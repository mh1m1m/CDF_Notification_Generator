-- 0004_notification_core — templates and immutable versions, case-keyed notifications, notification events,
-- api_create_notification_draft, content-free dispatch outbox (V13-DB-004).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- Invariants enforced here (not only in the app):
--   * A notification belongs to exactly one case. Its case_id is copied by the command from the authorised case; every
--     notification_event and outbox row carries the same case_id through a composite foreign key, so a row can never
--     point at one case's notification under another case's id.
--   * Template versions are immutable; their content hash is computed by the database.
--   * An idempotency key is used once: a second draft with the same key is refused (V1409).
--   * The outbox is content-free (no subject, body or address) and unreadable by cdf_v13_user (ADR-010, used from M5).
-- PRODUCTION_SUBSTITUTION_REQUIRED: the approved CDF mail gateway and scheduler (ADR-010); nothing here sends anything.

set local role cdf_v13_owner;

create table cdf_notifications_v13.notification_recipient_class (
  code     text primary key check (code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  name_ar  text not null check (length(name_ar) between 1 and 120),
  name_en  text not null check (length(name_en) between 1 and 120)
);
comment on table cdf_notifications_v13.notification_recipient_class is 'Recipient classes used by disclosure projection (lib/disclosure). Reference data shipped in migrations.';

insert into cdf_notifications_v13.notification_recipient_class (code, name_ar, name_en) values
  ('CASE_TEAM',          'فريق القضية',        'Case team'),
  ('COMMITTEE_MEMBERS',  'أعضاء اللجنة',       'Committee members'),
  ('SUBJECT_EMPLOYEE',   'الموظف المعني',      'Employee concerned'),
  ('WITNESS',            'الشاهد',             'Witness'),
  ('GOVERNANCE',         'الحوكمة',            'Governance');

create table cdf_notifications_v13.notification_template (
  id          uuid        primary key default gen_random_uuid(),
  code        text        not null unique check (code ~ '^[A-Z][A-Z0-9_-]{2,60}$'),
  name_ar     text        not null check (length(name_ar) between 1 and 200),
  name_en     text        not null check (length(name_en) between 1 and 200),
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);
comment on table cdf_notifications_v13.notification_template is 'Notification catalogue entries (template codes). Content lives in immutable versions.';

create table cdf_notifications_v13.notification_template_version (
  id              uuid        primary key default gen_random_uuid(),
  template_id     uuid        not null references cdf_notifications_v13.notification_template (id),
  version         integer     not null check (version >= 1),
  language        text        not null check (language in ('ar', 'en')),
  subject         text        not null check (length(subject) between 1 and 300),
  body            text        not null check (length(body) between 1 and 20000),
  basis           text        not null check (basis ~ '^[A-Za-z0-9._:/ -]{2,200}$'),
  content_sha256  text        not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz not null default now(),
  constraint notification_template_version_unique unique (template_id, version, language)
);
comment on table cdf_notifications_v13.notification_template_version is 'Immutable template versions. content_sha256 = sha256(subject || LF || body), computed by the database. basis = the source reference (register row, rule id).';

create function cdf_notifications_v13._template_version_hash()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  new.content_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                          new.subject || chr(10) || new.body, 'UTF8')), 'hex');
  return new;
end
$fn$;
comment on function cdf_notifications_v13._template_version_hash() is 'Trigger: computes content_sha256 of a template version (any supplied value is overwritten).';
create trigger notification_template_version_hash
  before insert on cdf_notifications_v13.notification_template_version
  for each row execute function cdf_notifications_v13._template_version_hash();
create trigger notification_template_version_immutable
  before update or delete on cdf_notifications_v13.notification_template_version
  for each row execute function cdf_notifications_v13._reject_mutation();

