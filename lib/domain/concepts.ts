/**
 * lib/domain/concepts.ts — CDF Notifications V13 · workstream W-A (domain model).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
 *
 * Contents
 *   EVENT_TYPES / EVENT_CATALOGUE  the event-type enum (charter §3.3 minimum set, owned by W-A) plus the
 *                                  additions W-A needs, each documented with reason and source, and the 58
 *                                  step-evidence types proposed by W-C and adopted by the lead
 *                                  (work/LEAD_notes.md L-05 item 2).
 *   PLATFORM_AUDIT_EVENT_MAP,      platform audit names, template codes and recorded values → V13 event types;
 *   toV13EventType                 toV13EventType() is the one resolver of evidence names (work/LEAD_notes.md L-06).
 *   FORMAL_NOTICE_EVENTS           formal notices are domain events, distinct from notify.* (L-05, G-06).
 *   PROTECTED_EVENT_RULES          ids-only and secret-ballot payload rules (L-06; CLAUDE.md protocol §22; mig. 1890:875).
 *   DELIVERY_CONFIRMATION_MODES    e-mail delivery confirmation reading (L-07): ACCEPTANCE (default) | SETTLEMENT.
 *   CONCEPTS                       the 20 concepts of the owner's directive, each with meaning, significance,
 *                                  owning domain (charter §2), lifecycle (one of the seven status objects of
 *                                  charter §3.4, or 'none'), event-driven transitions (and hold rows: an
 *                                  event recorded legitimately from a state that leaves the status unchanged,
 *                                  work/LEAD_notes.md L-10), relationships, authoritative source, permitted
 *                                  actions, authorization, evidence, disclosure default and audit.
 *
 * Labels used in every `label` field: FACT (read from the cited source or reproduced by execution) ·
 * INFERENCE · PROPOSAL · UNVERIFIED. BUILT ≠ APPROVED; PROPOSED ≠ IMPLEMENTED.
 * Source paths are relative to /mnt/project-files (V12 package and first review, read-only) or to the
 * platform repository `cdf_case_management` (read-only). Line numbers are those read on 27 Oct 2026.
 *
 * Its only runtime import is the leaf nil.ts: status.ts and invariants.ts import from it (no import cycle).
 */
import type { Bilingual, EventDomain, Guard, HoldRow, Label, OwnerDomain, TransitionRow } from "./types";
import { isNil } from "./nil";

export const LABELS: readonly Label[] = Object.freeze([
  "FACT",
  "INFERENCE",
  "PROPOSAL",
  "UNVERIFIED",
] as const);

/** Charter §2 — the seven logical domains. */
export const OWNER_DOMAINS = Object.freeze({
  A: Object.freeze({ ar: "ذكاء القضية", en: "Case Intelligence" }),
  B: Object.freeze({ ar: "الذكاء الإجرائي", en: "Procedural Intelligence" }),
  C: Object.freeze({ ar: "ذكاء الصلاحيات", en: "Authority Intelligence" }),
  D: Object.freeze({ ar: "ذكاء الأحداث", en: "Event Intelligence" }),
  E: Object.freeze({ ar: "ذكاء الإفصاح", en: "Disclosure Intelligence" }),
  F: Object.freeze({ ar: "ذكاء الإشعارات", en: "Notification Intelligence" }),
  G: Object.freeze({ ar: "ذكاء الأدلة والتدقيق", en: "Evidence & Audit Intelligence" }),
} as const) satisfies Readonly<Record<OwnerDomain, Bilingual>>;

/** Charter §3.2 — ProceduralObject.type (13 values, charter order). */
export const PROCEDURAL_OBJECT_TYPES = Object.freeze([
  "REFERRAL",
  "REPORT",
  "ALLEGATION",
  "PROCEDURE",
  "INVESTIGATION",
  "TASK",
  "MEETING",
  "HEARING",
  "BALLOT",
  "RECOMMENDATION",
  "LEGAL_OPINION",
  "DECISION",
  "IMPLEMENTATION_ACTION",
] as const);
export type ProceduralObjectType = (typeof PROCEDURAL_OBJECT_TYPES)[number];

// =====================================================================================================
// Event types (Domain D). W-A owns the enum (charter §3.3).
// =====================================================================================================

/** FACT: CHARTER.md §3.3, the minimum set, verbatim and in charter order (49 types). */
export const EVENT_TYPES_CHARTER_MINIMUM = Object.freeze([
  "CASE_REGISTERED",
  "CASE_STATUS_RECORDED",
  "CASE_SUSPENDED",
  "CASE_RESUMED",
  "CASE_RETURNED",
  "CASE_REOPENED",
  "CASE_CLOSED",
  "REFERRAL_RECEIVED",
  "REFERRAL_ACKNOWLEDGED",
  "INVESTIGATION_ASSIGNED",
  "STATEMENT_REQUESTED",
  "STATEMENT_RECEIVED",
  "MEETING_SCHEDULED",
  "MEETING_RESCHEDULED",
  "MEETING_CANCELLED",
  "MEETING_OPENED",
  "MEETING_CLOSED",
  "MINUTES_DRAFTED",
  "MINUTES_UNDER_REVIEW",
  "MINUTES_FINAL",
  "CHAIR_DIRECTION_RECORDED",
  "INFO_REQUEST_SENT",
  "INFO_RECEIVED",
  "BALLOT_OPENED",
  "BALLOT_CLOSED",
  "RECOMMENDATION_ADOPTED",
  "RECOMMENDATION_RETURNED",
  "LEGAL_REVIEW_REQUESTED",
  "LEGAL_OPINION_SUBMITTED",
  "PACKAGE_SUBMITTED_TO_AUTHORITY",
  "AUTHORITY_DECISION_RECORDED",
  "DECISION_NOTICE_ISSUED",
  "DECISION_NOTICE_DELIVERED",
  "GRIEVANCE_WINDOW_STARTED",
  "GRIEVANCE_RECEIVED",
  "ACTION_ASSIGNED",
  "ACTION_COMPLETED",
  "ACTION_VERIFIED",
  "NOTIFICATION_DRAFTED",
  "NOTIFICATION_VALIDATED",
  "NOTIFICATION_AUTHORIZED",
  "NOTIFICATION_QUEUED",
  "NOTIFICATION_SENT",
  "DELIVERY_CONFIRMED",
  "DELIVERY_FAILED",
  "NOTIFICATION_CANCELLED",
  "NOTIFICATION_CORRECTED",
  "NOTIFICATION_SUPERSEDED",
  "RECIPIENT_ACKNOWLEDGED",
] as const);
export type CharterMinimumEventType = (typeof EVENT_TYPES_CHARTER_MINIMUM)[number];

const CONTRACTS = "cdf_case_management/packages/contracts/src/index.ts";
const MIGRATIONS = "cdf_case_management/infrastructure/supabase/migrations/";
const MIG1920 = `${MIGRATIONS}20261007001920_notification_engine.sql`;
const TWSM = "cdf_case_management/docs/business-architecture/TARGET_WORKFLOW_STATE_MODEL.md"; // the charter calls it rebase/TARGET_WORKFLOW_STATE_MODEL.md
const TDM = "cdf_case_management/docs/business-architecture/TARGET_DOMAIN_MODEL.md"; // the brief calls it rebase/TARGET_DOMAIN_MODEL.md

const PROCEDURE_GENERIC_TYPES: string[] = [
  "PROCEDURE",
  "INVESTIGATION",
  "REFERRAL",
  "REPORT",
  "LEGAL_OPINION",
];
/** Procedural object types other than `driven`: the closure targets a closing event may name (work/LEAD_notes.md L-05). */
const CLOSABLE_ONLY = (driven: readonly string[]): string[] =>
  PROCEDURAL_OBJECT_TYPES.filter((t) => !driven.includes(t));

/** A closing event closes `payload.target` when present, else its object (work/LEAD_notes.md L-05). */
export type ClosesRule = "TARGET_ELSE_OBJECT";
/** One entry of EVENT_CATALOGUE. */
export interface EventCatalogueEntry {
  readonly domain: EventDomain;
  readonly object_types: readonly string[];
  readonly secondary_types: readonly string[];
  readonly origin: "CHARTER_MINIMUM" | "W-A_ADDITION";
  readonly label: Label;
  readonly source: string;
  readonly note: string | null;
  readonly reason?: Bilingual;
  readonly closes?: ClosesRule;
  readonly proposed_by?: "W-C";
  readonly wc_number?: number;
  readonly payload_doc?: string;
}
interface CatalogueExtra {
  secondary_types?: readonly string[];
  note?: string;
  closes?: ClosesRule;
}

/** Charter minimum entry: the event type is FACT (charter); its object binding is W-A's PROPOSAL. */
function cm(
  domain: EventDomain,
  object_types: readonly string[],
  extra: CatalogueExtra = {},
): EventCatalogueEntry {
  return Object.freeze({
    domain,
    object_types: Object.freeze(object_types),
    secondary_types: Object.freeze(extra.secondary_types || []),
    origin: "CHARTER_MINIMUM" as const,
    label: "FACT" as const,
    source: "CHARTER.md §3.3",
    note: extra.note || null,
    ...(extra.closes ? { closes: extra.closes } : {}),
  });
}
/** W-A addition: PROPOSAL, with the reason it is needed and the source that anchors it. */
function wa(
  domain: EventDomain,
  object_types: readonly string[],
  reason_en: string,
  reason_ar: string,
  source: string,
  extra: CatalogueExtra = {},
): EventCatalogueEntry {
  return Object.freeze({
    domain,
    object_types: Object.freeze(object_types),
    secondary_types: Object.freeze(extra.secondary_types || []),
    origin: "W-A_ADDITION" as const,
    label: "PROPOSAL" as const,
    source,
    reason: Object.freeze({ ar: reason_ar, en: reason_en }),
    note: extra.note || null,
    ...(extra.closes ? { closes: extra.closes } : {}),
  });
}

