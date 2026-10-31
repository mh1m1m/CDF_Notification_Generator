import "server-only";
/**
 * CDF Notifications V13 — Smart next authorized action (charter §7). Workstream W-D2.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Rules and wording are PROPOSAL (Level-2/3 wording PROPOSED).
 * PRODUCTION_SUBSTITUTION_REQUIRED: in the platform the next action is derived server-side from the procedural read model and
 * the authorization layer (@cdf/authorization + authz.*); deep links come from notify.deep_link (migration 1920).
 *
 * deriveNextAction({notification_type, recipient, procedural_object, case, authority_check, authority_model, events}) →
 *   {kind, ar, en, deadline|null, deadline_reason|null, how:{channel, link_kind, app?, path?}, what_next:[{kind, ar, en}],
 *    informational, epistemic:'PROPOSED_ACTION', authority:{action_id, result, code, administrative, release_status},
 *    optional_rights:[…], rule_id, release_status}
 *
 * Rules (charter §7, FACT):
 *  - the action kind must be ALLOWED by authority.check for the recipient's capacity; otherwise READ_ONLY (text starts
 *    «للاطلاع فقط — » followed by the reason; no link, no deadline);
 *  - a deadline is emitted only with a recorded basis event and a rule id; otherwise null + reason SOURCE_REQUIRED;
 *  - an informational notice prints exactly «للاطلاع فقط — لا يلزم إجراء حالياً»;
 *  - what_next items are Layer B (expected process): never the completed symbol, never the words سُجل / اكتُمل / تم.
 * Capacity is read only from recipient.actor.capacity — never inferred from a class name or a title.
 */
import { check, loadAuthority, isAllowed } from "@/lib/authority/check";
import { isNil } from "@/lib/domain/nil";

export const NEXT_ACTION_KINDS = Object.freeze([
  "SUBMIT_STATEMENT",
  "REVIEW_MINUTES",
  "COMPLETE_DOCUMENTS",
  "GIVE_OPINION",
  "DECIDE",
  "APPROVE_ACTION",
  "READ_ONLY",
  "NONE",
] as const);
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];
export const HOW_CHANNELS = Object.freeze(["PLATFORM", "PORTAL", "SECRETARIAT_MAILBOX"] as const);
export type HowChannel = (typeof HOW_CHANNELS)[number];
export const LINK_KINDS = Object.freeze(["PLATFORM_DEEP_LINK", "PORTAL_LINK", "NONE"] as const);
export type LinkKind = (typeof LINK_KINDS)[number];
export const WHAT_NEXT_KINDS = Object.freeze([
  "EXPECTED",
  "CONDITIONAL",
  "OPTIONAL",
  "ALTERNATIVE",
  "PARALLEL",
  "SUBJECT_TO_APPROVAL",
] as const);
export type WhatNextKind = (typeof WHAT_NEXT_KINDS)[number];

export interface BiText {
  ar: string;
  en: string;
}
export interface WhatNextItem {
  readonly kind: WhatNextKind;
  readonly ar: string;
  readonly en: string;
}

/** charter §7 exact wording for informational notices */
export const INFORMATIONAL_TEXT = Object.freeze({
  ar: "للاطلاع فقط — لا يلزم إجراء حالياً",
  en: "For information only — no action is required at this time",
} as const);
export const READ_ONLY_PREFIX = Object.freeze({
  ar: "للاطلاع فقط — ",
  en: "For information only — ",
} as const);

