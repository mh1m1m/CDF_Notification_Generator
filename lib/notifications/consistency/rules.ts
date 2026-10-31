/**
 * CDF Notifications V13 — procedural consistency rules (W-D1, charter §8).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * Deterministic logic only: every condition is a pure function of the context (no clock, no randomness, no network,
 * no generative model). A rule returns `null` (consistent) or a violation detail made of codes and ids only — never
 * notification text — so a violation can be logged without leaking content (§83).
 *
 * Context (charter §8 + W-D1 brief):
 *   ctx = {
 *     notification: { type_code, trigger_event_id, allowed_trigger_types?, event_label_type?, lifecycle_status?,
 *                     claims: { <claim>: true | {value, basis_event_id} }, fields_shown: [field | {field, form}],
 *                     deadline: {kind, at, basis_event_id, basis_rule, basis_kind?} | null, l1_code?, case_effect?,
 *                     recipient: {id, class, capacity}?, journey_capacities?, addressed_capacities?,
 *                     informational?, required_action?, rendered_from_event_id?, approval_required?, authority_action_id? },
 *     case: CaseRecord (§3.1) | {exists:false} | null, procedural_object: ProceduralObject (§3.2) | null,
 *     events: [Event (§3.3)], progress: {actual: [step], expected: [item]}, disclosure_log: {field → outcome | {outcome}},
 *     authority: {result, approval_required?, action_id?} | null, alternative_groups: [{group_id, steps, selected}],
 *     deadline_rules?: {<basis_rule>: {trigger_event_types:[…]}} }
 * Claim vocabulary: see CLAIMS below. A claim is a statement the notification makes about a recorded fact.
 * Ported to strict TypeScript from the V13 reference package (src/consistency/rules.js); conditions unchanged.
 */
import { orderEvents, latestEvent, compareEvents, parseInstant, isInstant } from "../lifecycle/idempotency";

export const RULES_VERSION = "PC-RULES-V13-draft-2026-10-27";

// ---------------------------------------------------------------------------------------------------------------
// Context types (every field is optional: the rules read the context defensively and fail closed)
// ---------------------------------------------------------------------------------------------------------------
export interface CtxEvent {
  readonly event_id: string;
  readonly type: string;
  readonly occurred_at: string;
  readonly recorded_at?: string | null;
  readonly case_id?: string | null;
  readonly object?: { readonly type?: string; readonly id?: string } | null;
  readonly actor?: unknown;
  readonly provenance?: unknown;
  readonly version?: number;
  readonly causation_id?: string | null;
  readonly correlation_id?: string | null;
  readonly payload?: Readonly<Record<string, unknown>> | null;
}

export interface CtxDeadline {
  readonly kind?: string | null;
  readonly at?: string | null;
  readonly basis_event_id?: string | null;
  readonly basis_rule?: string | null;
  readonly basis_kind?: string | null;
}

export type FieldShown = string | { readonly field: string; readonly form?: string };

export interface CtxNotification {
  readonly type_code?: string;
  readonly trigger_event_id?: string | null;
  readonly allowed_trigger_types?: readonly string[] | null;
  readonly event_label_type?: string | null;
  readonly lifecycle_status?: string;
  readonly claims?: Readonly<Record<string, unknown>>;
  readonly fields_shown?: readonly FieldShown[];
  readonly deadline?: CtxDeadline | null;
  readonly l1_code?: string | null;
  readonly case_effect?: string | null;
  readonly recipient?: { readonly id?: string; readonly class?: string; readonly capacity?: string } | null;
  readonly journey_capacities?: readonly string[] | null;
  readonly addressed_capacities?: readonly string[] | null;
  readonly informational?: boolean;
  readonly required_action?: { readonly kind?: string } | null;
  readonly rendered_from_event_id?: string | null;
  readonly approval_required?: boolean;
  readonly authority_action_id?: string | null;
}

export interface CtxCase {
  readonly case_id?: string | null;
  readonly exists?: boolean;
  readonly status?: {
    readonly code?: string | null;
    readonly recorded_at?: string;
    readonly source_event_id?: string | null;
  } | null;
  readonly flags?: Readonly<
    Partial<Record<"suspended" | "returned" | "cancelled" | "reopened" | "closed", boolean>>
  >;
}

export interface CtxProceduralObject {
  readonly object_id?: string | null;
  readonly type?: string;
  readonly status?: string;
  readonly case_id?: string | null;
}

export interface CtxActualStep {
  readonly step_id?: string | null;
  readonly actual?: string;
  readonly evidence_event_id?: string | null;
  readonly completion_event_type?: string | null;
  readonly epistemic?: string;
}

export interface CtxExpectedItem {
  readonly step_id?: string | null;
  readonly state?: string;
  readonly marker?: string;
  readonly epistemic?: string;
}

export interface CtxAlternativeGroup {
  readonly group_id?: string | null;
  readonly steps?: readonly string[];
  readonly selected?: string | null;
}

export interface CtxAuthority {
  readonly result?: unknown;
  readonly approval_required?: boolean;
  readonly action_id?: string | null;
}

export interface ConsistencyContext {
  readonly notification?: CtxNotification;
  readonly case?: CtxCase | null;
  readonly procedural_object?: CtxProceduralObject | null;
  readonly events?: readonly CtxEvent[];
  readonly progress?: {
    readonly actual?: readonly CtxActualStep[];
    readonly expected?: readonly CtxExpectedItem[];
  } | null;
  readonly disclosure_log?: Readonly<Record<string, unknown>> | null;
  readonly authority?: CtxAuthority | null;
  readonly alternative_groups?: readonly CtxAlternativeGroup[] | null;
  readonly deadline_rules?: Readonly<Record<string, { readonly trigger_event_types?: readonly string[] }>>;
}

/** A violation detail: codes and ids only. */
export type RuleDetail = { readonly [key: string]: unknown };
export type RuleCondition = (ctx: ConsistencyContext) => RuleDetail | null | undefined | false;
export type Severity = "BLOCK" | "WARN";

export interface Bilingual {
  readonly ar: string;
  readonly en: string;
}

/** The shape the engine evaluates (catalogue rules and caller-supplied rules alike). */
export interface ConsistencyRule {
  readonly id: string;
  readonly severity: Severity;
  readonly blocking: boolean;
  readonly condition: RuleCondition;
  readonly ar?: string;
  readonly en?: string;
  readonly explanation?: Bilingual;
  readonly remediation?: Bilingual;
}

/** A catalogue rule (charter §8 fields). */
export interface CatalogueRule extends ConsistencyRule {
  readonly ar: string;
  readonly en: string;
  readonly source_data: readonly string[];
  readonly explanation: Bilingual;
  readonly remediation: Bilingual;
  readonly test: string;
  readonly origin: string;
  readonly v12_findings: readonly string[];
  readonly v12_evidence: readonly string[];
}

/** Statements a notification can make, and the recorded event each one needs (documentation + tests). */
export const CLAIMS = Object.freeze({
  decision_issued: "AUTHORITY_DECISION_RECORDED",
  vote_open: "BALLOT_OPENED (and no later BALLOT_CLOSED)",
  meeting_completed: "MEETING_CLOSED",
  recommendation_approved: "RECOMMENDATION_ADOPTED",
  case_closed: "CASE_CLOSED + case.flags.closed",
  meeting_held: "MEETING_OPENED | MEETING_CLOSED",
  minutes_final: "MINUTES_FINAL",
  decision_notice_issued: "DECISION_NOTICE_ISSUED",
  notification_sent: "the notification itself past QUEUED",
  delivered: "DELIVERY_CONFIRMED | DECISION_NOTICE_DELIVERED with delivery-grade evidence",
  acknowledged: "RECIPIENT_ACKNOWLEDGED",
  grievance_period_started: "GRIEVANCE_WINDOW_STARTED",
  object_active: "object not CANCELLED",
  meeting_upcoming: "latest meeting event is not MEETING_CANCELLED",
  case_registered: "case.exists",
  case_status_changed: "not allowed for CASE_UNCHANGED notifications",
  outcome: "payload.outcome of the basis / latest outcome event",
});

/**
 * Default association deadline kind → event types that start it. PROPOSAL (modelling, not governance: durations and
 * rights are never set here). `ctx.deadline_rules[basis_rule].trigger_event_types` overrides it. Unknown kind ⇒ violation.
 * GRIEVANCE_WINDOW is started only by the recorded GRIEVANCE_WINDOW_STARTED event: whether the period runs from issue,
 * delivery or acknowledgement is the record's (and its rule's) decision, never the renderer's (F-W2-25).
 */
export const DEADLINE_KIND_TRIGGERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  STATEMENT_DUE: ["STATEMENT_REQUESTED"],
  INFO_DUE: ["INFO_REQUEST_SENT"],
  MINUTES_REVIEW_DUE: ["MINUTES_UNDER_REVIEW"],
  LEGAL_OPINION_DUE: ["LEGAL_REVIEW_REQUESTED"],
  GRIEVANCE_WINDOW: ["GRIEVANCE_WINDOW_STARTED"],
  ACTION_DUE: ["ACTION_ASSIGNED"],
});

const CASE_FIELDS: readonly string[] = Object.freeze([
  "case_number",
  "internal_ref",
  "l1_stage_name",
  "l1_substate",
]);
const DELIVERY_TYPES: readonly string[] = Object.freeze(["DELIVERY_CONFIRMED", "DECISION_NOTICE_DELIVERED"]);
const EXPORT_EVIDENCE: readonly string[] = Object.freeze([
  "EML_EXPORT",
  "EXPORT",
  "DOWNLOAD",
  "MAILTO",
  "MANUAL_SENT_MARK",
]);
const NOTIFICATION_EVENT = /^(NOTIFICATION_|DELIVERY_|RECIPIENT_ACKNOWLEDGED$)/;
const PRE_SEND: readonly string[] = Object.freeze([
  "DRAFT",
  "VALIDATED",
  "AUTHORIZATION_PENDING",
  "AUTHORIZED",
  "QUEUED",
  "CORRECTED",
]);
const UPCOMING_MEETING_TYPES: readonly string[] = Object.freeze([
  "MEETING_INVITATION",
  "MEETING_REMINDER",
  "MEETING_SCHEDULED",
  "MEETING_RESCHEDULED",
]);
const MEETING_EVENTS: readonly string[] = Object.freeze([
  "MEETING_SCHEDULED",
  "MEETING_RESCHEDULED",
  "MEETING_CANCELLED",
  "MEETING_OPENED",
  "MEETING_CLOSED",
]);

