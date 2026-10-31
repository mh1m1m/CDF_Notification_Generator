/**
 * CDF Notifications V13 — inline demo scenarios (W-D2). SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Every name, address, reference and event below is synthetic (Employee Alpha, Investigator Beta, Witness Gamma, …;
 * @example.test; CDF-DEMO-2026-…; provenance SYNTHETIC_DEMO). Used by ./build_demo.ts when W-C's
 * lib/journeys/scenarios/*.json are absent or not in the charter shape.
 * Port note: moved from the reference src/demo/ to the unit-test support folder (it is demo data, not library code).
 *
 * Shapes follow the charter: CaseRecord §3.1, ProceduralObject §3.2 (steps with actual / evidence_event_id / epistemic;
 * deadlines {kind, at, basis_event_id, basis_rule}), Event §3.3. Step ids and completion event types follow W-C's
 * catalogue_v13.json (L2-V13-draft-2026-10-27, PROPOSED); the W-D2 subset catalogue accepts them too.
 * Wording of titles and summaries is PROPOSED (owner decision: Level-2/3 and notice wording stay PROPOSED until approved).
 * `sensitive` holds sentinel strings that the disclosure projection must remove (§39, protected identity, DEC-22); the
 * security tests search every output for them.
 */
import { demoUuid } from "@/lib/notifications/render/escape";
import type {
  Scenario,
  Recipient,
  DemoEvent,
  ProcStep,
  ObjectRef,
  CaseRecord,
} from "@/lib/notifications/render/types";
import type { DeadlineRecord } from "@/lib/notifications/next-action/rules";

export const SCENARIO_SET = "WD2-INLINE-2026-10-27";
const PROV = Object.freeze({
  source: "SYNTHETIC_DEMO",
  ref: "tests/unit/notifications/support/scenarios_inline.ts",
});
const at = (day: string, hm: string): string => `2026-${day.length === 5 ? day : "10-" + day}T${hm}:00+03:00`;
const COMMITTEE_ID = demoUuid("committee|DEMO-COMMITTEE-1");

/** event factory per scenario: ids evt-demo-<sid>-NN, recorded at occurrence (synthetic) */
interface EventOpts {
  payload?: Readonly<Record<string, unknown>>;
  object?: ObjectRef | null;
  capacity?: string;
}
type EventFactory = (type: string, when: string, opts?: EventOpts) => DemoEvent;
function events(sid: string, caseId: string): EventFactory {
  let n = 0;
  return (type, when, { payload = {}, object = null, capacity = "SYSTEM" } = {}) =>
    Object.freeze({
      event_id: `evt-demo-${sid.toLowerCase()}-${String(++n).padStart(2, "0")}`,
      type,
      occurred_at: when,
      recorded_at: when,
      case_id: caseId,
      object: object ?? { type: "CASE", id: caseId },
      actor: { capacity, id: `usr-demo-${capacity.toLowerCase().replace(/_/g, "-")}` },
      provenance: PROV,
      version: 1,
      causation_id: null,
      correlation_id: `corr-demo-${sid.toLowerCase()}`,
      payload,
    });
}
const done = (step_id: string, ev: DemoEvent): ProcStep => ({
  step_id,
  actual: "COMPLETED",
  evidence_event_id: ev.event_id,
  epistemic: "RECORDED_FACT",
});
const state = (step_id: string, actual: string): ProcStep => ({
  step_id,
  actual,
  evidence_event_id: null,
  epistemic: "DERIVED_FROM_VERIFIED_FACTS",
});
/** a step under way: its recorded trigger event is the evidence (W-C rule 3) */
const running = (step_id: string, ev: DemoEvent): ProcStep => ({
  step_id,
  actual: "IN_PROGRESS",
  evidence_event_id: ev.event_id,
  epistemic: "RECORDED_FACT",
});

// ---------------------------------------------------------------------------------------------------------------
// Synthetic people (charter §5 recipient classes). `actor` feeds the authority check; `on_access_list` the restricted-case rule.
// ---------------------------------------------------------------------------------------------------------------
type PersonKey =
  | "secretary"
  | "chair"
  | "member"
  | "recused"
  | "authority"
  | "legal"
  | "rca"
  | "investigator"
  | "subject"
  | "witness"
  | "reporter"
  | "referrer";
const P: Readonly<Record<PersonKey, Recipient>> = Object.freeze({
  secretary: {
    class: "SECRETARY",
    ref: "usr-demo-secretary-delta",
    label: { ar: "أمين اللجنة", en: "Committee secretary" },
    email: "secretary.delta@example.test",
    display: { ar: "الأمين دلتا", en: "Secretary Delta" },
    actor: { capacity: "SECRETARY", seat_active: true, recused: false },
    on_access_list: true,
  },
  chair: {
    class: "CHAIR",
    ref: "usr-demo-chair-epsilon",
    label: { ar: "رئيس اللجنة", en: "Committee chair" },
    email: "chair.epsilon@example.test",
    display: { ar: "الرئيس إبسيلون", en: "Chair Epsilon" },
    actor: { capacity: "CHAIR", seat_active: true, recused: false },
    on_access_list: true,
  },
  member: {
    class: "MEMBER",
    ref: "usr-demo-member-zeta",
    label: { ar: "عضو اللجنة", en: "Committee member" },
    email: "member.zeta@example.test",
    display: { ar: "العضو زيتا", en: "Member Zeta" },
    actor: { capacity: "MEMBER", seat_active: true, recused: false },
    on_access_list: true,
  },
  recused: {
    class: "RECUSED_MEMBER",
    ref: "usr-demo-member-eta",
    label: { ar: "عضو اللجنة (متنحٍّ في هذا البند)", en: "Committee member (recused on this item)" },
    email: "member.eta@example.test",
    display: { ar: "العضو إيتا", en: "Member Eta" },
    actor: { capacity: "MEMBER", seat_active: true, recused: true },
    on_access_list: true,
  },
  authority: {
    class: "AUTHORITY",
    ref: "usr-demo-authority-theta",
    label: { ar: "صاحب الصلاحية", en: "Competent authority" },
    email: "authority.theta@example.test",
    display: { ar: "صاحب الصلاحية ثيتا", en: "Authority Theta" },
    actor: { capacity: "AUTHORITY", seat_active: true },
    on_access_list: true,
  },
  legal: {
    class: "LEGAL_REVIEWER",
    ref: "usr-demo-legal-iota",
    label: { ar: "المراجع القانوني", en: "Legal reviewer" },
    email: "legal.iota@example.test",
    display: { ar: "المراجع القانوني يوتا", en: "Legal Reviewer Iota" },
    actor: { capacity: "LEGAL_REVIEWER", seat_active: true },
    on_access_list: true,
  },
  rca: {
    class: "RESTRICTED_CASE_AUTHORITY",
    ref: "usr-demo-rca-kappa",
    label: { ar: "صاحب صلاحية القضايا المقيدة", en: "Restricted-case authority" },
    email: "rca.kappa@example.test",
    display: { ar: "صاحب الصلاحية كابا", en: "Authority Kappa" },
    actor: { capacity: "RESTRICTED_CASE_AUTHORITY", seat_active: true },
    on_access_list: true,
  },
  investigator: {
    class: "INVESTIGATOR",
    ref: "usr-demo-investigator-beta",
    label: { ar: "المحقق المختص", en: "Assigned investigator" },
    email: "investigator.beta@example.test",
    display: { ar: "المحقق بيتا", en: "Investigator Beta" },
    actor: { capacity: "INVESTIGATOR", seat_active: true, recused: false },
    on_access_list: true,
  },
  subject: {
    class: "SUBJECT",
    ref: "usr-demo-employee-alpha",
    label: { ar: "الموظف المعني", en: "The employee concerned" },
    email: "employee.alpha@example.test",
    display: { ar: "الموظف ألفا", en: "Employee Alpha" },
    actor: { capacity: "SUBJECT" },
    on_access_list: false,
  },
  witness: {
    class: "WITNESS",
    ref: "usr-demo-witness-gamma",
    label: { ar: "شاهد", en: "Witness" },
    email: "witness.gamma@example.test",
    display: { ar: "الشاهد غاما", en: "Witness Gamma" },
    actor: { capacity: "WITNESS" },
    on_access_list: false,
  },
  reporter: {
    class: "REPORTER",
    ref: "rpt-demo-anonymous-1",
    label: { ar: "مقدم البلاغ", en: "Reporter" },
    email: null,
    display: null,
    actor: { capacity: "REPORTER" },
    on_access_list: false,
  },
  referrer: {
    class: "REFERRING_BODY",
    ref: "org-demo-lambda",
    label: { ar: "الجهة المحيلة", en: "Referring body" },
    email: "referrals.lambda@example.test",
    display: { ar: "الجهة المحيلة لامدا (تجريبية)", en: "Referring Body Lambda (demo)" },
    actor: { capacity: "REFERRING_BODY" },
    on_access_list: false,
    delivery_context: "EXTERNAL",
  },
});
const who = (k: PersonKey, extra: Partial<Recipient> = {}): Recipient => ({
  ...P[k],
  actor: { ...P[k].actor },
  ...extra,
});

