/**
 * fixtures — SYNTHETIC scenario data and a wired "world" (adapters + lifecycle) for the W-D1 tests and for any demo that
 * needs a lifecycle. Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Synthetic ids only (lower-case uuids, `CDF-DEMO-2026-0001`); no names, no addresses, no real case.
 * Every adapter wired here is a mock — PRODUCTION_SUBSTITUTION_REQUIRED (see the fake headers).
 * The notification-type settings below (approval flags, allowed trigger types, capacities) are TEST CONFIGURATION, not
 * governance: real values come from the authority model (lib/authority/authority_v13.json, W-F; charter §6 separates
 * administrative coordination such as a meeting invitation from formal acts) and the journey catalogue (W-C).
 * Deterministic: a counter clock and counter ids, so every run produces the same ledger and evidence.
 * Ported to strict TypeScript from the V13 reference (src/lifecycle/fixtures.js); behaviour unchanged except
 * INTERNAL_REF renamed to the repository synthetic-id convention (CDF-DEMO-2026-0001).
 */
import { deepFreeze, type DeepReadonly } from "@/lib/notifications/lifecycle/util";
import { createEvidenceStore } from "@/lib/notifications/lifecycle/evidence";
import {
  createNotificationLifecycle,
  RENDERER_PROVENANCE_PORT,
  type DraftInput,
  type LifecycleDeps,
  type NotificationTypeInput,
  type Statement,
} from "@/lib/notifications/lifecycle/notification";
import type {
  AuthorityCheckInput,
  AuthorityPort,
  CaseRecord,
  CharterEvent,
  ObjectRef,
  Payload,
  ProceduralObject,
  ResolvedRecipient,
} from "@/lib/notifications/lifecycle/ports";
import { createAuditLedger } from "../fakes/auditLedger";
import { createNotifyOutbox, type OutboxUser } from "../fakes/notifyOutbox";
import { createStubSender, type SenderOutcome } from "../fakes/sender";
import { createRecipientResolution } from "../fakes/recipientResolution";
import { createCaseReadModel } from "../fakes/caseReadModel";
import { createProceduralReadModel } from "../fakes/proceduralReadModel";

const u = (suffix: string): string => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

export const IDS = Object.freeze({
  CASE: u("c1"),
  CASE_UNKNOWN: u("c9"),
  MEETING: u("e1"),
  MEETING_2: u("e2"),
  BALLOT: u("b1"),
  RECOMMENDATION: u("d1"),
  DECISION: u("d2"),
  LEGAL_OPINION: u("d3"),
  DEFENCE_NOTICE: u("f1"),
  MEMBER: u("a1"),
  SECRETARY: u("a2"),
  CHAIR: u("a3"),
  WITNESS: u("a4"),
  SUBJECT: u("a5"),
  MEMBER_2: u("a6"),
  INACTIVE_MEMBER: u("a9"),
});

export const INTERNAL_REF = "CDF-DEMO-2026-0001";
export const POLICY_VERSION = "DIS-POLICY-V13-SYNTHETIC-1";
export const TEMPLATE_VERSION = "TPL-V13-SYNTHETIC-1";
export const SECRETARY_ACTOR = Object.freeze({ capacity: "SECRETARY", id: IDS.SECRETARY });
export const CHAIR_ACTOR = Object.freeze({ capacity: "CHAIR", id: IDS.CHAIR });

export interface CounterClock {
  (): string;
  advance(ms: number): void;
}

/** Counter clock: each call returns the next instant (default step 1 s). `advance(ms)` jumps ahead. */
export function counterClock(startIso = "2026-10-27T06:00:00.000Z", stepMs = 1000): CounterClock {
  let t = Date.parse(startIso) - stepMs;
  const clock = (() => new Date((t += stepMs)).toISOString()) as CounterClock;
  clock.advance = (ms: number) => {
    t += ms;
  };
  return clock;
}

/** Counter uuids (prefix 1…, distinct from the fixture ids above). */
export function counterIds(prefix = "10000000-0000-4000-8000-"): () => string {
  let n = 0;
  return () => `${prefix}${(n += 1).toString(16).padStart(12, "0")}`;
}

