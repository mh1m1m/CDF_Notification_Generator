// V13-SEC-004 · database/hosted/post_apply_checks.sql, V13's own hardening check after each hosted migration.
// Proves on the local cluster that:
//  - the file is one READ ONLY transaction that ends in ROLLBACK, and its CHECKS block is a single SELECT;
//  - the P03 definer allow-list equals the SECURITY DEFINER functions the migrations declare, and the live catalogue;
//  - on a fresh db:reset every check passes and VERDICT is PASS;
//  - one planted fault per check (two for some) makes exactly that check fail and VERDICT FAIL.
// Every fault is planted inside an administrator transaction that is rolled back.
// SYNTHETIC DATA ONLY.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/lib/db/security-context";
import { buildHostedBundle } from "@/scripts/db/hosted-bundle.mjs";
import { readMigrations } from "@/scripts/db/lib/migrations.mjs";
import {
  clusterAvailable,
  HOSTED_SIM_SUPERUSER_URL,
  PRIMARY_ADMIN_URL,
} from "../../integration/support/clusters";
import { adminClient } from "../../integration/support/context";
import { client, resetHostedSim, run } from "../../integration/support/hosted-sim";

const present = await clusterAvailable("primary", PRIMARY_ADMIN_URL);
const hostedSim = await clusterAvailable("hosted-sim", HOSTED_SIM_SUPERUSER_URL);

const FILE = join(process.cwd(), "database", "hosted", "post_apply_checks.sql");
const MIGRATIONS = join(process.cwd(), "database", "migrations");
const text = readFileSync(FILE, "utf8");
const block = (() => {
  const start = text.indexOf("-- BEGIN CHECKS");
  const end = text.indexOf("-- END CHECKS");
  return text
    .slice(start + "-- BEGIN CHECKS".length, end)
    .trim()
    .replace(/;\s*$/, "");
})();

/** P03's allow-list, read from the file. */
function fileAllowList(): string[] {
  const m = /definer_allow \(name\) as \(values([\s\S]*?)\)\),/.exec(text);
  return [...(m?.[1] ?? "").matchAll(/\('([a-z_0-9]+)'/g)].map((x) => x[1]!).sort();
}

/** SECURITY DEFINER functions as the migrations leave them (later definitions and ALTERs win), by name. */
function migrationDefiners(): string[] {
  const definer = new Map<string, boolean>();
  for (const f of readdirSync(MIGRATIONS)
    .filter((n) => /^\d{4}_.*\.sql$/.test(n))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8").replace(/--[^\n]*/g, "");
    const events: [number, string, boolean][] = [];
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+cdf_notifications_v13\.(\w+)\s*\(([\s\S]*?)\bas\s+\$\w*\$/gi,
    ))
      events.push([m.index!, m[1]!, /security\s+definer/i.test(m[2]!)]);
    for (const m of sql.matchAll(
      /alter\s+function\s+cdf_notifications_v13\.(\w+)\s*\([^)]*\)\s+security\s+(definer|invoker)/gi,
    ))
      events.push([m.index!, m[1]!, m[2]!.toLowerCase() === "definer"]);
    for (const [, name, isDefiner] of events.sort((a, b) => a[0] - b[0])) definer.set(name, isDefiner);
  }
  return [...definer.entries()]
    .filter(([, d]) => d)
    .map(([n]) => n)
    .sort();
}

interface CheckRow {
  check_id: string;
  detail: string;
  breaches: number;
}

class Rollback extends Error {}

