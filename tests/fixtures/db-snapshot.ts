// One persona's view of the database (TEST_ARCHITECTURE.md §7 DB layer, §8 DB half), read in a single repeatable-read
// transaction as cdf_v13_user with the persona's claims (tests/fixtures/db.ts). The Sentinel's and the Truth
// Inspector's database halves check this snapshot; their self-tests plant faults into a copy of it. SYNTHETIC data
// only; nothing is written.
import type { WorkspaceCode } from "@/lib/contracts";
import type { ScenarioDb, ScenarioTx } from "./db";

export interface SnapshotCase {
  id: string;
  ref: string;
  records_state: string;
}
export interface SnapshotTask {
  id: string;
  case_id: string;
  status: string;
}
export interface SnapshotEvent {
  id: string;
  case_id: string;
  event_code: string;
  subject_type: string | null;
  subject_id: string | null;
  from_status: string | null;
  to_status: string | null;
  /** Position in recorded order (recorded_at, then id), from 1. */
  seq: number;
  recorded_in_future: boolean;
  occurred_after_recorded: boolean;
}
export interface SnapshotNotification {
  id: string;
  case_id: string;
  supersedes_id: string | null;
}
export interface SnapshotNotificationEvent {
  id: string;
  notification_id: string;
  case_id: string;
  event_code: string;
  /** Position among the notification's own events (occurred_at, then id), from 1. */
  seq: number;
}
export interface PersonaSnapshot {
  persona: string;
  workspace: WorkspaceCode;
  cases: SnapshotCase[];
  /** Every table the role may SELECT that has a case_id column → the case ids of its rows (with repeats). */
  caseKeyed: Record<string, string[]>;
  tasks: SnapshotTask[];
  events: SnapshotEvent[];
  notifications: SnapshotNotification[];
  notificationEvents: SnapshotNotificationEvent[];
}

const SCHEMA = "cdf_notifications_v13";
const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * Tables whose case_id column the current role may read, found in the catalogue (new tables are covered too). Column
 * privilege, not table privilege: a table granted per column (as 0001 does) is still found.
 */
async function caseKeyedTables(tx: ScenarioTx): Promise<string[]> {
  const rows = await tx<{ name: string }[]>`
    select c.relname::text as name
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'case_id' and not a.attisdropped
     where n.nspname = ${SCHEMA}
       and c.relkind in ('r', 'p', 'v', 'm')
       and pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT')
     order by 1`;
  return rows.map((r) => r.name);
}

export async function personaSnapshot(
  db: ScenarioDb,
  persona: string,
  workspace: WorkspaceCode,
): Promise<PersonaSnapshot> {
  return db.asPersona(persona, workspace, async (tx) => {
    const caseKeyed: Record<string, string[]> = {};
    for (const name of await caseKeyedTables(tx)) {
      if (!TABLE_NAME.test(name)) throw new Error(`unexpected table name ${JSON.stringify(name)}`);
      // Identifiers through the driver's escaping (no raw SQL); the name also passed the check above.
      const rows = await tx<{ case_id: string | null }[]>`
        select case_id::text as case_id from ${tx(SCHEMA)}.${tx(name)}`;
      caseKeyed[name] = rows.map((r) => r.case_id ?? "<null>");
    }
    const cases = await tx<SnapshotCase[]>`
      select id::text as id, display_number as ref, records_state
        from cdf_notifications_v13.case_record order by id`;
    const tasks = await tx<SnapshotTask[]>`
      select id::text as id, case_id::text as case_id, status from cdf_notifications_v13.task order by id`;
    const events = await tx<SnapshotEvent[]>`
      select id::text as id, case_id::text as case_id, event_code, subject_type, subject_id::text as subject_id,
             attributes ->> 'from' as from_status, attributes ->> 'to' as to_status,
             (row_number() over (order by recorded_at, id))::int as seq,
             recorded_at > pg_catalog.now() as recorded_in_future,
             occurred_at > recorded_at as occurred_after_recorded
        from cdf_notifications_v13.procedural_event order by recorded_at, id`;
    const notifications = await tx<SnapshotNotification[]>`
      select id::text as id, case_id::text as case_id, supersedes_id::text as supersedes_id
        from cdf_notifications_v13.notification order by id`;
    const notificationEvents = await tx<SnapshotNotificationEvent[]>`
      select id::text as id, notification_id::text as notification_id, case_id::text as case_id, event_code,
             (row_number() over (partition by notification_id order by occurred_at, id))::int as seq
        from cdf_notifications_v13.notification_event order by notification_id, occurred_at, id`;
    return {
      persona,
      workspace,
      cases: [...cases],
      caseKeyed,
      tasks: [...tasks],
      events: [...events],
      notifications: [...notifications],
      notificationEvents: [...notificationEvents],
    };
  });
}

/** A deep copy for planting faults. */
export const cloneSnapshot = (s: PersonaSnapshot): PersonaSnapshot => structuredClone(s);