const ISSUER_SECRETARIAT = { ar: "أمانة اللجنة", en: "The committee secretariat" };
const HELP_EXTERNAL = {
  SUBJECT: {
    ar: "للاستفسار عن هذا الإشعار: أمانة اللجنة (secretariat.demo@example.test) مع ذكر مرجع الإشعار.",
    en: "Questions about this notice: the committee secretariat (secretariat.demo@example.test), quoting the notice reference.",
  },
  WITNESS: {
    ar: "للاستفسار عن الموعد أو الحضور: أمانة اللجنة (secretariat.demo@example.test) مع ذكر مرجع الإشعار.",
    en: "Questions about the time or attendance: the committee secretariat (secretariat.demo@example.test), quoting the notice reference.",
  },
  REFERRING_BODY: {
    ar: "للمراسلات بشأن هذه الإحالة: أمانة اللجنة (secretariat.demo@example.test) مع ذكر مرجع الإشعار.",
    en: "Correspondence on this referral: the committee secretariat (secretariat.demo@example.test), quoting the notice reference.",
  },
  REPORTER: {
    ar: "للاستفسار استخدم صفحة المتابعة في بوابة البلاغات برقم بلاغك ورمزه السري.",
    en: "For questions, use the follow-up page of the reporting portal with your report ID and secret.",
  },
};
interface CaseOpts {
  track?: string;
  classification?: string;
  code: string;
  statusEvent: DemoEvent;
  flags?: Readonly<Record<string, boolean>>;
  rca?: boolean;
}
const caseRec = (
  sid: string,
  n: string,
  { track = "IR", classification = "INTERNAL", code, statusEvent, flags = {}, rca = false }: CaseOpts,
): CaseRecord => ({
  case_id: demoUuid(`case|${sid}`),
  internal_ref: `CDF-DEMO-2026-${n}`,
  track,
  classification,
  status: { code, recorded_at: statusEvent.recorded_at, source_event_id: statusEvent.event_id },
  flags: { suspended: false, returned: false, cancelled: false, reopened: false, closed: false, ...flags },
  restrictions: { rca_required: rca },
  exists: true,
});

// ---------------------------------------------------------------------------------------------------------------
function cf18(): Scenario {
  const sid = "CF-18";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "PROCEDURE", id: oid };
  const e1 = E("CASE_STATUS_RECORDED", at("20", "09:00"), {
    payload: { from: "S3.01", to: "S3.02" },
    capacity: "SECRETARY",
  });
  const e2 = E("MATTER_PRESENTED_TO_CHAIR", at("22", "10:00"), {
    payload: { purpose: "DIRECTION" },
    object: obj,
    capacity: "SECRETARY",
  });
  const e3 = E("CHAIR_DIRECTION_RECORDED", at("23", "11:30"), {
    payload: { direction: "INFO_REQUEST" },
    object: obj,
    capacity: "CHAIR",
  });
  return {
    id: sid,
    title: { ar: "توجيه رئيس اللجنة بطلب بيانات", en: "Chair direction: information request" },
    type_code: "CHAIR_DIRECTION_INFO",
    trigger_event_id: e3.event_id,
    case: caseRec(sid, "0018", { code: "S3.02", statusEvent: e1 }),
    object: {
      object_id: oid,
      type: "PROCEDURE",
      case_id: cid,
      journey_id: "J-CHAIR-DIRECTION",
      ref: "DIR-2026-DEMO-0018",
      status: "IN_PROGRESS",
      status_source_event_id: e3.event_id,
      delivery_context: "INTERNAL",
      steps: [
        done("J-CHAIR-DIRECTION/1/1", e2),
        done("J-CHAIR-DIRECTION/1/2", e2),
        done("J-CHAIR-DIRECTION/2/3", e3),
        state("J-CHAIR-DIRECTION/3/2", "PENDING"),
      ],
      deadlines: [],
      deep_link: { object_type: "COMMITTEE", object_id: COMMITTEE_ID },
    },
    events: [e1, e2, e3],
    content: {
      event_title: { ar: "توجيه رئيس اللجنة بطلب بيانات", en: "Chair direction: request for information" },
      event_summary: {
        ar: "سجّل رئيس اللجنة توجيهاً بطلب بيانات إضافية في الموضوع المعروض عليه.",
        en: "The committee chair recorded a direction to request additional information on the matter presented.",
      },
      status_text: {
        ar: "طلب البيانات بانتظار الإرسال من الأمانة",
        en: "The information request awaits dispatch by the secretariat",
      },
      issuer: ISSUER_SECRETARIAT,
    },
    sensitive: {
      investigation_details: "SENTINEL-INVESTIGATION-CF18-K2W",
      member_names: ["SENTINEL-MEMBER-NAME-CF18-Q7"],
    },
    audit_refs: ["aud-demo-cf18-01"],
    context_tags: [],
    recipients: [who("secretary"), who("chair")],
  };
}