// ---- W-C step-evidence types adopted by the lead (work/LEAD_notes.md L-05 item 2) ---------------------------------------
// [number in work/new_event_types.md §3, type, object types, secondary types, purpose (en), purpose (ar), payload (W-C),
//  basis (W-C), platform status (W-C)]. Type, purpose, payload, basis and platform status are copied from W-C's table
//  (work/new_event_types.md sha256 87b978ad…, read 27 Oct 2026 20:29 UTC); the Arabic purpose and the object types are
//  W-A's (PROPOSAL: object types read from the journeys W-C names for each type). Five W-C names were replaced by existing
//  types (L-05 item 1: GRIEVANCE_REGISTERED, GRIEVANCE_CONCLUDED, PROCEDURE_CLOSED, REFERRAL_DECIDED, REMINDER_ISSUED).
type WcRow = readonly [
  number,
  string,
  readonly string[],
  readonly string[],
  string,
  string,
  string,
  string,
  string,
];
const WC_ROWS: readonly WcRow[] = [
  [
    1,
    "AGENDA_APPROVED",
    ["MEETING", "HEARING"],
    [],
    "The meeting agenda is approved",
    "اعتُمد جدول أعمال الاجتماع.",
    "{}",
    "26b J-MEETING 1/1",
    "UNVERIFIED in the platform",
  ],
  [
    2,
    "AGENDA_DRAFTED",
    ["MEETING", "HEARING"],
    [],
    "A meeting agenda draft is submitted for approval",
    "قُدّمت مسودة جدول الأعمال للاعتماد.",
    "{}",
    "V12 COM-03 AGENDA_APPROVAL",
    "UNVERIFIED in the platform",
  ],
  [
    3,
    "ALERT_ESCALATED",
    [
      "REFERRAL",
      "REPORT",
      "ALLEGATION",
      "PROCEDURE",
      "INVESTIGATION",
      "TASK",
      "MEETING",
      "HEARING",
      "BALLOT",
      "RECOMMENDATION",
      "LEGAL_OPINION",
      "DECISION",
      "IMPLEMENTATION_ACTION",
    ],
    [],
    "An overdue alert is escalated",
    "صُعّد تنبيه تأخر.",
    "{rule}",
    "V12 SYS-05 DEADLINE_OVERDUE",
    "PROPOSED",
  ],
  [
    4,
    "ALERT_RAISED",
    [
      "REFERRAL",
      "REPORT",
      "ALLEGATION",
      "PROCEDURE",
      "INVESTIGATION",
      "TASK",
      "MEETING",
      "HEARING",
      "BALLOT",
      "RECOMMENDATION",
      "LEGAL_OPINION",
      "DECISION",
      "IMPLEMENTATION_ACTION",
    ],
    [],
    "A control rule raises an internal alert",
    "أطلقت قاعدة رقابية تنبيهاً داخلياً.",
    "{rule}",
    "V12 SYS-01..08 events",
    "PROPOSED",
  ],
  [
    5,
    "ALERT_RESOLVED",
    [
      "REFERRAL",
      "REPORT",
      "ALLEGATION",
      "PROCEDURE",
      "INVESTIGATION",
      "TASK",
      "MEETING",
      "HEARING",
      "BALLOT",
      "RECOMMENDATION",
      "LEGAL_OPINION",
      "DECISION",
      "IMPLEMENTATION_ACTION",
    ],
    [],
    "The alerted condition is resolved",
    "زالت الحالة موضوع التنبيه.",
    "{}",
    "26b J-ALERT 4/1",
    "PROPOSED",
  ],
  [
    6,
    "ALLEGATIONS_NOTIFIED",
    ["INVESTIGATION", "TASK", "HEARING"],
    ["ALLEGATION"],
    "The attributed facts are notified to the party",
    "أُبلغ الطرف بالوقائع المنسوبة إليه.",
    "{}",
    "V12 INV-06 ALLEGATION_NOTICE",
    "UNVERIFIED",
  ],
  [
    7,
    "AUTHORISED_OUTCOME_COMMUNICATED",
    ["REPORT", "REFERRAL"],
    [],
    "The authorised outcome is made available to the reporter or referring body",
    "أُتيحت النتيجة المأذون بها للمبلّغ أو للجهة المحيلة.",
    "{channel}",
    "26b J-WB-REPORTER 5/1, J-IR-REFERRER 5/2; DEC-24 (reporter channel = portal only until decided)",
    "NOT BUILT; channel SOURCE_REQUIRED",
  ],
  [
    8,
    "COI_CONCERN_RAISED",
    ["MEETING", "HEARING"],
    [],
    "A conflict concern is raised in a meeting",
    "أُثيرت شبهة تعارض مصالح في اجتماع.",
    "{}",
    "CF-26 register (BUILT)",
    "BUILT",
  ],
  [
    9,
    "COI_DECIDED",
    ["MEETING", "HEARING"],
    [],
    "The decider seat decides a conflict concern",
    "فصل صاحب الصفة المختص في شبهة التعارض.",
    "{outcome}",
    "V12 COM-11 COI_MITIGATION",
    "UNVERIFIED",
  ],
  [
    10,
    "COI_DECLARATIONS_COMPLETE",
    ["MEETING", "HEARING"],
    [],
    "All eligible declarations are received",
    "وردت إفصاحات جميع المعنيين.",
    "{}",
    "TARGET 3.4 (COI declarations required from all eligible)",
    "UNVERIFIED",
  ],
  [
    11,
    "COI_DECLARATION_RECEIVED",
    ["MEETING", "HEARING", "INVESTIGATION", "PROCEDURE"],
    [],
    "One member declaration is received",
    "ورد إفصاح أحد الأعضاء.",
    "{member_id}",
    "V12 COM-10 COI_RECEIVED",
    "UNVERIFIED",
  ],
  [
    12,
    "COI_DECLARATION_REQUESTED",
    ["MEETING", "HEARING"],
    [],
    "Conflict-of-interest declarations are requested",
    "طُلبت إفصاحات تعارض المصالح.",
    "{}",
    "V12 COM-09; TARGET 3.4 (COI declarations required at opening)",
    "UNVERIFIED",
  ],
  [
    13,
    "CORRECTION_REQUESTED",
    ["TASK", "HEARING"],
    [],
    "The party or witness requests a correction of the record",
    "طلب الطرف أو الشاهد تصحيح المحضر.",
    "{}",
    "26b J-STATEMENT-PARTY 4/2, J-WITNESS 4/2",
    "UNVERIFIED",
  ],
  [
    14,
    "DEFENCE_FORWARDED",
    ["PROCEDURE"],
    [],
    "A submitted defence is passed to the committee",
    "أُحيل الدفاع المقدَّم إلى اللجنة.",
    "{}",
    "26b J-DEFENCE 5/2",
    "UNVERIFIED",
  ],
  [
    15,
    "DEFENCE_NOTICE_ISSUED",
    ["PROCEDURE"],
    [],
    "A defence notice is issued to the subject employee",
    "صدر إشعار الدفاع للموظف المعني.",
    "{}",
    "CF-23 register api.issue_defence_notice (BUILT)",
    "BUILT",
  ],
  [
    16,
    "DEFENCE_PACKET_RELEASED",
    ["PROCEDURE"],
    [],
    "The defence packet is released to the subject employee",
    "أُتيحت حزمة الدفاع للموظف المعني.",
    "{}",
    "CF-23c register (BUILT)",
    "BUILT",
  ],
  [
    17,
    "DEFENCE_PERIOD_CLOSED",
    ["PROCEDURE"],
    [],
    "The defence period closes",
    "انتهت مهلة الدفاع.",
    "{reason: SUBMITTED|LAPSED}",
    "26b J-DEFENCE 5/1",
    "UNVERIFIED",
  ],
  [
    18,
    "DEFENCE_PERIOD_STARTED",
    ["PROCEDURE"],
    [],
    "The defence period starts (its length is SOURCE_REQUIRED, DEC-F18)",
    "بدأت مهلة الدفاع (مدتها SOURCE_REQUIRED، DEC-F18).",
    "{}",
    "CF-23 register sub-state DEFENCE_PERIOD; D11-064",
    "BUILT (status); duration SOURCE_REQUIRED",
  ],
  [
    19,
    "DEFENCE_SUBMITTED",
    ["PROCEDURE"],
    [],
    "The subject employee submits a defence",
    "قدّم الموظف المعني دفاعه.",
    "{}",
    "26b J-DEFENCE 4/2",
    "UNVERIFIED",
  ],
  [
    20,
    "DIRECTION_RESULT_RECORDED",
    ["PROCEDURE"],
    [],
    "The result of an executed chair direction is recorded",
    "سُجّلت نتيجة تنفيذ توجيه الرئيس.",
    "{}",
    "26b J-CHAIR-DIRECTION 4/1",
    "NOT BUILT",
  ],
  [
    21,
    "DISCLOSURE_SCOPE_APPROVED",
    ["REFERRAL"],
    [],
    "What may be disclosed to the referring body is approved",
    "اعتُمد نطاق ما يجوز الإفصاح عنه للجهة المحيلة.",
    "{}",
    "26b J-IR-REFERRER 5/1; v9_data IR status IR-S5-02 (disclosure scope review)",
    "NOT BUILT",
  ],
  [
    22,
    "DOCUMENTS_VERIFIED",
    ["TASK"],
    [],
    "Provided documents are verified for completeness",
    "تُحقّق من اكتمال المستندات المقدَّمة.",
    "{complete: boolean}",
    "26b J-EVIDENCE-REQUEST 3/2",
    "UNVERIFIED",
  ],
  [
    23,
    "EVIDENCE_RECORDED",
    ["INVESTIGATION", "TASK", "HEARING"],
    [],
    "Received material is recorded in the investigation file",
    "قُيّدت المواد الواردة في ملف التحقيق.",
    "{}",
    "26b J-INVESTIGATION 2/3, J-STATEMENT-PARTY 5/1",
    "BUILT (evidence vault); event name PROPOSED",
  ],
  [
    24,
    "GRIEVANCE_WINDOW_ENDED",
    ["DECISION"],
    [],
    "The grievance window ends",
    "انقضت مهلة التظلم.",
    "{}",
    "26b J-DECISION-SUBJECT 2/2",
    "UNVERIFIED",
  ],
  [
    25,
    "HANDLING_PLAN_APPROVED",
    ["REFERRAL"],
    [],
    "The handling plan for a mandate is approved",
    "اعتُمدت خطة معالجة التكليف.",
    "{}",
    "26b J-DR-AUTHORITY 3/4",
    "NOT BUILT",
  ],
  [
    26,
    "INDEPENDENCE_DECLARED",
    ["INVESTIGATION"],
    [],
    "An investigator records the independence / no-conflict declaration",
    "سجّل المحقق إقرار الاستقلال وعدم التعارض.",
    "{}",
    "V12 INV-02 INVESTIGATOR_COI",
    "UNVERIFIED",
  ],
  [
    27,
    "INTAKE_CHECK_RECORDED",
    ["REFERRAL", "REPORT", "PROCEDURE"],
    [],
    "An intake check (source, basis, attachments, confidentiality) is recorded",
    "سُجّل فحص من فحوص الاستقبال (المصدر، الأساس، المرفقات، السرية).",
    "{check: SOURCE|BASIS|ATTACHMENTS|CONFIDENTIALITY, result}",
    "26b intake sub-steps (J-IR-REFERRER 1/2-1/3, J-INTAKE-SECRETARY stage 2, J-DR-SECRETARY stage 2)",
    "NOT BUILT as a separate record (TARGET 3.1 records the decision only)",
  ],
  [
    28,
    "MANDATE_AMENDED",
    ["INVESTIGATION"],
    [],
    "An approved amendment of investigation scope or duration is recorded",
    "سُجّل تعديل معتمد لنطاق التحقيق أو مدته.",
    "{field: SCOPE|DURATION|OUTPUTS}",
    "V12 INV-07 INV_SCOPE_UPDATE",
    "UNVERIFIED",
  ],
  [
    29,
    "MANDATE_RECEIVED",
    ["REFERRAL"],
    [],
    "A direct mandate from an authority is received",
    "ورد تكليف مباشر من صاحب صلاحية.",
    "{}",
    "V12 DR-01 event DIRECT_RECEIVED (v9_data)",
    "NOT BUILT",
  ],
  [
    30,
    "MANDATE_SCOPE_DEFINED",
    ["REFERRAL"],
    [],
    "The mandate scope and the executing body are defined",
    "حُدّد نطاق التكليف والجهة المنفذة.",
    "{}",
    "26b J-DR-AUTHORITY 3/1-3/2",
    "NOT BUILT",
  ],
  [
    31,
    "MATTER_PRESENTED_TO_CHAIR",
    ["PROCEDURE", "REFERRAL", "REPORT"],
    [],
    "A matter is presented to the committee chair, for direction or with a result",
    "عُرض موضوع على رئيس اللجنة للتوجيه أو بنتيجة.",
    "{purpose: DIRECTION|RESULT, matter: CASE|REFERRAL|REPORT|PROCEDURE}",
    "CF-15 register trigger; V12 COM-01, COM-02, DR-03",
    "REQUIRED_NOT_BUILT",
  ],
  [
    32,
    "MATTER_RECEIVED_BY_SECRETARIAT",
    ["PROCEDURE", "REFERRAL", "REPORT"],
    [],
    "A referral, report or case reaches the committee secretariat",
    "وصلت إحالة أو بلاغ أو قضية إلى أمانة اللجنة.",
    "{matter: REFERRAL|REPORT|CASE, source}",
    "CF-09 (api.refer_case_to_committee), CF-10 (OTHER_AUTHORIZED_SOURCE) register triggers",
    "REQUIRED_NOT_BUILT (register)",
  ],
  [
    33,
    "MEETING_PACK_RELEASED",
    ["MEETING", "HEARING"],
    [],
    "Meeting materials are released to authorised participants",
    "أُتيحت مواد الاجتماع للمشاركين المأذون لهم.",
    "{}",
    "V12 COM-08 MEETING_PACK",
    "UNVERIFIED",
  ],
  [
    34,
    "MEETING_RECORD_CLOSED",
    ["MEETING", "HEARING"],
    [],
    "The meeting record is filed and closed",
    "حُفظ سجل الاجتماع وأُقفل.",
    "{}",
    "26b J-MEETING 5/1",
    "NOT BUILT",
  ],
  [
    35,
    "MINUTES_SIGNED",
    ["MEETING", "HEARING"],
    [],
    "Approved minutes are signed",
    "وُقّع المحضر المعتمد.",
    "{}",
    "V12 COM-17 MINUTES_SIGNED; 26b J-MEETING 4/3",
    "UNVERIFIED (TARGET 3.4 has no signature state)",
  ],
  [
    36,
    "OFFLINE_BALLOTS_BOUND",
    ["BALLOT"],
    [],
    "Provisional paper ballots of a member are bound to an opened vote item",
    "رُبطت أوراق تصويت ورقية مؤقتة لعضو ببند تصويت مفتوح.",
    "{member_id}",
    "CF-40 register (2120 F4, PROPOSED)",
    "PROPOSED (branch)",
  ],
  [
    37,
    "PACKAGE_ACCESSED",
    ["PROCEDURE", "LEGAL_OPINION"],
    [],
    "A recipient opens a released package (access record)",
    "اطّلع مستلم على حزمة متاحة (سجل اطلاع).",
    "{}",
    "26b J-DEFENCE 3/2, J-LEGAL-REVIEW 2/1, J-RESTRICTION-LIFT 2/2",
    "UNVERIFIED (access logging)",
  ],
  [
    38,
    "PACKAGE_SUBMITTED_FOR_VOTE",
    ["RECOMMENDATION"],
    ["BALLOT"],
    "A recommendation package is submitted for deliberation and vote",
    "قُدّمت حزمة التوصية للمداولة والتصويت.",
    "{}",
    "CF-31 register api.submit_package_for_vote (package VOTING)",
    "REQUIRED_NOT_BUILT (notice)",
  ],
  [
    39,
    "PARTICIPANTS_INVITED",
    ["MEETING", "HEARING"],
    [],
    "Participants are added to a meeting and invited",
    "أُضيف مشاركون إلى اجتماع ودُعوا إليه.",
    "{purpose: DELIBERATION|HEARING}",
    "CF-24 register: participant added to a meeting (BUILT)",
    "BUILT",
  ],
  [
    40,
    "PROGRESS_UPDATE_APPROVED",
    ["REFERRAL"],
    [],
    "An approved progress update is issued to the mandating authority",
    "صدر تحديث معتمد عن سير العمل إلى جهة التكليف.",
    "{}",
    "V12 DR-05 event DIRECT_PROGRESS",
    "NOT BUILT",
  ],
  [
    41,
    "REFERRAL_CLOSED",
    ["REFERRAL"],
    [],
    "The institutional referral path is closed (not the case)",
    "أُقفل مسار الإحالة المؤسسية (لا القضية).",
    "{reason}",
    "V12 IR-08 event REFERRAL_CLOSED (v9_data)",
    "NOT BUILT",
  ],
  [
    42,
    "REFERRAL_CREATED",
    ["REFERRAL"],
    [],
    "A direct referral is drafted",
    "أُعدّت مسودة إحالة مباشرة.",
    "{}",
    "TARGET_WORKFLOW_STATE_MODEL 3.1 api.create_referral (DRAFT)",
    "BUILT (command)",
  ],
  [
    43,
    "REFERRAL_HEAD_DECIDED",
    ["REFERRAL"],
    [],
    "The sector head approves or returns a direct referral",
    "اعتمد رئيس القطاع الإحالة المباشرة أو أعادها.",
    "{decision: APPROVED|RETURNED}",
    "TARGET 3.1 api.sector_approve_referral / api.sector_return_referral; CF-02, CF-03",
    "BUILT",
  ],
  [
    44,
    "REFERRAL_SUBMITTED",
    ["REFERRAL"],
    [],
    "A direct referral is submitted or resubmitted to the sector head",
    "قُدّمت الإحالة المباشرة أو أُعيد تقديمها إلى رئيس القطاع.",
    "{resubmission: boolean}",
    "TARGET 3.1 api.submit_referral_to_head / api.resubmit_referral; CF-01 referral_event SUBMITTED / RESUBMITTED",
    "BUILT",
  ],
  [
    45,
    "RESTRICTION_LIFTED",
    ["PROCEDURE"],
    [],
    "The restriction is lifted within the window",
    "رُفع التقييد خلال المدة المحددة.",
    "{}",
    "26b J-RESTRICTION-LIFT 4/2",
    "PROPOSED (branch)",
  ],
  [
    46,
    "RESTRICTION_LIFT_DECIDED",
    ["PROCEDURE"],
    [],
    "The second approver approves or rejects the lift",
    "وافق المعتمد الثاني على رفع التقييد أو رفضه.",
    "{decision: APPROVED|REJECTED}",
    "CF-39 register api.decide_restriction_lift (2130, branch)",
    "PROPOSED (branch)",
  ],
  [
    47,
    "RESTRICTION_LIFT_DECISION_REFUSED",
    ["PROCEDURE"],
    [],
    "A decision attempt is refused because the preview changed",
    "رُدّت محاولة القرار لتغيّر المعاينة.",
    "{}",
    "26b J-RESTRICTION-LIFT 3/2",
    "PROPOSED (branch)",
  ],
  [
    48,
    "RESTRICTION_LIFT_PREVIEWED",
    ["PROCEDURE"],
    [],
    "The restricted case authority previews a restriction lift",
    "عاين صاحب صلاحية القضايا المقيدة رفع التقييد.",
    "{}",
    "CF-38 register api.preview_restriction_lift (2130, branch)",
    "PROPOSED (branch)",
  ],
  [
    49,
    "RESTRICTION_LIFT_REQUESTED",
    ["PROCEDURE"],
    [],
    "A restriction lift is requested",
    "طُلب رفع التقييد.",
    "{}",
    "CF-38 register api.request_restriction_lift (2130, branch)",
    "PROPOSED (branch)",
  ],
  [
    50,
    "RESTRICTION_LIFT_REQUEST_CLOSED",
    ["PROCEDURE"],
    [],
    "The lift request closes by execution, expiry or withdrawal",
    "أُقفل طلب رفع التقييد بالتنفيذ أو الانقضاء أو السحب.",
    "{reason: EXECUTED|EXPIRED|WITHDRAWN|REJECTED}",
    "26b J-RESTRICTION-LIFT 5/1",
    "PROPOSED (branch)",
  ],
  [
    51,
    "RESULTS_PRESENTED_TO_COMMITTEE",
    ["INVESTIGATION", "TASK"],
    [],
    "Extended-investigation results are presented to the committee",
    "عُرضت نتائج التحقيق الموسّع على اللجنة.",
    "{}",
    "CF-23d register (REQUIRED_NOT_BUILT)",
    "REQUIRED_NOT_BUILT",
  ],
  [
    52,
    "RIGHTS_NOTICE_ISSUED",
    ["PROCEDURE", "INVESTIGATION"],
    [],
    "A rights notice is issued to the subject employee",
    "صدر إشعار الحقوق للموظف المعني.",
    "{}",
    "CF-22 register api.issue_rights_notice (BUILT)",
    "BUILT",
  ],
  [
    53,
    "SANCTION_EXTRACT_APPROVAL_REQUESTED",
    ["PROCEDURE"],
    [],
    "Approval of the extract is requested from the restricted case authority",
    "طُلب اعتماد المستخرج من صاحب صلاحية القضايا المقيدة.",
    "{}",
    "CF-36 register (BUILT)",
    "BUILT",
  ],
  [
    54,
    "SANCTION_EXTRACT_DECIDED",
    ["PROCEDURE"],
    [],
    "The restricted case authority decides the extract request",
    "فصل صاحب صلاحية القضايا المقيدة في طلب المستخرج.",
    "{decision: APPROVED|RETURNED|REJECTED}",
    "26b J-SANCTION-EXTRACT stage 3",
    "UNVERIFIED",
  ],
  [
    55,
    "SANCTION_EXTRACT_ISSUED",
    ["PROCEDURE"],
    [],
    "The approved extract is issued",
    "صدر المستخرج المعتمد.",
    "{}",
    "26b J-SANCTION-EXTRACT 4/1",
    "UNVERIFIED",
  ],
  [
    56,
    "SANCTION_EXTRACT_PREPARED",
    ["PROCEDURE"],
    [],
    "A prior-sanctions extract including a restricted case is prepared",
    "أُعدّ مستخرج الجزاءات السابقة متضمناً قضية مقيدة.",
    "{}",
    "CF-36 register (BUILT)",
    "BUILT",
  ],
  [
    57,
    "STATEMENT_RECORD_APPROVED",
    ["TASK", "HEARING"],
    [],
    "The statement record is approved",
    "اعتُمد محضر الإفادة.",
    "{}",
    "26b J-STATEMENT-PARTY 4/3, J-WITNESS 5/1",
    "UNVERIFIED",
  ],
  [
    58,
    "STATEMENT_RECORD_DRAFTED",
    ["TASK", "HEARING"],
    [],
    "A statement record is drafted and correction is enabled",
    "حُرّر محضر الإفادة وأُتيح طلب تصحيحه.",
    "{}",
    "V12 INV-12 WITNESS_STATEMENT_ACKNOWLEDGED",
    "UNVERIFIED",
  ],
];
/** The adopted W-C types that drive a status (work/LEAD_notes.md L-10); every other one is step evidence only. */
const WC_DRIVING_NOTES: Readonly<Record<string, string>> = Object.freeze({
  REFERRAL_SUBMITTED:
    "drives the REFERRAL status (work/LEAD_notes.md L-10): null → OPEN (the first submission to the sector head) and RETURNED | FAILED → IN_PROGRESS (a resubmission: the from-state identifies it). The recorded form of a resubmission (payload.resubmission true after a rejection); the W-A type REFERRAL_RESUBMITTED is retired.",
  REFERRAL_HEAD_DECIDED:
    "drives the REFERRAL status (L-10): decision APPROVED OPEN → IN_PROGRESS (the referral reaches the secretariat; a hold when it is already IN_PROGRESS after a resubmission), decision RETURNED OPEN | IN_PROGRESS → RETURNED (the sector head's return for completion, platform SECTOR_RETURNED; never REFERRAL_RETURNED).",
});
/** A W-C row as a catalogue entry: step evidence that drives no status (L-05 item 2) unless L-10 says otherwise; PROPOSAL, adopted by the lead. */
function wc([n, type, object_types, secondary_types, en, ar, payload, basis, platform]: WcRow): [
  string,
  EventCatalogueEntry,
] {
  return [
    type,
    Object.freeze({
      domain: "B" as const,
      object_types: Object.freeze(object_types),
      secondary_types: Object.freeze(secondary_types),
      origin: "W-A_ADDITION" as const,
      label: "PROPOSAL" as const,
      proposed_by: "W-C" as const,
      wc_number: n,
      source: `work/new_event_types.md §3 #${n} (W-C; adopted by work/LEAD_notes.md L-05 item 2); basis: ${basis}; platform: ${platform}`,
      reason: Object.freeze({ ar, en }),
      payload_doc: payload,
      note: WC_DRIVING_NOTES[type] || "step evidence (L-05 item 2): drives no status",
    }),
  ];
}
const WC_ADOPTED: Readonly<Record<string, EventCatalogueEntry>> = Object.freeze(
  Object.fromEntries(WC_ROWS.map(wc)),
);

/**
 * EVENT_CATALOGUE — every event type with: domain (A case · B procedural · F communication · G evidence and audit), the
 * object types it may name as `event.object` (object_types) or through `payload.target` / `payload.related`
 * (secondary_types), origin (charter minimum or W-A addition; `proposed_by: 'W-C'` for the 58 adopted by L-05), label
 * and source. An event *concerns* an object when it names it as `object`, as `payload.target` or in `payload.related`
 * (convention, PROPOSAL; Event.payload is free in charter §3.3). Case events concern the case by `case_id`.
 * A closing event (`closes: 'TARGET_ELSE_OBJECT'`, L-05) concerns only `payload.target` when present, else its object.
 */
