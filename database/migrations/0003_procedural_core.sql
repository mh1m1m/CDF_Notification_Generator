-- 0003_procedural_core — recorded procedural events, tasks, api_update_task_status (V13-DB-003).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- procedural_event is the record of what actually happened (Layer A). It is append-only: corrections are new events
-- that point at what they correct through causation_id. Expected steps (Layer B) are computed in lib/journeys and are
-- never stored here, so the two can never be merged.
--
-- Error codes raised by commands (SQLSTATE class V1, mapped to generic messages with a correlation id by the BFF):
--   V1401 no valid persona/workspace context
--   V1404 not found — used for unknown AND unauthorised ids alike (no existence leak)
--   V1409 stale row_version (optimistic concurrency) or conflicting duplicate
--   V1422 invalid input or transition
--   V1423 case is CLOSED (only raised after access was proven)

set local role cdf_v13_owner;

create table cdf_notifications_v13.procedural_event (
  id                      uuid        primary key default gen_random_uuid(),
  case_id                 uuid        not null references cdf_notifications_v13.case_record (id),
  event_code              text        not null check (event_code ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  occurred_at             timestamptz not null,
  recorded_at             timestamptz not null default clock_timestamp(),
  recorded_by_persona_id  uuid        references cdf_notifications_v13.persona (id),
  provenance              text        not null check (provenance in ('RECORDED_IN_V13', 'SEED_SYNTHETIC')),
  causation_id            uuid,
  subject_type            text        check (subject_type is null or subject_type ~ '^[a-z][a-z0-9_]{2,60}$'),
  subject_id              uuid,
  attributes              jsonb       not null default '{}'::jsonb
                                      check (jsonb_typeof(attributes) = 'object' and pg_column_size(attributes) <= 2048),
  constraint procedural_event_case_unique unique (id, case_id),
  -- A cause always belongs to the same case.
  constraint procedural_event_causation_fk foreign key (causation_id, case_id)
    references cdf_notifications_v13.procedural_event (id, case_id),
  constraint procedural_event_recorded_after_occurred check (recorded_at >= occurred_at - interval '5 minutes')
);
create index procedural_event_case_idx on cdf_notifications_v13.procedural_event (case_id, occurred_at, recorded_at);
comment on table cdf_notifications_v13.procedural_event is 'Append-only record of what happened in a case (Layer A). attributes hold codes and ids only. A causation_id must be an event of the same case.';

create trigger procedural_event_no_update_delete
  before update or delete on cdf_notifications_v13.procedural_event
  for each row execute function cdf_notifications_v13._reject_mutation();
create trigger procedural_event_no_truncate
  before truncate on cdf_notifications_v13.procedural_event
  for each statement execute function cdf_notifications_v13._reject_mutation();

create table cdf_notifications_v13.task (
  id                    uuid        primary key default gen_random_uuid(),
  case_id               uuid        not null references cdf_notifications_v13.case_record (id),
  task_code             text        not null check (task_code ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  title_ar              text        not null check (length(title_ar) between 1 and 200),
  title_en              text        not null check (length(title_en) between 1 and 200),
  assignee_persona_id   uuid        references cdf_notifications_v13.persona (id),
  status                text        not null default 'OPEN'
                                    check (status in ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED')),
  due_date              date,
  row_version           integer     not null default 1 check (row_version >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint task_case_unique unique (id, case_id)
);
create index task_case_idx     on cdf_notifications_v13.task (case_id, status);
create index task_assignee_idx on cdf_notifications_v13.task (assignee_persona_id, status, due_date);
comment on table cdf_notifications_v13.task is 'Case tasks. Status changes only through api_update_task_status (optimistic concurrency on row_version).';

alter table cdf_notifications_v13.procedural_event enable row level security;
alter table cdf_notifications_v13.task             enable row level security;

create policy procedural_event_select on cdf_notifications_v13.procedural_event
  for select to cdf_v13_user using (current_user = 'cdf_v13_user' and cdf_notifications_v13.can_access_case(case_id));
create policy task_select on cdf_notifications_v13.task
  for select to cdf_v13_user using (current_user = 'cdf_v13_user' and cdf_notifications_v13.can_access_case(case_id));

grant select on cdf_notifications_v13.procedural_event, cdf_notifications_v13.task to cdf_v13_user;

-- Allowed status transitions. DONE and CANCELLED are terminal.
create function cdf_notifications_v13._task_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $fn$
  select (p_from, p_to) in (
    ('OPEN', 'IN_PROGRESS'), ('OPEN', 'BLOCKED'), ('OPEN', 'CANCELLED'),
    ('IN_PROGRESS', 'BLOCKED'), ('IN_PROGRESS', 'DONE'), ('IN_PROGRESS', 'CANCELLED'), ('IN_PROGRESS', 'OPEN'),
    ('BLOCKED', 'IN_PROGRESS'), ('BLOCKED', 'OPEN'), ('BLOCKED', 'CANCELLED'))
$fn$;
comment on function cdf_notifications_v13._task_transition_allowed(text, text) is 'Internal: task status graph. DONE and CANCELLED are terminal.';

-- ---------------------------------------------------------------------------------------------------------------------
-- api_update_task_status
--   Who: the task's assignee, or a persona holding an active assignment on the task's case, in a workspace where the
--        case is visible (can_access_case). Governance officers without an assignment read but do not change tasks.
--   Writes: task (status, row_version + 1), one procedural_event TASK_STATUS_CHANGED, one audit_event — one transaction.
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13.api_update_task_status(
  p_task_id          uuid,
  p_new_status       text,
  p_expected_version integer)
returns table (task_id uuid, case_id uuid, status text, row_version integer)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_persona uuid := cdf_notifications_v13.current_persona_id();
  v_task    cdf_notifications_v13.task%rowtype;
  v_state   text;
  v_event   uuid;
begin
  if v_persona is null or cdf_notifications_v13.current_workspace_id() is null then
    raise exception 'no valid context' using errcode = 'V1401';
  end if;
  if p_task_id is null then
    raise exception 'not found' using errcode = 'V1404';
  end if;

  select t.* into v_task from cdf_notifications_v13.task t where t.id = p_task_id for update;
  -- Unknown and unauthorised are the same answer.
  if not found or not cdf_notifications_v13.can_access_case(v_task.case_id) then
    raise exception 'not found' using errcode = 'V1404';
  end if;
  if not (v_task.assignee_persona_id = v_persona or cdf_notifications_v13.is_assigned_to_case(v_task.case_id)) then
    raise exception 'not found' using errcode = 'V1404';
  end if;

  select c.records_state into v_state from cdf_notifications_v13.case_record c where c.id = v_task.case_id for share;
  if v_state <> 'ACTIVE' then
    raise exception 'case closed' using errcode = 'V1423';
  end if;
  if p_expected_version is null or p_expected_version <> v_task.row_version then
    raise exception 'stale version' using errcode = 'V1409';
  end if;
  if p_new_status is null or not cdf_notifications_v13._task_transition_allowed(v_task.status, p_new_status) then
    raise exception 'invalid transition' using errcode = 'V1422';
  end if;

  update cdf_notifications_v13.task t
     set status = p_new_status, row_version = t.row_version + 1, updated_at = now()
   where t.id = v_task.id;

  insert into cdf_notifications_v13.procedural_event
    (case_id, event_code, occurred_at, recorded_by_persona_id, provenance, subject_type, subject_id, attributes)
  values
    (v_task.case_id, 'TASK_STATUS_CHANGED', clock_timestamp(), v_persona, 'RECORDED_IN_V13', 'task', v_task.id,
     jsonb_build_object('from', v_task.status, 'to', p_new_status))
  returning id into v_event;

  perform cdf_notifications_v13._append_audit('TASK_STATUS_CHANGED', 'task', v_task.id, v_task.case_id,
    jsonb_build_object('from', v_task.status, 'to', p_new_status, 'row_version', v_task.row_version + 1,
                       'procedural_event_id', v_event));

  task_id := v_task.id; case_id := v_task.case_id; status := p_new_status; row_version := v_task.row_version + 1;
  return next;
end
$fn$;
comment on function cdf_notifications_v13.api_update_task_status(uuid, text, integer) is 'Command: change a task''s status (assignee or case-assigned persona; active case; expected row_version; allowed transition). Writes task, procedural event and audit event in one transaction. V1404 for unknown and unauthorised alike.';

-- My Work: tasks assigned to the current persona, across cases it can access in the current workspace (RLS applies).
create function cdf_notifications_v13.my_work_tasks(p_include_closed boolean default false)
returns table (
  task_id uuid, case_id uuid, display_number text, task_code text, title_ar text, title_en text,
  status text, due_date date, row_version integer)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select t.id, t.case_id, c.display_number, t.task_code, t.title_ar, t.title_en, t.status, t.due_date, t.row_version
    from cdf_notifications_v13.task t
    join cdf_notifications_v13.case_record c on c.id = t.case_id
   where t.assignee_persona_id = cdf_notifications_v13.current_persona_id()
     and (p_include_closed or t.status not in ('DONE', 'CANCELLED'))
   order by t.due_date nulls last, c.display_number, t.task_code
$fn$;
comment on function cdf_notifications_v13.my_work_tasks(boolean) is 'My Work: the current persona''s tasks in cases visible to it in the current workspace.';

-- ---------------------------------------------------------------------------------------------------------------------
-- Portfolio reads (FE-003, UX S2). SECURITY INVOKER: they run as cdf_v13_user, so RLS filters cases, tasks and events
-- BEFORE filtering, pagination, counts and per-row summaries. Keyset pagination on display_number (unique).
-- Filters are optional and identical for page and count:
--   p_stage, p_records_state   exact codes
--   p_search                   display number or a title (substring)
--   p_assigned_to_me           only cases where the current persona holds an active case assignment
-- Per row: the last recorded procedural event of the case (id and occurred_at) and the number of the current
-- persona's own open tasks in the case. Both come from rows the persona may already read.
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13.portfolio_page(
  p_after_display_number text default null,
  p_limit                integer default 25,
  p_stage                text default null,
  p_records_state        text default null,
  p_search               text default null,
  p_assigned_to_me       boolean default false)
returns table (
  id uuid, display_number text, title_ar text, title_en text, stage text, is_restricted boolean,
  records_state text, owning_workspace_id uuid, opened_at timestamptz, closed_at timestamptz, row_version integer,
  updated_at timestamptz, source_system text, source_ref text,
  last_event_id uuid, last_event_at timestamptz, my_open_task_count integer)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select c.id, c.display_number, c.title_ar, c.title_en, c.stage, c.is_restricted, c.records_state,
         c.owning_workspace_id, c.opened_at, c.closed_at, c.row_version, c.updated_at, c.source_system, c.source_ref,
         e.id, e.occurred_at,
         (select count(*)::integer
            from cdf_notifications_v13.task t
           where t.case_id = c.id
             and t.assignee_persona_id = cdf_notifications_v13.current_persona_id()
             and t.status not in ('DONE', 'CANCELLED'))
    from cdf_notifications_v13.case_record c
    left join lateral (
      select pe.id, pe.occurred_at
        from cdf_notifications_v13.procedural_event pe
       where pe.case_id = c.id
       order by pe.occurred_at desc, pe.recorded_at desc, pe.id desc
       limit 1) e on true
   where (p_after_display_number is null or c.display_number > p_after_display_number)
     and (p_stage is null or c.stage = p_stage)
     and (p_records_state is null or c.records_state = p_records_state)
     and (p_search is null or p_search = ''
          or strpos(lower(c.display_number), lower(p_search)) > 0
          or strpos(lower(c.title_en), lower(p_search)) > 0
          or strpos(c.title_ar, p_search) > 0)
     and (not coalesce(p_assigned_to_me, false) or cdf_notifications_v13.is_assigned_to_case(c.id))
   order by c.display_number
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
$fn$;
comment on function cdf_notifications_v13.portfolio_page(text, integer, text, text, text, boolean) is 'Authorised Case Portfolio page (RLS applies before filtering, ordering, limit and row summaries). Keyset on display_number; limit 1..100; optional assigned-to-me filter; per row the last recorded event and the caller''s own open-task count.';

create function cdf_notifications_v13.portfolio_count(
  p_stage          text default null,
  p_records_state  text default null,
  p_search         text default null,
  p_assigned_to_me boolean default false)
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
     and (not coalesce(p_assigned_to_me, false) or cdf_notifications_v13.is_assigned_to_case(c.id))
$fn$;
comment on function cdf_notifications_v13.portfolio_count(text, text, text, boolean) is 'Count of authorised cases matching exactly the portfolio_page filters (never counts a case the persona cannot see).';

grant execute on function cdf_notifications_v13.api_update_task_status(uuid, text, integer) to cdf_v13_user;
grant execute on function cdf_notifications_v13.portfolio_page(text, integer, text, text, text, boolean) to cdf_v13_user;
grant execute on function cdf_notifications_v13.portfolio_count(text, text, text, boolean)                to cdf_v13_user;
grant execute on function cdf_notifications_v13.my_work_tasks(boolean)                           to cdf_v13_user;

reset role;
