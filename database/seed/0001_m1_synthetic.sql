-- 0001_m1_synthetic — Milestone M1 synthetic seed (V13-DB-005).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. SYNTHETIC / DEMO data only:
-- invented names (Secretary Alpha, Investigator Beta, …), @example.test addresses, CDF-DEMO-2026-NNNN numbers.
--
-- Idempotent: fixed UUIDs and ON CONFLICT DO NOTHING; the audit row SEED_M1_LOADED is written once.
-- Runs as the administrator inside one transaction (runner), acting as cdf_v13_owner. Never runs on the hosted project
-- without the Chief Architect's procedure (docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md).
--
-- UUID scheme (readable in tests): workspace 0a…, persona 0b…, case 0c…, task 0d…, event 0e…, template 0f…,
-- template version 1f…, notification 2f…, assignment 3a…, membership 3b…. The visibility table per persona is in
-- docs/architecture/DATA_MODEL.md §5.

set local role cdf_v13_owner;

-- Workspaces ----------------------------------------------------------------------------------------------------------
insert into cdf_notifications_v13.workspace (id, code, name_ar, name_en) values
  ('0a000000-0000-4000-8000-000000000001', 'SECRETARIAT',    'أمانة اللجنة',   'Committee Secretariat'),
  ('0a000000-0000-4000-8000-000000000002', 'INVESTIGATIONS', 'التحقيقات',      'Investigations'),
  ('0a000000-0000-4000-8000-000000000003', 'GOVERNANCE',     'الحوكمة',        'Governance')
on conflict (id) do nothing;

-- Personas ------------------------------------------------------------------------------------------------------------
insert into cdf_notifications_v13.persona (id, code, display_name_ar, display_name_en, email, is_active) values
  ('0b000000-0000-4000-8000-000000000001', 'SECRETARY_ALPHA',    'أمين السر ألفا',        'Secretary Alpha',            'secretary.alpha@example.test',    true),
  ('0b000000-0000-4000-8000-000000000002', 'INVESTIGATOR_BETA',  'المحقق بيتا',           'Investigator Beta',          'investigator.beta@example.test',  true),
  ('0b000000-0000-4000-8000-000000000003', 'INVESTIGATOR_GAMMA', 'المحقق غاما',           'Investigator Gamma',         'investigator.gamma@example.test', true),
  ('0b000000-0000-4000-8000-000000000004', 'GOVERNANCE_DELTA',   'مسؤول الحوكمة دلتا',    'Governance Officer Delta',   'governance.delta@example.test',   true),
  -- Negative-test personas: membership expired; persona deactivated.
  ('0b000000-0000-4000-8000-000000000005', 'SECRETARY_EPSILON',  'أمين السر إبسيلون',     'Secretary Epsilon (expired)', 'secretary.epsilon@example.test',  true),
  ('0b000000-0000-4000-8000-000000000006', 'PERSONA_ZETA',       'الشخصية زيتا',          'Persona Zeta (inactive)',    'persona.zeta@example.test',       false)
on conflict (id) do nothing;

-- Memberships (persona × workspace × role) ----------------------------------------------------------------------------
insert into cdf_notifications_v13.persona_workspace_membership (id, persona_id, workspace_id, role_id, valid_from, valid_to) values
  ('3b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', '2026-01-01T00:00:00Z', null),
  ('3b000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2', '2026-01-01T00:00:00Z', null),
  ('3b000000-0000-4000-8000-000000000003', '0b000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2', '2026-01-01T00:00:00Z', null),
  ('3b000000-0000-4000-8000-000000000004', '0b000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a3', '2026-01-01T00:00:00Z', null),
  ('3b000000-0000-4000-8000-000000000005', '0b000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', '2026-01-01T00:00:00Z', null),
  ('3b000000-0000-4000-8000-000000000006', '0b000000-0000-4000-8000-000000000005', '0a000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', '2026-01-01T00:00:00Z', '2026-06-30T00:00:00Z'),
  ('3b000000-0000-4000-8000-000000000007', '0b000000-0000-4000-8000-000000000006', '0a000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', '2026-01-01T00:00:00Z', null)
on conflict (id) do nothing;

