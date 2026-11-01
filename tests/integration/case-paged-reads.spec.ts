// V13-DB-019 — migration 0011 (REQ-PERF-003, OI-026): keyset-paged per-case reads. case_events_page, case_tasks_page
// and case_notifications_page return their unpaged read (0006, 0004) one bounded page at a time: same rows, same order,
// same columns plus page_cursor, same RLS. Negative cases: other case, other workspace, other persona, restricted 0009,
// unknown case, half / malformed / stale / foreign cursor (all the same empty answer), limit outside 1..100 (refused,
// 22023), expired / inactive / unknown personas, forged contexts, the app login itself. Set-up writes run in
// rolled-back transactions. SYNTHETIC seed data only.
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimsMac, type Tx } from "@/lib/db/security-context";
import { DB_PERSONAS } from "../fixtures/db-personas";
import { TEST_CLAIMS_KEY } from "./support/claims";
import { clusterAvailable, errorCodeOf, PRIMARY_ADMIN_URL } from "./support/clusters";
import { adminClient, appClient, asPersona, asRaw, claimsText, PERSONA, WORKSPACE } from "./support/context";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function ready(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean; cases: number }[]>`
      select pg_catalog.to_regprocedure('cdf_notifications_v13.case_tasks_page(uuid, text, uuid, integer)') is not null as present,
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
  console.warn("[integration] skipping case-paged-reads: migration 0011 or cases seed missing");

const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ALL_CASES = Array.from({ length: 10 }, (_, k) => CASE(k + 1));
const UNKNOWN_CASE = "0c000000-0000-4000-8000-0000000000ff";
const TEMPLATE_VERSION_2 = "1f000000-0000-4000-8000-000000000002";
const key = (label: string) => createHash("sha256").update(`db-019:${label}`).digest("hex");

const PERSONA_ID: Record<string, string> = {
  "secretary-alpha": PERSONA.alpha,
  "investigator-beta": PERSONA.beta,
  "investigator-gamma": PERSONA.gamma,
  "governance-officer-delta": PERSONA.delta,
};

type Row = Record<string, unknown> & { page_cursor?: string };
interface Read {
  name: "events" | "tasks" | "notifications";
  unpaged: (tx: Tx, caseId: string) => Promise<Row[]>;
  paged: (
    tx: Tx,
    caseId: string,
    cursor: string | null,
    id: string | null,
    limit: number | null,
  ) => Promise<Row[]>;
  idOf: (r: Row) => string;
  unpagedName: string;
  pagedName: string;
}

const READS: Read[] = [
  {
    name: "events",
    unpaged: (tx, c) => tx<Row[]>`select * from cdf_notifications_v13.case_events(${c}::uuid)`,
    paged: (tx, c, cur, id, limit) =>
      tx<
        Row[]
      >`select * from cdf_notifications_v13.case_events_page(${c}::uuid, ${cur}::text, ${id}::uuid, ${limit}::integer)`,
    idOf: (r) => String(r.id),
    unpagedName: "case_events(uuid)",
    pagedName: "case_events_page(uuid,text,uuid,integer)",
  },
  {
    name: "tasks",
    unpaged: (tx, c) => tx<Row[]>`select * from cdf_notifications_v13.case_tasks(${c}::uuid)`,
    paged: (tx, c, cur, id, limit) =>
      tx<
        Row[]
      >`select * from cdf_notifications_v13.case_tasks_page(${c}::uuid, ${cur}::text, ${id}::uuid, ${limit}::integer)`,
    idOf: (r) => String(r.id),
    unpagedName: "case_tasks(uuid)",
    pagedName: "case_tasks_page(uuid,text,uuid,integer)",
  },
  {
    name: "notifications",
    unpaged: (tx, c) => tx<Row[]>`select * from cdf_notifications_v13.case_notifications(${c}::uuid)`,
    paged: (tx, c, cur, id, limit) =>
      tx<
        Row[]
      >`select * from cdf_notifications_v13.case_notifications_page(${c}::uuid, ${cur}::text, ${id}::uuid, ${limit}::integer)`,
    idOf: (r) => String(r.notification_id),
    unpagedName: "case_notifications(uuid)",
    pagedName: "case_notifications_page(uuid,text,uuid,integer)",
  },
];

const strip = (rows: Row[]) => rows.map(({ page_cursor: _c, ...rest }) => rest);

/** Switches the request context inside the current transaction (claims + MAC for this transaction id). */
async function switchTo(tx: Tx, persona: string, workspace: string) {
  const claims = claimsText(persona, workspace);
  const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
  await tx`select pg_catalog.set_config('request.v13.claims', ${claims}, true),
                  pg_catalog.set_config('request.v13.claims_mac', ${claimsMac(TEST_CLAIMS_KEY, claims, row!.xid)}, true)`;
}

/** Every page of one read, following the returned cursors; also returns the page sizes. */
async function allPages(read: Read, tx: Tx, caseId: string, limit: number) {
  const rows: Row[] = [];
  const sizes: number[] = [];
  let cursor: string | null = null;
  let id: string | null = null;
  for (let guard = 0; guard < 500; guard += 1) {
    const batch = await read.paged(tx, caseId, cursor, id, limit);
    sizes.push(batch.length);
    rows.push(...batch);
    if (batch.length < limit) break;
    const last = batch[batch.length - 1]!;
    cursor = String(last.page_cursor);
    id = read.idOf(last);
  }
  return { rows, sizes };
}

describe.skipIf(!present)("keyset-paged per-case reads (migration 0011)", () => {
  let app: postgres.Sql;
  let admin: postgres.Sql;
  const as = <T>(persona: string, workspace: string, fn: (tx: Tx) => Promise<T>) =>
    asRaw(app, { claims: claimsText(persona, workspace), mac: "valid" }, fn);
  const beta = <T>(fn: (tx: Tx) => Promise<T>) => as(PERSONA.beta, WORKSPACE.INVESTIGATIONS, fn);
  /** Writes rows as the administrator, then reads as Beta in INVESTIGATIONS, in one rolled-back transaction. */
  const seededAsBeta = <T>(setup: (tx: Tx) => Promise<unknown>, fn: (tx: Tx) => Promise<T>) =>
    asRaw(admin, { claims: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS), mac: "valid" }, async (tx) => {
      await tx`reset role`;
      await setup(tx);
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    app = appClient();
    admin = adminClient();
    await asPersona(app, PERSONA.alpha, "SECRETARIAT", async () => undefined); // installs the test key if needed
  });
  afterAll(async () => {
    await app.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("shape: invoker, empty search_path, EXECUTE for cdf_v13_user only, columns = unpaged + page_cursor", async () => {
    const rows = await admin<
      { sig: string; definer: boolean; config: string[] | null; acl: string; cols: string }[]
    >`
      select replace(p.oid::regprocedure::text, 'cdf_notifications_v13.', '') as sig, p.prosecdef as definer,
             p.proconfig as config, p.proacl::text as acl, pg_catalog.pg_get_function_result(p.oid) as cols
        from pg_catalog.pg_proc p
       where p.pronamespace = 'cdf_notifications_v13'::regnamespace
         and p.proname in ('case_events', 'case_tasks', 'case_notifications', 'case_events_page',
                           'case_tasks_page', 'case_notifications_page', '_page_limit')`;
    const bySig = new Map(rows.map((r) => [r.sig.replace(/ /g, ""), r]));
    for (const read of READS) {
      const paged = bySig.get(read.pagedName)!;
      const unpaged = bySig.get(read.unpagedName)!;
      expect(paged, read.pagedName).toBeDefined();
      expect(paged.definer, read.pagedName).toBe(false);
      expect(paged.config, read.pagedName).toEqual(['search_path=""']);
      expect(paged.acl, read.pagedName).toBe("{cdf_v13_owner=X/cdf_v13_owner,cdf_v13_user=X/cdf_v13_owner}");
      expect(paged.cols, read.pagedName).toBe(unpaged.cols.replace(/\)$/, ", page_cursor text)"));
    }
    const limit = bySig.get("_page_limit(integer)")!;
    expect(limit.definer).toBe(false);
    expect(limit.acl).toBe("{cdf_v13_owner=X/cdf_v13_owner,cdf_v13_user=X/cdf_v13_owner}");
  });

  it("the unpaged reads are unchanged: same definitions as before 0011 (no new grant, still invoker)", async () => {
    const rows = await admin<{ name: string; definer: boolean; acl: string }[]>`
      select p.proname as name, p.prosecdef as definer, p.proacl::text as acl
        from pg_catalog.pg_proc p
       where p.pronamespace = 'cdf_notifications_v13'::regnamespace
         and p.proname in ('case_events', 'case_tasks', 'case_notifications')
       order by 1`;
    expect(rows.map((r) => r.name)).toEqual(["case_events", "case_notifications", "case_tasks"]);
    for (const r of rows) {
      expect(r.definer, r.name).toBe(false);
      expect(r.acl, r.name).toBe("{cdf_v13_owner=X/cdf_v13_owner,cdf_v13_user=X/cdf_v13_owner}");
    }
  });

  for (const pair of DB_PERSONAS) {
    it(`${pair.persona} in ${pair.workspace}: for every case and limit, the pages are the unpaged read, in order`, async () => {
      const persona = PERSONA_ID[pair.persona]!;
      const result = await as(persona, WORKSPACE[pair.workspace], async (tx) => {
        const out: {
          read: string;
          caseId: string;
          limit: number;
          ok: boolean;
          sizes: number[];
          n: number;
        }[] = [];
        const nonEmpty = new Set<string>();
        for (const read of READS)
          for (const caseId of [...ALL_CASES, UNKNOWN_CASE]) {
            const whole = await read.unpaged(tx, caseId);
            if (whole.length > 0) nonEmpty.add(caseId);
            for (const limit of [1, 2, 3, 100]) {
              const { rows, sizes } = await allPages(read, tx, caseId, limit);
              expect(strip(rows), `${read.name} ${caseId} limit ${limit}`).toEqual(whole);
              const ids = rows.map(read.idOf);
              expect(new Set(ids).size, `${read.name} ${caseId}: pages disjoint`).toBe(ids.length);
              expect(sizes.every((s) => s <= limit)).toBe(true);
              out.push({ read: read.name, caseId, limit, ok: true, sizes, n: rows.length });
            }
          }
        return { out, nonEmpty: [...nonEmpty].sort() };
      });
      // Pinned to the seed's visibility table (DATA_MODEL §5): never vacuous, never more than the persona sees.
      expect(result.nonEmpty).toEqual(pair.sees);
      expect(result.out.filter((o) => o.caseId === UNKNOWN_CASE).every((o) => o.n === 0)).toBe(true);
    });
  }

  it("ties: equal sort keys are ordered by id and every row appears once (tasks, events, notifications)", async () => {
    const result = await seededAsBeta(
      async (tx) => {
        // Three tasks with the same due date and code prefix order, two with no due date (nulls last), and three
        // events with the same occurred_at and recorded_at, all in case 0002 (visible to Beta).
        for (const [code, due] of [
          ["TIE_A", "2026-12-01"],
          ["TIE_A", "2026-12-01"],
          ["TIE_B", "2026-12-01"],
          ["NODATE_A", null],
          ["NODATE_A", null],
        ] as const)
          await tx`insert into cdf_notifications_v13.task (case_id, task_code, title_ar, title_en, due_date)
                   values (${CASE(2)}::uuid, ${code}, 'مهمة', 'Task', ${due}::date)`;
        for (let k = 0; k < 3; k += 1)
          await tx`insert into cdf_notifications_v13.procedural_event
                     (case_id, event_code, occurred_at, recorded_at, provenance)
                   values (${CASE(2)}::uuid, 'TIE_EVENT', '2026-12-01T10:00:00.123456Z', '2026-12-01T10:00:00.123456Z',
                           'SEED_SYNTHETIC')`;
      },
      async (tx) => {
        await tx`select notification_id from cdf_notifications_v13.api_create_notification_draft(
                   ${CASE(2)}::uuid, ${TEMPLATE_VERSION_2}::uuid, 'CASE_TEAM', ${key("tie-1")})`;
        await tx`select notification_id from cdf_notifications_v13.api_create_notification_draft(
                   ${CASE(2)}::uuid, ${TEMPLATE_VERSION_2}::uuid, 'CASE_TEAM', ${key("tie-2")})`;
        const out: Record<string, { whole: Row[]; byOne: Row[] }> = {};
        for (const read of READS)
          out[read.name] = {
            whole: await read.unpaged(tx, CASE(2)),
            byOne: (await allPages(read, tx, CASE(2), 1)).rows,
          };
        return out;
      },
    );
    for (const read of READS) {
      const { whole, byOne } = result[read.name]!;
      expect(strip(byOne), read.name).toEqual(whole);
    }
    const tasks = result.tasks!.whole;
    expect(tasks.slice(-2).map((t) => t.due_date)).toEqual([null, null]);
    expect(tasks.filter((t) => t.task_code === "TIE_A")).toHaveLength(2);
    const tieEvents = result.events!.whole.filter((e) => e.event_code === "TIE_EVENT");
    expect(tieEvents).toHaveLength(3);
    expect(tieEvents.map((e) => e.id)).toEqual([...tieEvents.map((e) => String(e.id))].sort().reverse());
    const cursors = result.notifications!.byOne.map((n) => n.page_cursor);
    expect(new Set(cursors).size).toBeLessThan(cursors.length); // two drafts share created_at
  });

  it("limit: 1 and 100 are accepted, 0, 101, -1 and NULL are refused with 22023 (never clamped), on every read", async () => {
    const outcomes: Record<string, string> = {};
    for (const read of READS)
      for (const caseId of [CASE(3), UNKNOWN_CASE, CASE(9)])
        for (const limit of [1, 100, 0, 101, -1, null]) {
          const label = `${read.name} ${caseId.slice(-2)} ${String(limit)}`;
          outcomes[label] = await as(PERSONA.alpha, WORKSPACE.SECRETARIAT, async (tx) => {
            await read.paged(tx, caseId, null, null, limit);
            return "OK";
          }).catch((error: unknown) => errorCodeOf(error));
        }
    for (const [label, outcome] of Object.entries(outcomes)) {
      const limit = label.split(" ").at(-1);
      expect(outcome, label).toBe(limit === "1" || limit === "100" ? "OK" : "22023");
    }
  });

  it("limit 100 is the upper edge: 101 drafts page as 100 + the rest", async () => {
    const result = await beta(async (tx) => {
      for (let k = 0; k < 101; k += 1)
        await tx`select notification_id from cdf_notifications_v13.api_create_notification_draft(
                   ${CASE(2)}::uuid, ${TEMPLATE_VERSION_2}::uuid, 'CASE_TEAM', ${key(`edge-${k}`)})`;
      const whole = await READS[2]!.unpaged(tx, CASE(2));
      return { whole, pages: await allPages(READS[2]!, tx, CASE(2), 100) };
    });
    expect(result.whole).toHaveLength(101);
    expect(result.pages.sizes).toEqual([100, 1]);
    expect(strip(result.pages.rows)).toEqual(result.whole);
  });

  it("cursor: half, malformed, stale, foreign, unseen and unknown cursors all give the same empty answer, no error", async () => {
    for (const read of READS) {
      const answers = await beta(async (tx) => {
        const first = await read.paged(tx, CASE(3), null, null, 1);
        const row = first[0]!;
        const cursor = String(row.page_cursor);
        const id = read.idOf(row);
        const other = (await read.paged(tx, CASE(1), null, null, 1))[0]!; // a visible row of another case
        const restricted = (await read.paged(tx, CASE(9), null, null, 1))[0]!; // Beta sees 0009
        const unknownCase = await read.paged(tx, UNKNOWN_CASE, null, null, 25);
        const probes: [string, string | null, string | null, string][] = [
          ["half: cursor only", cursor, null, CASE(3)],
          ["half: id only", null, id, CASE(3)],
          ["malformed text", "not-a-cursor", id, CASE(3)],
          ["empty text", "", id, CASE(3)],
          [
            "text with a changed digit",
            cursor.replace(/\d(?=[^\d]*$)/, (d) => String((Number(d) + 1) % 10)),
            id,
            CASE(3),
          ],
          ["another row's text", String(other.page_cursor), id, CASE(3)],
          ["id from another case", String(other.page_cursor), read.idOf(other), CASE(3)],
          ["unknown id", cursor, "0f000000-0000-4000-8000-0000000000ff", CASE(3)],
          ["cursor of this case asked of another", cursor, id, CASE(1)],
          [
            "restricted row's cursor in another case",
            String(restricted.page_cursor),
            read.idOf(restricted),
            CASE(3),
          ],
        ];
        const out: Record<string, unknown> = { "unknown case": unknownCase };
        for (const [label, c, i, k] of probes) out[label] = await read.paged(tx, k, c, i, 25);
        return out;
      });
      for (const [label, rows] of Object.entries(answers)) expect(rows, `${read.name}: ${label}`).toEqual([]);
    }
  });

  it("cursor: a row Gamma cannot see (Beta's restricted 0009) used as a cursor gives Gamma nothing, in 0009 or anywhere", async () => {
    for (const read of READS) {
      const restricted = (await beta((tx) => read.paged(tx, CASE(9), null, null, 1)))[0]!;
      expect(restricted, read.name).toBeDefined();
      const gamma = await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, async (tx) => ({
        inCase: await read.paged(tx, CASE(9), String(restricted.page_cursor), read.idOf(restricted), 25),
        first: await read.paged(tx, CASE(9), null, null, 25),
        elsewhere: await read.paged(tx, CASE(3), String(restricted.page_cursor), read.idOf(restricted), 25),
      }));
      expect(gamma, read.name).toEqual({ inCase: [], first: [], elsewhere: [] });
    }
  });

  it("other workspace and other persona: a case not visible there pages to nothing, with or without a cursor", async () => {
    // 0002 is visible to Delta in GOVERNANCE and not in SECRETARIAT (it has no seeded notification, so Gamma writes an
    // uncommitted draft first); 0004 is visible to Alpha, not to Gamma (Alpha writes a draft there).
    const result = await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, async (tx) => {
      await tx`select notification_id from cdf_notifications_v13.api_create_notification_draft(
                 ${CASE(2)}::uuid, ${TEMPLATE_VERSION_2}::uuid, 'CASE_TEAM', ${key("other-workspace")})`;
      await switchTo(tx, PERSONA.alpha, WORKSPACE.SECRETARIAT);
      await tx`select notification_id from cdf_notifications_v13.api_create_notification_draft(
                 ${CASE(4)}::uuid, ${TEMPLATE_VERSION_2}::uuid, 'CASE_TEAM', ${key("other-persona")})`;
      const out: Record<string, unknown> = {};
      for (const read of READS) {
        await switchTo(tx, PERSONA.delta, WORKSPACE.GOVERNANCE);
        const governance = await read.paged(tx, CASE(2), null, null, 25);
        out[`${read.name} governance sees 0002`] = governance.length > 0;
        const row = governance[0]!;
        await switchTo(tx, PERSONA.delta, WORKSPACE.SECRETARIAT);
        out[`${read.name} secretariat first`] = await read.paged(tx, CASE(2), null, null, 25);
        out[`${read.name} secretariat after`] = await read.paged(
          tx,
          CASE(2),
          String(row.page_cursor),
          read.idOf(row),
          25,
        );
        await switchTo(tx, PERSONA.alpha, WORKSPACE.SECRETARIAT);
        const alpha4 = await read.paged(tx, CASE(4), null, null, 25);
        out[`${read.name} alpha sees 0004`] = alpha4.length > 0;
        await switchTo(tx, PERSONA.gamma, WORKSPACE.INVESTIGATIONS);
        out[`${read.name} gamma 0004 first`] = await read.paged(tx, CASE(4), null, null, 25);
        out[`${read.name} gamma 0004 after`] = await read.paged(
          tx,
          CASE(4),
          String(alpha4[0]!.page_cursor),
          read.idOf(alpha4[0]!),
          25,
        );
      }
      return out;
    });
    for (const [label, value] of Object.entries(result))
      expect(value, label).toEqual(label.includes(" sees ") ? true : []);
  });

  it("closed 0010 stays readable page by page, as in its unpaged read", async () => {
    const result = await as(PERSONA.alpha, WORKSPACE.SECRETARIAT, async (tx) => {
      const out: Record<string, number> = {};
      for (const read of READS) out[read.name] = (await allPages(read, tx, CASE(10), 1)).rows.length;
      return out;
    });
    expect(result.events).toBeGreaterThan(0);
    expect(result.tasks).toBeGreaterThan(0);
    expect(result.notifications).toBeGreaterThan(0);
  });

  it("Epsilon (expired), Zeta (inactive), an unknown persona and forged contexts see nothing", async () => {
    for (const read of READS) {
      for (const persona of [PERSONA.epsilon, PERSONA.zeta, PERSONA.unknown])
        for (const ws of Object.values(WORKSPACE))
          expect(
            await as(persona, ws, (tx) => read.paged(tx, CASE(1), null, null, 25)),
            `${read.name} ${persona}`,
          ).toEqual([]);
      const claims = claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT);
      for (const ctx of [
        {},
        { claims },
        { claims, mac: "00".repeat(32) },
        { claims, mac: "valid" as const, macOver: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS) },
      ])
        expect(
          await asRaw(app, ctx, (tx) => read.paged(tx, CASE(1), null, null, 25)),
          JSON.stringify(ctx),
        ).toEqual([]);
    }
  });

  it("the app login cannot call them without the request role (42501)", async () => {
    const codes: string[] = [];
    for (const fn of ["case_events_page", "case_tasks_page", "case_notifications_page"]) {
      codes.push(
        await app
          .begin(async (tx) => {
            await tx.unsafe(`select * from cdf_notifications_v13.${fn}('${CASE(1)}'::uuid)`);
            return "OK";
          })
          .catch((error: unknown) => errorCodeOf(error)),
      );
    }
    codes.push(
      await app
        .begin(async (tx) => {
          await tx`select cdf_notifications_v13._page_limit(5)`;
          return "OK";
        })
        .catch((error: unknown) => errorCodeOf(error)),
    );
    expect(codes).toEqual(["42501", "42501", "42501", "42501"]);
  });

  it("indexes: each page order is served by an index scan without a sort when sequential scans are off", async () => {
    const plans = await admin.begin(async (tx) => {
      await tx`set local enable_seqscan = off`;
      await tx`set local enable_bitmapscan = off`;
      const plan = async (q: string) =>
        (await tx.unsafe<{ "QUERY PLAN": string }[]>(`explain ${q}`)).map((r) => r["QUERY PLAN"]).join("\n");
      return {
        events: await plan(
          `select id from cdf_notifications_v13.procedural_event where case_id = '${CASE(3)}' order by occurred_at desc, recorded_at desc limit 25`,
        ),
        tasks: await plan(
          `select id from cdf_notifications_v13.task where case_id = '${CASE(3)}' order by due_date nulls last, task_code, id limit 25`,
        ),
        notifications: await plan(
          `select id from cdf_notifications_v13.notification where case_id = '${CASE(3)}' order by created_at desc limit 25`,
        ),
      };
    });
    expect(plans.events).toMatch(/Index (Only )?Scan Backward using procedural_event_case_idx/);
    expect(plans.tasks).toMatch(/Index (Only )?Scan using task_case_page_idx/);
    expect(plans.tasks).not.toMatch(/Sort/);
    expect(plans.notifications).toMatch(/Index (Only )?Scan using notification_case_idx/);
  });
});
