// lib/journeys/progress.ts — W-C (V13-06). Actual vs Expected progress: the view model for one recipient.
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Pure functions over plain JSON (TypeScript port of
// the V13 reference src/journeys/progress.js; behaviour unchanged).
//
// buildProgressView(l1, l23, recipientClass, options)
//   l1  = resolveLevel1(caseRecord, catalogue)           (null when the case does not exist)
//   l23 = resolveLevel2_3(object, catalogue, assignment, events)
// Returns a view model with Layer A (actual: one of eight states, solid) and Layer B (expected: ◇ + kind label,
// dashed, muted). The owner's Level-1 rules are applied here (witness: no Level 1; public and scope recipients:
// Level-1 stage names only; internal recipients: stage and sub-state). Step visibility follows the catalogue.
// The disclosure projection (W-F policy, W-D2 project()) runs afterwards: every part carries its policy field name
// and the model leaves here with _disclosure_applied === false, so a renderer must refuse it until it is projected.
// The returned model is a detached, deeply frozen copy (no object shared with the resolver output or the catalogue).

import type {
  ActualRow,
  ActualState,
  Anomaly,
  Bilingual,
  CaseFlagsResolved,
  EpistemicClass,
  ExpectedKind,
  ExpectedRow,
  Level1Result,
  Level23Result,
  NoteCode,
  ResolvedLifecycle,
  ResolverNote,
  StageKind,
  StageSummary,
  StepKind,
} from "./resolve";

export const VIEW_VERSION = "PV-V13-draft-2026-10-27";

// ================================================================== types
type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
export type ViewNoteCode = NoteCode | "PREVIOUSLY_VISITED";
export type Audience = "internal" | "scope" | "public" | "restricted" | "none";
export type L1Mode = "NONE" | "STAGE_NAMES" | "SUBSTATE";
export interface ViewStyle {
  readonly outline: "solid" | "dashed" | "dotted";
  readonly tone: "normal" | "muted";
  readonly token: string;
}

/** Level 3, Layer A item (solid, one of the eight actual states). Not assignable to or from ViewItemB. */
export interface ViewItemA {
  layer: "A";
  step_id: string;
  stage: number;
  kind: StepKind | "CHOICE";
  state: ActualState;
  symbol: string;
  label: Bilingual;
  state_label: Bilingual;
  aria: Bilingual;
  epistemic: EpistemicClass;
  evidence_event_id: string | null;
  style: ViewStyle;
  note?: NoteCode;
  note_label?: Bilingual;
  stage_level?: true;
  governance_status?: string;
  is_notice?: true;
  kind_label?: never;
  step_kind?: never;
  condition?: never;
}
/** Level 3, Layer B item (◇, dashed, muted): never an actual state, never evidence. Not assignable to or from ViewItemA. */
export interface ViewItemB {
  layer: "B";
  step_id: string;
  stage: number;
  kind: ExpectedKind;
  step_kind: StepKind;
  symbol: string;
  label: Bilingual;
  kind_label: Bilingual;
  aria: Bilingual;
  epistemic: EpistemicClass;
  style: ViewStyle;
  condition?: Bilingual;
  note?: NoteCode;
  note_label?: Bilingual;
  governance_status?: string;
  is_notice?: true;
  state?: never;
  state_label?: never;
  evidence_event_id?: never;
  stage_level?: never;
}
export interface ViewPreviousRoundItem {
  layer: "A";
  step_id: string;
  stage: number;
  state: ActualState;
  symbol: string;
  label: Bilingual;
  state_label: Bilingual;
  aria: Bilingual;
  epistemic: EpistemicClass;
  evidence_event_id: string;
  superseded_by: string;
  reason: string;
  style: ViewStyle;
  policy_field: "exception_indicator";
}
/** Level 1, Layer A stage. */
export interface L1ViewStageA {
  layer: "A";
  code: string;
  label: Bilingual;
  state: ActualState;
  symbol: string;
  state_label: Bilingual;
  aria: Bilingual;
  epistemic: EpistemicClass;
  style: ViewStyle;
  current?: true;
  note?: NoteCode;
  note_label?: Bilingual;
  policy_field?: "exception_indicator";
  reopened?: true;
  kind?: never;
  kind_label?: never;
  previously_visited?: never;
}
/** Level 1, Layer B stage (a later master stage). */
export interface L1ViewStageB {
  layer: "B";
  code: string;
  label: Bilingual;
  kind: "EXPECTED";
  symbol: string;
  kind_label: Bilingual;
  aria: Bilingual;
  epistemic: EpistemicClass;
  style: ViewStyle;
  previously_visited?: true;
  note_label?: Bilingual;
  policy_field?: "exception_indicator";
  state?: never;
  state_label?: never;
  current?: never;
  note?: never;
  reopened?: never;
}
/** Level 1, unverified stage (?, dotted): the record cannot establish it (fail closed). */
export interface L1ViewStageU {
  layer: "U";
  code: string;
  label: Bilingual;
  state: "UNVERIFIED";
  symbol: string;
  state_label: Bilingual;
  aria: Bilingual;
  epistemic?: EpistemicClass;
  style: ViewStyle;
  kind?: never;
  kind_label?: never;
  current?: never;
  note?: never;
  note_label?: never;
  policy_field?: never;
  reopened?: never;
  previously_visited?: never;
}
export type L1ViewStage = L1ViewStageA | L1ViewStageB | L1ViewStageU;
export interface L1ViewCurrent {
  code: string;
  label: Bilingual;
  state: ActualState;
  symbol: string;
  state_label: Bilingual;
  aria: Bilingual;
  substate?: { code: string; label: Bilingual; policy_field: "l1_substate" };
}
export interface Level1View {
  policy_field: "l1_stage_name";
  mode: L1Mode;
  current: L1ViewCurrent | null;
  stages: readonly L1ViewStage[];
  derivation: string;
  epistemic: EpistemicClass;
  flags?: CaseFlagsResolved;
  source_event_id?: string | null;
  recorded_at?: string | null;
}
interface StageViewBase {
  n: number;
  key: string;
  label: Bilingual;
  stage_kind: StageKind | ExpectedKind;
  stage_kind_label: Bilingual | null;
  current?: true;
}
export interface StageViewA extends StageViewBase {
  layer: "A";
  state: ActualState;
  symbol: string;
  state_label: Bilingual;
  aria: Bilingual;
  epistemic: EpistemicClass;
  style: ViewStyle;
  note?: NoteCode;
  note_label?: Bilingual;
  kind?: never;
  kind_label?: never;
}
export interface StageViewB extends StageViewBase {
  layer: "B";
  kind: ExpectedKind;
  symbol: string;
  kind_label: Bilingual;
  aria: Bilingual;
  epistemic: EpistemicClass;
  style: ViewStyle;
  state?: never;
  state_label?: never;
  note?: never;
  note_label?: never;
}
export type StageView = StageViewA | StageViewB;
export interface Level2View {
  policy_field: "l2_journey";
  journey_id: string;
  object: Bilingual;
  capacity: Bilingual;
  closure: Bilingual;
  structure: string;
  disclosure: string;
  current_stage: number | null;
  summary5: readonly StageView[] | null;
  stages: readonly StageView[];
  lifecycle: (Readonly<ResolvedLifecycle> & { readonly policy_field: "exception_indicator" }) | null;
}
export interface Level3View {
  policy_field: "l3_steps";
  stage_n: number | null;
  actual: readonly ViewItemA[];
  expected: readonly ViewItemB[];
  current_stage: { readonly actual: readonly ViewItemA[]; readonly expected: readonly ViewItemB[] };
  previous_round: readonly ViewPreviousRoundItem[];
  hidden_steps: number;
  note?: Bilingual;
}
export interface NoticeView {
  step_id: string | null;
  location: string;
  stage: number | null;
  marker: Bilingual;
}
export interface DeadlineView {
  policy_field: "deadline";
  basis_policy_field: "deadline_basis";
  kind: string;
  rule_id: string;
  label: Bilingual | null;
  at: string | null;
  status: string;
  epistemic: EpistemicClass;
  basis_event_id: string | null;
  reason: string;
}
export type LegendEntry =
  | { layer: "A"; state: ActualState; symbol: string; label: Bilingual; style: ViewStyle; kind?: never }
  | { layer: "B"; kind: ExpectedKind; symbol: string; label: Bilingual; style: ViewStyle; state?: never };
export interface ViewDiagnostics {
  anomalies: (Anomaly | { code: "UNKNOWN_RECIPIENT_CLASS"; detail: string })[];
  notes: ResolverNote[];
  never_rendered: true;
}
export interface InteractionView {
  platform: { layer_b: "COLLAPSED_EXPANDABLE"; control: Bilingual; control_collapse: Bilingual };
  email: { layer_b: "STATIC"; scope: "CURRENT_STAGE" };
}
interface ProgressViewShape {
  version: string;
  recipient_class: unknown;
  audience: Audience | null;
  policy: { l1_mode: L1Mode; basis: string } | null;
  level1: Level1View | null;
  level2: Level2View | null;
  level3: Level3View | null;
  notice: NoticeView | null;
  deadlines: readonly DeadlineView[];
  legend: readonly LegendEntry[];
  interaction: InteractionView | null;
  diagnostics: ViewDiagnostics;
  _disclosure_applied: false;
}
/** The progress view model: deeply frozen, unprojected (_disclosure_applied === false). */
export type ProgressView = DeepReadonly<ProgressViewShape>;

// ================================================================== constants
const freeze = <T>(o: T): Readonly<T> => Object.freeze(o);
const T = (ar: string, en: string): Bilingual => freeze({ ar, en });
/** A detached, deeply frozen copy: the view shares no object with its inputs (resolver output, catalogue) and cannot be changed. */
function snapshot<V>(o: V): DeepReadonly<V> {
  const deep = (x: unknown): unknown => {
    if (x && typeof x === "object") {
      for (const v of Object.values(x)) deep(v);
      Object.freeze(x);
    }
    return x;
  };
  return deep(JSON.parse(JSON.stringify(o))) as DeepReadonly<V>;
}

/** Layer A — the eight actual states (charter 3.6). */
export const SYMBOLS = freeze({
  COMPLETED: "✔",
  IN_PROGRESS: "●",
  PENDING: "○",
  SUSPENDED: "⏸",
  RETURNED: "↩",
  CANCELLED: "✕",
  FAILED: "⚠",
  NOT_APPLICABLE: "—",
} as const satisfies Record<ActualState, string>);
/** Visible label = aria text of the state (charter 3.6 gives the Arabic; English PROPOSAL). */
export const STATE_LABELS: Readonly<Record<ActualState, Bilingual>> = freeze({
  COMPLETED: T("اكتمل — تم تسجيل الإجراء", "Completed — the action is on record"),
  IN_PROGRESS: T("جارٍ", "In progress"),
  PENDING: T("بانتظار إجراء محدد", "Awaiting a specific action"),
  SUSPENDED: T("موقوف مؤقتاً", "Temporarily suspended"),
  RETURNED: T("أُعيد لاستكمال متطلبات", "Returned to complete requirements"),
  CANCELLED: T("أُلغي", "Cancelled"),
  FAILED: T("تعذر إتمامه", "Could not be completed"),
  NOT_APPLICABLE: T("لا ينطبق", "Not applicable"),
});

/** Layer B — the six expected kinds, one symbol (charter 3.6). */
export const EXPECTED_SYMBOL = "◇";
export const KIND_LABELS: Readonly<Record<ExpectedKind, Bilingual>> = freeze({
  EXPECTED: T("خطوة متوقعة", "Expected step"),
  CONDITIONAL: T("خطوة محتملة — بحسب …", "Possible step — depending on …"),
  OPTIONAL: T("خطوة اختيارية", "Optional step"),
  ALTERNATIVE: T("مسار بديل", "Alternative path"),
  PARALLEL: T("بالتوازي", "In parallel"),
  SUBJECT_TO_APPROVAL: T("رهن الاعتماد", "Subject to approval"),
});
/** Level 1 only: a later master stage is an expected stage; an earlier stage the record cannot establish shows "?". */
export const L1_EXPECTED_LABEL = T("مرحلة متوقعة", "Expected stage");
export const UNVERIFIED_SYMBOL = "?";
export const L1_UNVERIFIED_LABELS: Readonly<Record<"SUBSTATE" | "STAGE_NAMES", Bilingual>> = freeze({
  SUBSTATE: T("غير مُثبت في سجل الحالة", "Not established by the case record"),
  STAGE_NAMES: T("غير مُبيَّن", "Not shown"),
});

/** Why a step is where it is (shown next to the state or kind; never a completion wording on Layer B). */
export const NOTE_LABELS: Readonly<Record<ViewNoteCode, Bilingual>> = freeze({
  NOT_SELECTED: T("لم يُختر", "Not chosen"),
  BRANCH_NOT_TAKEN: T("مسار لم يُسلك", "Path not taken"),
  BRANCH_NOT_DECIDED: T("بحسب الخيار الذي يُعتمد", "Depends on the option chosen"),
  CONDITION_DID_NOT_ARISE: T("لم يلزم", "Not needed"),
  CONDITION_NOT_MET: T("لم يتحقق شرطها", "Its condition did not arise"),
  TERMINATED: T("انتهى المسار قبلها", "The path ended before this step"),
  TERMINATED_BEFORE_COMPLETION: T("انتهى المسار قبل إتمامها", "The path ended before this step finished"),
  CANCELLED: T("أُلغي الإجراء", "The procedure was cancelled"),
  CLOSED: T("أُقفل المسار", "The path is closed"),
  EVIDENCE_GAP: T("لا يوجد قيد لهذه الخطوة", "There is no record of this step"),
  OBJECT_RECORD: T("بحسب سجل الإجراء", "As held in the procedure record"),
  OBJECT_NOT_APPLICABLE: T("الإجراء لا ينطبق", "The procedure does not apply"),
  NOT_VISITED: T("لم تمر بها الحالة", "The case did not pass through this stage"),
  ON_EVERY_PATH: T(
    "تمر بها الحالة على كل مسار إلى موقعها",
    "Every path to the current position passes this stage",
  ),
  NOT_ESTABLISHED_BY_THE_CASE_RECORD: T("غير مُثبت في سجل الحالة", "Not established by the case record"),
  PREVIOUSLY_VISITED: T(
    "مرّت بها الحالة قبل إعادة الفتح",
    "The case passed this stage before it was reopened",
  ),
});

/** Stage kinds (Level 2 typed structure, W3 3.4: cells = phases, each typed). */
export const STAGE_KIND_LABELS: Readonly<Record<StageKind, Bilingual>> = freeze({
  SEQUENCE: T("تسلسل", "Sequence"),
  CHOICE: T("اختيار أحد البدائل", "One of several options"),
  BRANCH: T("فرع بحسب الخيار", "Branch by the option chosen"),
  PARALLEL: T("بالتوازي", "In parallel"),
  CONDITION: T("عند تحقق الشرط", "When the condition arises"),
  TERMINAL: T("الإقفال", "Closure"),
});

/** Colour tokens by name only (values belong to the design system, W-E). Colour is never the only carrier. */
export const COLOUR_TOKENS = freeze({
  COMPLETED: "progress.completed",
  IN_PROGRESS: "progress.inProgress",
  PENDING: "progress.pending",
  SUSPENDED: "progress.suspended",
  RETURNED: "progress.returned",
  CANCELLED: "progress.cancelled",
  FAILED: "progress.failed",
  NOT_APPLICABLE: "progress.notApplicable",
  EXPECTED: "progress.expected",
  UNVERIFIED: "progress.unverified",
} as const);
// plain property lookups, as in the reference (an unknown key reads undefined)
const lookup = <V>(rec: object, key: unknown): V | undefined =>
  (rec as Readonly<Record<PropertyKey, V | undefined>>)[key as PropertyKey];
const STYLE_A = (state: string): ViewStyle =>
  freeze({
    outline: "solid",
    tone: state === "NOT_APPLICABLE" ? "muted" : "normal",
    token: lookup<string>(COLOUR_TOKENS, state) || COLOUR_TOKENS.UNVERIFIED,
  });
const STYLE_B: ViewStyle = freeze({ outline: "dashed", tone: "muted", token: COLOUR_TOKENS.EXPECTED });
const STYLE_U: ViewStyle = freeze({ outline: "dotted", tone: "muted", token: COLOUR_TOKENS.UNVERIFIED });

export const NOTICE_MARKER = T("هذا الإشعار", "This notice");

/** Exception states that are also an exception indicator (W-F policy field exception_indicator). */
const EXCEPTION_STATES = new Set<string>(["SUSPENDED", "RETURNED", "CANCELLED", "FAILED"]);

export interface RecipientPolicy {
  readonly audience: Audience;
  readonly l1: L1Mode;
  readonly basis: string;
  readonly scope_audience_on_scope_journey?: boolean;
}
/**
 * Recipient classes (charter 5) → audience of catalogue step visibility and the Level-1 mode.
 * l1: NONE (witness, owner decision) | STAGE_NAMES (public and scope recipients, owner decision; restricted and
 * recused recipients by fail-closed default, PROPOSAL) | SUBSTATE (internal recipients).
 * AUTHORITY reads a scope journey (J-DR-AUTHORITY, disclosure "scope") as a scope recipient.
 */
export const RECIPIENT_POLICY = freeze({
  SECRETARY: freeze({ audience: "internal", l1: "SUBSTATE", basis: "internal recipient" }),
  CHAIR: freeze({ audience: "internal", l1: "SUBSTATE", basis: "internal recipient" }),
  MEMBER: freeze({ audience: "internal", l1: "SUBSTATE", basis: "internal recipient" }),
  INVESTIGATOR: freeze({ audience: "internal", l1: "SUBSTATE", basis: "internal recipient" }),
  LEGAL_REVIEWER: freeze({ audience: "internal", l1: "SUBSTATE", basis: "internal recipient" }),
  RESTRICTED_CASE_AUTHORITY: freeze({
    audience: "internal",
    l1: "SUBSTATE",
    basis: "internal recipient (authority of the restricted case)",
  }),
  AUTHORITY: freeze({
    audience: "internal",
    l1: "SUBSTATE",
    scope_audience_on_scope_journey: true,
    basis: "internal recipient; a scope recipient on a scope journey",
  }),
  REPORTER: freeze({
    audience: "public",
    l1: "STAGE_NAMES",
    basis: "owner decision: public recipients see Level-1 stage names only",
  }),
  REFERRING_BODY: freeze({
    audience: "scope",
    l1: "STAGE_NAMES",
    basis: "owner decision: scope recipients see Level-1 stage names only",
  }),
  EVIDENCE_HOLDER: freeze({
    audience: "scope",
    l1: "STAGE_NAMES",
    basis: "scope recipient (owner decision)",
  }),
  SUBJECT: freeze({
    audience: "restricted",
    l1: "STAGE_NAMES",
    basis: "PROPOSAL fail-closed default: no owner rule grants the sub-state",
  }),
  WITNESS: freeze({
    audience: "restricted",
    l1: "NONE",
    basis: "owner decision: the witness sees no Level 1",
  }),
  RECUSED_MEMBER: freeze({
    audience: "none",
    l1: "STAGE_NAMES",
    basis: "PROPOSAL fail-closed default: a recused seat sees no steps of the affected object",
  }),
} as const satisfies Record<string, RecipientPolicy>);
export type RecipientClass = keyof typeof RECIPIENT_POLICY;

// ------------------------------------------------------------------ wording guard (Layer B)
const HARAKAT = /[ً-ٰٟـ]/g;
/** Words Layer B never carries (charter 3.6), compared word by word after removing diacritics. */
export const FORBIDDEN_LAYER_B = freeze({
  ar: Object.freeze(["سجل", "سجلت", "اكتمل", "اكتملت", "تم", "تمت"] as const),
  en: Object.freeze(["recorded", "completed", "done"] as const),
});
const FORBIDDEN_AR: readonly string[] = FORBIDDEN_LAYER_B.ar;
const FORBIDDEN_EN: readonly string[] = FORBIDDEN_LAYER_B.en;
export function forbiddenWords(text: unknown, lang: string): string[] {
  if (typeof text !== "string" || !text) return [];
  if (lang === "en")
    return (text.toLowerCase().match(/[a-z]+/g) || []).filter((w) => FORBIDDEN_EN.includes(w));
  const words = text
    .replace(HARAKAT, "")
    .replace(/[أإآ]/g, "ا")
    .split(/[^ء-ي]+/)
    .filter(Boolean);
  return words.filter(
    (w) =>
      FORBIDDEN_AR.includes(w) || (w.length >= 3 && /^[وف]/.test(w) && FORBIDDEN_AR.includes(w.slice(1))),
  );
}

// ------------------------------------------------------------------ items
const join = (a: Bilingual, b: Bilingual): Bilingual => T(`${a.ar}: ${b.ar}`, `${a.en}: ${b.en}`);
function conditionalLabel(cond: Bilingual | undefined): Bilingual {
  if (!cond) return KIND_LABELS.CONDITIONAL;
  return T(`خطوة محتملة — بحسب ${cond.ar}`, `Possible step — depending on ${cond.en}`);
}
function itemA(x: ActualRow, noticeId: string | null): ViewItemA {
  const state = x.state;
  const stateLabel = STATE_LABELS[state];
  const it: ViewItemA = {
    layer: "A",
    step_id: x.step_id,
    stage: x.stage,
    kind: x.kind,
    state,
    symbol: SYMBOLS[state],
    label: x.label,
    state_label: stateLabel,
    aria: join(x.label, stateLabel),
    epistemic: x.epistemic,
    evidence_event_id: x.evidence_event_id ?? null,
    style: STYLE_A(state),
  };
  if (x.note) {
    it.note = x.note;
    if (lookup<Bilingual>(NOTE_LABELS, x.note)) it.note_label = NOTE_LABELS[x.note];
  }
  if (x.stage_level) it.stage_level = true;
  if (x.governance_status) it.governance_status = x.governance_status;
  if (noticeId && x.step_id === noticeId) it.is_notice = true;
  return freeze(it);
}
function itemB(x: ExpectedRow, noticeId: string | null): ViewItemB {
  const kindLabel = x.kind === "CONDITIONAL" ? conditionalLabel(x.condition) : KIND_LABELS[x.kind];
  const it: ViewItemB = {
    layer: "B",
    step_id: x.step_id,
    stage: x.stage,
    kind: x.kind,
    step_kind: x.step_kind,
    symbol: EXPECTED_SYMBOL,
    label: x.label,
    kind_label: kindLabel,
    aria: join(x.label, kindLabel),
    epistemic: x.epistemic,
    style: STYLE_B,
  };
  if (x.condition) it.condition = x.condition;
  if (x.note) {
    it.note = x.note;
    if (lookup<Bilingual>(NOTE_LABELS, x.note)) it.note_label = NOTE_LABELS[x.note];
  }
  if (x.governance_status) it.governance_status = x.governance_status;
  if (noticeId && x.step_id === noticeId) it.is_notice = true;
  return freeze(it);
}

// ------------------------------------------------------------------ Level 1
function level1View(l1: Level1Result | null, mode: L1Mode): Level1View | null {
  if (!l1 || mode === "NONE") return null;
  if (!l1.stage) {
    // unknown status code: fail closed — stage names only, nothing marked, the anomaly travels in diagnostics
    return freeze({
      policy_field: "l1_stage_name",
      mode,
      current: null,
      derivation: l1.derivation,
      epistemic: "UNVERIFIED_INFORMATION",
      stages: Object.freeze(
        l1.stages.map((s): L1ViewStage =>
          freeze({
            layer: "U",
            code: s.code,
            label: T(s.ar, s.en),
            state: "UNVERIFIED",
            symbol: UNVERIFIED_SYMBOL,
            state_label: L1_UNVERIFIED_LABELS[mode],
            aria: join(T(s.ar, s.en), L1_UNVERIFIED_LABELS[mode]),
            style: STYLE_U,
          }),
        ),
      ),
    });
  }
  const stages = l1.stages.map((s): L1ViewStage => {
    const lbl = T(s.ar, s.en);
    if (s.layer === "B") {
      const it: L1ViewStageB = {
        layer: "B",
        code: s.code,
        label: lbl,
        kind: "EXPECTED",
        symbol: EXPECTED_SYMBOL,
        kind_label: L1_EXPECTED_LABEL,
        aria: join(lbl, L1_EXPECTED_LABEL),
        epistemic: s.epistemic,
        style: STYLE_B,
      };
      if (s.previously_visited && mode === "SUBSTATE") {
        it.previously_visited = true;
        it.note_label = NOTE_LABELS.PREVIOUSLY_VISITED;
        it.policy_field = "exception_indicator";
      }
      return freeze(it);
    }
    if (s.state === "UNVERIFIED") {
      return freeze({
        layer: "U",
        code: s.code,
        label: lbl,
        state: "UNVERIFIED",
        symbol: UNVERIFIED_SYMBOL,
        state_label: L1_UNVERIFIED_LABELS[mode],
        aria: join(lbl, L1_UNVERIFIED_LABELS[mode]),
        epistemic: s.epistemic,
        style: STYLE_U,
      });
    }
    const it: L1ViewStageA = {
      layer: "A",
      code: s.code,
      label: lbl,
      state: s.state,
      symbol: SYMBOLS[s.state],
      state_label: STATE_LABELS[s.state],
      aria: join(lbl, STATE_LABELS[s.state]),
      epistemic: s.epistemic,
      style: STYLE_A(s.state),
    };
    if (s.current) it.current = true;
    if (s.note && mode === "SUBSTATE" && lookup<Bilingual>(NOTE_LABELS, s.note)) {
      it.note = s.note;
      it.note_label = NOTE_LABELS[s.note];
    }
    if (s.note === "NOT_VISITED" && mode === "STAGE_NAMES") {
      it.note = s.note;
      it.note_label = NOTE_LABELS.NOT_VISITED;
    }
    if (EXCEPTION_STATES.has(s.state)) it.policy_field = "exception_indicator";
    if (s.reopened && mode === "SUBSTATE") {
      it.reopened = true;
      it.policy_field = "exception_indicator";
    }
    return freeze(it);
  });
  const cur = stages.find((s): s is L1ViewStageA => s.layer === "A" && !!s.current) || null;
  const current: L1ViewCurrent | null = cur
    ? {
        code: cur.code,
        label: cur.label,
        state: cur.state,
        symbol: cur.symbol,
        state_label: cur.state_label,
        aria: cur.aria,
        ...(mode === "SUBSTATE" && l1.substate
          ? {
              substate: freeze({
                code: l1.substate.code,
                label: T(l1.substate.ar, l1.substate.en),
                policy_field: "l1_substate" as const,
              }),
            }
          : {}),
      }
    : null;
  const out: Level1View = {
    policy_field: "l1_stage_name",
    mode,
    current: current && freeze(current),
    stages: Object.freeze(stages),
    derivation: l1.derivation,
    epistemic: l1.epistemic,
  };
  if (mode === "SUBSTATE") {
    out.flags = l1.flags;
    out.source_event_id = l1.source_event_id;
    out.recorded_at = l1.recorded_at;
  }
  return freeze(out);
}

// ------------------------------------------------------------------ Level 2
function stageView(s: StageSummary, isCurrent: boolean): StageView {
  const lbl = T(s.ar, s.en);
  const base = {
    n: s.n,
    key: s.key,
    label: lbl,
    stage_kind: s.kind,
    stage_kind_label: lookup<Bilingual>(STAGE_KIND_LABELS, s.kind) || null,
  };
  if (s.layer === "B") {
    const kl = lookup<Bilingual>(KIND_LABELS, s.kind) || KIND_LABELS.EXPECTED;
    return freeze({
      ...base,
      layer: "B",
      kind: s.kind,
      symbol: EXPECTED_SYMBOL,
      kind_label: kl,
      aria: join(lbl, kl),
      epistemic: s.epistemic,
      style: STYLE_B,
      ...(isCurrent ? { current: true as const } : {}),
    });
  }
  return freeze({
    ...base,
    layer: "A",
    state: s.state,
    symbol: SYMBOLS[s.state],
    state_label: STATE_LABELS[s.state],
    aria: join(lbl, STATE_LABELS[s.state]),
    epistemic: s.epistemic,
    style: STYLE_A(s.state),
    ...(s.note ? { note: s.note, note_label: NOTE_LABELS[s.note] } : {}),
    ...(isCurrent ? { current: true as const } : {}),
  });
}

// ------------------------------------------------------------------ public API
/**
 * @param l1              resolveLevel1 result (null: no case — no Level 1 at all)
 * @param l23             resolveLevel2_3 result
 * @param recipientClass  one of RECIPIENT_POLICY's keys (charter 5); anything else fails closed
 * @param options         { now?: ignored (pure) }
 */
export function buildProgressView(
  l1: Level1Result | null,
  l23: Level23Result | null | undefined,
  recipientClass: unknown,
  options: Readonly<Record<string, unknown>> = {},
): ProgressView {
  void options;
  const policy: RecipientPolicy | null = Object.prototype.hasOwnProperty.call(
    RECIPIENT_POLICY,
    recipientClass as PropertyKey,
  )
    ? lookup<RecipientPolicy>(RECIPIENT_POLICY, recipientClass)!
    : null;
  const diagnostics: ViewDiagnostics = {
    anomalies: [...((l1 && l1.anomalies) || []), ...((l23 && l23.anomalies) || [])],
    notes: [...((l23 && l23.notes) || [])],
    never_rendered: true,
  };
  if (!policy) {
    diagnostics.anomalies.push({ code: "UNKNOWN_RECIPIENT_CLASS", detail: String(recipientClass) });
    return snapshot<ProgressViewShape>({
      version: VIEW_VERSION,
      recipient_class: recipientClass ?? null,
      audience: null,
      policy: null,
      level1: null,
      level2: null,
      level3: null,
      notice: null,
      deadlines: Object.freeze([]),
      legend: Object.freeze([]),
      interaction: null,
      diagnostics: freeze(diagnostics),
      _disclosure_applied: false,
    });
  }
  const J = l23 && l23.journey;
  let audience: Audience = policy.audience;
  if (
    recipientClass === "AUTHORITY" &&
    J &&
    J.disclosure === "scope" &&
    policy.scope_audience_on_scope_journey
  )
    audience = "scope";
  const l1Mode: L1Mode = policy.l1 === "SUBSTATE" && audience !== "internal" ? "STAGE_NAMES" : policy.l1;
  const visible = (x: { visibility?: unknown }): boolean =>
    audience !== "none" && Array.isArray(x.visibility) && x.visibility.includes(audience);

  // Level 1
  const level1 = level1View(l1, l1Mode);
  if (l1 && l1Mode === "NONE") diagnostics.notes.push({ code: "LEVEL1_WITHHELD", detail: policy.basis });

  // Level 2 + 3
  let level2: Level2View | null = null,
    level3: Level3View | null = null,
    notice: NoticeView | null = null;
  if (J && l23 && l23.journey) {
    const r = l23;
    const curN = r.stage ? r.stage.n : null;
    const noticeId = r.notice_step ? r.notice_step.step_id : null;
    const actualAll: readonly ActualRow[] = r.actual || [];
    const expectedAll: readonly ExpectedRow[] = r.expected || [];
    const actual = actualAll.filter(visible).map((x) => itemA(x, noticeId));
    const expected = expectedAll.filter(visible).map((x) => itemB(x, noticeId));
    const hidden = actualAll.length + expectedAll.length - actual.length - expected.length;
    const shownStages = new Set([...actual, ...expected].map((x) => x.stage));
    const stages = (r.stages || [])
      .filter((s) => audience !== "none" && (shownStages.has(s.n) || s.n === curN))
      .map((s) => stageView(s, s.n === curN));
    const capacity =
      (J.capacity_by_recipient && lookup<Bilingual>(J.capacity_by_recipient, recipientClass)) || J.capacity;
    level2 = freeze({
      policy_field: "l2_journey",
      journey_id: J.id,
      object: J.object,
      capacity,
      closure: J.closure,
      structure: J.structure,
      disclosure: J.disclosure,
      current_stage: curN,
      summary5:
        J.summary5 && J.structure === "LINEAR" && audience !== "none"
          ? Object.freeze((r.stages || []).map((s) => stageView(s, s.n === curN)))
          : null,
      stages: Object.freeze(stages),
      lifecycle: r.lifecycle
        ? freeze({ ...r.lifecycle, policy_field: "exception_indicator" as const })
        : null,
    });
    const prev = (r.previous_round || [])
      .filter((p) => {
        const a =
          actualAll.find((x) => x.step_id === p.step_id) || expectedAll.find((x) => x.step_id === p.step_id);
        return a ? visible(a) : false;
      })
      .map((p): ViewPreviousRoundItem =>
        freeze({
          layer: "A",
          step_id: p.step_id,
          stage: p.stage,
          state: p.state,
          symbol: SYMBOLS[p.state],
          label: p.label,
          state_label: STATE_LABELS[p.state],
          aria: join(p.label, STATE_LABELS[p.state]),
          epistemic: p.epistemic,
          evidence_event_id: p.evidence_event_id,
          superseded_by: p.superseded_by,
          reason: p.reason,
          style: STYLE_A(p.state),
          policy_field: "exception_indicator",
        }),
      );
    level3 = freeze({
      policy_field: "l3_steps",
      stage_n: curN,
      actual: Object.freeze(actual),
      expected: Object.freeze(expected),
      current_stage: freeze({
        actual: Object.freeze(actual.filter((x) => x.stage === curN)),
        expected: Object.freeze(expected.filter((x) => x.stage === curN)),
      }),
      previous_round: Object.freeze(prev),
      hidden_steps: hidden,
      ...(audience === "none"
        ? {
            note: T(
              "لا تُعرض خطوات هذا الإجراء لمن تنحّى عنه",
              "Steps of this procedure are not shown to a recused seat",
            ),
          }
        : {}),
    });
    if (r.notice_step) {
      const ns = r.notice_step;
      const shown =
        [...actual, ...expected, ...prev].some((x) => x.step_id === ns.step_id) ||
        (ns.location === "stage" && shownStages.has(ns.stage));
      notice = freeze(
        shown
          ? { step_id: ns.step_id, location: ns.location, stage: ns.stage, marker: NOTICE_MARKER }
          : { step_id: null, location: "NOT_SHOWN", stage: null, marker: NOTICE_MARKER },
      );
    }
  }

  // deadlines: a date only with its recorded basis and rule; otherwise the reason, never a guess
  const deadlines = ((l23 && l23.deadlines) || []).map((d): DeadlineView =>
    freeze({
      policy_field: "deadline",
      basis_policy_field: "deadline_basis",
      kind: d.kind,
      rule_id: d.rule_id,
      label: d.label || null,
      at: d.at,
      status: d.status,
      epistemic: d.epistemic,
      basis_event_id: d.basis_event_id,
      reason: d.reason,
    }),
  );

  const legend: LegendEntry[] = [
    ...(Object.keys(SYMBOLS) as ActualState[]).map((s): LegendEntry =>
      freeze({ layer: "A", state: s, symbol: SYMBOLS[s], label: STATE_LABELS[s], style: STYLE_A(s) }),
    ),
    ...(Object.keys(KIND_LABELS) as ExpectedKind[]).map((k): LegendEntry =>
      freeze({ layer: "B", kind: k, symbol: EXPECTED_SYMBOL, label: KIND_LABELS[k], style: STYLE_B }),
    ),
  ];

  return snapshot<ProgressViewShape>({
    version: VIEW_VERSION,
    recipient_class: recipientClass,
    audience,
    policy: freeze({ l1_mode: l1Mode, basis: policy.basis }),
    level1,
    level2,
    level3,
    notice,
    deadlines: Object.freeze(deadlines),
    legend: Object.freeze(legend),
    interaction: freeze({
      platform: freeze({
        layer_b: "COLLAPSED_EXPANDABLE" as const,
        control: T("عرض الخطوات المتوقعة", "Show expected steps"),
        control_collapse: T("إخفاء الخطوات المتوقعة", "Hide expected steps"),
      }),
      email: freeze({ layer_b: "STATIC" as const, scope: "CURRENT_STAGE" as const }),
    }),
    diagnostics: freeze(diagnostics),
    _disclosure_applied: false,
  });
}
