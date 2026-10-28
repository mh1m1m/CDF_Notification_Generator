/**
 * lib/domain/epistemic.ts — CDF Notifications V13 · workstream W-A (domain model).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
 *
 * The epistemic classes (FACT: CHARTER.md §3.5; the class names come from the master execution directive §4.2,
 * work/owner_messages_2026-10-27/master_execution_directive_en_16-08-26Z.txt:346-352, gap G-07 closed), their certainty
 * order (PROPOSAL: the listing order, most certain first; NOT_APPLICABLE is outside the order), the display ceiling
 * (charter §0.5; directive §4.2 :356-358 "The certainty of the interface must never exceed the certainty of its
 * authoritative source."), the progress layers of charter §3.6 (FACT, generated from the charter text; the same states
 * and kinds as directive §7 :598-605 and :615-620), the safe-inference table (charter §3.5; directive §4.2 :354) and the
 * forbidden inferences (directive §4.3 :366-374 each have one; each source names its line).
 */
import { COMMUNICATION_EVENTS } from "./concepts";
import type { Bilingual, DomainEvent, Label } from "./types";

/** The master execution directive (owner message of 27 Oct 2026), cited by file and line. */
export const DIRECTIVE = "work/owner_messages_2026-10-27/master_execution_directive_en_16-08-26Z.txt";

/** The source of a displayed statement (`source.kind` with its cited event id(s)). */
export interface StatementSource {
  kind?: string;
  event_id?: string | null;
  event_ids?: readonly string[] | null;
}
/** `table[key]` as the reference reads it (a non-string key is converted by the property access, as in JavaScript). */
const lookup = <V>(table: Readonly<Record<string, V>>, key: unknown): V | undefined =>
  (table as Readonly<Record<string, V | undefined>>)[String(key)];

export class EpistemicError extends Error {
  readonly code: string;
  readonly detail: unknown;
  constructor(code: string, message: string, detail: unknown = null) {
    super(`${code}: ${message}`);
    this.name = "EpistemicError";
    this.code = code;
    this.detail = detail;
  }
}
const L = (ar: string, en: string): Bilingual => Object.freeze({ ar, en });

/**
 * FACT: CHARTER.md §3.5, verbatim and in charter order. The names come from the directive §4.2 (:346-352: "Introduce:"),
 * in the same order; :342 "Every displayed procedural statement must have a defined knowledge status."
 */
export const EPISTEMIC_CLASSES = Object.freeze([
  "RECORDED_FACT",
  "DERIVED_FROM_VERIFIED_FACTS",
  "EXPECTED_PROCESS",
  "CONDITIONAL_STEP",
  "PROPOSED_ACTION",
  "UNVERIFIED_INFORMATION",
  "NOT_APPLICABLE",
] as const);
/** An epistemic class (charter §3.5). */
export type EpistemicClass = (typeof EPISTEMIC_CLASSES)[number];
/** A ranked epistemic class: every class but NOT_APPLICABLE, which is outside the certainty order. */
export type RankedEpistemicClass = Exclude<EpistemicClass, "NOT_APPLICABLE">;
/** PROPOSAL: most certain first (the charter and directive §4.2 listing order); NOT_APPLICABLE is not a degree of certainty. */
export const CERTAINTY_ORDER: readonly RankedEpistemicClass[] = Object.freeze(
  EPISTEMIC_CLASSES.filter((c): c is RankedEpistemicClass => c !== "NOT_APPLICABLE"),
);

export const CLASS_LABELS: Readonly<Record<EpistemicClass, Bilingual>> = Object.freeze({
  RECORDED_FACT: L("واقعة مسجَّلة", "Recorded fact"),
  DERIVED_FROM_VERIFIED_FACTS: L("مشتق من وقائع متحقَّق منها", "Derived from verified facts"),
  EXPECTED_PROCESS: L("إجراء متوقع", "Expected process"),
  CONDITIONAL_STEP: L("خطوة مشروطة", "Conditional step"),
  PROPOSED_ACTION: L("إجراء مقترح", "Proposed action"),
  UNVERIFIED_INFORMATION: L("معلومة غير متحقَّق منها", "Unverified information"),
  NOT_APPLICABLE: L("لا ينطبق", "Not applicable"),
});

export function isEpistemicClass(c: unknown): c is EpistemicClass {
  return (EPISTEMIC_CLASSES as readonly unknown[]).includes(c);
}

/** 0 = most certain … 5 = least certain; null for NOT_APPLICABLE; EpistemicError for anything else. */
export function certaintyRank(cls: "NOT_APPLICABLE"): null;
export function certaintyRank(cls: RankedEpistemicClass): number;
export function certaintyRank(cls: unknown): number | null;
export function certaintyRank(cls: unknown): number | null {
  if (cls === "NOT_APPLICABLE") return null;
  const i = (CERTAINTY_ORDER as readonly unknown[]).indexOf(cls);
  if (i < 0) throw new EpistemicError("UNKNOWN_EPISTEMIC_CLASS", `not an epistemic class: ${String(cls)}`);
  return i;
}