function cf19(opened: boolean): Scenario {
  const sid = opened ? "CF-19M" : "CF-19";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const mid = demoUuid(`meeting|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "PROCEDURE", id: oid };
  const meeting = { type: "MEETING", id: mid };
  const e1 = E("CASE_STATUS_RECORDED", at("19", "09:00"), {
    payload: { from: "S2.05", to: "S3.01" },
    capacity: "SECRETARY",
  });
  const e2 = E("MATTER_PRESENTED_TO_CHAIR", at("21", "10:00"), {
    payload: { purpose: "DIRECTION" },
    object: obj,
    capacity: "SECRETARY",
  });
  const e3 = E("CHAIR_DIRECTION_RECORDED", at("22", "12:00"), {
    payload: { direction: "VOTE" },
    object: obj,
    capacity: "CHAIR",
  });
  const e4 = E("MEETING_SCHEDULED", at("22", "15:00"), {
    payload: { purpose: "DELIBERATION" },
    object: meeting,
    capacity: "SECRETARY",
  });
  const evs = [e1, e2, e3, e4];
  let trigger = e3;
  if (opened) {
    const e5 = E("MEETING_OPENED", at("27", "10:05"), {
      payload: { purpose: "DELIBERATION" },
      object: meeting,
      capacity: "SECRETARY",
    });
    evs.push(e5);
    trigger = e5;
  }
  return {
    id: sid,
    title: opened
      ? { ar: "توجيه بالتصويت — الاجتماع منعقد", en: "Vote direction — meeting in session" }
      : {
          ar: "توجيه رئيس اللجنة بترك الأمر لتصويت اللجنة",
          en: "Chair direction: leave the matter to a committee vote",
        },
    type_code: "CHAIR_DIRECTION_VOTE",
    trigger_event_id: trigger.event_id,
    case: caseRec(sid, opened ? "0020" : "0019", { code: "S3.01", statusEvent: e1 }),
    meeting: {
      at: at("27", "10:00"),
      place: { ar: "قاعة اجتماعات اللجنة (عرض تجريبي)", en: "Committee meeting room (demo)" },
      mode: { ar: "حضوري", en: "In person" },
    },
    object: {
      object_id: oid,
      type: "PROCEDURE",
      case_id: cid,
      journey_id: "J-CHAIR-DIRECTION",
      ref: `DIR-2026-DEMO-${opened ? "0020" : "0019"}`,
      status: "IN_PROGRESS",
      status_source_event_id: e3.event_id,
      delivery_context: "INTERNAL",
      steps: [
        done("J-CHAIR-DIRECTION/1/1", e2),
        done("J-CHAIR-DIRECTION/1/2", e2),
        done("J-CHAIR-DIRECTION/2/4", e3),
        state("J-CHAIR-DIRECTION/3/3", "PENDING"),
      ],
      deadlines: [],
      deep_link: { object_type: "MEETING", object_id: mid },
    },
    events: evs,
    content: {
      event_title: {
        ar: "توجيه رئيس اللجنة بطرح البند للتصويت",
        en: "Chair direction: put the item to a vote",
      },
      event_summary: opened
        ? {
            ar: "انعقد اجتماع اللجنة المجدول، ويمكن فتح بند التصويت وفق توجيه رئيس اللجنة.",
            en: "The scheduled committee meeting is in session; the vote item can be opened as the chair directed.",
          }
        : {
            ar: "سجّل رئيس اللجنة توجيهاً بترك الأمر لتصويت اللجنة، وجُدول اجتماع للمداولة.",
            en: "The committee chair recorded a direction to leave the matter to a committee vote, and a deliberation meeting was scheduled.",
          },
      status_text: opened
        ? {
            ar: "الاجتماع منعقد؛ بند التصويت لم يُفتح بعد",
            en: "The meeting is in session; the vote item is not open yet",
          }
        : {
            ar: "بند التصويت لم يُفتح؛ يُفتح أثناء اجتماع منعقد",
            en: "The vote item is not open; it opens during a meeting in session",
          },
      issuer: ISSUER_SECRETARIAT,
    },
    sensitive: {
      member_names: ["SENTINEL-MEMBER-NAME-CF19-B3"],
      investigation_details: "SENTINEL-INVESTIGATION-CF19-P1",
    },
    audit_refs: [`aud-demo-${sid.toLowerCase()}-01`],
    context_tags: [],
    recipients: opened ? [who("secretary")] : [who("secretary"), who("chair"), who("member")],
  };
}

function cf31(variant: "R" | null): Scenario {
  // variant: null (CF-31) or 'R' (restricted case). W-C: J-RECOMMENDATION-COMMITTEE is not suspendable, so the suspension
  // example lives on J-INVESTIGATION (INV-S below).
  const sid = `CF-31${variant ?? ""}`;
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "RECOMMENDATION", id: oid };
  const e1 = E("CASE_STATUS_RECORDED", at("21", "09:00"), {
    payload: { from: "S3.07", to: "S4.01" },
    capacity: "SECRETARY",
  });
  const e2 = E("RECOMMENDATION_DRAFTED", at("24", "13:00"), { object: obj, capacity: "SECRETARY" });
  const e3 = E("PACKAGE_SUBMITTED_FOR_VOTE", at("26", "09:30"), { object: obj, capacity: "SECRETARY" });
  const evs = [e1, e2, e3];
  const trigger = e3;
  const steps = [done("J-RECOMMENDATION-COMMITTEE/1/1", e2), done("J-RECOMMENDATION-COMMITTEE/1/2", e3)];
  const exception = null;
  const typeCode = "PACKAGE_SUBMITTED_FOR_DELIBERATION";
  const flags = {};
  const restricted = variant === "R";
  const recipients =
    variant === "R"
      ? [who("secretary"), who("member", { on_access_list: false }), who("rca")]
      : [
          who("member"),
          who("recused", {
            content: {
              event_summary: {
                ar: "عُرضت على اللجنة حزمة توصيات في بند تنحّيتم عنه؛ لا يلزمكم إجراء.",
                en: "A recommendations package was put to the committee on an item you are recused from; no action is needed from you.",
              },
            },
          }),
          who("secretary"),
        ];
  return {
    id: sid,
    title:
      variant === "R"
        ? { ar: "حزمة توصيات في قضية مقيدة", en: "Recommendations package on a restricted case" }
        : { ar: "عرض حزمة التوصيات للمداولة", en: "Recommendations package presented for deliberation" },
    type_code: typeCode,
    trigger_event_id: trigger.event_id,
    case: caseRec(sid, variant === "R" ? "0032" : "0031", {
      code: "S4.01",
      statusEvent: e1,
      classification: restricted ? "RESTRICTED" : "INTERNAL",
      rca: restricted,
      flags,
    }),
    object: {
      object_id: oid,
      type: "RECOMMENDATION",
      case_id: cid,
      journey_id: "J-RECOMMENDATION-COMMITTEE",
      ref: `REC-2026-DEMO-${variant === "R" ? "0032" : "0031"}`,
      status: "DRAFT",
      status_source_event_id: trigger.event_id,
      delivery_context: "INTERNAL",
      steps,
      deadlines: [],
      deep_link: { object_type: "COMMITTEE", object_id: COMMITTEE_ID },
    },
    events: evs,
    content: {
      event_title: {
        ar: "عرض حزمة التوصيات على اللجنة للمداولة",
        en: "Recommendations package presented to the committee for deliberation",
      },
      event_summary: {
        ar: "أودعت الأمانة حزمة التوصيات لعرضها على اللجنة للمداولة والتصويت في اجتماع يُحدَّد موعده.",
        en: "The secretariat lodged the recommendations package for deliberation and a vote at a meeting to be scheduled.",
      },
      status_text: {
        ar: "الحزمة معروضة للمداولة؛ التصويت لم يُفتح",
        en: "The package is presented for deliberation; voting is not open",
      },
      issuer: ISSUER_SECRETARIAT,
    },
    exception,
    sensitive: {
      investigation_details: `SENTINEL-INVESTIGATION-${sid}-R5`,
      member_names: [`SENTINEL-MEMBER-NAME-${sid}-M2`],
      decision_reasons: `SENTINEL-DELIBERATION-${sid}-D8`,
    },
    audit_refs: [`aud-demo-${sid.toLowerCase()}-01`],
    context_tags: [],
    recipients,
  };
}

function cf35(): Scenario {
  const sid = "CF-35";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "RECOMMENDATION", id: oid };
  const meeting = { type: "MEETING", id: demoUuid(`meeting|${sid}`) };
  const e1 = E("CASE_STATUS_RECORDED", at("09-28", "09:00"), {
    payload: { from: "S4.04", to: "S4.05" },
    capacity: "SECRETARY",
  });
  const e2 = E("RECOMMENDATION_DRAFTED", at("09-10", "10:00"), { object: obj, capacity: "SECRETARY" });
  const e3 = E("PACKAGE_SUBMITTED_FOR_VOTE", at("09-12", "09:00"), { object: obj, capacity: "SECRETARY" });
  const e4 = E("MEETING_OPENED", at("09-15", "10:00"), {
    payload: { purpose: "DELIBERATION" },
    object: meeting,
    capacity: "SECRETARY",
  });
  const e5 = E("BALLOT_OPENED", at("09-15", "11:00"), { object: meeting, capacity: "SECRETARY" });
  const e6 = E("BALLOT_CLOSED", at("09-15", "11:40"), {
    payload: { result: "APPROVED" },
    object: meeting,
    capacity: "SECRETARY",
  });
  const e7 = E("RECOMMENDATION_ADOPTED", at("09-15", "12:00"), { object: obj, capacity: "COMMITTEE" });
  const e8 = E("PACKAGE_SUBMITTED_TO_AUTHORITY", at("09-18", "09:00"), {
    object: obj,
    capacity: "SECRETARY",
  });
  const e9 = E("CASE_STATUS_RECORDED", at("09-18", "09:05"), {
    payload: { transition_id: "T24", from: "S4.03", to: "S4.04" },
    capacity: "SECRETARY",
  });
  const e10 = E("AUTHORITY_DECISION_RECORDED", at("09-28", "08:45"), {
    payload: { outcome: "MODIFY" },
    object: obj,
    capacity: "SECRETARY",
  });
  return {
    id: sid,
    title: { ar: "قيد قرار صاحب الصلاحية", en: "Authority decision recorded" },
    type_code: "AUTHORITY_DECISION_RECORDED",
    trigger_event_id: e10.event_id,
    case: caseRec(sid, "0035", { code: "S4.05", statusEvent: e1 }),
    object: {
      object_id: oid,
      type: "RECOMMENDATION",
      case_id: cid,
      journey_id: "J-RECOMMENDATION-COMMITTEE",
      ref: "REC-2026-DEMO-0035",
      status: "DECIDED",
      related_objects: [meeting],
      status_source_event_id: e10.event_id,
      delivery_context: "INTERNAL",
      decision_final: true,
      steps: [
        done("J-RECOMMENDATION-COMMITTEE/1/1", e2),
        done("J-RECOMMENDATION-COMMITTEE/1/2", e3),
        done("J-RECOMMENDATION-COMMITTEE/2/1", e5),
        done("J-RECOMMENDATION-COMMITTEE/2/2", e6),
        done("J-RECOMMENDATION-COMMITTEE/2/3", e7),
        done("J-RECOMMENDATION-COMMITTEE/4/1", e8),
        done("J-RECOMMENDATION-COMMITTEE/4/2", e10),
        done("J-RECOMMENDATION-COMMITTEE/5/1", e10),
        state("J-RECOMMENDATION-COMMITTEE/5/2", "PENDING"),
      ],
      deadlines: [],
      deep_link: { object_type: "COMMITTEE", object_id: COMMITTEE_ID },
    },
    events: [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10],
    content: {
      event_title: {
        ar: "قيد قرار صاحب الصلاحية في التوصية المرفوعة",
        en: "The authority’s decision on the raised recommendation is recorded",
      },
      event_summary: {
        ar: "قيدت الأمانة قرار صاحب الصلاحية في التوصية المرفوعة إليه. يُبلَّغ مضمون القرار عبر القناة الرسمية فقط.",
        en: "The secretariat entered the authority’s decision on the recommendation raised to it. The content of the decision is communicated through the formal channel only.",
      },
      status_text: {
        ar: "القرار مقيد؛ إشعار القرار للطرف المعني لم يصدر بعد",
        en: "The decision is entered; the decision notice to the party concerned is not issued yet",
      },
      issuer: ISSUER_SECRETARIAT,
    },
    sensitive: {
      decision_outcome: "SENTINEL-DECISION-OUTCOME-CF35-X4",
      decision_reasons: "SENTINEL-DECISION-REASON-CF35-V9",
      member_names: ["SENTINEL-MEMBER-NAME-CF35-T6"],
    },
    audit_refs: ["aud-demo-cf35-01"],
    context_tags: [],
    recipients: [who("secretary"), who("chair"), who("member")],
  };
}

function cf37(delivered: boolean): Scenario {
  const sid = delivered ? "CF-37D" : "CF-37";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "DECISION", id: oid };
  const e1 = E("CASE_STATUS_RECORDED", at("25", "09:00"), {
    payload: { transition_id: "T26", from: "S4.05", to: "S5.01" },
    capacity: "SECRETARY",
  });
  const e2 = E("DECISION_NOTICE_ISSUED", at("26", "10:00"), { object: obj, capacity: "SECRETARY" });
  const evs = [e1, e2];
  let trigger = e2;
  let steps = [running("J-DECISION-SUBJECT/1/1", e2)];
  let deadlines: DeadlineRecord[] = [
    {
      kind: "GRIEVANCE_DUE",
      at: null,
      basis_event_id: `evt-demo-${sid.toLowerCase()}-window`,
      basis_rule: "DEC-F15",
      basis_event_type: "GRIEVANCE_WINDOW_STARTED",
    },
  ];
  if (delivered) {
    // formal service of the notice is a domain record (L-02/L-07), with delivery-grade evidence (not an export, W-D1 PC rule)
    const e3 = E("DECISION_NOTICE_DELIVERED", at("27", "09:40"), {
      payload: { evidence_kind: "SERVICE_RECORD" },
      object: obj,
      capacity: "SECRETARY",
    });
    const e4 = E("GRIEVANCE_WINDOW_STARTED", at("27", "09:40"), { object: obj, capacity: "SYSTEM" });
    evs.push(e3, e4);
    trigger = e4;
    steps = [
      done("J-DECISION-SUBJECT/1/1", e3),
      done("J-DECISION-SUBJECT/2/1", e4),
      state("J-DECISION-SUBJECT/2/2", "PENDING"),
    ];
    // DEC-F15: the clock starts at effective delivery; 30 days OWNER_DEFAULT, configurable (Q94, D11-039); calendar-day count UNVERIFIED
    deadlines = [
      {
        kind: "GRIEVANCE_DUE",
        at: "2026-11-26T09:40:00+03:00",
        basis_event_id: e4.event_id,
        basis_rule: "DEC-F15",
        basis_event_type: "GRIEVANCE_WINDOW_STARTED",
      },
    ];
  }
  return {
    id: sid,
    title: delivered
      ? { ar: "بدء مهلة التظلم بعد التبليغ الفعلي", en: "Grievance period started at effective delivery" }
      : { ar: "إشعار بقرار صادر في شأنك", en: "Notice of a decision concerning you" },
    type_code: delivered ? "GRIEVANCE_WINDOW_STARTED" : "DECISION_NOTICE_ISSUED",
    trigger_event_id: trigger.event_id,
    case: caseRec(sid, delivered ? "0038" : "0037", { code: "S5.01", statusEvent: e1 }),
    object: {
      object_id: oid,
      type: "DECISION",
      case_id: cid,
      journey_id: "J-DECISION-SUBJECT",
      ref: `DN-2026-DEMO-${delivered ? "0038" : "0037"}`,
      status: "DECIDED",
      status_source_event_id: trigger.event_id,
      delivery_context: "INTERNAL",
      steps,
      deadlines,
    },
    events: evs,
    content: delivered
      ? {
          event_title: {
            ar: "بدء مهلة التظلم من القرار الصادر في شأنك",
            en: "The grievance period on the decision concerning you has started",
          },
          event_summary: {
            ar: "سُجّل تسلّمك إشعار القرار، وبدأت بذلك مهلة التظلم.",
            en: "Your receipt of the decision notice is recorded; the grievance period has therefore started.",
          },
          status_text: { ar: "مهلة التظلم جارية", en: "The grievance period is running" },
          issuer: ISSUER_SECRETARIAT,
          help: HELP_EXTERNAL,
        }
      : {
          event_title: {
            ar: "صدور إشعار بقرار في شأنك",
            en: "A decision notice concerning you has been issued",
          },
          event_summary: {
            ar: "صدر إشعار رسمي بقرار يخصك، ويُطّلع على مضمونه عبر القناة الرسمية المعتمدة فقط.",
            en: "A formal notice of a decision concerning you has been issued; its content is available through the approved formal channel only.",
          },
          status_text: {
            ar: "إشعار القرار صادر؛ تسلّمك له لم يُسجَّل بعد",
            en: "The decision notice is issued; your receipt of it is not recorded yet",
          },
          issuer: ISSUER_SECRETARIAT,
          help: HELP_EXTERNAL,
        },
    sensitive: {
      decision_outcome: `SENTINEL-DECISION-OUTCOME-${sid}-L3`,
      decision_reasons: `SENTINEL-DECISION-REASON-${sid}-H8`,
      allegations: `SENTINEL-ALLEGATION-${sid}-F2`,
    },
    audit_refs: [`aud-demo-${sid.toLowerCase()}-01`],
    context_tags: [],
    recipients: [who("subject")],
  };
}

function witness(): Scenario {
  const sid = "WIT";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const hid = demoUuid(`hearing|${sid}`);
  const E = events(sid, cid);
  const hearing = { type: "HEARING", id: hid };
  const e1 = E("CASE_STATUS_RECORDED", at("16", "09:00"), {
    payload: { from: "S3.02", to: "S3.03" },
    capacity: "SECRETARY",
  });
  const e2 = E("MEETING_SCHEDULED", at("24", "14:00"), {
    payload: { purpose: "HEARING" },
    object: hearing,
    capacity: "SECRETARY",
  });
  const e3 = E("STATEMENT_REQUESTED", at("24", "14:10"), {
    payload: { role: "WITNESS" },
    object: hearing,
    capacity: "INVESTIGATOR",
  });
  return {
    id: sid,
    title: { ar: "دعوة شاهد إلى جلسة استماع", en: "Witness summons to a hearing" },
    type_code: "WITNESS_SUMMONS",
    trigger_event_id: e3.event_id,
    case: caseRec(sid, "0041", { code: "S3.03", statusEvent: e1 }),
    meeting: {
      at: at("11-03", "10:00"),
      place: { ar: "مقر الصندوق — قاعة الاجتماعات (عرض تجريبي)", en: "CDF premises — meeting room (demo)" },
      mode: { ar: "حضوري", en: "In person" },
    },
    object: {
      object_id: oid,
      type: "HEARING",
      case_id: cid,
      journey_id: "J-WITNESS",
      ref: "HRG-2026-DEMO-0041",
      status: "SCHEDULED",
      status_source_event_id: e2.event_id,
      related_objects: [hearing],
      delivery_context: "INTERNAL",
      steps: [done("J-WITNESS/1/1", e3)],
      // W-C catalogue: J-WITNESS defines no deadline; an attendance-confirmation period would need a source (none is claimed)
      deadlines: [],
    },
    events: [e1, e2, e3],
    content: {
      event_title: { ar: "دعوتكم لحضور جلسة استماع", en: "You are invited to attend a hearing" },
      event_summary: {
        ar: "تدعوكم الأمانة لحضور جلسة استماع للإدلاء بإفادتكم بصفتكم شاهداً، في الموعد والمكان المبيّنين.",
        en: "The secretariat invites you to attend a hearing to give your testimony as a witness, at the time and place shown.",
      },
      issuer: ISSUER_SECRETARIAT,
      help: HELP_EXTERNAL,
    },
    sensitive: {
      allegations: "SENTINEL-ALLEGATION-WIT-C5",
      investigation_details: "SENTINEL-INVESTIGATION-WIT-J4",
      participant_names: ["SENTINEL-PARTICIPANT-NAME-WIT-N1"],
    },
    audit_refs: ["aud-demo-wit-01"],
    context_tags: [],
    recipients: [who("witness")],
  };
}

function reporter(): Scenario {
  const sid = "RPT";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "REPORT", id: oid };
  const e1 = E("REPORT_RECEIVED", at("10", "20:15"), { object: obj, capacity: "SYSTEM" });
  const e2 = E("REPORT_ACKNOWLEDGED", at("10", "20:15"), { object: obj, capacity: "SYSTEM" });
  const e3 = E("CASE_STATUS_RECORDED", at("12", "09:00"), {
    payload: { transition_id: "T01", from: "S1.01", to: "S1.02" },
    capacity: "COMPLIANCE",
  });
  const e4 = E("CASE_REGISTERED", at("12", "09:30"), { object: obj, capacity: "COMPLIANCE" });
  const e5 = E("CASE_STATUS_RECORDED", at("12", "10:00"), {
    payload: { transition_id: "T03", from: "S1.03", to: "S1.04" },
    capacity: "COMPLIANCE",
  });
  const e6 = E("CASE_STATUS_RECORDED", at("19", "11:00"), {
    payload: { transition_id: "T07", from: "S2.01", to: "S2.03" },
    capacity: "COMPLIANCE",
  });
  const e7 = E("CASE_STATUS_RECORDED", at("26", "13:00"), {
    payload: { transition_id: "T08", from: "S2.03", to: "S2.04" },
    capacity: "COMPLIANCE",
  });
  return {
    id: sid,
    title: { ar: "تحديث حالة بلاغ في بوابة البلاغات", en: "Report status update in the reporting portal" },
    type_code: "REPORT_STATUS_CHANGED",
    trigger_event_id: e7.event_id,
    report_id: "RPT-DEMO-4Q7K-92XM",
    case: caseRec(sid, "0014", { track: "WB", code: "S2.04", statusEvent: e7 }),
    object: {
      object_id: oid,
      type: "REPORT",
      case_id: cid,
      journey_id: "J-WB-REPORTER",
      ref: "WB-2026-DEMO-0014",
      status: "IN_PROGRESS",
      status_source_event_id: e7.event_id,
      delivery_context: "EXTERNAL",
      steps: [
        done("J-WB-REPORTER/1/1", e1),
        done("J-WB-REPORTER/1/2", e2),
        done("J-WB-REPORTER/2/1", e3),
        done("J-WB-REPORTER/2/2", e4),
        done("J-WB-REPORTER/2/3", e5),
        done("J-WB-REPORTER/3/1", e6),
        done("J-WB-REPORTER/3/3", e7),
        running("J-WB-REPORTER/3/4", e7),
      ],
      deadlines: [],
    },
    events: [e1, e2, e3, e4, e5, e6, e7],
    content: {
      event_title: { ar: "تحديث على حالة بلاغك", en: "An update on your report" },
      // the sub-state name («التقييم الأولي») is withheld from the reporter (W-F l1_substate); the summary must not quote it
      event_summary: {
        ar: "طرأ تحديث على حالة بلاغك؛ تظهر المرحلة الحالية في صفحة المتابعة.",
        en: "There is an update on the status of your report; the current stage is shown on the follow-up page.",
      },
      issuer: { ar: "بوابة البلاغات", en: "The reporting portal" },
      help: HELP_EXTERNAL,
    },
    sensitive: {
      reporter_identity: "SENTINEL-REPORTER-IDENTITY-RPT-Z8",
      allegations: "SENTINEL-ALLEGATION-RPT-U6",
      investigation_details: "SENTINEL-INVESTIGATION-RPT-E2",
    },
    audit_refs: ["aud-demo-rpt-01"],
    context_tags: [],
    recipients: [who("reporter")],
  };
}

function referral(): Scenario {
  const sid = "CF-11";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "REFERRAL", id: oid };
  const e1 = E("REFERRAL_RECEIVED", at("22", "08:30"), { object: obj, capacity: "SYSTEM" });
  const e2 = E("INTAKE_CHECK_RECORDED", at("22", "11:00"), {
    payload: { check: "SOURCE" },
    object: obj,
    capacity: "SECRETARY",
  });
  const e3 = E("INTAKE_CHECK_RECORDED", at("22", "11:20"), {
    payload: { check: "ATTACHMENTS" },
    object: obj,
    capacity: "SECRETARY",
  });
  const e4 = E("CASE_REGISTERED", at("23", "09:00"), { object: obj, capacity: "SECRETARY" });
  return {
    id: sid,
    title: {
      ar: "إفادة جهة محيلة باستلام إحالتها وقيدها",
      en: "Referring body told its referral is received and registered",
    },
    type_code: "INSTITUTIONAL_REFERRAL_RECEIPT",
    trigger_event_id: e4.event_id,
    case: caseRec(sid, "0011", { track: "IR", code: "S1.03", statusEvent: e4 }),
    object: {
      object_id: oid,
      type: "REFERRAL",
      case_id: cid,
      journey_id: "J-IR-REFERRER",
      ref: "IR-2026-DEMO-0011",
      status: "IN_PROGRESS",
      status_source_event_id: e4.event_id,
      delivery_context: "EXTERNAL",
      steps: [
        done("J-IR-REFERRER/1/1", e1),
        done("J-IR-REFERRER/1/2", e2),
        done("J-IR-REFERRER/1/3", e3),
        done("J-IR-REFERRER/2/1", e4),
        running("J-IR-REFERRER/2/2", e4),
      ],
      deadlines: [],
    },
    events: [e1, e2, e3, e4],
    content: {
      event_title: {
        ar: "استلام إحالتكم المؤسسية وقيدها",
        en: "Your institutional referral is received and registered",
      },
      event_summary: {
        ar: "استلمت الأمانة إحالتكم وقيّدتها، وستُراجع اكتمالها والاختصاص بها.",
        en: "The secretariat received and registered your referral; its completeness and jurisdiction will be reviewed.",
      },
      issuer: ISSUER_SECRETARIAT,
      help: HELP_EXTERNAL,
    },
    sensitive: {
      allegations: "SENTINEL-ALLEGATION-CF11-W7",
      investigation_details: "SENTINEL-INVESTIGATION-CF11-G3",
    },
    audit_refs: ["aud-demo-cf11-01"],
    context_tags: [],
    recipients: [who("referrer")],
  };
}

function statementRequest(): Scenario {
  const sid = "CF-21";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const E = events(sid, cid);
  const session = { type: "HEARING", id: demoUuid(`hearing|${sid}`) };
  const e1 = E("CASE_STATUS_RECORDED", at("15", "09:00"), {
    payload: { from: "S3.02", to: "S3.03" },
    capacity: "INVESTIGATOR",
  });
  const e2 = E("MEETING_SCHEDULED", at("25", "10:00"), {
    payload: { purpose: "HEARING" },
    object: session,
    capacity: "SECRETARY",
  });
  const e3 = E("STATEMENT_REQUESTED", at("25", "10:15"), {
    payload: { role: "PARTY" },
    object: session,
    capacity: "INVESTIGATOR",
  });
  return {
    id: sid,
    title: { ar: "طلب إفادة من الموظف المعني", en: "Statement request to the employee concerned" },
    type_code: "INTERVIEW_NOTICE",
    trigger_event_id: e3.event_id,
    case: caseRec(sid, "0021", { code: "S3.03", statusEvent: e1 }),
    meeting: {
      at: at("11-04", "11:00"),
      place: {
        ar: "مقر الصندوق — مكتب التحقيق (عرض تجريبي)",
        en: "CDF premises — investigation office (demo)",
      },
      mode: { ar: "حضوري أو رد كتابي", en: "In person, or a written reply" },
    },
    object: {
      object_id: oid,
      type: "PROCEDURE",
      case_id: cid,
      journey_id: "J-STATEMENT-PARTY",
      ref: "STM-2026-DEMO-0021",
      status: "OPEN",
      status_source_event_id: e3.event_id,
      related_objects: [session],
      delivery_context: "INTERNAL",
      steps: [done("J-STATEMENT-PARTY/1/1", e3), done("J-STATEMENT-PARTY/1/2", e3)],
      // W-C catalogue: J-STATEMENT-PARTY defines no deadline; no reply period is invented
      deadlines: [],
    },
    events: [e1, e2, e3],
    content: {
      event_title: { ar: "دعوتك لتقديم إفادة", en: "You are invited to give a statement" },
      event_summary: {
        ar: "يدعوك المحقق المختص لتقديم إفادتك بشأن وقائع محددة، في جلسة أو برد كتابي.",
        en: "The competent investigator invites you to give your statement on specific facts, at a session or in a written reply.",
      },
      issuer: { ar: "المحقق المختص (المحقق بيتا)", en: "The competent investigator (Investigator Beta)" },
      help: HELP_EXTERNAL,
    },
    sensitive: {
      allegations: "SENTINEL-ALLEGATION-CF21-Y9",
      investigation_details: "SENTINEL-INVESTIGATION-CF21-A6",
    },
    audit_refs: ["aud-demo-cf21-01"],
    context_tags: [],
    recipients: [who("subject")],
  };
}

function defence(): Scenario {
  const sid = "CF-23";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "PROCEDURE", id: oid };
  const e1 = E("CASE_STATUS_RECORDED", at("20", "09:00"), {
    payload: { from: "S3.05", to: "S3.06" },
    capacity: "INVESTIGATOR",
  });
  const e2 = E("STATEMENT_REQUESTED", at("21", "10:00"), {
    payload: { role: "PARTY" },
    object: obj,
    capacity: "INVESTIGATOR",
  });
  const e3 = E("RIGHTS_NOTICE_ISSUED", at("21", "10:05"), { object: obj, capacity: "SECRETARY" });
  const e4 = E("DEFENCE_NOTICE_ISSUED", at("26", "12:00"), { object: obj, capacity: "SECRETARY" });
  return {
    id: sid,
    title: { ar: "إشعار دفاع للموظف المعني", en: "Defence notice to the employee concerned" },
    type_code: "DEFENCE_NOTICE_ISSUED",
    trigger_event_id: e4.event_id,
    case: caseRec(sid, "0023", { code: "S3.06", statusEvent: e1 }),
    object: {
      object_id: oid,
      type: "PROCEDURE",
      case_id: cid,
      journey_id: "J-DEFENCE",
      ref: "DEF-2026-DEMO-0023",
      status: "OPEN",
      status_source_event_id: e4.event_id,
      delivery_context: "INTERNAL",
      steps: [done("J-DEFENCE/1/1", e3), done("J-DEFENCE/2/1", e4), state("J-DEFENCE/2/2", "PENDING")],
      // DEC-F18 / D11-064: no CDF defence period is invented; the due date is set per notice when the period starts (not recorded yet)
      deadlines: [{ kind: "DEFENCE_DUE", at: null, basis_event_id: null, basis_rule: "SOURCE_REQUIRED" }],
      deep_link: { object_type: "DEFENCE_NOTICE", object_id: oid },
    },
    events: [e1, e2, e3, e4],
    content: {
      event_title: {
        ar: "صدور إشعار دفاع موجّه إليك",
        en: "A defence notice addressed to you has been issued",
      },
      event_summary: {
        ar: "صدر إشعار دفاع موجّه إليك، ويمكنك الاطلاع عليه وتقديم دفاعك عبر صفحة «دفاعي».",
        en: 'A defence notice addressed to you has been issued; you can read it and submit your defence on the "My defence" page.',
      },
      issuer: ISSUER_SECRETARIAT,
      help: HELP_EXTERNAL,
    },
    sensitive: {
      allegations: "SENTINEL-ALLEGATION-CF23-S4",
      investigation_details: "SENTINEL-INVESTIGATION-CF23-O7",
    },
    audit_refs: ["aud-demo-cf23-01"],
    context_tags: [],
    recipients: [who("subject")],
  };
}

function authority(): Scenario {
  const sid = "DEC-01";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "DECISION", id: oid };
  const e1 = E("CASE_STATUS_RECORDED", at("26", "09:00"), {
    payload: { from: "S4.02", to: "S4.03" },
    capacity: "SECRETARY",
  });
  const e2 = E("PACKAGE_SUBMITTED_TO_AUTHORITY", at("26", "09:10"), { object: obj, capacity: "SECRETARY" });
  return {
    id: sid,
    title: { ar: "رفع توصية إلى صاحب الصلاحية", en: "Recommendation raised to the authority" },
    type_code: "RECOMMENDATION_RAISED_TO_AUTHORITY",
    trigger_event_id: e2.event_id,
    case: caseRec(sid, "0051", { code: "S4.03", statusEvent: e1 }),
    object: {
      object_id: oid,
      type: "DECISION",
      case_id: cid,
      journey_id: "J-DECISION-AUTHORITY",
      ref: "AUTH-2026-DEMO-0051",
      status: "SUBMITTED_TO_AUTHORITY",
      status_source_event_id: e2.event_id,
      delivery_context: "INTERNAL",
      steps: [done("J-DECISION-AUTHORITY/1/1", e2)],
      deadlines: [],
    },
    events: [e1, e2],
    content: {
      event_title: {
        ar: "رفع توصية اللجنة إليكم للنظر والقرار",
        en: "The committee’s recommendation is raised to you for consideration and decision",
      },
      event_summary: {
        ar: "رفعت الأمانة إليكم حزمة توصيات اللجنة. تُسلَّم الحزمة عبر القناة الرسمية؛ لا يتضمن هذا الإشعار مضمونها.",
        en: "The secretariat raised the committee’s recommendations package to you. The package is delivered through the formal channel; this notice does not contain it.",
      },
      status_text: {
        ar: "التوصية مرفوعة؛ قرار صاحب الصلاحية لم يُقيَّد بعد",
        en: "The recommendation is raised; no authority decision is entered yet",
      },
      issuer: ISSUER_SECRETARIAT,
    },
    sensitive: {
      decision_reasons: "SENTINEL-DECISION-REASON-DEC01-K1",
      investigation_details: "SENTINEL-INVESTIGATION-DEC01-B5",
    },
    audit_refs: ["aud-demo-dec01-01"],
    context_tags: [],
    recipients: [who("authority")],
  };
}

function minutes(): Scenario {
  const sid = "CF-27";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`meeting|${sid}`);
  const E = events(sid, cid);
  const m = { type: "MEETING", id: oid };
  const e1 = E("CASE_STATUS_RECORDED", at("13", "09:00"), {
    payload: { from: "S3.07", to: "S4.01" },
    capacity: "SECRETARY",
  });
  const ev = (
    type: string,
    d: string,
    hm: string,
    payload?: Readonly<Record<string, unknown>> | null,
    cap: string = "SECRETARY",
  ): DemoEvent => E(type, at(d, hm), { payload: payload ?? {}, object: m, capacity: cap });
  const e2 = ev("AGENDA_DRAFTED", "14", "09:00");
  const e3 = ev("AGENDA_APPROVED", "14", "12:00", null, "CHAIR");
  const e4 = ev("MEETING_SCHEDULED", "14", "12:30", { purpose: "DELIBERATION" });
  const e5 = ev("PARTICIPANTS_INVITED", "14", "13:00");
  const e6 = ev("MEETING_PACK_RELEASED", "18", "09:00");
  const e7 = ev("COI_DECLARATION_REQUESTED", "18", "09:05");
  const e8 = ev("COI_DECLARATIONS_COMPLETE", "19", "16:00", null, "SYSTEM");
  const e9 = ev("MEETING_OPENED", "21", "10:00", { purpose: "DELIBERATION" });
  const e10 = ev("MEETING_CLOSED", "21", "12:30", { purpose: "DELIBERATION" });
  const e11 = ev("MINUTES_DRAFTED", "23", "15:00");
  const e12 = ev("MINUTES_UNDER_REVIEW", "26", "09:00");
  return {
    id: sid,
    title: { ar: "طلب مراجعة مسودة المحضر", en: "Draft minutes review requested" },
    type_code: "MINUTES_REVIEW_REQUESTED",
    trigger_event_id: e12.event_id,
    case: caseRec(sid, "0027", { code: "S4.01", statusEvent: e1 }),
    object: {
      object_id: oid,
      type: "MEETING",
      case_id: cid,
      journey_id: "J-MEETING",
      ref: "MTG-2026-DEMO-0027",
      status: "MINUTES_UNDER_REVIEW",
      status_source_event_id: e12.event_id,
      delivery_context: "INTERNAL",
      steps: [
        done("J-MEETING/1/1", e3),
        done("J-MEETING/1/2", e4),
        done("J-MEETING/1/3", e5),
        done("J-MEETING/2/1", e6),
        done("J-MEETING/2/2", e7),
        done("J-MEETING/2/3", e8),
        done("J-MEETING/3/1", e9),
        done("J-MEETING/3/2", e10),
        done("J-MEETING/4/1", e11),
        running("J-MEETING/4/2", e12),
      ],
      // W-C MINUTES_REVIEW_WINDOW: 3 business days OWNER_DEFAULT, but the holiday calendar is SOURCE_REQUIRED → no date is computed
      deadlines: [
        { kind: "MINUTES_REVIEW_DUE", at: null, basis_event_id: e12.event_id, basis_rule: "SOURCE_REQUIRED" },
      ],
      deep_link: { object_type: "MINUTES", object_id: oid },
    },
    events: [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12],
    content: {
      event_title: {
        ar: "تعميم مسودة محضر الاجتماع للمراجعة",
        en: "Draft meeting minutes circulated for review",
      },
      event_summary: {
        ar: "عمّمت الأمانة مسودة محضر اجتماع اللجنة على الأعضاء الحاضرين لمراجعتها.",
        en: "The secretariat circulated the draft minutes of the committee meeting to the attending members for review.",
      },
      status_text: { ar: "المسودة قيد المراجعة", en: "The draft is under review" },
      issuer: ISSUER_SECRETARIAT,
    },
    sensitive: {
      member_names: ["SENTINEL-MEMBER-NAME-CF27-W2"],
      decision_reasons: "SENTINEL-DELIBERATION-CF27-Q4",
    },
    audit_refs: ["aud-demo-cf27-01"],
    context_tags: [],
    recipients: [who("member"), who("secretary")],
  };
}

function legal(): Scenario {
  const sid = "LEG-01";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`legal|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "LEGAL_OPINION", id: oid };
  const e1 = E("CASE_STATUS_RECORDED", at("24", "09:00"), {
    payload: { from: "S4.01", to: "S4.02" },
    capacity: "SECRETARY",
  });
  const e2 = E("LEGAL_REVIEW_REQUESTED", at("26", "11:00"), { object: obj, capacity: "SECRETARY" });
  return {
    id: sid,
    title: { ar: "إسناد مراجعة قانونية", en: "Legal review assigned" },
    type_code: "LEGAL_REVIEW_REQUESTED",
    trigger_event_id: e2.event_id,
    case: caseRec(sid, "0061", { code: "S4.02", statusEvent: e1 }),
    object: {
      object_id: oid,
      type: "LEGAL_OPINION",
      case_id: cid,
      journey_id: "J-LEGAL-REVIEW",
      ref: "LGL-2026-DEMO-0061",
      status: "OPEN",
      status_source_event_id: e2.event_id,
      delivery_context: "INTERNAL",
      steps: [done("J-LEGAL-REVIEW/1/1", e2)],
      // W-C catalogue: J-LEGAL-REVIEW defines no deadline; the opinion period would need a source (none is claimed)
      deadlines: [],
      deep_link: { object_type: "LEGAL_REVIEW", object_id: oid },
    },
    events: [e1, e2],
    content: {
      event_title: { ar: "إسناد طلب مراجعة قانونية إليك", en: "A legal review request is assigned to you" },
      event_summary: {
        ar: "أسندت الأمانة إليك مراجعة حزمة توصيات قبل رفعها إلى صاحب الصلاحية.",
        en: "The secretariat assigned you the review of a recommendations package before it is raised to the authority.",
      },
      status_text: { ar: "طلب المراجعة مسند", en: "The review request is assigned" },
      issuer: ISSUER_SECRETARIAT,
    },
    sensitive: {
      investigation_details: "SENTINEL-INVESTIGATION-LEG01-H2",
      decision_reasons: "SENTINEL-DELIBERATION-LEG01-R3",
    },
    audit_refs: ["aud-demo-leg01-01"],
    context_tags: [],
    recipients: [who("legal")],
  };
}

