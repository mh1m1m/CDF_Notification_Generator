-- 0002_case_registry — case registry, case-level authorisation, authorised portfolio reads (V13-DB-002).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- Access rule (one function, can_access_case, used by every case-keyed policy and command):
--   a valid persona in a valid workspace (0001 helpers) may see a case when
--     (1) the case is visible in the current workspace (case_workspace_visibility), and
--     (2) the case is not restricted, or the persona holds an active assignment on it.
--   Closed cases stay readable for those with access; commands refuse to change them (0003+).
--   Unknown and unauthorised ids are indistinguishable: both simply return no row.
--
-- Case records here are V13's own synthetic copies (ADR-001, source_system = 'V13_SYNTHETIC'), read by the app only
-- through the CaseSourceAdapter port. PRODUCTION_SUBSTITUTION_REQUIRED: the authoritative CDF case system.

set local role cdf_v13_owner;

create table cdf_notifications_v13.case_record (
  id                   uuid        primary key default gen_random_uuid(),
  display_number       text        not null unique check (display_number ~ '^CDF-DEMO-[0-9]{4}-[0-9]{4}$'),
  title_ar             text        not null check (length(title_ar) between 1 and 200),
  title_en             text        not null check (length(title_en) between 1 and 200),
  stage                text        not null check (stage in ('INTAKE', 'PRELIMINARY_REVIEW', 'INVESTIGATION',
                                                             'COMMITTEE_DELIBERATION', 'DECISION', 'CLOSURE')),
  is_restricted        boolean     not null default false,
  records_state        text        not null default 'ACTIVE' check (records_state in ('ACTIVE', 'CLOSED')),
  owning_workspace_id  uuid        not null references cdf_notifications_v13.workspace (id),
  source_system        text        not null default 'V13_SYNTHETIC' check (source_system in ('V13_SYNTHETIC')),
  source_ref           text        check (source_ref is null or source_ref ~ '^[A-Za-z0-9._:-]{1,80}$'),
  opened_at            timestamptz not null default now(),
  closed_at            timestamptz,
  row_version          integer     not null default 1 check (row_version >= 1),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint case_closed_consistency check ((records_state = 'CLOSED') = (closed_at is not null)),
  constraint case_closed_after_open  check (closed_at is null or closed_at >= opened_at)
);
comment on table cdf_notifications_v13.case_record is 'V13 synthetic case records (ADR-001). UUID is the key; display_number (CDF-DEMO-YYYY-NNNN) is a label only and never used for lookup. PRODUCTION_SUBSTITUTION_REQUIRED: authoritative CDF case system behind CaseSourceAdapter.';
-- source_system is limited to V13_SYNTHETIC on purpose: a new source needs a migration and a data-ownership review.

create table cdf_notifications_v13.case_workspace_visibility (
  case_id       uuid        not null references cdf_notifications_v13.case_record (id),
  workspace_id  uuid        not null references cdf_notifications_v13.workspace (id),
  created_at    timestamptz not null default now(),
  primary key (case_id, workspace_id)
);
create index case_workspace_visibility_ws_idx on cdf_notifications_v13.case_workspace_visibility (workspace_id, case_id);
comment on table cdf_notifications_v13.case_workspace_visibility is 'Workspaces in which a case appears. The owning workspace is always listed (trigger).';

create table cdf_notifications_v13.case_assignment (
  id          uuid        primary key default gen_random_uuid(),
  case_id     uuid        not null references cdf_notifications_v13.case_record (id),
  persona_id  uuid        not null references cdf_notifications_v13.persona (id),
  capacity    text        not null check (capacity in ('LEAD_INVESTIGATOR', 'INVESTIGATOR', 'SECRETARY',
                                                          'GOVERNANCE_REVIEWER')),
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  created_at  timestamptz not null default now(),
  constraint case_assignment_window check (valid_to is null or valid_to > valid_from),
  constraint case_assignment_unique unique (case_id, persona_id, capacity, valid_from)
);
create index case_assignment_persona_idx on cdf_notifications_v13.case_assignment (persona_id, case_id);
comment on table cdf_notifications_v13.case_assignment is 'Persona × case × capacity with an active window. Required to see a restricted case.';

alter table cdf_notifications_v13.audit_event
  add constraint audit_event_case_fk foreign key (case_id) references cdf_notifications_v13.case_record (id);

-- The owning workspace is always a visibility row.
create function cdf_notifications_v13._case_owning_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into cdf_notifications_v13.case_workspace_visibility (case_id, workspace_id)
  values (new.id, new.owning_workspace_id)
  on conflict do nothing;
  return new;
end
$fn$;
comment on function cdf_notifications_v13._case_owning_visibility() is 'Trigger: lists the owning workspace in case_workspace_visibility.';
create trigger case_record_owning_visibility
  after insert or update of owning_workspace_id on cdf_notifications_v13.case_record
  for each row execute function cdf_notifications_v13._case_owning_visibility();

alter table cdf_notifications_v13.case_record               enable row level security;
alter table cdf_notifications_v13.case_workspace_visibility enable row level security;
alter table cdf_notifications_v13.case_assignment           enable row level security;

