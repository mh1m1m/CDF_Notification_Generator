/**
 * lib/domain/status.ts — CDF Notifications V13 · workstream W-A (domain model).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
 *
 * The seven status objects of CHARTER.md §3.4, never collapsed into one field:
 *   CaseStatus (V8 code + flags) · ProcedureStatus · TaskStatus · MeetingStatus · DecisionStatus ·
 *   NotificationStatus · DeliveryStatus.
 *
 * FACT   the seven enums (charter §3.4, verbatim); the V8 codes, stages and 34 transitions (V12 package, read-only:
 *        notifications/generator/source/tests/v9_data.json, notifications/journeys/level2_journeys.json).
 * PROPOSAL  every transition table below unless a row cites a source; the forbidden-derivation list FD-01…FD-12.
 *
 * Independence by construction (directive §4.1, charter §3.4): the status of an object changes only through
 * applyEvent(type, ownState, event), which sees the object's own state and one recorded event that names the object.
 * A hold row (concept.holds, work/LEAD_notes.md L-10) admits a recorded event from a state without changing it.
 * No function in this module reads one object's status to compute another's. assertIndependent() checks the
 * tables structurally and the forbidden derivations FD-01…FD-12; tests/status.test.js ST-13…ST-16 check it by
 * property tests. OVERDUE is a derived flag (isOverdue), never a status; recipient acknowledgement is an event,
 * never a status.
 *
 * Module style: ESM, pure functions over plain JSON, no runtime dependencies (charter §1).
 */
import {
  CONCEPTS,
  CONCEPT_IDS,
  EVENT_CATALOGUE,
  EVENT_TYPES,
  COMMUNICATION_EVENTS,
  CASE_EVENTS,
  PROCEDURAL_EVENTS,
  CASE_CODE_EVENTS,
  getConcept,
} from "./concepts";
import type { Concept, StatusObjectName } from "./concepts";
import type {
  Bilingual,
  DomainEvent,
  Guard,
  HoldRow,
  Label,
  ObjectRef,
  OwnerDomain,
  TransitionRow,
} from "./types";
import { isNil } from "./nil";

export type { StatusObjectName } from "./concepts";

export class DomainError extends Error {
  readonly code: string;
  readonly detail: unknown;
  constructor(code: string, message: string, detail: unknown = null) {
    super(`${code}: ${message}`);
    this.name = "DomainError";
    this.code = code;
    this.detail = detail;
  }
}
const fail = (code: string, message: string, detail: unknown = null): never => {
  throw new DomainError(code, message, detail);
};
const own = (o: unknown, k: PropertyKey): boolean => !isNil(o) && Object.prototype.hasOwnProperty.call(o, k);
/** `list.includes(v)` for a value of any type (narrows `v` to the element type). */
const has = <T>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

// ---- V8 master journey (FACT) ----------------------------------------------------------------------
// Stages: notifications/journeys/level2_journeys.json `master` (version L2-2026-10-26b).
// Sub-states: Arabic names and keys from notifications/generator/source/tests/v9_data.json `substates[28]`;
// English names from level2_journeys.json `master_sub_en`. Transitions: v9_data.json `transitions[34]`.
export const MASTER_STAGES = Object.freeze([
  Object.freeze({
    code: "S1",
    key: "INTAKE_REGISTER",
    ar: "الاستقبال والتسجيل",
    en: "Receipt and registration",
  }),
  Object.freeze({
    code: "S2",
    key: "SCREENING",
    ar: "فحص الاكتمال والاختصاص والتقييم",
    en: "Completeness, jurisdiction and assessment",
  }),
  Object.freeze({
    code: "S3",
    key: "PROCESS_INVESTIGATE",
    ar: "المعالجة والتحقيق المختص",
    en: "Competent handling and investigation",
  }),
  Object.freeze({
    code: "S4",
    key: "RECOMMEND_DECIDE",
    ar: "التوصية والقرار المختص",
    en: "Recommendation and competent decision",
  }),
  Object.freeze({
    code: "S5",
    key: "EXECUTE_CLOSE",
    ar: "التبليغ والتنفيذ والإغلاق",
    en: "Notification, execution and closure",
  }),
]);

export const V8_SUBSTATES = Object.freeze([
  Object.freeze({ code: "S1.01", stage: "S1", key: "RECEIVED", ar: "ورود الطلب", en: "Request received" }),
  Object.freeze({
    code: "S1.02",
    stage: "S1",
    key: "REGISTRATION_PENDING",
    ar: "استيفاء متطلبات القيد",
    en: "Registration requirements met",
  }),
  Object.freeze({ code: "S1.03", stage: "S1", key: "REGISTERED", ar: "تسجيل الحالة", en: "Case registered" }),
  Object.freeze({
    code: "S1.04",
    stage: "S1",
    key: "SOURCE_CONFIDENTIALITY_SET",
    ar: "تحديد المصدر والسرية",
    en: "Source and confidentiality set",
  }),
  Object.freeze({
    code: "S2.01",
    stage: "S2",
    key: "COMPLETENESS_REVIEW",
    ar: "فحص اكتمال البيانات",
    en: "Completeness check",
  }),
  Object.freeze({
    code: "S2.02",
    stage: "S2",
    key: "WAITING_INFORMATION",
    ar: "بانتظار استكمال معلومات",
    en: "Awaiting additional information",
  }),
  Object.freeze({
    code: "S2.03",
    stage: "S2",
    key: "JURISDICTION_CHECK",
    ar: "فحص الاختصاص",
    en: "Jurisdiction check",
  }),
  Object.freeze({
    code: "S2.04",
    stage: "S2",
    key: "INITIAL_ASSESSMENT",
    ar: "التقييم الأولي",
    en: "Preliminary assessment",
  }),
  Object.freeze({
    code: "S2.05",
    stage: "S2",
    key: "SCREENING_APPROVAL",
    ar: "اعتماد نتيجة الفحص",
    en: "Screening outcome approved",
  }),
  Object.freeze({
    code: "S3.01",
    stage: "S3",
    key: "PROCESSING_ASSIGNED",
    ar: "إسناد المعالجة المختصة",
    en: "Competent handling assigned",
  }),
  Object.freeze({
    code: "S3.02",
    stage: "S3",
    key: "EVIDENCE_COLLECTION",
    ar: "جمع المعلومات والأدلة",
    en: "Information and evidence gathering",
  }),
  Object.freeze({
    code: "S3.03",
    stage: "S3",
    key: "PRELIMINARY_INVESTIGATION",
    ar: "التحقيق الأولي",
    en: "Preliminary investigation",
  }),
  Object.freeze({
    code: "S3.04",
    stage: "S3",
    key: "ESCALATION_APPROVED",
    ar: "التصعيد المعتمد عند انطباقه",
    en: "Approved escalation (where applicable)",
  }),
  Object.freeze({
    code: "S3.05",
    stage: "S3",
    key: "EXTENDED_INVESTIGATION",
    ar: "إجراءات التحقيق الموسع",
    en: "Extended investigation procedures",
  }),
  Object.freeze({
    code: "S3.06",
    stage: "S3",
    key: "REPORT_PREPARATION",
    ar: "إعداد التقرير النهائي للمعالجة",
    en: "Final handling report prepared",
  }),
  Object.freeze({
    code: "S3.07",
    stage: "S3",
    key: "PROCESS_OUTPUT_APPROVED",
    ar: "اعتماد مخرجات المعالجة",
    en: "Handling outputs approved",
  }),
  Object.freeze({
    code: "S4.01",
    stage: "S4",
    key: "RECOMMENDATION_PREPARATION",
    ar: "إعداد المخرجات والتوصيات",
    en: "Outputs and recommendations prepared",
  }),
  Object.freeze({
    code: "S4.02",
    stage: "S4",
    key: "RECOMMENDATION_APPROVED",
    ar: "اعتماد التوصيات من جهة الاختصاص",
    en: "Recommendations adopted by the competent body",
  }),
  Object.freeze({
    code: "S4.03",
    stage: "S4",
    key: "RECOMMENDATION_SUBMITTED",
    ar: "رفع التوصية لصاحب الصلاحية",
    en: "Recommendation raised to the authority",
  }),
  Object.freeze({
    code: "S4.04",
    stage: "S4",
    key: "AUTHORITY_REVIEW",
    ar: "بانتظار قرار الجهة المخولة",
    en: "Awaiting the authorised body's decision",
  }),
  Object.freeze({
    code: "S4.05",
    stage: "S4",
    key: "DECISION_ISSUED",
    ar: "صدور مآل القرار المختص",
    en: "Competent decision issued",
  }),
  Object.freeze({
    code: "S5.01",
    stage: "S5",
    key: "DECISION_NOTIFICATION",
    ar: "تبليغ القرار عند انطباقه",
    en: "Decision notified (where applicable)",
  }),
  Object.freeze({
    code: "S5.02",
    stage: "S5",
    key: "IMPLEMENTATION",
    ar: "متابعة تنفيذ القرار",
    en: "Decision execution followed up",
  }),
  Object.freeze({
    code: "S5.03",
    stage: "S5",
    key: "GRIEVANCE_PATH",
    ar: "معالجة التظلم المشروط",
    en: "Conditional grievance handled",
  }),
  Object.freeze({
    code: "S5.04",
    stage: "S5",
    key: "COMPLETION_VERIFICATION",
    ar: "التحقق من اكتمال الالتزامات",
    en: "Obligations verified complete",
  }),
  Object.freeze({
    code: "S5.05",
    stage: "S5",
    key: "CLOSED",
    ar: "إغلاق مسار القضية",
    en: "Case path closed",
  }),
  Object.freeze({ code: "S5.06", stage: "S5", key: "ARCHIVED", ar: "أرشفة الملف", en: "File archived" }),
  Object.freeze({
    code: "S5.07",
    stage: "S5",
    key: "TRANSFERRED_CLOSED",
    ar: "إغلاق مسار الإحالة بعد التحويل",
    en: "Referral path closed after transfer",
  }),
]);

export const V8_TRANSITIONS = Object.freeze([
  Object.freeze({ id: "T01", from: "S1.01", to: "S1.02", v8_event: "RECEIPT_VALIDATED" }),
  Object.freeze({ id: "T02", from: "S1.02", to: "S1.03", v8_event: "CASE_REGISTRATION_APPROVED" }),
  Object.freeze({
    id: "T03",
    from: "S1.03",
    to: "S1.04",
    v8_event: "CONFIDENTIALITY_CLASSIFICATION_RECORDED",
  }),
  Object.freeze({ id: "T04", from: "S1.04", to: "S2.01", v8_event: "INTAKE_COMPLETED" }),
  Object.freeze({ id: "T05", from: "S2.01", to: "S2.02", v8_event: "INFO_REQUEST_APPROVED" }),
  Object.freeze({ id: "T06", from: "S2.02", to: "S2.01", v8_event: "REQUIRED_INFORMATION_RECEIVED" }),
  Object.freeze({ id: "T07", from: "S2.01", to: "S2.03", v8_event: "COMPLETENESS_CONFIRMED" }),
  Object.freeze({ id: "T08", from: "S2.03", to: "S2.04", v8_event: "JURISDICTION_CONFIRMED" }),
  Object.freeze({ id: "T09", from: "S2.03", to: "S5.07", v8_event: "TRANSFER_ROUTE_APPROVED" }),
  Object.freeze({ id: "T10", from: "S2.04", to: "S2.05", v8_event: "SCREENING_REPORT_SUBMITTED" }),
  Object.freeze({ id: "T11", from: "S2.05", to: "S3.01", v8_event: "INVESTIGATION_ROUTE_APPROVED" }),
  Object.freeze({ id: "T12", from: "S2.05", to: "S5.05", v8_event: "SCREENING_CLOSURE_APPROVED" }),
  Object.freeze({ id: "T13", from: "S3.01", to: "S3.02", v8_event: "ASSIGNMENT_ACCEPTED" }),
  Object.freeze({ id: "T14", from: "S3.02", to: "S3.03", v8_event: "PRELIMINARY_INVESTIGATION_STARTED" }),
  Object.freeze({ id: "T15", from: "S3.03", to: "S3.04", v8_event: "ESCALATION_APPROVED" }),
  Object.freeze({ id: "T16", from: "S3.03", to: "S3.06", v8_event: "PRELIMINARY_REPORT_READY" }),
  Object.freeze({ id: "T17", from: "S3.04", to: "S3.05", v8_event: "EXTENDED_MANDATE_ACTIVE" }),
  Object.freeze({
    id: "T18",
    from: "S3.05",
    to: "S3.06",
    v8_event: "HEARINGS_COMPLETED_AND_DEFENSE_OBSERVED",
  }),
  Object.freeze({ id: "T19", from: "S3.06", to: "S3.07", v8_event: "REPORT_SUBMITTED_FOR_APPROVAL" }),
  Object.freeze({ id: "T20", from: "S3.07", to: "S4.01", v8_event: "RECOMMENDATION_ROUTE_CONFIRMED" }),
  Object.freeze({
    id: "T21",
    from: "S3.07",
    to: "S5.05",
    v8_event: "PROCESSING_CLOSED_WITHOUT_RECOMMENDATION",
  }),
  Object.freeze({ id: "T22", from: "S4.01", to: "S4.02", v8_event: "RECOMMENDATION_REVIEW_COMPLETED" }),
  Object.freeze({ id: "T23", from: "S4.02", to: "S4.03", v8_event: "RECOMMENDATION_RELEASE_AUTHORIZED" }),
  Object.freeze({ id: "T24", from: "S4.03", to: "S4.04", v8_event: "AUTHORITY_RECEIPT_CONFIRMED" }),
  Object.freeze({ id: "T25", from: "S4.04", to: "S4.05", v8_event: "COMPETENT_DECISION_RECORDED" }),
  Object.freeze({ id: "T26", from: "S4.05", to: "S5.01", v8_event: "DECISION_NOTICE_REQUIRED" }),
  Object.freeze({ id: "T27", from: "S4.05", to: "S5.04", v8_event: "NO_NOTICE_OR_EXECUTION_REQUIRED" }),
  Object.freeze({ id: "T28", from: "S5.01", to: "S5.02", v8_event: "IMPLEMENTATION_ASSIGNED" }),
  Object.freeze({ id: "T29", from: "S5.01", to: "S5.03", v8_event: "GRIEVANCE_RECEIVED" }),
  Object.freeze({ id: "T30", from: "S5.02", to: "S5.04", v8_event: "IMPLEMENTATION_EVIDENCE_ACCEPTED" }),
  Object.freeze({
    id: "T31",
    from: "S5.03",
    to: "S5.02",
    v8_event: "GRIEVANCE_RESOLVED_CONTINUE_IMPLEMENTATION",
  }),
  Object.freeze({ id: "T32", from: "S5.04", to: "S5.05", v8_event: "CLOSURE_APPROVED" }),
  Object.freeze({ id: "T33", from: "S5.05", to: "S5.06", v8_event: "ARCHIVE_TRANSFER_ACCEPTED" }),
  Object.freeze({ id: "T34", from: "S2.02", to: "S5.05", v8_event: "INCOMPLETE_CLOSURE_APPROVED" }),
]);