/** INV-S — an investigation suspended by a recorded decision (W-C: J-INVESTIGATION is suspendable; the step under way shows ⏸) */
function investigationSuspended(): Scenario {
  const sid = "INV-S";
  const cid = demoUuid(`case|${sid}`);
  const oid = demoUuid(`obj|${sid}`);
  const E = events(sid, cid);
  const obj = { type: "INVESTIGATION", id: oid };
  const e1 = E("CASE_STATUS_RECORDED", at("13", "09:00"), {
    payload: { transition_id: "T14", from: "S3.02", to: "S3.03" },
    capacity: "SECRETARY",
  });
  const e2 = E("INVESTIGATION_ASSIGNED", at("13", "10:00"), { object: obj, capacity: "SECRETARY" });
  const e3 = E("INDEPENDENCE_DECLARED", at("14", "09:00"), { object: obj, capacity: "INVESTIGATOR" });
  const e4 = E("INFO_REQUEST_SENT", at("15", "11:00"), {
    payload: { kind: "DOCUMENTS" },
    object: obj,
    capacity: "INVESTIGATOR",
  });
  const e5 = E("PROCEDURE_SUSPENDED", at("27", "08:30"), {
    payload: { reason_code: "AWAITING_RECORD" },
    object: obj,
    capacity: "CHAIR",
  });
  return {
    id: sid,
    title: { ar: "إيقاف أعمال التحقيق مؤقتاً", en: "Investigation work suspended" },
    type_code: "PROCEDURE_SUSPENDED",
    trigger_event_id: e5.event_id,
    case: caseRec(sid, "0033", { code: "S3.03", statusEvent: e1, flags: { suspended: true } }),
    object: {
      object_id: oid,
      type: "INVESTIGATION",
      case_id: cid,
      journey_id: "J-INVESTIGATION",
      ref: "INV-2026-DEMO-0033",
      status: "ON_HOLD",
      status_source_event_id: e5.event_id,
      delivery_context: "INTERNAL",
      steps: [
        done("J-INVESTIGATION/1/1", e2),
        done("J-INVESTIGATION/1/2", e3),
        done("J-INVESTIGATION/2/1", e4),
        {
          step_id: "J-INVESTIGATION/2/2",
          actual: "SUSPENDED",
          evidence_event_id: e5.event_id,
          epistemic: "RECORDED_FACT",
        },
      ],
      deadlines: [],
    },
    events: [e1, e2, e3, e4, e5],
    content: {
      event_title: { ar: "إيقاف أعمال التحقيق مؤقتاً", en: "Investigation work temporarily suspended" },
      event_summary: {
        ar: "سُجّل قرار بإيقاف أعمال التحقيق مؤقتاً إلى حين استكمال سجل مطلوب؛ لا يلزم إجراء منكم حالياً.",
        en: "A decision to suspend the investigation work until a required record is completed has been entered; no action is needed from you now.",
      },
      status_text: { ar: "التحقيق موقوف مؤقتاً", en: "The investigation is temporarily suspended" },
      issuer: ISSUER_SECRETARIAT,
    },
    exception: {
      kind: "SUSPENDED",
      source_event_id: e5.event_id,
      ar: "أعمال التحقيق موقوفة مؤقتاً بقرار مسجّل",
      en: "The investigation work is temporarily suspended by a recorded decision",
    },
    sensitive: {
      investigation_details: "SENTINEL-INVESTIGATION-INVS-P3",
      allegations: "SENTINEL-ALLEGATION-INVS-K8",
      participant_names: ["SENTINEL-PARTICIPANT-NAME-INVS-C2"],
    },
    audit_refs: ["aud-demo-invs-01"],
    context_tags: [],
    recipients: [who("investigator"), who("secretary")],
  };
}

