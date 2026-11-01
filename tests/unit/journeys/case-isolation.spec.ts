// tests/unit/journeys/case-isolation.spec.ts — V13-PROC-018, REQ-JRN-007 (Part XII §11 Multi-Case Isolation).
// "Each case must have its own journey instance. Case A must never inherit Case B's procedural state."
// In M1 the journey instance is computed: (case record, procedural object, the case's own recorded events, catalogue)
// → resolveLevel1 / resolveLevel2_3 → buildProgressView. These checks prove that the computation is per case.
// Design note: docs/teams/proc/JOURNEY_INSTANCE.md. SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
import { describe, expect, it } from "vitest";
import {
  resolveLevel1,
  resolveLevel2_3,
  type CaseRecordInput,
  type JourneyEvent,
  type Level1Known,
  type Level23Resolved,
  type ProceduralObjectInput,
} from "@/lib/journeys/resolve";
import { buildProgressView } from "@/lib/journeys/progress";
import { CATALOGUE_V13 } from "@/lib/journeys";

const J = "J-DECISION-SUBJECT";
const CASE_A = "ca5e0000-0000-4000-8000-00000000a001";
const CASE_B = "ca5e0000-0000-4000-8000-00000000b001";
const OBJ_A = "0b1ec700-0000-4000-8000-00000000a001";
const OBJ_B = "0b1ec700-0000-4000-8000-00000000b001";
const NOTICE_B = "0b1ec700-0000-4000-8000-00000000b0ff";

const po = (caseId: string, objectId: string): ProceduralObjectInput => ({
  object_id: objectId,
  type: "PROCEDURE",
  case_id: caseId,
  journey_id: J,
  status: null,
  status_source_event_id: null,
  steps: [],
  deadlines: [],
});
let minute = 0;
const ev = (
  id: string,
  type: string,
  caseId: string,
  object: { type: string; id: string },
  payload: Record<string, unknown> = {},
): JourneyEvent => {
  minute++;
  return {
    event_id: id,
    type,
    occurred_at: new Date(Date.UTC(2026, 9, 1, 8, minute)).toISOString(),
    recorded_at: new Date(Date.UTC(2026, 9, 1, 8, minute, 30)).toISOString(),
    case_id: caseId,
    object,
    payload,
    version: 1,
  };
};
const proc = (id: string) => ({ type: "PROCEDURE", id });

// Case A: the decision notice is issued and delivered, and the grievance window has started.
const EVENTS_A = [
  ev("evt-A-01", "DECISION_NOTICE_ISSUED", CASE_A, proc(OBJ_A)),
  ev("evt-A-02", "DECISION_NOTICE_DELIVERED", CASE_A, proc(OBJ_A)),
  ev("evt-A-03", "GRIEVANCE_WINDOW_STARTED", CASE_A, proc(OBJ_A)),
];
// Case B: the decision notice is issued only.
const EVENTS_B = [ev("evt-B-01", "DECISION_NOTICE_ISSUED", CASE_B, proc(OBJ_B))];
const MIXED = [...EVENTS_A, ...EVENTS_B].sort((x, y) =>
  String(x.occurred_at).localeCompare(String(y.occurred_at)),
);

const resolve = (caseId: string, objectId: string, events: readonly unknown[]): Level23Resolved =>
  resolveLevel2_3(po(caseId, objectId), CATALOGUE_V13, null, events) as Level23Resolved;
