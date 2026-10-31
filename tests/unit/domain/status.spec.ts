// tests/unit/domain/status.spec.ts — CDF Notifications V13 · workstream W-A (domain model). Ported from tests/status.test.js
// (node:test → Vitest).
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
//
// The seven independent status objects (charter §3.4), the V8 case graph, the 20 concepts, the event catalogue, the
// forbidden derivations, the epistemic classes, the progress layers, the evidence-name resolver (L-06), the notification
// correction model (L-04) and the referral rulings (L-10). Test names carry ST-xx (charter §12). Sources read here, all
// required (a missing file fails the test): ./__evidence__/CHARTER.md, ./__evidence__/V13-02_concepts.csv,
// ./__evidence__/level2_journeys.json and ./__evidence__/v9_data.json (synthetic copies of reference files outside src/).
// The checks against the journeys and authority data files moved to tests/unit/journeys/domain-scenarios.spec.ts (ST-29b,
// ST-32b, ST-34) and tests/unit/authority/domain-evidence-names.spec.ts (ST-28b), which land with those files. The master
// execution directive (an owner message) is not in the repository: ST-33 keeps its directive-free assertions.
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "@/lib/domain/concepts";
import * as S from "@/lib/domain/status";
import * as EP from "@/lib/domain/epistemic";
import type { DomainEvent, Guard, HoldRow, ObjectRef, Payload, TransitionRow } from "@/lib/domain/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "__evidence__");
/** The reference path (relative to tests/) → its synthetic evidence copy. Every source is required: a missing copy throws. */
const EVIDENCE_FILES: Record<string, string> = {
  "../CHARTER.md": "CHARTER.md",
  "../work/V13-02_concepts.csv": "V13-02_concepts.csv",
  "../../journeys/level2_journeys.json": "level2_journeys.json",
  "../../generator/source/tests/v9_data.json": "v9_data.json",
};
const read = (rel: string): string => {
  const name = EVIDENCE_FILES[rel];
  if (name === undefined) throw new Error(`no evidence copy for ${rel}`);
  return readFileSync(join(EVIDENCE, name), "utf8");
};
const CHARTER = read("../CHARTER.md");
// Shapes of the JSON files read here (the fields the checks use).
interface Level2File {
  master: { code: string; key: string; ar: string; en: string }[];
  master_sub_en: Record<string, string>;
  assignments: { master: string }[];
}
interface V9File {
  substates: { code: string; main: string; key: string; name: string }[];
  transitions: { id: string; frm: string; to: string; event: string }[];
}
const throwsCode = (fn: () => unknown, code: string): void =>
  assert.throws(
    fn,
    (e: unknown) => !!e && (e as { code?: unknown }).code === code,
    `expected DomainError ${code}`,
  );

const u = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let seq = 0;
type Ev = DomainEvent & { occurred_at: string; recorded_at: string; object: ObjectRef; payload: Payload };
function ev(type: string, object: ObjectRef, payload: Payload = {}, extra: Partial<DomainEvent> = {}): Ev {
  seq += 1;
  const t = new Date(Date.parse("2026-10-01T08:00:00Z") + seq * 60e3).toISOString();
  return {
    event_id: `evt-st-${String(seq).padStart(4, "0")}`,
    type,
    occurred_at: t,
    recorded_at: t,
    case_id: u(1),
    object,
    actor: { capacity: "SECRETARY", id: "usr-secretary-01" },
    provenance: { source: "SYNTHETIC_DEMO", ref: "tests/status.test.js" },
    version: 1,
    causation_id: null,
    correlation_id: "corr-st",
    payload,
    ...extra,
  } as Ev;
}
const ref = (type: string, id: string): ObjectRef => ({ type, id });

// FACT: CHARTER.md §3.4 (copied); ST-01 also re-reads the charter.
const CHARTER_ENUMS = {
  ProcedureStatus: [
    "NOT_STARTED",
    "OPEN",
    "IN_PROGRESS",
    "ON_HOLD",
    "RETURNED",
    "COMPLETED",
    "CANCELLED",
    "FAILED",
    "NOT_APPLICABLE",
  ],
  TaskStatus: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "SUBMITTED", "RETURNED", "COMPLETED", "CANCELLED"],
  MeetingStatus: [
    "SCHEDULED",
    "RESCHEDULED",
    "CANCELLED",
    "OPENED",
    "CLOSED",
    "MINUTES_DRAFT",
    "MINUTES_UNDER_REVIEW",
    "MINUTES_FINAL",
  ],
  DecisionStatus: [
    "DRAFT",
    "UNDER_VOTE",
    "ADOPTED",
    "NOT_ADOPTED",
    "RETURNED",
    "SUBMITTED_TO_AUTHORITY",
    "DECIDED",
    "SUPERSEDED",
  ],
  NotificationStatus: [
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
  ],
  DeliveryStatus: ["ATTEMPTED", "ACCEPTED_BY_PROVIDER", "FAILED", "BOUNCED"],
};

function charterEnums(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\| (\w+Status)[^|]*\| ([^|]+) \|\s*$/);
    if (!m) continue;
    out[m[1]!] = m[2]!
      .split(/ \(|;/)[0]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return out;
}
const fold = (type: string, id: string, events: DomainEvent[]): string | null =>
  S.statusFromEvents(type, id, events).status;
/** STATUS_OBJECTS indexed by a computed name (the reference indexes by a string). */
const SO = S.STATUS_OBJECTS as unknown as Readonly<Record<string, S.AnyStatusObject>>;

