// V13-SEC-002 · shared helpers for SEC's database adversarial suites (tests/security/db).
// The suites run in the Vitest "integration" project against the local cluster (pnpm db:local start && pnpm db:reset)
// and reuse the integration support (real withRequestContext, hand-built contexts, owner access). Everything a suite
// does as a persona or as the owner is rolled back; nothing here commits.
// SYNTHETIC DATA ONLY: the seeded personas, workspaces and CDF-DEMO-2026-0001…0010 cases.
import type postgres from "postgres";
import type { WorkspaceCode } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { clusterAvailable, errorCodeOf, PRIMARY_ADMIN_URL } from "../../integration/support/clusters";
import { readinessVerdict } from "./readiness";
import {
  adminClient,
  appClient,
  asPersona,
  asRaw,
  claimsText,
  CORRELATION,
  PERSONA,
  WORKSPACE,
} from "../../integration/support/context";

export const SCHEMA = "cdf_notifications_v13";
export const V13_ROLES = ["cdf_v13_owner", "cdf_v13_app", "cdf_v13_user"] as const;

export const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
export const TASK = (n: number) => `0d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
export const TEMPLATE_VERSION = (n: number) => `1f000000-0000-4000-8000-00000000000${n}`;
/** Not in the seed: the "unknown id" of every comparison. */
export const UNKNOWN_CASE = "0c000000-0000-4000-8000-0000000000ff";
export const UNKNOWN_TASK = "0d000000-0000-4000-8000-0000000000ff";
export const ALL_CASES = Array.from({ length: 10 }, (_, i) => CASE(i + 1));
export const RESTRICTED_CASE = CASE(9);
export const CLOSED_CASE = CASE(10);

/** Active personas that can be signed in (Zeta is inactive; it belongs to the hostile contexts). */
export const ACTIVE_PERSONAS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
export const WORKSPACES = Object.keys(WORKSPACE) as WorkspaceCode[];

/**
 * True when the cluster answers and migrations 0001–0006 plus the seed are present. Otherwise false locally (the suite
 * skips with a warning) and an error in CI, where test:db resets the database first (V13-SEC-010, readiness.ts).
 */
export async function databaseReady(label: string): Promise<boolean> {
  if (!(await clusterAvailable("primary", PRIMARY_ADMIN_URL)))
    return readinessVerdict(label, false, "the local cluster does not answer");
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean; cases: number }[]>`
      select pg_catalog.to_regprocedure('cdf_notifications_v13.case_tasks(uuid)') is not null as present,
             (select count(*)::int from cdf_notifications_v13.case_record) as cases`;
    const ok = Boolean(row?.present) && (row?.cases ?? 0) >= 10;
    return readinessVerdict(label, ok, "migration 0006 or the cases seed is missing");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("[security/db]")) throw error;
    return readinessVerdict(label, false, "schema not present");
  } finally {
    await admin.end({ timeout: 5 });
  }
}

export interface Outcome {
  ok: boolean;
  /** SQLSTATE when refused. */
  code?: string;
  /** Server message when refused (compared between unknown and unauthorised; never logged). */
  message?: string;
  rows?: Record<string, unknown>[];
}

/**
 * A command's answer as an outcome: since migration 0013 (V13-DB-021) the three request-time commands answer a
 * refusal in their `refusal` column (one row, every other column null) instead of raising it. Such a row is a refusal
 * with that code and no message (the database sends no text with it).
 */
function outcomeOfRows(rows: Record<string, unknown>[]): Outcome {
  if (rows.length === 1 && typeof rows[0]?.refusal === "string")
    return { ok: false, code: rows[0].refusal, rows };
  return { ok: true, rows };
}

/** Runs one statement in a savepoint, so a refusal does not abort the surrounding transaction. */
export async function attempt(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<Outcome> {
  try {
    const rows = (await tx.savepoint((sp) => fn(sp as unknown as Tx))) as Record<string, unknown>[];
    return outcomeOfRows(Array.isArray(rows) ? [...rows] : []);
  } catch (error) {
    return { ok: false, code: errorCodeOf(error), message: (error as Error).message };
  }
}

class SavepointRollback extends Error {
  constructor(readonly rows: Record<string, unknown>[]) {
    super("savepoint rollback");
  }
}

/**
 * As `attempt`, but the savepoint is always rolled back, so nothing the statement did survives it: a command's writes,
 * its REFUSED audit row, and its one-command-per-transaction mark (V13-DB-021 R1, an advisory lock released with the
 * savepoint). For sweeps that call several commands in one transaction.
 */
export async function attemptRolledBack(tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<Outcome> {
  try {
    await tx.savepoint(async (sp) => {
      const rows = (await fn(sp as unknown as Tx)) as Record<string, unknown>[];
      throw new SavepointRollback(Array.isArray(rows) ? [...rows] : []);
    });
    throw new Error("savepoint was not rolled back");
  } catch (error) {
    if (error instanceof SavepointRollback) return outcomeOfRows(error.rows);
    return { ok: false, code: errorCodeOf(error), message: (error as Error).message };
  }
}

/** Every relation in the V13 schema, discovered from the catalogue (new tables are swept automatically). */
export async function v13Tables(
  tx: Tx | postgres.Sql,
): Promise<{ name: string; caseColumn: string | null }[]> {
  const rows = await tx<{ name: string; case_column: string | null }[]>`
    select c.relname as name,
           case when c.relname = 'case_record' then 'id'
                when exists (select 1 from pg_catalog.pg_attribute a
                              where a.attrelid = c.oid and a.attname = 'case_id' and not a.attisdropped)
                then 'case_id' end as case_column
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${SCHEMA} and c.relkind in ('r', 'p', 'v', 'm', 'f')
     order by c.relname`;
  return rows.map((r) => ({ name: r.name, caseColumn: r.case_column }));
}

/** Every V13 function the request role may execute, as "name(identity args)". */
export async function executableFunctions(tx: Tx | postgres.Sql): Promise<string[]> {
  const rows = await tx<{ sig: string }[]>`
    select p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as sig
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = ${SCHEMA}
       and pg_catalog.has_function_privilege('cdf_v13_user', p.oid, 'EXECUTE')
     order by 1`;
  return rows.map((r) => r.sig);
}

/**
 * The expected set of accessible cases for a persona in a workspace, derived independently of can_access_case from
 * the raw rows (as the administrator): active persona, live membership of an active workspace, a visibility row for
 * that workspace, and for a restricted case a live assignment. A regression in the database rule shows up as a
 * difference from this oracle.
 */
export async function expectedAccess(
  admin: postgres.Sql,
  persona: string,
  workspace: string,
): Promise<Set<string>> {
  const rows = await admin<{ id: string }[]>`
    select c.id
      from cdf_notifications_v13.case_record c
      join cdf_notifications_v13.case_workspace_visibility v on v.case_id = c.id and v.workspace_id = ${workspace}
      join cdf_notifications_v13.workspace w on w.id = v.workspace_id and w.is_active
      join cdf_notifications_v13.persona p on p.id = ${persona} and p.is_active
     where exists (select 1 from cdf_notifications_v13.persona_workspace_membership m
                    where m.persona_id = p.id and m.workspace_id = w.id
                      and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()))
       and (not c.is_restricted
            or exists (select 1 from cdf_notifications_v13.case_assignment a
                        where a.case_id = c.id and a.persona_id = p.id
                          and a.valid_from <= now() and (a.valid_to is null or a.valid_to > now())))`;
  return new Set(rows.map((r) => r.id));
}

export interface HostileContext {
  label: string;
  /**
   * True when the persona itself is verified and active but the workspace is not usable (SEC-DB-06): the persona may
   * still read its own identity rows and switch to a workspace it belongs to, and nothing else.
   */
  personaOnly?: boolean;
  run: <T>(sql: postgres.Sql, fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

const valid = claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT);

/**
 * Contexts that must all be "nobody" (SEC-DB-01, -02, -03, -06): no claims, malformed or incomplete claims, a forged
 * or replayed MAC, a persona that is unknown or inactive, a workspace the persona is not a member of, and a valid
 * context rewritten inside its own transaction.
 */
export const HOSTILE_CONTEXTS: HostileContext[] = [
  { label: "no claims, no MAC", run: (sql, fn) => asRaw(sql, {}, fn) },
  {
    label: "empty claims, valid MAC over them",
    run: (sql, fn) => asRaw(sql, { claims: "", mac: "valid" }, fn),
  },
  { label: "claims {}, valid MAC", run: (sql, fn) => asRaw(sql, { claims: "{}", mac: "valid" }, fn) },
  {
    label: "malformed JSON, valid MAC",
    run: (sql, fn) => asRaw(sql, { claims: valid.slice(0, -2), mac: "valid" }, fn),
  },
  {
    label: "missing workspace_id, valid MAC",
    run: (sql, fn) =>
      asRaw(sql, { claims: JSON.stringify({ v: 1, persona_id: PERSONA.alpha }), mac: "valid" }, fn),
  },
  {
    label: "version 2, valid MAC",
    run: (sql, fn) => asRaw(sql, { claims: valid.replace('"v":1', '"v":2'), mac: "valid" }, fn),
  },
  {
    label: "array claims, valid MAC",
    run: (sql, fn) => asRaw(sql, { claims: `[${valid}]`, mac: "valid" }, fn),
  },
  { label: "valid claims, no MAC", run: (sql, fn) => asRaw(sql, { claims: valid }, fn) },
  { label: "valid claims, empty MAC", run: (sql, fn) => asRaw(sql, { claims: valid, mac: "" }, fn) },
  {
    label: "valid claims, MAC of other claims",
    run: (sql, fn) =>
      asRaw(
        sql,
        { claims: valid, mac: "valid", macOver: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS) },
        fn,
      ),
  },
  {
    label: "valid claims, MAC replayed from another transaction",
    run: (sql, fn) => asRaw(sql, { claims: valid, mac: "valid", macXid: "1" }, fn),
  },
  {
    label: "unknown persona, valid MAC",
    run: (sql, fn) =>
      asRaw(sql, { claims: claimsText(PERSONA.unknown, WORKSPACE.SECRETARIAT), mac: "valid" }, fn),
  },
  {
    label: "inactive persona Zeta, valid MAC",
    run: (sql, fn) =>
      asRaw(sql, { claims: claimsText(PERSONA.zeta, WORKSPACE.SECRETARIAT), mac: "valid" }, fn),
  },
  {
    label: "Alpha in a workspace it is not a member of (Investigations), valid MAC",
    personaOnly: true,
    run: (sql, fn) =>
      asRaw(sql, { claims: claimsText(PERSONA.alpha, WORKSPACE.INVESTIGATIONS), mac: "valid" }, fn),
  },
  {
    label: "Alpha in an unknown workspace id, valid MAC",
    personaOnly: true,
    run: (sql, fn) =>
      asRaw(
        sql,
        { claims: claimsText(PERSONA.alpha, "0a000000-0000-4000-8000-0000000000ff"), mac: "valid" },
        fn,
      ),
  },
  {
    label: "valid Alpha context, claims rewritten to Beta inside the transaction",
    run: (sql, fn) =>
      asRaw(sql, { claims: valid, mac: "valid" }, async (tx) => {
        await tx`select pg_catalog.set_config('request.v13.claims', ${claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS)}, true)`;
        return fn(tx);
      }),
  },
];

/** Installs the test claims key (first writer wins) so hand-built contexts with a "valid" MAC verify. */
export async function installTestKey(sql: postgres.Sql): Promise<void> {
  await asPersona(sql, PERSONA.alpha, "SECRETARIAT", async (tx) => tx`select 1`);
}

export { adminClient, appClient, asPersona, asRaw, claimsText, CORRELATION, PERSONA, WORKSPACE };