/** A recorded event (charter §3.3) of the synthetic case. Riyadh offset on purpose (ordering is by instant). */
export function syntheticEvent(
  event_id: string,
  type: string,
  occurred_at: string,
  object: ObjectRef | null,
  payload: Payload = {},
  extra: Partial<CharterEvent> & Record<string, unknown> = {},
): CharterEvent & Record<string, unknown> {
  return {
    event_id,
    type,
    occurred_at,
    recorded_at: occurred_at,
    case_id: IDS.CASE,
    object,
    actor: { capacity: "SECRETARY", id: IDS.SECRETARY },
    provenance: { source: "SYNTHETIC_DEMO", ref: "src/lifecycle/fixtures.js" },
    version: 1,
    causation_id: null,
    correlation_id: "corr-demo-0001",
    payload,
    ...extra,
  };
}

export const EVENTS = deepFreeze([
  syntheticEvent("evt-case-registered", "CASE_REGISTERED", "2026-10-01T09:00:00+03:00", {
    type: "CASE",
    id: IDS.CASE,
  }),
  syntheticEvent(
    "evt-case-status",
    "CASE_STATUS_RECORDED",
    "2026-10-05T09:00:00+03:00",
    { type: "CASE", id: IDS.CASE },
    { code: "S3.01" },
  ),
  syntheticEvent("evt-meeting-scheduled", "MEETING_SCHEDULED", "2026-10-20T10:00:00+03:00", {
    type: "MEETING",
    id: IDS.MEETING,
  }),
  syntheticEvent("evt-statement-requested", "STATEMENT_REQUESTED", "2026-10-21T10:00:00+03:00", {
    type: "DEFENCE_NOTICE",
    id: IDS.DEFENCE_NOTICE,
  }),
  syntheticEvent("evt-legal-opinion", "LEGAL_OPINION_SUBMITTED", "2026-10-22T10:00:00+03:00", {
    type: "LEGAL_OPINION",
    id: IDS.LEGAL_OPINION,
  }),
  syntheticEvent(
    "evt-decision-recorded",
    "AUTHORITY_DECISION_RECORDED",
    "2026-10-24T10:00:00+03:00",
    { type: "DECISION", id: IDS.DECISION },
    { outcome: "APPROVE_AS_RECOMMENDED" },
  ),
]);

export const CASE_RECORD = deepFreeze<CaseRecord>({
  case_id: IDS.CASE,
  internal_ref: INTERNAL_REF,
  track: "IR",
  classification: "INTERNAL",
  status: { code: "S3.01", recorded_at: "2026-10-05T09:00:00+03:00", source_event_id: "evt-case-status" },
  flags: { suspended: false, returned: false, cancelled: false, reopened: false, closed: false },
  restrictions: { rca_required: false },
});

export const PROCEDURAL_OBJECTS = deepFreeze<ProceduralObject[]>([
  {
    object_id: IDS.MEETING,
    type: "MEETING",
    case_id: IDS.CASE,
    journey_id: "J-SYNTHETIC-MEETING",
    status: "SCHEDULED",
    status_source_event_id: "evt-meeting-scheduled",
    steps: [],
    deadlines: [],
  },
  {
    object_id: IDS.DECISION,
    type: "DECISION",
    case_id: IDS.CASE,
    journey_id: "J-SYNTHETIC-DECISION",
    status: "DECIDED",
    status_source_event_id: "evt-decision-recorded",
    steps: [],
    deadlines: [],
  },
]);

/** Directory read by notify.enqueue (`identity.app_user.status = 'ACTIVE'`, 1920:254). */
export const USERS = deepFreeze<Record<string, OutboxUser>>(
  Object.fromEntries(
    [IDS.MEMBER, IDS.SECRETARY, IDS.CHAIR, IDS.WITNESS, IDS.SUBJECT, IDS.MEMBER_2]
      .map((id): [string, OutboxUser] => [id, { status: "ACTIVE" }])
      .concat([[IDS.INACTIVE_MEMBER, { status: "DISABLED" }]]),
  ),
);