/** The least certain of ranked classes (the binding ceiling when several limits apply). */
export function leastCertain(...classes: EpistemicClass[]): EpistemicClass {
  const ranked = classes.filter((c): c is RankedEpistemicClass => c !== "NOT_APPLICABLE");
  if (!ranked.length) return "NOT_APPLICABLE";
  return ranked.reduce((a, b) => (certaintyRank(b) > certaintyRank(a) ? b : a));
}

/** Non-throwing: does `displayClass` claim more certainty than `sourceClass` allows? (NOT_APPLICABLE rules below.) */
export function exceeds(displayClass: string, sourceClass: string): boolean {
  const d = certaintyRank(displayClass);
  const s = certaintyRank(sourceClass); // validate both
  if (sourceClass === "NOT_APPLICABLE") return displayClass !== "NOT_APPLICABLE";
  if (displayClass === "NOT_APPLICABLE") return (s as number) > certaintyRank("DERIVED_FROM_VERIFIED_FACTS");
  return (d as number) < (s as number); // both ranked here: certaintyRank threw for anything else
}

/**
 * assertNotExceeding(displayClass, sourceClass) → true, or EpistemicError EPISTEMIC_CEILING_EXCEEDED.
 * Charter §0.5. NOT_APPLICABLE: a NOT_APPLICABLE source admits only a NOT_APPLICABLE display; a NOT_APPLICABLE display
 * needs a recorded or derived basis (a recorded selection or outcome), never an expectation.
 */
export function assertNotExceeding(displayClass: string, sourceClass: string): true {
  if (exceeds(displayClass, sourceClass)) {
    throw new EpistemicError(
      "EPISTEMIC_CEILING_EXCEEDED",
      `display ${displayClass} exceeds source ${sourceClass}`,
      { displayClass, sourceClass },
    );
  }
  return true;
}

/** A Layer A state: its symbol and accessible name. */
export interface LayerAState {
  readonly symbol: string;
  readonly aria: Bilingual;
}
/** A Layer B kind: its symbol and label. */
export interface LayerBKind {
  readonly symbol: string;
  readonly label: Bilingual;
}
// ---- FACT: CHARTER.md §3.6, extracted programmatically from the charter text (Arabic copied, not retyped; re-checked by tests/status.test.js ST-20). English labels: W-A translation (PROPOSAL).
export const LAYER_A_STATES = Object.freeze({
  COMPLETED: Object.freeze({
    symbol: "✔",
    aria: Object.freeze({ ar: "اكتمل — تم تسجيل الإجراء", en: "Completed — the action was recorded" }),
  }),
  IN_PROGRESS: Object.freeze({ symbol: "●", aria: Object.freeze({ ar: "جارٍ", en: "In progress" }) }),
  PENDING: Object.freeze({
    symbol: "○",
    aria: Object.freeze({ ar: "بانتظار إجراء محدد", en: "Awaiting a specific action" }),
  }),
  SUSPENDED: Object.freeze({
    symbol: "⏸",
    aria: Object.freeze({ ar: "موقوف مؤقتاً", en: "Temporarily suspended" }),
  }),
  RETURNED: Object.freeze({
    symbol: "↩",
    aria: Object.freeze({ ar: "أُعيد لاستكمال متطلبات", en: "Returned to complete requirements" }),
  }),
  CANCELLED: Object.freeze({ symbol: "✕", aria: Object.freeze({ ar: "أُلغي", en: "Cancelled" }) }),
  FAILED: Object.freeze({
    symbol: "⚠",
    aria: Object.freeze({ ar: "تعذر إتمامه", en: "Could not be completed" }),
  }),
  NOT_APPLICABLE: Object.freeze({
    symbol: "—",
    aria: Object.freeze({ ar: "لا ينطبق", en: "Not applicable" }),
  }),
} as const) satisfies Readonly<Record<string, LayerAState>>;
/** A Layer A (Actual Progress) state of charter §3.6. */
export type LayerAStateId = keyof typeof LAYER_A_STATES;
export const LAYER_B_KINDS = Object.freeze({
  EXPECTED: Object.freeze({ symbol: "◇", label: Object.freeze({ ar: "خطوة متوقعة", en: "Expected step" }) }),
  CONDITIONAL: Object.freeze({
    symbol: "◇",
    label: Object.freeze({ ar: "خطوة محتملة — بحسب …", en: "Possible step — depending on …" }),
  }),
  OPTIONAL: Object.freeze({
    symbol: "◇",
    label: Object.freeze({ ar: "خطوة اختيارية", en: "Optional step" }),
  }),
  ALTERNATIVE: Object.freeze({
    symbol: "◇",
    label: Object.freeze({ ar: "مسار بديل", en: "Alternative path" }),
  }),
  PARALLEL: Object.freeze({ symbol: "◇", label: Object.freeze({ ar: "بالتوازي", en: "In parallel" }) }),
  SUBJECT_TO_APPROVAL: Object.freeze({
    symbol: "◇",
    label: Object.freeze({ ar: "رهن الاعتماد", en: "Subject to approval" }),
  }),
} as const) satisfies Readonly<Record<string, LayerBKind>>;
/** A Layer B (Expected Process) kind of charter §3.6. */
export type LayerBKindId = keyof typeof LAYER_B_KINDS;
/** Charter §3.6: Layer B is "never ✔/●, never the words سُجل / اكتُمل / تم"; directive §7 :622 "Expected steps must never display verified-completion symbols.", :647 "Do not use the same iconography for both." */
export const LAYER_B_FORBIDDEN_WORDS = Object.freeze(["سُجل", "اكتُمل", "تم"] as const);