/** A V8 sub-state code (28 values). */
export type V8Code = (typeof V8_SUBSTATES)[number]["code"];
/** A V8 master-journey stage code (5 values). */
export type StageCode = (typeof MASTER_STAGES)[number]["code"];
/** One of the 34 V8 transitions. */
export type V8TransitionRecord = (typeof V8_TRANSITIONS)[number];
export const V8_CODES: readonly V8Code[] = Object.freeze(V8_SUBSTATES.map((s) => s.code));
export const STAGE_CODES: readonly StageCode[] = Object.freeze(MASTER_STAGES.map((s) => s.code));
/** FACT (review/v12-forensic/work/W3_journeys_review.md:59): S1.01 is the only entry (in-degree 0). */
export const CASE_ENTRY_CODE: V8Code = "S1.01";
/** FACT (W3_journeys_review.md:59): terminals S5.06 (archived) and S5.07 (transferred), out-degree 0. */
export const CASE_TERMINAL_CODES: readonly V8Code[] = Object.freeze(["S5.06", "S5.07"] as const);
/** INFERENCE (sub-state keys CLOSED / ARCHIVED / TRANSFERRED_CLOSED): the codes at which the case path is closed. */
export const CLOSURE_CODES: readonly V8Code[] = Object.freeze(["S5.05", "S5.06", "S5.07"] as const);
/** FACT (W3_journeys_review.md:59): backward transitions. */
export const BACKWARD_TRANSITIONS = Object.freeze(["T06", "T31"] as const);
/** FACT (W3_journeys_review.md:59): skip-ahead (early closure) transitions. */
export const SKIP_AHEAD_TRANSITIONS = Object.freeze(["T09", "T12", "T21", "T27", "T34"] as const);
/** FACT (CHARTER.md §3.1): the five case flags. */
export const CASE_FLAGS = Object.freeze([
  "suspended",
  "returned",
  "cancelled",
  "reopened",
  "closed",
] as const);
/** One of the five case flags (charter §3.1). */
export type CaseFlag = (typeof CASE_FLAGS)[number];
/** The five case flags (charter §3.1). */
export type CaseFlags = Readonly<Record<CaseFlag, boolean>>;
/**
 * Which event sets which flag (PROPOSAL; CASE_CANCELLED is a W-A addition, concepts.js). No event clears
 * `returned` and no V8 transition leaves S5.05–S5.07 after a reopening: both SOURCE_REQUIRED (W3 F11, :38).
 */
export const CASE_FLAG_EVENTS: Readonly<Record<string, Readonly<Partial<Record<CaseFlag, boolean>>>>> =
  Object.freeze({
    CASE_SUSPENDED: Object.freeze({ suspended: true }),
    CASE_RESUMED: Object.freeze({ suspended: false }),
    CASE_RETURNED: Object.freeze({ returned: true }),
    CASE_CLOSED: Object.freeze({ closed: true }),
    CASE_REOPENED: Object.freeze({ closed: false, reopened: true }),
    CASE_CANCELLED: Object.freeze({ cancelled: true }),
  });

export function isV8Code(code: unknown): code is V8Code {
  return typeof code === "string" && has(V8_CODES, code);
}
/** Safe inference SI-02 (charter §3.5): the Level-1 stage of a recorded code. */
export function stageOf(code: unknown): StageCode {
  const s = V8_SUBSTATES.find((x) => x.code === code);
  if (!s) return fail("UNKNOWN_V8_CODE", `not one of the 28 V8 codes: ${String(code)}`);
  return s.stage;
}
export function v8Transition(from: unknown, to: unknown): V8TransitionRecord | null {
  return V8_TRANSITIONS.find((t) => t.from === from && t.to === to) || null;
}

// =====================================================================================================
// The seven status objects (charter §3.4)
// =====================================================================================================
const L = (ar: string, en: string): Bilingual => Object.freeze({ ar, en });
type Pair<S extends string> = readonly [S, S];
const pairsOf = <S extends string>(rows: readonly (readonly [S, readonly S[]])[]): Pair<S>[] =>
  rows.flatMap(([from, tos]) => tos.map((to): Pair<S> => Object.freeze([from, to] as const)));
const MIG1920 =
  "cdf_case_management/infrastructure/supabase/migrations/20261007001920_notification_engine.sql";
const CONTRACTS = "cdf_case_management/packages/contracts/src/index.ts";
const TWSM = "cdf_case_management/docs/business-architecture/TARGET_WORKFLOW_STATE_MODEL.md"; // the charter calls it rebase/TARGET_WORKFLOW_STATE_MODEL.md

/** A platform enum or record aligned to a status object (FACT where cited; mappings are INFERENCE). */
export interface PlatformAlignment {
  readonly platform: string;
  readonly ref: string;
  readonly label: Label;
  readonly mapping: string;
}
/** A status object of charter §3.4 over its own state type `S`, discriminated by `name`. */
export interface StatusObjectDef<N extends StatusObjectName, S extends string> {
  readonly name: N;
  readonly ar: string;
  readonly en: string;
  readonly owner_domain: OwnerDomain;
  readonly meaning: Bilingual;
  readonly states: readonly S[];
  readonly labels: Readonly<Record<S, Bilingual>>;
  readonly initial: readonly S[];
  readonly pairs: readonly Pair<S>[];
  readonly terminal: readonly S[];
  readonly evidence_free: readonly S[];
  readonly active: readonly S[];
  readonly derived_flags: readonly string[];
  readonly lineage_pairs: readonly Pair<S>[];
  readonly platform_alignment: readonly PlatformAlignment[];
  readonly flags?: readonly CaseFlag[];
  readonly source: string;
  readonly label: Label;
}
/** The input of statusObject(): the computed and optional lists are filled in. */
interface StatusObjectInput<N extends StatusObjectName, S extends string> {
  name: N;
  ar: string;
  en: string;
  owner_domain: OwnerDomain;
  meaning: Bilingual;
  states: readonly S[];
  labels: Record<S, Bilingual>;
  initial: readonly S[];
  pairs: readonly (readonly [S, S])[];
  evidence_free?: readonly S[];
  active?: readonly S[];
  derived_flags?: readonly string[];
  lineage_pairs?: readonly (readonly [S, S])[];
  platform_alignment?: readonly PlatformAlignment[];
  flags?: readonly CaseFlag[];
  source: string;
  label: Label;
}

function statusObject<N extends StatusObjectName, S extends string>(
  def: StatusObjectInput<N, S>,
): StatusObjectDef<N, S> {
  const pairs = Object.freeze(def.pairs.map((p): Pair<S> => Object.freeze([...p] as [S, S])));
  const terminal = Object.freeze(def.states.filter((s) => !pairs.some(([f]) => f === s)));
  return Object.freeze({
    ...def,
    states: Object.freeze([...def.states]),
    labels: Object.freeze(def.labels),
    initial: Object.freeze([...def.initial]),
    pairs,
    terminal,
    evidence_free: Object.freeze([...(def.evidence_free || [])]),
    active: Object.freeze([...(def.active || [])]),
    derived_flags: Object.freeze([...(def.derived_flags || [])]),
    lineage_pairs: Object.freeze(
      (def.lineage_pairs || []).map((p): Pair<S> => Object.freeze([...p] as [S, S])),
    ),
    platform_alignment: Object.freeze((def.platform_alignment || []).map((a) => Object.freeze(a))),
  });
}

const PROCEDURE_STATES = [
  "NOT_STARTED",
  "OPEN",
  "IN_PROGRESS",
  "ON_HOLD",
  "RETURNED",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
  "NOT_APPLICABLE",
] as const;
const TASK_STATES = [
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "RETURNED",
  "COMPLETED",
  "CANCELLED",
] as const;
const MEETING_STATES = [
  "SCHEDULED",
  "RESCHEDULED",
  "CANCELLED",
  "OPENED",
  "CLOSED",
  "MINUTES_DRAFT",
  "MINUTES_UNDER_REVIEW",
  "MINUTES_FINAL",
] as const;
const DECISION_STATES = [
  "DRAFT",
  "UNDER_VOTE",
  "ADOPTED",
  "NOT_ADOPTED",
  "RETURNED",
  "SUBMITTED_TO_AUTHORITY",
  "DECIDED",
  "SUPERSEDED",
] as const;
const NOTIFICATION_STATES = [
  "DRAFT",
  "VALIDATED",
  "AUTHORIZATION_PENDING",
  "AUTHORIZED",
  "QUEUED",
  "SENT",
  "DELIVERY_CONFIRMED",
  "DELIVERY_FAILED",
  "CANCELLED",
  "CORRECTED",
  "SUPERSEDED",
] as const;
const DELIVERY_STATES = ["ATTEMPTED", "ACCEPTED_BY_PROVIDER", "FAILED", "BOUNCED"] as const;

/** CHARTER.md §3.4 enums, one type per status object. */
export type ProcedureState = (typeof PROCEDURE_STATES)[number];
export type TaskState = (typeof TASK_STATES)[number];
export type MeetingState = (typeof MEETING_STATES)[number];
export type DecisionState = (typeof DECISION_STATES)[number];
export type NotificationState = (typeof NOTIFICATION_STATES)[number];
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export type CaseStatusObject = StatusObjectDef<"CaseStatus", V8Code>;
export type ProcedureStatusObject = StatusObjectDef<"ProcedureStatus", ProcedureState>;
export type TaskStatusObject = StatusObjectDef<"TaskStatus", TaskState>;
export type MeetingStatusObject = StatusObjectDef<"MeetingStatus", MeetingState>;
export type DecisionStatusObject = StatusObjectDef<"DecisionStatus", DecisionState>;
export type NotificationStatusObject = StatusObjectDef<"NotificationStatus", NotificationState>;
export type DeliveryStatusObject = StatusObjectDef<"DeliveryStatus", DeliveryState>;
/** The seven status objects, discriminated by `name` (charter §3.4: never collapsed into one field). */
export type StatusObject =
  | CaseStatusObject
  | ProcedureStatusObject
  | TaskStatusObject
  | MeetingStatusObject
  | DecisionStatusObject
  | NotificationStatusObject
  | DeliveryStatusObject;
/** Any status object read through its string states (every member of StatusObject is one). */
export type AnyStatusObject = StatusObjectDef<StatusObjectName, string>;
/** A state of any status object. */
export type StatusState =
  V8Code | ProcedureState | TaskState | MeetingState | DecisionState | NotificationState | DeliveryState;

export interface StatusObjects {
  readonly CaseStatus: CaseStatusObject;
  readonly ProcedureStatus: ProcedureStatusObject;
  readonly TaskStatus: TaskStatusObject;
  readonly MeetingStatus: MeetingStatusObject;
  readonly DecisionStatus: DecisionStatusObject;
  readonly NotificationStatus: NotificationStatusObject;
  readonly DeliveryStatus: DeliveryStatusObject;
}

