-- 0011_case_paged_reads — V13-DB-019 (REQ-PERF-003, OI-026): keyset-paged versions of the three per-case reads.
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- case_events_page         case_events, one bounded page at a time
-- case_tasks_page          case_tasks, one bounded page at a time
-- case_notifications_page  case_notifications, one bounded page at a time
--
-- The unpaged reads (0004, 0006) stay as they are; the FE switches to these in its own task. Each paged read returns
-- exactly the columns of its unpaged read plus page_cursor, in the same order, and the union of its pages equals the
-- unpaged read.
--
-- Access: SECURITY INVOKER with search_path ''. They run as cdf_v13_user, so the same RLS policies (can_access_case on
-- procedural_event, task, notification, case_record) decide which rows exist before any order, cursor or limit. No new
-- access path. Unknown and unauthorised cases return no rows, alike.
--
-- Paging: pass both values of the last row seen (p_after_cursor = its page_cursor, p_after_id = its id), or neither
-- for the first page. The cursor row is looked up by id in the same case under RLS and must carry exactly that
-- page_cursor; the keyset comparison then uses its stored values (exact microseconds, no text parsing). A half cursor,
-- a malformed or stale cursor text, an id from another case and an id the caller cannot see all return no rows, the
-- same answer as an unknown or unauthorised case, with no error.
-- Limit: 1..100, default 25. Any other value (NULL included) is refused with SQLSTATE 22023, never clamped.
-- PRODUCTION_SUBSTITUTION_REQUIRED: production case history comes from the CDF platform through the adapters.

set local role cdf_v13_owner;