export const LAYER_A_STATE_IDS = Object.freeze(Object.keys(LAYER_A_STATES) as LayerAStateId[]);
export const LAYER_B_KIND_IDS = Object.freeze(Object.keys(LAYER_B_KINDS) as LayerBKindId[]);

/**
 * Which classes a display state may carry (PROPOSAL, from charter §3.5–§3.6): a Layer A state is a claim of fact
 * (RECORDED_FACT or DERIVED_FROM_VERIFIED_FACTS; NOT_APPLICABLE also with the NOT_APPLICABLE class); a Layer B kind is
 * at most EXPECTED_PROCESS (EXPECTED, PARALLEL) or CONDITIONAL_STEP (the others) and at least PROPOSED_ACTION.
 */
/** The band of classes a display state may carry, discriminated by its progress layer. */
export type DisplayStateBand =
  | {
      readonly layer: "A";
      readonly ceiling: "RECORDED_FACT";
      readonly floor: "DERIVED_FROM_VERIFIED_FACTS";
      readonly not_applicable: boolean;
    }
  | {
      readonly layer: "B";
      readonly ceiling: "EXPECTED_PROCESS" | "CONDITIONAL_STEP";
      readonly floor: "PROPOSED_ACTION";
      readonly not_applicable: false;
    };
export const DISPLAY_STATE_BANDS: Readonly<Record<string, DisplayStateBand>> = Object.freeze({
  ...Object.fromEntries(
    LAYER_A_STATE_IDS.map((s): [string, DisplayStateBand] => [
      s,
      Object.freeze({
        layer: "A",
        ceiling: "RECORDED_FACT",
        floor: "DERIVED_FROM_VERIFIED_FACTS",
        not_applicable: s === "NOT_APPLICABLE",
      }),
    ]),
  ),
  EXPECTED: Object.freeze({
    layer: "B",
    ceiling: "EXPECTED_PROCESS",
    floor: "PROPOSED_ACTION",
    not_applicable: false,
  }),
  PARALLEL: Object.freeze({
    layer: "B",
    ceiling: "EXPECTED_PROCESS",
    floor: "PROPOSED_ACTION",
    not_applicable: false,
  }),
  CONDITIONAL: Object.freeze({
    layer: "B",
    ceiling: "CONDITIONAL_STEP",
    floor: "PROPOSED_ACTION",
    not_applicable: false,
  }),
  OPTIONAL: Object.freeze({
    layer: "B",
    ceiling: "CONDITIONAL_STEP",
    floor: "PROPOSED_ACTION",
    not_applicable: false,
  }),
  ALTERNATIVE: Object.freeze({
    layer: "B",
    ceiling: "CONDITIONAL_STEP",
    floor: "PROPOSED_ACTION",
    not_applicable: false,
  }),
  SUBJECT_TO_APPROVAL: Object.freeze({
    layer: "B",
    ceiling: "CONDITIONAL_STEP",
    floor: "PROPOSED_ACTION",
    not_applicable: false,
  }),
});

/** May a statement of class `cls` be shown with `displayState` (a Layer A state or a Layer B kind)? */
export function displayStateAllows(displayState: unknown, cls: unknown): boolean {
  const b = lookup(DISPLAY_STATE_BANDS, displayState);
  if (!b) return false;
  if (cls === "NOT_APPLICABLE") return b.not_applicable;
  const r = certaintyRank(cls) as number; // certaintyRank threw unless cls is a ranked class
  return r >= certaintyRank(b.ceiling) && r <= certaintyRank(b.floor);
}

/** The display states a class may use (inverse of DISPLAY_STATE_BANDS). UNVERIFIED_INFORMATION may use none. */
export function maxDisplayStates(cls: string): readonly string[] {
  certaintyRank(cls);
  return Object.freeze(Object.keys(DISPLAY_STATE_BANDS).filter((s) => displayStateAllows(s, cls)));
}

/** PROPOSAL: certainty ceiling per Event.provenance.source (charter §3.3). A manual entry is never more than unverified. */
export const PROVENANCE_CEILING: Readonly<Record<string, EpistemicClass>> = Object.freeze({
  PLATFORM_RECORD: "RECORDED_FACT",
  SYNTHETIC_DEMO: "RECORDED_FACT", // within the synthetic demonstration only; outputs are labelled SYNTHETIC
  MANUAL_ENTRY: "UNVERIFIED_INFORMATION",
});

