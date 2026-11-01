// V13-DB-022 — migration 0014 (REQ-PERF-003, OI-054): case_my_open_tasks_page, the caller's own open tasks on one case,
// one bounded page at a time. Same rows as filtering the unpaged read (case_tasks: is_mine and status OPEN, IN_PROGRESS
// or BLOCKED), ordered by due_date nulls last, task_code in code point order (collate "C"), id; case_tasks_page's
// columns. Negative cases: other case, other workspace, other persona, restricted 0009, unknown case, half / malformed /
// foreign / invisible cursor (all the same empty answer), limit outside 1..100 (22023), expired / inactive / unknown
// personas, forged contexts, the app login itself. Set-up writes run in rolled-back transactions. SYNTHETIC seed data.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/lib/db/security-context";
import { DB_PERSONAS } from "../fixtures/db-personas";
import { clusterAvailable, errorCodeOf, PRIMARY_ADMIN_URL } from "./support/clusters";
import { adminClient, appClient, asPersona, asRaw, claimsText, PERSONA, WORKSPACE } from "./support/context";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function ready(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean; cases: number }[]>`
      select pg_catalog.to_regprocedure('cdf_notifications_v13.case_my_open_tasks_page(uuid, text, uuid, integer)') is not null as present,
             (select count(*)::int from cdf_notifications_v13.case_record) as cases`;
    return Boolean(row?.present) && (row?.cases ?? 0) >= 10;
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const present = await ready();
if (available && !present)
  console.warn("[integration] skipping case-my-open-tasks: migration 0014 or cases seed missing");

