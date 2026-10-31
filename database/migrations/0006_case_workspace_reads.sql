-- 0006_case_workspace_reads — V13-DB-008: read functions for the Case Workspace (FE-004, SCREENS S3; ARCH ruling 28 Oct).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- All three are SECURITY INVOKER with search_path '': they run as cdf_v13_user, so RLS (can_access_case on
-- case_record, procedural_event, task and case_assignment) filters every row before anything is ordered or derived.
-- An unknown case and an unauthorised one both return zero rows.
--
-- No column identifies a person: actors and assignees appear only as a capacity code on the case
-- (LEAD_INVESTIGATOR, INVESTIGATOR, SECRETARY, GOVERNANCE_REVIEWER) or as "is it me". When a persona holds several
-- capacities at the same time the first in that order is shown (_capacity_rank).
--
--   case_events(p_case_id)  newest first (occurred_at, recorded_at, id); actor_capacity = the recorder's capacity on the
--                           case at occurred_at, or NULL (no assignment then, or a seed row without a recorder).
--   case_tasks(p_case_id)   the case's tasks; assignee_capacity = the assignee's capacity now, or NULL; is_mine;
--                           status_event_id = the latest procedural event about the task (NULL for an untouched task).
--   case_header(p_case_id)  unchanged columns plus my_capacity (the caller's active capacity on the case, or NULL).
--                           Redefined here because its result type grows (DROP + CREATE in one transaction).
-- PRODUCTION_SUBSTITUTION_REQUIRED: production takes case roles from the CDF case system through CaseSourceAdapter.

set local role cdf_v13_owner;

-- Fixed display order of case capacities (lower first). Immutable, no table access.
create function cdf_notifications_v13._capacity_rank(p_capacity text)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.array_position(
    array['LEAD_INVESTIGATOR', 'INVESTIGATOR', 'SECRETARY', 'GOVERNANCE_REVIEWER']::text[], p_capacity), 99)
$fn$;
comment on function cdf_notifications_v13._capacity_rank(text) is 'Display order of case capacities when a persona holds several (internal).';

create function cdf_notifications_v13.case_events(p_case_id uuid)
returns table (
  id uuid, case_id uuid, event_code text, occurred_at timestamptz, recorded_at timestamptz, actor_capacity text,
  provenance text, subject_type text, subject_id uuid, causation_id uuid)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select e.id, e.case_id, e.event_code, e.occurred_at, e.recorded_at,
         (select a.capacity
            from cdf_notifications_v13.case_assignment a
           where a.case_id = e.case_id
             and a.persona_id = e.recorded_by_persona_id
             and a.valid_from <= e.occurred_at
             and (a.valid_to is null or a.valid_to > e.occurred_at)
           order by cdf_notifications_v13._capacity_rank(a.capacity), a.capacity
           limit 1),
         e.provenance, e.subject_type, e.subject_id, e.causation_id
    from cdf_notifications_v13.procedural_event e
   where e.case_id = p_case_id
   order by e.occurred_at desc, e.recorded_at desc, e.id desc
$fn$;
comment on function cdf_notifications_v13.case_events(uuid) is 'Case Workspace timeline: the case''s procedural events, newest first, with the actor as a capacity code only. No row for unknown and unauthorised alike.';

create function cdf_notifications_v13.case_tasks(p_case_id uuid)
returns table (
  id uuid, case_id uuid, task_code text, title_ar text, title_en text, assignee_capacity text, is_mine boolean,
  status text, due_date date, row_version integer, status_event_id uuid)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select t.id, t.case_id, t.task_code, t.title_ar, t.title_en,
         (select a.capacity
            from cdf_notifications_v13.case_assignment a
           where a.case_id = t.case_id
             and a.persona_id = t.assignee_persona_id
             and a.valid_from <= pg_catalog.now()
             and (a.valid_to is null or a.valid_to > pg_catalog.now())
           order by cdf_notifications_v13._capacity_rank(a.capacity), a.capacity
           limit 1),
         coalesce(t.assignee_persona_id = cdf_notifications_v13.current_persona_id(), false),
         t.status, t.due_date, t.row_version,
         (select e.id
            from cdf_notifications_v13.procedural_event e
           where e.case_id = t.case_id and e.subject_type = 'task' and e.subject_id = t.id
           order by e.occurred_at desc, e.recorded_at desc, e.id desc
           limit 1)
    from cdf_notifications_v13.task t
   where t.case_id = p_case_id
   order by t.due_date nulls last, t.task_code, t.id
$fn$;
comment on function cdf_notifications_v13.case_tasks(uuid) is 'Case Workspace tasks: assignee as a capacity code and an is-mine flag only, and the event that set the current status. No row for unknown and unauthorised alike.';

drop function cdf_notifications_v13.case_header(uuid);
create function cdf_notifications_v13.case_header(p_case_id uuid)
returns table (
  id uuid, display_number text, title_ar text, title_en text, stage text, is_restricted boolean,
  records_state text, owning_workspace_id uuid, opened_at timestamptz, closed_at timestamptz, row_version integer,
  updated_at timestamptz, source_system text, source_ref text, my_capacity text)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select c.id, c.display_number, c.title_ar, c.title_en, c.stage, c.is_restricted, c.records_state,
         c.owning_workspace_id, c.opened_at, c.closed_at, c.row_version, c.updated_at, c.source_system, c.source_ref,
         (select a.capacity
            from cdf_notifications_v13.case_assignment a
           where a.case_id = c.id
             and a.persona_id = cdf_notifications_v13.current_persona_id()
             and a.valid_from <= pg_catalog.now()
             and (a.valid_to is null or a.valid_to > pg_catalog.now())
           order by cdf_notifications_v13._capacity_rank(a.capacity), a.capacity
           limit 1)
    from cdf_notifications_v13.case_record c
   where c.id = p_case_id
$fn$;
comment on function cdf_notifications_v13.case_header(uuid) is 'Case header by UUID, with the caller''s own capacity on the case. No row for unknown and unauthorised alike.';

grant execute on function cdf_notifications_v13._capacity_rank(text) to cdf_v13_user;
grant execute on function cdf_notifications_v13.case_events(uuid)    to cdf_v13_user;
grant execute on function cdf_notifications_v13.case_tasks(uuid)     to cdf_v13_user;
grant execute on function cdf_notifications_v13.case_header(uuid)    to cdf_v13_user;

reset role;
