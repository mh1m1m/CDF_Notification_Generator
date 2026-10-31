// LC — notification lifecycle (charter §9; directive §13). Author: W-D1.
// State machine, gates, idempotency, retry, ordering, correction, cancellation, evidence, acknowledgement, export and the
// mirrored notify.* behaviour. All adapters are mocks (PRODUCTION_SUBSTITUTION_REQUIRED). Synthetic data only.
import { test, describe, type TestContext } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as F from "./support/fixtures";
import {
  NOTIFICATION_STATUSES,
  ALLOWED_TRANSITIONS,
  LINEAGE_TRANSITIONS,
  ISSUED_STATUSES,
  TRANSITION_EVENT_TYPES,
  CHARTER_NOTIFICATION_EVENT_TYPES,
  PROPOSED_EVENT_TYPES,
  AUDIT_ONLY_ACTIONS,
  DELIVERY_CONFIRMATION_MODES,
  LifecycleError,
  canTransition,
  canCorrect,
  isTerminal,
  createNotificationLifecycle,
} from "@/lib/notifications/lifecycle/notification";
import {
  idempotencyKey,
  createRetryPolicy,
  RETRY_POLICY,
  orderEvents,
  compareEvents,
  latestEvent,
  parseInstant,
  recordedNotBeforeOccurred,
  OrderingError,
  PLATFORM_OUTBOX_MAX_ATTEMPTS,
} from "@/lib/notifications/lifecycle/idempotency";
import { createEvidenceStore, EVIDENCE_KINDS } from "@/lib/notifications/lifecycle/evidence";
import { verifyEntries } from "./fakes/auditLedger";
import { RULES } from "@/lib/notifications/consistency/engine";
import * as domainStatus from "@/lib/domain/status";
import * as domainConcepts from "@/lib/domain/concepts";
import type {
  NotificationRecord,
  NotificationStatus,
  TransitionResult,
} from "@/lib/notifications/lifecycle/notification";
import type { DeepReadonly } from "@/lib/notifications/lifecycle/util";

type W = F.World;
type Rec = DeepReadonly<NotificationRecord>;
/** One step of the drivers below: a transition result, or (SUPERSEDED) the superseded predecessor with the successor. */
type Step = Omit<DeepReadonly<TransitionResult>, "warnings"> & {
  readonly warnings?: DeepReadonly<TransitionResult>["warnings"];
  readonly successor?: Rec;
};
/** Test view of LifecycleError.details (codes and ids only). */
interface ErrDetails {
  readonly violations: readonly { readonly id: string; readonly detail: { readonly reason?: unknown } }[];
  readonly result?: unknown;
  readonly [key: string]: unknown;
}
const det = (e: unknown): ErrDetails => (e as LifecycleError).details as unknown as ErrDetails;

const SEC = F.SECRETARY_ACTOR;
const CHAIR = F.CHAIR_ACTOR;
const code = (c: string) => (err: unknown) => err instanceof LifecycleError && err.code === c;
const isDefence = (r: Rec) => r.type_code.startsWith("DEFENCE");
const modelFor = (r: Rec) =>
  F.projectedModel({ recipient_id: r.recipient.recipient_id, recipient_class: r.recipient.class });
const statementFor = (r: Rec) => (isDefence(r) ? F.DEFENCE_STATEMENT : F.INVITATION_STATEMENT);
/** Lead ruling L-07: ACCEPTANCE is the default; a test that confirms e-mail delivery on settlement says so explicitly. */
const SETTLEMENT = Object.freeze({ deliveryConfirmation: "SETTLEMENT" });
const VIA_EMAIL_CONFIRMATION: readonly string[] = Object.freeze([
  "DELIVERY_CONFIRMED",
  "CORRECTED",
  "SUPERSEDED",
]);

function failOut(w: W, rowId: string) {
  // the row is claimed; settle «not delivered» and re-claim until the platform marks it FAILED at attempts 5 (1920:609)
  for (let i = 0; i < 10; i += 1) {
    if (w.outbox.recordEmailDelivery(rowId, false) === "FAILED") return;
    w.outbox.claimEmailBatch(10);
  }
  throw new Error("row did not fail");
}

/** Performs `from → to` with the inputs that transition needs (adapter steps included). */
function perform(w: W, r: Rec, to: string): Step {
  const lc = w.lifecycle;
  switch (to) {
    case "VALIDATED":
      return lc.transition(r, to, { actor: SEC, model: modelFor(r), statement: statementFor(r) });
    case "AUTHORIZATION_PENDING":
    case "QUEUED":
      return lc.transition(r, to, { actor: SEC });
    case "AUTHORIZED":
      return lc.transition(r, to, { actor: r.status === "AUTHORIZATION_PENDING" ? CHAIR : SEC });
    case "SENT":
      w.outbox.claimEmailBatch(10);
      return lc.transition(r, to, {});
    case "DELIVERY_CONFIRMED":
      w.outbox.recordEmailDelivery(r.outbox!.row_id, true);
      return lc.transition(r, to, {});
    case "DELIVERY_FAILED":
      failOut(w, r.outbox!.row_id);
      return lc.transition(r, to, {});
    case "CORRECTED":
      return lc.transition(r, to, { actor: SEC, reason_code: "SYNTHETIC_CORRECTION" });
    case "CANCELLED":
      return lc.transition(r, to, { actor: SEC, reason_code: "SYNTHETIC_CANCELLATION" });
    case "SUPERSEDED": {
      // L-04 item 2: version n is superseded in the step in which its correcting version reaches SENT.
      const s = sendCorrection(w, perform(w, r, "CORRECTED").record);
      return { record: s.superseded!, events: s.events, successor: s.record };
    }
    default:
      throw new Error(`no driver for ${to}`);
  }
}

/** Drives a correcting version from CORRECTED to SENT; returns that step (record, events, superseded predecessor). */
function sendCorrection(w: W, c: Rec): Step {
  let v = perform(w, c, "VALIDATED").record;
  if (v.approval.required !== false) v = perform(w, v, "AUTHORIZATION_PENDING").record;
  v = perform(w, v, "AUTHORIZED").record;
  const q = perform(w, v, "QUEUED");
  return q.record.channel === "IN_APP" ? q : perform(w, q.record, "SENT");
}

/** A fresh world with one record in `state` (approval-required type when asked or when the state needs it). Paths
 * through an e-mail DELIVERY_CONFIRMED set SETTLEMENT explicitly (L-07). */
function reach(
  state: string,
  {
    approval = false,
    world = {},
    draft = {},
  }: { approval?: boolean; world?: F.WorldOptions; draft?: F.DraftOverrides } = {},
): { w: W; r: Rec } {
  const w = F.createWorld(
    VIA_EMAIL_CONFIRMATION.includes(state)
      ? { ...world, lifecycle: { ...SETTLEMENT, ...(world.lifecycle ?? {}) } }
      : world,
  );
  const lc = w.lifecycle;
  const useDefence = approval || state === "AUTHORIZATION_PENDING";
  let r = lc.draft(useDefence ? F.defenceNoticeDraft(draft) : F.invitationDraft(draft)).record;
  if (state === "DRAFT") return { w, r };
  if (state === "CANCELLED") return { w, r: perform(w, r, "CANCELLED").record };
  r = perform(w, r, "VALIDATED").record;
  if (state === "VALIDATED") return { w, r };
  if (useDefence) {
    r = perform(w, r, "AUTHORIZATION_PENDING").record;
    if (state === "AUTHORIZATION_PENDING") return { w, r };
  }
  r = perform(w, r, "AUTHORIZED").record;
  if (state === "AUTHORIZED") return { w, r };
  r = perform(w, r, "QUEUED").record;
  if (state === "QUEUED") return { w, r };
  r = perform(w, r, "SENT").record;
  if (state === "SENT") return { w, r };
  if (state === "DELIVERY_FAILED") return { w, r: perform(w, r, "DELIVERY_FAILED").record };
  r = perform(w, r, "DELIVERY_CONFIRMED").record;
  if (state === "DELIVERY_CONFIRMED") return { w, r };
  const c = perform(w, r, "CORRECTED");
  if (state === "CORRECTED") return { w, r: c.record };
  if (state === "SUPERSEDED") return { w, r: sendCorrection(w, c.record).superseded! };
  throw new Error(`cannot reach ${state}`);
}

const transitionsOf = (w: W, r: Rec) =>
  w.evidence.list(r.notification_id, r.version).filter((e) => e.kind === "TRANSITION");

// ================================================================================================ state machine ======
describe("LC-01 every allowed record-level transition is accepted, with one Event and one evidence record on the version that moved", () => {
  const edges = Object.entries(ALLOWED_TRANSITIONS).flatMap(([from, tos]) =>
    tos.map((to): [NotificationStatus, NotificationStatus] => [from as NotificationStatus, to]),
  );
  test("LC-01 the record-level table is lead ruling L-04 item 5 (18 edges); the three charter «→ CORRECTED» pairs are lineage-level", () => {
    assert.equal(edges.length, 18);
    assert.deepEqual(NOTIFICATION_STATUSES, [
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
    ]);
    for (const s of ["DRAFT", "VALIDATED", "AUTHORIZATION_PENDING", "AUTHORIZED", "QUEUED", "CORRECTED"])
      assert.ok(canTransition(s, "CANCELLED"), `${s} → CANCELLED`);
    assert.deepEqual(
      Object.keys(ALLOWED_TRANSITIONS).filter((s) =>
        ALLOWED_TRANSITIONS[s as NotificationStatus].includes("SUPERSEDED"),
      ),
      ISSUED_STATUSES,
      "SUPERSEDED only from SENT / DELIVERY_*",
    );
    assert.ok(
      !Object.values(ALLOWED_TRANSITIONS).some((tos) => tos.includes("CORRECTED")),
      "CORRECTED is an entry state, never a record-level target",
    );
    assert.deepEqual(ALLOWED_TRANSITIONS.CORRECTED, ["VALIDATED", "CANCELLED"]);
    assert.deepEqual(Object.keys(LINEAGE_TRANSITIONS), ISSUED_STATUSES);
    for (const s of ISSUED_STATUSES) assert.ok(canCorrect(s) && !canTransition(s, "CORRECTED"), s);
    for (const s of NOTIFICATION_STATUSES.filter((x) => !(ISSUED_STATUSES as readonly string[]).includes(x)))
      assert.ok(!canCorrect(s), s);
    assert.ok(isTerminal("CANCELLED") && isTerminal("SUPERSEDED") && !isTerminal("DELIVERY_FAILED"));
  });
  for (const [from, to] of edges) {
    test(`LC-01 allowed ${from} → ${to}`, () => {
      // An e-mail settlement confirms delivery only under the explicit SETTLEMENT configuration (L-07; in-app: LC-16).
      const { w, r } = reach(from, {
        approval: from === "VALIDATED" && to === "AUTHORIZATION_PENDING",
        world: to === "DELIVERY_CONFIRMED" ? { lifecycle: SETTLEMENT } : {},
      });
      const before = transitionsOf(w, r).length;
      const out = perform(w, r, to);
      assert.equal(out.record.status, to);
      assert.equal(out.record.revision, r.revision + 1);
      if (to === "SUPERSEDED") {
        // L-04 item 2: the step is the successor's SENT; the superseding Event follows it and is caused by it.
        assert.deepEqual(
          out.events.map((e) => [e.type, e.version]),
          [
            ["NOTIFICATION_SENT", r.version + 1],
            ["NOTIFICATION_SUPERSEDED", r.version],
          ],
        );
        assert.equal(out.events[1]!.causation_id, out.events[0]!.event_id);
        assert.equal(out.record.superseded_by, r.version + 1);
      } else {
        assert.deepEqual(
          out.events.map((e) => e.type),
          [TRANSITION_EVENT_TYPES[to]],
        );
      }
      const after = transitionsOf(w, r);
      assert.equal(
        after.length,
        before + 1,
        "exactly one TRANSITION evidence record on the version that moved",
      );
      assert.equal(after.at(-1)!.data.to, to);
      assert.equal(after.at(-1)!.data.event_id, out.events.at(-1)!.event_id);
    });
  }
  for (const from of ISSUED_STATUSES) {
    test(`LC-01 lineage-level ${from} → CORRECTED: version n+1 enters CORRECTED; version n keeps its state and stays current (L-04)`, () => {
      const { w, r } = reach(from);
      const before = transitionsOf(w, r).length;
      const out = perform(w, r, "CORRECTED");
      assert.deepEqual(
        [out.record.version, out.record.status, out.record.revision],
        [r.version + 1, "CORRECTED", 0],
      );
      assert.deepEqual(out.record.corrects, {
        notification_id: r.notification_id,
        version: r.version,
        reason_code: "SYNTHETIC_CORRECTION",
      });
      assert.deepEqual(
        out.events.map((e) => [e.type, e.version, e.payload.from, e.payload.to, e.payload.corrects_version]),
        [["NOTIFICATION_CORRECTED", r.version + 1, null, "CORRECTED", r.version]],
      );
      assert.deepEqual([out.predecessor!.status, out.predecessor!.revision], [from, r.revision]);
      assert.equal(transitionsOf(w, r).length, before, "no TRANSITION on version n");
      assert.equal(transitionsOf(w, out.record).length, 1);
      assert.deepEqual(
        [
          w.lifecycle.lineage(r.notification_id)!.current_version,
          w.lifecycle.lineage(r.notification_id)!.pending_version,
        ],
        [r.version, r.version + 1],
      );
    });
  }
});

