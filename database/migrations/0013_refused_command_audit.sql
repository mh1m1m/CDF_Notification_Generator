-- 0013_refused_command_audit — V13-DB-021 (REQ-AUD-005): a refused command leaves one REFUSED, hash-chained audit row.
-- Design accepted: docs/teams/db/DB-021_REFUSED_COMMAND_AUDIT.md (PR #120: SEC threat review ACCEPT f1eb959, ARCH ACCEPT
-- 26024a9). SEC's required items R1–R7 (#120 comment 6553371697) are marked where they are met.
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- Write path C: each command's body moves, unchanged, into an internal _<command>_impl. The api_* wrapper runs it in a
-- PL/pgSQL block with an EXCEPTION clause, so PostgreSQL runs it as a subtransaction:
--   - the impl succeeds: the wrapper returns its row with refusal NULL;
--   - the impl raises V1401, V1404, V1409, V1422 or V1423 (named exactly, R2): the subtransaction is rolled back (every
--     row it wrote, every row lock and every advisory lock it took is gone, R6), the wrapper appends one REFUSED row
--     through _append_audit_refused and returns a row whose only non-null column is refusal; the caller's transaction
--     commits that row;
--   - any other error propagates unchanged and nothing is recorded.
-- No caller supplies a code, an id or a command name to the ledger, and no new function is granted to cdf_v13_user.
--
-- One command per transaction (R1): every api_* function, api_install_claims_key included, takes a transaction-level
-- advisory lock keyed by the backend pid in the V13 namespace and refuses when this transaction already holds it. The
-- request role cannot release a transaction-level advisory lock, so the mark cannot be removed; rolling back to a
-- savepoint releases it together with everything the earlier command did. A second wrapped command returns refusal
-- V1500 (not recorded); a second api_install_claims_key raises V1500.
--
-- Flooding (§4.5): one REFUSED row per (persona or none, command, code) per REFUSAL_AUDIT_WINDOW_SECONDS = 60 (a
-- DB-proposed value). Later refusals in the window only increment refusal_window.suppressed (no chain lock, no ledger
-- row); the next window's row carries that count in its metadata.
--
-- Targets (§4.1): V1401 and V1404 rows never carry an id. Other codes carry the target and its case only when
-- can_access_case(case) holds when the row is written (R7). A check constraint pins the shape of every row (R4).
-- Readers (§4.4): none added; the ledger stays owner-only.
-- PRODUCTION_SUBSTITUTION_REQUIRED: CDF SLS/SIEM ledger; an upstream rate limit behind the RateLimiter port.

set local role cdf_v13_owner;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Window counters (owner only; updated only by _append_audit_refused).
-- ---------------------------------------------------------------------------------------------------------------------
create table cdf_notifications_v13.refusal_window (
  actor_key     uuid        not null,   -- the persona, or the nil UUID when there is no verified persona
  command       text        not null check (command in ('api_update_task_status', 'api_create_notification_draft',
                                                        'api_switch_workspace')),
  refusal       text        not null check (refusal in ('V1401', 'V1404', 'V1409', 'V1422', 'V1423')),
  window_start  timestamptz not null,
  suppressed    integer     not null default 0 check (suppressed >= 0),
  primary key (actor_key, command, refusal)
);
comment on table cdf_notifications_v13.refusal_window is 'Per (persona or none, command, refusal code): the start of the current audit window and how many refusals it suppressed (V13-DB-021 §4.5). Owner only; ids and codes only.';

alter table cdf_notifications_v13.refusal_window enable row level security;
create policy refusal_window_deny_all on cdf_notifications_v13.refusal_window
  as restrictive for all to public using (false) with check (false);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. The shape of every ledger row (R4). Existing rows are SUCCEEDED with no refusal or suppressed key.
