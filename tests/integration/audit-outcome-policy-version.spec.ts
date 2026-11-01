// V13-DB-020 · REQ-AUD-005: migration 0012, outcome and access-policy version on every audit record
// (design: docs/teams/db/DB-020_AUDIT_RECORD_CONTENT.md, accepted on #115). Proves:
//   - the new columns, constraints and register, and who can reach them (owner only);
//   - _append_audit writes hash version 2, outcome SUCCEEDED and the highest recorded policy version, never a caller's;
//   - the verifier checks each row by its own version and catches a rewritten outcome or policy version, a v1 row after
//     a v2 row, and a v1 row that claims an outcome or version its hash does not cover;
//   - the fingerprint guard (live _policy_fingerprint() = latest register row) fails when RLS is disabled, one privilege
//     is granted or one function body changes without a new row, and passes again once a row is recorded; changes
//     outside the access policy leave it alone, and session settings do not change it;
//   - on the hosted layout, a ledger written by 0000–0011 keeps every stored value byte-identical through 0012, still
//     verifies, and the first v2 row chains to the last v1 row.
// Every fault is planted in a transaction that is rolled back (the hosted-layout scratch database is rebuilt). SYNTHETIC
// DATA ONLY.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/lib/db/security-context";
import { buildHostedBundle } from "@/scripts/db/hosted-bundle.mjs";
import { listFiles, readMigrations, SEED_DIR } from "@/scripts/db/lib/migrations.mjs";
import { clusterAvailable, HOSTED_SIM_SUPERUSER_URL, PRIMARY_ADMIN_URL } from "./support/clusters";
import {
  adminClient,
  appClient,
  asOwner,
  asPersona,
  asRaw,
  claimsText,
  CORRELATION,
  PERSONA,
  WORKSPACE,
} from "./support/context";
import { client, resetHostedSim, run } from "./support/hosted-sim";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);
const hostedSim = await clusterAvailable("hosted-sim", HOSTED_SIM_SUPERUSER_URL);

async function migrated(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean }[]>`
      select exists (select 1 from cdf_notifications_v13.schema_migrations where version = '0012') as present`;
    return Boolean(row?.present);
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}
const present = await migrated();
if (available && !present)
  console.warn("[integration] skipping audit-outcome-policy-version: migration 0012 missing");

/** The guard, as the tests and post_apply_checks.sql state it: the live fingerprint equals the latest row's. */
const GUARD = `
  select coalesce((select pv.fingerprint from cdf_notifications_v13.policy_version pv
                    order by pv.version desc limit 1)
                  = cdf_notifications_v13._policy_fingerprint(), false) as ok`;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return String((error as { code?: unknown }).code ?? "UNKNOWN");
  }
}

/** Runs one statement inside a savepoint and returns its SQLSTATE ("OK" when it succeeds), keeping the transaction. */
async function codeIn(tx: Tx, statement: (sp: Tx) => Promise<unknown>): Promise<string> {
  let code = "OK";
  await (tx as unknown as postgres.TransactionSql)
    .savepoint(async (sp) => {
      await statement(sp as unknown as Tx);
      throw new SavepointRollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof SavepointRollback))
        code = String((error as { code?: unknown }).code ?? "UNKNOWN");
    });
  return code;
}
class SavepointRollback extends Error {}

type Verdict = { rows_checked: string; first_broken_seq: string | null; is_valid: boolean };
const verify = async (tx: Tx) =>
  (await tx<Verdict[]>`select * from cdf_notifications_v13.verify_audit_chain()`)[0]!;
const guard = async (tx: Tx) => (await tx.unsafe<{ ok: boolean }[]>(GUARD))[0]!.ok;