describe("LC-02 every forbidden transition is refused and changes nothing", () => {
  for (const from of NOTIFICATION_STATUSES) {
    test(`LC-02 forbidden from ${from}`, () => {
      const { w, r } = reach(from);
      const ledgerBefore = w.ledger.size();
      const lineageLevel = Object.hasOwn(LINEAGE_TRANSITIONS, from) ? LINEAGE_TRANSITIONS[from] : [];
      const forbidden = NOTIFICATION_STATUSES.filter(
        (to) => !ALLOWED_TRANSITIONS[from].includes(to) && !lineageLevel!.includes(to),
      );
      assert.ok(forbidden.length >= 7);
      for (const to of forbidden) {
        assert.throws(
          () =>
            w.lifecycle.transition(r, to, {
              actor: SEC,
              reason_code: "SYNTHETIC",
              model: modelFor(r),
              statement: statementFor(r),
            }),
          code(to === "SUPERSEDED" ? "SUPERSEDED_ONLY_BY_CORRECTION" : "INVALID_TRANSITION"),
          `${from} → ${to} must be refused`,
        );
      }
      if (ALLOWED_TRANSITIONS[from].includes("SUPERSEDED")) {
        // in the table, but only the successor's SENT can take it (L-04 item 2)
        assert.throws(
          () => w.lifecycle.transition(r, "SUPERSEDED", { actor: SEC, reason_code: "SYNTHETIC" }),
          code("SUPERSEDED_ONLY_BY_CORRECTION"),
        );
      }
      assert.throws(() => w.lifecycle.transition(r, "ACKNOWLEDGED", {}), code("UNKNOWN_STATUS"));
      assert.equal(w.ledger.size(), ledgerBefore, "no event was appended");
      const now = w.lifecycle.get(r.notification_id, r.version);
      assert.equal(now!.status, from);
      assert.equal(now!.revision, r.revision);
    });
  }
});

// ================================================================================================== gates =========
describe("LC-03 VALIDATED requires the disclosure projection", () => {
  for (const [label, model] of [
    ["no model", undefined],
    ["plain object", { fields: { meeting_info: "x" } }],
    ["flag false", { _disclosure_applied: false, _disclosure_log: {} }],
    ["flag without log", { _disclosure_applied: true }],
    ["flag as string", { _disclosure_applied: "true", _disclosure_log: {} }],
  ]) {
    test(`LC-03 refused: ${label}`, () => {
      const { w, r } = reach("DRAFT");
      assert.throws(
        () =>
          w.lifecycle.transition(r, "VALIDATED", { actor: SEC, model, statement: F.INVITATION_STATEMENT }),
        code("DISCLOSURE_NOT_APPLIED"),
      );
      assert.equal(w.lifecycle.get(r.notification_id)!.status, "DRAFT");
      const denial = w.ledger.list({ type: "VALIDATION_REJECTED" }).at(-1);
      assert.equal(denial!.category, "SECURITY");
      assert.equal(denial!.outcome, "DENIED");
      assert.deepEqual(denial!.payload, {
        command: "notification_validate",
        outcome: "DISCLOSURE_NOT_APPLIED",
      });
      assert.equal(
        w.evidence.summary(r.notification_id, 1).refusals.at(-1)!.reason_code,
        "DISCLOSURE_NOT_APPLIED",
      );
    });
  }
  test("LC-03 a projection port (W-D2 brand) is applied in addition to the flag", () => {
    const w = F.createWorld({ lifecycle: { projection: { isProjected: () => false } } });
    const r = w.lifecycle.draft(F.invitationDraft()).record;
    assert.throws(
      () =>
        w.lifecycle.transition(r, "VALIDATED", {
          actor: SEC,
          model: modelFor(r),
          statement: F.INVITATION_STATEMENT,
        }),
      code("DISCLOSURE_NOT_APPLIED"),
    );
  });
});

describe("LC-04 VALIDATED is refused by any consistency BLOCK; WARN rules are carried, not blocking", () => {
  test("LC-04 BLOCK: vote claimed open and a Level-1 code that is not the recorded status → CONSISTENCY_BLOCKED", () => {
    const { w, r } = reach("DRAFT");
    let err;
    assert.throws(
      () =>
        w.lifecycle.transition(r, "VALIDATED", {
          actor: SEC,
          model: modelFor(r),
          statement: { ...F.INVITATION_STATEMENT, claims: { vote_open: true }, l1_code: "S4.03" },
        }),
      (e) => ((err = e), code("CONSISTENCY_BLOCKED")(e)),
    );
    const idsBlocked = det(err).violations.map((v) => v.id);
    assert.ok(idsBlocked.includes("PC-02") && idsBlocked.includes("PC-18"), idsBlocked.join(","));
    assert.equal(w.lifecycle.get(r.notification_id)!.status, "DRAFT");
    const refusal = w.evidence.summary(r.notification_id, 1).refusals.at(-1);
    assert.equal(refusal!.reason_code, "CONSISTENCY_BLOCKED");
    assert.deepEqual([...(refusal!.rule_ids as string[])].sort(), [...new Set(idsBlocked)].sort());
    const audit = w.ledger.list({ type: "VALIDATION_REJECTED" }).at(-1);
    assert.equal(audit!.payload.outcome, "CONSISTENCY_BLOCKED");
    assert.ok((audit!.payload.rule_ids as string[]).includes("PC-02"));
  });
  test("LC-04 BLOCK: the trigger must be a recorded event of an allowed type (PC-25 through the read model)", () => {
    const w = F.createWorld();
    const r = w.lifecycle.draft(F.invitationDraft({ originating_event_id: "evt-not-recorded" })).record;
    assert.throws(
      () => perform(w, r, "VALIDATED"),
      (e) => code("CONSISTENCY_BLOCKED")(e) && det(e).violations.some((v) => v.id === "PC-25"),
    );
    const r2 = w.lifecycle.draft(
      F.invitationDraft({ originating_event_id: "evt-decision-recorded", recipient_id: F.IDS.MEMBER_2 }),
    ).record;
    assert.throws(
      () => perform(w, r2, "VALIDATED"),
      (e) =>
        code("CONSISTENCY_BLOCKED")(e) &&
        det(e).violations.some((v) => v.id === "PC-25" && v.detail.reason === "TRIGGER_TYPE_NOT_ALLOWED"),
    );
  });
  test("LC-04 WARN: an informational notice that asks for an action validates with warning PC-28", () => {
    const { w, r } = reach("DRAFT");
    const out = w.lifecycle.transition(r, "VALIDATED", {
      actor: SEC,
      model: modelFor(r),
      statement: {
        ...F.INVITATION_STATEMENT,
        informational: true,
        required_action: { kind: "SUBMIT_STATEMENT" },
      },
    });
    assert.equal(out.record.status, "VALIDATED");
    assert.deepEqual(
      out.warnings.map((x) => x.id),
      ["PC-28"],
    );
    assert.deepEqual(out.record.validation!.warnings, ["PC-28"]);
    assert.equal(out.events[0]!.payload.warnings, "PC-28");
  });
  test("LC-04 the validated model is fingerprinted, never stored", () => {
    const { w, r } = reach("VALIDATED");
    assert.match(r.model_hash!, /^[0-9a-f]{64}$/);
    const s = w.evidence.summary(r.notification_id, 1);
    assert.equal(s.model_hash, r.model_hash);
    assert.ok(
      !JSON.stringify(w.evidence.list(r.notification_id)).includes("Committee meeting (synthetic)"),
      "no rendered value in evidence",
    );
  });
  test("LC-04 a correction validates as a pre-send state: claiming «sent» in a correction draft is blocked (PC-14)", () => {
    const { w, r } = reach("CORRECTED");
    assert.throws(
      () =>
        w.lifecycle.transition(r, "VALIDATED", {
          actor: SEC,
          model: modelFor(r),
          statement: { ...F.INVITATION_STATEMENT, claims: { notification_sent: true } },
        }),
      (e) => code("CONSISTENCY_BLOCKED")(e) && det(e).violations.some((v) => v.id === "PC-14"),
    );
  });
});

describe("LC-05 the model is bound to this version: recipient and policy version must match", () => {
  test("LC-05 model projected for another recipient → MODEL_RECIPIENT_MISMATCH", () => {
    const { w, r } = reach("DRAFT");
    assert.throws(
      () =>
        w.lifecycle.transition(r, "VALIDATED", {
          actor: SEC,
          model: F.projectedModel({ recipient_id: F.IDS.MEMBER_2 }),
          statement: F.INVITATION_STATEMENT,
        }),
      code("MODEL_RECIPIENT_MISMATCH"),
    );
  });
  test("LC-05 model projected for another class → MODEL_RECIPIENT_CLASS_MISMATCH", () => {
    const { w, r } = reach("DRAFT");
    assert.throws(
      () =>
        w.lifecycle.transition(r, "VALIDATED", {
          actor: SEC,
          model: F.projectedModel({ recipient_class: "WITNESS" }),
          statement: F.INVITATION_STATEMENT,
        }),
      code("MODEL_RECIPIENT_CLASS_MISMATCH"),
    );
  });
  test("LC-05 model projected with another policy version → POLICY_VERSION_MISMATCH", () => {
    const { w, r } = reach("DRAFT");
    assert.throws(
      () =>
        w.lifecycle.transition(r, "VALIDATED", {
          actor: SEC,
          model: F.projectedModel({ policy_version: "DIS-POLICY-OTHER" }),
          statement: F.INVITATION_STATEMENT,
        }),
      code("POLICY_VERSION_MISMATCH"),
    );
  });
});