-- ---------------------------------------------------------------------------------------------------------------------
-- Authorisation
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13.is_assigned_to_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from cdf_notifications_v13.case_assignment a
     where a.case_id = p_case_id
       and a.persona_id = cdf_notifications_v13.current_persona_id()
       and a.valid_from <= now()
       and (a.valid_to is null or a.valid_to > now()))
$fn$;
comment on function cdf_notifications_v13.is_assigned_to_case(uuid) is 'The current persona holds an active assignment on the case (any capacity).';

create function cdf_notifications_v13.can_access_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce((
    select (not c.is_restricted or cdf_notifications_v13.is_assigned_to_case(c.id))
      from cdf_notifications_v13.case_record c
      join cdf_notifications_v13.case_workspace_visibility v
        on v.case_id = c.id and v.workspace_id = cdf_notifications_v13.current_workspace_id()
     where c.id = p_case_id
       and cdf_notifications_v13.current_persona_id() is not null), false)
$fn$;
comment on function cdf_notifications_v13.can_access_case(uuid) is 'The single case-access rule: valid persona and workspace, case visible in that workspace, and (not restricted or assigned). False for unknown ids, exactly as for unauthorised ones.';

create policy case_record_select on cdf_notifications_v13.case_record
  for select to cdf_v13_user using (cdf_notifications_v13.can_access_case(id));
create policy case_workspace_visibility_select on cdf_notifications_v13.case_workspace_visibility
  for select to cdf_v13_user
  using (workspace_id = cdf_notifications_v13.current_workspace_id() and cdf_notifications_v13.can_access_case(case_id));
create policy case_assignment_select on cdf_notifications_v13.case_assignment
  for select to cdf_v13_user using (cdf_notifications_v13.can_access_case(case_id));

grant select on cdf_notifications_v13.case_record, cdf_notifications_v13.case_workspace_visibility,
                cdf_notifications_v13.case_assignment to cdf_v13_user;

-- ---------------------------------------------------------------------------------------------------------------------
-- Portfolio reads. SECURITY INVOKER: they run as cdf_v13_user, so RLS filters rows BEFORE pagination and counts.
-- Keyset pagination on display_number (unique). Filters are optional; search matches the display number or a title.
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13.portfolio_page(
  p_after_display_number text default null,
  p_limit                integer default 25,
  p_stage                text default null,
  p_records_state        text default null,
  p_search               text default null)
returns table (
  id uuid, display_number text, title_ar text, title_en text, stage text, is_restricted boolean,
  records_state text, owning_workspace_id uuid, opened_at timestamptz, closed_at timestamptz, row_version integer)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select c.id, c.display_number, c.title_ar, c.title_en, c.stage, c.is_restricted, c.records_state,
         c.owning_workspace_id, c.opened_at, c.closed_at, c.row_version
    from cdf_notifications_v13.case_record c
   where (p_after_display_number is null or c.display_number > p_after_display_number)
     and (p_stage is null or c.stage = p_stage)
     and (p_records_state is null or c.records_state = p_records_state)
     and (p_search is null or p_search = ''
          or strpos(lower(c.display_number), lower(p_search)) > 0
          or strpos(lower(c.title_en), lower(p_search)) > 0
          or strpos(c.title_ar, p_search) > 0)
   order by c.display_number
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
$fn$;
comment on function cdf_notifications_v13.portfolio_page(text, integer, text, text, text) is 'Authorised Case Portfolio page (RLS applies before filtering, ordering and limit). Keyset on display_number; limit 1..100.';

create function cdf_notifications_v13.portfolio_count(
  p_stage text default null, p_records_state text default null, p_search text default null)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
  select count(*)
    from cdf_notifications_v13.case_record c
   where (p_stage is null or c.stage = p_stage)
     and (p_records_state is null or c.records_state = p_records_state)
     and (p_search is null or p_search = ''
          or strpos(lower(c.display_number), lower(p_search)) > 0
          or strpos(lower(c.title_en), lower(p_search)) > 0
          or strpos(c.title_ar, p_search) > 0)
$fn$;
comment on function cdf_notifications_v13.portfolio_count(text, text, text) is 'Count of authorised cases matching the filters (never counts a case the persona cannot see).';

create function cdf_notifications_v13.case_header(p_case_id uuid)
returns table (
  id uuid, display_number text, title_ar text, title_en text, stage text, is_restricted boolean,
  records_state text, owning_workspace_id uuid, opened_at timestamptz, closed_at timestamptz, row_version integer)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select c.id, c.display_number, c.title_ar, c.title_en, c.stage, c.is_restricted, c.records_state,
         c.owning_workspace_id, c.opened_at, c.closed_at, c.row_version
    from cdf_notifications_v13.case_record c
   where c.id = p_case_id
$fn$;
comment on function cdf_notifications_v13.case_header(uuid) is 'Case header by UUID. No row for unknown and unauthorised alike.';

grant execute on function cdf_notifications_v13.is_assigned_to_case(uuid) to cdf_v13_user;
grant execute on function cdf_notifications_v13.can_access_case(uuid)     to cdf_v13_user;
grant execute on function cdf_notifications_v13.portfolio_page(text, integer, text, text, text) to cdf_v13_user;
grant execute on function cdf_notifications_v13.portfolio_count(text, text, text)                to cdf_v13_user;
grant execute on function cdf_notifications_v13.case_header(uuid)                                to cdf_v13_user;

reset role;