-- ---------------------------------------------------------------------------------------------------------------------
alter table cdf_notifications_v13.audit_event
  add constraint audit_event_refusal_shape_check check (
    case when outcome = 'REFUSED' then
      action = 'COMMAND_REFUSED'
      and metadata ? 'command' and metadata ? 'refusal'
      and (metadata - 'command' - 'refusal' - 'suppressed') = '{}'::jsonb
      and (metadata ->> 'command') in ('api_update_task_status', 'api_create_notification_draft', 'api_switch_workspace')
      and (metadata ->> 'refusal') in ('V1401', 'V1404', 'V1409', 'V1422', 'V1423')
      and (not (metadata ? 'suppressed')
           or (jsonb_typeof(metadata -> 'suppressed') = 'number' and (metadata ->> 'suppressed') ~ '^[1-9][0-9]{0,8}$'))
      and ((metadata ->> 'refusal') not in ('V1401', 'V1404') or (entity_id is null and case_id is null))
      and (actor_persona_id is not null or (metadata ->> 'refusal') = 'V1401')
    else
      action <> 'COMMAND_REFUSED' and not (metadata ? 'refusal') and not (metadata ? 'suppressed')
    end);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. One shared append (private helper), the SUCCEEDED writer re-created on it, and the REFUSED writer.
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13._append_audit_row(
  p_action text, p_entity_type text, p_entity_id uuid, p_case_id uuid, p_metadata jsonb, p_outcome text)
returns uuid
language plpgsql
volatile
security invoker
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
  v_policy  text;
begin
  if p_outcome is null or p_outcome not in ('SUCCEEDED', 'REFUSED') then
    raise exception 'invalid audit outcome' using errcode = 'V1422';
  end if;
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
     v_meta, v_prev, 2, p_outcome, v_policy,
     cdf_notifications_v13._audit_row_hash_v2(v_seq, v_at, v_actor, v_ws, p_action, p_entity_type, p_entity_id,
                                              p_case_id, v_corr, p_outcome, v_policy, v_meta, v_prev));
  return v_id;
end
$fn$;
comment on function cdf_notifications_v13._append_audit_row(text, text, uuid, uuid, jsonb, text) is 'Internal: the one hash-chained append (hash version 2, chain lock, highest policy version), shared by _append_audit (SUCCEEDED) and _append_audit_refused (REFUSED). Invoker: it runs as the owner only through those two writers. Never granted.';

drop function cdf_notifications_v13._append_audit(text, text, uuid, uuid, jsonb);

create function cdf_notifications_v13._append_audit(
  p_action text, p_entity_type text, p_entity_id uuid, p_case_id uuid, p_metadata jsonb default '{}'::jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  -- A committed command. REFUSED rows come only from _append_audit_refused.
  return cdf_notifications_v13._append_audit_row(p_action, p_entity_type, p_entity_id, p_case_id, p_metadata,
                                                 'SUCCEEDED');
end
$fn$;
comment on function cdf_notifications_v13._append_audit(text, text, uuid, uuid, jsonb) is 'Internal: appends one hash-chained audit row (hash version 2) in the caller''s transaction; correlation id from the verified claims only; outcome SUCCEEDED and the highest recorded access-policy version, never from a caller. Callable only by cdf_v13_owner (commands).';

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
              and p_refusal in ('V1401', 'V1404'))) then
    raise exception 'refusal not recordable' using errcode = 'V1422';
  end if;

  -- §4.1: no id on V1401 / V1404; otherwise ids only while the caller can access the case (re-checked here, R7).
  if p_refusal in ('V1401', 'V1404') or v_case is null or not cdf_notifications_v13.can_access_case(v_case) then
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
comment on function cdf_notifications_v13._append_audit_refused(text, text, text, uuid, uuid) is 'Internal: records one refused command (outcome REFUSED, action COMMAND_REFUSED, metadata command + refusal code [+ suppressed count]); ids only for V1409/V1422/V1423 and only while the caller can access the case; at most one row per (persona or none, command, code) per 60 s. Called only by the api_* wrappers. Never granted.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. One command per transaction (R1).
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13._claim_command_slot()
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
begin
  -- Already held by this transaction: a command has run in it.
  if exists (select 1
               from pg_catalog.pg_locks l
              where l.locktype = 'advisory' and l.pid = pg_catalog.pg_backend_pid() and l.granted
                and l.classid::bigint = (pg_catalog.hashtext('cdf_notifications_v13')::bigint & 4294967295)
                and l.objid::bigint = pg_catalog.pg_backend_pid()::bigint
                and l.objsubid = 2) then
    return false;
  end if;
  -- Keyed by this backend, so it never waits on another session; released only when the transaction (or the
  -- savepoint around the command) ends.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'), pg_catalog.pg_backend_pid());
  return true;