// ---------------------------------------------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------------------------------------------
/** Array.prototype.includes over a list of codes, for a value whose type is not yet known to be a string. */
const isIn = (list: readonly unknown[], value: unknown): boolean => list.includes(value);
const N = (ctx: ConsistencyContext): CtxNotification => ctx.notification ?? {};
const evs = (ctx: ConsistencyContext): readonly CtxEvent[] => (Array.isArray(ctx.events) ? ctx.events : []);
const findEvent = (ctx: ConsistencyContext, id: unknown): CtxEvent | null =>
  id ? (evs(ctx).find((e) => e.event_id === id) ?? null) : null;
const actualSteps = (ctx: ConsistencyContext): readonly CtxActualStep[] =>
  Array.isArray(ctx.progress?.actual) ? ctx.progress.actual : [];
const expectedItems = (ctx: ConsistencyContext): readonly CtxExpectedItem[] =>
  Array.isArray(ctx.progress?.expected) ? ctx.progress.expected : [];

export interface Claim {
  asserted: boolean;
  basis_event_id: unknown;
  value: unknown;
}

/** {asserted, basis_event_id, value} for a claim given as `true`, a non-empty string, or `{value, basis_event_id}`. */
export function claimOf(ctx: ConsistencyContext, name: string): Claim {
  const c = N(ctx).claims?.[name];
  if (c === true) return { asserted: true, basis_event_id: null, value: true };
  if (typeof c === "string" && c) return { asserted: true, basis_event_id: null, value: c };
  const o =
    c && typeof c === "object"
      ? (c as { readonly value?: unknown; readonly basis_event_id?: unknown })
      : null;
  if (o && o.value !== undefined && o.value !== null && o.value !== false) {
    return { asserted: true, basis_event_id: o.basis_event_id ?? null, value: o.value };
  }
  return { asserted: false, basis_event_id: null, value: null };
}

/** An event supports a claim about `objectType` when it is on that object (if the context's object has that type), else when it is in the same case. */
function inScope(ctx: ConsistencyContext, e: CtxEvent, objectType: string | null | undefined): boolean {
  const po = ctx.procedural_object;
  if (objectType && po?.object_id && po.type === objectType) return e.object?.id === po.object_id;
  const caseId = ctx.case?.case_id;
  if (caseId && e.case_id) return e.case_id === caseId;
  return true;
}

const supporting = (
  ctx: ConsistencyContext,
  types: readonly string[],
  objectType: string | null | undefined,
): CtxEvent[] => evs(ctx).filter((e) => types.includes(e.type) && inScope(ctx, e, objectType));

function unsupportedClaim(
  ctx: ConsistencyContext,
  name: string,
  types: readonly string[],
  objectType: string | null | undefined,
): RuleDetail | null {
  const c = claimOf(ctx, name);
  if (!c.asserted) return null;
  if (c.basis_event_id) {
    const e = findEvent(ctx, c.basis_event_id);
    if (!e)
      return {
        claim: name,
        reason: "BASIS_EVENT_NOT_FOUND",
        basis_event_id: c.basis_event_id,
        required: types,
      };
    if (!types.includes(e.type))
      return {
        claim: name,
        reason: "BASIS_EVENT_WRONG_TYPE",
        basis_event_id: e.event_id,
        basis_type: e.type,
        required: types,
      };
    return null;
  }
  return supporting(ctx, types, objectType).length
    ? null
    : { claim: name, reason: "NO_RECORDED_EVENT", required: types };
}

function outcomeOf(log: Readonly<Record<string, unknown>> | null | undefined, field: string): string | null {
  const v = log?.[field];
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { outcome?: unknown }).outcome === "string")
    return (v as { outcome: string }).outcome;
  return null;
}

const asList = (items: readonly RuleDetail[]): RuleDetail | null =>
  items.length === 0 ? null : items.length === 1 ? (items[0] ?? null) : { reason: "MULTIPLE", items };

// ---------------------------------------------------------------------------------------------------------------
// Rule builder
// ---------------------------------------------------------------------------------------------------------------
interface RuleDef {
  ar: string;
  en: string;
  condition: RuleCondition;
  source_data: string[];
  severity: Severity;
  explanation: Bilingual;
  remediation: Bilingual;
  origin: string;
  v12_findings?: string[];
  v12_evidence?: string[];
}

function rule(id: string, def: RuleDef): CatalogueRule {
  return Object.freeze({
    id,
    ar: def.ar,
    en: def.en,
    condition: def.condition,
    source_data: Object.freeze(def.source_data),
    severity: def.severity,
    blocking: def.severity === "BLOCK",
    explanation: Object.freeze(def.explanation),
    remediation: Object.freeze(def.remediation),
    test: `tests/consistency.test.js#${id}`,
    origin: def.origin,
    v12_findings: Object.freeze(def.v12_findings ?? []),
    v12_evidence: Object.freeze(def.v12_evidence ?? []),
  });
}