create table cdf_notifications_v13.notification (
  id                    uuid        primary key default gen_random_uuid(),
  case_id               uuid        not null references cdf_notifications_v13.case_record (id),
  template_version_id   uuid        not null references cdf_notifications_v13.notification_template_version (id),
  recipient_class       text        not null references cdf_notifications_v13.notification_recipient_class (code),
  recipient_persona_id  uuid        references cdf_notifications_v13.persona (id),
  lifecycle_status      text        not null default 'DRAFT'
                                    check (lifecycle_status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'DISPATCHED',
                                                                'CANCELLED', 'SUPERSEDED')),
  idempotency_key       text        not null unique check (idempotency_key ~ '^[0-9a-f]{64}$'),
  supersedes_id         uuid,
  created_by_persona_id uuid        not null references cdf_notifications_v13.persona (id),
  row_version           integer     not null default 1 check (row_version >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint notification_case_unique unique (id, case_id),
  -- A correction supersedes a notification of the same case only.
  constraint notification_supersedes_fk foreign key (supersedes_id, case_id)
    references cdf_notifications_v13.notification (id, case_id),
  constraint notification_not_self_superseding check (supersedes_id is null or supersedes_id <> id)
);
create index notification_case_idx on cdf_notifications_v13.notification (case_id, created_at desc);
comment on table cdf_notifications_v13.notification is 'Case-keyed notification records. case_id is set by the command from the authorised case. Lifecycle per ADR-010. Drafts hold no rendered content in M1 (rendered server-side by lib/notifications).';