describe("LC-06 AUTHORIZED needs the approval when the type requires one (fail closed)", () => {
  test("LC-06 approval required: VALIDATED → AUTHORIZED directly is refused (APPROVAL_REQUIRED)", () => {
    const { w, r } = reach("VALIDATED", { approval: true });
    assert.equal(r.approval.required, true);
    assert.throws(() => w.lifecycle.transition(r, "AUTHORIZED", { actor: CHAIR }), code("APPROVAL_REQUIRED"));
  });
  test("LC-06 approver whose check answers DENIED → AUTHORITY_NOT_ALLOWED, audited COMMAND_DENIED", () => {
    const { w, r } = reach("AUTHORIZATION_PENDING");
    assert.throws(
      () => w.lifecycle.transition(r, "AUTHORIZED", { actor: { capacity: "MEMBER", id: F.IDS.MEMBER } }),
      (e) => code("AUTHORITY_NOT_ALLOWED")(e) && det(e).result === "DENIED",
    );
    const d = w.ledger.list({ type: "COMMAND_DENIED" }).at(-1);
    assert.deepEqual(
      [d!.category, d!.outcome, d!.payload.command, d!.payload.outcome],
      ["SECURITY", "DENIED", "notification_authorize", "FORBIDDEN"],
    );
    assert.equal(w.lifecycle.get(r.notification_id)!.status, "AUTHORIZATION_PENDING");
  });
  test("LC-06 SOURCE_REQUIRED (no approved source for this capacity) fails closed", () => {
    const { w, r } = reach("AUTHORIZATION_PENDING");
    assert.throws(
      () => w.lifecycle.transition(r, "AUTHORIZED", { actor: SEC }),
      (e) => code("AUTHORITY_NOT_ALLOWED")(e) && det(e).result === "SOURCE_REQUIRED",
    );
  });
  test("LC-06 no authority port → AUTHORITY_PORT_MISSING; a throwing port → NO_RESULT", () => {
    const a = reach("AUTHORIZATION_PENDING", { world: { authority: null } });
    assert.throws(
      () => a.w.lifecycle.transition(a.r, "AUTHORIZED", { actor: CHAIR }),
      code("AUTHORITY_PORT_MISSING"),
    );
    const b = reach("AUTHORIZATION_PENDING", {
      world: {
        authority: {
          check: () => {
            throw new Error("down");
          },
        },
      },
    });
    assert.throws(
      () => b.w.lifecycle.transition(b.r, "AUTHORIZED", { actor: CHAIR }),
      (e) => code("AUTHORITY_NOT_ALLOWED")(e) && det(e).result === "NO_RESULT",
    );
  });
  test("LC-06 a type without an approval spec is treated as SOURCE_REQUIRED and can never be authorized", () => {
    const w = F.createWorld();
    let r = w.lifecycle.draft(F.defenceNoticeDraft({ type_code: "DEFENCE_UNCONFIGURED" })).record;
    assert.deepEqual(r.approval, { required: true, basis: "SOURCE_REQUIRED", action_id: null });
    r = perform(w, r, "VALIDATED").record;
    assert.throws(() => w.lifecycle.transition(r, "AUTHORIZED", { actor: CHAIR }), code("APPROVAL_REQUIRED"));
    r = perform(w, r, "AUTHORIZATION_PENDING").record;
    assert.throws(
      () => w.lifecycle.transition(r, "AUTHORIZED", { actor: CHAIR }),
      code("APPROVAL_ACTION_UNDEFINED"),
    );
  });
  test("LC-06 approval not required: AUTHORIZATION_PENDING is refused, AUTHORIZED records the SYSTEM basis", () => {
    const { w, r } = reach("VALIDATED");
    assert.throws(
      () => w.lifecycle.transition(r, "AUTHORIZATION_PENDING", { actor: SEC }),
      code("APPROVAL_NOT_REQUIRED"),
    );
    const out = w.lifecycle.transition(r, "AUTHORIZED", { actor: SEC });
    assert.equal(w.evidence.summary(r.notification_id, 1).authorizer!.basis, "NO_APPROVAL_REQUIRED");
    assert.equal(out.events[0]!.payload.basis, "NO_APPROVAL_REQUIRED");
  });
  test("LC-06 ALLOWED: the approver and the check are recorded as evidence", () => {
    const { w, r } = reach("AUTHORIZATION_PENDING");
    const out = w.lifecycle.transition(r, "AUTHORIZED", { actor: CHAIR });
    assert.equal(out.record.status, "AUTHORIZED");
    assert.deepEqual(w.evidence.summary(r.notification_id, 1).authorizer, {
      capacity: "CHAIR",
      id: F.IDS.CHAIR,
      basis: "AUTHORITY_CHECK_ALLOWED",
      action_id: "ISSUE_DEFENCE_NOTICE",
      authority_result: "ALLOWED",
    });
    assert.deepEqual((w.authority as F.MockAuthority).calls().at(-1), {
      action_id: "ISSUE_DEFENCE_NOTICE",
      capacity: "CHAIR",
    });
  });
});

// ============================================================================================ idempotency ==========
describe("LC-07 duplicate prevention by idempotency key", () => {
  test("LC-07 the same draft twice → the second is a duplicate; nothing new is written", () => {
    const w = F.createWorld();
    const a = w.lifecycle.draft(F.invitationDraft());
    const ledger = w.ledger.size();
    const evidence = w.evidence.size();
    const b = w.lifecycle.draft(F.invitationDraft());
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, true);
    assert.equal(b.record.notification_id, a.record.notification_id);
    assert.deepEqual(b.events, []);
    assert.equal(w.ledger.size(), ledger);
    assert.equal(w.evidence.size(), evidence);
    assert.equal(w.lifecycle.records().length, 1);
  });
  test("LC-07 another recipient, another channel or another policy version is another notification", () => {
    const w = F.createWorld();
    const ids = new Set([
      w.lifecycle.draft(F.invitationDraft()).record.idempotency_key,
      w.lifecycle.draft(F.invitationDraft({ recipient_id: F.IDS.MEMBER_2 })).record.idempotency_key,
      w.lifecycle.draft(F.invitationDraft({ channel: "IN_APP" })).record.idempotency_key,
      w.lifecycle.draft(F.invitationDraft({ policy_version: "DIS-POLICY-V13-SYNTHETIC-2" })).record
        .idempotency_key,
    ]);
    assert.equal(ids.size, 4);
  });
  test("LC-07 the outbox dedupe key is derived from the idempotency key (ids only) and refuses a second row", () => {
    const { w, r } = reach("QUEUED");
    const row = w.outbox.getRow(r.outbox!.row_id);
    assert.equal(row!.dedupe_key, `v13:${r.idempotency_key}:${F.IDS.MEMBER}:EMAIL`);
    assert.deepEqual(
      w.outbox.enqueue({
        template_code: "MEETING_INVITATION",
        recipient_id: F.IDS.MEMBER,
        object_id: F.IDS.MEETING,
        channel: "EMAIL",
        dedupe: `v13:${r.idempotency_key}`,
      }),
      { inserted: false, id: null, reason: "DUPLICATE_DEDUPE_KEY" },
    );
  });
});

describe("LC-08 idempotency key formula (charter §9) and its tagged PROPOSAL components", () => {
  const base = {
    type_code: "MEETING_INVITATION",
    object_id: F.IDS.MEETING,
    recipient_id: F.IDS.MEMBER,
    version: 1,
    policy_version: F.POLICY_VERSION,
  };
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  test("LC-08 five components only → exactly sha256(type|object|recipient|version|policy)", () => {
    assert.equal(
      idempotencyKey(base),
      sha(`MEETING_INVITATION|${F.IDS.MEETING}|${F.IDS.MEMBER}|1|${F.POLICY_VERSION}`),
    );
  });
  test("LC-08 the lifecycle appends the channel (one record per channel, as the outbox dedupes per channel, 1920:261)", () => {
    const w = F.createWorld();
    const r = w.lifecycle.draft(F.invitationDraft()).record;
    assert.equal(
      r.idempotency_key,
      sha(`MEETING_INVITATION|${F.IDS.MEETING}|${F.IDS.MEMBER}|1|${F.POLICY_VERSION}|ch:EMAIL`),
    );
    assert.deepEqual(r.key_components, { ...base, channel: "EMAIL" });
  });
  test("LC-08 a repeatable type adds the originating event (occ:), so two reminders do not collide", () => {
    const w = F.createWorld();
    const d = (evt: string) =>
      w.lifecycle.draft({
        ...F.invitationDraft({ type_code: "MINUTES_REVIEW_REMINDER", originating_event_id: evt }),
      });
    const a = d("evt-reminder-1");
    const b = d("evt-reminder-2");
    const c = d("evt-reminder-1");
    assert.equal(a.duplicate, false);
    assert.equal(b.duplicate, false);
    assert.equal(c.duplicate, true);
    assert.equal(
      a.record.idempotency_key,
      sha(
        `MINUTES_REVIEW_REMINDER|${F.IDS.MEETING}|${F.IDS.MEMBER}|1|${F.POLICY_VERSION}|ch:EMAIL|occ:evt-reminder-1`,
      ),
    );
  });
  test("LC-08 keys change with the version, so a correction is never a duplicate", () => {
    assert.notEqual(idempotencyKey(base), idempotencyKey({ ...base, version: 2 }));
  });
});

// ============================================================================================ retry ================
describe("LC-09 retry policy: attempts, backoff and FAILED after exhaustion", () => {
  test("LC-09 five failed attempts → DELIVERY_FAILED; the row is FAILED at attempts 5 and never claimed again", async () => {
    const w = F.createWorld({ senderDefault: false });
    const r = F.toQueued(w);
    const states = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await w.lifecycle.dispatchEmailBatch(10);
      states.push([
        w.lifecycle.get(r.notification_id)!.status,
        w.outbox.getRow(r.outbox!.row_id)!.status,
        res.retrying,
        res.failed,
      ]);
    }
    assert.deepEqual(states, [
      ["SENT", "PENDING", 1, 0],
      ["SENT", "PENDING", 1, 0],
      ["SENT", "PENDING", 1, 0],
      ["SENT", "PENDING", 1, 0],
      ["DELIVERY_FAILED", "FAILED", 0, 1],
    ]);
    assert.equal(w.outbox.getRow(r.outbox!.row_id)!.attempts, PLATFORM_OUTBOX_MAX_ATTEMPTS);
    assert.deepEqual(await w.lifecycle.dispatchEmailBatch(10), {
      sent: 0,
      failed: 0,
      retrying: 0,
      suppressed: 0,
      unmanaged: 0,
    });
    assert.equal(w.sender.calls().length, 5);
    const attempts = w.evidence.summary(r.notification_id, 1).delivery_attempts;
    assert.equal(attempts.length, 10, "ATTEMPTED + result per attempt");
    assert.deepEqual(
      attempts.filter((a) => a.status !== "ATTEMPTED").map((a) => a.status),
      ["FAILED", "FAILED", "FAILED", "FAILED", "FAILED"],
    );
    const gaps = attempts
      .filter((a) => a.status === "FAILED")
      .map((a) =>
        a.next_attempt_not_before ? parseInstant(a.next_attempt_not_before) - parseInstant(a.at) : null,
      );
    assert.deepEqual(
      gaps,
      [60_000, 120_000, 240_000, 480_000, null],
      "exponential backoff proposal; none after exhaustion",
    );
    const failed = w.ledger.list({ type: "DELIVERY_FAILED" }).at(-1);
    assert.equal(failed!.payload.evidence_kind, "OUTBOX_ATTEMPTS_EXHAUSTED");
    assert.equal(
      w.ledger.list({ type: "NOTIFICATION_DELIVERY" }).length,
      5,
      "record_email_delivery audits every settlement (1920:612-614)",
    );
  });
  test("LC-09 a refusal, then a transport error, then acceptance on attempt 3 → ACCEPTED_BY_PROVIDER, the version stays SENT (ACCEPTANCE, L-07); the error is not logged", async () => {
    const w = F.createWorld({ senderOutcomes: [false, "THROW", true] });
    const r = F.toQueued(w);
    for (let i = 0; i < 3; i += 1) await w.lifecycle.dispatchEmailBatch(10);
    assert.equal(w.lifecycle.get(r.notification_id)!.status, "SENT");
    assert.deepEqual(
      [w.outbox.getRow(r.outbox!.row_id)!.status, w.outbox.getRow(r.outbox!.row_id)!.attempts],
      ["SENT", 3],
    );
    assert.deepEqual(
      w.evidence.summary(r.notification_id, 1).delivery_attempts.map((a) => a.status),
      ["ATTEMPTED", "FAILED", "ATTEMPTED", "FAILED", "ATTEMPTED", "ACCEPTED_BY_PROVIDER"],
    );
    assert.equal(
      w.ledger.list({ type: "DELIVERY_CONFIRMED" }).length,
      0,
      "acceptance is not confirmed delivery",
    );
    assert.ok(!JSON.stringify(w.ledger.list()).includes("stub transport error"));
    assert.ok(!JSON.stringify(w.evidence.list(r.notification_id)).includes("stub transport error"));
  });
  test("LC-09 policy object: backoff doubles from 60 s and caps at 1 h; verdict mirrors 1920:609", () => {
    const p = createRetryPolicy();
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map(p.backoffMs),
      [60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000],
    );
    assert.deepEqual(
      (
        [
          [1, true],
          [4, false],
          [5, false],
          [6, false],
        ] as [number, boolean][]
      ).map(([a, d]) => p.verdict(a, d)),
      ["SENT", "PENDING", "FAILED", "FAILED"],
    );
    assert.equal(p.maxAttempts, 5);
    assert.equal(p.nextAttemptAt("2026-10-27T10:00:00+03:00", 1), "2026-10-27T07:01:00.000Z");
    assert.throws(() => createRetryPolicy({ maxAttempts: 0 }), RangeError);
    assert.throws(() => p.backoffMs(0), RangeError);
    assert.equal(RETRY_POLICY.maxAttempts, PLATFORM_OUTBOX_MAX_ATTEMPTS);
  });
  test("LC-09 the lifecycle refuses a retry policy that contradicts the outbox ceiling", () => {
    assert.throws(
      () => F.createWorld({ lifecycle: { retryPolicy: createRetryPolicy({ maxAttempts: 3 }) } }),
      code("RETRY_POLICY_DIVERGES"),
    );
  });
});