/** PROPOSAL: certainty ceiling per statement source kind (a statement's `source.kind`). */
export const SOURCE_KIND_CEILING: Readonly<Record<string, EpistemicClass>> = Object.freeze({
  CASE_RECORD: "RECORDED_FACT", // CaseRecord.status (charter §3.1)
  OBJECT_RECORD: "RECORDED_FACT", // ProceduralObject.status with its source event (charter §3.2)
  EVENT: "RECORDED_FACT", // the recorded event itself (charter §3.3)
  DERIVATION: "DERIVED_FROM_VERIFIED_FACTS", // a safe inference SI-01…SI-05 over recorded events
  CATALOGUE: "EXPECTED_PROCESS", // journey catalogue `next` / kinds (charter §4)
  AUTHORITY_MODEL: "PROPOSED_ACTION", // authority_v13.json is PROPOSED (charter §6)
  NEXT_ACTION: "PROPOSED_ACTION", // charter §7 ("epistemic":"PROPOSED_ACTION")
  NOTIFICATION: "UNVERIFIED_INFORMATION", // a notification is never a source of procedural truth
  EXPORT: "UNVERIFIED_INFORMATION",
  MANUAL_ENTRY: "UNVERIFIED_INFORMATION",
  NONE: "UNVERIFIED_INFORMATION",
});

/**
 * sourceCeiling(source, events) — the most certain class a statement with this source may carry: the source-kind
 * ceiling, lowered by the provenance of the cited event(s); a cited event that cannot be found ⇒ UNVERIFIED_INFORMATION.
 */
export function sourceCeiling(
  source: StatementSource | null | undefined,
  events: readonly (DomainEvent | null | undefined)[] | null = [],
): EpistemicClass {
  if (!source || typeof source !== "object" || !source.kind) return "UNVERIFIED_INFORMATION";
  const base = lookup(SOURCE_KIND_CEILING, source.kind) || "UNVERIFIED_INFORMATION";
  if (source.kind !== "EVENT" && source.kind !== "DERIVATION") return base;
  const ids = ([] as unknown[]).concat(source.event_id ?? [], source.event_ids ?? []);
  if (!ids.length) return "UNVERIFIED_INFORMATION";
  const ceilings = ids.map((id): EpistemicClass => {
    const ev = (events || []).find((e) => e && e.event_id === id);
    return ev
      ? lookup(PROVENANCE_CEILING, ev.provenance && ev.provenance.source) || "UNVERIFIED_INFORMATION"
      : "UNVERIFIED_INFORMATION";
  });
  return leastCertain(base, ...ceilings);
}

/**
 * maxDisplayCertainty(source) — the most certain class a display may carry.
 *   string (an epistemic class)  → that class: a display never exceeds its source (charter §0.5);
 *   object (a statement source)  → sourceCeiling(source, events).
 */
export function maxDisplayCertainty(
  source: string | StatementSource | null | undefined,
  events: readonly (DomainEvent | null | undefined)[] | null = [],
): EpistemicClass {
  if (typeof source === "string") {
    certaintyRank(source);
    return source as EpistemicClass;
  } // certaintyRank threw unless it is a class
  return sourceCeiling(source, events);
}

