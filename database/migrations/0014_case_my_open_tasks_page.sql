-- 0014_case_my_open_tasks_page — V13-DB-022 (REQ-PERF-003, OI-054): the caller's own open tasks on one case, one
-- bounded page at a time, for the Case Workspace overview's "My open tasks in this case" (V13-FE-014 switches to it).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- Rows: exactly the rows of case_tasks(p_case_id) (0006) for which is_mine is true and status is OPEN, IN_PROGRESS or
-- BLOCKED (the overview's filter, lib/server/case-workspace.ts), with case_tasks_page's columns (0011), page_cursor
-- included, so the FE reads one row shape.
-- Order: due_date nulls last, then task_code collate "C", then id (Chief Architect, ACCEPT of PROC-025 on #124): code
-- point order, so the overview's first row and the next-action card (nextActionForCase sorts by code point) agree on
-- any server, whatever its default collation. Under an ICU collation case_tasks' own task_code order can differ (AB_A
-- before ABB); with "C", ABB comes first.
--
-- Access: SECURITY INVOKER with search_path ''. It runs as cdf_v13_user, so the task policy (can_access_case) decides
-- which rows exist before the filter, cursor or limit; "mine" is the verified persona (current_persona_id()), never an
-- argument. No new access path. Unknown and unauthorised cases, and a caller without a verified persona, return no rows.
--
-- Paging (as 0011): pass both values of the last row seen (p_after_cursor = its page_cursor, p_after_id = its id), or
-- neither. The cursor row is looked up by id in the same case under RLS and must carry exactly that page_cursor; it need
-- not still be open or the caller's (a task finished between two pages does not end the list). A half, malformed, stale
-- or foreign cursor returns no rows. Limit 1..100, default 25; any other value (NULL included) is refused with 22023.
-- PRODUCTION_SUBSTITUTION_REQUIRED: production task data comes from the CDF platform through the adapters.

set local role cdf_v13_owner;

-- The read's keyset, for the caller's open tasks of a case.
create index task_case_assignee_open_idx on cdf_notifications_v13.task
  (case_id, assignee_persona_id, due_date, task_code collate "C", id)
  where status in ('OPEN', 'IN_PROGRESS', 'BLOCKED');
comment on index cdf_notifications_v13.task_case_assignee_open_idx is 'Keyset order of case_my_open_tasks_page (open tasks of one assignee in one case: due date, nulls last; task code in code point order; id).';

create function cdf_notifications_v13.case_my_open_tasks_page(
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
  with me as (
    select cdf_notifications_v13.current_persona_id() as persona_id),
  anchor as (
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
         true,
         t.status, t.due_date, t.row_version,
         (select e.id
            from cdf_notifications_v13.procedural_event e
           where e.case_id = t.case_id and e.subject_type = 'task' and e.subject_id = t.id
           order by e.occurred_at desc, e.recorded_at desc, e.id desc
           limit 1),
         coalesce(pg_catalog.to_char(t.due_date, 'YYYY-MM-DD'), '-') || '|' || t.task_code
    from cdf_notifications_v13.task t
    join me on t.assignee_persona_id = me.persona_id
   where t.case_id = p_case_id
     and t.status in ('OPEN', 'IN_PROGRESS', 'BLOCKED')
     and ((p_after_cursor is null and p_after_id is null)
          or exists (select 1 from anchor x
                      where case when x.due_date is null
                                 then t.due_date is null
                                      and (t.task_code collate "C", t.id) > (x.task_code collate "C", x.id)
                                 else t.due_date > x.due_date
                                      or t.due_date is null
                                      or (t.due_date = x.due_date
                                          and (t.task_code collate "C", t.id) > (x.task_code collate "C", x.id))
                            end))
   order by t.due_date nulls last, t.task_code collate "C", t.id
   limit cdf_notifications_v13._page_limit(p_limit)
$fn$;
comment on function cdf_notifications_v13.case_my_open_tasks_page(uuid, text, uuid, integer) is 'The verified persona''s open tasks (OPEN, IN_PROGRESS, BLOCKED) on one case, case_tasks_page''s columns, one page at a time: keyset on (due_date nulls last, task_code collate "C", id) with both cursor values of the last row or neither; limit 1..100, refused otherwise. A half, malformed, stale or foreign cursor returns no rows, like an unknown or unauthorised case.';

revoke execute on function cdf_notifications_v13.case_my_open_tasks_page(uuid, text, uuid, integer) from public;
grant execute on function cdf_notifications_v13.case_my_open_tasks_page(uuid, text, uuid, integer) to cdf_v13_user;

-- The access policy changed (a new function and its grant): record V13-ACCESS-0014. Last statement.
insert into cdf_notifications_v13.policy_version (version, fingerprint, migration)
values ('V13-ACCESS-0014', cdf_notifications_v13._policy_fingerprint(), '0014');

reset role;
