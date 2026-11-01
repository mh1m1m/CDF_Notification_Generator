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

// Seed personas (database/seed/0001_m1_synthetic.sql).
const GAMMA = "0b000000-0000-4000-8000-000000000003";
const EPSILON = "0b000000-0000-4000-8000-000000000005";

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

  // D4 (V13-QA-007, OI-048). No command and no seed row sets recipient_persona_id yet, so the clean run passes D4
  // without a recipient; these plants prove the rule before the first one is written.
  test("the snapshot carries the case team and every notification's recipient and creation time", () => {
    expect(base.assignments.length, "the persona reads case team rows").toBeGreaterThan(0);
    const visible = new Set(base.cases.map((c) => c.id));
    expect(
      base.assignments.every((a) => visible.has(a.case_id)),
      "team rows of visible cases only",
    ).toBe(true);
    expect(
      base.notifications.every((n) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(n.created_at)),
    ).toBe(true);
    expect(
      base.notifications.every((n) => n.recipient_persona_id === null),
      "no recipient is set in M1",
    ).toBe(true);
  });

  /** A notification and a team row of the same case, with the team row's window open at creation. */
  function onTeam(s: PersonaSnapshot) {
    const n = s.notifications.find((x) => s.assignments.some((a) => a.case_id === x.case_id))!;
    expect(n, "a notification on a case with a readable team").toBeDefined();
    const a = s.assignments.find((x) => x.case_id === n.case_id)!;
    return { n, a };
  }

  test("a recipient on the case's team when the notification was created passes D4", () => {
    const s = cloneSnapshot(base);
    const { n, a } = onTeam(s);
    n.recipient_persona_id = a.persona_id;
    a.valid_from = "2026-01-01T00:00:00.000000Z";
    a.valid_to = null;
    n.created_at = "2026-02-01T00:00:00.000000Z";
    expect(dbSentinelViolations(s)).toEqual([]);
    a.valid_to = "2026-03-01T00:00:00.000000Z"; // left the case later: the notification stays sound
    expect(dbSentinelViolations(s)).toEqual([]);
  });

  test("a recipient taken from another case's team → D4, naming that case", () => {
    // Investigator Gamma is on the teams of 0006 and 0010 (seed 0002), both visible to Alpha, and of no other case
    // Alpha sees; a notification of any other case addressed to Gamma takes its recipient from another case.
    const s = cloneSnapshot(base);
    const gammaCases = new Set(s.assignments.filter((a) => a.persona_id === GAMMA).map((a) => a.case_id));
    expect([...gammaCases].sort()).toEqual([caseId("06"), caseId("10")]);
    const n = s.notifications.find((x) => !gammaCases.has(x.case_id))!;
    expect(n, "a notification outside Gamma's cases").toBeDefined();
    n.recipient_persona_id = GAMMA;
    const v = dbSentinelViolations(s);
    expect(rulesOf(v)).toEqual(["D4"]);
    expect(formatDbViolations(v)).toContain(`team of case ${caseId("06")}, ${caseId("10")} instead`);
  });

  test("a recipient on no readable team → D4", () => {
    const s = cloneSnapshot(base);
    s.notifications[0]!.recipient_persona_id = EPSILON; // on no case team (seed 0002)
    const v = dbSentinelViolations(s);
    expect(rulesOf(v)).toEqual(["D4"]);
    expect(formatDbViolations(v)).toContain("on no case team");
  });

  test("a recipient whose assignment to the case began after, or ended before, the notification → D4", () => {
    for (const [from, to] of [
      ["2026-02-01T00:00:00.000001Z", null], // began one microsecond after creation
      ["2026-01-01T00:00:00.000000Z", "2026-02-01T00:00:00.000000Z"], // ended exactly at creation (valid_to is exclusive)
    ] as const) {
      const s = cloneSnapshot(base);
      const { n, a } = onTeam(s);
      // only this one assignment of the persona to this case
      s.assignments = s.assignments.filter(
        (x) => x === a || !(x.case_id === n.case_id && x.persona_id === a.persona_id),
      );
      n.recipient_persona_id = a.persona_id;
      n.created_at = "2026-02-01T00:00:00.000000Z";
      a.valid_from = from;
      a.valid_to = to;
      const v = dbSentinelViolations(s);
      expect(rulesOf(v), `${from} – ${to}`).toEqual(["D4"]);
      expect(formatDbViolations(v)).toContain("did not hold when it was created");
    }
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
