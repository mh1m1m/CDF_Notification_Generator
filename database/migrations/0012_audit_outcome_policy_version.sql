-- 0012_audit_outcome_policy_version — V13-DB-020 (REQ-AUD-005): every audit record carries its outcome and the access
-- policy version the database enforced. Design accepted by the Chief Architect: docs/teams/db/DB-020_AUDIT_RECORD_CONTENT.md
-- (PR #115, REVIEW: ACCEPT c35d6c1).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- policy_version         append-only register of access-policy versions: V13-ACCESS-<migration>, with the
--                        fingerprint of the access policy that migration left (computed on this server, never a literal)
-- _acl_canonical         internal: one ACL as sorted text (grantee=privilege, * when grantable)
-- _policy_fingerprint    internal: sha256 of the V13 access policy (see its comment for what it covers)
-- audit_event            + hash_version, outcome, policy_version (constant defaults: catalogue-only, no row rewritten)
-- _audit_row_hash_v2     internal: hash version 2 = 'v2' | v1 fields | outcome | policy_version, in the v1 order
-- _append_audit          same signature; writes hash version 2, outcome SUCCEEDED and the latest policy version
-- verify_audit_chain     same signature and result; checks each row with the formula of its hash version and refuses a
--                        version that goes down along seq
--
-- Rows written before this migration keep hash version 1 and verify unchanged: their row_hash, prev_hash and every
-- other stored value stay byte-identical; a check constraint pins what a v1 row means (SUCCEEDED, no policy version).
-- No caller passes the outcome or the policy version: _append_audit chooses both inside the chain lock. Refusals
-- (outcome REFUSED) are recorded by V13-DB-021, which has its own design note and threat review; nothing writes
-- REFUSED yet. No api_* command, grant or RLS policy of an existing object changes.
--
-- Every later migration that changes the access policy (a policy, RLS flag, ACL or function in this schema) must insert
-- its own policy_version row as its last statement; the fingerprint guard (tests, post_apply_checks.sql) fails until it
-- does.
-- PRODUCTION_SUBSTITUTION_REQUIRED: the production ledger is CDF SLS/SIEM, with policy versions from CDF's policy
-- management.

set local role cdf_v13_owner;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Access-policy version register.
-- ---------------------------------------------------------------------------------------------------------------------
create table cdf_notifications_v13.policy_version (
  version      text        primary key check (version ~ '^V13-ACCESS-[0-9]{4}$'),
  fingerprint  text        not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  migration    text        not null check (migration ~ '^[0-9]{4}$'),
  recorded_at  timestamptz not null default clock_timestamp(),
  constraint policy_version_names_its_migration check (version = 'V13-ACCESS-' || migration)
);
comment on table cdf_notifications_v13.policy_version is 'Append-only register of V13 access-policy versions (REQ-AUD-005). One row per migration that changes the access policy; fingerprint = _policy_fingerprint() on the server that applied it. The latest version is the highest version, never the latest recorded_at. Owner only.';

alter table cdf_notifications_v13.policy_version enable row level security;
-- Owner only, like the ledger: no grant, and a restrictive deny-all keeps the intent explicit.
create policy policy_version_deny_all on cdf_notifications_v13.policy_version
  as restrictive for all to public using (false) with check (false);

create trigger policy_version_no_update_delete
  before update or delete on cdf_notifications_v13.policy_version
  for each row execute function cdf_notifications_v13._reject_mutation();
create trigger policy_version_no_truncate
  before truncate on cdf_notifications_v13.policy_version
  for each statement execute function cdf_notifications_v13._reject_mutation();

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. The access-policy fingerprint.
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13._acl_canonical(p_acl aclitem[])
returns text
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(pg_catalog.string_agg(x.entry, ',' order by x.entry collate "C"), '')
    from (select (case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end)
                 || '=' || a.privilege_type || (case when a.is_grantable then '*' else '' end) as entry
            from pg_catalog.aclexplode(p_acl) a) x
$fn$;
comment on function cdf_notifications_v13._acl_canonical(aclitem[]) is 'Internal: an ACL as sorted text (grantee=privilege, * when grantable); grantor and entry order ignored. Owner only.';

-- Reads the catalogue of cdf_notifications_v13 only (ADR-012: the hosted database is shared). Every part is ordered by
-- its schema-qualified name (functions by oid::regprocedure::text, so overloads sort deterministically), with collation
-- "C". A NULL ACL is read as its built-in default, so an implicit PUBLIC grant is visible.
create function cdf_notifications_v13._policy_fingerprint()
returns text
language sql
stable
security invoker
set search_path = ''
as $fn$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           coalesce(pg_catalog.string_agg(p.section || '|' || p.name || '|' || p.body, E'\n'
                                          order by p.section collate "C", p.name collate "C"), ''),
           'UTF8')), 'hex')
    from (
      -- the schema's ACL
      select '1 schema' as section, n.nspname::text as name,
             cdf_notifications_v13._acl_canonical(coalesce(n.nspacl, pg_catalog.acldefault('n'::"char", n.nspowner)))
               as body
        from pg_catalog.pg_namespace n
       where n.nspname = 'cdf_notifications_v13'
      union all
      -- every table, view and sequence: kind, RLS enabled, RLS forced, ACL
      select '2 relation', n.nspname || '.' || c.relname,
             c.relkind::text || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text || '|'
               || cdf_notifications_v13._acl_canonical(coalesce(c.relacl,
                    pg_catalog.acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner)))
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'cdf_notifications_v13' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      union all
      -- column privileges, where any exist
      select '3 column', n.nspname || '.' || c.relname || '.' || a.attname,
             cdf_notifications_v13._acl_canonical(a.attacl)
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_class c on c.oid = a.attrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'cdf_notifications_v13' and a.attacl is not null and not a.attisdropped
      union all
      -- every RLS policy: command, permissive or restrictive, roles, USING, WITH CHECK
      select '4 policy', n.nspname || '.' || c.relname || '.' || pol.polname,
             pol.polcmd::text || '|' || (case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end) || '|'
               || coalesce((select pg_catalog.string_agg(r.name, ',' order by r.name collate "C")
                              from (select (case when x.oid = 0 then 'PUBLIC'
                                                 else pg_catalog.pg_get_userbyid(x.oid)::text end) as name
                                      from pg_catalog.unnest(pol.polroles) as x (oid)) r), '') || '|'
               || coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '-') || '|'
               || coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '-')
        from pg_catalog.pg_policy pol
        join pg_catalog.pg_class c on c.oid = pol.polrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'cdf_notifications_v13'
      union all
      -- user triggers and whether they fire (the append-only guards are access rules)
      select '5 trigger', n.nspname || '.' || c.relname || '.' || t.tgname,
             t.tgenabled::text || '|' || pg_catalog.pg_get_triggerdef(t.oid)
        from pg_catalog.pg_trigger t
        join pg_catalog.pg_class c on c.oid = t.tgrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'cdf_notifications_v13' and not t.tgisinternal
      union all
      -- every function: full definition (body, SECURITY DEFINER, search_path, volatility) and ACL
      select '6 function', f.oid::pg_catalog.regprocedure::text,
             (case when f.prokind in ('f', 'p') then pg_catalog.pg_get_functiondef(f.oid) else f.prokind::text end)
               || '|' || cdf_notifications_v13._acl_canonical(coalesce(f.proacl,
                           pg_catalog.acldefault('f'::"char", f.proowner)))
        from pg_catalog.pg_proc f
        join pg_catalog.pg_namespace n on n.oid = f.pronamespace
       where n.nspname = 'cdf_notifications_v13'
    ) p
