-- 0010_notification_operations_reads — V13-DB-015: the Notification Operations Center reads (UX S4, FE-006).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- notifications_page   one bounded page of notifications across every case the caller may see, newest first
-- notifications_count  the number of rows notifications_page would return over all its pages, same filters
--
-- Access: both are SECURITY INVOKER with search_path ''. They run as cdf_v13_user, so the RLS policies of 0002/0004
-- (can_access_case on notification, notification_event and case_record) decide which rows exist BEFORE any filter,
-- ordering, limit, count or per-row summary. That is the same access as the case Notifications tab
-- (case_notifications): a row appears here only if it appears in its case's tab. Unknown and unauthorised look alike.
-- Columns carry no person: no recipient, author or actor id, name or address (recipient_class only).
--
-- Filters (all optional, identical for page and count; NULL or '' = no filter; unknown values match nothing):
--   p_lifecycle_status   exact lifecycle code
--   p_template_code      exact template code
--   p_case_number        exact case display number, applied to authorised rows only; never a key (cases are keyed by
--                        case_id; an unseen case's number matches nothing, exactly like an unknown number)
--   p_created_from       created_at >= this instant
--   p_created_before     created_at <  this instant
-- Paging: keyset on (created_at desc, notification_id desc); pass both cursor values of the last row seen
-- (p_after_created_at = its created_at_cursor, p_after_id = its notification_id), or neither. One without the other
-- matches nothing (fail closed). created_at_cursor is the exact instant as TEXT in one fixed form
-- (YYYY-MM-DDTHH:MI:SS.ffffffZ, UTC, microseconds): a timestamptz parameter would pass through the driver's Date
-- (milliseconds) and skip rows that share a millisecond. A cursor text in any other form matches nothing.
-- Limit 1..100 (default 25).
-- Per row: last_event_at = the latest notification_event.occurred_at of the notification (rows the caller may read).
-- PRODUCTION_SUBSTITUTION_REQUIRED: production notification records come from the CDF platform through the adapters.

set local role cdf_v13_owner;

create index notification_created_idx
  on cdf_notifications_v13.notification (created_at desc, id desc);
comment on index cdf_notifications_v13.notification_created_idx is 'Keyset order of notifications_page (newest first, id as tie-breaker).';

create function cdf_notifications_v13.notifications_page(
  p_after_created_at text        default null,
  p_after_id         uuid        default null,
  p_limit            integer     default 25,
  p_lifecycle_status text        default null,
  p_template_code    text        default null,
  p_case_number      text        default null,
  p_created_from     timestamptz default null,
  p_created_before   timestamptz default null)
returns table (
  notification_id uuid, case_id uuid, case_number text, case_title_ar text, case_title_en text,
  template_code text, template_name_ar text, template_name_en text, template_version integer, language text,
  recipient_class text, lifecycle_status text, created_at timestamptz, created_at_cursor text,
  last_event_at timestamptz, row_version integer)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select n.id, n.case_id, c.display_number, c.title_ar, c.title_en,
         t.code, t.name_ar, t.name_en, tv.version, tv.language,
         n.recipient_class, n.lifecycle_status, n.created_at,
         pg_catalog.to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
         (select max(e.occurred_at)
            from cdf_notifications_v13.notification_event e
           where e.notification_id = n.id and e.case_id = n.case_id),
         n.row_version
    from cdf_notifications_v13.notification n
    join cdf_notifications_v13.case_record c on c.id = n.case_id
    join cdf_notifications_v13.notification_template_version tv on tv.id = n.template_version_id
    join cdf_notifications_v13.notification_template t on t.id = tv.template_id
   cross join (select case when p_after_created_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
                           then p_after_created_at::timestamptz end as at) cursor
   where ((p_after_created_at is null and p_after_id is null)
          or (n.created_at, n.id) < (cursor.at, p_after_id))
     and (p_lifecycle_status is null or p_lifecycle_status = '' or n.lifecycle_status = p_lifecycle_status)
     and (p_template_code is null or p_template_code = '' or t.code = p_template_code)
     and (p_case_number is null or p_case_number = '' or c.display_number = p_case_number)
     and (p_created_from is null or n.created_at >= p_created_from)
     and (p_created_before is null or n.created_at < p_created_before)
   order by n.created_at desc, n.id desc
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
$fn$;
comment on function cdf_notifications_v13.notifications_page(text, uuid, integer, text, text, text, timestamptz, timestamptz) is 'Notification Operations Center page (UX S4): authorised notifications across cases (RLS before filters, order, limit and summaries; same access as case_notifications). Keyset on (created_at desc, id desc) with both cursor values or neither; limit 1..100; filters lifecycle, template code, case display number (after authorisation, never a key), created range. No person columns.';

create function cdf_notifications_v13.notifications_count(
  p_lifecycle_status text        default null,
  p_template_code    text        default null,
  p_case_number      text        default null,
  p_created_from     timestamptz default null,
  p_created_before   timestamptz default null)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
  select count(*)
    from cdf_notifications_v13.notification n
    join cdf_notifications_v13.case_record c on c.id = n.case_id
    join cdf_notifications_v13.notification_template_version tv on tv.id = n.template_version_id
    join cdf_notifications_v13.notification_template t on t.id = tv.template_id
   where (p_lifecycle_status is null or p_lifecycle_status = '' or n.lifecycle_status = p_lifecycle_status)
     and (p_template_code is null or p_template_code = '' or t.code = p_template_code)
     and (p_case_number is null or p_case_number = '' or c.display_number = p_case_number)
     and (p_created_from is null or n.created_at >= p_created_from)
     and (p_created_before is null or n.created_at < p_created_before)
$fn$;
comment on function cdf_notifications_v13.notifications_count(text, text, text, timestamptz, timestamptz) is 'Count of authorised notifications matching exactly the notifications_page filters (never counts a notification the caller cannot see in its case tab).';

grant execute on function cdf_notifications_v13.notifications_page(text, uuid, integer, text, text, text, timestamptz, timestamptz) to cdf_v13_user;
grant execute on function cdf_notifications_v13.notifications_count(text, text, text, timestamptz, timestamptz) to cdf_v13_user;

reset role;
