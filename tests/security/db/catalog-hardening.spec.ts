// V13-SEC-002 · SEC-DB-04, -14, -16, -23, -24, -25, -26 · threats TM-S4, TM-E1, TM-E2, TM-T4, TM-T8, TM-I9, TM-I10,
// TM-D1.
//  - SEC-DB-14: every V13 function pins search_path = '' and no plpgsql body runs a built string (EXECUTE).
//  - SEC-DB-16 / -24: no role outside the three V13 roles reaches any V13 object. Supabase's anon, authenticated and
//    service_role (and a stand-in for the other application's login) are planted in a rolled-back transaction and
//    checked against every relation, sequence and function, by catalogue and by an actual attempt.
//  - SEC-DB-23: a planted foreign schema (the shape of the other application's: a table without RLS, a view, a
//    sequence, a function executable by PUBLIC) is unreachable for cdf_v13_user and cdf_v13_app, which also cannot
//    create anything anywhere. Mirrors hosted isolation checks C04–C09 on the local cluster.
//  - SEC-DB-26: the V13 roles' memberships are exactly those 0000_bootstrap creates (SET only, no INHERIT, no ADMIN),
//    and no V13 role belongs to a predefined pg_* role.
//  - SEC-DB-04: inside a verified context the request role cannot change identity (SET ROLE, SET SESSION
//    AUTHORIZATION, set_config('role'), RESET ROLE / SET ROLE NONE leave nobody).
//  - SEC-DB-25: the app login carries statement, idle-in-transaction and lock timeouts.
// Everything planted is created and dropped inside one administrator transaction that is rolled back.
// SYNTHETIC DATA ONLY.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/lib/db/security-context";
import {
  adminClient,
  appClient,
  asRaw,
  attempt,
  claimsText,
  databaseReady,
  installTestKey,
  PERSONA,
  SCHEMA,
  V13_ROLES,
  WORKSPACE,
} from "./support";

const present = await databaseReady("catalog-hardening");

class Rollback extends Error {}