export const STATUS_OBJECTS: StatusObjects = Object.freeze({
  CaseStatus: statusObject<"CaseStatus", V8Code>({
    name: "CaseStatus",
    ar: "حالة القضية",
    en: "Case status",
    owner_domain: "A",
    meaning: L(
      "رمز الحالة المسجَّل في المسار الرئيسي V8 (28 حالة فرعية) مع خمسة أعلام مستقلة؛ المصدر الوحيد للمستوى الأول.",
      "The recorded V8 master-journey code (28 sub-states) plus five independent flags; the only source of Level 1.",
    ),
    states: V8_SUBSTATES.map((s) => s.code),
    labels: Object.fromEntries(V8_SUBSTATES.map((s) => [s.code, L(s.ar, s.en)])) as Record<V8Code, Bilingual>,
    initial: ["S1.01", "S1.03"],
    pairs: V8_TRANSITIONS.map((t): readonly [V8Code, V8Code] => [t.from, t.to]),
    active: V8_SUBSTATES.map((s) => s.code).filter((c) => !CLOSURE_CODES.includes(c)),
    flags: CASE_FLAGS,
    source:
      "FACT: CHARTER.md §3.1, §3.4; codes and 34 transitions from notifications/generator/source/tests/v9_data.json (V8); initial S1.03 is PROPOSAL (record created at registration).",
    label: "FACT",
    platform_alignment: [
      {
        platform: "case stage",
        ref: `${TWSM}:11`,
        label: "FACT",
        mapping:
          'The platform keeps no V8 code: its case stage (INTAKE, PRELIMINARY_REVIEW, INVESTIGATION, COMMITTEE, LEGAL_REVIEW, DECISION, EXECUTION, GRIEVANCE, CLOSURE, RECORDS) is "derived from the CDF_CASE_V1 state and the open proceedings".',
      },
      {
        platform: "V8 code",
        ref: "concepts.js CASE.authoritative_source",
        label: "INFERENCE",
        mapping:
          "CaseRecord.status.code is supplied by the mock case adapter (PRODUCTION_SUBSTITUTION_REQUIRED); the V8 ↔ platform-stage mapping is SOURCE_REQUIRED.",
      },
    ],
  }),

  ProcedureStatus: statusObject<"ProcedureStatus", ProcedureState>({
    name: "ProcedureStatus",
    ar: "حالة الإجراء",
    en: "Procedure status",
    owner_domain: "B",
    meaning: L(
      "حالة إجراء أو إحالة أو بلاغ أو تحقيق أو تصويت أو رأي نظامي؛ لا تُشتق من حالة القضية ولا تشتقها.",
      "The status of a proceeding, referral, report, investigation, ballot or legal opinion; neither derived from nor deriving the case status.",
    ),
    states: PROCEDURE_STATES,
    labels: {
      NOT_STARTED: L("لم يبدأ", "Not started"),
      OPEN: L("مفتوح", "Open"),
      IN_PROGRESS: L("قيد الإجراء", "In progress"),
      ON_HOLD: L("موقوف مؤقتاً", "On hold"),
      RETURNED: L("أُعيد لاستكمال متطلبات", "Returned for completion"),
      COMPLETED: L("مكتمل", "Completed"),
      CANCELLED: L("أُلغي", "Cancelled"),
      FAILED: L("تعذّر إتمامه", "Failed"),
      NOT_APPLICABLE: L("لا ينطبق", "Not applicable"),
    },
    initial: ["NOT_STARTED", "OPEN"],
    pairs: pairsOf([
      ["NOT_STARTED", ["OPEN", "CANCELLED", "NOT_APPLICABLE"]],
      ["OPEN", ["IN_PROGRESS", "ON_HOLD", "RETURNED", "COMPLETED", "CANCELLED", "FAILED"]],
      ["IN_PROGRESS", ["ON_HOLD", "RETURNED", "COMPLETED", "CANCELLED", "FAILED"]],
      ["ON_HOLD", ["IN_PROGRESS", "CANCELLED"]],
      ["RETURNED", ["IN_PROGRESS", "CANCELLED"]],
      ["FAILED", ["IN_PROGRESS", "CANCELLED"]],
    ]),
    evidence_free: ["NOT_STARTED", "NOT_APPLICABLE"],
    active: ["OPEN", "IN_PROGRESS", "ON_HOLD", "RETURNED"],
    source: "FACT: enum CHARTER.md §3.4; PROPOSAL: transitions (W-A).",
    label: "PROPOSAL",
    platform_alignment: [
      {
        platform: "PROCEEDING_STATUSES",
        ref: `${CONTRACTS}:1034-1043`,
        label: "INFERENCE",
        mapping:
          "OPEN→OPEN · IN_PROGRESS→IN_PROGRESS · AWAITING_REVIEW→IN_PROGRESS (+waiting reason) · AWAITING_APPROVAL→IN_PROGRESS (+waiting reason) · RETURNED→RETURNED · SUSPENDED→ON_HOLD · CONCLUDED→COMPLETED · CANCELLED→CANCELLED; NOT_STARTED, FAILED, NOT_APPLICABLE have no platform value.",
      },
      {
        platform: "REFERRAL_STATUSES",
        ref: `${CONTRACTS}:1322-1333`,
        label: "INFERENCE",
        mapping:
          "DRAFT before the first submission: no V13 status (REFERRAL_CREATED is step evidence) · SUBMITTED_TO_HEAD→OPEN (in preparation; REFERRAL_SUBMITTED null→OPEN), or IN_PROGRESS after a resubmission (REFERRAL_SUBMITTED from RETURNED | FAILED; work/LEAD_notes.md L-10) · DRAFT after the sector head's return (SECTOR_RETURNED)→RETURNED (REFERRAL_HEAD_DECIDED {decision: RETURNED}, L-10) · SUBMITTED_TO_SECRETARY (SECTOR_APPROVED), OBJECTED, ESCALATED→IN_PROGRESS · RETURNED_FOR_COMPLETION→RETURNED (REFERRAL_RETURNED: the secretary's return only, L-10) · REJECTED→FAILED (not final) · ACCEPTED→COMPLETED · WITHDRAWN→CANCELLED.",
      },
      {
        platform: "REPORT_STATUSES",
        ref: `${CONTRACTS}:27-35`,
        label: "INFERENCE",
        mapping:
          "RECEIVED→OPEN · INFO_REQUESTED, ACCEPTED→IN_PROGRESS · CASE_OPENED, REFERRED_OUT, CLOSED_NO_ACTION, DUPLICATE→COMPLETED (the value stays as outcome). PUBLIC_REPORT_STATUSES (:39) are a projection for the reporter, never this status.",
      },
      {
        platform: "VOTE_ITEM_STATUSES",
        ref: `${CONTRACTS}:1488`,
        label: "INFERENCE",
        mapping: "OPEN, AWAITING_CASTING_VOTE→OPEN · CLOSED→COMPLETED (VOTE_RESULTS :1490 kept as outcome).",
      },
      {
        platform: "legal review",
        ref: `${TWSM} §3.6`,
        label: "INFERENCE",
        mapping: "REQUESTED→OPEN · OPINION_SUBMITTED→COMPLETED (LEGAL_OPINIONS :1538 kept as outcome).",
      },
      {
        platform: "GRIEVANCE_STATUSES",
        ref: `${CONTRACTS}:1572-1579`,
        label: "INFERENCE",
        mapping:
          "RECEIVED→OPEN · AWAITING_ADMISSIBILITY_DECISION, ADMITTED→IN_PROGRESS · INADMISSIBLE, DECIDED→COMPLETED · WITHDRAWN→CANCELLED.",
      },
    ],
  }),

  TaskStatus: statusObject<"TaskStatus", TaskState>({
    name: "TaskStatus",
    ar: "حالة المهمة",
    en: "Task status",
    owner_domain: "B",
    meaning: L(
      "حالة عمل مُسند إلى صاحب صفة؛ التأخر علامة مشتقة (isOverdue) وليس حالة.",
      "The status of work assigned to a capacity; being overdue is a derived flag (isOverdue), never a status.",
    ),
    states: TASK_STATES,
    labels: {
      ASSIGNED: L("مُسندة", "Assigned"),
      ACCEPTED: L("قبلها المكلَّف", "Accepted"),
      IN_PROGRESS: L("قيد التنفيذ", "In progress"),
      SUBMITTED: L("قُدِّم المخرَج للمراجعة", "Submitted"),
      RETURNED: L("أُعيدت للاستكمال", "Returned"),
      COMPLETED: L("مكتملة", "Completed"),
      CANCELLED: L("أُلغيت", "Cancelled"),
    },
    initial: ["ASSIGNED"],
    pairs: pairsOf([
      ["ASSIGNED", ["ACCEPTED", "IN_PROGRESS", "SUBMITTED", "CANCELLED"]],
      ["ACCEPTED", ["IN_PROGRESS", "SUBMITTED", "CANCELLED"]],
      ["IN_PROGRESS", ["SUBMITTED", "COMPLETED", "CANCELLED"]],
      ["SUBMITTED", ["COMPLETED", "RETURNED", "CANCELLED"]],
      ["RETURNED", ["IN_PROGRESS", "SUBMITTED", "CANCELLED"]],
    ]),
    active: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "SUBMITTED", "RETURNED"],
    derived_flags: ["OVERDUE"],
    source:
      'FACT: enum and "OVERDUE is a derived flag, never a status" CHARTER.md §3.4; PROPOSAL: transitions (W-A).',
    label: "PROPOSAL",
    platform_alignment: [
      {
        platform: "CASE_TASK_STATUSES",
        ref: `${CONTRACTS}:156`,
        label: "INFERENCE",
        mapping:
          "OPEN→ASSIGNED · IN_PROGRESS→IN_PROGRESS · COMPLETED→COMPLETED · CANCELLED→CANCELLED · EXPIRED→no V13 status (gap: an expiry is an outcome; OVERDUE is derived).",
      },
      {
        platform: "CORRECTIVE_ACTION_STATUSES",
        ref: `${CONTRACTS}:1822-1828`,
        label: "INFERENCE",
        mapping:
          "OPEN→ASSIGNED · IN_PROGRESS→IN_PROGRESS · PENDING_VERIFICATION→SUBMITTED · COMPLETED→COMPLETED · WAIVED→no V13 status (gap). VERIFICATION_DECISIONS (:1830) VERIFIED→COMPLETED, RETURNED→RETURNED.",
      },
      {
        platform: "DEFENCE_NOTICE_STATUSES",
        ref: `${CONTRACTS}:1564`,
        label: "INFERENCE",
        mapping:
          "ISSUED→ASSIGNED · ACKNOWLEDGED→ACCEPTED · RESPONDED→SUBMITTED · WITHDRAWN→CANCELLED (the notice is a procedural act, not a platform notification).",
      },
      {
        platform: "EXECUTION_STATES",
        ref: `${CONTRACTS}:1837-1845`,
        label: "FACT",
        mapping: 'The platform also treats OVERDUE as derived ("derived … never stored").',
      },
    ],
  }),

  MeetingStatus: statusObject<"MeetingStatus", MeetingState>({
    name: "MeetingStatus",
    ar: "حالة الاجتماع",
    en: "Meeting status",
    owner_domain: "B",
    meaning: L(
      "حالة الاجتماع أو جلسة الاستماع ومحضره؛ الجدولة والدعوة لا تعنيان الانعقاد.",
      "The status of a meeting or hearing and its minutes; scheduling and invitation never mean it took place.",
    ),
    states: MEETING_STATES,
    labels: {
      SCHEDULED: L("مجدول", "Scheduled"),
      RESCHEDULED: L("أُعيدت جدولته", "Rescheduled"),
      CANCELLED: L("أُلغي", "Cancelled"),
      OPENED: L("افتُتح", "Opened"),
      CLOSED: L("اختُتم", "Closed"),
      MINUTES_DRAFT: L("المحضر قيد التحرير", "Minutes in draft"),
      MINUTES_UNDER_REVIEW: L("المحضر قيد المراجعة", "Minutes under review"),
      MINUTES_FINAL: L("المحضر نهائي", "Minutes final"),
    },
    initial: ["SCHEDULED"],
    pairs: pairsOf([
      ["SCHEDULED", ["RESCHEDULED", "CANCELLED", "OPENED"]],
      ["RESCHEDULED", ["RESCHEDULED", "CANCELLED", "OPENED"]],
      ["OPENED", ["CLOSED"]],
      ["CLOSED", ["MINUTES_DRAFT", "MINUTES_UNDER_REVIEW"]],
      ["MINUTES_DRAFT", ["MINUTES_UNDER_REVIEW"]],
      ["MINUTES_UNDER_REVIEW", ["MINUTES_DRAFT", "MINUTES_FINAL"]],
    ]),
    active: ["SCHEDULED", "RESCHEDULED", "OPENED"],
    source: `FACT: enum CHARTER.md §3.4; SCHEDULED→OPEN→CLOSED, CANCELLED from SCHEDULED: ${TWSM} §3.4; PROPOSAL: the other rows (W-A).`,
    label: "PROPOSAL",
    platform_alignment: [
      {
        platform: "MEETING_STATUSES",
        ref: `${CONTRACTS}:1424`,
        label: "INFERENCE",
        mapping:
          "SCHEDULED→SCHEDULED · OPEN→OPENED · CLOSED→CLOSED · CANCELLED→CANCELLED; RESCHEDULED has no platform state (a reschedule is an update of SCHEDULED).",
      },
      {
        platform: "MINUTES_STATUSES",
        ref: `${CONTRACTS}:1492-1498`,
        label: "INFERENCE",
        mapping:
          "IN_REVIEW→MINUTES_UNDER_REVIEW · CHANGES_REQUESTED→MINUTES_DRAFT · APPROVED, DEEMED_APPROVED→MINUTES_FINAL · SUPERSEDED→a replaced minutes version (the meeting keeps its state). The platform keeps meeting and minutes as two records; charter §3.4 places both in MeetingStatus.",
      },
    ],
  }),

  DecisionStatus: statusObject<"DecisionStatus", DecisionState>({
    name: "DecisionStatus",
    ar: "حالة التوصية أو القرار",
    en: "Decision status (recommendation / authority decision)",
    owner_domain: "B",
    meaning: L(
      "حالة التوصية وحالة قرار صاحب الصلاحية، كلٌّ في كائن مستقل؛ الاعتماد ليس قراراً، والإعادة إلى اللجنة ليست قراراً في الموضوع.",
      "The status of a recommendation and, separately, of the authority decision; adoption is not a decision and a return to the committee is not a decision on the merits.",
    ),
    states: DECISION_STATES,
    labels: {
      DRAFT: L("مسودة", "Draft"),
      UNDER_VOTE: L("قيد التصويت", "Under vote"),
      ADOPTED: L("اعتمدتها جهة الاختصاص", "Adopted"),
      NOT_ADOPTED: L("لم تُعتمد", "Not adopted"),
      RETURNED: L("أُعيدت", "Returned"),
      SUBMITTED_TO_AUTHORITY: L("رُفعت إلى صاحب الصلاحية", "Submitted to the authority"),
      DECIDED: L("صدر فيها قرار صاحب الصلاحية", "Decided by the authority"),
      SUPERSEDED: L("حلّ محلها غيرها", "Superseded"),
    },
    initial: ["DRAFT", "SUBMITTED_TO_AUTHORITY"],
    pairs: pairsOf([
      ["DRAFT", ["UNDER_VOTE", "ADOPTED", "SUPERSEDED"]],
      ["UNDER_VOTE", ["ADOPTED", "NOT_ADOPTED"]],
      ["ADOPTED", ["SUBMITTED_TO_AUTHORITY", "RETURNED", "SUPERSEDED"]],
      ["NOT_ADOPTED", ["UNDER_VOTE", "DRAFT", "SUPERSEDED"]],
      ["RETURNED", ["DRAFT", "UNDER_VOTE", "SUPERSEDED"]],
      ["SUBMITTED_TO_AUTHORITY", ["DECIDED", "RETURNED"]],
      ["DECIDED", ["SUPERSEDED"]],
    ]),
    active: ["DRAFT", "UNDER_VOTE", "ADOPTED", "NOT_ADOPTED", "RETURNED", "SUBMITTED_TO_AUTHORITY"],
    source:
      "FACT: enum CHARTER.md §3.4; PROPOSAL: transitions (W-A), union of the RECOMMENDATION and DECISION tables in concepts.js.",
    label: "PROPOSAL",
    platform_alignment: [
      {
        platform: "RECOMMENDATION_PACKAGE_STATUSES",
        ref: `${CONTRACTS}:1524-1533`,
        label: "INFERENCE",
        mapping:
          "DRAFT→DRAFT · VOTING→UNDER_VOTE only from the opening of the vote (RECOMMENDATION_PACKAGE_VOTE_OPENED, migration 1900:841 → BALLOT_OPENED); VOTING set by api.submit_package_for_vote (1900:795-798, RECOMMENDATION_PACKAGE_SUBMITTED_FOR_VOTE → PACKAGE_SUBMITTED_FOR_VOTE) is a requested vote and moves nothing (directive §4.3 :370; FD-05) · ADOPTED, IN_LEGAL_REVIEW→ADOPTED (the legal review is its own LEGAL_OPINION object) · RETURNED_BY_LEGAL, RETURNED_BY_AUTHORITY→RETURNED · AWAITING_AUTHORITY→SUBMITTED_TO_AUTHORITY · DECIDED→DECIDED. A vote that does not adopt sets the platform package back to DRAFT with audit RECOMMENDATION_PACKAGE_NOT_ADOPTED (migration 1900:887); V13 keeps NOT_ADOPTED.",
      },
      {
        platform: "authority decision",
        ref: `${TWSM} §3.7; ${CONTRACTS}:1542-1549`,
        label: "INFERENCE",
        mapping:
          "AWAITING→SUBMITTED_TO_AUTHORITY · RECORDED, EFFECTIVE→DECIDED (effective requires the source document) · outcome RETURN_TO_COMMITTEE→RETURNED, never DECIDED · GRIEVANCE_OUTCOMES MODIFY / CANCEL (:1581-1593)→SUPERSEDED.",
      },
    ],
  }),

  NotificationStatus: statusObject<"NotificationStatus", NotificationState>({
    name: "NotificationStatus",
    ar: "حالة الإشعار",
    en: "Notification status",
    owner_domain: "F",
    meaning: L(
      "دورة حياة الإشعار بصفته تمثيلاً تواصلياً (الميثاق §9)؛ لا تغيّر أي حالة إجرائية، والإقرار بالاستلام حدث وليس حالة.",
      "The lifecycle of the notification as a communicative representation (charter §9); it changes no procedural status, and acknowledgement is an event, not a status.",
    ),
    states: NOTIFICATION_STATES,
    labels: {
      DRAFT: L("مسودة", "Draft"),
      VALIDATED: L("اجتاز التحقق", "Validated"),
      AUTHORIZATION_PENDING: L("بانتظار الإذن", "Authorization pending"),
      AUTHORIZED: L("مأذون بإرساله", "Authorized"),
      QUEUED: L("في طابور الإرسال", "Queued"),
      SENT: L("أُرسل — لم يُؤكَّد التسليم", "Sent — delivery not confirmed"),
      DELIVERY_CONFIRMED: L("تأكد التسليم", "Delivery confirmed"),
      DELIVERY_FAILED: L("تعذّر التسليم", "Delivery failed"),
      CANCELLED: L("أُلغي", "Cancelled"),
      CORRECTED: L("تصحيح قيد الإعداد", "Correction in preparation"),
      SUPERSEDED: L("حلّ محله إصدار أحدث أُرسل", "Superseded by a newer version that was sent"),
    },
    initial: ["DRAFT", "CORRECTED"],
    pairs: pairsOf([
      ["DRAFT", ["VALIDATED", "CANCELLED"]],
      ["VALIDATED", ["AUTHORIZATION_PENDING", "AUTHORIZED", "CANCELLED"]],
      ["AUTHORIZATION_PENDING", ["AUTHORIZED", "CANCELLED"]],
      ["AUTHORIZED", ["QUEUED", "CANCELLED"]],
      ["QUEUED", ["SENT", "CANCELLED"]],
      ["SENT", ["DELIVERY_CONFIRMED", "DELIVERY_FAILED", "SUPERSEDED"]],
      ["DELIVERY_CONFIRMED", ["SUPERSEDED"]],
      ["DELIVERY_FAILED", ["SUPERSEDED"]],
      ["CORRECTED", ["VALIDATED", "CANCELLED"]],
    ]),
    lineage_pairs: [
      ["SENT", "CORRECTED"],
      ["DELIVERY_CONFIRMED", "CORRECTED"],
      ["DELIVERY_FAILED", "CORRECTED"],
    ],
    active: ["DRAFT", "CORRECTED", "VALIDATED", "AUTHORIZATION_PENDING", "AUTHORIZED", "QUEUED", "SENT"],
    source:
      'FACT: enum CHARTER.md §3.4 and transitions §9, read per work/LEAD_notes.md L-04 (lead decision, binding for V13; closes W-A gap G-03). Record level: SENT → DELIVERY_CONFIRMED | DELIVERY_FAILED | SUPERSEDED; DELIVERY_CONFIRMED / DELIVERY_FAILED → SUPERSEDED; CORRECTED → VALIDATED | CANCELLED. CORRECTED is the entry state of the correcting version n+1 (an initial state); version n stays current and becomes SUPERSEDED only when n+1 reaches SENT, in the same step; a cancelled correction leaves version n current. The charter pair "SENT/DELIVERY_* → CORRECTED (new version, old SUPERSEDED)" is lineage level (lineage_pairs; LINEAGE_TRANSITIONS; checkLineage). INFERENCE: VALIDATED→AUTHORIZED when no approval is required. The record pairs equal W-D1 src/lifecycle/notification.js ALLOWED_TRANSITIONS (LC-23).',
    label: "FACT",
    platform_alignment: [
      {
        platform: "notify.outbox.status",
        ref: `${MIG1920}:118, 123, 125`,
        label: "INFERENCE",
        mapping:
          "PENDING→QUEUED · an IN_APP row is SENT on insert (:125), i.e. placed in the recipient's platform inbox: V13 SENT and DELIVERY_CONFIRMED together (work/LEAD_notes.md L-02) · an EMAIL row becomes SENT when the sender returns success (:598-609; intended production sender: the CDF mail relay, a pending human decision): under the default ACCEPTANCE reading (L-07, closes gap G-08) that is a delivery attempt ACCEPTED_BY_PROVIDER and the notification stays SENT (\"sent; delivery not confirmed\"); DELIVERY_CONFIRMED needs a provider delivery report, which the platform does not record (UNVERIFIED; PRODUCTION_SUBSTITUTION_REQUIRED); only the explicit SETTLEMENT configuration reads the sender's success as DELIVERY_CONFIRMED (charter §9 read literally) · FAILED→DELIVERY_FAILED (after the fifth attempt, :609). V13 DRAFT, VALIDATED, AUTHORIZATION_PENDING, AUTHORIZED, CANCELLED, CORRECTED, SUPERSEDED have no platform value: the platform enqueues from triggers (:13-17). Name collision: platform SENT ≠ V13 SENT.",
      },
      {
        platform: "notify.outbox.read_at",
        ref: `${MIG1920}:122, 124`,
        label: "INFERENCE",
        mapping:
          "An IN_APP read marker; neither a V13 status nor a RECIPIENT_ACKNOWLEDGED event (reading is not acknowledging).",
      },
    ],
  }),

  DeliveryStatus: statusObject<"DeliveryStatus", DeliveryState>({
    name: "DeliveryStatus",
    ar: "حالة محاولة التسليم",
    en: "Delivery status (per attempt)",
    owner_domain: "F",
    meaning: L(
      "حالة كل محاولة تسليم على حدة؛ قبول الناقل ليس تسليماً مؤكداً ولا قراءة ولا إقراراً.",
      "The status of each delivery attempt; acceptance by the provider is neither confirmed delivery, nor reading, nor acknowledgement.",
    ),
    states: DELIVERY_STATES,
    labels: {
      ATTEMPTED: L("جرت محاولة", "Attempted"),
      ACCEPTED_BY_PROVIDER: L("قبلها ناقل القناة", "Accepted by the provider"),
      FAILED: L("فشلت المحاولة", "Attempt failed"),
      BOUNCED: L("ارتدّت", "Bounced"),
    },
    initial: ["ATTEMPTED"],
    pairs: pairsOf([
      ["ATTEMPTED", ["ACCEPTED_BY_PROVIDER", "FAILED"]],
      ["ACCEPTED_BY_PROVIDER", ["BOUNCED"]],
    ]),
    active: ["ATTEMPTED"],
    source:
      'FACT: enum and "recipient acknowledgement is a separate event, never a delivery status" CHARTER.md §3.4; PROPOSAL: transitions (W-A).',
    label: "PROPOSAL",
    platform_alignment: [
      {
        platform: "notify.outbox.attempts",
        ref: `${MIG1920}:119, 580-615`,
        label: "INFERENCE",
        mapping:
          "Each claim (claim_email_batch, attempts+1) ≈ ATTEMPTED; record_email_delivery(delivered=true) = ACCEPTED_BY_PROVIDER (the sender returned success; stub sender, PRODUCTION_SUBSTITUTION_REQUIRED): the notification stays SENT under the default ACCEPTANCE reading (work/LEAD_notes.md L-07; gap G-08 closed); delivered=false ≈ FAILED; BOUNCED has no platform value. The platform keeps a counter, not a per-attempt record (gap); V13 (W-D1) keeps one DELIVERY_ATTEMPT evidence entry per attempt state (L-07, D5).",
      },
    ],
  }),
});

