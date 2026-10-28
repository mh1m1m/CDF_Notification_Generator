// tests/unit/domain/invariants.test.ts — CDF Notifications V13 · workstream W-A (domain model). Ported from
// tests/invariants.test.js (node:test → Vitest).
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
//
// Charter §12 and directive §4.3 :379 ("Every invariant must have a corresponding test."): every invariant INV-01 …
// INV-27 (lib/domain/invariants.ts) has at least one passing case and one violating case here; test names carry the
// invariant id (INV-00c checks it). The baseline context is one synthetic committee case (CDF-DEMO-2026-0001,
// recipients @example.test, event provenance SYNTHETIC_DEMO). Delivery attempts, the issuance context and the
// acknowledgement are W-D1 evidence entries (work/LEAD_notes.md L-07; W-D1 lib/notifications/lifecycle/evidence.ts shape),
// not ledger events; legacyAttempt() adds the ledger shape of one attempt (DELIVERY_ATTEMPT object + DeliveryStatus
// record). The e-mail is confirmed under ACCEPTANCE (the default, L-07) by a provider delivery report:
// PROVIDER_DELIVERY_REPORT is a W-A proposal name, and no platform delivery report exists today (UNVERIFIED,
// PRODUCTION_SUBSTITUTION_REQUIRED). Every test builds a fresh baseline and mutates only its own copy.
// The master execution directive (an owner message, §4.3 :364-379) is not in the repository: INV-00f keeps every
// assertion that does not re-read it.
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  INVARIANTS,
  INVARIANT_IDS,
  getInvariant,
  checkInvariant,
  checkAll,
  checkClaim,
  RECORDED_ON_BEHALF_EVENTS,
  DIRECTIVE_EXAMPLE_LINES,
  payloadFilterMatches,
} from "@/lib/domain/invariants";
import type {
  CatalogueStep,
  CheckAllResult,
  CheckedInvariant,
  DeadlineRecord,
  DeliveryAttemptRecord,
  DeadlineRule,
  L1Display,
  LayerARow,
  LayerBRow,
  NextAction,
  NotificationRecord,
  ObjectStep,
  ProceduralObjectRecord,
  RecipientRecord,
  Statement,
  WhatNextItem,
} from "@/lib/domain/invariants";
import type { CaseRecord, EvidenceEntry } from "@/lib/domain/status";
import type { DomainEvent, EventActor, ObjectRef, Payload } from "@/lib/domain/types";
import { DIRECTIVE } from "@/lib/domain/epistemic";

// The master execution directive is an owner message (work/owner_messages_*): never copied into the repository.