// =====================================================================================================
// Safe and forbidden inferences
// =====================================================================================================
const fz = <T>(o: T): Readonly<T> => Object.freeze(o);
/** A safe inference (charter §3.5). */
export interface SafeInference {
  readonly id: string;
  readonly premise: Bilingual;
  readonly conclusion: Bilingual;
  readonly class: EpistemicClass;
  readonly label: Label;
  readonly source: string;
}
/** Charter §3.5 "Safe inference (DERIVED)" (FACT) plus the step bound of §3.2 (FACT) and one PROPOSAL. */
export const SAFE_INFERENCES: readonly SafeInference[] = Object.freeze<SafeInference[]>([
  fz({
    id: "SI-01",
    premise: L(
      "حدث الإكمال المحدد للخطوة (completion_event_type) مسجَّل ويسمّي الكائن",
      "the step's completion_event_type event is recorded and names the object",
    ),
    conclusion: L("الخطوة مكتملة (طبقة الإنجاز الفعلي ✔)", "the step is COMPLETED (Layer A ✔)"),
    class: "DERIVED_FROM_VERIFIED_FACTS",
    label: "FACT",
    source: "CHARTER.md §3.5, §3.2",
  }),
  fz({
    id: "SI-02",
    premise: L("رمز الحالة المسجَّل في سجل القضية", "the recorded code in CaseRecord.status"),
    conclusion: L("مرحلة المستوى الأول (stageOf)", "the Level-1 stage (stageOf)"),
    class: "DERIVED_FROM_VERIFIED_FACTS",
    label: "FACT",
    source: "CHARTER.md §3.5, §3.1",
  }),
  fz({
    id: "SI-03",
    premise: L(
      "حدث أساس مسجَّل + قاعدة مسمّاة (≠ SOURCE_REQUIRED) يكون حدثها المُطلِق هو حدث الأساس",
      "a recorded basis event + a named rule (≠ SOURCE_REQUIRED) whose trigger is that event type",
    ),
    conclusion: L("المهلة", "the deadline"),
    class: "DERIVED_FROM_VERIFIED_FACTS",
    label: "FACT",
    source: "CHARTER.md §3.5, §7; PC-05",
  }),
  fz({
    id: "SI-04",
    premise: L(
      "حدث بدء الخطوة (trigger_event_type) مسجَّل ولا يوجد حدث إكمالها",
      "the step trigger event is recorded and its completion event is not",
    ),
    conclusion: L(
      "الخطوة جارية أو بانتظار إجراء — وليست مكتملة أبداً",
      "the step is IN_PROGRESS or PENDING — never COMPLETED",
    ),
    class: "DERIVED_FROM_VERIFIED_FACTS",
    label: "FACT",
    source: 'CHARTER.md §3.2 ("at most PENDING/IN_PROGRESS (if its trigger event exists)")',
  }),
  fz({
    id: "SI-05",
    premise: L(
      "حدث إكمال بديل آخر في المجموعة نفسها مسجَّل وحمولته تطابق ذلك البديل",
      "the completion event of another alternative of the same group is recorded with that alternative’s payload",
    ),
    conclusion: L("البدائل غير المختارة «لا ينطبق»", "the unchosen alternatives are NOT_APPLICABLE"),
    class: "NOT_APPLICABLE",
    label: "PROPOSAL",
    source:
      "review/v12-forensic/work/W3_journeys_review.md:173 (§6.1: alternatives not chosen «غير مختار»); CHARTER.md §4 (alternative_group)",
  }),
]);

/** One forbidden conclusion: claims about `type` (statuses or events) that the premise never supports. */
export interface ForbiddenConclusion {
  readonly type: string;
  readonly statuses: readonly string[];
  readonly events: readonly string[];
}
/** A forbidden inference (charter §3.5; directive §4.3). premise_events null = a structural rule. */
export interface ForbiddenInference {
  readonly id: string;
  readonly rule: Bilingual;
  readonly premise_events: readonly string[] | null;
  readonly conclusions: readonly ForbiddenConclusion[];
  readonly label: Label;
  readonly source: string;
  readonly related_pc: readonly string[];
}
interface ConclusionInput {
  type: string;
  statuses?: readonly string[];
  events?: readonly string[];
}
const fi = (
  id: string,
  rule: Bilingual,
  premise_events: readonly string[] | null,
  conclusions: readonly ConclusionInput[],
  label: Label,
  source: string,
  related_pc: readonly string[],
): ForbiddenInference =>
  fz({
    id,
    rule,
    premise_events: premise_events ? Object.freeze(premise_events) : null,
    conclusions: Object.freeze(
      conclusions.map((c) =>
        fz({
          type: c.type,
          statuses: Object.freeze(c.statuses || []),
          events: Object.freeze(c.events || []),
        }),
      ),
    ),
    label,
    source,
    related_pc: Object.freeze(related_pc),
  });
const MEETING_HELD: readonly string[] = [
  "OPENED",
  "CLOSED",
  "MINUTES_DRAFT",
  "MINUTES_UNDER_REVIEW",
  "MINUTES_FINAL",
];
/**
 * Forbidden inferences. FI-01…FI-05 are charter §3.5 "Never inferred" (FACT); the others follow from charter §6, §8
 * (PC-03, PC-07, PC-12…PC-17) and the first review (labelled). The directive §4.3 examples :366-374 map one to one onto
 * FI-05, FI-03, FI-07, FI-06, FI-17, FI-08, FI-04, FI-09 and FI-15 (each source names its line); :375 is a display rule
 * (INV-11; LAYER_B_FORBIDDEN_SYMBOLS). premise_events null = a structural rule checked by an invariant (named in
 * `source`) rather than an event-to-claim pair.
 */