/** the W-C assignment each inline notification realises (catalogue_v13.json assignments); null where none reports the trigger */
const ASSIGNMENT_OF: Readonly<Record<string, string | null>> = Object.freeze({
  "CF-18": "CF-18",
  "CF-19": "CF-19",
  "CF-19M": "CF-19",
  "CF-31": "CF-31",
  "CF-31R": "CF-31",
  "CF-35": "CF-35",
  "CF-37": "CF-37",
  "CF-37D": null,
  WIT: "INV-10",
  RPT: "CF-14",
  "CF-11": "CF-11",
  "CF-21": "CF-21",
  "CF-23": "CF-23",
  "DEC-01": "DEC-01",
  "CF-27": "CF-27",
  "LEG-01": "CF-33",
  "INV-S": null,
});

/**
 * The statements each notice's wording makes (W-D1 claim vocabulary, src/consistency/rules.js CLAIMS), read from the
 * event_title / event_summary / status_text above. A value naming an event type cites the scenario's recorded event of that
 * type as the basis; `true` asserts without a cited basis (W-D1 then looks for a supporting event itself). Statements the
 * wording explicitly denies ("voting is not open", "not issued yet", "receipt not recorded yet") are not claims.
 */
const CLAIMS_OF: Readonly<Record<string, Readonly<Record<string, string | true>>>> = Object.freeze({
  "CF-19": { meeting_upcoming: true },
  "CF-19M": { meeting_held: "MEETING_OPENED" },
  "CF-35": { decision_issued: "AUTHORITY_DECISION_RECORDED" },
  "CF-37": { decision_notice_issued: "DECISION_NOTICE_ISSUED" },
  "CF-37D": {
    decision_notice_issued: "DECISION_NOTICE_ISSUED",
    delivered: "DECISION_NOTICE_DELIVERED",
    grievance_period_started: "GRIEVANCE_WINDOW_STARTED",
  },
  WIT: { meeting_upcoming: true },
  RPT: { case_status_changed: true },
  "CF-11": { case_registered: "CASE_REGISTERED" },
  "CF-21": { meeting_upcoming: true },
  "CF-27": { meeting_held: "MEETING_OPENED", meeting_completed: "MEETING_CLOSED" },
});
function claimsOf(sc: Scenario): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(
    (Object.hasOwn(CLAIMS_OF, sc.id) ? CLAIMS_OF[sc.id] : undefined) ?? {},
  )) {
    if (spec === true) {
      out[name] = true;
      continue;
    }
    const basis = [...(sc.events ?? [])].reverse().find((e) => e.type === spec);
    out[name] = { value: true, basis_event_id: basis ? basis.event_id : `missing:${spec}` }; // a missing basis must fail W-D1, never pass silently
  }
  return Object.freeze(out);
}

/** the inline set (charter brief: CF-18, CF-19, CF-31, CF-35, CF-37, a witness, a reporter, a referring body, a subject statement request) */
export function inlineScenarios(): Scenario[] {
  return [
    cf18(),
    cf19(false),
    cf19(true),
    cf31(null),
    cf31("R"),
    investigationSuspended(),
    cf35(),
    cf37(false),
    cf37(true),
    witness(),
    reporter(),
    referral(),
    statementRequest(),
    defence(),
    authority(),
    minutes(),
    legal(),
  ].map((x) => ({
    ...x,
    assignment_id: (Object.hasOwn(ASSIGNMENT_OF, x.id) ? ASSIGNMENT_OF[x.id] : undefined) ?? null,
    claims: claimsOf(x),
  }));
}
export const PEOPLE = P;
/** every sentinel planted in a scenario (for leak tests) */
export function sentinelsOf(scenario: Scenario): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.startsWith("SENTINEL-")) out.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(scenario.sensitive ?? {});
  return out;
}
