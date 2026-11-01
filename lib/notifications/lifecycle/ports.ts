/**
 * ports — the shapes the V13 notification lifecycle depends on (W-D1, charter §10).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * lib/notifications/lifecycle/* depends only on these interfaces. The in-memory test doubles live in
 * tests/unit/notifications/fakes/* (PRODUCTION_SUBSTITUTION_REQUIRED); production implementations sit behind the
 * platform's own ports (audit.audit_event, notify.*, api.* read models under RLS, the NotificationSender port).
 */
import "server-only";
import type { DeepReadonly } from "./util";

// ------------------------------------------------------------------------------------------- shared vocabulary ----
export type Channel = "EMAIL" | "IN_APP";
export type OutboxStatus = "PENDING" | "SENT" | "FAILED";
export type AuditCategory = "BUSINESS" | "SECURITY" | "ADMIN";
export type AuditOutcome = "SUCCESS" | "DENIED" | "FAILURE";

export interface Actor {
  capacity: string;
  id: string;
}

export interface ObjectRef {
  type: string;
  id: string;
}

export interface Provenance {
  source: string;
  ref: string;
}

/** Ledger payload: codes and ids only (never names, addresses or content — checked by the ledger). */
export type Payload = Record<string, unknown>;

/** A charter §3.3 Event. */
export interface CharterEvent {
  event_id: string;
  type: string;
  occurred_at: string;
  recorded_at?: string | null;
  case_id: string | null;
  object: ObjectRef | null;
  actor: Actor | null;
  provenance: Provenance | null;
  version: number;
  causation_id: string | null;
  correlation_id: string | null;
  payload: Payload;
}

// --------------------------------------------------------------------------------------------- audit ledger ------
/** What the lifecycle hands to the ledger; the ledger stamps recorded_at itself and validates every field. */
export interface LedgerEventInput {
  event_id?: string;
  type: string;
  occurred_at?: string;
  case_id?: string | null;
  object?: ObjectRef | null;
  actor?: Actor | null;
  provenance?: Provenance | null;
  version?: number;
  causation_id?: string | null;
  correlation_id?: string | null;
  payload?: Payload;
}

export interface AuditEnvelope {
  category?: AuditCategory;
  outcome?: AuditOutcome;
  reason?: string | null;
}

/** A stored ledger entry: the charter Event, the audit envelope and the chain fields. */
export interface LedgerEntry extends CharterEvent {
  seq: number;
  recorded_at: string;
  category: AuditCategory;
  outcome: AuditOutcome;
  reason: string | null;
  previous_hash: string | null;
  event_hash: string;
}

export interface LedgerFilter {
  type?: string;
  object_id?: string;
  correlation_id?: string;
  category?: AuditCategory;
}

export interface ChainVerification {
  ok: boolean;
  broken_seq: number | null;
  reason: "PREVIOUS_HASH_MISMATCH" | "EVENT_HASH_MISMATCH" | null;
}

/** Append-only audit ledger (production: audit.audit_event, written in the command's transaction). */
export interface AuditLedgerPort {
  append(event: LedgerEventInput, envelope?: AuditEnvelope): DeepReadonly<LedgerEntry>;
  list(filter?: LedgerFilter): DeepReadonly<LedgerEntry>[];
}

// ------------------------------------------------------------------------------------------------ evidence ------
export type EvidenceKind =
  | "ISSUANCE_CONTEXT"
  | "TRANSITION"
  | "DELIVERY_ATTEMPT"
  | "SUPPRESSION"
  | "CORRECTION"
  | "EXPORT"
  | "ACKNOWLEDGEMENT"
  | "EXCEPTION"
  | "REFUSAL";

/** Evidence data: references, codes and hashes only (content keys are refused by the store). */
export type EvidenceData = Record<string, unknown>;

export interface EvidenceEntry {
  seq: number;
  entry_id: string;
  notification_id: string;
  version: number;
  kind: EvidenceKind;
  recorded_at: string;
  data: EvidenceData;
  previous_hash: string | null;
  entry_hash: string;
}

export interface EvidenceVerification {
  ok: boolean;
  broken_seq: number | null;
}

/** One folded evidence item (an entry's data plus its recorded_at). */
export type EvidenceItem = EvidenceData & { recorded_at: string };

export interface SourceRef {
  kind: "EVENT" | "OBJECT" | "CASE";
  id: string;
  type?: string;
}

export interface TemplateRef {
  code: string;
  version: string | null;
}

export interface CorrectsRef {
  notification_id: string;
  version: number;
  reason_code: string;
}

export interface Authorizer {
  capacity: string;
  id: string;
  basis: string;
  approval_basis?: string;
  action_id?: string | null;
  authority_result?: string;
}

export interface EvidenceSummary {
  notification_id: string;
  version: number;
  originating_event_id: string | null;
  source_refs: SourceRef[];
  template: TemplateRef | null;
  policy_version: string | null;
  idempotency_key: string | null;
  recipients: ResolvedRecipient[];
  corrects: CorrectsRef | null;
  model_hash: string | null;
  authorizer: Authorizer | null;
  issued_at: string | null;
  delivery_attempts: EvidenceItem[];
  suppressions: EvidenceItem[];
  corrections: EvidenceItem[];
  exports: EvidenceItem[];
  acknowledgements: EvidenceItem[];
  exceptions: EvidenceItem[];
  refusals: EvidenceItem[];
  transitions: EvidenceItem[];
  entries: number;
  chain_ok: boolean;
}

