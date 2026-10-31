import "server-only";
/**
 * CDF Notifications V13 — shared shapes of the W-D2 renderer port (scenario inputs, the notification view model and the
 * projected model the renderers read). SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Shapes follow the charter (CaseRecord §3.1, ProceduralObject §3.2, Event §3.3, field names §5). Every input shape is open
 * (index signature) because W-C scenario fixtures and the inline demo set carry extra keys the renderers ignore.
 */
import type { NextAction, DeadlineRecord } from "../next-action/rules";

export type Lang = "ar" | "en";
export type Experience = "EMAIL" | "PLATFORM";

/** a bilingual value (either side may be missing) */
export interface Bi {
  ar?: string | null;
  en?: string | null;
}
/** a value as the disclosure projection may hand it over: the recorded value, or its generalized / safe-reference replacement */
export interface Replaceable extends Bi {
  generalized?: boolean;
  safe_reference?: boolean;
  token?: string;
  label?: unknown;
}

// ---------------------------------------------------------------------------------------------------------------
// inputs: events, procedural object, case record, recipient, scenario
// ---------------------------------------------------------------------------------------------------------------
export interface ObjectRef {
  type?: string;
  id?: string;
  [k: string]: unknown;
}
export interface DemoEvent {
  event_id: string;
  type?: string;
  event_type?: string;
  occurred_at?: string | null;
  recorded_at?: string | null;
  case_id?: string | null;
  object?: ObjectRef | null;
  payload?: Readonly<Record<string, unknown>> | null;
  [k: string]: unknown;
}
export interface ProcStep {
  step_id: string;
  actual?: string;
  evidence_event_id?: string | null;
  epistemic?: string;
  [k: string]: unknown;
}
export interface ProceduralObject {
  object_id?: string;
  type?: string;
  case_id?: string;
  journey_id?: string;
  ref?: string;
  status?: string;
  steps?: readonly ProcStep[];
  deadlines?: readonly DeadlineRecord[];
  deep_link?: { object_type?: string; object_id?: string } | null;
  related_objects?: readonly ObjectRef[];
  events?: readonly DemoEvent[];
  [k: string]: unknown;
}
export interface CaseRecord {
  case_id?: string;
  internal_ref?: string;
  track?: string;
  classification?: string;
  exists?: boolean;
  status?: { code?: string; recorded_at?: string | null; source_event_id?: string | null } | null;
  [k: string]: unknown;
}
export interface Actor {
  capacity?: string;
  seat_active?: boolean;
  recused?: boolean;
  delegation_active?: boolean;
  acting_for?: unknown;
  [k: string]: unknown;
}
export interface MeetingInfo extends Replaceable {
  at?: string;
  ends_at?: string;
  place?: Bi;
  mode?: Bi;
  [k: string]: unknown;
}
export interface ExceptionInfo extends Replaceable {
  kind?: string;
  source_event_id?: string;
  [k: string]: unknown;
}
export interface ScenarioContent {
  event_title?: Bi | string | null;
  event_summary?: Bi | null;
  status_text?: Bi | null;
  issuer?: Bi | null;
  help?: Readonly<Record<string, Bi>> | null;
  [k: string]: unknown;
}
export interface Recipient {
  class: string;
  ref?: string | null;
  label?: Bi | null;
  email?: string | null;
  display?: Bi | null;
  actor?: Actor;
  on_access_list?: boolean;
  delivery_context?: string;
  object?: ProceduralObject | null;
  content?: ScenarioContent;
  assignment_id?: string | null;
  [k: string]: unknown;
}
export interface Scenario {
  id: string;
  title?: Bi | null;
  type_code: string;
  trigger_event_id?: string | null;
  case?: CaseRecord | null;
  object?: ProceduralObject | null;
  events?: readonly DemoEvent[];
  content?: ScenarioContent;
  meeting?: MeetingInfo | null;
  sensitive?: Readonly<Record<string, unknown>>;
  audit_refs?: readonly string[];
  context_tags?: readonly string[];
  recipients: readonly Recipient[];
  exception?: ExceptionInfo | null;
  report_id?: string;
  assignment_id?: string | null;
  claims?: Readonly<Record<string, unknown>>;
  reported_action?: { action_id: string; result?: string } | null;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------------------------------------------
// view model: Levels 1–3 and the field values the renderers read
// ---------------------------------------------------------------------------------------------------------------
export interface L1StageEntry {
  code: string;
  position: number;
  ar?: string | null;
  en?: string | null;
}
export interface L1Stage extends Replaceable {
  exists?: boolean;
  code?: string | null;
  position?: number | null;
  of?: number;
  stages?: L1StageEntry[];
  status_source_event_id?: string | null;
}
export interface L1Substate extends Replaceable {
  code?: string;
  status_source_event_id?: string | null;
}
export interface StageView extends Bi {
  n: number;
  layer: "actual" | "expected";
  state?: string | null;
  kind?: string;
  evidence_recorded?: boolean;
  evidence_event_id?: string | null;
  note?: string;
  note_label?: Bi;
  condition?: Bi;
  current?: boolean;
  derived?: string;
  unknown?: boolean;
}
export interface L2Journey extends Replaceable {
  journey_id?: string;
  object?: Bi | null;
  capacity?: Bi | null;
  structure?: unknown;
  current_stage?: number;
  stages?: StageView[];
  closure?: Bi | null;
  visibility?: string | null;
}
export interface StepView extends Bi {
  step_id: string;
  layer: "actual" | "expected";
  state?: string | null;
  kind?: string;
  evidence_event_id?: string | null;
  evidence_recorded?: boolean;
  epistemic?: string | null;
  derived?: string;
  condition?: Bi;
  note?: string;
  note_label?: Bi;
  is_notice?: boolean;
  stage_level?: boolean;
}
export interface L3Stage extends Bi {
  n: number;
  state: string | null;
  steps: StepView[];
}
export interface L3Steps extends Replaceable {
  journey_id?: string;
  current_stage?: number;
  stages?: L3Stage[];
  visibility?: string | null;
  note?: Bi;
}

export interface DeadlineField extends Replaceable {
  kind?: string | null;
  at?: string | null;
  reason?: Bi | null;
  basis_withheld?: boolean;
  basis_event_id?: string | null;
  basis_rule?: string | null;
  basis_event_type?: string | null;
}
export interface DeadlineBasis extends Replaceable {
  basis_event_id?: string | null;
  basis_rule?: string | null;
  event_type?: string | null;
}
export interface EvidenceRef {
  event_id?: string | null;
  type?: string | null;
  recorded_at?: string | null;
}
export interface DeliveryInput {
  notification_status?: string;
  channel?: string;
  provider_report?: boolean;
  read?: boolean;
  superseded_by_sent?: boolean;
  correction_in_progress?: boolean;
  note?: Bi | null;
}
export interface DecisionRights extends Replaceable {
  action_id?: string;
  action?: Bi | null;
  result?: string;
  code?: string;
  role?: string | null;
  administrative?: boolean;
  basis_status?: string | null;
  reason?: Bi | null;
}
export type NextActionField = Partial<NextAction> & Replaceable;

/** field name → the value shape the renderers read (a projected value may be the generalized/safe-reference replacement) */
export interface ModelFields {
  event_title: string | Replaceable;
  event_summary: Replaceable & { epistemic?: string };
  event_at: string;
  recipient_capacity_label: Replaceable;
  issuer: Replaceable;
  notice_reference: string;
  template_code: string;
  classification_marking: Replaceable & { code?: string };
  case_number: string | Replaceable;
  report_id: string | Replaceable;
  internal_ref: string | Replaceable;
  l1_stage_name: L1Stage;
  l1_substate: L1Substate;
  l2_journey: L2Journey;
  l3_steps: L3Steps;
  procedural_status_text: Replaceable;
  meeting_info: MeetingInfo;
  allegations: unknown;
  investigation_details: unknown;
  decision_outcome: unknown;
  decision_reasons: unknown;
  member_names: unknown;
  participant_names: unknown;
  reporter_identity: unknown;
  deadline: DeadlineField;
  deadline_basis: DeadlineBasis;
  links_internal: { app?: string; path?: string };
  links_portal: { app?: string; path?: string };
  evidence_refs: EvidenceRef[];
  audit_refs: readonly unknown[];
  card_content: { enabled: boolean };
  preheader: { enabled: boolean };
  subject_detail: { enabled: boolean };
  exception_indicator: ExceptionInfo;
  delivery_status: DeliveryInput;
  next_action: NextActionField;
  decision_rights: DecisionRights;
  help: Replaceable;
  confidentiality_notice: Replaceable;
}
export type FieldName = keyof ModelFields;

export interface ModelMeta {
  notification_id: string;
  type_code: string;
  event_type: string | null;
  template_version: string;
  language: Lang;
  recipient_class: string;
  recipient_ref: string | null;
  generated_at: string;
  synthetic: true;
  marking: string;
  scenario_id: string;
  release_status: "DESIGN_PREVIEW";
  context: { tags: string[]; on_access_list: boolean };
}

/** what the renderers read from a projected model (the disclosure module's projection satisfies it) */
export interface RenderModel {
  readonly meta: Readonly<Record<string, unknown>> & { readonly recipient_class: string };
  readonly fields: Readonly<Record<string, unknown>>;
  readonly safe_refs?: unknown;
  readonly _disclosure_summary?: unknown;
  readonly _disclosure_log?: unknown;
}

/** typed read of one field of a projected model (own keys only) */
export function fieldOf<K extends FieldName>(m: RenderModel, f: K): ModelFields[K] | undefined {
  // the projection hands over values of the shapes listed in ModelFields; readers still null-check every member
  return Object.prototype.hasOwnProperty.call(m.fields, f)
    ? (m.fields[f] as ModelFields[K] | undefined)
    : undefined;
}