end
$fn$;
comment on function cdf_notifications_v13._claim_command_slot() is 'Internal: true for the first api_* command of a transaction (takes a transaction-level advisory lock keyed by the backend pid in the V13 namespace), false when this transaction already ran one. Never granted.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The command bodies, moved unchanged into owner-only impl functions (only the name differs).
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13._api_install_claims_key_impl(p_key bytea)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_existing bytea;
  v_k        bytea;
  v_ipad     bytea;
  v_opad     bytea;
  i          integer;
begin
  if p_key is null or length(p_key) <> 32 then
    raise exception 'invalid key' using errcode = 'V1422';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'), 2);
  select k.key_sha256 into v_existing from cdf_notifications_v13.claims_key k where k.key_version = 1;
  if found then
    if v_existing = pg_catalog.sha256(p_key) then
      return 'ALREADY_INSTALLED';
    end if;
    raise exception 'a different key is installed' using errcode = 'V1409';
  end if;
  v_k := p_key || pg_catalog.decode(repeat('00', 32), 'hex');      -- pad to the 64-byte SHA-256 block
  v_ipad := v_k;
  v_opad := v_k;
  for i in 0 .. 63 loop
    v_ipad := pg_catalog.set_byte(v_ipad, i, pg_catalog.get_byte(v_k, i) # 54);   -- 0x36
    v_opad := pg_catalog.set_byte(v_opad, i, pg_catalog.get_byte(v_k, i) # 92);   -- 0x5c
  end loop;
  insert into cdf_notifications_v13.claims_key (key_version, ipad_key, opad_key, key_sha256)
  values (1, v_ipad, v_opad, pg_catalog.sha256(p_key));
  perform cdf_notifications_v13._append_audit('CLAIMS_KEY_INSTALLED', 'claims_key', null, null,
    jsonb_build_object('key_version', 1));
  return 'INSTALLED';
end
$fn$;
comment on function cdf_notifications_v13._api_install_claims_key_impl(bytea) is 'Internal: the body of api_install_claims_key (0001), unchanged. Never granted.';

create function cdf_notifications_v13._api_update_task_status_impl(
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

  -- Access first, without a lock: a caller without access never waits on, or locks, a task row (no timing signal).
  -- Unknown and unauthorised are the same answer.
  select t.* into v_task from cdf_notifications_v13.task t where t.id = p_task_id;
  if not found or not cdf_notifications_v13.can_access_case(v_task.case_id) then
    raise exception 'not found' using errcode = 'V1404';
  end if;
  if not (v_task.assignee_persona_id = v_persona or cdf_notifications_v13.is_assigned_to_case(v_task.case_id)) then
    raise exception 'not found' using errcode = 'V1404';
  end if;

  -- Then lock and re-read; the version, state and transition checks below use the locked row, and the assignee rule
  -- is checked again on it.
  select t.* into v_task from cdf_notifications_v13.task t where t.id = p_task_id for update;
  if not found
     or not (v_task.assignee_persona_id = v_persona or cdf_notifications_v13.is_assigned_to_case(v_task.case_id)) then
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
comment on function cdf_notifications_v13._api_update_task_status_impl(uuid, text, integer) is 'Internal: the body of api_update_task_status (0003), unchanged. Never granted.';

create function cdf_notifications_v13._api_create_notification_draft_impl(
  p_case_id              uuid,
  p_template_version_id  uuid,
  p_recipient_class      text,
  p_idempotency_key      text)
returns table (notification_id uuid, case_id uuid, lifecycle_status text, row_version integer)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_persona uuid := cdf_notifications_v13.current_persona_id();
  v_state   text;
  v_id      uuid;
begin
  if v_persona is null or cdf_notifications_v13.current_workspace_id() is null then
    raise exception 'no valid context' using errcode = 'V1401';
  end if;
  if p_case_id is null or not cdf_notifications_v13.can_access_case(p_case_id) then
    raise exception 'not found' using errcode = 'V1404';
  end if;
  if not (cdf_notifications_v13.has_role('COMMITTEE_SECRETARY') or cdf_notifications_v13.has_role('INVESTIGATOR')) then
    raise exception 'not found' using errcode = 'V1404';
  end if;

  select c.records_state into v_state from cdf_notifications_v13.case_record c where c.id = p_case_id for share;
  if v_state <> 'ACTIVE' then
    raise exception 'case closed' using errcode = 'V1423';
  end if;

  if p_idempotency_key is null or p_idempotency_key !~ '^[0-9a-f]{64}$'
     or p_recipient_class is null
     or not exists (select 1 from cdf_notifications_v13.notification_recipient_class r where r.code = p_recipient_class)
     or not exists (select 1
                      from cdf_notifications_v13.notification_template_version tv
                      join cdf_notifications_v13.notification_template t on t.id = tv.template_id
                     where tv.id = p_template_version_id and t.is_active) then
    raise exception 'invalid input' using errcode = 'V1422';
  end if;

  -- Serialise on (author, key) so a concurrent duplicate gets V1409 rather than a raw unique violation. Only the
  -- caller's own keys count: another persona's key, on any case, gives no signal.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'),
                                           pg_catalog.hashtext('notification:' || v_persona::text || ':' || p_idempotency_key));
  if exists (select 1 from cdf_notifications_v13.notification n
              where n.created_by_persona_id = v_persona and n.idempotency_key = p_idempotency_key) then
    raise exception 'duplicate idempotency key' using errcode = 'V1409';
  end if;

  insert into cdf_notifications_v13.notification
    (case_id, template_version_id, recipient_class, lifecycle_status, idempotency_key, created_by_persona_id)
  values
    (p_case_id, p_template_version_id, p_recipient_class, 'DRAFT', p_idempotency_key, v_persona)
  returning id into v_id;

  insert into cdf_notifications_v13.notification_event (notification_id, case_id, event_code, actor_persona_id)
  values (v_id, p_case_id, 'DRAFT_CREATED', v_persona);

  perform cdf_notifications_v13._append_audit('NOTIFICATION_DRAFT_CREATED', 'notification', v_id, p_case_id,
    jsonb_build_object('template_version_id', p_template_version_id, 'recipient_class', p_recipient_class));

  notification_id := v_id; case_id := p_case_id; lifecycle_status := 'DRAFT'; row_version := 1;
  return next;
end
$fn$;
comment on function cdf_notifications_v13._api_create_notification_draft_impl(uuid, uuid, text, text) is 'Internal: the body of api_create_notification_draft (0004), unchanged. Never granted.';

create function cdf_notifications_v13._api_switch_workspace_impl(p_workspace_id uuid)
returns table (workspace_id uuid, workspace_code text, role_codes text[])
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_persona uuid := cdf_notifications_v13.current_persona_id();
  v_from    uuid := cdf_notifications_v13.current_workspace_id();
  v_code    text;
  v_roles   text[];
begin
  if v_persona is null then
    raise exception 'no valid context' using errcode = 'V1401';
  end if;
  if p_workspace_id is null then
    raise exception 'not found' using errcode = 'V1404';
  end if;

  select w.code, array_agg(distinct r.code order by r.code)
    into v_code, v_roles
    from cdf_notifications_v13.workspace w
    join cdf_notifications_v13.persona_workspace_membership m
      on m.workspace_id = w.id
     and m.persona_id = v_persona
     and m.valid_from <= now()
     and (m.valid_to is null or m.valid_to > now())
    join cdf_notifications_v13.role r on r.id = m.role_id
   where w.id = p_workspace_id
     and w.is_active
   group by w.code;
  if v_code is null then
    raise exception 'not found' using errcode = 'V1404';
  end if;

  perform cdf_notifications_v13._append_audit('WORKSPACE_SWITCHED', 'workspace', p_workspace_id, null,
    jsonb_build_object('from_workspace_id', v_from, 'to_workspace_id', p_workspace_id));

  workspace_id := p_workspace_id; workspace_code := v_code; role_codes := v_roles;
  return next;
end
$fn$;
comment on function cdf_notifications_v13._api_switch_workspace_impl(uuid) is 'Internal: the body of api_switch_workspace (0005), unchanged. Never granted.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. The commands: same arguments and grants; the three request-time commands gain a refusal column.
-- ---------------------------------------------------------------------------------------------------------------------
drop function cdf_notifications_v13.api_install_claims_key(bytea);

create function cdf_notifications_v13.api_install_claims_key(p_key bytea)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  -- Takes part in R1 like every api_* function. It records no refusal (a server-start step with no persona): its
  -- refusals (V1422, V1409) and a second command in the transaction (V1500) raise.
  if not cdf_notifications_v13._claim_command_slot() then
    raise exception 'one command per transaction' using errcode = 'V1500';
  end if;
  return cdf_notifications_v13._api_install_claims_key_impl(p_key);
end
$fn$;
comment on function cdf_notifications_v13.api_install_claims_key(bytea) is 'Command: installs the 32-byte claims HMAC key while none exists (ADR-014). Same key again: ALREADY_INSTALLED. Other key: V1409. Audited as CLAIMS_KEY_INSTALLED without key material. One command per transaction (V1500 otherwise).';

drop function cdf_notifications_v13.api_update_task_status(uuid, text, integer);

create function cdf_notifications_v13.api_update_task_status(
  p_task_id          uuid,
  p_new_status       text,
  p_expected_version integer)
returns table (task_id uuid, case_id uuid, status text, row_version integer, refusal text)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_row   record;
  v_code  text;
  v_case  uuid;
begin
  if not cdf_notifications_v13._claim_command_slot() then
    refusal := 'V1500';                                   -- R1: not recorded
    return next;
    return;
  end if;
  begin
    select i.task_id, i.case_id, i.status, i.row_version into strict v_row
      from cdf_notifications_v13._api_update_task_status_impl(p_task_id, p_new_status, p_expected_version) i;
  exception
    when sqlstate 'V1401' or sqlstate 'V1404' or sqlstate 'V1409' or sqlstate 'V1422' or sqlstate 'V1423' then
      v_code := pg_catalog.left(sqlstate, 5);             -- R2: the code only, never the message
  end;
  if v_code is null then
    task_id := v_row.task_id; case_id := v_row.case_id; status := v_row.status; row_version := v_row.row_version;
    return next;
    return;
  end if;
  select t.case_id into v_case from cdf_notifications_v13.task t where t.id = p_task_id;
  perform cdf_notifications_v13._append_audit_refused('api_update_task_status', v_code, 'task', p_task_id, v_case);
  refusal := v_code;
  return next;
end
$fn$;
comment on function cdf_notifications_v13.api_update_task_status(uuid, text, integer) is 'Command: change a task''s status (assignee or case-assigned persona; active case; expected row_version; allowed transition). Writes task, procedural event and audit event in one transaction. A refusal returns one row with only refusal set (V1401, V1404 for unknown and unauthorised alike, V1409, V1422, V1423) and records one REFUSED audit row; V1500 when the transaction already ran a command.';

drop function cdf_notifications_v13.api_create_notification_draft(uuid, uuid, text, text);

create function cdf_notifications_v13.api_create_notification_draft(
  p_case_id              uuid,
  p_template_version_id  uuid,
  p_recipient_class      text,
  p_idempotency_key      text)
returns table (notification_id uuid, case_id uuid, lifecycle_status text, row_version integer, refusal text)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_row   record;
  v_code  text;
begin
  if not cdf_notifications_v13._claim_command_slot() then
    refusal := 'V1500';                                   -- R1: not recorded
    return next;
    return;
  end if;
  begin
    select i.notification_id, i.case_id, i.lifecycle_status, i.row_version into strict v_row
      from cdf_notifications_v13._api_create_notification_draft_impl(p_case_id, p_template_version_id,
                                                                     p_recipient_class, p_idempotency_key) i;
  exception
    when sqlstate 'V1401' or sqlstate 'V1404' or sqlstate 'V1409' or sqlstate 'V1422' or sqlstate 'V1423' then
      v_code := pg_catalog.left(sqlstate, 5);             -- R2: the code only, never the message
  end;
  if v_code is null then
    notification_id := v_row.notification_id; case_id := v_row.case_id;
    lifecycle_status := v_row.lifecycle_status; row_version := v_row.row_version;
    return next;
    return;
  end if;
  -- No notification exists for a refused draft: the target is the case alone.
  perform cdf_notifications_v13._append_audit_refused('api_create_notification_draft', v_code, 'notification', null,
                                                      p_case_id);
  refusal := v_code;
  return next;
end
$fn$;
comment on function cdf_notifications_v13.api_create_notification_draft(uuid, uuid, text, text) is 'Command: create a DRAFT notification for an authorised ACTIVE case (secretary or investigator role). Idempotency key used once per author (V1409); another persona''s key gives no signal. Writes notification, notification event and audit event in one transaction. A refusal returns one row with only refusal set and records one REFUSED audit row; V1500 when the transaction already ran a command.';

drop function cdf_notifications_v13.api_switch_workspace(uuid);

create function cdf_notifications_v13.api_switch_workspace(p_workspace_id uuid)
returns table (workspace_id uuid, workspace_code text, role_codes text[], refusal text)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_row   record;
  v_code  text;
begin
  if not cdf_notifications_v13._claim_command_slot() then
    refusal := 'V1500';                                   -- R1: not recorded
    return next;
    return;
  end if;
  begin
    select i.workspace_id, i.workspace_code, i.role_codes into strict v_row
      from cdf_notifications_v13._api_switch_workspace_impl(p_workspace_id) i;
  exception
    when sqlstate 'V1401' or sqlstate 'V1404' then
      v_code := pg_catalog.left(sqlstate, 5);             -- R2: the code only, never the message
  end;
  if v_code is null then
    workspace_id := v_row.workspace_id; workspace_code := v_row.workspace_code; role_codes := v_row.role_codes;
    return next;
    return;
  end if;
  -- V1401 / V1404 only: never an id (§4.1).
  perform cdf_notifications_v13._append_audit_refused('api_switch_workspace', v_code, 'workspace', null, null);
  refusal := v_code;
  return next;
end
$fn$;
comment on function cdf_notifications_v13.api_switch_workspace(uuid) is 'Command: confirm and audit a switch of the verified persona to a workspace where it holds an active membership (WORKSPACE_SWITCHED, ids only). Returns the target workspace and the persona''s roles there. A refusal (V1401 without a verified persona; V1404 for any unusable target) returns one row with only refusal set and records one REFUSED audit row; V1500 when the transaction already ran a command.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Grants (R3). The commands keep exactly their old grants; nothing internal is executable by PUBLIC or any role.
-- ---------------------------------------------------------------------------------------------------------------------
revoke execute on function cdf_notifications_v13._append_audit_row(text, text, uuid, uuid, jsonb, text) from public;
revoke execute on function cdf_notifications_v13._append_audit(text, text, uuid, uuid, jsonb) from public;
revoke execute on function cdf_notifications_v13._append_audit_refused(text, text, text, uuid, uuid) from public;
revoke execute on function cdf_notifications_v13._claim_command_slot() from public;
revoke execute on function cdf_notifications_v13._api_install_claims_key_impl(bytea) from public;
revoke execute on function cdf_notifications_v13._api_update_task_status_impl(uuid, text, integer) from public;
revoke execute on function cdf_notifications_v13._api_create_notification_draft_impl(uuid, uuid, text, text) from public;
revoke execute on function cdf_notifications_v13._api_switch_workspace_impl(uuid) from public;

grant execute on function cdf_notifications_v13.api_install_claims_key(bytea) to cdf_v13_user;
grant execute on function cdf_notifications_v13.api_update_task_status(uuid, text, integer) to cdf_v13_user;
grant execute on function cdf_notifications_v13.api_create_notification_draft(uuid, uuid, text, text) to cdf_v13_user;
grant execute on function cdf_notifications_v13.api_switch_workspace(uuid) to cdf_v13_user;

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. The access policy changed (new functions, table, policy, grants): record V13-ACCESS-0013. Last statement.
-- ---------------------------------------------------------------------------------------------------------------------
insert into cdf_notifications_v13.policy_version (version, fingerprint, migration)
values ('V13-ACCESS-0013', cdf_notifications_v13._policy_fingerprint(), '0013');

reset role;