/** Append-only evidence store keyed by notification id + version. */
export interface EvidenceStorePort {
  append(entry: {
    notification_id: string;
    version: number;
    kind: EvidenceKind;
    data?: EvidenceData;
  }): DeepReadonly<EvidenceEntry>;
  list(notificationId: string, version?: number): DeepReadonly<EvidenceEntry>[];
  summary(notificationId: string, version: number): DeepReadonly<EvidenceSummary>;
  verify(notificationId: string, version?: number): EvidenceVerification;
}

// -------------------------------------------------------------------------------------------------- outbox ------
export interface EnqueueInput {
  template_code: string;
  recipient_id: string | null;
  object_id: string;
  channel: Channel;
  dedupe: string;
  object_type?: string;
}

export type EnqueueResult =
  | { inserted: true; id: string; status: OutboxStatus; channel: Channel }
  | { inserted: false; id: null; reason: string };

/** notify.outbox row (1920:107-126): ids, codes and timestamps only — no content column. */
export interface OutboxRow {
  id: string;
  recipient_id: string;
  template_code: string;
  channel: Channel;
  object_type: string;
  object_id: string;
  deep_link: string;
  dedupe_key: string;
  status: OutboxStatus;
  attempts: number;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

/** What notify.claim_email_batch returns (1920:582, :593). */
export interface ClaimedRow {
  id: string;
  recipient_id: string;
  template_code: string;
  deep_link: string;
  attempts: number;
}

/** notify.* as the lifecycle uses it (enqueue, claim, settle, server-side row read). */
export interface NotifyOutboxPort {
  readonly MAX_ATTEMPTS: number;
  enqueue(input: EnqueueInput): EnqueueResult;
  getRow(id: string): DeepReadonly<OutboxRow> | null;
  claimEmailBatch(limit: number): readonly Readonly<ClaimedRow>[];
  recordEmailDelivery(id: string, delivered: boolean): OutboxStatus;
}

// -------------------------------------------------------------------------------------------------- sender ------
/** OutgoingNotification (packages/contracts/src/index.ts:1811-1817): never case content (§39, N18). */
export interface OutgoingNotification {
  id: string;
  recipientId: string;
  template: string;
  deepLink: string;
  attempts: number;
}

/** NotificationSender port (packages/application/src/ports.ts:437-440). */
export interface NotificationSenderPort {
  send(notification: OutgoingNotification): Promise<boolean>;
}

// ------------------------------------------------------------------------------------- recipient resolution ------
/** Authoritative recipient: opaque id, charter §5 class and capacity — never an address or a name. */
export interface ResolvedRecipient {
  recipient_id: string;
  class: string;
  capacity: string;
}

export interface RecipientResolutionPort {
  resolve(query: { type_code: string; object_id: string }): readonly DeepReadonly<ResolvedRecipient>[];
}

// ------------------------------------------------------------------------------------------- read models ------
export interface CaseFlags {
  suspended: boolean;
  returned: boolean;
  cancelled: boolean;
  reopened: boolean;
  closed: boolean;
}

/** CaseRecord (charter §3.1) as scenario data. */
export interface CaseRecord {
  case_id: string;
  internal_ref?: string;
  track: "WB" | "IR" | "DR";
  classification: "PUBLIC" | "INTERNAL" | "RESTRICTED";
  status: { code: string; recorded_at?: string; source_event_id?: string | null } | null;
  flags: CaseFlags;
  restrictions?: Record<string, unknown>;
}

export type CaseView =
  DeepReadonly<CaseRecord & { exists: true }> | DeepReadonly<{ case_id: string | null; exists: false }>;

export interface CaseReadModelPort {
  getCase(caseId: unknown): CaseView;
}

/** ProceduralObject (charter §3.2) as scenario data. */
export interface ProceduralObject {
  object_id: string;
  type: string;
  case_id: string | null;
  journey_id?: string;
  status: string;
  status_source_event_id?: string;
  steps?: unknown[];
  deadlines?: unknown[];
}

export type ProceduralObjectView =
  | DeepReadonly<ProceduralObject & { exists: true }>
  | DeepReadonly<{ object_id: string | null; exists: false }>;

export interface ProceduralReadModelPort {
  getObject(objectId: unknown): ProceduralObjectView;
  eventsFor(filter: { object_id?: string; case_id?: string }): readonly DeepReadonly<CharterEvent>[];
}

// ------------------------------------------------------------------------------------- authority / projection ----
export interface AuthorityCheckInput {
  action_id: string;
  actor: unknown;
  object: ObjectRef;
  case_id: string | null;
}

/** W-D2 check() wrapper: {result, reason}. Read defensively (a missing or malformed answer fails closed). */
export interface AuthorityCheckResult {
  result?: unknown;
  reason?: unknown;
  approval_required?: boolean;
  action_id?: string | null;
}

export interface AuthorityPort {
  check(input: AuthorityCheckInput): AuthorityCheckResult | null | undefined;
}

/** W-D2 brand check, applied in addition to the `_disclosure_applied` flag. */
export interface ProjectionPort {
  isProjected(model: unknown): boolean;
}

/** W-D2 rendering provenance (OI-053): the rendering was made from this projected model and is unchanged. */
export interface RenderingPort {
  isRenderingOf(rendered: unknown, model: unknown): boolean;
}
