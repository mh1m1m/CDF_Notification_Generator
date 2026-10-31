// V13-SEC-002 · SEC-DB-18, SEC-DB-19, SEC-DB-20, SEC-DB-21, SEC-DB-06 (non-member workspace) · threats TM-I1..TM-I5.
// For every active persona in every workspace (15 contexts, through the real withRequestContext), what the database
// shows is compared with an oracle derived independently from the raw rows (support.ts expectedAccess):
//  - case_record shows exactly the oracle; every other case-keyed table shows rows of oracle cases only;
//  - every case read function answers for oracle cases only, and for any other case exactly as for an unknown id;
//  - portfolio count = portfolio rows = oracle (no hidden case counted, also under search by display number);
//  - My Work lists oracle cases only;
//  - the restricted case 0009 is seen only by its assigned investigator, never by Governance or a workspace member;
//  - a display number is never a key: passing one gives the same refusal whether the case is visible or not.
// SYNTHETIC DATA ONLY.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceCode } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import {
  ACTIVE_PERSONAS,
  adminClient,
  ALL_CASES,
  appClient,
  asPersona,
  attempt,
  databaseReady,
  expectedAccess,
  installTestKey,
  PERSONA,
  RESTRICTED_CASE,
  SCHEMA,
  UNKNOWN_CASE,
  v13Tables,
  WORKSPACE,
  WORKSPACES,
  type Outcome,
} from "./support";

const present = await databaseReady("case-matrix");

const READS = ["case_header", "case_events", "case_tasks", "case_notifications"] as const;
type Read = (typeof READS)[number];

function callRead(tx: Tx, fn: Read, caseId: string) {
  switch (fn) {
    case "case_header":
      return tx`select * from cdf_notifications_v13.case_header(${caseId})`;
    case "case_events":
      return tx`select * from cdf_notifications_v13.case_events(${caseId})`;
    case "case_tasks":
      return tx`select * from cdf_notifications_v13.case_tasks(${caseId})`;
    case "case_notifications":
      return tx`select * from cdf_notifications_v13.case_notifications(${caseId})`;
  }
}

/** Outcome reduced to what a caller can observe: refused with which code and message, or how many rows. */
const observable = (o: Outcome) => (o.ok ? { rows: o.rows!.length } : { code: o.code, message: o.message });

interface Combo {
  persona: (typeof ACTIVE_PERSONAS)[number];
  workspace: WorkspaceCode;
}
const COMBOS: Combo[] = ACTIVE_PERSONAS.flatMap((persona) =>
  WORKSPACES.map((workspace) => ({ persona, workspace })),
);

