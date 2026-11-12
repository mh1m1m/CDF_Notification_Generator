// V13-DB-024 (OI-032 follow-up) — the Supabase performance advisor's `unused_index` findings after the hosted resume
// (9 Nov: 0000–0015 and seeds 0001/0002 on CDF GC Review, docs/TEST_EVIDENCE.md). The advisor reports every index that
// no query has used yet; it skips indexes that back a primary key or unique constraint. Each of the twelve it listed
// is reviewed here with the read it serves (docs/teams/db/STATUS.md, V13-DB-024). A new secondary index fails this
// suite until it is added below with its read, and an index whose leading keys repeat another index's fails too
// (only the one reviewed exception is allowed). Catalogue reads only. SYNTHETIC DATA ONLY.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clusterAvailable, PRIMARY_ADMIN_URL } from "./support/clusters";
import { adminClient } from "./support/context";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function ready(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean }[]>`
      select exists (select 1 from cdf_notifications_v13.schema_migrations where version = '0015') as present`;
    return Boolean(row?.present);
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const present = await ready();
if (available && !present) console.warn("[integration] skipping index-review: migration 0015 missing");

/**
 * Every secondary index (not backing a constraint), with the read it serves. These are the advisor's twelve
 * `unused_index` findings of 9 Nov: unused only because the hosted tables have had no traffic yet.
 */
const REVIEWED_SECONDARY = {
  audit_event_case_idx:
    "0001: a case's ledger rows in chain order (case_id, seq), partial on case_id not null",
  case_assignment_persona_idx:
    "0002: can_access_case and the case lists find a persona's assignments (persona_id first)",
  case_workspace_visibility_ws_idx: "0002: a workspace's visible cases (the primary key leads with case_id)",
  notification_case_idx: "0004: a case's notifications, newest first",
  notification_created_idx: "0010: notifications_page keyset (created_at desc, id desc)",
  notification_event_notification_idx:
    "0009: covers notification_event_notification_fk and keeps the timeline order",
  persona_workspace_membership_persona_idx:
    "0001: a persona's memberships (redundant with membership_unique, kept)",
  procedural_event_case_idx: "0003: a case's procedural timeline (case_id, occurred_at, recorded_at)",
  task_assignee_idx: "0003: a persona's tasks across cases by status and due date (My work)",
  task_case_assignee_open_idx: "0014: case_my_open_tasks_page keyset, partial on open statuses",
  task_case_idx: "0003: a case's tasks by status (counts and status filters)",
  task_case_page_idx: "0011: case_tasks keyset (due_date nulls last, task_code, id)",
} as const;

/**
 * Pairs where the first index's key columns are a leading prefix of the second's. Accepted: dropping it saves one
 * small index on a seed-only table and would cost a hosted DROP (owner confirmation); it goes with the next migration
 * that changes persona_workspace_membership.
 */
const ACCEPTED_PREFIX_PAIRS = ["persona_workspace_membership_persona_idx ⊆ membership_unique"];

describe.skipIf(!present)("secondary index review (V13-DB-024, advisor unused_index)", () => {
  let admin: postgres.Sql;

  beforeAll(() => {
    admin = adminClient();
  });

  afterAll(async () => {
    await admin.end({ timeout: 5 });
  });

  it("every secondary index is reviewed, and nothing reviewed is stale", async () => {
    const rows = await admin<{ name: string }[]>`
      select c.relname::text as name
        from pg_catalog.pg_index i
        join pg_catalog.pg_class c on c.oid = i.indexrelid
       where c.relnamespace = 'cdf_notifications_v13'::regnamespace
         and not exists (select 1 from pg_catalog.pg_constraint k where k.conindid = i.indexrelid)
       order by c.relname collate "C"`;
    expect(rows.map((r) => r.name)).toEqual(Object.keys(REVIEWED_SECONDARY).sort());
  });

  it("no index's key columns are a leading prefix of another index's, except the reviewed pair", async () => {
    const rows = await admin<{ pair: string }[]>`
      select a_c.relname || ' ⊆ ' || b_c.relname as pair
        from pg_catalog.pg_index a
        join pg_catalog.pg_index b on b.indrelid = a.indrelid and b.indexrelid <> a.indexrelid
        join pg_catalog.pg_class a_c on a_c.oid = a.indexrelid
        join pg_catalog.pg_class b_c on b_c.oid = b.indexrelid
       where a_c.relnamespace = 'cdf_notifications_v13'::regnamespace
         and not a.indisunique
         and a.indexprs is null and b.indexprs is null
         and a.indpred is null and b.indpred is null
         and (b.indkey::text = a.indkey::text or b.indkey::text like a.indkey::text || ' %')
       order by (a_c.relname || ' ⊆ ' || b_c.relname) collate "C"`;
    expect(rows.map((r) => r.pair)).toEqual(ACCEPTED_PREFIX_PAIRS);
  });

  it("the check catches a planted prefix index (rolled back)", async () => {
    await admin
      .begin(async (tx) => {
        await tx.unsafe("set local role cdf_v13_owner");
        await tx`create index planted_task_case_prefix_idx on cdf_notifications_v13.task (case_id)`;
        const rows = await tx<{ n: number }[]>`
          select count(*)::int as n
            from pg_catalog.pg_index a
            join pg_catalog.pg_index b on b.indrelid = a.indrelid and b.indexrelid <> a.indexrelid
           where a.indexrelid = 'cdf_notifications_v13.planted_task_case_prefix_idx'::regclass
             and (b.indkey::text = a.indkey::text or b.indkey::text like a.indkey::text || ' %')`;
        expect(rows[0]?.n).toBeGreaterThan(0);
        throw new Error("rollback");
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "rollback") throw error;
      });
  });
});
