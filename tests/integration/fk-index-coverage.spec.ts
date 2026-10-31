// V13-DB-011 (OI-032) — migration 0009: every V13 foreign key is either covered by an index that leads with its
// columns (in order), or accepted here with the reason recorded in the migration. A new foreign key fails this suite
// until it is decided. Catalogue reads only.
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
      select exists (select 1 from cdf_notifications_v13.schema_migrations where version = '0009') as present`;
    return Boolean(row?.present);
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const present = await ready();
if (available && !present) console.warn("[integration] skipping fk-index-coverage: migration 0009 missing");

/** Accepted without an index (migration 0009 gives each reason). */
const ACCEPTED_UNINDEXED = [
  "audit_event_actor_persona_id_fkey",
  "audit_event_workspace_id_fkey",
  "case_record_owning_workspace_id_fkey",
  "dispatch_outbox_notification_fk",
  "notification_event_actor_persona_id_fkey",
  "notification_recipient_class_fkey",
  "notification_recipient_persona_id_fkey",
  "notification_supersedes_fk",
  "notification_template_version_id_fkey",
  "persona_workspace_membership_role_id_fkey",
  "persona_workspace_membership_workspace_id_fkey",
  "procedural_event_causation_fk",
  "procedural_event_recorded_by_persona_id_fkey",
];

interface ForeignKey {
  name: string;
  table: string;
  columns: string[];
  indexes: string[];
  on_update: string;
  on_delete: string;
}

describe.skipIf(!present)("foreign-key index coverage (migration 0009, V13-DB-011)", () => {
  let admin: postgres.Sql;
  let keys: ForeignKey[];

  beforeAll(async () => {
    admin = adminClient();
    // An index covers a foreign key when its first n key columns are the key's n columns in the same order.
    keys = await admin<ForeignKey[]>`
      select c.conname as name, c.conrelid::regclass::text as table,
             (select array_agg(a.attname::text order by k.ord)
                from unnest(c.conkey) with ordinality k (attnum, ord)
                join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
             coalesce((select array_agg(i.indexrelid::regclass::text order by i.indexrelid::regclass::text)
                         from pg_catalog.pg_index i
                        where i.indrelid = c.conrelid
                          and (i.indkey::int2[])[0:pg_catalog.array_length(c.conkey, 1) - 1] = c.conkey),
                      '{}') as indexes,
             c.confupdtype::text as on_update, c.confdeltype::text as on_delete
        from pg_catalog.pg_constraint c
       where c.contype = 'f' and c.connamespace = 'cdf_notifications_v13'::regnamespace
       order by c.conname`;
  });

  afterAll(async () => {
    await admin.end({ timeout: 5 });
  });

  it("every foreign key is indexed or explicitly accepted, and nothing accepted is stale", () => {
    expect(keys.length).toBeGreaterThanOrEqual(26);
    const unindexed = keys.filter((k) => k.indexes.length === 0).map((k) => k.name);
    expect(unindexed.sort()).toEqual([...ACCEPTED_UNINDEXED].sort());
  });

  it("notification_event_notification_fk is covered by the reshaped timeline index", () => {
    const fk = keys.find((k) => k.name === "notification_event_notification_fk");
    expect(fk).toMatchObject({
      columns: ["notification_id", "case_id"],
      indexes: ["cdf_notifications_v13.notification_event_notification_idx"],
    });
  });

  it("the reshaped index keeps the timeline order: (notification_id, case_id, occurred_at)", async () => {
    const [row] = await admin<{ def: string }[]>`
      select pg_catalog.pg_get_indexdef('cdf_notifications_v13.notification_event_notification_idx'::regclass) as def`;
    expect(row?.def).toContain("(notification_id, case_id, occurred_at)");
  });

  it("no foreign key cascades or nulls on parent change: parents are never deleted and keys never change", () => {
    // 'a' = NO ACTION. A cascading or SET NULL action would make a parent delete rewrite children (append-only tables
    // refuse it); the acceptance reasons above assume NO ACTION.
    expect(keys.filter((k) => k.on_update !== "a" || k.on_delete !== "a").map((k) => k.name)).toEqual([]);
  });

  it("the accepted foreign keys still point at parents no application role can delete or re-key", async () => {
    const rows = await admin<{ parent: string; who: string; priv: string }[]>`
      select distinct c.confrelid::regclass::text as parent, r.who, p.priv
        from pg_catalog.pg_constraint c
       cross join (values ('cdf_v13_app'), ('cdf_v13_user'), ('public')) r (who)
       cross join (values ('DELETE'), ('UPDATE'), ('TRUNCATE')) p (priv)
       where c.conname = any (${ACCEPTED_UNINDEXED})
         and c.connamespace = 'cdf_notifications_v13'::regnamespace
         and pg_catalog.has_table_privilege(r.who, c.confrelid, p.priv)`;
    expect(rows).toEqual([]);
  });
});