/** Plants a fault (as the administrator), then runs the CHECKS block as cdf_v13_owner; always rolls back. */
async function runChecks(
  admin: postgres.Sql,
  plant?: (tx: Tx) => Promise<unknown>,
): Promise<Record<string, CheckRow>> {
  let out: Record<string, CheckRow> = {};
  await admin
    .begin(async (tx) => {
      if (plant) await plant(tx as unknown as Tx);
      await tx.unsafe("reset role");
      await tx.unsafe("set local role cdf_v13_owner");
      const rows = await tx.unsafe<CheckRow[]>(block);
      out = Object.fromEntries(rows.map((r) => [r.check_id, { ...r, breaches: Number(r.breaches) }]));
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
  return out;
}

const asOwner = (tx: Tx, statement: string) =>
  tx.unsafe(`set local role cdf_v13_owner; ${statement}; reset role`);

/** [check that must fail, label, plant, other checks the same fault legitimately also fails]. */
const FAULTS: [string, string, (tx: Tx) => Promise<unknown>, string[]?][] = [
  [
    "P01_rls_enabled",
    "RLS disabled on task",
    (tx) => asOwner(tx, "alter table cdf_notifications_v13.task disable row level security"),
  ],
  [
    "P02_no_table_writes",
    "INSERT on task granted to cdf_v13_user",
    (tx) => asOwner(tx, "grant insert on cdf_notifications_v13.task to cdf_v13_user"),
  ],
  [
    "P02_no_table_writes",
    "DELETE on audit_event granted to cdf_v13_app",
    (tx) => asOwner(tx, "grant delete on cdf_notifications_v13.audit_event to cdf_v13_app"),
  ],
  [
    "P03_definer_allow_list",
    "a new, unlisted SECURITY DEFINER function",
    (tx) =>
      asOwner(
        tx,
        "create function cdf_notifications_v13.planted_definer() returns int language sql security definer set search_path = '' as 'select 1'",
      ),
  ],
  [
    "P03_definer_allow_list",
    "a listed definer switched to invoker",
    (tx) => asOwner(tx, "alter function cdf_notifications_v13.has_role(text) security invoker"),
  ],
  [
    "P04_search_path_pinned",
    "search_path reset on case_header",
    (tx) => asOwner(tx, "alter function cdf_notifications_v13.case_header(uuid) reset search_path"),
  ],
  [
    "P05_no_api_role_privileges",
    "planted anon role granted schema usage",
    async (tx) => {
      await tx.unsafe("create role anon nologin");
      await asOwner(tx, "grant usage on schema cdf_notifications_v13 to anon");
    },
    ["P09_acl_grantees_v13_only"],
  ],
  [
    "P05_no_api_role_privileges",
    "EXECUTE on portfolio_count granted to PUBLIC",
    (tx) =>
      asOwner(
        tx,
        "grant execute on function cdf_notifications_v13.portfolio_count(text, text, text, boolean) to public",
      ),
    ["P09_acl_grantees_v13_only"],
  ],
  [
    "P09_acl_grantees_v13_only",
    "a column grant to a planted authenticated role",
    async (tx) => {
      await tx.unsafe("create role authenticated nologin");
      await asOwner(
        tx,
        "grant select (display_number) on cdf_notifications_v13.case_record to authenticated",
      );
    },
  ],
  [
    "P09_acl_grantees_v13_only",
    "a table grant to the predefined role pg_read_all_data",
    (tx) => asOwner(tx, "grant select on cdf_notifications_v13.task to pg_read_all_data"),
  ],
  [
    "P09_acl_grantees_v13_only",
    "a default ACL granting future tables to a planted service_role",
    async (tx) => {
      await tx.unsafe("create role service_role nologin");
      await tx.unsafe(
        "alter default privileges for role cdf_v13_owner in schema cdf_notifications_v13 grant select on tables to service_role",
      );
    },
  ],
  [
    "P09_acl_grantees_v13_only",
    "a function with no ACL (built-in default: PUBLIC EXECUTE), created by the administrator",
    (tx) =>
      tx.unsafe(
        "create function cdf_notifications_v13.planted_public() returns int language sql set search_path = '' as 'select 1'",
      ),
    ["P05_no_api_role_privileges"],
  ],
  [
    "P06_claims_key_protected",
    "SELECT on claims_key granted to cdf_v13_app",
    (tx) => asOwner(tx, "grant select on cdf_notifications_v13.claims_key to cdf_v13_app"),
  ],
  [
    "P06_claims_key_protected",
    "deny-all policy dropped",
    (tx) => asOwner(tx, "drop policy claims_key_deny_all on cdf_notifications_v13.claims_key"),
  ],
  [
    "P07_audit_chain_valid",
    "an audit row rewritten",
    (tx) =>
      asOwner(
        tx,
        `alter table cdf_notifications_v13.audit_event disable trigger audit_event_no_update_delete;
         update cdf_notifications_v13.audit_event set metadata = '{"tampered":true}'::jsonb
          where seq = (select min(seq) from cdf_notifications_v13.audit_event)`,
      ),
  ],
  [
    "P08_memberships",
    "cdf_v13_app made a member of cdf_v13_owner",
    (tx) => tx.unsafe("grant cdf_v13_owner to cdf_v13_app"),
  ],
  [
    "P08_memberships",
    "cdf_v13_user made a member of pg_read_all_data",
    (tx) => tx.unsafe("grant pg_read_all_data to cdf_v13_user"),
  ],
];

describe("SEC-004 post_apply_checks.sql shape", () => {
  it("is one READ ONLY transaction ending in ROLLBACK, run as cdf_v13_owner, with a single SELECT as its CHECKS", () => {
    const statements = text
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements[0]).toBe("begin read only");
    expect(statements.at(-1)).toBe("rollback");
    expect(statements).toContain("set local role cdf_v13_owner");
    expect(statements.some((s) => /^commit\b/i.test(s))).toBe(false);
    expect(block).toMatch(/^with\b/);
    expect(block.replace(/--[^\n]*/g, "")).not.toContain(";");
    // Reads catalogue metadata only, apart from claims_key's row count and the chain verdict.
    const tables = [...block.matchAll(/from\s+cdf_notifications_v13\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual(["claims_key", "verify_audit_chain"]);
  });

  it("P03's allow-list equals the SECURITY DEFINER functions the migrations declare", () => {
    const fromMigrations = migrationDefiners();
    expect(fromMigrations.length).toBeGreaterThanOrEqual(20);
    expect(fileAllowList()).toEqual(fromMigrations);
  });
});

describe.skipIf(!present)("SEC-004 post_apply_checks.sql against the local cluster", () => {
  let admin: postgres.Sql;

  beforeAll(() => {
    admin = adminClient();
  });
  afterAll(async () => {
    await admin?.end({ timeout: 5 });
  });

  it("P03's allow-list equals the live catalogue's SECURITY DEFINER functions", async () => {
    const rows = await admin<{ name: string }[]>`
      select p.proname as name from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'cdf_notifications_v13' and p.prosecdef order by 1`;
    expect(rows.map((r) => r.name)).toEqual(fileAllowList());
  });

  it("PASS on the migrated, seeded database: every check has 0 breaches", async () => {
    const result = await runChecks(admin);
    expect(Object.keys(result).sort()).toEqual([
      "P00_preconditions",
      "P01_rls_enabled",
      "P02_no_table_writes",
      "P03_definer_allow_list",
      "P04_search_path_pinned",
      "P05_no_api_role_privileges",
      "P06_claims_key_protected",
      "P07_audit_chain_valid",
      "P08_memberships",
      "P09_acl_grantees_v13_only",
      "VERDICT",
    ]);
    for (const row of Object.values(result)) expect(row.breaches, `${row.check_id}: ${row.detail}`).toBe(0);
    expect(result.VERDICT?.detail).toBe("PASS");
  });

  it("the file itself runs as written (READ ONLY, as cdf_v13_owner) and leaves nothing behind", async () => {
    const results = (await admin.unsafe(text)) as unknown as unknown[];
    const rows = results.find(
      (r) => Array.isArray(r) && (r as CheckRow[]).some((x) => x?.check_id === "VERDICT"),
    ) as CheckRow[] | undefined;
    expect(rows?.find((r) => r.check_id === "VERDICT")?.detail).toBe("PASS");
    const [state] = await admin<{ role: string; tx: string }[]>`
      select current_user::text as role, pg_catalog.txid_current_if_assigned()::text as tx`;
    expect(state?.role).not.toBe("cdf_v13_owner");
  });

  for (const [check, label, plant, also = []] of FAULTS) {
    it(`FAIL on a planted fault: ${label} → ${[check, ...also].join(" + ")}`, async () => {
      const result = await runChecks(admin, plant);
      for (const c of [check, ...also])
        expect(result[c]?.breaches, `${c}: ${result[c]?.detail}`).toBeGreaterThan(0);
      expect(result.VERDICT?.detail).toBe("FAIL");
      const others = Object.values(result).filter(
        (r) => r.check_id !== check && !also.includes(r.check_id) && r.check_id !== "VERDICT",
      );
      expect(others.filter((r) => r.breaches > 0).map((r) => `${r.check_id}: ${r.detail}`)).toEqual([]);
    });
  }
});

describe.skipIf(!hostedSim)(
  "SEC-004 post_apply_checks.sql on the hosted layout (non-superuser administrator)",
  () => {
    let adminUrl: string;
    let superuserUrl: string;

    beforeAll(async () => {
      // Every repository migration, applied the hosted way: one bundle per version, run by the non-superuser `postgres`.
      const sim = await resetHostedSim();
      adminUrl = sim.adminUrl;
      superuserUrl = sim.superuserUrl;
      for (const m of readMigrations()) await run(adminUrl, buildHostedBundle({ version: m.version }));
    }, 120_000);

    /** Runs the file exactly as ARCH runs it, as the administrator; returns the result rows. */
    async function runFile(): Promise<Record<string, CheckRow>> {
      const results = (await run(adminUrl, text)) as unknown as unknown[];
      const rows = (results.find(
        (r) => Array.isArray(r) && (r as CheckRow[]).some((x) => x?.check_id === "VERDICT"),
      ) ?? []) as CheckRow[];
      return Object.fromEntries(rows.map((r) => [r.check_id, { ...r, breaches: Number(r.breaches) }]));
    }

    it("the administrator holds PostgreSQL's automatic creator grants (ADMIN only, from the superuser)", async () => {
      const rows = await run(
        superuserUrl,
        `select g.rolname as role, am.admin_option as admin, am.set_option as set, gr.rolsuper as by_superuser
         from pg_catalog.pg_auth_members am
         join pg_catalog.pg_roles u on u.oid = am.member
         join pg_catalog.pg_roles g on g.oid = am.roleid
         join pg_catalog.pg_roles gr on gr.oid = am.grantor
        where u.rolname = 'postgres' and am.admin_option order by 1`,
      );
      expect([...rows]).toEqual([
        { role: "cdf_v13_app", admin: true, set: false, by_superuser: true },
        { role: "cdf_v13_owner", admin: true, set: false, by_superuser: true },
        { role: "cdf_v13_user", admin: true, set: false, by_superuser: true },
      ]);
    });

    it("PASS as written: every check has 0 breaches, with the Supabase API roles present", async () => {
      const result = await runFile();
      for (const row of Object.values(result)) expect(row.breaches, `${row.check_id}: ${row.detail}`).toBe(0);
      expect(result.VERDICT?.detail).toBe("PASS");
    });

    it("FAIL on the hosted layout when a Supabase API role is granted something (then revoked)", async () => {
      const sql = client(adminUrl);
      try {
        await sql.unsafe(
          "set role cdf_v13_owner; grant select on cdf_notifications_v13.role to authenticated; reset role",
        );
        const result = await runFile();
        expect(result.P05_no_api_role_privileges?.breaches).toBeGreaterThan(0);
        expect(result.P09_acl_grantees_v13_only?.breaches).toBeGreaterThan(0);
        expect(result.VERDICT?.detail).toBe("FAIL");
      } finally {
        await sql.unsafe(
          "set role cdf_v13_owner; revoke select on cdf_notifications_v13.role from authenticated; reset role",
        );
        await sql.end({ timeout: 5 });
      }
      expect((await runFile()).VERDICT?.detail).toBe("PASS");
    });

    it("FAIL when the administrator's creator row gains INHERIT (then restored)", async () => {
      // Only the bootstrap superuser, its grantor, can change that row.
      const sql = client(superuserUrl);
      try {
        await sql.unsafe("grant cdf_v13_owner to postgres with inherit true granted by supabase_admin");
        const result = await runFile();
        expect(result.P08_memberships?.breaches).toBeGreaterThan(0);
        expect(result.VERDICT?.detail).toBe("FAIL");
      } finally {
        await sql.unsafe("grant cdf_v13_owner to postgres with inherit false granted by supabase_admin");
        await sql.end({ timeout: 5 });
      }
      expect((await runFile()).VERDICT?.detail).toBe("PASS");
    });

    it("FAIL when cdf_v13_app's membership in cdf_v13_user gains INHERIT (then restored)", async () => {
      // The administrator holds ADMIN on the role it created, so it changes its own grant row in place.
      const sql = client(adminUrl);
      try {
        await sql.unsafe("grant cdf_v13_user to cdf_v13_app with inherit true");
        const result = await runFile();
        expect(result.P08_memberships?.breaches).toBeGreaterThan(0);
        expect(result.VERDICT?.detail).toBe("FAIL");
      } finally {
        await sql.unsafe("grant cdf_v13_user to cdf_v13_app with inherit false");
        await sql.end({ timeout: 5 });
      }
      expect((await runFile()).VERDICT?.detail).toBe("PASS");
    });
  },
);