export const EVENT_CATALOGUE: Readonly<Record<string, EventCatalogueEntry>> = Object.freeze({
  // ---- Domain A — case ------------------------------------------------------------------------------
  CASE_REGISTERED: cm("A", ["CASE"], {
    note: "records the V8 registration move (T02, S1.02→S1.03) or the creation of the case record at S1.03",
  }),
  CASE_STATUS_RECORDED: cm("A", ["CASE"], {
    note: "payload {from, to, transition_id}; the only event that moves CaseStatus.code besides CASE_REGISTERED",
  }),
  CASE_SUSPENDED: cm("A", ["CASE"]),
  CASE_RESUMED: cm("A", ["CASE"]),
  CASE_RETURNED: cm("A", ["CASE"]),
  CASE_REOPENED: cm("A", ["CASE"], {
    note: "no V8 transition leaves S5.05/S5.06/S5.07 except S5.05→S5.06: the code after reopening is SOURCE_REQUIRED (W3 F11, review/v12-forensic/work/W3_journeys_review.md:38)",
  }),
  CASE_CLOSED: cm("A", ["CASE"]),
  CASE_CANCELLED: wa(
    "A",
    ["CASE"],
    "CaseRecord.flags.cancelled (charter §3.1) needs its own evidence event; the V12 ledger had a CANCEL type that cancelled the whole path.",
    "علَم الإلغاء في سجل القضية يحتاج حدثاً مستقلاً يثبته؛ وكان سجل V12 يحوي نوع CANCEL يلغي المسار كله.",
    "CHARTER.md §3.1 (flags); review/v12-forensic/work/W3_journeys_review.md:38 (F11, engine_v9.js:95,209)",
  ),

  // ---- Domain B — referral / report -------------------------------------------------------------------
  REFERRAL_RECEIVED: cm("B", ["REFERRAL"]),
  REFERRAL_ACKNOWLEDGED: cm("B", ["REFERRAL"], {
    note: "step evidence (receipt acknowledged); drives no status",
  }),
  REFERRAL_RETURNED: wa(
    "B",
    ["REFERRAL"],
    "A return for completion must be distinguishable from forward progress (V12 rendered returns as progress).",
    "يجب تمييز الإعادة للاستكمال عن التقدم؛ إذ عرض V12 الإعادة تقدماً.",
    `${CONTRACTS}:1337-1352 (RETURNED_FOR_COMPLETION: the secretary's return; the sector head's SECTOR_RETURNED is REFERRAL_HEAD_DECIDED {decision: RETURNED}, W-C #43 adopted by L-05); review/v12-forensic/work/W3_journeys_review.md:43 (F16)`,
  ),
  REFERRAL_REJECTED: wa(
    "B",
    ["REFERRAL"],
    "Rejection is not final in the platform; it must be represented, not hidden (CF-06 fired no notice).",
    "الرفض ليس نهائياً في المنصة، ويجب تمثيله لا إخفاؤه (لم يصدر عن CF-06 أي إشعار).",
    `${CONTRACTS}:1337-1352 (REJECTED); ${TWSM} §3.1 ("rejection is not final"); D6 MF-023`,
  ),
  REFERRAL_OBJECTED: wa(
    "B",
    ["REFERRAL"],
    "Sector objection to a rejection.",
    "اعتراض القطاع على الرفض.",
    `${CONTRACTS}:1337-1352 (OBJECTED)`,
  ),
  REFERRAL_ACCEPTED: wa(
    "B",
    ["REFERRAL"],
    "Acceptance creates the case in the same transaction; it is the only event that completes a referral.",
    "القبول يُنشئ القضية في المعاملة نفسها، وهو الحدث الوحيد الذي يُكمل الإحالة.",
    `${CONTRACTS}:1337-1352 (ACCEPTED); ${TWSM} §3.1`,
  ),
  REFERRAL_WITHDRAWN: wa(
    "B",
    ["REFERRAL"],
    "Withdrawal by the referring side.",
    "سحب الإحالة من الجهة المحيلة.",
    `${CONTRACTS}:1337-1352 (WITHDRAWN)`,
  ),
  REPORT_RECEIVED: wa(
    "B",
    ["REPORT"],
    "Creation event of a whistleblowing report (not in the charter minimum).",
    "حدث إنشاء البلاغ (غير وارد في الحد الأدنى للميثاق).",
    `${CONTRACTS}:27-36 (REPORT_STATUSES RECEIVED)`,
  ),
  REPORT_ACKNOWLEDGED: wa(
    "B",
    ["REPORT"],
    'Step evidence for "receipt recorded and acknowledged"; drives no status.',
    "دليل خطوة «إثبات الورود وإصدار إيصال الاستلام»؛ لا يحرّك أي حالة.",
    "notifications/journeys/level2_journeys.json J-WB-REPORTER stage 1",
  ),
  REPORT_CLOSED: wa(
    "B",
    ["REPORT"],
    "Closure of the report with its outcome (case opened, referred out, closed without action, duplicate).",
    "إقفال البلاغ بمآله (فتح قضية، تحويل، إقفال دون إجراء، تكرار).",
    `${CONTRACTS}:27-36 (CASE_OPENED, REFERRED_OUT, CLOSED_NO_ACTION, DUPLICATE)`,
  ),

  // ---- Domain G — evidence and audit ---------------------------------------------------------------------------------
  REPORTER_IDENTITY_REVEALED: wa(
    "G",
    ["REPORT"],
    "A permitted, justified resolution of the reporter identity is a security audit fact: it must resolve as evidence (L-06) and must never reach a notification.",
    "كشف هوية المبلّغ بإذن ومسوّغ واقعة تدقيق أمني: يلزم أن يُحلّ دليلاً (L-06) ولا يصل إلى أي إشعار أبداً.",
    `${MIGRATIONS}20261007000700_api_commands.sql:799-801 (category SECURITY; "identity values are never written to the ledger"; payload {reveal_request_id}); cdf_case_management/CLAUDE.md security rules (protocol §22); work/LEAD_notes.md L-06`,
    {
      note: "ids only: payload {reveal_request_id}; never the identity and never the justification text. Never in a notification, never cited by a statement, never the cause of a notification event (PROTECTED_EVENT_RULES; INV-27). Drives no status.",
    },
  ),

  // ---- Domain B — generic proceeding events -------------------------------------------------------------
  PROCEDURE_OPENED: wa(
    "B",
    ["PROCEDURE", "INVESTIGATION"],
    "Opening of a proceeding.",
    "فتح إجراء.",
    `${CONTRACTS}:1022-1043, 1162-1188 (OPENABLE_PROCEEDING_TYPES; api.update_proceeding_state / api.close_proceeding)`,
  ),
  PROCEDURE_STARTED: wa(
    "B",
    PROCEDURE_GENERIC_TYPES,
    "Work started (OPEN → IN_PROGRESS) or resumed after a return.",
    "بدء العمل (مفتوح ← قيد الإجراء).",
    `${CONTRACTS}:1172-1179 (OPEN_PROCEEDING_STATUSES)`,
  ),
  PROCEDURE_SUSPENDED: wa(
    "B",
    ["PROCEDURE", "INVESTIGATION"],
    "Suspension with a reason (waiting is not suspension).",
    "إيقاف بسبب محدد (الانتظار ليس إيقافاً).",
    `${CONTRACTS}:1077-1120 (SUSPENSION_REASON); ${TWSM} §1`,
  ),
  PROCEDURE_RESUMED: wa(
    "B",
    ["PROCEDURE", "INVESTIGATION"],
    "Resumption after suspension, return or failure.",
    "الاستئناف بعد الإيقاف أو الإعادة أو التعذر.",
    `${CONTRACTS}:1172-1179`,
  ),
  PROCEDURE_RETURNED: wa(
    "B",
    ["PROCEDURE", "INVESTIGATION"],
    "Return to an earlier holder for completion.",
    "الإعادة لاستكمال متطلبات.",
    `${CONTRACTS}:1034-1043 (RETURNED); ${CONTRACTS}:1077-1160 (RETURN_REASON)`,
  ),
  PROCEDURE_COMPLETED: wa(
    "B",
    ["PROCEDURE", "INVESTIGATION", ...CLOSABLE_ONLY(["PROCEDURE", "INVESTIGATION"])],
    "Conclusion of a proceeding (platform CONCLUDED); also the closure of any procedural object (L-05).",
    "انتهاء الإجراء (CONCLUDED في المنصة)؛ وإقفال أي كائن إجرائي (L-05).",
    `${CONTRACTS}:1181-1184 (CLOSED_PROCEEDING_STATUSES); work/LEAD_notes.md L-05 (replaces W-C GRIEVANCE_CONCLUDED and PROCEDURE_CLOSED)`,
    {
      secondary_types: CLOSABLE_ONLY(["PROCEDURE", "INVESTIGATION"]),
      closes: "TARGET_ELSE_OBJECT",
      note: "closes payload.target when present ({type, id} or an id), else event.object (L-05; W-C resolve.js). It moves the status of a PROCEDURE or INVESTIGATION only; for every other closed object it is step evidence. payload.reason, payload.outcomes and payload.proceeding_type (e.g. GRIEVANCE) are kept.",
    },
  ),
  PROCEDURE_CANCELLED: wa(
    "B",
    [...PROCEDURE_GENERIC_TYPES, ...CLOSABLE_ONLY(PROCEDURE_GENERIC_TYPES)],
    "Cancellation of a proceeding; also the closure of a procedural object by withdrawal or cancellation (L-05).",
    "إلغاء الإجراء؛ وإقفال كائن إجرائي بالسحب أو الإلغاء (L-05).",
    `${CONTRACTS}:1181-1184; work/LEAD_notes.md L-05`,
    {
      secondary_types: CLOSABLE_ONLY(PROCEDURE_GENERIC_TYPES),
      closes: "TARGET_ELSE_OBJECT",
      note: "closes payload.target when present, else event.object (L-05); moves a status only where a W-A table names it.",
    },
  ),
  PROCEDURE_FAILED: wa(
    "B",
    ["PROCEDURE", "INVESTIGATION"],
    "The proceeding could not be completed (charter ProcedureStatus FAILED; no platform equivalent).",
    "تعذر إتمام الإجراء (FAILED في الميثاق؛ لا مقابل له في المنصة).",
    "CHARTER.md §3.4",
  ),

  // ---- Domain B — investigation, statements, information requests, tasks ---------------------------------
  INVESTIGATION_ASSIGNED: cm("B", ["INVESTIGATION"]),
  STATEMENT_REQUESTED: cm("B", ["TASK"]),
  STATEMENT_RECEIVED: cm("B", ["TASK"]),
  INFO_REQUEST_SENT: cm("B", ["TASK"]),
  INFO_RECEIVED: cm("B", ["TASK"]),
  TASK_ASSIGNED: wa(
    "B",
    ["TASK"],
    "Generic task creation.",
    "إنشاء مهمة.",
    `${CONTRACTS}:156-157 (CASE_TASK_STATUSES); review/v12-forensic/work/W3_journeys_review.md:78 (V12 TASK_EVENT families)`,
  ),
  TASK_ACCEPTED: wa(
    "B",
    ["TASK"],
    "Assignee accepted the task.",
    "قبول المكلَّف للمهمة.",
    "CHARTER.md §3.4 (TaskStatus ACCEPTED)",
  ),
  TASK_STARTED: wa(
    "B",
    ["TASK", "IMPLEMENTATION_ACTION"],
    "Work on the task started.",
    "بدء العمل على المهمة.",
    `${CONTRACTS}:156-157 (IN_PROGRESS)`,
  ),
  TASK_SUBMITTED: wa(
    "B",
    ["TASK"],
    "Assignee submitted the output for review.",
    "تقديم المكلَّف للمخرَج للمراجعة.",
    "CHARTER.md §3.4 (TaskStatus SUBMITTED)",
  ),
  TASK_RETURNED: wa(
    "B",
    ["TASK"],
    "Output returned for completion.",
    "إعادة المخرَج للاستكمال.",
    "CHARTER.md §3.4 (TaskStatus RETURNED)",
  ),
  TASK_COMPLETED: wa(
    "B",
    ["TASK"],
    "Task completed by the person entitled to accept it.",
    "اكتمال المهمة ممن يملك قبولها.",
    `${CONTRACTS}:156-157 (COMPLETED)`,
  ),
  TASK_CANCELLED: wa(
    "B",
    ["TASK", "IMPLEMENTATION_ACTION"],
    "Task cancelled.",
    "إلغاء المهمة.",
    `${CONTRACTS}:156-157 (CANCELLED)`,
  ),

  // ---- Domain B — meetings and hearings ------------------------------------------------------------------
  MEETING_SCHEDULED: cm("B", ["MEETING", "HEARING"], {
    note: "scheduling (and the invitation that follows) is never evidence of occurrence",
  }),
  MEETING_RESCHEDULED: cm("B", ["MEETING", "HEARING"]),
  MEETING_CANCELLED: cm("B", ["MEETING", "HEARING"]),
  MEETING_OPENED: cm("B", ["MEETING", "HEARING"]),
  MEETING_CLOSED: cm("B", ["MEETING", "HEARING"]),
  MINUTES_DRAFTED: cm("B", ["MEETING", "HEARING"]),
  MINUTES_UNDER_REVIEW: cm("B", ["MEETING", "HEARING"]),
  MINUTES_CHANGES_REQUESTED: wa(
    "B",
    ["MEETING", "HEARING"],
    "Minutes sent back from review to drafting.",
    "إعادة المحضر من المراجعة إلى التحرير.",
    `${CONTRACTS}:1492-1498 (MINUTES_STATUSES CHANGES_REQUESTED)`,
  ),
  MINUTES_FINAL: cm("B", ["MEETING", "HEARING"], {
    note: "payload.basis ∈ APPROVED | DEEMED_APPROVED (deemed approval is OWNER_DEFAULT, TARGET_WORKFLOW_STATE_MODEL.md §5)",
  }),

  // ---- Domain B — direction, ballot, recommendation, legal review, decision -------------------------------
  CHAIR_DIRECTION_RECORDED: cm("B", ["PROCEDURE"], {
    note: "payload.direction ∈ MEETING | INFO_REQUEST | VOTE | DEFER (charter §3.3). Step evidence only; drives no status. No platform command exists for the direction and its authority is SOURCE_REQUIRED (D8 §6, review/v12-forensic/deliverables/D8_future_state_V13_design.md:73; D6 MF-002).",
  }),
  BALLOT_OPENED: cm("B", ["BALLOT"], {
    secondary_types: ["RECOMMENDATION"],
    note: "payload.target names the voted object (e.g. the recommendation)",
  }),
  BALLOT_CLOSED: cm("B", ["BALLOT"], {
    note: `payload.result ∈ APPROVED | REJECTED | TIED | NO_DECISION | NO_QUORUM (${CONTRACTS}:1490)`,
  }),
  VOTE_CAST: wa(
    "B",
    ["BALLOT"],
    "A member cast a vote. The platform records that a vote was cast, never the choice (ballot secrecy); the type is needed so that the authority evidence VOTE_CAST resolves (L-06).",
    "أدلى عضو بصوته. تسجّل المنصة أن صوتاً أُدلي به ولا تسجّل الخيار أبداً (سرية الاقتراع)؛ ويلزم النوع كي يُحلّ دليل الصلاحية VOTE_CAST (L-06).",
    `${MIGRATIONS}20261007001890_committee_meetings_votes_minutes.sql:875-877 (secrecy Q61–Q63; payload {meeting_id}); work/LEAD_notes.md L-06`,
    {
      note: "payload {meeting_id} only: the choice is never in the ledger, a V13 event or a notification (PROTECTED_EVENT_RULES; INV-27). Step evidence; drives no status.",
    },
  ),
  VOTE_RECORDED_FOR_MEMBER: wa(
    "B",
    ["BALLOT"],
    "The secretary records ABSENT, UNABLE_TO_VOTE or RECUSED, with a reason, for a voting member who is not present: an act distinct from casting a vote (L-06).",
    "يسجّل أمين اللجنة «غائب» أو «تعذّر التصويت» أو «متنحٍّ» مع السبب لعضو مصوّت غير حاضر: فعل مستقل عن الإدلاء بالصوت (L-06).",
    `${MIGRATIONS}20261007001890_committee_meetings_votes_minutes.sql:881-912 (values :897; table check :198; payload {meeting_id, participant_id}); work/LEAD_notes.md L-06`,
    {
      note: "payload {meeting_id, participant_id}: the recorded value and its reason stay in the platform record. UNABLE_TO_VOTE is one of its values, not an event. Step evidence; drives no status.",
    },
  ),
  RECOMMENDATION_DRAFTED: wa(
    "B",
    ["RECOMMENDATION"],
    "Creation (or redraft) of a recommendation package.",
    "إنشاء حزمة التوصية أو إعادة صياغتها.",
    `${CONTRACTS}:1524-1533 (RECOMMENDATION_PACKAGE_STATUSES DRAFT)`,
  ),
  RECOMMENDATION_ADOPTED: cm("B", ["RECOMMENDATION"]),
  RECOMMENDATION_NOT_ADOPTED: wa(
    "B",
    ["RECOMMENDATION"],
    "A vote that does not adopt (rejected, tied without casting vote, no decision, no quorum) needs evidence distinct from adoption.",
    "التصويت الذي لا ينتهي بالاعتماد يحتاج دليلاً مستقلاً عن الاعتماد.",
    `${CONTRACTS}:1490 (VOTE_RESULTS)`,
  ),
  RECOMMENDATION_RETURNED: cm("B", ["RECOMMENDATION"], {
    note: "legal CONFLICTS → RETURNED_BY_LEGAL; authority RETURN_TO_COMMITTEE → RETURNED_BY_AUTHORITY (TARGET_WORKFLOW_STATE_MODEL.md §3.3, §3.6)",
  }),
  RECOMMENDATION_SUPERSEDED: wa(
    "B",
    ["RECOMMENDATION"],
    "DecisionStatus SUPERSEDED for a recommendation replaced by a new package.",
    "حالة «حلّ محلها غيرها» لتوصية استُبدلت بحزمة جديدة.",
    "CHARTER.md §3.4",
  ),
  LEGAL_REVIEW_REQUESTED: cm("B", ["LEGAL_OPINION"]),
  LEGAL_OPINION_SUBMITTED: cm("B", ["LEGAL_OPINION"], {
    note: `payload.opinion ∈ CONCURS | CONCURS_WITH_COMMENTS | CONFLICTS (${CONTRACTS}:1538)`,
  }),
  PACKAGE_SUBMITTED_TO_AUTHORITY: cm("B", ["RECOMMENDATION"], {
    secondary_types: ["DECISION"],
    note: "payload.related names the DECISION object it opens (awaiting the authority)",
  }),
  AUTHORITY_DECISION_RECORDED: cm("B", ["DECISION"], {
    secondary_types: ["RECOMMENDATION"],
    note: `payload.outcome ∈ AUTHORITY_OUTCOMES (${CONTRACTS}:1542-1549); payload.performed_by = the deciding capacity (the actor is whoever recorded it); payload.source_document_ref required for effectiveness (${TDM} §2 AuthorityDecision)`,
  }),
  DECISION_NOTICE_ISSUED: cm("B", ["DECISION"], {
    note: "the procedural notice of the decision (تبليغ القرار): step evidence on the DECISION; never the decision itself and never a platform notification",
  }),
  DECISION_NOTICE_DELIVERED: cm("B", ["DECISION"], { note: "step evidence; drives no status" }),
  DECISION_SUPERSEDED: wa(
    "B",
    ["DECISION"],
    "DecisionStatus SUPERSEDED for a decision modified or cancelled later (e.g. a grievance outcome).",
    "حالة «حلّ محله غيره» لقرار عُدّل أو أُلغي لاحقاً (مثل مآل تظلم).",
    `${CONTRACTS}:1581-1593 (GRIEVANCE_OUTCOMES MODIFY, CANCEL)`,
  ),
  GRIEVANCE_WINDOW_STARTED: cm("B", ["DECISION"], {
    note: "deadline basis event only; the basis (issue / delivery / acknowledgement) is per rule set and not yet decided (D6 MF-017)",
  }),
  GRIEVANCE_RECEIVED: cm("B", ["PROCEDURE"], {
    note: "also records the registration of the grievance (work/LEAD_notes.md L-05: W-C GRIEVANCE_REGISTERED replaced by this type)",
  }),
  GRIEVANCE_ADMISSIBILITY_DECIDED: wa(
    "B",
    ["PROCEDURE"],
    "The admissibility decision on a grievance by its designated decider is its own platform audit event; the type is needed so that the authority evidence resolves (L-06).",
    "قرار قبول التظلم شكلاً ممن أُسند إليه حدث تدقيق مستقل في المنصة؛ ويلزم النوع كي يُحلّ دليل الصلاحية (L-06).",
    `${MIGRATIONS}20261007001910_employee_defence_grievance.sql:1065-1066; ${MIGRATIONS}20261007002098_grievance_admissibility_restricted_decider.sql:77-79 (payload {decision, decider}); work/LEAD_notes.md L-06`,
    {
      note: "payload {decision, decider}; the reason stays in the platform record. Step evidence on the grievance proceeding; drives no status (GRIEVANCE_STATUSES ADMITTED / INADMISSIBLE kept as outcome).",
    },
  ),

  // ---- Domain B — implementation actions -------------------------------------------------------------------
  ACTION_ASSIGNED: cm("B", ["IMPLEMENTATION_ACTION"]),
  ACTION_COMPLETED: cm("B", ["IMPLEMENTATION_ACTION"], {
    note: "the owner declares completion with evidence → SUBMITTED (platform PENDING_VERIFICATION); never COMPLETED by itself",
  }),
  ACTION_VERIFIED: cm("B", ["IMPLEMENTATION_ACTION"]),
  ACTION_RETURNED: wa(
    "B",
    ["IMPLEMENTATION_ACTION"],
    "Verification returned the action to its owner.",
    "أعاد التحقق الإجراء إلى مالكه.",
    `${CONTRACTS}:1830 (VERIFICATION_DECISIONS RETURNED); NOTIFICATION_TEMPLATES CORRECTIVE_ACTION_RETURNED`,
  ),

  // ---- Domain F — notification lifecycle (charter §9) ----------------------------------------------------
  NOTIFICATION_DRAFTED: cm("F", ["NOTIFICATION"]),
  NOTIFICATION_VALIDATED: cm("F", ["NOTIFICATION"]),
  NOTIFICATION_AUTHORIZATION_REQUESTED: wa(
    "F",
    ["NOTIFICATION"],
    "Charter §9 state AUTHORIZATION_PENDING has no entering event in §3.3.",
    "لا يوجد في الميثاق §3.3 حدث يُدخل الحالة AUTHORIZATION_PENDING المذكورة في §9.",
    "CHARTER.md §9",
  ),
  NOTIFICATION_AUTHORIZED: cm("F", ["NOTIFICATION"]),
  NOTIFICATION_QUEUED: cm("F", ["NOTIFICATION"]),
  NOTIFICATION_SENT: cm("F", ["NOTIFICATION"], {
    note: "payload {channel, attempt, template_code, type_code, subject_object_type, subject_object_id, purpose?} (subject_object_id: L-05 contract addition). Also the reminder event (L-05: W-C REMINDER_ISSUED → NOTIFICATION_SENT {template_code, purpose}). A communication event: it never drives a procedural status (FD-06, FD-12). EMAIL: handed to the sender; delivery not confirmed (L-07).",
  }),
  DELIVERY_CONFIRMED: cm("F", ["NOTIFICATION"], {
    note: "payload.evidence_kind ∈ DELIVERY_EVIDENCE_KINDS: IN_APP_ROW_CREATED (IN_APP, L-02) · PROVIDER_DELIVERY_REPORT (EMAIL, L-07; no platform report today) · SENDER_ADAPTER_REPORTED_SUCCESS (EMAIL under the explicit SETTLEMENT reading only)",
  }),
  DELIVERY_FAILED: cm("F", ["NOTIFICATION"], {
    note: "payload.evidence_kind OUTBOX_ATTEMPTS_EXHAUSTED (after the last attempt; L-07)",
  }),
  NOTIFICATION_CANCELLED: cm("F", ["NOTIFICATION"]),
  NOTIFICATION_CORRECTED: cm("F", ["NOTIFICATION"], {
    note: "entry event of the correcting version n+1 (work/LEAD_notes.md L-04 item 1): recorded on version n+1 with payload {from: null, to: CORRECTED, corrects_version: n (< version), corrected_status, reason_code}; version n does not change at that moment",
  }),
  NOTIFICATION_SUPERSEDED: cm("F", ["NOTIFICATION"], {
    note: "recorded on version n in the same step as version n+1 reaches SENT (L-04 item 2): payload {from, to: SUPERSEDED, successor_version (> version), reason_code}; occurred_at = the successor's SENT; causation_id = that SENT event",
  }),
  RECIPIENT_ACKNOWLEDGED: cm("F", ["NOTIFICATION"], {
    note: "an act of the recipient; never a delivery status (charter §3.4)",
  }),
  NOTIFICATION_EXPORTED: wa(
    "F",
    ["NOTIFICATION"],
    'An export (EML/HTML/JSON file) is a recorded artefact and never a delivery; it must exist as a type so that "export ≠ delivery" can be tested.',
    "التصدير (ملف EML/HTML/JSON) أثر مسجّل وليس تسليماً؛ ويلزم وجوده نوعاً كي يُختبر أن «التصدير ≠ التسليم».",
    'CHARTER.md §8 PC-15; review/v12-forensic/deliverables/D3_architecture_reconstruction.md:28 (.eml download, manual "sent")',
  ),
  NOTIFICATION_SUPPRESSED: wa(
    "F",
    ["NOTIFICATION"],
    "When the correcting version n+1 is created, pending outbox retries of version n are suppressed so that a known-wrong text is never re-sent; the record of that suppression drives no status.",
    "عند إنشاء الإصدار المصحِّح n+1 تُوقَف محاولات الإعادة المعلّقة للإصدار n كي لا يُعاد إرسال نص ثبت خطؤه؛ ولا يحرّك سجل الإيقاف أي حالة.",
    "work/LEAD_notes.md L-04 item 3; W-D1 src/lifecycle/notification.js AUDIT_ONLY_ACTIONS (ledger type NOTIFICATION_SUPPRESSED, payload {reason_code, outbox_status, attempts, gap})",
    {
      note: "drives no status: version n keeps its state. After a cancelled correction the suppressed retries stay suppressed (manual follow-up, no automatic re-send; accepted by the coordinator, 27 Oct).",
    },
  ),
  DELIVERY_ATTEMPTED: wa(
    "F",
    ["DELIVERY_ATTEMPT"],
    "Per-attempt DeliveryStatus (charter §3.4) needs events; the platform keeps an attempts counter only.",
    "حالة التسليم لكل محاولة تحتاج أحداثاً؛ والمنصة تحفظ عدّاداً للمحاولات فقط.",
    `CHARTER.md §3.4; ${MIG1920}:119, 588-593`,
    {
      note: "work/LEAD_notes.md L-07 (D5): in the V13 lifecycle (W-D1) attempts are evidence entries (kind DELIVERY_ATTEMPT, data.status ∈ DeliveryStatus), not ledger events; these four types remain the DeliveryStatus vocabulary of an adapter that reports attempts as events. INV-22 reads both.",
    },
  ),
  DELIVERY_ACCEPTED_BY_PROVIDER: wa(
    "F",
    ["DELIVERY_ATTEMPT"],
    "The channel transport (mail relay or in-app inbox) accepted the attempt; not a confirmation of delivery by itself.",
    "قبول ناقل القناة للمحاولة؛ وليس تأكيداً للتسليم بذاته.",
    `CHARTER.md §3.4; ${MIG1920}:598-615`,
  ),
  DELIVERY_ATTEMPT_FAILED: wa(
    "F",
    ["DELIVERY_ATTEMPT"],
    "One attempt failed (retry possible); distinct from the notification-level DELIVERY_FAILED after exhaustion.",
    "فشل محاولة واحدة (مع إمكان الإعادة)؛ ويختلف عن DELIVERY_FAILED على مستوى الإشعار بعد استنفاد المحاولات.",
    `CHARTER.md §9 (retry policy); ${MIG1920}:609`,
  ),
  DELIVERY_BOUNCED: wa(
    "F",
    ["DELIVERY_ATTEMPT"],
    "An accepted attempt bounced later.",
    "ارتداد محاولة سبق قبولها.",
    "CHARTER.md §3.4 (BOUNCED)",
  ),

  // ---- Domain B — the 58 step-evidence types proposed by W-C, adopted by the lead (L-05 item 2) ------------------------
  ...WC_ADOPTED,
});

/** The full enum, charter minimum first (charter order), then W-A additions (catalogue order). */
const CHARTER_MINIMUM: readonly string[] = EVENT_TYPES_CHARTER_MINIMUM;
/** The catalogue entry of a type of EVENT_TYPES (always present: EVENT_TYPES is built from the catalogue keys). */
const entryOf = (t: string): EventCatalogueEntry => EVENT_CATALOGUE[t] as EventCatalogueEntry;
export const EVENT_TYPES: readonly string[] = Object.freeze([
  ...EVENT_TYPES_CHARTER_MINIMUM,
  ...Object.keys(EVENT_CATALOGUE).filter((t) => !CHARTER_MINIMUM.includes(t)),
]);
export const EVENT_TYPE_ADDITIONS: readonly string[] = Object.freeze(
  EVENT_TYPES.filter((t) => entryOf(t).origin === "W-A_ADDITION"),
);

/** Communication events (Domain F): they describe the notification, never procedural reality. */
export const COMMUNICATION_EVENTS: readonly string[] = Object.freeze(
  EVENT_TYPES.filter((t) => entryOf(t).domain === "F"),
);
export const CASE_EVENTS: readonly string[] = Object.freeze(
  EVENT_TYPES.filter((t) => entryOf(t).domain === "A"),
);
export const PROCEDURAL_EVENTS: readonly string[] = Object.freeze(
  EVENT_TYPES.filter((t) => entryOf(t).domain === "B"),
);
/** Events that move CaseStatus.code. */
export const CASE_CODE_EVENTS: readonly string[] = Object.freeze([
  "CASE_REGISTERED",
  "CASE_STATUS_RECORDED",
] as const);

export function isKnownEventType(type: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(EVENT_CATALOGUE, type as PropertyKey);
}
/** Evidence and audit events (Domain G): audit facts, never procedural or communication events. */
export const AUDIT_EVENTS: readonly string[] = Object.freeze(
  EVENT_TYPES.filter((t) => entryOf(t).domain === "G"),
);
/** The step-evidence types adopted from W-C (L-05 item 2). */
export const WC_ADOPTED_EVENT_TYPES: readonly string[] = Object.freeze(Object.keys(WC_ADOPTED));