// ============================================================================================ ordering =============
describe("LC-10 event ordering: occurred_at, then recorded_at, then event_id; offsets required", () => {
  const e = (event_id: string, occurred_at: string, recorded_at?: string | null) => ({
    event_id,
    occurred_at,
    recorded_at,
  });
  test("LC-10 instants are compared across offsets", () => {
    const out = orderEvents([
      e("b", "2026-10-20T10:00:00+03:00"),
      e("a", "2026-10-20T08:00:00Z"),
      e("c", "2026-10-20T06:30:00Z"),
    ]);
    assert.deepEqual(
      out.map((x) => x.event_id),
      ["c", "b", "a"],
    );
  });
  test("LC-10 ties: recorded_at, then event_id; an unrecorded event sorts after a recorded one", () => {
    const t = "2026-10-20T07:00:00Z";
    const out = orderEvents([
      e("z", t, "2026-10-20T07:00:05Z"),
      e("y", t, "2026-10-20T07:00:01Z"),
      e("x", t, null),
      e("w", t, "2026-10-20T07:00:01Z"),
    ]);
    assert.deepEqual(
      out.map((x) => x.event_id),
      ["w", "y", "z", "x"],
    );
    assert.equal(compareEvents(e("a", t), e("a", t)), 0);
    assert.equal(latestEvent(out, (x) => x.recorded_at)!.event_id, "z");
  });
  test("LC-10 a zone-less or invalid time is refused (W4-09)", () => {
    assert.throws(
      () => orderEvents([e("a", "2026-10-20T10:00:00"), e("b", "2026-10-20T10:00:00Z")]),
      (err: unknown) => err instanceof OrderingError && err.code === "TIMESTAMP_WITHOUT_OFFSET",
    );
    assert.throws(
      () => parseInstant("2026-02-30T10:00:00Z"),
      (err) => err instanceof OrderingError,
    );
    assert.equal(recordedNotBeforeOccurred(e("a", "2026-10-20T10:00:00Z", "2026-10-20T09:59:59Z")), false);
    assert.equal(recordedNotBeforeOccurred(e("a", "2026-10-20T10:00:00Z", "2026-10-20T10:00:00Z")), true);
  });
  test("LC-10 a notification history is returned in lifecycle order with a causation chain", async () => {
    const w = F.createWorld({ lifecycle: SETTLEMENT }); // explicit: the chain ends with the settlement's DELIVERY_CONFIRMED (L-07)
    const r = F.toQueued(w);
    await w.lifecycle.dispatchEmailBatch(10);
    const h = w.lifecycle.history(r.notification_id);
    assert.deepEqual(
      h.map((x) => x.type),
      [
        "NOTIFICATION_DRAFTED",
        "NOTIFICATION_VALIDATED",
        "NOTIFICATION_AUTHORIZED",
        "NOTIFICATION_QUEUED",
        "NOTIFICATION_SENT",
        "DELIVERY_CONFIRMED",
      ],
    );
    assert.equal(h[0]!.causation_id, "evt-meeting-scheduled", "the draft is caused by the recorded trigger");
    for (let i = 1; i < h.length; i += 1) assert.equal(h[i]!.causation_id, h[i - 1]!.event_id);
    assert.deepEqual(
      orderEvents([...h].reverse()).map((x) => x.event_id),
      h.map((x) => x.event_id),
    );
  });
});