-- Cases ---------------------------------------------------------------------------------------------------------------
-- ws: S = SECRETARIAT (…01), I = INVESTIGATIONS (…02), G = GOVERNANCE (…03)
insert into cdf_notifications_v13.case_record
  (id, display_number, title_ar, title_en, stage, is_restricted, records_state, owning_workspace_id, source_ref, opened_at, closed_at)
values
  ('0c000000-0000-4000-8000-000000000001', 'CDF-DEMO-2026-0001', 'قضية تجريبية ٠٠٠١ — مخالفة إجرائية',      'Demo case 0001 — procedural breach',       'INVESTIGATION',          false, 'ACTIVE', '0a000000-0000-4000-8000-000000000002', 'demo-0001', '2026-02-01T08:00:00Z', null),
  ('0c000000-0000-4000-8000-000000000002', 'CDF-DEMO-2026-0002', 'قضية تجريبية ٠٠٠٢ — تعارض مصالح',         'Demo case 0002 — conflict of interest',    'INVESTIGATION',          false, 'ACTIVE', '0a000000-0000-4000-8000-000000000002', 'demo-0002', '2026-02-10T08:00:00Z', null),
  ('0c000000-0000-4000-8000-000000000003', 'CDF-DEMO-2026-0003', 'قضية تجريبية ٠٠٠٣ — مداولة اللجنة',       'Demo case 0003 — committee deliberation',  'COMMITTEE_DELIBERATION', false, 'ACTIVE', '0a000000-0000-4000-8000-000000000001', 'demo-0003', '2026-03-01T08:00:00Z', null),
  ('0c000000-0000-4000-8000-000000000004', 'CDF-DEMO-2026-0004', 'قضية تجريبية ٠٠٠٤ — مراجعة أولية',        'Demo case 0004 — preliminary review',      'PRELIMINARY_REVIEW',     false, 'ACTIVE', '0a000000-0000-4000-8000-000000000001', 'demo-0004', '2026-03-15T08:00:00Z', null),
  ('0c000000-0000-4000-8000-000000000005', 'CDF-DEMO-2026-0005', 'قضية تجريبية ٠٠٠٥ — استلام بلاغ',         'Demo case 0005 — intake',                  'INTAKE',                 false, 'ACTIVE', '0a000000-0000-4000-8000-000000000002', 'demo-0005', '2026-04-01T08:00:00Z', null),
  ('0c000000-0000-4000-8000-000000000006', 'CDF-DEMO-2026-0006', 'قضية تجريبية ٠٠٠٦ — تحقيق مشترك',         'Demo case 0006 — joint investigation',     'INVESTIGATION',          false, 'ACTIVE', '0a000000-0000-4000-8000-000000000002', 'demo-0006', '2026-04-10T08:00:00Z', null),
  ('0c000000-0000-4000-8000-000000000007', 'CDF-DEMO-2026-0007', 'قضية تجريبية ٠٠٠٧ — قرار',               'Demo case 0007 — decision',                'DECISION',               false, 'ACTIVE', '0a000000-0000-4000-8000-000000000001', 'demo-0007', '2026-05-01T08:00:00Z', null),
  ('0c000000-0000-4000-8000-000000000008', 'CDF-DEMO-2026-0008', 'قضية تجريبية ٠٠٠٨ — مراجعة حوكمة',        'Demo case 0008 — governance review',       'COMMITTEE_DELIBERATION', false, 'ACTIVE', '0a000000-0000-4000-8000-000000000003', 'demo-0008', '2026-05-15T08:00:00Z', null),
  ('0c000000-0000-4000-8000-000000000009', 'CDF-DEMO-2026-0009', 'قضية تجريبية ٠٠٠٩ — مقيدة',               'Demo case 0009 — restricted',              'INVESTIGATION',          true,  'ACTIVE', '0a000000-0000-4000-8000-000000000002', 'demo-0009', '2026-06-01T08:00:00Z', null),
  ('0c000000-0000-4000-8000-000000000010', 'CDF-DEMO-2026-0010', 'قضية تجريبية ٠٠١٠ — مغلقة',               'Demo case 0010 — closed',                  'CLOSURE',                false, 'CLOSED', '0a000000-0000-4000-8000-000000000001', 'demo-0010', '2026-01-15T08:00:00Z', '2026-07-01T08:00:00Z')
on conflict (id) do nothing;