const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TASK = (n: number) => `0d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ALL_CASES = Array.from({ length: 10 }, (_, k) => CASE(k + 1));
const UNKNOWN_CASE = "0c000000-0000-4000-8000-0000000000ff";
const OPEN = new Set(["OPEN", "IN_PROGRESS", "BLOCKED"]);

const PERSONA_ID: Record<string, string> = {
  "secretary-alpha": PERSONA.alpha,
  "investigator-beta": PERSONA.beta,
  "investigator-gamma": PERSONA.gamma,
  "governance-officer-delta": PERSONA.delta,
};

type Row = Record<string, unknown> & { page_cursor?: string };

const unpaged = (tx: Tx, c: string) => tx<Row[]>`select * from cdf_notifications_v13.case_tasks(${c}::uuid)`;
const mine = (tx: Tx, c: string, cur: string | null, id: string | null, limit: number | null) =>
  tx<
    Row[]
  >`select * from cdf_notifications_v13.case_my_open_tasks_page(${c}::uuid, ${cur}::text, ${id}::uuid, ${limit}::integer)`;
const tasksPage = (tx: Tx, c: string) =>
  tx<Row[]>`select * from cdf_notifications_v13.case_tasks_page(${c}::uuid, null, null, 100)`;

const strip = (rows: Row[]) => rows.map(({ page_cursor: _c, ...rest }) => rest);

/** Code point comparison (the seed and the fixtures are ASCII, so UTF-16 order is code point order). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** A due date as YYYY-MM-DD (the driver parses date columns into a Date at UTC midnight), or null. */
const dueText = (d: unknown) =>
  d === null || d === undefined ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d);
/** The read's order: due_date nulls last, then task_code in code point order, then id. */
function byReadOrder(a: Row, b: Row): number {
  const da = dueText(a.due_date);
  const db = dueText(b.due_date);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return cmp(da, db);
  }
  return cmp(String(a.task_code), String(b.task_code)) || cmp(String(a.id), String(b.id));
}
/** The overview's filter applied to the unpaged read, in the read's order. */
const expected = (whole: Row[]) =>
  whole.filter((t) => t.is_mine === true && OPEN.has(String(t.status))).sort(byReadOrder);

/** Every page, following the returned cursors; also returns the page sizes. */
async function allPages(tx: Tx, caseId: string, limit: number) {
  const rows: Row[] = [];
  const sizes: number[] = [];
  let cursor: string | null = null;
  let id: string | null = null;
  for (let guard = 0; guard < 500; guard += 1) {
    const batch = await mine(tx, caseId, cursor, id, limit);
    sizes.push(batch.length);
    rows.push(...batch);
    if (batch.length < limit) break;
    const last = batch[batch.length - 1]!;
    cursor = String(last.page_cursor);
    id = String(last.id);
  }
  return { rows, sizes };
}

describe.skipIf(!present)("the caller's open tasks on one case, paged (migration 0014)", () => {
  let app: postgres.Sql;
  let admin: postgres.Sql;
  const as = <T>(persona: string, workspace: string, fn: (tx: Tx) => Promise<T>) =>
    asRaw(app, { claims: claimsText(persona, workspace), mac: "valid" }, fn);
  /** Writes rows as the administrator, then reads as the persona, in one rolled-back transaction. */
  const seededAs = <T>(
    persona: string,
    workspace: string,
    setup: (tx: Tx) => Promise<unknown>,
    fn: (tx: Tx) => Promise<T>,
  ) =>
    asRaw(admin, { claims: claimsText(persona, workspace), mac: "valid" }, async (tx) => {
      await tx`reset role`;
      await setup(tx);
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      return fn(tx);
    });
  const seededAsBeta = <T>(setup: (tx: Tx) => Promise<unknown>, fn: (tx: Tx) => Promise<T>) =>
    seededAs(PERSONA.beta, WORKSPACE.INVESTIGATIONS, setup, fn);
  const insertTask = (
    tx: Tx,
    caseId: string,
    code: string,
    due: string | null,
    status = "OPEN",
    who: string | null = PERSONA.beta,
  ) =>
    tx<{ id: string }[]>`
      insert into cdf_notifications_v13.task (case_id, task_code, title_ar, title_en, assignee_persona_id, status, due_date)
      values (${caseId}::uuid, ${code}, 'مهمة', 'Task', ${who}::uuid, ${status}, ${due}::date) returning id`;

  beforeAll(async () => {
    app = appClient();
    admin = adminClient();
    await asPersona(app, PERSONA.alpha, "SECRETARIAT", async () => undefined); // installs the test key if needed
  });
  afterAll(async () => {
    await app.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("shape: invoker, empty search_path, EXECUTE for cdf_v13_user only, columns = case_tasks_page's", async () => {
    const rows = await admin<
      { sig: string; definer: boolean; config: string[] | null; acl: string; cols: string }[]
    >`
      select replace(p.oid::regprocedure::text, 'cdf_notifications_v13.', '') as sig, p.prosecdef as definer,
             p.proconfig as config, p.proacl::text as acl, pg_catalog.pg_get_function_result(p.oid) as cols
        from pg_catalog.pg_proc p
       where p.pronamespace = 'cdf_notifications_v13'::regnamespace
         and p.proname in ('case_tasks_page', 'case_my_open_tasks_page')`;
    const bySig = new Map(rows.map((r) => [r.sig.replace(/ /g, ""), r]));
    const read = bySig.get("case_my_open_tasks_page(uuid,text,uuid,integer)")!;
    expect(read).toBeDefined();
    expect(read.definer).toBe(false);
    expect(read.config).toEqual(['search_path=""']);
    expect(read.acl).toBe("{cdf_v13_owner=X/cdf_v13_owner,cdf_v13_user=X/cdf_v13_owner}");
    expect(read.cols).toBe(bySig.get("case_tasks_page(uuid,text,uuid,integer)")!.cols);
  });

  for (const pair of DB_PERSONAS) {
    it(`${pair.persona} in ${pair.workspace}: for every case and limit, the pages are the filtered unpaged read, in order`, async () => {
      const persona = PERSONA_ID[pair.persona]!;
      const result = await as(persona, WORKSPACE[pair.workspace], async (tx) => {
        let total = 0;
        const ids: string[] = [];
        for (const caseId of [...ALL_CASES, UNKNOWN_CASE]) {
          const want = expected(await unpaged(tx, caseId));
          for (const limit of [1, 2, 100]) {
            const { rows, sizes } = await allPages(tx, caseId, limit);
            expect(strip(rows), `${caseId} limit ${limit}`).toEqual(want);
            expect(sizes.every((s) => s <= limit)).toBe(true);
            for (const r of rows) {
              expect(r.is_mine).toBe(true);
              expect(OPEN.has(String(r.status))).toBe(true);
              expect(r.page_cursor).toBe(`${dueText(r.due_date) ?? "-"}|${String(r.task_code)}`);
            }
          }
          total += want.length;
          ids.push(...want.map((r) => String(r.id)));
          if (caseId === UNKNOWN_CASE) expect(want).toEqual([]);
        }
        return { total, ids };
      });
      // Never vacuous: every pair has at least one open task of its own in a visible case.
      expect(result.total).toBeGreaterThan(0);
      // Every returned row's assignee is the caller (read independently of the function, as the administrator).
      const owners = await admin<{ assignee: string }[]>`
        select distinct assignee_persona_id::text as assignee from cdf_notifications_v13.task
         where id = any(${result.ids}::uuid[])`;
      expect(owners).toEqual([{ assignee: persona }]);
    });
  }

  it("seed: Beta's open tasks in 0006 are exactly task 12; Alpha's in 0010 are none (19 is DONE, 20 is Gamma's)", async () => {
    const beta = await as(PERSONA.beta, WORKSPACE.INVESTIGATIONS, (tx) => mine(tx, CASE(6), null, null, 25));
    expect(beta.map((r) => r.id)).toEqual([TASK(12)]);
    const alpha = await as(PERSONA.alpha, WORKSPACE.SECRETARIAT, (tx) => mine(tx, CASE(10), null, null, 25));
    expect(alpha).toEqual([]);
    const gamma = await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, (tx) =>
      mine(tx, CASE(10), null, null, 25),
    );
    expect(gamma.map((r) => r.id)).toEqual([TASK(20)]); // closed 0010 stays readable, as in case_tasks
  });

  it("order: task_code in code point order on any server (ABB before AB_A), ties by id, nulls last, finished tasks and other assignees out", async () => {
    const result = await seededAsBeta(
      async (tx) => {
        for (const [code, due] of [
          ["AB_A", "2026-12-01"],
          ["ABB", "2026-12-01"],
          ["TIE", "2026-12-02"],
          ["TIE", "2026-12-02"],
          ["NODATE", null],
          ["NODATE", null],
        ] as const)
          await insertTask(tx, CASE(2), code, due);
        await insertTask(tx, CASE(2), "BLOCKED_ONE", "2026-12-03", "BLOCKED");
        await insertTask(tx, CASE(2), "IN_PROGRESS_ONE", "2026-12-03", "IN_PROGRESS");
        await insertTask(tx, CASE(2), "DONE_ONE", "2026-12-01", "DONE");
        await insertTask(tx, CASE(2), "CANCELLED_ONE", "2026-12-01", "CANCELLED");
        await insertTask(tx, CASE(2), "GAMMAS", "2026-12-01", "OPEN", PERSONA.gamma);
        await insertTask(tx, CASE(2), "UNASSIGNED", "2026-12-01", "OPEN", null);
      },
      async (tx) => ({
        whole: await unpaged(tx, CASE(2)),
        byOne: (await allPages(tx, CASE(2), 1)).rows,
        byHundred: (await allPages(tx, CASE(2), 100)).rows,
      }),
    );
    const codes = result.byHundred.map((r) => r.task_code);
    expect(codes).toEqual([
      "ABB",
      "AB_A",
      "TIE",
      "TIE",
      "BLOCKED_ONE",
      "IN_PROGRESS_ONE",
      "NODATE",
      "NODATE",
    ]);
    const ties = result.byHundred.filter((r) => r.task_code === "TIE").map((r) => String(r.id));
    expect(ties).toEqual([...ties].sort());
    const nodates = result.byHundred.filter((r) => r.task_code === "NODATE").map((r) => String(r.id));
    expect(nodates).toEqual([...nodates].sort());
    expect(strip(result.byOne)).toEqual(strip(result.byHundred));
    expect(strip(result.byHundred)).toEqual(expected(result.whole));
  });

  it('collation: the order, the keyset and the index all use collate "C", whatever the database default is', async () => {
    // This cluster's default may already be C, where the ABB / AB_A test above cannot tell the difference; pin the text.
    const [row] = await admin<{ body: string; indexdef: string }[]>`
      select pg_catalog.pg_get_functiondef('cdf_notifications_v13.case_my_open_tasks_page(uuid, text, uuid, integer)'::regprocedure) as body,
             pg_catalog.pg_get_indexdef('cdf_notifications_v13.task_case_assignee_open_idx'::regclass) as indexdef`;
    expect(row!.body).toContain('order by t.due_date nulls last, t.task_code collate "C", t.id');
    expect(
      row!.body.match(/\(t\.task_code collate "C", t\.id\) > \(x\.task_code collate "C", x\.id\)/g),
    ).toHaveLength(2);
    expect(row!.indexdef).toContain('(case_id, assignee_persona_id, due_date, task_code COLLATE "C", id)');
    expect(row!.indexdef).toContain("WHERE (status = ANY");
  });

  it("cursor: an anchor that is no longer open, or not the caller's, still pages on from its position", async () => {
    const result = await seededAsBeta(
      async (tx) => {
        await insertTask(tx, CASE(2), "FIRST", "2026-12-01");
        await insertTask(tx, CASE(2), "SECOND", "2026-12-02");
        await insertTask(tx, CASE(2), "THIRD", "2026-12-03");
      },
      async (tx) => {
        const [first] = await mine(tx, CASE(2), null, null, 1);
        // The first row is finished between two pages (as the administrator, inside this rolled-back transaction).
        await tx`reset role`;
        await tx`update cdf_notifications_v13.task set status = 'DONE' where id = ${String(first!.id)}::uuid`;
        await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
        const afterFinished = await mine(tx, CASE(2), String(first!.page_cursor), String(first!.id), 25);
        // Gamma's seeded task 03 in 0002 (due 2026-11-07) used as an anchor: Beta's own rows after it.
        const gammas = (await tasksPage(tx, CASE(2))).find((r) => r.id === TASK(3))!;
        const afterGammas = await mine(tx, CASE(2), String(gammas.page_cursor), TASK(3), 25);
        return { first, afterFinished, afterGammas };
      },
    );
    expect(result.first!.task_code).toBe("FIRST");
    expect(result.afterFinished.map((r) => r.task_code)).toEqual(["SECOND", "THIRD"]);
    // FIRST is finished by then, so only the two still open follow Gamma's row.
    expect(result.afterGammas.map((r) => r.task_code)).toEqual(["SECOND", "THIRD"]);
  });

  it("cursor: half, malformed, changed, foreign, unknown and invisible cursors all give the same empty answer", async () => {
    const answers = await as(PERSONA.beta, WORKSPACE.INVESTIGATIONS, async (tx) => {
      const [row] = await mine(tx, CASE(5), null, null, 1); // Beta's task 09 in 0005
      const cursor = String(row!.page_cursor);
      const id = String(row!.id);
      const [other] = await mine(tx, CASE(3), null, null, 1); // Beta's task 06 in 0003
      const probes: [string, string | null, string | null, string][] = [
        ["half: cursor only", cursor, null, CASE(5)],
        ["half: id only", null, id, CASE(5)],
        ["malformed text", "not-a-cursor", id, CASE(5)],
        ["empty text", "", id, CASE(5)],
        [
          "text with a changed digit",
          cursor.replace(/\d(?=[^\d]*$)/, (d) => String((Number(d) + 1) % 10)),
          id,
          CASE(5),
        ],
        ["another row's text", String(other!.page_cursor), id, CASE(5)],
        ["id from another case", String(other!.page_cursor), String(other!.id), CASE(5)],
        ["unknown id", cursor, "0f000000-0000-4000-8000-0000000000ff", CASE(5)],
        ["cursor of this case asked of another", cursor, id, CASE(3)],
        ["unknown case", cursor, id, UNKNOWN_CASE],
      ];
      const out: Record<string, unknown> = {};
      for (const [label, c, i, k] of probes) out[label] = await mine(tx, k, c, i, 25);
      return out;
    });
    for (const [label, rows] of Object.entries(answers)) expect(rows, label).toEqual([]);
    // Beta's restricted 0009 task as Gamma's cursor: nothing in 0009 (Gamma cannot see it) and nothing elsewhere.
    const restricted = (
      await as(PERSONA.beta, WORKSPACE.INVESTIGATIONS, (tx) => mine(tx, CASE(9), null, null, 1))
    )[0]!;
    expect(restricted.id).toBe(TASK(17));
    const gamma = await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, async (tx) => ({
      inCase: await mine(tx, CASE(9), String(restricted.page_cursor), TASK(17), 25),
      first: await mine(tx, CASE(9), null, null, 25),
      elsewhere: await mine(tx, CASE(2), String(restricted.page_cursor), TASK(17), 25),
    }));
    expect(gamma).toEqual({ inCase: [], first: [], elsewhere: [] });
  });

  it("other workspace and other persona: a case not visible there gives nothing, with or without a cursor", async () => {
    // A task of Delta's in 0002 (rolled back): 0002 is visible to Delta in GOVERNANCE, not in SECRETARIAT.
    const deltaIn = (workspace: string) =>
      seededAs(
        PERSONA.delta,
        workspace,
        (tx) => insertTask(tx, CASE(2), "DELTA_ONLY", "2026-12-01", "OPEN", PERSONA.delta),
        async (tx) => {
          const first = await mine(tx, CASE(2), null, null, 25);
          const after = await mine(tx, CASE(2), "2026-11-07|COLLECT_DOCUMENTS", TASK(3), 25);
          return { first: first.map((r) => r.task_code), after: after.map((r) => r.task_code) };
        },
      );
    expect(await deltaIn(WORKSPACE.GOVERNANCE)).toEqual({ first: ["DELTA_ONLY"], after: ["DELTA_ONLY"] });
    expect(await deltaIn(WORKSPACE.SECRETARIAT)).toEqual({ first: [], after: [] });
    // Gamma sees 0005, but Beta's tasks there are Beta's, never Gamma's, with or without Beta's row as the cursor.
    const [beta5] = await as(PERSONA.beta, WORKSPACE.INVESTIGATIONS, (tx) =>
      mine(tx, CASE(5), null, null, 1),
    );
    expect(beta5!.id).toBe(TASK(9));
    const gamma5 = await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, async (tx) => ({
      first: await mine(tx, CASE(5), null, null, 25),
      after: await mine(tx, CASE(5), String(beta5!.page_cursor), String(beta5!.id), 25),
      seesTasks: (await unpaged(tx, CASE(5))).length,
    }));
    expect(gamma5).toEqual({ first: [], after: [], seesTasks: 2 });
  });

  it("limit: 1 and 100 are accepted, 0, 101, -1 and NULL are refused with 22023 (never clamped)", async () => {
    const outcomes: Record<string, string> = {};
    for (const caseId of [CASE(3), UNKNOWN_CASE, CASE(9)])
      for (const limit of [1, 100, 0, 101, -1, null]) {
        outcomes[`${caseId.slice(-2)} ${String(limit)}`] = await as(
          PERSONA.alpha,
          WORKSPACE.SECRETARIAT,
          async (tx) => {
            await mine(tx, caseId, null, null, limit);
            return "OK";
          },
        ).catch((error: unknown) => errorCodeOf(error));
      }
    for (const [label, outcome] of Object.entries(outcomes)) {
      const limit = label.split(" ").at(-1);
      expect(outcome, label).toBe(limit === "1" || limit === "100" ? "OK" : "22023");
    }
  });

  it("Epsilon (expired), Zeta (inactive), an unknown persona and forged contexts see nothing", async () => {
    for (const persona of [PERSONA.epsilon, PERSONA.zeta, PERSONA.unknown])
      for (const ws of Object.values(WORKSPACE))
        for (const caseId of ALL_CASES)
          expect(
            await as(persona, ws, (tx) => mine(tx, caseId, null, null, 25)),
            `${persona} ${caseId}`,
          ).toEqual([]);
    const claims = claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT);
    for (const ctx of [
      {},
      { claims },
      { claims, mac: "00".repeat(32) },
      { claims, mac: "valid" as const, macOver: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS) },
    ])
      expect(await asRaw(app, ctx, (tx) => mine(tx, CASE(1), null, null, 25)), JSON.stringify(ctx)).toEqual(
        [],
      );
    // Control: the same valid context does see Alpha's task 02 in 0001.
    const alpha = await as(PERSONA.alpha, WORKSPACE.SECRETARIAT, (tx) => mine(tx, CASE(1), null, null, 25));
    expect(alpha.map((r) => r.id)).toEqual([TASK(2)]);
  });

  it("the app login cannot call it without the request role (42501)", async () => {
    const code = await app
      .begin(async (tx) => {
        await tx`select * from cdf_notifications_v13.case_my_open_tasks_page(${CASE(1)}::uuid)`;
        return "OK";
      })
      .catch((error: unknown) => errorCodeOf(error));
    expect(code).toBe("42501");
  });

  it("index: the page order is served by task_case_assignee_open_idx without a sort when sequential scans are off", async () => {
    const plan = await admin.begin(async (tx) => {
      await tx`set local enable_seqscan = off`;
      await tx`set local enable_bitmapscan = off`;
      const rows = await tx.unsafe<{ "QUERY PLAN": string }[]>(
        `explain select id from cdf_notifications_v13.task
          where case_id = '${CASE(6)}' and assignee_persona_id = '${PERSONA.beta}'
            and status in ('OPEN', 'IN_PROGRESS', 'BLOCKED')
          order by due_date nulls last, task_code collate "C", id limit 25`,
      );
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    });
    expect(plan).toMatch(/Index (Only )?Scan using task_case_assignee_open_idx/);
    expect(plan).not.toMatch(/Sort/);
  });
});