// ======================================================================================= correction ==============
describe("LC-11 correction (lead ruling L-04): version n+1 starts in CORRECTED; version n stays current until n+1 is SENT", () => {
  /** Lineage invariants checked after every step: one current version, at most one issued (unsuperseded) version, and
   * every SUPERSEDED version replaced by an issued version that corrects it. Returns the lineage. */
  function assertLineage(w: W, id: string) {
    const lin = w.lifecycle.lineage(id);
    const vs = w.lifecycle.versions(id);
    assert.ok(lin && Number.isInteger(lin.current_version), "the lineage always has a current version");
    const cur = vs[lin.current_version - 1];
    const anyIssued = vs.some(
      (v) => (ISSUED_STATUSES as readonly string[]).includes(v.status) || v.status === "SUPERSEDED",
    );
    assert.ok(
      (ISSUED_STATUSES as readonly string[]).includes(cur!.status) || (!anyIssued && cur!.version === 1),
      `current v${cur!.version} is ${cur!.status}`,
    );
    assert.ok(
      vs.filter((v) => (ISSUED_STATUSES as readonly string[]).includes(v.status)).length <= 1,
      "at most one issued, unsuperseded version",
    );
    for (const v of vs.filter((x) => x.status === "SUPERSEDED")) {
      const s = vs[v.superseded_by! - 1];
      assert.ok(
        s && s.corrects!.version === v.version && [...ISSUED_STATUSES, "SUPERSEDED"].includes(s.status),
        `v${v.version} is superseded by an issued correction`,
      );
    }
    return lin;
  }

  test("LC-11 correcting creates version n+1 in CORRECTED (corrects_version, reason code); version n keeps state, revision and last Event and stays current", async () => {
    const w = F.createWorld();
    const lc = w.lifecycle;
    const v1 = F.toQueued(w);
    await lc.dispatchEmailBatch(10);
    const sent = lc.get(v1.notification_id);
    assert.equal(
      sent!.status,
      "SENT",
      "ACCEPTANCE (default): accepted by the sender, delivery not confirmed",
    );
    const c = lc.transition(sent, "CORRECTED", { actor: SEC, reason_code: "WRONG_MEETING_ROOM" });
    assert.deepEqual([c.record.version, c.record.status], [2, "CORRECTED"]);
    assert.deepEqual(c.record.corrects, {
      notification_id: v1.notification_id,
      version: 1,
      reason_code: "WRONG_MEETING_ROOM",
    });
    assert.deepEqual(
      c.events.map((e) => [
        e.type,
        e.version,
        e.payload.corrects_version,
        e.payload.corrected_status,
        e.payload.reason_code,
      ]),
      [["NOTIFICATION_CORRECTED", 2, 1, "SENT", "WRONG_MEETING_ROOM"]],
    );
    assert.equal(c.events[0]!.causation_id, sent!.last_event_id);
    assert.deepEqual(
      [c.predecessor!.status, c.predecessor!.revision, c.predecessor!.last_event_id],
      [sent!.status, sent!.revision, sent!.last_event_id],
    );
    assert.equal(w.ledger.list({ type: "NOTIFICATION_SUPERSEDED" }).length, 0, "nothing is superseded yet");
    const lin = assertLineage(w, v1.notification_id);
    assert.deepEqual([lin.current_version, lin.pending_version, lin.current.status], [1, 2, "SENT"]);
    const s1 = w.evidence.summary(v1.notification_id, 1);
    assert.deepEqual(
      s1.corrections.map((x) => [x.successor_version, x.reason_code]),
      [[2, "WRONG_MEETING_ROOM"]],
    );
    assert.equal(s1.chain_ok, true);
    assert.equal(w.evidence.summary(v1.notification_id, 2).corrects!.version, 1);
  });

  test("LC-11 version n moves to SUPERSEDED exactly when version n+1 reaches SENT — not at CORRECTED, VALIDATED, AUTHORIZED or QUEUED", async () => {
    const w = F.createWorld();
    const lc = w.lifecycle;
    const v1 = F.toQueued(w);
    await lc.dispatchEmailBatch(10);
    let v2 = lc.transition(lc.get(v1.notification_id), "CORRECTED", {
      actor: SEC,
      reason_code: "WRONG_TIME",
    }).record;
    const seen = [
      [
        "CORRECTED",
        lc.get(v1.notification_id, 1)!.status,
        assertLineage(w, v1.notification_id).current_version,
      ],
    ];
    for (const step of ["VALIDATED", "AUTHORIZED", "QUEUED"]) {
      v2 = perform(w, v2, step).record;
      seen.push([
        step,
        lc.get(v1.notification_id, 1)!.status,
        assertLineage(w, v1.notification_id).current_version,
      ]);
    }
    assert.deepEqual(seen, [
      ["CORRECTED", "SENT", 1],
      ["VALIDATED", "SENT", 1],
      ["AUTHORIZED", "SENT", 1],
      ["QUEUED", "SENT", 1],
    ]);
    assert.equal(w.ledger.list({ type: "NOTIFICATION_SUPERSEDED" }).length, 0);
    await lc.dispatchEmailBatch(10); // claims version 2's row: version 2 SENT, version 1 SUPERSEDED in the same step
    assert.deepEqual(
      lc.versions(v1.notification_id).map((x) => [x.version, x.status, x.superseded_by]),
      [
        [1, "SUPERSEDED", 2],
        [2, "SENT", null],
      ],
    );
    const sent2 = w.ledger.list({ type: "NOTIFICATION_SENT" }).find((e) => e.version === 2);
    const sup = w.ledger.list({ type: "NOTIFICATION_SUPERSEDED" });
    assert.equal(sup.length, 1);
    assert.deepEqual(
      [
        sup[0]!.version,
        sup[0]!.causation_id,
        sup[0]!.occurred_at,
        sup[0]!.payload.from,
        sup[0]!.payload.successor_version,
        sup[0]!.payload.reason_code,
      ],
      [1, sent2!.event_id, sent2!.occurred_at, "SENT", 2, "WRONG_TIME"],
    );
    assert.equal(assertLineage(w, v1.notification_id).current_version, 2);
    const s1 = w.evidence.summary(v1.notification_id, 1);
    assert.deepEqual(
      s1.corrections.map((x) => x.successor_version ?? x.superseded_by_version),
      [2, 2],
    );
    assert.equal(s1.transitions.at(-1)!.to, "SUPERSEDED");
    assert.equal(s1.chain_ok, true);
  });

  test("LC-11 v1 → v2 → v3: each issued correction supersedes its predecessor; keys, rows and evidence stay per version", async () => {
    const w = F.createWorld();
    const lc = w.lifecycle;
    const v1 = F.toQueued(w);
    await lc.dispatchEmailBatch(10);
    const c2 = lc.transition(lc.get(v1.notification_id), "CORRECTED", {
      actor: SEC,
      reason_code: "WRONG_MEETING_ROOM",
    });
    sendCorrection(w, c2.record);
    const c3 = lc.transition(lc.get(v1.notification_id), "CORRECTED", {
      actor: SEC,
      reason_code: "WRONG_TIME",
    });
    assert.equal(c3.record.corrects!.version, 2);
    assert.deepEqual(
      lc.versions(v1.notification_id).map((x) => [x.version, x.status]),
      [
        [1, "SUPERSEDED"],
        [2, "SENT"],
        [3, "CORRECTED"],
      ],
    );
    sendCorrection(w, c3.record);
    assert.deepEqual(
      lc.versions(v1.notification_id).map((x) => [x.version, x.status, x.superseded_by]),
      [
        [1, "SUPERSEDED", 2],
        [2, "SUPERSEDED", 3],
        [3, "SENT", null],
      ],
    );
    assert.equal(new Set(lc.versions(v1.notification_id).map((x) => x.idempotency_key)).size, 3);
    assert.equal(w.outbox.rows().length, 3, "one outbox row per sent version");
    for (const v of [1, 2]) {
      const s = w.evidence.summary(v1.notification_id, v);
      assert.equal(s.corrections.at(-1)!.superseded_by_version, v + 1);
      assert.equal(s.chain_ok, true);
    }
    assert.equal(w.evidence.summary(v1.notification_id, 3).corrects!.version, 2);
    assert.equal(assertLineage(w, v1.notification_id).current_version, 3);
  });

  test("LC-11 one correction at a time (CORRECTION_IN_PROGRESS); a superseded version cannot be corrected (INVALID_TRANSITION)", () => {
    const { w, r } = reach("CORRECTED");
    const v1 = w.lifecycle.get(r.notification_id, 1);
    assert.throws(
      () => w.lifecycle.transition(v1, "CORRECTED", { actor: SEC, reason_code: "AGAIN" }),
      (e) => code("CORRECTION_IN_PROGRESS")(e) && det(e).pending_version === 2,
    );
    assert.equal(w.lifecycle.versions(r.notification_id).length, 2, "nothing was created");
    const s = reach("SUPERSEDED");
    assert.throws(
      () => s.w.lifecycle.transition(s.r, "CORRECTED", { actor: SEC, reason_code: "AGAIN" }),
      code("INVALID_TRANSITION"),
    );
  });

  test("LC-11 correction needs a reason code and an actor", () => {
    const { w, r } = reach("DELIVERY_CONFIRMED");
    assert.throws(() => w.lifecycle.transition(r, "CORRECTED", { actor: SEC }), code("REASON_CODE_REQUIRED"));
    assert.throws(
      () => w.lifecycle.transition(r, "CORRECTED", { reason_code: "WRONG_TIME" }),
      code("ACTOR_REQUIRED"),
    );
  });

  test("LC-11 correcting an e-mail still retrying suppresses its retries (CORRECTION_PENDING): version n stays SENT and is never handed to the sender again", async () => {
    const w = F.createWorld({ senderOutcomes: [false] });
    const r = F.toQueued(w);
    await w.lifecycle.dispatchEmailBatch(10);
    const sent = w.lifecycle.get(r.notification_id);
    assert.deepEqual([sent!.status, w.outbox.getRow(r.outbox!.row_id)!.status], ["SENT", "PENDING"]);
    const c = w.lifecycle.transition(sent, "CORRECTED", { actor: SEC, reason_code: "WRONG_CONTENT" });
    assert.equal(w.lifecycle.suppressionReason(r.outbox!.row_id), "CORRECTION_PENDING");
    assert.deepEqual(
      [c.predecessor!.status, c.predecessor!.revision],
      ["SENT", sent!.revision],
      "the state of version n does not change",
    );
    const calls = w.sender.calls().length;
    const res = await w.lifecycle.dispatchEmailBatch(10);
    assert.deepEqual([res.suppressed, res.sent, res.retrying], [1, 0, 0]);
    assert.equal(w.sender.calls().length, calls);
    assert.equal(
      w.outbox.getRow(r.outbox!.row_id)!.status,
      "PENDING",
      "GAP-OUT-03: notify.* cannot withdraw the row",
    );
    assert.deepEqual(
      w.evidence.summary(r.notification_id, 1).suppressions.map((x) => x.reason_code),
      ["CORRECTION_PENDING", "CORRECTION_PENDING"],
    );
    assert.equal(w.lifecycle.get(r.notification_id, 1)!.status, "SENT");
    assert.equal(sendCorrection(w, c.record).superseded!.status, "SUPERSEDED");
    await w.lifecycle.dispatchEmailBatch(10);
    assert.equal(
      w.evidence.summary(r.notification_id, 1).suppressions.at(-1)!.reason_code,
      "VERSION_SUPERSEDED",
    );
    assert.equal(
      w.sender.calls().filter((x) => x.id === r.outbox!.row_id).length,
      1,
      "the wrong text was handed over once, before the correction",
    );
  });

  test("LC-11 an in-app correction supersedes version n in its QUEUED step (SENT and DELIVERY_CONFIRMED together, L-02)", () => {
    const w = F.createWorld();
    const lc = w.lifecycle;
    const v1 = F.toQueued(w, F.invitationDraft({ channel: "IN_APP" }));
    assert.equal(v1.status, "DELIVERY_CONFIRMED");
    const c = lc.transition(v1, "CORRECTED", { actor: SEC, reason_code: "WRONG_TIME" });
    let v2 = perform(w, c.record, "VALIDATED").record;
    v2 = perform(w, v2, "AUTHORIZED").record;
    assert.equal(lc.get(v1.notification_id, 1)!.status, "DELIVERY_CONFIRMED");
    const q = perform(w, v2, "QUEUED");
    assert.deepEqual(
      q.events.map((e) => [e.type, e.version]),
      [
        ["NOTIFICATION_QUEUED", 2],
        ["NOTIFICATION_SENT", 2],
        ["NOTIFICATION_SUPERSEDED", 1],
        ["DELIVERY_CONFIRMED", 2],
      ],
    );
    assert.deepEqual(
      [q.record.status, q.superseded!.status, q.superseded!.superseded_by],
      ["DELIVERY_CONFIRMED", "SUPERSEDED", 2],
    );
    assert.equal(
      w.outbox.listForRecipient(F.IDS.MEMBER).length,
      2,
      "both rows stay in the inbox: notify.* rows are immutable facts (limitation, docs/V13-11 §7)",
    );
    assert.equal(assertLineage(w, v1.notification_id).current_version, 2);
  });

  test("LC-11 a cancelled correction leaves version n current — the lineage never loses its current version — and a new correction may start (L-04 item 4)", async () => {
    const w = F.createWorld({ senderOutcomes: [false] });
    const lc = w.lifecycle;
    const v1 = F.toQueued(w);
    const id = v1.notification_id;
    await lc.dispatchEmailBatch(10); // version 1 SENT, its e-mail retrying
    const steps = [];
    const c2 = lc.transition(lc.get(id), "CORRECTED", { actor: SEC, reason_code: "WRONG_TIME" });
    steps.push(assertLineage(w, id));
    const x2 = lc.transition(perform(w, c2.record, "VALIDATED").record, "CANCELLED", {
      actor: SEC,
      reason_code: "CORRECTION_WITHDRAWN",
    });
    steps.push(assertLineage(w, id));
    const res = await lc.dispatchEmailBatch(10);
    assert.equal(
      res.suppressed,
      1,
      "the retries of the text found wrong stay suppressed after the correction is cancelled",
    );
    const c3 = lc.transition(lc.get(id, 1), "CORRECTED", { actor: SEC, reason_code: "WRONG_ROOM" });
    steps.push(assertLineage(w, id));
    sendCorrection(w, c3.record);
    steps.push(assertLineage(w, id));
    assert.deepEqual(
      steps.map((l) => [l.current_version, l.pending_version]),
      [
        [1, 2],
        [1, null],
        [1, 3],
        [3, null],
      ],
    );
    assert.equal(x2.record.status, "CANCELLED");
    assert.deepEqual(c3.record.corrects, { notification_id: id, version: 1, reason_code: "WRONG_ROOM" });
    assert.deepEqual(
      lc.versions(id).map((x) => [x.version, x.status, x.superseded_by]),
      [
        [1, "SUPERSEDED", 3],
        [2, "CANCELLED", null],
        [3, "SENT", null],
      ],
    );
    assert.equal(w.sender.calls().filter((x) => x.id === v1.outbox!.row_id).length, 1, "never re-sent");
    const ex = lc.exceptions(id);
    assert.deepEqual(
      ex.map((e) => [e.version, e.data.reason_code, e.data.successor_version, e.data.retries_suppressed]),
      [[1, "CORRECTION_CANCELLED", 2, true]],
    );
  });
});

// ===================================================================================== cancellation ==============
describe("LC-12 cancellation", () => {
  for (const state of ["DRAFT", "VALIDATED", "AUTHORIZATION_PENDING", "AUTHORIZED"]) {
    test(`LC-12 ${state} → CANCELLED with reason and actor`, () => {
      const { w, r } = reach(state);
      const out = w.lifecycle.transition(r, "CANCELLED", {
        actor: SEC,
        reason_code: "MEETING_NO_LONGER_NEEDED",
      });
      assert.equal(out.record.status, "CANCELLED");
      assert.equal(out.events[0]!.payload.reason_code, "MEETING_NO_LONGER_NEEDED");
      assert.equal(transitionsOf(w, r).at(-1)!.data.reason_code, "MEETING_NO_LONGER_NEEDED");
    });
  }
  test("LC-12 a reason code and an actor are required", () => {
    const { w, r } = reach("DRAFT");
    assert.throws(() => w.lifecycle.transition(r, "CANCELLED", { actor: SEC }), code("REASON_CODE_REQUIRED"));
    assert.throws(
      () => w.lifecycle.transition(r, "CANCELLED", { actor: SEC, reason_code: "free text reason" }),
      code("REASON_CODE_REQUIRED"),
    );
    assert.throws(
      () => w.lifecycle.transition(r, "CANCELLED", { reason_code: "NOT_NEEDED" }),
      code("ACTOR_REQUIRED"),
    );
  });
  test("LC-12 QUEUED e-mail not yet claimed → CANCELLED; dispatch is suppressed; the row stays PENDING (GAP-OUT-03)", async () => {
    const { w, r } = reach("QUEUED");
    const out = w.lifecycle.transition(r, "CANCELLED", { actor: SEC, reason_code: "MEETING_CANCELLED" });
    assert.equal(out.record.status, "CANCELLED");
    assert.equal(transitionsOf(w, r).at(-1)!.data.outbox_row_left_pending, true);
    assert.equal(w.ledger.list({ type: "NOTIFICATION_SUPPRESSED" }).length, 1);
    const res = await w.lifecycle.dispatchEmailBatch(10);
    assert.deepEqual(res, { sent: 0, failed: 0, retrying: 0, suppressed: 1, unmanaged: 0 });
    assert.equal(w.sender.calls().length, 0, "never handed to the sender");
    assert.equal(w.outbox.getRow(r.outbox!.row_id)!.status, "PENDING");
  });
  test("LC-12 QUEUED but already claimed by the dispatcher → CANCEL_TOO_LATE", () => {
    const { w, r } = reach("QUEUED");
    w.outbox.claimEmailBatch(10);
    assert.throws(
      () => w.lifecycle.transition(r, "CANCELLED", { actor: SEC, reason_code: "TOO_LATE" }),
      code("CANCEL_TOO_LATE"),
    );
  });
  test("LC-12 once SENT a notification is corrected, never cancelled", () => {
    for (const s of ["SENT", "DELIVERY_CONFIRMED", "DELIVERY_FAILED"]) {
      const { w, r } = reach(s);
      assert.throws(
        () => w.lifecycle.transition(r, "CANCELLED", { actor: SEC, reason_code: "X_REASON" }),
        code("INVALID_TRANSITION"),
      );
    }
  });
  test("LC-12 cancelling a correction leaves the predecessor current and unchanged, with an open exception for manual follow-up (L-04 item 4)", () => {
    const { w, r } = reach("CORRECTED");
    const before = w.lifecycle.get(r.notification_id, 1);
    w.lifecycle.transition(r, "CANCELLED", { actor: SEC, reason_code: "CORRECTION_WITHDRAWN" });
    const [v1, v2] = w.lifecycle.versions(r.notification_id);
    assert.deepEqual(
      [v1!.status, v1!.revision, v2!.status],
      ["DELIVERY_CONFIRMED", before!.revision, "CANCELLED"],
    );
    const lin = w.lifecycle.lineage(r.notification_id);
    assert.deepEqual([lin!.current_version, lin!.pending_version], [1, null]);
    const ex = w.lifecycle.exceptions(r.notification_id);
    assert.equal(ex.length, 1);
    assert.deepEqual(
      [
        ex[0]!.version,
        ex[0]!.data.reason_code,
        ex[0]!.data.follow_up,
        ex[0]!.data.successor_version,
        ex[0]!.data.current_version,
        ex[0]!.data.retries_suppressed,
      ],
      [1, "CORRECTION_CANCELLED", "MANUAL", 2, 1, false],
    );
  });
});