/** Runs `fn` in an administrator transaction that is always rolled back. */
async function planted<T>(admin: postgres.Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await admin
    .begin(async (tx) => {
      out = await fn(tx as unknown as Tx);
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
  return out as T;
}

const SUPABASE_ROLES = ["anon", "authenticated", "service_role", "gc_review_app_sim"];

describe.skipIf(!present)("SEC-DB-14/16/23/24/26 catalogue hardening", () => {
  let admin: postgres.Sql;

  beforeAll(() => {
    admin = adminClient();
  });
  afterAll(async () => {
    await admin?.end({ timeout: 5 });
  });

  it("SEC-DB-14 every V13 function pins search_path = '' and no plpgsql body executes a built string", async () => {
    const rows = await admin<{ name: string; config: string[] | null; dynamic: boolean }[]>`
      select p.proname as name, p.proconfig as config,
             (l.lanname = 'plpgsql' and pg_catalog.regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '\\mexecute\\M') as dynamic
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        join pg_catalog.pg_language l on l.oid = p.prolang
       where n.nspname = ${SCHEMA}`;
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => !(r.config ?? []).includes('search_path=""')).map((r) => r.name)).toEqual([]);
    expect(rows.filter((r) => r.dynamic).map((r) => r.name)).toEqual([]);
  });

  it("SEC-DB-16 / -24 planted Supabase roles and every other non-V13 role reach no V13 object (catalogue)", async () => {
    const leaks = await planted(admin, async (tx) => {
      for (const r of SUPABASE_ROLES) await tx.unsafe(`create role ${r} nologin`);
      return tx<{ role: string; object: string; privilege: string }[]>`
        with roles as (
          select r.rolname from pg_catalog.pg_roles r
           where not r.rolsuper and r.rolname <> all(${V13_ROLES as unknown as string[]})
             and r.rolname !~ '^pg_'
           union select 'public'),
        objs as (
          select 'table ' || c.relname as object, c.oid, 'rel' as kind
            from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = ${SCHEMA} and c.relkind in ('r','v','m','S','f','p')
          union all
          select 'function ' || p.proname, p.oid, 'fn'
            from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = ${SCHEMA})
        select r.rolname as role, 'schema' as object, 'USAGE' as privilege from roles r
         where pg_catalog.has_schema_privilege(r.rolname, ${SCHEMA}, 'USAGE')
            or pg_catalog.has_schema_privilege(r.rolname, ${SCHEMA}, 'CREATE')
        union all
        select r.rolname, o.object, priv
          from roles r cross join objs o
          cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) priv
         where o.kind = 'rel' and (select relkind from pg_catalog.pg_class where oid = o.oid) <> 'S'
           and pg_catalog.has_table_privilege(r.rolname, o.oid, priv)
        union all
        select r.rolname, o.object, 'EXECUTE'
          from roles r cross join objs o
         where o.kind = 'fn' and pg_catalog.has_function_privilege(r.rolname, o.oid, 'EXECUTE')`;
    });
    expect(leaks).toEqual([]);
  });

  it("SEC-DB-24 planted Supabase roles are refused in practice: no table read, no function call", async () => {
    const results = await planted(admin, async (tx) => {
      const out: Record<string, string | undefined> = {};
      for (const r of SUPABASE_ROLES) {
        await tx.unsafe(`create role ${r} nologin`);
        await tx.unsafe(`set local role ${r}`);
        out[`${r} read`] = (
          await attempt(tx, (sp) => sp`select count(*) from cdf_notifications_v13.case_record`)
        ).code;
        out[`${r} call`] = (
          await attempt(tx, (sp) => sp`select cdf_notifications_v13.can_access_case(${PERSONA.alpha})`)
        ).code;
        out[`${r} verify`] = (
          await attempt(tx, (sp) => sp`select * from cdf_notifications_v13.verify_audit_chain()`)
        ).code;
        await tx.unsafe("reset role");
      }
      return out;
    });
    for (const [k, v] of Object.entries(results)) expect(v, k).toBe("42501");
  });

  it("SEC-DB-23 a planted foreign schema is unreachable for cdf_v13_user and cdf_v13_app, and they create nothing", async () => {
    const results = await planted(admin, async (tx) => {
      await tx.unsafe(`
        create schema gc_review_sim;
        create table gc_review_sim.review_item (id int primary key, note text);
        insert into gc_review_sim.review_item values (1, 'synthetic');
        create view gc_review_sim.review_view as select * from gc_review_sim.review_item;
        create sequence gc_review_sim.review_seq;
        create function gc_review_sim.review_fn() returns int language sql as 'select 1';`);
      const out: Record<string, string | undefined> = {};
      for (const role of ["cdf_v13_user", "cdf_v13_app"]) {
        await tx.unsafe(`set local role ${role}`);
        const probes: [string, (sp: Tx) => Promise<unknown>][] = [
          ["read table", (sp) => sp`select * from gc_review_sim.review_item`],
          ["read view", (sp) => sp`select * from gc_review_sim.review_view`],
          ["nextval", (sp) => sp`select nextval('gc_review_sim.review_seq')`],
          ["call function", (sp) => sp`select gc_review_sim.review_fn()`],
          ["create in foreign schema", (sp) => sp`create table gc_review_sim.v13_probe (id int)`],
          ["create in public", (sp) => sp`create table public.v13_probe (id int)`],
          ["create schema", (sp) => sp`create schema v13_probe`],
          ["create in V13 schema", (sp) => sp`create table cdf_notifications_v13.v13_probe (id int)`],
        ];
        for (const [label, fn] of probes) out[`${role} ${label}`] = (await attempt(tx, fn)).code;
        await tx.unsafe("reset role");
      }
      return out;
    });
    for (const [k, v] of Object.entries(results)) expect(v, k).toBe("42501");
  });

  it("SEC-DB-26 V13 role memberships are exactly the bootstrap's: SET only, no INHERIT, no ADMIN, no pg_* role", async () => {
    const [meRow] = await admin<{ me: string }[]>`select current_user as me`;
    const me = meRow!.me;
    const rows = await admin<
      { role: string; member: string; admin: boolean; inherit: boolean; set: boolean }[]
    >`
      select r.rolname as role, m.rolname as member, am.admin_option as admin, am.inherit_option as inherit,
             am.set_option as set
        from pg_catalog.pg_auth_members am
        join pg_catalog.pg_roles r on r.oid = am.roleid
        join pg_catalog.pg_roles m on m.oid = am.member
       where r.rolname = any(${V13_ROLES as unknown as string[]}) or m.rolname = any(${V13_ROLES as unknown as string[]})
       order by 1, 2`;
    // The V13 roles are members of exactly one role: the app may become the request role.
    expect(rows.filter((r) => (V13_ROLES as readonly string[]).includes(r.member))).toEqual([
      { role: "cdf_v13_user", member: "cdf_v13_app", admin: false, inherit: false, set: true },
    ]);
    // Only the bootstrap administrator (to run migrations and set up the app login) is otherwise a member.
    const others = rows.filter((r) => !(V13_ROLES as readonly string[]).includes(r.member));
    expect([...new Set(others.map((r) => r.member))]).toEqual([me]);
    expect(others.every((r) => !r.admin && !r.inherit && r.set)).toBe(true);
  });
});

