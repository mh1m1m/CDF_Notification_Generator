/**
 * notification — the V13 notification lifecycle (W-D1, charter §9).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Node 22, ESM, node:crypto only (via util).
 *
 * One lifecycle record = one version of one logical notification to one recipient on one channel; the versions of one
 * notification_id form its lineage. Record-level states (charter §3.4) and transitions (lead ruling L-04 item 5,
 * work/LEAD_notes.md, 27 Oct 2026):
 *   DRAFT → VALIDATED → [AUTHORIZATION_PENDING →] AUTHORIZED → QUEUED → SENT → DELIVERY_CONFIRMED | DELIVERY_FAILED
 *   DRAFT | VALIDATED | AUTHORIZATION_PENDING | AUTHORIZED | QUEUED | CORRECTED → CANCELLED
 *   SENT | DELIVERY_CONFIRMED | DELIVERY_FAILED → SUPERSEDED   CORRECTED → VALIDATED | CANCELLED
 * Correction (L-04; charter §9 "SENT/DELIVERY_* → CORRECTED (new version, old SUPERSEDED)" read at lineage level):
 *   correcting the lineage's current version n (SENT, DELIVERY_CONFIRMED or DELIVERY_FAILED) creates version n+1 in
 *   CORRECTED with `corrects` = {version n, reason code}; versions are immutable and version n keeps its state. Pending
 *   outbox retries of version n are suppressed at that moment (CORRECTION_PENDING: a known-wrong text is never re-sent).
 *   Version n stays current until version n+1 reaches SENT; in that same step version n moves to SUPERSEDED, which is
 *   reachable only that way. If version n+1 is CANCELLED, version n stays current and a new correction may start.
 *   VALIDATED → AUTHORIZED directly only when the type's approval is explicitly not required (charter §9: AUTHORIZATION_PENDING
 *   "if the authority model requires approval"); a missing or SOURCE_REQUIRED approval spec fails closed to "required".
 *
 * Gates (each refused transition throws LifecycleError with a code; denials are audited as the platform does):
 *   DRAFT       the recipient is one the resolution port returns for this type and object (class and capacity from
 *               there; addresses refused); the case is the procedural object's own case — a different, unknown or
 *               display-number case is refused (NOT_FOUND), so a caller cannot pull another case into the context.
 *   VALIDATED   the model passed the disclosure projection (`_disclosure_applied === true` and `_disclosure_log`,
 *               charter §0.6, §5) and engine.validate(ctx).ok — ctx is assembled HERE from the authoritative read models
 *               (case, procedural object, recorded events, ledger) plus the caller's procedural statement; the caller
 *               cannot supply events, the case, the authority result or the recipient (they are refused).
 *   AUTHORIZED  approval required ⇒ only from AUTHORIZATION_PENDING and only when the authority port answers ALLOWED for
 *               the type's action and the approving actor; DENIED / SOURCE_REQUIRED / no port / no action ⇒ refused.
 *   QUEUED      through notifyOutbox.enqueue (notify.enqueue, 1920:242-268); nothing queued ⇒ refused with the reason.
 *   SENT        EMAIL: only after the outbox row was claimed (notify.claim_email_batch, 1920:581-594);
 *               IN_APP: the row is inserted SENT with delivered_at (1920:262-263), so QUEUED → SENT → DELIVERY_CONFIRMED
 *               are recorded together (lead ruling L-02). A correcting version's SENT supersedes its predecessor.
 *   DELIVERY_*  only when the outbox row is settled accordingly (notify.record_email_delivery, 1920:598-617): a caller
 *               cannot assert delivery the outbox did not record. EMAIL DELIVERY_CONFIRMED additionally needs the
 *               SETTLEMENT configuration; under the default ACCEPTANCE it needs a provider delivery report (L-07).
 *   CANCELLED   reason code + actor; a QUEUED e-mail only while unclaimed — its row stays PENDING (no cancel exists in
 *               notify.*, GAP-OUT-03) and dispatch is suppressed.
 * Every transition appends one charter §3.3 Event to the audit ledger and one evidence record (lib/notifications/lifecycle/evidence.ts).
 * Recipient acknowledgement is an Event (RECIPIENT_ACKNOWLEDGED), never a state. Export never changes state.
 * Optimistic concurrency: every record carries `revision`; a stale snapshot is refused (mirrors row_version, 0400:127).
 */
import "server-only";
import {
  deepFreeze,
  clone,
  hashOf,
  defaultClock,
  defaultIds,
  OPAQUE_ID,
  UUID,
  type DeepReadonly,
} from "./util";
import {
  idempotencyKey,
  createIdempotencyRegistry,
  RETRY_POLICY,
  orderEvents,
  parseInstant,
  type RetryPolicy,
} from "./idempotency";
import {
  validate as engineValidate,
  assertMinimumRuleSet,
  RULES,
  type RuleItem,
  type ValidationResult,
} from "../consistency/engine";
import type {
  ConsistencyContext,
  ConsistencyRule,
  CtxAuthority,
  CtxDeadline,
  FieldShown,
} from "../consistency/rules";
import { toEvent, RECIPIENT_CLASSES } from "./vocabulary";
import { buildExportEml, ExportError, type ExportResult, type RenderedInput } from "./export";
import type {
  Actor,
  AuditLedgerPort,
  AuthorityPort,
  CaseReadModelPort,
  Channel,
  CharterEvent,
  EvidenceData,
  EvidenceEntry,
  EvidenceKind,
  EvidenceStorePort,
  LedgerEntry,
  NotificationSenderPort,
  NotifyOutboxPort,
  ObjectRef,
  OutboxRow,
  Payload,
  ProceduralReadModelPort,
  ProjectionPort,
  RecipientResolutionPort,
  ResolvedRecipient,
} from "./ports";
import { isProjected as disclosureIsProjected } from "@/lib/disclosure";

/**
 * The default projection port is W-D2's own brand check (SEC review of #45, LOW: fail closed). Without it the VALIDATED
 * gate would accept any object that only claims `_disclosure_applied: true`. Passing `projection: null` does not turn the
 * check off; a caller can only replace it with another port.
 */
export const DISCLOSURE_PROJECTION_PORT: ProjectionPort = Object.freeze({
  isProjected: (m: unknown) => disclosureIsProjected(m),
});

export const NOTIFICATION_STATUSES = Object.freeze([
  "DRAFT",
  "VALIDATED",
  "AUTHORIZATION_PENDING",
  "AUTHORIZED",
  "QUEUED",
  "SENT",
  "DELIVERY_CONFIRMED",
  "DELIVERY_FAILED",
  "CANCELLED",
  "CORRECTED",
  "SUPERSEDED",
] as const);

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const ALLOWED_TRANSITIONS: DeepReadonly<Record<NotificationStatus, NotificationStatus[]>> = deepFreeze(
  {
    DRAFT: ["VALIDATED", "CANCELLED"],
    VALIDATED: ["AUTHORIZATION_PENDING", "AUTHORIZED", "CANCELLED"],
    AUTHORIZATION_PENDING: ["AUTHORIZED", "CANCELLED"],
    AUTHORIZED: ["QUEUED", "CANCELLED"],
    QUEUED: ["SENT", "CANCELLED"],
    SENT: ["DELIVERY_CONFIRMED", "DELIVERY_FAILED", "SUPERSEDED"],
    DELIVERY_CONFIRMED: ["SUPERSEDED"],
    DELIVERY_FAILED: ["SUPERSEDED"],
    CORRECTED: ["VALIDATED", "CANCELLED"],
    CANCELLED: [],
    SUPERSEDED: [],
  },
);

/**
 * Charter §9 "SENT/DELIVERY_* → CORRECTED" read at lineage level (L-04 item 5): the lineage's current version in one of
 * these states may be corrected, which creates the next version in CORRECTED (its entry state) and leaves this one as it is.
 */
export const LINEAGE_TRANSITIONS: DeepReadonly<Partial<Record<NotificationStatus, NotificationStatus[]>>> =
  deepFreeze({
    SENT: ["CORRECTED"],
    DELIVERY_CONFIRMED: ["CORRECTED"],
    DELIVERY_FAILED: ["CORRECTED"],
  });

export const TERMINAL_STATUSES = Object.freeze(["CANCELLED", "SUPERSEDED"] as const);
/** States of a version that has been issued (handed to its channel) — the only states a lineage's current version
 * can have once anything was sent. */
export const ISSUED_STATUSES = Object.freeze(["SENT", "DELIVERY_CONFIRMED", "DELIVERY_FAILED"] as const);
/** States of a correcting version that is neither issued nor cancelled: the lineage has a correction pending. */
const PENDING_CORRECTION_STATUSES: readonly NotificationStatus[] = Object.freeze([
  "CORRECTED",
  "VALIDATED",
  "AUTHORIZATION_PENDING",
  "AUTHORIZED",
  "QUEUED",
]);

/**
 * What may move a version to DELIVERY_CONFIRMED (lead ruling L-07, aligned to W-B docs/V13-03 §8 :357; W-A gap G-08):
 *   ACCEPTANCE   (default) for EMAIL a sender success is a delivery attempt ACCEPTED_BY_PROVIDER (evidence entry) and the
 *                version stays SENT ("sent; delivery not confirmed"). DELIVERY_CONFIRMED needs a provider delivery
 *                report, which the platform does not have today (UNVERIFIED; the CDF mail relay's semantics are
 *                SOURCE_REQUIRED; PRODUCTION_SUBSTITUTION_REQUIRED at W-B stages S3/S8), so it is refused here
 *                (DELIVERY_REPORT_REQUIRED). Failure after the last attempt is DELIVERY_FAILED.
 *   SETTLEMENT   explicit configuration only — charter §9 read literally: record_email_delivery(true) confirms delivery,
 *                and the Event names its evidence kind (SENDER_ADAPTER_REPORTED_SUCCESS). To be switched on only on
 *                evidence of the relay's semantics.
 * IN_APP follows L-02 in both modes: the committed inbox row is SENT and DELIVERY_CONFIRMED together (evidence kind
 * IN_APP_ROW_CREATED). Reading it is NOTIFICATION_READ (api.mark_notification_read, 1920:504), never an acknowledgement.
 * Nothing in V13 starts a right or a period from acceptance or delivery alone (PC-05, PC-16, PC-22).
 */
export const DELIVERY_CONFIRMATION_MODES = Object.freeze(["ACCEPTANCE", "SETTLEMENT"] as const);
export type DeliveryConfirmationMode = (typeof DELIVERY_CONFIRMATION_MODES)[number];

