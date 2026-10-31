import "server-only";
import { isNil } from "@/lib/domain/nil";
/**
 * CDF Notifications V13 — interface strings for the renderers (W-D2). Arabic and English side by side.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION. All wording here is PROPOSED (not approved); the Layer A / Layer B labels are the
 * charter §3.6 wording (FACT: CHARTER.md).
 */
export const MARKING = "عرض تجريبي — بيانات اصطناعية | DESIGN_PREVIEW — SYNTHETIC DATA";
export const MARKING_SUBJECT_PREFIX = "[DESIGN_PREVIEW]";

/** Layer A (actual progress) — charter §3.6. Symbols carry U+FE0E (text presentation) where an emoji form exists. */
export const LAYER_A = Object.freeze({
  COMPLETED: { sym: "✔︎", ar: "اكتمل — تم تسجيل الإجراء", en: "Completed — the action is recorded" },
  IN_PROGRESS: { sym: "●", ar: "جارٍ", en: "In progress" },
  PENDING: { sym: "○", ar: "بانتظار إجراء محدد", en: "Awaiting a specific action" },
  SUSPENDED: { sym: "⏸︎", ar: "موقوف مؤقتاً", en: "Suspended" },
  RETURNED: { sym: "↩︎", ar: "أُعيد لاستكمال متطلبات", en: "Returned for requirements to be completed" },
  CANCELLED: { sym: "✕", ar: "أُلغي", en: "Cancelled" },
  FAILED: { sym: "⚠︎", ar: "تعذر إتمامه", en: "Could not be completed" },
  NOT_APPLICABLE: { sym: "—", ar: "لا ينطبق", en: "Not applicable" },
});
/** Layer B (expected process) — charter §3.6: ◇ + label, never ✔/●, never سُجل / اكتُمل / تم */
export const LAYER_B = Object.freeze({
  EXPECTED: { sym: "◇", ar: "خطوة متوقعة", en: "Expected step" },
  CONDITIONAL: {
    sym: "◇",
    ar: "خطوة محتملة — بحسب",
    en: "Possible step — depending on",
    defaultCondition: { ar: "تحقق شرطها", en: "whether its condition is met" },
  },
  OPTIONAL: { sym: "◇", ar: "خطوة اختيارية", en: "Optional step" },
  ALTERNATIVE: { sym: "◇", ar: "مسار بديل", en: "Alternative path" },
  PARALLEL: { sym: "◇", ar: "بالتوازي", en: "In parallel" },
  SUBJECT_TO_APPROVAL: { sym: "◇", ar: "رهن الاعتماد", en: "Subject to approval" },
});

export interface BiText {
  readonly ar: string;
  readonly en: string;
}
const t = <A extends string, E extends string>(ar: A, en: E): { readonly ar: A; readonly en: E } =>
  Object.freeze({ ar, en });