export const STATUS_OBJECT_NAMES: readonly StatusObjectName[] = Object.freeze(
  Object.keys(STATUS_OBJECTS) as StatusObjectName[],
);

// ---- Notification lineage (work/LEAD_notes.md L-04) -------------------------------------------------------------------
/** Statuses of an issued version (W-D1 ISSUED_STATUSES): the only ones a correction starts from. */
export const ISSUED_NOTIFICATION_STATES: readonly NotificationState[] = Object.freeze([
  "SENT",
  "DELIVERY_CONFIRMED",
  "DELIVERY_FAILED",
] as const);
/** Statuses of a correcting version that is not yet issued (W-D1 PENDING_CORRECTION_STATUSES). */
export const PENDING_CORRECTION_STATES: readonly NotificationState[] = Object.freeze([
  "CORRECTED",
  "VALIDATED",
  "AUTHORIZATION_PENDING",
  "AUTHORIZED",
  "QUEUED",
] as const);
/**
 * Lineage-level pairs (L-04 item 5): the charter's "SENT/DELIVERY_* → CORRECTED" reads "the lineage's issued version n
 * gets a correcting version n+1 in CORRECTED"; version n itself does not move until n+1 is SENT (then SUPERSEDED).
 * Equal to W-D1 LINEAGE_TRANSITIONS.
 */
export const LINEAGE_TRANSITIONS: Readonly<Partial<Record<NotificationState, readonly NotificationState[]>>> =
  Object.freeze(
    Object.fromEntries(
      STATUS_OBJECTS.NotificationStatus.lineage_pairs.map(([from, to]) => [from, Object.freeze([to])]),
    ),
  );
/** canCorrect(status) → may a version in `status` be corrected (L-04 item 1)? */
export function canCorrect(status: unknown): boolean {
  return has(ISSUED_NOTIFICATION_STATES, status);
}
export {
  DELIVERY_CONFIRMATION_MODES,
  DEFAULT_DELIVERY_CONFIRMATION,
  DELIVERY_EVIDENCE_KINDS,
} from "./concepts";

// =====================================================================================================
// Resolution of an object type (status-object name or concept id)
// =====================================================================================================
const LIFECYCLE_CONCEPTS: readonly string[] = Object.freeze(
  CONCEPTS.filter((c) => c.lifecycle !== "none").map((c) => c.id),
);
export { LIFECYCLE_CONCEPTS };

/** The status-object name of a concept ('none' for concepts without a status object). */
export function lifecycleOf(conceptId: unknown): StatusObjectName | "none" {
  return getConcept(conceptId).lifecycle;
}

/** A status object read through its string states. */
const soOf = (name: StatusObjectName): AnyStatusObject => STATUS_OBJECTS[name];
/** An object type resolved to its status object: a status-object name, or a concept with a lifecycle. */
type Resolved =
  | { readonly kind: "STATUS_OBJECT"; readonly so: AnyStatusObject; readonly concept: null }
  | { readonly kind: "CONCEPT"; readonly so: AnyStatusObject; readonly concept: Concept };

function resolve(objectType: unknown): Resolved {
  if (typeof objectType === "string" && own(STATUS_OBJECTS, objectType))
    return { kind: "STATUS_OBJECT", so: soOf(objectType as StatusObjectName), concept: null };
  if (has(CONCEPT_IDS, objectType)) {
    const c = getConcept(objectType);
    if (c.lifecycle === "none")
      return fail("NO_STATUS_OBJECT", `${objectType} has no status object (lifecycle 'none')`);
    return { kind: "CONCEPT", so: soOf(c.lifecycle), concept: c };
  }
  return fail(
    "UNKNOWN_OBJECT_TYPE",
    `neither a status object nor a concept with a lifecycle: ${String(objectType)}`,
  );
}

/** The status object (definition) governing an object type. */
export function statusObjectOf(objectType: unknown): StatusObject {
  return resolve(objectType).so as StatusObject;
}

/** The transition rows of a concept (concepts.ts) — or, for a status-object name, its generic pairs as rows. */
export function transitionsOf(objectType: unknown): readonly TransitionRow[] {
  const r = resolve(objectType);
  if (r.kind === "CONCEPT") return r.concept.transitions;
  return r.so.pairs.map(([from, to]): TransitionRow =>
    Object.freeze({ from: Object.freeze([from]), to, on: Object.freeze([]), when: null }),
  );
}

/**
 * holdsOf(conceptId) → the concept's hold rows (PROPOSAL, W-A; work/LEAD_notes.md L-10): a driving event recorded
 * legitimately from one of these states leaves the status unchanged (e.g. the sector head's approval of a resubmitted
 * referral). A hold never leads into a status and is never a status source. Empty for status-object names.
 */
export function holdsOf(objectType: unknown): readonly HoldRow[] {
  const r = resolve(objectType);
  return r.kind === "CONCEPT" ? r.concept.holds || Object.freeze([]) : Object.freeze([]);
}

const isCaseType = (t: unknown): boolean => t === "CASE" || t === "CaseStatus";

/**
 * canTransition(objectType, from, to) → boolean.
 * objectType: a status-object name (generic table) or a concept id (its own table; CASE uses the 34 V8 pairs and,
 * for flags, rows such as 'flags.suspended=false' → 'flags.suspended=true'). from === null asks whether `to` may be
 * the first status. Unknown states → false (fail closed); unknown object type → DomainError.
 */
export function canTransition(objectType: unknown, from: unknown, to: unknown): boolean {
  const r = resolve(objectType);
  if (isCaseType(objectType)) {
    if (from === null || from === undefined) return has(r.so.initial, to);
    if (isV8Code(from) && isV8Code(to)) return v8Transition(from, to) !== null;
    if (r.kind === "CONCEPT")
      return r.concept.transitions.some((t) => t.from && has(t.from, from) && t.to === to);
    return false;
  }
  if (!has(r.so.states, to)) return false;
  if (from === null || from === undefined) {
    if (r.kind === "STATUS_OBJECT") return has(r.so.initial, to);
    return (
      r.concept.transitions.some((t) => t.from === null && t.to === to) ||
      r.concept.transitions.some((t) => t.from && t.from.includes(null) && t.to === to)
    );
  }
  if (!has(r.so.states, from)) return false;
  if (r.kind === "STATUS_OBJECT") return r.so.pairs.some(([f, t]) => f === from && t === to);
  return r.concept.transitions.some((t) => t.from && has(t.from, from) && t.to === to);
}

