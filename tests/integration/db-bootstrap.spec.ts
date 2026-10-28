// The primary cluster after `pnpm db:reset`: what 0000_bootstrap.sql created (roles, memberships, settings, schema,
// history), what the app login can and cannot do, and the runner's idempotence, drift refusal and lock behaviour.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, MIGRATION_LOCK_SQL, MIGRATIONS_DIR, readMigrations } from "@/scripts/db/lib/migrations.mjs";
import { migrate } from "@/scripts/db/migrate.mjs";
import { clusterAvailable, PRIMARY_ADMIN_URL, PRIMARY_APP_URL } from "./support/clusters";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

describe.skipIf(!available)("bootstrap on the primary cluster", () => {
  let admin: postgres.Sql;
  const dirs: string[] = [];

  beforeAll(async () => {
    admin = connect(PRIMARY_ADMIN_URL, "cdf-v13-tests");
    const [present] = await admin`
      select pg_catalog.to_regclass('cdf_notifications_v13.schema_migrations') is not null as present`;
    if (!present?.present)
      throw new Error("v13_local has no V13 history: run pnpm db:reset before pnpm test:db");
  });

  afterAll(async () => {
    await admin?.end({ timeout: 5 });
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  /** Reads as cdf_v13_owner inside a transaction (the history has no grants). */
  async function asOwner<T>(query: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return (await admin.begin(async (tx) => {
      await tx.unsafe("set local role cdf_v13_owner");
      return query(tx);
    })) as T;
  }

  it("records every repository migration with its checksum", async () => {
    const rows = await asOwner(
      (tx) =>
        tx`select version, name, checksum_sha256, runner from cdf_notifications_v13.schema_migrations order by version`,
    );
    const files = readMigrations();
    expect(rows.map((r) => [r.version, r.name, r.checksum_sha256])).toEqual(
      files.map((f) => [f.version, f.name, f.checksum]),
    );
    for (const r of rows) expect(["local", "ci"]).toContain(r.runner);
  });

  it("creates three roles without dangerous attributes; only cdf_v13_app logs in, limited to 8 connections", async () => {
    const roles = await admin`
      select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls,
             rolconnlimit
        from pg_catalog.pg_roles where rolname like 'cdf\\_v13\\_%' order by rolname`;
    const base = {
      rolsuper: false,
      rolinherit: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolbypassrls: false,
    };
    expect(roles).toEqual([
      { rolname: "cdf_v13_app", ...base, rolcanlogin: true, rolconnlimit: 8 },
      { rolname: "cdf_v13_owner", ...base, rolcanlogin: false, rolconnlimit: -1 },
      { rolname: "cdf_v13_user", ...base, rolcanlogin: false, rolconnlimit: -1 },
    ]);
  });

  it("grants SET-only memberships: the app may only become cdf_v13_user", async () => {
    const memberships = await admin`
      select r.rolname as role, m.rolname as member, a.admin_option, a.inherit_option, a.set_option
        from pg_catalog.pg_auth_members a
        join pg_catalog.pg_roles r on r.oid = a.roleid
        join pg_catalog.pg_roles m on m.oid = a.member
       where r.rolname like 'cdf\\_v13\\_%' or m.rolname like 'cdf\\_v13\\_%'
       order by 1, 2`;
    const appMemberships = memberships.filter((m) => m.member === "cdf_v13_app");
    expect(appMemberships).toEqual([
      {
        role: "cdf_v13_user",
        member: "cdf_v13_app",
        admin_option: false,
        inherit_option: false,
        set_option: true,
      },
    ]);
    for (const m of memberships) {
      expect(m.inherit_option, `${m.member} → ${m.role}`).toBe(false);
      expect(m.member === "cdf_v13_app" || m.member === "postgres", `${m.member} → ${m.role}`).toBe(true);
    }
  });

  it("limits the app login's sessions and empties its search_path", async () => {
    const [row] = await admin`
      select s.setconfig
        from pg_catalog.pg_db_role_setting s
        join pg_catalog.pg_roles r on r.oid = s.setrole
       where r.rolname = 'cdf_v13_app' and s.setdatabase = 0`;
    expect([...(row?.setconfig ?? [])].sort()).toEqual([
      "idle_in_transaction_session_timeout=15s",
      "lock_timeout=3s",
      'search_path=""',
      "statement_timeout=10s",
    ]);
  });

  it("owns the schema as cdf_v13_owner and lets only cdf_v13_user use it", async () => {
    const [row] = await admin`
      select pg_catalog.pg_get_userbyid(n.nspowner) as owner,
             pg_catalog.has_schema_privilege('cdf_v13_user', n.oid, 'USAGE') as user_usage,
             pg_catalog.has_schema_privilege('cdf_v13_app', n.oid, 'USAGE') as app_usage,
             pg_catalog.has_schema_privilege('cdf_v13_user', n.oid, 'CREATE') as user_create,
             exists (select 1 from pg_catalog.aclexplode(n.nspacl) a where a.grantee = 0) as public_acl
        from pg_catalog.pg_namespace n where n.nspname = 'cdf_notifications_v13'`;
    expect(row).toEqual({
      owner: "cdf_v13_owner",
      user_usage: true,
      app_usage: false,
      user_create: false,
      public_acl: false,
    });
  });

  it("keeps the history table owner-only: RLS on, no grants", async () => {
    const [row] = await admin`
      select c.relrowsecurity, pg_catalog.pg_get_userbyid(c.relowner) as owner, c.relacl is null as no_grants
        from pg_catalog.pg_class c where c.oid = 'cdf_notifications_v13.schema_migrations'::regclass`;
    expect(row).toEqual({ relrowsecurity: true, owner: "cdf_v13_owner", no_grants: true });
  });

  it("refuses to run the bootstrap twice (guard)", async () => {
    const bootstrap = readFileSync(join(MIGRATIONS_DIR, "0000_bootstrap.sql"), "utf8");
    await expect(
      admin.begin(async (tx) => {
        await tx.unsafe(bootstrap);
      }),
    ).rejects.toMatchObject({ code: "P0001" });
  });

  describe("the app login", () => {
    let app: postgres.Sql;
    beforeAll(() => {
      app = connect(PRIMARY_APP_URL, "cdf-v13-tests");
    });
    afterAll(async () => {
      await app?.end({ timeout: 5 });
    });

    it("authenticates with the local-only SCRAM password and has an empty search_path", async () => {
      const [row] =
        await app`select session_user as s, current_user as c, pg_catalog.current_setting('search_path') as p`;
      expect(row).toEqual({ s: "cdf_v13_app", c: "cdf_v13_app", p: '""' });
    });

    it("can become cdf_v13_user and nothing else", async () => {
      await app.begin(async (tx) => {
        await tx`set local role cdf_v13_user`;
        const [row] = await tx`select current_user as c`;
        expect(row?.c).toBe("cdf_v13_user");
      });
      for (const role of ["cdf_v13_owner", "postgres"]) {
        await expect(
          app.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
          }),
        ).rejects.toMatchObject({ code: "42501" });
      }
    });

    it("cannot read the history, as itself or as cdf_v13_user", async () => {
      await expect(app`select 1 from cdf_notifications_v13.schema_migrations`).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        app.begin(async (tx) => {
          await tx`set local role cdf_v13_user`;
          await tx`select 1 from cdf_notifications_v13.schema_migrations`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("cannot create schemas or tables in public", async () => {
      await expect(app`create schema v13_should_not_exist`).rejects.toMatchObject({ code: "42501" });
      await expect(app`create table public.v13_should_not_exist (x integer)`).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  describe("runner", () => {
    function copySet(mutate?: (dir: string) => void): string {
      const dir = mkdtempSync(join(tmpdir(), "v13-primary-"));
      dirs.push(dir);
      for (const f of readMigrations()) copyFileSync(f.path, join(dir, f.file));
      mutate?.(dir);
      return dir;
    }

    it("is idempotent: nothing pending after db:reset, also in a dry run", async () => {
      const files = readMigrations();
      expect(await migrate({ url: PRIMARY_ADMIN_URL, runner: "local" })).toMatchObject({
        applied: [],
        alreadyApplied: files.length,
      });
      expect(await migrate({ url: PRIMARY_ADMIN_URL, runner: "local", dryRun: true })).toMatchObject({
        applied: [],
        alreadyApplied: files.length,
      });
    });

    it("refuses a repository whose applied file changed or was renamed", async () => {
      const changed = copySet((dir) =>
        writeFileSync(
          join(dir, "0000_bootstrap.sql"),
          `${readFileSync(join(dir, "0000_bootstrap.sql"), "utf8")}\n-- edited\n`,
        ),
      );
      await expect(migrate({ url: PRIMARY_ADMIN_URL, runner: "local", dir: changed })).rejects.toMatchObject({
        code: "HISTORY_CHECKSUM_DRIFT",
      });
      const renamed = copySet((dir) => {
        copyFileSync(join(dir, "0000_bootstrap.sql"), join(dir, "0000_bootstrap_renamed.sql"));
        rmSync(join(dir, "0000_bootstrap.sql"));
      });
      await expect(migrate({ url: PRIMARY_ADMIN_URL, runner: "local", dir: renamed })).rejects.toMatchObject({
        code: "HISTORY_NAME_DRIFT",
      });
    });

    it("waits at most lock_timeout for another runner holding the V13 migration lock", async () => {
      const holder = connect(PRIMARY_ADMIN_URL, "cdf-v13-tests-lock-holder");
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holding = holder.begin(async (tx) => {
        await tx.unsafe(MIGRATION_LOCK_SQL);
        locked();
        await released;
      });
      try {
        await isLocked;
        const started = Date.now();
        await expect(migrate({ url: PRIMARY_ADMIN_URL, runner: "local" })).rejects.toMatchObject({
          code: "55P03",
        });
        expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
      } finally {
        release();
        await holding;
        await holder.end({ timeout: 5 });
      }
    });
  });
});