-- Extra visibility (the owning workspace is added by trigger).
insert into cdf_notifications_v13.case_workspace_visibility (case_id, workspace_id)
select ('0c000000-0000-4000-8000-0000000000' || c)::uuid, ('0a000000-0000-4000-8000-00000000000' || w)::uuid
  from (values ('01', '1'), ('01', '3'), ('02', '3'), ('03', '2'), ('03', '3'), ('04', '3'), ('06', '1'),
               ('07', '3'), ('08', '1'), ('09', '1'), ('09', '3'), ('10', '2'), ('10', '3')) as v (c, w)
on conflict do nothing;

-- Assignments ---------------------------------------------------------------------------------------------------------
-- persona: 1 Alpha, 2 Beta, 3 Gamma, 4 Delta
insert into cdf_notifications_v13.case_assignment (id, case_id, persona_id, capacity, valid_from)
select ('3a000000-0000-4000-8000-0000000000' || n)::uuid, ('0c000000-0000-4000-8000-0000000000' || c)::uuid,
       ('0b000000-0000-4000-8000-00000000000' || p)::uuid, cap, '2026-01-01T00:00:00Z'::timestamptz
  from (values ('01', '01', '2', 'LEAD_INVESTIGATOR'), ('02', '01', '1', 'SECRETARY'),
               ('03', '02', '3', 'LEAD_INVESTIGATOR'),
               ('04', '03', '1', 'SECRETARY'),         ('05', '03', '2', 'INVESTIGATOR'),
               ('06', '04', '1', 'SECRETARY'),
               ('07', '05', '2', 'LEAD_INVESTIGATOR'),
               ('08', '06', '3', 'LEAD_INVESTIGATOR'), ('09', '06', '2', 'INVESTIGATOR'),
               ('10', '07', '1', 'SECRETARY'),
               ('11', '08', '4', 'GOVERNANCE_REVIEWER'), ('12', '08', '1', 'SECRETARY'),
               ('13', '09', '2', 'LEAD_INVESTIGATOR'),
               ('14', '10', '1', 'SECRETARY'),         ('15', '10', '3', 'LEAD_INVESTIGATOR')) as v (n, c, p, cap)
on conflict (id) do nothing;

-- Tasks: two per case -------------------------------------------------------------------------------------------------
insert into cdf_notifications_v13.task (id, case_id, task_code, title_ar, title_en, assignee_persona_id, status, due_date)
select ('0d000000-0000-4000-8000-0000000000' || n)::uuid, ('0c000000-0000-4000-8000-0000000000' || c)::uuid, code,
       ar, en, ('0b000000-0000-4000-8000-00000000000' || p)::uuid, st, d::date
  from (values
    ('01', '01', 'COLLECT_DOCUMENTS',   'جمع المستندات',        'Collect documents',       '2', 'IN_PROGRESS', '2026-11-05'),
    ('02', '01', 'SCHEDULE_INTERVIEW',  'جدولة المقابلة',       'Schedule interview',      '1', 'OPEN',        '2026-11-10'),
    ('03', '02', 'COLLECT_DOCUMENTS',   'جمع المستندات',        'Collect documents',       '3', 'OPEN',        '2026-11-07'),
    ('04', '02', 'DRAFT_FINDINGS',      'إعداد مسودة النتائج',   'Draft findings',          '3', 'OPEN',        '2026-11-20'),
    ('05', '03', 'PREPARE_AGENDA',      'إعداد جدول الأعمال',    'Prepare agenda',          '1', 'IN_PROGRESS', '2026-11-03'),
    ('06', '03', 'PRESENT_RESULTS',     'عرض نتائج التحقيق',     'Present results',         '2', 'OPEN',        '2026-11-12'),
    ('07', '04', 'PRELIMINARY_REVIEW',  'المراجعة الأولية',      'Preliminary review',      '1', 'OPEN',        '2026-11-08'),
    ('08', '04', 'REQUEST_INFORMATION', 'طلب معلومات',          'Request information',     '1', 'BLOCKED',     '2026-11-15'),
    ('09', '05', 'REGISTER_REPORT',     'تسجيل البلاغ',         'Register report',         '2', 'OPEN',        '2026-11-02'),
    ('10', '05', 'ASSESS_ADMISSIBILITY','تقييم القبول',         'Assess admissibility',    '2', 'OPEN',        '2026-11-09'),
    ('11', '06', 'COLLECT_DOCUMENTS',   'جمع المستندات',        'Collect documents',       '3', 'IN_PROGRESS', '2026-11-06'),
    ('12', '06', 'WITNESS_INTERVIEW',   'مقابلة الشاهد',        'Witness interview',       '2', 'OPEN',        '2026-11-14'),
    ('13', '07', 'ISSUE_DECISION_NOTICE','إصدار إشعار القرار',  'Issue decision notice',   '1', 'OPEN',        '2026-11-04'),
    ('14', '07', 'ARCHIVE_MINUTES',     'حفظ المحضر',           'Archive minutes',         '1', 'OPEN',        '2026-11-18'),
    ('15', '08', 'GOVERNANCE_REVIEW',   'مراجعة الحوكمة',       'Governance review',       '4', 'IN_PROGRESS', '2026-11-11'),
    ('16', '08', 'PREPARE_AGENDA',      'إعداد جدول الأعمال',    'Prepare agenda',          '1', 'OPEN',        '2026-11-13'),
    ('17', '09', 'COLLECT_DOCUMENTS',   'جمع المستندات',        'Collect documents',       '2', 'OPEN',        '2026-11-05'),
    ('18', '09', 'RESTRICTED_INTERVIEW','مقابلة مقيدة',         'Restricted interview',    '2', 'OPEN',        '2026-11-16'),
    ('19', '10', 'ARCHIVE_CASE',        'أرشفة القضية',         'Archive case',            '1', 'DONE',        '2026-07-01'),
    ('20', '10', 'FINAL_REPORT',        'التقرير النهائي',       'Final report',            '3', 'OPEN',        '2026-07-01')
  ) as v (n, c, code, ar, en, p, st, d)