/**
 * Formal notices issued by their own platform command (work/LEAD_notes.md L-05, G-06): procedural acts recorded as
 * domain events, distinct from notify.* notifications (a sentence and a link). Service or acknowledgement of a formal
 * notice stays a domain record (L-02). A formal notice is never caused by a communication event (INV-08).
 */
export interface FormalNoticeRule {
  readonly label: Label;
  readonly source: string;
  readonly platform: string;
}
export const FORMAL_NOTICE_EVENTS: Readonly<Record<string, FormalNoticeRule>> = Object.freeze({
  RIGHTS_NOTICE_ISSUED: Object.freeze({
    label: "FACT",
    source: "work/LEAD_notes.md L-05 (G-06)",
    platform: `${MIGRATIONS}20261007001990_employee_notice_kinds.sql:179`,
  }),
  DEFENCE_NOTICE_ISSUED: Object.freeze({
    label: "FACT",
    source: "work/LEAD_notes.md L-05 (G-06)",
    platform: `${MIGRATIONS}20261007001910_employee_defence_grievance.sql:674`,
  }),
  DEFENCE_PACKET_RELEASED: Object.freeze({
    label: "FACT",
    source: "work/LEAD_notes.md L-05 (G-06)",
    platform: "CF-23c register (W-C #16; BUILT per W-C, not re-read by W-A)",
  }),
  ALLEGATIONS_NOTIFIED: Object.freeze({
    label: "FACT",
    source: "work/LEAD_notes.md L-05 (G-06)",
    platform: "UNVERIFIED (W-C #6: V12 INV-06 ALLEGATION_NOTICE)",
  }),
  AUTHORISED_OUTCOME_COMMUNICATED: Object.freeze({
    label: "FACT",
    source: "work/LEAD_notes.md L-05 (G-06)",
    platform: "NOT BUILT; channel SOURCE_REQUIRED (W-C #7)",
  }),
  DECISION_NOTICE_ISSUED: Object.freeze({
    label: "INFERENCE",
    source:
      "charter §3.3 minimum type, the procedural notice of the decision (تبليغ القرار): the same kind as the five named in L-05 G-06",
    platform: `${MIGRATIONS}20261007001990_employee_notice_kinds.sql:219`,
  }),
});

/**
 * Payload rules for protected events. `allowed_keys` (when set): the only payload keys; `forbidden_keys`: keys that
 * never appear; `never_in_notification`: the event is never cited by, never causes and is never named in a
 * notification (INV-27).
 */
export interface ProtectedEventRule {
  readonly allowed_keys: readonly string[] | null;
  readonly forbidden_keys: readonly string[];
  readonly never_in_notification: boolean;
  readonly label: Label;
  readonly source: string;
}
export const PROTECTED_EVENT_RULES: Readonly<Record<string, ProtectedEventRule>> = Object.freeze({
  REPORTER_IDENTITY_REVEALED: Object.freeze({
    allowed_keys: Object.freeze(["reveal_request_id"]),
    forbidden_keys: Object.freeze([]),
    never_in_notification: true,
    label: "FACT",
    source: `work/LEAD_notes.md L-06 ("stays ids-only and never appears in a notification"); ${MIGRATIONS}20261007000700_api_commands.sql:799-801; cdf_case_management/CLAUDE.md security rules (protocol §22)`,
  }),
  VOTE_CAST: Object.freeze({
    allowed_keys: null,
    forbidden_keys: Object.freeze(["choice"]),
    never_in_notification: false,
    label: "FACT",
    source: `${MIGRATIONS}20261007001890_committee_meetings_votes_minutes.sql:875 ("the ledger records that a vote was cast, never the choice"); src/authority/authority_v13.json CAST_VOTE ("choice never in the ledger or a notification")`,
  }),
  VOTE_RECORDED_FOR_MEMBER: Object.freeze({
    allowed_keys: null,
    forbidden_keys: Object.freeze(["choice", "reason"]),
    never_in_notification: false,
    label: "INFERENCE",
    source: `${MIGRATIONS}20261007001890_committee_meetings_votes_minutes.sql:911-912 (the audit payload carries {meeting_id, participant_id} only)`,
  }),
  COI_DECIDED: Object.freeze({
    allowed_keys: null,
    forbidden_keys: Object.freeze(["reason", "reasons"]),
    never_in_notification: false,
    label: "PROPOSAL",
    source:
      "W-A: the grounds of a conflict decision stay in the platform record (cdf_case_management/CLAUDE.md: notifications carry no investigation content, protocol §39)",
  }),
});

/**
 * E-mail delivery confirmation (work/LEAD_notes.md L-07, closes W-A gap G-08). ACCEPTANCE (default, aligned to W-B
 * V13-03 §8): a sender success is DELIVERY_ACCEPTED_BY_PROVIDER and the notification stays SENT; DELIVERY_CONFIRMED needs
 * a provider delivery report. SETTLEMENT (charter §9 read literally) is explicit configuration, to be switched only on
 * evidence that the CDF mail relay's success means delivery (SOURCE_REQUIRED; PRODUCTION_SUBSTITUTION_REQUIRED at W-B
 * S3/S8). IN_APP: SENT and DELIVERY_CONFIRMED coincide (L-02).
 */
export const DELIVERY_CONFIRMATION_MODES = Object.freeze(["ACCEPTANCE", "SETTLEMENT"] as const);
export type DeliveryConfirmationMode = (typeof DELIVERY_CONFIRMATION_MODES)[number];
export const DEFAULT_DELIVERY_CONFIRMATION: DeliveryConfirmationMode = "ACCEPTANCE";
/** Is `mode` one of DELIVERY_CONFIRMATION_MODES? */
export const isDeliveryConfirmationMode = (mode: unknown): mode is DeliveryConfirmationMode =>
  (DELIVERY_CONFIRMATION_MODES as readonly unknown[]).includes(mode);
/** DELIVERY_CONFIRMED.payload.evidence_kind values: the channel and the readings under which each confirms delivery. */
export interface DeliveryEvidenceKind {
  readonly channel: "IN_APP" | "EMAIL";
  readonly modes: readonly DeliveryConfirmationMode[];
  readonly label: Label;
  readonly source: string;
}
export const DELIVERY_EVIDENCE_KINDS: Readonly<Record<string, DeliveryEvidenceKind>> = Object.freeze({
  IN_APP_ROW_CREATED: Object.freeze({
    channel: "IN_APP",
    modes: Object.freeze(["ACCEPTANCE", "SETTLEMENT"] as const),
    label: "FACT",
    source:
      'work/LEAD_notes.md L-07 ("IN_APP follows L-02"), L-02 (the committed outbox row; SENT and DELIVERY_CONFIRMED coincide); W-D1 src/lifecycle/notification.js (IN_APP DELIVERY_CONFIRMED evidence_kind)',
  }),
  PROVIDER_DELIVERY_REPORT: Object.freeze({
    channel: "EMAIL",
    modes: Object.freeze(["ACCEPTANCE", "SETTLEMENT"] as const),
    label: "PROPOSAL",
    source:
      'work/LEAD_notes.md L-07 ("needs a provider delivery report"); the name is W-A\'s proposal. No platform delivery report exists today: UNVERIFIED, PRODUCTION_SUBSTITUTION_REQUIRED (W-B S3/S8)',
  }),
  SENDER_ADAPTER_REPORTED_SUCCESS: Object.freeze({
    channel: "EMAIL",
    modes: Object.freeze(["SETTLEMENT"] as const),
    label: "FACT",
    source:
      "work/LEAD_notes.md L-07 (SETTLEMENT explicit, non-default); W-D1 src/lifecycle/notification.js (SETTLEMENT evidence_kind)",
  }),
});

/**
 * Platform names (FACT with file:line in the platform repository, read-only) and the V13 event type each corresponds to
 * (INFERENCE). `kind`: AUDIT_EVENT (an audit.record_event name), TEMPLATE_CODE (a notify.enqueue template: an outbox row,
 * whose certainty ceiling is NOTIFICATION_QUEUED) or VALUE (a value of a platform record). `when` = the payload
 * condition; `mode` = the delivery-confirmation reading the row holds under (L-07); `v13_payload` = what the V13 event
 * carries to say the same. `v13: null` = no V13 type (gap, named in the note). Used by toV13EventType (L-06), the mock
 * adapters (W-D1) and the integration contracts (W-B); platform names are never V13 types themselves.
 */
const MIG = MIGRATIONS;
/** One row of PLATFORM_AUDIT_EVENT_MAP. */
export interface PlatformAuditMapping {
  readonly platform: string;
  readonly kind: "AUDIT_EVENT" | "TEMPLATE_CODE" | "VALUE";
  readonly ref: string;
  readonly v13: string | null;
  readonly when: Guard | null;
  readonly mode: DeliveryConfirmationMode | null;
  readonly v13_payload: Readonly<Record<string, unknown>> | null;
  readonly label: "INFERENCE";
  readonly note: string | null;
}
interface PlatformAuditExtra {
  kind?: PlatformAuditMapping["kind"];
  when?: Guard;
  mode?: DeliveryConfirmationMode;
  v13_payload?: Record<string, unknown>;
  note?: string;
}
const pa = (
  platform: string,
  ref: string,
  v13: string | null,
  extra: PlatformAuditExtra = {},
): PlatformAuditMapping =>
  Object.freeze({
    platform,
    kind: extra.kind || "AUDIT_EVENT",
    ref: MIG + ref,
    v13,
    when: extra.when ? Object.freeze(extra.when) : null,
    mode: extra.mode || null,
    v13_payload: extra.v13_payload ? Object.freeze(extra.v13_payload) : null,
    label: "INFERENCE" as const,
    note: extra.note || null,
  });
export const PLATFORM_AUDIT_EVENT_MAP: readonly PlatformAuditMapping[] = Object.freeze([
  pa("MEETING_SCHEDULED", "20261007001890_committee_meetings_votes_minutes.sql:562", "MEETING_SCHEDULED"),
  pa("MEETING_OPENED", "20261007001890_committee_meetings_votes_minutes.sql:710", "MEETING_OPENED"),
  pa("MEETING_CLOSED", "20261007001890_committee_meetings_votes_minutes.sql:770", "MEETING_CLOSED"),
  pa("MEETING_CANCELLED", "20261007001890_committee_meetings_votes_minutes.sql:789", "MEETING_CANCELLED"),
  pa("VOTE_OPENED", "20261007001890_committee_meetings_votes_minutes.sql:824", "BALLOT_OPENED"),
  pa("VOTE_CLOSED", "20261007001890_committee_meetings_votes_minutes.sql:1015", "BALLOT_CLOSED"),
  pa(
    "MINUTES_GENERATED",
    "20261007001890_committee_meetings_votes_minutes.sql:1165",
    "MINUTES_UNDER_REVIEW",
    { when: { path: "payload.status", eq: "IN_REVIEW" } },
  ),
  pa("MINUTES_GENERATED", "20261007001890_committee_meetings_votes_minutes.sql:1165", "MINUTES_FINAL", {
    when: { path: "payload.status", eq: "APPROVED" },
  }),
  pa(
    "MINUTES_REVIEWED",
    "20261007001890_committee_meetings_votes_minutes.sql:1205",
    "MINUTES_CHANGES_REQUESTED",
    { when: { path: "payload.status", eq: "CHANGES_REQUESTED" } },
  ),
  pa("MINUTES_REVIEWED", "20261007001890_committee_meetings_votes_minutes.sql:1205", "MINUTES_FINAL", {
    when: { path: "payload.status", eq: "APPROVED" },
  }),
  pa("MINUTES_DEEMED_APPROVED", "20261007001890_committee_meetings_votes_minutes.sql:1257", "MINUTES_FINAL", {
    note: "payload.basis DEEMED_APPROVED (OWNER_DEFAULT rule)",
  }),
  pa(
    "RECOMMENDATION_PACKAGE_CREATED",
    "20261007001900_recommendations_legal_review_authority.sql:671",
    "RECOMMENDATION_DRAFTED",
  ),
  pa(
    "RECOMMENDATION_PACKAGE_SUBMITTED_FOR_VOTE",
    "20261007001900_recommendations_legal_review_authority.sql:798",
    "PACKAGE_SUBMITTED_FOR_VOTE",
    {
      note: "a requested vote: api.submit_package_for_vote (:774) sets the package VOTING (:795), but the vote opens only with RECOMMENDATION_PACKAGE_VOTE_OPENED (:841, which requires VOTING, :822); work/owner_messages_2026-10-27/master_execution_directive_en_16-08-26Z.txt:370; FD-05, FI-17",
    },
  ),
  pa(
    "RECOMMENDATION_PACKAGE_VOTE_OPENED",
    "20261007001900_recommendations_legal_review_authority.sql:841",
    "BALLOT_OPENED",
    { note: "payload.target = the package (RECOMMENDATION)" },
  ),
  pa(
    "RECOMMENDATION_PACKAGE_ADOPTED",
    "20261007001900_recommendations_legal_review_authority.sql:887",
    "RECOMMENDATION_ADOPTED",
  ),
  pa(
    "RECOMMENDATION_PACKAGE_NOT_ADOPTED",
    "20261007001900_recommendations_legal_review_authority.sql:887",
    "RECOMMENDATION_NOT_ADOPTED",
    { note: "the platform sets the package back to DRAFT" },
  ),
  pa(
    "LEGAL_REVIEW_REQUESTED",
    "20261007001900_recommendations_legal_review_authority.sql:985",
    "LEGAL_REVIEW_REQUESTED",
  ),
  pa(
    "LEGAL_OPINION_GIVEN",
    "20261007001900_recommendations_legal_review_authority.sql:1096",
    "LEGAL_OPINION_SUBMITTED",
  ),
  pa(
    "RECOMMENDATION_PACKAGE_SUBMITTED_TO_AUTHORITY",
    "20261007001900_recommendations_legal_review_authority.sql:1146",
    "PACKAGE_SUBMITTED_TO_AUTHORITY",
  ),
  pa(
    "AUTHORITY_DECISION_RECORDED",
    "20261007001900_recommendations_legal_review_authority.sql:1226",
    "AUTHORITY_DECISION_RECORDED",
  ),
  pa("RIGHTS_NOTICE_ISSUED", "20261007001990_employee_notice_kinds.sql:179", "RIGHTS_NOTICE_ISSUED", {
    note: "formal notice, a domain event distinct from notify.* (L-05 G-06); mapped 1:1 (L-05); payload {subject_id, sequence_no, allegations}",
  }),
  pa("DECISION_NOTICE_ISSUED", "20261007001990_employee_notice_kinds.sql:219", "DECISION_NOTICE_ISSUED"),
  pa("GRIEVANCE_FILED", "20261007001990_employee_notice_kinds.sql:260", "GRIEVANCE_RECEIVED"),
  pa("NOTIFICATION_DELIVERY", "20261007001920_notification_engine.sql:612", "DELIVERY_ACCEPTED_BY_PROVIDER", {
    when: { path: "payload.status", eq: "SENT" },
    mode: "ACCEPTANCE",
    note: "EMAIL outcome SUCCESS = the sender returned success: acceptance by the provider, and the notification stays SENT (L-07 default, aligned to W-B V13-03 §8). In W-D1 it is a DELIVERY_ATTEMPT evidence entry ACCEPTED_BY_PROVIDER (D5). DELIVERY_CONFIRMED needs a provider delivery report: none in the platform (UNVERIFIED; PRODUCTION_SUBSTITUTION_REQUIRED). Closes gap G-08.",
  }),
  pa("NOTIFICATION_DELIVERY", "20261007001920_notification_engine.sql:612", "DELIVERY_CONFIRMED", {
    when: { path: "payload.status", eq: "SENT" },
    mode: "SETTLEMENT",
    note: "only under the explicit, non-default SETTLEMENT configuration (charter §9 read literally; L-07): DELIVERY_CONFIRMED with evidence_kind SENDER_ADAPTER_REPORTED_SUCCESS",
  }),
  pa("NOTIFICATION_DELIVERY", "20261007001920_notification_engine.sql:612", "DELIVERY_FAILED", {
    when: { path: "payload.status", eq: "FAILED" },
    note: "after the fifth attempt",
  }),
  pa("NOTIFICATION_DELIVERY", "20261007001920_notification_engine.sql:612", "DELIVERY_ATTEMPT_FAILED", {
    when: { path: "payload.status", eq: "PENDING" },
    note: "a failed attempt left PENDING for retry",
  }),
  // L-06: the eight platform names of src/authority/authority_v13.json evidence_required that had no V13 type
  pa("VOTE_CAST", "20261007001890_committee_meetings_votes_minutes.sql:876", "VOTE_CAST", {
    note: "payload {meeting_id}; never the choice (:875)",
  }),
  pa(
    "VOTE_RECORDED_FOR_MEMBER",
    "20261007001890_committee_meetings_votes_minutes.sql:911",
    "VOTE_RECORDED_FOR_MEMBER",
    { note: "payload {meeting_id, participant_id}" },
  ),
  pa(
    "UNABLE_TO_VOTE",
    "20261007001890_committee_meetings_votes_minutes.sql:897",
    "VOTE_RECORDED_FOR_MEMBER",
    {
      kind: "VALUE",
      note: "a value the secretary records (ABSENT | UNABLE_TO_VOTE | RECUSED, :897; table check :198); its evidence is VOTE_RECORDED_FOR_MEMBER; the value stays in the platform record",
    },
  ),
  pa("DEFENCE_NOTICE_ISSUED", "20261007001910_employee_defence_grievance.sql:674", "DEFENCE_NOTICE_ISSUED", {
    note: "formal notice (L-05 G-06); mapped 1:1 (L-05); payload {subject_id, sequence_no, allegations, due_at}",
  }),
  pa("DEFENCE_NOTICE_ACKNOWLEDGED", "20261007001910_employee_defence_grievance.sql:712", null, {
    note: "acknowledgement of a formal notice stays a domain record (L-02; L-05 G-06): no V13 event type yet (open item in work/V13-02_notes.md)",
  }),
  pa(
    "GRIEVANCE_ADMISSIBILITY_DECIDED",
    "20261007001910_employee_defence_grievance.sql:1065",
    "GRIEVANCE_ADMISSIBILITY_DECIDED",
    {
      note: "payload {decision, decider}; also 20261007002098_grievance_admissibility_restricted_decider.sql:77",
    },
  ),
  pa("CONFLICT_DECLARED", "20261007000700_api_commands.sql:620", "COI_DECLARATION_RECEIVED", {
    note: "payload {user_id, has_conflict}: one declaration, with or without a conflict (status CONFLICT_DECLARED | NO_CONFLICT, :617); W-C #11",
  }),
  pa(
    "MEETING_INVITEE_ADDED",
    "20261007001890_committee_meetings_votes_minutes.sql:624",
    "PARTICIPANTS_INVITED",
    {
      note: "payload {meeting_id, invitee_role, requires_coi, firewall_restricted}; an invitation never evidences that the meeting took place (FD-06, FI-06)",
    },
  ),
  pa("MEETING_INVITATION", "20261007001920_notification_engine.sql:311", "NOTIFICATION_QUEUED", {
    kind: "TEMPLATE_CODE",
    v13_payload: { template_code: "MEETING_INVITATION" },
    note: "notify.enqueue template: the outbox row is a queued notification (an enqueue proves neither dispatch nor delivery); the invitation itself is MEETING_INVITEE_ADDED → PARTICIPANTS_INVITED",
  }),
  pa("LEGAL_REVIEW_ASSIGNED", "20261007001920_notification_engine.sql:384", "NOTIFICATION_QUEUED", {
    kind: "TEMPLATE_CODE",
    v13_payload: { template_code: "LEGAL_REVIEW_ASSIGNED" },
    note: "notify.enqueue template (an outbox row ⇒ QUEUED at most); the request itself is LEGAL_REVIEW_REQUESTED (1900:985)",
  }),
  pa("REPORTER_IDENTITY_REVEALED", "20261007000700_api_commands.sql:800", "REPORTER_IDENTITY_REVEALED", {
    note: "category SECURITY; payload {reveal_request_id}; identity values are never written to the ledger (:799); ids only and never in a notification (L-06)",
  }),
  // L-10: direct-referral history (intake.referral_event.event_type, 1880:187-190; contracts REFERRAL_EVENT_TYPES :1337-1352),
  // recorded by intake.record_referral_event, whose audit name is 'REFERRAL_' || event_type (1880:566). One platform fact, one V13 type.
  pa(
    "REFERRAL_SECTOR_APPROVED",
    "20261007001880_direct_referral_preliminary_review.sql:875",
    "REFERRAL_HEAD_DECIDED",
    {
      v13_payload: { decision: "APPROVED" },
      note: "the sector head's approval (api.sector_decide_referral APPROVE): SUBMITTED_TO_SECRETARY (L-10)",
    },
  ),
  pa(
    "REFERRAL_SECTOR_RETURNED",
    "20261007001880_direct_referral_preliminary_review.sql:879",
    "REFERRAL_HEAD_DECIDED",
    {
      v13_payload: { decision: "RETURNED" },
      note: "the sector head's return (api.sector_decide_referral RETURN; back to DRAFT): never REFERRAL_RETURNED (L-10)",
    },
  ),
  pa(
    "REFERRAL_RETURNED_FOR_COMPLETION",
    "20261007001880_direct_referral_preliminary_review.sql:968",
    "REFERRAL_RETURNED",
    {
      note: "the secretary's return for completion (api.secretary_decide_referral): the only platform fact REFERRAL_RETURNED stands for (L-10)",
    },
  ),
  pa(
    "REFERRAL_RESUBMITTED",
    "20261007001880_direct_referral_preliminary_review.sql:996",
    "REFERRAL_SUBMITTED",
    {
      v13_payload: { resubmission: true },
      note: "api.resubmit_referral after a rejection; the V13 type REFERRAL_RESUBMITTED is retired (L-10)",
    },
  ),
  pa(
    "SECTOR_APPROVED",
    "20261007001880_direct_referral_preliminary_review.sql:189",
    "REFERRAL_HEAD_DECIDED",
    {
      kind: "VALUE",
      v13_payload: { decision: "APPROVED" },
      note: "intake.referral_event.event_type value (L-10)",
    },
  ),
  pa(
    "SECTOR_RETURNED",
    "20261007001880_direct_referral_preliminary_review.sql:189",
    "REFERRAL_HEAD_DECIDED",
    {
      kind: "VALUE",
      v13_payload: { decision: "RETURNED" },
      note: "intake.referral_event.event_type value: the sector head's return, never REFERRAL_RETURNED (L-10)",
    },
  ),
  pa(
    "RETURNED_FOR_COMPLETION",
    "20261007001880_direct_referral_preliminary_review.sql:190",
    "REFERRAL_RETURNED",
    {
      kind: "VALUE",
      note: "intake.referral_event.event_type value: the secretary's return for completion (L-10)",
    },
  ),
  pa("RESUBMITTED", "20261007001880_direct_referral_preliminary_review.sql:190", "REFERRAL_SUBMITTED", {
    kind: "VALUE",
    v13_payload: { resubmission: true },
    note: "intake.referral_event.event_type value (L-10)",
  }),
]);