/** What the platform triggers would select (recipient ids + class + capacity only). */
export const RECIPIENT_MAP = deepFreeze<Record<string, ResolvedRecipient[]>>({
  [`MEETING_INVITATION:${IDS.MEETING}`]: [
    { recipient_id: IDS.MEMBER, class: "MEMBER", capacity: "COMMITTEE_MEMBER" },
    { recipient_id: IDS.MEMBER_2, class: "MEMBER", capacity: "COMMITTEE_MEMBER" },
    { recipient_id: IDS.SECRETARY, class: "SECRETARY", capacity: "COMMITTEE_SECRETARY" },
    { recipient_id: IDS.INACTIVE_MEMBER, class: "MEMBER", capacity: "COMMITTEE_MEMBER" },
  ],
  [`MINUTES_REVIEW_REMINDER:${IDS.MEETING}`]: [
    { recipient_id: IDS.MEMBER, class: "MEMBER", capacity: "COMMITTEE_MEMBER" },
  ],
  [`DEFENCE_NOTICE_ISSUED:${IDS.DEFENCE_NOTICE}`]: [
    { recipient_id: IDS.SUBJECT, class: "SUBJECT", capacity: "SUBJECT_OF_PROCEEDINGS" },
  ],
  [`DEFENCE_UNCONFIGURED:${IDS.DEFENCE_NOTICE}`]: [
    { recipient_id: IDS.SUBJECT, class: "SUBJECT", capacity: "SUBJECT_OF_PROCEEDINGS" },
  ],
});

/** TEST CONFIGURATION (see header). DEFENCE_UNCONFIGURED has no approval spec: the lifecycle fails closed. */
export const NOTIFICATION_TYPES = deepFreeze<Record<string, NotificationTypeInput>>({
  MEETING_INVITATION: {
    template_code: "MEETING_INVITATION",
    template_version: TEMPLATE_VERSION,
    channels: ["EMAIL", "IN_APP"],
    approval: { required: false, basis: "SYNTHETIC: administrative coordination (charter §6)" },
    allowed_trigger_types: ["MEETING_SCHEDULED", "MEETING_RESCHEDULED"],
    journey_capacities: ["COMMITTEE_MEMBER", "COMMITTEE_SECRETARY"],
  },
  MINUTES_REVIEW_REMINDER: {
    template_code: "MINUTES_REVIEW_REMINDER",
    template_version: TEMPLATE_VERSION,
    channels: ["EMAIL", "IN_APP"],
    approval: { required: false, basis: "SYNTHETIC: administrative reminder" },
    key_occurrence: "EVENT",
  },
  DEFENCE_NOTICE_ISSUED: {
    template_code: "DEFENCE_NOTICE_ISSUED",
    template_version: TEMPLATE_VERSION,
    channels: ["EMAIL"],
    approval: {
      required: true,
      action_id: "ISSUE_DEFENCE_NOTICE",
      basis: "SYNTHETIC: formal notice to a subject",
    },
    allowed_trigger_types: ["STATEMENT_REQUESTED"],
  },
  DEFENCE_UNCONFIGURED: {
    template_code: "DEFENCE_NOTICE_ISSUED",
    template_version: TEMPLATE_VERSION,
    channels: ["EMAIL"],
  },
});

/** Synthetic authority table `${action_id}:${capacity}` → result; anything else answers SOURCE_REQUIRED (fail closed). */
export const AUTHORITY_TABLE = deepFreeze<Record<string, string>>({
  "ISSUE_DEFENCE_NOTICE:CHAIR": "ALLOWED",
  "ISSUE_DEFENCE_NOTICE:MEMBER": "DENIED",
});

export interface MockAuthority extends AuthorityPort {
  readonly kind: "mock-authority-check";
  check(input?: Partial<AuthorityCheckInput>): { result: string; reason: string };
  calls(): { action_id: string | null; capacity: string | null }[];
}

/** Stand-in for W-D2's check() (charter §6 contract `check({action_id, actor, object}) → {result, reason}`). */
export function createMockAuthority(
  table: Readonly<Record<string, string>> = AUTHORITY_TABLE,
): MockAuthority {
  const calls: { action_id: string | null; capacity: string | null }[] = [];
  return Object.freeze({
    kind: "mock-authority-check" as const,
    check({ action_id, actor }: Partial<AuthorityCheckInput> = {}) {
      const capacity = (actor as { capacity?: string } | null | undefined)?.capacity;
      calls.push({ action_id: action_id ?? null, capacity: capacity ?? null });
      const result = table[`${action_id}:${capacity}`] ?? "SOURCE_REQUIRED";
      return { result, reason: result === "SOURCE_REQUIRED" ? "NO_APPROVED_SOURCE" : "SYNTHETIC_TABLE" };
    },
    calls: () => [...calls],
  });
}

export interface ProjectedModelOptions {
  recipient_class?: string;
  recipient_id?: string;
  policy_version?: string;
  log?: Record<string, { outcome: string; basis?: string[]; [key: string]: unknown }>;
  fields?: Record<string, unknown>;
}