on conflict (id) do nothing;

-- Recorded events (provenance SEED_SYNTHETIC) -------------------------------------------------------------------------
insert into cdf_notifications_v13.procedural_event (id, case_id, event_code, occurred_at, recorded_at, provenance)
select ('0e000000-0000-4000-8000-0000000000' || c)::uuid, ('0c000000-0000-4000-8000-0000000000' || c)::uuid,
       'CASE_OPENED', o, o, 'SEED_SYNTHETIC'
  from (select lpad(i::text, 2, '0') as c, opened_at as o
          from generate_series(1, 10) i
          join cdf_notifications_v13.case_record r
            on r.id = ('0c000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid) s
on conflict (id) do nothing;
insert into cdf_notifications_v13.procedural_event (id, case_id, event_code, occurred_at, recorded_at, provenance)
values ('0e000000-0000-4000-8000-000000000110', '0c000000-0000-4000-8000-000000000010', 'CASE_CLOSED',
        '2026-07-01T08:00:00Z', '2026-07-01T08:00:00Z', 'SEED_SYNTHETIC')
on conflict (id) do nothing;

-- Every seeded task status other than OPEN has a recorded event (Procedural Truth: no status without an event).
insert into cdf_notifications_v13.procedural_event
  (id, case_id, event_code, occurred_at, recorded_at, provenance, subject_type, subject_id, attributes)
select ('0e000000-0000-4000-8000-0000000002' || right(t.id::text, 2))::uuid, t.case_id, 'TASK_STATUS_CHANGED',
       c.opened_at + interval '1 day', c.opened_at + interval '1 day', 'SEED_SYNTHETIC', 'task', t.id,
       jsonb_build_object('from', 'OPEN', 'to', t.status)
  from cdf_notifications_v13.task t
  join cdf_notifications_v13.case_record c on c.id = t.case_id
 where t.id::text like '0d000000-0000-4000-8000-%' and t.status <> 'OPEN'
on conflict (id) do nothing;

-- Templates (synthetic texts) -----------------------------------------------------------------------------------------
insert into cdf_notifications_v13.notification_template (id, code, name_ar, name_en) values
  ('0f000000-0000-4000-8000-000000000001', 'CF-20_INVESTIGATION_ASSIGNED', 'إسناد التحقيق', 'Investigation assigned'),
  ('0f000000-0000-4000-8000-000000000002', 'CF-24_MEETING_INVITATION',     'دعوة اجتماع',   'Meeting invitation')
on conflict (id) do nothing;

insert into cdf_notifications_v13.notification_template_version (id, template_id, version, language, subject, body, basis, content_sha256) values
  ('1f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 1, 'ar',
   'إسناد تحقيق — {{case_reference}}', 'تم إسناد التحقيق في القضية {{case_reference}} إليكم. يرجى الدخول إلى المنصة للاطلاع. (بيانات تجريبية)',
   'REGISTER:CF-20', repeat('0', 64)),
  ('1f000000-0000-4000-8000-000000000002', '0f000000-0000-4000-8000-000000000001', 1, 'en',
   'Investigation assigned — {{case_reference}}', 'The investigation of case {{case_reference}} has been assigned to you. Please sign in to the platform. (Synthetic data)',
   'REGISTER:CF-20', repeat('0', 64)),
  ('1f000000-0000-4000-8000-000000000003', '0f000000-0000-4000-8000-000000000002', 1, 'ar',
   'دعوة لاجتماع اللجنة — {{case_reference}}', 'أنتم مدعوون لاجتماع اللجنة بشأن القضية {{case_reference}}. التفاصيل في المنصة. (بيانات تجريبية)',
   'REGISTER:CF-24', repeat('0', 64)),
  ('1f000000-0000-4000-8000-000000000004', '0f000000-0000-4000-8000-000000000002', 1, 'en',
   'Committee meeting invitation — {{case_reference}}', 'You are invited to a committee meeting about case {{case_reference}}. Details are in the platform. (Synthetic data)',
   'REGISTER:CF-24', repeat('0', 64))
on conflict (id) do nothing;

-- Notifications (history for 0001, 0003, 0009, 0010) -----------------------------------------------------------------
-- All five are DRAFT with a DRAFT_CREATED event only. The seed holds no APPROVED or DISPATCHED notification and no
-- APPROVED or DISPATCHED event: dispatch state comes only from the outbox path (REQ-DISP-001, M5) and approval is a
-- decision right that arrives with the M5 approval command (REQ-DISP-009, REQ-GOV-014). Other lifecycle chips are
-- tested with component fixtures, not database rows.
insert into cdf_notifications_v13.notification
  (id, case_id, template_version_id, recipient_class, lifecycle_status, idempotency_key, created_by_persona_id, created_at)
select ('2f000000-0000-4000-8000-0000000000' || n)::uuid, ('0c000000-0000-4000-8000-0000000000' || c)::uuid,
       ('1f000000-0000-4000-8000-00000000000' || tv)::uuid, rc, 'DRAFT',
       encode(sha256(convert_to('seed-m1:' || n, 'UTF8')), 'hex'),
       ('0b000000-0000-4000-8000-00000000000' || p)::uuid, at::timestamptz
  from (values ('01', '01', '1', 'CASE_TEAM',         '1', '2026-10-01T09:00:00Z'),
               ('02', '03', '3', 'COMMITTEE_MEMBERS', '1', '2026-10-02T09:00:00Z'),
               ('03', '03', '4', 'COMMITTEE_MEMBERS', '1', '2026-10-03T09:00:00Z'),
               ('04', '09', '1', 'CASE_TEAM',         '2', '2026-10-04T09:00:00Z'),
               ('05', '10', '3', 'COMMITTEE_MEMBERS', '1', '2026-06-20T09:00:00Z'))
       as v (n, c, tv, rc, p, at)
on conflict (id) do nothing;

insert into cdf_notifications_v13.notification_event
  (id, notification_id, case_id, event_code, occurred_at, actor_persona_id, provenance)
select ('2e000000-0000-4000-8000-0000000100' || right(n.id::text, 2))::uuid, n.id, n.case_id, 'DRAFT_CREATED',
       n.created_at, n.created_by_persona_id, 'SEED_SYNTHETIC'
  from cdf_notifications_v13.notification n
 where n.id::text like '2f000000-0000-4000-8000-%'
on conflict (id) do nothing;

-- One audit row for the seed (no persona context: actor NULL).
do $seed$
begin
  if not exists (select 1 from cdf_notifications_v13.audit_event where action = 'SEED_M1_LOADED') then
    perform cdf_notifications_v13._append_audit('SEED_M1_LOADED', 'seed', null, null,
      jsonb_build_object('seed', '0001_m1_synthetic', 'cases', 10, 'personas', 6, 'workspaces', 3));
  end if;
end
$seed$;

reset role;