/** Appends one hash version 1 row after the last row, exactly as 0001's writer did (owner, rolled back by callers). */
async function insertV1Row(tx: Tx, outcome = "SUCCEEDED"): Promise<string> {
  const [row] = await tx<{ seq: string }[]>`
    with prev as (select a.row_hash from cdf_notifications_v13.audit_event a order by a.seq desc limit 1),
         s as (select pg_catalog.nextval(pg_catalog.pg_get_serial_sequence('cdf_notifications_v13.audit_event', 'seq'))
                        as seq, pg_catalog.clock_timestamp() as at)
    insert into cdf_notifications_v13.audit_event
      (seq, occurred_at, action, entity_type, metadata, prev_hash, hash_version, outcome, policy_version, row_hash)
    overriding system value
    select s.seq, s.at, 'TEST_DOWNGRADE', 'test', '{}'::jsonb, prev.row_hash, 1, ${outcome}, null,
           cdf_notifications_v13._audit_row_hash(s.seq, s.at, null, null, 'TEST_DOWNGRADE', 'test', null, null, null,
                                                 '{}'::jsonb, prev.row_hash)
      from s, prev
    returning seq::text as seq`;
  return row!.seq;
}

describe.skipIf(!present)("V13-DB-020 audit outcome and policy version (migration 0012)", () => {
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

  describe("schema", () => {
    it("audit_event gains hash_version (default 2), outcome (default SUCCEEDED) and policy_version", async () => {
      const rows = await admin<{ name: string; type: string; nullable: string; def: string | null }[]>`
        select column_name as name, data_type as type, is_nullable as nullable, column_default as def
          from information_schema.columns
         where table_schema = 'cdf_notifications_v13' and table_name = 'audit_event'
           and column_name in ('hash_version', 'outcome', 'policy_version')
         order by column_name collate "C"`;
      expect([...rows]).toEqual([
        { name: "hash_version", type: "smallint", nullable: "NO", def: "2" },
        { name: "outcome", type: "text", nullable: "NO", def: "'SUCCEEDED'::text" },
        { name: "policy_version", type: "text", nullable: "YES", def: null },
      ]);
    });

    it("the register holds V13-ACCESS-0012 to 0015, and the highest equals this server's live fingerprint", async () => {
      const rows = await asOwner(
        admin,
        (tx) =>
          tx<{ version: string; migration: string; fingerprint: string; live: string }[]>`
          select version, migration, fingerprint, cdf_notifications_v13._policy_fingerprint() as live
            from cdf_notifications_v13.policy_version order by version`,
      );
      // Each migration that changes access ends with its own row (DB-020 rule): 0012, 0013 (V13-DB-021), 0014
      // (V13-DB-022), then 0015 (V13-DB-023).
      expect(rows.map((r) => [r.version, r.migration])).toEqual([
        ["V13-ACCESS-0012", "0012"],
        ["V13-ACCESS-0013", "0013"],
        ["V13-ACCESS-0014", "0014"],
        ["V13-ACCESS-0015", "0015"],
      ]);
      for (const r of rows) expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      // The highest version wins: 0013, 0014 and 0015 each changed functions, so the earlier fingerprints are not live.
      expect(rows[3]!.fingerprint).toBe(rows[3]!.live);
      for (const r of rows.slice(0, 3)) expect(r.fingerprint).not.toBe(r.live);
      expect(await asOwner(admin, guard)).toBe(true);
    });

    it("every ledger row on this cluster is version 2 with the current policy version; REFUSED only for refusals", async () => {
      // db:reset applies every migration before the seeds, so every row carries the highest version (0015). REFUSED
      // rows come from refused commands of earlier suites (0013) and are always COMMAND_REFUSED.
      const rows = await asOwner(
        admin,
        (tx) =>
          tx<
            {
              hash_version: number;
              outcome: string;
              policy_version: string | null;
              refused: boolean;
              n: number;
            }[]
          >`
          select hash_version, outcome, policy_version, action = 'COMMAND_REFUSED' as refused, count(*)::int as n
            from cdf_notifications_v13.audit_event group by 1, 2, 3, 4 order by 2`,
      );
      expect(rows.map(({ n: _n, ...r }) => r)).toEqual(
        expect.arrayContaining([
          { hash_version: 2, outcome: "SUCCEEDED", policy_version: "V13-ACCESS-0015", refused: false },
        ]),
      );
      for (const { n: _n, ...r } of rows)
        expect([
          { hash_version: 2, outcome: "SUCCEEDED", policy_version: "V13-ACCESS-0015", refused: false },
          { hash_version: 2, outcome: "REFUSED", policy_version: "V13-ACCESS-0015", refused: true },
        ]).toContainEqual(r);
      expect(rows.find((r) => r.outcome === "SUCCEEDED")!.n).toBeGreaterThanOrEqual(2);
      expect((await asOwner(admin, verify)).is_valid).toBe(true);
    });

    it("the request role cannot read or write the register, nor run the new internal functions", async () => {
      const refused: ((tx: Tx) => Promise<unknown>)[] = [
        (tx) => tx`select count(*) from cdf_notifications_v13.policy_version`,
        (tx) => tx`insert into cdf_notifications_v13.policy_version (version, fingerprint, migration)
                   values ('V13-ACCESS-9999', repeat('0', 64), '9999')`,
        (tx) => tx`select cdf_notifications_v13._policy_fingerprint()`,
        (tx) => tx`select cdf_notifications_v13._acl_canonical(null)`,
        (
          tx,
        ) => tx`select cdf_notifications_v13._audit_row_hash_v2(1, now(), null, null, 'X', 'x', null, null, null,
                     'SUCCEEDED', 'V13-ACCESS-0012', '{}'::jsonb, repeat('0', 64))`,
      ];
      for (const query of refused)
        expect(await codeOf(asPersona(app, PERSONA.alpha, "SECRETARIAT", query))).toBe("42501");
    });

    it("the register is append-only even for the owner (V1403)", async () => {
      for (const statement of [
        "update cdf_notifications_v13.policy_version set fingerprint = repeat('0', 64)",
        "delete from cdf_notifications_v13.policy_version",
        // Truncated together with the ledger that references it, so only the trigger can refuse it.
        "truncate cdf_notifications_v13.policy_version, cdf_notifications_v13.audit_event",
      ])
        expect(await codeOf(asOwner(admin, (tx) => tx.unsafe(statement))), statement).toBe("V1403");
      // Alone, the ledger's foreign key already refuses it.
      expect(
        await codeOf(asOwner(admin, (tx) => tx.unsafe("truncate cdf_notifications_v13.policy_version"))),
      ).toBe("0A000");
    });

    it("the register refuses a malformed version or one that does not name its migration (23514)", async () => {
      const codes = await asOwner(admin, async (tx) => [
        await codeIn(
          tx,
          (sp) => sp`insert into cdf_notifications_v13.policy_version (version, fingerprint, migration)
                                     values ('V13-ACCESS-99', repeat('0', 64), '0099')`,
        ),
        await codeIn(
          tx,
          (sp) => sp`insert into cdf_notifications_v13.policy_version (version, fingerprint, migration)
                                     values ('V13-ACCESS-0099', repeat('0', 64), '0100')`,
        ),
        await codeIn(
          tx,
          (sp) => sp`insert into cdf_notifications_v13.policy_version (version, fingerprint, migration)
                                     values ('V13-ACCESS-0099', 'not-a-hash', '0099')`,
        ),
      ]);
      expect(codes).toEqual(["23514", "23514", "23514"]);
    });
  });

  describe("the writer", () => {
    it("writes version 2, SUCCEEDED and the policy version, with the claims' actor and correlation id", async () => {
      const row = await asRaw(
        admin,
        { claims: claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), mac: "valid" },
        async (tx) => {
          await tx.unsafe("reset role");
          await tx.unsafe("set local role cdf_v13_owner");
          const [appended] = await tx<{ id: string }[]>`
            select cdf_notifications_v13._append_audit('TEST_OUTCOME', 'test', null, null, '{"k":1}'::jsonb) as id`;
          const [r] = await tx<
            {
              hash_version: number;
              outcome: string;
              policy_version: string;
              actor_persona_id: string;
              correlation_id: string;
              ok: boolean;
            }[]
          >`
            select a.hash_version, a.outcome, a.policy_version, a.actor_persona_id, a.correlation_id,
                   a.row_hash = cdf_notifications_v13._audit_row_hash_v2(a.seq, a.occurred_at, a.actor_persona_id,
                     a.workspace_id, a.action, a.entity_type, a.entity_id, a.case_id, a.correlation_id, a.outcome,
                     a.policy_version, a.metadata, a.prev_hash) as ok
              from cdf_notifications_v13.audit_event a where a.id = ${appended!.id}`;
          return { ...r, chain: await verify(tx) };
        },
      );
      expect(row).toMatchObject({
        hash_version: 2,
        outcome: "SUCCEEDED",
        policy_version: "V13-ACCESS-0015",
        actor_persona_id: PERSONA.alpha,
        correlation_id: CORRELATION,
        ok: true,
      });
      expect(row.chain.is_valid).toBe(true);
    });

    it("has no argument for outcome or policy version (42883)", async () => {
      expect(
        await codeOf(
          asOwner(
            admin,
            (
              tx,
            ) => tx`select cdf_notifications_v13._append_audit('TEST_OUTCOME', 'test', null, null, '{}'::jsonb,
                       'REFUSED')`,
          ),
        ),
      ).toBe("42883");
    });

    it("takes the highest version, not the latest recorded_at", async () => {
      const versions = await asOwner(admin, async (tx) => {
        await tx`insert into cdf_notifications_v13.policy_version (version, fingerprint, migration, recorded_at)
                 values ('V13-ACCESS-0099', repeat('a', 64), '0099', '2000-01-01T00:00:00Z')`;
        await tx`insert into cdf_notifications_v13.policy_version (version, fingerprint, migration)
                 values ('V13-ACCESS-0005', repeat('b', 64), '0005')`;
        const [a] = await tx<{ id: string }[]>`
          select cdf_notifications_v13._append_audit('TEST_POLICY_VERSION', 'test', null, null) as id`;
        const [r] = await tx<{ policy_version: string }[]>`
          select policy_version from cdf_notifications_v13.audit_event where id = ${a!.id}`;
        return r!.policy_version;
      });
      expect(versions).toBe("V13-ACCESS-0099");
    });

    it("refuses to append when no policy version is recorded (V1501)", async () => {
      // The register is append-only and referenced by the ledger; only a superuser with triggers and foreign-key
      // checks switched off (replica mode) can empty it, here inside a transaction that is rolled back.
      let code = "OK";
      await admin
        .begin(async (tx) => {
          await tx.unsafe("set local session_replication_role = replica");
          await tx.unsafe("delete from cdf_notifications_v13.policy_version");
          await tx.unsafe("set local session_replication_role = origin");
          await tx.unsafe("set local role cdf_v13_owner");
          code = await codeIn(
            tx as unknown as Tx,
            (sp) => sp`select cdf_notifications_v13._append_audit('TEST_NO_POLICY', 'test', null, null)`,
          );
          throw new SavepointRollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof SavepointRollback)) throw error;
        });
      expect(code).toBe("V1501");
      expect(await asOwner(admin, guard)).toBe(true);
    });
  });

  describe("the constraints", () => {
    it("refuse a v1 row that claims an outcome or version, a v2 row without one, and an undecided outcome", async () => {
      const codes = await asOwner(admin, async (tx) => ({
        v1Refused: await codeIn(tx, (sp) => insertV1Row(sp, "REFUSED")),
        v1WithVersion: await codeIn(
          tx,
          (sp) => sp`insert into cdf_notifications_v13.audit_event
                       (action, entity_type, prev_hash, row_hash, hash_version, outcome, policy_version)
                     values ('TEST_X', 'test', repeat('0', 64), repeat('1', 64), 1, 'SUCCEEDED', 'V13-ACCESS-0012')`,
        ),
        v2WithoutVersion: await codeIn(
          tx,
          (sp) => sp`insert into cdf_notifications_v13.audit_event
                       (action, entity_type, prev_hash, row_hash, hash_version, outcome, policy_version)
                     values ('TEST_X', 'test', repeat('0', 64), repeat('1', 64), 2, 'SUCCEEDED', null)`,
        ),
        noChange: await codeIn(
          tx,
          (sp) => sp`insert into cdf_notifications_v13.audit_event
                       (action, entity_type, prev_hash, row_hash, hash_version, outcome, policy_version)
                     values ('TEST_X', 'test', repeat('0', 64), repeat('1', 64), 2, 'NO_CHANGE', 'V13-ACCESS-0012')`,
        ),
        unknownVersion: await codeIn(
          tx,
          (sp) => sp`insert into cdf_notifications_v13.audit_event
                       (action, entity_type, prev_hash, row_hash, hash_version, outcome, policy_version)
                     values ('TEST_X', 'test', repeat('0', 64), repeat('1', 64), 2, 'SUCCEEDED', 'V13-ACCESS-9999')`,
        ),
        version3: await codeIn(
          tx,
          (sp) => sp`insert into cdf_notifications_v13.audit_event
                       (action, entity_type, prev_hash, row_hash, hash_version, outcome, policy_version)
                     values ('TEST_X', 'test', repeat('0', 64), repeat('1', 64), 3, 'SUCCEEDED', 'V13-ACCESS-0012')`,
        ),
      }));
      expect(codes).toEqual({
        v1Refused: "23514",
        v1WithVersion: "23514",
        v2WithoutVersion: "23514",
        noChange: "23514",
        unknownVersion: "23503",
        version3: "23514",
      });
    });
  });

  describe("the verifier", () => {
    /**
     * Appends one SUCCEEDED row, rewrites one column of it (trigger switched off, rolled back) and returns [its seq,
     * the verdict]. Appending first keeps the target a SUCCEEDED v2 row whatever earlier suites left last (since 0013,
     * a refused command commits a REFUSED row).
     */
    const rewriteLast = (set: string, before?: string) =>
      asOwner(admin, async (tx) => {
        if (before) await tx.unsafe(before);
        await tx`select cdf_notifications_v13._append_audit('TEST_TAMPER', 'test', null, null)`;
        const [last] = await tx<{ seq: string }[]>`
          select max(seq)::text as seq from cdf_notifications_v13.audit_event`;
        await tx`alter table cdf_notifications_v13.audit_event disable trigger audit_event_no_update_delete`;
        await tx.unsafe(`update cdf_notifications_v13.audit_event set ${set} where seq = ${last!.seq}`);
        return [last!.seq, await verify(tx)] as const;
      });

    it("reports a v2 row whose outcome was rewritten", async () => {
      // The row-shape constraint (0013) is dropped too (rolled back), so only the hash can give the rewrite away.
      const [seq, verdict] = await rewriteLast(
        "outcome = 'REFUSED'",
        "alter table cdf_notifications_v13.audit_event drop constraint audit_event_refusal_shape_check",
      );
      expect(verdict).toMatchObject({ is_valid: false, first_broken_seq: seq });
    });

    it("reports a v2 row whose policy version was rewritten", async () => {
      // The appended row carries the current version (0015); 0012 is another recorded version.
      const [seq, verdict] = await rewriteLast("policy_version = 'V13-ACCESS-0012'");
      expect(verdict).toMatchObject({ is_valid: false, first_broken_seq: seq });
    });

    it("reports a v2 row relabelled as v1 (a downgrade that drops outcome and version from the hash)", async () => {
      const [seq, verdict] = await asOwner(admin, async (tx) => {
        await tx`select cdf_notifications_v13._append_audit('TEST_TAMPER', 'test', null, null)`;
        const [last] = await tx<{ seq: string }[]>`
          select max(seq)::text as seq from cdf_notifications_v13.audit_event`;
        await tx`alter table cdf_notifications_v13.audit_event disable trigger audit_event_no_update_delete`;
        // Recompute a valid v1 hash for the row, so only the version order can give it away.
        await tx`update cdf_notifications_v13.audit_event a
                    set hash_version = 1, policy_version = null,
                        row_hash = cdf_notifications_v13._audit_row_hash(a.seq, a.occurred_at, a.actor_persona_id,
                          a.workspace_id, a.action, a.entity_type, a.entity_id, a.case_id, a.correlation_id,
                          a.metadata, a.prev_hash)
                  where a.seq = ${last!.seq}::bigint`;
        return [last!.seq, await verify(tx)] as const;
      });
      expect(verdict).toMatchObject({ is_valid: false, first_broken_seq: seq });
    });

    it("reports a correctly hashed v1 row appended after v2 rows", async () => {
      const [seq, verdict] = await asOwner(admin, async (tx) => {
        const s = await insertV1Row(tx);
        return [s, await verify(tx)] as const;
      });
      expect(verdict).toMatchObject({ is_valid: false, first_broken_seq: seq });
      expect((await asOwner(admin, verify)).is_valid).toBe(true);
    });
  });

  describe("the fingerprint guard", () => {
    /** Applies a change as the owner (rolled back) and returns [guard after the change, guard once a row is recorded]. */
    const plant = (statement: string) =>
      asOwner(admin, async (tx) => {
        await tx.unsafe(statement);
        const changed = await guard(tx);
        await tx`insert into cdf_notifications_v13.policy_version (version, fingerprint, migration)
                 values ('V13-ACCESS-0099', cdf_notifications_v13._policy_fingerprint(), '0099')`;
        return [changed, await guard(tx)] as const;
      });

    it.each([
      ["RLS disabled on one table", "alter table cdf_notifications_v13.task disable row level security"],
      ["RLS forced on one table", "alter table cdf_notifications_v13.task force row level security"],
      ["one table privilege granted", "grant select on cdf_notifications_v13.task to cdf_v13_app"],
      ["one column privilege granted", "grant select (id) on cdf_notifications_v13.role to cdf_v13_app"],
      [
        "one function privilege granted",
        "grant execute on function cdf_notifications_v13._page_limit(integer) to cdf_v13_app",
      ],
      [
        "one function body changed",
        `create or replace function cdf_notifications_v13._page_limit(p_limit integer) returns integer
           language plpgsql immutable set search_path = '' as $fn$ begin return p_limit; end $fn$`,
      ],
      ["one policy dropped", "drop policy policy_version_deny_all on cdf_notifications_v13.policy_version"],
      [
        "an append-only trigger switched off",
        "alter table cdf_notifications_v13.audit_event disable trigger audit_event_no_update_delete",
      ],
      ["the schema's ACL changed", "grant usage on schema cdf_notifications_v13 to cdf_v13_app"],
    ])("fails when %s without a new row, and passes once one is recorded", async (_label, statement) => {
      expect(await plant(statement)).toEqual([false, true]);
    });

    it("ignores changes outside the access policy: a comment, an index, data", async () => {
      const ok = await asOwner(admin, async (tx) => {
        await tx`comment on table cdf_notifications_v13.task is 'TEST comment'`;
        await tx`create index task_test_idx on cdf_notifications_v13.task (status)`;
        await tx`select cdf_notifications_v13._append_audit('TEST_DATA', 'test', null, null)`;
        return guard(tx);
      });
      expect(ok).toBe(true);
    });

    it("is the same under other session settings (search_path, time zone, DateStyle)", async () => {
      const base = await asOwner(
        admin,
        async (tx) =>
          (await tx<{ f: string }[]>`select cdf_notifications_v13._policy_fingerprint() as f`)[0]!.f,
      );
      const other = await asOwner(admin, async (tx) => {
        await tx.unsafe("set local search_path = cdf_notifications_v13, public");
        await tx.unsafe("set local timezone = 'Pacific/Kiritimati'");
        await tx.unsafe("set local datestyle = 'SQL, DMY'");
        return (await tx<{ f: string }[]>`select cdf_notifications_v13._policy_fingerprint() as f`)[0]!.f;
      });
      expect(other).toBe(base);
    });
  });
});