$fn$;
comment on function cdf_notifications_v13._policy_fingerprint() is 'Internal: sha256 of the V13 access policy on this server: schema ACL; every table, view and sequence (kind, RLS enabled and forced, ACL); column ACLs; every policy (command, permissive or restrictive, roles, USING, WITH CHECK); user triggers and their enabled state; every function definition and ACL. Schema cdf_notifications_v13 only. Owner only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Audit record content. Constant defaults: PostgreSQL stores them in the catalogue, so no existing row is rewritten,
--    no UPDATE runs and the append-only trigger never fires. The checks are validated against existing rows (they hold
--    the defaults).
-- ---------------------------------------------------------------------------------------------------------------------
alter table cdf_notifications_v13.audit_event add column hash_version smallint not null default 1;
alter table cdf_notifications_v13.audit_event add column outcome text not null default 'SUCCEEDED';
alter table cdf_notifications_v13.audit_event add column policy_version text;

-- Only decided outcomes; another value is a one-line migration when a writer needs it.
alter table cdf_notifications_v13.audit_event
  add constraint audit_event_outcome_check check (outcome in ('SUCCEEDED', 'REFUSED'));
-- What each hash version covers: a v1 row can never carry an outcome or policy version its hash does not cover.
alter table cdf_notifications_v13.audit_event
  add constraint audit_event_hash_version_check check (
    (hash_version = 1 and outcome = 'SUCCEEDED' and policy_version is null)
    or (hash_version = 2 and policy_version is not null));