/** Stand-ins made by projectedModel() below; only these pass FIXTURE_PROJECTION_PORT. */
const FIXTURE_MODELS = new WeakSet<object>();

/**
 * The fixture world's projection port (SEC review of #45). The lifecycle's default port is W-D2's isProjected, which
 * refuses these stand-ins; the lifecycle unit tests need hand-set disclosure logs, so createWorld() wires this port
 * explicitly. It accepts only objects that projectedModel() made: a hand-made `{_disclosure_applied: true, …}` is still
 * refused. Tests that need the real projection use buildProjected()/projectForRecipient() and a world without this port.
 */
export const FIXTURE_PROJECTION_PORT = Object.freeze({
  isProjected: (m: unknown): boolean => typeof m === "object" && m !== null && FIXTURE_MODELS.has(m),
});

/**
 * The fixture world's rendering port (V13-PROC-022, OI-053). The lifecycle's default port accepts only a renderer
 * output made from the very model being exported; the lifecycle unit tests hand the export renderedFor() placeholders
 * with stand-in models, so this port accepts any rendering only together with a stand-in model (one that
 * projectedModel() made, which no real projection can be) and applies the real check to every other model.
 */
export const FIXTURE_RENDERING_PORT = Object.freeze({
  isRenderingOf: (r: unknown, m: unknown): boolean =>
    (typeof m === "object" && m !== null && FIXTURE_MODELS.has(m)) ||
    RENDERER_PROVENANCE_PORT.isRenderingOf(r, m),
});

/**
 * Stand-in for a model returned by W-D2's project() (charter §5): `_disclosure_applied: true` and `_disclosure_log`
 * (field → {outcome, basis}). Display values are placeholders; no names, no addresses. It passes only the fixture
 * world's FIXTURE_PROJECTION_PORT, never the lifecycle's default port.
 */
export function projectedModel({
  recipient_class = "MEMBER",
  recipient_id = IDS.MEMBER,
  policy_version = POLICY_VERSION,
  log,
  fields,
}: ProjectedModelOptions = {}) {
  const m = deepFreeze({
    _disclosure_applied: true as const,
    _disclosure_log: log ?? {
      meeting_info: { outcome: "ALLOWED", basis: ["SYNTHETIC"] },
      deadline: { outcome: "ALLOWED", basis: ["SYNTHETIC"] },
      case_number: { outcome: "PROHIBITED", basis: ["SYNTHETIC"] },
      internal_ref: { outcome: "PROHIBITED", basis: ["SYNTHETIC"] },
    },
    _disclosure_summary: { policy_version, recipient: recipient_class },
    recipient_id,
    fields: fields ?? { meeting_info: "Committee meeting (synthetic)", deadline: null },
  });
  FIXTURE_MODELS.add(m);
  return m;
}

/** What a renderer would hand to the export: subject, text twin, HTML (synthetic placeholders). */
export function renderedFor(subject = "Meeting invitation (synthetic)"): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject,
    text: "You are invited to a committee meeting. SYNTHETIC DATA — بيانات اصطناعية.",
    html: '<!doctype html><html lang="en" dir="ltr"><head><title>synthetic</title></head><body><p>You are invited to a committee meeting.</p><p>SYNTHETIC DATA — بيانات اصطناعية</p></body></html>',
  };
}

export const INVITATION_STATEMENT = deepFreeze<Statement>({
  claims: {},
  fields_shown: [{ field: "meeting_info", form: "RAW" }],
  informational: false,
  required_action: { kind: "READ_ONLY" },
});

export const DEFENCE_STATEMENT = deepFreeze<Statement>({
  claims: {},
  fields_shown: [],
  deadline: null,
  informational: false,
  required_action: { kind: "SUBMIT_STATEMENT" },
});

/** A draft input; overrides may carry any value on purpose (negative tests). */
export type DraftOverrides = Record<string, unknown>;

export function invitationDraft(overrides: DraftOverrides = {}): DraftInput & Record<string, unknown> {
  return {
    type_code: "MEETING_INVITATION",
    object: { type: "MEETING", id: IDS.MEETING },
    case_id: IDS.CASE,
    originating_event_id: "evt-meeting-scheduled",
    recipient_id: IDS.MEMBER,
    channel: "EMAIL",
    policy_version: POLICY_VERSION,
    actor: SECRETARY_ACTOR,
    ...overrides,
  };
}