/** Ledger event type appended when a version enters each state. */
export const TRANSITION_EVENT_TYPES: Readonly<Record<NotificationStatus, string>> = Object.freeze({
  DRAFT: "NOTIFICATION_DRAFTED",
  VALIDATED: "NOTIFICATION_VALIDATED",
  AUTHORIZATION_PENDING: "NOTIFICATION_AUTHORIZATION_REQUESTED", // PROPOSAL: not in the charter §3.3 minimum set
  AUTHORIZED: "NOTIFICATION_AUTHORIZED",
  QUEUED: "NOTIFICATION_QUEUED",
  SENT: "NOTIFICATION_SENT",
  DELIVERY_CONFIRMED: "DELIVERY_CONFIRMED",
  DELIVERY_FAILED: "DELIVERY_FAILED",
  CANCELLED: "NOTIFICATION_CANCELLED",
  CORRECTED: "NOTIFICATION_CORRECTED",
  SUPERSEDED: "NOTIFICATION_SUPERSEDED",
});

/** Charter §3.3 notification event types (minimum set) — every lifecycle Event type is one of these or PROPOSED below. */
export const CHARTER_NOTIFICATION_EVENT_TYPES: readonly string[] = Object.freeze([
  "NOTIFICATION_DRAFTED",
  "NOTIFICATION_VALIDATED",
  "NOTIFICATION_AUTHORIZED",
  "NOTIFICATION_QUEUED",
  "NOTIFICATION_SENT",
  "DELIVERY_CONFIRMED",
  "DELIVERY_FAILED",
  "NOTIFICATION_CANCELLED",
  "NOTIFICATION_CORRECTED",
  "NOTIFICATION_SUPERSEDED",
  "RECIPIENT_ACKNOWLEDGED",
]);
export const PROPOSED_EVENT_TYPES: readonly string[] = Object.freeze([
  "NOTIFICATION_AUTHORIZATION_REQUESTED",
]);

/**
 * Ledger actions that are audit records, not charter Events: export and suppression (PROPOSAL); COMMAND_DENIED and
 * VALIDATION_REJECTED mirror the platform's security-event allow-list (packages/audit/src/index.ts:11-16).
 */
export const AUDIT_ONLY_ACTIONS: readonly string[] = Object.freeze([
  "NOTIFICATION_EXPORTED",
  "NOTIFICATION_SUPPRESSED",
  "COMMAND_DENIED",
  "VALIDATION_REJECTED",
]);

/** Keys a caller may put in the procedural statement checked at VALIDATED. Everything authoritative is read here. */
export const STATEMENT_KEYS: readonly string[] = Object.freeze([
  "claims",
  "fields_shown",
  "deadline",
  "l1_code",
  "case_effect",
  "event_label_type",
  "allowed_trigger_types",
  "informational",
  "required_action",
  "rendered_from_event_id",
  "addressed_capacities",
  "journey_capacities",
  "authority_action_id",
  "progress",
  "alternative_groups",
]);

const SYSTEM_ACTOR: Readonly<Actor> = Object.freeze({ capacity: "SYSTEM", id: "v13-notification-lifecycle" });
const DISPATCHER: Readonly<Actor> = Object.freeze({ capacity: "SYSTEM", id: "v13-notification-dispatcher" });
const PROVENANCE = Object.freeze({ source: "SYNTHETIC_DEMO", ref: "src/lifecycle/notification.js" });
const TYPE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const CAPACITY = /^[A-Z][A-Z0-9_]{1,63}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Array.prototype.includes for a value whose type is not yet known. */
const isIn = (list: readonly unknown[], value: unknown): boolean => list.includes(value);

export class LifecycleError extends Error {
  readonly code: string;
  readonly details: DeepReadonly<Record<string, unknown>>;
  constructor(code: string, details: Record<string, unknown> = {}) {
    super(`notification lifecycle: ${code}`); // generic message — codes and ids only, never content (§82, §83)
    this.name = "LifecycleError";
    this.code = code;
    this.details = deepFreeze(clone(details));
  }
}

export const canTransition = (from: unknown, to: unknown): boolean =>
  typeof from === "string" &&
  Object.hasOwn(ALLOWED_TRANSITIONS, from) &&
  isIn(ALLOWED_TRANSITIONS[from as NotificationStatus], to); // no prototype keys
/** Whether the lineage's current version in `status` may be corrected (LINEAGE_TRANSITIONS). */
export const canCorrect = (status: unknown): boolean =>
  typeof status === "string" &&
  Object.hasOwn(LINEAGE_TRANSITIONS, status) &&
  isIn(LINEAGE_TRANSITIONS[status as NotificationStatus] ?? [], "CORRECTED");
export const isTerminal = (status: unknown): boolean => isIn(TERMINAL_STATUSES, status);

/** A model that passed the disclosure projection (charter §0.6). */
export interface ProjectedModel {
  readonly _disclosure_applied: true;
  readonly _disclosure_log: object;
  readonly [key: string]: unknown;
}

/** Charter §0.6: a model that passed the disclosure projection. */
export function isProjectedModel(model: unknown): model is ProjectedModel {
  const m = model as
    { readonly _disclosure_applied?: unknown; readonly _disclosure_log?: unknown } | null | undefined;
  return (
    Boolean(m) &&
    typeof m === "object" &&
    m !== null &&
    m._disclosure_applied === true &&
    m._disclosure_log !== null &&
    typeof m._disclosure_log === "object"
  );
}

/** Approval of a notification type (fails closed to "required" with basis SOURCE_REQUIRED). */
export interface ApprovalSpec {
  required: boolean;
  basis: string;
  action_id: string | null;
}

/** Synthetic type configuration as given (the catalogue in production); every field is checked at construction. */
export interface NotificationTypeInput {
  readonly template_code?: unknown;
  readonly template_version?: unknown;
  readonly channels?: readonly unknown[];
  readonly approval?: {
    readonly required?: unknown;
    readonly basis?: unknown;
    readonly action_id?: unknown;
  } | null;
  readonly allowed_trigger_types?: readonly string[];
  readonly journey_capacities?: readonly string[];
  readonly key_occurrence?: unknown;
}

/** A normalized notification type. */
export interface NotificationType {
  template_code: string;
  template_version: string | null;
  channels: Channel[];
  approval: ApprovalSpec;
  allowed_trigger_types: string[] | null;
  journey_capacities: string[] | null;
  key_occurrence: "EVENT" | null;
}

function normalizeApproval(spec: NotificationTypeInput["approval"]): ApprovalSpec {
  const action_id =
    spec && typeof spec.action_id === "string" && TYPE_CODE.test(spec.action_id) ? spec.action_id : null;
  const basis = spec && typeof spec.basis === "string" && spec.basis.length <= 120 ? spec.basis : null;
  if (spec?.required === false)
    return { required: false, basis: basis ?? "NOT_REQUIRED_BY_TYPE_CONFIGURATION", action_id };
  if (spec?.required === true) return { required: true, basis: basis ?? "AUTHORITY_MODEL", action_id };
  return { required: true, basis: "SOURCE_REQUIRED", action_id }; // absent / SOURCE_REQUIRED / anything else: fail closed
}

function normalizeTypes(
  types: Readonly<Record<string, NotificationTypeInput | null | undefined>> | null | undefined,
): Readonly<Record<string, DeepReadonly<NotificationType>>> {
  const out: Record<string, DeepReadonly<NotificationType>> = {};
  for (const [code, t] of Object.entries(types ?? {})) {
    if (!TYPE_CODE.test(code))
      throw new LifecycleError("INVALID_TYPE_CONFIGURATION", { type_code: code, field: "type_code" });
    if (!TYPE_CODE.test(String(t?.template_code ?? "")))
      throw new LifecycleError("INVALID_TYPE_CONFIGURATION", { type_code: code, field: "template_code" });
    const def = t as NotificationTypeInput;
    if (
      def.channels !== undefined &&
      !(Array.isArray(def.channels) && def.channels.every((c) => isIn(["EMAIL", "IN_APP"], c)))
    ) {
      throw new LifecycleError("INVALID_TYPE_CONFIGURATION", { type_code: code, field: "channels" });
    }
    if (def.key_occurrence !== undefined && def.key_occurrence !== "EVENT")
      throw new LifecycleError("INVALID_TYPE_CONFIGURATION", { type_code: code, field: "key_occurrence" });
    out[code] = deepFreeze({
      template_code: def.template_code as string,
      template_version:
        typeof def.template_version === "string" && OPAQUE_ID.test(def.template_version)
          ? def.template_version
          : null,
      channels: def.channels ? ([...def.channels] as Channel[]) : (["EMAIL", "IN_APP"] as Channel[]),
      approval: normalizeApproval(def.approval),
      allowed_trigger_types: Array.isArray(def.allowed_trigger_types) ? [...def.allowed_trigger_types] : null,
      journey_capacities: Array.isArray(def.journey_capacities) ? [...def.journey_capacities] : null,
      key_occurrence: (def.key_occurrence as "EVENT" | undefined) ?? null,
    });
  }
  return Object.freeze(out);
}

function normalizeLog(log: unknown): Readonly<Record<string, unknown>> | null {
  if (Array.isArray(log)) {
    return Object.fromEntries(
      (log as readonly unknown[])
        .filter(
          (e): e is { field: string; outcome?: unknown } =>
            Boolean(e) && typeof (e as { field?: unknown }).field === "string",
        )
        .map((e) => [e.field, e.outcome ?? null]),
    );
  }
  return log as Readonly<Record<string, unknown>> | null;
}

/** The record key (a snapshot's notification_id and version). */
const keyOf = (r: { readonly notification_id: unknown; readonly version: unknown }): string =>
  `${String(r.notification_id)}#${String(r.version)}`;

/** The components of a record's idempotency key (charter §9 + tagged PROPOSAL parts). */
export interface RecordKeyComponents {
  type_code: string;
  object_id: string;
  recipient_id: string;
  version: number;
  policy_version: string;
  channel: Channel;
  occurrence_id?: string;
}

/** One version of one logical notification to one recipient on one channel. */
export interface NotificationRecord {
  notification_id: string;
  version: number;
  revision: number;
  status: NotificationStatus;
  type_code: string;
  object: ObjectRef;
  case_id: string | null;
  channel: Channel;
  recipient: ResolvedRecipient;
  template: { code: string; version: string | null };
  policy_version: string;
  originating_event_id: string;
  idempotency_key: string;
  key_components: RecordKeyComponents;
  approval: ApprovalSpec;
  correlation_id: string;
  corrects: { notification_id: string; version: number; reason_code: string } | null;
  superseded_by: number | null;
  outbox: { row_id: string; channel: Channel; template_code: string } | null;
  model_hash: string | null;
  validation: { rules_version: string; engine_version: string; warnings: string[] } | null;
  created_at: string;
  updated_at: string;
  last_event_id: string | null;
}