export const RULES: readonly CatalogueRule[] = Object.freeze([
  rule("PC-01", {
    ar: "وصف القرار بأنه صدر دون قيد حدث قرار صاحب الصلاحية (AUTHORITY_DECISION_RECORDED)",
    en: "Decision described as issued without an AUTHORITY_DECISION_RECORDED event",
    condition: (ctx) => unsupportedClaim(ctx, "decision_issued", ["AUTHORITY_DECISION_RECORDED"], "DECISION"),
    source_data: ["notification.claims.decision_issued", "events", "procedural_object"],
    severity: "BLOCK",
    explanation: {
      ar: "يذكر الإشعار أن قراراً صدر، ولا يوجد في الأحداث المسجلة حدث AUTHORITY_DECISION_RECORDED يثبت ذلك. إصدار إشعار بالقرار لا يعني اتخاذ القرار.",
      en: "The notification states that a decision was issued, but no recorded AUTHORITY_DECISION_RECORDED event supports it. Issuing a decision notice never equals making the decision.",
    },
    remediation: {
      ar: "احذف عبارة صدور القرار، أو انتظر قيد قرار صاحب الصلاحية واربط العبارة بمعرّف حدثه.",
      en: "Remove the statement, or wait until the authority decision is recorded and cite its event id as the basis.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-011", "W7 #7", "MF-015", "F-W2-07"],
    v12_evidence: [
      "samples/DEC-04.txt:1,8-9 — the decision notice says a decision was issued while its card says the matter awaits the authority (W7 #7)",
      "eml/en/CF-35_AUTHORITY_DECISION_RECORDED.eml L9 «Case position: S4.05 Competent decision issued», also used for RETURN_TO_COMMITTEE (F-W2-07)",
    ],
  }),
  rule("PC-02", {
    ar: "وصف التصويت بأنه مفتوح دون قيد حدث فتح التصويت (BALLOT_OPENED)",
    en: "Vote described as open without a BALLOT_OPENED event",
    condition: (ctx) => {
      const base = unsupportedClaim(ctx, "vote_open", ["BALLOT_OPENED"], "BALLOT");
      if (base) return base;
      if (!claimOf(ctx, "vote_open").asserted) return null;
      const last = latestEvent(
        evs(ctx),
        (e) => ["BALLOT_OPENED", "BALLOT_CLOSED"].includes(e.type) && inScope(ctx, e, "BALLOT"),
      );
      return last?.type === "BALLOT_CLOSED"
        ? { claim: "vote_open", reason: "BALLOT_CLOSED_AFTER_OPEN", closed_event_id: last.event_id }
        : null;
    },
    source_data: ["notification.claims.vote_open", "events"],
    severity: "BLOCK",
    explanation: {
      ar: "يذكر الإشعار أن التصويت مفتوح، ولا يوجد حدث BALLOT_OPENED مسجل، أو أن آخر حدث للتصويت هو الإقفال. توجيه الرئيس أو تقديم الحزمة لا يعني فتح التصويت.",
      en: "The notification states that a vote is open, but no BALLOT_OPENED event is recorded, or the latest ballot event is BALLOT_CLOSED. A chair direction or a submitted package is not an opened vote.",
    },
    remediation: {
      ar: "لا تذكر فتح التصويت إلا بعد قيد BALLOT_OPENED لبند التصويت، واستخدم عنوان الحدث الفعلي (مثل «قُدّمت الحزمة للمداولة»).",
      en: 'State that voting is open only after BALLOT_OPENED is recorded for the vote item; otherwise use the actual event label (e.g. "Package submitted for deliberation").',
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-013", "F-W2-05", "F-W2-04", "W3 F1"],
    v12_evidence: [
      "eml/en/CF-31_PACKAGE_SUBMITTED_FOR_DELIBERATION.eml L21 «This notice: Voting open» with no vote item (F-W2-05)",
      "eml/en/CF-19_CHAIR_DIRECTION_VOTE.eml L21 «● Vote item opened» on the chair direction alone (F-W2-04)",
    ],
  }),
  rule("PC-03", {
    ar: "وصف الاجتماع بأنه اكتمل دون قيد حدث إقفال الاجتماع (MEETING_CLOSED)",
    en: "Meeting described as completed without a MEETING_CLOSED event",
    condition: (ctx) => unsupportedClaim(ctx, "meeting_completed", ["MEETING_CLOSED"], "MEETING"),
    source_data: ["notification.claims.meeting_completed", "events", "procedural_object"],
    severity: "BLOCK",
    explanation: {
      ar: "يذكر الإشعار أن الاجتماع اكتمل، ولا يوجد حدث MEETING_CLOSED مسجل لهذا الاجتماع.",
      en: "The notification states that the meeting was completed, but no MEETING_CLOSED event is recorded for this meeting.",
    },
    remediation: {
      ar: "اعرض حالة الاجتماع المسجلة فقط (مجدول / منعقد)، ولا تذكر اكتماله قبل قيد الإقفال.",
      en: "Show the recorded meeting status only (scheduled / opened); do not state completion before the closure is recorded.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-053", "F-W2-10"],
    v12_evidence: [
      "CF-40 «✔ Attendance/Deliberation» assumed without a record (F-W2-10) — nearest V12 instance; no V12 card states «meeting completed» verbatim (INFERENCE)",
    ],
  }),
  rule("PC-04", {
    ar: "وصف التوصية بأنها اعتُمدت دون قيد حدث اعتماد التوصية (RECOMMENDATION_ADOPTED)",
    en: "Recommendation described as approved without a RECOMMENDATION_ADOPTED event",
    condition: (ctx) =>
      unsupportedClaim(ctx, "recommendation_approved", ["RECOMMENDATION_ADOPTED"], "RECOMMENDATION"),
    source_data: ["notification.claims.recommendation_approved", "events", "procedural_object"],
    severity: "BLOCK",
    explanation: {
      ar: "يذكر الإشعار أن التوصية اعتُمدت، ولا يوجد حدث RECOMMENDATION_ADOPTED مسجل. إعداد التوصية أو تقديمها أو إبداء الرأي القانوني فيها لا يعني اعتمادها.",
      en: "The notification states that the recommendation was approved, but no RECOMMENDATION_ADOPTED event is recorded. Preparing, submitting or reviewing a recommendation is not adopting it.",
    },
    remediation: {
      ar: "اربط عبارة الاعتماد بحدث RECOMMENDATION_ADOPTED المسجل، أو استبدلها بالمرحلة المسجلة فعلاً.",
      en: "Cite the recorded RECOMMENDATION_ADOPTED event, or replace the statement with the stage actually recorded.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-016", "F-W2-08"],
    v12_evidence: [
      "CF-36 L41 «Recommendations adopted» on a request about another case (F-W2-08)",
      "eml/en/CF-34_LEGAL_OPINION_RECORDED.eml L13 and CF-35 L13 «✔ 2. Deliberation, vote and adoption» with no adoption event in the notice context (INFERENCE: the cards carry no event ids)",
    ],
  }),
  rule("PC-05", {
    ar: "مهلة لا يكون حدث أساسها هو الحدث المُنشئ في قاعدتها",
    en: "Deadline whose basis event is not its rule's trigger",
    condition: (ctx) => {
      const d = N(ctx).deadline;
      if (!d) return null;
      if (!d.basis_rule || d.basis_rule === "SOURCE_REQUIRED")
        return { reason: "DEADLINE_RULE_SOURCE_REQUIRED", kind: d.kind ?? null };
      if (!d.basis_event_id) return { reason: "DEADLINE_WITHOUT_BASIS_EVENT", kind: d.kind ?? null };
      const e = findEvent(ctx, d.basis_event_id);
      if (!e) return { reason: "BASIS_EVENT_NOT_FOUND", basis_event_id: d.basis_event_id };
      const triggers =
        ctx.deadline_rules?.[d.basis_rule]?.trigger_event_types ?? DEADLINE_KIND_TRIGGERS[String(d.kind)];
      if (!Array.isArray(triggers) || triggers.length === 0)
        return { reason: "DEADLINE_RULE_UNKNOWN", kind: d.kind ?? null, basis_rule: d.basis_rule };
      if (!triggers.includes(e.type))
        return { reason: "BASIS_EVENT_NOT_RULE_TRIGGER", basis_type: e.type, required: triggers };
      return null;
    },
    source_data: ["notification.deadline", "events", "deadline_rules"],
    severity: "BLOCK",
    explanation: {
      ar: "تُعرض مهلة دون قاعدة معتمدة (SOURCE_REQUIRED)، أو دون حدث أساس، أو بحدث أساس غير مسجل، أو بحدث من نوع لا تنشأ به هذه المهلة وفق قاعدتها.",
      en: "A deadline is shown without an approved rule (SOURCE_REQUIRED), without a basis event, with a basis event that is not recorded, or with a basis event of a type that does not start this deadline under its rule.",
    },
    remediation: {
      ar: "لا تعرض المهلة إلا بقاعدة معتمدة ومعرّف حدث أساس من النوع المُنشئ لها؛ وإلا فاحذف التاريخ واذكر متى يُحدَّد.",
      en: "Show the deadline only with an approved rule id and a basis event of the triggering type; otherwise omit the date and say when it will be set.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-003", "W7 #13", "F-W2-25"],
    v12_evidence: [
      "14 generator samples print «المهلة المثبتة: 25 أكتوبر 2026، 4:00 م» with no recorded basis (W7 #13)",
      "INV-12 basis = SOURCE_REQUIRED yet implies a correction period (W7 #13)",
    ],
  }),
  rule("PC-06", {
    ar: "عرض حقل على مستلم لا تسمح له سياسة الإفصاح به",
    en: "Field shown to a recipient whose disclosure outcome is not ALLOWED",
    condition: (ctx) => {
      const shown = Array.isArray(N(ctx).fields_shown) ? (N(ctx).fields_shown ?? []) : [];
      if (!shown.length) return null;
      const log = ctx.disclosure_log;
      if (!log || typeof log !== "object")
        return {
          reason: "NO_DISCLOSURE_LOG",
          fields: shown.map((f) => (typeof f === "string" ? f : f.field)),
        };
      const items: RuleDetail[] = [];
      for (const entry of shown) {
        const field = typeof entry === "string" ? entry : entry.field;
        const form = typeof entry === "string" ? "RAW" : (entry.form ?? "RAW");
        const outcome = outcomeOf(log, field) ?? "PROHIBITED"; // default PROHIBITED (charter §5)
        const ok =
          (form === "RAW" && outcome === "ALLOWED") ||
          (form === "GENERALIZED" && ["ALLOWED", "GENERALIZED"].includes(outcome)) ||
          (form === "SAFE_REFERENCE" && ["ALLOWED", "SAFE_REFERENCE"].includes(outcome));
        if (!ok)
          items.push({
            reason: outcomeOf(log, field) ? "FORM_NOT_ALLOWED_BY_OUTCOME" : "FIELD_NOT_IN_LOG",
            field,
            form,
            outcome,
          });
      }
      return asList(items);
    },
    source_data: ["notification.fields_shown", "disclosure_log"],
    severity: "BLOCK",
    explanation: {
      ar: "يعرض الإشعار حقلاً بصيغته الكاملة أو بصيغة لا تطابق قرار الإفصاح لهذا المستلم (محجوب، أو معمم، أو مرجع آمن، أو ممنوع)، أو حقلاً لا قرار له في سجل الإفصاح، والأصل فيه المنع.",
      en: "The notification shows a field in full, or in a form that does not match the disclosure decision for this recipient (redacted, generalized, safe reference or prohibited), or a field with no decision in the disclosure log (default: prohibited).",
    },
    remediation: {
      ar: "أعد الإسقاط عبر سياسة الإفصاح واعرض كل حقل بالصيغة التي قررها السجل فقط؛ القرار نفسه يحكم الموضوع والمعاينة والنص والبطاقة والروابط والتصدير والسجل.",
      en: "Re-run the disclosure projection and show each field only in the form its log entry decides; one decision governs subject, preheader, body, card, links, export and log.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-004", "MF-005", "MF-006", "MF-007", "W7 #2", "W7 #4", "F-W2-03"],
    v12_evidence: [
      "INV-03/04/05/06 and DEC-04/05: EVENT_ONLY external parties receive the full level-1 rail, status header and sub-state (W7 #2)",
      "IR-02 hidden preheader «… — CDF-DEMO-2026-0001» to the referring body (W7 #4)",
      "samples/WB-08.txt:6 «الرقم المرجعي للحالة: CDF-WB-2026-DEMO-0002» shown to the reporter (W7 §2; verified)",
    ],
  }),
  rule("PC-07", {
    ar: "إشعار يشير إلى حالة غير موجودة في السجل",
    en: "Notification refers to a case that does not exist (exists:false)",
    condition: (ctx) => {
      const c = ctx.case;
      if (c && c.exists !== false) return null;
      const shown = (Array.isArray(N(ctx).fields_shown) ? (N(ctx).fields_shown ?? []) : []).map((f) =>
        typeof f === "string" ? f : f.field,
      );
      const refs = shown.filter((f) => CASE_FIELDS.includes(f));
      if (N(ctx).l1_code) refs.push("l1_code");
      if (claimOf(ctx, "case_registered").asserted) refs.push("claims.case_registered");
      if (!refs.length) return null;
      return { reason: c ? "CASE_DOES_NOT_EXIST" : "CASE_NOT_READ", references: refs };
    },
    source_data: [
      "case.exists",
      "notification.fields_shown",
      "notification.l1_code",
      "notification.claims.case_registered",
    ],
    severity: "BLOCK",
    explanation: {
      ar: "يعرض الإشعار رقم حالة أو مرجعها أو موقعها في المسار الرئيسي، بينما لا توجد حالة مسجلة (exists:false) أو لم يُقرأ سجلها.",
      en: "The notification shows a case number, reference or master-journey position, although no case is recorded (exists:false) or its record was not read.",
    },
    remediation: {
      ar: "احذف كل إشارة إلى الحالة؛ لا يُعرض المسار الرئيسي قبل تسجيل الحالة.",
      en: "Remove every case reference; the master journey is not rendered before a case is registered.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-008", "F-W2-09", "F-W2-02"],
    v12_evidence: [
      "CF-01–04, 06–08, 10–11 print a case position although no case exists (F-W2-09)",
      "eml/en/CF-08_REFERRAL_ESCALATION_DECIDED.eml L6 «Case position: S1.03 Case registered» on an escalation decision that may be UPHOLD (F-W2-02; verified)",
    ],
  }),
  rule("PC-08", {
    ar: "غياب الاعتماد المطلوب: نتيجة فحص الصلاحية ليست «مسموح»",
    en: "Required approval missing (authority check not ALLOWED)",
    condition: (ctx) => {
      const a = ctx.authority;
      const required =
        a?.approval_required === true ||
        N(ctx).approval_required === true ||
        Boolean(N(ctx).authority_action_id);
      if (!required) return null;
      if (!a || !a.result)
        return { reason: "AUTHORITY_CHECK_MISSING", action_id: N(ctx).authority_action_id ?? null };
      if (a.result === "ALLOWED") return null;
      return {
        reason: a.result === "SOURCE_REQUIRED" ? "GOVERNING_SOURCE_REQUIRED" : "AUTHORITY_NOT_ALLOWED",
        result: a.result,
        action_id: a.action_id ?? N(ctx).authority_action_id ?? null,
      };
    },
    source_data: ["authority", "notification.approval_required", "notification.authority_action_id"],
    severity: "BLOCK",
    explanation: {
      ar: "يتطلب الإجراء الذي يبلغ عنه الإشعار اعتماداً وفق نموذج الصلاحيات، ونتيجة الفحص ليست ALLOWED: مرفوض، أو المصدر الحاكم غير متاح (SOURCE_REQUIRED)، أو لم يُجرَ الفحص.",
      en: "The act the notification reports requires an approval under the authority model, and the check is not ALLOWED (denied, governing source missing — SOURCE_REQUIRED — or no check was run).",
    },
    remediation: {
      ar: "أجرِ فحص الصلاحية لمن يملك الاعتماد وسجّل نتيجته؛ وعند غياب المصدر الحاكم يبقى الإشعار مسودة تشغيل يدوي ولا يصدر.",
      en: "Run the authority check for the approver and record its result; without a governing source the notice stays a manual-operation draft and is not issued.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-001", "MF-002", "MF-018", "F-W2-04", "W4-07"],
    v12_evidence: [
      "W8 authority map: 2 of 62 authority claims SUPPORTED by an approved source (MF-001)",
      "CF-15…CF-19 chair direction with no approved source (F-W2-04)",
      "generator ui_v9.js:458-471 act() exports without a release check; release status computed from checkboxes (W4-07)",
    ],
  }),
  rule("PC-09", {
    ar: "خطوة متوقعة معروضة على أنها مكتملة",
    en: "Expected step marked COMPLETED",
    condition: (ctx) => {
      const items: RuleDetail[] = [];
      for (const x of expectedItems(ctx)) {
        if (x.state === "COMPLETED" || x.marker === "✔" || x.epistemic === "RECORDED_FACT")
          items.push({ reason: "EXPECTED_ITEM_MARKED_COMPLETED", step_id: x.step_id ?? null });
      }
      for (const s of actualSteps(ctx)) {
        if (s.actual !== "COMPLETED") continue;
        if (!s.evidence_event_id)
          items.push({ reason: "COMPLETED_WITHOUT_EVIDENCE", step_id: s.step_id ?? null });
        else if (!findEvent(ctx, s.evidence_event_id))
          items.push({
            reason: "EVIDENCE_EVENT_NOT_FOUND",
            step_id: s.step_id ?? null,
            evidence_event_id: s.evidence_event_id,
          });
        else if (
          s.completion_event_type &&
          findEvent(ctx, s.evidence_event_id)?.type !== s.completion_event_type
        ) {
          items.push({
            reason: "EVIDENCE_EVENT_WRONG_TYPE",
            step_id: s.step_id ?? null,
            required: s.completion_event_type,
            evidence_type: findEvent(ctx, s.evidence_event_id)?.type,
          });
        }
      }
      return asList(items);
    },
    source_data: ["progress.expected", "progress.actual", "events"],
    severity: "BLOCK",
    explanation: {
      ar: "تظهر خطوة من «المسار المتوقع» بعلامة الاكتمال، أو تظهر خطوة مكتملة دون معرّف حدث يثبت اكتمالها، أو بمعرّف حدث غير مسجل أو من غير نوع حدث اكتمالها.",
      en: "An Expected-Process item carries the completed mark, or a step is shown COMPLETED without an evidence event id, with an evidence event that is not recorded, or with an event of another type than its completion event.",
    },
    remediation: {
      ar: "اعرض الخطوات المتوقعة بالرمز ◇ ونصها فقط، ولا تعلّم خطوة بالاكتمال إلا بحدث اكتمالها المسجل.",
      en: "Render expected items with ◇ and their label only; mark a step completed only with its recorded completion event.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-010", "W3 F5", "W3 F15", "W7 #22", "F-W2-15", "F-W2-22", "F-W2-26", "F-W2-28"],
    v12_evidence: [
      "eml/en/CF-25_MEETING_CANCELLED.eml L19-21 «✔ Agenda approved / ✔ Date set / ✔ Invitations and reminders» with no event ids (verified)",
      "samples/DR-03.txt:44 and COM-04.txt «✓? … دون قيد مؤرَّخ» (W7 #22)",
      "samples/WB-08.txt:37-40 ✔ on stages 1–4 of the reporter journey rendered on an S2 snapshot (verified)",
    ],
  }),
  rule("PC-10", {
    ar: "إجراء ملغى معروض على أنه قائم",
    en: "CANCELLED procedure presented as active",
    condition: (ctx) => {
      const po = ctx.procedural_object;
      const cancelled = po?.status === "CANCELLED" || ctx.case?.flags?.cancelled === true;
      if (!cancelled) return null;
      const signals: string[] = [];
      if (claimOf(ctx, "object_active").asserted) signals.push("claims.object_active");
      if (actualSteps(ctx).some((s) => s.actual === "IN_PROGRESS"))
        signals.push("progress.actual:IN_PROGRESS");
      if (expectedItems(ctx).length) signals.push("progress.expected:upcoming_steps");
      return signals.length
        ? { reason: "CANCELLED_SHOWN_ACTIVE", object_status: po?.status ?? null, signals }
        : null;
    },
    source_data: [
      "procedural_object.status",
      "case.flags.cancelled",
      "progress",
      "notification.claims.object_active",
    ],
    severity: "BLOCK",
    explanation: {
      ar: "الإجراء أو الحالة ملغى في السجل، والإشعار يعرضه قائماً: خطوة جارية، أو خطوات قادمة متوقعة، أو عبارة تفيد استمراره.",
      en: "The procedure or case is cancelled in the record, but the notification presents it as active: a step in progress, upcoming expected steps, or a statement that it continues.",
    },
    remediation: {
      ar: "اعرض الإلغاء (✕) ولا تعرض خطوات لاحقة؛ واذكر ما يترتب على الإلغاء فقط.",
      en: "Show the cancellation (✕) and no further steps; state only what follows from the cancellation.",
    },
    origin: "CHARTER §8",
    v12_findings: ["W3 F6", "MF-033"],
    v12_evidence: [
      "eml/en/CF-25_MEETING_CANCELLED.eml L12-16 «● 1. Scheduling and invitations / ○ 2 … ○ 5» on a cancelled meeting (verified); generator COM-07 renders «— 2 … — 5» for the same event (W3 F6)",
    ],
  }),
  rule("PC-11", {
    ar: "إشعار يُنشئ إغلاق الحالة أو يُستدل به عليه",
    en: "Notification establishing case closure",
    condition: (ctx) => {
      const items: RuleDetail[] = [];
      const closedRecorded =
        ctx.case?.flags?.closed === true && supporting(ctx, ["CASE_CLOSED"], null).length > 0;
      if (claimOf(ctx, "case_closed").asserted && !closedRecorded)
        items.push({ reason: "CLOSURE_NOT_RECORDED" });
      for (const e of supporting(ctx, ["CASE_CLOSED"], null)) {
        const cause = findEvent(ctx, e.causation_id);
        if (cause && NOTIFICATION_EVENT.test(cause.type))
          items.push({
            reason: "CLOSURE_CAUSED_BY_NOTIFICATION",
            closure_event_id: e.event_id,
            cause_type: cause.type,
          });
      }
      return asList(items);
    },
    source_data: ["notification.claims.case_closed", "case.flags.closed", "events"],
    severity: "BLOCK",
    explanation: {
      ar: "يذكر الإشعار أن الحالة أُغلقت دون إغلاق مسجل (علَم الإغلاق وحدث CASE_CLOSED)، أو أن إغلاق الحالة سُجل بسبب إشعار أو تسليمه. الإشعار يبلّغ عن الإغلاق ولا يُنشئه.",
      en: "The notification states that the case is closed without a recorded closure (closed flag and CASE_CLOSED event), or the closure was recorded as caused by a notification or its delivery. A notification reports closure; it never establishes it.",
    },
    remediation: {
      ar: "لا تُصدر إشعار الإغلاق إلا بعد قيد CASE_CLOSED من صاحب الصلاحية، ولا تجعل أي إشعار سبباً لقيد الإغلاق.",
      en: "Issue a closure notice only after CASE_CLOSED is recorded by the competent actor; never let a notification cause the closure record.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-011", "W7 #1", "W3 F18"],
    v12_evidence: [
      "samples/WB-08.txt:1,7 «إشعار بانتهاء معالجة البلاغ» rendered with «الحالة: التقييم الأولي» (verified)",
      "IR-08 and DEC-07 closure notices rendered on an S2 snapshot (W7 #1)",
    ],
  }),
  rule("PC-12", {
    ar: "معاملة الرأي القانوني على أنه اعتماد",
    en: "Legal opinion treated as adoption",
    condition: (ctx) => {
      const items: RuleDetail[] = [];
      for (const name of ["recommendation_approved", "decision_issued"]) {
        const c = claimOf(ctx, name);
        const e = c.asserted ? findEvent(ctx, c.basis_event_id) : null;
        if (e?.type === "LEGAL_OPINION_SUBMITTED")
          items.push({ reason: "OPINION_USED_AS_ADOPTION", claim: name, basis_event_id: e.event_id });
      }
      for (const s of actualSteps(ctx)) {
        if (
          s.actual !== "COMPLETED" ||
          !isIn(["RECOMMENDATION_ADOPTED", "AUTHORITY_DECISION_RECORDED"], s.completion_event_type)
        )
          continue;
        if (findEvent(ctx, s.evidence_event_id)?.type === "LEGAL_OPINION_SUBMITTED")
          items.push({ reason: "OPINION_COMPLETES_ADOPTION_STEP", step_id: s.step_id ?? null });
      }
      return asList(items);
    },
    source_data: ["notification.claims", "progress.actual", "events"],
    severity: "BLOCK",
    explanation: {
      ar: "يستند الإشعار في اعتماد توصية أو صدور قرار إلى حدث LEGAL_OPINION_SUBMITTED. الرأي القانوني استشاري (يوافق / يوافق مع ملاحظات / يتعارض) ولا يعتمد ولا يقرر.",
      en: "The notification bases an adoption or a decision on a LEGAL_OPINION_SUBMITTED event. A legal opinion is advisory (concurs / concurs with comments / conflicts); it neither adopts nor decides.",
    },
    remediation: {
      ar: "اذكر أن الرأي القانوني سُجل فقط، واربط الاعتماد بحدث RECOMMENDATION_ADOPTED والقرار بحدث AUTHORITY_DECISION_RECORDED.",
      en: "State only that the legal opinion was recorded; cite RECOMMENDATION_ADOPTED for adoption and AUTHORITY_DECISION_RECORDED for a decision.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-014", "F-W2-06"],
    v12_evidence: [
      "eml/en/CF-34_LEGAL_OPINION_RECORDED.eml L9 «Case position: S4.03 Recommendation raised to the authority» and L21-22 «Returned to the committee» for every opinion (verified; F-W2-06) — partial match: the opinion is treated as moving the recommendation on (INFERENCE)",
    ],
  }),
  rule("PC-13", {
    ar: "معاملة الدعوة إلى الاجتماع على أنها انعقاد له",
    en: "Invitation treated as meeting occurrence",
    condition: (ctx) => {
      const items: RuleDetail[] = [];
      const c = claimOf(ctx, "meeting_held");
      if (c.asserted) {
        const v = unsupportedClaim(ctx, "meeting_held", ["MEETING_OPENED", "MEETING_CLOSED"], "MEETING");
        if (v) {
          const basis = findEvent(ctx, c.basis_event_id);
          items.push(
            isIn(["MEETING_SCHEDULED", "MEETING_RESCHEDULED"], basis?.type)
              ? { ...v, reason: "INVITATION_USED_AS_OCCURRENCE" }
              : v,
          );
        }
      }
      for (const s of actualSteps(ctx)) {
        if (s.actual !== "COMPLETED" || !isIn(["MEETING_OPENED", "MEETING_CLOSED"], s.completion_event_type))
          continue;
        const e = findEvent(ctx, s.evidence_event_id);
        if (isIn(["MEETING_SCHEDULED", "MEETING_RESCHEDULED"], e?.type))
          items.push({ reason: "INVITATION_COMPLETES_SESSION_STEP", step_id: s.step_id ?? null });
      }
      return asList(items);
    },
    source_data: ["notification.claims.meeting_held", "progress.actual", "events"],
    severity: "BLOCK",
    explanation: {
      ar: "يذكر الإشعار أن الاجتماع انعقد، أو يعلّم خطوات الانعقاد بالاكتمال، استناداً إلى جدولته أو الدعوة إليه، ولا يوجد حدث MEETING_OPENED مسجل.",
      en: "The notification states that the meeting took place (or marks session steps completed) on the strength of its scheduling or invitation, but no MEETING_OPENED event is recorded.",
    },
    remediation: {
      ar: "اربط الانعقاد بحدث MEETING_OPENED أو MEETING_CLOSED، والدعوة بحدث MEETING_SCHEDULED فقط.",
      en: "Cite MEETING_OPENED / MEETING_CLOSED for occurrence and MEETING_SCHEDULED for the invitation only.",
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-053", "F-W2-10", "F-W2-28"],
    v12_evidence: [
      "CF-40 «✔ Attendance/Deliberation» assumed (F-W2-10)",
      "CF-24 L38–39 «✔ Agenda approved ✔ Date set» (F-W2-28)",
    ],
  }),
  rule("PC-14", {
    ar: "معاملة المسودة على أنها صادرة",
    en: "Draft treated as issued",
    condition: (ctx) => {
      const items: RuleDetail[] = [];
      const v1 = unsupportedClaim(ctx, "minutes_final", ["MINUTES_FINAL"], "MEETING");
      if (v1) items.push(v1);
      const v2 = unsupportedClaim(ctx, "decision_notice_issued", ["DECISION_NOTICE_ISSUED"], null);
      if (v2) items.push(v2);
      const po = ctx.procedural_object;
      if (po && isIn(["RECOMMENDATION", "DECISION"], po.type) && po.status === "DRAFT") {
        const asserted = ["recommendation_approved", "decision_issued", "object_issued"].filter(
          (n) => claimOf(ctx, n).asserted,
        );
        if (asserted.length) items.push({ reason: "DRAFT_OBJECT_PRESENTED_AS_ISSUED", claims: asserted });
      }
      if (
        isIn(PRE_SEND, N(ctx).lifecycle_status) &&
        (claimOf(ctx, "notification_sent").asserted || claimOf(ctx, "notification_issued").asserted)
      ) {
        items.push({
          reason: "NOTIFICATION_DRAFT_PRESENTED_AS_ISSUED",
          lifecycle_status: N(ctx).lifecycle_status,
        });
      }
      return asList(items);
    },
    source_data: [
      "notification.claims",
      "notification.lifecycle_status",
      "procedural_object.status",
      "events",
    ],
    severity: "BLOCK",
    explanation: {
      ar: "يعرض الإشعار محضراً أو إشعار قرار أو توصية أو قراراً أو الإشعار نفسه على أنه نهائي أو صادر، وهو في السجل مسودة لم تصدر بعد.",
      en: "The notification presents minutes, a decision notice, a recommendation, a decision or the notification itself as final or issued while the record still holds it as a draft.",
    },
    remediation: {
      ar: "اعرض حالة المسودة كما هي («مسودة — لم تصدر»)، ولا تذكر الصدور قبل قيد حدثه.",
      en: 'Show the draft state as it is ("draft — not issued"); do not state issuance before its event is recorded.',
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-018", "W4-07", "W7 #19", "F-W2-12"],
    v12_evidence: [
      "release_status = DESIGN_PREVIEW for all 69 generator samples while every sample reads as an issued notice (W7 §1, #19)",
      "CF-28 «may be deemed approved» regardless of deemed_approval_enabled (F-W2-12; partial)",
    ],
  }),
  rule("PC-15", {
    ar: "معاملة تصدير ملف EML على أنه تسليم",
    en: "EML export treated as delivery",
    condition: (ctx) => {
      const items: RuleDetail[] = [];
      const c = claimOf(ctx, "delivered");
      if (c.asserted) {
        const candidates = c.basis_event_id
          ? [findEvent(ctx, c.basis_event_id)].filter((x): x is CtxEvent => Boolean(x))
          : supporting(ctx, DELIVERY_TYPES, null);
        const grade = candidates.filter(
          (e) => DELIVERY_TYPES.includes(e.type) && !isIn(EXPORT_EVIDENCE, e.payload?.evidence_kind),
        );
        if (!grade.length)
          items.push({
            claim: "delivered",
            reason: candidates.some((e) => isIn(EXPORT_EVIDENCE, e.payload?.evidence_kind))
              ? "EXPORT_USED_AS_DELIVERY"
              : "DELIVERY_NOT_EVIDENCED",
          });
      }
      const claims = N(ctx).claims ?? {};
      const basisIds = [
        N(ctx).deadline?.basis_event_id,
        ...Object.values(claims).map((x) =>
          x && typeof x === "object" ? (x as { readonly basis_event_id?: unknown }).basis_event_id : null,
        ),
      ].filter(Boolean);
      for (const id of new Set(basisIds)) {
        const e = findEvent(ctx, id);
        if (
          e &&
          [...DELIVERY_TYPES, "NOTIFICATION_SENT"].includes(e.type) &&
          isIn(EXPORT_EVIDENCE, e.payload?.evidence_kind)
        ) {
          items.push({
            reason: "EXPORT_USED_AS_DELIVERY_BASIS",
            basis_event_id: id,
            evidence_kind: e.payload?.evidence_kind,
          });
        }
      }
      return asList(items);
    },
    source_data: ["notification.claims.delivered", "notification.deadline", "events"],
    severity: "BLOCK",
    explanation: {
      ar: "يذكر الإشعار التسليم، أو يستند إليه في مهلة أو عبارة، ودليله الوحيد تصدير ملف (EML أو تنزيل أو mailto) أو علامة «أُرسل» يدوية. التصدير ليس إرسالاً ولا تسليماً.",
      en: 'The notification states delivery, or relies on it for a deadline or statement, while the only evidence is a file export (EML / download / mailto) or a manual "sent" mark. An export is neither sending nor delivery.',
    },
    remediation: {
      ar: "اعتمد في التسليم على نتيجة قناة الإرسال المسجلة (record_email_delivery أو ظهور الإشعار داخل المنصة)، أو على قيد يدوي موثّق بنسخة البريد المرسل وفق نموذج التشغيل المؤقت.",
      en: "Rely on the channel's recorded settlement (record_email_delivery, or in-app visibility), or on a manual record evidenced by the sent-item copy under the temporary operating model.",
    },
    origin: "CHARTER §8",
    v12_findings: ["W4-00", "MF-018", "MF-019"],
    v12_evidence: [
      "generator/source/ui_v9.js:460 the .eml download is logged as «exported»; :478 the manual «sent» button sets status 'sent' (verified)",
      "77 of 77 generator sample EMLs carry X-Unsent: 1 — drafts, not sent items (verified)",
    ],
  }),
  rule("PC-16", {
    ar: "معاملة محاولة التسليم على أنها إقرار بالاستلام",
    en: "Delivery attempt treated as acknowledgement",
    condition: (ctx) => {
      const items: RuleDetail[] = [];
      const c = claimOf(ctx, "acknowledged");
      if (c.asserted) {
        if (c.basis_event_id) {
          const e = findEvent(ctx, c.basis_event_id);
          if (!e) items.push({ claim: "acknowledged", reason: "BASIS_EVENT_NOT_FOUND" });
          else if (e.type !== "RECIPIENT_ACKNOWLEDGED") {
            items.push({
              claim: "acknowledged",
              reason: [...DELIVERY_TYPES, "NOTIFICATION_SENT"].includes(e.type)
                ? "DELIVERY_USED_AS_ACKNOWLEDGEMENT"
                : "BASIS_EVENT_WRONG_TYPE",
              basis_type: e.type,
            });
          }
        } else if (!supporting(ctx, ["RECIPIENT_ACKNOWLEDGED"], null).length)
          items.push({ claim: "acknowledged", reason: "NO_RECORDED_ACKNOWLEDGEMENT" });
      }
      const d = N(ctx).deadline;
      if (d?.basis_kind === "ACKNOWLEDGEMENT" && d.basis_event_id) {
        const e = findEvent(ctx, d.basis_event_id);
        if (e && e.type !== "RECIPIENT_ACKNOWLEDGED")
          items.push({ reason: "ACKNOWLEDGEMENT_DEADLINE_ON_OTHER_EVENT", basis_type: e.type });
      }
      return asList(items);
    },
    source_data: ["notification.claims.acknowledged", "notification.deadline.basis_kind", "events"],
    severity: "BLOCK",
    explanation: {
      ar: "يذكر الإشعار أن المستلم أقرّ بالاستلام، أو يحسب مهلة من الإقرار، ولا يوجد حدث RECIPIENT_ACKNOWLEDGED؛ الإرسال أو التسليم ليس إقراراً.",
      en: "The notification states that the recipient acknowledged, or computes a deadline from an acknowledgement, without a RECIPIENT_ACKNOWLEDGED event; sending or delivery is not acknowledgement.",
    },
    remediation: {
      ar: "انتظر حدث RECIPIENT_ACKNOWLEDGED، أو اكتب «تبدأ المهلة عند قيد إقرارك بالاستلام».",
      en: 'Wait for RECIPIENT_ACKNOWLEDGED, or say "the period starts when your acknowledgement is recorded".',
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-017", "F-W2-25"],
    v12_evidence: [
      "eml/en/CF-37_DECISION_NOTICE_ISSUED.eml Subject and L1 «The period to file a grievance has started.» while L20 shows «○ Receipt acknowledged» and the start is null under DELIVERY/ACKNOWLEDGEMENT (verified; F-W2-25)",
    ],
  }),
  rule("PC-17", {
    ar: "تعليم بديل غير مختار بالاكتمال في مجموعة بدائل",
    en: "Alternative-group sibling marked COMPLETED when another alternative was selected",
    condition: (ctx) => {
      const groups: readonly CtxAlternativeGroup[] = Array.isArray(ctx.alternative_groups)
        ? ctx.alternative_groups
        : [];
      const state = new Map<unknown, unknown>(
        actualSteps(ctx).map((s): [unknown, unknown] => [s.step_id, s.actual]),
      );
      const items: RuleDetail[] = [];
      for (const g of groups) {
        const completed = (g.steps ?? ([] as readonly string[])).filter(
          (id) => state.get(id) === "COMPLETED",
        );
        if (completed.length > 1)
          items.push({
            reason: "MULTIPLE_ALTERNATIVES_COMPLETED",
            group_id: g.group_id ?? null,
            steps: completed,
          });
        else if (g.selected && completed.some((id) => id !== g.selected)) {
          items.push({
            reason: "NON_SELECTED_ALTERNATIVE_COMPLETED",
            group_id: g.group_id ?? null,
            selected: g.selected,
            steps: completed,
          });
        }
      }
      return asList(items);
    },
    source_data: ["alternative_groups", "progress.actual"],
    severity: "BLOCK",
    explanation: {
      ar: "في مجموعة بدائل متنافية (مثل توجيه الرئيس: اجتماع / جلسة استماع / طلب بيانات / التصويت) يظهر أكثر من بديل مكتملاً، أو يظهر بديل غير المختار مكتملاً. اختيار بديل لا يُكمل البدائل الأخرى.",
      en: "In a group of mutually exclusive alternatives (e.g. the chair direction: meeting / hearing / information request / vote) more than one alternative shows as completed, or one other than the selected alternative does. Selecting one alternative never completes the others.",
    },
    remediation: {
      ar: "اعرض البديل المختار وحده جارياً أو مكتملاً بحدثه، والبدائل الأخرى «لم تُختر».",
      en: 'Show only the selected alternative as current or completed with its event; the others as "not chosen".',
    },
    origin: "CHARTER §8",
    v12_findings: ["MF-009", "W3 F1", "F-W2-04"],
    v12_evidence: [
      "eml/en/CF-18_CHAIR_DIRECTION_INFO.eml L19-21 «✔ Meeting or hearing scheduled / ● Information request sent / ○ Vote item opened» (verified)",
      "eml/en/CF-19_CHAIR_DIRECTION_VOTE.eml L19-21 «✔ Meeting or hearing scheduled / ✔ Information request sent / ● Vote item opened» (verified)",
    ],
  }),
  // ------------------------------------------------------------------ additions justified by the sources ----------
  rule("PC-18", {
    ar: "موقع للحالة (المستوى الأول) لا يطابق الحالة المسجلة",
    en: "Level-1 case position differs from the recorded case status",
    condition: (ctx) => {
      const n = N(ctx);
      const c = ctx.case;
      if (!c || c.exists === false) return null; // PC-07 reports a missing case
      if (n.case_effect === "CASE_UNCHANGED" && claimOf(ctx, "case_status_changed").asserted)
        return { reason: "CASE_UNCHANGED_NOTICE_MOVES_CASE" };
      if (!n.l1_code) return null;
      if (!c.status?.code || !c.status?.source_event_id)
        return { reason: "L1_WITHOUT_RECORDED_STATUS", shown: n.l1_code };
      return n.l1_code === c.status.code
        ? null
        : { reason: "L1_NOT_RECORDED_STATUS", shown: n.l1_code, recorded: c.status.code };
    },
    source_data: ["notification.l1_code", "notification.case_effect", "case.status"],
    severity: "BLOCK",
    explanation: {
      ar: "يعرض الإشعار رمز موقع الحالة في المسار الرئيسي بقيمة لا تطابق الرمز المسجل (status.code)، أو دون رمز مسجل له حدث مصدر. المستوى الأول يُستمد من سجل الحالة وحده، لا من نوع الإشعار.",
      en: "The notification shows a master-journey position that differs from the recorded status.code, or shows one without a recorded code and source event. Level 1 comes from the case record only, never from the notification type.",
    },
    remediation: {
      ar: "اقرأ status.code من سجل الحالة عند الصياغة واعرضه كما هو، أو احذف سطر الموقع.",
      en: "Read status.code from the case record at render time and show it as is, or omit the position line.",
    },
    origin: "SOURCES (charter §3.1/§4: Level 1 from CaseRecord.status.code only)",
    v12_findings: ["MF-008", "F-W2-09", "F-W2-29", "F-W2-06", "W3 F2", "W3 F7", "W7 #1"],
    v12_evidence: [
      "eml/en/CF-33_LEGAL_REVIEW_ASSIGNED.eml L9 «Case position: S4.03 …» printed at review assignment (verified; F-W2-06)",
      "CF-09 S3.01 versus CF-10 S1.01 for the same level-2 stage (F-W2-29)",
      "templates/institutional-referral/v4 build_ir_template_v4.py:25 L2_TO_MASTER = {1:1,2:1,3:2,4:3,5:5} (W3 F7)",
    ],
  }),
  rule("PC-19", {
    ar: "إشعار عن اجتماع أُلغي معروض على أنه قادم",
    en: "Notification for a cancelled meeting presented as upcoming",
    condition: (ctx) => {
      const last = latestEvent(
        evs(ctx),
        (e) => MEETING_EVENTS.includes(e.type) && inScope(ctx, e, "MEETING"),
      );
      if (last?.type !== "MEETING_CANCELLED") return null;
      const upcoming =
        claimOf(ctx, "meeting_upcoming").asserted || isIn(UPCOMING_MEETING_TYPES, N(ctx).type_code);
      return upcoming
        ? {
            reason: "CANCELLED_MEETING_SHOWN_UPCOMING",
            cancelled_event_id: last.event_id,
            type_code: N(ctx).type_code,
          }
        : null;
    },
    source_data: ["events", "notification.type_code", "notification.claims.meeting_upcoming"],
    severity: "BLOCK",
    explanation: {
      ar: "آخر حدث مسجل لهذا الاجتماع هو الإلغاء (MEETING_CANCELLED)، والإشعار دعوة أو تذكير أو يذكر أن الاجتماع قادم.",
      en: "The latest recorded event for this meeting is MEETING_CANCELLED, but the notification is an invitation or reminder, or states that the meeting is upcoming.",
    },
    remediation: {
      ar: "أوقف الدعوة أو التذكير، وأرسل إشعار الإلغاء فقط.",
      en: "Withhold the invitation or reminder and send the cancellation notice only.",
    },
    origin: "W-D1 BRIEF + SOURCES",
    v12_findings: ["W3 F6", "MF-033"],
    v12_evidence: [
      "platform: notify.on_meeting enqueues MEETING_CANCELLED (1920:329-337) while earlier MEETING_INVITATION rows stay as they were (protect_outbox 1920:133-154) — FACT; a later render of that invitation as upcoming is what this rule blocks (INFERENCE)",
      "eml/en/CF-25_MEETING_CANCELLED.eml L22 «● Rescheduled or cancelled where required» as an in-progress step (verified)",
    ],
  }),
  rule("PC-20", {
    ar: "مهلة تقع قبل حدث أساسها",
    en: "Deadline earlier than its basis event",
    condition: (ctx) => {
      const d = N(ctx).deadline;
      if (!d?.at || !d.basis_event_id) return null;
      const e = findEvent(ctx, d.basis_event_id);
      if (!e) return null; // PC-05 reports a missing basis event
      let at: number;
      let basis: number;
      try {
        at = parseInstant(d.at, "deadline.at");
        basis = parseInstant(e.occurred_at, "basis.occurred_at");
      } catch {
        return { reason: "TIMESTAMP_WITHOUT_OFFSET", basis_event_id: e.event_id };
      }
      return at <= basis ? { reason: "DEADLINE_NOT_AFTER_BASIS", basis_event_id: e.event_id } : null;
    },
    source_data: ["notification.deadline.at", "events[basis].occurred_at"],
    severity: "BLOCK",
    explanation: {
      ar: "يقع تاريخ انتهاء المهلة قبل وقت حدث أساسها أو عنده، أو أن أحد التاريخين بلا منطقة زمنية صريحة.",
      en: "The deadline falls before (or at) the occurrence of its basis event, or one of the two timestamps has no explicit offset.",
    },
    remediation: {
      ar: "احسب المهلة من وقت حدث الأساس وفق القاعدة، واكتب الأوقات بصيغة ISO-8601 مع المنطقة الزمنية.",
      en: "Compute the deadline from the basis event under the rule, with ISO-8601 timestamps carrying an explicit offset.",
    },
    origin: "W-D1 BRIEF",
    v12_findings: ["W4-09", "MF-063"],
    v12_evidence: [
      "no V12 instance: V12 has no deadline arithmetic at all and renders `…Z`, `+03:00` and zone-less times identically (W4-09)",
    ],
  }),
  rule("PC-21", {
    ar: "فئة المستلم لا تطابق الصفة التي يخاطبها الإشعار",
    en: "Recipient class does not match the capacity the notification addresses",
    condition: (ctx) => {
      const n = N(ctx);
      const r = n.recipient;
      if (!r) return null;
      const addressed = Array.isArray(n.addressed_capacities) ? n.addressed_capacities : null;
      if (addressed && addressed.length > 1) return { reason: "BUNDLED_CAPACITIES", addressed };
      if (addressed && addressed.length === 1 && r.capacity && addressed[0] !== r.capacity)
        return { reason: "ADDRESSED_CAPACITY_NOT_RECIPIENT", addressed: addressed[0], capacity: r.capacity };
      const caps = Array.isArray(n.journey_capacities) ? n.journey_capacities : null;
      if (caps && caps.length && r.capacity && !caps.includes(r.capacity))
        return {
          reason: "RECIPIENT_CAPACITY_NOT_IN_JOURNEY",
          capacity: r.capacity,
          journey_capacities: caps,
        };
      return null;
    },
    source_data: [
      "notification.recipient",
      "notification.journey_capacities",
      "notification.addressed_capacities",
    ],
    severity: "BLOCK",
    explanation: {
      ar: "يخاطب الإشعار المستلم بصفة غير صفته المسجلة، أو بصفة لم يُكتب لها مسار الإشعار، أو بأكثر من صفة في رأس واحد.",
      en: "The notification addresses the recipient in a capacity other than the resolved one, in a capacity its journey is not written for, or in more than one capacity in one header.",
    },
    remediation: {
      ar: "اختر صياغة المسار والمستوى الثاني بحسب صفة المستلم المسجلة، وصفة واحدة لكل إشعار.",
      en: "Select the journey and level-2 wording by the recipient's resolved capacity, one capacity per notification.",
    },
    origin: "W-D1 BRIEF + SOURCES",
    v12_findings: ["MF-057", "W7 #15", "W3 F20", "F-W2-24", "MF-059"],
    v12_evidence: [
      "COM-20, INV-08, INV-09, SYS-05: recipients placed on journeys written for another capacity (W7 §3.4)",
      "eml/en/CF-18_CHAIR_DIRECTION_INFO.eml L11 «as Committee chair, and the executing secretariat» — two capacities in one header (verified; W3 F20)",
      "CF-24 trigger covers HEARING participants, so a witness or subject would get the member journey and the conflict request (F-W2-24)",
    ],
  }),
  rule("PC-22", {
    ar: "وصف مدة التظلم بأنها بدأت دون قيد حدث بدء المدة",
    en: "Grievance period described as started without GRIEVANCE_WINDOW_STARTED",
    condition: (ctx) => unsupportedClaim(ctx, "grievance_period_started", ["GRIEVANCE_WINDOW_STARTED"], null),
    source_data: ["notification.claims.grievance_period_started", "events"],
    severity: "BLOCK",
    explanation: {
      ar: "يذكر الإشعار أن مدة التظلم بدأت، ولا يوجد حدث GRIEVANCE_WINDOW_STARTED مسجل؛ قد تبدأ المدة بالإصدار أو التسليم أو الإقرار بحسب القاعدة.",
      en: "The notification states that the grievance period has started, but no GRIEVANCE_WINDOW_STARTED event is recorded; depending on the rule the period starts at issue, delivery or acknowledgement.",
    },
    remediation: {
      ar: "اذكر البدء وتاريخه بعد قيد الحدث فقط؛ وإلا فاكتب متى تبدأ المدة بحسب أساس القاعدة.",
      en: "State the start and its date only after the event is recorded; otherwise say when the period will start under the rule.",
    },
    origin: "SOURCES",
    v12_findings: ["MF-017", "F-W2-25"],
    v12_evidence: [
      "eml/en/CF-37_DECISION_NOTICE_ISSUED.eml Subject «A decision notice awaits you. The period to file a grievance has started.» (verified)",
    ],
  }),
  rule("PC-23", {
    ar: "نتيجة معلنة تخالف النتيجة المسجلة",
    en: "Stated outcome differs from the recorded outcome",
    condition: (ctx) => {
      const c = claimOf(ctx, "outcome");
      if (!c.asserted) return null;
      const e = c.basis_event_id
        ? findEvent(ctx, c.basis_event_id)
        : latestEvent(
            evs(ctx),
            (x) =>
              x.payload && x.payload.outcome !== undefined && inScope(ctx, x, ctx.procedural_object?.type),
          );
      if (!e) return { reason: "OUTCOME_NOT_RECORDED", stated: c.value };
      if (e.payload?.outcome === undefined)
        return { reason: "BASIS_EVENT_HAS_NO_OUTCOME", basis_event_id: e.event_id };
      return e.payload?.outcome === c.value
        ? null
        : {
            reason: "OUTCOME_MISMATCH",
            stated: c.value,
            recorded: e.payload?.outcome,
            basis_event_id: e.event_id,
          };
    },
    source_data: ["notification.claims.outcome", "events[].payload.outcome"],
    severity: "BLOCK",
    explanation: {
      ar: "يعلن الإشعار نتيجة (قبول، تأييد الرفض، إعادة، قرار، موافقة الرأي القانوني…) لا تطابق النتيجة المسجلة في الحدث، أو يعلنها دون حدث يحمل نتيجة.",
      en: "The notification announces an outcome (accepted, rejection upheld, returned, decided, opinion concurs…) that differs from the outcome recorded in the event, or without an event carrying an outcome.",
    },
    remediation: {
      ar: "اختر صيغة الإشعار بحسب النتيجة المسجلة (payload.outcome)، صيغة لكل نتيجة.",
      en: "Select the wording by the recorded outcome (payload.outcome), one rendering per outcome.",
    },
    origin: "SOURCES",
    v12_findings: ["MF-012", "MF-014", "MF-015", "F-W2-02", "F-W2-06", "F-W2-07", "W7 #7"],
    v12_evidence: [
      "eml/en/CF-08_REFERRAL_ESCALATION_DECIDED.eml L22 «This notice: Received by the committee» for an escalation whose recorded outcome may be UPHOLD (verified; F-W2-02)",
      "eml/en/CF-34_LEGAL_OPINION_RECORDED.eml L22 «This notice: Returned to the committee» for every opinion including CONCURS (verified; opinion enum 1900:193)",
      "CF-35 RETURN_TO_COMMITTEE rendered as decided (F-W2-07; outcome enum 1900:266-267)",
    ],
  }),
  rule("PC-24", {
    ar: "سطر «هذا الإشعار» يسمّي حدثاً غير الحدث المُنشئ",
    en: "Event label names a different event than the trigger",
    condition: (ctx) => {
      const label = N(ctx).event_label_type;
      if (!label) return null;
      const trigger = findEvent(ctx, N(ctx).trigger_event_id);
      if (!trigger) return null; // PC-25 reports it
      return label === trigger.type
        ? null
        : { reason: "EVENT_LABEL_MISMATCH", label, trigger_type: trigger.type };
    },
    source_data: ["notification.event_label_type", "notification.trigger_event_id", "events"],
    severity: "BLOCK",
    explanation: {
      ar: "يسمّي سطر «هذا الإشعار:» حدثاً من نوع يختلف عن نوع الحدث المُنشئ المسجل (مثل «تحديد موعد الاجتماع» في إشعار إعادة جدولة).",
      en: 'The "This notice:" line names an event type different from the recorded trigger event (e.g. "Meeting scheduled" on a reschedule notice).',
    },
    remediation: {
      ar: "اشتق عنوان الحدث من نوع الحدث المُنشئ نفسه.",
      en: "Derive the event label from the trigger event's own type.",
    },
    origin: "SOURCES",
    v12_findings: ["MF-059", "F-W2-13", "F-W2-05", "F-W2-07"],
    v12_evidence: [
      "eml/en/CF-29_MEETING_RESCHEDULED.eml L23 «This notice: Meeting scheduled» under the subject «A meeting you take part in was rescheduled.» (verified)",
      "eml/en/CF-31_PACKAGE_SUBMITTED_FOR_DELIBERATION.eml L21 «Voting open» on a package-submitted notice (verified)",
      "eml/en/CF-35_AUTHORITY_DECISION_RECORDED.eml L21 «With the competent authority» on a decision-recorded notice (verified)",
    ],
  }),
  rule("PC-25", {
    ar: "إشعار بلا حدث مُنشئ مسجل",
    en: "Notification without a recorded trigger event",
    condition: (ctx) => {
      const n = N(ctx);
      if (!n.trigger_event_id) return { reason: "TRIGGER_EVENT_MISSING" };
      const e = findEvent(ctx, n.trigger_event_id);
      if (!e) return { reason: "TRIGGER_EVENT_NOT_FOUND", trigger_event_id: n.trigger_event_id };
      if (Array.isArray(n.allowed_trigger_types) && !n.allowed_trigger_types.includes(e.type))
        return { reason: "TRIGGER_TYPE_NOT_ALLOWED", trigger_type: e.type };
      return null;
    },
    source_data: ["notification.trigger_event_id", "notification.allowed_trigger_types", "events"],
    severity: "BLOCK",
    explanation: {
      ar: "لا يحمل الإشعار معرّف حدث مُنشئ، أو يحمل معرّفاً غير موجود في الأحداث المسجلة، أو حدثاً من نوع لا يُنشئ هذا النوع من الإشعارات. كل إشعار يقابل حدثاً مسجلاً.",
      en: "The notification carries no trigger event id, an id that is not among the recorded events, or an event of a type that does not trigger this notification type. Every notification corresponds to a recorded event.",
    },
    remediation: {
      ar: "أنشئ الإشعار من الحدث المسجل نفسه (trigger_event_id)، ولا تنشئه من إدخال يدوي.",
      en: "Create the notification from the recorded event itself (trigger_event_id), never from typed input.",
    },
    origin: "SOURCES (D8 §1 principle 1; W7 §8)",
    v12_findings: ["MF-035", "W7 #5", "W3 F12"],
    v12_evidence: [
      "66 of the 69 generator trigger events are not events of any transition (W7 §3.2)",
      "V12 events are typed into the browser (ui_v9.js ctx.events; W4 §3.1)",
    ],
  }),
  rule("PC-26", {
    ar: "إجراء مُعاد أو موقوف معروض على أنه يتقدم",
    en: "Returned or suspended object presented as forward progress",
    condition: (ctx) => {
      const po = ctx.procedural_object;
      const held =
        isIn(["RETURNED", "ON_HOLD"], po?.status) ||
        ctx.case?.flags?.suspended === true ||
        ctx.case?.flags?.returned === true;
      if (!held) return null;
      const steps = actualSteps(ctx);
      if (!steps.length) return null;
      return steps.some((s) => isIn(["RETURNED", "SUSPENDED"], s.actual))
        ? null
        : { reason: "RETURN_OR_SUSPENSION_NOT_SHOWN", object_status: po?.status ?? null };
    },
    source_data: ["procedural_object.status", "case.flags", "progress.actual"],
    severity: "BLOCK",
    explanation: {
      ar: "الإجراء أو الحالة مُعاد أو موقوف في السجل، ولا تظهر في التقدم الفعلي أي خطوة بحالة «أُعيد» أو «موقوف»، فيبدو المسار متقدماً.",
      en: "The object or case is returned or suspended in the record, but no step in Actual Progress shows RETURNED or SUSPENDED, so the journey reads as moving forward.",
    },
    remediation: {
      ar: "اعرض الخطوة المُعادة (↩) أو الموقوفة (⏸) مع سببها، ولا تعرض ما بعدها جارياً.",
      en: "Show the returned (↩) or suspended (⏸) step with its reason, and nothing after it as in progress.",
    },
    origin: "SOURCES",
    v12_findings: ["MF-034", "W3 F16"],
    v12_evidence: [
      "eml/ar/CF-02_REFERRAL_RETURNED.eml «● 1 … / ○ 2» — a returned referral shown as a first pass (W3 F16)",
      "eml/ar/CF-06_REFERRAL_REJECTED.eml — a rejected referral shown heading to «registered as a case» (W3 F16)",
    ],
  }),
  rule("PC-27", {
    ar: "إشعار صيغ من حالة أقدم من آخر حدث مسجل",
    en: "Notification rendered from state older than the latest recorded event",
    condition: (ctx) => {
      const from = N(ctx).rendered_from_event_id;
      if (!from) return null;
      const basis = findEvent(ctx, from);
      if (!basis) return { reason: "RENDER_BASIS_EVENT_NOT_FOUND" };
      const later = orderEvents(
        evs(ctx).filter(
          (e) =>
            e.event_id !== from &&
            !NOTIFICATION_EVENT.test(e.type) &&
            inScope(ctx, e, ctx.procedural_object?.type),
        ),
      ).filter((e) => compareEvents(e, basis) > 0);
      return later.length
        ? { reason: "RENDERED_FROM_STALE_STATE", later_event_ids: later.slice(0, 10).map((e) => e.event_id) }
        : null;
    },
    source_data: ["notification.rendered_from_event_id", "events"],
    severity: "WARN",
    explanation: {
      ar: "سُجلت أحداث بعد الحدث الذي صيغ منه الإشعار؛ قد لا يعكس الإشعار الحالة وقت الإرسال.",
      en: "Events were recorded after the event the notification was rendered from; the content may not reflect the state at send time.",
    },
    remediation: {
      ar: "أعد الصياغة من آخر حالة مسجلة قبل الإرسال، أو أوقف الإشعار إن أُلغي حدثه.",
      en: "Re-render from the latest recorded state before dispatch, or withdraw the notification if its event was reversed.",
    },
    origin: "SOURCES (W4 §3.4; D8 §2 state-at-send rule)",
    v12_findings: ["W4 §3.4", "D8 §2"],
    v12_evidence: [
      "state at send cannot be guaranteed when content is composed from a snapshot without a version (W4 §3.4); outbox rows are written at enqueue and sent later by claim_email_batch (1920:258-264, :581-593)",
    ],
  }),
  rule("PC-28", {
    ar: "إشعار «للعلم» يطلب من المستلم إجراءً",
    en: "Information-only notice that asks the recipient to act",
    condition: (ctx) => {
      const n = N(ctx);
      if (n.informational !== true || !n.required_action) return null;
      return isIn(["NONE", "READ_ONLY"], n.required_action.kind)
        ? null
        : { reason: "INFORMATIONAL_NOTICE_REQUIRES_ACTION", action_kind: n.required_action.kind };
    },
    source_data: ["notification.informational", "notification.required_action"],
    severity: "WARN",
    explanation: {
      ar: "الإشعار مصنف «للاطلاع فقط — لا يلزم إجراء حالياً» ويحمل في الوقت نفسه إجراءً مطلوباً.",
      en: 'The notification is classed "for information only — no action required now" yet carries a required action.',
    },
    remediation: {
      ar: "اختر أحد الأمرين: للعلم بلا إجراء، أو إجراء مطلوب بمهلته وقناته.",
      en: "Choose one: information without action, or a required action with its deadline and channel.",
    },
    origin: "SOURCES",
    v12_findings: ["MF-021", "W7 #11"],
    v12_evidence: ["11 «للعلم» generator records carry an ask in their action text (W7 §3.6, #11)"],
  }),
  rule("PC-29", {
    ar: "وقت حدث يعتمد عليه الإشعار بلا منطقة زمنية صريحة",
    en: "A relied-on event time without an explicit time-zone offset",
    condition: (ctx) => {
      const bad = evs(ctx)
        .filter(
          (e) =>
            !isInstant(e.occurred_at) ||
            (e.recorded_at !== undefined && e.recorded_at !== null && !isInstant(e.recorded_at)),
        )
        .map((e) => e.event_id ?? null);
      return bad.length ? { reason: "EVENT_TIMESTAMP_WITHOUT_OFFSET", event_ids: bad.slice(0, 10) } : null;
    },
    source_data: ["events[].occurred_at", "events[].recorded_at"],
    severity: "BLOCK",
    explanation: {
      ar: "وقت حدث يعتمد عليه الإشعار مكتوب بلا منطقة زمنية (مثل 2026-10-20T10:00:00)؛ فلا يمكن ترتيب الأحداث ولا حساب المهل بشكل موثوق، فيُرفض الإشعار.",
      en: "An event the notification relies on has a time without an offset (e.g. 2026-10-20T10:00:00); events cannot be ordered nor deadlines computed reliably, so the notification is refused.",
    },
    remediation: {
      ar: "سجّل أوقات الأحداث بصيغة ISO-8601 مع المنطقة الزمنية (Z أو +03:00) من مصدرها، ثم أعد التحقق.",
      en: "Record event times as ISO-8601 with an offset (Z or +03:00) at the source, then validate again.",
    },
    origin: "SOURCES (W4-09; charter §9 ordering by occurred_at then recorded_at)",
    v12_findings: ["W4-09", "MF-063"],
    v12_evidence: [
      "V12 renders `…Z`, `+03:00` and zone-less times identically and has no deadline arithmetic (W4-09)",
    ],
  }),
]);

export interface MetaRule {
  readonly id: string;
  readonly ar: string;
  readonly en: string;
  readonly severity: Severity;
  readonly blocking: boolean;
  readonly explanation: Bilingual;
  readonly remediation: Bilingual;
  readonly test: string;
}

/** Engine-level outcomes (not evaluated as rules; produced by engine.validate). */
export const META_RULES: Readonly<Record<"PC-00" | "PC-ENGINE", MetaRule>> = Object.freeze({
  "PC-00": Object.freeze({
    id: "PC-00",
    ar: "سياق التحقق ناقص — رفض احترازي",
    en: "Validation context incomplete (fail closed)",
    severity: "BLOCK",
    blocking: true,
    explanation: Object.freeze({
      ar: "لا يحمل السياق كائن الإشعار أو رمز نوعه؛ لا يمكن التحقق، فيُرفض.",
      en: "The context has no notification or no type code; nothing can be checked, so it is refused.",
    }),
    remediation: Object.freeze({
      ar: "مرّر السياق كاملاً من دورة حياة الإشعار.",
      en: "Pass the full context from the notification lifecycle.",
    }),
    test: "tests/consistency.test.js#PC-00",
  }),
  "PC-ENGINE": Object.freeze({
    id: "PC-ENGINE",
    ar: "تعذّر تقييم قاعدة — رفض احترازي",
    en: "Rule evaluation failed (fail closed)",
    severity: "BLOCK",
    blocking: true,
    explanation: Object.freeze({
      ar: "تعطل تقييم قاعدة على هذا السياق (مثل تاريخ بلا منطقة زمنية)؛ ويُعامل ذلك مخالفة مانعة.",
      en: "A rule could not be evaluated on this context (for example a timestamp without an offset); this is treated as a blocking violation.",
    }),
    remediation: Object.freeze({
      ar: "صحّح بيانات السياق وأعد التحقق.",
      en: "Fix the context data and validate again.",
    }),
    test: "tests/consistency.test.js#PC-00b",
  }),
});

/** Charter §8 minimum set; the lifecycle refuses a rule set that lacks any of them. */
export const CHARTER_MINIMUM: readonly string[] = Object.freeze(
  Array.from({ length: 17 }, (_, i) => `PC-${String(i + 1).padStart(2, "0")}`),
);