export function defenceNoticeDraft(overrides: DraftOverrides = {}): DraftInput & Record<string, unknown> {
  return {
    type_code: "DEFENCE_NOTICE_ISSUED",
    object: { type: "DEFENCE_NOTICE", id: IDS.DEFENCE_NOTICE },
    case_id: IDS.CASE,
    originating_event_id: "evt-statement-requested",
    recipient_id: IDS.SUBJECT,
    channel: "EMAIL",
    policy_version: POLICY_VERSION,
    actor: SECRETARY_ACTOR,
    ...overrides,
  };
}

export interface WorldOptions {
  clock?: CounterClock | (() => string);
  ids?: () => string;
  users?: Readonly<Record<string, OutboxUser>>;
  senderOutcomes?: readonly SenderOutcome[];
  senderDefault?: SenderOutcome;
  recipientMap?: Readonly<Record<string, readonly Partial<ResolvedRecipient>[]>>;
  cases?: readonly unknown[];
  objects?: readonly unknown[];
  events?: readonly unknown[];
  authority?: AuthorityPort | null;
  authorityTable?: Readonly<Record<string, string>>;
  types?: Readonly<Record<string, NotificationTypeInput | null | undefined>>;
  lifecycle?: Partial<LifecycleDeps>;
}

/** Builds the mocks and the lifecycle with one deterministic clock and id source. */
export function createWorld(opts: WorldOptions = {}) {
  const clock = opts.clock ?? counterClock();
  const ids = opts.ids ?? counterIds();
  const ledger = createAuditLedger({ clock, ids });
  const evidence = createEvidenceStore({ clock, ids });
  const outbox = createNotifyOutbox({ clock, ids, users: opts.users ?? USERS, audit: ledger });
  const sender = createStubSender({
    outcomes: opts.senderOutcomes ?? [],
    defaultOutcome: opts.senderDefault ?? true,
  });
  const recipients = createRecipientResolution(opts.recipientMap ?? RECIPIENT_MAP);
  const cases = createCaseReadModel(
    (opts.cases ?? [CASE_RECORD]) as Parameters<typeof createCaseReadModel>[0],
  );
  const procedural = createProceduralReadModel({
    objects: (opts.objects ?? PROCEDURAL_OBJECTS) as readonly Partial<ProceduralObject>[],
    events: (opts.events ?? EVENTS) as readonly Partial<CharterEvent>[],
  });
  const authority =
    opts.authority === null
      ? null
      : (opts.authority ?? createMockAuthority(opts.authorityTable ?? AUTHORITY_TABLE));
  const lifecycle = createNotificationLifecycle({
    ledger,
    evidence,
    outbox,
    sender,
    recipients,
    cases,
    procedural,
    authority,
    projection: FIXTURE_PROJECTION_PORT,
    rendering: FIXTURE_RENDERING_PORT,
    types: opts.types ?? NOTIFICATION_TYPES,
    clock,
    ids,
    ...(opts.lifecycle ?? {}),
  });
  return {
    clock,
    ids,
    ledger,
    evidence,
    outbox,
    sender,
    recipients,
    cases,
    procedural,
    authority,
    lifecycle,
  };
}

export type World = ReturnType<typeof createWorld>;

export interface ToQueuedOptions {
  model?: unknown;
  statement?: unknown;
  approver?: unknown;
}

/** Drives a MEETING_INVITATION (or the given draft) to VALIDATED → AUTHORIZED → QUEUED. Returns the QUEUED record. */
export function toQueued(
  world: World,
  draftInput: DraftInput = invitationDraft(),
  { model, statement = INVITATION_STATEMENT, approver = CHAIR_ACTOR }: ToQueuedOptions = {},
) {
  const lc = world.lifecycle;
  let r = lc.draft(draftInput).record;
  const m =
    model ?? projectedModel({ recipient_id: r.recipient.recipient_id, recipient_class: r.recipient.class });
  r = lc.transition(r, "VALIDATED", { actor: SECRETARY_ACTOR, model: m, statement }).record;
  if (r.approval.required === false) r = lc.transition(r, "AUTHORIZED", { actor: SECRETARY_ACTOR }).record;
  else {
    r = lc.transition(r, "AUTHORIZATION_PENDING", { actor: SECRETARY_ACTOR }).record;
    r = lc.transition(r, "AUTHORIZED", { actor: approver }).record;
  }
  return lc.transition(r, "QUEUED", { actor: SECRETARY_ACTOR }).record;
}

export type { DeepReadonly };