/** Reads a dotted path of a plain JSON value (undefined when a step is missing). */
const pathValue = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (isNil(o) ? undefined : (o as Record<string, unknown>)[k]), obj);
/** Options of toV13EventType. */
export interface ToV13Options {
  delivery_confirmation?: string | null;
}
/**
 * toV13EventType(name, payload = null, options = {}) → the V13 event type a name stands for, or null (L-06).
 * Identity for a V13 type; otherwise PLATFORM_AUDIT_EVENT_MAP (audit names, template codes, recorded values) under the
 * delivery-confirmation reading `options.delivery_confirmation` (default ACCEPTANCE, L-07; an unknown reading → null).
 * `payload` (the platform payload) narrows the rows by their `when` condition. Ambiguous or unknown → null: never guessed.
 */
export function toV13EventType(
  name: unknown,
  payload: unknown = null,
  options: ToV13Options | null = {},
): string | null {
  if (typeof name !== "string" || name === "") return null;
  if (isKnownEventType(name)) return name;
  const mode =
    options && !isNil(options.delivery_confirmation)
      ? options.delivery_confirmation
      : DEFAULT_DELIVERY_CONFIRMATION;
  if (!isDeliveryConfirmationMode(mode)) return null;
  let rows = PLATFORM_AUDIT_EVENT_MAP.filter(
    (m) => m.platform === name && m.v13 !== null && (m.mode === null || m.mode === mode),
  );
  if (!isNil(payload))
    rows = rows.filter((m) => !m.when || pathValue({ payload }, m.when.path) === m.when.eq);
  const types = [...new Set(rows.map((m) => m.v13))];
  return types.length === 1 ? (types[0] ?? null) : null;
}

// =====================================================================================================
// Relationship vocabulary
// =====================================================================================================
export const RELATIONSHIP_KINDS = Object.freeze({
  CONTAINS: Object.freeze({ ar: "يحتوي", en: "contains" }),
  PART_OF: Object.freeze({ ar: "جزء من", en: "part of" }),
  ORIGINATES: Object.freeze({ ar: "يُنشئ عند القبول", en: "originates (on acceptance)" }),
  ORIGINATES_FROM: Object.freeze({ ar: "ينشأ عن", en: "originates from" }),
  PRODUCES: Object.freeze({ ar: "يُنتج", en: "produces" }),
  INPUT_TO: Object.freeze({ ar: "مُدخل إلى", en: "input to" }),
  TARGETS: Object.freeze({ ar: "ينصبّ على", en: "targets" }),
  TARGETED_BY: Object.freeze({ ar: "محلٌّ لـ", en: "targeted by" }),
  REVIEWED_BY: Object.freeze({ ar: "يراجعه", en: "reviewed by" }),
  IS_A: Object.freeze({ ar: "نوع من", en: "is a" }),
  ATTEMPT_OF: Object.freeze({ ar: "محاولة لتسليم", en: "attempt of" }),
  OUTCOME_OF: Object.freeze({ ar: "نتيجة لـ", en: "outcome of" }),
  REPRESENTS: Object.freeze({ ar: "يمثّل تواصلياً", en: "represents (communicatively)" }),
  ADDRESSED_TO: Object.freeze({ ar: "موجَّه إلى صفة", en: "addressed to (capacity)" }),
  EVIDENCED_BY: Object.freeze({ ar: "يُثبَت بـ", en: "evidenced by" }),
  GOVERNED_BY: Object.freeze({ ar: "تحكمه صلاحية", en: "governed by" }),
  GOVERNS: Object.freeze({ ar: "يحكم", en: "governs" }),
  ADDRESSEE_OF: Object.freeze({ ar: "صفة المخاطَب في", en: "addressee capacity of" }),
  RESULTS_IN: Object.freeze({ ar: "ينتهي إلى", en: "results in" }),
  NEVER_IMPLIES: Object.freeze({
    ar: "لا يستلزم أبداً (فصل دلالي)",
    en: "never implies (semantic separation)",
  }),
  NEVER_IMPLIED_BY: Object.freeze({
    ar: "لا يُستنتج أبداً من (فصل دلالي)",
    en: "never implied by (semantic separation)",
  }),
} as const);
export type RelationshipKind = keyof typeof RELATIONSHIP_KINDS;

/** The 12 attributes exported per concept (work/V13-02_concepts.csv). */
export const CONCEPT_ATTRIBUTES = Object.freeze([
  "meaning",
  "significance",
  "owner_domain",
  "lifecycle",
  "transitions",
  "relationships",
  "authoritative_source",
  "permitted_actions",
  "authorization",
  "evidence_requirements",
  "disclosure_default",
  "audit",
] as const);
export type ConceptAttribute = (typeof CONCEPT_ATTRIBUTES)[number];

// helpers for transition rows
interface RowExtra {
  when?: Guard;
  label?: Label;
  source?: string;
  note?: string;
}
type OneOrMany<T> = T | readonly T[];
const isList = <T>(x: OneOrMany<T>): x is readonly T[] => Array.isArray(x);
const tr = (
  from: OneOrMany<string | null> | null,
  to: string,
  on: OneOrMany<string>,
  extra: RowExtra = {},
): TransitionRow =>
  Object.freeze({
    from: from === null ? null : Object.freeze(isList(from) ? from : [from]),
    to,
    on: Object.freeze(isList(on) ? on : [on]),
    when: extra.when ? Object.freeze(extra.when) : null,
    label: extra.label || "PROPOSAL",
    source: extra.source || "CHARTER.md §3.4 (enum); transition table W-A",
    note: extra.note || null,
  });
/**
 * A hold row (PROPOSAL, W-A; needed by work/LEAD_notes.md L-10): the event is recorded legitimately from these states and
 * leaves the status unchanged. A hold never leads into a status and is never a status source; applyEvent returns the
 * current status, statusFromEvents lists the event under `held`. Without it, a driving event with no row from the current
 * state is TRANSITION_NOT_ALLOWED (fail closed).
 */
const hold = (from: OneOrMany<string | null>, on: OneOrMany<string>, extra: RowExtra = {}): HoldRow =>
  Object.freeze({
    from: Object.freeze(isList(from) ? from : [from]),
    on: Object.freeze(isList(on) ? on : [on]),
    when: extra.when ? Object.freeze(extra.when) : null,
    hold: true as const,
    label: extra.label || "PROPOSAL",
    source: extra.source || "W-A",
    note: extra.note || null,
  });
/** A relationship of a concept to another concept. */
export interface ConceptRelationship {
  readonly to: string;
  readonly kind: RelationshipKind;
  readonly note: string | null;
}
/** The significance of a concept: bilingual text with its label and source. */
export interface Significance extends Bilingual {
  readonly label: Label;
  readonly source: string;
}
const rel = (to: string, kind: RelationshipKind, note: string | null = null): ConceptRelationship =>
  Object.freeze({ to, kind, note });
const sig = (ar: string, en: string, label: Label, source: string): Significance =>
  Object.freeze({ ar, en, label, source });
const txt = (ar: string, en: string): Bilingual => Object.freeze({ ar, en });

const PS_ACTIVE: readonly string[] = ["OPEN", "IN_PROGRESS"];
const L04 = "work/LEAD_notes.md L-04 (lead decision, binding for V13)";
const L07 = "work/LEAD_notes.md L-07 (lead decision)";
const AUDIT_PLATFORM =
  "Platform: every command writes its audit event in the same transaction (CLAUDE.md §29; append-only ledger). V13: the mock adapter replays synthetic events; V13 never writes procedural events (PRODUCTION_SUBSTITUTION_REQUIRED for the mock).";

// =====================================================================================================
// The 20 concepts
// =====================================================================================================
/** The status-object names of charter §3.4 (status.ts STATUS_OBJECTS keys). */
export type StatusObjectName =
  | "CaseStatus"
  | "ProcedureStatus"
  | "TaskStatus"
  | "MeetingStatus"
  | "DecisionStatus"
  | "NotificationStatus"
  | "DeliveryStatus";