/** A caller's snapshot of a record: only its key and revision are read (everything else comes from the store). */
export interface RecordSnapshot {
  readonly notification_id?: unknown;
  readonly version?: unknown;
  readonly revision?: unknown;
}

/** The procedural statement a caller may make at VALIDATED (keys limited to STATEMENT_KEYS). */
export interface Statement {
  readonly claims?: Readonly<Record<string, unknown>>;
  readonly fields_shown?: readonly FieldShown[];
  readonly deadline?: CtxDeadline | null;
  readonly l1_code?: string | null;
  readonly case_effect?: string | null;
  readonly event_label_type?: string | null;
  readonly allowed_trigger_types?: readonly string[] | null;
  readonly informational?: boolean;
  readonly required_action?: { readonly kind?: string } | null;
  readonly rendered_from_event_id?: string | null;
  readonly addressed_capacities?: readonly string[] | null;
  readonly journey_capacities?: readonly string[] | null;
  readonly authority_action_id?: string | null;
  readonly progress?: ConsistencyContext["progress"];
  readonly alternative_groups?: ConsistencyContext["alternative_groups"];
}

/** Inputs of a transition; each is checked by the step that needs it. */
export interface TransitionInput {
  readonly actor?: unknown;
  readonly model?: unknown;
  readonly statement?: unknown;
  readonly reason_code?: unknown;
  readonly policy_version?: unknown;
  readonly template_version?: unknown;
  readonly originating_event_id?: unknown;
}

/** Inputs of draft(); every field is checked before anything is written. */
export interface DraftInput {
  readonly type_code?: unknown;
  readonly object?: { readonly type?: unknown; readonly id?: unknown } | null;
  readonly case_id?: unknown;
  readonly originating_event_id?: unknown;
  readonly recipient_id?: unknown;
  readonly recipient_class?: unknown;
  readonly capacity?: unknown;
  readonly channel?: unknown;
  readonly policy_version?: unknown;
  readonly template_version?: unknown;
  readonly actor?: unknown;
  readonly correlation_id?: unknown;
}

export interface DraftResult {
  duplicate: boolean;
  record: NotificationRecord;
  idempotency_key: string;
  events: LedgerEntry[];
}

export interface TransitionResult {
  record: NotificationRecord;
  events: LedgerEntry[];
  warnings: RuleItem[];
  /** Set when this step superseded the predecessor (a correcting version reached SENT). */
  superseded?: NotificationRecord;
  /** Set on a lineage-level correction: version n, unchanged and still current. */
  predecessor?: NotificationRecord;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  retrying: number;
  suppressed: number;
  unmanaged: number;
}

export interface AcknowledgeResult {
  duplicate: boolean;
  event: LedgerEntry;
  record: NotificationRecord;
}

export interface LineageView {
  notification_id: string;
  current_version: number;
  pending_version: number | null;
  current: NotificationRecord;
  versions: {
    version: number;
    status: NotificationStatus;
    corrects_version: number | null;
    superseded_by: number | null;
  }[];
}

/**
 * Dependencies of the lifecycle:
 *   ledger, evidence, outbox, recipients, cases, procedural  (required: the ports in ./ports)
 *   sender                     NotificationSender (required for dispatchEmailBatch only)
 *   authority                  { check({action_id, actor, object, case_id}) → {result, reason} } — W-D2 check() wrapper
 *   projection                 { isProjected(model) } — W-D2 brand check, applied in addition to isProjectedModel;
 *                              defaults to DISCLOSURE_PROJECTION_PORT (lib/disclosure isProjected), never to "accept"
 *   types                      { [type_code]: {template_code, template_version?, channels?, approval?, allowed_trigger_types?,
 *                                journey_capacities?, key_occurrence?} } — synthetic configuration (catalogue in production)
 *   rules, validate, deadlineRules, retryPolicy, clock, ids
 *   deliveryConfirmation       'ACCEPTANCE' (default, L-07) | 'SETTLEMENT' (explicit only; see DELIVERY_CONFIRMATION_MODES)
 */
export interface LifecycleDeps {
  ledger?: AuditLedgerPort | null;
  evidence?: EvidenceStorePort | null;
  outbox?: NotifyOutboxPort | null;
  sender?: NotificationSenderPort | null;
  recipients?: RecipientResolutionPort | null;
  cases?: CaseReadModelPort | null;
  procedural?: ProceduralReadModelPort | null;
  authority?: AuthorityPort | null;
  projection?: ProjectionPort | null;
  types?: Readonly<Record<string, NotificationTypeInput | null | undefined>> | null;
  rules?: readonly ConsistencyRule[];
  validate?: (ctx: ConsistencyContext, rules: readonly ConsistencyRule[]) => DeepReadonly<ValidationResult>;
  deadlineRules?: ConsistencyContext["deadline_rules"];
  retryPolicy?: RetryPolicy;
  clock?: () => string;
  ids?: () => string;
  deliveryConfirmation?: string;
}

export interface NotificationLifecycle {
  readonly kind: "v13-notification-lifecycle";
  draft(input?: DraftInput): DeepReadonly<DraftResult>;
  transition(
    record: RecordSnapshot | null | undefined,
    to: string,
    event?: TransitionInput | null,
  ): DeepReadonly<TransitionResult>;
  dispatchEmailBatch(limit?: number): Promise<DeepReadonly<DispatchResult>>;
  acknowledge(
    record: RecordSnapshot | null | undefined,
    input?: { actor?: unknown; occurred_at?: string },
  ): DeepReadonly<AcknowledgeResult>;
  exportEml(
    record: RecordSnapshot | null | undefined,
    input?: { rendered?: RenderedInput | null; model?: unknown; actor?: unknown },
  ): ExportResult;
  get(notificationId: string, version?: number): DeepReadonly<NotificationRecord> | null;
  versions(notificationId: string): DeepReadonly<NotificationRecord>[];
  history(notificationId: string): DeepReadonly<CharterEvent>[];
  exceptions(notificationId: string): DeepReadonly<EvidenceEntry>[];
  lineage(notificationId: string): DeepReadonly<LineageView> | null;
  records(): DeepReadonly<NotificationRecord>[];
  readonly deliveryConfirmation: DeliveryConfirmationMode;
  isSuppressed(rowId: string): boolean;
  suppressionReason(rowId: string): string | null;
  types(): Readonly<Record<string, DeepReadonly<NotificationType>>>;
}

type ReadonlyEntry = DeepReadonly<LedgerEntry>;

interface StepResult {
  events: ReadonlyEntry[];
  warnings?: DeepReadonly<RuleItem>[];
  superseded?: NotificationRecord | null;
  next?: NotificationRecord;
  predecessor?: NotificationRecord;
}

function need<T>(name: string, dep: T | null | undefined): T {
  if (!dep) throw new LifecycleError("DEPENDENCY_MISSING", { dependency: name });
  return dep;
}