create table cdf_notifications_v13.notification_event (
  id               uuid        primary key default gen_random_uuid(),
  notification_id  uuid        not null,
  case_id          uuid        not null,
  event_code       text        not null check (event_code ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  occurred_at      timestamptz not null default clock_timestamp(),
  actor_persona_id uuid        references cdf_notifications_v13.persona (id),
  provenance       text        not null default 'COMMAND' check (provenance in ('COMMAND', 'SEED_SYNTHETIC')),
  constraint notification_event_notification_fk foreign key (notification_id, case_id)
    references cdf_notifications_v13.notification (id, case_id)
);
create index notification_event_notification_idx on cdf_notifications_v13.notification_event (notification_id, occurred_at);
comment on table cdf_notifications_v13.notification_event is 'Append-only lifecycle events of a notification. (notification_id, case_id) must match the notification. provenance: COMMAND (written by an api_* command) or SEED_SYNTHETIC.';
create trigger notification_event_no_update_delete
  before update or delete on cdf_notifications_v13.notification_event
  for each row execute function cdf_notifications_v13._reject_mutation();
create trigger notification_event_no_truncate
  before truncate on cdf_notifications_v13.notification_event
  for each statement execute function cdf_notifications_v13._reject_mutation();

create table cdf_notifications_v13.dispatch_outbox (
  id               uuid        primary key default gen_random_uuid(),
  notification_id  uuid        not null,
  case_id          uuid        not null,
  channel          text        not null check (channel in ('EMAIL_STUB', 'IN_APP')),
  status           text        not null default 'PENDING'
                               check (status in ('PENDING', 'CLAIMED', 'SENT_STUB', 'FAILED', 'DEAD_LETTER')),
  attempts         integer     not null default 0 check (attempts >= 0),
  available_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint dispatch_outbox_notification_fk foreign key (notification_id, case_id)
    references cdf_notifications_v13.notification (id, case_id),
  constraint dispatch_outbox_once_per_channel unique (notification_id, channel)
);
comment on table cdf_notifications_v13.dispatch_outbox is 'Content-free transactional outbox (ADR-010): ids, channel and state only — no subject, body or address. Not readable by cdf_v13_user. Used from M5. PRODUCTION_SUBSTITUTION_REQUIRED: CDF mail gateway.';

alter table cdf_notifications_v13.notification_recipient_class  enable row level security;
alter table cdf_notifications_v13.notification_template         enable row level security;
alter table cdf_notifications_v13.notification_template_version enable row level security;
alter table cdf_notifications_v13.notification                  enable row level security;
alter table cdf_notifications_v13.notification_event            enable row level security;
alter table cdf_notifications_v13.dispatch_outbox               enable row level security;

create policy notification_recipient_class_select on cdf_notifications_v13.notification_recipient_class
  for select to cdf_v13_user using (current_user = 'cdf_v13_user' and cdf_notifications_v13.current_persona_id() is not null);
create policy notification_template_select on cdf_notifications_v13.notification_template
  for select to cdf_v13_user using (current_user = 'cdf_v13_user' and cdf_notifications_v13.current_workspace_id() is not null);
create policy notification_template_version_select on cdf_notifications_v13.notification_template_version
  for select to cdf_v13_user using (current_user = 'cdf_v13_user' and cdf_notifications_v13.current_workspace_id() is not null);
create policy notification_select on cdf_notifications_v13.notification
  for select to cdf_v13_user using (current_user = 'cdf_v13_user' and cdf_notifications_v13.can_access_case(case_id));
create policy notification_event_select on cdf_notifications_v13.notification_event
  for select to cdf_v13_user using (current_user = 'cdf_v13_user' and cdf_notifications_v13.can_access_case(case_id));
create policy dispatch_outbox_deny_all on cdf_notifications_v13.dispatch_outbox
  as restrictive for all to public using (false) with check (false);

grant select on cdf_notifications_v13.notification_recipient_class, cdf_notifications_v13.notification_template,
                cdf_notifications_v13.notification_template_version, cdf_notifications_v13.notification,
                cdf_notifications_v13.notification_event to cdf_v13_user;

-- ---------------------------------------------------------------------------------------------------------------------
-- api_create_notification_draft
--   Who: a persona holding COMMITTEE_SECRETARY or INVESTIGATOR in the current workspace, with access to the case
--        (can_access_case — restricted cases need an assignment). Governance officers do not draft in M1.
--   Case: ACTIVE only. Template: active, version exists.
--   Writes: notification (DRAFT), notification_event DRAFT_CREATED, audit_event NOTIFICATION_DRAFT_CREATED.
-- ---------------------------------------------------------------------------------------------------------------------
create function cdf_notifications_v13.api_create_notification_draft(
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

  -- Serialise on the key so a concurrent duplicate gets V1409 rather than a raw unique violation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'),
                                           pg_catalog.hashtext('notification:' || p_idempotency_key));
  if exists (select 1 from cdf_notifications_v13.notification n where n.idempotency_key = p_idempotency_key) then
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
comment on function cdf_notifications_v13.api_create_notification_draft(uuid, uuid, text, text) is 'Command: create a DRAFT notification for an authorised ACTIVE case (secretary or investigator role). Idempotency key used once (V1409). Writes notification, notification event and audit event in one transaction.';

-- Notification history of one case (RLS applies; an unauthorised or unknown case yields no rows).
create function cdf_notifications_v13.case_notifications(p_case_id uuid)
returns table (
  notification_id uuid, case_id uuid, template_code text, template_version integer, language text,
  recipient_class text, lifecycle_status text, created_at timestamptz, row_version integer)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select n.id, n.case_id, t.code, tv.version, tv.language, n.recipient_class, n.lifecycle_status, n.created_at,
         n.row_version
    from cdf_notifications_v13.notification n
    join cdf_notifications_v13.notification_template_version tv on tv.id = n.template_version_id
    join cdf_notifications_v13.notification_template t on t.id = tv.template_id
   where n.case_id = p_case_id
   order by n.created_at desc, n.id
$fn$;
comment on function cdf_notifications_v13.case_notifications(uuid) is 'Notifications of one case (newest first). Empty for unknown and unauthorised cases alike.';

grant execute on function cdf_notifications_v13.api_create_notification_draft(uuid, uuid, text, text) to cdf_v13_user;
grant execute on function cdf_notifications_v13.case_notifications(uuid) to cdf_v13_user;

reset role;