-- Every v2 row names a recorded version. Accepted without an index (fk-index-coverage): policy_version rows are never
-- deleted or re-keyed (append-only, no application grant), and the ledger is read only by the verifier.
alter table cdf_notifications_v13.audit_event
  add constraint audit_event_policy_version_fk foreign key (policy_version)
  references cdf_notifications_v13.policy_version (version);

-- Every row from now on is version 2 (_append_audit also sets it explicitly).
alter table cdf_notifications_v13.audit_event alter column hash_version set default 2;

comment on column cdf_notifications_v13.audit_event.hash_version is 'Which row_hash formula covers the row: 1 = rows written before 0012 (no outcome or policy version), 2 = _audit_row_hash_v2. Never decreases along seq.';
comment on column cdf_notifications_v13.audit_event.outcome is 'SUCCEEDED for a committed command; REFUSED is reserved for V13-DB-021. Set by _append_audit, never by a caller.';
comment on column cdf_notifications_v13.audit_event.policy_version is 'The access-policy version in force when the row was written (highest policy_version.version). NULL only on hash version 1 rows.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Hash version 2. The leading 'v2' separates the two formulas: no v1 input string equals a v2 one.
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13._audit_row_hash_v2(
  p_seq bigint, p_occurred_at timestamptz, p_actor uuid, p_workspace uuid, p_action text, p_entity_type text,
  p_entity_id uuid, p_case_id uuid, p_correlation_id uuid, p_outcome text, p_policy_version text, p_metadata jsonb,
  p_prev_hash text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $fn$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.concat_ws('|',
           'v2',
           p_seq::text,
           pg_catalog.to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           coalesce(p_actor::text, '-'),
           coalesce(p_workspace::text, '-'),
           p_action,
           p_entity_type,
           coalesce(p_entity_id::text, '-'),
           coalesce(p_case_id::text, '-'),
           coalesce(p_correlation_id::text, '-'),
           coalesce(p_outcome, '-'),
           coalesce(p_policy_version, '-'),
           p_metadata::text,
           p_prev_hash), 'UTF8')), 'hex')
$fn$;
comment on function cdf_notifications_v13._audit_row_hash_v2(bigint, timestamptz, uuid, uuid, text, text, uuid, uuid, uuid, text, text, jsonb, text) is 'Internal: canonical sha256 of a hash version 2 audit row: ''v2'', the version 1 fields in their order, then outcome and policy version before metadata and prev_hash. Timezone-independent.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The writer: same signature; outcome and policy version chosen here, inside the chain lock.
-- ---------------------------------------------------------------------------------------------------------------------
drop function cdf_notifications_v13._append_audit(text, text, uuid, uuid, jsonb);