/** Arabic words a Layer-B statement never uses (charter §3.6); matched as whole words after removing tatweel */
const FORBIDDEN_LAYER_B = ["سُجل", "سُجّل", "سجّل", "اكتُمل", "اكتمل", "تم", "تمّ"];
const FORBIDDEN_SYMBOLS = ["✔", "●"];
export function layerBViolations(text: unknown): string[] {
  const t = String(text ?? "").replace(/ـ/g, "");
  const words = t.split(/[\s.,;:!؟?،؛()«»"'\-—–/]+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) if (FORBIDDEN_LAYER_B.includes(w)) out.push(w);
  for (const s of FORBIDDEN_SYMBOLS) if (t.includes(s)) out.push(s);
  return out;
}

/** mirror of notify.deep_link (migration 20261007001920, FACT): object types without a mapping have no deep link */
const DEEP_LINK_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  COMMITTEE: "/committees/",
  MEETING: "/meetings/",
  MINUTES: "/minutes/",
  LEGAL_REVIEW: "/legal-reviews/",
  DEFENCE_NOTICE: "/my-defence/",
  GRIEVANCE: "/grievances/",
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function deepLinkPath(objectType: unknown, objectId: unknown): string | null {
  const key = String(objectType);
  const p = Object.hasOwn(DEEP_LINK_PREFIX, key) ? DEEP_LINK_PREFIX[key] : undefined;
  if (!p || !UUID_RE.test(String(objectId))) return null;
  return p + String(objectId);
}

const NO_DEADLINE = Object.freeze({
  NO_DEADLINE_RECORD: {
    ar: "لا يوجد موعد نهائي مسجّل لهذا الإجراء — المصدر المعتمد مطلوب",
    en: "No deadline is recorded for this action — an approved source is required",
  },
  NO_BASIS_EVENT: {
    ar: "لا يُعرض موعد نهائي: لا يوجد حدث بدء مسجّل",
    en: "No deadline is shown: no starting event is recorded",
  },
  NO_BASIS_RULE: {
    ar: "لا يُعرض موعد نهائي: لا توجد قاعدة معتمدة للمدة",
    en: "No deadline is shown: no approved rule sets the period",
  },
  RULE_SOURCE_REQUIRED: {
    ar: "لا يُعرض موعد نهائي: مدة الإجراء غير محددة بمصدر معتمد",
    en: "No deadline is shown: the period has no approved source",
  },
  BASIS_EVENT_NOT_RECORDED: {
    ar: "لا يُعرض موعد نهائي: حدث البدء لم يُسجَّل بعد",
    en: "No deadline is shown: the starting event is not recorded yet",
  },
  BASIS_EVENT_TYPE_MISMATCH: {
    ar: "لا يُعرض موعد نهائي: حدث البدء المسجّل لا يطابق القاعدة",
    en: "No deadline is shown: the recorded starting event does not match the rule",
  },
  INVALID_DATE: {
    ar: "لا يُعرض موعد نهائي: التاريخ غير صالح أو بلا منطقة زمنية",
    en: "No deadline is shown: the date is invalid or has no time zone",
  },
});
export type NoDeadlineDetail = keyof typeof NO_DEADLINE;
const ZONED_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** a deadline as a procedural object records it (charter §3.2) */
export interface DeadlineRecord {
  kind?: string | null;
  at?: unknown;
  basis_event_id?: string | null;
  basis_rule?: unknown;
  basis_event_type?: string | null;
  [k: string]: unknown;
}
export interface ResolvedDeadline {
  kind: string | null;
  at: string;
  basis_event_id: string;
  basis_rule: string;
  basis_event_type: string | undefined;
}
export interface DeadlineReason {
  code: "SOURCE_REQUIRED";
  detail: NoDeadlineDetail;
  kind: string | null;
  ar: string;
  en: string;
}
export interface DeadlineResolution {
  deadline: ResolvedDeadline | null;
  reason: DeadlineReason | null;
}
/** an event as the deadline and authority checks read it */
export interface EventLike {
  event_id?: string | null;
  type?: string;
  event_type?: string;
  payload?: unknown;
  recorded_at?: string | null;
  [k: string]: unknown;
}

/** A deadline passes only with a date that carries a zone, a basis event that is recorded, and a rule id that is not
 *  SOURCE_REQUIRED (charter §3.5 safe inference; §7). Returns {deadline, reason}. */
export function resolveDeadline(
  record: DeadlineRecord | null | undefined,
  events: readonly (EventLike | null | undefined)[] | null = [],
): DeadlineResolution {
  const why = (detail: NoDeadlineDetail): DeadlineResolution => ({
    deadline: null,
    reason: { code: "SOURCE_REQUIRED", detail, kind: record?.kind ?? null, ...NO_DEADLINE[detail] },
  });
  if (!record || typeof record !== "object") return why("NO_DEADLINE_RECORD");
  if (!record.basis_event_id) return why("NO_BASIS_EVENT");
  const rule = isNil(record.basis_rule) ? "" : String(record.basis_rule).trim();
  if (!rule) return why("NO_BASIS_RULE");
  if (/SOURCE_REQUIRED/i.test(rule)) return why("RULE_SOURCE_REQUIRED");
  const ev = (events || []).find((e) => e && e.event_id === record.basis_event_id);
  if (!ev) return why("BASIS_EVENT_NOT_RECORDED");
  const evType = ev.type ?? ev.event_type;
  if (record.basis_event_type && evType !== record.basis_event_type) return why("BASIS_EVENT_TYPE_MISMATCH");
  if (typeof record.at !== "string" || !ZONED_ISO.test(record.at) || Number.isNaN(Date.parse(record.at)))
    return why("INVALID_DATE");
  return {
    deadline: {
      kind: record.kind ?? null,
      at: record.at,
      basis_event_id: record.basis_event_id,
      basis_rule: rule,
      basis_event_type: evType,
    },
    reason: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Rules per notification type and recipient class (PROPOSAL; wording PROPOSED). `action_id: null` = informational.
// ---------------------------------------------------------------------------------------------------------------
export interface RuleHow {
  channel: HowChannel;
  link_kind: LinkKind;
  app?: string;
  path?: string;
  deep_link?: boolean;
}
export interface OptionalRightRule {
  action_id: string;
  deadline_kind?: string | null;
  ar: string;
  en: string;
  object_extra?: Readonly<Record<string, unknown>>;
}
export interface Rule {
  id: string;
  action_id: string | null;
  kind?: NextActionKind;
  how?: RuleHow;
  deadline_kind?: string | null;
  object_extra?: Readonly<Record<string, unknown>>;
  text?: BiText;
  read_only?: Readonly<Record<string, BiText>>;
  what_next?: readonly WhatNextItem[];
  what_next_read_only?: readonly WhatNextItem[];
  optional_rights?: readonly OptionalRightRule[];
}
const HOW = Object.freeze({
  platformDeep: {
    channel: "PLATFORM",
    link_kind: "PLATFORM_DEEP_LINK",
    app: "INVESTIGATION_WEB",
    deep_link: true,
  },
  platform: { channel: "PLATFORM", link_kind: "NONE", app: "INVESTIGATION_WEB" },
  mailbox: { channel: "SECRETARIAT_MAILBOX", link_kind: "NONE" },
  reporterPortal: {
    channel: "PORTAL",
    link_kind: "PORTAL_LINK",
    app: "WHISTLEBLOWING_WEB",
    path: "/follow-up",
  },
  subjectPortal: { channel: "PORTAL", link_kind: "PORTAL_LINK", app: "INVESTIGATION_WEB", deep_link: true },
  subjectNoLink: { channel: "PORTAL", link_kind: "NONE", app: "INVESTIGATION_WEB" },
} satisfies Record<string, RuleHow>);
const wn = (kind: WhatNextKind, ar: string, en: string): WhatNextItem => Object.freeze({ kind, ar, en });
const SR_HOLD = (ar: string, en: string): Record<string, BiText> => ({ SOURCE_REQUIRED: { ar, en } });

export const RULES: Readonly<Record<string, Readonly<Record<string, Rule>>>> = Object.freeze({
  CHAIR_DIRECTION_INFO: {
    SECRETARY: {
      id: "NA-R-CF18-SEC",
      action_id: "SEND_INFO_REQUEST",
      kind: "COMPLETE_DOCUMENTS",
      how: HOW.platformDeep,
      deadline_kind: "INFO_REQUEST_DUE",
      text: {
        ar: "إعداد طلب البيانات وإرساله وفق توجيه رئيس اللجنة",
        en: "Prepare and send the information request as directed by the chair",
      },
      read_only: SR_HOLD(
        "إرسال طلب البيانات موقوف إلى حين اعتماد مصدر لهذا الطلب",
        "Sending the information request is on hold until a source for this request is approved",
      ),
      what_next: [
        wn(
          "EXPECTED",
          "ورود البيانات المطلوبة من الجهة المعنية",
          "The requested information arrives from the unit concerned",
        ),
        wn("EXPECTED", "عرض النتيجة على رئيس اللجنة", "The result goes to the chair"),
      ],
      what_next_read_only: [
        wn(
          "CONDITIONAL",
          "إرسال طلب البيانات — بعد اعتماد مصدر لهذا الطلب",
          "Sending the information request — once a source for it is approved",
        ),
      ],
    },
    CHAIR: {
      id: "NA-R-CF18-CHAIR",
      action_id: null,
      how: HOW.platform,
      what_next: [
        wn(
          "EXPECTED",
          "تنفيذ التوجيه من الأمانة المنفذة",
          "The executing secretariat carries out the direction",
        ),
        wn("EXPECTED", "عرض النتيجة عليكم", "The result is presented to you"),
      ],
    },
  },
  CHAIR_DIRECTION_VOTE: {
    SECRETARY: {
      id: "NA-R-CF19-SEC",
      action_id: "OPEN_FORMAL_VOTE",
      kind: "APPROVE_ACTION",
      how: HOW.platformDeep,
      deadline_kind: null,
      text: {
        ar: "فتح بند التصويت في الاجتماع المنعقد وفق توجيه رئيس اللجنة",
        en: "Open the vote item in the meeting in session, as directed by the chair",
      },
      read_only: {
        ...SR_HOLD(
          "فتح بند التصويت موقوف إلى حين اعتماد مصدر الإجراء",
          "Opening the vote item is on hold until the governing source is approved",
        ),
        PRECONDITION_MISSING: {
          ar: "يُفتح بند التصويت أثناء اجتماع منعقد؛ لم يُسجَّل افتتاح الاجتماع بعد",
          en: "A vote item is opened in a meeting in session; the opening of the meeting is not recorded yet",
        },
        EXPIRED: {
          ar: "أُغلق الاجتماع؛ لا يُفتح بند التصويت بعد إغلاقه",
          en: "The meeting is closed; the vote item cannot be opened after closure",
        },
      },
      what_next: [
        wn("EXPECTED", "تصويت الأعضاء غير المتنحّين", "Vote by the members who are not recused"),
        wn("EXPECTED", "إغلاق التصويت واحتساب النتيجة", "The vote is closed and the result counted"),
      ],
    },
    CHAIR: {
      id: "NA-R-CF19-CHAIR",
      action_id: null,
      how: HOW.platform,
      what_next: [
        wn(
          "EXPECTED",
          "فتح بند التصويت من الأمانة أثناء الاجتماع",
          "The secretariat opens the vote item during the meeting",
        ),
        wn(
          "CONDITIONAL",
          "تصويتكم مع الأعضاء — عند فتح بند التصويت",
          "Your vote with the members — when the vote item is opened",
        ),
      ],
    },
  },
  PACKAGE_SUBMITTED_FOR_DELIBERATION: {
    MEMBER: {
      id: "NA-R-CF31-MEM",
      action_id: "CAST_VOTE",
      kind: "DECIDE",
      how: HOW.platformDeep,
      deadline_kind: "VOTE_DUE",
      object_extra: { own_vote: true },
      text: { ar: "التصويت على التوصيات المعروضة", en: "Vote on the recommendations presented" },
      read_only: {
        PRECONDITION_MISSING: {
          ar: "لم يُفتح التصويت بعد؛ ستُبلَّغون عند فتح بند التصويت",
          en: "The vote is not open yet; you will be notified when the vote item is opened",
        },
        RECUSED: {
          ar: "أنتم متنحّون عن هذا البند؛ لا يلزمكم أي إجراء",
          en: "You are recused from this item; no action is required from you",
        },
      },
      what_next: [
        wn("EXPECTED", "المداولة في اجتماع اللجنة", "Deliberation at the committee's meeting"),
        wn("CONDITIONAL", "التصويت — عند فتح بند التصويت", "The vote — when the vote item is opened"),
      ],
    },
    RECUSED_MEMBER: {
      id: "NA-R-CF31-REC",
      action_id: "CAST_VOTE",
      kind: "DECIDE",
      how: HOW.platform,
      deadline_kind: null,
      object_extra: { own_vote: true },
      text: { ar: "التصويت على التوصيات المعروضة", en: "Vote on the recommendations presented" },
      read_only: {
        RECUSED: {
          ar: "أنتم متنحّون عن هذا البند؛ لا يلزمكم أي إجراء",
          en: "You are recused from this item; no action is required from you",
        },
      },
      what_next: [],
      what_next_read_only: [],
    },
    SECRETARY: {
      id: "NA-R-CF31-SEC",
      action_id: "SCHEDULE_MEETING",
      kind: "COMPLETE_DOCUMENTS",
      how: HOW.platformDeep,
      deadline_kind: null,
      text: {
        ar: "جدولة اجتماع اللجنة للمداولة في التوصية وإعداد الدعوات",
        en: "Schedule the committee meeting to deliberate on the recommendation and prepare the invitations",
      },
      read_only: SR_HOLD(
        "جدولة الاجتماع موقوفة إلى حين اعتماد مصدر الإجراء",
        "Scheduling the meeting is on hold until the governing source is approved",
      ),
      what_next: [
        wn("EXPECTED", "المداولة في اجتماع اللجنة", "Deliberation at the committee's meeting"),
        wn("EXPECTED", "فتح بند التصويت أثناء الاجتماع", "The vote item is opened during the meeting"),
      ],
    },
    RESTRICTED_CASE_AUTHORITY: {
      id: "NA-R-CF31-RCA",
      action_id: null,
      how: HOW.platform,
      what_next: [wn("EXPECTED", "المداولة في اجتماع اللجنة", "Deliberation at the committee's meeting")],
    },
  },
  AUTHORITY_DECISION_RECORDED: {
    SECRETARY: {
      id: "NA-R-CF35-SEC",
      action_id: "ISSUE_DECISION_NOTICE",
      kind: "COMPLETE_DOCUMENTS",
      how: HOW.platform,
      deadline_kind: "DECISION_NOTICE_DUE",
      text: {
        ar: "إعداد إشعار القرار للطرف المعني وإصداره",
        en: "Prepare and issue the decision notice to the party concerned",
      },
      what_next: [
        wn("EXPECTED", "تبليغ الطرف المعني بالقرار", "The party concerned is notified of the decision"),
        wn("EXPECTED", "إقفال مسار التوصية", "The recommendation path closes"),
      ],
    },
    CHAIR: {
      id: "NA-R-CF35-CHAIR",
      action_id: null,
      how: HOW.platform,
      what_next: [
        wn(
          "EXPECTED",
          "إصدار الأمانة إشعارَ القرار للطرف المعني",
          "The secretariat issues the decision notice to the party concerned",
        ),
      ],
    },
    MEMBER: {
      id: "NA-R-CF35-MEM",
      action_id: null,
      how: HOW.platform,
      what_next: [
        wn(
          "EXPECTED",
          "إصدار الأمانة إشعارَ القرار للطرف المعني",
          "The secretariat issues the decision notice to the party concerned",
        ),
      ],
    },
  },
  DECISION_NOTICE_ISSUED: {
    SUBJECT: {
      id: "NA-R-CF37-SUB",
      action_id: null,
      how: HOW.subjectNoLink,
      optional_rights: [
        {
          action_id: "FILE_GRIEVANCE",
          deadline_kind: "GRIEVANCE_DUE",
          ar: "يحق لكم التظلم من القرار خلال المهلة المحددة",
          en: "You may file a grievance against the decision within the set period",
        },
      ],
      what_next: [
        wn(
          "CONDITIONAL",
          "النظر في التظلم والبت فيه — عند تقديمه",
          "The grievance is considered and decided — if you file one",
        ),
      ],
    },
  },
  // CF-37 after effective delivery: the grievance window has started (DEC-F15: the clock starts at effective delivery)
  GRIEVANCE_WINDOW_STARTED: {
    SUBJECT: {
      id: "NA-R-CF37D-SUB",
      action_id: null,
      how: HOW.subjectNoLink,
      optional_rights: [
        {
          action_id: "FILE_GRIEVANCE",
          deadline_kind: "GRIEVANCE_DUE",
          ar: "يحق لكم التظلم من القرار قبل انتهاء المهلة",
          en: "You may file a grievance against the decision before the period ends",
        },
      ],
      what_next: [
        wn("EXPECTED", "انتهاء مهلة التظلم في موعدها", "The grievance period ends on its date"),
        wn(
          "CONDITIONAL",
          "النظر في التظلم والبت فيه — عند تقديمه",
          "The grievance is considered and decided — if you file one",
        ),
      ],
    },
  },
  WITNESS_SUMMONS: {
    WITNESS: {
      id: "NA-R-INV10-WIT",
      action_id: "GIVE_WITNESS_STATEMENT",
      kind: "SUBMIT_STATEMENT",
      how: HOW.mailbox,
      deadline_kind: "ATTENDANCE_CONFIRMATION_DUE",
      text: {
        ar: "حضور جلسة الاستماع في الموعد المحدد والإدلاء بإفادتكم، وتأكيد الحضور بالرد على صندوق بريد الأمانة",
        en: "Attend the hearing at the set time and give your testimony; confirm attendance by replying to the secretariat mailbox",
      },
      what_next: [
        wn("EXPECTED", "تذكيركم بواجب السرية قبل الجلسة", "A confidentiality reminder before the hearing"),
        wn(
          "EXPECTED",
          "تحرير محضر إفادتكم وإتاحة طلب تصحيحه",
          "Your statement record is drafted and you may request a correction",
        ),
      ],
    },
  },
  REPORT_STATUS_CHANGED: {
    REPORTER: {
      id: "NA-R-CF14-RPT",
      action_id: null,
      how: HOW.reporterPortal,
      what_next: [
        wn(
          "EXPECTED",
          "إبلاغك بالمآل المصرح به عند صدوره",
          "You are told the authorised outcome when it is issued",
        ),
      ],
    },
  },
  INSTITUTIONAL_REFERRAL_RECEIPT: {
    REFERRING_BODY: { id: "NA-R-CF11-REF", action_id: null, how: HOW.mailbox, what_next: [] },
  },
  INTERVIEW_NOTICE: {
    SUBJECT: {
      id: "NA-R-CF21-SUB",
      action_id: "SUBMIT_STATEMENT",
      kind: "SUBMIT_STATEMENT",
      how: HOW.subjectNoLink,
      deadline_kind: "STATEMENT_DUE",
      text: {
        ar: "حضور جلسة الإفادة في الموعد المحدد، أو تقديم ردّكم الكتابي عبر القناة المعتمدة",
        en: "Attend the statement session at the set time, or give your written reply through the approved channel",
      },
      what_next: [
        wn(
          "EXPECTED",
          "إشعارك بالوقائع المنسوبة وتمكينك من الرد",
          "You are notified of the attributed facts and enabled to reply",
        ),
        wn(
          "EXPECTED",
          "تحرير محضر الإفادة وإتاحة تصحيحه",
          "The statement record is drafted and correction is enabled",
        ),
      ],
    },
  },
  DEFENCE_NOTICE_ISSUED: {
    SUBJECT: {
      id: "NA-R-CF23-SUB",
      action_id: "SUBMIT_STATEMENT",
      kind: "SUBMIT_STATEMENT",
      how: HOW.subjectPortal,
      deadline_kind: "DEFENCE_DUE",
      text: {
        ar: "الاطلاع على إشعار الدفاع وتقديم دفاعكم عبر صفحة «دفاعي» في المنصة",
        en: 'Read the defence notice and submit your defence through the "My defence" page of the platform',
      },
      what_next: [
        wn("EXPECTED", "إتاحة حزمة الدفاع للاطلاع", "The defence packet is released for you to examine"),
        wn(
          "EXPECTED",
          "إقفال مهلة الدفاع وإحالة دفاعكم إلى اللجنة",
          "The defence period closes and your defence is passed to the committee",
        ),
      ],
    },
  },
  RECOMMENDATION_RAISED_TO_AUTHORITY: {
    AUTHORITY: {
      id: "NA-R-DEC01-AUTH",
      action_id: "DECIDE",
      kind: "DECIDE",
      how: HOW.mailbox,
      deadline_kind: "DECISION_DUE",
      text: {
        ar: "النظر في التوصية المرفوعة إليكم واتخاذ القرار على الوثيقة الموقّعة، ثم إيداعها لدى الأمانة لقيدها",
        en: "Consider the recommendation raised to you, take the decision on the signed document, then lodge it with the secretariat for entry",
      },
      what_next: [
        wn(
          "CONDITIONAL",
          "الاستيضاح أو الإعادة إلى اللجنة — عند الاقتضاء",
          "Clarification or return to the committee — where required",
        ),
        wn(
          "EXPECTED",
          "قيد قراركم لدى الأمانة، ثم تبليغه وتنفيذه",
          "The secretariat enters your decision; notification and execution follow",
        ),
      ],
    },
  },
  MINUTES_REVIEW_REQUESTED: {
    MEMBER: {
      id: "NA-R-CF27-MEM",
      action_id: "REVIEW_MINUTES",
      kind: "REVIEW_MINUTES",
      how: HOW.platformDeep,
      deadline_kind: "MINUTES_REVIEW_DUE",
      text: {
        ar: "مراجعة مسودة المحضر وإبداء ملاحظاتكم",
        en: "Review the draft minutes and give your comments",
      },
      what_next: [
        wn("EXPECTED", "اعتماد المحضر وتوقيعه", "The minutes are approved and signed"),
        wn(
          "EXPECTED",
          "توثيق المحضر الموقّع ومتابعة التكليفات",
          "The signed minutes are filed and assignments are tracked",
        ),
      ],
    },
    SECRETARY: {
      id: "NA-R-CF27-SEC",
      action_id: null,
      how: HOW.platform,
      what_next: [
        wn("EXPECTED", "ورود ملاحظات الأعضاء على المسودة", "Members' comments on the draft arrive"),
      ],
    },
  },
  LEGAL_REVIEW_REQUESTED: {
    LEGAL_REVIEWER: {
      id: "NA-R-LEGAL-REV",
      action_id: "GIVE_LEGAL_OPINION",
      kind: "GIVE_OPINION",
      how: HOW.platformDeep,
      deadline_kind: "LEGAL_OPINION_DUE",
      text: { ar: "إعداد الرأي القانوني وتقديمه", en: "Prepare and submit the legal opinion" },
      what_next: [wn("EXPECTED", "عرض الرأي القانوني على اللجنة", "The legal opinion goes to the committee")],
    },
  },
});

/** rule lookup: RULES[type][class] → RULES[type]['*'] → null */
export function ruleFor(notificationType: unknown, recipientClass: unknown): Rule | null {
  const tk = String(notificationType);
  const t = Object.hasOwn(RULES, tk) ? RULES[tk] : undefined;
  if (!t) return null;
  const ck = String(recipientClass);
  return (Object.hasOwn(t, ck) ? t[ck] : undefined) ?? (Object.hasOwn(t, "*") ? t["*"] : undefined) ?? null;
}

/** the outcome of an authority check as this module reads it (W-F check() result, or a precomputed one) */
export interface AuthorityResult {
  result?: string;
  effect?: string;
  code?: string;
  action_id?: string;
  administrative?: boolean;
  release_status?: string | null;
  reason?: BiText | null;
  [k: string]: unknown;
}
export type AuthorityCheckFn = (q: {
  action_id: string;
  actor: Readonly<Record<string, unknown>>;
  object: Readonly<Record<string, unknown>>;
}) => AuthorityResult;
export type AuthorityModel = ReturnType<typeof loadAuthority>;

function recipientParts(recipient: unknown): { cls: string; actor: Readonly<Record<string, unknown>> } {
  if (recipient && typeof recipient === "object") {
    const r = recipient as { class?: unknown; recipient_class?: unknown; actor?: unknown };
    const actor =
      r.actor && typeof r.actor === "object" ? (r.actor as Readonly<Record<string, unknown>>) : {};
    return { cls: String(r.class ?? r.recipient_class ?? ""), actor };
  }
  return { cls: String(recipient ?? ""), actor: {} };
}

/** the procedural object as the rules read it (charter §3.2); open shape */
export interface ProceduralObjectInput {
  deadlines?: readonly (DeadlineRecord | null | undefined)[];
  deep_link?: { object_type?: unknown; object_id?: unknown } | null;
  events?: readonly EventLike[];
  [k: string]: unknown;
}

interface RunAuthorityInput {
  authority_check?: AuthorityCheckFn | AuthorityResult | null;
  authority_model?: AuthorityModel | null;
  action_id: string;
  actor: Readonly<Record<string, unknown>>;
  object: ProceduralObjectInput | null | undefined;
  events: readonly EventLike[] | null | undefined;
  object_extra?: Readonly<Record<string, unknown>>;
}
function runAuthority({
  authority_check,
  authority_model,
  action_id,
  actor,
  object,
  events,
  object_extra,
}: RunAuthorityInput): AuthorityResult {
  const obj = { ...(object || {}), ...(object_extra || {}), events: events ?? object?.events ?? [] };
  if (typeof authority_check === "function") return authority_check({ action_id, actor, object: obj });
  if (authority_check && typeof authority_check === "object" && "result" in authority_check) {
    if (authority_check.action_id && authority_check.action_id !== action_id) {
      return {
        result: "DENIED",
        effect: "DENIED",
        code: "AUTHORITY_CHECK_MISMATCH",
        action_id,
        reason: {
          ar: "نتيجة التحقق من الصلاحية لا تخص هذا الإجراء",
          en: "The authority result given is for another action",
        },
      };
    }
    return authority_check;
  }
  // the outcome echoes the query's action_id (a string here); CheckOutcome types it as unknown
  return check(authority_model ?? loadAuthority(), {
    action_id,
    actor,
    object: obj,
    purpose: "EXECUTE",
  }) as AuthorityResult;
}
const allowed = (r: AuthorityResult | null | undefined): boolean => isAllowed(r);

export interface How {
  channel: string;
  link_kind: LinkKind;
  app?: string;
  path?: string;
  link_note?: "NO_DEEP_LINK_FOR_OBJECT_TYPE";
}
function resolveHow(
  how: RuleHow | null | undefined,
  procedural_object: ProceduralObjectInput | null | undefined,
): How {
  if (!how) return { channel: "PLATFORM", link_kind: "NONE" };
  const out: How = { channel: how.channel, link_kind: how.link_kind };
  if (how.app) out.app = how.app;
  if (how.link_kind === "NONE") return out;
  let path = how.path ?? null;
  if (!path && how.deep_link) {
    const dl = procedural_object?.deep_link;
    path = dl ? deepLinkPath(dl.object_type, dl.object_id) : null;
  }
  if (!path) {
    out.link_kind = "NONE";
    out.link_note = "NO_DEEP_LINK_FOR_OBJECT_TYPE";
    return out;
  }
  out.path = path;
  return out;
}

const pickDeadline = (
  procedural_object: ProceduralObjectInput | null | undefined,
  kind: string | null | undefined,
): DeadlineRecord | null =>
  kind
    ? ((procedural_object?.deadlines || []).find((d): d is DeadlineRecord => !!d && d.kind === kind) ?? null)
    : null;

export interface OptionalRight {
  action_id: string;
  ar: string;
  en: string;
  deadline: ResolvedDeadline | null;
  deadline_reason: DeadlineReason | null;
  administrative: boolean;
  release_status: string;
}
export interface NextActionAuthority {
  action_id: string;
  result: string;
  code: string;
  administrative: boolean;
  release_status: string | null;
}
export interface NextAction {
  epistemic: "PROPOSED_ACTION";
  rule_id: string | null;
  optional_rights: OptionalRight[];
  kind: NextActionKind;
  ar: string;
  en: string;
  deadline: ResolvedDeadline | null;
  deadline_reason: DeadlineReason | null;
  how: How;
  what_next: WhatNextItem[];
  informational: boolean;
  authority: NextActionAuthority | null;
  release_status: string;
  read_only_reason?: { code: string; result: string };
}
export interface DeriveNextActionInput {
  notification_type?: unknown;
  recipient?: unknown;
  procedural_object?: ProceduralObjectInput | null;
  case?: unknown;
  authority_check?: AuthorityCheckFn | AuthorityResult | null;
  authority_model?: AuthorityModel | null;
  events?: readonly EventLike[] | null;
}

/**
 * deriveNextAction — see header. `recipient` = {class, actor:{capacity, seat_active, recused, delegation_active, acting_for}}.
 * `authority_check` may be a precomputed check() result for the rule's action, or a function ({action_id, actor, object}) → result.
 */
export function deriveNextAction(input: DeriveNextActionInput = {}): NextAction {
  const { notification_type, procedural_object } = input;
  const { cls, actor } = recipientParts(input.recipient);
  const events = input.events ?? procedural_object?.events ?? [];
  const rule = ruleFor(notification_type, cls);
  const base = {
    epistemic: "PROPOSED_ACTION" as const,
    rule_id: rule?.id ?? null,
    optional_rights: [] as OptionalRight[],
  };
  const whatNext = (items: readonly WhatNextItem[] | undefined): WhatNextItem[] =>
    (items || [])
      .filter((x) => x && (WHAT_NEXT_KINDS as readonly string[]).includes(x.kind))
      .map((x) => ({ kind: x.kind, ar: x.ar, en: x.en }));

  const informational = (how: RuleHow | undefined): NextAction => ({
    ...base,
    kind: "NONE",
    ar: INFORMATIONAL_TEXT.ar,
    en: INFORMATIONAL_TEXT.en,
    deadline: null,
    deadline_reason: null,
    how: resolveHow(how ?? rule?.how ?? { channel: "PLATFORM", link_kind: "NONE" }, procedural_object),
    what_next: whatNext(rule?.what_next),
    informational: true,
    authority: null,
    release_status: "DESIGN_PREVIEW",
  });

  if (!rule || !rule.action_id) {
    const r = informational(rule?.how);
    for (const o of rule?.optional_rights || []) {
      const auth = runAuthority({
        ...input,
        action_id: o.action_id,
        actor,
        object: procedural_object,
        events,
        object_extra: o.object_extra,
      });
      if (!allowed(auth)) continue;
      const { deadline, reason } = resolveDeadline(pickDeadline(procedural_object, o.deadline_kind), events);
      r.optional_rights.push({
        action_id: o.action_id,
        ar: o.ar,
        en: o.en,
        deadline,
        deadline_reason: reason,
        administrative: auth.administrative === true,
        release_status: auth.release_status ?? "DESIGN_PREVIEW",
      });
    }
    return r;
  }

  const auth: AuthorityResult | null | undefined = runAuthority({
    ...input,
    action_id: rule.action_id,
    actor,
    object: procedural_object,
    events,
    object_extra: rule.object_extra,
  });
  const authority: NextActionAuthority = {
    action_id: rule.action_id,
    result: auth?.result ?? "DENIED",
    code: auth?.code ?? "NO_RESULT",
    administrative: auth?.administrative === true,
    release_status: auth?.release_status ?? null,
  };
  if (!allowed(auth)) {
    const code = auth?.code;
    const specific =
      (!isNil(code) && rule.read_only && Object.hasOwn(rule.read_only, code)
        ? rule.read_only[code]
        : undefined) ?? (auth?.result === "SOURCE_REQUIRED" ? rule.read_only?.SOURCE_REQUIRED : null);
    const reason: BiText = specific ??
      auth?.reason ?? {
        ar: "الإجراء غير مسموح لصفتكم حالياً",
        en: "The action is not allowed for your capacity at this time",
      };
    return {
      ...base,
      kind: "READ_ONLY",
      ar: READ_ONLY_PREFIX.ar + reason.ar,
      en: READ_ONLY_PREFIX.en + reason.en,
      deadline: null,
      deadline_reason: null,
      how: {
        channel: rule.how?.channel ?? "PLATFORM",
        link_kind: "NONE",
        ...(rule.how?.app ? { app: rule.how.app } : {}),
      },
      what_next: whatNext(rule.what_next_read_only ?? rule.what_next),
      informational: false,
      read_only_reason: { code: auth?.code ?? "NO_RESULT", result: authority.result },
      authority,
      release_status: "DESIGN_PREVIEW",
    };
  }
  const kind: NextActionKind =
    rule.kind && (NEXT_ACTION_KINDS as readonly string[]).includes(rule.kind) ? rule.kind : "READ_ONLY";
  const { deadline, reason } = resolveDeadline(pickDeadline(procedural_object, rule.deadline_kind), events);
  return {
    ...base,
    kind,
    ar: rule.text?.ar ?? "",
    en: rule.text?.en ?? "",
    deadline,
    deadline_reason: reason,
    how: resolveHow(rule.how, procedural_object),
    what_next: whatNext(rule.what_next),
    informational: false,
    authority,
    release_status: auth?.release_status === "BASIS_RECORDED" ? "BASIS_RECORDED" : "DESIGN_PREVIEW",
  };
}
