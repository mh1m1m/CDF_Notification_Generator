import "server-only";
import { isNil } from "@/lib/domain/nil";
import { ar as AR } from "@/lib/i18n/notificationRender/ar";
import { en as EN } from "@/lib/i18n/notificationRender/en";
/**
 * CDF Notifications V13 — interface strings for the renderers (W-D2), assembled from the i18n namespace
 * `notificationRender` (lib/i18n/notificationRender, PROC; V13-PROC-007, OI-036). No wording lives in this file: it only
 * shapes the dictionary entries into the structures the renderers read, with the same keys and texts as the reference.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION. All wording is PROPOSED (not approved); the Layer A / Layer B labels are the
 * charter §3.6 wording (FACT: CHARTER.md).
 */
type Key = keyof typeof AR;
export interface BiText {
  readonly ar: string;
  readonly en: string;
}
/** one dictionary entry in both languages */
const tk = (key: Key): BiText => Object.freeze({ ar: AR[key], en: EN[key] });

export const MARKING: string = AR["marking"];
export const MARKING_SUBJECT_PREFIX: string = AR["markingSubjectPrefix"];

/** Layer A (actual progress) — charter §3.6. Symbols carry U+FE0E (text presentation) where an emoji form exists. */
export const LAYER_A = Object.freeze({
  COMPLETED: { sym: AR["layerA.completed.sym"], ar: AR["layerA.completed"], en: EN["layerA.completed"] },
  IN_PROGRESS: { sym: AR["layerA.inProgress.sym"], ar: AR["layerA.inProgress"], en: EN["layerA.inProgress"] },
  PENDING: { sym: AR["layerA.pending.sym"], ar: AR["layerA.pending"], en: EN["layerA.pending"] },
  SUSPENDED: { sym: AR["layerA.suspended.sym"], ar: AR["layerA.suspended"], en: EN["layerA.suspended"] },
  RETURNED: { sym: AR["layerA.returned.sym"], ar: AR["layerA.returned"], en: EN["layerA.returned"] },
  CANCELLED: { sym: AR["layerA.cancelled.sym"], ar: AR["layerA.cancelled"], en: EN["layerA.cancelled"] },
  FAILED: { sym: AR["layerA.failed.sym"], ar: AR["layerA.failed"], en: EN["layerA.failed"] },
  NOT_APPLICABLE: {
    sym: AR["layerA.notApplicable.sym"],
    ar: AR["layerA.notApplicable"],
    en: EN["layerA.notApplicable"],
  },
});
/** Layer B (expected process) — charter §3.6: ◇ + label, never ✔/●, never سُجل / اكتُمل / تم */
export const LAYER_B = Object.freeze({
  EXPECTED: { sym: AR["layerB.expected.sym"], ar: AR["layerB.expected"], en: EN["layerB.expected"] },
  CONDITIONAL: {
    sym: AR["layerB.conditional.sym"],
    ar: AR["layerB.conditional"],
    en: EN["layerB.conditional"],
    defaultCondition: {
      ar: AR["layerB.conditional.defaultCondition"],
      en: EN["layerB.conditional.defaultCondition"],
    },
  },
  OPTIONAL: { sym: AR["layerB.optional.sym"], ar: AR["layerB.optional"], en: EN["layerB.optional"] },
  ALTERNATIVE: {
    sym: AR["layerB.alternative.sym"],
    ar: AR["layerB.alternative"],
    en: EN["layerB.alternative"],
  },
  PARALLEL: { sym: AR["layerB.parallel.sym"], ar: AR["layerB.parallel"], en: EN["layerB.parallel"] },
  SUBJECT_TO_APPROVAL: {
    sym: AR["layerB.subjectToApproval.sym"],
    ar: AR["layerB.subjectToApproval"],
    en: EN["layerB.subjectToApproval"],
  },
});