/** isTerminal(objectType, status) → boolean: no transition leaves `status` in that type's table. */
export function isTerminal(objectType: unknown, status: unknown): boolean {
  const r = resolve(objectType);
  if (!has(r.so.states, status)) fail("UNKNOWN_STATE", `${String(status)} is not a ${r.so.name} state`);
  if (isCaseType(objectType)) return has(CASE_TERMINAL_CODES, status);
  if (r.kind === "STATUS_OBJECT") return has(r.so.terminal, status);
  return !r.concept.transitions.some((t) => t.from && has(t.from, status));
}

/** Event types that may change the status of `objectType` (union over the concepts using a status object). */
export function drivingEvents(objectType: unknown): readonly string[] {
  if (own(STATUS_OBJECTS, objectType as PropertyKey)) {
    const set = new Set<string>();
    for (const c of CONCEPTS)
      if (c.lifecycle === objectType) for (const t of c.transitions) for (const e of t.on) set.add(e);
    return Object.freeze([...set]);
  }
  const r = resolve(objectType);
  // A status-object name was handled above, so `r` is a concept here (a null concept throws, as in the reference).
  return Object.freeze([...new Set((r.concept as Concept).transitions.flatMap((t) => t.on))]);
}

/** States that need no evidence event (they assert that nothing happened). */
export function isEvidenceFree(objectType: unknown, status: unknown): boolean {
  const r = resolve(objectType);
  return has(r.so.evidence_free, status);
}

/** Event types whose rows lead into `status` for `objectType` (concept id). Empty for evidence-free states. */
export function evidenceEventsInto(objectType: unknown, status: unknown): readonly string[] {
  const r = resolve(objectType);
  if (r.kind !== "CONCEPT") return fail("CONCEPT_REQUIRED", "evidenceEventsInto needs a concept id");
  if (isCaseType(objectType)) return CASE_CODE_EVENTS;
  return Object.freeze([
    ...new Set(r.concept.transitions.filter((t) => t.to === status).flatMap((t) => t.on)),
  ]);
}

// =====================================================================================================
// Events: concern, ordering, guards, fold
// =====================================================================================================
const getPath = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (isNil(o) ? undefined : (o as Record<string, unknown>)[k]), obj);

/** Guard of a transition row. A guard reads the event only (payload.*), never another object's status. */
export function guardHolds(when: Guard | null | undefined, event: unknown): boolean {
  if (!when) return true;
  const v = getPath(event, when.path);
  if (own(when, "eq")) return v === when.eq;
  if (own(when, "ne")) return v !== undefined && v !== null && v !== when.ne; // fail closed on a missing value
  if (own(when, "in")) return (when.in as readonly unknown[]).includes(v);
  return false;
}

const sameRef = (ref: unknown, type: unknown, id: unknown): boolean =>
  !isNil(ref) &&
  typeof ref === "object" &&
  (ref as Partial<ObjectRef>).type === type &&
  (ref as Partial<ObjectRef>).id === id;

/**
 * Does `event` concern the object (type, id)? PROPOSAL (Event.payload is free in charter §3.3): the event names it as
 * `object`, as `payload.target` or in `payload.related[]`. A case event concerns the case by `case_id` (or object CASE).
 * A closing event (catalogue `closes: 'TARGET_ELSE_OBJECT'`: PROCEDURE_COMPLETED, PROCEDURE_CANCELLED; work/LEAD_notes.md
 * L-05) with a `payload.target` concerns that target only ({type, id}, or an id string matched by id), never its object.
 */
export function eventConcerns(
  event: DomainEvent | null | undefined,
  objectType: unknown,
  objectId: unknown,
): boolean {
  if (!event || typeof event !== "object") return false;
  if (objectType === "CASE") {
    return (
      CASE_EVENTS.includes(event.type) &&
      (event.case_id === objectId || sameRef(event.object, "CASE", objectId))
    );
  }
  const p: Record<string, unknown> = event.payload || {};
  const cat = own(EVENT_CATALOGUE, event.type) ? EVENT_CATALOGUE[event.type] : null;
  if (cat && cat.closes === "TARGET_ELSE_OBJECT" && !isNil(p.target)) {
    return typeof p.target === "string" ? p.target === objectId : sameRef(p.target, objectType, objectId);
  }
  if (sameRef(event.object, objectType, objectId)) return true;
  if (sameRef(p.target, objectType, objectId)) return true;
  return Array.isArray(p.related) && p.related.some((x) => sameRef(x, objectType, objectId));
}

/** Charter §9 ordering: occurred_at, then recorded_at, then event_id (deterministic tie-break, PROPOSAL). */
/** The fields that order events (charter §9). */
export interface Orderable {
  readonly occurred_at?: unknown;
  readonly recorded_at?: unknown;
  readonly event_id?: unknown;
}
export function compareEvents(a: Orderable, b: Orderable): -1 | 0 | 1 {
  const k = (e: Orderable): [string, string, string] => [
    String(e.occurred_at ?? ""),
    String(e.recorded_at ?? ""),
    String(e.event_id ?? ""),
  ];
  const x = k(a);
  const y = k(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] as string) < (y[i] as string)) return -1;
    if ((x[i] as string) > (y[i] as string)) return 1;
  }
  return 0;
}
export function sortEvents<T extends Orderable>(events: readonly T[] | null | undefined): T[] {
  return [...(events || [])].sort(compareEvents);
}

/**
 * applyEvent(objectType, current, event) → the next status of THAT object.
 * Sees only the object's own current status and the recorded event; never another object's status.
 *   objectType  a concept id with a lifecycle (CASE: `current` is {code, flags}).
 *   Throws DomainError NOT_A_DRIVING_EVENT (the event type never changes this type's status),
 *   TRANSITION_NOT_ALLOWED (no row from `current`), AMBIGUOUS_TRANSITION (two rows with different targets, or a row
 *   and a hold). A matching hold row (holdsOf, L-10) returns `current` unchanged.
 */
/** The case status (charter §3.1): the recorded V8 code and the five flags. */
export interface CaseState {
  readonly code: string | null;
  readonly flags: CaseFlags;
}
/** A case status as given to applyEvent: missing flags are false. */
export interface CaseStateInput {
  readonly code?: string | null;
  readonly flags?: Readonly<Partial<Record<CaseFlag, boolean>>> | null;
}

/**
 * Overloads: CASE folds a {code, flags} state; every other concept a status (string) or null. With `objectType` typed
 * as a plain string the result is one of both.
 */
export function applyEvent(
  objectType: "CASE",
  current: CaseStateInput | null | undefined,
  event: DomainEvent,
): CaseState;
export function applyEvent(
  objectType: string,
  current: string | null | undefined,
  event: DomainEvent | null | undefined,
): string | null;
export function applyEvent(
  objectType: string,
  current: unknown,
  event: DomainEvent | null | undefined,
): string | null | CaseState;
export function applyEvent(
  objectType: string,
  current: unknown,
  event: DomainEvent | null | undefined,
): string | null | CaseState {
  const r = resolve(objectType);
  if (r.kind !== "CONCEPT")
    return fail("CONCEPT_REQUIRED", "applyEvent needs a concept id, not a status-object name");
  const type = event && event.type;
  if (!has(drivingEvents(objectType), type)) {
    fail("NOT_A_DRIVING_EVENT", `${String(type)} never changes the status of ${objectType}`, {
      objectType,
      type,
    });
  }
  // `type` is a driving event type here, so `event` is an event.
  const ev = event as DomainEvent;
  if (objectType === "CASE") return applyCaseEvent(current, ev);
  const cur = current === undefined ? null : current;
  const rows = r.concept.transitions.filter(
    (t) =>
      t.on.includes(ev.type) &&
      (t.from === null ? cur === null : has(t.from, cur)) &&
      guardHolds(t.when, event),
  );
  const targets = [...new Set(rows.map((t) => t.to))];
  const held = (r.concept.holds || []).some(
    (h) => h.on.includes(ev.type) && has(h.from, cur) && guardHolds(h.when, event),
  );
  if (held && targets.length)
    fail(
      "AMBIGUOUS_TRANSITION",
      `${objectType}: ${String(cur)} --${ev.type}--> ${targets.join("|")} or unchanged (hold)`,
      { objectType, from: cur, type, targets },
    );
  if (held) return cur as string | null; // a hold row's from-states are strings or null
  if (targets.length === 0)
    fail("TRANSITION_NOT_ALLOWED", `${objectType}: ${String(cur)} --${ev.type}--> (no row)`, {
      objectType,
      from: cur,
      type,
    });
  if (targets.length > 1)
    fail("AMBIGUOUS_TRANSITION", `${objectType}: ${String(cur)} --${ev.type}--> ${targets.join("|")}`, {
      objectType,
      from: cur,
      type,
      targets,
    });
  return targets[0] as string;
}

const EMPTY_FLAGS: CaseFlags = Object.freeze({
  suspended: false,
  returned: false,
  cancelled: false,
  reopened: false,
  closed: false,
});

function applyCaseEvent(current: unknown, event: DomainEvent): CaseState {
  const cur: CaseStateInput =
    current && typeof current === "object" ? (current as CaseStateInput) : { code: null, flags: EMPTY_FLAGS };
  const flags: Record<CaseFlag, boolean> = { ...EMPTY_FLAGS, ...(cur.flags || {}) };
  if (own(CASE_FLAG_EVENTS, event.type)) {
    const set = CASE_FLAG_EVENTS[event.type] as Readonly<Partial<Record<CaseFlag, boolean>>>;
    // Every CASE_FLAG_EVENTS entry sets exactly one flag besides `reopened`.
    const [k, v] = Object.entries(set).filter(([key]) => key !== "reopened")[0] as [CaseFlag, boolean];
    if (flags[k] === v)
      fail("TRANSITION_NOT_ALLOWED", `CASE: flags.${k} is already ${v} (${event.type})`, {
        objectType: "CASE",
        flag: k,
        type: event.type,
      });
    return Object.freeze({ code: cur.code ?? null, flags: Object.freeze({ ...flags, ...set }) });
  }
  // CASE_STATUS_RECORDED / CASE_REGISTERED: payload.to is the recorded code.
  const to = event.payload && event.payload.to;
  if (!isV8Code(to))
    return fail("TRANSITION_NOT_ALLOWED", `CASE: ${event.type} without a V8 code in payload.to`, {
      objectType: "CASE",
      type: event.type,
    });
  const from = cur.code ?? null;
  const ok =
    from === null
      ? event.type === "CASE_STATUS_RECORDED"
        ? to === CASE_ENTRY_CODE
        : to === "S1.03"
      : v8Transition(from, to) !== null && (event.type === "CASE_STATUS_RECORDED" || to === "S1.03");
  if (!ok)
    fail("TRANSITION_NOT_ALLOWED", `CASE: ${String(from)} --${event.type}--> ${to} is not a V8 transition`, {
      objectType: "CASE",
      from,
      to,
      type: event.type,
    });
  return Object.freeze({ code: to, flags: Object.freeze(flags) });
}

/** options.version: keep only the events of that version (a notification lineage mixes the versions' lifecycles, L-04). */
/** Options of statusFromEvents and checkHistory. */
export interface FoldOptions {
  version?: number | null;
}
const inVersion =
  (options: FoldOptions | null | undefined) =>
  (e: DomainEvent): boolean =>
    !options || isNil(options.version) || (e.version ?? 1) === options.version;

/** statusFromEvents result for a concept other than CASE. */
export interface StatusFold {
  readonly status: string | null;
  readonly source_event_id: string | null;
  readonly applied: readonly string[];
  readonly held: readonly string[];
}
/** statusFromEvents result for CASE. */
export interface CaseFold {
  readonly code: string | null;
  readonly flags: CaseFlags;
  readonly source_event_id: string | null;
  readonly applied: readonly string[];
}

/**
 * statusFromEvents(objectType, objectId, events, {version}?) → {status, source_event_id, applied[], held[]} (CASE: {code, flags, …}).
 * Folds, in charter §9 order, only the events that concern this object AND drive this type: every other event —
 * another object's, a communication event, step evidence — is ignored by construction. For a notification pass
 * `version`: each version has its own lifecycle (version n+1 starts in CORRECTED, L-04). `held`: events admitted by a
 * hold row (L-10), which leave the status and its source event unchanged.
 */
export function statusFromEvents(
  objectType: "CASE",
  objectId: unknown,
  events: readonly DomainEvent[] | null | undefined,
  options?: FoldOptions | null,
): CaseFold;
export function statusFromEvents(
  objectType: string,
  objectId: unknown,
  events: readonly DomainEvent[] | null | undefined,
  options?: FoldOptions | null,
): StatusFold;
export function statusFromEvents(
  objectType: string,
  objectId: unknown,
  events: readonly DomainEvent[] | null | undefined,
  options: FoldOptions | null = {},
): StatusFold | CaseFold {
  const driving = drivingEvents(objectType);
  const mine = sortEvents(events).filter(
    (e) => driving.includes(e.type) && eventConcerns(e, objectType, objectId) && inVersion(options)(e),
  );
  let state: string | null | CaseState = objectType === "CASE" ? { code: null, flags: EMPTY_FLAGS } : null;
  let source: string | null = null;
  const applied: string[] = [];
  const held: string[] = [];
  for (const e of mine) {
    const next: string | null | CaseState = applyEvent(objectType, state, e);
    if (objectType !== "CASE" && next === state) {
      held.push(e.event_id);
      continue;
    } // a hold row: no self-loop pair exists
    state = next;
    source = e.event_id;
    applied.push(e.event_id);
  }
  if (objectType === "CASE") {
    const cs = state as CaseState;
    return Object.freeze({
      code: cs.code,
      flags: cs.flags,
      source_event_id: source,
      applied: Object.freeze(applied),
    });
  }
  return Object.freeze({
    status: state as string | null,
    source_event_id: source,
    applied: Object.freeze(applied),
    held: Object.freeze(held),
  });
}

/** checkHistory result. */
export interface HistoryCheck {
  ok: boolean;
  problems: string[];
  final: string | null;
}

/**
 * Lenient check of a recorded history (used by INV-17): the first event may start from any `from` of its rows; when it
 * has an initial row (from null), that row applies — e.g. REFERRAL_SUBMITTED starts a referral (null → OPEN), and only a
 * later one, from RETURNED | FAILED, is a resubmission (work/LEAD_notes.md L-10). Hold rows (L-10) leave the status as is.
 */