export function createNotificationLifecycle(deps: LifecycleDeps = {}): NotificationLifecycle {
  const {
    sender = null,
    authority = null,
    projection: projectionIn = null,
    types: rawTypes = {},
    rules = RULES,
    validate = engineValidate,
    deadlineRules = undefined,
    retryPolicy = RETRY_POLICY,
    clock = defaultClock,
    ids = defaultIds,
    deliveryConfirmation = "ACCEPTANCE",
  } = deps;
  // Same order as the reference: ledger, evidence, outbox, recipients, cases, procedural.
  const ledger = need("ledger", deps.ledger);
  const evidence = need("evidence", deps.evidence);
  const outbox = need("outbox", deps.outbox);
  const recipients = need("recipients", deps.recipients);
  const cases = need("cases", deps.cases);
  const procedural = need("procedural", deps.procedural);
  if (retryPolicy.maxAttempts !== outbox.MAX_ATTEMPTS) {
    // The platform settles FAILED at attempts >= 5 (1920:609); a different lifecycle ceiling would contradict the outbox.
    throw new LifecycleError("RETRY_POLICY_DIVERGES", {
      lifecycle: retryPolicy.maxAttempts,
      outbox: outbox.MAX_ATTEMPTS,
    });
  }
  assertMinimumRuleSet(rules);
  if (!isIn(DELIVERY_CONFIRMATION_MODES, deliveryConfirmation)) {
    throw new LifecycleError("INVALID_CONFIGURATION", { field: "deliveryConfirmation" });
  }
  const confirmationMode = deliveryConfirmation as DeliveryConfirmationMode;
  const emailConfirmsOnSettlement = confirmationMode === "SETTLEMENT"; // IN_APP confirms on insert in both modes (L-02)
  const types = normalizeTypes(rawTypes);
  /** The normalized configuration of a known type code (records only ever carry configured types). */
  const typeOf = (code: string): DeepReadonly<NotificationType> =>
    types[code] as DeepReadonly<NotificationType>;

  const state = new Map<string, NotificationRecord>(); // `${id}#${v}` → mutable record (internal only)
  const latest = new Map<string, number>(); // id → latest version
  const registry = createIdempotencyRegistry();
  const byOutboxRow = new Map<string, string>(); // outbox row id → record key
  const suppressedRows = new Map<string, string>(); // outbox row id → reason code of the suppression

  const view = (rec: NotificationRecord): DeepReadonly<NotificationRecord> => deepFreeze(clone(rec));
  const pickActor = (a: unknown): Actor | null => {
    const x = a as { readonly capacity?: unknown; readonly id?: unknown } | null | undefined;
    return x &&
      typeof x === "object" &&
      CAPACITY.test(String(x.capacity ?? "")) &&
      typeof x.id === "string" &&
      OPAQUE_ID.test(x.id)
      ? { capacity: x.capacity as string, id: x.id }
      : null;
  };
  const projection = projectionIn ?? DISCLOSURE_PROJECTION_PORT;
  const isProjected = (m: unknown): m is ProjectedModel =>
    isProjectedModel(m) && projection.isProjected(m) === true;

  function requireActor(actor: unknown, field = "actor"): Actor {
    const a = pickActor(actor);
    if (!a) throw new LifecycleError("ACTOR_REQUIRED", { field });
    return a;
  }

  interface AppendOptions {
    actor?: unknown;
    occurred_at?: string | undefined;
    causation_id?: string | null | undefined;
    payload: Payload;
  }

  function appendEvent(
    rec: NotificationRecord,
    type: string,
    { actor, occurred_at, causation_id, payload }: AppendOptions,
  ): ReadonlyEntry {
    return ledger.append(
      {
        type,
        occurred_at: occurred_at ?? clock(),
        case_id: rec.case_id ?? null,
        object: { type: "NOTIFICATION", id: rec.notification_id },
        actor: pickActor(actor) ?? SYSTEM_ACTOR,
        provenance: PROVENANCE,
        version: rec.version,
        causation_id: causation_id ?? rec.last_event_id ?? null,
        correlation_id: rec.correlation_id,
        payload,
      },
      { category: "BUSINESS", outcome: "SUCCESS" },
    );
  }

  const addEvidence = (
    rec: NotificationRecord,
    kind: EvidenceKind,
    data: EvidenceData,
  ): DeepReadonly<EvidenceEntry> =>
    evidence.append({ notification_id: rec.notification_id, version: rec.version, kind, data });

  interface DeniedOptions {
    command: string;
    outcome?: string;
    action?: "COMMAND_DENIED" | "VALIDATION_REJECTED";
    objectId?: string | null;
    actor?: unknown;
    details?: Record<string, unknown>;
    rec?: NotificationRecord | null;
  }

  /** Records a refusal the way the platform does (COMMAND_DENIED / VALIDATION_REJECTED, SECURITY, DENIED, metadata
   * {command, outcome} only — inbox.ts:45-60) and returns the error to throw. Recording never masks the denial. */
  function denied(
    code: string,
    {
      command,
      outcome = "FORBIDDEN",
      action = "COMMAND_DENIED",
      objectId = null,
      actor = null,
      details = {},
      rec = null,
    }: DeniedOptions,
  ): LifecycleError {
    try {
      ledger.append(
        {
          type: action,
          occurred_at: clock(),
          case_id: rec?.case_id ?? null,
          object: { type: "command", id: objectId ?? rec?.notification_id ?? command },
          actor: pickActor(actor),
          provenance: PROVENANCE,
          payload: { command, outcome },
        },
        { category: "SECURITY", outcome: "DENIED" },
      );
    } catch {
      /* recording must never mask the original denial (packages/application/src/inbox.ts:57-59) */
    }
    if (rec) {
      try {
        addEvidence(rec, "REFUSAL", { command, reason_code: code, at: clock() });
      } catch {
        /* idem */
      }
    }
    return new LifecycleError(code, details);
  }

  function refusal(
    rec: NotificationRecord,
    code: string,
    extra: Record<string, unknown> = {},
  ): LifecycleError {
    addEvidence(rec, "REFUSAL", { reason_code: code, at: clock(), ...extra });
    return new LifecycleError(code, extra);
  }

  interface MoveOptions {
    actor?: unknown;
    payload?: Payload;
    data?: EvidenceData;
    causation_id?: string | null;
    occurred_at?: string | null;
  }

  /** The one place a state changes: appends the Event, then the evidence record, then moves the record. */
  function move(
    rec: NotificationRecord,
    to: NotificationStatus,
    { actor, payload = {}, data = {}, causation_id, occurred_at }: MoveOptions = {},
  ): ReadonlyEntry {
    const from = rec.status;
    const at = occurred_at ?? clock();
    const entry = appendEvent(rec, TRANSITION_EVENT_TYPES[to], {
      actor,
      occurred_at: at,
      causation_id,
      payload: { from, to, ...payload },
    });
    addEvidence(rec, "TRANSITION", {
      from,
      to,
      event_id: entry.event_id,
      at,
      actor: pickActor(actor) ?? SYSTEM_ACTOR,
      ...data,
    });
    rec.status = to;
    rec.revision += 1;
    rec.last_event_id = entry.event_id;
    rec.updated_at = at;
    return entry;
  }

  /**
   * NOTIFICATION_SENT names the template and the subject object (W-C convention, work/new_event_types.md — PROPOSAL), so a
   * journey step "… notified" can complete on the recorded send and never on a rendering. Codes and ids only; ledger
   * payload only (the evidence store holds no `subject…` keys).
   */
  const sentRefs = (rec: NotificationRecord): Payload => ({
    template_code: rec.template.code,
    type_code: rec.type_code,
    subject_object_type: rec.object.type,
    subject_object_id: rec.object.id,
  });

  function current(record: RecordSnapshot | null | undefined): NotificationRecord {
    if (!record || typeof record.notification_id !== "string" || !Number.isInteger(record.version))
      throw new LifecycleError("INVALID_RECORD");
    const rec = state.get(keyOf({ notification_id: record.notification_id, version: record.version }));
    if (!rec)
      throw new LifecycleError("UNKNOWN_NOTIFICATION", {
        notification_id: record.notification_id,
        version: record.version,
      });
    if (record.revision !== rec.revision) {
      throw new LifecycleError("STALE_RECORD", {
        expected_revision: rec.revision,
        given_revision: record.revision ?? null,
      });
    }
    return rec;
  }

  /** The stored version `n` of a lineage (always present for 1 ≤ n ≤ latest). */
  const versionOf = (notificationId: string, n: number): NotificationRecord =>
    state.get(`${notificationId}#${n}`) as NotificationRecord;

  /**
   * The lineage of one notification (L-04): its versions, its current version and a pending correction. The current
   * version is the latest issued one (SENT, DELIVERY_CONFIRMED, DELIVERY_FAILED); before anything was issued it is
   * version 1 — a correction starts only from an issued version, so a lineage without one has a single version.
   */
  function lineageOf(notificationId: string): {
    recs: NotificationRecord[];
    current: NotificationRecord | null;
    pending: NotificationRecord | null;
  } {
    const n = latest.get(notificationId) ?? 0;
    const recs = Array.from({ length: n }, (_, i) => versionOf(notificationId, i + 1));
    const cur = recs.filter((r) => isIn(ISSUED_STATUSES, r.status)).at(-1) ?? recs[0] ?? null;
    const last = recs.at(-1) ?? null;
    const pending = last && last.corrects && PENDING_CORRECTION_STATUSES.includes(last.status) ? last : null;
    return { recs, current: cur, pending };
  }

  /** The version a correcting version will supersede when it reaches SENT; checked before anything is written. */
  function predecessorToSupersede(rec: NotificationRecord): NotificationRecord | null {
    if (!rec.corrects) return null;
    const prev = state.get(keyOf(rec.corrects)) ?? null;
    if (!prev || !canTransition(prev.status, "SUPERSEDED")) {
      // Unreachable by construction (a pending correction's predecessor stays issued); refused rather than half-applied.
      throw new LifecycleError("PREDECESSOR_NOT_SUPERSEDABLE", {
        corrects_version: rec.corrects.version,
        status: prev?.status ?? null,
      });
    }
    return prev;
  }

  /**
   * QUEUED → SENT and, for a correcting version, its predecessor's move to SUPERSEDED in the same step (L-04 item 2):
   * a version is superseded only when its replacement has actually been issued.
   */
  function sendStep(
    rec: NotificationRecord,
    {
      actor,
      occurred_at,
      payload,
      data,
    }: { actor: unknown; occurred_at?: string | null; payload: Payload; data: EvidenceData },
  ): { events: ReadonlyEntry[]; superseded: NotificationRecord | null } {
    const prev = predecessorToSupersede(rec);
    const sent = move(rec, "SENT", { actor, occurred_at, payload, data });
    if (!prev || !rec.corrects) return { events: [sent], superseded: null };
    const reason_code = rec.corrects.reason_code ?? null;
    const sup = move(prev, "SUPERSEDED", {
      actor,
      occurred_at: sent.occurred_at,
      causation_id: sent.event_id,
      payload: { successor_version: rec.version, reason_code },
      data: { successor_version: rec.version },
    });
    prev.superseded_by = rec.version;
    addEvidence(prev, "CORRECTION", {
      superseded_by_version: rec.version,
      reason_code,
      event_id: sup.event_id,
      at: sent.occurred_at,
    });
    const row = prev.outbox ? outbox.getRow(prev.outbox.row_id) : null;
    if (row && row.status === "PENDING" && !suppressedRows.has(row.id))
      suppress(prev, row, "VERSION_SUPERSEDED"); // already suppressed at correction
    return { events: [sent, sup], superseded: prev };
  }

  interface ResolveInput {
    type_code: string;
    object: { readonly id: string };
    recipient_id: unknown;
    recipient_class: unknown;
    capacity: unknown;
    command: string;
    actor: unknown;
  }

  /** Authoritative recipient: one of the ids resolved for this type and object; class and capacity come from there. */
  function resolveRecipient({
    type_code,
    object,
    recipient_id,
    recipient_class,
    capacity,
    command,
    actor,
  }: ResolveInput): ResolvedRecipient {
    if (typeof recipient_id === "string" && /[@\s<>]/.test(recipient_id)) {
      throw denied("RECIPIENT_ADDRESS_NOT_ALLOWED", { command, objectId: object.id, actor });
    }
    if (typeof recipient_id !== "string" || !OPAQUE_ID.test(recipient_id))
      throw denied("RECIPIENT_NOT_RESOLVED", { command, objectId: object.id, actor });
    const resolved = recipients
      .resolve({ type_code, object_id: object.id })
      .find((r) => r.recipient_id === recipient_id);
    if (!resolved) throw denied("RECIPIENT_NOT_RESOLVED", { command, objectId: object.id, actor });
    if (recipient_class !== undefined && recipient_class !== resolved.class)
      throw denied("RECIPIENT_CLASS_MISMATCH", { command, objectId: object.id, actor });
    if (capacity !== undefined && capacity !== resolved.capacity)
      throw denied("RECIPIENT_CAPACITY_MISMATCH", { command, objectId: object.id, actor });
    if (!isIn(RECIPIENT_CLASSES, resolved.class)) throw new LifecycleError("INVALID_RECIPIENT_CLASS");
    return { recipient_id: resolved.recipient_id, class: resolved.class, capacity: resolved.capacity };
  }

  function issuanceContext(rec: NotificationRecord, extra: EvidenceData = {}): EvidenceData {
    return {
      type_code: rec.type_code,
      channel: rec.channel,
      originating_event_id: rec.originating_event_id,
      source_refs: [
        { kind: "EVENT", id: rec.originating_event_id },
        { kind: "OBJECT", type: rec.object.type, id: rec.object.id },
        ...(rec.case_id ? [{ kind: "CASE", id: rec.case_id }] : []),
      ],
      template: rec.template,
      policy_version: rec.policy_version,
      idempotency_key: rec.idempotency_key,
      key_components: rec.key_components,
      recipients: [rec.recipient],
      approval: rec.approval,
      corrects: rec.corrects,
      ...extra,
    };
  }

  // ------------------------------------------------------------------------------------------------- draft ---------
  function draft(input: DraftInput = {}): DeepReadonly<DraftResult> {
    const command = "notification_draft";
    const {
      type_code,
      object,
      case_id = null,
      originating_event_id,
      recipient_id,
      recipient_class,
      capacity,
      channel,
      policy_version,
      template_version,
      actor,
      correlation_id,
    } = input;
    if (!TYPE_CODE.test(String(type_code ?? "")))
      throw new LifecycleError("INVALID_INPUT", { field: "type_code" });
    const typeCode = type_code as string;
    const type = types[typeCode];
    if (!type) throw new LifecycleError("UNKNOWN_NOTIFICATION_TYPE", { type_code: typeCode });
    if (!object || !CAPACITY.test(String(object.type ?? "")) || !UUID.test(String(object.id ?? "")))
      throw new LifecycleError("INVALID_INPUT", { field: "object" });
    const obj: ObjectRef = { type: object.type as string, id: object.id as string };
    if (case_id !== null && !UUID.test(String(case_id)))
      throw new LifecycleError("INVALID_INPUT", { field: "case_id" });
    if (typeof originating_event_id !== "string" || !OPAQUE_ID.test(originating_event_id))
      throw new LifecycleError("INVALID_INPUT", { field: "originating_event_id" });
    if (!isIn(["EMAIL", "IN_APP"], channel)) throw new LifecycleError("INVALID_INPUT", { field: "channel" });
    const ch = channel as Channel;
    if (!type.channels.includes(ch))
      throw new LifecycleError("CHANNEL_NOT_CONFIGURED_FOR_TYPE", { type_code: typeCode, channel: ch });
    if (typeof policy_version !== "string" || !OPAQUE_ID.test(policy_version))
      throw new LifecycleError("INVALID_INPUT", { field: "policy_version" });
    if (
      template_version !== undefined &&
      (typeof template_version !== "string" || !OPAQUE_ID.test(template_version))
    )
      throw new LifecycleError("INVALID_INPUT", { field: "template_version" });
    if (
      correlation_id !== undefined &&
      (typeof correlation_id !== "string" || !OPAQUE_ID.test(correlation_id))
    )
      throw new LifecycleError("INVALID_INPUT", { field: "correlation_id" });
    const who = requireActor(actor);
    // The case is the authoritative object's case, never a free caller choice: a forged case_id would pull another
    // case's events into the consistency context. Unknown or mismatched answers NOT_FOUND (CLAUDE.md §87: every lookup
    // is authorised; nothing reveals whether another case exists).
    const po = procedural.getObject(obj.id);
    let caseId = case_id as string | null;
    if (po && po.exists !== false) {
      if (po.type !== obj.type)
        throw denied("OBJECT_TYPE_MISMATCH", { command, outcome: "NOT_FOUND", objectId: obj.id, actor: who });
      const objectCase = po.case_id ?? null;
      if (case_id !== null && case_id !== objectCase)
        throw denied("CASE_OBJECT_MISMATCH", { command, outcome: "NOT_FOUND", objectId: obj.id, actor: who });
      caseId = objectCase;
    }
    if (caseId !== null && cases.getCase(caseId)?.exists !== true) {
      throw denied("CASE_NOT_FOUND", { command, outcome: "NOT_FOUND", objectId: obj.id, actor: who });
    }
    const recipient = resolveRecipient({
      type_code: typeCode,
      object: obj,
      recipient_id,
      recipient_class,
      capacity,
      command,
      actor: who,
    });

    const key_components: RecordKeyComponents = {
      type_code: typeCode,
      object_id: obj.id,
      recipient_id: recipient.recipient_id,
      version: 1,
      policy_version,
      channel: ch,
      ...(type.key_occurrence === "EVENT" ? { occurrence_id: originating_event_id } : {}),
    };
    const idempotency_key = idempotencyKey(key_components);
    const notification_id = `ntf-${ids()}`;
    const claim = registry.claim(idempotency_key, { notification_id, version: 1 });
    if (claim.duplicate && claim.existing) {
      // `on conflict (dedupe_key) do nothing` (1920:264): nothing new is written; the caller gets the existing version.
      return deepFreeze({
        duplicate: true,
        record: view(state.get(keyOf(claim.existing)) as NotificationRecord),
        idempotency_key,
        events: [],
      }) as DeepReadonly<DraftResult>;
    }
    const at = clock();
    const rec: NotificationRecord = {
      notification_id,
      version: 1,
      revision: 0,
      status: "DRAFT",
      type_code: typeCode,
      object: { type: obj.type, id: obj.id },
      case_id: caseId,
      channel: ch,
      recipient,
      template: {
        code: type.template_code,
        version: (template_version as string | undefined) ?? type.template_version,
      },
      policy_version,
      originating_event_id,
      idempotency_key,
      key_components,
      approval: clone(type.approval) as ApprovalSpec,
      correlation_id: (correlation_id as string | undefined) ?? `corr-${notification_id}`,
      corrects: null,
      superseded_by: null,
      outbox: null,
      model_hash: null,
      validation: null,
      created_at: at,
      updated_at: at,
      last_event_id: null,
    };
    state.set(keyOf(rec), rec);
    latest.set(notification_id, 1);
    const entry = appendEvent(rec, "NOTIFICATION_DRAFTED", {
      actor: who,
      occurred_at: at,
      causation_id: originating_event_id,
      payload: {
        from: null,
        to: "DRAFT",
        type_code: typeCode,
        channel: ch,
        recipient_class: recipient.class,
      },
    });
    addEvidence(rec, "ISSUANCE_CONTEXT", issuanceContext(rec));
    addEvidence(rec, "TRANSITION", { from: null, to: "DRAFT", event_id: entry.event_id, at, actor: who });
    rec.last_event_id = entry.event_id;
    return deepFreeze({
      duplicate: false,
      record: view(rec),
      idempotency_key,
      events: [entry],
    }) as DeepReadonly<DraftResult>;
  }

  // ------------------------------------------------------------------------------------ consistency context ---------
  function ledgerEventsFor(rec: NotificationRecord): DeepReadonly<CharterEvent>[] {
    if (!rec.case_id) return [];
    return ledger
      .list()
      .filter(
        (e) =>
          e.case_id === rec.case_id &&
          (CHARTER_NOTIFICATION_EVENT_TYPES.includes(e.type) || PROPOSED_EVENT_TYPES.includes(e.type)),
      )
      .map(toEvent);
  }

  function buildContext(
    rec: NotificationRecord,
    statement: Statement,
    model: ProjectedModel,
  ): ConsistencyContext {
    const type = typeOf(rec.type_code);
    const caseRecord = rec.case_id ? cases.getCase(rec.case_id) : null;
    const po = procedural.getObject(rec.object.id);
    const merged = new Map<string, DeepReadonly<CharterEvent>>();
    for (const e of [
      ...(rec.case_id ? procedural.eventsFor({ case_id: rec.case_id }) : []),
      ...procedural.eventsFor({ object_id: rec.object.id }),
      ...ledgerEventsFor(rec),
    ]) {
      if (!merged.has(e.event_id)) merged.set(e.event_id, e);
    }
    const events = orderEvents([...merged.values()]);
    let authorityResult: CtxAuthority | null | undefined = null;
    if (statement.authority_action_id && authority) {
      const trigger = merged.get(rec.originating_event_id) ?? null;
      try {
        authorityResult = authority.check({
          action_id: statement.authority_action_id,
          actor: trigger?.actor ?? null,
          object: rec.object,
          case_id: rec.case_id,
        });
      } catch {
        authorityResult = null; // PC-08 reports AUTHORITY_CHECK_MISSING: fail closed
      }
    }
    const { progress, alternative_groups, ...rest } = statement;
    return {
      notification: {
        ...clone(rest),
        type_code: rec.type_code,
        trigger_event_id: rec.originating_event_id,
        allowed_trigger_types: type.allowed_trigger_types ?? rest.allowed_trigger_types,
        journey_capacities: type.journey_capacities ?? rest.journey_capacities,
        lifecycle_status: rec.status,
        recipient: {
          id: rec.recipient.recipient_id,
          class: rec.recipient.class,
          capacity: rec.recipient.capacity,
        },
      },
      case: caseRecord,
      procedural_object: po && po.exists !== false ? po : null,
      events,
      progress: clone(progress),
      disclosure_log: normalizeLog(model._disclosure_log),
      authority: authorityResult,
      alternative_groups: clone(alternative_groups),
      deadline_rules: deadlineRules,
    };
  }

  /** A projected model names (some of) its recipient and policy; when it does, they must be this version's. Only string
   * values are compared, so a renderer model of another shape is not refused for its shape alone. */
  function checkModelBinding(rec: NotificationRecord, model: ProjectedModel): string | null {
    const m = model;
    const str = (...xs: unknown[]): string | null =>
      (xs.find((x) => typeof x === "string") as string | undefined) ?? null;
    const r = (m.recipient && typeof m.recipient === "object" ? m.recipient : {}) as {
      readonly recipient_id?: unknown;
      readonly id?: unknown;
      readonly class?: unknown;
    };
    const summary = m._disclosure_summary as
      { readonly recipient?: unknown; readonly policy_version?: unknown } | null | undefined;
    const rid = str(m.recipient_id, r.recipient_id, r.id);
    if (rid !== null && rid !== rec.recipient.recipient_id) return "MODEL_RECIPIENT_MISMATCH";
    const cls = str(
      m.recipient_class,
      typeof m.recipient === "string" ? m.recipient : null,
      r.class,
      summary?.recipient,
    );
    if (cls !== null && cls !== rec.recipient.class) return "MODEL_RECIPIENT_CLASS_MISMATCH";
    const pv = str(m.policy_version, summary?.policy_version);
    if (pv !== null && pv !== rec.policy_version) return "POLICY_VERSION_MISMATCH";
    return null;
  }

  // -------------------------------------------------------------------------------------------- transitions ---------
  function apply(rec: NotificationRecord, to: string, ev: TransitionInput = {}): StepResult {
    if (!isIn(NOTIFICATION_STATUSES, to)) throw new LifecycleError("UNKNOWN_STATUS", { to: String(to) });
    // L-04 item 2: only the successor's SENT supersedes a version (sendStep); no caller can ask for it.
    if (to === "SUPERSEDED") throw new LifecycleError("SUPERSEDED_ONLY_BY_CORRECTION", { from: rec.status });
    // L-04 item 5: CORRECTED is reached at lineage level — a new version — never by a record-level transition.
    if (to === "CORRECTED") return toCorrected(rec, ev);
    if (!canTransition(rec.status, to))
      throw new LifecycleError("INVALID_TRANSITION", { from: rec.status, to });
    switch (to) {
      case "VALIDATED":
        return toValidated(rec, ev);
      case "AUTHORIZATION_PENDING": {
        const actor = requireActor(ev.actor);
        if (rec.approval.required === false)
          throw new LifecycleError("APPROVAL_NOT_REQUIRED", { type_code: rec.type_code });
        return {
          events: [
            move(rec, "AUTHORIZATION_PENDING", {
              actor,
              payload: { action_id: rec.approval.action_id, basis: rec.approval.basis },
            }),
          ],
        };
      }
      case "AUTHORIZED":
        return toAuthorized(rec, ev);
      case "QUEUED":
        return toQueued(rec, ev);
      case "SENT": {
        const row = rec.outbox ? outbox.getRow(rec.outbox.row_id) : null;
        if (!row || row.channel !== "EMAIL" || !(row.attempts >= 1))
          throw denied("NOT_CLAIMED", { command: "notification_send", rec, actor: ev.actor });
        return sendStep(rec, {
          actor: ev.actor ?? DISPATCHER,
          payload: { channel: rec.channel, attempt: row.attempts, ...sentRefs(rec) },
          data: { outbox_row_id: row.id, attempt: row.attempts },
        });
      }
      case "DELIVERY_CONFIRMED":
      case "DELIVERY_FAILED":
        return toSettled(rec, to, ev);
      case "CANCELLED":
        return toCancelled(rec, ev);
      default:
        throw new LifecycleError("INVALID_TRANSITION", { from: rec.status, to });
    }
  }

  function toValidated(rec: NotificationRecord, ev: TransitionInput): StepResult {
    const command = "notification_validate";
    const actor = requireActor(ev.actor);
    const { model, statement = {} } = ev;
    if (!isProjected(model)) {
      throw denied("DISCLOSURE_NOT_APPLIED", {
        command,
        outcome: "DISCLOSURE_NOT_APPLIED",
        action: "VALIDATION_REJECTED",
        rec,
        actor,
      });
    }
    const mismatch = checkModelBinding(rec, model);
    if (mismatch)
      throw denied(mismatch, { command, outcome: mismatch, action: "VALIDATION_REJECTED", rec, actor });
    if (!statement || typeof statement !== "object" || Array.isArray(statement))
      throw new LifecycleError("INVALID_STATEMENT", { field: "statement" });
    const foreign = Object.keys(statement).filter((k) => !STATEMENT_KEYS.includes(k));
    if (foreign.length) {
      // events, case, procedural_object, authority, disclosure_log, recipient, lifecycle_status … are read here, never taken from the caller
      throw denied("STATEMENT_FIELD_NOT_ALLOWED", {
        command,
        outcome: "STATEMENT_FIELD_NOT_ALLOWED",
        action: "VALIDATION_REJECTED",
        rec,
        actor,
        details: { fields: foreign },
      });
    }
    let model_hash: string;
    try {
      model_hash = hashOf(model);
    } catch {
      throw refusal(rec, "MODEL_NOT_SERIALIZABLE");
    }
    const result = validate(buildContext(rec, statement as Statement, model), rules);
    const warnings = result.warnings.map((w) => w.id);
    if (!result.ok) {
      const ruleIds = [...new Set(result.violations.map((v) => v.id))];
      try {
        ledger.append(
          {
            type: "VALIDATION_REJECTED",
            occurred_at: clock(),
            case_id: rec.case_id ?? null,
            object: { type: "command", id: rec.notification_id },
            actor,
            provenance: PROVENANCE,
            payload: { command, outcome: "CONSISTENCY_BLOCKED", rule_ids: ruleIds.join(",").slice(0, 120) },
          },
          { category: "SECURITY", outcome: "DENIED" },
        );
      } catch {
        /* never masks the refusal */
      }
      addEvidence(rec, "REFUSAL", {
        command,
        reason_code: "CONSISTENCY_BLOCKED",
        rule_ids: ruleIds,
        warnings,
        rules_version: result.rules_version,
        at: clock(),
      });
      throw new LifecycleError("CONSISTENCY_BLOCKED", {
        violations: result.violations.map((v) => ({ id: v.id, detail: v.detail })),
        warnings,
        rules_version: result.rules_version,
      });
    }
    rec.model_hash = model_hash;
    rec.validation = { rules_version: result.rules_version, engine_version: result.engine_version, warnings };
    const entry = move(rec, "VALIDATED", {
      actor,
      payload: { rules_version: result.rules_version, warnings: warnings.join(",") || null },
      data: {
        model_hash,
        rules_version: result.rules_version,
        engine_version: result.engine_version,
        warnings,
        rules_evaluated: result.evaluated.length,
      },
    });
    return { events: [entry], warnings: [...result.warnings] };
  }

  function toAuthorized(rec: NotificationRecord, ev: TransitionInput): StepResult {
    const command = "notification_authorize";
    let authorizer: Record<string, unknown> & { basis: string };
    let actor: Actor;
    if (rec.status === "VALIDATED") {
      if (rec.approval.required !== false) {
        throw new LifecycleError("APPROVAL_REQUIRED", {
          action_id: rec.approval.action_id,
          basis: rec.approval.basis,
        });
      }
      actor = pickActor(ev.actor) ?? SYSTEM_ACTOR;
      authorizer = {
        capacity: SYSTEM_ACTOR.capacity,
        id: SYSTEM_ACTOR.id,
        basis: "NO_APPROVAL_REQUIRED",
        approval_basis: rec.approval.basis,
      };
    } else {
      actor = requireActor(ev.actor);
      if (!rec.approval.action_id)
        throw denied("APPROVAL_ACTION_UNDEFINED", {
          command,
          rec,
          actor,
          details: { basis: rec.approval.basis },
        });
      if (!authority) throw denied("AUTHORITY_PORT_MISSING", { command, rec, actor });
      let res: unknown = null;
      try {
        res = authority.check({
          action_id: rec.approval.action_id,
          actor: clone(ev.actor),
          object: rec.object,
          case_id: rec.case_id,
        });
      } catch {
        res = null;
      }
      const answer = res as { readonly result?: unknown } | null | undefined;
      const result =
        answer && typeof answer === "object" && typeof answer.result === "string"
          ? answer.result
          : "NO_RESULT";
      if (result !== "ALLOWED") {
        throw denied("AUTHORITY_NOT_ALLOWED", {
          command,
          rec,
          actor,
          details: { result, action_id: rec.approval.action_id },
        });
      }
      authorizer = {
        capacity: actor.capacity,
        id: actor.id,
        basis: "AUTHORITY_CHECK_ALLOWED",
        action_id: rec.approval.action_id,
        authority_result: "ALLOWED",
      };
    }
    const entry = move(rec, "AUTHORIZED", {
      actor,
      payload: { basis: authorizer.basis, action_id: rec.approval.action_id },
      data: { authorizer },
    });
    return { events: [entry] };
  }

  function toQueued(rec: NotificationRecord, ev: TransitionInput): StepResult {
    const actor = pickActor(ev.actor) ?? SYSTEM_ACTOR;
    if (rec.channel === "IN_APP") predecessorToSupersede(rec); // the in-app row is SENT on insert: check before enqueuing
    let res;
    try {
      res = outbox.enqueue({
        template_code: rec.template.code,
        recipient_id: rec.recipient.recipient_id,
        object_id: rec.object.id,
        channel: rec.channel,
        dedupe: `v13:${rec.idempotency_key}`,
      });
    } catch (err) {
      const c = (err as { readonly code?: unknown } | null | undefined)?.code;
      throw refusal(rec, "OUTBOX_REJECTED", { outbox_code: typeof c === "string" ? c : "ERROR" });
    }
    if (!res.inserted) throw refusal(rec, "ENQUEUE_NOT_INSERTED", { outbox_reason: res.reason });
    rec.outbox = { row_id: res.id, channel: rec.channel, template_code: rec.template.code };
    byOutboxRow.set(res.id, keyOf(rec));
    // The row's created_at is the authoritative instant of queuing (one clock read inside notify.enqueue, 1920:262-263),
    // so QUEUED never sorts after the in-app SENT / DELIVERY_CONFIRMED that share that instant (ties: recorded_at).
    const row = outbox.getRow(res.id) as DeepReadonly<OutboxRow>;
    const events = [
      move(rec, "QUEUED", {
        actor,
        occurred_at: row.created_at,
        payload: { channel: rec.channel, outbox_status: res.status },
        data: { outbox_row_id: res.id, outbox_status: res.status },
      }),
    ];
    let superseded: NotificationRecord | null = null;
    if (rec.channel === "IN_APP") {
      // 1920:262-263: the in-app row is inserted SENT with delivered_at = now — it is in the recipient's inbox (read ≠ acknowledged).
      const step = sendStep(rec, {
        actor: DISPATCHER,
        occurred_at: row.delivered_at,
        payload: { channel: "IN_APP", attempt: 0, ...sentRefs(rec) },
        data: { outbox_row_id: row.id, attempt: 0 },
      });
      events.push(...step.events);
      superseded = step.superseded;
      addEvidence(rec, "DELIVERY_ATTEMPT", {
        attempt: 0,
        status: "ACCEPTED_BY_PROVIDER",
        provider: "IN_APP_OUTBOX_ROW",
        outbox_status: row.status,
        at: row.delivered_at,
      });
      // L-02 (both modes): the committed inbox row is the transport step — SENT and DELIVERY_CONFIRMED coincide.
      events.push(
        move(rec, "DELIVERY_CONFIRMED", {
          actor: DISPATCHER,
          occurred_at: row.delivered_at,
          payload: {
            channel: "IN_APP",
            outbox_status: row.status,
            attempts: row.attempts,
            evidence_kind: "IN_APP_ROW_CREATED",
          },
          data: { outbox_row_id: row.id, outbox_status: row.status, evidence_kind: "IN_APP_ROW_CREATED" },
        }),
      );
    }
    return { events, superseded };
  }

  function toSettled(
    rec: NotificationRecord,
    to: "DELIVERY_CONFIRMED" | "DELIVERY_FAILED",
    ev: TransitionInput,
  ): StepResult {
    const row = rec.outbox ? outbox.getRow(rec.outbox.row_id) : null;
    const want = to === "DELIVERY_CONFIRMED" ? "SENT" : "FAILED";
    if (!row || row.status !== want) {
      throw denied("SETTLEMENT_NOT_RECORDED", {
        command: "notification_settle",
        rec,
        actor: ev.actor,
        details: { outbox_status: row?.status ?? null },
      });
    }
    if (to === "DELIVERY_CONFIRMED" && row.channel === "EMAIL" && !emailConfirmsOnSettlement) {
      // ACCEPTANCE (L-07): no platform port reports mailbox delivery (NG-04); the settlement is acceptance by the sender and
      // the version stays SENT until a provider delivery report exists (PRODUCTION_SUBSTITUTION_REQUIRED, W-B S3/S8).
      throw denied("DELIVERY_REPORT_REQUIRED", {
        command: "notification_settle",
        rec,
        actor: ev.actor,
        details: { outbox_status: row.status },
      });
    }
    const evidence_kind =
      to === "DELIVERY_FAILED"
        ? "OUTBOX_ATTEMPTS_EXHAUSTED"
        : row.channel === "IN_APP"
          ? "IN_APP_ROW_CREATED"
          : "SENDER_ADAPTER_REPORTED_SUCCESS";
    const entry = move(rec, to, {
      actor: ev.actor ?? DISPATCHER,
      payload: { channel: row.channel, outbox_status: row.status, attempts: row.attempts, evidence_kind },
      data: { outbox_row_id: row.id, outbox_status: row.status, attempts: row.attempts, evidence_kind },
    });
    return { events: [entry] };
  }

  function toCancelled(rec: NotificationRecord, ev: TransitionInput): StepResult {
    const actor = requireActor(ev.actor);
    if (typeof ev.reason_code !== "string" || !REASON_CODE.test(ev.reason_code))
      throw new LifecycleError("REASON_CODE_REQUIRED");
    let leftPending = false;
    if (rec.status === "QUEUED" && rec.outbox) {
      const row = outbox.getRow(rec.outbox.row_id) as DeepReadonly<OutboxRow>;
      if (row.channel !== "EMAIL" || row.status !== "PENDING" || row.attempts > 0) {
        throw new LifecycleError("CANCEL_TOO_LATE", { outbox_status: row.status, attempts: row.attempts });
      }
      suppress(rec, row, "CANCELLED_BEFORE_DISPATCH");
      leftPending = true;
    }
    const entry = move(rec, "CANCELLED", {
      actor,
      payload: { reason_code: ev.reason_code },
      data: { reason_code: ev.reason_code, outbox_row_left_pending: leftPending },
    });
    if (rec.corrects) {
      // L-04 item 4: the predecessor stays the lineage's current version (its state is untouched) and a new correction may
      // start. Its retries stay suppressed — the text was found wrong — so the follow-up is a person's decision.
      const prev = state.get(keyOf(rec.corrects));
      if (prev) {
        addEvidence(prev, "EXCEPTION", {
          reason_code: "CORRECTION_CANCELLED",
          successor_version: rec.version,
          current_version: prev.version,
          retries_suppressed: Boolean(prev.outbox && suppressedRows.has(prev.outbox.row_id)),
          follow_up: "MANUAL",
          at: clock(),
        });
      }
    }
    return { events: [entry] };
  }

  function suppress(rec: NotificationRecord, row: DeepReadonly<OutboxRow>, reason_code: string): void {
    suppressedRows.set(row.id, reason_code);
    addEvidence(rec, "SUPPRESSION", {
      outbox_row_id: row.id,
      outbox_status: row.status,
      attempts: row.attempts,
      reason_code,
      gap: "GAP-OUT-03",
      at: clock(),
    });
    ledger.append(
      {
        type: "NOTIFICATION_SUPPRESSED",
        occurred_at: clock(),
        case_id: rec.case_id ?? null,
        object: { type: "NOTIFICATION", id: rec.notification_id },
        actor: DISPATCHER,
        provenance: PROVENANCE,
        version: rec.version,
        causation_id: rec.last_event_id,
        correlation_id: rec.correlation_id,
        payload: { reason_code, outbox_status: row.status, attempts: row.attempts, gap: "GAP-OUT-03" },
      },
      { category: "BUSINESS", outcome: "SUCCESS" },
    );
  }

  /**
   * Lineage-level correction (L-04 items 1-3 and 5): the lineage's current version n (SENT, DELIVERY_CONFIRMED or
   * DELIVERY_FAILED) gets a successor in CORRECTED, numbered after the lineage's last version (a cancelled correction
   * keeps its number). Version n keeps its state and stays current; only its pending outbox retries are suppressed.
   */
  function toCorrected(rec: NotificationRecord, ev: TransitionInput): StepResult {
    const command = "notification_correct";
    if (!canCorrect(rec.status))
      throw new LifecycleError("INVALID_TRANSITION", { from: rec.status, to: "CORRECTED" });
    const actor = requireActor(ev.actor);
    if (typeof ev.reason_code !== "string" || !REASON_CODE.test(ev.reason_code))
      throw new LifecycleError("REASON_CODE_REQUIRED");
    const reasonCode = ev.reason_code;
    const lineage = lineageOf(rec.notification_id);
    if (lineage.pending)
      throw new LifecycleError("CORRECTION_IN_PROGRESS", { pending_version: lineage.pending.version });
    if (lineage.current !== rec)
      throw new LifecycleError("NOT_CURRENT_VERSION", { current_version: lineage.current?.version ?? null });
    const type = typeOf(rec.type_code);
    const recipient = resolveRecipient({
      type_code: rec.type_code,
      object: rec.object,
      recipient_id: rec.recipient.recipient_id,
      recipient_class: rec.recipient.class,
      capacity: rec.recipient.capacity,
      command,
      actor,
    });
    for (const [field, v] of [
      ["policy_version", ev.policy_version],
      ["template_version", ev.template_version],
      ["originating_event_id", ev.originating_event_id],
    ] as const) {
      if (v !== undefined && (typeof v !== "string" || !OPAQUE_ID.test(v)))
        throw new LifecycleError("INVALID_INPUT", { field });
    }
    const version = (latest.get(rec.notification_id) as number) + 1;
    const policy_version = (ev.policy_version as string | undefined) ?? rec.policy_version;
    const originating_event_id = (ev.originating_event_id as string | undefined) ?? rec.originating_event_id;
    const key_components: RecordKeyComponents = {
      type_code: rec.type_code,
      object_id: rec.object.id,
      recipient_id: recipient.recipient_id,
      version,
      policy_version,
      channel: rec.channel,
      ...(type.key_occurrence === "EVENT" ? { occurrence_id: originating_event_id } : {}),
    };
    const idempotency_key = idempotencyKey(key_components);
    const claim = registry.claim(idempotency_key, { notification_id: rec.notification_id, version });
    if (claim.duplicate) throw new LifecycleError("DUPLICATE_VERSION", { version });
    const at = clock();
    const next: NotificationRecord = {
      ...clone(rec),
      version,
      revision: 0,
      status: "CORRECTED",
      recipient,
      template: {
        code: rec.template.code,
        version: (ev.template_version as string | undefined) ?? rec.template.version,
      },
      policy_version,
      originating_event_id,
      idempotency_key,
      key_components,
      approval: clone(type.approval) as ApprovalSpec,
      corrects: { notification_id: rec.notification_id, version: rec.version, reason_code: reasonCode },
      superseded_by: null,
      outbox: null,
      model_hash: null,
      validation: null,
      created_at: at,
      updated_at: at,
      last_event_id: null,
    };
    state.set(keyOf(next), next);
    latest.set(next.notification_id, version);
    // The Event belongs to the new version and records its entry state (from: null), like NOTIFICATION_DRAFTED.
    const eCorr = appendEvent(next, "NOTIFICATION_CORRECTED", {
      actor,
      occurred_at: at,
      causation_id: rec.last_event_id,
      payload: {
        from: null,
        to: "CORRECTED",
        corrects_version: rec.version,
        corrected_status: rec.status,
        reason_code: reasonCode,
      },
    });
    addEvidence(next, "ISSUANCE_CONTEXT", issuanceContext(next));
    addEvidence(next, "CORRECTION", {
      corrects_version: rec.version,
      reason_code: reasonCode,
      event_id: eCorr.event_id,
      at,
    });
    addEvidence(next, "TRANSITION", { from: null, to: "CORRECTED", event_id: eCorr.event_id, at, actor });
    next.last_event_id = eCorr.event_id;

    // Version n: state, revision and last event unchanged (L-04 item 3); the correction is noted in its evidence.
    addEvidence(rec, "CORRECTION", {
      successor_version: version,
      reason_code: reasonCode,
      event_id: eCorr.event_id,
      at,
    });
    if (rec.outbox) {
      const row = outbox.getRow(rec.outbox.row_id);
      // A retrying e-mail of a version found wrong is never handed to the sender again (L-04 item 3; GAP-OUT-03).
      if (row && row.status === "PENDING" && !suppressedRows.has(row.id))
        suppress(rec, row, "CORRECTION_PENDING");
    }
    return { events: [eCorr], next, predecessor: rec };
  }

  /** Public transition. `record` is the caller's snapshot (its revision must be current). */
  function transition(
    record: RecordSnapshot | null | undefined,
    to: string,
    event: TransitionInput | null = {},
  ): DeepReadonly<TransitionResult> {
    const rec = current(record);
    const out = apply(rec, to, event ?? {});
    if (to === "CORRECTED") {
      // Lineage level: `record` is the new version; `predecessor` is version n, unchanged and still current.
      return deepFreeze({
        record: view(out.next as NotificationRecord),
        predecessor: view(out.predecessor as NotificationRecord),
        events: out.events,
        warnings: [],
      }) as DeepReadonly<TransitionResult>;
    }
    return deepFreeze({
      record: view(rec),
      events: out.events,
      warnings: out.warnings ?? [],
      ...(out.superseded ? { superseded: view(out.superseded) } : {}),
    }) as DeepReadonly<TransitionResult>;
  }

  // ----------------------------------------------------------------------------------------------- dispatch ---------
  /**
   * Mirrors createNotificationService().dispatchEmail (packages/application/src/notifications.ts:27-41): claim, send,
   * record — plus the lifecycle transitions and evidence. Rows of CANCELLED or SUPERSEDED versions, and retries of a
   * version under correction (CORRECTION_PENDING), are claimed (the platform cannot skip them) but never handed to the
   * sender (GAP-OUT-03). Rows this lifecycle did not create are dispatched exactly as the platform would (`unmanaged`).
   * A sender success is ACCEPTED_BY_PROVIDER; it confirms delivery only under the explicit SETTLEMENT configuration (L-07).
   */
  async function dispatchEmailBatch(limit = 50): Promise<DeepReadonly<DispatchResult>> {
    if (!sender || typeof sender.send !== "function") throw new LifecycleError("SENDER_MISSING");
    const result: DispatchResult = { sent: 0, failed: 0, retrying: 0, suppressed: 0, unmanaged: 0 };
    for (const n of outbox.claimEmailBatch(limit)) {
      const key = byOutboxRow.get(n.id);
      const rec = key ? (state.get(key) ?? null) : null;
      if (rec && (suppressedRows.has(n.id) || isTerminal(rec.status))) {
        addEvidence(rec, "SUPPRESSION", {
          outbox_row_id: n.id,
          outbox_status: "PENDING",
          attempts: n.attempts,
          reason_code:
            rec.status === "SUPERSEDED"
              ? "VERSION_SUPERSEDED"
              : rec.status === "CANCELLED"
                ? "NOTIFICATION_CANCELLED"
                : suppressedRows.get(n.id),
          gap: "GAP-OUT-03",
          at: clock(),
        });
        result.suppressed += 1;
        continue;
      }
      if (rec && rec.status === "QUEUED") apply(rec, "SENT", { actor: DISPATCHER });
      if (rec)
        addEvidence(rec, "DELIVERY_ATTEMPT", {
          attempt: n.attempts,
          status: "ATTEMPTED",
          outbox_row_id: n.id,
          at: clock(),
        });
      let delivered = false;
      try {
        // OutgoingNotification (packages/contracts/src/index.ts:1811-1817), mapped as outbox.ts:15-21 does.
        delivered =
          (await sender.send({
            id: n.id,
            recipientId: n.recipient_id,
            template: n.template_code,
            deepLink: n.deep_link,
            attempts: n.attempts,
          })) === true;
      } catch {
        delivered = false; // never logged: it may echo the address (notifications.ts:33-35)
      }
      const status = outbox.recordEmailDelivery(n.id, delivered);
      if (status === "SENT") result.sent += 1;
      else if (status === "FAILED") result.failed += 1;
      else result.retrying += 1;
      if (!rec) {
        result.unmanaged += 1;
        continue;
      }
      const at = clock();
      addEvidence(rec, "DELIVERY_ATTEMPT", {
        attempt: n.attempts,
        status: delivered ? "ACCEPTED_BY_PROVIDER" : "FAILED",
        outbox_status: status,
        outbox_row_id: n.id,
        at,
        // PROPOSAL (no backoff in notify.*): earliest sensible retry; the scheduler must honour it (GAP).
        next_attempt_not_before: status === "PENDING" ? retryPolicy.nextAttemptAt(at, n.attempts) : null,
      });
      if (status === "SENT" && emailConfirmsOnSettlement)
        apply(rec, "DELIVERY_CONFIRMED", { actor: DISPATCHER });
      else if (status === "FAILED") apply(rec, "DELIVERY_FAILED", { actor: DISPATCHER });
    }
    return deepFreeze(result);
  }

  // ------------------------------------------------------------------------------------------ acknowledgement -------
  /** RECIPIENT_ACKNOWLEDGED is an Event and an evidence entry; the record's state and revision do not change. */
  function acknowledge(
    record: RecordSnapshot | null | undefined,
    { actor, occurred_at }: { actor?: unknown; occurred_at?: string } = {},
  ): DeepReadonly<AcknowledgeResult> {
    const who = requireActor(actor);
    const known =
      record && typeof record.notification_id === "string" && Number.isInteger(record.version)
        ? (state.get(keyOf({ notification_id: record.notification_id, version: record.version })) ?? null)
        : null;
    if (!known || who.id !== known.recipient.recipient_id) {
      // One answer for "unknown" and "someone else's", checked before anything else (revision, state), like
      // api.mark_notification_read (1920:499-501): the caller cannot learn whether another person's notification exists.
      const objectId = known
        ? known.notification_id
        : OPAQUE_ID.test(String(record?.notification_id ?? ""))
          ? (record?.notification_id as string)
          : "unknown";
      throw denied("NOT_RECIPIENT", {
        command: "notification_acknowledge",
        outcome: "NOT_FOUND",
        rec: null,
        objectId,
        actor: who,
      });
    }
    const rec = current(record);
    if (!["SENT", "DELIVERY_CONFIRMED"].includes(rec.status))
      throw new LifecycleError("NOT_ACKNOWLEDGEABLE", { status: rec.status });
    const existing = ledger
      .list({ type: "RECIPIENT_ACKNOWLEDGED", object_id: rec.notification_id })
      .find((e) => e.version === rec.version);
    if (existing)
      return deepFreeze({
        duplicate: true,
        event: existing,
        record: view(rec),
      }) as DeepReadonly<AcknowledgeResult>;
    const now = clock();
    const at = occurred_at ?? now;
    if (parseInstant(at, "occurred_at") > parseInstant(now, "now"))
      throw new LifecycleError("ACKNOWLEDGEMENT_IN_FUTURE");
    const entry = appendEvent(rec, "RECIPIENT_ACKNOWLEDGED", {
      actor: { capacity: rec.recipient.capacity, id: who.id },
      occurred_at: at,
      causation_id: rec.last_event_id,
      payload: { channel: rec.channel, lifecycle_state: rec.status },
    });
    addEvidence(rec, "ACKNOWLEDGEMENT", {
      event_id: entry.event_id,
      at,
      actor: { capacity: rec.recipient.capacity, id: who.id },
    });
    return deepFreeze({
      duplicate: false,
      event: entry,
      record: view(rec),
    }) as DeepReadonly<AcknowledgeResult>;
  }

  // ------------------------------------------------------------------------------------------------- export ---------
  /** EML export of the current version; never changes the record or the outbox (it appends audit + evidence only). */
  function exportEml(
    record: RecordSnapshot | null | undefined,
    { rendered, model, actor }: { rendered?: RenderedInput | null; model?: unknown; actor?: unknown } = {},
  ): ExportResult {
    const rec = current(record);
    const who = requireActor(actor);
    if (!isProjected(model)) {
      throw denied("MODEL_NOT_PROJECTED", {
        command: "notification_export",
        outcome: "MODEL_NOT_PROJECTED",
        action: "VALIDATION_REJECTED",
        rec,
        actor: who,
      });
    }
    const mismatch = checkModelBinding(rec, model);
    if (mismatch)
      throw denied(mismatch, {
        command: "notification_export",
        outcome: mismatch,
        action: "VALIDATION_REJECTED",
        rec,
        actor: who,
      });
    let modelHash: string;
    try {
      modelHash = hashOf(model);
    } catch {
      throw new LifecycleError("MODEL_NOT_SERIALIZABLE");
    }
    if (rec.model_hash && rec.model_hash !== modelHash) {
      throw denied("MODEL_CHANGED_SINCE_VALIDATION", {
        command: "notification_export",
        outcome: "MODEL_CHANGED",
        action: "VALIDATION_REJECTED",
        rec,
        actor: who,
      });
    }
    const issuedAt = evidence.summary(rec.notification_id, rec.version).issued_at;
    let out: ExportResult;
    try {
      out = buildExportEml({ record: view(rec), rendered, exportedAt: clock(), issuedAt, modelHash });
    } catch (err) {
      if (err instanceof ExportError) {
        throw denied(err.code, {
          command: "notification_export",
          outcome: err.code,
          action: "VALIDATION_REJECTED",
          rec,
          actor: who,
          details: err.details,
        });
      }
      throw err;
    }
    ledger.append(
      {
        type: "NOTIFICATION_EXPORTED",
        occurred_at: clock(),
        case_id: rec.case_id ?? null,
        object: { type: "NOTIFICATION", id: rec.notification_id },
        actor: who,
        provenance: PROVENANCE,
        version: rec.version,
        causation_id: rec.last_event_id,
        correlation_id: rec.correlation_id,
        payload: { lifecycle_state: rec.status, export_label: out.label.code, eml_sha256: out.sha256 },
      },
      { category: "BUSINESS", outcome: "SUCCESS" },
    );
    addEvidence(rec, "EXPORT", {
      label: out.label.code,
      lifecycle_state: rec.status,
      eml_sha256: out.sha256,
      model_hash: modelHash,
      at: clock(),
      actor: who,
    });
    return out;
  }

  // -------------------------------------------------------------------------------------------------- reads ---------
  /** One version; without `version`, the lineage's latest version (which may be a correction not yet issued — see lineage). */
  function get(notificationId: string, version?: number): DeepReadonly<NotificationRecord> | null {
    const v = version ?? latest.get(notificationId);
    const rec = v === undefined ? null : state.get(`${notificationId}#${v}`);
    return rec ? view(rec) : null;
  }

  function versions(notificationId: string): DeepReadonly<NotificationRecord>[] {
    const n = latest.get(notificationId) ?? 0;
    return Array.from({ length: n }, (_, i) => view(versionOf(notificationId, i + 1)));
  }

  /** Ledger history of one notification (all versions), ordered by occurred_at, recorded_at, event_id. */
  function history(notificationId: string): DeepReadonly<CharterEvent>[] {
    return orderEvents(
      ledger
        .list({ object_id: notificationId })
        .filter((e) => e.object?.type === "NOTIFICATION")
        .map(toEvent),
    );
  }

  function exceptions(notificationId: string): DeepReadonly<EvidenceEntry>[] {
    return versions(notificationId).flatMap((r) =>
      evidence.list(r.notification_id, r.version).filter((e) => e.kind === "EXCEPTION"),
    );
  }

  /** The lineage (L-04): which version is current, which correction is pending, and every version's state. */
  function lineage(notificationId: string): DeepReadonly<LineageView> | null {
    const { recs, current: cur, pending } = lineageOf(notificationId);
    if (!cur) return null;
    return deepFreeze({
      notification_id: notificationId,
      current_version: cur.version,
      pending_version: pending ? pending.version : null,
      current: view(cur),
      versions: recs.map((r) => ({
        version: r.version,
        status: r.status,
        corrects_version: r.corrects?.version ?? null,
        superseded_by: r.superseded_by,
      })),
    }) as DeepReadonly<LineageView>;
  }

  return Object.freeze({
    kind: "v13-notification-lifecycle" as const,
    draft,
    transition,
    dispatchEmailBatch,
    acknowledge,
    exportEml,
    get,
    versions,
    history,
    exceptions,
    lineage,
    records: () => [...state.values()].map(view),
    deliveryConfirmation: confirmationMode,
    isSuppressed: (rowId: string) => suppressedRows.has(rowId),
    suppressionReason: (rowId: string) => suppressedRows.get(rowId) ?? null,
    types: () => types,
  });
}