describe("ST status objects", () => {
  test("ST-01 the seven status objects and their enums equal CHARTER.md §3.4", () => {
    assert.deepEqual(S.STATUS_OBJECT_NAMES, [
      "CaseStatus",
      "ProcedureStatus",
      "TaskStatus",
      "MeetingStatus",
      "DecisionStatus",
      "NotificationStatus",
      "DeliveryStatus",
    ]);
    for (const [name, states] of Object.entries(CHARTER_ENUMS))
      assert.deepEqual([...SO[name]!.states], states, name);
    assert.equal(S.STATUS_OBJECTS.CaseStatus.states.length, 28);
    assert.deepEqual(
      [...S.STATUS_OBJECTS.CaseStatus.flags!],
      ["suspended", "returned", "cancelled", "reopened", "closed"],
    );
    assert.deepEqual([...S.STATUS_OBJECTS.TaskStatus.derived_flags], ["OVERDUE"]);
    for (const n of S.STATUS_OBJECT_NAMES) {
      const o: S.AnyStatusObject = S.STATUS_OBJECTS[n];
      assert.ok(Object.isFrozen(o) && Object.isFrozen(o.states) && Object.isFrozen(o.pairs), `${n} frozen`);
      assert.match(o.ar, /[؀-ۿ]/);
      for (const s of o.states)
        assert.ok(o.labels[s] && /[؀-ۿ]/.test(o.labels[s]!.ar) && o.labels[s]!.en, `${n}.${s} label`);
      assert.ok(o.platform_alignment.length > 0, `${n} platform alignment`);
      for (const a of o.platform_alignment)
        assert.ok(a.ref && a.mapping && C.LABELS.includes(a.label), `${n} alignment row`);
    }
    assert.deepEqual(Object.keys(S.PLATFORM_ALIGNMENT), S.STATUS_OBJECT_NAMES);
    {
      const parsed = charterEnums(CHARTER);
      for (const [name, states] of Object.entries(CHARTER_ENUMS))
        assert.deepEqual(parsed[name], states, `charter row ${name}`);
      assert.match(CHARTER, /\| CaseStatus \| V8 codes S1\.01 … S5\.xx \(28\) \+ flags/);
    }
  });

  test("ST-02 V8 case graph facts: 5 stages, 28 codes, 34 transitions, one entry, two terminals, backward and skip-ahead sets", () => {
    assert.equal(S.MASTER_STAGES.length, 5);
    assert.equal(S.V8_CODES.length, 28);
    assert.equal(S.V8_TRANSITIONS.length, 34);
    assert.deepEqual(S.STAGE_CODES, ["S1", "S2", "S3", "S4", "S5"]);
    assert.deepEqual(
      S.V8_SUBSTATES.map((s) => s.stage).reduce(
        (m: Record<string, number>, s) => ({ ...m, [s]: (m[s] || 0) + 1 }),
        {},
      ),
      { S1: 4, S2: 5, S3: 7, S4: 5, S5: 7 },
    );
    assert.equal(new Set(S.V8_TRANSITIONS.map((t) => t.id)).size, 34);
    const idx = (c: string): number => (S.V8_CODES as readonly string[]).indexOf(c);
    for (const t of S.V8_TRANSITIONS) assert.ok(idx(t.from) >= 0 && idx(t.to) >= 0, t.id);
    const indeg = S.V8_CODES.filter((c) => !S.V8_TRANSITIONS.some((t) => t.to === c));
    const outdeg = S.V8_CODES.filter((c) => !S.V8_TRANSITIONS.some((t) => t.from === c));
    assert.deepEqual(indeg, [S.CASE_ENTRY_CODE]);
    assert.deepEqual(outdeg, [...S.CASE_TERMINAL_CODES]);
    const seen = new Set<string>(["S1.01"]);
    const queue: string[] = ["S1.01"];
    while (queue.length) {
      const c = queue.shift();
      for (const t of S.V8_TRANSITIONS)
        if (t.from === c && !seen.has(t.to)) {
          seen.add(t.to);
          queue.push(t.to);
        }
    }
    assert.equal(seen.size, 28, "all 28 reachable from S1.01");
    assert.deepEqual(
      S.V8_TRANSITIONS.filter((t) => idx(t.to) < idx(t.from)).map((t) => t.id),
      [...S.BACKWARD_TRANSITIONS],
    );
    const firstOf = (stage: string | undefined): string =>
      S.V8_SUBSTATES.find((s) => s.stage === stage)!.code;
    const nextStage = (stage: S.StageCode): string | undefined =>
      S.STAGE_CODES[S.STAGE_CODES.indexOf(stage) + 1];
    const skip = S.V8_TRANSITIONS.filter(
      (t) => S.stageOf(t.from) !== S.stageOf(t.to) && t.to !== firstOf(nextStage(S.stageOf(t.from))),
    ).map((t) => t.id);
    assert.deepEqual(skip, [...S.SKIP_AHEAD_TRANSITIONS]);
    assert.equal(S.stageOf("S4.04"), "S4");
    throwsCode(() => S.stageOf("S9.99"), "UNKNOWN_V8_CODE");
    assert.equal(S.isV8Code("S5.07"), true);
    assert.equal(S.isV8Code("IR-S5-02"), false);
    assert.equal(S.v8Transition("S4.04", "S4.05")!.id, "T25");
    assert.equal(S.v8Transition("S2.01", "S4.04"), null);
  });

  test("ST-03 ProcedureStatus table (procedure, investigation, referral, report, ballot, legal opinion)", () => {
    const so = "ProcedureStatus";
    assert.equal(S.canTransition(so, "NOT_STARTED", "OPEN"), true);
    assert.equal(S.canTransition(so, "OPEN", "COMPLETED"), true);
    assert.equal(S.canTransition(so, "ON_HOLD", "IN_PROGRESS"), true);
    assert.equal(S.canTransition(so, "COMPLETED", "IN_PROGRESS"), false);
    assert.equal(S.canTransition(so, "NOT_APPLICABLE", "OPEN"), false);
    assert.equal(S.canTransition("PROCEDURE", null, "OPEN"), true);
    assert.equal(S.canTransition("BALLOT", "NOT_STARTED", "NOT_APPLICABLE"), true);
    assert.equal(
      S.canTransition("BALLOT", "OPEN", "IN_PROGRESS"),
      false,
      'a ballot is open or completed, never "in progress"',
    );
    assert.equal(S.canTransition("LEGAL_OPINION", "OPEN", "COMPLETED"), true);
    assert.equal(
      S.canTransition("REFERRAL", "FAILED", "IN_PROGRESS"),
      true,
      "a rejected referral can be objected to",
    );
    const P = u(11);
    let st: string | null = null;
    for (const [type, want] of [
      ["PROCEDURE_OPENED", "OPEN"],
      ["PROCEDURE_STARTED", "IN_PROGRESS"],
      ["PROCEDURE_SUSPENDED", "ON_HOLD"],
      ["PROCEDURE_RESUMED", "IN_PROGRESS"],
      ["PROCEDURE_COMPLETED", "COMPLETED"],
    ]) {
      st = S.applyEvent("PROCEDURE", st, ev(type!, ref("PROCEDURE", P)));
      assert.equal(st, want, type);
    }
    throwsCode(
      () => S.applyEvent("PROCEDURE", "COMPLETED", ev("PROCEDURE_STARTED", ref("PROCEDURE", P))),
      "TRANSITION_NOT_ALLOWED",
    );
    assert.equal(S.isTerminal("PROCEDURE", "COMPLETED"), true);
    assert.equal(S.isTerminal("PROCEDURE", "FAILED"), false);
  });

  test("ST-04 TaskStatus table; OVERDUE is derived (isOverdue), never stored", () => {
    assert.equal(S.canTransition("TaskStatus", "ASSIGNED", "ACCEPTED"), true);
    assert.equal(S.canTransition("TaskStatus", "SUBMITTED", "RETURNED"), true);
    assert.equal(
      S.canTransition("TaskStatus", "ASSIGNED", "COMPLETED"),
      false,
      "no completion without an output",
    );
    assert.equal(S.canTransition("TaskStatus", "ASSIGNED", "OVERDUE"), false);
    assert.equal(S.canTransition("TASK", null, "ASSIGNED"), true);
    assert.equal(
      S.canTransition("IMPLEMENTATION_ACTION", "ASSIGNED", "COMPLETED"),
      false,
      "owner declaration then verification",
    );
    assert.equal(
      S.applyEvent(
        "IMPLEMENTATION_ACTION",
        "ASSIGNED",
        ev("ACTION_COMPLETED", ref("IMPLEMENTATION_ACTION", u(18))),
      ),
      "SUBMITTED",
    );
    assert.equal(
      S.applyEvent(
        "IMPLEMENTATION_ACTION",
        "SUBMITTED",
        ev("ACTION_VERIFIED", ref("IMPLEMENTATION_ACTION", u(18))),
      ),
      "COMPLETED",
    );
    const base = {
      type: "TASK",
      status: "ASSIGNED",
      deadlines: [
        {
          kind: "STATEMENT_DUE",
          at: "2026-10-20T09:00:00Z",
          basis_event_id: "evt-t-01",
          basis_rule: "SYNTHETIC-RULE-01",
        },
      ],
    };
    assert.deepEqual(S.isOverdue(base, "2026-10-27T12:00:00Z").reason, "DEADLINE_PASSED");
    assert.equal(S.isOverdue(base, "2026-10-27T12:00:00Z").overdue, true);
    assert.equal(S.isOverdue(base, "2026-10-01T12:00:00Z").reason, "NOT_YET_DUE");
    assert.equal(
      S.isOverdue({ ...base, status: "COMPLETED" }, "2026-10-27T12:00:00Z").reason,
      "TERMINAL_STATUS",
    );
    assert.equal(S.isOverdue({ ...base, deadlines: [] }, "2026-10-27T12:00:00Z").reason, "NO_DEADLINE");
    const sr = S.isOverdue(
      { ...base, deadlines: [{ ...base.deadlines[0], basis_rule: "SOURCE_REQUIRED" }] },
      "2026-10-27T12:00:00Z",
    );
    assert.deepEqual([sr.overdue, sr.reason], [null, "SOURCE_REQUIRED"]);
    throwsCode(
      () => S.isOverdue({ type: "MEETING", status: "SCHEDULED" }, "2026-10-27T12:00:00Z"),
      "NOT_A_TASK",
    );
    throwsCode(() => S.isOverdue(base, "yesterday"), "INVALID_NOW");
  });

  test("ST-05 MeetingStatus table: scheduling or invitation never makes a meeting held", () => {
    assert.equal(S.canTransition("MeetingStatus", "SCHEDULED", "OPENED"), true);
    assert.equal(S.canTransition("MeetingStatus", "SCHEDULED", "CLOSED"), false);
    assert.equal(S.canTransition("MeetingStatus", "RESCHEDULED", "MINUTES_FINAL"), false);
    assert.equal(
      S.canTransition("MeetingStatus", "MINUTES_UNDER_REVIEW", "MINUTES_DRAFT"),
      true,
      "changes requested",
    );
    assert.equal(S.canTransition("HEARING", "OPENED", "CLOSED"), true);
    const M = u(12);
    const evs = [ev("MEETING_SCHEDULED", ref("MEETING", M)), ev("MEETING_CLOSED", ref("MEETING", M))];
    throwsCode(() => S.statusFromEvents("MEETING", M, evs), "TRANSITION_NOT_ALLOWED");
    assert.equal(S.isTerminal("MEETING", "MINUTES_FINAL"), true);
    assert.equal(S.isTerminal("MEETING", "CANCELLED"), true);
    assert.deepEqual([...S.STATUS_OBJECTS.MeetingStatus.active], ["SCHEDULED", "RESCHEDULED", "OPENED"]);
  });

  test("ST-06 DecisionStatus table: adoption, submission and the authority decision are separate; RETURN_TO_COMMITTEE is not DECIDED", () => {
    const R = u(14);
    const D = u(16);
    assert.equal(S.canTransition("RECOMMENDATION", "DRAFT", "UNDER_VOTE"), true);
    assert.equal(S.canTransition("RECOMMENDATION", "UNDER_VOTE", "DECIDED"), false);
    assert.equal(S.canTransition("DECISION", null, "SUBMITTED_TO_AUTHORITY"), true);
    assert.equal(
      S.canTransition("DECISION", null, "DRAFT"),
      false,
      "the decision object starts at submission",
    );
    assert.equal(S.canTransition("DECISION", "DRAFT", "UNDER_VOTE"), false);
    assert.equal(S.canTransition("DecisionStatus", "UNDER_VOTE", "NOT_ADOPTED"), true);
    const decide = (outcome: string | undefined) =>
      ev("AUTHORITY_DECISION_RECORDED", ref("DECISION", D), outcome === undefined ? {} : { outcome });
    assert.equal(
      S.applyEvent("DECISION", "SUBMITTED_TO_AUTHORITY", decide("APPROVE_AS_RECOMMENDED")),
      "DECIDED",
    );
    assert.equal(
      S.applyEvent("DECISION", "SUBMITTED_TO_AUTHORITY", decide("RETURN_TO_COMMITTEE")),
      "RETURNED",
    );
    throwsCode(
      () => S.applyEvent("DECISION", "SUBMITTED_TO_AUTHORITY", decide(undefined)),
      "TRANSITION_NOT_ALLOWED",
    );
    assert.equal(
      S.applyEvent(
        "RECOMMENDATION",
        "UNDER_VOTE",
        ev("RECOMMENDATION_NOT_ADOPTED", ref("RECOMMENDATION", R)),
      ),
      "NOT_ADOPTED",
    );
    throwsCode(
      () =>
        S.applyEvent(
          "RECOMMENDATION",
          "DRAFT",
          ev("LEGAL_OPINION_SUBMITTED", ref("LEGAL_OPINION", u(15)), { target: ref("RECOMMENDATION", R) }),
        ),
      "NOT_A_DRIVING_EVENT",
    );
    assert.deepEqual([...S.STATUS_OBJECTS.DecisionStatus.terminal], ["SUPERSEDED"]);
  });

  test("ST-07 NotificationStatus: the record-level table of work/LEAD_notes.md L-04; the three charter §9 «→ CORRECTED» pairs are lineage-level; labels; acknowledgement drives nothing", () => {
    const so = "NotificationStatus";
    const o: S.AnyStatusObject = S.STATUS_OBJECTS.NotificationStatus;
    const chain = [
      "DRAFT",
      "VALIDATED",
      "AUTHORIZATION_PENDING",
      "AUTHORIZED",
      "QUEUED",
      "SENT",
      "DELIVERY_CONFIRMED",
    ];
    for (let i = 1; i < chain.length; i++)
      assert.equal(S.canTransition(so, chain[i - 1], chain[i]), true, `${chain[i - 1]}→${chain[i]}`);
    // FACT: work/LEAD_notes.md L-04 items 1, 2 and 5 (record level; lead decision, binding for V13)
    const L04 = {
      DRAFT: ["VALIDATED", "CANCELLED"],
      VALIDATED: ["AUTHORIZATION_PENDING", "AUTHORIZED", "CANCELLED"],
      AUTHORIZATION_PENDING: ["AUTHORIZED", "CANCELLED"],
      AUTHORIZED: ["QUEUED", "CANCELLED"],
      QUEUED: ["SENT", "CANCELLED"],
      SENT: ["DELIVERY_CONFIRMED", "DELIVERY_FAILED", "SUPERSEDED"],
      DELIVERY_CONFIRMED: ["SUPERSEDED"],
      DELIVERY_FAILED: ["SUPERSEDED"],
      CORRECTED: ["VALIDATED", "CANCELLED"],
    };
    const flat = (tbl: Readonly<Record<string, readonly string[] | undefined>>) =>
      Object.entries(tbl)
        .flatMap(([f, ts]) => (ts as readonly string[]).map((x) => `${f}→${x}`))
        .sort();
    const pairsText = (ps: readonly (readonly [string | null, string])[]) => ps.map(([f, x]) => `${f}→${x}`);
    assert.deepEqual(pairsText(o.pairs).sort(), flat(L04));
    assert.equal(o.pairs.length, 18);
    assert.deepEqual(
      [...o.initial],
      ["DRAFT", "CORRECTED"],
      "version 1 starts in DRAFT, a correcting version in CORRECTED (L-04 item 1)",
    );
    assert.deepEqual([...o.terminal], ["CANCELLED", "SUPERSEDED"]);
    for (const s of S.ISSUED_NOTIFICATION_STATES) {
      assert.equal(
        S.canTransition(so, s, "CORRECTED"),
        false,
        `${s}→CORRECTED is a lineage step (L-04 item 5), not a move of the record`,
      );
      assert.equal(S.canTransition(so, s, "SUPERSEDED"), true, `${s}→SUPERSEDED (L-04 item 2)`);
      assert.equal(S.canCorrect(s), true, `canCorrect(${s})`);
    }
    for (const s of [
      "DRAFT",
      "VALIDATED",
      "AUTHORIZATION_PENDING",
      "AUTHORIZED",
      "QUEUED",
      "CANCELLED",
      "CORRECTED",
      "SUPERSEDED",
    ])
      assert.equal(S.canCorrect(s), false, `canCorrect(${s})`);
    assert.equal(
      S.canTransition(so, "CORRECTED", "SUPERSEDED"),
      false,
      "a correction is superseded only once it is issued",
    );
    assert.equal(
      S.canTransition(so, "CORRECTED", "VALIDATED"),
      true,
      "consistency, disclosure and authority run again (L-04 item 1)",
    );
    assert.deepEqual(pairsText(o.lineage_pairs), [
      "SENT→CORRECTED",
      "DELIVERY_CONFIRMED→CORRECTED",
      "DELIVERY_FAILED→CORRECTED",
    ]);
    assert.ok(
      Object.isFrozen(S.LINEAGE_TRANSITIONS) &&
        Object.values(S.LINEAGE_TRANSITIONS).every((v) => Object.isFrozen(v)),
    );
    assert.deepEqual(JSON.parse(JSON.stringify(S.LINEAGE_TRANSITIONS)), {
      SENT: ["CORRECTED"],
      DELIVERY_CONFIRMED: ["CORRECTED"],
      DELIVERY_FAILED: ["CORRECTED"],
    });
    assert.deepEqual([...S.ISSUED_NOTIFICATION_STATES], ["SENT", "DELIVERY_CONFIRMED", "DELIVERY_FAILED"]);
    assert.deepEqual(
      [...S.PENDING_CORRECTION_STATES],
      ["CORRECTED", "VALIDATED", "AUTHORIZATION_PENDING", "AUTHORIZED", "QUEUED"],
    );
    // charter §9 lists 15 pairs; exactly its three «→ CORRECTED» pairs are lineage-level (L-04 item 5)
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
    const record = new Set(pairsText(o.pairs));
    const lineage = new Set(pairsText(o.lineage_pairs));
    for (const p of charter9) assert.ok(record.has(p) || lineage.has(p), `charter §9 pair ${p}`);
    assert.deepEqual(
      charter9.filter((p) => !record.has(p)),
      [...lineage],
    );
    if (CHARTER) {
      const line = CHARTER.split("\n").find((l) =>
        l.startsWith("States and allowed transitions: DRAFT → VALIDATED"),
      );
      assert.ok(line, "charter §9 transitions line");
      for (const s of [
        "DRAFT/VALIDATED/AUTHORIZATION_PENDING/AUTHORIZED/QUEUED → CANCELLED",
        "SENT/DELIVERY_* → CORRECTED (new version, old SUPERSEDED)",
        "Recipient acknowledgement is an event, never a lifecycle state.",
      ])
        assert.ok(line.includes(s), s);
    }
    for (const [f, x] of [
      ["SENT", "CANCELLED"],
      ["DRAFT", "SENT"],
      ["QUEUED", "DELIVERY_CONFIRMED"],
      ["DELIVERY_CONFIRMED", "DELIVERY_FAILED"],
      ["DRAFT", "ACKNOWLEDGED"],
      ["SUPERSEDED", "SENT"],
      ["CANCELLED", "VALIDATED"],
      ["CORRECTED", "SENT"],
    ])
      assert.equal(S.canTransition(so, f, x), false, `${f}→${x}`);
    assert.ok(!o.states.includes("ACKNOWLEDGED") && !o.states.includes("READ"));
    // labels: the one catalogue wording for SENT (work/LEAD_notes.md L-08, W-E C-18) and the CORRECTED wording (W-D1 LC-23)
    assert.equal(o.labels.SENT!.ar, "أُرسل — لم يُؤكَّد التسليم");
    assert.equal(o.labels.SENT!.en, "Sent — delivery not confirmed");
    assert.deepEqual(
      { ...o.labels.CORRECTED! },
      { ar: "تصحيح قيد الإعداد", en: "Correction in preparation" },
    );
    throwsCode(
      () =>
        S.applyEvent(
          "NOTIFICATION",
          "DELIVERY_CONFIRMED",
          ev("RECIPIENT_ACKNOWLEDGED", ref("NOTIFICATION", u(21))),
        ),
      "NOT_A_DRIVING_EVENT",
    );
    throwsCode(
      () => S.applyEvent("NOTIFICATION", "QUEUED", ev("NOTIFICATION_EXPORTED", ref("NOTIFICATION", u(21)))),
      "NOT_A_DRIVING_EVENT",
    );
  });

  test("ST-08 DeliveryStatus table: per attempt; no DELIVERED, READ or ACKNOWLEDGED state", () => {
    assert.equal(S.canTransition("DeliveryStatus", "ATTEMPTED", "ACCEPTED_BY_PROVIDER"), true);
    assert.equal(S.canTransition("DeliveryStatus", "ATTEMPTED", "FAILED"), true);
    assert.equal(S.canTransition("DeliveryStatus", "ACCEPTED_BY_PROVIDER", "BOUNCED"), true);
    assert.equal(S.canTransition("DeliveryStatus", "ACCEPTED_BY_PROVIDER", "FAILED"), false);
    assert.equal(S.canTransition("DeliveryStatus", "ATTEMPTED", "DELIVERED"), false);
    assert.deepEqual([...S.STATUS_OBJECTS.DeliveryStatus.terminal], ["FAILED", "BOUNCED"]);
    const A = u(31);
    assert.equal(
      fold("DELIVERY_ATTEMPT", A, [
        ev("DELIVERY_ATTEMPTED", ref("DELIVERY_ATTEMPT", A)),
        ev("DELIVERY_ACCEPTED_BY_PROVIDER", ref("DELIVERY_ATTEMPT", A)),
      ]),
      "ACCEPTED_BY_PROVIDER",
    );
  });

  test("ST-09 API contract: unknown type throws, unknown state is false, null asks for an initial status", () => {
    throwsCode(() => S.canTransition("PARCEL", "A", "B"), "UNKNOWN_OBJECT_TYPE");
    throwsCode(() => S.canTransition("ALLEGATION", null, "OPEN"), "NO_STATUS_OBJECT");
    throwsCode(() => S.statusObjectOf("EVIDENCE"), "NO_STATUS_OBJECT");
    assert.equal(S.canTransition("TaskStatus", "ASSIGNED", "NOPE"), false);
    assert.equal(S.canTransition("TaskStatus", "NOPE", "ASSIGNED"), false);
    assert.equal(S.canTransition("TaskStatus", null, "ASSIGNED"), true);
    assert.equal(S.canTransition("TaskStatus", null, "COMPLETED"), false);
    assert.equal(S.canTransition("CASE", null, "S1.01"), true);
    assert.equal(S.canTransition("CASE", null, "S2.01"), false);
    assert.equal(S.canTransition("CaseStatus", "S4.04", "S4.05"), true);
    assert.equal(S.canTransition("CASE", "flags.suspended=false", "flags.suspended=true"), true);
    assert.equal(
      S.canTransition("CASE", "flags.returned=true", "flags.returned=false"),
      false,
      "no clearing event for returned (SOURCE_REQUIRED)",
    );
    throwsCode(() => S.isTerminal("TaskStatus", "OVERDUE"), "UNKNOWN_STATE");
    throwsCode(
      () => S.applyEvent("TaskStatus", null, ev("TASK_ASSIGNED", ref("TASK", u(17)))),
      "CONCEPT_REQUIRED",
    );
    throwsCode(() => S.evidenceEventsInto("TaskStatus", "COMPLETED"), "CONCEPT_REQUIRED");
    try {
      S.canTransition("PARCEL", "A", "B");
    } catch (e) {
      assert.ok(e instanceof S.DomainError);
      assert.equal(e.name, "DomainError");
    }
  });

  test("ST-10 terminal states are exactly the states without outgoing pairs; every state is reachable from an initial state", () => {
    for (const n of S.STATUS_OBJECT_NAMES) {
      const o: S.AnyStatusObject = S.STATUS_OBJECTS[n];
      assert.deepEqual(
        [...o.terminal],
        o.states.filter((s) => !o.pairs.some(([f]) => f === s)),
        `${n} terminal`,
      );
      for (const s of o.states)
        assert.equal(
          S.isTerminal(n, s),
          o.terminal.includes(s) ||
            (n === "CaseStatus" && (S.CASE_TERMINAL_CODES as readonly string[]).includes(s)),
          `${n}.${s}`,
        );
      const seen = new Set(o.initial);
      const queue = [...o.initial];
      while (queue.length) {
        const s = queue.shift();
        for (const [f, t] of o.pairs)
          if (f === s && !seen.has(t)) {
            seen.add(t);
            queue.push(t);
          }
      }
      assert.deepEqual(
        o.states.filter((s) => !seen.has(s)),
        [],
        `${n} unreachable states`,
      );
      for (const [f, t] of o.pairs) {
        assert.ok(o.states.includes(f) && o.states.includes(t), `${n} pair ${f}→${t}`);
      }
    }
    assert.deepEqual([...S.STATUS_OBJECTS.CaseStatus.terminal], ["S5.06", "S5.07"]);
  });

  test("ST-11 concept tables: rows ⊆ status-object pairs; driving events name the type; guards read the payload only", () => {
    for (const id of S.LIFECYCLE_CONCEPTS) {
      const c = C.getConcept(id);
      const so = SO[c.lifecycle]!;
      assert.ok(c.transitions.length > 0, `${id} has rows`);
      for (const r of c.transitions) {
        for (const e of r.on) {
          assert.ok(C.EVENT_TYPES.includes(e), `${id}: ${e} known`);
          const cat = C.EVENT_CATALOGUE[e];
          assert.ok(
            cat!.object_types.includes(id) || cat!.secondary_types.includes(id),
            `${id}: ${e} names ${id}`,
          );
        }
        if (r.when) assert.match(r.when.path, /^payload\./, `${id}: guard path`);
        assert.ok(C.LABELS.includes(r.label!), `${id}: row label`);
        if (id === "CASE") continue;
        if (r.from === null) {
          assert.ok(so.initial.includes(r.to), `${id}: null→${r.to} is an initial ${so.name} state`);
          continue;
        }
        for (const f of r.from) {
          if (f === null) {
            assert.ok(so.initial.includes(r.to), `${id}: null→${r.to}`);
            continue;
          }
          assert.ok(
            so.pairs.some(([a, b]) => a === f && b === r.to),
            `${id}: ${f}→${r.to} is a ${so.name} pair`,
          );
        }
      }
    }
  });

  test("ST-12 EVENT_TYPES: the 49 charter types first and in order, 99 documented W-A additions (58 adopted from W-C), four domains, platform map", () => {
    assert.equal(C.EVENT_TYPES_CHARTER_MINIMUM.length, 49);
    assert.deepEqual(C.EVENT_TYPES.slice(0, 49), [...C.EVENT_TYPES_CHARTER_MINIMUM]);
    assert.equal(C.EVENT_TYPE_ADDITIONS.length, 99);
    assert.deepEqual(C.EVENT_TYPES.slice(49), [...C.EVENT_TYPE_ADDITIONS]);
    assert.equal(C.EVENT_TYPES.length, 148);
    assert.equal(new Set(C.EVENT_TYPES).size, 148);
    for (const t of C.EVENT_TYPES) {
      const e = C.EVENT_CATALOGUE[t]!;
      assert.ok(["A", "B", "F", "G"].includes(e!.domain), `${t} domain`);
      assert.ok(["CHARTER_MINIMUM", "W-A_ADDITION"].includes(e.origin), `${t} origin`);
      assert.ok(
        e.object_types.length > 0 && e.object_types.every((o) => C.CONCEPT_IDS.includes(o)),
        `${t} object types`,
      );
      assert.ok(
        e.secondary_types.every((o) => C.CONCEPT_IDS.includes(o)),
        `${t} secondary types`,
      );
      assert.ok(C.LABELS.includes(e.label) && e.source, `${t} label/source`);
    }
    for (const t of C.EVENT_TYPE_ADDITIONS) {
      const e = C.EVENT_CATALOGUE[t]!;
      assert.equal(e.origin, "W-A_ADDITION");
      assert.ok(e.reason && /[؀-ۿ]/.test(e.reason.ar) && e.reason.en, `${t} reason`);
    }
    // work/LEAD_notes.md L-05 item 2 (with L-10 item 3): the 58 types W-C proposed, adopted as written
    assert.equal(C.WC_ADOPTED_EVENT_TYPES.length, 58);
    assert.equal(new Set(C.WC_ADOPTED_EVENT_TYPES).size, 58);
    for (const t of C.WC_ADOPTED_EVENT_TYPES) {
      assert.ok(C.EVENT_TYPE_ADDITIONS.includes(t), t);
      assert.equal(C.EVENT_CATALOGUE[t]!.proposed_by, "W-C", t);
    }
    assert.equal(C.EVENT_TYPES.filter((t) => C.EVENT_CATALOGUE[t]!.proposed_by === "W-C").length, 58);
    // L-10 item 2: REFERRAL_RESUBMITTED is retired; a resubmission is REFERRAL_SUBMITTED {resubmission: true}
    assert.equal(C.isKnownEventType("REFERRAL_RESUBMITTED"), false);
    assert.ok(C.isKnownEventType("REFERRAL_SUBMITTED") && C.isKnownEventType("REFERRAL_HEAD_DECIDED"));
    // the four domains partition the enum; Domain G holds the one audit fact; formal notices are domain events (L-05 G-06)
    assert.deepEqual(
      [
        C.CASE_EVENTS.length,
        C.PROCEDURAL_EVENTS.length,
        C.COMMUNICATION_EVENTS.length,
        C.AUDIT_EVENTS.length,
      ],
      [8, 121, 18, 1],
    );
    assert.equal(
      new Set([...C.CASE_EVENTS, ...C.PROCEDURAL_EVENTS, ...C.COMMUNICATION_EVENTS, ...C.AUDIT_EVENTS]).size,
      148,
    );
    assert.deepEqual([...C.AUDIT_EVENTS], ["REPORTER_IDENTITY_REVEALED"]);
    for (const t of Object.keys(C.FORMAL_NOTICE_EVENTS))
      assert.equal(
        C.EVENT_CATALOGUE[t]!.domain,
        "B",
        `${t}: a formal notice is a domain event, never a communication event`,
      );
    assert.equal(C.isKnownEventType("MEETING_HELD"), false);
    assert.deepEqual([...C.CASE_CODE_EVENTS], ["CASE_REGISTERED", "CASE_STATUS_RECORDED"]);
    assert.ok(C.COMMUNICATION_EVENTS.every((t) => C.EVENT_CATALOGUE[t]!.domain === "F"));
    assert.equal(C.PLATFORM_AUDIT_EVENT_MAP.length, 46);
    for (const m of C.PLATFORM_AUDIT_EVENT_MAP) {
      assert.equal(m.label, "INFERENCE");
      assert.match(m.ref, /infrastructure\/supabase\/migrations\/2026\d+_\w+\.sql:\d+$/);
      assert.ok(["AUDIT_EVENT", "TEMPLATE_CODE", "VALUE"].includes(m.kind), `${m.platform} kind`);
      assert.ok([null, "ACCEPTANCE", "SETTLEMENT"].includes(m.mode), `${m.platform} mode`);
      if (m.v13 !== null) assert.ok(C.EVENT_TYPES.includes(m.v13), `${m.platform} → ${m.v13}`);
      if (C.isKnownEventType(m.platform))
        assert.equal(m.v13, m.platform, `${m.platform} is a V13 name and maps to itself`);
    }
    if (CHARTER) {
      const line = CHARTER.split("\n").find((l) =>
        l.startsWith("`EVENT_TYPES` (W-A owns the enum; minimum set):"),
      );
      assert.ok(line, "charter §3.3 EVENT_TYPES line");
      const names = line
        .split("):")[1]!
        .replace(/\([^)]*\)/g, "")
        .split(",")
        .map((s) => s.trim().replace(/\.$/, ""))
        .filter(Boolean);
      assert.deepEqual(names, [...C.EVENT_TYPES_CHARTER_MINIMUM]);
    }
  });

  test("ST-13 foreign events never move a status: NOT_A_DRIVING_EVENT for every state of every type", () => {
    let n = 0;
    for (const id of S.LIFECYCLE_CONCEPTS) {
      const driving = S.drivingEvents(id);
      const states = id === "CASE" ? [{ code: "S4.04", flags: {} }] : [null, ...S.statusObjectOf(id).states];
      for (const t of C.EVENT_TYPES) {
        if (driving.includes(t)) continue;
        for (const st of states) {
          throwsCode(
            () => S.applyEvent(id, st, ev(t, ref(C.EVENT_CATALOGUE[t]!.object_types[0]!, u(99)))),
            "NOT_A_DRIVING_EVENT",
          );
          n++;
        }
      }
    }
    assert.ok(n > 5000, `${n} combinations`);
  });

  test("ST-14 forbidden derivations FD-01…FD-12 hold (assertIndependent); doctored tables are rejected", () => {
    assert.deepEqual(
      S.FORBIDDEN_DERIVATIONS.map((d) => d.id),
      Array.from({ length: 12 }, (_, i) => `FD-${String(i + 1).padStart(2, "0")}`),
    );
    for (const d of S.FORBIDDEN_DERIVATIONS) {
      assert.ok(d.rule.ar && d.rule.en && d.basis, d.id);
      for (const tg of d.targets) {
        const r = S.assertIndependent(tg.type, d.source === tg.type ? null : d.source);
        assert.equal(r.ok, true);
        assert.ok(
          r.checks.some((c) => c.id === d.id && c.ok),
          `${d.id} checked for ${tg.type}`,
        );
      }
    }
    const rowsOf = (id: string): TransitionRow[] => [...C.getConcept(id).transitions];
    const row = (from: string[], to: string, on: string[], when: Guard | null = null): TransitionRow => ({
      from,
      to,
      on,
      when,
      label: "PROPOSAL",
    });
    const reject = (target: string, source: string | null, rows: TransitionRow[], pattern: RegExp) =>
      assert.throws(
        () => S.assertIndependent(target, source, { rows }),
        (e: S.DomainError) => e.code === "STATUS_DERIVATION_FORBIDDEN" && pattern.test(e.message),
        `${target} ← ${source}`,
      );
    reject(
      "DECISION",
      "RECOMMENDATION",
      [...rowsOf("DECISION"), row(["SUBMITTED_TO_AUTHORITY"], "DECIDED", ["RECOMMENDATION_ADOPTED"])],
      /EVENT_NAMES_TARGET/,
    );
    reject(
      "DECISION",
      "RECOMMENDATION",
      [...rowsOf("DECISION"), row(["SUBMITTED_TO_AUTHORITY"], "DECIDED", ["PACKAGE_SUBMITTED_TO_AUTHORITY"])],
      /FD-02/,
    );
    reject(
      "NOTIFICATION",
      null,
      [...rowsOf("NOTIFICATION"), row(["QUEUED"], "SENT", ["NOTIFICATION_EXPORTED"])],
      /FD-08/,
    );
    reject(
      "MEETING",
      "NOTIFICATION",
      [...rowsOf("MEETING"), row(["SCHEDULED"], "CLOSED", ["MEETING_SCHEDULED"])],
      /FD-06/,
    );
    reject(
      "NOTIFICATION",
      "DELIVERY_ATTEMPT",
      [...rowsOf("NOTIFICATION"), row(["SENT"], "DELIVERY_CONFIRMED", ["NOTIFICATION_SENT"])],
      /FD-07/,
    );
    reject(
      "NOTIFICATION",
      "DELIVERY_ATTEMPT",
      [...rowsOf("NOTIFICATION"), row(["DELIVERY_CONFIRMED"], "CORRECTED", ["RECIPIENT_ACKNOWLEDGED"])],
      /FD-09/,
    );
    reject(
      "TASK",
      "NOTIFICATION",
      [...rowsOf("TASK"), row(["ASSIGNED"], "COMPLETED", ["STATEMENT_REQUESTED"])],
      /FD-12/,
    );
    reject("TASK", null, [...rowsOf("TASK"), row(["ASSIGNED"], "OVERDUE", ["TASK_STARTED"])], /OWN_STATES/);
    reject(
      "RECOMMENDATION",
      "LEGAL_OPINION",
      [
        ...rowsOf("RECOMMENDATION"),
        row(["UNDER_VOTE"], "ADOPTED", ["RECOMMENDATION_ADOPTED"], {
          path: "object.status",
          eq: "COMPLETED",
        }),
      ],
      /GUARD_READS_EVENT/,
    );
    reject(
      "CASE",
      "NOTIFICATION",
      [...rowsOf("CASE"), row(["<V8 code>"], "<V8 code>", ["NOTIFICATION_SENT"])],
      /EVENT_NAMES_TARGET/,
    );
    throwsCode(() => S.assertIndependent("TASK", "TASK"), "SAME_TYPE");
    throwsCode(() => S.assertIndependent("TaskStatus"), "CONCEPT_REQUIRED");
  });

  test("ST-15 statusFromEvents ignores interleaved foreign events (seeded PRNG, 60 shuffles)", () => {
    const M = u(12);
    const M2 = u(22);
    const N = u(21);
    const R = u(14);
    const own = [
      "MEETING_SCHEDULED",
      "MEETING_OPENED",
      "MEETING_CLOSED",
      "MINUTES_DRAFTED",
      "MINUTES_UNDER_REVIEW",
      "MINUTES_FINAL",
    ];
    const foreign = () => [
      ev("MEETING_CANCELLED", ref("MEETING", M2)),
      ev("MEETING_SCHEDULED", ref("MEETING", M2)),
      ev("NOTIFICATION_SENT", ref("NOTIFICATION", N)),
      ev("DELIVERY_CONFIRMED", ref("NOTIFICATION", N)),
      ev("RECIPIENT_ACKNOWLEDGED", ref("NOTIFICATION", N)),
      ev("CHAIR_DIRECTION_RECORDED", ref("PROCEDURE", u(11)), { direction: "MEETING" }),
      ev("RECOMMENDATION_DRAFTED", ref("RECOMMENDATION", R)),
      ev("CASE_STATUS_RECORDED", ref("CASE", u(1)), { from: "S4.03", to: "S4.04" }),
      ev("NOTIFICATION_EXPORTED", ref("NOTIFICATION", N)),
    ];
    let x = 20261027;
    const rnd = () => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x / 2147483648;
    };
    for (let k = 0; k < 60; k++) {
      const mine = own.map((t) => ev(t, ref("MEETING", M)));
      const others = foreign();
      const merged = [...mine];
      for (const o of others) merged.splice(Math.floor(rnd() * (merged.length + 1)), 0, o);
      // re-stamp in merged order so foreign events fall between the meeting's own events
      merged.forEach((e, i) => {
        e.occurred_at = new Date(Date.parse("2026-10-02T08:00:00Z") + i * 60e3).toISOString();
        e.recorded_at = e.occurred_at;
      });
      const r = S.statusFromEvents("MEETING", M, merged);
      assert.equal(r.status, "MINUTES_FINAL");
      assert.deepEqual(
        r.applied,
        mine.map((e) => e.event_id),
      );
    }
  });

  test("ST-16 the case status is untouched by every communication event", () => {
    const CASE = u(1);
    const caseEvents = [
      ev("CASE_STATUS_RECORDED", ref("CASE", CASE), { from: null, to: "S1.01" }),
      ev("CASE_STATUS_RECORDED", ref("CASE", CASE), { from: "S1.01", to: "S1.02" }),
    ];
    const comm = C.COMMUNICATION_EVENTS.map((t) =>
      ev(t, ref(C.EVENT_CATALOGUE[t]!.object_types[0]!, u(21)), { to: "S5.05" }, { case_id: CASE }),
    );
    const clean = S.statusFromEvents("CASE", CASE, caseEvents);
    const noisy = S.statusFromEvents("CASE", CASE, [...caseEvents, ...comm]);
    assert.equal(noisy.code, "S1.02");
    assert.deepEqual(noisy.flags, clean.flags);
    assert.deepEqual(noisy.applied, clean.applied);
    for (const e of comm) {
      assert.equal(S.eventConcerns(e, "CASE", CASE), false, e.type);
      throwsCode(() => S.applyEvent("CASE", { code: "S4.04", flags: {} }, e), "NOT_A_DRIVING_EVENT");
    }
    assert.equal(S.assertIndependent("CASE", "NOTIFICATION").ok, true);
  });
});