export function checkHistory(
  objectType: string,
  objectId: unknown,
  events: readonly DomainEvent[] | null | undefined,
  options: FoldOptions | null = {},
): HistoryCheck {
  const driving = drivingEvents(objectType);
  const mine = sortEvents(events).filter(
    (e) => driving.includes(e.type) && eventConcerns(e, objectType, objectId) && inVersion(options)(e),
  );
  const problems: string[] = [];
  if (objectType === "CASE") {
    let prev: string | null = null;
    for (const e of mine) {
      if (!CASE_CODE_EVENTS.includes(e.type)) continue;
      const to = e.payload && e.payload.to;
      const from = e.payload && own(e.payload, "from") ? e.payload.from : prev;
      if (!isV8Code(to)) problems.push(`${e.event_id}: no V8 code in payload.to`);
      else if (from !== null && from !== undefined && !v8Transition(from, to))
        problems.push(
          `${e.event_id}: ${String(from)}→${to} is not one of the 34 V8 transitions (shown as recorded, flagged)`,
        );
      else if (prev !== null && from !== prev)
        problems.push(`${e.event_id}: payload.from ${String(from)} ≠ previous recorded code ${prev}`);
      prev = isV8Code(to) ? to : prev;
    }
    return { ok: problems.length === 0, problems, final: prev };
  }
  const rows = transitionsOf(objectType);
  let cur: string | null | undefined;
  let first = true;
  for (const e of mine) {
    if (first) {
      const cands = rows.filter((t) => t.on.includes(e.type) && guardHolds(t.when, e));
      const initial = cands.filter((t) => t.from === null || t.from.includes(null));
      const targets = [...new Set((initial.length ? initial : cands).map((t) => t.to))];
      if (targets.length === 1) cur = targets[0];
      else problems.push(`${e.event_id}: ${e.type} has ${targets.length} possible targets as a first event`);
      first = false;
      continue;
    }
    try {
      cur = applyEvent(objectType, cur, e);
    } catch (err) {
      problems.push(
        `${e.event_id}: ${String((err as { code?: unknown }).code)} (${String(cur)} --${e.type}-->)`,
      );
    }
  }
  return { ok: problems.length === 0, problems, final: cur ?? null };
}

/**
 * checkLineage(versions, events, {evidence}?) → {ok, problems[], current_version, pending_version}
 * The correction model of work/LEAD_notes.md L-04 over the versions of ONE notification. `versions`: records with
 * {version, status, corrects: {version, reason_code} | corrects_version, reason_code?}; `events`: that notification's
 * ledger events (all versions; other types are ignored); `evidence` (optional): its W-D1 evidence entries.
 *   1. versions are integers ≥ 1, never duplicated (an issued version is never edited: a correction is a new version);
 *   2. version 1 corrects nothing; every later version corrects a lower, issued version with a reason code, enters in
 *      CORRECTED (its NOTIFICATION_CORRECTED event names corrects_version; never NOTIFICATION_DRAFTED);
 *   3. SUPERSEDED only once a version correcting it is SENT, in that same step (NOTIFICATION_SUPERSEDED names the
 *      successor, at or caused by the successor's NOTIFICATION_SENT); an issued version with a sent correction is a fault;
 *   4. one current (issued) version, at most one pending correction, which corrects the current version; a lineage never
 *      loses its current version (a cancelled correction leaves it current);
 *   5. with evidence: no new delivery attempt of version n after its correction was created (pending retries suppressed).
 * options.partial: the caller holds only some versions (e.g. a context with the current notification alone); the checks
 * that need the missing versions (predecessor present, successor sent, current version present) are skipped.
 */
/** A notification version as read by checkLineage (W-D1 notification record fields it uses). */
export interface LineageVersion {
  version?: number;
  status?: string;
  corrects?: { version?: number | null; reason_code?: string | null } | null;
  corrects_version?: number | null;
  reason_code?: string | null;
  created_at?: string;
}
/** A W-D1 evidence entry (src/lifecycle/evidence.js shape: seq, entry_id, notification_id, version, kind, recorded_at, data). */
export interface EvidenceEntry {
  seq?: number;
  entry_id?: string;
  notification_id?: string;
  version?: number;
  kind?: string;
  recorded_at?: string;
  data?: Record<string, unknown> | null;
}
/** Options of checkLineage. */
export interface LineageOptions {
  evidence?: readonly (EvidenceEntry | null | undefined)[] | null;
  partial?: boolean;
}
/** checkLineage result. */
export interface LineageCheck {
  ok: boolean;
  problems: string[];
  current_version: number | null;
  pending_version: number | null;
}
/** Date.parse as the reference calls it (Date.parse converts its argument to a string). */
const parseTime = (v: unknown): number => Date.parse(v as string);

export function checkLineage(
  versions: readonly (LineageVersion | null | undefined)[] | null | undefined,
  events: readonly (DomainEvent | null | undefined)[] | null = [],
  options: LineageOptions = {},
): LineageCheck {
  const problems: string[] = [];
  const vs = [...(versions || [])]
    .filter((x): x is LineageVersion => Boolean(x))
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
  const evts = sortEvents((events || []).filter((e): e is DomainEvent => !!e && typeof e === "object"));
  const nums = vs.map((x) => x.version);
  if (nums.some((k) => !Number.isInteger(k) || (k as number) < 1))
    problems.push("version numbers must be integers ≥ 1");
  if (new Set(nums).size < nums.length)
    problems.push(
      "duplicate version numbers: an issued version is never edited in place; a correction is a new version (L-04 item 1)",
    );
  const byV = new Map(vs.map((x) => [x.version, x]));
  const evOf = (v: unknown, type: string): DomainEvent[] =>
    evts.filter((e) => e.type === type && (e.version ?? 1) === v);
  const entryOf = (x: LineageVersion): DomainEvent | null =>
    evOf(x.version, "NOTIFICATION_CORRECTED")[0] || null;
  const correctsOf = (x: LineageVersion): unknown => {
    const c =
      x.corrects_version ?? (x.corrects && typeof x.corrects === "object" ? x.corrects.version : null);
    if (!isNil(c)) return c;
    const en = entryOf(x);
    return en && en.payload && !isNil(en.payload.corrects_version) ? en.payload.corrects_version : null;
  };
  const reasonOf = (x: LineageVersion): unknown =>
    (x.corrects && typeof x.corrects === "object" ? x.corrects.reason_code : null) ??
    x.reason_code ??
    (entryOf(x) && entryOf(x)?.payload ? entryOf(x)?.payload?.reason_code : null) ??
    null;
  const issued = (s: unknown): boolean => has(ISSUED_NOTIFICATION_STATES, s);
  const sentOrLater = (s: unknown): boolean => issued(s) || s === "SUPERSEDED";
  const hasEvents = evts.length > 0;

  for (const e of evts) {
    if (e.type === "NOTIFICATION_CORRECTED") {
      const cv = e.payload && e.payload.corrects_version;
      if (!Number.isInteger(cv) || (cv as number) >= (e.version ?? 1))
        problems.push(
          `${e.event_id}: corrects_version ${String(cv)} must be lower than the event's version ${String(e.version)} (NOTIFICATION_CORRECTED is the entry event of the correcting version)`,
        );
    }
    if (e.type === "NOTIFICATION_SUPERSEDED") {
      const sv = e.payload && e.payload.successor_version;
      if (!Number.isInteger(sv) || (sv as number) <= (e.version ?? 1))
        problems.push(
          `${e.event_id}: successor_version ${String(sv)} must exceed version ${String(e.version)}`,
        );
    }
  }
  for (const x of vs) {
    if (!Number.isInteger(x.version)) continue;
    const xv = x.version as number; // an integer (checked above)
    const tag = `v${xv}`;
    const cv = correctsOf(x);
    if (xv === 1) {
      if (!isNil(cv)) problems.push(`${tag}: the first version corrects nothing (corrects v${String(cv)})`);
      if (x.status === "CORRECTED")
        problems.push(
          `${tag}: CORRECTED is the entry state of a correcting version (L-04 item 1), never of version 1`,
        );
      continue;
    }
    if (x.status === "DRAFT")
      problems.push(`${tag}: DRAFT — a correcting version enters in CORRECTED (L-04 item 1)`);
    if (isNil(cv)) {
      problems.push(
        `${tag}: a later version must correct an earlier one (corrects_version missing; L-04 item 1)`,
      );
      continue;
    }
    if (!((cv as number) < xv))
      problems.push(`${tag}: corrects v${String(cv)}; a correction corrects a lower version`);
    const prev = byV.get(cv as number);
    if (!prev) {
      if (!options.partial) problems.push(`${tag}: corrects v${String(cv)}, which is not in the lineage`);
    } else if (!sentOrLater(prev.status))
      problems.push(
        `${tag}: corrects v${String(cv)} in ${String(prev.status)}; only an issued version (SENT, DELIVERY_CONFIRMED, DELIVERY_FAILED) is corrected`,
      );
    if (isNil(reasonOf(x))) problems.push(`${tag}: correction without a reason code (L-04 item 1)`);
    if (hasEvents) {
      const en = entryOf(x);
      if (!en)
        problems.push(
          `${tag}: no NOTIFICATION_CORRECTED entry event (CORRECTED is the entry state of a correcting version)`,
        );
      else if (en.payload && en.payload.corrects_version !== cv)
        problems.push(
          `${en.event_id}: corrects_version ${String(en.payload.corrects_version)} ≠ v${String(cv)}`,
        );
      if (evOf(xv, "NOTIFICATION_DRAFTED").length)
        problems.push(
          `${tag}: a correcting version enters in CORRECTED, never through NOTIFICATION_DRAFTED (L-04 item 1)`,
        );
    }
  }
  for (const x of vs) {
    if (!Number.isInteger(x.version)) continue;
    const xv = x.version as number; // an integer (checked above)
    const tag = `v${xv}`;
    const sentSuccessors = vs.filter(
      (y) => (y.version as number) > xv && correctsOf(y) === xv && sentOrLater(y.status),
    );
    if (issued(x.status) && sentSuccessors.length)
      problems.push(
        `${tag}: still ${String(x.status)} although its correction v${String(sentSuccessors[0]?.version)} was SENT; it becomes SUPERSEDED in that same step (L-04 item 2)`,
      );
    if (x.status !== "SUPERSEDED") continue;
    if (!sentSuccessors.length) {
      if (!options.partial)
        problems.push(
          `${tag}: SUPERSEDED before any version correcting it was SENT; a version stays current until its correction is SENT (L-04 item 2)`,
        );
      continue;
    }
    if (!hasEvents) continue;
    const sup = evOf(xv, "NOTIFICATION_SUPERSEDED")[0] || null;
    if (!sup) {
      problems.push(`${tag}: SUPERSEDED without a NOTIFICATION_SUPERSEDED event`);
      continue;
    }
    const sv = sup.payload && sup.payload.successor_version;
    if (!Number.isInteger(sv) || (sv as number) <= xv) continue; // reported above
    if (!sentSuccessors.some((y) => y.version === sv)) {
      problems.push(
        `${sup.event_id}: successor_version ${String(sv)} is not a sent version correcting v${xv}`,
      );
      continue;
    }
    const sent = evOf(sv, "NOTIFICATION_SENT")[0] || null;
    if (!sent) problems.push(`${tag}: superseded by v${String(sv)}, which has no NOTIFICATION_SENT event`);
    else if (!(
      sup.causation_id === sent.event_id || parseTime(sup.occurred_at) >= parseTime(sent.occurred_at)
    )) {
      problems.push(
        `${sup.event_id}: v${xv} SUPERSEDED (${String(sup.occurred_at)}) before v${String(sv)} was SENT (${String(sent.occurred_at)}); both happen in one step (L-04 item 2)`,
      );
    }
  }
  const issuedVs = vs.filter((x) => issued(x.status));
  if (issuedVs.length > 1)
    problems.push(
      `${issuedVs.length} issued versions (${issuedVs.map((x) => `v${String(x.version)}`).join(", ")}); a lineage has one current version`,
    );
  const current = issuedVs.at(-1) ?? null;
  const pending = vs.filter((x) => (x.version as number) > 1 && has(PENDING_CORRECTION_STATES, x.status));
  if (pending.length > 1)
    problems.push(
      `${pending.length} corrections pending at once (${pending.map((x) => `v${String(x.version)}`).join(", ")}); at most one`,
    );
  for (const p of pending) {
    if (!current) {
      if (!options.partial)
        problems.push(`v${String(p.version)}: a pending correction without a current issued version`);
    } else if (correctsOf(p) !== current.version)
      problems.push(
        `v${String(p.version)}: a pending correction must correct the current version v${String(current.version)}`,
      );
  }
  if (!options.partial && !current && vs.some((x) => x.status === "SUPERSEDED"))
    problems.push(
      "SUPERSEDED versions but no current issued version: the lineage never loses its current version (L-04 item 4)",
    );
  if (Array.isArray(options.evidence)) {
    const evidence = options.evidence as readonly (EvidenceEntry | null | undefined)[];
    for (const y of vs) {
      const cv = correctsOf(y);
      if (isNil(cv) || !Number.isInteger(y.version) || y.version === 1) continue;
      const en = entryOf(y);
      const t0 = parseTime(en ? en.occurred_at : y.created_at);
      if (Number.isNaN(t0)) continue;
      const late = evidence.filter(
        (x) =>
          x &&
          x.kind === "DELIVERY_ATTEMPT" &&
          x.version === cv &&
          x.data &&
          x.data.status === "ATTEMPTED" &&
          parseTime(x.data.at ?? x.recorded_at) > t0,
      );
      if (late.length)
        problems.push(
          `v${String(cv)}: ${late.length} delivery attempt(s) after its correction v${String(y.version)} was created; pending retries are suppressed (L-04 item 3)`,
        );
    }
  }
  return {
    ok: problems.length === 0,
    problems,
    current_version: current ? (current.version as number) : vs[0] ? (vs[0].version as number) : null,
    pending_version: pending.length ? ((pending.at(-1) as LineageVersion).version as number) : null,
  };
}

// =====================================================================================================
// Derived flags (never statuses)
// =====================================================================================================
/**
 * isOverdue(object, nowISO) → {overdue: true|false|null, reason, deadline}. OVERDUE is derived, never stored
 * (charter §3.4). Only a deadline with a recorded basis event and a stated rule (≠ SOURCE_REQUIRED) counts
 * (charter §3.5 safe inference); otherwise the answer is null with reason SOURCE_REQUIRED (never invented).
 */
