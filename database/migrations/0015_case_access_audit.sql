-- 0015_case_access_audit — V13-DB-023 (REQ-AUD-001): opening a case, a restricted case or a notification preview
-- leaves one hash-chained audit row, written in the read's own transaction before the read.
-- Design accepted: docs/teams/db/DB-023_CASE_ACCESS_AUDIT.md (PR #137: SEC threat review ACCEPT 1b32f87 with Q1–Q3 and
-- binding points 1–6, comment 6554125758; Chief Architect decisions D1–D6, comment 6554193404; §9 Decisions).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- Write path B (§2): api_record_access(kind, case, notification) is called first, inside the header read's (or the
-- preview read's) own short transaction (D4). The read and its row commit together, or neither does (fail closed,
-- §2.3). It follows 0013's pattern: one command per transaction (_claim_command_slot), the body in an owner-only impl,
-- and a wrapper that turns V1401 / V1404 / V1422 into one id-less COMMAND_REFUSED row (Q3), identical for unknown and
-- unauthorised cases. Every other error propagates and nothing is served.
--
-- Rows (§4): CASE_OPENED / RESTRICTED_CASE_OPENED (entity case; restricted decided here from case_record at write time)
-- and NOTIFICATION_PREVIEW_OPENED (entity notification). Ids only; metadata {} or {"suppressed": n}; a check constraint
-- pins the shape. RESTRICTED_CASE_OPENED is never windowed (Q2): every restricted open is a row.
--
-- Bounding (§3): CASE_OPENED and NOTIFICATION_PREVIEW_OPENED keep one row per (persona, case, action, entity) per
-- ACCESS_AUDIT_WINDOW_SECONDS = 300 (DB-PROPOSED, SEC agreed). Later opens only increment access_window.suppressed (no
-- chain lock); the next row carries the count. A window row starts only together with a successful append in the same
-- transaction (SEC point 3). Known limit (SEC point 2): a count left in access_window with no later open never reaches
-- the ledger.
--
-- Replaces _append_audit_refused (allow-list gains api_record_access) and re-creates two check constraints with wider
-- allow-lists (refusal_window.command, the ledger's row shape). No data changes.
-- PRODUCTION_SUBSTITUTION_REQUIRED: access events go to the CDF SLS/SIEM through the audit sink port.

set local role cdf_v13_owner;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Window counters for access rows (owner only; updated only by _record_access_row).
-- ---------------------------------------------------------------------------------------------------------------------
create table cdf_notifications_v13.access_window (
  persona_id    uuid        not null,
  case_id       uuid        not null,
  action        text        not null check (action in ('CASE_OPENED', 'NOTIFICATION_PREVIEW_OPENED')),
  entity_id     uuid        not null,
  window_start  timestamptz not null,
  suppressed    integer     not null default 0 check (suppressed >= 0),
  primary key (persona_id, case_id, action, entity_id)
);
comment on table cdf_notifications_v13.access_window is 'Per (persona, case, action, entity): the start of the current access-audit window and how many opens it suppressed (V13-DB-023 §3). Restricted opens are never windowed. Owner only; ids only; no foreign keys (counters, never joined).';

alter table cdf_notifications_v13.access_window enable row level security;
create policy access_window_deny_all on cdf_notifications_v13.access_window
  as restrictive for all to public using (false) with check (false);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Wider allow-lists: the refusal counter and the ledger's row shape (0013 R4) now know the access command and rows.
-- ---------------------------------------------------------------------------------------------------------------------
alter table cdf_notifications_v13.refusal_window drop constraint refusal_window_command_check;
alter table cdf_notifications_v13.refusal_window
  add constraint refusal_window_command_check
  check (command in ('api_update_task_status', 'api_create_notification_draft', 'api_switch_workspace',
                     'api_record_access'));

alter table cdf_notifications_v13.audit_event drop constraint audit_event_refusal_shape_check;
alter table cdf_notifications_v13.audit_event
  add constraint audit_event_refusal_shape_check check (
    case
    when outcome = 'REFUSED' then
      action = 'COMMAND_REFUSED'
      and metadata ? 'command' and metadata ? 'refusal'
      and (metadata - 'command' - 'refusal' - 'suppressed') = '{}'::jsonb
      and (metadata ->> 'command') in ('api_update_task_status', 'api_create_notification_draft', 'api_switch_workspace',
                                       'api_record_access')
      and (metadata ->> 'refusal') in ('V1401', 'V1404', 'V1409', 'V1422', 'V1423')
      and (not (metadata ? 'suppressed')
           or (jsonb_typeof(metadata -> 'suppressed') = 'number' and (metadata ->> 'suppressed') ~ '^[1-9][0-9]{0,8}$'))
      and ((metadata ->> 'refusal') not in ('V1401', 'V1404') or (entity_id is null and case_id is null))
      and ((metadata ->> 'command') <> 'api_record_access'
           or ((metadata ->> 'refusal') in ('V1401', 'V1404', 'V1422') and entity_id is null and case_id is null))
      and (actor_persona_id is not null or (metadata ->> 'refusal') = 'V1401')
    when action in ('CASE_OPENED', 'RESTRICTED_CASE_OPENED', 'NOTIFICATION_PREVIEW_OPENED') then
      outcome = 'SUCCEEDED'
      and actor_persona_id is not null and case_id is not null and entity_id is not null
      and ((action in ('CASE_OPENED', 'RESTRICTED_CASE_OPENED') and entity_type = 'case' and entity_id = case_id)
           or (action = 'NOTIFICATION_PREVIEW_OPENED' and entity_type = 'notification'))
      and (metadata - 'suppressed') = '{}'::jsonb
      and (not (metadata ? 'suppressed')
           or (action <> 'RESTRICTED_CASE_OPENED'
               and jsonb_typeof(metadata -> 'suppressed') = 'number' and (metadata ->> 'suppressed') ~ '^[1-9][0-9]{0,8}$'))
    else
      action <> 'COMMAND_REFUSED' and not (metadata ? 'refusal') and not (metadata ? 'suppressed')
    end);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. The refused-row writer (0013) also records api_record_access, never with an id.
-- ---------------------------------------------------------------------------------------------------------------------
drop function cdf_notifications_v13._append_audit_refused(text, text, text, uuid, uuid);

create function cdf_notifications_v13._append_audit_refused(
  p_command text, p_refusal text, p_entity_type text, p_entity_id uuid, p_case_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_key       uuid := coalesce(cdf_notifications_v13.current_persona_id(), '00000000-0000-0000-0000-000000000000');
  v_window    timestamptz;
  v_carried   integer;
  v_entity    uuid := p_entity_id;
  v_case      uuid := p_case_id;
  v_meta      jsonb;
begin
  -- The §1 table: which command may record which code.
  if not ((p_command = 'api_update_task_status' and p_entity_type = 'task'
           and p_refusal in ('V1401', 'V1404', 'V1409', 'V1422', 'V1423'))
          or (p_command = 'api_create_notification_draft' and p_entity_type = 'notification'
              and p_refusal in ('V1401', 'V1404', 'V1409', 'V1422', 'V1423'))
          or (p_command = 'api_switch_workspace' and p_entity_type = 'workspace'
              and p_refusal in ('V1401', 'V1404'))
          or (p_command = 'api_record_access' and p_entity_type = 'case'                 -- 0015 (V13-DB-023)
              and p_refusal in ('V1401', 'V1404', 'V1422'))) then
    raise exception 'refusal not recordable' using errcode = 'V1422';
  end if;

  -- §4.1: no id on V1401 / V1404; otherwise ids only while the caller can access the case (re-checked here, R7).
  -- 0015: an access record's refusal never carries an id, whatever the code (DB-023 §2.2).
  if p_refusal in ('V1401', 'V1404') or p_command = 'api_record_access' or v_case is null
     or not cdf_notifications_v13.can_access_case(v_case) then
    v_entity := null;
    v_case := null;
  end if;

  -- §4.5: one row per key per window. The counter row is created once, then locked, so concurrent refusals for one
  -- key are counted exactly; the chain lock is taken only by the refusal that opens a window.
  insert into cdf_notifications_v13.refusal_window (actor_key, command, refusal, window_start, suppressed)
  values (v_key, p_command, p_refusal, '-infinity', 0)
  on conflict (actor_key, command, refusal) do nothing;
  select w.window_start, w.suppressed into v_window, v_carried
    from cdf_notifications_v13.refusal_window w
   where w.actor_key = v_key and w.command = p_command and w.refusal = p_refusal
   for update;
  if v_window > clock_timestamp() - interval '60 seconds' then          -- REFUSAL_AUDIT_WINDOW_SECONDS = 60
    update cdf_notifications_v13.refusal_window w
       set suppressed = w.suppressed + 1
     where w.actor_key = v_key and w.command = p_command and w.refusal = p_refusal;
    return;
  end if;
  update cdf_notifications_v13.refusal_window w
     set window_start = clock_timestamp(), suppressed = 0
   where w.actor_key = v_key and w.command = p_command and w.refusal = p_refusal;

  v_meta := jsonb_build_object('command', p_command, 'refusal', p_refusal);
  if v_carried > 0 then
    v_meta := v_meta || jsonb_build_object('suppressed', v_carried);
  end if;
  perform cdf_notifications_v13._append_audit_row('COMMAND_REFUSED', p_entity_type, v_entity, v_case, v_meta,
                                                  'REFUSED');
end
$fn$;
comment on function cdf_notifications_v13._append_audit_refused(text, text, text, uuid, uuid) is 'Internal: records one refused command (outcome REFUSED, action COMMAND_REFUSED, metadata command + refusal code [+ suppressed count]); ids only for V1409/V1422/V1423 and only while the caller can access the case, never for api_record_access; at most one row per (persona or none, command, code) per 60 s. Called only by the api_* wrappers. Never granted.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The access-row writer: windowed for CASE_OPENED and NOTIFICATION_PREVIEW_OPENED, never for restricted opens.
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13._record_access_row(
  p_action text, p_entity_type text, p_entity_id uuid, p_case_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_persona  uuid := cdf_notifications_v13.current_persona_id();
  v_window   timestamptz;
  v_carried  integer;
  v_meta     jsonb := '{}'::jsonb;
begin
  if v_persona is null or p_case_id is null or p_entity_id is null
     or not ((p_action in ('CASE_OPENED', 'RESTRICTED_CASE_OPENED') and p_entity_type = 'case' and p_entity_id = p_case_id)
             or (p_action = 'NOTIFICATION_PREVIEW_OPENED' and p_entity_type = 'notification')) then
    raise exception 'access row not recordable' using errcode = 'V1422';
  end if;

  -- Q2: every restricted open is a row.
  if p_action = 'RESTRICTED_CASE_OPENED' then
    perform cdf_notifications_v13._append_audit_row(p_action, p_entity_type, p_entity_id, p_case_id, v_meta,
                                                    'SUCCEEDED');
    return;
  end if;

  -- §3: one row per key per window. The counter row is created once, then locked, so concurrent opens for one key are
  -- counted exactly. It lives in this transaction, so a failed append below rolls it back too (SEC point 3).
  insert into cdf_notifications_v13.access_window (persona_id, case_id, action, entity_id, window_start, suppressed)
  values (v_persona, p_case_id, p_action, p_entity_id, '-infinity', 0)
  on conflict (persona_id, case_id, action, entity_id) do nothing;
  select w.window_start, w.suppressed into v_window, v_carried
    from cdf_notifications_v13.access_window w
   where w.persona_id = v_persona and w.case_id = p_case_id and w.action = p_action and w.entity_id = p_entity_id
   for update;
  if v_window > clock_timestamp() - interval '300 seconds' then        -- ACCESS_AUDIT_WINDOW_SECONDS = 300
    update cdf_notifications_v13.access_window w
       set suppressed = w.suppressed + 1
     where w.persona_id = v_persona and w.case_id = p_case_id and w.action = p_action and w.entity_id = p_entity_id;
    return;
  end if;

  if v_carried > 0 then
    v_meta := jsonb_build_object('suppressed', v_carried);
  end if;
  perform cdf_notifications_v13._append_audit_row(p_action, p_entity_type, p_entity_id, p_case_id, v_meta,
                                                  'SUCCEEDED');
  update cdf_notifications_v13.access_window w
     set window_start = clock_timestamp(), suppressed = 0
   where w.persona_id = v_persona and w.case_id = p_case_id and w.action = p_action and w.entity_id = p_entity_id;
end
$fn$;
comment on function cdf_notifications_v13._record_access_row(text, text, uuid, uuid) is 'Internal: appends one access row (CASE_OPENED, RESTRICTED_CASE_OPENED, NOTIFICATION_PREVIEW_OPENED; ids only; metadata {} or {suppressed}). Restricted opens always append; the other two at most once per (persona, case, action, entity) per 300 s, later opens counted. Called only by _api_record_access_impl. Never granted.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The command: body in an owner-only impl, the wrapper as in 0013.
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13._api_record_access_impl(
  p_kind text, p_case_id uuid, p_notification_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_restricted boolean;
begin
  if cdf_notifications_v13.current_persona_id() is null then
    raise exception 'no valid context' using errcode = 'V1401';
  end if;
  -- The argument only selects the action; it is never copied into a row. Checked before any id is looked at, so the
  -- answer cannot depend on whether the case exists.
  if p_kind is null or p_case_id is null
     or not ((p_kind = 'CASE' and p_notification_id is null)
             or (p_kind = 'NOTIFICATION_PREVIEW' and p_notification_id is not null)) then
    raise exception 'invalid access kind' using errcode = 'V1422';
  end if;
  -- Unknown and unauthorised alike (§4).
  if not cdf_notifications_v13.can_access_case(p_case_id) then
    raise exception 'not found' using errcode = 'V1404';
  end if;

  if p_kind = 'CASE' then
    select c.is_restricted into strict v_restricted
      from cdf_notifications_v13.case_record c
     where c.id = p_case_id;
    perform cdf_notifications_v13._record_access_row(
      case when v_restricted then 'RESTRICTED_CASE_OPENED' else 'CASE_OPENED' end, 'case', p_case_id, p_case_id);
    return;
  end if;

  -- The notification policy is can_access_case(case_id) (0004), checked above; the notification must be this case's.
  -- An unknown id and another case's notification answer the same V1404 (SEC point 4).
  if not exists (select 1 from cdf_notifications_v13.notification n
                  where n.id = p_notification_id and n.case_id = p_case_id) then
    raise exception 'not found' using errcode = 'V1404';
  end if;
  perform cdf_notifications_v13._record_access_row('NOTIFICATION_PREVIEW_OPENED', 'notification', p_notification_id,
                                                   p_case_id);
end
$fn$;
comment on function cdf_notifications_v13._api_record_access_impl(text, uuid, uuid) is 'Internal: the body of api_record_access. Never granted.';

create function cdf_notifications_v13.api_record_access(
  p_kind text, p_case_id uuid, p_notification_id uuid default null)
returns table (refusal text)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_code text;
begin
  if not cdf_notifications_v13._claim_command_slot() then
    refusal := 'V1500';                                   -- 0013 R1: not recorded
    return next;
    return;
  end if;
  begin
    perform cdf_notifications_v13._api_record_access_impl(p_kind, p_case_id, p_notification_id);
  exception
    when sqlstate 'V1401' or sqlstate 'V1404' or sqlstate 'V1422' then
      v_code := pg_catalog.left(sqlstate, 5);             -- the code only, never the message
  end;
  if v_code is not null then
    -- Never an id (§4): unknown, unauthorised and malformed requests leave the same row shape.
    perform cdf_notifications_v13._append_audit_refused('api_record_access', v_code, 'case', null, null);
  end if;
  refusal := v_code;
  return next;
end
$fn$;
comment on function cdf_notifications_v13.api_record_access(text, uuid, uuid) is 'Command: records that the verified persona opened a case (kind CASE: CASE_OPENED, or RESTRICTED_CASE_OPENED for a restricted case) or a notification preview of that case (kind NOTIFICATION_PREVIEW), ids only. Called first, in the read''s own transaction, so the read and its row commit together (V13-DB-023). Returns one row: refusal NULL, or V1401 / V1404 (unknown and unauthorised alike) / V1422 with one id-less REFUSED row; V1500 when the transaction already ran a command. Never says whether a row was written or suppressed.';

revoke execute on function cdf_notifications_v13._append_audit_refused(text, text, text, uuid, uuid) from public;
revoke execute on function cdf_notifications_v13._record_access_row(text, text, uuid, uuid) from public;
revoke execute on function cdf_notifications_v13._api_record_access_impl(text, uuid, uuid) from public;
revoke execute on function cdf_notifications_v13.api_record_access(text, uuid, uuid) from public;
grant execute on function cdf_notifications_v13.api_record_access(text, uuid, uuid) to cdf_v13_user;

-- The access policy changed (a new table, functions and a grant): record V13-ACCESS-0015. Last statement.
insert into cdf_notifications_v13.policy_version (version, fingerprint, migration)
values ('V13-ACCESS-0015', cdf_notifications_v13._policy_fingerprint(), '0015');

reset role;