describe("ST concepts and catalogue", () => {
  test("ST-17 twenty concepts, each with the 12 attributes, bilingual, labelled and related within the model", () => {
    assert.equal(C.CONCEPTS.length, 20);
    assert.equal(new Set(C.CONCEPT_IDS).size, 20);
    assert.deepEqual(
      [...C.CONCEPT_ATTRIBUTES],
      [
        "meaning",
        "significance",
        "owner_domain",
        "lifecycle",
        "transitions",
        "relationships",
        "authoritative_source",
        "permitted_actions",
        "authorization",
        "evidence_requirements",
        "disclosure_default",
        "audit",
      ],
    );
    assert.ok(
      C.PROCEDURAL_OBJECT_TYPES.every((t) => C.CONCEPT_IDS.includes(t)) &&
        C.PROCEDURAL_OBJECT_TYPES.length === 13,
    );
    for (const c of C.CONCEPTS) {
      assert.match(c.ar, /[؀-ۿ]/, c.id);
      assert.ok(c.en, c.id);
      for (const a of C.CONCEPT_ATTRIBUTES)
        assert.ok(c[a] !== undefined && c[a] !== null && c[a] !== "", `${c.id}.${a}`);
      assert.ok(/[؀-ۿ]/.test(c.meaning.ar) && c.meaning.en, `${c.id}.meaning`);
      assert.ok(C.LABELS.includes(c.significance.label) && c.significance.source, `${c.id}.significance`);
      assert.ok(Object.keys(C.OWNER_DOMAINS).includes(c.owner_domain), `${c.id}.owner_domain`);
      assert.ok(c.lifecycle === "none" || S.STATUS_OBJECT_NAMES.includes(c.lifecycle), `${c.id}.lifecycle`);
      if (c.lifecycle === "none") assert.deepEqual([...c.transitions], [], `${c.id} has no rows`);
      for (const r of c.relationships) {
        assert.ok(C.CONCEPT_IDS.includes(r.to), `${c.id}→${r.to}`);
        assert.ok(Object.keys(C.RELATIONSHIP_KINDS).includes(r.kind), `${c.id} ${r.kind}`);
      }
      assert.ok(
        Array.isArray(c.permitted_actions) && c.permitted_actions.length > 0,
        `${c.id}.permitted_actions`,
      );
    }
    assert.deepEqual(
      C.CONCEPTS.filter((c) => c.lifecycle === "none").map((c) => c.id),
      ["ALLEGATION", "DELIVERY_OUTCOME", "EVIDENCE", "AUTHORITY", "RECIPIENT_CAPACITY"],
    );
    assert.ok(
      C.getConcept("NOTIFICATION").relationships.some((r) => r.kind === "NEVER_IMPLIES" && r.to === "CASE"),
    );
    assert.throws(() => C.getConcept("PARCEL"));
  });

  test("ST-18 work/V13-02_concepts.csv equals the concept model (20 rows × id, ar, en + 12 attributes)", () => {
    const raw = read("../work/V13-02_concepts.csv");
    assert.ok(raw.startsWith("﻿"), "UTF-8 BOM for spreadsheet tools");
    const rows = [];
    let row = [];
    let cell = "";
    let q = false;
    const text = raw.slice(1);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') q = false;
        else cell += ch;
        continue;
      }
      if (ch === '"') q = true;
      else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }
    const [head, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
    assert.deepEqual(head, ["id", "ar", "en", ...C.CONCEPT_ATTRIBUTES]);
    assert.equal(body.length, 20);
    body.forEach((r, i) => {
      const c = C.CONCEPTS[i]!;
      assert.equal(r.length, 15, `${c.id} columns`);
      assert.deepEqual([r[0], r[1], r[2]], [c.id, c.ar, c.en]);
      assert.ok(r[3]!.includes(c.meaning.ar) && r[3]!.includes(c.meaning.en), `${c.id} meaning`);
      assert.ok(r[5]!.startsWith(c.owner_domain), `${c.id} owner_domain`);
      assert.equal(r[6], c.lifecycle);
      assert.equal(r[10], c.permitted_actions.join(", "));
      for (let k = 3; k < 15; k++) assert.ok(r[k]!.trim().length > 0, `${c.id} column ${head![k]}`);
    });
  });
});