describe.skipIf(!hostedSim)("V13-DB-020 rows written before 0012 verify unchanged (hosted layout)", () => {
  const BEFORE = readMigrations().filter((m) => m.version < "0012");
  type Stored = {
    seq: string;
    id: string;
    occurred_at: string;
    action: string;
    metadata: string;
    prev_hash: string;
    row_hash: string;
  };
  let adminUrl: string;
  let before: Stored[];

  /** Runs fn as cdf_v13_owner on the scratch database; commits unless it throws. */
  async function owner<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const sql = client(adminUrl);
    try {
      return (await sql.begin(async (tx) => {
        await tx.unsafe("set local role cdf_v13_owner");
        return fn(tx as unknown as Tx);
      })) as T;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
  const stored = (tx: Tx) =>
    tx<Stored[]>`
      select seq::text as seq, id::text as id, occurred_at::text as occurred_at, action, metadata::text as metadata,
             prev_hash, row_hash
        from cdf_notifications_v13.audit_event order by seq`;

  beforeAll(async () => {
    const sim = await resetHostedSim();
    adminUrl = sim.adminUrl;
    for (const m of BEFORE) await run(adminUrl, buildHostedBundle({ version: m.version }));
    // A ledger written by 0001's writer: both seeds, then rows with entity, case and metadata values.
    for (const file of listFiles(SEED_DIR)) {
      const text = readFileSync(join(SEED_DIR, file), "utf8");
      const sql = client(adminUrl);
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe("set local search_path = ''");
          await tx.unsafe(text);
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
    await owner(async (tx) => {
      await tx`select cdf_notifications_v13._append_audit('TEST_BEFORE_0012', 'case_record', c.id, c.id,
                                                          '{"code":"A","n":1}'::jsonb)
                 from (select id from cdf_notifications_v13.case_record order by id limit 2) c`;
    });
    before = await owner(stored);
  }, 180_000);

  it("the ledger before 0012 has rows of both seeds and other rows, and verifies", async () => {
    expect(before.map((r) => r.action)).toEqual(
      expect.arrayContaining(["SEED_M1_LOADED", "SEED_M1_CASES_LOADED", "TEST_BEFORE_0012"]),
    );
    expect(before.length).toBeGreaterThanOrEqual(4);
    expect((await owner(verify)).is_valid).toBe(true);
  });

  it("after 0012 (dry run, then apply) every stored value is byte-identical, every row is v1, and the chain verifies", async () => {
    expect(await owner(stored)).toEqual(before); // the dry run left nothing behind
    await run(adminUrl, buildHostedBundle({ version: "0012", dryRun: true }));
    await run(adminUrl, buildHostedBundle({ version: "0012" }));
    expect(await owner(stored)).toEqual(before);
    const meta = await owner(
      (tx) => tx<{ hash_version: number; outcome: string; policy_version: string | null; n: number }[]>`
        select hash_version, outcome, policy_version, count(*)::int as n
          from cdf_notifications_v13.audit_event group by 1, 2, 3`,
    );
    expect([...meta]).toEqual([
      { hash_version: 1, outcome: "SUCCEEDED", policy_version: null, n: before.length },
    ]);
    expect(await owner(verify)).toMatchObject({
      is_valid: true,
      first_broken_seq: null,
      rows_checked: String(before.length),
    });
  });

  it("this server recorded its own fingerprint, and the guard holds", async () => {
    expect(await owner(guard)).toBe(true);
  });

  it("the first v2 row chains to the last v1 row, and the whole chain verifies across the boundary", async () => {
    const appended = await owner(async (tx) => {
      const [a] = await tx<{ id: string }[]>`
        select cdf_notifications_v13._append_audit('TEST_AFTER_0012', 'test', null, null) as id`;
      const [r] = await tx<{ hash_version: number; policy_version: string; prev_hash: string }[]>`
        select hash_version, policy_version, prev_hash from cdf_notifications_v13.audit_event where id = ${a!.id}`;
      return r!;
    });
    expect(appended).toEqual({
      hash_version: 2,
      policy_version: "V13-ACCESS-0012",
      prev_hash: before.at(-1)!.row_hash,
    });
    expect(await owner(verify)).toMatchObject({
      is_valid: true,
      rows_checked: String(before.length + 1),
    });
  });
});