export const S = Object.freeze({
  org: tk("ui.org"),
  to: tk("ui.to"),
  from: tk("ui.from"),
  date: tk("ui.date"),
  ref: tk("ui.ref"),
  caseRef: tk("ui.caseRef"),
  reportId: tk("ui.reportId"),
  classification: tk("ui.classification"),
  notAvailable: tk("ui.notAvailable"),
  noticeRef: tk("ui.noticeRef"),
  meetingAt: tk("ui.meetingAt"),
  meetingPlace: tk("ui.meetingPlace"),
  emailRefused: tk("ui.emailRefused"),
  suppressed: tk("ui.suppressed"),
  whatHappened: tk("ui.whatHappened"),
  recordedFact: tk("ui.recordedFact"),
  required: tk("ui.required"),
  how: tk("ui.how"),
  channel: {
    PLATFORM: tk("ui.channel.platform"),
    PORTAL: tk("ui.channel.portal"),
    SECRETARIAT_MAILBOX: tk("ui.channel.secretariatMailbox"),
  },
  whatNext: tk("ui.whatNext"),
  optionalRights: tk("ui.optionalRights"),
  draftBasis: tk("ui.draftBasis"),
  deadline: tk("ui.deadline"),
  deadlineBasis: tk("ui.deadlineBasis"),
  deadlineKinds: {
    GRIEVANCE_DUE: tk("ui.deadlineKinds.grievanceDue"),
    STATEMENT_DUE: tk("ui.deadlineKinds.statementDue"),
    DEFENCE_DUE: tk("ui.deadlineKinds.defenceDue"),
    MINUTES_REVIEW_DUE: tk("ui.deadlineKinds.minutesReviewDue"),
    INFO_REQUEST_DUE: tk("ui.deadlineKinds.infoRequestDue"),
    DECISION_NOTICE_DUE: tk("ui.deadlineKinds.decisionNoticeDue"),
    ATTENDANCE_CONFIRMATION_DUE: tk("ui.deadlineKinds.attendanceConfirmationDue"),
    DECISION_DUE: tk("ui.deadlineKinds.decisionDue"),
    VOTE_DUE: tk("ui.deadlineKinds.voteDue"),
    LEGAL_OPINION_DUE: tk("ui.deadlineKinds.legalOpinionDue"),
  },
  basisWithheld: tk("ui.basisWithheld"),
  open: tk("ui.open"),
  openFollowUp: tk("ui.openFollowUp"),
  openDefence: tk("ui.openDefence"),
  destination: tk("ui.destination"),
  linkUnavailable: tk("ui.linkUnavailable"),
  noDeepLink: tk("ui.noDeepLink"),
  mailboxHow: tk("ui.mailboxHow"),
  status: tk("ui.status"),
  level1: tk("ui.level1"),
  level2: tk("ui.level2"),
  capacity: tk("ui.capacity"),
  level3: tk("ui.level3"),
  stageOf: tk("ui.stageOf"),
  subState: tk("ui.subState"),
  noCasePath: tk("ui.noCasePath"),
  earlierStage: tk("ui.earlierStage"),
  laterStage: tk("ui.laterStage"),
  currentStage: tk("ui.currentStage"),
  currentStep: tk("ui.currentStep"),
  actualProgress: tk("ui.actualProgress"),
  expectedProcess: tk("ui.expectedProcess"),
  showExpected: tk("ui.showExpected"),
  closure: tk("ui.closure"),
  evidenceRecorded: tk("ui.evidenceRecorded"),
  details: tk("ui.details"),
  evidence: tk("ui.evidence"),
  rights: tk("ui.rights"),
  roles: {
    executor: tk("ui.roles.executor"),
    decision_maker: tk("ui.roles.decisionMaker"),
    approver: tk("ui.roles.approver"),
    preparer: tk("ui.roles.preparer"),
  },
  administrative: tk("ui.administrative"),
  formal: tk("ui.formal"),
  basisStatus: {
    APPROVED: tk("ui.basisStatus.approved"),
    OWNER_DECISION: tk("ui.basisStatus.ownerDecision"),
    DRAFT: tk("ui.basisStatus.draft"),
    SOURCE_REQUIRED: tk("ui.basisStatus.sourceRequired"),
  },
  holders: tk("ui.holders"),
  delivery: tk("ui.delivery"),
  deliveryNote: tk("ui.deliveryNote"),
  audit: tk("ui.audit"),
  confidentiality: tk("ui.confidentiality"),
  help: tk("ui.help"),
  helpGroup: tk("ui.helpGroup"),
  exception: tk("ui.exception"),
  previewFooter: tk("ui.previewFooter"),
  skip: tk("ui.skip"),
  simplified: tk("ui.simplified"),
  levelLine1: tk("ui.levelLine1"),
  levelLine3: tk("ui.levelLine3"),
  notADecision: tk("ui.notADecision"),
});

/** confidentiality wording per recipient group (PROPOSED) */
export const CONFIDENTIALITY = Object.freeze({
  INTERNAL: tk("confidentiality.internal"),
  RECUSED_MEMBER: tk("confidentiality.recusedMember"),
  WITNESS: tk("confidentiality.witness"),
  SUBJECT: tk("confidentiality.subject"),
  REPORTER: tk("confidentiality.reporter"),
  REFERRING_BODY: tk("confidentiality.referringBody"),
  EVIDENCE_HOLDER: tk("confidentiality.evidenceHolder"),
});
/** static help wording per recipient group (used when the `help` field is withheld or absent) */
export const HELP_STATIC = Object.freeze({
  INTERNAL: tk("helpStatic.internal"),
  EXTERNAL: tk("helpStatic.external"),
});
export const CLASSIFICATION = Object.freeze({
  PUBLIC: tk("classification.public"),
  INTERNAL: tk("classification.internal"),
  RESTRICTED: tk("classification.restricted"),
});

/** a bilingual value's text for `lang` (falls back to ar, then en); a scalar is stringified; null/undefined → '' */
export const pick = (v: unknown, lang: string): string => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    // the value is returned as stored (bilingual leaves are strings in every model this renderer receives)
    return (o[lang] ?? o.ar ?? o.en ?? "") as string;
  }
  return isNil(v) ? "" : String(v);
};
export const fill = (s: unknown, vars: Readonly<Record<string, unknown>>): string =>
  String(s).replace(/\{(\w+)\}/g, (_: string, k: string) => (isNil(vars[k]) ? "" : String(vars[k])));

/** Notification delivery wording (lead rulings L-07, L-02, L-04 — 27 Oct 2026). PROPOSED wording; the rules are the lead's. */
export const DELIVERY = Object.freeze({
  DRAFT: tk("delivery.draft"),
  NOT_SENT: tk("delivery.notSent"),
  SENT_EMAIL: tk("delivery.sentEmail"),
  DELIVERED_EMAIL_REPORT: tk("delivery.deliveredEmailReport"),
  IN_APP: tk("delivery.inApp"),
  FAILED: tk("delivery.failed"),
  CANCELLED: tk("delivery.cancelled"),
  OPENED: tk("delivery.opened"),
  CORRECTION_PREPARING: tk("delivery.correctionPreparing"),
  SUPERSEDED: tk("delivery.superseded"),
  UNKNOWN: tk("delivery.unknown"),
});