create function cdf_notifications_v13._append_audit(
  p_action text, p_entity_type text, p_entity_id uuid, p_case_id uuid, p_metadata jsonb default '{}'::jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_prev    text;
  v_id      uuid := gen_random_uuid();
  v_seq     bigint;
  v_at      timestamptz := clock_timestamp();
  v_actor   uuid := cdf_notifications_v13.current_persona_id();
  v_ws      uuid := cdf_notifications_v13.current_workspace_id();
  v_meta    jsonb := coalesce(p_metadata, '{}'::jsonb);
  -- Always the verified claims' correlation id: a caller cannot label an audit row with another request's id.
  v_corr    uuid := cdf_notifications_v13.current_correlation_id();
  -- A committed command. REFUSED rows come only from V13-DB-021's own path.
  v_outcome text := 'SUCCEEDED';
  v_policy  text;
begin
  -- The chain reads the latest committed row; that needs a fresh snapshot per statement.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'audit append requires READ COMMITTED' using errcode = 'V1500';
  end if;
  -- V13 lock namespace only (CLAUDE.md §2); held until commit, so appends are strictly ordered.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'), 1);

  -- The access policy in force: the highest version (fixed four digits, so text order is number order).
  select pv.version into v_policy
    from cdf_notifications_v13.policy_version pv
   order by pv.version desc
   limit 1;
  if v_policy is null then
    raise exception 'no access policy version recorded' using errcode = 'V1501';
  end if;

  select a.row_hash into v_prev
    from cdf_notifications_v13.audit_event a
   order by a.seq desc
   limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));

  v_seq := pg_catalog.nextval(pg_catalog.pg_get_serial_sequence('cdf_notifications_v13.audit_event', 'seq'));

  insert into cdf_notifications_v13.audit_event
    (id, seq, occurred_at, actor_persona_id, workspace_id, action, entity_type, entity_id, case_id, correlation_id,
     metadata, prev_hash, hash_version, outcome, policy_version, row_hash)
  overriding system value
  values
    (v_id, v_seq, v_at, v_actor, v_ws, p_action, p_entity_type, p_entity_id, p_case_id, v_corr,
     v_meta, v_prev, 2, v_outcome, v_policy,
     cdf_notifications_v13._audit_row_hash_v2(v_seq, v_at, v_actor, v_ws, p_action, p_entity_type, p_entity_id,
                                              p_case_id, v_corr, v_outcome, v_policy, v_meta, v_prev));
  return v_id;
end
$fn$;
comment on function cdf_notifications_v13._append_audit(text, text, uuid, uuid, jsonb) is 'Internal: appends one hash-chained audit row (hash version 2) in the caller''s transaction; correlation id from the verified claims only; outcome SUCCEEDED and the highest recorded access-policy version, never from a caller. Callable only by cdf_v13_owner (commands).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. The verifier: same signature and result (counts and the first broken sequence number only).
-- ---------------------------------------------------------------------------------------------------------------------
drop function cdf_notifications_v13.verify_audit_chain();

create function cdf_notifications_v13.verify_audit_chain()
returns table (rows_checked bigint, first_broken_seq bigint, is_valid boolean)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  r          record;
  v_prev     text := repeat('0', 64);
  v_n        bigint := 0;
  v_version  smallint := 1;
  v_hash     text;
begin
  for r in select * from cdf_notifications_v13.audit_event order by seq loop
    v_n := v_n + 1;
    v_hash := case r.hash_version
      -- Version 1 covers no outcome or policy version, so it holds only with the values it implies.
      when 1 then case when r.outcome = 'SUCCEEDED' and r.policy_version is null
                       then cdf_notifications_v13._audit_row_hash(r.seq, r.occurred_at, r.actor_persona_id,
                              r.workspace_id, r.action, r.entity_type, r.entity_id, r.case_id, r.correlation_id,
                              r.metadata, r.prev_hash) end
      when 2 then cdf_notifications_v13._audit_row_hash_v2(r.seq, r.occurred_at, r.actor_persona_id,
                    r.workspace_id, r.action, r.entity_type, r.entity_id, r.case_id, r.correlation_id, r.outcome,
                    r.policy_version, r.metadata, r.prev_hash)
    end;
    -- A version that goes down along seq would drop the outcome and policy version from the hash.
    if r.hash_version < v_version or r.prev_hash <> v_prev or v_hash is null or r.row_hash <> v_hash then
      rows_checked := v_n; first_broken_seq := r.seq; is_valid := false;
      return next; return;
    end if;
    v_version := r.hash_version;
    v_prev := r.row_hash;
  end loop;
  rows_checked := v_n; first_broken_seq := null; is_valid := true;
  return next;
end
$fn$;
comment on function cdf_notifications_v13.verify_audit_chain() is 'Recomputes the audit hash chain, each row with the formula of its hash version (1 or 2); fails when the version goes down along seq. Owner and administrator only (migrations, CI, hosted checks); not granted to cdf_v13_user. Returns counts only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. The first access-policy version: the policy as this migration leaves it, fingerprinted on this server. Last
--    statement, so nothing after it changes the policy.
-- ---------------------------------------------------------------------------------------------------------------------
insert into cdf_notifications_v13.policy_version (version, fingerprint, migration)
values ('V13-ACCESS-0012', cdf_notifications_v13._policy_fingerprint(), '0012');

reset role;