// ======================================================================================= evidence ===============
describe("LC-13 evidence is append-only, hash-chained and holds references, not content", () => {
  test("LC-13 update, delete, set and clear throw; stored entries are frozen", () => {
    const { w, r } = reach("DELIVERY_CONFIRMED");
    for (const op of ["update", "delete", "set", "clear"] as const)
      assert.throws(
        () => w.evidence[op]({}),
        (e: unknown) => (e as { code?: unknown }).code === "APPEND_ONLY",
      );
    const entry = w.evidence.list(r.notification_id, 1)[0];
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry!.data));
    assert.throws(() => {
      // @ts-expect-error -- writing to a frozen entry on purpose (must throw)
      entry!.kind = "EXPORT";
    }, TypeError);
    assert.throws(() => {
      // @ts-expect-error -- writing to frozen evidence data on purpose (must throw)
      entry!.data.originating_event_id = "evt-forged";
    }, TypeError);
    assert.equal(w.evidence.verify(r.notification_id, 1).ok, true);
  });
  test("LC-13 a version summary answers what, to whom, by whom, when and what happened", async () => {
    const w = F.createWorld();
    const r = F.toQueued(w, F.defenceNoticeDraft(), {
      model: F.projectedModel({ recipient_id: F.IDS.SUBJECT, recipient_class: "SUBJECT" }),
      statement: F.DEFENCE_STATEMENT,
    });
    await w.lifecycle.dispatchEmailBatch(10);
    const s = w.evidence.summary(r.notification_id, 1);
    assert.equal(s.originating_event_id, "evt-statement-requested");
    assert.deepEqual(s.template, { code: "DEFENCE_NOTICE_ISSUED", version: F.TEMPLATE_VERSION });
    assert.equal(s.policy_version, F.POLICY_VERSION);
    assert.equal(s.idempotency_key, r.idempotency_key);
    assert.deepEqual(s.recipients, [
      { recipient_id: F.IDS.SUBJECT, class: "SUBJECT", capacity: "SUBJECT_OF_PROCEEDINGS" },
    ]);
    assert.equal(s.authorizer!.id, F.IDS.CHAIR);
    assert.match(s.issued_at!, /^2026-10-27T/);
    assert.deepEqual(
      s.delivery_attempts.map((a) => a.status),
      ["ATTEMPTED", "ACCEPTED_BY_PROVIDER"],
    );
    assert.deepEqual(
      s.transitions.map((t) => t.to),
      ["DRAFT", "VALIDATED", "AUTHORIZATION_PENDING", "AUTHORIZED", "QUEUED", "SENT"],
      "ACCEPTANCE: sent, delivery not confirmed (L-07)",
    );
    assert.equal(s.chain_ok, true);
    assert.deepEqual(
      s.source_refs.map((x) => x.kind),
      ["EVENT", "OBJECT", "CASE"],
    );
  });
  test("LC-13 content-like keys are refused by the store", () => {
    const ev = createEvidenceStore();
    for (const data of [
      { subject: "x" },
      { body_html: "<p>" },
      { recipient_email: "a" },
      { nested: { narrative: "x" } },
      { reporter_name: "x" },
    ]) {
      assert.throws(
        () => ev.append({ notification_id: "ntf-x", version: 1, kind: "EXPORT", data }),
        (e: unknown) => (e as { code?: unknown }).code === "CONTENT_NOT_ALLOWED",
      );
    }
    assert.throws(
      // @ts-expect-error -- an unknown evidence kind on purpose (must be refused)
      () => ev.append({ notification_id: "ntf-x", version: 1, kind: "OTHER", data: {} }),
      (e: unknown) => (e as { code?: unknown }).code === "INVALID_KIND",
    );
    assert.ok(EVIDENCE_KINDS.includes("REFUSAL"));
  });
});

// ================================================================================== acknowledgement ===============
describe("LC-14 recipient acknowledgement is an Event, never a state", () => {
  test("LC-14 acknowledging appends RECIPIENT_ACKNOWLEDGED and leaves status and revision untouched", () => {
    const { w, r } = reach("DELIVERY_CONFIRMED");
    const out = w.lifecycle.acknowledge(r, { actor: { capacity: "MEMBER", id: F.IDS.MEMBER } });
    assert.equal(out.event.type, "RECIPIENT_ACKNOWLEDGED");
    assert.deepEqual(
      out.event.actor,
      { capacity: "COMMITTEE_MEMBER", id: F.IDS.MEMBER },
      "capacity comes from the resolution, not the caller",
    );
    const now = w.lifecycle.get(r.notification_id);
    assert.deepEqual([now!.status, now!.revision], [r.status, r.revision]);
    assert.ok(!NOTIFICATION_STATUSES.some((s) => /ACK/.test(s)));
    assert.equal(w.evidence.summary(r.notification_id, 1).acknowledgements.length, 1);
    const again = w.lifecycle.acknowledge(now, { actor: { capacity: "MEMBER", id: F.IDS.MEMBER } });
    assert.equal(again.duplicate, true);
    assert.equal(w.ledger.list({ type: "RECIPIENT_ACKNOWLEDGED" }).length, 1);
  });
  test("LC-14 nothing to acknowledge before SENT; delivery attempts never carry an acknowledgement status", async () => {
    const { w, r } = reach("QUEUED");
    assert.throws(
      () => w.lifecycle.acknowledge(r, { actor: { capacity: "MEMBER", id: F.IDS.MEMBER } }),
      code("NOT_ACKNOWLEDGEABLE"),
    );
    await w.lifecycle.dispatchEmailBatch(10);
    const statuses = new Set(w.evidence.summary(r.notification_id, 1).delivery_attempts.map((a) => a.status));
    for (const s of statuses)
      assert.ok(["ATTEMPTED", "ACCEPTED_BY_PROVIDER", "FAILED", "BOUNCED"].includes(s as string));
  });
  test("LC-14 reading an in-app notification is not acknowledging it (NOTIFICATION_READ ≠ RECIPIENT_ACKNOWLEDGED)", () => {
    const w = F.createWorld();
    const r = F.toQueued(w, F.invitationDraft({ channel: "IN_APP" }));
    w.outbox.markRead(r.outbox!.row_id, F.IDS.MEMBER);
    assert.equal(w.ledger.list({ type: "NOTIFICATION_READ" }).length, 1);
    assert.equal(w.ledger.list({ type: "RECIPIENT_ACKNOWLEDGED" }).length, 0);
  });
  test("LC-14 a recorded acknowledgement is what lets a later notice say «acknowledged» (PC-16 through the ledger)", () => {
    const { w, r } = reach("DELIVERY_CONFIRMED");
    const lc = w.lifecycle;
    const ack = lc.acknowledge(r, { actor: { capacity: "MEMBER", id: F.IDS.MEMBER } });
    const follow = lc.draft(
      F.invitationDraft({
        type_code: "MINUTES_REVIEW_REMINDER",
        originating_event_id: "evt-meeting-scheduled",
      }),
    ).record;
    const delivered = w.ledger.list({ type: "DELIVERY_CONFIRMED" }).at(-1)!.event_id;
    assert.throws(
      () =>
        lc.transition(follow, "VALIDATED", {
          actor: SEC,
          model: modelFor(follow),
          statement: { claims: { acknowledged: { value: true, basis_event_id: delivered } } },
        }),
      (e) =>
        code("CONSISTENCY_BLOCKED")(e) &&
        det(e).violations.some(
          (v) => v.id === "PC-16" && v.detail.reason === "DELIVERY_USED_AS_ACKNOWLEDGEMENT",
        ),
    );
    const ok = lc.transition(follow, "VALIDATED", {
      actor: SEC,
      model: modelFor(follow),
      statement: { claims: { acknowledged: { value: true, basis_event_id: ack.event.event_id } } },
    });
    assert.equal(ok.record.status, "VALIDATED");
  });
});

// ============================================================================================= export ===============
describe("LC-15 EML export never changes state or the outbox", () => {
  for (const state of [
    "DRAFT",
    "VALIDATED",
    "AUTHORIZED",
    "QUEUED",
    "SENT",
    "DELIVERY_CONFIRMED",
    "DELIVERY_FAILED",
    "CANCELLED",
    "CORRECTED",
    "SUPERSEDED",
  ]) {
    test(`LC-15 export in ${state}`, () => {
      const { w, r } = reach(state);
      const rows = JSON.stringify(w.outbox.rows());
      const types = w.ledger.list().map((e) => e.type);
      const out = w.lifecycle.exportEml(r, { rendered: F.renderedFor(), model: modelFor(r), actor: SEC });
      const now = w.lifecycle.get(r.notification_id, r.version);
      assert.deepEqual([now!.status, now!.revision], [r.status, r.revision], "state unchanged");
      assert.equal(JSON.stringify(w.outbox.rows()), rows, "outbox unchanged");
      assert.deepEqual(
        w.ledger.list().map((e) => e.type),
        [...types, "NOTIFICATION_EXPORTED"],
        "only the export is recorded",
      );
      assert.equal(out.headers["X-CDF-Lifecycle-State"], state);
      assert.equal(out.headers["X-Unsent"], "1");
      assert.equal(w.evidence.summary(r.notification_id, r.version).exports.at(-1)!.eml_sha256, out.sha256);
    });
  }
});