/** A deadline of a procedural object (charter §3.2). */
export interface Deadline {
  kind?: string;
  at?: string | null;
  basis_event_id?: string | null;
  basis_rule?: string | null;
}
/** The object isOverdue reads. */
export interface OverdueSubject {
  type: string;
  status?: string;
  deadlines?: readonly (Deadline | null | undefined)[] | null;
}
/** isOverdue result: OVERDUE is derived, never stored. */
export interface OverdueResult {
  overdue: boolean | null;
  reason: "TERMINAL_STATUS" | "NO_DEADLINE" | "SOURCE_REQUIRED" | "DEADLINE_PASSED" | "NOT_YET_DUE";
  deadline: Deadline | null;
}
export function isOverdue(object: OverdueSubject, nowISO: string): OverdueResult {
  const r = resolve(object.type);
  if (r.so.name !== "TaskStatus")
    fail("NOT_A_TASK", `isOverdue applies to TaskStatus objects, not ${object.type}`);
  if (has(r.so.terminal, object.status)) return { overdue: false, reason: "TERMINAL_STATUS", deadline: null };
  const ds = Array.isArray(object.deadlines)
    ? (object.deadlines as readonly (Deadline | null | undefined)[])
    : [];
  if (ds.length === 0) return { overdue: false, reason: "NO_DEADLINE", deadline: null };
  const valid = ds.filter(
    (d): d is Deadline =>
      !!(d && d.at && d.basis_event_id && d.basis_rule && d.basis_rule !== "SOURCE_REQUIRED"),
  );
  if (valid.length === 0) return { overdue: null, reason: "SOURCE_REQUIRED", deadline: null };
  const now = Date.parse(nowISO);
  if (Number.isNaN(now)) fail("INVALID_NOW", "nowISO must be an ISO timestamp (no clock is read here)");
  const due = valid.filter((d) => parseTime(d.at) < now).sort((a, b) => parseTime(a.at) - parseTime(b.at));
  return due.length
    ? { overdue: true, reason: "DEADLINE_PASSED", deadline: due[0] as Deadline }
    : { overdue: false, reason: "NOT_YET_DUE", deadline: null };
}

// =====================================================================================================
// Independence of the seven status objects
// =====================================================================================================
const ALL_CASE_STATES = "*";
/** A target of a forbidden derivation: `statuses` reachable only via `only_via` ('*' = every case state). */
export interface DerivationTarget {
  readonly type: string;
  readonly statuses: readonly string[] | typeof ALL_CASE_STATES;
  readonly only_via: readonly string[];
}
/** States that must not exist in a status object. */
export interface AbsentStates {
  readonly object: StatusObjectName;
  readonly states: readonly string[];
}
/** A forbidden derivation FD-01…FD-12. */
export interface ForbiddenDerivation {
  readonly id: string;
  readonly source: string;
  readonly rule: Bilingual;
  readonly targets: readonly DerivationTarget[];
  readonly forbidden_events: readonly string[];
  readonly never_driving: readonly string[];
  readonly absent_states: readonly AbsentStates[];
  readonly basis: string;
  readonly related_pc: readonly string[];
}
interface DerivationInput {
  id: string;
  source: string;
  rule: Bilingual;
  targets: readonly DerivationTarget[];
  forbidden_events?: readonly string[];
  never_driving?: readonly string[];
  absent_states?: readonly AbsentStates[];
  basis: string;
  related_pc: readonly string[];
}
const fd = (def: DerivationInput): ForbiddenDerivation =>
  Object.freeze({
    ...def,
    targets: Object.freeze(
      def.targets.map((t) =>
        Object.freeze({ ...t, statuses: Object.freeze(t.statuses), only_via: Object.freeze(t.only_via) }),
      ),
    ),
    forbidden_events: Object.freeze(def.forbidden_events || []),
    never_driving: Object.freeze(def.never_driving || []),
    absent_states: Object.freeze(def.absent_states || []),
  });

/**
 * Forbidden derivations (PROPOSAL; each anchored in the charter or the first review). A target status is reachable
 * only through `only_via` events; `forbidden_events` never lead into it; `never_driving` events drive no status at all;
 * `absent_states` must not exist in the named status objects.
 */
export const FORBIDDEN_DERIVATIONS: readonly ForbiddenDerivation[] = Object.freeze([
  fd({
    id: "FD-01",
    source: "NOTIFICATION",
    rule: L(
      "لا تُشتق حالة القضية ولا إغلاقها من إشعار.",
      "The case status and its closure are never derived from a notification.",
    ),
    targets: [{ type: "CASE", statuses: ALL_CASE_STATES, only_via: CASE_EVENTS }],
    forbidden_events: COMMUNICATION_EVENTS,
    basis:
      'CHARTER.md §3.1 ("CASE_UNCHANGED notifications never move it"), §3.5 ("case closure from a notification"); PC-11',
    related_pc: ["PC-11"],
  }),
  fd({
    id: "FD-02",
    source: "RECOMMENDATION",
    rule: L("لا يُشتق القرار من التوصية.", "A decision is never derived from a recommendation."),
    targets: [{ type: "DECISION", statuses: ["DECIDED"], only_via: ["AUTHORITY_DECISION_RECORDED"] }],
    forbidden_events: [
      "RECOMMENDATION_DRAFTED",
      "RECOMMENDATION_ADOPTED",
      "BALLOT_CLOSED",
      "PACKAGE_SUBMITTED_TO_AUTHORITY",
    ],
    basis: 'CHARTER.md §3.5 ("a decision from a recommendation"); PC-01',
    related_pc: ["PC-01"],
  }),
  fd({
    id: "FD-03",
    source: "LEGAL_OPINION",
    rule: L("الرأي النظامي لا يعتمد التوصية.", "A legal opinion never adopts a recommendation."),
    targets: [{ type: "RECOMMENDATION", statuses: ["ADOPTED"], only_via: ["RECOMMENDATION_ADOPTED"] }],
    forbidden_events: ["LEGAL_REVIEW_REQUESTED", "LEGAL_OPINION_SUBMITTED"],
    basis: `CHARTER.md §8 PC-12; ${TWSM} §3.6`,
    related_pc: ["PC-12"],
  }),
  fd({
    id: "FD-04",
    source: "LEGAL_OPINION",
    rule: L("الرأي النظامي لا يقرر.", "A legal opinion never decides."),
    targets: [{ type: "DECISION", statuses: ["DECIDED"], only_via: ["AUTHORITY_DECISION_RECORDED"] }],
    forbidden_events: ["LEGAL_REVIEW_REQUESTED", "LEGAL_OPINION_SUBMITTED"],
    basis: "CHARTER.md §8 PC-12",
    related_pc: ["PC-12"],
  }),
  fd({
    id: "FD-05",
    source: "PROCEDURE",
    rule: L(
      "توجيه الرئيس أو طلب التصويت لا يفتح التصويت.",
      "A chair direction or a requested vote never opens a vote.",
    ),
    targets: [
      { type: "BALLOT", statuses: ["OPEN"], only_via: ["BALLOT_OPENED"] },
      { type: "RECOMMENDATION", statuses: ["UNDER_VOTE"], only_via: ["BALLOT_OPENED"] },
    ],
    forbidden_events: ["CHAIR_DIRECTION_RECORDED", "PACKAGE_SUBMITTED_FOR_VOTE"],
    never_driving: ["CHAIR_DIRECTION_RECORDED", "PACKAGE_SUBMITTED_FOR_VOTE"],
    basis:
      'CHARTER.md §3.5 ("opening of a vote from a direction"); work/owner_messages_2026-10-27/master_execution_directive_en_16-08-26Z.txt:370 ("A requested vote cannot establish that voting opened."), :1113 ("Vote described as open before authorization."); PC-02; D6 MF-013 (D6_findings_register.csv:14: «Voting open» shown although no vote item exists); D8_future_state_V13_design.md:73 (no chair-direction command exists)',
    related_pc: ["PC-02"],
  }),
  fd({
    id: "FD-06",
    source: "NOTIFICATION",
    rule: L(
      "الدعوة والجدولة لا تُثبتان الانعقاد.",
      "An invitation or a schedule never evidences that a meeting took place.",
    ),
    targets: [
      { type: "MEETING", statuses: ["OPENED", "CLOSED"], only_via: ["MEETING_OPENED", "MEETING_CLOSED"] },
      { type: "HEARING", statuses: ["OPENED", "CLOSED"], only_via: ["MEETING_OPENED", "MEETING_CLOSED"] },
    ],
    forbidden_events: [
      "MEETING_SCHEDULED",
      "MEETING_RESCHEDULED",
      "PARTICIPANTS_INVITED",
      ...COMMUNICATION_EVENTS,
    ],
    never_driving: ["PARTICIPANTS_INVITED"],
    basis:
      'CHARTER.md §8 PC-03, PC-13; work/owner_messages_2026-10-27/master_execution_directive_en_16-08-26Z.txt:369 ("A meeting invitation cannot establish that the meeting occurred."), :1114; W2_committee_register_review.md:64 (CF-24 invitation card ticks «Agenda approved ✔ Date set» with no recorded command)',
    related_pc: ["PC-03", "PC-13"],
  }),
  fd({
    id: "FD-07",
    source: "DELIVERY_ATTEMPT",
    rule: L(
      "المحاولة أو قبول الناقل لا يؤكدان التسليم.",
      "An attempt or provider acceptance never confirms delivery.",
    ),
    targets: [{ type: "NOTIFICATION", statuses: ["DELIVERY_CONFIRMED"], only_via: ["DELIVERY_CONFIRMED"] }],
    forbidden_events: ["DELIVERY_ATTEMPTED", "DELIVERY_ACCEPTED_BY_PROVIDER", "NOTIFICATION_SENT"],
    basis:
      "CHARTER.md §3.4 (per-attempt DeliveryStatus separate from NotificationStatus); v9_data.json substates[S5.01].caution",
    related_pc: ["PC-15", "PC-16"],
  }),
  fd({
    id: "FD-08",
    source: "NOTIFICATION",
    rule: L("التصدير ليس إرسالاً ولا تسليماً.", "An export is neither a dispatch nor a delivery."),
    targets: [
      { type: "NOTIFICATION", statuses: ["SENT"], only_via: ["NOTIFICATION_SENT"] },
      { type: "NOTIFICATION", statuses: ["DELIVERY_CONFIRMED"], only_via: ["DELIVERY_CONFIRMED"] },
    ],
    forbidden_events: ["NOTIFICATION_EXPORTED"],
    never_driving: ["NOTIFICATION_EXPORTED"],
    basis: 'CHARTER.md §3.5 ("delivery from an export"); PC-15; D3 (D3_architecture_reconstruction.md:28)',
    related_pc: ["PC-15"],
  }),
  fd({
    id: "FD-09",
    source: "DELIVERY_ATTEMPT",
    rule: L(
      "التسليم لا يعني الإقرار بالاستلام؛ الإقرار حدث من المستلم وليس حالة.",
      "Delivery never implies acknowledgement; acknowledgement is an act of the recipient, never a status.",
    ),
    targets: [],
    never_driving: ["RECIPIENT_ACKNOWLEDGED"],
    absent_states: [
      { object: "NotificationStatus", states: ["ACKNOWLEDGED", "READ"] },
      { object: "DeliveryStatus", states: ["ACKNOWLEDGED", "READ", "DELIVERED"] },
    ],
    basis:
      'CHARTER.md §3.4 (DeliveryStatus), §9 ("Recipient acknowledgement is an event, never a lifecycle state"); PC-16',
    related_pc: ["PC-16"],
  }),
  fd({
    id: "FD-10",
    source: "NOTIFICATION",
    rule: L(
      "إصدار تبليغ القرار أو تسليمه ليس القرار.",
      "Issuing or delivering the decision notice is not the decision.",
    ),
    targets: [{ type: "DECISION", statuses: ["DECIDED"], only_via: ["AUTHORITY_DECISION_RECORDED"] }],
    forbidden_events: ["DECISION_NOTICE_ISSUED", "DECISION_NOTICE_DELIVERED", ...COMMUNICATION_EVENTS],
    never_driving: ["DECISION_NOTICE_ISSUED", "DECISION_NOTICE_DELIVERED"],
    basis: 'CHARTER.md §6 ("Issuing a decision notice never equals making the decision")',
    related_pc: ["PC-01", "PC-14"],
  }),
  fd({
    id: "FD-11",
    source: "PROCEDURE",
    rule: L(
      "لا يشتق V13 رمز القضية من حالات الإجراءات؛ بل يقرأ الرمز المسجَّل.",
      "V13 never derives the case code from proceeding statuses; it reads the recorded code.",
    ),
    targets: [{ type: "CASE", statuses: ALL_CASE_STATES, only_via: CASE_EVENTS }],
    forbidden_events: PROCEDURAL_EVENTS,
    basis:
      'CHARTER.md §3.1 ("status.code is the only source of Level 1"), §4 ("Level 1 is resolved from CaseRecord.status.code only")',
    related_pc: ["PC-07", "PC-11"],
  }),
  fd({
    id: "FD-12",
    source: "NOTIFICATION",
    rule: L(
      "التذكير أو طلب الإجراء لا يُكمل المهمة، وإعلان المالك لا يُكمل إجراء التنفيذ دون تحقق.",
      "A reminder or request never completes a task, and the owner's declaration never completes an implementation action without verification.",
    ),
    targets: [
      { type: "TASK", statuses: ["COMPLETED"], only_via: ["TASK_COMPLETED"] },
      { type: "IMPLEMENTATION_ACTION", statuses: ["COMPLETED"], only_via: ["ACTION_VERIFIED"] },
    ],
    forbidden_events: ["ACTION_COMPLETED", ...COMMUNICATION_EVENTS],
    basis: `CHARTER.md §3.2; ${CONTRACTS}:1822-1830 (PENDING_VERIFICATION, VERIFIED)`,
    related_pc: ["PC-09"],
  }),
]);

/**
 * Events whose one recorded instance moves two objects (the `object` and a `payload.target` / `payload.related`
 * object): BALLOT_OPENED, PACKAGE_SUBMITTED_TO_AUTHORITY, AUTHORITY_DECISION_RECORDED. Shared recorded evidence that
 * names each object — each object moves under its own table from its own state — never a derivation.
 */
export const SHARED_EVIDENCE_EVENTS: readonly string[] = Object.freeze(
  EVENT_TYPES.filter((e) => {
    const c = EVENT_CATALOGUE[e] as NonNullable<(typeof EVENT_CATALOGUE)[string]>; // EVENT_TYPES are the catalogue keys
    const drives = (t: string): boolean => LIFECYCLE_CONCEPTS.includes(t) && drivingEvents(t).includes(e);
    return c.object_types.some(drives) && c.secondary_types.some(drives);
  }),
);