-- The page bound. IMMUTABLE and table-free: it only checks its argument.
create function cdf_notifications_v13._page_limit(p_limit integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'page limit must be between 1 and 100' using errcode = '22023';
  end if;
  return p_limit;
end
$fn$;
comment on function cdf_notifications_v13._page_limit(integer) is 'Internal: returns the page limit if it is 1..100, else raises 22023 (refused, never clamped).';

-- case_tasks' order (due_date nulls last, task_code, id) within a case.
create index task_case_page_idx on cdf_notifications_v13.task (case_id, due_date, task_code, id);
comment on index cdf_notifications_v13.task_case_page_idx is 'Keyset order of case_tasks_page (due date, nulls last; task code; id).';

create function cdf_notifications_v13.case_events_page(
  p_case_id      uuid,
  p_after_cursor text    default null,
  p_after_id     uuid    default null,
  p_limit        integer default 25)
returns table (
  id uuid, case_id uuid, event_code text, occurred_at timestamptz, recorded_at timestamptz, actor_capacity text,
  provenance text, subject_type text, subject_id uuid, causation_id uuid, page_cursor text)
language sql
stable
security invoker
set search_path = ''
as $fn$
  with anchor as (
    select a.occurred_at, a.recorded_at, a.id
      from cdf_notifications_v13.procedural_event a
     where p_after_cursor is not null and p_after_id is not null
       and a.id = p_after_id and a.case_id = p_case_id
       and pg_catalog.to_char(a.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
           pg_catalog.to_char(a.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = p_after_cursor)
  select e.id, e.case_id, e.event_code, e.occurred_at, e.recorded_at,
         (select c.capacity
            from cdf_notifications_v13.case_assignment c
           where c.case_id = e.case_id
             and c.persona_id = e.recorded_by_persona_id
             and c.valid_from <= e.occurred_at
             and (c.valid_to is null or c.valid_to > e.occurred_at)
           order by cdf_notifications_v13._capacity_rank(c.capacity), c.capacity
           limit 1),
         e.provenance, e.subject_type, e.subject_id, e.causation_id,
         pg_catalog.to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
         pg_catalog.to_char(e.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    from cdf_notifications_v13.procedural_event e
   where e.case_id = p_case_id
     and ((p_after_cursor is null and p_after_id is null)
          or exists (select 1 from anchor x
                      where (e.occurred_at, e.recorded_at, e.id) < (x.occurred_at, x.recorded_at, x.id)))
   order by e.occurred_at desc, e.recorded_at desc, e.id desc
   limit cdf_notifications_v13._page_limit(p_limit)
$fn$;
comment on function cdf_notifications_v13.case_events_page(uuid, text, uuid, integer) is 'case_events one page at a time: keyset on (occurred_at desc, recorded_at desc, id desc) with both cursor values of the last row or neither; limit 1..100, refused otherwise. A half, malformed, stale or foreign cursor returns no rows, like an unknown or unauthorised case.';

create function cdf_notifications_v13.case_tasks_page(
  p_case_id      uuid,
  p_after_cursor text    default null,
  p_after_id     uuid    default null,
  p_limit        integer default 25)
returns table (
  id uuid, case_id uuid, task_code text, title_ar text, title_en text, assignee_capacity text, is_mine boolean,
  status text, due_date date, row_version integer, status_event_id uuid, page_cursor text)
language sql
stable
security invoker
set search_path = ''
as $fn$
  with anchor as (
    select a.due_date, a.task_code, a.id
      from cdf_notifications_v13.task a
     where p_after_cursor is not null and p_after_id is not null
       and a.id = p_after_id and a.case_id = p_case_id
       and coalesce(pg_catalog.to_char(a.due_date, 'YYYY-MM-DD'), '-') || '|' || a.task_code = p_after_cursor)
  select t.id, t.case_id, t.task_code, t.title_ar, t.title_en,
         (select c.capacity
            from cdf_notifications_v13.case_assignment c
           where c.case_id = t.case_id
             and c.persona_id = t.assignee_persona_id
             and c.valid_from <= pg_catalog.now()
             and (c.valid_to is null or c.valid_to > pg_catalog.now())
           order by cdf_notifications_v13._capacity_rank(c.capacity), c.capacity
           limit 1),
         coalesce(t.assignee_persona_id = cdf_notifications_v13.current_persona_id(), false),
         t.status, t.due_date, t.row_version,
         (select e.id
            from cdf_notifications_v13.procedural_event e
           where e.case_id = t.case_id and e.subject_type = 'task' and e.subject_id = t.id
           order by e.occurred_at desc, e.recorded_at desc, e.id desc
           limit 1),
         coalesce(pg_catalog.to_char(t.due_date, 'YYYY-MM-DD'), '-') || '|' || t.task_code
    from cdf_notifications_v13.task t
   where t.case_id = p_case_id
     and ((p_after_cursor is null and p_after_id is null)
          or exists (select 1 from anchor x
                      where case when x.due_date is null
                                 then t.due_date is null and (t.task_code, t.id) > (x.task_code, x.id)
                                 else t.due_date > x.due_date
                                      or t.due_date is null
                                      or (t.due_date = x.due_date and (t.task_code, t.id) > (x.task_code, x.id))
                            end))
   order by t.due_date nulls last, t.task_code, t.id
   limit cdf_notifications_v13._page_limit(p_limit)
$fn$;
comment on function cdf_notifications_v13.case_tasks_page(uuid, text, uuid, integer) is 'case_tasks one page at a time: keyset on (due_date nulls last, task_code, id) with both cursor values of the last row or neither; limit 1..100, refused otherwise. A half, malformed, stale or foreign cursor returns no rows, like an unknown or unauthorised case.';

create function cdf_notifications_v13.case_notifications_page(
  p_case_id      uuid,
  p_after_cursor text    default null,
  p_after_id     uuid    default null,
  p_limit        integer default 25)
returns table (
  notification_id uuid, case_id uuid, template_code text, template_version integer, language text,
  recipient_class text, lifecycle_status text, created_at timestamptz, row_version integer, page_cursor text)
language sql
stable
security invoker
set search_path = ''
as $fn$
  with anchor as (
    select a.created_at, a.id
      from cdf_notifications_v13.notification a
     where p_after_cursor is not null and p_after_id is not null
       and a.id = p_after_id and a.case_id = p_case_id
       and pg_catalog.to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = p_after_cursor)
  select n.id, n.case_id, t.code, tv.version, tv.language, n.recipient_class, n.lifecycle_status, n.created_at,
         n.row_version,
         pg_catalog.to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    from cdf_notifications_v13.notification n
    join cdf_notifications_v13.notification_template_version tv on tv.id = n.template_version_id
    join cdf_notifications_v13.notification_template t on t.id = tv.template_id
   where n.case_id = p_case_id
     and ((p_after_cursor is null and p_after_id is null)
          or exists (select 1 from anchor x
                      where n.created_at < x.created_at or (n.created_at = x.created_at and n.id > x.id)))
   order by n.created_at desc, n.id
   limit cdf_notifications_v13._page_limit(p_limit)
$fn$;
comment on function cdf_notifications_v13.case_notifications_page(uuid, text, uuid, integer) is 'case_notifications one page at a time: keyset on (created_at desc, id) with both cursor values of the last row or neither; limit 1..100, refused otherwise. A half, malformed, stale or foreign cursor returns no rows, like an unknown or unauthorised case.';

grant execute on function cdf_notifications_v13._page_limit(integer)                          to cdf_v13_user;
grant execute on function cdf_notifications_v13.case_events_page(uuid, text, uuid, integer)        to cdf_v13_user;
grant execute on function cdf_notifications_v13.case_tasks_page(uuid, text, uuid, integer)         to cdf_v13_user;
grant execute on function cdf_notifications_v13.case_notifications_page(uuid, text, uuid, integer) to cdf_v13_user;

reset role;