// ===================================================================================== platform mirror ============
describe("LC-16 the in-app channel mirrors notify.enqueue: inserted SENT, delivered into the inbox", () => {
  test("LC-16 QUEUED → SENT → DELIVERY_CONFIRMED in one step; the row is visible to its recipient only", () => {
    const w = F.createWorld();
    const r = F.toQueued(w, F.invitationDraft({ channel: "IN_APP" }));
    assert.equal(r.status, "DELIVERY_CONFIRMED");
    assert.deepEqual(
      w.lifecycle
        .history(r.notification_id)
        .map((e) => e.type)
        .slice(-3),
      ["NOTIFICATION_QUEUED", "NOTIFICATION_SENT", "DELIVERY_CONFIRMED"],
    );
    const row = w.outbox.getRow(r.outbox!.row_id);
    assert.deepEqual([row!.status, row!.attempts, row!.channel], ["SENT", 0, "IN_APP"]);
    assert.equal(row!.delivered_at, w.evidence.summary(r.notification_id, 1).issued_at);
    assert.equal(w.outbox.listForRecipient(F.IDS.MEMBER).length, 1);
    assert.equal(w.outbox.listForRecipient(F.IDS.MEMBER_2).length, 0);
    assert.throws(
      () => w.outbox.markRead(row!.id, F.IDS.MEMBER_2),
      (e: unknown) => (e as { code?: unknown }).code === "NOT_FOUND",
    );
  });
});

describe("LC-17 enqueue refusals keep the record where it was", () => {
  test("LC-17 inactive recipient → ENQUEUE_NOT_INSERTED (RECIPIENT_NOT_ACTIVE, 1920:254), record stays AUTHORIZED", () => {
    const { w, r } = reach("AUTHORIZED", { draft: { recipient_id: F.IDS.INACTIVE_MEMBER } });
    assert.throws(
      () => w.lifecycle.transition(r, "QUEUED", { actor: SEC }),
      (e) => code("ENQUEUE_NOT_INSERTED")(e) && det(e).outbox_reason === "RECIPIENT_NOT_ACTIVE",
    );
    assert.equal(w.lifecycle.get(r.notification_id)!.status, "AUTHORIZED");
    assert.equal(w.outbox.rows().length, 0);
    assert.equal(
      w.evidence.summary(r.notification_id, 1).refusals.at(-1)!.reason_code,
      "ENQUEUE_NOT_INSERTED",
    );
  });
  test("LC-17 a type whose template is not in notify.template → OUTBOX_REJECTED (UNKNOWN_TEMPLATE; GAP-OUT-02)", () => {
    const types = {
      ...F.NOTIFICATION_TYPES,
      DECISION_NOTICE: {
        template_code: "DECISION_NOTICE_ISSUED",
        channels: ["EMAIL"],
        approval: { required: false },
      },
    };
    const map = {
      ...F.RECIPIENT_MAP,
      [`DECISION_NOTICE:${F.IDS.MEETING}`]: [
        { recipient_id: F.IDS.MEMBER, class: "MEMBER", capacity: "COMMITTEE_MEMBER" },
      ],
    };
    const w = F.createWorld({ types, recipientMap: map });
    let r = w.lifecycle.draft(F.invitationDraft({ type_code: "DECISION_NOTICE" })).record;
    r = w.lifecycle.transition(r, "VALIDATED", {
      actor: SEC,
      model: modelFor(r),
      statement: F.INVITATION_STATEMENT,
    }).record;
    r = w.lifecycle.transition(r, "AUTHORIZED", { actor: SEC }).record;
    assert.throws(
      () => w.lifecycle.transition(r, "QUEUED", { actor: SEC }),
      (e) => code("OUTBOX_REJECTED")(e) && det(e).outbox_code === "UNKNOWN_TEMPLATE",
    );
  });
});

describe("LC-18 dispatch mirrors createNotificationService().dispatchEmail (notifications.ts:27-41)", () => {
  test("LC-18 rows the lifecycle did not create are dispatched as the platform would (emit_due_reminders, idempotent)", async () => {
    const w = F.createWorld();
    const notices = [
      {
        notice_id: F.IDS.DEFENCE_NOTICE,
        recipient_id: F.IDS.SUBJECT,
        status: "ISSUED",
        due_at: "2026-10-28T09:00:00+03:00",
      },
    ];
    assert.equal(w.outbox.emitDueReminders(notices, "2026-10-27T06:00:00Z"), 1);
    assert.equal(w.outbox.emitDueReminders(notices, "2026-10-27T06:00:00Z"), 0, "once per notice (1920:632)");
    assert.deepEqual(
      w.outbox
        .rows()
        .map((x) => x.channel)
        .sort(),
      ["EMAIL", "IN_APP"],
    );
    const res = await w.lifecycle.dispatchEmailBatch(10);
    assert.deepEqual(res, { sent: 1, failed: 0, retrying: 0, suppressed: 0, unmanaged: 1 });
    assert.deepEqual(Object.keys(w.sender.calls()[0]!).sort(), [
      "attempts",
      "deepLink",
      "id",
      "recipientId",
      "template",
    ]);
  });
  test("LC-18 limit is validated as claim_email_batch does (1..100)", async () => {
    const w = F.createWorld();
    await assert.rejects(
      () => w.lifecycle.dispatchEmailBatch(0),
      (e: unknown) => (e as { code?: unknown }).code === "INVALID_LIMIT",
    );
    await assert.rejects(
      () => w.lifecycle.dispatchEmailBatch(101),
      (e: unknown) => (e as { code?: unknown }).code === "INVALID_LIMIT",
    );
  });
});

describe("LC-19 every transition appends one charter Event and one evidence record; the ledger verifies", () => {
  test("LC-19 full approval path: 7 states, 7 Events, 7 TRANSITION records, intact hash chain", async () => {
    const w = F.createWorld({ lifecycle: SETTLEMENT }); // explicit: the seventh state is the settlement's DELIVERY_CONFIRMED (L-07)
    const r = F.toQueued(w, F.defenceNoticeDraft(), {
      model: F.projectedModel({ recipient_id: F.IDS.SUBJECT, recipient_class: "SUBJECT" }),
      statement: F.DEFENCE_STATEMENT,
    });
    await w.lifecycle.dispatchEmailBatch(10);
    const events = w.lifecycle.history(r.notification_id);
    assert.equal(events.length, 7);
    assert.equal(transitionsOf(w, r).length, 7);
    for (const e of events) {
      assert.equal(e.object!.type, "NOTIFICATION");
      assert.equal(e.version, 1);
      assert.equal(e.correlation_id, r.correlation_id);
      assert.equal(e.provenance!.source, "SYNTHETIC_DEMO");
      assert.equal(e.case_id, F.IDS.CASE);
    }
    assert.deepEqual(w.ledger.verifyChain(), { ok: true, broken_seq: null, reason: null });
    const copy = w.ledger.list().map((x) => ({ ...x }));
    copy[2] = { ...copy[2]!, type: "NOTIFICATION_SENT" };
    assert.equal(verifyEntries(copy).ok, false, "a tampered copy breaks the chain");
  });
  test("LC-19 every lifecycle Event type is a charter §3.3 type or a listed PROPOSAL; audit-only actions are separate", async () => {
    const w = F.createWorld({ senderOutcomes: [true, false] });
    const lc = w.lifecycle;
    const a = F.toQueued(w);
    F.toQueued(w, F.defenceNoticeDraft(), {
      model: F.projectedModel({ recipient_id: F.IDS.SUBJECT, recipient_class: "SUBJECT" }),
      statement: F.DEFENCE_STATEMENT,
    });
    await lc.dispatchEmailBatch(10);
    lc.acknowledge(lc.get(a.notification_id), { actor: { capacity: "MEMBER", id: F.IDS.MEMBER } });
    const c = lc.transition(lc.get(a.notification_id), "CORRECTED", {
      actor: SEC,
      reason_code: "WRONG_TIME",
    });
    lc.transition(c.record, "CANCELLED", { actor: SEC, reason_code: "WITHDRAWN" });
    lc.exportEml(lc.get(a.notification_id, 1), {
      rendered: F.renderedFor(),
      model: F.projectedModel(),
      actor: SEC,
    });
    const types = new Set(
      w.ledger
        .list()
        .filter((e) => e.object?.type === "NOTIFICATION")
        .map((e) => e.type),
    );
    for (const t of types)
      assert.ok(
        CHARTER_NOTIFICATION_EVENT_TYPES.includes(t) ||
          PROPOSED_EVENT_TYPES.includes(t) ||
          AUDIT_ONLY_ACTIONS.includes(t),
        t,
      );
    assert.ok(
      types.has("NOTIFICATION_AUTHORIZATION_REQUESTED") &&
        types.has("RECIPIENT_ACKNOWLEDGED") &&
        types.has("NOTIFICATION_EXPORTED"),
    );
    assert.deepEqual(PROPOSED_EVENT_TYPES, ["NOTIFICATION_AUTHORIZATION_REQUESTED"]);
  });
});

describe("LC-20 concurrency and construction guards", () => {
  test("LC-20 a stale snapshot is refused (optimistic concurrency, like row_version)", () => {
    const { w, r } = reach("VALIDATED");
    w.lifecycle.transition(r, "AUTHORIZED", { actor: SEC });
    assert.throws(
      () => w.lifecycle.transition(r, "CANCELLED", { actor: SEC, reason_code: "STALE" }),
      code("STALE_RECORD"),
    );
    assert.throws(
      () =>
        w.lifecycle.transition({ notification_id: "ntf-unknown", version: 1, revision: 0 }, "VALIDATED", {}),
      code("UNKNOWN_NOTIFICATION"),
    );
    assert.throws(() => w.lifecycle.transition(null, "VALIDATED", {}), code("INVALID_RECORD"));
  });
  test("LC-20 the lifecycle refuses a rule set without the charter minimum, and missing dependencies", () => {
    assert.throws(
      () => F.createWorld({ lifecycle: { rules: RULES.filter((x) => x.id !== "PC-09") } }),
      /PC-09/,
    );
    assert.throws(() => createNotificationLifecycle({}), code("DEPENDENCY_MISSING"));
  });
  test("LC-20 unknown type, channel not configured, invalid ids → refused before anything is written", () => {
    const w = F.createWorld();
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ type_code: "NOT_CONFIGURED" })),
      code("UNKNOWN_NOTIFICATION_TYPE"),
    );
    assert.throws(
      () => w.lifecycle.draft(F.defenceNoticeDraft({ channel: "IN_APP" })),
      code("CHANNEL_NOT_CONFIGURED_FOR_TYPE"),
    );
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ case_id: "CDF-DEMO-2026-0001" })),
      code("INVALID_INPUT"),
    );
    assert.throws(() => w.lifecycle.draft(F.invitationDraft({ actor: undefined })), code("ACTOR_REQUIRED"));
    assert.equal(w.ledger.size(), 0);
  });
});

describe("LC-21 NOTIFICATION_SENT carries the references a journey step needs (W-C convention, PROPOSAL)", () => {
  test("LC-21 e-mail and in-app sends name the template, the type and the subject object — codes and ids only", async () => {
    const w = F.createWorld();
    const mail = F.toQueued(w);
    const inApp = F.toQueued(w, F.invitationDraft({ channel: "IN_APP", recipient_id: F.IDS.MEMBER_2 }));
    await w.lifecycle.dispatchEmailBatch(10);
    for (const r of [mail, inApp]) {
      const sent = w.lifecycle.history(r.notification_id).find((e) => e.type === "NOTIFICATION_SENT");
      assert.equal(sent!.object!.type, "NOTIFICATION");
      assert.deepEqual(
        {
          template_code: sent!.payload.template_code,
          type_code: sent!.payload.type_code,
          subject_object_type: sent!.payload.subject_object_type,
          subject_object_id: sent!.payload.subject_object_id,
        },
        {
          template_code: "MEETING_INVITATION",
          type_code: "MEETING_INVITATION",
          subject_object_type: "MEETING",
          subject_object_id: F.IDS.MEETING,
        },
      );
    }
    const keys = w.evidence.list(mail.notification_id).flatMap((e) => Object.keys(e.data));
    assert.ok(
      !keys.some((k) => k.startsWith("subject")),
      "the references stay in the ledger payload, not in evidence",
    );
  });
});