const states = (r: Level23Resolved) => r.actual.map((x) => `${x.step_id}:${x.state}`);
const evidence = (r: Level23Resolved) =>
  r.actual.map((x) => x.evidence_event_id).filter((x): x is string => typeof x === "string");
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("REQ-JRN-007: each case has its own journey instance", () => {
  it("JI-01 two cases with different events give different Layer A and Layer B progress", () => {
    const a = resolve(CASE_A, OBJ_A, EVENTS_A);
    const b = resolve(CASE_B, OBJ_B, EVENTS_B);
    expect(a.actual.find((x) => x.step_id === `${J}/1/1`)?.state).toBe("COMPLETED");
    expect(b.actual.find((x) => x.step_id === `${J}/1/1`)?.state).toBe("IN_PROGRESS");
    expect(states(a)).not.toEqual(states(b));
    expect(a.expected.map((x) => x.step_id)).not.toEqual(b.expected.map((x) => x.step_id));
    // each case's evidence is its own events only
    expect(evidence(a).every((id) => id.startsWith("evt-A-"))).toBe(true);
    expect(evidence(b).every((id) => id.startsWith("evt-B-"))).toBe(true);
  });

  it("JI-02 given both cases' events, each case resolves exactly as from its own events, and the other case's are ignored", () => {
    const a = resolve(CASE_A, OBJ_A, MIXED);
    const b = resolve(CASE_B, OBJ_B, MIXED);
    expect(plain(a.actual)).toEqual(plain(resolve(CASE_A, OBJ_A, EVENTS_A).actual));
    expect(plain(a.expected)).toEqual(plain(resolve(CASE_A, OBJ_A, EVENTS_A).expected));
    expect(plain(b.actual)).toEqual(plain(resolve(CASE_B, OBJ_B, EVENTS_B).actual));
    expect(plain(b.expected)).toEqual(plain(resolve(CASE_B, OBJ_B, EVENTS_B).expected));
    expect(a.ignored_events.map((x) => x.event_id).sort()).toEqual(["evt-B-01"]);
    expect(b.ignored_events.map((x) => x.event_id).sort()).toEqual(["evt-A-01", "evt-A-02", "evt-A-03"]);
  });

  it("JI-03 an event of another case that names this case's object, as its object or in its payload, is refused with CASE_MISMATCH", () => {
    const viaObject = ev("evt-B-90", "DECISION_NOTICE_DELIVERED", CASE_B, proc(OBJ_A));
    const viaPayload = ev(
      "evt-B-91",
      "DECISION_NOTICE_DELIVERED",
      CASE_B,
      { type: "NOTIFICATION", id: NOTICE_B },
      { subject_object_id: OBJ_A },
    );
    const issued = ev("evt-A-90", "DECISION_NOTICE_ISSUED", CASE_A, proc(OBJ_A));
    for (const foreign of [viaObject, viaPayload]) {
      const r = resolve(CASE_A, OBJ_A, [issued, foreign]);
      expect(r.ignored_events).toEqual([{ event_id: foreign.event_id, reason: "CASE_MISMATCH" }]);
      expect(r.actual.find((x) => x.step_id === `${J}/1/1`)?.state).toBe("IN_PROGRESS");
      expect(evidence(r)).not.toContain(foreign.event_id);
    }
    // the same payload reference recorded under this case does count (the check is the case, not the path)
    const own = { ...viaPayload, event_id: "evt-A-91", case_id: CASE_A };
    expect(resolve(CASE_A, OBJ_A, [issued, own]).actual.find((x) => x.step_id === `${J}/1/1`)?.state).toBe(
      "COMPLETED",
    );
  });

  it("JI-04 resolving one case leaves no state behind: interleaved calls give identical results, inputs unchanged", () => {
    const before = plain(MIXED);
    const catalogueBefore = JSON.stringify(CATALOGUE_V13);
    const a1 = plain(resolve(CASE_A, OBJ_A, MIXED));
    const b1 = plain(resolve(CASE_B, OBJ_B, MIXED));
    const a2 = plain(resolve(CASE_A, OBJ_A, MIXED));
    const b2 = plain(resolve(CASE_B, OBJ_B, [...MIXED].reverse()));
    expect(a2).toEqual(a1);
    expect(b2.actual).toEqual(b1.actual);
    expect(b2.expected).toEqual(b1.expected);
    expect(plain(MIXED)).toEqual(before);
    expect(JSON.stringify(CATALOGUE_V13)).toBe(catalogueBefore);
  });

  it("JI-05 Level 1 comes from each case's own record only", () => {
    const rec = (caseId: string, code: string): CaseRecordInput => ({
      exists: true,
      case_id: caseId,
      status: { code, recorded_at: "2026-10-01T08:00:00Z", source_event_id: `evt-${caseId.slice(-4)}-case` },
      flags: { suspended: false, returned: false, cancelled: false, reopened: false, closed: false },
    });
    const a = resolveLevel1(rec(CASE_A, "S3.02"), CATALOGUE_V13) as Level1Known;
    const b = resolveLevel1(rec(CASE_B, "S2.01"), CATALOGUE_V13) as Level1Known;
    expect(a.substate.code).toBe("S3.02");
    expect(b.substate.code).toBe("S2.01");
    expect(plain(resolveLevel1(rec(CASE_A, "S3.02"), CATALOGUE_V13))).toEqual(plain(a));
  });

  it("JI-06 each case's progress view cites only its own events", () => {
    const viewA = buildProgressView(null, resolve(CASE_A, OBJ_A, MIXED), "SECRETARY");
    const viewB = buildProgressView(null, resolve(CASE_B, OBJ_B, MIXED), "SECRETARY");
    const cited = (v: unknown) =>
      [...JSON.stringify(v).matchAll(/"evidence_event_id":"([^"]+)"/g)].map((m) => m[1]);
    expect(cited(viewA).length).toBeGreaterThan(0);
    expect(cited(viewA).every((id) => id!.startsWith("evt-A-"))).toBe(true);
    expect(cited(viewB).every((id) => id!.startsWith("evt-B-"))).toBe(true);
    expect(JSON.stringify(viewA)).not.toContain(CASE_B);
    expect(JSON.stringify(viewB)).not.toContain(CASE_A);
  });
});
