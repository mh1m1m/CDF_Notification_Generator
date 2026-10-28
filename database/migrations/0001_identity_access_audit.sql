-- 0001_identity_access_audit — identity and access core, claims helpers, append-only audit ledger (V13-DB-001).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- Runs inside the migration runner's single transaction as the administrator, then acts as cdf_v13_owner so every
-- object below is owned by the V13 owner role (ADR-012). Creates only new objects inside cdf_notifications_v13.
--
-- Security model (ADR-003):
--   * The web app logs in as cdf_v13_app and, inside each transaction, runs
--       select set_config('request.v13.claims', '{"persona_id":"<uuid>","workspace_id":"<uuid>"}', true);
--       set local role cdf_v13_user;
--   * The claims are only a request: every helper below re-checks them against the tables (persona exists and is
--     active; the persona holds an active membership in the claimed workspace). A forged or stale claim resolves to
--     NULL, and NULL grants nothing.
--   * cdf_v13_user gets SELECT where a policy needs it and EXECUTE on named functions. It never gets INSERT, UPDATE,
--     DELETE or TRUNCATE on any table; writes happen in api_* SECURITY DEFINER commands (migrations 0003+).
--
-- PRODUCTION_SUBSTITUTION_REQUIRED: personas stand in for CDF corporate IdP identities (OIDC); the audit ledger stands
-- in for the CDF SLS/SIEM export (ADR-011).

set local role cdf_v13_owner;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. schema_migrations: explicit restrictive deny-all (clears advisor INFO rls_enabled_no_policy, OI-009).
--    The owner and the administrator (BYPASSRLS / superuser) are not subject to RLS on it; nobody else holds a grant.
-- ---------------------------------------------------------------------------------------------------------------------
create policy schema_migrations_deny_all on cdf_notifications_v13.schema_migrations
  as restrictive for all to public using (false) with check (false);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Reference and identity tables