export const FORBIDDEN_INFERENCES: readonly ForbiddenInference[] = Object.freeze([
  fi(
    "FI-01",
    L("لا تُعدّ خطوة مكتملة دون حدث إكمالها", "no step is completed without its completion event"),
    null,
    [],
    "FACT",
    `CHARTER.md §3.5; ${DIRECTIVE}:162 (§2.2), :178 (§2.6), :607 (§7); checked by INV-11`,
    ["PC-09"],
  ),
  fi(
    "FI-02",
    L("لا يُستنتج فتح التصويت من توجيه الرئيس", "a vote is never inferred open from a chair direction"),
    ["CHAIR_DIRECTION_RECORDED"],
    [
      {
        type: "BALLOT",
        statuses: ["OPEN", "COMPLETED", "FAILED"],
        events: ["BALLOT_OPENED", "BALLOT_CLOSED"],
      },
      { type: "RECOMMENDATION", statuses: ["UNDER_VOTE"] },
    ],
    "FACT",
    `CHARTER.md §3.5; ${DIRECTIVE}:959 (§12), :1113 (§16)`,
    ["PC-02"],
  ),
  fi(
    "FI-03",
    L("لا يُستنتج القرار من التوصية", "a decision is never inferred from a recommendation"),
    ["RECOMMENDATION_DRAFTED", "RECOMMENDATION_ADOPTED", "BALLOT_CLOSED", "PACKAGE_SUBMITTED_TO_AUTHORITY"],
    [
      { type: "DECISION", statuses: ["DECIDED"], events: ["AUTHORITY_DECISION_RECORDED"] },
      { type: "RECOMMENDATION", statuses: ["DECIDED"] },
    ],
    "FACT",
    `CHARTER.md §3.5; ${DIRECTIVE}:367 (§4.3 "A recommendation cannot establish a competent-authority decision.")`,
    ["PC-01"],
  ),
  fi(
    "FI-04",
    L("لا يُستنتج التسليم من التصدير", "delivery is never inferred from an export"),
    ["NOTIFICATION_EXPORTED"],
    [
      {
        type: "NOTIFICATION",
        statuses: ["SENT", "DELIVERY_CONFIRMED"],
        events: ["NOTIFICATION_SENT", "DELIVERY_CONFIRMED"],
      },
    ],
    "FACT",
    `CHARTER.md §3.5; ${DIRECTIVE}:372 (§4.3 "An exported EML file cannot establish delivery.")`,
    ["PC-15"],
  ),
  fi(
    "FI-05",
    L("لا يُستنتج إغلاق القضية من إشعار", "case closure is never inferred from a notification"),
    COMMUNICATION_EVENTS,
    [
      {
        type: "CASE",
        statuses: ["S5.05", "S5.06", "S5.07"],
        events: ["CASE_CLOSED", "CASE_STATUS_RECORDED", "CASE_REGISTERED", "CASE_CANCELLED"],
      },
    ],
    "FACT",
    `CHARTER.md §3.5, §3.1; ${DIRECTIVE}:366 (§4.3 "A notification cannot establish case closure.")`,
    ["PC-11"],
  ),
  fi(
    "FI-06",
    L(
      "لا يُستنتج انعقاد الاجتماع من الدعوة أو الجدولة",
      "a meeting is never inferred held from an invitation or a schedule",
    ),
    ["MEETING_SCHEDULED", "MEETING_RESCHEDULED", "PARTICIPANTS_INVITED", ...COMMUNICATION_EVENTS],
    [
      {
        type: "MEETING",
        statuses: MEETING_HELD,
        events: ["MEETING_OPENED", "MEETING_CLOSED", "MINUTES_FINAL"],
      },
      {
        type: "HEARING",
        statuses: MEETING_HELD,
        events: ["MEETING_OPENED", "MEETING_CLOSED", "MINUTES_FINAL"],
      },
    ],
    "FACT",
    `CHARTER.md §8 PC-03, PC-13; ${DIRECTIVE}:369 (§4.3 "A meeting invitation cannot establish that the meeting occurred."), :1114 (§16)`,
    ["PC-03", "PC-13"],
  ),
  fi(
    "FI-07",
    L(
      "لا يُستنتج الاعتماد أو القرار من الرأي النظامي",
      "adoption or a decision is never inferred from a legal opinion",
    ),
    ["LEGAL_REVIEW_REQUESTED", "LEGAL_OPINION_SUBMITTED"],
    [
      { type: "RECOMMENDATION", statuses: ["ADOPTED"], events: ["RECOMMENDATION_ADOPTED"] },
      { type: "DECISION", statuses: ["DECIDED"], events: ["AUTHORITY_DECISION_RECORDED"] },
    ],
    "FACT",
    `CHARTER.md §8 PC-12; ${DIRECTIVE}:368 (§4.3 "A submitted legal opinion cannot establish adoption of the recommendation."), :1115 (§16)`,
    ["PC-12"],
  ),
  fi(
    "FI-08",
    L("لا يُستنتج الإصدار من المسودة", "issuance is never inferred from a draft"),
    ["NOTIFICATION_DRAFTED", "MINUTES_DRAFTED", "RECOMMENDATION_DRAFTED"],
    [
      {
        type: "NOTIFICATION",
        statuses: ["QUEUED", "SENT", "DELIVERY_CONFIRMED"],
        events: ["NOTIFICATION_SENT", "DELIVERY_CONFIRMED"],
      },
      { type: "MEETING", statuses: ["MINUTES_FINAL"], events: ["MINUTES_FINAL"] },
      { type: "HEARING", statuses: ["MINUTES_FINAL"], events: ["MINUTES_FINAL"] },
      { type: "RECOMMENDATION", statuses: ["ADOPTED"], events: ["RECOMMENDATION_ADOPTED"] },
      {
        type: "DECISION",
        statuses: ["DECIDED"],
        events: ["AUTHORITY_DECISION_RECORDED", "DECISION_NOTICE_ISSUED"],
      },
    ],
    "FACT",
    `CHARTER.md §8 PC-14; ${DIRECTIVE}:371 (§4.3 "A drafted notification cannot establish that it was issued.")`,
    ["PC-14"],
  ),
  fi(
    "FI-09",
    L(
      "لا يُستنتج الإقرار بالاستلام من التسليم أو محاولته",
      "acknowledgement is never inferred from a delivery or an attempt",
    ),
    ["NOTIFICATION_SENT", "DELIVERY_ATTEMPTED", "DELIVERY_ACCEPTED_BY_PROVIDER", "DELIVERY_CONFIRMED"],
    [{ type: "NOTIFICATION", events: ["RECIPIENT_ACKNOWLEDGED"] }],
    "FACT",
    `CHARTER.md §3.4, §8 PC-16; ${DIRECTIVE}:373 (§4.3 "A delivery attempt cannot establish recipient acknowledgment."), :1009-1011 (§13)`,
    ["PC-16"],
  ),
  fi(
    "FI-10",
    L("اختيار بديل لا يُكمل البدائل الأخرى", "selecting one alternative never completes its siblings"),
    null,
    [],
    "FACT",
    `CHARTER.md §4, §8 PC-17; ${DIRECTIVE}:584 (§6); checked by INV-12`,
    ["PC-17"],
  ),
  fi(
    "FI-11",
    L(
      "لا يُستنتج القرار من إصدار تبليغه أو تسليمه",
      "a decision is never inferred from the issue or delivery of its notice",
    ),
    ["DECISION_NOTICE_ISSUED", "DECISION_NOTICE_DELIVERED", ...COMMUNICATION_EVENTS],
    [{ type: "DECISION", statuses: ["DECIDED"], events: ["AUTHORITY_DECISION_RECORDED"] }],
    "FACT",
    `CHARTER.md §6; ${DIRECTIVE}:961 (§12 "Issuing a decision notification must not be confused with making the decision."), :1112 (§16)`,
    ["PC-01", "PC-14"],
  ),
  fi(
    "FI-12",
    L("لا تُستنتج الصلاحية من المسمّى الوظيفي", "authority is never inferred from a job title"),
    null,
    [],
    "FACT",
    `CHARTER.md §2 C, §6; ${DIRECTIVE}:166 (§2.3 "The software must enforce authorized decision rights, not create them."); enforced by authority.check (W-D2)`,
    ["PC-08"],
  ),
  fi(
    "FI-13",
    L(
      "لا يُستنتج وجود القضية من إحالة أو إشعار",
      "the existence of a case is never inferred from a referral receipt or a notification",
    ),
    ["REFERRAL_RECEIVED", "REFERRAL_ACKNOWLEDGED", ...COMMUNICATION_EVENTS],
    [{ type: "CASE", events: ["CASE_REGISTERED", "CASE_STATUS_RECORDED"] }],
    "FACT",
    `CHARTER.md §3.1 (exists:false), §8 PC-07; ${DIRECTIVE}:520 (§6), :1118 (§16)`,
    ["PC-07"],
  ),
  fi(
    "FI-14",
    L(
      "لا يُستنتج موقع القضية من نوع الإشعار أو قالبه",
      "the case position is never inferred from the notification type or template",
    ),
    null,
    [],
    "FACT",
    `CHARTER.md §4 (master_hint is documentation only); ${DIRECTIVE}:517-519 (§6); D6 MF-008; checked by INV-01`,
    ["PC-11"],
  ),
  fi(
    "FI-15",
    L(
      "لا تُستنتج مهلة من ثابت في القالب دون حدث أساس",
      "no deadline is inferred from a template constant without a basis event",
    ),
    null,
    [],
    "FACT",
    `CHARTER.md §3.5, §7, §8 PC-05; ${DIRECTIVE}:374 (§4.3 "A procedural deadline cannot start from an assumed event."), :1116 (§16); D6 MF-003; checked by INV-20`,
    ["PC-05"],
  ),
  fi(
    "FI-16",
    L(
      "لا يُستنتج تأكيد التسليم من المحاولة أو قبول الناقل أو الإرسال",
      "confirmed delivery is never inferred from an attempt, provider acceptance or dispatch",
    ),
    ["NOTIFICATION_SENT", "DELIVERY_ATTEMPTED", "DELIVERY_ACCEPTED_BY_PROVIDER"],
    [{ type: "NOTIFICATION", statuses: ["DELIVERY_CONFIRMED"], events: ["DELIVERY_CONFIRMED"] }],
    "FACT",
    `CHARTER.md §3.4, §9; ${DIRECTIVE}:1001-1011 (§13 "Distinguish: … Dispatch. Provider acceptance. Delivery evidence. Recipient acknowledgment. … Do not treat these as interchangeable."); work/LEAD_notes.md L-07 (DELIVERY_CONFIRMED is its own recorded event: a provider delivery report for EMAIL, the inbox row for IN_APP under L-02); v9_data.json substates[S5.01].caution («الإرسال ≠ التسليم ≠ القراءة»)`,
    ["PC-15", "PC-16"],
  ),
  fi(
    "FI-17",
    L("لا يُستنتج فتح التصويت من طلب التصويت", "a vote is never inferred open from a requested vote"),
    ["PACKAGE_SUBMITTED_FOR_VOTE"],
    [
      {
        type: "BALLOT",
        statuses: ["OPEN", "COMPLETED", "FAILED"],
        events: ["BALLOT_OPENED", "BALLOT_CLOSED"],
      },
      { type: "RECOMMENDATION", statuses: ["UNDER_VOTE"] },
    ],
    "FACT",
    `${DIRECTIVE}:370 (§4.3 "A requested vote cannot establish that voting opened."), :1113 (§16); the platform sets the package VOTING on the request (migration 1900:795-798) and opens the vote separately (1900:841)`,
    ["PC-02"],
  ),
]);

