// Isolation probe behind GET /api/health/isolation (enabled only with V13_ISOLATION_PROBE=enabled).
//
// Runs as the app login (session user cdf_v13_app) in ONE transaction that always ends in ROLLBACK. A single
// static PL/pgSQL block tries, each attempt in its own subtransaction (BEGIN … EXCEPTION):
//   1. set_role       SET LOCAL ROLE to every other role in pg_roles; only cdf_v13_user may succeed.
//   2. foreign_select SELECT … LIMIT 0 from every relation outside cdf_notifications_v13 and the system schemas,
//                     as cdf_v13_app and then as cdf_v13_user; none may succeed.
//   3. foreign_create CREATE SCHEMA v13_isolation_probe and CREATE TABLE public.v13_isolation_probe, as cdf_v13_app
//                     and as cdf_v13_user; none may succeed (a success is rolled back at once).
//   4. own_schema     as cdf_v13_user, USAGE on cdf_notifications_v13 must be granted.
// Object names come from the catalogs and are quoted with format('%I'); there is no input of any kind. Only counts
// leave the database: never object names, row data or error text. SQLSTATE 42501 counts as refused; any other
// error counts as inconclusive, which fails the verdict (fail closed).
import "server-only";
import { z } from "zod";
import type postgres from "postgres";
import { getSql, type Sql } from "./client";

type Tx = postgres.TransactionSql;

/**
 * Runs the probe block inside the caller's transaction. A static tagged template without interpolations: no input of
 * any kind reaches the SQL text (raw SQL through `unsafe` is forbidden in app code, SEC finding TM-S4).
 */
async function executeProbeBlock(tx: Tx): Promise<void> {
  await tx`
do $v13_isolation_probe$
declare
  role_name text;
  rel record;
  as_user boolean;
  v_session_ok boolean := (session_user = 'cdf_v13_app' and current_user = 'cdf_v13_app');
  v_set_refused integer := 0;
  v_set_allowed integer := 0;
  v_set_unexpected integer := 0;
  v_set_user_allowed boolean := false;
  v_set_inconclusive integer := 0;
  v_app_refused integer := 0;
  v_app_allowed integer := 0;
  v_app_inconclusive integer := 0;
  v_user_refused integer := 0;
  v_user_allowed integer := 0;
  v_user_inconclusive integer := 0;
  v_create_refused integer := 0;
  v_create_allowed integer := 0;
  v_create_inconclusive integer := 0;
  v_usage boolean := false;
begin
  -- 1. set_role (from the login role)
  for role_name in
    select r.rolname from pg_catalog.pg_roles r where r.rolname <> current_user order by r.rolname
  loop
    begin
      execute pg_catalog.format('set local role %I', role_name);
      v_set_allowed := v_set_allowed + 1;
      if role_name = 'cdf_v13_user' then
        v_set_user_allowed := true;
      else
        v_set_unexpected := v_set_unexpected + 1;
      end if;
      reset role;
    exception
      when insufficient_privilege then v_set_refused := v_set_refused + 1;
      when others then v_set_inconclusive := v_set_inconclusive + 1;
    end;
  end loop;

  -- 2 and 3, first as the login role, then as the request role.
  for pass_no in 1..2 loop
    as_user := (pass_no = 2);
    if as_user then
      begin
        set local role cdf_v13_user;
      exception
        when others then
          v_user_inconclusive := v_user_inconclusive + 1;
          exit;
      end;
    end if;

    for rel in
      select n.nspname, c.relname
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p', 'v', 'm', 'f')
         and n.nspname not in ('cdf_notifications_v13', 'pg_catalog', 'information_schema')
         and n.nspname !~ '^pg_(toast|temp)'
       order by n.nspname, c.relname
    loop
      begin
        execute pg_catalog.format('select 1 from %I.%I limit 0', rel.nspname, rel.relname);
        if as_user then v_user_allowed := v_user_allowed + 1; else v_app_allowed := v_app_allowed + 1; end if;
      exception
        when insufficient_privilege then
          if as_user then v_user_refused := v_user_refused + 1; else v_app_refused := v_app_refused + 1; end if;
        when others then
          if as_user then v_user_inconclusive := v_user_inconclusive + 1;
          else v_app_inconclusive := v_app_inconclusive + 1; end if;
      end;
    end loop;

    begin
      create schema v13_isolation_probe;
      v_create_allowed := v_create_allowed + 1;
      raise exception using errcode = 'V13P1';
    exception
      when sqlstate 'V13P1' then null;
      when insufficient_privilege then v_create_refused := v_create_refused + 1;
      when others then v_create_inconclusive := v_create_inconclusive + 1;
    end;

    begin
      create table public.v13_isolation_probe (x integer);
      v_create_allowed := v_create_allowed + 1;
      raise exception using errcode = 'V13P1';
    exception
      when sqlstate 'V13P1' then null;
      when insufficient_privilege then v_create_refused := v_create_refused + 1;
      when others then v_create_inconclusive := v_create_inconclusive + 1;
    end;

    if as_user then
      -- 4. own_schema
      v_usage := coalesce(
        pg_catalog.has_schema_privilege(pg_catalog.to_regnamespace('cdf_notifications_v13')::oid, 'USAGE'),
        false);
      reset role;
    end if;
  end loop;

  perform pg_catalog.set_config('v13.isolation_probe', pg_catalog.json_build_object(
    'session_user_ok', v_session_ok,
    'set_role', pg_catalog.json_build_object(
      'refused', v_set_refused, 'allowed', v_set_allowed, 'unexpected', v_set_unexpected,
      'user_allowed', v_set_user_allowed, 'inconclusive', v_set_inconclusive),
    'foreign_select', pg_catalog.json_build_object(
      'app', pg_catalog.json_build_object(
        'refused', v_app_refused, 'allowed', v_app_allowed, 'inconclusive', v_app_inconclusive),
      'user', pg_catalog.json_build_object(
        'refused', v_user_refused, 'allowed', v_user_allowed, 'inconclusive', v_user_inconclusive)),
    'foreign_create', pg_catalog.json_build_object(
      'refused', v_create_refused, 'allowed', v_create_allowed, 'inconclusive', v_create_inconclusive),
    'own_schema', pg_catalog.json_build_object('usage', v_usage)
  )::text, true);
end
$v13_isolation_probe$`;
}