describe("LC-22 delivery confirmation (lead ruling L-07): ACCEPTANCE by default, SETTLEMENT only when configured", () => {
  test("LC-22 ACCEPTANCE (default): a sender success is ACCEPTED_BY_PROVIDER evidence; the e-mail stays SENT and DELIVERY_CONFIRMED needs a provider delivery report", async () => {
    const w = F.createWorld();
    assert.equal(w.lifecycle.deliveryConfirmation, "ACCEPTANCE");
    assert.deepEqual(DELIVERY_CONFIRMATION_MODES, ["ACCEPTANCE", "SETTLEMENT"]);
    const r = F.toQueued(w);
    const out = await w.lifecycle.dispatchEmailBatch(10);
    assert.equal(out.sent, 1);
    const sent = w.lifecycle.get(r.notification_id);
    assert.equal(sent!.status, "SENT");
    assert.equal(w.outbox.getRow(r.outbox!.row_id)!.status, "SENT");
    assert.deepEqual(
      w.evidence.summary(r.notification_id, 1).delivery_attempts.map((a) => a.status),
      ["ATTEMPTED", "ACCEPTED_BY_PROVIDER"],
    );
    assert.throws(
      () => w.lifecycle.transition(sent, "DELIVERY_CONFIRMED", {}),
      code("DELIVERY_REPORT_REQUIRED"),
    );
    assert.deepEqual(w.ledger.list({ category: "SECURITY" }).at(-1)!.payload, {
      command: "notification_settle",
      outcome: "FORBIDDEN",
    });
    assert.equal(w.ledger.list({ type: "DELIVERY_CONFIRMED" }).length, 0);
    assert.equal(w.lifecycle.get(r.notification_id)!.status, "SENT");
  });
  test("LC-22 ACCEPTANCE: IN_APP follows L-02 — the committed inbox row is SENT and DELIVERY_CONFIRMED together; a read is NOTIFICATION_READ, never an acknowledgement", () => {
    const w = F.createWorld();
    const inApp = F.toQueued(w, F.invitationDraft({ channel: "IN_APP", recipient_id: F.IDS.MEMBER_2 }));
    assert.equal(inApp.status, "DELIVERY_CONFIRMED");
    assert.equal(
      w.ledger.list({ type: "DELIVERY_CONFIRMED" }).at(-1)!.payload.evidence_kind,
      "IN_APP_ROW_CREATED",
    );
    w.outbox.markRead(inApp.outbox!.row_id, F.IDS.MEMBER_2);
    assert.equal(w.ledger.list({ type: "NOTIFICATION_READ" }).length, 1);
    assert.equal(w.ledger.list({ type: "RECIPIENT_ACKNOWLEDGED" }).length, 0);
    const now = w.lifecycle.get(inApp.notification_id);
    assert.deepEqual([now!.status, now!.revision], [inApp.status, inApp.revision]);
  });
  test("LC-22 SETTLEMENT (explicit configuration): the recorded settlement confirms e-mail delivery and the Event names its evidence kind", async () => {
    const w = F.createWorld({ lifecycle: SETTLEMENT });
    assert.equal(w.lifecycle.deliveryConfirmation, "SETTLEMENT");
    const r = F.toQueued(w);
    await w.lifecycle.dispatchEmailBatch(10);
    assert.equal(w.lifecycle.get(r.notification_id)!.status, "DELIVERY_CONFIRMED");
    const confirmed = w.lifecycle.history(r.notification_id).find((e) => e.type === "DELIVERY_CONFIRMED");
    assert.equal(confirmed!.payload.evidence_kind, "SENDER_ADAPTER_REPORTED_SUCCESS");
    assert.deepEqual(
      w.evidence.summary(r.notification_id, 1).delivery_attempts.map((a) => a.status),
      ["ATTEMPTED", "ACCEPTED_BY_PROVIDER"],
    );
  });
  test("LC-22 both modes: failure after the last attempt is DELIVERY_FAILED; an unknown mode, including the retired PROVIDER_REPORT, is refused at construction", async () => {
    for (const lifecycle of [{}, SETTLEMENT]) {
      const w = F.createWorld({ lifecycle, senderDefault: false });
      const r = F.toQueued(w);
      for (let i = 0; i < 5; i += 1) await w.lifecycle.dispatchEmailBatch(10);
      assert.equal(w.lifecycle.get(r.notification_id)!.status, "DELIVERY_FAILED");
      assert.equal(
        w.ledger.list({ type: "DELIVERY_FAILED" }).at(-1)!.payload.evidence_kind,
        "OUTBOX_ATTEMPTS_EXHAUSTED",
      );
    }
    for (const mode of ["READ_RECEIPT", "PROVIDER_REPORT", ""]) {
      assert.throws(
        () => F.createWorld({ lifecycle: { deliveryConfirmation: mode } }),
        code("INVALID_CONFIGURATION"),
        mode,
      );
    }
  });
});

// ============================== optional: W-A domain model, when present (guarded; D1 per lead ruling L-04, D5 per L-07) =====
describe("LC-23 cross-check with W-A src/domain (guarded): same vocabularies; transition pairs compared with lead ruling L-04", () => {
  /** The W-A modules, imported statically (lib/domain); a missing module fails (the reference skipped). */
  interface DomainModule {
    readonly STATUS_OBJECTS?: {
      readonly NotificationStatus?: { readonly states?: unknown; readonly pairs?: unknown };
      readonly DeliveryStatus?: { readonly states?: unknown };
    };
    readonly EVENT_TYPES?: unknown;
    readonly COMMUNICATION_EVENTS?: unknown;
  }
  const MODULES: Readonly<Record<string, DomainModule | undefined>> = {
    "status.js": domainStatus as DomainModule,
    "concepts.js": domainConcepts as DomainModule,
  };
  const load = async (t: TestContext, file: string): Promise<DomainModule | null> => {
    const mod = MODULES[file];
    // Port: the domain modules are static imports, so a missing one fails (no skipped test in the committed suite).
    assert.ok(mod, `lib/domain/${file.replace(/\.js$/, ".ts")} not loadable (W-A)`);
    return mod;
  };
  const pairSet = (entries: readonly (readonly [unknown, unknown])[]) =>
    new Set(entries.map(([from, to]) => `${String(from)}→${String(to)}`));
  const pairsOf = (table: Readonly<Record<string, readonly string[] | undefined>>) =>
    pairSet(
      Object.entries(table).flatMap(([from, tos]) => (tos ?? []).map((to): [string, string] => [from, to])),
    );
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

  test("LC-23 NotificationStatus and DeliveryStatus values equal W-A's (charter §3.4); W-A's transition pairs are compared with the L-04 table (D1)", async (t) => {
    const mod = await load(t, "status.js");
    if (!mod) return;
    const ns = mod.STATUS_OBJECTS?.NotificationStatus;
    const ds = mod.STATUS_OBJECTS?.DeliveryStatus;
    assert.ok(
      Array.isArray(ns?.states) && Array.isArray(ns?.pairs) && Array.isArray(ds?.states),
      "W-A STATUS_OBJECTS shape differs from the assumed one",
    );
    assert.deepEqual(
      [...ns.states].sort(),
      [...NOTIFICATION_STATUSES].sort(),
      "charter §3.4 NotificationStatus",
    );
    assert.deepEqual(
      [...ds.states].sort(),
      ["ACCEPTED_BY_PROVIDER", "ATTEMPTED", "BOUNCED", "FAILED"],
      "charter §3.4 DeliveryStatus",
    );
    const record = pairsOf(ALLOWED_TRANSITIONS);
    const lineage = pairsOf(LINEAGE_TRANSITIONS);
    const charter9 = [
      "DRAFT→VALIDATED",
      "VALIDATED→AUTHORIZATION_PENDING",
      "AUTHORIZATION_PENDING→AUTHORIZED",
      "AUTHORIZED→QUEUED",
      "QUEUED→SENT",
      "SENT→DELIVERY_CONFIRMED",
      "SENT→DELIVERY_FAILED",
      "DRAFT→CANCELLED",
      "VALIDATED→CANCELLED",
      "AUTHORIZATION_PENDING→CANCELLED",
      "AUTHORIZED→CANCELLED",
      "QUEUED→CANCELLED",
      "SENT→CORRECTED",
      "DELIVERY_CONFIRMED→CORRECTED",
      "DELIVERY_FAILED→CORRECTED",
    ];
    for (const p of charter9) assert.ok(record.has(p) || lineage.has(p), `W-D1 lacks charter §9 pair ${p}`);
    assert.deepEqual(
      charter9.filter((p) => !record.has(p)),
      [...lineage],
      "exactly the three «→ CORRECTED» pairs are lineage-level (L-04 item 5)",
    );
    const theirs = pairSet(ns.pairs);
    const both = new Set([...record, ...lineage]);
    // W-A may list the lineage-level pairs with the record-level ones or leave them out; either agrees with L-04.
    const ref = [...lineage].some((p) => theirs.has(p)) ? both : record;
    const agrees = same(theirs, ref);
    const onlyMine = [...ref].filter((p) => !theirs.has(p)).sort();
    const onlyTheirs = [...theirs].filter((p) => !ref.has(p)).sort();
    console.warn(
      "[diagnostic]",
      `D1 (L-04): W-A NotificationStatus pairs ${agrees ? `agree with the L-04 table (${ref === both ? "record + lineage level" : "record level"})` : `differ from the L-04 table — only in W-D1: ${onlyMine.join(", ") || "none"} | only in W-A: ${onlyTheirs.join(", ") || "none"}`}`,
    );
    console.warn(
      "[diagnostic]",
      `charter §9 pairs absent from W-A's table: ${charter9.filter((p) => !theirs.has(p)).join(", ") || "none"}`,
    );
    // The todo marker that stood here while W-A aligned its table was removed by the lead at integration (27 Oct 2026, work/LEAD_notes.md L-12): a disagreement now fails.
    assert.ok(agrees, "W-A src/domain/status.js NotificationStatus pairs agree with lead ruling L-04");
  });

  test("LC-23 every charter notification event the lifecycle appends is in W-A's EVENT_TYPES; W-A communication events kept as evidence are listed (D5, accepted by L-07)", async (t) => {
    const mod = await load(t, "concepts.js");
    if (!mod) return;
    assert.ok(
      Array.isArray(mod.EVENT_TYPES) && Array.isArray(mod.COMMUNICATION_EVENTS),
      "W-A EVENT_TYPES shape differs from the assumed one",
    );
    for (const type of CHARTER_NOTIFICATION_EVENT_TYPES)
      assert.ok(mod.EVENT_TYPES.includes(type), `charter §3.3 ${type} missing from W-A EVENT_TYPES`);
    const appended = new Set([...Object.values(TRANSITION_EVENT_TYPES), "RECIPIENT_ACKNOWLEDGED"]);
    console.warn(
      "[diagnostic]",
      `W-D1 PROPOSED event types present in W-A EVENT_TYPES: ${PROPOSED_EVENT_TYPES.map((e) => `${e}=${(mod.EVENT_TYPES as string[]).includes(e)}`).join(", ")}`,
    );
    const elsewhere = (mod.COMMUNICATION_EVENTS as string[]).filter((e) => !appended.has(e));
    console.warn(
      "[diagnostic]",
      `D5 (accepted, L-07): W-A communication events W-D1 records as evidence entries or audit-only actions, not as ledger Events: ${elsewhere.join(", ") || "none"}`,
    );
  });
});