/**
 * findForbiddenInference({premise_event_type, about_type, asserts_status, asserts_event}) → the first forbidden
 * inference whose premise is the cited event type and whose conclusion is the asserted claim, or null.
 */
/** The query of findForbiddenInference. */
export interface ForbiddenInferenceQuery {
  premise_event_type: unknown;
  about_type: unknown;
  asserts_status?: unknown;
  asserts_event?: unknown;
}
export function findForbiddenInference({
  premise_event_type,
  about_type,
  asserts_status = null,
  asserts_event = null,
}: ForbiddenInferenceQuery): ForbiddenInference | null {
  for (const f of FORBIDDEN_INFERENCES) {
    if (!f.premise_events || !(f.premise_events as readonly unknown[]).includes(premise_event_type)) continue;
    for (const c of f.conclusions) {
      if (c.type !== about_type) continue;
      if (
        (asserts_status && (c.statuses as readonly unknown[]).includes(asserts_status)) ||
        (asserts_event && (c.events as readonly unknown[]).includes(asserts_event))
      ) {
        if (asserts_event && asserts_event === premise_event_type) continue; // the event asserts itself: not an inference
        return f;
      }
    }
  }
  return null;
}

// =====================================================================================================
// Layer B text checks (heuristic, documented as such)
// =====================================================================================================
/** Marks Layer B never carries (charter §3.6 "never ✔/●"), with their common look-alikes. */
export const LAYER_B_FORBIDDEN_SYMBOLS = Object.freeze(["✔", "✓", "✅", "☑", "●", "⬤"] as const);
export function carriesCompletionMark(text: unknown): boolean {
  return /[✔✓✅☑]/u.test(String(text ?? ""));
}
export function carriesActualMark(text: unknown): boolean {
  return LAYER_B_FORBIDDEN_SYMBOLS.some((s) => String(text ?? "").includes(s));
}