// ---------------------------------------------------------------------------------------------------------------------
// Fixture types (the synthetic baseline is fully populated, so the tests can mutate it without null checks)
// ---------------------------------------------------------------------------------------------------------------------
type Ev = DomainEvent & {
  occurred_at: string;
  recorded_at: string;
  actor: EventActor;
  provenance: { source: string; ref: string };
  payload: Payload;
};
type Obj = ProceduralObjectRecord & { journey_id?: string; steps: ObjectStep[]; deadlines: DeadlineRecord[] };
type Act = NextAction & {
  ar?: string;
  en?: string;
  how?: Record<string, string>;
  informational?: boolean;
  what_next: WhatNextItem[];
};
type Note = NotificationRecord & {
  recipient: RecipientRecord;
  statements: Statement[];
  next_action: Act;
  deadlines: DeadlineRecord[];
  links: string[];
  corrects?: { version?: number | null; reason_code?: string | null } | null;
};
type CaseRec = CaseRecord & {
  status: { code?: string | null; recorded_at?: string | null; source_event_id?: string | null };
  flags: Record<string, unknown>;
  history?: { code?: string | null; recorded_at?: string | null; source_event_id?: string | null }[];
};
type Entry = EvidenceEntry & { data: Record<string, unknown> };
interface Fixture {
  case: CaseRec;
  objects: Obj[];
  events: Ev[];
  catalogue: { steps: Record<string, CatalogueStep> };
  deadline_rules: Record<string, DeadlineRule>;
  notification: Note;
  notification_versions: Note[];
  evidence: Entry[];
  delivery_confirmation?: string;
  delivery_attempts: DeliveryAttemptRecord[];
  progress: { l1: L1Display | null; layer_a: LayerARow[]; layer_b: LayerBRow[] };
  now: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic baseline (SYNTHETIC — no real CDF data; identifiers are test UUIDs)
// ---------------------------------------------------------------------------------------------------------------------
const u = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CASE = u(1);
const P = u(11);
const M = u(12);
const B = u(13);
const R = u(14);
const L = u(15);
const D = u(16);
const T = u(17);
const N = u(21);
const A = u(31);
const T0 = Date.parse("2026-10-01T08:00:00Z");
const at = (h: number, m = 0): string => new Date(T0 + h * 3600e3 + m * 60e3).toISOString();
const SECRETARY = Object.freeze({ capacity: "SECRETARY", id: "usr-secretary-01" });
const SYSTEM = Object.freeze({ capacity: "SYSTEM", id: "svc-notify-demo" });

interface EOptions {
  object?: ObjectRef | null;
  payload?: Payload;
  actor?: EventActor;
  causation_id?: string | null;
  version?: number;
  case_id?: string | null;
}
function E(
  event_id: string,
  type: string,
  h: number,
  {
    object = null,
    payload = {},
    actor = SECRETARY,
    causation_id = null,
    version = 1,
    case_id = CASE,
  }: EOptions = {},
): Ev {
  return {
    event_id,
    type,
    occurred_at: at(h),
    recorded_at: at(h, 1),
    case_id,
    object,
    actor: { ...actor },
    provenance: { source: "SYNTHETIC_DEMO", ref: "tests/invariants.test.js#BASE" },
    version,
    causation_id,
    correlation_id: "corr-demo-0001",
    payload,
  };
}
const ref = (type: string, id: string): ObjectRef => ({ type, id });
/** A W-D1 evidence entry (lib/notifications/lifecycle/evidence.ts: seq, entry_id, notification_id, version, kind, recorded_at, data). */
const evd = (
  seq: number,
  kind: string,
  h: number,
  data: Record<string, unknown>,
  { version = 1, notification_id = N }: { version?: number; notification_id?: string } = {},
): Entry => ({
  seq,
  entry_id: `evd-demo-${String(seq).padStart(2, "0")}`,
  notification_id,
  version,
  kind,
  recorded_at: at(h, 1),
  data,
});

function baseline(): Fixture {
  const events: Ev[] = [
    E("evt-case-03", "CASE_STATUS_RECORDED", 0, {
      object: ref("CASE", CASE),
      payload: { from: "S4.02", to: "S4.03", transition_id: "T23" },
    }),
    E("evt-p-01", "PROCEDURE_OPENED", 1, { object: ref("PROCEDURE", P) }),
    E("evt-p-02", "PROCEDURE_STARTED", 2, { object: ref("PROCEDURE", P) }),
    E("evt-m-01", "MEETING_SCHEDULED", 3, { object: ref("MEETING", M) }),
    E("evt-m-02", "MEETING_OPENED", 4, { object: ref("MEETING", M) }),
    E("evt-p-03", "CHAIR_DIRECTION_RECORDED", 5, {
      object: ref("PROCEDURE", P),
      payload: { direction: "VOTE", performed_by: { capacity: "CHAIR" } },
    }),
    E("evt-r-01", "RECOMMENDATION_DRAFTED", 6, { object: ref("RECOMMENDATION", R) }),
    E("evt-b-01", "BALLOT_OPENED", 7, {
      object: ref("BALLOT", B),
      payload: { target: ref("RECOMMENDATION", R) },
    }),
    E("evt-b-02", "BALLOT_CLOSED", 8, { object: ref("BALLOT", B), payload: { result: "APPROVED" } }),
    E("evt-r-02", "RECOMMENDATION_ADOPTED", 9, {
      object: ref("RECOMMENDATION", R),
      payload: { performed_by: { capacity: "COMMITTEE" } },
    }),
    E("evt-m-03", "MEETING_CLOSED", 10, { object: ref("MEETING", M) }),
    E("evt-m-04", "MINUTES_DRAFTED", 11, { object: ref("MEETING", M) }),
    E("evt-m-05", "MINUTES_UNDER_REVIEW", 12, { object: ref("MEETING", M) }),
    E("evt-m-06", "MINUTES_FINAL", 13, { object: ref("MEETING", M), payload: { basis: "APPROVED" } }),
    E("evt-l-01", "LEGAL_REVIEW_REQUESTED", 14, {
      object: ref("LEGAL_OPINION", L),
      payload: { target: ref("RECOMMENDATION", R) },
    }),
    E("evt-l-02", "LEGAL_OPINION_SUBMITTED", 15, {
      object: ref("LEGAL_OPINION", L),
      payload: { opinion: "CONCURS", target: ref("RECOMMENDATION", R) },
      actor: { capacity: "LEGAL_REVIEWER", id: "usr-legal-01" },
    }),
    E("evt-r-03", "PACKAGE_SUBMITTED_TO_AUTHORITY", 16, {
      object: ref("RECOMMENDATION", R),
      payload: { related: [ref("DECISION", D)] },
    }),
    E("evt-case-04", "CASE_STATUS_RECORDED", 17, {
      object: ref("CASE", CASE),
      payload: { from: "S4.03", to: "S4.04", transition_id: "T24" },
    }),
    E("evt-t-01", "STATEMENT_REQUESTED", 18, { object: ref("TASK", T) }),
    E("evt-n-01", "NOTIFICATION_DRAFTED", 19, {
      object: ref("NOTIFICATION", N),
      actor: SYSTEM,
      causation_id: "evt-r-03",
    }),
    E("evt-n-02", "NOTIFICATION_VALIDATED", 20, { object: ref("NOTIFICATION", N), actor: SYSTEM }),
    E("evt-n-03", "NOTIFICATION_AUTHORIZED", 21, { object: ref("NOTIFICATION", N) }),
    E("evt-n-04", "NOTIFICATION_QUEUED", 22, { object: ref("NOTIFICATION", N), actor: SYSTEM }),
    E("evt-n-05", "NOTIFICATION_SENT", 23, { object: ref("NOTIFICATION", N), actor: SYSTEM }),
    // L-07 ACCEPTANCE: e-mail delivery is confirmed by a provider delivery report (name: W-A proposal; UNVERIFIED)
    E("evt-n-06", "DELIVERY_CONFIRMED", 26, {
      object: ref("NOTIFICATION", N),
      actor: SYSTEM,
      payload: { channel: "EMAIL", evidence_kind: "PROVIDER_DELIVERY_REPORT" },
    }),
    E("evt-n-07", "RECIPIENT_ACKNOWLEDGED", 27, {
      object: ref("NOTIFICATION", N),
      actor: { capacity: "MEMBER", id: "usr-member-01" },
    }),
  ];
  const dir = (n: number, actual: string, ev: string | null = null): ObjectStep => ({
    step_id: `J-DEMO-DIRECTION/2/${n}`,
    actual,
    evidence_event_id: ev,
    epistemic: actual === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "DERIVED_FROM_VERIFIED_FACTS",
  });
  const objects: Obj[] = [
    {
      object_id: P,
      type: "PROCEDURE",
      case_id: CASE,
      journey_id: "J-DEMO-DIRECTION",
      status: "IN_PROGRESS",
      status_source_event_id: "evt-p-02",
      steps: [
        dir(1, "NOT_APPLICABLE"),
        dir(2, "NOT_APPLICABLE"),
        dir(3, "COMPLETED", "evt-p-03"),
        dir(4, "NOT_APPLICABLE"),
      ],
      deadlines: [],
    },
    {
      object_id: M,
      type: "MEETING",
      case_id: CASE,
      journey_id: "J-DEMO-COMMITTEE",
      status: "MINUTES_FINAL",
      status_source_event_id: "evt-m-06",
      steps: [],
      deadlines: [],
    },
    {
      object_id: B,
      type: "BALLOT",
      case_id: CASE,
      journey_id: "J-DEMO-COMMITTEE",
      status: "COMPLETED",
      status_source_event_id: "evt-b-02",
      steps: [
        {
          step_id: "J-DEMO-COMMITTEE/2/1",
          actual: "COMPLETED",
          evidence_event_id: "evt-b-02",
          epistemic: "DERIVED_FROM_VERIFIED_FACTS",
        },
      ],
      deadlines: [],
    },
    {
      object_id: R,
      type: "RECOMMENDATION",
      case_id: CASE,
      journey_id: "J-DEMO-COMMITTEE",
      status: "SUBMITTED_TO_AUTHORITY",
      status_source_event_id: "evt-r-03",
      steps: [],
      deadlines: [],
    },
    {
      object_id: L,
      type: "LEGAL_OPINION",
      case_id: CASE,
      journey_id: "J-DEMO-COMMITTEE",
      status: "COMPLETED",
      status_source_event_id: "evt-l-02",
      steps: [],
      deadlines: [],
    },
    {
      object_id: D,
      type: "DECISION",
      case_id: CASE,
      journey_id: "J-DEMO-COMMITTEE",
      status: "SUBMITTED_TO_AUTHORITY",
      status_source_event_id: "evt-r-03",
      steps: [],
      deadlines: [],
    },
    {
      object_id: T,
      type: "TASK",
      case_id: CASE,
      journey_id: "J-DEMO-COMMITTEE",
      status: "ASSIGNED",
      status_source_event_id: "evt-t-01",
      steps: [],
      deadlines: [
        {
          kind: "STATEMENT_DUE",
          at: "2026-10-28T09:00:00Z",
          basis_event_id: "evt-t-01",
          basis_rule: "SYNTHETIC-RULE-01",
        },
      ],
    },
  ];
  const alt = (n: number, direction: string): CatalogueStep => ({
    kind: "ALTERNATIVE",
    alternative_group: "AG-DEMO-DIRECTION",
    trigger_event_type: "MEETING_OPENED",
    completion_event_type: "CHAIR_DIRECTION_RECORDED",
    completion_payload: { direction },
  });
  const catalogue: Fixture["catalogue"] = {
    steps: {
      "J-DEMO-DIRECTION/2/1": alt(1, "MEETING"),
      "J-DEMO-DIRECTION/2/2": alt(2, "INFO_REQUEST"),
      "J-DEMO-DIRECTION/2/3": alt(3, "VOTE"),
      "J-DEMO-DIRECTION/2/4": alt(4, "DEFER"),
      "J-DEMO-COMMITTEE/2/1": {
        kind: "STEP",
        alternative_group: null,
        trigger_event_type: "BALLOT_OPENED",
        completion_event_type: "BALLOT_CLOSED",
      },
      "J-DEMO-COMMITTEE/3/1": {
        kind: "STEP",
        alternative_group: null,
        trigger_event_type: "PACKAGE_SUBMITTED_TO_AUTHORITY",
        completion_event_type: "AUTHORITY_DECISION_RECORDED",
      },
    },
  };
  const l1: L1Display = { code: "S4.04", stage: "S4", source: "CASE_RECORD", source_event_id: "evt-case-04" };
  const statements: Statement[] = [
    {
      id: "s1",
      about: ref("RECOMMENDATION", R),
      asserts_event: "RECOMMENDATION_ADOPTED",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-r-02",
      source: { kind: "EVENT", event_id: "evt-r-02" },
      actor_capacity: "COMMITTEE",
      text: { ar: "اعتمدت اللجنة التوصية", en: "The committee adopted the recommendation" },
    },
    {
      id: "s2",
      about: ref("BALLOT", B),
      asserts_status: "COMPLETED",
      display_state: "COMPLETED",
      epistemic: "DERIVED_FROM_VERIFIED_FACTS",
      evidence_event_id: "evt-b-02",
      source: { kind: "DERIVATION", event_id: "evt-b-02" },
      text: { ar: "أُغلق التصويت", en: "The vote was closed" },
    },
    {
      id: "s3",
      about: ref("MEETING", M),
      asserts_status: "MINUTES_FINAL",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-m-06",
      source: { kind: "EVENT", event_id: "evt-m-06" },
      text: { ar: "اعتُمد محضر الاجتماع", en: "The meeting minutes are final" },
    },
    {
      id: "s4",
      about: ref("RECOMMENDATION", R),
      asserts_status: "SUBMITTED_TO_AUTHORITY",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-r-03",
      source: { kind: "OBJECT_RECORD" },
      text: {
        ar: "رُفعت التوصية إلى صاحب الصلاحية",
        en: "The recommendation was submitted to the authority",
      },
    },
    {
      id: "s5",
      about: ref("DECISION", D),
      display_state: "EXPECTED",
      epistemic: "EXPECTED_PROCESS",
      evidence_event_id: null,
      source: { kind: "CATALOGUE" },
      text: { ar: "خطوة متوقعة — قرار صاحب الصلاحية", en: "Expected step — the authority decision" },
    },
    {
      id: "s6",
      about: ref("LEGAL_OPINION", L),
      asserts_status: "COMPLETED",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-l-02",
      source: { kind: "EVENT", event_id: "evt-l-02" },
      actor_capacity: "LEGAL_REVIEWER",
      text: { ar: "قُدّم الرأي النظامي", en: "The legal opinion was given" },
    },
  ];
  const notification: Note = {
    notification_id: N,
    version: 1,
    type_code: "DEMO-RECOMMENDATION-SUBMITTED",
    channel: "EMAIL",
    case_id: CASE,
    object: ref("RECOMMENDATION", R),
    recipient: { id: "usr-member-01", class: "MEMBER", email: "committee.member@example.test" },
    status: "DELIVERY_CONFIRMED",
    status_source_event_id: "evt-n-06",
    l1: { ...l1 },
    statements,
    next_action: {
      kind: "READ_ONLY",
      ar: "للاطلاع فقط — لا يلزم إجراء حالياً",
      en: "For information only — no action is required now",
      deadline: null,
      how: { channel: "PLATFORM", link_kind: "PLATFORM_DEEP_LINK" },
      what_next: [
        {
          kind: "EXPECTED",
          ar: "خطوة متوقعة: قرار صاحب الصلاحية",
          en: "Expected step: the authority decision",
        },
      ],
      informational: true,
      epistemic: "PROPOSED_ACTION",
    },
    deadlines: [],
    case_effect: "CASE_UNCHANGED",
    originating_event_id: "evt-r-03",
    internal_ref: "CDF-DEMO-2026-0001",
    links: ["https://platform.example.test/cases/demo-0001"],
    _disclosure_applied: true,
  };
  return {
    case: {
      case_id: CASE,
      internal_ref: "CDF-DEMO-2026-0001",
      track: "IR",
      classification: "RESTRICTED",
      status: { code: "S4.04", recorded_at: at(17, 1), source_event_id: "evt-case-04" },
      flags: { suspended: false, returned: false, cancelled: false, reopened: false, closed: false },
      restrictions: { rca_required: false },
      exists: true,
    },
    objects,
    events,
    catalogue,
    deadline_rules: {
      "SYNTHETIC-RULE-01": {
        trigger_event_type: "STATEMENT_REQUESTED",
        label: "SYNTHETIC — test rule, not a CDF rule",
      },
    },
    notification,
    notification_versions: [notification],
    // W-D1 evidence entries for version 1 (no delivery_confirmation key: ACCEPTANCE, the default, applies — L-07)
    evidence: [
      evd(1, "ISSUANCE_CONTEXT", 19, {
        originating_event_id: "evt-r-03",
        source_refs: [
          { kind: "EVENT", id: "evt-r-03" },
          { kind: "OBJECT", type: "RECOMMENDATION", id: R },
        ],
      }),
      evd(2, "DELIVERY_ATTEMPT", 24, {
        attempt: 1,
        status: "ATTEMPTED",
        outbox_row_id: "obx-demo-0001",
        at: at(24),
      }),
      evd(3, "DELIVERY_ATTEMPT", 25, {
        attempt: 1,
        status: "ACCEPTED_BY_PROVIDER",
        outbox_status: "SENT",
        outbox_row_id: "obx-demo-0001",
        at: at(25),
      }),
      evd(4, "ACKNOWLEDGEMENT", 27, {
        event_id: "evt-n-07",
        at: at(27),
        actor: { capacity: "MEMBER", id: "usr-member-01" },
      }),
    ],
    delivery_attempts: [],
    progress: {
      l1: { ...l1 },
      layer_a: [
        {
          step_id: "J-DEMO-COMMITTEE/2/1",
          object_id: B,
          display_state: "COMPLETED",
          epistemic: "DERIVED_FROM_VERIFIED_FACTS",
          evidence_event_id: "evt-b-02",
          text: { ar: "التصويت", en: "Vote" },
        },
        {
          step_id: "J-DEMO-DIRECTION/2/3",
          object_id: P,
          display_state: "COMPLETED",
          epistemic: "DERIVED_FROM_VERIFIED_FACTS",
          evidence_event_id: "evt-p-03",
          text: { ar: "توجيه الرئيس بالتصويت", en: "Chair direction: vote" },
        },
      ],
      layer_b: [
        {
          step_id: "J-DEMO-COMMITTEE/3/1",
          kind: "EXPECTED",
          symbol: "◇",
          epistemic: "EXPECTED_PROCESS",
          text: { ar: "خطوة متوقعة — قرار صاحب الصلاحية", en: "Expected step — the authority decision" },
        },
      ],
    },
    now: "2026-10-27T12:00:00Z",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------
const evOf = (ctx: Fixture, id: string): Ev => ctx.events.find((e) => e.event_id === id)!;
const objOf = (ctx: Fixture, id: string): Obj => ctx.objects.find((o) => o.object_id === id)!;
const stOf = (ctx: Fixture, id: string): Statement => ctx.notification.statements.find((s) => s.id === id)!;
const addEvent = (ctx: Fixture, e: Ev): Ev => {
  ctx.events.push(e);
  return e;
};
const addStatement = (ctx: Fixture, s: Statement): Statement => {
  ctx.notification.statements.push(s);
  return s;
};
const dropEvents = (ctx: Fixture, ...ids: string[]): Fixture => {
  ctx.events = ctx.events.filter((e) => !ids.includes(e.event_id));
  return ctx;
};
const attemptEntries = (ctx: Fixture): Entry[] => ctx.evidence.filter((x) => x.kind === "DELIVERY_ATTEMPT");
function pass(id: string, ctx: Fixture): CheckedInvariant {
  const r = checkInvariant(id, ctx);
  assert.equal(r.ok, true, `${id} should pass: ${r.detail}`);
  return r;
}
function violation(id: string, ctx: Fixture, pattern?: RegExp): CheckedInvariant {
  const r = checkInvariant(id, ctx);
  assert.equal(r.ok, false, `${id} should be violated`);
  assert.ok(r.violations.length > 0);
  if (pattern) assert.match(r.detail, pattern);
  return r;
}
function allPass(ctx: Fixture): CheckAllResult {
  const r = checkAll(ctx);
  assert.deepEqual(
    r.violations.map((x) => `${x.id}: ${x.detail}`),
    [],
  );
  assert.deepEqual(
    r.warnings.map((x) => `${x.id}: ${x.detail}`),
    [],
  );
  assert.equal(r.ok, true);
  return r;
}
const decisionRecorded = (ctx: Fixture, h: number, outcome = "APPROVE_AS_RECOMMENDED", id = "evt-d-01"): Ev =>
  addEvent(
    ctx,
    E(id, "AUTHORITY_DECISION_RECORDED", h, {
      object: ref("DECISION", D),
      payload: { outcome, related: [ref("RECOMMENDATION", R)], performed_by: { capacity: "AUTHORITY" } },
    }),
  );

/** The ledger shape of one attempt (DELIVERY_ATTEMPT object + DeliveryStatus record), beside W-D1's evidence entries. */
function legacyAttempt(ctx: Fixture): Fixture {
  addEvent(
    ctx,
    E("evt-a-01", "DELIVERY_ATTEMPTED", 24, {
      object: ref("DELIVERY_ATTEMPT", A),
      payload: { related: [ref("NOTIFICATION", N)], channel: "EMAIL" },
      actor: SYSTEM,
    }),
  );
  addEvent(
    ctx,
    E("evt-a-02", "DELIVERY_ACCEPTED_BY_PROVIDER", 25, {
      object: ref("DELIVERY_ATTEMPT", A),
      payload: { related: [ref("NOTIFICATION", N)] },
      actor: SYSTEM,
    }),
  );
  ctx.delivery_attempts = [
    {
      attempt_id: A,
      notification_id: N,
      version: 1,
      channel: "EMAIL",
      status: "ACCEPTED_BY_PROVIDER",
      status_source_event_id: "evt-a-02",
    },
  ];
  return ctx;
}

/**
 * A corrected lineage (work/LEAD_notes.md L-04): v1 issued and confirmed; v2 corrects it, enters in CORRECTED, is
 * validated, authorized, queued and SENT, and v1 becomes SUPERSEDED in that same step. ctx.notification is v2.
 */
function corrected(): Fixture {
  const ctx = baseline();
  const v1 = ctx.notification;
  const n2 = (id: string, type: string, h: number, extra: EOptions = {}) =>
    addEvent(ctx, E(id, type, h, { object: ref("NOTIFICATION", N), version: 2, actor: SYSTEM, ...extra }));
  n2("evt-n2-01", "NOTIFICATION_CORRECTED", 30, {
    actor: SECRETARY,
    payload: { corrects_version: 1, reason_code: "CONTENT_ERROR" },
  });
  n2("evt-n2-02", "NOTIFICATION_VALIDATED", 31);
  n2("evt-n2-03", "NOTIFICATION_AUTHORIZED", 32, { actor: SECRETARY });
  n2("evt-n2-04", "NOTIFICATION_QUEUED", 33);
  n2("evt-n2-05", "NOTIFICATION_SENT", 34);
  addEvent(
    ctx,
    E("evt-n-09", "NOTIFICATION_SUPERSEDED", 34, {
      object: ref("NOTIFICATION", N),
      actor: SYSTEM,
      causation_id: "evt-n2-05",
      payload: { successor_version: 2 },
    }),
  );
  ctx.evidence.push(
    evd(
      5,
      "DELIVERY_ATTEMPT",
      34,
      { attempt: 1, status: "ATTEMPTED", outbox_row_id: "obx-demo-0002", at: at(34, 10) },
      { version: 2 },
    ),
  );
  ctx.evidence.push(
    evd(
      6,
      "DELIVERY_ATTEMPT",
      34,
      {
        attempt: 1,
        status: "ACCEPTED_BY_PROVIDER",
        outbox_status: "SENT",
        outbox_row_id: "obx-demo-0002",
        at: at(34, 20),
      },
      { version: 2 },
    ),
  );
  const v2: Note = {
    ...structuredClone(v1),
    version: 2,
    corrects: { version: 1, reason_code: "CONTENT_ERROR" },
    status: "SENT",
    status_source_event_id: "evt-n2-05",
  };
  Object.assign(v1, { status: "SUPERSEDED", status_source_event_id: "evt-n-09" });
  ctx.notification = v2;
  ctx.notification_versions = [v1, v2];
  return ctx;
}
/** v1 issued and current; v2, its correction, has just entered in CORRECTED (not yet validated: no disclosure yet). */
function pendingCorrection(): Fixture {
  const ctx = baseline();
  const v1 = ctx.notification;
  addEvent(
    ctx,
    E("evt-n2-01", "NOTIFICATION_CORRECTED", 30, {
      object: ref("NOTIFICATION", N),
      version: 2,
      payload: { corrects_version: 1, reason_code: "CONTENT_ERROR" },
    }),
  );
  const v2: Note = {
    ...structuredClone(v1),
    version: 2,
    corrects: { version: 1, reason_code: "CONTENT_ERROR" },
    status: "CORRECTED",
    status_source_event_id: "evt-n2-01",
    _disclosure_applied: false,
  };
  ctx.notification = v2;
  ctx.notification_versions = [v1, v2];
  return ctx;
}
/** A third version v3 in CORRECTED that corrects `cv`. */
function addPendingV3(ctx: Fixture, cv: number): Note {
  addEvent(
    ctx,
    E("evt-n3-01", "NOTIFICATION_CORRECTED", 40, {
      object: ref("NOTIFICATION", N),
      version: 3,
      payload: { corrects_version: cv, reason_code: "CONTENT_ERROR" },
    }),
  );
  const v3: Note = {
    ...structuredClone(ctx.notification_versions[0]!),
    version: 3,
    corrects: { version: cv, reason_code: "CONTENT_ERROR" },
    status: "CORRECTED",
    status_source_event_id: "evt-n3-01",
    _disclosure_applied: false,
  };
  ctx.notification_versions.push(v3);
  return v3;
}

// ---------------------------------------------------------------------------------------------------------------------
// Catalogue-level tests
// ---------------------------------------------------------------------------------------------------------------------
describe("INV-00 invariant catalogue", () => {
  test("INV-00a baseline: the synthetic committee context satisfies all 27 invariants (no BLOCK, no WARN)", () => {
    const r = allPass(baseline());
    assert.equal(r.results.length, 27);
  });

  test("INV-00b catalogue: 27 entries INV-01…INV-27 with bilingual rule, severity, origin, label, sources and test id", () => {
    assert.equal(INVARIANTS.length, 27);
    assert.deepEqual(
      INVARIANT_IDS,
      Array.from({ length: 27 }, (_, i) => `INV-${String(i + 1).padStart(2, "0")}`),
    );
    for (const i of INVARIANTS) {
      assert.match(i.ar, /[؀-ۿ]/, `${i.id} ar`);
      assert.ok(i.en.length > 20, `${i.id} en`);
      assert.ok(["BLOCK", "WARN"].includes(i.severity), `${i.id} severity`);
      assert.ok(["FACT", "INFERENCE", "PROPOSAL", "UNVERIFIED"].includes(i.label), `${i.id} label`);
      assert.ok(typeof i.origin === "string" && i.origin.length > 5, `${i.id} origin`);
      assert.ok(Array.isArray(i.related_pc) && Object.isFrozen(i.related_pc), `${i.id} related_pc`);
      assert.ok(i.sources.length > 0 && Object.isFrozen(i.sources), `${i.id} sources`);
      assert.equal(i.test, `tests/invariants.test.js#${i.id}`);
      assert.equal(typeof i.check, "function");
      assert.ok(Object.isFrozen(i));
    }
    assert.deepEqual(
      INVARIANTS.filter((i) => i.severity === "WARN").map((i) => i.id),
      ["INV-17"],
    );
    assert.throws(() => getInvariant("INV-99"), /UNKNOWN_INVARIANT/);
  });

  test("INV-00c coverage: this file names a pass test and a violation test for every invariant", () => {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    for (const id of INVARIANT_IDS) {
      // Quote style and line breaks follow the formatter: match test( "INV-nn pass… / violation…" in either quote.
      assert.match(src, new RegExp(`test\\(\\s*["'\`]${id} pass`), `${id} has no pass test`);
      assert.match(src, new RegExp(`test\\(\\s*["'\`]${id} violation`), `${id} has no violation test`);
    }
  });

  test("INV-00d fail closed: a checker that throws is reported as a violation, never swallowed", () => {
    const ctx = baseline();
    Object.defineProperty(ctx, "events", {
      get() {
        throw new Error("synthetic adapter failure");
      },
    });
    const r = checkInvariant("INV-21", ctx);
    assert.equal(r.ok, false);
    assert.match(r.detail, /checker error: synthetic adapter failure/);
    assert.equal(checkAll(ctx).ok, false);
  });

  test("INV-00e checkClaim: evidence-free, invalid and unsupported claims", () => {
    const ctx = baseline();
    assert.deepEqual(
      checkClaim(ctx, { id: "x", about: ref("PROCEDURE", P), epistemic: "EXPECTED_PROCESS" }),
      { ok: true, claim: false },
    );
    assert.equal(
      checkClaim(ctx, { id: "x", about: ref("BALLOT", B), asserts_status: "NOT_APPLICABLE" }).ok,
      true,
    );
    assert.equal(checkClaim(ctx, { id: "x", about: ref("MEETING", M), asserts_status: "DECIDED" }).ok, false);
    assert.equal(
      checkClaim(ctx, {
        id: "x",
        about: ref("BALLOT", B),
        asserts_status: "OPEN",
        evidence_event_id: "evt-missing",
      }).ok,
      false,
    );
    const fi = checkClaim(ctx, {
      id: "x",
      about: ref("DECISION", D),
      asserts_status: "DECIDED",
      evidence_event_id: "evt-r-03",
    });
    assert.equal(fi.ok, false);
    assert.equal(fi.fi && fi.fi.id, "FI-03");
    assert.deepEqual([...RECORDED_ON_BEHALF_EVENTS].sort(), [
      "AUTHORITY_DECISION_RECORDED",
      "CHAIR_DIRECTION_RECORDED",
      "RECOMMENDATION_ADOPTED",
      "RECOMMENDATION_NOT_ADOPTED",
    ]);
  });

  test("INV-00f directive §4.3 :366-375: the ten examples are carried as directive_example (FACT) on their invariants (the comparison with the directive text is not ported: PORT_PLAN §5)", () => {
    assert.deepEqual(
      Object.keys(DIRECTIVE_EXAMPLE_LINES).map(Number),
      [366, 367, 368, 369, 370, 371, 372, 373, 374, 375],
    );
    assert.deepEqual(Object.values(DIRECTIVE_EXAMPLE_LINES), [
      "INV-03",
      "INV-04",
      "INV-05",
      "INV-07",
      "INV-06",
      "INV-08",
      "INV-09",
      "INV-10",
      "INV-20",
      "INV-11",
    ]);
    assert.ok(Object.isFrozen(DIRECTIVE_EXAMPLE_LINES));
    for (const [k, id] of Object.entries(DIRECTIVE_EXAMPLE_LINES)) {
      const line = Number(k);
      const i = getInvariant(id);
      const x = i.directive_example;
      assert.ok(x && Object.isFrozen(x), `${id} directive_example`);
      assert.deepEqual(
        { ref: x.ref, line: x.line, section: x.section, label: x.label },
        { ref: `${DIRECTIVE}:${line}`, line, section: "§4.3", label: "FACT" },
        id,
      );
      assert.ok(
        i.en.startsWith(x.text.replace(/\.$/, "")),
        `${id}: the English rule opens with the directive sentence`,
      );
      assert.match(i.origin, new RegExp(`^directive §4\\.3 :${line}\\b`), `${id} origin`);
      assert.ok(
        i.sources.some((s) => s.startsWith(`${DIRECTIVE}:${line} `)),
        `${id} cites ${DIRECTIVE}:${line}`,
      );
    }
    assert.deepEqual(
      INVARIANTS.filter((i) => i.directive_example)
        .map((i) => i.id)
        .sort(),
      Object.values(DIRECTIVE_EXAMPLE_LINES).sort(),
    );
  });

  test("INV-00g payloadFilterMatches: the catalogue payload filter (scalar equal, array any-of, null in an array = absent key)", () => {
    assert.equal(payloadFilterMatches(null, { a: 1 }), true);
    assert.equal(payloadFilterMatches({}, undefined), true);
    assert.equal(payloadFilterMatches({ direction: "VOTE" }, { direction: "VOTE", other: 1 }), true);
    assert.equal(payloadFilterMatches({ direction: "VOTE" }, { direction: "MEETING" }), false);
    assert.equal(payloadFilterMatches({ direction: "VOTE" }, null), false);
    assert.equal(
      payloadFilterMatches({ result: ["APPROVED", "REJECTED", "TIED"] }, { result: "TIED" }),
      true,
    );
    assert.equal(
      payloadFilterMatches({ result: ["APPROVED", "REJECTED", "TIED"] }, { result: "NO_DECISION" }),
      false,
    );
    assert.equal(payloadFilterMatches({ resubmission: [null, false] }, {}), true);
    assert.equal(payloadFilterMatches({ resubmission: [null, false] }, { resubmission: false }), true);
    assert.equal(payloadFilterMatches({ resubmission: [null, false] }, { resubmission: true }), false);
    assert.equal(
      payloadFilterMatches({ target: { type: "TASK", id: T } }, { target: { type: "TASK", id: T } }),
      true,
    );
    assert.equal(
      payloadFilterMatches({ target: { type: "TASK", id: T } }, { target: { type: "TASK", id: u(27) } }),
      false,
    );
  });

  test("INV-00h the ledger shape of an attempt (DELIVERY_ATTEMPT object + DeliveryStatus record) satisfies all 27 invariants as well", () => {
    allPass(legacyAttempt(baseline()));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// INV-01 … INV-27
// ---------------------------------------------------------------------------------------------------------------------
describe("INV-01 Level 1 from the case record only", () => {
  const withHistory = (ctx: Fixture): Fixture => {
    ctx.case.history = [
      { code: "S4.03", recorded_at: at(0, 1), source_event_id: "evt-case-03" },
      { code: "S4.04", recorded_at: at(17, 1), source_event_id: "evt-case-04" },
    ];
    return ctx;
  };
  test("INV-01 pass: notification and progress Level 1 equal CaseRecord.status.code with its source event", () =>
    pass("INV-01", baseline()));
  test("INV-01 pass: the case code history (L-05) follows the recorded case events and ends in the current code", () =>
    pass("INV-01", withHistory(baseline())));
  test("INV-01 violation: Level 1 taken from the master hint of the notification type (S3.05)", () => {
    const ctx = baseline();
    ctx.notification.l1 = { code: "S3.05", stage: "S3", source: "MASTER_HINT", source_event_id: null };
    violation("INV-01", ctx, /source is MASTER_HINT.*S3\.05 ≠ recorded S4\.04/);
  });
  test("INV-01 violation: stage not derived from the recorded code", () => {
    const ctx = baseline();
    ctx.progress.l1!.stage = "S3";
    violation("INV-01", ctx, /stage S3 ≠ stageOf\(S4\.04\)/);
  });
  test("INV-01 violation: the case record cites an event that records another code", () => {
    const ctx = baseline();
    ctx.case.status.source_event_id = "evt-case-03";
    violation("INV-01", ctx, /records S4\.03, not S4\.04/);
  });
  test("INV-01 violation: a history entry the events do not record; a history that goes back in time and ends elsewhere", () => {
    const ctx = withHistory(baseline());
    ctx.case.history![0]!.source_event_id = "evt-case-04";
    violation(
      "INV-01",
      ctx,
      /case\.history\[0\]: evt-case-04 \(CASE_STATUS_RECORDED\) does not record S4\.03 for this case/,
    );
    const ctx2 = withHistory(baseline());
    ctx2.case.history![1]!.recorded_at = at(-1);
    ctx2.case.history!.push({ code: "S4.03", recorded_at: at(18), source_event_id: "evt-case-03" });
    const r = violation("INV-01", ctx2, /case\.history\[1\]: recorded_at goes back in time/);
    assert.match(r.detail, /case\.history ends in S4\.03, status\.code is S4\.04/);
  });
});

describe("INV-02 no case, no Level 1", () => {
  const noCase = () => {
    const ctx = baseline();
    ctx.case = { case_id: null, exists: false } as CaseRec;
    ctx.notification.l1 = null;
    ctx.notification.case_id = null;
    delete ctx.notification.internal_ref;
    ctx.progress.l1 = null;
    return ctx;
  };
  test("INV-02 pass: exists:false and the notification shows no Level 1, case id or case number", () =>
    pass("INV-02", noCase()));
  test("INV-02 pass: an existing case is not concerned", () => pass("INV-02", baseline()));
  test("INV-02 violation: Level 1 rendered although the case does not exist", () => {
    const ctx = noCase();
    ctx.notification.l1 = { code: "S1.01", stage: "S1", source: "CASE_RECORD", source_event_id: null };
    violation("INV-02", ctx, /notification\.l1 present/);
  });
  test("INV-02 violation: case number and a case statement for a non-existent case", () => {
    const ctx = noCase();
    ctx.notification.internal_ref = "CDF-DEMO-2026-0001";
    addStatement(ctx, {
      id: "sx",
      about: ref("CASE", CASE),
      asserts_status: "S1.03",
      epistemic: "RECORDED_FACT",
      evidence_event_id: null,
      source: { kind: "NONE" },
    });
    const r = violation("INV-02", ctx, /case number/);
    assert.match(r.detail, /statement about a non-existent case/);
  });
});

describe("INV-03 a notification never changes the case", () => {
  test("INV-03 pass: CASE_UNCHANGED notification; case events have no communication cause", () =>
    pass("INV-03", baseline()));
  test("INV-03 pass: a notification reporting a recorded case event, backed by that event", () => {
    const ctx = baseline();
    ctx.notification.case_effect = "REPORTS_RECORDED_CASE_EVENT";
    addStatement(ctx, {
      id: "sc",
      about: ref("CASE", CASE),
      asserts_status: "S4.04",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-case-04",
      source: { kind: "CASE_RECORD" },
    });
    pass("INV-03", ctx);
  });
  test("INV-03 violation: case closure caused by NOTIFICATION_SENT", () => {
    const ctx = baseline();
    addEvent(
      ctx,
      E("evt-case-05", "CASE_CLOSED", 30, { object: ref("CASE", CASE), causation_id: "evt-n-05" }),
    );
    violation("INV-03", ctx, /evt-case-05 CASE_CLOSED is caused by evt-n-05 NOTIFICATION_SENT/);
  });
  test("INV-03 violation: indirect causation chain (case ← procedure ← notification)", () => {
    const ctx = baseline();
    addEvent(
      ctx,
      E("evt-p-09", "PROCEDURE_COMPLETED", 30, { object: ref("PROCEDURE", P), causation_id: "evt-n-06" }),
    );
    addEvent(
      ctx,
      E("evt-case-05", "CASE_STATUS_RECORDED", 31, {
        object: ref("CASE", CASE),
        causation_id: "evt-p-09",
        payload: { from: "S4.04", to: "S4.05", transition_id: "T25" },
      }),
    );
    violation("INV-03", ctx, /caused by evt-n-06 DELIVERY_CONFIRMED/);
  });
  test("INV-03 violation: a CASE_UNCHANGED notification asserts a case change; a case event recorded from notify.*", () => {
    const ctx = baseline();
    addStatement(ctx, {
      id: "sc",
      about: ref("CASE", CASE),
      asserts_status: "S5.05",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-n-05",
      source: { kind: "NOTIFICATION" },
    });
    evOf(ctx, "evt-case-04").provenance.ref = "notify.outbox/row-demo";
    const r = violation("INV-03", ctx, /CASE_UNCHANGED notification asserts a case change/);
    assert.match(r.detail, /recorded from notify\.outbox/);
  });
});

describe("INV-04 recommendation ≠ decision", () => {
  test("INV-04 pass: decision shown only after AUTHORITY_DECISION_RECORDED", () => {
    const ctx = baseline();
    decisionRecorded(ctx, 30);
    Object.assign(objOf(ctx, D), { status: "DECIDED", status_source_event_id: "evt-d-01" });
    addStatement(ctx, {
      id: "sd",
      about: ref("DECISION", D),
      asserts_status: "DECIDED",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-d-01",
      source: { kind: "EVENT", event_id: "evt-d-01" },
    });
    pass("INV-04", ctx);
  });
  test("INV-04 violation: decision shown as made from the package submission (forbidden inference FI-03)", () => {
    const ctx = baseline();
    addStatement(ctx, {
      id: "sd",
      about: ref("DECISION", D),
      asserts_status: "DECIDED",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-r-03",
      source: { kind: "EVENT", event_id: "evt-r-03" },
    });
    violation("INV-04", ctx, /FI-03/);
  });
  test("INV-04 violation: decision object DECIDED on the strength of the adoption event", () => {
    const ctx = baseline();
    Object.assign(objOf(ctx, D), { status: "DECIDED", status_source_event_id: "evt-r-02" });
    violation("INV-04", ctx, /DECISION .* DECIDED/);
  });
  test("INV-04 violation: RETURN_TO_COMMITTEE presented as a decision", () => {
    const ctx = baseline();
    decisionRecorded(ctx, 30, "RETURN_TO_COMMITTEE");
    Object.assign(objOf(ctx, D), { status: "DECIDED", status_source_event_id: "evt-d-01" });
    violation("INV-04", ctx, /guard/);
  });
});

describe("INV-05 adoption only by RECOMMENDATION_ADOPTED", () => {
  test("INV-05 pass: adoption claim rests on RECOMMENDATION_ADOPTED", () => pass("INV-05", baseline()));
  test("INV-05 violation: the legal opinion presented as adoption (forbidden inference FI-07)", () => {
    const ctx = baseline();
    stOf(ctx, "s1").evidence_event_id = "evt-l-02";
    violation("INV-05", ctx, /LEGAL_OPINION_SUBMITTED.*FI-07/);
  });
  test("INV-05 violation: recommendation status ADOPTED sourced from the legal opinion", () => {
    const ctx = baseline();
    Object.assign(objOf(ctx, R), { status: "ADOPTED", status_source_event_id: "evt-l-02" });
    violation("INV-05", ctx, /LEGAL_OPINION_SUBMITTED never leads RECOMMENDATION into ADOPTED/);
  });
  test("INV-05 violation: a vote closed without a decision (NO_DECISION) presented as adoption (L-11)", () => {
    const ctx = baseline();
    Object.assign(evOf(ctx, "evt-b-02").payload, { result: "NO_DECISION", target: ref("RECOMMENDATION", R) });
    stOf(ctx, "s1").evidence_event_id = "evt-b-02";
    violation(
      "INV-05",
      ctx,
      /s1: claims event RECOMMENDATION_ADOPTED of RECOMMENDATION from BALLOT_CLOSED.*requires RECOMMENDATION_ADOPTED/,
    );
  });
});

describe("INV-06 chair direction ≠ vote", () => {
  const B2 = u(23);
  const directed = () => {
    const ctx = baseline();
    addEvent(
      ctx,
      E("evt-p-04", "CHAIR_DIRECTION_RECORDED", 30, {
        object: ref("PROCEDURE", P),
        payload: { direction: "VOTE", target: ref("BALLOT", B2), performed_by: { capacity: "CHAIR" } },
      }),
    );
    return ctx;
  };
  test("INV-06 pass: vote closed shown from BALLOT_CLOSED; a direction alone shows no vote", () => {
    pass("INV-06", baseline());
    pass("INV-06", directed());
  });
  test("INV-06 violation: vote shown open from the chair direction (forbidden inference FI-02)", () => {
    const ctx = directed();
    addStatement(ctx, {
      id: "sv",
      about: ref("BALLOT", B2),
      asserts_status: "OPEN",
      display_state: "IN_PROGRESS",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-p-04",
      source: { kind: "EVENT", event_id: "evt-p-04" },
    });
    violation("INV-06", ctx, /CHAIR_DIRECTION_RECORDED.*FI-02/);
  });
  test("INV-06 violation: ballot object OPEN and recommendation UNDER_VOTE sourced from the direction", () => {
    const ctx = directed();
    ctx.objects.push({
      object_id: B2,
      type: "BALLOT",
      case_id: CASE,
      status: "OPEN",
      status_source_event_id: "evt-p-04",
      steps: [],
      deadlines: [],
    });
    Object.assign(objOf(ctx, R), { status: "UNDER_VOTE", status_source_event_id: "evt-p-03" });
    const r = violation("INV-06", ctx, /BALLOT/);
    assert.match(r.detail, /RECOMMENDATION/);
  });
  test("INV-06 violation: a ballot closed without quorum shown completed (work/LEAD_notes.md L-10); shown as FAILED it passes", () => {
    const ctx = baseline();
    evOf(ctx, "evt-b-02").payload.result = "NO_QUORUM";
    const r = violation("INV-06", ctx, /s2/);
    assert.match(r.detail, /BALLOT/);
    Object.assign(stOf(ctx, "s2"), { asserts_status: "FAILED", display_state: "FAILED" });
    Object.assign(objOf(ctx, B), { status: "FAILED" });
    pass("INV-06", ctx);
  });
});

describe("INV-07 invitation ≠ occurrence", () => {
  test("INV-07 pass: final minutes shown from MINUTES_FINAL", () => pass("INV-07", baseline()));
  test("INV-07 violation: meeting shown closed from MEETING_SCHEDULED (forbidden inference FI-06)", () => {
    const ctx = baseline();
    addStatement(ctx, {
      id: "sm",
      about: ref("MEETING", M),
      asserts_status: "CLOSED",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-m-01",
      source: { kind: "EVENT", event_id: "evt-m-01" },
    });
    violation("INV-07", ctx, /MEETING_SCHEDULED.*FI-06/);
  });
  test("INV-07 violation: a hearing recorded as OPENED on the strength of its invitation", () => {
    const ctx = baseline();
    const H = u(24);
    addEvent(ctx, E("evt-h-01", "MEETING_SCHEDULED", 30, { object: ref("HEARING", H) }));
    ctx.objects.push({
      object_id: H,
      type: "HEARING",
      case_id: CASE,
      status: "OPENED",
      status_source_event_id: "evt-h-01",
      steps: [],
      deadlines: [],
    });
    violation("INV-07", ctx, /HEARING .* OPENED/);
  });
});

describe("INV-08 draft ≠ issued; a formal notice is a domain event", () => {
  test("INV-08 pass: final minutes and a sent notification rest on their issuing events", () =>
    pass("INV-08", baseline()));
  test("INV-08 pass: a formal notice recorded as a domain event of its procedure and reported by the notification (L-05 G-06)", () => {
    const ctx = baseline();
    addEvent(ctx, E("evt-p-06", "RIGHTS_NOTICE_ISSUED", 18.5, { object: ref("PROCEDURE", P) }));
    addStatement(ctx, {
      id: "sr",
      about: ref("PROCEDURE", P),
      asserts_event: "RIGHTS_NOTICE_ISSUED",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-p-06",
      source: { kind: "EVENT", event_id: "evt-p-06" },
      text: { ar: "صدر إشعار الحقوق", en: "The rights notice was issued" },
    });
    pass("INV-08", ctx);
  });
  test("INV-08 violation: minutes shown final from MINUTES_DRAFTED (forbidden inference FI-08)", () => {
    const ctx = baseline();
    stOf(ctx, "s3").evidence_event_id = "evt-m-04";
    violation("INV-08", ctx, /MINUTES_DRAFTED.*FI-08/);
  });
  test("INV-08 violation: notification still DRAFT while dispatch events exist for its version", () => {
    const ctx = baseline();
    Object.assign(ctx.notification, { status: "DRAFT", status_source_event_id: "evt-n-01" });
    violation("INV-08", ctx, /is DRAFT but/);
  });
  test("INV-08 violation: notification shown SENT from its draft event", () => {
    const ctx = baseline();
    addStatement(ctx, {
      id: "sn",
      about: ref("NOTIFICATION", N),
      asserts_status: "SENT",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-n-01",
      source: { kind: "EVENT", event_id: "evt-n-01" },
    });
    violation("INV-08", ctx, /NOTIFICATION_DRAFTED/);
  });
  test("INV-08 violation: a notification not yet queued with delivery attempt evidence entries for its version", () => {
    const ctx = baseline();
    Object.assign(ctx.notification, { status: "AUTHORIZED", status_source_event_id: "evt-n-03" });
    violation("INV-08", ctx, /is AUTHORIZED but has 2 delivery attempt evidence entries for this version/);
  });
  test("INV-08 violation: a formal notice caused by the notification that reports it, and claimed from the dispatch", () => {
    const ctx = baseline();
    addEvent(
      ctx,
      E("evt-p-06", "RIGHTS_NOTICE_ISSUED", 23.5, { object: ref("PROCEDURE", P), causation_id: "evt-n-05" }),
    );
    addStatement(ctx, {
      id: "sr",
      about: ref("PROCEDURE", P),
      asserts_event: "RIGHTS_NOTICE_ISSUED",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-n-05",
      source: { kind: "EVENT", event_id: "evt-n-05" },
    });
    const r = violation(
      "INV-08",
      ctx,
      /evt-p-06 RIGHTS_NOTICE_ISSUED is caused by the notification event evt-n-05 NOTIFICATION_SENT: a formal notice is a domain event/,
    );
    assert.match(r.detail, /sr: evidence evt-n-05 \(NOTIFICATION_SENT\) does not name PROCEDURE/);
  });
});

describe("INV-09 export ≠ delivery", () => {
  const exported = () => {
    const ctx = baseline();
    addEvent(
      ctx,
      E("evt-n-08", "NOTIFICATION_EXPORTED", 30, {
        object: ref("NOTIFICATION", N),
        payload: { format: "EML" },
      }),
    );
    return ctx;
  };
  test("INV-09 pass: delivery confirmed by DELIVERY_CONFIRMED; an export alongside changes nothing", () => {
    pass("INV-09", baseline());
    const ctx = exported();
    ctx.evidence.push(evd(5, "EXPORT", 30, { format: "EML", model_hash: "sha256-demo" }));
    pass("INV-09", ctx);
  });
  test("INV-09 violation: DELIVERY_CONFIRMED status sourced from an .eml export", () => {
    const ctx = exported();
    ctx.notification.status_source_event_id = "evt-n-08";
    violation("INV-09", ctx, /NOTIFICATION_EXPORTED never leads NOTIFICATION into DELIVERY_CONFIRMED/);
  });
  test("INV-09 violation: delivery claimed from the export (FI-04); an attempt record resting on the export", () => {
    const ctx = legacyAttempt(exported());
    addStatement(ctx, {
      id: "sx",
      about: ref("NOTIFICATION", N),
      asserts_status: "DELIVERY_CONFIRMED",
      display_state: "COMPLETED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-n-08",
      source: { kind: "EXPORT" },
    });
    ctx.delivery_attempts[0]!.status_source_event_id = "evt-n-08";
    const r = violation("INV-09", ctx, /FI-04/);
    assert.match(r.detail, /rests on an export/);
  });
  test("INV-09 violation: SENT resting on an export only (an EXPORT evidence entry and no attempt)", () => {
    const ctx = dropEvents(baseline(), "evt-n-06", "evt-n-07");
    Object.assign(ctx.notification, { status: "SENT", status_source_event_id: "evt-n-05" });
    ctx.evidence = [evd(5, "EXPORT", 23.5, { format: "EML", model_hash: "sha256-demo" })];
    violation(
      "INV-09",
      ctx,
      /notification SENT rests on an export only \(1 EXPORT evidence entry, no delivery attempt\)/,
    );
  });
  test("INV-09 violation: a delivery confirmation caused by an export", () => {
    const ctx = baseline();
    addEvent(
      ctx,
      E("evt-n-08", "NOTIFICATION_EXPORTED", 25.5, {
        object: ref("NOTIFICATION", N),
        payload: { format: "EML" },
      }),
    );
    evOf(ctx, "evt-n-06").causation_id = "evt-n-08";
    violation("INV-09", ctx, /evt-n-06 DELIVERY_CONFIRMED is caused by the export evt-n-08/);
  });
});

describe("INV-10 delivery ≠ acknowledgement", () => {
  test("INV-10 pass: acknowledgement recorded by the recipient in the recipient capacity; its evidence entry cites it", () =>
    pass("INV-10", baseline()));
  test("INV-10 violation: acknowledgement recorded by the system, not by the recipient", () => {
    const ctx = baseline();
    evOf(ctx, "evt-n-07").actor = { ...SYSTEM };
    violation("INV-10", ctx, /not by the recipient usr-member-01/);
  });
  test("INV-10 violation: acknowledgement claimed from DELIVERY_CONFIRMED (FI-09)", () => {
    const ctx = baseline();
    addStatement(ctx, {
      id: "sa",
      about: ref("NOTIFICATION", N),
      asserts_event: "RECIPIENT_ACKNOWLEDGED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-n-06",
      source: { kind: "EVENT", event_id: "evt-n-06" },
    });
    violation("INV-10", ctx, /FI-09/);
  });
  test("INV-10 violation: ACKNOWLEDGED used as a notification status; DELIVERED as an attempt status (evidence entry and record)", () => {
    const ctx = baseline();
    ctx.notification.status = "ACKNOWLEDGED";
    attemptEntries(ctx)[1]!.data.status = "DELIVERED";
    const r = violation("INV-10", ctx, /acknowledgement is an event/);
    assert.match(r.detail, /evidence evd-demo-03: attempt status DELIVERED is not a DeliveryStatus/);
    const ctx2 = legacyAttempt(baseline());
    ctx2.delivery_attempts[0]!.status = "DELIVERED";
    violation("INV-10", ctx2, /attempt \S+ status DELIVERED is not a DeliveryStatus/);
  });
  test("INV-10 violation: an ACKNOWLEDGEMENT evidence entry that cites no recorded acknowledgement", () => {
    const ctx = baseline();
    ctx.evidence.find((x) => x.kind === "ACKNOWLEDGEMENT")!.data.event_id = "evt-n-06";
    violation(
      "INV-10",
      ctx,
      /evidence evd-demo-04: ACKNOWLEDGEMENT without a recorded RECIPIENT_ACKNOWLEDGED event \(cites evt-n-06\)/,
    );
  });
});

describe("INV-11 expected ≠ completed", () => {
  // A «votes counted» step after lead ruling L-11: NO_DECISION is a recorded ballot outcome; NO_QUORUM fails the step.
  const countedStep = () => ({
    kind: "STEP",
    alternative_group: null,
    trigger_event_type: "BALLOT_OPENED",
    completion_event_type: "BALLOT_CLOSED",
    completion_payload: { result: ["APPROVED", "REJECTED", "TIED"] },
    completion_any_of: [
      { type: "BALLOT_CLOSED", payload: { result: ["APPROVED", "REJECTED", "TIED"] } },
      { type: "BALLOT_CLOSED", payload: { result: "NO_DECISION" } },
    ],
    fail_on: { type: "BALLOT_CLOSED", payload: { result: "NO_QUORUM" } },
  });
  const taskClosure = (target: ObjectRef | string): Fixture => {
    const ctx = baseline();
    ctx.catalogue.steps["J-DEMO-TASK/3/1"] = {
      kind: "STEP",
      alternative_group: null,
      trigger_event_type: null,
      completion_event_type: "PROCEDURE_COMPLETED",
      completion_target: "SELF",
    };
    addEvent(
      ctx,
      E("evt-p-05", "PROCEDURE_COMPLETED", 30, { object: ref("PROCEDURE", P), payload: { target } }),
    );
    objOf(ctx, T).steps = [
      {
        step_id: "J-DEMO-TASK/3/1",
        actual: "COMPLETED",
        evidence_event_id: "evt-p-05",
        epistemic: "RECORDED_FACT",
      },
    ];
    return ctx;
  };
  test("INV-11 pass: completed steps cite their completion events; Expected Process carries ◇ only", () =>
    pass("INV-11", baseline()));
  test("INV-11 pass: a step completes on any one listed pattern (completion_any_of, L-05); a NO_DECISION closure counts the votes (L-11)", () => {
    const ctx = baseline();
    ctx.catalogue.steps["J-DEMO-COMMITTEE/2/1"] = countedStep();
    pass("INV-11", ctx);
    evOf(ctx, "evt-b-02").payload.result = "NO_DECISION";
    pass("INV-11", ctx);
  });
  test("INV-11 pass: a closure step (completion_target SELF) completed by PROCEDURE_COMPLETED naming the task as payload.target (L-10 item 5)", () => {
    pass("INV-11", taskClosure(ref("TASK", T)));
    pass("INV-11", taskClosure(T)); // the bare-id convention of payload.target
  });
  test("INV-11 pass: a step IN_PROGRESS on any one listed trigger (trigger_any_of)", () => {
    const ctx = baseline();
    ctx.catalogue.steps["J-DEMO-COMMITTEE/2/1"] = {
      ...ctx.catalogue.steps["J-DEMO-COMMITTEE/2/1"],
      trigger_any_of: [
        { type: "MEETING_OPENED", payload: null },
        { type: "BALLOT_OPENED", payload: null },
      ],
    };
    Object.assign(objOf(ctx, B).steps[0]!, { actual: "IN_PROGRESS", evidence_event_id: "evt-b-01" });
    pass("INV-11", ctx);
  });
  test("INV-11 violation: step COMPLETED without an evidence event", () => {
    const ctx = baseline();
    objOf(ctx, P).steps[2]!.evidence_event_id = null;
    violation("INV-11", ctx, /COMPLETED without a recorded evidence event/);
  });
  test("INV-11 violation: step COMPLETED by its trigger event, not its completion event", () => {
    const ctx = baseline();
    objOf(ctx, B).steps[0]!.evidence_event_id = "evt-b-01";
    violation("INV-11", ctx, /is BALLOT_OPENED, not BALLOT_CLOSED/);
  });
  test("INV-11 violation: evidence that matches no listed pattern and matches the step's fail_on (NO_QUORUM)", () => {
    const ctx = baseline();
    ctx.catalogue.steps["J-DEMO-COMMITTEE/2/1"] = countedStep();
    evOf(ctx, "evt-b-02").payload.result = "NO_QUORUM";
    const r = violation(
      "INV-11",
      ctx,
      /evidence evt-b-02 BALLOT_CLOSED payload \{"result":"NO_QUORUM"\} matches no completion pattern of the step/,
    );
    assert.match(r.detail, /matches the step's fail_on \{"result":"NO_QUORUM"\}: never its completion/);
  });
  test("INV-11 violation: a NO_DECISION closure never completes an adoption step (L-11)", () => {
    const ctx = baseline();
    evOf(ctx, "evt-b-02").payload.result = "NO_DECISION";
    ctx.catalogue.steps["J-DEMO-COMMITTEE/2/3"] = {
      kind: "STEP",
      alternative_group: null,
      trigger_event_type: null,
      completion_event_type: "RECOMMENDATION_ADOPTED",
    };
    objOf(ctx, R).steps = [
      {
        step_id: "J-DEMO-COMMITTEE/2/3",
        actual: "COMPLETED",
        evidence_event_id: "evt-b-02",
        epistemic: "DERIVED_FROM_VERIFIED_FACTS",
      },
    ];
    violation("INV-11", ctx, /evidence evt-b-02 is BALLOT_CLOSED, not RECOMMENDATION_ADOPTED/);
  });
  test("INV-11 violation: the completion of another object never closes this path (completion_target SELF)", () => {
    const r = violation(
      "INV-11",
      taskClosure(ref("TASK", u(27))),
      /completes 00000000-0000-4000-8000-000000000027, not the object itself \(completion_target SELF\)/,
    );
    assert.match(r.detail, /belongs to neither the object, its related objects nor its case/);
  });
  test("INV-11 violation: Expected Process item with ✔ and completion wording «تم»", () => {
    const ctx = baseline();
    const b = ctx.progress.layer_b[0]!;
    b.symbol = "✔";
    b.text = { ar: "تم اتخاذ القرار", en: "Decision completed" };
    const r = violation("INV-11", ctx, /symbol ✔ instead of ◇/);
    assert.match(r.detail, /completion wording «تم»/);
  });
  test("INV-11 violation: expected statement and next-action what_next worded as done", () => {
    const ctx = baseline();
    stOf(ctx, "s5").text!.ar = "اكتمل قرار صاحب الصلاحية";
    ctx.notification.next_action.what_next[0]!.en = "The authority decision is recorded";
    const r = violation("INV-11", ctx, /s5: expected statement uses completion wording/);
    assert.match(r.detail, /what_next\[0\]: completion wording/);
  });
  test("INV-11 violation: step IN_PROGRESS without its trigger event", () => {
    const ctx = baseline();
    Object.assign(objOf(ctx, B).steps[0]!, { actual: "IN_PROGRESS", evidence_event_id: null });
    violation("INV-11", ctx, /IN_PROGRESS without its trigger event BALLOT_OPENED/);
  });
});

describe("INV-12 alternatives exclusive", () => {
  test("INV-12 pass: only the VOTE alternative is COMPLETED; siblings NOT_APPLICABLE", () =>
    pass("INV-12", baseline()));
  test("INV-12 violation: the MEETING alternative also COMPLETED by the VOTE direction", () => {
    const ctx = baseline();
    Object.assign(objOf(ctx, P).steps[0]!, {
      actual: "COMPLETED",
      evidence_event_id: "evt-p-03",
      epistemic: "DERIVED_FROM_VERIFIED_FACTS",
    });
    const r = violation("INV-12", ctx, /2 alternatives COMPLETED/);
    assert.match(r.detail, /one event completes several alternatives/);
    assert.match(r.detail, /does not select \{"direction":"MEETING"\}/);
  });
  test("INV-12 violation: Actual Progress shows the wrong alternative completed", () => {
    const ctx = baseline();
    ctx.progress.layer_a[1]!.step_id = "J-DEMO-DIRECTION/2/2";
    violation("INV-12", ctx, /does not select \{"direction":"INFO_REQUEST"\}/);
  });
});

describe("INV-13 notice presupposes a recorded decision", () => {
  const notice = (ctx: Fixture, h: number, id = "evt-d-02") =>
    addEvent(ctx, E(id, "DECISION_NOTICE_ISSUED", h, { object: ref("DECISION", D) }));
  test("INV-13 pass: DECISION_NOTICE_ISSUED after AUTHORITY_DECISION_RECORDED", () => {
    const ctx = baseline();
    decisionRecorded(ctx, 30);
    notice(ctx, 31);
    pass("INV-13", ctx);
  });
  test("INV-13 violation: notice issued without any recorded decision", () => {
    const ctx = baseline();
    notice(ctx, 31);
    violation("INV-13", ctx, /without an earlier recorded decision/);
  });
  test("INV-13 violation: notice issued before the decision was recorded", () => {
    const ctx = baseline();
    notice(ctx, 30);
    decisionRecorded(ctx, 31);
    violation("INV-13", ctx, /without an earlier recorded decision/);
  });
  test("INV-13 violation: RETURN_TO_COMMITTEE notified as a decision", () => {
    const ctx = baseline();
    decisionRecorded(ctx, 30, "RETURN_TO_COMMITTEE");
    notice(ctx, 31);
    addStatement(ctx, {
      id: "sn",
      about: ref("DECISION", D),
      asserts_event: "DECISION_NOTICE_ISSUED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-d-02",
      source: { kind: "EVENT", event_id: "evt-d-02" },
    });
    const r = violation("INV-13", ctx, /without an earlier recorded decision/);
    assert.match(r.detail, /sn: notice of decision/);
  });
});

describe("INV-14 cancelled never shown active", () => {
  const M3 = u(25);
  const cancelledMeeting = () => {
    const ctx = baseline();
    addEvent(ctx, E("evt-m3-01", "MEETING_SCHEDULED", 30, { object: ref("MEETING", M3) }));
    addEvent(ctx, E("evt-m3-02", "MEETING_CANCELLED", 31, { object: ref("MEETING", M3) }));
    ctx.objects.push({
      object_id: M3,
      type: "MEETING",
      case_id: CASE,
      status: "CANCELLED",
      status_source_event_id: "evt-m3-02",
      steps: [],
      deadlines: [],
    });
    return ctx;
  };
  test("INV-14 pass: a cancelled meeting shown as cancelled with a read-only next action", () => {
    const ctx = cancelledMeeting();
    addStatement(ctx, {
      id: "sm",
      about: ref("MEETING", M3),
      asserts_status: "CANCELLED",
      display_state: "CANCELLED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-m3-02",
      source: { kind: "EVENT", event_id: "evt-m3-02" },
    });
    ctx.notification.object = ref("MEETING", M3);
    pass("INV-14", ctx);
  });
  test("INV-14 violation: cancelled meeting presented as scheduled and pending, with an action on it", () => {
    const ctx = cancelledMeeting();
    addStatement(ctx, {
      id: "sm",
      about: ref("MEETING", M3),
      asserts_status: "SCHEDULED",
      display_state: "PENDING",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-m3-01",
      source: { kind: "EVENT", event_id: "evt-m3-01" },
    });
    ctx.notification.object = ref("MEETING", M3);
    ctx.notification.next_action.kind = "SUBMIT_STATEMENT";
    const r = violation("INV-14", ctx, /presents cancelled MEETING .* as SCHEDULED/);
    assert.match(r.detail, /next action SUBMIT_STATEMENT on cancelled MEETING/);
  });
  test("INV-14 violation: a required action on a cancelled case", () => {
    const ctx = baseline();
    ctx.case.flags.cancelled = true;
    ctx.notification.next_action.kind = "SUBMIT_STATEMENT";
    violation("INV-14", ctx, /on a cancelled case/);
  });
  test("INV-14 violation: dispatch events and an attempt entry after the notification was cancelled", () => {
    const ctx = baseline();
    ctx.notification.status = "CANCELLED";
    addEvent(ctx, E("evt-n-00", "NOTIFICATION_CANCELLED", 21.5, { object: ref("NOTIFICATION", N) }));
    const r = violation("INV-14", ctx, /after the cancellation evt-n-00/);
    assert.match(r.detail, /evidence evd-demo-02: delivery attempt 1 after the cancellation evt-n-00/);
  });
});

describe("INV-15 seven separate enums", () => {
  test("INV-15 pass: every object, the notification, the attempt entries and the case hold values of their own enums", () => {
    pass("INV-15", baseline());
    pass("INV-15", legacyAttempt(baseline()));
  });
  test("INV-15 violation: OVERDUE stored as a task status; ACKNOWLEDGED as a notification status", () => {
    const ctx = baseline();
    objOf(ctx, T).status = "OVERDUE";
    ctx.notification.status = "ACKNOWLEDGED";
    const r = violation("INV-15", ctx, /status OVERDUE is not a TaskStatus value/);
    assert.match(r.detail, /ACKNOWLEDGED is not a NotificationStatus value/);
  });
  test("INV-15 violation: a meeting asserted DECIDED (status vocabularies collapsed)", () => {
    const ctx = baseline();
    addStatement(ctx, {
      id: "sx",
      about: ref("MEETING", M),
      asserts_status: "DECIDED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-m-06",
      source: { kind: "EVENT", event_id: "evt-m-06" },
    });
    violation("INV-15", ctx, /DECIDED is not a MeetingStatus value/);
  });
  test("INV-15 violation: allegation with an invented status; unknown case flag; Layer A state outside the enum", () => {
    const ctx = baseline();
    ctx.objects.push({
      object_id: u(26),
      type: "ALLEGATION",
      case_id: CASE,
      status: "SUBSTANTIATED",
      status_source_event_id: null,
      steps: [],
      deadlines: [],
    });
    ctx.case.flags.archived = false;
    ctx.progress.layer_a[0]!.display_state = "DONE";
    const r = violation("INV-15", ctx, /no status object \(SOURCE_REQUIRED\)/);
    assert.match(r.detail, /case flag archived/);
    assert.match(r.detail, /DONE is not a Layer A state/);
  });
  test("INV-15 violation: an attempt evidence entry and an older version outside their enums", () => {
    const ctx = pendingCorrection();
    attemptEntries(ctx)[0]!.data.status = "OPENED";
    ctx.notification_versions[0]!.status = "ARCHIVED";
    const r = violation(
      "INV-15",
      ctx,
      /evidence evd-demo-02: attempt status OPENED is not a DeliveryStatus value/,
    );
    assert.match(r.detail, /notification \S+ v1: status ARCHIVED is not a NotificationStatus value/);
  });
});

describe("INV-16 each status rests on its own event", () => {
  test("INV-16 pass: every recorded status has a source event naming the object and leading into it", () => {
    pass("INV-16", baseline());
    pass("INV-16", legacyAttempt(baseline()));
  });
  test("INV-16 violation: task COMPLETED on the strength of its request (reminder) event", () => {
    const ctx = baseline();
    objOf(ctx, T).status = "COMPLETED";
    violation("INV-16", ctx, /STATEMENT_REQUESTED never leads TASK into COMPLETED/);
  });
  test("INV-16 violation: task status sourced from a notification event that does not name it", () => {
    const ctx = baseline();
    Object.assign(objOf(ctx, T), { status: "SUBMITTED", status_source_event_id: "evt-n-05" });
    violation("INV-16", ctx, /does not name TASK/);
  });
  test("INV-16 violation: case code sourced from DELIVERY_CONFIRMED; closed flag without CASE_CLOSED", () => {
    const ctx = baseline();
    ctx.case.status.source_event_id = "evt-n-06";
    const r = violation("INV-16", ctx, /DELIVERY_CONFIRMED, not one of/);
    const ctx2 = baseline();
    ctx2.case.flags.closed = true;
    violation("INV-16", ctx2, /flags\.closed = true without CASE_CLOSED/);
    assert.ok(r.violations.length >= 1);
  });
  test("INV-16 violation: an attempt record BOUNCED on the strength of its acceptance", () => {
    const ctx = legacyAttempt(baseline());
    ctx.delivery_attempts[0]!.status = "BOUNCED";
    violation(
      "INV-16",
      ctx,
      /attempt \S+: DELIVERY_ACCEPTED_BY_PROVIDER never leads DELIVERY_ATTEMPT into BOUNCED/,
    );
  });
});

describe("INV-17 recorded histories follow the tables (WARN)", () => {
  const F = u(18);
  // A referral returned by the sector head and resubmitted (work/LEAD_notes.md L-10): the head's approval of the
  // resubmission and the arrival at the secretariat are hold rows (they leave IN_PROGRESS unchanged).
  const referral = () => {
    const ctx = baseline();
    const rv = (id: string, type: string, h: number, payload: Payload = {}) =>
      addEvent(ctx, E(id, type, h, { object: ref("REFERRAL", F), payload }));
    rv("evt-f-01", "REFERRAL_CREATED", -8);
    rv("evt-f-02", "REFERRAL_SUBMITTED", -7);
    rv("evt-f-03", "REFERRAL_HEAD_DECIDED", -6, { decision: "RETURNED" });
    rv("evt-f-04", "REFERRAL_SUBMITTED", -5, { resubmission: true });
    rv("evt-f-05", "REFERRAL_HEAD_DECIDED", -4, { decision: "APPROVED" });
    rv("evt-f-06", "REFERRAL_RECEIVED", -3);
    rv("evt-f-07", "REFERRAL_ACCEPTED", -2);
    ctx.objects.push({
      object_id: F,
      type: "REFERRAL",
      case_id: CASE,
      status: "COMPLETED",
      status_source_event_id: "evt-f-07",
      steps: [],
      deadlines: [],
    });
    return ctx;
  };
  test("INV-17 pass: every recorded history follows its transition table and ends in the recorded status", () =>
    pass("INV-17", baseline()));
  test("INV-17 pass: a referral returned by the sector head and resubmitted (L-10 hold rows); each notification version folds on its own (L-04)", () => {
    const ctx = referral();
    pass("INV-17", ctx);
    allPass(ctx);
    pass("INV-17", corrected());
  });
  test("INV-17 violation: meeting closed without having been opened (WARN; checkAll stays ok)", () => {
    const ctx = dropEvents(baseline(), "evt-m-02");
    const r = violation("INV-17", ctx, /TRANSITION_NOT_ALLOWED \(SCHEDULED --MEETING_CLOSED-->\)/);
    assert.equal(r.severity, "WARN");
    const all = checkAll(ctx);
    assert.deepEqual(
      all.warnings.map((w) => w.id),
      ["INV-17"],
    );
    assert.equal(
      all.violations.some((v) => v.id === "INV-17"),
      false,
    );
  });
  test("INV-17 violation: case move S2.01 → S4.04 outside the 34 V8 transitions is flagged, not corrected", () => {
    const ctx = baseline();
    evOf(ctx, "evt-case-04").payload.from = "S2.01";
    violation("INV-17", ctx, /S2\.01→S4\.04 is not one of the 34 V8 transitions/);
  });
  test("INV-17 violation: events end in another status than the record says", () => {
    const ctx = baseline();
    addEvent(ctx, E("evt-t-02", "STATEMENT_RECEIVED", 30, { object: ref("TASK", T) }));
    violation("INV-17", ctx, /events end in SUBMITTED, record says ASSIGNED/);
  });
  test("INV-17 violation: a referral resubmitted without a return (L-10: the from-state identifies a resubmission)", () => {
    const ctx = dropEvents(referral(), "evt-f-03");
    violation(
      "INV-17",
      ctx,
      /REFERRAL \S+: evt-f-04: TRANSITION_NOT_ALLOWED \(OPEN --REFERRAL_SUBMITTED-->\)/,
    );
  });
  test("INV-17 violation: a correcting version that skips its validation", () => {
    const ctx = dropEvents(corrected(), "evt-n2-02");
    violation(
      "INV-17",
      ctx,
      /NOTIFICATION \S+ v2: evt-n2-03: TRANSITION_NOT_ALLOWED \(CORRECTED --NOTIFICATION_AUTHORIZED-->\)/,
    );
  });
});

describe("INV-18 every statement classed", () => {
  test("INV-18 pass: statements, both layers, steps and the next action carry fitting classes", () =>
    pass("INV-18", baseline()));
  test("INV-18 violation: a statement without an epistemic class", () => {
    const ctx = baseline();
    delete stOf(ctx, "s5").epistemic;
    violation("INV-18", ctx, /s5: epistemic undefined is not a class/);
  });
  test("INV-18 violation: Expected Process item claiming RECORDED_FACT; next action claiming RECORDED_FACT", () => {
    const ctx = baseline();
    ctx.progress.layer_b[0]!.epistemic = "RECORDED_FACT";
    ctx.notification.next_action.epistemic = "RECORDED_FACT";
    const r = violation("INV-18", ctx, /Expected Process J-DEMO-COMMITTEE\/3\/1: epistemic RECORDED_FACT/);
    assert.match(r.detail, /next_action epistemic RECORDED_FACT ≠ PROPOSED_ACTION/);
  });
  test("INV-18 violation: display state and class do not match (COMPLETED shown as an expectation)", () => {
    const ctx = baseline();
    stOf(ctx, "s5").display_state = "COMPLETED";
    violation("INV-18", ctx, /COMPLETED cannot carry EXPECTED_PROCESS/);
  });
});

describe("INV-19 certainty ceiling", () => {
  test("INV-19 pass: no statement claims more certainty than its source", () => pass("INV-19", baseline()));
  test("INV-19 violation: a notification used as the source of a recorded fact", () => {
    const ctx = baseline();
    stOf(ctx, "s4").source = { kind: "NOTIFICATION" };
    violation("INV-19", ctx, /s4: RECORDED_FACT exceeds its ceiling UNVERIFIED_INFORMATION/);
  });
  test("INV-19 violation: evidence entered manually cannot support a recorded fact", () => {
    const ctx = baseline();
    evOf(ctx, "evt-r-02").provenance.source = "MANUAL_ENTRY";
    violation("INV-19", ctx, /s1: RECORDED_FACT exceeds its ceiling UNVERIFIED_INFORMATION/);
  });
  test("INV-19 violation: an unsupported claim is unverified whatever its source kind", () => {
    const ctx = baseline();
    stOf(ctx, "s4").evidence_event_id = "evt-r-01";
    violation("INV-19", ctx, /claim unsupported/);
  });
});

describe("INV-20 deadlines have a recorded basis", () => {
  const shown = (ctx: Fixture, d: Partial<DeadlineRecord>): Fixture => {
    ctx.notification.deadlines = [
      {
        kind: "STATEMENT_DUE",
        at: "2026-10-28T09:00:00Z",
        basis_event_id: "evt-t-01",
        basis_rule: "SYNTHETIC-RULE-01",
        ...d,
      },
    ];
    return ctx;
  };
  test("INV-20 pass: displayed deadline with a recorded basis event and the rule triggered by it", () =>
    pass("INV-20", shown(baseline(), {})));
  test("INV-20 violation: a SOURCE_REQUIRED deadline displayed", () =>
    violation(
      "INV-20",
      shown(baseline(), { basis_rule: "SOURCE_REQUIRED" }),
      /SOURCE_REQUIRED deadline is never displayed/,
    ));
  test("INV-20 violation: basis event is not the rule trigger", () =>
    violation(
      "INV-20",
      shown(baseline(), { basis_event_id: "evt-m-01" }),
      /basis MEETING_SCHEDULED is not the trigger STATEMENT_REQUESTED/,
    ));
  test("INV-20 violation: invented rule id and unrecorded basis event", () => {
    violation("INV-20", shown(baseline(), { basis_rule: "DEC-F99" }), /not in the rule set/);
    violation(
      "INV-20",
      shown(baseline(), { basis_event_id: "evt-none" }),
      /basis event evt-none not recorded/,
    );
  });
  test("INV-20 violation: next-action deadline without a basis", () => {
    const ctx = baseline();
    ctx.notification.next_action.deadline = {
      at: "2026-10-28T09:00:00Z",
      basis_event_id: null,
      basis_rule: null,
    };
    violation("INV-20", ctx, /next_action\.deadline: basis event null not recorded/);
  });
  test("INV-20 violation: a deadline whose basis event was entered by hand (an assumed event, directive :374)", () => {
    const ctx = shown(baseline(), {});
    evOf(ctx, "evt-t-01").provenance.source = "MANUAL_ENTRY";
    violation(
      "INV-20",
      ctx,
      /basis evt-t-01 has provenance MANUAL_ENTRY, not a verified record: a deadline never starts from an assumed event/,
    );
  });
});

describe("INV-21 event integrity", () => {
  test("INV-21 pass: 26 baseline events are well-formed", () => {
    const r = pass("INV-21", baseline());
    assert.match(r.detail, /^26 events/);
  });
  test("INV-21 violation: duplicate id and unknown event type (MEETING_HELD)", () => {
    const ctx = baseline();
    addEvent(ctx, { ...evOf(ctx, "evt-m-02") });
    addEvent(ctx, E("evt-m-09", "MEETING_HELD", 30, { object: ref("MEETING", M) }));
    const r = violation("INV-21", ctx, /evt-m-02: duplicate event_id/);
    assert.match(r.detail, /unknown type MEETING_HELD/);
  });
  test("INV-21 violation: the retired type REFERRAL_RESUBMITTED (L-10: a resubmission is REFERRAL_SUBMITTED)", () => {
    const ctx = baseline();
    addEvent(ctx, E("evt-f-09", "REFERRAL_RESUBMITTED", -1, { object: ref("REFERRAL", u(18)) }));
    violation("INV-21", ctx, /evt-f-09: unknown type REFERRAL_RESUBMITTED/);
  });
  test("INV-21 violation: recorded before occurred; caused by a later event", () => {
    const ctx = baseline();
    evOf(ctx, "evt-m-01").recorded_at = at(2);
    evOf(ctx, "evt-p-01").causation_id = "evt-p-02";
    const r = violation("INV-21", ctx, /evt-m-01: recorded_at before occurred_at/);
    assert.match(r.detail, /evt-p-01: caused by a later event evt-p-02/);
  });
  test("INV-21 violation: NOTIFICATION_SENT naming a MEETING; case event without case_id; missing provenance and correlation", () => {
    const ctx = baseline();
    evOf(ctx, "evt-n-05").object = ref("MEETING", M);
    evOf(ctx, "evt-case-03").case_id = null;
    evOf(ctx, "evt-r-01").provenance = { source: "SPREADSHEET", ref: "x" };
    delete evOf(ctx, "evt-r-02").correlation_id;
    const r = violation("INV-21", ctx, /NOTIFICATION_SENT cannot name a MEETING/);
    assert.match(r.detail, /evt-case-03: case event without case_id/);
    assert.match(r.detail, /evt-r-01: provenance SPREADSHEET/);
    assert.match(r.detail, /evt-r-02: correlation_id missing/);
  });
});

describe("INV-22 delivery evidence chain (L-07: ACCEPTANCE by default; L-02: in-app)", () => {
  const senderOnly = () => {
    // the sender reported success; no provider delivery report exists
    const ctx = dropEvents(baseline(), "evt-n-06");
    Object.assign(ctx.notification, { status: "SENT", status_source_event_id: "evt-n-05" });
    return ctx;
  };
  const inApp = () => {
    // W-D1: the committed inbox row is one attempt entry ACCEPTED_BY_PROVIDER (attempt 0)
    const ctx = baseline();
    ctx.notification.channel = "IN_APP";
    ctx.evidence = ctx.evidence.filter((x) => x.kind !== "DELIVERY_ATTEMPT");
    ctx.evidence.push(
      evd(5, "DELIVERY_ATTEMPT", 23, {
        attempt: 0,
        status: "ACCEPTED_BY_PROVIDER",
        provider: "IN_APP_OUTBOX_ROW",
        outbox_status: "SENT",
        at: at(23, 5),
      }),
    );
    Object.assign(evOf(ctx, "evt-n-06").payload, { channel: "IN_APP", evidence_kind: "IN_APP_ROW_CREATED" });
    return ctx;
  };
  test("INV-22 pass: e-mail under ACCEPTANCE (the default): queued → attempt entries → accepted by provider → provider delivery report", () => {
    const ctx = baseline();
    assert.equal(ctx.delivery_confirmation, undefined, "the baseline names no mode, so ACCEPTANCE applies");
    pass("INV-22", ctx);
    ctx.delivery_confirmation = "ACCEPTANCE";
    pass("INV-22", ctx);
  });
  test("INV-22 pass: a sender success alone leaves the e-mail SENT («أُرسل — لم يُؤكَّد التسليم», L-08)", () => {
    const ctx = senderOnly();
    pass("INV-22", ctx);
    allPass(ctx);
  });
  test("INV-22 pass: under the explicit SETTLEMENT configuration the sender adapter's success confirms delivery", () => {
    const ctx = baseline();
    ctx.delivery_confirmation = "SETTLEMENT";
    evOf(ctx, "evt-n-06").payload.evidence_kind = "SENDER_ADAPTER_REPORTED_SUCCESS";
    pass("INV-22", ctx);
  });
  test("INV-22 pass: in-app — the committed inbox row is the delivery (L-02)", () => {
    const ctx = inApp();
    pass("INV-22", ctx);
    allPass(ctx);
  });
  test("INV-22 violation: under ACCEPTANCE a sender success is not delivery evidence", () => {
    const ctx = baseline();
    evOf(ctx, "evt-n-06").payload.evidence_kind = "SENDER_ADAPTER_REPORTED_SUCCESS";
    violation(
      "INV-22",
      ctx,
      /EMAIL DELIVERY_CONFIRMED with evidence_kind SENDER_ADAPTER_REPORTED_SUCCESS; under ACCEPTANCE it needs PROVIDER_DELIVERY_REPORT \(L-07\): a sender success alone leaves the notification SENT/,
    );
  });
  test("INV-22 violation: DELIVERY_CONFIRMED without an evidence kind; an unknown confirmation mode", () => {
    const ctx = baseline();
    delete evOf(ctx, "evt-n-06").payload.evidence_kind;
    violation("INV-22", ctx, /evidence_kind null; under ACCEPTANCE it needs PROVIDER_DELIVERY_REPORT/);
    const ctx2 = baseline();
    ctx2.delivery_confirmation = "OPTIMISTIC";
    violation(
      "INV-22",
      ctx2,
      /delivery_confirmation OPTIMISTIC is not one of ACCEPTANCE, SETTLEMENT \(L-07\)/,
    );
  });
  test("INV-22 violation: in-app delivery confirmed with an e-mail evidence kind, or without the inbox row", () => {
    const ctx = inApp();
    evOf(ctx, "evt-n-06").payload.evidence_kind = "PROVIDER_DELIVERY_REPORT";
    violation(
      "INV-22",
      ctx,
      /IN_APP DELIVERY_CONFIRMED with evidence_kind PROVIDER_DELIVERY_REPORT; in-app delivery is the inbox row/,
    );
    const ctx2 = inApp();
    delete evOf(ctx2, "evt-n-06").payload.evidence_kind;
    ctx2.evidence = ctx2.evidence.filter((x) => x.kind !== "DELIVERY_ATTEMPT");
    const r = violation("INV-22", ctx2, /IN_APP DELIVERY_CONFIRMED without the inbox row/);
    assert.match(r.detail, /without any delivery attempt/);
  });
  test("INV-22 violation: DELIVERY_CONFIRMED without any delivery attempt (none, or only another version's)", () => {
    const ctx = baseline();
    ctx.evidence = ctx.evidence.filter((x) => x.kind !== "DELIVERY_ATTEMPT");
    const r = violation("INV-22", ctx, /DELIVERY_CONFIRMED without any delivery attempt/);
    assert.match(r.detail, /without an attempt ACCEPTED_BY_PROVIDER/);
    const ctx2 = baseline();
    for (const x of attemptEntries(ctx2)) x.version = 2;
    violation("INV-22", ctx2, /DELIVERY_CONFIRMED without any delivery attempt/);
  });
  test("INV-22 violation: an attempt entry recorded before the notification was queued", () => {
    const ctx = baseline();
    attemptEntries(ctx)[0]!.data.at = at(21, 30);
    violation(
      "INV-22",
      ctx,
      /evidence evd-demo-02: delivery attempt 1 \(ATTEMPTED\) before NOTIFICATION_QUEUED/,
    );
  });
  test("INV-22 violation: delivery confirmed while the only attempt failed", () => {
    const ctx = baseline();
    attemptEntries(ctx)[1]!.data.status = "FAILED";
    violation("INV-22", ctx, /without an attempt ACCEPTED_BY_PROVIDER/);
  });
  test("INV-22 violation: DELIVERY_FAILED while the latest attempt was accepted by the provider", () => {
    const ctx = baseline();
    Object.assign(evOf(ctx, "evt-n-06"), {
      type: "DELIVERY_FAILED",
      payload: { channel: "EMAIL", evidence_kind: "OUTBOX_ATTEMPTS_EXHAUSTED" },
    });
    ctx.notification.status = "DELIVERY_FAILED";
    violation("INV-22", ctx, /DELIVERY_FAILED while the latest attempt is ACCEPTED_BY_PROVIDER/);
  });
  test("INV-22 violation: a notification not yet queued already has attempts", () => {
    const ctx = baseline();
    Object.assign(ctx.notification, { status: "AUTHORIZED", status_source_event_id: "evt-n-03" });
    violation("INV-22", ctx, /notification AUTHORIZED already has delivery attempts/);
  });
  test("INV-22 violation (ledger shape): a DELIVERY_ATTEMPTED event before NOTIFICATION_QUEUED", () => {
    const ctx = legacyAttempt(baseline());
    Object.assign(evOf(ctx, "evt-a-01"), { occurred_at: at(21, 30), recorded_at: at(21, 31) });
    violation("INV-22", ctx, /evt-a-01: attempt before NOTIFICATION_QUEUED/);
  });
});

describe("INV-23 disclosure applied before rendering", () => {
  test("INV-23 pass: delivered notification carries _disclosure_applied = true; a DRAFT needs none yet", () => {
    pass("INV-23", baseline());
    const ctx = baseline();
    Object.assign(ctx.notification, { status: "DRAFT", _disclosure_applied: false });
    pass("INV-23", ctx);
  });
  test("INV-23 pass: a correcting version that has just entered in CORRECTED is not validated yet (L-04)", () =>
    pass("INV-23", pendingCorrection()));
  test("INV-23 violation: VALIDATED or later without the disclosure projection", () => {
    const ctx = baseline();
    ctx.notification._disclosure_applied = false;
    violation("INV-23", ctx, /DELIVERY_CONFIRMED with _disclosure_applied = false/);
    const ctx2 = baseline();
    Object.assign(ctx2.notification, { status: "VALIDATED" });
    delete ctx2.notification._disclosure_applied;
    violation("INV-23", ctx2, /VALIDATED with _disclosure_applied = undefined/);
  });
});

describe("INV-24 corrections preserve history (L-04)", () => {
  test("INV-24 pass: v1 SUPERSEDED in the step its correction v2 was SENT; v2 is current; the context satisfies all 27 invariants", () => {
    const ctx = corrected();
    pass("INV-24", ctx);
    allPass(ctx);
  });
  test("INV-24 pass: a correction in preparation (v2 CORRECTED) leaves v1 current", () => {
    const ctx = pendingCorrection();
    pass("INV-24", ctx);
    allPass(ctx);
  });
  test("INV-24 pass: a cancelled correction leaves the older version current (L-04 item 4)", () => {
    const ctx = pendingCorrection();
    addEvent(
      ctx,
      E("evt-n2-02", "NOTIFICATION_CANCELLED", 31, {
        object: ref("NOTIFICATION", N),
        version: 2,
        payload: { reason_code: "CORRECTION_WITHDRAWN" },
      }),
    );
    Object.assign(ctx.notification, { status: "CANCELLED", status_source_event_id: "evt-n2-02" });
    pass("INV-24", ctx);
    allPass(ctx);
  });
  test("INV-24 pass: without a version list only the version at hand is checked (partial; nothing is invented)", () => {
    const ctx = corrected();
    ctx.notification_versions = [];
    pass("INV-24", ctx);
  });
  test("INV-24 violation: v1 SUPERSEDED while its correction is still queued", () => {
    const ctx = dropEvents(corrected(), "evt-n2-05");
    Object.assign(ctx.notification, { status: "QUEUED", status_source_event_id: "evt-n2-04" });
    const r = violation("INV-24", ctx, /v1: SUPERSEDED before any version correcting it was SENT/);
    assert.match(r.detail, /SUPERSEDED versions but no current issued version/);
  });
  test("INV-24 violation: the older version left current after its correction was SENT", () => {
    const ctx = dropEvents(corrected(), "evt-n-09");
    Object.assign(ctx.notification_versions[0]!, {
      status: "DELIVERY_CONFIRMED",
      status_source_event_id: "evt-n-06",
    });
    const r = violation("INV-24", ctx, /v1: still DELIVERY_CONFIRMED although its correction v2 was SENT/);
    assert.match(r.detail, /2 issued versions \(v1, v2\); a lineage has one current version/);
  });
  test("INV-24 violation: SUPERSEDED recorded before the correcting version was SENT", () => {
    const ctx = corrected();
    Object.assign(evOf(ctx, "evt-n-09"), {
      causation_id: null,
      occurred_at: at(33, 30),
      recorded_at: at(33, 31),
    });
    violation(
      "INV-24",
      ctx,
      /evt-n-09: v1 SUPERSEDED \(\S+\) before v2 was SENT \(\S+\); both happen in one step/,
    );
  });
  test("INV-24 violation: successor version not greater than the version", () => {
    const ctx = corrected();
    evOf(ctx, "evt-n-09").payload.successor_version = 1;
    violation("INV-24", ctx, /evt-n-09: successor_version 1 must exceed version 1/);
  });
  test("INV-24 violation: duplicate version numbers (an issued version edited in place)", () => {
    const ctx = corrected();
    ctx.notification_versions[1]!.version = 1;
    violation("INV-24", ctx, /duplicate version numbers/);
  });
  test("INV-24 violation: a correcting version drafted instead of entering in CORRECTED; a correction without a reason", () => {
    const ctx = corrected();
    evOf(ctx, "evt-n2-01").type = "NOTIFICATION_DRAFTED";
    ctx.notification.corrects = { version: 1 };
    const r = violation("INV-24", ctx, /v2: no NOTIFICATION_CORRECTED entry event/);
    assert.match(
      r.detail,
      /v2: a correcting version enters in CORRECTED, never through NOTIFICATION_DRAFTED/,
    );
    assert.match(r.detail, /v2: correction without a reason code/);
    const ctx2 = pendingCorrection();
    ctx2.notification.status = "DRAFT";
    violation("INV-24", ctx2, /v2: DRAFT — a correcting version enters in CORRECTED/);
  });
  test("INV-24 violation: a correction of a version that was never issued; two corrections pending at once", () => {
    const ctx = pendingCorrection();
    ctx.notification_versions[0]!.status = "QUEUED";
    violation(
      "INV-24",
      ctx,
      /v2: corrects v1 in QUEUED; only an issued version \(SENT, DELIVERY_CONFIRMED, DELIVERY_FAILED\) is corrected/,
    );
    const ctx2 = pendingCorrection();
    addPendingV3(ctx2, 1);
    violation("INV-24", ctx2, /2 corrections pending at once \(v2, v3\); at most one/);
  });
  test("INV-24 violation: a pending correction of a version that is no longer current", () => {
    const ctx = corrected();
    addPendingV3(ctx, 1);
    violation("INV-24", ctx, /v3: a pending correction must correct the current version v2/);
  });
  test("INV-24 violation: retries of the corrected version after its correction was created (L-04 item 3)", () => {
    const ctx = corrected();
    ctx.evidence.push(
      evd(7, "DELIVERY_ATTEMPT", 31, {
        attempt: 2,
        status: "ATTEMPTED",
        outbox_row_id: "obx-demo-0001",
        at: at(31),
      }),
    );
    violation(
      "INV-24",
      ctx,
      /v1: 1 delivery attempt\(s\) after its correction v2 was created; pending retries are suppressed \(L-04 item 3\)/,
    );
  });
  test("INV-24 violation: a cancelled correction keeps the suppressed retries suppressed (work/LEAD_notes.md L-08: no automatic re-send)", () => {
    const ctx = pendingCorrection();
    addEvent(
      ctx,
      E("evt-n2-02", "NOTIFICATION_CANCELLED", 31, {
        object: ref("NOTIFICATION", N),
        version: 2,
        payload: { reason_code: "CORRECTION_WITHDRAWN" },
      }),
    );
    Object.assign(ctx.notification, { status: "CANCELLED", status_source_event_id: "evt-n2-02" });
    ctx.evidence.push(
      evd(7, "DELIVERY_ATTEMPT", 32, {
        attempt: 2,
        status: "ATTEMPTED",
        outbox_row_id: "obx-demo-0001",
        at: at(32),
      }),
    );
    violation(
      "INV-24",
      ctx,
      /v1: 1 delivery attempt\(s\) after its correction v2 was created; pending retries are suppressed/,
    );
  });
});

describe("INV-25 attribution from the record", () => {
  test("INV-25 pass: adoption attributed to the committee (performed_by), opinion to the legal reviewer", () =>
    pass("INV-25", baseline()));
  test("INV-25 violation: adoption attributed to the secretary who recorded it", () => {
    const ctx = baseline();
    stOf(ctx, "s1").actor_capacity = "SECRETARY";
    violation("INV-25", ctx, /attributes RECOMMENDATION_ADOPTED to SECRETARY; the record says COMMITTEE/);
  });
  test("INV-25 violation: an on-behalf event without performed_by cannot be attributed", () => {
    const ctx = baseline();
    delete evOf(ctx, "evt-r-02").payload.performed_by;
    violation("INV-25", ctx, /records no performed_by; the recorder SECRETARY is not the maker/);
  });
  test("INV-25 violation: an act attributed without a recorded event", () => {
    const ctx = baseline();
    stOf(ctx, "s6").evidence_event_id = null;
    violation("INV-25", ctx, /attributes an act to LEGAL_REVIEWER without a recorded event/);
  });
});

describe("INV-26 synthetic data only", () => {
  test("INV-26 pass: @example.test addresses, example.test links and DEMO case references only", () =>
    pass("INV-26", baseline()));
  test("INV-26 violation: an e-mail outside example.test", () => {
    const ctx = baseline();
    ctx.notification.recipient.email = "member@example.com";
    violation("INV-26", ctx, /e-mail member@example\.com is not @example\.test/);
  });
  test("INV-26 violation: a non-DEMO case reference and a link outside example.test", () => {
    const ctx = baseline();
    ctx.notification.internal_ref = "CDF-ZZ-0000-0000"; // fictitious non-DEMO shape (never a real reference)
    ctx.notification.links.push("https://portal.example.com/case");
    const r = violation("INV-26", ctx, /CDF-ZZ-0000-0000 is not a DEMO reference/);
    assert.match(r.detail, /URL host portal\.example\.com is not example\.test/);
  });
});

describe("INV-27 protected events stay out of notifications (L-06)", () => {
  const G = u(41);
  const revealed = () => {
    const ctx = baseline();
    addEvent(
      ctx,
      E("evt-g-01", "REPORTER_IDENTITY_REVEALED", 18.5, {
        object: ref("REPORT", G),
        payload: { reveal_request_id: "rvr-demo-0001" },
        actor: { capacity: "CASE_OWNER", id: "usr-owner-01" },
      }),
    );
    addEvent(
      ctx,
      E("evt-b-03", "VOTE_CAST", 7.5, {
        object: ref("BALLOT", B),
        payload: { participant_id: "prt-demo-01" },
        actor: { capacity: "MEMBER", id: "usr-member-01" },
      }),
    );
    return ctx;
  };
  test("INV-27 pass: an identity reveal recorded ids-only and a vote cast without its choice; the notification names neither", () =>
    pass("INV-27", revealed()));
  test("INV-27 violation: the identity reveal carries more than its request id", () => {
    const ctx = revealed();
    evOf(ctx, "evt-g-01").payload.reporter_alias = "Witness Gamma";
    violation(
      "INV-27",
      ctx,
      /evt-g-01 REPORTER_IDENTITY_REVEALED: payload key reporter_alias \(only reveal_request_id\)/,
    );
  });
  test("INV-27 violation: a vote event carries the choice; a conflict decision carries its grounds", () => {
    const ctx = revealed();
    evOf(ctx, "evt-b-03").payload.choice = "APPROVE";
    addEvent(
      ctx,
      E("evt-m-07", "COI_DECIDED", 3.5, {
        object: ref("MEETING", M),
        payload: { participant_id: "prt-demo-02", outcome: "RECUSED", reason: "SYNTHETIC grounds" },
      }),
    );
    const r = violation("INV-27", ctx, /evt-b-03 VOTE_CAST: payload carries choice/);
    assert.match(r.detail, /evt-m-07 COI_DECIDED: payload carries reason/);
  });
  test("INV-27 violation: a notification cites, asserts, originates in and names the identity reveal", () => {
    const ctx = revealed();
    addStatement(ctx, {
      id: "s7",
      about: ref("REPORT", G),
      asserts_event: "REPORTER_IDENTITY_REVEALED",
      epistemic: "RECORDED_FACT",
      evidence_event_id: "evt-g-01",
      source: { kind: "EVENT", event_id: "evt-g-01" },
      text: { ar: "كُشفت الهوية", en: "Identity revealed" },
    });
    ctx.notification.originating_event_id = "evt-g-01";
    const r = violation("INV-27", ctx, /s7: cites the protected event evt-g-01/);
    for (const re of [
      /s7: asserts REPORTER_IDENTITY_REVEALED/,
      /the notification originates in the protected event evt-g-01/,
      /notification\.originating_event_id: names evt-g-01/,
    ])
      assert.match(r.detail, re);
  });
  test("INV-27 violation: a notification event follows from the identity reveal; the issuance context records it as the origin", () => {
    const ctx = revealed();
    evOf(ctx, "evt-n-01").causation_id = "evt-g-01";
    ctx.evidence.find((x) => x.kind === "ISSUANCE_CONTEXT")!.data.originating_event_id = "evt-g-01";
    const r = violation(
      "INV-27",
      ctx,
      /evt-n-01 NOTIFICATION_DRAFTED follows from the protected event evt-g-01 REPORTER_IDENTITY_REVEALED/,
    );
    assert.match(
      r.detail,
      /evidence evd-demo-01: issuance context originates in the protected event evt-g-01/,
    );
  });
});
