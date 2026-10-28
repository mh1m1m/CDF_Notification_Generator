// The persona registry in lib/contracts mirrors the database seed. Runs only when the identity tables and the M1 seed
// are present (V13-DB-001 / V13-DB-005); until then it is skipped with a message. Reads as cdf_v13_owner.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERSONAS, ROLE_CODES, WORKSPACE_IDS } from "@/lib/contracts";
import { connect } from "@/scripts/db/lib/migrations.mjs";
import { clusterAvailable, PRIMARY_ADMIN_URL } from "./support/clusters";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function seedPresent(): Promise<boolean> {
  if (!available) return false;
  const sql = connect(PRIMARY_ADMIN_URL, "cdf-v13-tests");
  try {
    const [row] = await sql.begin(async (tx) => {
      await tx.unsafe("set local role cdf_v13_owner");
      const [tables] = await tx`
        select pg_catalog.to_regclass('cdf_notifications_v13.persona_workspace_membership') is not null as present`;
      if (!tables?.present) return [{ present: false }];
      return tx`select exists (select 1 from cdf_notifications_v13.persona) as present`;
    });
    return Boolean(row?.present);
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const seeded = await seedPresent();
if (available && !seeded) {
  console.warn(
    "[integration] skipping persona-registry: no identity tables or seed yet (V13-DB-001, V13-DB-005)",
  );
}

describe.skipIf(!seeded)("persona registry mirrors the database seed", () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    sql = connect(PRIMARY_ADMIN_URL, "cdf-v13-tests");
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  async function asOwner<T>(query: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return (await sql.begin(async (tx) => {
      await tx.unsafe("set local role cdf_v13_owner");
      return query(tx);
    })) as T;
  }

  it("workspace ids and role codes", async () => {
    const workspaces = await asOwner(
      (tx) => tx`select code, id::text as id from cdf_notifications_v13.workspace order by code`,
    );
    expect(Object.fromEntries(workspaces.map((w) => [w.code, w.id]))).toEqual({ ...WORKSPACE_IDS });
    const roles = await asOwner((tx) => tx`select code from cdf_notifications_v13.role order by code`);
    expect(roles.map((r) => r.code)).toEqual([...ROLE_CODES].sort());
  });

  it("persona ids, codes, memberships, and the two negative-test personas", async () => {
    const rows = await asOwner(
      (tx) => tx`
        select p.id::text as persona_id, p.code, p.is_active, w.code as workspace, r.code as role,
               m.valid_to is not null and m.valid_to <= now() as expired
          from cdf_notifications_v13.persona p
          join cdf_notifications_v13.persona_workspace_membership m on m.persona_id = p.id
          join cdf_notifications_v13.workspace w on w.id = m.workspace_id
          join cdf_notifications_v13.role r on r.id = m.role_id
         order by p.id, m.id`,
    );
    for (const persona of PERSONAS) {
      const mine = rows.filter((r) => r.persona_id === persona.persona_id);
      expect(mine.length, persona.code).toBeGreaterThan(0);
      expect(mine[0]?.code).toBe(persona.code);
      expect(mine.map((r) => ({ workspace: r.workspace, role: r.role }))).toEqual(
        persona.memberships.map((m) => ({ ...m })),
      );
      const refusedByDatabase = mine.every((r) => r.expired) || mine.some((r) => !r.is_active);
      expect(refusedByDatabase, persona.code).toBe(persona.negative_test);
    }
    expect(new Set(rows.map((r) => r.persona_id)).size).toBe(PERSONAS.length);
  });
});