describe.skipIf(!present)("SEC-DB-18..21 every persona × workspace sees exactly the oracle", () => {
  let sql: postgres.Sql;
  let admin: postgres.Sql;
  let tables: { name: string; caseColumn: string | null }[];
  const oracle = new Map<string, Set<string>>();
  const key = (c: Combo) => `${c.persona}@${c.workspace}`;

  beforeAll(async () => {
    sql = appClient();
    admin = adminClient();
    await installTestKey(sql);
    tables = (await v13Tables(admin)).filter((t) => t.caseColumn !== null);
    for (const c of COMBOS)
      oracle.set(key(c), await expectedAccess(admin, PERSONA[c.persona], WORKSPACE[c.workspace]));
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await admin?.end({ timeout: 5 });
  });

  it("the oracle is not trivial: some contexts see cases, some see none, and 0009 is seen by Beta only", () => {
    const sizes = [...oracle.values()].map((s) => s.size);
    expect(Math.max(...sizes)).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBe(0); // non-member workspaces
    const seeing0009 = [...oracle.entries()].filter(([, s]) => s.has(RESTRICTED_CASE)).map(([k]) => k);
    expect(seeing0009).toEqual(["beta@INVESTIGATIONS"]);
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(["case_record", "case_assignment", "task", "procedural_event", "notification"]),
    );
  });

  for (const combo of COMBOS) {
    it(`${combo.persona} in ${combo.workspace}: tables, reads, counts and My Work match the oracle`, async () => {
      const expected = oracle.get(key(combo))!;
      const problems = await asPersona(sql, PERSONA[combo.persona], combo.workspace, async (tx) => {
        const out: string[] = [];

        // SEC-DB-18 / -21: tables.
        for (const t of tables) {
          const o = await attempt(
            tx,
            (sp) =>
              sp`select distinct ${sp(t.caseColumn!)}::text as case_id from ${sp(SCHEMA)}.${sp(t.name)}`,
          );
          if (!o.ok) {
            if (o.code !== "42501") out.push(`${t.name}: refused ${o.code}`);
            continue;
          }
          const seen = new Set(o.rows!.map((r) => String(r.case_id)));
          for (const id of seen)
            if (!expected.has(id)) out.push(`${t.name}: row of case ${id.slice(-2)} leaked`);
          if (t.name === "case_record" && seen.size !== expected.size)
            out.push(`case_record: ${seen.size} visible, oracle ${expected.size}`);
        }

        // SEC-DB-19 / -21: read functions, unauthorised == unknown.
        for (const fn of READS) {
          const unknown = observable(await attempt(tx, (sp) => callRead(sp, fn, UNKNOWN_CASE)));
          if (JSON.stringify(unknown) !== JSON.stringify({ rows: 0 }))
            out.push(`${fn}(unknown): ${JSON.stringify(unknown)}`);
          for (const c of ALL_CASES) {
            const got = observable(await attempt(tx, (sp) => callRead(sp, fn, c)));
            if (expected.has(c)) {
              if (fn === "case_header" && got.rows !== 1)
                out.push(`${fn}(${c.slice(-2)}): ${JSON.stringify(got)}`);
            } else if (JSON.stringify(got) !== JSON.stringify(unknown)) {
              out.push(`${fn}(${c.slice(-2)}) differs from unknown: ${JSON.stringify(got)}`);
            }
          }
        }

        // SEC-DB-20: counts equal visible rows; hidden cases never counted, also when searched by display number.
        const [count] = await tx<{ n: string }[]>`
          select cdf_notifications_v13.portfolio_count(null, null, null, false)::text as n`;
        const page = await tx<{ case_id: string }[]>`
          select id::text as case_id from cdf_notifications_v13.portfolio_page(null, 99, null, null, null, false)`;
        if (Number(count!.n) !== expected.size)
          out.push(`portfolio_count ${count!.n}, oracle ${expected.size}`);
        if (page.length !== expected.size || page.some((r) => !expected.has(r.case_id)))
          out.push(`portfolio_page ${page.length} rows, oracle ${expected.size}`);
        for (const [i, c] of ALL_CASES.entries()) {
          const number = `CDF-DEMO-2026-${String(i + 1).padStart(4, "0")}`;
          const [hit] = await tx<{ n: string }[]>`
            select cdf_notifications_v13.portfolio_count(null, null, ${number}, false)::text as n`;
          if (Number(hit!.n) !== (expected.has(c) ? 1 : 0)) out.push(`search ${number}: count ${hit!.n}`);
        }

        // My Work: own tasks of accessible cases only (closed included on request).
        const work = await tx<{ case_id: string }[]>`
          select case_id::text from cdf_notifications_v13.my_work_tasks(true)`;
        for (const r of work)
          if (!expected.has(r.case_id)) out.push(`my_work_tasks: case ${r.case_id.slice(-2)}`);

        return out;
      });
      expect(problems).toEqual([]);
    });
  }

  it("SEC-DB-19 a display number is never a key: the same refusal whether the case is visible or not", async () => {
    const answers = await asPersona(sql, PERSONA.alpha, "SECRETARIAT", async (tx) => {
      const out: Record<string, unknown> = {};
      for (const fn of READS)
        for (const number of ["CDF-DEMO-2026-0001", "CDF-DEMO-2026-0009", "CDF-DEMO-2026-0999"]) {
          const o = await attempt(tx, (sp) => callRead(sp, fn, number));
          out[`${fn} ${number}`] = { ok: o.ok, code: o.code };
        }
      return out;
    });
    // 0001 is Alpha's, 0009 is hidden from Alpha, 0999 does not exist: all three are the same invalid-input refusal.
    for (const v of Object.values(answers)) expect(v).toEqual({ ok: false, code: "22P02" });
  });

  it("SEC-DB-21 Governance Delta never sees the restricted case, in either of its workspaces", async () => {
    for (const workspace of ["SECRETARIAT", "GOVERNANCE"] as const) {
      const seen = await asPersona(sql, PERSONA.delta, workspace, async (tx) => {
        const [r] = await tx<{ access: boolean; header: number; count: string }[]>`
          select cdf_notifications_v13.can_access_case(${RESTRICTED_CASE}) as access,
                 (select count(*)::int from cdf_notifications_v13.case_header(${RESTRICTED_CASE})) as header,
                 cdf_notifications_v13.portfolio_count(null, null, 'CDF-DEMO-2026-0009', false)::text as count`;
        return r;
      });
      expect(seen).toEqual({ access: false, header: 0, count: "0" });
    }
  });
});