export const S = Object.freeze({
  org: t(
    "صندوق التنمية الثقافي — منصة إدارة القضايا والتحقيقات (عرض تجريبي)",
    "Cultural Development Fund — Case Management & Investigation Platform (design preview)",
  ),
  to: t("إلى", "To"),
  from: t("من", "From"),
  date: t("التاريخ", "Date"),
  ref: t("المرجع", "Reference"),
  caseRef: t("مرجع الحالة", "Case reference"),
  reportId: t("رقم البلاغ", "Report ID"),
  classification: t("التصنيف", "Classification"),
  notAvailable: t("غير متاح", "Not available"),
  noticeRef: t("مرجع الإشعار", "Notice reference"),
  meetingAt: t("موعد الجلسة", "Session time"),
  meetingPlace: t("المكان", "Place"),
  emailRefused: t(
    "لا يُرسل هذا الإشعار بالبريد لهذه الفئة",
    "This notice is not sent by e-mail to this class",
  ),
  suppressed: t("لا يُنشأ إشعار لهذا المستلم", "No notification is generated for this recipient"),
  whatHappened: t("ما الذي حدث", "What happened"),
  recordedFact: t("واقعة مسجّلة", "Recorded fact"),
  required: t("الإجراء المطلوب منكم", "What you need to do"),
  how: t("طريقة التنفيذ", "How"),
  channel: {
    PLATFORM: t("عبر المنصة", "Through the platform"),
    PORTAL: t("عبر صفحتكم المخصصة", "Through your own page"),
    SECRETARIAT_MAILBOX: t(
      "بالرد على صندوق بريد الأمانة المعتمد (دون إرفاق أي معلومات عن الوقائع)",
      "By replying to the approved secretariat mailbox (without attaching any information about the facts)",
    ),
  },
  whatNext: t("ما يُتوقع بعد ذلك", "What is expected next"),
  optionalRights: t("حقوق اختيارية", "Optional rights"),
  draftBasis: t(
    "سند هذا الإجراء مسودة غير معتمدة — يُعرض لأغراض التصميم فقط",
    "The basis of this action is an unapproved draft — shown for design purposes only",
  ),
  deadline: t("الموعد النهائي", "Deadline"),
  deadlineBasis: t("سند الموعد", "Basis of the deadline"),
  deadlineKinds: {
    GRIEVANCE_DUE: t("آخر موعد لتقديم التظلم (اختياري)", "Last day to file a grievance (optional)"),
    STATEMENT_DUE: t("موعد تقديم الإفادة", "Statement due"),
    DEFENCE_DUE: t("موعد تقديم الدفاع", "Defence due"),
    MINUTES_REVIEW_DUE: t("موعد مراجعة المحضر", "Minutes review due"),
    INFO_REQUEST_DUE: t("موعد إرسال طلب البيانات", "Information request due"),
    DECISION_NOTICE_DUE: t("موعد إصدار إشعار القرار", "Decision notice due"),
    ATTENDANCE_CONFIRMATION_DUE: t("موعد تأكيد الحضور", "Attendance confirmation due"),
    DECISION_DUE: t("موعد اتخاذ القرار", "Decision due"),
    VOTE_DUE: t("موعد التصويت", "Vote due"),
    LEGAL_OPINION_DUE: t("موعد تقديم الرأي القانوني", "Legal opinion due"),
  },
  basisWithheld: t(
    "سند الموعد مسجّل لدى الأمانة",
    "The basis of the deadline is on record with the secretariat",
  ),
  open: t("فتح الإجراء", "Open the item"),
  openFollowUp: t("متابعة البلاغ في البوابة", "Follow up your report on the portal"),
  openDefence: t("فتح صفحة «دفاعي»", 'Open the "My defence" page'),
  destination: t("الوجهة", "Destination"),
  linkUnavailable: t("الرابط غير متاح", "The link is not available"),
  noDeepLink: t(
    "لا يتوفر رابط مباشر لهذا العنصر؛ سجّلوا الدخول إلى المنصة من عنوانها المعتاد",
    "No direct link exists for this item; sign in to the platform from its usual address",
  ),
  mailboxHow: t(
    "لا تُرسل روابط في هذا الإشعار؛ يكون الرد على صندوق بريد الأمانة المعتمد",
    "This notice carries no links; reply to the approved secretariat mailbox",
  ),
  status: t("موقف الإجراء", "Procedure status"),
  level1: t(
    "المستوى 1 — موقع الحالة في مسارها الرئيسي",
    "Level 1 — where the case stands on its master journey",
  ),
  level2: t("المستوى 2 — مسار", "Level 2 — journey of"),
  capacity: t("بصفتكم", "Your capacity"),
  level3: t("المستوى 3 — خطوات الإجراء", "Level 3 — steps of the procedure"),
  stageOf: t("المرحلة {n} من {of}", "Stage {n} of {of}"),
  subState: t("الحالة الفرعية", "Sub-state"),
  noCasePath: t(
    "لا يوجد مسار حالة — لم تُسجَّل حالة بعد",
    "No case journey — no case has been registered yet",
  ),
  earlierStage: t("مرحلة سابقة", "Earlier stage"),
  laterStage: t("مرحلة لاحقة", "Later stage"),
  currentStage: t("المرحلة الحالية", "Current stage"),
  currentStep: t("الخطوة الحالية", "Current step"),
  actualProgress: t("ما سُجّل فعلاً", "What has actually been recorded"),
  expectedProcess: t("المسار المتوقع (لم يقع بعد)", "Expected process (has not happened yet)"),
  showExpected: t("عرض الخطوات المتوقعة", "Show the expected steps"),
  closure: t("نطاق الإقفال", "What closes"),
  evidenceRecorded: t("مسجّل بحدث موثّق", "Recorded with a documented event"),
  details: t("تفاصيل لأصحاب الاختصاص", "Details for authorised users"),
  evidence: t("مراجع الأحداث المسجّلة", "References of recorded events"),
  rights: t("صلاحيتكم في هذا الإجراء", "Your authority for this action"),
  roles: {
    executor: t("منفّذ", "Executor"),
    decision_maker: t("صاحب القرار", "Decision maker"),
    approver: t("معتمِد", "Approver"),
    preparer: t("معِدّ", "Preparer"),
  },
  administrative: t("إجراء إداري تنسيقي — لا يُعد قراراً", "Administrative coordination — not a decision"),
  formal: t("إجراء رسمي", "Formal act"),
  basisStatus: {
    APPROVED: t("السند: مصدر معتمد", "Basis: approved source"),
    OWNER_DECISION: t("السند: قرار المالك", "Basis: the owner's decision"),
    DRAFT: t("السند: مسودة غير معتمدة", "Basis: unapproved draft"),
    SOURCE_REQUIRED: t(
      "السند: مطلوب مصدر معتمد — التنفيذ موقوف",
      "Basis: an approved source is required — execution is blocked",
    ),
  },
  holders: t("أعضاء اللجنة المعنيون", "Committee members concerned"),
  delivery: t("حالة الإشعار", "Notification status"),
  deliveryNote: t(
    "الإرسال لا يعني التسليم، والتسليم أو الفتح لا يعني الإقرار بالتسلّم؛ الإقرار سجل مستقل",
    "Sending does not mean delivery, and delivery or opening does not mean acknowledgement; acknowledgement is a separate record",
  ),
  audit: t("مرجع سجل التدقيق", "Audit ledger reference"),
  confidentiality: t("السرية", "Confidentiality"),
  help: t("المساعدة", "Help"),
  helpGroup: t("السرية والمساعدة", "Confidentiality and help"),
  exception: t("تنبيه إجرائي", "Procedural alert"),
  previewFooter: t(
    "هذه معاينة تصميمية ببيانات اصطناعية؛ لم يُتحقق من طريقة عرضها في برامج البريد (Outlook / Gmail / Apple Mail).",
    "This is a design preview with synthetic data; its rendering in mail clients (Outlook / Gmail / Apple Mail) is UNVERIFIED.",
  ),
  skip: t("تخطَّ إلى محتوى الإشعار", "Skip to the notification"),
  simplified: t("ملخص الموقف", "Status at a glance"),
  levelLine1: t("الحالة", "Case"),
  levelLine3: t("الخطوة الحالية", "Current step"),
  notADecision: t(
    "هذا إشعار إجرائي وليس قراراً، ولا يُغني عن الإجراء الرسمي.",
    "This is a procedural notice, not a decision, and does not replace the formal act.",
  ),
});