describe("ST epistemic classes and progress layers", () => {
  test("ST-19 epistemic classes: charter order, certainty ranks, ceilings and the NOT_APPLICABLE rules", () => {
    assert.deepEqual(
      [...EP.EPISTEMIC_CLASSES],
      [
        "RECORDED_FACT",
        "DERIVED_FROM_VERIFIED_FACTS",
        "EXPECTED_PROCESS",
        "CONDITIONAL_STEP",
        "PROPOSED_ACTION",
        "UNVERIFIED_INFORMATION",
        "NOT_APPLICABLE",
      ],
    );
    if (CHARTER) assert.ok(CHARTER.includes(EP.EPISTEMIC_CLASSES.join(" · ")), "charter §3.5 order");
    assert.deepEqual(
      [...EP.CERTAINTY_ORDER],
      EP.EPISTEMIC_CLASSES.filter((c) => c !== "NOT_APPLICABLE"),
    );
    assert.equal(EP.certaintyRank("RECORDED_FACT"), 0);
    assert.equal(EP.certaintyRank("UNVERIFIED_INFORMATION"), 5);
    assert.equal(EP.certaintyRank("NOT_APPLICABLE"), null);
    assert.throws(
      () => EP.certaintyRank("CERTAIN"),
      (e: EP.EpistemicError) => e.code === "UNKNOWN_EPISTEMIC_CLASS",
    );
    assert.equal(EP.exceeds("RECORDED_FACT", "EXPECTED_PROCESS"), true);
    assert.equal(EP.exceeds("PROPOSED_ACTION", "EXPECTED_PROCESS"), false);
    assert.equal(EP.exceeds("NOT_APPLICABLE", "DERIVED_FROM_VERIFIED_FACTS"), false);
    assert.equal(
      EP.exceeds("NOT_APPLICABLE", "EXPECTED_PROCESS"),
      true,
      "a NOT_APPLICABLE display needs a recorded or derived basis",
    );
    assert.equal(EP.exceeds("UNVERIFIED_INFORMATION", "NOT_APPLICABLE"), true);
    assert.throws(
      () => EP.assertNotExceeding("RECORDED_FACT", "UNVERIFIED_INFORMATION"),
      (e: EP.EpistemicError) => e.code === "EPISTEMIC_CEILING_EXCEEDED" && e instanceof EP.EpistemicError,
    );
    assert.equal(EP.assertNotExceeding("EXPECTED_PROCESS", "EXPECTED_PROCESS"), true);
    assert.equal(EP.leastCertain("RECORDED_FACT", "PROPOSED_ACTION", "NOT_APPLICABLE"), "PROPOSED_ACTION");
    assert.equal(EP.maxDisplayCertainty("CONDITIONAL_STEP"), "CONDITIONAL_STEP");
    const events = [
      ev("BALLOT_CLOSED", ref("BALLOT", u(13))),
      { ...ev("BALLOT_CLOSED", ref("BALLOT", u(13))), provenance: { source: "MANUAL_ENTRY", ref: "x" } },
    ];
    assert.equal(
      EP.maxDisplayCertainty({ kind: "EVENT", event_id: events[0]!.event_id }, events),
      "RECORDED_FACT",
    );
    assert.equal(
      EP.maxDisplayCertainty({ kind: "EVENT", event_id: events[1]!.event_id }, events),
      "UNVERIFIED_INFORMATION",
    );
    assert.equal(
      EP.maxDisplayCertainty({ kind: "DERIVATION", event_id: events[0]!.event_id }, events),
      "DERIVED_FROM_VERIFIED_FACTS",
    );
    assert.equal(
      EP.maxDisplayCertainty({ kind: "EVENT", event_id: "evt-missing" }, events),
      "UNVERIFIED_INFORMATION",
    );
    for (const k of ["NOTIFICATION", "EXPORT", "MANUAL_ENTRY", "NONE"])
      assert.equal(EP.sourceCeiling({ kind: k }), "UNVERIFIED_INFORMATION", k);
    assert.equal(EP.sourceCeiling({ kind: "CATALOGUE" }), "EXPECTED_PROCESS");
    assert.equal(EP.sourceCeiling({ kind: "NEXT_ACTION" }), "PROPOSED_ACTION");
    assert.equal(EP.sourceCeiling(null), "UNVERIFIED_INFORMATION");
    assert.deepEqual([...EP.maxDisplayStates("UNVERIFIED_INFORMATION")], []);
    assert.ok(
      EP.maxDisplayStates("EXPECTED_PROCESS").includes("EXPECTED") &&
        !EP.maxDisplayStates("EXPECTED_PROCESS").includes("COMPLETED"),
    );
    assert.equal(EP.displayStateAllows("COMPLETED", "DERIVED_FROM_VERIFIED_FACTS"), true);
    assert.equal(EP.displayStateAllows("COMPLETED", "EXPECTED_PROCESS"), false);
    assert.equal(
      EP.displayStateAllows("CONDITIONAL", "EXPECTED_PROCESS"),
      false,
      "a conditional step is at most CONDITIONAL_STEP",
    );
    assert.equal(EP.displayStateAllows("NOT_APPLICABLE", "NOT_APPLICABLE"), true);
    assert.equal(EP.displayStateAllows("ARCHIVED", "RECORDED_FACT"), false);
    for (const c of EP.EPISTEMIC_CLASSES)
      assert.ok(/[؀-ۿ]/.test(EP.CLASS_LABELS[c].ar) && EP.CLASS_LABELS[c].en, c);
  });

  test("ST-20 progress layers equal CHARTER.md §3.6; Layer B marks and completion wording are detected", () => {
    assert.deepEqual(
      [...EP.LAYER_A_STATE_IDS],
      [
        "COMPLETED",
        "IN_PROGRESS",
        "PENDING",
        "SUSPENDED",
        "RETURNED",
        "CANCELLED",
        "FAILED",
        "NOT_APPLICABLE",
      ],
    );
    assert.deepEqual(
      [...EP.LAYER_B_KIND_IDS],
      ["EXPECTED", "CONDITIONAL", "OPTIONAL", "ALTERNATIVE", "PARALLEL", "SUBJECT_TO_APPROVAL"],
    );
    assert.ok(EP.LAYER_B_KIND_IDS.every((k) => EP.LAYER_B_KINDS[k].symbol === "◇"));
    assert.deepEqual([...EP.LAYER_B_FORBIDDEN_WORDS], ["سُجل", "اكتُمل", "تم"]);
    if (CHARTER) {
      const a = CHARTER.split("\n").find((l) => l.startsWith("Layer A **Actual Progress** states:"));
      const b = CHARTER.split("\n").find((l) => l.startsWith("Layer B **Expected Process** kinds:"));
      assert.ok(a && b, "charter §3.6 lines");
      for (const id of EP.LAYER_A_STATE_IDS) {
        const s = EP.LAYER_A_STATES[id];
        assert.ok(a.includes(`${id} ${s.symbol}`), `${id} ${s.symbol}`);
        assert.ok(a.includes(`«${s.aria.ar}»`), `${id} aria`);
      }
      for (const id of EP.LAYER_B_KIND_IDS) {
        assert.ok(b.includes(id), id);
        assert.ok(b.includes(`«${EP.LAYER_B_KINDS[id].label.ar}»`), `${id} label`);
      }
      assert.ok(b.includes("never the words سُجل / اكتُمل / تم"));
    }
    for (const w of [
      "تم إرسال التوصية",
      "تمّ الاعتماد",
      "وتمت المراجعة",
      "اكتُمل التحقيق",
      "سُجّل القرار",
      "المحضر مكتمل",
      "Decision recorded",
      "Review completed",
      "done",
    ])
      assert.ok(EP.containsCompletionWording(w), w);
    for (const w of [
      "سجل التدقيق",
      "خطوة متوقعة — قرار صاحب الصلاحية",
      "Expected: will be recorded by the secretary",
      "تمام الإجراءات المتوقعة",
      "Expected step",
    ])
      assert.equal(EP.containsCompletionWording(w), null, w);
    assert.equal(EP.normalizeArabic("تمّ"), "تم");
    assert.equal(EP.carriesCompletionMark("◇ خطوة متوقعة"), false);
    assert.equal(EP.carriesCompletionMark("✓"), true);
    assert.equal(EP.carriesActualMark("● جارٍ"), true);
    assert.equal(EP.carriesActualMark("◇"), false);
  });

  test("ST-21 safe and forbidden inferences cover the charter §3.5 lists", () => {
    assert.deepEqual(
      EP.SAFE_INFERENCES.map((s) => [s.id, s.label]),
      [
        ["SI-01", "FACT"],
        ["SI-02", "FACT"],
        ["SI-03", "FACT"],
        ["SI-04", "FACT"],
        ["SI-05", "PROPOSAL"],
      ],
    );
    const charterFive = EP.FORBIDDEN_INFERENCES.slice(0, 5);
    assert.deepEqual(
      charterFive.map((f) => [f.id, f.label]),
      [
        ["FI-01", "FACT"],
        ["FI-02", "FACT"],
        ["FI-03", "FACT"],
        ["FI-04", "FACT"],
        ["FI-05", "FACT"],
      ],
    );
    for (const f of charterFive) assert.match(f.source, /CHARTER\.md §3\.5/);
    const find = (
      premise_event_type: string,
      about_type: string,
      asserts_status: string | null = null,
      asserts_event: string | null = null,
    ) => {
      const f = EP.findForbiddenInference({ premise_event_type, about_type, asserts_status, asserts_event });
      return f && f.id;
    };
    assert.equal(find("CHAIR_DIRECTION_RECORDED", "BALLOT", "OPEN"), "FI-02");
    assert.equal(find("RECOMMENDATION_ADOPTED", "DECISION", "DECIDED"), "FI-03");
    assert.equal(find("NOTIFICATION_EXPORTED", "NOTIFICATION", "DELIVERY_CONFIRMED"), "FI-04");
    assert.equal(find("NOTIFICATION_SENT", "CASE", "S5.05"), "FI-05");
    assert.equal(find("MEETING_SCHEDULED", "MEETING", "CLOSED"), "FI-06");
    assert.equal(find("LEGAL_OPINION_SUBMITTED", "RECOMMENDATION", "ADOPTED"), "FI-07");
    assert.equal(find("MINUTES_DRAFTED", "MEETING", "MINUTES_FINAL"), "FI-08");
    assert.equal(find("DELIVERY_CONFIRMED", "NOTIFICATION", null, "RECIPIENT_ACKNOWLEDGED"), "FI-09");
    assert.equal(find("DECISION_NOTICE_ISSUED", "DECISION", "DECIDED"), "FI-11");
    assert.equal(find("REFERRAL_RECEIVED", "CASE", null, "CASE_REGISTERED"), "FI-13");
    assert.equal(find("DELIVERY_ACCEPTED_BY_PROVIDER", "NOTIFICATION", "DELIVERY_CONFIRMED"), "FI-16");
    assert.equal(find("BALLOT_CLOSED", "BALLOT", "COMPLETED"), null, "a safe inference is not forbidden");
    assert.equal(find("AUTHORITY_DECISION_RECORDED", "DECISION", "DECIDED"), null);
    for (const f of EP.FORBIDDEN_INFERENCES.filter((x) => x.premise_events === null))
      assert.match(f.source, /INV-\d\d|W-D2/, `${f.id} names its checker`);
  });

  test("ST-22 V8 stages, codes, names and transitions equal level2_journeys.json and v9_data.json", () => {
    const l2raw = read("../../journeys/level2_journeys.json");
    const l2 = JSON.parse(l2raw) as Level2File;
    assert.deepEqual(
      S.MASTER_STAGES.map((s) => ({ ...s })),
      l2.master.map((m) => ({ code: m.code, key: m.key, ar: m.ar, en: m.en })),
    );
    assert.deepEqual(Object.fromEntries(S.V8_SUBSTATES.map((s) => [s.code, s.en])), l2.master_sub_en);
    const unchanged = l2.assignments.filter((a) => a.master === "CASE_UNCHANGED").length;
    assert.ok(unchanged > 0, "V12 assignments use master: CASE_UNCHANGED");
    const v9raw = read("../../generator/source/tests/v9_data.json");
    const v9 = JSON.parse(v9raw) as V9File;
    assert.deepEqual(
      S.V8_SUBSTATES.map((s) => [s.code, s.stage, s.key, s.ar]),
      v9.substates.map((s) => [s.code, s.main, s.key, s.name]),
    );
    assert.deepEqual(
      S.V8_TRANSITIONS.map((x) => [x.id, x.from, x.to, x.v8_event]),
      v9.transitions.map((x) => [x.id, x.frm, x.to, x.event]),
    );
  });
});