const count = z.number().int().nonnegative();
const tally = z.strictObject({ refused: count, allowed: count, inconclusive: count });

export const IsolationProbeCountsSchema = z.strictObject({
  session_user_ok: z.boolean(),
  set_role: z.strictObject({
    refused: count,
    allowed: count,
    unexpected: count,
    user_allowed: z.boolean(),
    inconclusive: count,
  }),
  foreign_select: z.strictObject({ app: tally, user: tally }),
  foreign_create: tally,
  own_schema: z.strictObject({ usage: z.boolean() }),
});
export type IsolationProbeCounts = z.infer<typeof IsolationProbeCountsSchema>;

class ProbeRollback extends Error {}

/** Runs the probe; the transaction is always rolled back. Throws on connection or SQL failure. */
export async function runIsolationProbe(sql: Sql = getSql()): Promise<IsolationProbeCounts> {
  let raw: string | null = null;
  try {
    await sql.begin(async (tx) => {
      await executeProbeBlock(tx);
      const [row] = await tx<{ result: string | null }[]>`
        select pg_catalog.current_setting('v13.isolation_probe', true) as result`;
      raw = row?.result ?? null;
      throw new ProbeRollback();
    });
  } catch (error) {
    if (!(error instanceof ProbeRollback)) throw error;
  }
  if (raw === null) throw new Error("isolation probe produced no result");
  return IsolationProbeCountsSchema.parse(JSON.parse(raw));
}

export interface IsolationChecks {
  login: { session_user_ok: boolean };
  set_role: { refused: number; allowed: number; allowed_targets_ok: boolean; inconclusive: number };
  foreign_select: {
    app: { refused: number; allowed: number; inconclusive: number };
    user: { refused: number; allowed: number; inconclusive: number };
  };
  foreign_create: { refused: number; allowed: number; inconclusive: number };
  own_schema: { usage: boolean };
}

/** Shapes the counts for the response: the only allowed SET ROLE target must be cdf_v13_user. */
export function isolationChecks(counts: IsolationProbeCounts): IsolationChecks {
  const { set_role } = counts;
  return {
    login: { session_user_ok: counts.session_user_ok },
    set_role: {
      refused: set_role.refused,
      allowed: set_role.allowed,
      allowed_targets_ok: set_role.allowed === 1 && set_role.user_allowed && set_role.unexpected === 0,
      inconclusive: set_role.inconclusive,
    },
    foreign_select: { app: { ...counts.foreign_select.app }, user: { ...counts.foreign_select.user } },
    foreign_create: { ...counts.foreign_create },
    own_schema: { usage: counts.own_schema.usage },
  };
}

/** PASS only when every check holds and nothing was inconclusive. */
export function isolationVerdict(checks: IsolationChecks): "PASS" | "FAIL" {
  const clean = (t: { allowed: number; inconclusive: number }) => t.allowed === 0 && t.inconclusive === 0;
  return checks.login.session_user_ok &&
    checks.set_role.allowed_targets_ok &&
    checks.set_role.inconclusive === 0 &&
    clean(checks.foreign_select.app) &&
    clean(checks.foreign_select.user) &&
    clean(checks.foreign_create) &&
    checks.own_schema.usage
    ? "PASS"
    : "FAIL";
}
