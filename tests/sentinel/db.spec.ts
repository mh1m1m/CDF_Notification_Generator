// Case Context Sentinel, database half (V13-QA-003; TEST_ARCHITECTURE.md §7): for every persona and workspace, every
// row the persona can read in a case-keyed table belongs to a visible case, and every child row agrees with its
// parent. Runs without a browser against the local database of the started app. The planted-fault self-test proves
// each rule fires on a copy of a real snapshot before the clean result is trusted. SYNTHETIC data only.
import { expect, test } from "@playwright/test";
import { scenarioDb, type ScenarioDb } from "../fixtures/db";
import { DB_PERSONAS, KNOWN_CASE_KEYED } from "../fixtures/db-personas";
import { cloneSnapshot, personaSnapshot, type PersonaSnapshot } from "../fixtures/db-snapshot";
import { caseId } from "../fixtures/scenario";
import { dbSentinelViolations, formatDbViolations } from "./db-sentinel";

let db: ScenarioDb;
test.beforeAll(() => {
  db = scenarioDb();
});
test.afterAll(async () => {
  await db?.end();
});

const rulesOf = (vs: { rule: string }[]) => [...new Set(vs.map((v) => v.rule))].sort();

for (const p of DB_PERSONAS) {
  test(`DB Sentinel — ${p.persona} @ ${p.workspace}: every readable case-keyed row is a visible case's and agrees with its parent`, async () => {
    const s = await personaSnapshot(db, p.persona, p.workspace);
    expect(s.cases.map((c) => c.id).sort(), "visible cases (DATA_MODEL §5)").toEqual(p.sees);
    expect(Object.keys(s.caseKeyed), "every known case-keyed table is discovered").toEqual(
      expect.arrayContaining([...KNOWN_CASE_KEYED]),
    );
    expect(s.caseKeyed.task!.length, "the persona reads tasks").toBeGreaterThan(0);
    expect(s.caseKeyed.procedural_event!.length, "the persona reads events").toBeGreaterThan(0);
    const v = dbSentinelViolations(s);
    expect(v, formatDbViolations(v)).toEqual([]);
  });
}

test.describe("planted faults are detected", () => {
  let base: PersonaSnapshot;
  const hidden = caseId("02"); // not visible to Secretary Alpha
  test.beforeAll(async () => {
    base = await personaSnapshot(db, "secretary-alpha", "SECRETARIAT");
    expect(dbSentinelViolations(base)).toEqual([]);
    expect(base.cases.some((c) => c.id === hidden)).toBe(false);
  });

  test("a row of a hidden case in any case-keyed table → D1", () => {
    for (const table of KNOWN_CASE_KEYED) {
      const s = cloneSnapshot(base);
      s.caseKeyed[table]!.push(hidden);
      expect(rulesOf(dbSentinelViolations(s)), table).toEqual(["D1"]);
    }
  });

  test("a task event whose task is not readable → D2; on another case than its task → D3", () => {
    const s = cloneSnapshot(base);
    const e = s.events.find((x) => x.subject_type === "task")!;
    expect(e, "the snapshot has a task event to plant on").toBeDefined();
    s.tasks = s.tasks.filter((t) => t.id !== e.subject_id);
    expect(rulesOf(dbSentinelViolations(s))).toEqual(["D2"]);

    const s2 = cloneSnapshot(base);
    const e2 = s2.events.find((x) => x.subject_type === "task")!;
    e2.case_id = s2.cases.find((c) => c.id !== e2.case_id)!.id;
    expect(rulesOf(dbSentinelViolations(s2))).toEqual(["D3"]);
  });

  test("a notification event whose notification is not readable → D2; on another case → D3", () => {
    const s = cloneSnapshot(base);
    const e = s.notificationEvents[0]!;
    expect(e, "the snapshot has a notification event to plant on").toBeDefined();
    s.notifications = s.notifications.filter((n) => n.id !== e.notification_id);
    expect(rulesOf(dbSentinelViolations(s))).toEqual(["D2"]);

    const s2 = cloneSnapshot(base);
    const e2 = s2.notificationEvents[0]!;
    e2.case_id = s2.cases.find((c) => c.id !== e2.case_id)!.id;
    expect(rulesOf(dbSentinelViolations(s2))).toEqual(["D3"]);
  });

  test("a notification superseding an unreadable one → D2, or one of another case → D3", () => {
    const s = cloneSnapshot(base);
    expect(s.notifications.length).toBeGreaterThanOrEqual(2);
    s.notifications[0]!.supersedes_id = "2f000000-0000-4000-8000-0000000000ff";
    expect(rulesOf(dbSentinelViolations(s))).toEqual(["D2"]);

    const s2 = cloneSnapshot(base);
    const [a, b] = [
      s2.notifications[0]!,
      s2.notifications.find((n) => n.case_id !== s2.notifications[0]!.case_id)!,
    ];
    expect(b, "two notifications on different cases").toBeDefined();
    a.supersedes_id = b.id;
    expect(rulesOf(dbSentinelViolations(s2))).toEqual(["D3"]);
  });
});
// Negative-test personas (ARCH follow-up on #68): Secretary Epsilon (membership expired) and Persona Zeta (inactive)
// read nothing at all, in every workspace: no case, no row of any case-keyed table. The same pin as the browser one
// (tests/e2e/negative-personas-pinning.spec.ts), one layer down.
for (const slug of ["secretary-epsilon", "persona-zeta"]) {
  for (const workspace of ["SECRETARIAT", "INVESTIGATIONS", "GOVERNANCE"] as const) {
    test(`DB Sentinel — ${slug} @ ${workspace} reads nothing`, async () => {
      const s = await personaSnapshot(db, slug, workspace);
      expect(s.cases, "cases").toEqual([]);
      expect(Object.keys(s.caseKeyed), "every known case-keyed table is discovered").toEqual(
        expect.arrayContaining([...KNOWN_CASE_KEYED]),
      );
      for (const [table, rows] of Object.entries(s.caseKeyed)) expect(rows, table).toEqual([]);
      expect([s.tasks, s.events, s.notifications, s.notificationEvents]).toEqual([[], [], [], []]);
    });
  }
}