describe("ST independence at runtime", () => {
  test("ST-23 independenceReport: every lifecycle concept against every other concept passes", () => {
    const r = S.independenceReport();
    assert.equal(r.ok, true, JSON.stringify(r.failed.slice(0, 3)));
    assert.equal(r.checked, S.LIFECYCLE_CONCEPTS.length * (C.CONCEPT_IDS.length - 1));
    assert.deepEqual(
      [...r.forbidden_derivations],
      S.FORBIDDEN_DERIVATIONS.map((d) => d.id),
    );
  });

  test("ST-24 shared evidence events move only the objects they name, each under its own table", () => {
    assert.deepEqual(
      [...S.SHARED_EVIDENCE_EVENTS],
      ["BALLOT_OPENED", "PACKAGE_SUBMITTED_TO_AUTHORITY", "AUTHORITY_DECISION_RECORDED"],
    );
    const B = u(13);
    const R = u(14);
    const R2 = u(24);
    const D = u(16);
    const D2 = u(26);
    const evs = [
      ev("RECOMMENDATION_DRAFTED", ref("RECOMMENDATION", R)),
      ev("RECOMMENDATION_DRAFTED", ref("RECOMMENDATION", R2)),
      ev("BALLOT_OPENED", ref("BALLOT", B), { target: ref("RECOMMENDATION", R) }),
    ];
    assert.equal(fold("BALLOT", B, evs), "OPEN");
    assert.equal(fold("RECOMMENDATION", R, evs), "UNDER_VOTE");
    assert.equal(fold("RECOMMENDATION", R2, evs), "DRAFT");
    evs.push(
      ev("BALLOT_CLOSED", ref("BALLOT", B), { result: "APPROVED" }),
      ev("RECOMMENDATION_ADOPTED", ref("RECOMMENDATION", R)),
      ev("PACKAGE_SUBMITTED_TO_AUTHORITY", ref("RECOMMENDATION", R), { related: [ref("DECISION", D)] }),
    );
    assert.equal(fold("RECOMMENDATION", R, evs), "SUBMITTED_TO_AUTHORITY");
    assert.equal(fold("DECISION", D, evs), "SUBMITTED_TO_AUTHORITY");
    assert.equal(fold("DECISION", D2, evs), null);
    assert.equal(fold("BALLOT", B, evs), "COMPLETED", "adoption does not move the ballot");
    evs.push(
      ev("AUTHORITY_DECISION_RECORDED", ref("DECISION", D), {
        outcome: "APPROVE_AS_RECOMMENDED",
        related: [ref("RECOMMENDATION", R)],
      }),
    );
    assert.equal(fold("DECISION", D, evs), "DECIDED");
    assert.equal(fold("RECOMMENDATION", R, evs), "DECIDED");
    assert.equal(fold("RECOMMENDATION", R2, evs), "DRAFT");
    assert.equal(S.eventConcerns(evs.at(-1), "RECOMMENDATION", R2), false);
  });

  test("ST-25 determinism: no (state, event) pair has two targets under the same payload; illegal moves throw", () => {
    let groups = 0;
    for (const id of S.LIFECYCLE_CONCEPTS) {
      if (id === "CASE") continue;
      const rows = C.getConcept(id).transitions;
      for (const from of [null, ...S.statusObjectOf(id).states]) {
        for (const e of S.drivingEvents(id)) {
          const cand = rows.filter(
            (r) => r.on.includes(e) && (r.from === null ? from === null : r.from.includes(from)),
          );
          if (new Set(cand.map((r) => r.to)).size < 2) continue;
          groups++;
          const paths = new Set(cand.map((r) => r.when && r.when.path));
          assert.equal(paths.size, 1, `${id} ${from} ${e}: one guard path`);
          assert.ok([...paths][0], `${id} ${from} ${e}: guarded`);
          const path = [...paths][0];
          const values = [
            undefined,
            null,
            "OTHER",
            ...cand
              .flatMap((r) => [r.when!.eq, r.when!.ne, ...(r.when!.in || [])])
              .filter((v) => v !== undefined),
          ];
          for (const v of values) {
            const payload: Payload = {};
            if (v !== undefined) payload[path!.split(".")[1]!] = v;
            const event = ev(e, ref(id, u(77)), payload);
            const targets = new Set(cand.filter((r) => S.guardHolds(r.when, event)).map((r) => r.to));
            assert.ok(
              targets.size <= 1,
              `${id} ${from} ${e} payload ${JSON.stringify(payload)} → ${[...targets]}`,
            );
          }
        }
      }
    }
    assert.ok(groups >= 2, "the guarded authority-decision rows were examined");
    throwsCode(
      () => S.applyEvent("MEETING", "CANCELLED", ev("MEETING_OPENED", ref("MEETING", u(12)))),
      "TRANSITION_NOT_ALLOWED",
    );
    throwsCode(
      () => S.applyEvent("NOTIFICATION", "SENT", ev("NOTIFICATION_CANCELLED", ref("NOTIFICATION", u(21)))),
      "TRANSITION_NOT_ALLOWED",
    );
  });

  test("ST-26 case fold: entry codes, V8 moves only, flags independent of the code; history and evidence checks", () => {
    const CASE = u(1);
    const rec = (from: string | null, to: string, type = "CASE_STATUS_RECORDED") =>
      ev(type, ref("CASE", CASE), { from, to });
    assert.equal(S.applyEvent("CASE", null, rec(null, "S1.01")).code, "S1.01");
    assert.equal(S.applyEvent("CASE", null, rec(null, "S1.03", "CASE_REGISTERED")).code, "S1.03");
    throwsCode(() => S.applyEvent("CASE", null, rec(null, "S2.01")), "TRANSITION_NOT_ALLOWED");
    throwsCode(
      () => S.applyEvent("CASE", { code: "S4.04", flags: {} }, rec("S4.04", "S5.05")),
      "TRANSITION_NOT_ALLOWED",
    );
    let st = S.applyEvent("CASE", { code: "S4.04", flags: {} }, ev("CASE_SUSPENDED", ref("CASE", CASE)));
    assert.deepEqual([st.code, st.flags.suspended], ["S4.04", true]);
    throwsCode(
      () => S.applyEvent("CASE", st, ev("CASE_SUSPENDED", ref("CASE", CASE))),
      "TRANSITION_NOT_ALLOWED",
    );
    st = S.applyEvent(
      "CASE",
      { code: "S5.05", flags: { closed: true } },
      ev("CASE_REOPENED", ref("CASE", CASE)),
    );
    assert.deepEqual([st.flags.closed, st.flags.reopened], [false, true]);
    const hist = [rec(null, "S1.01"), rec("S1.01", "S1.02"), rec("S2.01", "S4.04")];
    const h = S.checkHistory("CASE", CASE, hist);
    assert.equal(h.ok, false);
    assert.equal(h.final, "S4.04");
    assert.match(h.problems.join(" "), /S2\.01→S4\.04 is not one of the 34 V8 transitions/);
    const record = {
      case_id: CASE,
      exists: true,
      status: { code: "S1.02", source_event_id: hist[1]!.event_id },
      flags: { suspended: false, returned: false, cancelled: false, reopened: false, closed: false },
    };
    assert.equal(S.checkCaseEvidence(record, hist).ok, true);
    assert.equal(
      S.checkCaseEvidence({ ...record, flags: { ...record.flags, suspended: true } }, hist).ok,
      false,
    );
    assert.equal(
      S.checkCaseEvidence({ ...record, flags: { ...record.flags, suspended: true } }, hist, { flags: false })
        .ok,
      true,
    );
    assert.equal(S.checkCaseEvidence({ exists: false }, []).ok, true);
  });

  test("ST-27 event concern and ordering: object, payload.target, payload.related; occurred_at, recorded_at, event_id", () => {
    const e = ev("BALLOT_OPENED", ref("BALLOT", u(13)), {
      target: ref("RECOMMENDATION", u(14)),
      related: [ref("DECISION", u(16))],
    });
    assert.equal(S.eventConcerns(e, "BALLOT", u(13)), true);
    assert.equal(S.eventConcerns(e, "RECOMMENDATION", u(14)), true);
    assert.equal(S.eventConcerns(e, "DECISION", u(16)), true);
    assert.equal(S.eventConcerns(e, "BALLOT", u(99)), false);
    assert.equal(S.eventConcerns(null, "BALLOT", u(13)), false);
    const a = { event_id: "b", occurred_at: "2026-10-01T08:00:00Z", recorded_at: "2026-10-01T08:05:00Z" };
    const b = { event_id: "a", occurred_at: "2026-10-01T08:00:00Z", recorded_at: "2026-10-01T08:06:00Z" };
    const c = { event_id: "a", occurred_at: "2026-10-01T08:00:00Z", recorded_at: "2026-10-01T08:05:00Z" };
    assert.deepEqual(
      S.sortEvents([b, a, c]).map((x) => `${x.event_id}${x.recorded_at.slice(15, 16)}`),
      ["a5", "b5", "a6"],
    );
    assert.equal(
      S.guardHolds({ path: "payload.outcome", ne: "RETURN_TO_COMMITTEE" }, { payload: {} }),
      false,
      "fail closed on a missing value",
    );
    assert.equal(
      S.guardHolds({ path: "payload.result", in: ["APPROVED"] }, { payload: { result: "APPROVED" } }),
      true,
    );
    assert.equal(
      S.guardHolds({ path: "payload.x" }, { payload: { x: 1 } }),
      false,
      "an unknown guard form fails closed",
    );
  });
});