-- ---------------------------------------------------------------------------------------------------------------------
create table cdf_notifications_v13.workspace (
  id          uuid        primary key default gen_random_uuid(),
  code        text        not null unique check (code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  name_ar     text        not null check (length(name_ar) between 1 and 120),
  name_en     text        not null check (length(name_en) between 1 and 120),
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);
comment on table cdf_notifications_v13.workspace is 'V13 workspaces (e.g. SECRETARIAT, INVESTIGATIONS, GOVERNANCE). Reference data. Synthetic.';

create table cdf_notifications_v13.role (
  id          uuid        primary key default gen_random_uuid(),
  code        text        not null unique check (code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  name_ar     text        not null check (length(name_ar) between 1 and 120),
  name_en     text        not null check (length(name_en) between 1 and 120),
  created_at  timestamptz not null default now()
);
comment on table cdf_notifications_v13.role is 'V13 roles (e.g. COMMITTEE_SECRETARY, INVESTIGATOR, GOVERNANCE_OFFICER). Reference data shipped in migrations.';

create table cdf_notifications_v13.persona (
  id               uuid        primary key default gen_random_uuid(),
  code             text        not null unique check (code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  display_name_ar  text        not null check (length(display_name_ar) between 1 and 120),
  display_name_en  text        not null check (length(display_name_en) between 1 and 120),
  email            text        not null unique check (email ~ '^[a-z0-9._-]+@example\.test$'),
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now()
);
comment on table cdf_notifications_v13.persona is 'Synthetic sign-in personas (ADR-004). Only @example.test addresses. PRODUCTION_SUBSTITUTION_REQUIRED: CDF corporate IdP identities.';

create table cdf_notifications_v13.persona_workspace_membership (
  id            uuid        primary key default gen_random_uuid(),
  persona_id    uuid        not null references cdf_notifications_v13.persona (id),
  workspace_id  uuid        not null references cdf_notifications_v13.workspace (id),
  role_id       uuid        not null references cdf_notifications_v13.role (id),
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  created_at    timestamptz not null default now(),
  constraint membership_window check (valid_to is null or valid_to > valid_from),
  constraint membership_unique unique (persona_id, workspace_id, role_id, valid_from)
);
create index persona_workspace_membership_persona_idx
  on cdf_notifications_v13.persona_workspace_membership (persona_id, workspace_id);
comment on table cdf_notifications_v13.persona_workspace_membership is 'Persona × workspace × role with an active window. A membership is active when valid_from <= now() < coalesce(valid_to, infinity).';

alter table cdf_notifications_v13.workspace                    enable row level security;
alter table cdf_notifications_v13.role                         enable row level security;
alter table cdf_notifications_v13.persona                      enable row level security;
alter table cdf_notifications_v13.persona_workspace_membership enable row level security;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Claims helpers. SECURITY DEFINER (they read identity tables without recursing through RLS), search_path = '',
--    STABLE, schema-qualified. They never raise on bad input: a malformed claim is treated as "no claim".
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13._claim_uuid(p_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_raw  text := pg_catalog.current_setting('request.v13.claims', true);
  v_text text;
begin
  if v_raw is null or v_raw = '' then
    return null;
  end if;
  begin
    v_text := (v_raw::jsonb) ->> p_key;
  exception when others then
    return null;                          -- malformed JSON: no claim
  end;
  if v_text is null or v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;                          -- missing or not a UUID: no claim
  end if;
  return v_text::uuid;
end
$fn$;
comment on function cdf_notifications_v13._claim_uuid(text) is 'Internal: reads one UUID from request.v13.claims (transaction-local). NULL when absent or malformed.';

create function cdf_notifications_v13.current_persona_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id
    from cdf_notifications_v13.persona p
   where p.id = cdf_notifications_v13._claim_uuid('persona_id')
     and p.is_active
$fn$;
comment on function cdf_notifications_v13.current_persona_id() is 'The claimed persona if it exists and is active; otherwise NULL.';

create function cdf_notifications_v13.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select w.id
    from cdf_notifications_v13.workspace w
   where w.id = cdf_notifications_v13._claim_uuid('workspace_id')
     and w.is_active
     and exists (
       select 1
         from cdf_notifications_v13.persona_workspace_membership m
        where m.persona_id = cdf_notifications_v13.current_persona_id()
          and m.workspace_id = w.id
          and m.valid_from <= now()
          and (m.valid_to is null or m.valid_to > now()))
$fn$;
comment on function cdf_notifications_v13.current_workspace_id() is 'The claimed workspace if it is active and the current persona holds an active membership in it; otherwise NULL. Switching workspace never widens access beyond memberships.';

create function cdf_notifications_v13.current_role_codes()
returns text[]
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(array_agg(distinct r.code order by r.code), '{}'::text[])
    from cdf_notifications_v13.persona_workspace_membership m
    join cdf_notifications_v13.role r on r.id = m.role_id
   where m.persona_id = cdf_notifications_v13.current_persona_id()
     and m.workspace_id = cdf_notifications_v13.current_workspace_id()
     and m.valid_from <= now()
     and (m.valid_to is null or m.valid_to > now())
$fn$;
comment on function cdf_notifications_v13.current_role_codes() is 'Role codes of the current persona in the current workspace (active memberships only). Empty when the context is invalid.';

create function cdf_notifications_v13.has_role(p_role_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select p_role_code = any (cdf_notifications_v13.current_role_codes())
$fn$;
comment on function cdf_notifications_v13.has_role(text) is 'True when the current persona holds the role in the current workspace.';

create function cdf_notifications_v13._is_colleague(p_persona_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from cdf_notifications_v13.persona_workspace_membership m
     where m.persona_id = p_persona_id
       and m.workspace_id = cdf_notifications_v13.current_workspace_id()
       and m.valid_from <= now()
       and (m.valid_to is null or m.valid_to > now()))
$fn$;
comment on function cdf_notifications_v13._is_colleague(uuid) is 'Internal: the persona holds an active membership in the current workspace.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Read policies on identity tables (SELECT only; no write grants).
-- ---------------------------------------------------------------------------------------------------------------------
-- Workspaces: only those the persona is an active member of (feeds the Workspace Switcher).
create policy workspace_select_member on cdf_notifications_v13.workspace
  for select to cdf_v13_user
  using (exists (
    select 1 from cdf_notifications_v13.persona_workspace_membership m
     where m.persona_id = cdf_notifications_v13.current_persona_id()
       and m.workspace_id = workspace.id
       and m.valid_from <= now()
       and (m.valid_to is null or m.valid_to > now())));

-- Roles: reference data, visible to any valid persona.
create policy role_select_signed_in on cdf_notifications_v13.role
  for select to cdf_v13_user
  using (cdf_notifications_v13.current_persona_id() is not null);

-- Personas: oneself, and personas holding an active membership in the current workspace (assignee names).
create policy persona_select_self_or_colleague on cdf_notifications_v13.persona
  for select to cdf_v13_user
  using (id = cdf_notifications_v13.current_persona_id() or cdf_notifications_v13._is_colleague(id));

-- Memberships: only one's own.
create policy membership_select_own on cdf_notifications_v13.persona_workspace_membership
  for select to cdf_v13_user
  using (persona_id = cdf_notifications_v13.current_persona_id());

grant select on cdf_notifications_v13.workspace, cdf_notifications_v13.role, cdf_notifications_v13.persona,
                cdf_notifications_v13.persona_workspace_membership to cdf_v13_user;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Audit ledger (ADR-011): append-only, hash-chained, serialised in the V13 advisory-lock namespace.
-- ---------------------------------------------------------------------------------------------------------------------
create table cdf_notifications_v13.audit_event (
  id                uuid        primary key default gen_random_uuid(),
  seq               bigint      not null unique generated always as identity,
  occurred_at       timestamptz not null default clock_timestamp(),
  actor_persona_id  uuid        references cdf_notifications_v13.persona (id),
  workspace_id      uuid        references cdf_notifications_v13.workspace (id),
  action            text        not null check (action ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  entity_type       text        not null check (entity_type ~ '^[a-z][a-z0-9_]{2,60}$'),
  entity_id         uuid,
  case_id           uuid,       -- FK added in 0002 when case_record exists
  correlation_id    uuid,
  metadata          jsonb       not null default '{}'::jsonb
                                check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),
  prev_hash         text        not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash          text        not null unique check (row_hash ~ '^[0-9a-f]{64}$')
);
create index audit_event_case_idx on cdf_notifications_v13.audit_event (case_id, seq) where case_id is not null;
comment on table cdf_notifications_v13.audit_event is 'Append-only, hash-chained audit ledger (ADR-011). Metadata holds ids and codes only, never narrative or free-text reasons. UPDATE/DELETE/TRUNCATE refused for every role. PRODUCTION_SUBSTITUTION_REQUIRED: CDF SLS/SIEM.';

alter table cdf_notifications_v13.audit_event enable row level security;
-- No policy for cdf_v13_user and no grant: the ledger is read only through owner-run verification and later
-- purpose-built read functions. Restrictive deny-all keeps the intent explicit.
create policy audit_event_deny_all on cdf_notifications_v13.audit_event
  as restrictive for all to public using (false) with check (false);

-- Genesis hash: 64 zeros.
create function cdf_notifications_v13._audit_row_hash(
  p_seq bigint, p_occurred_at timestamptz, p_actor uuid, p_workspace uuid, p_action text, p_entity_type text,
  p_entity_id uuid, p_case_id uuid, p_correlation_id uuid, p_metadata jsonb, p_prev_hash text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $fn$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.concat_ws('|',
           p_seq::text,
           pg_catalog.to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           coalesce(p_actor::text, '-'),
           coalesce(p_workspace::text, '-'),
           p_action,
           p_entity_type,
           coalesce(p_entity_id::text, '-'),
           coalesce(p_case_id::text, '-'),
           coalesce(p_correlation_id::text, '-'),
           p_metadata::text,
           p_prev_hash), 'UTF8')), 'hex')
$fn$;
comment on function cdf_notifications_v13._audit_row_hash(bigint, timestamptz, uuid, uuid, text, text, uuid, uuid, uuid, jsonb, text) is 'Internal: canonical sha256 of an audit row (UTC timestamp text, jsonb canonical text). Timezone-independent.';

-- The only way to write the ledger. Not granted to cdf_v13_user: api_* commands (owned by cdf_v13_owner) call it.
create function cdf_notifications_v13._append_audit(
  p_action text, p_entity_type text, p_entity_id uuid, p_case_id uuid, p_metadata jsonb default '{}'::jsonb,
  p_correlation_id uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_prev   text;
  v_id     uuid := gen_random_uuid();
  v_seq    bigint;
  v_at     timestamptz := clock_timestamp();
  v_actor  uuid := cdf_notifications_v13.current_persona_id();
  v_ws     uuid := cdf_notifications_v13.current_workspace_id();
  v_meta   jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  -- The chain reads the latest committed row; that needs a fresh snapshot per statement.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'audit append requires READ COMMITTED' using errcode = 'V1500';
  end if;
  -- V13 lock namespace only (CLAUDE.md §2); held until commit, so appends are strictly ordered.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'), 1);

  select a.row_hash into v_prev
    from cdf_notifications_v13.audit_event a
   order by a.seq desc
   limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));

  v_seq := pg_catalog.nextval(pg_catalog.pg_get_serial_sequence('cdf_notifications_v13.audit_event', 'seq'));

  insert into cdf_notifications_v13.audit_event
    (id, seq, occurred_at, actor_persona_id, workspace_id, action, entity_type, entity_id, case_id, correlation_id,
     metadata, prev_hash, row_hash)
  overriding system value
  values
    (v_id, v_seq, v_at, v_actor, v_ws, p_action, p_entity_type, p_entity_id, p_case_id, p_correlation_id,
     v_meta, v_prev,
     cdf_notifications_v13._audit_row_hash(v_seq, v_at, v_actor, v_ws, p_action, p_entity_type, p_entity_id,
                                           p_case_id, p_correlation_id, v_meta, v_prev));
  return v_id;
end
$fn$;
comment on function cdf_notifications_v13._append_audit(text, text, uuid, uuid, jsonb, uuid) is 'Internal: appends one hash-chained audit row in the caller''s transaction. Callable only by cdf_v13_owner (commands).';

-- Append-only enforcement for every role, including the owner.
create function cdf_notifications_v13._reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  raise exception '% on %.% is not permitted (append-only)', tg_op, tg_table_schema, tg_table_name
    using errcode = 'V1403';
end
$fn$;
comment on function cdf_notifications_v13._reject_mutation() is 'Trigger: refuses UPDATE, DELETE and TRUNCATE on append-only V13 tables.';

create trigger audit_event_no_update_delete
  before update or delete on cdf_notifications_v13.audit_event
  for each row execute function cdf_notifications_v13._reject_mutation();
create trigger audit_event_no_truncate
  before truncate on cdf_notifications_v13.audit_event
  for each statement execute function cdf_notifications_v13._reject_mutation();

-- Chain verification: returns counts and the first broken sequence number only (no row content).
create function cdf_notifications_v13.verify_audit_chain()
returns table (rows_checked bigint, first_broken_seq bigint, is_valid boolean)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  r       record;
  v_prev  text := repeat('0', 64);
  v_n     bigint := 0;
begin
  for r in select * from cdf_notifications_v13.audit_event order by seq loop
    v_n := v_n + 1;
    if r.prev_hash <> v_prev
       or r.row_hash <> cdf_notifications_v13._audit_row_hash(r.seq, r.occurred_at, r.actor_persona_id,
            r.workspace_id, r.action, r.entity_type, r.entity_id, r.case_id, r.correlation_id, r.metadata, r.prev_hash)
    then
      rows_checked := v_n; first_broken_seq := r.seq; is_valid := false;
      return next; return;
    end if;
    v_prev := r.row_hash;
  end loop;
  rows_checked := v_n; first_broken_seq := null; is_valid := true;
  return next;
end
$fn$;
comment on function cdf_notifications_v13.verify_audit_chain() is 'Recomputes the audit hash chain. Owner and administrator only (migrations, CI, hosted checks); not granted to cdf_v13_user. Returns counts only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Reference data: roles (workspaces and personas are synthetic seed data, database/seed/).
-- ---------------------------------------------------------------------------------------------------------------------
insert into cdf_notifications_v13.role (id, code, name_ar, name_en) values
  ('00000000-0000-4000-8000-0000000000a1', 'COMMITTEE_SECRETARY', 'أمين سر اللجنة',  'Committee Secretary'),
  ('00000000-0000-4000-8000-0000000000a2', 'INVESTIGATOR',        'محقق',            'Investigator'),
  ('00000000-0000-4000-8000-0000000000a3', 'GOVERNANCE_OFFICER',  'مسؤول الحوكمة',   'Governance Officer');

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. EXECUTE grants (default privileges already revoke PUBLIC EXECUTE for functions created by cdf_v13_owner).
-- ---------------------------------------------------------------------------------------------------------------------
grant execute on function cdf_notifications_v13.current_persona_id()   to cdf_v13_user;
grant execute on function cdf_notifications_v13.current_workspace_id() to cdf_v13_user;
grant execute on function cdf_notifications_v13.current_role_codes()   to cdf_v13_user;
grant execute on function cdf_notifications_v13.has_role(text)         to cdf_v13_user;
-- Policies evaluated for cdf_v13_user call these internal helpers, so the request role needs EXECUTE on them too.
grant execute on function cdf_notifications_v13._is_colleague(uuid)    to cdf_v13_user;

reset role;