/** confidentiality wording per recipient group (PROPOSED) */
export const CONFIDENTIALITY = Object.freeze({
  INTERNAL: t(
    "هذا الإشعار سري ومخصّص لصفتكم في الإجراء؛ لا تُعيدوا توجيهه ولا تنقلوا محتواه خارج المنصة.",
    "This notice is confidential and addressed to your capacity in the procedure; do not forward it or move its content outside the platform.",
  ),
  RECUSED_MEMBER: t(
    "أنتم متنحّون عن هذا البند؛ لا يتضمن هذا الإشعار أي مداولات أو أصوات أو أسماء.",
    "You are recused from this item; this notice contains no deliberations, votes or names.",
  ),
  WITNESS: t(
    "تذكير بواجب السرية: لا تُفصحوا عن موعد الجلسة أو موضوعها أو ما يدور فيها لأي جهة.",
    "Confidentiality reminder: do not disclose the hearing, its subject or what happens in it to anyone.",
  ),
  SUBJECT: t(
    "هذا الإشعار يخصّكم وحدكم؛ يقتصر على ما تحتاجونه لممارسة حقوقكم الإجرائية.",
    "This notice concerns you alone; it carries only what you need to exercise your procedural rights.",
  ),
  REPORTER: t(
    "لا يتضمن هذا التحديث أي معلومات عن هويتك أو عن تفاصيل المعالجة الداخلية.",
    "This update contains no information about your identity or about the internal handling.",
  ),
  REFERRING_BODY: t(
    "يقتصر هذا الإشعار على المعلومات المصرّح بإبلاغها لجهتكم.",
    "This notice is limited to the information authorised for your organisation.",
  ),
  EVIDENCE_HOLDER: t(
    "يقتصر هذا الإشعار على ما يلزم لتقديم المطلوب منكم.",
    "This notice is limited to what you need to provide what is requested.",
  ),
});
/** static help wording per recipient group (used when the `help` field is withheld or absent) */
export const HELP_STATIC = Object.freeze({
  INTERNAL: t(
    "للاستفسار عن هذا الإشعار: أمانة اللجنة عبر المنصة.",
    "Questions about this notice: the committee secretariat, through the platform.",
  ),
  EXTERNAL: t(
    "للاستفسار عن هذا الإشعار: الجهة المرسلة عبر القناة المذكورة فيه.",
    "Questions about this notice: the sender, through the channel it names.",
  ),
});
export const CLASSIFICATION = Object.freeze({
  PUBLIC: t("عام", "Public"),
  INTERNAL: t("داخلي — سري", "Internal — confidential"),
  RESTRICTED: t("مقيد — سري للغاية", "Restricted — highly confidential"),
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
  DRAFT: t("مسودة — لم يُرسل", "Draft — not sent"),
  NOT_SENT: t("لم يُرسل بعد", "Not sent yet"),
  SENT_EMAIL: t("أُرسل — لم يُؤكَّد التسليم", "Sent — delivery not confirmed"),
  DELIVERED_EMAIL_REPORT: t(
    "سُلِّم بحسب تقرير تسليم من مزوّد البريد",
    "Delivered according to a delivery report from the mail provider",
  ),
  IN_APP: t("وصل إلى صندوق الإشعارات في المنصة", "In the platform notification inbox"),
  FAILED: t("تعذّر الإرسال", "Sending failed"),
  CANCELLED: t("أُلغي ولم يُرسل", "Cancelled — not sent"),
  OPENED: t("فُتح — الفتح ليس إقراراً بالتسلّم", "Opened — opening is not an acknowledgement"),
  CORRECTION_PREPARING: t(
    "يجري إعداد تصحيح؛ هذا الإشعار ما زال النسخة السارية",
    "A correction is being prepared; this notice is still the current version",
  ),
  SUPERSEDED: t("استُبدل بنسخة مصحَّحة أُرسلت", "Superseded by a corrected version that has been sent"),
  UNKNOWN: t("حالة غير معروفة", "Unknown status"),
});