describe("ST resolver, closing events, versions, lineage and the directive", () => {
  test("ST-28 toV13EventType (work/LEAD_notes.md L-06): identity for V13 types, platform names through the map under the delivery reading (L-07), ambiguous or unknown → null", () => {
    const r = C.toV13EventType;
    assert.equal(r("BALLOT_OPENED"), "BALLOT_OPENED");
    assert.equal(r("VOTE_OPENED"), "BALLOT_OPENED");
    assert.equal(r("CONFLICT_DECLARED"), "COI_DECLARATION_RECEIVED");
    assert.equal(
      r("RECOMMENDATION_PACKAGE_SUBMITTED_FOR_VOTE"),
      "PACKAGE_SUBMITTED_FOR_VOTE",
      "a requested vote, never BALLOT_OPENED (FI-17)",
    );
    assert.equal(
      r("MEETING_INVITATION"),
      "NOTIFICATION_QUEUED",
      "a template code is an outbox row: QUEUED at most",
    );
    assert.equal(r("MINUTES_GENERATED"), null, "two readings without a payload: never guessed");
    assert.equal(r("MINUTES_GENERATED", { status: "APPROVED" }), "MINUTES_FINAL");
    assert.equal(r("MINUTES_GENERATED", { status: "IN_REVIEW" }), "MINUTES_UNDER_REVIEW");
    assert.equal(r("NOTIFICATION_DELIVERY"), null);
    assert.equal(C.DEFAULT_DELIVERY_CONFIRMATION, "ACCEPTANCE");
    assert.equal(
      r("NOTIFICATION_DELIVERY", { status: "SENT" }),
      "DELIVERY_ACCEPTED_BY_PROVIDER",
      "ACCEPTANCE is the default reading (L-07)",
    );
    assert.equal(
      r("NOTIFICATION_DELIVERY", { status: "SENT" }, { delivery_confirmation: "ACCEPTANCE" }),
      "DELIVERY_ACCEPTED_BY_PROVIDER",
    );
    assert.equal(
      r("NOTIFICATION_DELIVERY", { status: "SENT" }, { delivery_confirmation: "SETTLEMENT" }),
      "DELIVERY_CONFIRMED",
      "explicit, non-default configuration only",
    );
    assert.equal(r("NOTIFICATION_DELIVERY", { status: "FAILED" }), "DELIVERY_FAILED");
    assert.equal(r("NOTIFICATION_DELIVERY", { status: "PENDING" }), "DELIVERY_ATTEMPT_FAILED");
    assert.equal(
      r("NOTIFICATION_DELIVERY", { status: "SENT" }, { delivery_confirmation: "OPTIMISTIC" }),
      null,
      "an unknown reading is never guessed",
    );
    assert.equal(r("DEFENCE_NOTICE_ACKNOWLEDGED"), null, "no V13 type yet (open item, work/V13-02_notes.md)");
    for (const x of ["", null, undefined, 42, "NO_SUCH_EVENT"]) assert.equal(r(x), null, String(x));
    // L-06: the eight platform names of authority_v13.json evidence_required that had no V13 type
    for (const [n, v] of [
      ["VOTE_CAST", "VOTE_CAST"],
      ["VOTE_RECORDED_FOR_MEMBER", "VOTE_RECORDED_FOR_MEMBER"],
      ["UNABLE_TO_VOTE", "VOTE_RECORDED_FOR_MEMBER"],
      ["DEFENCE_NOTICE_ISSUED", "DEFENCE_NOTICE_ISSUED"],
      ["GRIEVANCE_ADMISSIBILITY_DECIDED", "GRIEVANCE_ADMISSIBILITY_DECIDED"],
      ["CONFLICT_DECLARED", "COI_DECLARATION_RECEIVED"],
      ["LEGAL_REVIEW_ASSIGNED", "NOTIFICATION_QUEUED"],
      ["REPORTER_IDENTITY_REVEALED", "REPORTER_IDENTITY_REVEALED"],
    ])
      assert.equal(r(n), v, n);
    const rule = C.PROTECTED_EVENT_RULES.REPORTER_IDENTITY_REVEALED!;
    assert.deepEqual(
      [[...rule.allowed_keys!], rule.never_in_notification],
      [["reveal_request_id"], true],
      "ids only, never in a notification (L-06)",
    );
    assert.equal(C.EVENT_CATALOGUE.REPORTER_IDENTITY_REVEALED!.domain, "G");
  });

  test("ST-29 closing events: PROCEDURE_COMPLETED / PROCEDURE_CANCELLED close payload.target when present, else their object (L-05; L-10 item 5); they move a status only where a table names them", () => {
    for (const ty of ["PROCEDURE_COMPLETED", "PROCEDURE_CANCELLED"]) {
      const e = C.EVENT_CATALOGUE[ty]!;
      assert.equal(e.closes, "TARGET_ELSE_OBJECT", ty);
      for (const p of C.PROCEDURAL_OBJECT_TYPES)
        assert.ok(e.object_types.includes(p), `${ty} may close a ${p}`);
    }
    const P = u(11);
    const T = u(17);
    const done = ev("PROCEDURE_COMPLETED", ref("PROCEDURE", P), { target: ref("TASK", T) });
    assert.equal(S.eventConcerns(done, "TASK", T), true);
    assert.equal(
      S.eventConcerns(done, "PROCEDURE", P),
      false,
      "with a target, a closing event concerns the target only",
    );
    assert.equal(
      S.eventConcerns({ ...done, payload: { target: T } }, "TASK", T),
      true,
      "an id string is matched by id",
    );
    assert.equal(
      S.eventConcerns({ ...done, payload: {} }, "PROCEDURE", P),
      true,
      "without a target: its object",
    );
    const opened = [
      ev("PROCEDURE_OPENED", ref("PROCEDURE", P)),
      ev("PROCEDURE_STARTED", ref("PROCEDURE", P)),
      done,
    ];
    assert.equal(
      fold("PROCEDURE", P, opened),
      "IN_PROGRESS",
      "a task's closure does not complete the procedure that holds it",
    );
    assert.equal(
      fold("PROCEDURE", P, [...opened, ev("PROCEDURE_COMPLETED", ref("PROCEDURE", P))]),
      "COMPLETED",
    );
    assert.equal(
      fold("INVESTIGATION", u(12), [
        ev("INVESTIGATION_ASSIGNED", ref("INVESTIGATION", u(12))),
        ev("PROCEDURE_COMPLETED", ref("PROCEDURE", P), { target: ref("INVESTIGATION", u(12)) }),
      ]),
      "COMPLETED",
    );
    for (const [ty, id] of [
      ["TASK", T],
      ["RECOMMENDATION", u(14)],
      ["DECISION", u(16)],
      ["IMPLEMENTATION_ACTION", u(18)],
      ["REFERRAL", u(19)],
    ]) {
      assert.ok(
        !S.drivingEvents(ty!).includes("PROCEDURE_COMPLETED"),
        `${ty}: PROCEDURE_COMPLETED is step evidence`,
      );
      throwsCode(
        () =>
          S.applyEvent(ty!, null, ev("PROCEDURE_COMPLETED", ref("PROCEDURE", P), { target: ref(ty!, id!) })),
        "NOT_A_DRIVING_EVENT",
      );
    }
  });

  test("ST-30 notification versions (L-04): statusFromEvents and checkHistory fold one version at a time; an event without a version is version 1", () => {
    const N = u(21);
    const v = (type: string, version: number, payload: Payload = {}) =>
      ev(type, ref("NOTIFICATION", N), payload, { version });
    const evs = [
      v("NOTIFICATION_DRAFTED", 1),
      v("NOTIFICATION_VALIDATED", 1),
      v("NOTIFICATION_AUTHORIZED", 1),
      v("NOTIFICATION_QUEUED", 1),
      v("NOTIFICATION_SENT", 1),
      v("NOTIFICATION_CORRECTED", 2, { corrects_version: 1, reason_code: "SYNTHETIC_CORRECTION" }),
      v("NOTIFICATION_VALIDATED", 2),
    ];
    const s1 = S.statusFromEvents("NOTIFICATION", N, evs, { version: 1 });
    const s2 = S.statusFromEvents("NOTIFICATION", N, evs, { version: 2 });
    assert.deepEqual([s1.status, s1.source_event_id], ["SENT", evs[4]!.event_id]);
    assert.deepEqual([s2.status, s2.source_event_id, s2.applied.length], ["VALIDATED", evs[6]!.event_id, 2]);
    throwsCode(() => S.statusFromEvents("NOTIFICATION", N, evs), "TRANSITION_NOT_ALLOWED");
    assert.deepEqual(
      [
        S.checkHistory("NOTIFICATION", N, evs, { version: 1 }).ok,
        S.checkHistory("NOTIFICATION", N, evs, { version: 1 }).final,
      ],
      [true, "SENT"],
    );
    assert.deepEqual(
      [
        S.checkHistory("NOTIFICATION", N, evs, { version: 2 }).ok,
        S.checkHistory("NOTIFICATION", N, evs, { version: 2 }).final,
      ],
      [true, "VALIDATED"],
    );
    const mixed = S.checkHistory("NOTIFICATION", N, evs);
    assert.equal(mixed.ok, false);
    assert.match(mixed.problems.join(" | "), /TRANSITION_NOT_ALLOWED \(SENT --NOTIFICATION_CORRECTED-->\)/);
    const bare: DomainEvent = { ...v("NOTIFICATION_DRAFTED", 1) };
    delete bare.version;
    assert.equal(S.statusFromEvents("NOTIFICATION", N, [bare], { version: 1 }).status, "DRAFT");
    assert.equal(S.statusFromEvents("NOTIFICATION", N, [bare], { version: 2 }).status, null);
  });

  test("ST-31 checkLineage (L-04 items 1-5): one current version, at most one pending correction, SUPERSEDED in the step its correction is SENT; partial contexts; retries after a correction", () => {
    const N = u(21);
    const lv = (type: string, version: number, payload: Payload = {}, extra: Partial<DomainEvent> = {}) =>
      ev(type, ref("NOTIFICATION", N), payload, { version, ...extra });
    const reason = "SYNTHETIC_CORRECTION";
    const issue = (version: number, first: string) => [
      lv(
        first,
        version,
        first === "NOTIFICATION_CORRECTED" ? { corrects_version: version - 1, reason_code: reason } : {},
      ),
      lv("NOTIFICATION_VALIDATED", version),
      lv("NOTIFICATION_AUTHORIZED", version),
      lv("NOTIFICATION_QUEUED", version),
      lv("NOTIFICATION_SENT", version),
    ];
    const v1 = issue(1, "NOTIFICATION_DRAFTED");
    const v2 = issue(2, "NOTIFICATION_CORRECTED");
    const sup = lv(
      "NOTIFICATION_SUPERSEDED",
      1,
      { successor_version: 2, reason_code: reason },
      { causation_id: v2.at(-1)!.event_id },
    );
    const rec = (
      version: number,
      status: string,
      extra: Partial<S.LineageVersion> = {},
    ): S.LineageVersion => ({ version, status, ...extra });
    const c1 = { corrects: { version: 1, reason_code: reason } };
    const full = S.checkLineage([rec(1, "SUPERSEDED"), rec(2, "SENT", c1)], [...v1, ...v2, sup]);
    assert.deepEqual(
      [full.ok, full.current_version, full.pending_version],
      [true, 2, null],
      full.problems.join(" | "),
    );
    assert.equal(
      S.statusFromEvents("NOTIFICATION", N, [...v1, ...v2, sup], { version: 1 }).status,
      "SUPERSEDED",
    );
    assert.equal(S.statusFromEvents("NOTIFICATION", N, [...v1, ...v2, sup], { version: 2 }).status, "SENT");
    const pending = S.checkLineage([rec(1, "SENT"), rec(2, "CORRECTED", c1)], [...v1, v2[0]]);
    assert.deepEqual(
      [pending.ok, pending.current_version, pending.pending_version],
      [true, 1, 2],
      pending.problems.join(" | "),
    );
    const bad = (
      versions: S.LineageVersion[],
      evs: DomainEvent[],
      re: RegExp,
      options: S.LineageOptions = {},
    ) => {
      const res = S.checkLineage(versions, evs, options);
      assert.equal(res.ok, false, `expected a problem matching ${re}`);
      assert.ok(
        res.problems.some((p) => re.test(p)),
        `${re} not in: ${res.problems.join(" | ")}`,
      );
    };
    bad([rec(1, "SENT"), rec(1, "DRAFT")], [], /duplicate version numbers/);
    bad([rec(0, "DRAFT")], [], /integers ≥ 1/);
    bad([rec(1, "CORRECTED")], [], /never of version 1/);
    bad([rec(1, "SENT", { corrects_version: 1 })], [], /the first version corrects nothing/);
    bad([rec(1, "SENT"), rec(2, "DRAFT", c1)], [], /DRAFT — a correcting version enters in CORRECTED/);
    bad([rec(1, "SENT"), rec(2, "CORRECTED")], [], /corrects_version missing/);
    bad([rec(1, "VALIDATED"), rec(2, "CORRECTED", c1)], [], /only an issued version/);
    bad([rec(1, "SENT"), rec(2, "CORRECTED", { corrects_version: 1 })], [], /without a reason code/);
    bad(
      [rec(1, "SUPERSEDED"), rec(2, "VALIDATED", c1)],
      [],
      /SUPERSEDED before any version correcting it was SENT/,
    );
    bad([rec(1, "SENT"), rec(2, "SENT", c1)], [], /still SENT although its correction v2 was SENT/);
    bad([rec(1, "SENT"), rec(2, "SENT", c1)], [], /2 issued versions/);
    bad(
      [rec(1, "SENT"), rec(2, "CORRECTED", c1), rec(3, "CORRECTED", c1)],
      [],
      /2 corrections pending at once/,
    );
    bad(
      [rec(1, "SUPERSEDED"), rec(2, "SENT", c1), rec(3, "CORRECTED", c1)],
      [],
      /must correct the current version v2/,
    );
    bad([rec(1, "SUPERSEDED"), rec(2, "CANCELLED", c1)], [], /never loses its current version/);
    // with events
    bad([rec(1, "SENT"), rec(2, "CORRECTED", c1)], [...v1], /no NOTIFICATION_CORRECTED entry event/);
    bad(
      [rec(1, "SENT"), rec(2, "VALIDATED", c1)],
      [...v1, lv("NOTIFICATION_DRAFTED", 2), v2[0]!, v2[1]!],
      /never through NOTIFICATION_DRAFTED/,
    );
    bad(
      [rec(1, "SENT"), rec(2, "CORRECTED", c1)],
      [...v1, lv("NOTIFICATION_CORRECTED", 2, { corrects_version: 2, reason_code: reason })],
      /must be lower than the event's version/,
    );
    bad(
      [rec(1, "SENT")],
      [...v1, lv("NOTIFICATION_SUPERSEDED", 1, { successor_version: 1 })],
      /must exceed version 1/,
    );
    bad(
      [rec(1, "SUPERSEDED"), rec(2, "SENT", c1)],
      [...v1, ...v2],
      /SUPERSEDED without a NOTIFICATION_SUPERSEDED event/,
    );
    const early = lv("NOTIFICATION_SUPERSEDED", 1, { successor_version: 2, reason_code: reason });
    early.occurred_at = v2[0]!.occurred_at;
    early.recorded_at = v2[0]!.occurred_at;
    bad(
      [rec(1, "SUPERSEDED"), rec(2, "SENT", c1)],
      [...v1, ...v2, early],
      /SUPERSEDED .* before v2 was SENT/,
    );
    const sameStep = { ...early, causation_id: v2.at(-1)!.event_id };
    assert.equal(
      S.checkLineage([rec(1, "SUPERSEDED"), rec(2, "SENT", c1)], [...v1, ...v2, sameStep]).ok,
      true,
      "caused by the successor's NOTIFICATION_SENT: the same step",
    );
    // partial contexts (a context holding the current notification only)
    assert.equal(S.checkLineage([rec(2, "SENT", c1)], [], { partial: true }).ok, true);
    bad([rec(2, "SENT", c1)], [], /which is not in the lineage/);
    assert.equal(S.checkLineage([rec(1, "SUPERSEDED")], [], { partial: true }).ok, true);
    // retries of version n after its correction was created are suppressed (L-04 item 3)
    const at = (ms: number) => new Date(Date.parse(v2[0]!.occurred_at) + ms).toISOString();
    const attempt = (when: string): S.EvidenceEntry => ({
      kind: "DELIVERY_ATTEMPT",
      version: 1,
      recorded_at: when,
      data: { status: "ATTEMPTED", at: when },
    });
    const versions = [rec(1, "SENT"), rec(2, "CORRECTED", c1)];
    assert.equal(
      S.checkLineage(versions, [...v1, v2[0]], { evidence: [attempt(at(-30e3))] }).ok,
      true,
      "an attempt before the correction",
    );
    bad(versions, [...v1, v2[0]!], /1 delivery attempt\(s\) after its correction v2 was created/, {
      evidence: [attempt(at(30e3))],
    });
  });

  test("ST-32 referral (work/LEAD_notes.md L-10): REFERRAL_RETURNED is the secretary's return only; the sector head decides through REFERRAL_HEAD_DECIDED; REFERRAL_SUBMITTED records a resubmission; hold rows", () => {
    const R = u(19);
    const rv = (type: string, payload: Payload = {}) =>
      ev(type, ref("REFERRAL", R), payload, { case_id: null });
    for (const [n, v] of [
      ["REFERRAL_SECTOR_APPROVED", "REFERRAL_HEAD_DECIDED"],
      ["REFERRAL_SECTOR_RETURNED", "REFERRAL_HEAD_DECIDED"],
      ["SECTOR_APPROVED", "REFERRAL_HEAD_DECIDED"],
      ["SECTOR_RETURNED", "REFERRAL_HEAD_DECIDED"],
      ["REFERRAL_RETURNED_FOR_COMPLETION", "REFERRAL_RETURNED"],
      ["RETURNED_FOR_COMPLETION", "REFERRAL_RETURNED"],
      ["REFERRAL_RESUBMITTED", "REFERRAL_SUBMITTED"],
      ["RESUBMITTED", "REFERRAL_SUBMITTED"],
    ])
      assert.equal(C.toV13EventType(n), v, n);
    const row = (p: string) => C.PLATFORM_AUDIT_EVENT_MAP.find((m) => m.platform === p)!;
    assert.deepEqual({ ...row("REFERRAL_SECTOR_APPROVED").v13_payload }, { decision: "APPROVED" });
    assert.deepEqual({ ...row("REFERRAL_SECTOR_RETURNED").v13_payload }, { decision: "RETURNED" });
    assert.deepEqual({ ...row("SECTOR_RETURNED").v13_payload }, { decision: "RETURNED" });
    assert.deepEqual({ ...row("REFERRAL_RESUBMITTED").v13_payload }, { resubmission: true });
    assert.ok(
      C.PLATFORM_AUDIT_EVENT_MAP.filter((m) => /SECTOR_/.test(m.platform)).every(
        (m) => m.v13 === "REFERRAL_HEAD_DECIDED",
      ),
      "a sector-head decision never maps to REFERRAL_RETURNED",
    );
    assert.deepEqual(
      C.PLATFORM_AUDIT_EVENT_MAP.filter((m) => m.v13 === "REFERRAL_RETURNED")
        .map((m) => m.platform)
        .sort(),
      ["REFERRAL_RETURNED_FOR_COMPLETION", "RETURNED_FOR_COMPLETION"],
    );
    assert.match(
      C.EVENT_CATALOGUE.REFERRAL_RETURNED!.source,
      /RETURNED_FOR_COMPLETION: the secretary's return; the sector head's SECTOR_RETURNED is REFERRAL_HEAD_DECIDED \{decision: RETURNED\}/,
    );
    const A = (from: string | null, e: DomainEvent) => S.applyEvent("REFERRAL", from, e);
    assert.equal(
      A(null, rv("REFERRAL_SUBMITTED")),
      "OPEN",
      "the first submission to the sector head: in preparation",
    );
    assert.equal(
      A("OPEN", rv("REFERRAL_HEAD_DECIDED", { decision: "APPROVED" })),
      "IN_PROGRESS",
      "the referral reaches the secretariat",
    );
    assert.equal(
      A("OPEN", rv("REFERRAL_HEAD_DECIDED", { decision: "RETURNED" })),
      "RETURNED",
      "the sector head's return: its own transition",
    );
    assert.equal(A("IN_PROGRESS", rv("REFERRAL_HEAD_DECIDED", { decision: "RETURNED" })), "RETURNED");
    assert.equal(
      A("IN_PROGRESS", rv("REFERRAL_RETURNED")),
      "RETURNED",
      "the secretary's return for completion",
    );
    assert.equal(
      A("RETURNED", rv("REFERRAL_SUBMITTED")),
      "IN_PROGRESS",
      "a resubmission after a return (the from-state identifies it)",
    );
    assert.equal(
      A("FAILED", rv("REFERRAL_SUBMITTED", { resubmission: true })),
      "IN_PROGRESS",
      "a resubmission after a rejection",
    );
    assert.equal(
      A("IN_PROGRESS", rv("REFERRAL_HEAD_DECIDED", { decision: "APPROVED" })),
      "IN_PROGRESS",
      "hold: the head approves a resubmitted referral",
    );
    assert.equal(
      A("IN_PROGRESS", rv("REFERRAL_RECEIVED")),
      "IN_PROGRESS",
      "hold: arrival at the secretariat after the approval",
    );
    throwsCode(() => A("OPEN", rv("REFERRAL_HEAD_DECIDED")), "TRANSITION_NOT_ALLOWED");
    throwsCode(() => A("OPEN", rv("REFERRAL_HEAD_DECIDED", { decision: "MAYBE" })), "TRANSITION_NOT_ALLOWED");
    throwsCode(() => A("OPEN", rv("REFERRAL_RECEIVED")), "TRANSITION_NOT_ALLOWED");
    throwsCode(() => A("IN_PROGRESS", rv("REFERRAL_SUBMITTED")), "TRANSITION_NOT_ALLOWED");
    throwsCode(() => A("COMPLETED", rv("REFERRAL_SUBMITTED")), "TRANSITION_NOT_ALLOWED");
    throwsCode(() => A(null, rv("REFERRAL_CREATED")), "NOT_A_DRIVING_EVENT");
    throwsCode(() => A("OPEN", rv("REFERRAL_ACKNOWLEDGED")), "NOT_A_DRIVING_EVENT");
    const path = [
      rv("REFERRAL_CREATED"),
      rv("REFERRAL_SUBMITTED"),
      rv("REFERRAL_HEAD_DECIDED", { decision: "APPROVED" }),
      rv("REFERRAL_RECEIVED"),
      rv("REFERRAL_RETURNED", { round: "FIRST" }),
      rv("REFERRAL_SUBMITTED"),
      rv("REFERRAL_HEAD_DECIDED", { decision: "APPROVED" }),
      rv("REFERRAL_RECEIVED"),
      rv("REFERRAL_ACCEPTED", { round: "FIRST" }),
    ];
    const id = (i: number) => path[i]!.event_id;
    const all = S.statusFromEvents("REFERRAL", R, path);
    assert.deepEqual([all.status, all.source_event_id], ["COMPLETED", id(8)]);
    assert.deepEqual([...all.applied], [1, 2, 4, 5, 8].map(id));
    assert.deepEqual([...all.held], [3, 6, 7].map(id));
    const mid = S.statusFromEvents("REFERRAL", R, path.slice(0, 8));
    assert.deepEqual(
      [mid.status, mid.source_event_id],
      ["IN_PROGRESS", id(5)],
      "a held event is never a status source",
    );
    assert.deepEqual(S.checkHistory("REFERRAL", R, path), { ok: true, problems: [], final: "COMPLETED" });
    assert.deepEqual(
      S.checkHistory("REFERRAL", R, path.slice(4)),
      { ok: true, problems: [], final: "COMPLETED" },
      "a history may start mid-way",
    );
    const holds = S.holdsOf("REFERRAL");
    assert.equal(holds.length, 2);
    assert.ok(holds.every((h) => h.hold === true && C.LABELS.includes(h.label) && h.source));
    assert.deepEqual([...S.holdsOf("ProcedureStatus")], []);
    assert.deepEqual([...S.holdsOf("TASK")], []);
    for (const h of holds)
      for (const f of h.from)
        for (const e of h.on) {
          const payload = h.when ? { [h.when.path.split(".")[1]!]: h.when.eq } : {};
          const hit = C.getConcept("REFERRAL").transitions.filter(
            (x) =>
              x.on.includes(e) &&
              (x.from === null ? f === null : x.from.includes(f)) &&
              S.guardHolds(x.when, { payload }),
          );
          assert.deepEqual(hit, [], `hold ${f} --${e}--> overlaps a row`);
        }
    const ind = S.assertIndependent("REFERRAL");
    assert.ok(ind.ok && ind.checks.some((c) => c.id === "HOLDS" && c.ok && /^2 hold row/.test(c.detail)));
    const rows = [...C.getConcept("REFERRAL").transitions];
    const hold = (from: string[], on: string[], when: Guard | null = null): HoldRow => ({
      from,
      on,
      when,
      hold: true,
      label: "PROPOSAL",
      source: "tests/status.test.js",
    });
    const rejectHold = (hs: HoldRow[], re: RegExp) =>
      assert.throws(
        () => S.assertIndependent("REFERRAL", null, { rows, holds: hs }),
        (e: S.DomainError) => e.code === "STATUS_DERIVATION_FORBIDDEN" && re.test(e.message),
        String(re),
      );
    rejectHold([hold(["UNDER_VOTE"], ["REFERRAL_RECEIVED"])], /OWN_STATES/);
    rejectHold([hold(["IN_PROGRESS"], ["NO_SUCH_EVENT"])], /KNOWN_EVENT/);
    rejectHold([hold(["IN_PROGRESS"], ["BALLOT_OPENED"])], /EVENT_NAMES_TARGET/);
    rejectHold([hold(["IN_PROGRESS"], ["REFERRAL_CREATED"])], /HOLD_DRIVES/);
    rejectHold(
      [hold(["IN_PROGRESS"], ["REFERRAL_RECEIVED"], { path: "object.status", eq: "OPEN" })],
      /GUARD_READS_EVENT/,
    );
  });

  test("ST-33 master execution directive (owner message, 27 Oct 2026): §4.1 objects, §4.2 classes, §4.3 examples, §7 layers and §13 lifecycle values carried by the model (the line-by-line comparison with the directive is not ported: PORT_PLAN §5)", () => {
    // The directive is an owner message, never copied into the repository: only the assertions that do not read it are ported.
    // §4.3 examples :366-374 → one forbidden inference each, whose source quotes the line; :375 is the display rule (INV-11)
    const FI_LINES = {
      366: "FI-05",
      367: "FI-03",
      368: "FI-07",
      369: "FI-06",
      370: "FI-17",
      371: "FI-08",
      372: "FI-04",
      373: "FI-09",
      374: "FI-15",
    };
    assert.deepEqual(
      EP.FORBIDDEN_INFERENCES.map((f) => f.id),
      Array.from({ length: 17 }, (_, i) => `FI-${String(i + 1).padStart(2, "0")}`),
    );
    for (const [n, id] of Object.entries(FI_LINES)) {
      const f = EP.FORBIDDEN_INFERENCES.find((x) => x.id === id)!;
      assert.ok(f.source.includes(`${EP.DIRECTIVE}:${n} (§4.3 "`), `${id} cites directive :${n}`);
    }
    const find = (p: string, a: string, s: string | null = null, e: string | null = null) => {
      const f = EP.findForbiddenInference({
        premise_event_type: p,
        about_type: a,
        asserts_status: s,
        asserts_event: e,
      });
      return f && f.id;
    };
    assert.equal(find("NOTIFICATION_SENT", "CASE", "S5.05"), "FI-05");
    assert.equal(find("RECOMMENDATION_ADOPTED", "DECISION", "DECIDED"), "FI-03");
    assert.equal(find("LEGAL_OPINION_SUBMITTED", "RECOMMENDATION", "ADOPTED"), "FI-07");
    assert.equal(find("PARTICIPANTS_INVITED", "MEETING", "CLOSED"), "FI-06");
    assert.equal(find("PACKAGE_SUBMITTED_FOR_VOTE", "BALLOT", "OPEN"), "FI-17");
    assert.equal(find("PACKAGE_SUBMITTED_FOR_VOTE", "RECOMMENDATION", "UNDER_VOTE"), "FI-17");
    assert.equal(find("NOTIFICATION_DRAFTED", "NOTIFICATION", "SENT"), "FI-08");
    assert.equal(find("NOTIFICATION_EXPORTED", "NOTIFICATION", "DELIVERY_CONFIRMED"), "FI-04");
    assert.equal(find("DELIVERY_ATTEMPTED", "NOTIFICATION", null, "RECIPIENT_ACKNOWLEDGED"), "FI-09");
    assert.equal(find("BALLOT_OPENED", "BALLOT", "OPEN"), null, "the opening itself is the evidence");
    // the same examples as forbidden derivations: a doctored table is rejected
    const rowsOf = (id: string): TransitionRow[] => [...C.getConcept(id).transitions];
    const row = (from: string[], to: string, on: string[]): TransitionRow => ({
      from,
      to,
      on,
      when: null,
      label: "PROPOSAL",
    });
    const reject = (target: string, source: string, rows: TransitionRow[], re: RegExp) =>
      assert.throws(
        () => S.assertIndependent(target, source, { rows }),
        (e: S.DomainError) => e.code === "STATUS_DERIVATION_FORBIDDEN" && re.test(e.message),
        `${target} ← ${source}`,
      );
    reject(
      "BALLOT",
      "PROCEDURE",
      [...rowsOf("BALLOT"), row(["NOT_STARTED"], "OPEN", ["PACKAGE_SUBMITTED_FOR_VOTE"])],
      /FD-05/,
    );
    reject(
      "RECOMMENDATION",
      "PROCEDURE",
      [...rowsOf("RECOMMENDATION"), row(["DRAFT"], "UNDER_VOTE", ["PACKAGE_SUBMITTED_FOR_VOTE"])],
      /FD-05/,
    );
    reject(
      "MEETING",
      "NOTIFICATION",
      [...rowsOf("MEETING"), row(["SCHEDULED"], "OPENED", ["PARTICIPANTS_INVITED"])],
      /FD-06/,
    );
    // §7: Layer A states :598-605, Layer B kinds :615-620, the two examples :641 and :645
    const records: [number, string, string, string, string][] = [
      [1003, "Draft creation.", "NOTIFICATION", "DRAFT", "NOTIFICATION_DRAFTED"],
      [1004, "Validation.", "NOTIFICATION", "VALIDATED", "NOTIFICATION_VALIDATED"],
      [1005, "Authorization.", "NOTIFICATION", "AUTHORIZED", "NOTIFICATION_AUTHORIZED"],
      [1006, "Dispatch.", "NOTIFICATION", "SENT", "NOTIFICATION_SENT"],
      [
        1007,
        "Provider acceptance.",
        "DELIVERY_ATTEMPT",
        "ACCEPTED_BY_PROVIDER",
        "DELIVERY_ACCEPTED_BY_PROVIDER",
      ],
      [1008, "Delivery evidence.", "NOTIFICATION", "DELIVERY_CONFIRMED", "DELIVERY_CONFIRMED"],
    ];
    for (const [, text, type, status, event] of records) {
      assert.deepEqual(
        [...S.evidenceEventsInto(type, status)],
        [event],
        `${text} → ${type} ${status} only via ${event}`,
      );
    }
    for (const ty of ["NOTIFICATION", "DELIVERY_ATTEMPT"])
      assert.ok(
        !S.drivingEvents(ty).includes("RECIPIENT_ACKNOWLEDGED"),
        `${ty}: acknowledgement is an event, never a status`,
      );
    assert.equal(
      new Set([...records.map((x) => x[4]), "RECIPIENT_ACKNOWLEDGED"]).size,
      7,
      "seven distinct records",
    );
  });

  test("ST-35 ballot closure (work/LEAD_notes.md L-10, L-11): a counted result completes the ballot, NO_QUORUM fails it, a closure without a result matches no row; NO_DECISION is an outcome, never an adoption or a decision", () => {
    const Bx = u(29);
    const Rx = u(30);
    for (const result of ["APPROVED", "REJECTED", "TIED", "NO_DECISION"]) {
      assert.equal(
        S.applyEvent("BALLOT", "OPEN", ev("BALLOT_CLOSED", ref("BALLOT", Bx), { result })),
        "COMPLETED",
        result,
      );
    }
    assert.equal(
      S.applyEvent("BALLOT", "OPEN", ev("BALLOT_CLOSED", ref("BALLOT", Bx), { result: "NO_QUORUM" })),
      "FAILED",
      "a vote without quorum is never shown completed or cast (L-10)",
    );
    for (const payload of [{}, { result: null }, { result: "OTHER" }]) {
      throwsCode(
        () => S.applyEvent("BALLOT", "OPEN", ev("BALLOT_CLOSED", ref("BALLOT", Bx), payload)),
        "TRANSITION_NOT_ALLOWED",
      );
    }
    assert.deepEqual([...S.evidenceEventsInto("BALLOT", "FAILED")], ["BALLOT_CLOSED"]);
    assert.equal(
      EP.findForbiddenInference({
        premise_event_type: "PACKAGE_SUBMITTED_FOR_VOTE",
        about_type: "BALLOT",
        asserts_status: "FAILED",
        asserts_event: null,
      })!.id,
      "FI-17",
    );
    const opened = ev("BALLOT_OPENED", ref("BALLOT", Bx));
    const closed = ev("BALLOT_CLOSED", ref("BALLOT", Bx), {
      result: "NO_DECISION",
      target: ref("RECOMMENDATION", Rx),
    });
    throwsCode(() => S.applyEvent("RECOMMENDATION", "UNDER_VOTE", closed), "NOT_A_DRIVING_EVENT");
    throwsCode(() => S.applyEvent("DECISION", "SUBMITTED_TO_AUTHORITY", closed), "NOT_A_DRIVING_EVENT");
    assert.deepEqual([...S.evidenceEventsInto("RECOMMENDATION", "ADOPTED")], ["RECOMMENDATION_ADOPTED"]);
    assert.deepEqual([...S.evidenceEventsInto("DECISION", "DECIDED")], ["AUTHORITY_DECISION_RECORDED"]);
    assert.equal(
      EP.findForbiddenInference({
        premise_event_type: "BALLOT_CLOSED",
        about_type: "DECISION",
        asserts_status: "DECIDED",
        asserts_event: null,
      })!.id,
      "FI-03",
    );
    const r = S.statusFromEvents("BALLOT", Bx, [closed, opened]); // folded in recorded order, whatever the list order
    assert.deepEqual([r.status, r.source_event_id], ["COMPLETED", closed.event_id]);
    assert.match(C.EVENT_CATALOGUE.BALLOT_CLOSED!.note!, /NO_DECISION/);
  });
});