describe.skipIf(!present)(
  "SEC-DB-04 / -25 the request role cannot change identity; the login has timeouts",
  () => {
    let app: postgres.Sql;
    let admin: postgres.Sql;

    beforeAll(async () => {
      app = appClient();
      admin = adminClient();
      await installTestKey(app);
    });
    afterAll(async () => {
      await app?.end({ timeout: 5 });
      await admin?.end({ timeout: 5 });
    });

    it("inside a verified context: SET ROLE / SET SESSION AUTHORIZATION / set_config('role') to another role are refused", async () => {
      const codes = await asRaw(
        app,
        { claims: claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), mac: "valid" },
        async (tx) => {
          const out: Record<string, string | undefined> = {};
          // (SET ROLE to the session user cdf_v13_app is always allowed by PostgreSQL; it is RESET ROLE, tested below.)
          for (const target of ["cdf_v13_owner", "postgres", "pg_read_all_data", "pg_write_all_data"]) {
            out[`set role ${target}`] = (
              await attempt(tx, (sp) => sp.unsafe(`set local role ${target}`))
            ).code;
            out[`set_config role ${target}`] = (
              await attempt(tx, (sp) => sp`select pg_catalog.set_config('role', ${target}, true)`)
            ).code;
            out[`session authorization ${target}`] = (
              await attempt(tx, (sp) => sp.unsafe(`set local session authorization ${target}`))
            ).code;
          }
          return out;
        },
      );
      for (const [k, v] of Object.entries(codes)) expect(v, k).toBe("42501");
    });

    it("RESET ROLE, SET ROLE NONE and SET ROLE cdf_v13_app leave the app login, which reads and calls nothing", async () => {
      for (const leave of ["reset role", "set local role none", "set local role cdf_v13_app"]) {
        const codes = await asRaw(
          app,
          { claims: claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), mac: "valid" },
          async (tx) => {
            await tx.unsafe(leave);
            const [whoRow] = await tx<{ who: string }[]>`select current_user as who`;
            const who = whoRow!.who;
            return {
              who,
              read: (await attempt(tx, (sp) => sp`select count(*) from cdf_notifications_v13.case_record`))
                .code,
              call: (await attempt(tx, (sp) => sp`select cdf_notifications_v13.current_persona_id()`)).code,
            };
          },
        );
        expect(codes, leave).toEqual({ who: "cdf_v13_app", read: "42501", call: "42501" });
      }
    });

    it("SEC-INFO-3 temporary tables: allowed by PostgreSQL's default TEMP grant, but they cannot shadow a V13 table", async () => {
      // TEMP on the database is granted to PUBLIC by default; on the shared hosted project V13 may not change database-
      // level grants (ADR-012). Every V13 function pins search_path = '' and qualifies every name, so a temporary table
      // named like a V13 table is never read by the database rules. Pinned so a change in either direction is seen.
      const claims = claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT);
      const read = (tx: Tx) => tx<{ n: string; tasks: number; access: boolean }[]>`
      select cdf_notifications_v13.portfolio_count(null, null, null, false)::text as n,
             (select count(*)::int from cdf_notifications_v13.case_tasks('0c000000-0000-4000-8000-000000000001')) as tasks,
             cdf_notifications_v13.can_access_case('0c000000-0000-4000-8000-000000000002') as access`;
      const before = await asRaw(app, { claims, mac: "valid" }, read);
      const after = await asRaw(app, { claims, mac: "valid" }, async (tx) => {
        const created: (string | undefined)[] = [];
        for (const t of [
          "case_record",
          "case_workspace_visibility",
          "case_assignment",
          "task",
          "persona_workspace_membership",
        ]) {
          const o = await attempt(tx, (sp) =>
            sp.unsafe(`create temp table ${t} (id uuid, case_id uuid, persona_id uuid, workspace_id uuid)`),
          );
          created.push(o.code);
          await tx.unsafe(`insert into pg_temp.${t} (id, case_id, persona_id, workspace_id)
                         select '0c000000-0000-4000-8000-000000000002', '0c000000-0000-4000-8000-000000000002',
                                '0b000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001'`);
        }
        expect(created.every((c) => c === undefined)).toBe(true);
        return read(tx);
      });
      expect(after).toEqual(before);
      expect(before[0]?.access).toBe(false);
    });

    it("SEC-DB-25 the app login has statement, idle-in-transaction and lock timeouts, and an empty search_path", async () => {
      const [row] = await admin<{ config: string[] }[]>`
      select s.setconfig as config from pg_catalog.pg_db_role_setting s
        join pg_catalog.pg_roles r on r.oid = s.setrole where r.rolname = 'cdf_v13_app' and s.setdatabase = 0`;
      const cfg = Object.fromEntries((row?.config ?? []).map((kv) => kv.split("=", 2) as [string, string]));
      const seconds = (v: string | undefined) =>
        v ? Number.parseInt(v, 10) * (v.endsWith("ms") ? 0.001 : v.endsWith("min") ? 60 : 1) : Infinity;
      expect(seconds(cfg.statement_timeout)).toBeLessThanOrEqual(30);
      expect(seconds(cfg.idle_in_transaction_session_timeout)).toBeLessThanOrEqual(60);
      expect(seconds(cfg.lock_timeout)).toBeLessThanOrEqual(10);
      expect(cfg.search_path).toBe('""');
      // The session the app actually gets carries them.
      const [live] = await app<{ st: string; lt: string }[]>`
      select current_setting('statement_timeout') as st, current_setting('lock_timeout') as lt`;
      expect(live?.st).not.toBe("0");
      expect(live?.lt).not.toBe("0");
    });
  },
);
