// V13-DB-001 — catalog invariants of schema cdf_notifications_v13 for every migration applied so far, and the audit
// ledger (ADR-011): RLS on every table, no write privilege for the application roles, definer discipline, owner-only
// internals, append-only ledger, hash chain that detects tampering and does not depend on the session time zone.
// The catalog checks read pg_catalog, so they hold for whatever migrations exist (they grow with 0002+).
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/lib/db/security-context";
import { clusterAvailable, PRIMARY_ADMIN_URL } from "./support/clusters";
import {
  adminClient,
  appClient,
  asOwner,
  asPersona,
  asRaw,
  claimsText,
  CORRELATION,
  identitySeedPresent,
  PERSONA,
  WORKSPACE,
} from "./support/context";
import { outcomeOf } from "./support/refusal";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);
const seeded = available && (await identitySeedPresent(adminClient()));
if (available && !seeded)
  console.warn("[integration] skipping catalog-audit: no identity seed (pnpm db:reset)");

const APP_ROLES = ["cdf_v13_user", "cdf_v13_app", "PUBLIC"];

/**
 * SECURITY DEFINER allow-list (E02 §5.1, SEC-DB-30): commands, claims and access helpers, the owning-visibility
 * trigger, the audit writer and the chain verifier. Anything else must be SECURITY INVOKER.
 */
const DEFINER_ALLOWED = new Set([
  "_api_create_notification_draft_impl",
  "_api_install_claims_key_impl",
  "_api_switch_workspace_impl",
  "_api_update_task_status_impl",
  "_append_audit",
  "_append_audit_refused",
  "_case_owning_visibility",
  "_claim_uuid",
  "_claims_hmac",
  "_is_colleague",
  "_verified_claims",
  "api_create_notification_draft",
  "api_install_claims_key",
  "api_switch_workspace",
  "api_update_task_status",
  "can_access_case",
  "claims_key_state",
  "current_correlation_id",
  "current_persona",
  "current_persona_id",
  "current_role_codes",
  "current_workspace_id",
  "has_role",
  "is_assigned_to_case",
  "verify_audit_chain",
]);

/** Functions the request role must never execute. */
const OWNER_ONLY = [
  "_append_audit(text, text, uuid, uuid, jsonb)",
  "_claims_hmac(bytea)",
  "_verified_claims()",
  "_claim_uuid(text)",
  "verify_audit_chain()",
  "_reject_mutation()",
  // 0012 (V13-DB-020)
  "_audit_row_hash_v2(bigint, timestamptz, uuid, uuid, text, text, uuid, uuid, uuid, text, text, jsonb, text)",
  "_policy_fingerprint()",
  "_acl_canonical(aclitem[])",
  // 0013 (V13-DB-021, R3): the private append helper, the REFUSED writer, the command slot and the four bodies.
  "_append_audit_row(text, text, uuid, uuid, jsonb, text)",
  "_append_audit_refused(text, text, text, uuid, uuid)",
  "_claim_command_slot()",
  "_api_install_claims_key_impl(bytea)",
  "_api_update_task_status_impl(uuid, text, integer)",
  "_api_create_notification_draft_impl(uuid, uuid, text, text)",
  "_api_switch_workspace_impl(uuid)",
];

/** A command's refusal (migration 0013), its raised SQLSTATE, or "OK". */
const codeOf = outcomeOf;

