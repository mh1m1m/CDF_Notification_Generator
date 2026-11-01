// Case Context Sentinel, database half, read functions (ARCH follow-up on #68). The pages read through these
// functions, not the tables, so each one is checked for every persona/workspace pair (pinned to DATA_MODEL §5) and
// every seeded case, in one repeatable-read snapshot as cdf_v13_user:
//   - can_access_case(id) is true exactly for the visible cases;
//   - case_header / case_events / case_tasks / case_notifications return nothing for a hidden case, and for a visible
//     one only that case's rows, the same rows the persona reads from the tables;
//   - portfolio_page and portfolio_count list exactly the visible cases; my_work_tasks and notifications_page return
//     only visible cases' rows, and notifications_count equals the page.
// Read-only; every transaction is rolled back. SYNTHETIC data only.
import { expect, test } from "@playwright/test";
import { scenarioDb, type ScenarioDb } from "../fixtures/db";
import { DB_PERSONAS } from "../fixtures/db-personas";
import { SEEDED_CASE_IDS } from "../fixtures/scenario";

let db: ScenarioDb;
test.beforeAll(() => {
  db = scenarioDb();
});
test.afterAll(async () => {
  await db?.end();
});

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id).sort();

for (const p of DB_PERSONAS) {
  test(`DB Sentinel functions — ${p.persona} @ ${p.workspace}: every case-returning read stays within the visible cases`, async () => {
    const visible = new Set(p.sees);
    const out = await db.asPersona(p.persona, p.workspace, async (tx) => {
      const perCase: Record<string, unknown> = {};
      for (const id of [...SEEDED_CASE_IDS].sort()) {
        const [access] = await tx<
          { ok: boolean }[]
        >`select cdf_notifications_v13.can_access_case(${id}::uuid) as ok`;
        const header = await tx<{ id: string }[]>`
          select id::text as id from cdf_notifications_v13.case_header(${id}::uuid)`;
        const events = await tx<{ id: string; case_id: string }[]>`
          select id::text as id, case_id::text as case_id from cdf_notifications_v13.case_events(${id}::uuid)`;
        const tasks = await tx<{ id: string; case_id: string }[]>`
          select id::text as id, case_id::text as case_id from cdf_notifications_v13.case_tasks(${id}::uuid)`;
        const notifications = await tx<{ id: string; case_id: string }[]>`
          select notification_id::text as id, case_id::text as case_id
            from cdf_notifications_v13.case_notifications(${id}::uuid)`;
        const tableEvents = await tx<{ id: string }[]>`
          select id::text as id from cdf_notifications_v13.procedural_event where case_id = ${id}::uuid`;
        const tableTasks = await tx<{ id: string }[]>`
          select id::text as id from cdf_notifications_v13.task where case_id = ${id}::uuid`;
        const tableNotifications = await tx<{ id: string }[]>`
          select id::text as id from cdf_notifications_v13.notification where case_id = ${id}::uuid`;
        perCase[id] = {
          access: access!.ok,
          header: ids(header),
          events: ids(events),
          eventCases: [...new Set(events.map((r) => r.case_id))],
          tasks: ids(tasks),
          taskCases: [...new Set(tasks.map((r) => r.case_id))],
          notifications: ids(notifications),
          notificationCases: [...new Set(notifications.map((r) => r.case_id))],
          tableEvents: ids(tableEvents),
          tableTasks: ids(tableTasks),
          tableNotifications: ids(tableNotifications),
        };
      }
      const portfolio = await tx<{ id: string }[]>`
        select id::text as id
          from cdf_notifications_v13.portfolio_page(null, 100, null, null, null, false)`;
      const [portfolioCount] = await tx<{ n: string }[]>`
        select cdf_notifications_v13.portfolio_count(null, null, null, false)::text as n`;
      const myWork = await tx<{ case_id: string }[]>`
        select case_id::text as case_id from cdf_notifications_v13.my_work_tasks(true)`;
      const center = await tx<{ case_id: string }[]>`
        select case_id::text as case_id
          from cdf_notifications_v13.notifications_page(null, null, 100, null, null, null, null, null)`;
      const [centerCount] = await tx<{ n: string }[]>`
        select cdf_notifications_v13.notifications_count(null, null, null, null, null)::text as n`;
      return {
        perCase,
        portfolio,
        portfolioCount: Number(portfolioCount!.n),
        myWork,
        center,
        centerCount: Number(centerCount!.n),
      };
    });

    for (const [id, raw] of Object.entries(out.perCase)) {
      const c = raw as Record<string, string[] | boolean>;
      const where = `case ${id}`;
      expect(c.access, `${where}: can_access_case`).toBe(visible.has(id));
      if (!visible.has(id)) {
        expect([c.header, c.events, c.tasks, c.notifications], `${where} is hidden: no rows`).toEqual([
          [],
          [],
          [],
          [],
        ]);
        continue;
      }
      expect(c.header, `${where}: case_header`).toEqual([id]);
      expect(c.events, `${where}: case_events = the case's events`).toEqual(c.tableEvents);
      expect((c.events as string[]).length, `${where} has events`).toBeGreaterThan(0);
      expect(c.tasks, `${where}: case_tasks = the case's tasks`).toEqual(c.tableTasks);
      expect(c.notifications, `${where}: case_notifications = the case's notifications`).toEqual(
        c.tableNotifications,
      );
      for (const k of ["eventCases", "taskCases", "notificationCases"])
        expect(
          (c[k] as string[]).every((x) => x === id),
          `${where}: ${k}`,
        ).toBe(true);
    }
    expect(ids(out.portfolio), "portfolio_page lists exactly the visible cases").toEqual(p.sees);
    expect(out.portfolioCount, "portfolio_count").toBe(p.sees.length);
    expect(
      out.myWork.every((r) => visible.has(r.case_id)),
      "my_work_tasks stays within the visible cases",
    ).toBe(true);
    expect(
      out.center.every((r) => visible.has(r.case_id)),
      "notifications_page stays within the visible cases",
    ).toBe(true);
    expect(out.centerCount, "notifications_count equals the page").toBe(out.center.length);
  });
}
