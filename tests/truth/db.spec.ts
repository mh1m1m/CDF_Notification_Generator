// Procedural Truth Inspector, database half (V13-QA-004; TEST_ARCHITECTURE.md §8): for every persona and workspace,
// the records the persona can read tell one story (task status = fold of its events, no event from the future, one
// CASE_OPENED, CLOSED ⇔ CASE_CLOSED, every notification starts with DRAFT_CREATED). Runs without a browser against the
// local database of the started app. The planted-fault self-test proves each rule fires on a copy of a real snapshot
// before the clean result is trusted. SYNTHETIC data only.
import { expect, test } from "@playwright/test";
import { scenarioDb, type ScenarioDb } from "../fixtures/db";
import { DB_PERSONAS } from "../fixtures/db-personas";
import { cloneSnapshot, personaSnapshot, type PersonaSnapshot } from "../fixtures/db-snapshot";
import { formatDbViolations } from "../sentinel/db-sentinel";
import { dbTruthViolations } from "./db-truth";

let db: ScenarioDb;
test.beforeAll(() => {
  db = scenarioDb();
});
test.afterAll(async () => {
  await db?.end();
});

const rulesOf = (vs: { rule: string }[]) => [...new Set(vs.map((v) => v.rule))].sort();

for (const p of DB_PERSONAS) {
  test(`DB Truth — ${p.persona} @ ${p.workspace}: task statuses, events, case lifecycle and notifications agree`, async () => {
    const s = await personaSnapshot(db, p.persona, p.workspace);
    expect(s.cases.map((c) => c.id).sort(), "visible cases (DATA_MODEL §5)").toEqual(p.sees);
    expect(s.tasks.length, "the persona reads tasks").toBeGreaterThan(0);
    expect(
      s.events.filter((e) => e.event_code === "CASE_OPENED").length,
      "one CASE_OPENED per visible case is read",
    ).toBe(p.sees.length);
    const v = dbTruthViolations(s);
    expect(v, formatDbViolations(v)).toEqual([]);
  });
}

test.describe("planted faults are detected", () => {
  let base: PersonaSnapshot;
  test.beforeAll(async () => {
    // Beta reads tasks with recorded changes and the closed case 0010.
    base = await personaSnapshot(db, "investigator-beta", "INVESTIGATIONS");
    expect(dbTruthViolations(base)).toEqual([]);
  });

  test("a task status no event records → U1; a broken chain → U1", () => {
    const s = cloneSnapshot(base);
    const open = s.tasks.find((t) => !s.events.some((e) => e.subject_id === t.id))!;
    expect(open, "a task with no recorded change").toBeDefined();
    open.status = "DONE";
    expect(rulesOf(dbTruthViolations(s))).toEqual(["U1"]);

    const s2 = cloneSnapshot(base);
    const changed = s2.events.find((e) => e.event_code === "TASK_STATUS_CHANGED")!;
    expect(changed, "a recorded task change").toBeDefined();
    changed.from_status = "BLOCKED";
    expect(rulesOf(dbTruthViolations(s2))).toEqual(["U1"]);
  });

  test("an event recorded in the future, or occurring after it was recorded → U2", () => {
    const s = cloneSnapshot(base);
    s.events[0]!.recorded_in_future = true;
    expect(rulesOf(dbTruthViolations(s))).toEqual(["U2"]);
    const s2 = cloneSnapshot(base);
    s2.events[0]!.occurred_after_recorded = true;
    expect(rulesOf(dbTruthViolations(s2))).toEqual(["U2"]);
  });

  test("a case with no or two CASE_OPENED, or CLOSED without CASE_CLOSED (and the reverse) → U3", () => {
    const s = cloneSnapshot(base);
    s.events = s.events.filter((e) => !(e.event_code === "CASE_OPENED" && e.case_id === s.cases[0]!.id));
    expect(rulesOf(dbTruthViolations(s))).toEqual(["U3"]);

    const s2 = cloneSnapshot(base);
    const opened = s2.events.find((e) => e.event_code === "CASE_OPENED")!;
    s2.events.push({ ...opened, id: "1e000000-0000-4000-8000-0000000000ff", seq: 9999 });
    expect(rulesOf(dbTruthViolations(s2))).toEqual(["U3"]);

    const s3 = cloneSnapshot(base);
    const closed = s3.cases.find((c) => c.records_state === "CLOSED")!;
    expect(closed, "the closed case 0010 is visible").toBeDefined();
    closed.records_state = "ACTIVE";
    expect(rulesOf(dbTruthViolations(s3))).toEqual(["U3"]);

    const s4 = cloneSnapshot(base);
    s4.cases.find((c) => c.records_state !== "CLOSED")!.records_state = "CLOSED";
    expect(rulesOf(dbTruthViolations(s4))).toEqual(["U3"]);
  });

  test("a notification without its DRAFT_CREATED first → U4", () => {
    const s = cloneSnapshot(base);
    const n = s.notifications[0]!;
    expect(n, "a notification to plant on").toBeDefined();
    s.notificationEvents = s.notificationEvents.filter((e) => e.notification_id !== n.id);
    expect(rulesOf(dbTruthViolations(s))).toEqual(["U4"]);

    const s2 = cloneSnapshot(base);
    s2.notificationEvents.find(
      (e) => e.notification_id === s2.notifications[0]!.id && e.seq === 1,
    )!.event_code = "DISPATCHED";
    expect(rulesOf(dbTruthViolations(s2))).toEqual(["U4"]);
  });
});