describe.skipIf(!seeded)("catalog invariants and the audit ledger", () => {
  let admin: postgres.Sql;
  let app: postgres.Sql;

  beforeAll(async () => {
    admin = adminClient();
    app = appClient();
    await asPersona(app, PERSONA.alpha, "SECRETARIAT", async () => undefined); // installs the test key if needed
  });

  afterAll(async () => {
    await admin?.end({ timeout: 5 });
    await app?.end({ timeout: 5 });
  });

  describe("catalog", () => {
    it("every table has RLS enabled and at least one policy; no FORCE, no views, no other relation kinds", async () => {
      const rows = await admin<
        { name: string; kind: string; rls: boolean; force: boolean; policies: number }[]
      >`
        select c.relname as name, c.relkind::text as kind, c.relrowsecurity as rls, c.relforcerowsecurity as force,
               (select count(*)::int from pg_catalog.pg_policy p where p.polrelid = c.oid) as policies
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'cdf_notifications_v13' and c.relkind in ('r', 'p', 'v', 'm', 'f')
         order by 1`;
      expect(rows.length).toBeGreaterThanOrEqual(7);
      for (const row of rows) {
        expect(row, row.name).toMatchObject({ kind: "r", rls: true, force: false });
        expect(row.policies, `${row.name} has no policy`).toBeGreaterThan(0);
      }
    });

    it("every relation is owned by cdf_v13_owner", async () => {
      const rows = await admin<{ name: string; owner: string }[]>`
        select c.relname as name, pg_catalog.pg_get_userbyid(c.relowner) as owner
          from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'cdf_notifications_v13' and c.relkind in ('r', 'S', 'i')`;
      for (const row of rows) expect(row.owner, row.name).toBe("cdf_v13_owner");
    });

    it("the application roles and PUBLIC hold no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on any table", async () => {
      const rows = await admin<{ grantee: string; table_name: string; privilege_type: string }[]>`
        select g.grantee, g.table_name, g.privilege_type
          from information_schema.role_table_grants g
         where g.table_schema = 'cdf_notifications_v13'
           and g.grantee = any (${APP_ROLES})
           and g.privilege_type <> 'SELECT'`;
      expect([...rows]).toEqual([]);
      const columns = await admin<{ grantee: string; table_name: string; privilege_type: string }[]>`
        select g.grantee, g.table_name, g.privilege_type
          from information_schema.column_privileges g
         where g.table_schema = 'cdf_notifications_v13'
           and g.grantee = any (${APP_ROLES})
           and g.privilege_type <> 'SELECT'`;
      expect([...columns]).toEqual([]);
    });

    it("cdf_v13_app and PUBLIC cannot read any table; every policy is limited to current_user = 'cdf_v13_user'", async () => {
      const reads = await admin<{ grantee: string; table_name: string }[]>`
        select g.grantee, g.table_name from information_schema.role_table_grants g
         where g.table_schema = 'cdf_notifications_v13' and g.grantee in ('cdf_v13_app', 'PUBLIC')`;
      expect([...reads]).toEqual([]);
      const permissive = await admin<{ table: string; name: string; using: string | null }[]>`
        select c.relname as table, p.polname as name, pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using
          from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'cdf_notifications_v13' and p.polpermissive`;
      for (const policy of permissive)
        expect(policy.using ?? "", `${policy.table}.${policy.name}`).toContain(
          "CURRENT_USER = 'cdf_v13_user'::name",
        );
    });

    it("SECURITY DEFINER functions are on the allow-list, owned by cdf_v13_owner, with search_path=''", async () => {
      const rows = await admin<{ name: string; definer: boolean; owner: string; config: string[] | null }[]>`
        select p.proname as name, p.prosecdef as definer, pg_catalog.pg_get_userbyid(p.proowner) as owner,
               p.proconfig as config
          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'cdf_notifications_v13'`;
      expect(rows.length).toBeGreaterThan(0);
      for (const fn of rows) {
        expect(fn.owner, fn.name).toBe("cdf_v13_owner");
        expect(fn.config ?? [], fn.name).toContain('search_path=""');
        if (fn.definer) expect(DEFINER_ALLOWED.has(fn.name), `${fn.name} is SECURITY DEFINER`).toBe(true);
        if (fn.name.startsWith("api_")) expect(fn.definer, `${fn.name} must be a definer command`).toBe(true);
      }
    });

    it("no function is executable by PUBLIC", async () => {
      const rows = await admin<{ name: string }[]>`
        select p.proname as name
          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'cdf_notifications_v13'
           and pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')`;
      expect([...rows]).toEqual([]);
    });

    it.each(OWNER_ONLY)("cdf_v13_user cannot execute %s", async (signature) => {
      const [row] = await admin<{ allowed: boolean }[]>`
        select pg_catalog.has_function_privilege('cdf_v13_user', ${`cdf_notifications_v13.${signature}`},
                                                 'EXECUTE') as allowed`;
      expect(row?.allowed).toBe(false);
    });
  });

  describe("audit ledger", () => {
    const verify = (tx: Tx) =>
      tx<{ rows_checked: string; first_broken_seq: string | null; is_valid: boolean }[]>`
        select * from cdf_notifications_v13.verify_audit_chain()`;

    it("the request role can neither read nor write the ledger", async () => {
      const refused: ((tx: Tx) => Promise<unknown>)[] = [
        (tx) => tx`select count(*) from cdf_notifications_v13.audit_event`,
        (tx) => tx`insert into cdf_notifications_v13.audit_event (action, entity_type, prev_hash, row_hash)
                   values ('FORGED', 'test', repeat('0', 64), repeat('1', 64))`,
        (tx) => tx`update cdf_notifications_v13.audit_event set metadata = '{}'::jsonb`,
        (tx) => tx`delete from cdf_notifications_v13.audit_event`,
        (tx) => tx`select cdf_notifications_v13._append_audit('FORGED', 'test', null, null)`,
        (tx) => tx`select * from cdf_notifications_v13.verify_audit_chain()`,
      ];
      for (const query of refused)
        expect(await codeOf(asPersona(app, PERSONA.alpha, "SECRETARIAT", query))).toBe("42501");
    });

    it("UPDATE, DELETE and TRUNCATE are refused even for the owner (V1403)", async () => {
      expect(
        await codeOf(
          asOwner(admin, (tx) => tx`update cdf_notifications_v13.audit_event set metadata = '{}'::jsonb`),
        ),
      ).toBe("V1403");
      expect(await codeOf(asOwner(admin, (tx) => tx`delete from cdf_notifications_v13.audit_event`))).toBe(
        "V1403",
      );
      expect(await codeOf(asOwner(admin, (tx) => tx`truncate cdf_notifications_v13.audit_event`))).toBe(
        "V1403",
      );
    });

    it("the chain verifies, and verifies identically under other session time zones", async () => {
      const utc = await asOwner(admin, async (tx) => {
        await tx`set local timezone = 'UTC'`;
        return verify(tx);
      });
      expect(utc[0]).toMatchObject({ is_valid: true, first_broken_seq: null });
      expect(Number(utc[0]?.rows_checked)).toBeGreaterThanOrEqual(2);
      for (const zone of ["Asia/Riyadh", "Pacific/Kiritimati", "America/St_Johns"]) {
        const other = await asOwner(admin, async (tx) => {
          await tx.unsafe(`set local timezone = '${zone}'`);
          return verify(tx);
        });
        expect(other, zone).toEqual(utc);
      }
    });

    it("detects a rewritten row and reports its sequence number (tamper rolled back)", async () => {
      const result = await asOwner(admin, async (tx) => {
        const [target] = await tx<{ seq: string }[]>`
          select a.seq::text as seq from cdf_notifications_v13.audit_event a order by a.seq limit 1`;
        await tx`alter table cdf_notifications_v13.audit_event disable trigger audit_event_no_update_delete`;
        await tx`update cdf_notifications_v13.audit_event set metadata = '{"tampered":true}'::jsonb
                  where seq = ${target!.seq}::bigint`;
        const [row] = await verify(tx);
        return { seq: target!.seq, row };
      });
      expect(result.row).toMatchObject({ is_valid: false, first_broken_seq: result.seq });
      const [after] = await asOwner(admin, verify);
      expect(after?.is_valid).toBe(true);
    });

    it("detects a removed row (the next row's prev_hash no longer matches)", async () => {
      const result = await asOwner(admin, async (tx) => {
        const rows = await tx<{ seq: string }[]>`
          select a.seq::text as seq from cdf_notifications_v13.audit_event a order by a.seq limit 2`;
        if (rows.length < 2) return null;
        await tx`alter table cdf_notifications_v13.audit_event disable trigger audit_event_no_update_delete`;
        await tx`delete from cdf_notifications_v13.audit_event where seq = ${rows[0]!.seq}::bigint`;
        const [row] = await verify(tx);
        return { next: rows[1]!.seq, row };
      });
      expect(result).not.toBeNull();
      expect(result!.row).toMatchObject({ is_valid: false, first_broken_seq: result!.next });
    });

    it("takes the correlation id from the verified claims only; there is no argument to override it", async () => {
      const appendAndRead = async (tx: Tx) => {
        const [appended] = await tx<{ id: string }[]>`
          select cdf_notifications_v13._append_audit('TEST_CORRELATION', 'test', null, null) as id`;
        const [row] = await tx<
          { correlation_id: string | null; actor_persona_id: string | null; workspace_id: string | null }[]
        >`
          select a.correlation_id, a.actor_persona_id, a.workspace_id
            from cdf_notifications_v13.audit_event a where a.id = ${appended!.id}`;
        return row;
      };
      const withClaims = await asRaw(
        admin,
        { claims: claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), mac: "valid" },
        async (tx) => {
          await tx.unsafe("reset role");
          await tx.unsafe("set local role cdf_v13_owner");
          return appendAndRead(tx);
        },
      );
      expect(withClaims).toEqual({
        correlation_id: CORRELATION,
        actor_persona_id: PERSONA.alpha,
        workspace_id: WORKSPACE.SECRETARIAT,
      });
      expect(await asOwner(admin, appendAndRead)).toEqual({
        correlation_id: null,
        actor_persona_id: null,
        workspace_id: null,
      });
      expect(
        await codeOf(
          asOwner(
            admin,
            (tx) =>
              tx`select cdf_notifications_v13._append_audit('TEST_CORRELATION', 'test', null, null, '{}'::jsonb,
                 '6f1c2a9e-3b7d-4c1e-9a2f-0d8e7b6a5c42'::uuid)`,
          ),
        ),
      ).toBe("42883");
    });

    it("refuses to append outside READ COMMITTED (V1500)", async () => {
      const code = await codeOf(
        admin.begin("isolation level repeatable read", async (tx) => {
          await tx.unsafe("set local role cdf_v13_owner");
          await tx`select cdf_notifications_v13._append_audit('TEST_ISOLATION', 'test', null, null)`;
        }),
      );
      expect(code).toBe("V1500");
    });

    it("concurrent appends from two connections keep one valid chain", async () => {
      const second = adminClient();
      try {
        const append = (sql: postgres.Sql, n: number) =>
          asOwner(
            sql,
            async (tx) => {
              for (let i = 0; i < n; i += 1)
                await tx`select cdf_notifications_v13._append_audit('TEST_CHAIN_CONCURRENCY', 'test', null, null,
                                                                  jsonb_build_object('i', ${i}::int))`;
            },
            { rollback: false },
          );
        await Promise.all([append(admin, 5), append(second, 5)]);
      } finally {
        await second.end({ timeout: 5 });
      }
      const [row] = await asOwner(admin, verify);
      expect(row).toMatchObject({ is_valid: true, first_broken_seq: null });
    });

    it("rows carry ids and codes only: the metadata of every row stays within 2 KB", async () => {
      const [row] = await asOwner(
        admin,
        (tx) =>
          tx<{ max: number }[]>`select coalesce(max(pg_catalog.pg_column_size(metadata)), 0)::int as max
                               from cdf_notifications_v13.audit_event`,
      );
      expect(row!.max).toBeLessThanOrEqual(2048);
      expect(
        await codeOf(
          asOwner(
            admin,
            (tx) =>
              tx`select cdf_notifications_v13._append_audit('TEST_OVERSIZE', 'test', null, null,
                 jsonb_build_object('x', (select string_agg(md5(g::text), '') from generate_series(1, 100) g)))`,
          ),
        ),
      ).toBe("23514");
    });
  });
});