/** A concept of the owner's directive (20 entries, CONCEPT_ATTRIBUTES). */
export interface Concept {
  readonly id: string;
  readonly ar: string;
  readonly en: string;
  readonly meaning: Bilingual;
  readonly significance: Significance;
  readonly owner_domain: OwnerDomain;
  readonly lifecycle: StatusObjectName | "none";
  readonly transitions: readonly TransitionRow[];
  readonly holds?: readonly HoldRow[];
  readonly relationships: readonly ConceptRelationship[];
  readonly authoritative_source: string;
  readonly permitted_actions: readonly string[];
  readonly authorization: string;
  readonly evidence_requirements: string;
  readonly disclosure_default: string;
  readonly audit: string;
}
export const CONCEPTS: readonly Concept[] = Object.freeze<Concept[]>([
  Object.freeze({
    id: "CASE",
    ar: "القضية",
    en: "Case",
    meaning: txt(
      "الوعاء الإجرائي المسجَّل الذي تُنسب إليه البلاغات والإحالات والإجراءات؛ يحمل رمز الحالة المسجَّل في المسار الرئيسي (V8: خمس مراحل و28 حالة فرعية) وأعلام الإيقاف والإعادة والإلغاء وإعادة الفتح والإغلاق.",
      "The registered procedural container to which reports, referrals and proceedings attach; it carries the recorded master-journey code (V8: five stages, 28 sub-states) and the suspended / returned / cancelled / reopened / closed flags.",
    ),
    significance: sig(
      "المصدر الوحيد للمستوى الأول: رمز الحالة المسجَّل وحده يحدد موقع القضية، ولا يحرّكه أي إشعار. وقد طبع V12 موقعاً ثابتاً لكل قالب بدلاً من الموقع المسجَّل.",
      "The only source of Level 1: the recorded code alone fixes the case position, and no notification moves it. V12 printed a fixed per-template position instead of the recorded one.",
      "FACT",
      "CHARTER.md §3.1; review/v12-forensic/deliverables/D6_findings_register.csv:9 (MF-008); review/v12-forensic/work/W3_journeys_review.md:29 (F2)",
    ),
    owner_domain: "A",
    lifecycle: "CaseStatus",
    transitions: Object.freeze([
      tr(null, "S1.01", "CASE_STATUS_RECORDED", {
        label: "FACT",
        source: "review/v12-forensic/work/W3_journeys_review.md:59 (S1.01 is the only entry, in-degree 0)",
      }),
      tr(null, "S1.03", "CASE_REGISTERED", {
        label: "PROPOSAL",
        source: `${TWSM} §3.1 (the platform creates the case on acceptance)`,
        note: "a case record created at registration starts at S1.03",
      }),
      tr(["<V8 code>"], "<V8 code>", ["CASE_STATUS_RECORDED", "CASE_REGISTERED"], {
        label: "FACT",
        source: "notifications/generator/source/tests/v9_data.json transitions[34]",
        note: "only the 34 V8 pairs (status.js V8_TRANSITIONS); a recorded move outside them is shown as recorded and flagged (INV-17), never silently corrected",
      }),
      tr(["flags.suspended=false"], "flags.suspended=true", "CASE_SUSPENDED"),
      tr(["flags.suspended=true"], "flags.suspended=false", "CASE_RESUMED"),
      tr(["flags.returned=false"], "flags.returned=true", "CASE_RETURNED", {
        note: "no clearing event is defined: SOURCE_REQUIRED",
      }),
      tr(["flags.closed=false"], "flags.closed=true", "CASE_CLOSED"),
      tr(["flags.closed=true"], "flags.closed=false", "CASE_REOPENED", {
        note: "sets flags.reopened=true; the code after reopening is SOURCE_REQUIRED (W3 F11)",
      }),
      tr(["flags.cancelled=false"], "flags.cancelled=true", "CASE_CANCELLED"),
    ]),
    relationships: Object.freeze([
      rel("REFERRAL", "ORIGINATES_FROM", "a referral originates the case only when accepted"),
      rel("REPORT", "ORIGINATES_FROM", "a report may lead to a case (outcome CASE_OPENED)"),
      rel("ALLEGATION", "CONTAINS"),
      rel("PROCEDURE", "CONTAINS"),
      rel("EVIDENCE", "EVIDENCED_BY"),
      rel(
        "NOTIFICATION",
        "NEVER_IMPLIED_BY",
        "FD-01: case status / closure never derived from a notification",
      ),
      rel(
        "PROCEDURE",
        "NEVER_IMPLIED_BY",
        "FD-11: V13 never derives the case code from proceeding statuses; it reads the recorded code",
      ),
    ]),
    authoritative_source: `Platform case_mgmt.case_record + case history read through api.* (${TDM} §2 "Case"; CHARTER.md §2 A). V13: caseReadModel.getCase() mock adapter (PRODUCTION_SUBSTITUTION_REQUIRED). The V8 code is not a platform column (INFERENCE: the mock adapter supplies it).`,
    permitted_actions: Object.freeze([
      "REGISTER_CASE",
      "RECORD_CASE_STATUS",
      "SUSPEND_CASE",
      "RESUME_CASE",
      "RETURN_CASE",
      "CLOSE_CASE",
      "CANCEL_CASE",
      "REOPEN_CASE (SOURCE_REQUIRED)",
      "READ_CASE_POSITION (V13: read only)",
    ]),
    authorization:
      "Platform RLS + authz.* case access; PLATFORM_ADMIN / DB_ADMIN never imply case content (CLAUDE.md §21). V13 reads only; no notification writes case state.",
    evidence_requirements:
      "Every code change: CASE_STATUS_RECORDED (or CASE_REGISTERED) with payload {from, to, transition_id}; every flag: its own event; closure: CASE_CLOSED or a status event into S5.05 / S5.06 / S5.07, never caused by a communication event.",
    disclosure_default:
      "PROHIBITED unless policy_v13.json allows (charter §5). Owner decisions: public/scope recipients see Level-1 stage names only; WITNESS sees no Level 1; no case number in e-mail (AMB-181 safe default); DEC-22 hides case numbers on queue reads.",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "REFERRAL",
    ar: "الإحالة",
    en: "Referral",
    meaning: txt(
      "طلب مؤسسي من جهة مُحيلة (قطاع أو إدارة) بعرض موضوع على لجنة التحقيق؛ له مسار إعداد واعتماد وقبول مستقل عن القضية، ولا يُنشئ القضية إلا عند قبوله.",
      "An institutional request from a referring body (sector or department) to put a matter before the Investigation Committee; it has its own preparation, approval and acceptance path and creates the case only on acceptance.",
    ),
    significance: sig(
      "للإحالة مسارها المستقل (إعداد، اعتماد رئيس القطاع، قرار الأمين بالقبول أو الإعادة للاستكمال أو الرفض، الاعتراض والتصعيد)، ولا تُنشأ القضية إلا عند قبولها؛ وقد عرض V12 الإحالة المعادة والمرفوضة تقدّماً إلى الأمام.",
      "The referral has its own path (preparation, sector-head approval, the secretary's acceptance, return for completion or rejection, objection and escalation) and the case is created only on acceptance; V12 rendered returned and rejected referrals as forward progress.",
      "FACT",
      `${TWSM}:55 (§3.1: ACCEPTED → case created); review/v12-forensic/work/W3_journeys_review.md:43 (F16); review/v12-forensic/deliverables/D6_findings_register.csv:35 (MF-034)`,
    ),
    owner_domain: "B",
    lifecycle: "ProcedureStatus",
    transitions: Object.freeze([
      tr(null, "OPEN", "REFERRAL_RECEIVED"),
      tr(null, "OPEN", "REFERRAL_SUBMITTED", {
        source: `${MIGRATIONS}20261007001880_direct_referral_preliminary_review.sql:827-845 (api.submit_referral: SUBMITTED_TO_HEAD); work/LEAD_notes.md L-10`,
        note: "the first submission of a direct referral to the sector head: in preparation (OPEN) until it reaches the secretariat; a draft (REFERRAL_CREATED) has no V13 status",
      }),
      tr("OPEN", "IN_PROGRESS", "PROCEDURE_STARTED"),
      tr("OPEN", "IN_PROGRESS", "REFERRAL_HEAD_DECIDED", {
        when: { path: "payload.decision", eq: "APPROVED" },
        source: `${MIGRATIONS}20261007001880_direct_referral_preliminary_review.sql:870-876 (SECTOR_APPROVED: SUBMITTED_TO_SECRETARY); work/LEAD_notes.md L-10`,
        note: "the sector head approves: the referral reaches the secretariat",
      }),
      tr(PS_ACTIVE, "RETURNED", "REFERRAL_HEAD_DECIDED", {
        when: { path: "payload.decision", eq: "RETURNED" },
        source: `${MIGRATIONS}20261007001880_direct_referral_preliminary_review.sql:877-880 (SECTOR_RETURNED: back to DRAFT); work/LEAD_notes.md L-10`,
        note: "the sector head's return for completion: its own transition, never REFERRAL_RETURNED (L-10)",
      }),
      tr(PS_ACTIVE, "RETURNED", "REFERRAL_RETURNED", {
        source: `${TWSM} §3.1 (RETURNED_FOR_COMPLETION); ${MIGRATIONS}20261007001880_direct_referral_preliminary_review.sql:965-968; work/LEAD_notes.md L-10 (the secretary's return only)`,
      }),
      tr(["RETURNED", "FAILED"], "IN_PROGRESS", "REFERRAL_SUBMITTED", {
        source: `${TWSM} §3.1; work/LEAD_notes.md L-10 (replaces the retired REFERRAL_RESUBMITTED)`,
        note: "a resubmission: the from-state identifies it (L-10). payload.resubmission is true after a rejection (api.resubmit_referral, 1880:981-998); after a return the platform records SUBMITTED (api.submit_referral from RETURNED_FOR_COMPLETION, 1880:838)",
      }),
      tr(PS_ACTIVE, "FAILED", "REFERRAL_REJECTED", {
        source: `${TWSM} §3.1 ("rejection is not final")`,
        note: "FAILED is not terminal: resubmission or objection may follow",
      }),
      tr("FAILED", "IN_PROGRESS", "REFERRAL_OBJECTED", {
        source: `${TWSM} §3.1 (OBJECTED); escalation of a repeated rejection (ESCALATED from REJECTED, 20261007002040_owner_decisions_defence_export_actions.sql:3908-3930) is REFERRAL_OBJECTED {escalated: true} (W-C)`,
      }),
      tr(PS_ACTIVE, "COMPLETED", "REFERRAL_ACCEPTED", {
        source: `${TWSM} §3.1 (ACCEPTED: case created in the same transaction)`,
      }),
      tr(["OPEN", "IN_PROGRESS", "RETURNED", "FAILED"], "CANCELLED", "REFERRAL_WITHDRAWN"),
    ]),
    holds: Object.freeze([
      hold("IN_PROGRESS", "REFERRAL_HEAD_DECIDED", {
        when: { path: "payload.decision", eq: "APPROVED" },
        source: `${MIGRATIONS}20261007001880_direct_referral_preliminary_review.sql:870-876; work/LEAD_notes.md L-10`,
        note: "the sector head approves a resubmitted referral, already IN_PROGRESS by its resubmission (L-10)",
      }),
      hold("IN_PROGRESS", "REFERRAL_RECEIVED", {
        source: "src/journeys/catalogue_v13.json J-DR-SECRETARY/1/3, J-DR-PREPARER/3/1 (W-C)",
        note: "the arrival at the secretariat of a referral the sector head approved: the status moved on the approval",
      }),
    ]),
    relationships: Object.freeze([
      rel("CASE", "ORIGINATES", "only on REFERRAL_ACCEPTED"),
      rel("RECIPIENT_CAPACITY", "ADDRESSED_TO", "REFERRING_BODY"),
      rel("NOTIFICATION", "NEVER_IMPLIED_BY", "an acknowledgement notice does not accept the referral"),
    ]),
    authoritative_source: `Platform intake.referral + intake.referral_event (${TDM} §2 "Referral"; ${TWSM} §3.1; REFERRAL_STATUSES / REFERRAL_EVENT_TYPES ${CONTRACTS}:1322-1352).`,
    permitted_actions: Object.freeze([
      "SUBMIT",
      "SECTOR_APPROVE",
      "SECTOR_RETURN",
      "ACCEPT",
      "RETURN_FOR_COMPLETION",
      "REJECT",
      "RESUBMIT",
      "OBJECT",
      "ESCALATE",
      "WITHDRAW",
      "COMMENT",
    ]),
    authorization: `Preparer: active sector membership; approval: sector head or active delegate (approver ≠ preparer); acceptance / return / rejection: IC secretary on an effective seat (${TWSM} §3.1). Action ids FACT from REFERRAL_ACTIONS ${CONTRACTS}:1357-1372.`,
    evidence_requirements:
      "REFERRAL_SUBMITTED for a submission or a resubmission to the sector head (L-10: the from-state identifies a resubmission); REFERRAL_HEAD_DECIDED {decision} for the sector head's approval or return (L-10); REFERRAL_RECEIVED for receipt; REFERRAL_ACCEPTED (with the case it creates) for acceptance; REFERRAL_RETURNED (the secretary's return for completion only, L-10) / REFERRAL_REJECTED with structured reasons; a draft (REFERRAL_CREATED) and an acknowledgement (REFERRAL_ACKNOWLEDGED) are step evidence only.",
    disclosure_default:
      "REFERRING_BODY: approved referral information only — SOURCE_REQUIRED beyond the acknowledgement (charter §5); no internal case number in e-mail (AMB-181 safe default).",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "REPORT",
    ar: "البلاغ",
    en: "Report",
    meaning: txt(
      "بلاغ مقدَّم عبر قناة الإبلاغ وقد يكون مجهول الهوية؛ يُتابَع برقم البلاغ وسرّ عالي العشوائية، ولا يُعرض على المبلّغ إلا حالات عامة.",
      "A report submitted through the whistleblowing channel, possibly anonymous; followed up with a Report ID and a high-entropy secret, showing the reporter public statuses only.",
    ),
    significance: sig(
      "حالة البلاغ العامة ليست حالة القضية؛ والمبلّغ يتابع عبر البوابة فقط إلى أن يُتخذ قرار (DEC-24)، بينما أنتج V12 مسودات بريد للمبلّغ.",
      "The public report status is not the case status; the reporter follows up through the portal only until decided (DEC-24), whereas V12 produced e-mail drafts for the reporter.",
      "FACT",
      `${CONTRACTS}:38-40 (PUBLIC_REPORT_STATUSES "Never internal workflow state"); review/v12-forensic/deliverables/D6_findings_register.csv:6 (MF-005); CHARTER.md header (DEC-24)`,
    ),
    owner_domain: "B",
    lifecycle: "ProcedureStatus",
    transitions: Object.freeze([
      tr(null, "OPEN", "REPORT_RECEIVED", { source: `${CONTRACTS}:27-36 (RECEIVED)` }),
      tr("OPEN", "IN_PROGRESS", "PROCEDURE_STARTED"),
      tr(PS_ACTIVE, "COMPLETED", "REPORT_CLOSED", {
        source: `${CONTRACTS}:27-36`,
        note: "payload.outcome ∈ CASE_OPENED | REFERRED_OUT | CLOSED_NO_ACTION | DUPLICATE",
      }),
      tr(PS_ACTIVE, "CANCELLED", "PROCEDURE_CANCELLED"),
    ]),
    relationships: Object.freeze([
      rel("CASE", "ORIGINATES", "outcome CASE_OPENED"),
      rel("ALLEGATION", "CONTAINS", "alleged facts as reported (unverified)"),
      rel("RECIPIENT_CAPACITY", "ADDRESSED_TO", "REPORTER (portal only)"),
    ]),
    authoritative_source: `Platform report records and PUBLIC_REPORT_STATUSES (${CONTRACTS}:27-40); anonymous portal per CLAUDE.md §23; protected identity only in protected_identity (CLAUDE.md §22).`,
    permitted_actions: Object.freeze([
      "SUBMIT_REPORT",
      "TRIAGE",
      "REQUEST_INFORMATION",
      "OPEN_CASE",
      "REFER_OUT",
      "CLOSE_NO_ACTION",
      "MARK_DUPLICATE",
    ]),
    authorization: `Reporter: Report ID + high-entropy secret, never revealing whether an ID exists (CLAUDE.md §23); case team through authz.*; reporter identity only via api.resolve_reporter_identity() with permission + case access + justification + audit (CLAUDE.md §22). Triage outcomes FACT from TRIAGE_OUTCOMES ${CONTRACTS}:42-49.`,
    evidence_requirements:
      "REPORT_RECEIVED; REPORT_ACKNOWLEDGED (receipt issued — step evidence); REPORT_CLOSED with its outcome.",
    disclosure_default:
      "REPORTER: public stage names only, portal channel only; e-mail rows PROHIBITED until DEC-24 is decided (charter §5).",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "ALLEGATION",
    ar: "الواقعة المنسوبة (الادعاء)",
    en: "Allegation",
    meaning: txt(
      "واقعة منسوبة إلى طرف محدد ومرتبطة بمرجع سياسة أو نظام؛ لا تثبت بمجرد تسجيلها، ونتيجتها «نتيجة» مستقلة لكل ادعاء ولكل طرف.",
      "A fact alleged against a specific party, linked to a policy or law reference; recording it proves nothing, and its result is a separate Finding per allegation and subject.",
    ),
    significance: sig(
      "الادعاء يبقى ادعاءً حتى تصدر نتيجته لكل طرف، ولا يصل مضمونه إلى أي صفة إلا بقاعدة إفصاح صريحة (الافتراض: محظور)؛ وقد حجبه V12 عن جميع الفئات المرصودة، وأشار إليه دون مضمون عند الطرف المعني.",
      "An allegation remains a claim until its finding per subject exists, and its content reaches a capacity only through an explicit disclosure rule (default PROHIBITED); V12 suppressed it for every observed class and referenced it without content for the case party.",
      "FACT",
      `${TDM} §2 (Allegation, Finding per allegation × subject); CHARTER.md §5 (default PROHIBITED); review/v12-forensic/work/W7_generator_notifications_review.md:139 (row "Allegations": S for every observed class; party: referenced, no content)`,
    ),
    owner_domain: "B",
    lifecycle: "none",
    transitions: Object.freeze([]),
    relationships: Object.freeze([
      rel("CASE", "PART_OF"),
      rel("EVIDENCE", "EVIDENCED_BY", "platform evidence_link → allegation | finding"),
      rel("RECIPIENT_CAPACITY", "TARGETS", "SUBJECT (the person concerned)"),
    ]),
    authoritative_source: `Platform case_mgmt.allegation (+ subject_id, policy/law reference) and case_mgmt.finding (${TDM} §2); FINDING_RESULTS ${CONTRACTS}:1049.`,
    permitted_actions: Object.freeze(["RECORD_ALLEGATION", "LINK_EVIDENCE", "RECORD_FINDING"]),
    authorization:
      "Case team under authz.* with case access; findings by the assigned investigation or committee (platform commands).",
    evidence_requirements:
      "No status: the allegation itself is a recorded claim (UNVERIFIED as to truth); its result exists only as a recorded finding.",
    disclosure_default:
      "PROHIBITED for every external class; internal on need-to-know; SUBJECT receives what procedural rights need (charter §5), never deliberations.",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "PROCEDURE",
    ar: "الإجراء",
    en: "Procedure",
    meaning: txt(
      "إجراء مفتوح على القضية من نوع محدد (مراجعة أولية، تحقيق، تحقيق لجنة، مراجعة نظامية، قرار صاحب الصلاحية، إجراء تصحيحي، تظلم، إعادة تحقيق)، له حالته وسبب انتظاره وسبب إيقافه ومآله.",
      "A proceeding opened on the case, of a given type (preliminary review, investigation, committee investigation, legal review, authority decision, corrective action, grievance, reinvestigation), with its own status, waiting reason, suspension reason and outcome.",
    ),
    significance: sig(
      "الحالة متعددة الأبعاد: حالة الإجراء ليست حالة القضية، والانتظار ليس إيقافاً، والحدث ليس حالة.",
      "Status is multi-dimensional: a proceeding status is not the case status, waiting is not suspension, and an event is not a status.",
      "FACT",
      `${TWSM} §1 (one current value per dimension; "Events … never a status"); v9_data.json substates[S2.02].caution`,
    ),
    owner_domain: "B",
    lifecycle: "ProcedureStatus",
    transitions: Object.freeze([
      tr(null, "NOT_STARTED", [], {
        note: "a declared, not-yet-opened procedure; carries no claim that anything happened",
      }),
      tr([null, "NOT_STARTED"], "OPEN", ["PROCEDURE_OPENED", "GRIEVANCE_RECEIVED"], {
        source: `${CONTRACTS}:1022-1043; ${TWSM} §3.8 (grievance RECEIVED)`,
      }),
      tr("NOT_STARTED", "NOT_APPLICABLE", [], {
        note: "derived from a recorded selection (e.g. a branch not taken); epistemic NOT_APPLICABLE",
      }),
      tr("NOT_STARTED", "CANCELLED", "PROCEDURE_CANCELLED"),
      tr("OPEN", "IN_PROGRESS", "PROCEDURE_STARTED"),
      tr(PS_ACTIVE, "ON_HOLD", "PROCEDURE_SUSPENDED", {
        source: `${CONTRACTS}:1077-1120 (SUSPENSION_REASON)`,
      }),
      tr(["ON_HOLD", "RETURNED", "FAILED"], "IN_PROGRESS", "PROCEDURE_RESUMED"),
      tr(PS_ACTIVE, "RETURNED", "PROCEDURE_RETURNED"),
      tr(PS_ACTIVE, "COMPLETED", "PROCEDURE_COMPLETED", { source: `${CONTRACTS}:1181-1184 (CONCLUDED)` }),
      tr(PS_ACTIVE, "FAILED", "PROCEDURE_FAILED"),
      tr(["OPEN", "IN_PROGRESS", "ON_HOLD", "RETURNED", "FAILED"], "CANCELLED", "PROCEDURE_CANCELLED"),
    ]),
    relationships: Object.freeze([
      rel("CASE", "PART_OF"),
      rel("TASK", "CONTAINS"),
      rel("MEETING", "CONTAINS"),
      rel("BALLOT", "CONTAINS"),
      rel("RECOMMENDATION", "PRODUCES"),
      rel("AUTHORITY", "GOVERNED_BY"),
      rel("BALLOT", "NEVER_IMPLIES", "FD-05: a chair direction recorded on the procedure never opens a vote"),
    ]),
    authoritative_source: `Platform case_mgmt.proceeding (${TDM} §2 "Proceeding"); PROCEEDING_TYPES / PROCEEDING_STATUSES ${CONTRACTS}:1022-1043; api.update_proceeding_state / api.close_proceeding (${CONTRACTS}:1172-1188).`,
    permitted_actions: Object.freeze([
      "OPEN_PROCEEDING",
      "UPDATE_PROCEEDING_STATE",
      "SUSPEND_PROCEEDING",
      "RETURN_PROCEEDING",
      "CLOSE_PROCEEDING",
      "RECORD_CHAIR_DIRECTION (SOURCE_REQUIRED)",
    ]),
    authorization: `Per proceeding type and committee seat (${TWSM} §3); "only one open proceeding of a type per case unless parallel allowed" and "closed is final" (${TDM} §2 Proceeding).`,
    evidence_requirements:
      "Each status: the event that leads into it (status.js evidenceEventsInto); NOT_STARTED / NOT_APPLICABLE need no event and assert nothing happened.",
    disclosure_default:
      "Internal and restricted classes per policy_v13.json; PROHIBITED by default (charter §5).",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "INVESTIGATION",
    ar: "التحقيق",
    en: "Investigation",
    meaning: txt(
      "إجراء تقصٍّ للوقائع يُسند إلى محقق أو فريق بتكليف معتمد، ينتج تقريراً ونتائج ولا ينتج قراراً.",
      "A fact-finding proceeding assigned to an investigator or a team under an approved mandate; it produces a report and findings, never a decision.",
    ),
    significance: sig(
      "تقرير التحقيق مُدخل للتوصية، لا توصية ولا قرار؛ ولا تساوي المسودة توصية أو قراراً.",
      "An investigation report is an input to a recommendation — neither a recommendation nor a decision; a draft equals neither.",
      "FACT",
      `v9_data.json substates[S3.06].caution («لا تساوي المسودة توصية أو قرارًا»); ${TWSM} §4 (INVESTIGATION proceeding)`,
    ),
    owner_domain: "B",
    lifecycle: "ProcedureStatus",
    transitions: Object.freeze([
      tr(null, "NOT_STARTED", []),
      tr([null, "NOT_STARTED"], "OPEN", ["INVESTIGATION_ASSIGNED", "PROCEDURE_OPENED"]),
      tr("OPEN", "IN_PROGRESS", "PROCEDURE_STARTED"),
      tr(PS_ACTIVE, "ON_HOLD", "PROCEDURE_SUSPENDED"),
      tr(["ON_HOLD", "RETURNED", "FAILED"], "IN_PROGRESS", "PROCEDURE_RESUMED"),
      tr(PS_ACTIVE, "RETURNED", "PROCEDURE_RETURNED"),
      tr(PS_ACTIVE, "COMPLETED", "PROCEDURE_COMPLETED"),
      tr(PS_ACTIVE, "FAILED", "PROCEDURE_FAILED"),
      tr(
        ["NOT_STARTED", "OPEN", "IN_PROGRESS", "ON_HOLD", "RETURNED", "FAILED"],
        "CANCELLED",
        "PROCEDURE_CANCELLED",
      ),
    ]),
    relationships: Object.freeze([
      rel("PROCEDURE", "IS_A"),
      rel("ALLEGATION", "TARGETS"),
      rel("TASK", "CONTAINS", "statement and information requests"),
      rel("HEARING", "CONTAINS"),
      rel("EVIDENCE", "EVIDENCED_BY"),
      rel("RECOMMENDATION", "INPUT_TO"),
      rel("DECISION", "NEVER_IMPLIES", "an investigation report never decides"),
    ]),
    authoritative_source: `Platform proceeding of type INVESTIGATION / COMMITTEE_INVESTIGATION (${CONTRACTS}:1022-1031); assignment roles ${CONTRACTS}:51.`,
    permitted_actions: Object.freeze([
      "ASSIGN_INVESTIGATION",
      "REQUEST_STATEMENT",
      "REQUEST_INFORMATION",
      "RECORD_FINDING",
      "SUBMIT_REPORT",
    ]),
    authorization:
      'Assignment requires its approved mandate ("أي تكليف تحقيق يتطلب تفويضه المقرر", v9_data.json substates[S3.01].caution); investigators act under authz.* case assignment.',
    evidence_requirements:
      "INVESTIGATION_ASSIGNED (mandate reference in payload); PROCEDURE_* events for every later status.",
    disclosure_default:
      'Restricted: investigation details only to authorised internal classes (W7 matrix row "Investigation details"); PROHIBITED by default.',
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "TASK",
    ar: "المهمة",
    en: "Task",
    meaning: txt(
      "عمل محدد مُسند إلى صاحب صفة (تقديم إفادة، تقديم مستندات، مراجعة محضر…) له مكلَّف ومهلة بسند؛ وتأخره علامة مشتقة وليست حالة.",
      "A defined piece of work assigned to a capacity (statement, documents, minutes review…) with an assignee and a deadline with a basis; being overdue is a derived flag, not a status.",
    ),
    significance: sig(
      "المهلة تُعرض فقط بحدث أساس مسجَّل وقاعدة مسمّاة، وإلا فالقيمة SOURCE_REQUIRED؛ وقد طبع V12 مهلاً ثابتة بلا سند.",
      "A deadline is displayed only with a recorded basis event and a named rule, otherwise SOURCE_REQUIRED; V12 printed fixed deadlines with no basis.",
      "FACT",
      "CHARTER.md §3.4, §7; review/v12-forensic/deliverables/D6_findings_register.csv:4 (MF-003)",
    ),
    owner_domain: "B",
    lifecycle: "TaskStatus",
    transitions: Object.freeze([
      tr(null, "ASSIGNED", ["TASK_ASSIGNED", "STATEMENT_REQUESTED", "INFO_REQUEST_SENT"]),
      tr("ASSIGNED", "ACCEPTED", "TASK_ACCEPTED"),
      tr(["ASSIGNED", "ACCEPTED", "RETURNED"], "IN_PROGRESS", "TASK_STARTED"),
      tr(["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "RETURNED"], "SUBMITTED", [
        "TASK_SUBMITTED",
        "STATEMENT_RECEIVED",
        "INFO_RECEIVED",
      ]),
      tr("SUBMITTED", "RETURNED", "TASK_RETURNED"),
      tr(["IN_PROGRESS", "SUBMITTED"], "COMPLETED", "TASK_COMPLETED"),
      tr(["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "SUBMITTED", "RETURNED"], "CANCELLED", "TASK_CANCELLED"),
    ]),
    relationships: Object.freeze([
      rel("PROCEDURE", "PART_OF"),
      rel("RECIPIENT_CAPACITY", "ADDRESSED_TO", "assignee capacity"),
      rel("NOTIFICATION", "NEVER_IMPLIED_BY", "FD-12: a reminder or request notice never completes the task"),
    ]),
    authoritative_source: `Platform case_mgmt.case_task (CASE_TASK_STATUSES ${CONTRACTS}:156); defence notices and submissions (${TDM} §2 EmployeeNotice / DefenceSubmission).`,
    permitted_actions: Object.freeze([
      "ASSIGN_TASK",
      "ACCEPT_TASK",
      "SUBMIT_OUTPUT",
      "RETURN_OUTPUT",
      "COMPLETE_TASK",
      "CANCEL_TASK",
    ]),
    authorization:
      "Assignee acts on own task; acceptance of the output by the requesting capacity; no task type grants case content (CASE_TASK_TYPES comment, packages/contracts/src/index.ts:168).",
    evidence_requirements:
      "Each status: its event; deadline: basis_event_id + basis_rule (≠ SOURCE_REQUIRED) or no deadline (charter §3.2, §7).",
    disclosure_default:
      "Assignee sees own task, deadline with basis and channel; others per policy_v13.json.",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "MEETING",
    ar: "الاجتماع",
    en: "Meeting",
    meaning: txt(
      "اجتماع لجنة مجدول بموعد ونمط وجدول أعمال؛ يُفتتح ويُختتم ويُحرَّر محضره ويُراجع ويُعتمد.",
      "A scheduled committee meeting with a time, a mode and an agenda; it is opened, closed, minuted, reviewed and finalised.",
    ),
    significance: sig(
      "الدعوة ليست انعقاداً: لا يُعرض الاجتماع منعقداً إلا بحدث افتتاح واختتام مسجَّل، والاجتماع الملغى لا يتقدم؛ وقد عرض V12 اجتماعاً ملغى متقدماً.",
      "An invitation is not an occurrence: a meeting is shown as held only with recorded open and close events, and a cancelled meeting does not progress; V12 showed a cancelled meeting as progressing.",
      "FACT",
      "CHARTER.md §8 PC-03, PC-13; review/v12-forensic/work/W3_journeys_review.md:33 (F6, CF-25)",
    ),
    owner_domain: "B",
    lifecycle: "MeetingStatus",
    transitions: Object.freeze([
      tr(null, "SCHEDULED", "MEETING_SCHEDULED", { source: `${TWSM} §3.4` }),
      tr(["SCHEDULED", "RESCHEDULED"], "RESCHEDULED", "MEETING_RESCHEDULED", {
        note: "the platform has no reschedule state (MEETING_STATUSES, packages/contracts/src/index.ts:1424)",
      }),
      tr(["SCHEDULED", "RESCHEDULED"], "CANCELLED", "MEETING_CANCELLED", {
        label: "FACT",
        source: `${TWSM} §3.4 ("CANCELLED from SCHEDULED")`,
      }),
      tr(["SCHEDULED", "RESCHEDULED"], "OPENED", "MEETING_OPENED", {
        source: `${TWSM} §3.4 (secretary opens; COI declarations required)`,
      }),
      tr("OPENED", "CLOSED", "MEETING_CLOSED", { label: "FACT", source: `${TWSM} §3.4` }),
      tr("CLOSED", "MINUTES_DRAFT", "MINUTES_DRAFTED"),
      tr(["CLOSED", "MINUTES_DRAFT"], "MINUTES_UNDER_REVIEW", "MINUTES_UNDER_REVIEW", {
        source: `${CONTRACTS}:1492-1498 (minutes start IN_REVIEW in the platform)`,
      }),
      tr("MINUTES_UNDER_REVIEW", "MINUTES_DRAFT", "MINUTES_CHANGES_REQUESTED"),
      tr("MINUTES_UNDER_REVIEW", "MINUTES_FINAL", "MINUTES_FINAL", {
        source: `${TWSM} §3.4 (MINUTES_APPROVED / MINUTES_DEEMED_APPROVED); §5 (deemed approval OWNER_DEFAULT)`,
      }),
    ]),
    relationships: Object.freeze([
      rel("PROCEDURE", "PART_OF"),
      rel("BALLOT", "CONTAINS"),
      rel("EVIDENCE", "EVIDENCED_BY", "minutes"),
      rel("NOTIFICATION", "NEVER_IMPLIED_BY", "FD-06: an invitation never evidences occurrence"),
    ]),
    authoritative_source: `Platform committee.meeting / committee.minutes / committee.minutes_review (${TDM} §2); MEETING_STATUSES ${CONTRACTS}:1424; MINUTES_STATUSES ${CONTRACTS}:1492-1498; ${TWSM} §3.4.`,
    permitted_actions: Object.freeze([
      "SCHEDULE_MEETING",
      "RESCHEDULE_MEETING",
      "CANCEL_MEETING",
      "OPEN_MEETING",
      "CLOSE_MEETING",
      "DRAFT_MINUTES",
      "SUBMIT_MINUTES_FOR_REVIEW",
      "REQUEST_MINUTES_CHANGES",
      "FINALISE_MINUTES",
    ]),
    authorization: `Secretary schedules and opens (COI declarations from all eligible required, ${TWSM} §3.4); acting chair / secretary / alternate per MEETING_ACTING_ROLES (${CONTRACTS}:1463); conflicted or PENDING members cannot be PRESENT (${TDM} §2 Attendance).`,
    evidence_requirements:
      'MEETING_OPENED and MEETING_CLOSED for "held"; MINUTES_FINAL for final minutes; MEETING_SCHEDULED or an invitation notification is never evidence of occurrence.',
    disclosure_default:
      "Chair, members, secretary: meeting information; RECUSED_MEMBER: no deliberations, votes or member names; external classes: none (charter §5).",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "HEARING",
    ar: "جلسة الاستماع",
    en: "Hearing",
    meaning: txt(
      "اجتماع غرضه الاستماع إلى طرف أو شاهد أو خبير؛ له دعوة ومحضر، ولا يعني حضوره إدانة ولا ثبوتاً.",
      "A meeting whose purpose is to hear a party, a witness or an expert; it has an invitation and minutes, and attendance implies neither guilt nor proof.",
    ),
    significance: sig(
      "الشاهد يتلقى الحدث والإجراء المطلوب فقط دون أي مستوى من مسار القضية؛ وقد اجتاز V12 هذا الشرط في نصوص الشاهد.",
      "A witness receives the event and the required action only, with no case-journey level; V12 passed this condition in its witness texts.",
      "FACT",
      "CHARTER.md §5 (WITNESS → no l1/l2/l3); review/v12-forensic/work/W7_generator_notifications_review.md:33 (witness verdict)",
    ),
    owner_domain: "B",
    lifecycle: "MeetingStatus",
    transitions: Object.freeze([
      tr(null, "SCHEDULED", "MEETING_SCHEDULED"),
      tr(["SCHEDULED", "RESCHEDULED"], "RESCHEDULED", "MEETING_RESCHEDULED"),
      tr(["SCHEDULED", "RESCHEDULED"], "CANCELLED", "MEETING_CANCELLED"),
      tr(["SCHEDULED", "RESCHEDULED"], "OPENED", "MEETING_OPENED"),
      tr("OPENED", "CLOSED", "MEETING_CLOSED"),
      tr("CLOSED", "MINUTES_DRAFT", "MINUTES_DRAFTED"),
      tr(["CLOSED", "MINUTES_DRAFT"], "MINUTES_UNDER_REVIEW", "MINUTES_UNDER_REVIEW"),
      tr("MINUTES_UNDER_REVIEW", "MINUTES_DRAFT", "MINUTES_CHANGES_REQUESTED"),
      tr("MINUTES_UNDER_REVIEW", "MINUTES_FINAL", "MINUTES_FINAL"),
    ]),
    relationships: Object.freeze([
      rel("MEETING", "IS_A", `platform meeting with purpose HEARING (${CONTRACTS}:1419)`),
      rel("INVESTIGATION", "PART_OF"),
      rel("RECIPIENT_CAPACITY", "ADDRESSED_TO", "WITNESS / SUBJECT / expert invitees"),
      rel(
        "NOTIFICATION",
        "NEVER_IMPLIED_BY",
        "FD-06: an invitation never evidences that the hearing took place",
      ),
    ]),
    authoritative_source: `Platform committee.meeting with purpose HEARING (MEETING_PURPOSES ${CONTRACTS}:1419); invitees MEETING_INVITEE_ROLES ${CONTRACTS}:1426-1433.`,
    permitted_actions: Object.freeze([
      "SCHEDULE_HEARING",
      "INVITE_PARTICIPANT",
      "RESCHEDULE_HEARING",
      "CANCEL_HEARING",
      "OPEN_HEARING",
      "CLOSE_HEARING",
      "FINALISE_MINUTES",
    ]),
    authorization: `As for meetings; a grievance-firewalled member may be invited only as witness, expert or information provider (FIREWALL_INVITEE_ROLES ${CONTRACTS}:1437-1441).`,
    evidence_requirements:
      "As for meetings: occurrence only with MEETING_OPENED / MEETING_CLOSED for this hearing.",
    disclosure_default:
      "WITNESS: event and required action only, no case number, no Level 1/2/3 (charter §5); SUBJECT: what procedural rights need.",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "BALLOT",
    ar: "التصويت (بند التصويت)",
    en: "Ballot",
    meaning: txt(
      "بند تصويت رسمي على هدف محدد (توصية، نتيجة، عقوبة…) يُفتح ويُغلق وفق النصاب، وتُسجَّل نتيجته مآلاً لا حالة.",
      "A formal vote item on a defined target (recommendation, finding, sanction…), opened and closed under quorum; its result is recorded as an outcome, not a status.",
    ),
    significance: sig(
      "لا يُعدّ التصويت مفتوحاً بتوجيه من الرئيس ولا بحالة الحزمة؛ يلزم حدث فتح التصويت. وقد أعلن V12 «فتح التصويت» دون وجود بند تصويت.",
      'A vote is not open because of a chair direction or a package status; a ballot-opened event is required. V12 announced "voting open" with no vote item.',
      "FACT",
      "CHARTER.md §3.5; review/v12-forensic/deliverables/D6_findings_register.csv:14 (MF-013, CF-31)",
    ),
    owner_domain: "B",
    lifecycle: "ProcedureStatus",
    transitions: Object.freeze([
      tr(null, "NOT_STARTED", [], { note: "a planned vote item; asserts nothing" }),
      tr([null, "NOT_STARTED"], "OPEN", "BALLOT_OPENED", {
        label: "FACT",
        source: `${TWSM} §3.5 (vote item OPEN)`,
      }),
      tr("NOT_STARTED", "NOT_APPLICABLE", []),
      tr("OPEN", "COMPLETED", "BALLOT_CLOSED", {
        when: { path: "payload.result", in: ["APPROVED", "REJECTED", "TIED", "NO_DECISION"] },
        label: "INFERENCE",
        source: `${TWSM}:78 (§3.5 OPEN → CLOSED with result); ${CONTRACTS}:1490 (VOTE_RESULTS); work/LEAD_notes.md L-11 (NO_DECISION is a recorded outcome, not a failure)`,
        note: "platform CLOSED with a counted result mapped to COMPLETED; the result is an outcome attribute, never an adoption or a decision (L-11)",
      }),
      tr("OPEN", "FAILED", "BALLOT_CLOSED", {
        when: { path: "payload.result", eq: "NO_QUORUM" },
        source: `${TWSM}:78 (§3.5 CLOSED with result NO_QUORUM); cdf_case_management/packages/domain/src/committee.ts:254-265 (voteOutcome: NO_QUORUM without quorum); work/LEAD_notes.md L-10 ("A vote that did not reach quorum is never shown as cast")`,
        note: "a ballot closed without quorum could not be completed: FAILED, never COMPLETED (W-A proposal under L-10). A closure without a recorded result matches no row (fail closed); a new vote is a new ballot",
      }),
    ]),
    relationships: Object.freeze([
      rel("MEETING", "PART_OF"),
      rel("RECOMMENDATION", "TARGETS"),
      rel("AUTHORITY", "GOVERNED_BY", "quorum rule set; approver of opening"),
      rel("DECISION", "NEVER_IMPLIES", "a vote result is not the authority decision"),
    ]),
    authoritative_source: `Platform committee.vote_item / committee.vote / committee.casting_vote (${TDM} §2); VOTE_ITEM_STATUSES / VOTE_RESULTS ${CONTRACTS}:1488-1490; ${TWSM} §3.5.`,
    permitted_actions: Object.freeze([
      "OPEN_FORMAL_VOTE",
      "CAST_VOTE",
      "RECORD_NON_SUBSTANTIVE_CHOICE",
      "CAST_CASTING_VOTE",
      "CLOSE_VOTE",
    ]),
    authorization: `Opening a formal vote: approver CHAIR, decision maker COMMITTEE in the charter §6 example whose governing source is absent → SOURCE_REQUIRED; the secretary records only ABSENT / UNABLE_TO_VOTE / RECUSED (${CONTRACTS}:1486-1487); a recused member never votes.`,
    evidence_requirements:
      "BALLOT_OPENED for OPEN; BALLOT_CLOSED with a counted payload.result (APPROVED, REJECTED, TIED, NO_DECISION) for COMPLETED, with NO_QUORUM for FAILED; a CHAIR_DIRECTION_RECORDED {direction: VOTE} or a requested vote is never evidence that a vote is open or closed.",
    disclosure_default: `Individual choices: committee after close only, never the subject, the grievant or the case team (BALLOT_SECRECY ${CONTRACTS}:1467-1468); RECUSED_MEMBER: no votes (charter §5).`,
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "RECOMMENDATION",
    ar: "التوصية",
    en: "Recommendation",
    meaning: txt(
      "مخرَج تعتمده جهة الاختصاص (اللجنة بالتصويت، أو سلسلة اعتماد أولية) ويُرفع إلى صاحب الصلاحية؛ لا يُنفَّذ ولا يُبلَّغ به بوصفه قراراً.",
      "An output adopted by the competent body (the committee by vote, or a preliminary approval chain) and raised to the authority; it is neither executed nor notified as a decision.",
    ),
    significance: sig(
      "التوصية ليست قراراً، وبلوغ مرحلة التوصية لا يعني صدور توصية معتمدة، ورفعها إلى صاحب الصلاحية ليس قراراً نهائياً.",
      "A recommendation is not a decision; reaching the recommendation stage does not mean an adopted recommendation exists; raising it to the authority is not a final decision.",
      "FACT",
      "v9_data.json substates[S4.01].caution, substates[S4.03].caution («ليس قرارًا نهائيًا»); CHARTER.md §3.5",
    ),
    owner_domain: "B",
    lifecycle: "DecisionStatus",
    transitions: Object.freeze([
      tr(null, "DRAFT", "RECOMMENDATION_DRAFTED", { source: `${CONTRACTS}:1524-1533 (DRAFT)` }),
      tr(["DRAFT", "RETURNED", "NOT_ADOPTED"], "UNDER_VOTE", "BALLOT_OPENED", {
        source: `${CONTRACTS}:1524-1533 (VOTING)`,
        note: "BALLOT_OPENED names the recommendation as payload.target",
      }),
      tr("UNDER_VOTE", "ADOPTED", "RECOMMENDATION_ADOPTED", {
        label: "FACT",
        source: `${TWSM} §3.3 (RECOMMENDATION_ADOPTED: vote closed with quorum)`,
      }),
      tr("DRAFT", "ADOPTED", "RECOMMENDATION_ADOPTED", {
        label: "PROPOSAL",
        source: `${TWSM} §3.2 (preliminary recommendation approved without a vote)`,
        note: "only where the governing rule requires no vote; the committee path requires one",
      }),
      tr("UNDER_VOTE", "NOT_ADOPTED", "RECOMMENDATION_NOT_ADOPTED"),
      tr(["ADOPTED", "SUBMITTED_TO_AUTHORITY"], "RETURNED", "RECOMMENDATION_RETURNED", {
        label: "FACT",
        source: `${TWSM} §3.3, §3.6 (RETURNED_BY_LEGAL / RETURNED_BY_AUTHORITY)`,
      }),
      tr(["RETURNED", "NOT_ADOPTED"], "DRAFT", "RECOMMENDATION_DRAFTED"),
      tr("ADOPTED", "SUBMITTED_TO_AUTHORITY", "PACKAGE_SUBMITTED_TO_AUTHORITY", {
        source: `${CONTRACTS}:1524-1533 (AWAITING_AUTHORITY)`,
      }),
      tr("SUBMITTED_TO_AUTHORITY", "DECIDED", "AUTHORITY_DECISION_RECORDED", {
        when: { path: "payload.outcome", ne: "RETURN_TO_COMMITTEE" },
        source: `${CONTRACTS}:1524-1533 (DECIDED)`,
      }),
      tr("SUBMITTED_TO_AUTHORITY", "RETURNED", "AUTHORITY_DECISION_RECORDED", {
        when: { path: "payload.outcome", eq: "RETURN_TO_COMMITTEE" },
        source: `${TWSM} §2 (RETURN_TO_COMMITTEE → committee, new round)`,
      }),
      tr(["DRAFT", "NOT_ADOPTED", "RETURNED", "ADOPTED"], "SUPERSEDED", "RECOMMENDATION_SUPERSEDED"),
    ]),
    relationships: Object.freeze([
      rel("BALLOT", "TARGETED_BY"),
      rel("LEGAL_OPINION", "REVIEWED_BY", "optional legal review"),
      rel("DECISION", "INPUT_TO"),
      rel("DECISION", "NEVER_IMPLIES", "FD-02: a recommendation never becomes a decision"),
    ]),
    authoritative_source: `Platform decision.recommendation_package / recommendation_item (${TDM} §2); RECOMMENDATION_PACKAGE_STATUSES ${CONTRACTS}:1524-1533; free-text sanction ⇒ PROPOSED_UNVERIFIED (${CONTRACTS}:1536).`,
    permitted_actions: Object.freeze([
      "DRAFT_RECOMMENDATION",
      "PUT_TO_VOTE",
      "ADOPT_RECOMMENDATION",
      "REQUEST_LEGAL_REVIEW",
      "SUBMIT_TO_AUTHORITY",
    ]),
    authorization: `Adoption by the committee through a vote with quorum (${TWSM} §3.3); at least one meeting before adoption (${TDM} §2 Meeting); submission by the secretariat after adoption.`,
    evidence_requirements:
      "RECOMMENDATION_ADOPTED for ADOPTED (never LEGAL_OPINION_SUBMITTED); BALLOT_OPENED for UNDER_VOTE (never a chair direction); PACKAGE_SUBMITTED_TO_AUTHORITY for SUBMITTED_TO_AUTHORITY.",
    disclosure_default: `Internal; never shown to the referring body before authorisation is verified (v9_data.json states[S4].visible); external classes PROHIBITED by default.`,
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "LEGAL_OPINION",
    ar: "الرأي النظامي",
    en: "Legal opinion",
    meaning: txt(
      "رأي المراجع النظامي في بنود محددة (موافق، موافق بملاحظات، متعارض)؛ يُحفظ مع التوصية ولا يعتمدها ولا يقرر.",
      "The legal reviewer's opinion on selected items (concurs, concurs with comments, conflicts); preserved with the recommendation; it neither adopts nor decides.",
    ),
    significance: sig(
      "الرأي النظامي ليس اعتماداً ولا قراراً: التعارض يعيد التوصية إلى اللجنة ويُحفظ الاثنان؛ وقد أظهر V12 «الإعادة إلى اللجنة» لكل مراجعة نظامية.",
      'A legal opinion is neither adoption nor decision: a conflict returns the recommendation to the committee and both are preserved; V12 showed "returned to the committee" for every legal review.',
      "FACT",
      `${TWSM} §3.6; CHARTER.md §8 PC-12; review/v12-forensic/deliverables/D6_findings_register.csv:15 (MF-014)`,
    ),
    owner_domain: "B",
    lifecycle: "ProcedureStatus",
    transitions: Object.freeze([
      tr(null, "OPEN", "LEGAL_REVIEW_REQUESTED", { label: "FACT", source: `${TWSM} §3.6 (REQUESTED)` }),
      tr("OPEN", "IN_PROGRESS", "PROCEDURE_STARTED"),
      tr(PS_ACTIVE, "COMPLETED", "LEGAL_OPINION_SUBMITTED", {
        label: "FACT",
        source: `${TWSM} §3.6 (OPINION_SUBMITTED)`,
      }),
      tr(PS_ACTIVE, "CANCELLED", "PROCEDURE_CANCELLED"),
    ]),
    relationships: Object.freeze([
      rel("RECOMMENDATION", "TARGETS", "selected packet items"),
      rel("RECOMMENDATION", "NEVER_IMPLIES", "FD-03: an opinion never adopts"),
      rel("DECISION", "NEVER_IMPLIES", "FD-04: an opinion never decides"),
    ]),
    authoritative_source: `Platform decision.legal_review_request / item / opinion (${TDM} §2); LEGAL_OPINIONS ${CONTRACTS}:1538; ${TWSM} §3.6.`,
    permitted_actions: Object.freeze(["REQUEST_LEGAL_REVIEW", "SELECT_PACKET_ITEMS", "SUBMIT_LEGAL_OPINION"]),
    authorization:
      "Secretary selects packet items; the assigned legal reviewer submits the opinion (platform LEGAL_REVIEW_ASSIGNED template).",
    evidence_requirements:
      "LEGAL_REVIEW_REQUESTED; LEGAL_OPINION_SUBMITTED with payload.opinion; a CONFLICTS opinion is followed by its own RECOMMENDATION_RETURNED, never inferred.",
    disclosure_default: "Internal (legal reviewer, committee, secretariat); PROHIBITED for external classes.",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "DECISION",
    ar: "القرار",
    en: "Decision",
    meaning: txt(
      "قرار صاحب الصلاحية المسجَّل بسند (وثيقة مصدر) بأحد المآلات المعتمدة؛ يختلف عن التوصية وعن تبليغه وعن تنفيذه.",
      "The authority's recorded decision, with a source document, in one of the approved outcomes; distinct from the recommendation, from its notice and from its execution.",
    ),
    significance: sig(
      "القرار لا يُستنتج من التوصية، ولا يصدر بإصدار تبليغه، و«الإعادة إلى اللجنة» ليست قراراً في الموضوع؛ وقد عرض V12 حزمة معادة على أنها صدر فيها قرار.",
      "A decision is never inferred from a recommendation, is not made by issuing its notice, and 'return to committee' is not a decision on the merits; V12 showed a returned package as decided.",
      "FACT",
      `CHARTER.md §3.5, §6; review/v12-forensic/deliverables/D6_findings_register.csv:16 (MF-015); ${TDM} §2 AuthorityDecision ("effective ⇒ source document present")`,
    ),
    owner_domain: "B",
    lifecycle: "DecisionStatus",
    transitions: Object.freeze([
      tr(null, "SUBMITTED_TO_AUTHORITY", "PACKAGE_SUBMITTED_TO_AUTHORITY", {
        source: `${TWSM} §3.7 (AWAITING)`,
        note: "the submission event names the DECISION in payload.related",
      }),
      tr("SUBMITTED_TO_AUTHORITY", "DECIDED", "AUTHORITY_DECISION_RECORDED", {
        label: "FACT",
        when: { path: "payload.outcome", ne: "RETURN_TO_COMMITTEE" },
        source: `${TWSM} §3.7 (RECORDED)`,
      }),
      tr("SUBMITTED_TO_AUTHORITY", "RETURNED", "AUTHORITY_DECISION_RECORDED", {
        when: { path: "payload.outcome", eq: "RETURN_TO_COMMITTEE" },
        source: `${CONTRACTS}:1542-1549 (RETURN_TO_COMMITTEE); D6 MF-015`,
        note: "a return is recorded as RETURNED, never as DECIDED",
      }),
      tr("DECIDED", "SUPERSEDED", "DECISION_SUPERSEDED", {
        source: `${CONTRACTS}:1581-1593 (grievance MODIFY / CANCEL)`,
      }),
    ]),
    relationships: Object.freeze([
      rel("RECOMMENDATION", "TARGETS", "decides on"),
      rel("AUTHORITY", "GOVERNED_BY"),
      rel("IMPLEMENTATION_ACTION", "RESULTS_IN"),
      rel("EVIDENCE", "EVIDENCED_BY", "source document"),
      rel(
        "NOTIFICATION",
        "NEVER_IMPLIED_BY",
        "FD-10: issuing or delivering the decision notice is not the decision",
      ),
    ]),
    authoritative_source: `Platform decision.authority_decision (${TDM} §2 AuthorityDecision; AUTHORITY_OUTCOMES ${CONTRACTS}:1542-1549; AUTHORITY_TYPES ${CONTRACTS}:1540); ${TWSM} §3.7; employee DECISION notices ${CONTRACTS}:1568.`,
    permitted_actions: Object.freeze([
      "RECORD_AUTHORITY_DECISION",
      "ISSUE_DECISION_NOTICE",
      "RECORD_NOTICE_DELIVERY",
      "SUPERSEDE_DECISION",
    ]),
    authorization: `Decision maker per decision.action_authority_rule (CEO seeded OWNER_DEFAULT, not hard-coded; DoA SOURCE_REQUIRED — ${TDM} §2 AuthorityType / Rule); recorded by the secretary with the source document (${TWSM} §3.7). Issuing a decision notice never equals making the decision (charter §6).`,
    evidence_requirements:
      "AUTHORITY_DECISION_RECORDED (payload.outcome, payload.performed_by, payload.source_document_ref) for DECIDED; DECISION_NOTICE_ISSUED / _DELIVERED only after it; RETURN_TO_COMMITTEE ⇒ RETURNED.",
    disclosure_default:
      "Decision outcome to authorised internal classes; SUBJECT receives the notice content its rights require; referring body: authorised outcome only (W7 §8); PROHIBITED by default.",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "IMPLEMENTATION_ACTION",
    ar: "إجراء التنفيذ",
    en: "Implementation action",
    meaning: txt(
      "إجراء تصحيحي أو تنفيذي ناتج عن قرار، له مالك ومهلة ودليل إنجاز، ويُعدّ مكتملاً بالتحقق لا بإعلان المالك.",
      "A corrective or execution action arising from a decision, with an owner, a due date and completion evidence; complete on verification, not on the owner's declaration.",
    ),
    significance: sig(
      "فصل القرار عن التنفيذ، والإنجاز عن التحقق؛ وحالة التنفيذ على مستوى القضية مشتقة ولا تُخزَّن.",
      "Decision is separated from execution and completion from verification; the case-level execution state is derived and never stored.",
      "FACT",
      `v9_data.json substates[S5.02].caution («فصل القرار عن التنفيذ»); ${CONTRACTS}:1822-1828 (PENDING_VERIFICATION), 1837-1845 (EXECUTION_STATES "never stored")`,
    ),
    owner_domain: "B",
    lifecycle: "TaskStatus",
    transitions: Object.freeze([
      tr(null, "ASSIGNED", "ACTION_ASSIGNED"),
      tr(["ASSIGNED", "RETURNED"], "IN_PROGRESS", "TASK_STARTED"),
      tr(["ASSIGNED", "IN_PROGRESS", "RETURNED"], "SUBMITTED", "ACTION_COMPLETED", {
        label: "INFERENCE",
        source: `${CONTRACTS}:1822-1828 (PENDING_VERIFICATION)`,
        note: "owner completion = submitted for verification",
      }),
      tr("SUBMITTED", "COMPLETED", "ACTION_VERIFIED", { source: `${CONTRACTS}:1830 (VERIFIED)` }),
      tr("SUBMITTED", "RETURNED", "ACTION_RETURNED", { source: `${CONTRACTS}:1830 (RETURNED)` }),
      tr(["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "RETURNED"], "CANCELLED", "TASK_CANCELLED", {
        note: "platform WAIVED has no V13 status (gap)",
      }),
    ]),
    relationships: Object.freeze([
      rel("DECISION", "OUTCOME_OF"),
      rel("EVIDENCE", "EVIDENCED_BY", "completion evidence"),
      rel("RECIPIENT_CAPACITY", "ADDRESSED_TO", "action owner"),
    ]),
    authoritative_source: `Platform decision.corrective_action (${TDM} §2 CorrectiveAction); CORRECTIVE_ACTION_STATUSES ${CONTRACTS}:1822-1828; COMPLETION_EVIDENCE_RULES ${CONTRACTS}:1833 (SOURCE_REQUIRED, seeded REFERENCE_REQUIRED).`,
    permitted_actions: Object.freeze([
      "ASSIGN_ACTION",
      "START_ACTION",
      "SUBMIT_COMPLETION",
      "VERIFY_ACTION",
      "RETURN_ACTION",
      "CANCEL_ACTION",
    ]),
    authorization:
      "Owner submits completion; verification by the verifying capacity; the owner never reaches the case behind caseId (CorrectiveAction comment, packages/contracts/src/index.ts:1848).",
    evidence_requirements:
      "ACTION_COMPLETED with completion evidence (reference required by default) → SUBMITTED; ACTION_VERIFIED → COMPLETED.",
    disclosure_default: "Owner sees own action, due date and evidence rule; case team per policy_v13.json.",
    audit: AUDIT_PLATFORM,
  }),

  Object.freeze({
    id: "NOTIFICATION",
    ar: "الإشعار",
    en: "Notification",
    meaning: txt(
      "تمثيل تواصلي لحدث مسجَّل موجَّه إلى مستلم بصفة محددة عبر قناة؛ له دورة حياة خاصة (مسودة ← تحقق ← إذن ← طابور ← إرسال ← تسليم)، ولا يغيّر الواقع الإجرائي.",
      "A communicative representation of a recorded event, addressed to a recipient in a defined capacity through a channel; it has its own lifecycle (draft → validated → authorized → queued → sent → delivered) and never changes procedural reality.",
    ),
    significance: sig(
      "الإشعار ينقل المعرفة ولا يصنع الواقعة: لا يغلق قضية ولا يُثبت انعقاداً ولا قراراً. وكان V12 أداة صياغة لا خدمة إشعار.",
      "A notification carries knowledge and creates no fact: it closes no case and proves no meeting or decision. V12 was a drafting toolkit, not a notification service.",
      "FACT",
      'CHARTER.md §3.1 ("CASE_UNCHANGED notifications never move it"), §3.5; review/v12-forensic/deliverables/D3_architecture_reconstruction.md:7',
    ),
    owner_domain: "F",
    lifecycle: "NotificationStatus",
    transitions: Object.freeze([
      tr(null, "DRAFT", "NOTIFICATION_DRAFTED", { label: "FACT", source: "CHARTER.md §9" }),
      tr(null, "CORRECTED", "NOTIFICATION_CORRECTED", {
        label: "FACT",
        source: `${L04} item 1`,
        note: "entry state of the correcting version n+1 (payload.corrects_version = n, reason_code); version n does not move",
      }),
      tr(["DRAFT", "CORRECTED"], "VALIDATED", "NOTIFICATION_VALIDATED", {
        label: "FACT",
        source: `CHARTER.md §9 (consistency ok, disclosure applied); ${L04} item 1 (CORRECTED → VALIDATED: consistency, disclosure and authority run again)`,
      }),
      tr("VALIDATED", "AUTHORIZATION_PENDING", "NOTIFICATION_AUTHORIZATION_REQUESTED", {
        label: "FACT",
        source: "CHARTER.md §9 (if the authority model requires approval)",
      }),
      tr(["VALIDATED", "AUTHORIZATION_PENDING"], "AUTHORIZED", "NOTIFICATION_AUTHORIZED", {
        label: "INFERENCE",
        source: "CHARTER.md §9",
        note: "VALIDATED → AUTHORIZED when no approval is required; QUEUED is reachable only from AUTHORIZED",
      }),
      tr("AUTHORIZED", "QUEUED", "NOTIFICATION_QUEUED", {
        label: "FACT",
        source: "CHARTER.md §9 (adapter enqueue)",
      }),
      tr("QUEUED", "SENT", "NOTIFICATION_SENT", {
        label: "FACT",
        source: "CHARTER.md §9 (adapter claim + dispatch)",
      }),
      tr("SENT", "DELIVERY_CONFIRMED", "DELIVERY_CONFIRMED", {
        label: "FACT",
        source: `CHARTER.md §9 (record_email_delivery); ${L07}`,
        note: "IN_APP: together with SENT (the committed inbox row, L-02). EMAIL: only with a provider delivery report under the default ACCEPTANCE reading, or the sender's success under the explicit SETTLEMENT configuration (L-07)",
      }),
      tr("SENT", "DELIVERY_FAILED", "DELIVERY_FAILED", {
        label: "FACT",
        source: "CHARTER.md §9",
        note: "after the last attempt (OUTBOX_ATTEMPTS_EXHAUSTED)",
      }),
      tr(
        ["DRAFT", "VALIDATED", "AUTHORIZATION_PENDING", "AUTHORIZED", "QUEUED", "CORRECTED"],
        "CANCELLED",
        "NOTIFICATION_CANCELLED",
        {
          label: "FACT",
          source: `CHARTER.md §9; ${L04} items 1 and 4 (a cancelled correction leaves version n current)`,
        },
      ),
      tr(["SENT", "DELIVERY_CONFIRMED", "DELIVERY_FAILED"], "SUPERSEDED", "NOTIFICATION_SUPERSEDED", {
        label: "FACT",
        source: `${L04} items 2 and 5`,
        note: 'version n, in the same step as its correcting version n+1 reaches SENT; reachable only this way. The charter pair "SENT/DELIVERY_* → CORRECTED" is lineage level (status.js LINEAGE_TRANSITIONS).',
      }),
    ]),
    relationships: Object.freeze([
      rel("CASE", "REPRESENTS", "refers to (never changes)"),
      rel("RECIPIENT_CAPACITY", "ADDRESSED_TO"),
      rel("DELIVERY_ATTEMPT", "CONTAINS"),
      rel("DELIVERY_OUTCOME", "RESULTS_IN"),
      rel("EVIDENCE", "EVIDENCED_BY", "issuance record per version"),
      rel("CASE", "NEVER_IMPLIES", "FD-01"),
      rel("MEETING", "NEVER_IMPLIES", "FD-06"),
      rel("DELIVERY_OUTCOME", "NEVER_IMPLIES", "FD-08: an export is not a delivery"),
    ]),
    authoritative_source: `Platform notify.outbox / template / rule / preference (${MIG1920}:8-17, 108-125; ADR-025); V13 lifecycle charter §9 (W-D1) with the correction model of ${L04} and the delivery reading of ${L07}. E-mail adapter is a stub: PRODUCTION_SUBSTITUTION_REQUIRED (${MIG1920}:17).`,
    permitted_actions: Object.freeze([
      "DRAFT_NOTIFICATION",
      "VALIDATE",
      "REQUEST_AUTHORIZATION",
      "AUTHORIZE",
      "ENQUEUE",
      "DISPATCH",
      "RECORD_DELIVERY",
      "CANCEL",
      "CORRECT (new version in CORRECTED)",
      "SUPPRESS_RETRIES (on correction)",
      "EXPORT_PREVIEW (never a delivery)",
    ]),
    authorization: `Recipient = platform user id + rule (notify.rule layers, ${MIG1920}:8-10); approval when authority_v13.json requires it (charter §6, W-F); platform notifications carry no investigation content (§39, ${MIG1920}:11-12).`,
    evidence_requirements:
      "Every lifecycle transition: its event (charter §9) + an append-only evidence record keyed by notification version (W-D1 evidence entries; delivery attempts and exports are evidence entries, not ledger events: L-07 D5); delivery only with DELIVERY_CONFIRMED (IN_APP: the committed inbox row, L-02; EMAIL: a provider delivery report, or the sender's success under the explicit SETTLEMENT configuration, L-07); acknowledgement only with RECIPIENT_ACKNOWLEDGED; a correction is a new version entering CORRECTED, and the corrected version becomes SUPERSEDED only when the correction is SENT (L-04).",
    disclosure_default:
      "Every renderer receives a projected model (_disclosure_applied === true, charter §0.6); default PROHIBITED per field (charter §5).",
    audit:
      "Every lifecycle transition appends an Event (§3.3) and an evidence record (evidence.js, append-only) keyed by notification version (charter §9); the platform audits delivery as NOTIFICATION_DELIVERY (migration 1920 l.612).",
  }),

  Object.freeze({
    id: "DELIVERY_ATTEMPT",
    ar: "محاولة التسليم",
    en: "Delivery attempt",
    meaning: txt(
      "محاولة واحدة لتمرير إصدار محدد من الإشعار عبر قناة؛ نتيجتها قبول الناقل أو الفشل أو الارتداد.",
      "One attempt to pass a given notification version through a channel; its result is acceptance by the transport, failure or bounce.",
    ),
    significance: sig(
      "المحاولة ليست تسليماً، وقبول الناقل ليس قراءة ولا إقراراً («الإرسال ≠ التسليم ≠ القراءة»)؛ ولا تحفظ المنصة سجلاً لكل محاولة.",
      'An attempt is not delivery, and acceptance by the transport is neither reading nor acknowledgement ("sending ≠ delivery ≠ reading"); the platform keeps no per-attempt record.',
      "FACT",
      `CHARTER.md §3.4; v9_data.json substates[S5.01].caution; ${MIG1920}:119 (attempts counter only), 588-615`,
    ),
    owner_domain: "F",
    lifecycle: "DeliveryStatus",
    transitions: Object.freeze([
      tr(null, "ATTEMPTED", "DELIVERY_ATTEMPTED"),
      tr("ATTEMPTED", "ACCEPTED_BY_PROVIDER", "DELIVERY_ACCEPTED_BY_PROVIDER"),
      tr("ATTEMPTED", "FAILED", "DELIVERY_ATTEMPT_FAILED"),
      tr("ACCEPTED_BY_PROVIDER", "BOUNCED", "DELIVERY_BOUNCED"),
    ]),
    relationships: Object.freeze([
      rel("NOTIFICATION", "ATTEMPT_OF"),
      rel("DELIVERY_OUTCOME", "INPUT_TO", "evidence for, never the outcome itself"),
      rel(
        "DELIVERY_OUTCOME",
        "NEVER_IMPLIES",
        "FD-07: an attempt or provider acceptance never confirms delivery",
      ),
    ]),
    authoritative_source: `Platform notify.outbox.attempts + notify.claim_email_batch / record_email_delivery (${MIG1920}:119, 580-615); no per-attempt table (gap; PRODUCTION_SUBSTITUTION_REQUIRED in V13 adapters). In V13 (W-D1) each attempt is an evidence entry of kind DELIVERY_ATTEMPT keyed by notification version (${L07}, D5).`,
    permitted_actions: Object.freeze([
      "DISPATCH_ATTEMPT",
      "RECORD_PROVIDER_ACCEPTANCE",
      "RECORD_ATTEMPT_FAILURE",
      "RECORD_BOUNCE",
    ]),
    authorization: `Server-only sender functions granted to the BFF login role, never to authenticated or anon (${MIG1920}:14-17).`,
    evidence_requirements:
      'One record per attempt state (a DELIVERY_ATTEMPT evidence entry in V13, or an attempt event from an adapter); attempts exist only after NOTIFICATION_QUEUED; a sender success is ACCEPTED_BY_PROVIDER, never delivery (L-07); no attempt status means "read" or "acknowledged".',
    disclosure_default: "Operational metadata only (no content); internal operators and audit.",
    audit: `Platform audits each settlement as NOTIFICATION_DELIVERY SUCCESS / FAILURE (${MIG1920}:612-614); V13 appends an evidence record per attempt.`,
  }),

  Object.freeze({
    id: "DELIVERY_OUTCOME",
    ar: "نتيجة التسليم",
    en: "Delivery outcome",
    meaning: txt(
      "الواقعة المسجَّلة لنتيجة تسليم إصدار من الإشعار (تأكد التسليم أو تعذّره)؛ ثابتة لا تُعدَّل، ويُصحَّح الإشعار بإصدار جديد.",
      "The recorded fact of a notification version's delivery result (confirmed or failed); immutable; a notification is corrected by a new version.",
    ),
    significance: sig(
      "التصدير (EML/HTML) ليس تسليماً، والتسليم ليس إقراراً بالاستلام؛ وقد اعتمد V12 تنزيل ملف EML وزر «أُرسل» اليدوي.",
      'An export (EML/HTML) is not a delivery and a delivery is not an acknowledgement of receipt; V12 relied on an EML download and a manual "sent" button.',
      "FACT",
      "CHARTER.md §8 PC-15, PC-16; review/v12-forensic/deliverables/D3_architecture_reconstruction.md:28",
    ),
    owner_domain: "F",
    lifecycle: "none",
    transitions: Object.freeze([]),
    relationships: Object.freeze([
      rel("NOTIFICATION", "OUTCOME_OF"),
      rel("DELIVERY_ATTEMPT", "EVIDENCED_BY"),
      rel(
        "RECIPIENT_CAPACITY",
        "NEVER_IMPLIES",
        "FD-09: delivery never implies the recipient acknowledged or read",
      ),
    ]),
    authoritative_source: `Platform notify.outbox status SENT ⇔ delivered_at not null (${MIG1920}:118, 123), set by record_email_delivery when the sender returns success (${MIG1920}:598-609) or on insert for IN_APP (${MIG1920}:125); FAILED after the fifth attempt (${MIG1920}:609). Charter §9 maps record_email_delivery to DELIVERY_CONFIRMED / DELIVERY_FAILED (FACT). The intended production sender is the CDF mail relay, still a human decision (cdf_case_management/packages/application/src/ports.ts:433-436). Lead ruling ${L07} closes gap G-08: by default (ACCEPTANCE, aligned to W-B V13-03 §8) the sender's success is DELIVERY_ACCEPTED_BY_PROVIDER and the notification stays SENT; DELIVERY_CONFIRMED needs a provider delivery report, which the platform does not record today (UNVERIFIED; the relay's semantics are SOURCE_REQUIRED; PRODUCTION_SUBSTITUTION_REQUIRED at W-B S3/S8); the charter-literal SETTLEMENT reading is explicit configuration only; IN_APP follows L-02.`,
    permitted_actions: Object.freeze(["RECORD_DELIVERY_CONFIRMED", "RECORD_DELIVERY_FAILED"]),
    authorization:
      'Recorded by the sender adapter only (server-side); never by a user action in a browser (V12 manual "sent" is not an outcome).',
    evidence_requirements:
      "DELIVERY_CONFIRMED (payload.evidence_kind IN_APP_ROW_CREATED or PROVIDER_DELIVERY_REPORT; SENDER_ADAPTER_REPORTED_SUCCESS under SETTLEMENT only) or DELIVERY_FAILED (OUTBOX_ATTEMPTS_EXHAUSTED) for a notification version, backed by at least one attempt; immutable (INV-22).",
    disclosure_default: "delivery_status field per policy_v13.json (W-F); internal by default.",
    audit: "Platform audit NOTIFICATION_DELIVERY (migration 1920 l.612); V13 evidence record per version.",
  }),

  Object.freeze({
    id: "EVIDENCE",
    ar: "الدليل",
    en: "Evidence",
    meaning: txt(
      "مرجع إلى دليل أو سجل يثبت واقعة: دليل إجرائي في خزنة الأدلة (بمفاتيح عشوائية ثابتة)، أو سجل تدقيق، أو سجل إصدار للإشعار؛ يُشار إليه ولا يُنسخ.",
      "A reference to an exhibit or a record that proves a fact: a procedural exhibit in the evidence vault (random immutable keys), an audit record, or a notification issuance record; referenced, never copied.",
    ),
    significance: sig(
      "لا علامة اكتمال دون مرجع دليل، ولا مخزن ثانٍ للحقيقة؛ وقد وضع V12 علامات ✔ دون أي حدث مسجَّل ولم يحفظ سجل إصدار.",
      "No completion mark without an evidence reference and no second authoritative store; V12 placed ✔ marks with no recorded event and kept no issuance record.",
      "FACT",
      "CHARTER.md §0.7, §2 G, §3.2; review/v12-forensic/deliverables/D6_findings_register.csv:11 (MF-010), :20 (MF-019)",
    ),
    owner_domain: "G",
    lifecycle: "none",
    transitions: Object.freeze([]),
    relationships: Object.freeze([
      rel("CASE", "PART_OF"),
      rel("ALLEGATION", "TARGETS", "evidence_link → allegation | finding"),
      rel("NOTIFICATION", "TARGETS", "issuance evidence per version"),
    ]),
    authoritative_source: `Evidence vault (private storage, random immutable keys, never overwritten — CLAUDE.md §24–§27; EVIDENCE_STATUSES ${CONTRACTS}:412); audit ledger (append-only, CLAUDE.md §29); V13 evidence.js keyed by notification version (W-D1).`,
    permitted_actions: Object.freeze(["REFERENCE_EVIDENCE", "APPEND_ISSUANCE_RECORD"]),
    authorization:
      "Evidence access per case access and evidence restriction (TEAM / LEADS, packages/contracts/src/index.ts:416); no user hard delete (CLAUDE.md §24–§27).",
    evidence_requirements:
      "Itself the evidence: immutable, referenced by id; evidence content never enters a notification (CLAUDE.md §39, §83).",
    disclosure_default:
      "evidence_refs and attachments PROHIBITED for external classes by default (charter §5); content never in notifications.",
    audit:
      "Custody events in the platform (CUSTODY_EVENT_TYPES, packages/contracts/src/index.ts:428); V13 appends issuance evidence only.",
  }),

  Object.freeze({
    id: "AUTHORITY",
    ar: "الصلاحية",
    en: "Authority",
    meaning: txt(
      "الحق المسند بمصدر معتمد لاتخاذ فعل محدد (إعداد، مراجعة، اعتماد، قرار، تنفيذ) بصفة محددة، مع التفويض والتنحّي وتعارض المصالح؛ لا يُستنتج من مسمّى وظيفي.",
      "The right, granted by an approved source, to take a defined act (prepare, review, approve, decide, execute) in a defined capacity, subject to delegation, recusal and conflict of interest; never inferred from a job title.",
    ),
    significance: sig(
      "المعرفة ليست صلاحية والصلاحية ليست تنفيذاً: من سجّل الفعل ليس بالضرورة من اتخذه؛ ولم يثبت لـ V12 إلا ادعاءان من 62 ادعاء صلاحية بمصدر معتمد.",
      "Knowledge is not authority and authority is not execution: whoever recorded an act is not necessarily who took it; only 2 of 62 V12 authority claims had an approved source.",
      "FACT",
      `CHARTER.md §2 C, §6; ${TWSM} §3.7 (decision RECORDED by the secretary); review/v12-forensic/deliverables/D8_future_state_V13_design.md:72 (W8: 2 of 62 SUPPORTED)`,
    ),
    owner_domain: "C",
    lifecycle: "none",
    transitions: Object.freeze([]),
    relationships: Object.freeze([
      rel("RECIPIENT_CAPACITY", "GOVERNS", "a capacity holds rights only through an approved source"),
      rel("DECISION", "GOVERNS"),
      rel("BALLOT", "GOVERNS"),
      rel("NOTIFICATION", "GOVERNS", "approval before sending when required"),
    ]),
    authoritative_source: `@cdf/authorization + authz.* (CLAUDE.md §19); decision.authority_type / action_authority_rule (${TDM} §2); committee seats and delegations (${TDM} §2 Membership / CommitteeDelegation); authority_v13.json (W-F).`,
    permitted_actions: Object.freeze(["CHECK_AUTHORITY (authority.check, W-D2)"]),
    authorization:
      "Itself the authorization model: SOURCE_REQUIRED is fail-closed (DENIED for execution; drafting only with an explicit manual_operation label — charter §6).",
    evidence_requirements:
      "A readable approved source (document, version, approval date) or an owner decision id per right; otherwise SOURCE_REQUIRED.",
    disclosure_default:
      "Decision-rights indicator for authorised internal recipients only (charter §11 DecisionRightsIndicator).",
    audit: "Authorization decisions on sensitive actions are audited in the platform (CLAUDE.md §19, §29).",
  }),

  Object.freeze({
    id: "RECIPIENT_CAPACITY",
    ar: "صفة المستلم",
    en: "Recipient capacity",
    meaning: txt(
      "الصفة التي يتلقى بها المستلم الإشعار في سياق إجرائي محدد (أمين، رئيس، عضو، محقق، مراجع نظامي، صاحب صلاحية، جهة محيلة، مبلّغ، طرف معني، شاهد، حائز دليل، عضو متنحٍّ، صاحب صلاحية القضية المقيدة)؛ تحدد الإفصاح وصياغة المستوى الثاني.",
      "The capacity in which a recipient receives a notification in a given procedural context (secretary, chair, member, investigator, legal reviewer, authority, referring body, reporter, subject, witness, evidence holder, recused member, restricted-case authority); it determines disclosure and Level-2 wording.",
    ),
    significance: sig(
      "صياغة المستوى الثاني تتبع موضوع الإشعار وصفة المستلم (قرار المالك، 26 أكتوبر)؛ وقد وُجّهت إشعارات في V12 إلى صفة غير التي كُتب لها المسار.",
      "Level-2 wording follows the notification's object and the recipient's capacity (owner decision, 26 Oct); V12 addressed some notices to a capacity other than the one their journey was written for.",
      "FACT",
      "CHARTER.md header and §5 (13 recipient classes); notifications/journeys/level2_journeys.json owner_rule; review/v12-forensic/work/W7_generator_notifications_review.md:46 (recipient ≠ capacity)",
    ),
    owner_domain: "C",
    lifecycle: "none",
    transitions: Object.freeze([]),
    relationships: Object.freeze([rel("AUTHORITY", "GOVERNED_BY"), rel("NOTIFICATION", "ADDRESSEE_OF")]),
    authoritative_source: `Platform roles, committee seats and case assignment roles (ROLES ${CONTRACTS}:491; COMMITTEE_SEATS ${CONTRACTS}:1060; ASSIGNMENT_ROLES ${CONTRACTS}:51); recipient classes in policy_v13.json (W-F).`,
    permitted_actions: Object.freeze(["RESOLVE_RECIPIENT (platform user id + channel)"]),
    authorization:
      "A capacity is effective only through an effective-dated membership / assignment; a title alone grants nothing (charter §2 C; committee roles are capability prerequisites only, TARGET_DOMAIN_MODEL.md §4).",
    evidence_requirements:
      "The membership or assignment record that makes the capacity effective at the event time.",
    disclosure_default:
      "Selects the disclosure row (charter §5); RECUSED_MEMBER and RESTRICTED-case rules apply first.",
    audit:
      "Membership, delegation and recusal changes are audited in the platform (effective-dated, CLAUDE.md §29).",
  }),
]);

export const CONCEPT_IDS: readonly string[] = Object.freeze(CONCEPTS.map((c) => c.id));

export function getConcept(id: unknown): Concept {
  const c = CONCEPTS.find((x) => x.id === id);
  if (!c) throw new Error(`UNKNOWN_CONCEPT: ${String(id)}`);
  return c;
}