/**
 * assertIndependent(targetType, sourceType?, {rows}?) — structural proof that the target's status is never computed
 * from the source object's status. Throws DomainError STATUS_DERIVATION_FORBIDDEN on the first failed check;
 * returns the report otherwise. `rows` overrides the target's table (used by negative tests only).
 * Checks: (1) the target table uses only its own states; (2) every driving event names the target type (object_types or
 * secondary_types) — evidence about the target itself; (3) guards read the event payload only; (4) every forbidden
 * derivation that concerns the target holds: target statuses reachable only via `only_via`, never via
 * `forbidden_events`; `never_driving` events drive nothing; `absent_states` are absent; (5) shared events are listed;
 * (6) hold rows (L-10) use own states, name the target, read the payload and hold driving events only.
 */
/** One check of assertIndependent. */
export interface IndependenceCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}
/** assertIndependent result (it throws instead of returning a failed report). */
export interface IndependenceResult {
  readonly ok: true;
  readonly target: string;
  readonly source: string | null;
  readonly checks: readonly IndependenceCheck[];
  readonly shared_evidence_events: readonly string[];
}
/** Options of assertIndependent: `rows` (and `holds`) override the target's table (negative tests only). */
export interface IndependenceOptions {
  rows?: readonly TransitionRow[] | null;
  holds?: readonly HoldRow[] | null;
}
export function assertIndependent(
  targetType: string,
  sourceType: string | null = null,
  options: IndependenceOptions = {},
): IndependenceResult {
  const r = resolve(targetType);
  if (r.kind !== "CONCEPT") return fail("CONCEPT_REQUIRED", "assertIndependent needs concept ids");
  if (sourceType !== null) {
    if (!CONCEPT_IDS.includes(sourceType))
      fail("UNKNOWN_OBJECT_TYPE", `unknown source concept ${String(sourceType)}`);
    if (sourceType === targetType) fail("SAME_TYPE", "target and source must differ");
  }
  const rows = options.rows || r.concept.transitions;
  const states = r.so.states;
  const checks: IndependenceCheck[] = [];
  const bad = (id: string, detail: string): never => {
    checks.push({ id, ok: false, detail });
    throw new DomainError(
      "STATUS_DERIVATION_FORBIDDEN",
      `${targetType}${sourceType ? " ← " + sourceType : ""}: ${id} ${detail}`,
      { targetType, sourceType, checks },
    );
  };
  const good = (id: string, detail: string): number => checks.push({ id, ok: true, detail });
  const isFlagRow = (s: unknown): boolean => typeof s === "string" && s.startsWith("flags.");
  const ownState = (s: unknown): boolean =>
    has(states, s) || (targetType === "CASE" && (s === "<V8 code>" || isFlagRow(s)));

  // (1) own states only
  for (const t of rows) {
    if (t.from !== null && !t.from.every((s) => s === null || ownState(s)))
      bad("OWN_STATES", `row ${JSON.stringify(t.from)}→${t.to} uses a state outside ${r.so.name}`);
    if (!ownState(t.to)) bad("OWN_STATES", `row target ${t.to} is not a ${r.so.name} state`);
  }
  good("OWN_STATES", `${rows.length} rows use ${r.so.name} states only`);
  // (2) every driving event is evidence about the target itself
  for (const t of rows)
    for (const e of t.on) {
      const cat = EVENT_CATALOGUE[e];
      if (!cat) return bad("KNOWN_EVENT", `${e} is not in EVENT_TYPES`);
      if (!cat.object_types.includes(targetType) && !cat.secondary_types.includes(targetType))
        bad(
          "EVENT_NAMES_TARGET",
          `${e} does not name a ${targetType} (object_types ${cat.object_types.join(",")})`,
        );
    }
  good("EVENT_NAMES_TARGET", "every driving event names the target object");
  // (3) guards read the event payload only
  for (const t of rows)
    if (t.when && !String(t.when.path).startsWith("payload."))
      bad("GUARD_READS_EVENT", `guard path ${String(t.when.path)} is not an event payload path`);
  good("GUARD_READS_EVENT", "guards read payload.* only");
  // (4) forbidden derivations
  const relevant = FORBIDDEN_DERIVATIONS.filter(
    (d) => sourceType === null || d.source === sourceType || d.targets.some((x) => x.type === targetType),
  );
  const drv = [...new Set(rows.flatMap((t) => t.on))];
  for (const d of relevant) {
    for (const tg of d.targets.filter((x) => x.type === targetType)) {
      const sts = tg.statuses === ALL_CASE_STATES ? null : (tg.statuses as readonly string[]);
      const into = [...new Set(rows.filter((t) => sts === null || sts.includes(t.to)).flatMap((t) => t.on))];
      const outside = into.filter((e) => !tg.only_via.includes(e));
      if (outside.length)
        bad(
          d.id,
          `${targetType} ${sts ? sts.join("/") : "(any)"} reachable via ${outside.join(", ")} (only ${tg.only_via.length > 6 ? tg.only_via.length + " allowed types" : tg.only_via.join(", ")})`,
        );
      const forb = into.filter((e) => d.forbidden_events.includes(e));
      if (forb.length) bad(d.id, `${targetType} reachable via forbidden ${forb.join(", ")}`);
    }
    const nd = drv.filter((e) => d.never_driving.includes(e));
    if (nd.length) bad(d.id, `${nd.join(", ")} must drive no status`);
    for (const a of d.absent_states) {
      const present = a.states.filter((s) => has(soOf(a.object).states, s));
      if (present.length) bad(d.id, `${a.object} must not contain ${present.join(", ")}`);
    }
    good(d.id, d.rule.en);
  }
  // (6) hold rows: own states, events about the target that drive it, payload guards (checked on the concept's own table)
  const holds = options.rows ? options.holds || [] : r.concept.holds || [];
  for (const h of holds) {
    if (!h.from.every((s) => s === null || ownState(s)))
      bad("OWN_STATES", `hold ${JSON.stringify(h.from)} uses a state outside ${r.so.name}`);
    for (const e of h.on) {
      const cat = EVENT_CATALOGUE[e];
      if (!cat) return bad("KNOWN_EVENT", `${e} is not in EVENT_TYPES`);
      if (!cat.object_types.includes(targetType) && !cat.secondary_types.includes(targetType))
        bad("EVENT_NAMES_TARGET", `hold ${e} does not name a ${targetType}`);
      if (!drv.includes(e))
        bad(
          "HOLD_DRIVES",
          `hold ${e} is not a driving event of ${targetType} (a hold admits a driving event only)`,
        );
    }
    if (h.when && !String(h.when.path).startsWith("payload."))
      bad("GUARD_READS_EVENT", `hold guard path ${String(h.when.path)} is not an event payload path`);
  }
  good(
    "HOLDS",
    holds.length
      ? `${holds.length} hold row(s): own states, driving events about the target, payload guards`
      : "none",
  );
  // (5) shared evidence
  const shared = drv.filter((e) => SHARED_EVIDENCE_EVENTS.includes(e));
  good(
    "SHARED_EVIDENCE",
    shared.length
      ? `${shared.join(", ")} also drive another object: recorded evidence naming each object, not a derivation`
      : "none",
  );
  return Object.freeze({
    ok: true,
    target: targetType,
    source: sourceType,
    checks: Object.freeze(checks),
    shared_evidence_events: Object.freeze(shared),
  });
}

/** Runs assertIndependent for every ordered pair of concepts with a lifecycle; never throws, reports instead. */
/** One ordered pair checked by independenceReport. */
export interface IndependencePair {
  readonly target: string;
  readonly source: string;
  readonly ok: boolean;
  readonly error?: string;
}
/** independenceReport result. */
export interface IndependenceReport {
  readonly ok: boolean;
  readonly checked: number;
  readonly failed: readonly IndependencePair[];
  readonly forbidden_derivations: readonly string[];
}
export function independenceReport(): IndependenceReport {
  const pairs: IndependencePair[] = [];
  for (const t of LIFECYCLE_CONCEPTS)
    for (const s of CONCEPT_IDS) {
      if (s === t) continue;
      try {
        assertIndependent(t, s);
        pairs.push({ target: t, source: s, ok: true });
      } catch (e) {
        pairs.push({ target: t, source: s, ok: false, error: (e as Error).message });
      }
    }
  const failed = pairs.filter((p) => !p.ok);
  return Object.freeze({
    ok: failed.length === 0,
    checked: pairs.length,
    failed,
    forbidden_derivations: FORBIDDEN_DERIVATIONS.map((d) => d.id),
  });
}

/**
 * checkStatusEvidence({type, object_id, status, status_source_event_id}, events) → {ok, detail}
 * Runtime half of independence (INV-16): the recorded status is backed by a recorded event that names this object,
 * drives this type, leads into this status and satisfies its guard. Evidence-free states need no event.
 */
/** A recorded status as checkStatusEvidence reads it (a ProceduralObject, a notification version or an attempt). */
export interface StatusRecord {
  type?: string;
  object_id?: string | null;
  id?: string | null;
  notification_id?: string | null;
  attempt_id?: string | null;
  status?: string | null;
  status_source_event_id?: string | null;
  version?: number | null;
}
/** A check result: ok and a detail line. */
export interface CheckDetail {
  ok: boolean;
  detail: string;
}
export function checkStatusEvidence(
  object: StatusRecord,
  events: readonly DomainEvent[] | null | undefined,
): CheckDetail {
  const id = object.object_id ?? object.id ?? object.notification_id ?? object.attempt_id;
  let r: Resolved;
  try {
    r = resolve(object.type);
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
  if (r.kind !== "CONCEPT") return { ok: false, detail: `type ${String(object.type)} is not a concept` };
  if (!has(r.so.states, object.status))
    return {
      ok: false,
      detail: `${String(object.type)} status ${String(object.status)} is not a ${r.so.name} state`,
    };
  if (isNil(object.status_source_event_id)) {
    return has(r.so.evidence_free, object.status)
      ? { ok: true, detail: "evidence-free state" }
      : {
          ok: false,
          detail: `${String(object.type)} ${String(id)} status ${object.status} has no source event`,
        };
  }
  const ev = (events || []).find((e) => e.event_id === object.status_source_event_id);
  if (!ev) return { ok: false, detail: `source event ${object.status_source_event_id} not found` };
  if (!eventConcerns(ev, object.type, id))
    return {
      ok: false,
      detail: `source event ${ev.event_id} (${ev.type}) does not name ${String(object.type)} ${String(id)}`,
    };
  if (
    object.type === "NOTIFICATION" &&
    !isNil(object.version) &&
    !isNil(ev.version) &&
    ev.version !== object.version
  ) {
    return {
      ok: false,
      detail: `source event ${ev.event_id} (${ev.type}) belongs to version ${ev.version}, not ${object.version}`,
    };
  }
  const rows = r.concept.transitions.filter((t) => t.to === object.status && t.on.includes(ev.type));
  if (!rows.length)
    return {
      ok: false,
      detail: `${ev.type} never leads ${String(object.type)} into ${object.status} (allowed: ${evidenceEventsInto(object.type, object.status).join(", ") || "none"})`,
    };
  if (!rows.some((t) => guardHolds(t.when, ev)))
    return { ok: false, detail: `${ev.type} payload does not satisfy the guard into ${object.status}` };
  return { ok: true, detail: `${ev.type} → ${object.status}` };
}

/** The case half (INV-16 / INV-01): the recorded code is backed by a case-code event naming the case with payload.to = code. */
/** A case record (charter §3.1) as the checks read it; every field is optional so that a malformed record is reported. */
export interface CaseRecord {
  case_id?: string | null;
  exists?: boolean;
  internal_ref?: string | null;
  case_number?: string | null;
  track?: string;
  classification?: string;
  status?: { code?: string | null; recorded_at?: string | null; source_event_id?: string | null } | null;
  flags?: { [flag: string]: unknown } | null;
  restrictions?: Record<string, unknown> | null;
  history?: { code?: string | null; recorded_at?: string | null; source_event_id?: string | null }[] | null;
}
/** Options of checkCaseEvidence: flags false skips the flag check. */
export interface CaseEvidenceOptions {
  flags?: boolean;
}
export function checkCaseEvidence(
  caseRecord: CaseRecord | null | undefined,
  events: readonly DomainEvent[] | null | undefined,
  options: CaseEvidenceOptions = {},
): CheckDetail {
  if (!caseRecord || caseRecord.exists === false) return { ok: true, detail: "no case" };
  const st: NonNullable<CaseRecord["status"]> = caseRecord.status || {};
  if (!isV8Code(st.code)) return { ok: false, detail: `status.code ${String(st.code)} is not a V8 code` };
  const ev = (events || []).find((e) => e.event_id === st.source_event_id);
  if (!ev) return { ok: false, detail: `case source event ${String(st.source_event_id)} not found` };
  if (!CASE_CODE_EVENTS.includes(ev.type))
    return {
      ok: false,
      detail: `case code source ${ev.event_id} is ${ev.type}, not one of ${CASE_CODE_EVENTS.join("/")}`,
    };
  if (!eventConcerns(ev, "CASE", caseRecord.case_id))
    return { ok: false, detail: `case source event ${ev.event_id} names another case` };
  if (!ev.payload || ev.payload.to !== st.code)
    return {
      ok: false,
      detail: `case source event ${ev.event_id} records ${String(ev.payload && ev.payload.to)}, not ${String(st.code)}`,
    };
  if (options.flags === false) return { ok: true, detail: `${ev.type} → ${st.code}` };
  const flags = caseRecord.flags || {};
  for (const [k, v] of Object.entries(flags)) {
    if (!has(CASE_FLAGS, k)) return { ok: false, detail: `unknown case flag ${k}` };
    if (v !== true) continue;
    const setters = Object.entries(CASE_FLAG_EVENTS)
      .filter(([, s]) => s[k] === true)
      .map(([t]) => t);
    if (!(events || []).some((e) => setters.includes(e.type) && eventConcerns(e, "CASE", caseRecord.case_id)))
      return { ok: false, detail: `flags.${k} = true without ${setters.join("/")}` };
  }
  return { ok: true, detail: `${ev.type} → ${st.code}` };
}

/** Platform alignment of each status object (FACT where a platform enum is cited; mappings are INFERENCE). */
export const PLATFORM_ALIGNMENT: Readonly<Record<StatusObjectName, readonly PlatformAlignment[]>> =
  Object.freeze(
    Object.fromEntries(STATUS_OBJECT_NAMES.map((n) => [n, STATUS_OBJECTS[n].platform_alignment])) as Record<
      StatusObjectName,
      readonly PlatformAlignment[]
    >,
  );
