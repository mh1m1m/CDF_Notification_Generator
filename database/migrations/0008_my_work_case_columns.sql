-- 0008_my_work_case_columns — V13-DB-010: My Work rows carry the case title, the records state and the status event
-- (FE-005; ARCH request 31 Oct).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- my_work_tasks(p_include_closed) keeps its argument, its nine columns, its row set and its order, and appends four:
--   case_title_ar, case_title_en  the case's titles
--   case_records_state            the case's records state; a UI hint only, the commands' V1423 stays the authority
--   status_event_id               the latest procedural event about the task, or NULL; same definition as case_tasks
--                                 (0006): subject_type 'task', newest by occurred_at, recorded_at, id
-- Still SECURITY INVOKER with search_path '': it runs as cdf_v13_user, so RLS (can_access_case on task, case_record and
-- procedural_event) keeps rows to the current persona's own tasks in cases visible in the current workspace. The new
-- columns come from rows the caller may already read. Redefined because the result type grows (DROP + CREATE in one
-- transaction; the runner applies each migration in one transaction).
-- PRODUCTION_SUBSTITUTION_REQUIRED: production takes cases and tasks from the CDF case system through
-- CaseSourceAdapter.

set local role cdf_v13_owner;

drop function cdf_notifications_v13.my_work_tasks(boolean);

create function cdf_notifications_v13.my_work_tasks(p_include_closed boolean default false)
returns table (
  task_id uuid, case_id uuid, display_number text, task_code text, title_ar text, title_en text,
  status text, due_date date, row_version integer,
  case_title_ar text, case_title_en text, case_records_state text, status_event_id uuid)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select t.id, t.case_id, c.display_number, t.task_code, t.title_ar, t.title_en, t.status, t.due_date, t.row_version,
         c.title_ar, c.title_en, c.records_state,
         (select e.id
            from cdf_notifications_v13.procedural_event e
           where e.case_id = t.case_id and e.subject_type = 'task' and e.subject_id = t.id
           order by e.occurred_at desc, e.recorded_at desc, e.id desc
           limit 1)
    from cdf_notifications_v13.task t
    join cdf_notifications_v13.case_record c on c.id = t.case_id
   where t.assignee_persona_id = cdf_notifications_v13.current_persona_id()
     and (p_include_closed or t.status not in ('DONE', 'CANCELLED'))
   order by t.due_date nulls last, c.display_number, t.task_code
$fn$;
comment on function cdf_notifications_v13.my_work_tasks(boolean) is 'My Work: the current persona''s tasks in cases visible to it in the current workspace, with the case titles, the records state (UI hint only) and the event that set the current status.';

grant execute on function cdf_notifications_v13.my_work_tasks(boolean) to cdf_v13_user;

reset role;
