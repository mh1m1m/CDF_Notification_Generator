// OI-029 (ARCH 31 Oct 2026): the lib/domain case task status catalogue equals the database's `task.status` check
// constraint (migration 0003), and the terminal pair matches the database's transition graph. Read-only; no writes.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "@/scripts/db/lib/migrations.mjs";
import {
  CASE_TASK_STATUSES,
  CASE_TASK_TERMINAL_STATUSES,
  isTerminalCaseTaskStatus,
} from "@/lib/domain/task-status";
import { clusterAvailable, PRIMARY_ADMIN_URL } from "./support/clusters";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

describe.skipIf(!available)("case task status catalogue vs the database (migration 0003)", () => {
  let admin: postgres.Sql;

  beforeAll(() => {
    admin = connect(PRIMARY_ADMIN_URL, "cdf-v13-tests");
  });
  afterAll(async () => {
    await admin?.end({ timeout: 5 });
  });

  it("CTS-DB-01 the task.status check constraint allows exactly the catalogue's five codes", async () => {
    const rows = await admin<{ def: string }[]>`
      select pg_catalog.pg_get_constraintdef(c.oid) as def
        from pg_catalog.pg_constraint c
       where c.conrelid = 'cdf_notifications_v13.task'::regclass
         and c.contype = 'c'
         and pg_catalog.pg_get_constraintdef(c.oid) like '%status%'`;
    expect(rows).toHaveLength(1);
    const codes = [...(rows[0]?.def ?? "").matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(codes).toEqual([...CASE_TASK_STATUSES].sort());
  });

  it("CTS-DB-02 no transition leaves DONE or CANCELLED, and every other code has a way out", async () => {
    const rows = await admin.begin(async (tx) => {
      await tx.unsafe("set local role cdf_v13_owner");
      return tx<{ from_status: string; outs: number }[]>`
        select f.s as from_status,
               count(*) filter (where cdf_notifications_v13._task_transition_allowed(f.s, t.s))::int as outs
          from unnest(${[...CASE_TASK_STATUSES]}::text[]) as f(s)
         cross join unnest(${[...CASE_TASK_STATUSES]}::text[]) as t(s)
         group by f.s`;
    });
    expect(rows).toHaveLength(CASE_TASK_STATUSES.length);
    const terminal = rows
      .filter((r) => r.outs === 0)
      .map((r) => r.from_status)
      .sort();
    expect(terminal).toEqual([...CASE_TASK_TERMINAL_STATUSES].sort());
    for (const r of rows) expect(isTerminalCaseTaskStatus(r.from_status)).toBe(r.outs === 0);
  });
});