const AR_DIACRITICS = /[ً-ٰٟـ]/g;
/** Arabic normalisation for matching: strip harakat, superscript alef and tatweel; unify alef forms. */
export function normalizeArabic(text: unknown): string {
  return String(text ?? "")
    .replace(AR_DIACRITICS, "")
    .replace(/[أإآ]/g, "ا");
}
// Completion verbs after normalisation (inflections of تم / اكتمل / مكتمل). The bare form «سجل» is also the noun
// "record/log", so the passive سُجل is matched only with its damma (raw text), and the feminine verb «سجلت» after it.
const AR_COMPLETION_TOKENS = new Set([
  "تم",
  "وتم",
  "فتم",
  "تمت",
  "وتمت",
  "فتمت",
  "اكتمل",
  "اكتملت",
  "واكتمل",
  "واكتملت",
  "فاكتمل",
  "مكتمل",
  "مكتملة",
  "مكتملا",
  "سجلت",
  "وسجلت",
]);
const AR_PASSIVE_RECORDED = /(^|[\s«(،،.:—-])و?سُ[ـ]*[ً-ٟ]*ج[ً-ٟ]*ل/u;
const EN_COMPLETION = /\b(completed|done)\b|(?<!\b(?:will|to|must|shall|may|can|should) be )\brecorded\b/i;

/**
 * containsCompletionWording(text) → the matched word or null. HEURISTIC (documented): Arabic tokens are compared after
 * normalisation; the passive «سُجل» needs its damma; English matches completed / done / recorded (not "will be recorded").
 */
export function containsCompletionWording(text: unknown): string | null {
  const raw = String(text ?? "");
  const m = AR_PASSIVE_RECORDED.exec(raw);
  if (m) return "سُجل";
  for (const tok of normalizeArabic(raw).split(/[^ء-ي]+/u))
    if (tok && AR_COMPLETION_TOKENS.has(tok)) return tok;
  const e = EN_COMPLETION.exec(raw);
  return e ? e[0] : null;
}
