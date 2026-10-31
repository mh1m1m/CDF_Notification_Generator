-- 0001_m1_synthetic — Milestone M1 synthetic seed, part 1: identity (V13-DB-005).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. SYNTHETIC / DEMO data only:
-- invented names (Secretary Alpha, Investigator Beta, …), @example.test addresses.
--
-- Needs migration 0001 only: workspaces, personas and memberships. Cases, tasks, events, templates and notifications
-- are in 0002_m1_cases.sql (needs migrations 0002–0004).
-- Idempotent: fixed UUIDs and ON CONFLICT DO NOTHING; the audit row SEED_M1_LOADED is written once.
-- Runs as the administrator inside one transaction (runner), acting as cdf_v13_owner. Never runs on the hosted project
-- without the Chief Architect's procedure (docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md).
--
-- UUID scheme (readable in tests): workspace 0a…, persona 0b…, membership 3b…; role ids 00000000-…-0000000000a1/a2/a3
-- come from migration 0001. lib/contracts/personas.ts and workspaces.ts mirror these rows.

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

-- One audit row for this part (no persona context: actor NULL).
do $seed$
begin
  if not exists (select 1 from cdf_notifications_v13.audit_event where action = 'SEED_M1_LOADED') then
    perform cdf_notifications_v13._append_audit('SEED_M1_LOADED', 'seed', null, null,
      jsonb_build_object('seed', '0001_m1_synthetic', 'personas', 6, 'workspaces', 3, 'memberships', 7));
  end if;
end
$seed$;

reset role;
