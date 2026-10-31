// lib/journeys/resolve.ts — W-C (V13-05, V13-06). Three-level journey resolution.
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Pure functions over plain JSON (TypeScript port of
// the V13 reference src/journeys/resolve.js; behaviour unchanged).
//
// Level 1  : resolveLevel1(caseRecord, catalogue)  — from CaseRecord.status.code only (charter 3.1); never from master_hint.
// Level 2/3: resolveLevel2_3(proceduralObject, catalogue, assignment, events)
//            Layer A (actual)   — a state per step, each backed by a recorded event or derived from recorded events.
//            Layer B (expected) — what the catalogue says may come next; never carries a completed or in-progress state.
// Rules (charter 3.2, 3.5, 3.6, 4): a step is COMPLETED only with an in-scope event of its completion_event_type
// (and completion_payload) or of one pattern of completion_any_of; IN_PROGRESS only with its trigger event (or one of
// trigger_any_of); with completion_target SELF the completion event must name the object itself; a notification is
// never its own evidence; selecting one alternative never completes the others; unknown or unsourced values fail closed.
// Event payload names follow W-A (lib/domain/concepts): CASE_STATUS_RECORDED.transition_id, LEGAL_OPINION_SUBMITTED.opinion;
// the earlier W-C names (transition, position) are read as aliases. Lead ruling L-05 is applied.
//
// Typing: Layer A rows (ActualRow) and Layer B rows (ExpectedRow) are distinct types that cannot be assigned to each
// other: a Layer-A row requires an actual `state` and may only carry `layer: 'A'`; a Layer-B row forbids `state`,
// `actual` and `evidence_event_id` and may only carry `layer: 'B'`.

export const ACTUAL_STATES = Object.freeze([
  "COMPLETED",
  "IN_PROGRESS",
  "PENDING",
  "SUSPENDED",
  "RETURNED",
  "CANCELLED",
  "FAILED",
  "NOT_APPLICABLE",
] as const);
export const EXPECTED_KINDS = Object.freeze([
  "EXPECTED",
  "CONDITIONAL",
  "OPTIONAL",
  "ALTERNATIVE",
  "PARALLEL",
  "SUBJECT_TO_APPROVAL",
] as const);
export const EPISTEMIC_CLASSES = Object.freeze([
  "RECORDED_FACT",
  "DERIVED_FROM_VERIFIED_FACTS",
  "EXPECTED_PROCESS",
  "CONDITIONAL_STEP",
  "PROPOSED_ACTION",
  "UNVERIFIED_INFORMATION",
  "NOT_APPLICABLE",
] as const);
export const ANOMALY_CODES = Object.freeze([
  "UNKNOWN_STATUS_CODE",
  "STATUS_SOURCE_MISSING",
  "CLOSED_OUTSIDE_S5",
  "HISTORY_ENTRY_IGNORED",
  "JOURNEY_NOT_FOUND",
  "JOURNEY_MISMATCH",
  "PROCEDURAL_OBJECT_MISSING",
  "STATUS_SOURCE_EVENT_NOT_FOUND",
  "UNVERIFIED_STEP_CLAIM",
  "UNKNOWN_STEP_CLAIM",
  "CLAIM_CONFLICTS_WITH_EVIDENCE",
  "EVIDENCE_GAP",
  "REPORTED_EVENT_NOT_FOUND",
  "ASSIGNMENT_COMPLETION_UNEVIDENCED",
  "LIFECYCLE_NOT_DECLARED",
  "MULTIPLE_ALTERNATIVES_SELECTED",
  "RETURN_NOT_MAPPED",
  "DEADLINE_CLAIM_REJECTED",
  "DUPLICATE_EVENT_ID",
] as const);

// ================================================================== types
export type ActualState = (typeof ACTUAL_STATES)[number];
export type ExpectedKind = (typeof EXPECTED_KINDS)[number];
export type EpistemicClass = (typeof EPISTEMIC_CLASSES)[number];
export type AnomalyCode = (typeof ANOMALY_CODES)[number];

export interface Bilingual {
  readonly ar: string;
  readonly en: string;
}
/** Free-form event payload (charter 3.3). */
export type Payload = Readonly<Record<string, unknown>>;
export type StepKind = "STEP" | "OPTIONAL" | "ALTERNATIVE" | "PARALLEL" | "CONDITIONAL";
export type StageKind = "SEQUENCE" | "CHOICE" | "BRANCH" | "PARALLEL" | "CONDITION" | "TERMINAL";
export type Visibility = "internal" | "scope" | "public" | "restricted";
/** Why a step or stage is where it is (resolver notes; Level-1 notes included). */
export type NoteCode =
  | "OBJECT_RECORD"
  | "NOT_SELECTED"
  | "BRANCH_NOT_TAKEN"
  | "BRANCH_NOT_DECIDED"
  | "CONDITION_DID_NOT_ARISE"
  | "CONDITION_NOT_MET"
  | "TERMINATED"
  | "TERMINATED_BEFORE_COMPLETION"
  | "CANCELLED"
  | "CLOSED"
  | "EVIDENCE_GAP"
  | "OBJECT_NOT_APPLICABLE"
  | "NOT_VISITED"
  | "ON_EVERY_PATH"
  | "NOT_ESTABLISHED_BY_THE_CASE_RECORD";

// ---- catalogue (catalogue_v13.json)
export interface EventPattern {
  readonly type: string;
  readonly payload?: Payload | null;
}
export interface AppliesRule {
  readonly match?: readonly EventPattern[];
  readonly excluded_by?: readonly EventPattern[];
}
export interface V12Ref {
  readonly stage: number;
  readonly step: number;
}
export interface CatalogueStep {
  readonly id: string;
  readonly ar: string;
  readonly en: string;
  readonly kind: StepKind;
  readonly precondition?: string | null;
  readonly precondition_any_of?: readonly string[];
  readonly trigger_event_type?: string | null;
  readonly trigger_payload?: Payload;
  readonly trigger_any_of?: readonly EventPattern[];
  readonly completion_event_type?: string | null;
  readonly completion_payload?: Payload;
  readonly completion_any_of?: readonly EventPattern[];
  readonly completion_target?: string;
  readonly fail_on?: EventPattern;
  readonly return_on?: EventPattern;
  readonly returns_to?: string;
  readonly responsible_capacity?: string;
  readonly visibility: readonly Visibility[];
  readonly next?: readonly string[];
  readonly terminal?: string | null;
  readonly alternative_group?: string | null;
  readonly wording?: string;
  readonly v12_ref?: V12Ref | null;
  readonly disclosure_review?: string;
  readonly condition?: Bilingual;
  readonly after_termination?: boolean;
  readonly applies_if?: AppliesRule;
  readonly note?: string;
  readonly governance_status?: string;
  readonly requires_approval?: boolean;
}
export interface CatalogueStage {
  readonly n: number;
  readonly key: string;
  readonly ar: string;
  readonly en: string;
  readonly kind: StageKind;
  readonly v12_stage?: number | readonly (number | null)[] | null;
  readonly steps: readonly CatalogueStep[];
  readonly applies_if?: AppliesRule;
  readonly condition?: Bilingual;
  readonly note?: string;
}
export interface LifecycleEvents {
  readonly suspend_on?: readonly EventPattern[];
  readonly resume_on?: readonly EventPattern[];
  readonly terminate_on?: readonly EventPattern[];
  readonly reopen_on?: readonly EventPattern[];
  readonly cancel_on?: readonly EventPattern[];
  readonly reopen_to?: string;
  readonly reopen_step?: string;
}
export interface JourneyLifecycle {
  readonly returnable?: boolean;
  readonly suspendable?: boolean;
  readonly reopenable?: boolean;
  readonly cancellable?: boolean;
  readonly early_termination?: boolean;
  readonly events?: LifecycleEvents;
}
export interface CatalogueJourney {
  readonly id: string;
  readonly ar: string;
  readonly en: string;
  readonly object: Bilingual;
  readonly capacity: Bilingual;
  readonly capacity_by_recipient?: Readonly<Record<string, Bilingual>>;
  readonly disclosure: string;
  readonly structure: string;
  readonly summary5?: boolean;
  readonly closure: Bilingual;
  readonly default_responsible_capacity?: string;
  readonly lifecycle?: JourneyLifecycle;
  readonly status?: string;
  readonly stages: readonly CatalogueStage[];
  readonly deadlines?: readonly { readonly kind: string; readonly rule_id: string }[];
  readonly renamed_from?: string;
  readonly wording_change?: { readonly from?: unknown; readonly reason?: string };
  readonly removed_v12_stages?: readonly { readonly n: number; readonly reason?: string }[];
  readonly coincides_with_master_closure?: boolean;
  readonly w3_findings?: readonly string[];
  readonly structure_verdict?: string;
  readonly note?: string;
  readonly note_en?: string;
}
export interface CatalogueAssignment {
  readonly id: string;
  readonly source?: string;
  readonly journey: string;
  readonly stage: number;
  readonly step_id?: string | null;
  readonly reports_event_type?: string | null;
  readonly reports_payload?: Payload;
  readonly reports_any_of?: readonly EventPattern[];
  readonly completes?: boolean;
  readonly master_hint?: string | null;
  readonly changed_from?: { readonly journey?: string; readonly stage?: number; readonly reason?: string };
  readonly step_changed_from?: unknown;
  readonly note?: string;
  readonly v12_event?: string;
  readonly v12_note?: string;
  readonly v13_note?: string;
}
export interface DeadlineRule {
  readonly kind?: string;
  readonly basis_event_type: string;
  readonly duration_days?: number | null;
  readonly duration_business_days?: number;
  readonly day_count?: string;
  readonly status: string;
  readonly computable?: boolean;
  readonly source?: string;
  readonly label?: Bilingual;
  readonly at_from_payload?: string;
}
export interface MasterStage {
  readonly code: string;
  readonly key?: string;
  readonly ar: string;
  readonly en: string;
}
export interface MasterTransition {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly v12_event?: string;
}
export interface Catalogue {
  readonly version?: string;
  readonly status?: string;
  readonly classification?: string;
  readonly author?: string;
  readonly derived_from?: unknown;
  readonly owner_rule?: unknown;
  readonly wording_status?: unknown;
  readonly rules?: unknown;
  readonly field_notes?: unknown;
  readonly visibility_classes?: unknown;
  readonly event_types?: {
    readonly owner?: string;
    readonly charter: readonly string[];
    readonly w_a_additions_used: readonly string[];
    readonly adopted_l05: readonly string[];
    readonly formal_notices: { readonly types: readonly string[] } & Readonly<Record<string, unknown>>;
    readonly communication_events?: unknown;
  };
  readonly payload_conventions?: Readonly<Record<string, unknown>>;
  readonly capacities?: {
    readonly charter?: readonly string[];
    readonly extensions_proposed?: Readonly<Record<string, string>>;
  };
  readonly master?: readonly MasterStage[];
  readonly master_sub?: Readonly<Record<string, Bilingual>>;
  readonly master_transitions?: readonly MasterTransition[];
  readonly deadline_rules?: Readonly<Record<string, DeadlineRule>>;
  readonly journeys?: readonly CatalogueJourney[];
  readonly assignments?: readonly CatalogueAssignment[];
}

// ---- inputs
export interface CaseFlags {
  readonly suspended?: boolean;
  readonly returned?: boolean;
  readonly cancelled?: boolean;
  readonly reopened?: boolean;
  readonly closed?: boolean;
}
export interface CaseHistoryEntry {
  readonly code: string;
  readonly recorded_at?: string;
}
export interface CaseRecordInput {
  readonly exists?: boolean;
  readonly case_id?: string;
  readonly internal_ref?: string | null;
  readonly track?: string;
  readonly classification?: string;
  readonly status?: {
    readonly code?: unknown;
    readonly source_event_id?: string | null;
    readonly recorded_at?: string | null;
  } | null;
  readonly flags?: CaseFlags;
  readonly restrictions?: Readonly<Record<string, unknown>>;
  /** optional contract addition (PROPOSAL); invalid entries are ignored with HISTORY_ENTRY_IGNORED */
  readonly history?: readonly unknown[];
}
export interface ObjectRef {
  readonly type?: string;
  readonly id?: string;
}
export interface StepClaim {
  readonly step_id?: string;
  readonly actual?: string;
  readonly evidence_event_id?: string | null;
}
export interface DeadlineClaim {
  readonly kind: string;
  readonly at?: string | null;
  readonly basis_rule?: string | null;
}
export interface ProceduralObjectInput {
  readonly object_id?: string;
  readonly type?: string;
  readonly case_id?: string | null;
  readonly journey_id?: string | null;
  readonly status?: string | null;
  readonly status_source_event_id?: string | null;
  readonly related_objects?: readonly (ObjectRef | null)[];
  readonly steps?: readonly (StepClaim | null)[];
  readonly deadlines?: readonly DeadlineClaim[];
}
/** A charter 3.3 event as the resolver reads it; anything without a string `type` is ignored as MALFORMED. */
export interface JourneyEvent {
  readonly event_id?: string | null;
  readonly type: string;
  readonly occurred_at?: string | null;
  readonly recorded_at?: string | null;
  readonly case_id?: string | null;
  readonly object?: ObjectRef | null;
  readonly payload?: Payload | null;
  readonly version?: number;
  readonly [field: string]: unknown;
}

// ---- outputs
export interface Anomaly {
  readonly code: AnomalyCode;
  readonly detail?: string;
}
export interface ResolverNote {
  readonly code: string;
  readonly detail: string;
}
export type CaseFlagsResolved = {
  suspended: boolean;
  returned: boolean;
  cancelled: boolean;
  reopened: boolean;
  closed: boolean;
};

interface L1StageBase {
  code: string;
  ar: string;
  en: string;
}
/** Level 1, Layer A: a stage with an actual state (recorded or derived). */
export interface Level1StageActual extends L1StageBase {
  layer: "A";
  state: ActualState;
  epistemic: EpistemicClass;
  note?: NoteCode;
  current?: true;
  reopened?: true;
  kind?: never;
  previously_visited?: never;
}
/** Level 1: a stage the case record cannot establish (shown as ?, fail closed). */
export interface Level1StageUnverified extends L1StageBase {
  layer: "A";
  state: "UNVERIFIED";
  epistemic: "UNVERIFIED_INFORMATION";
  note?: "NOT_ESTABLISHED_BY_THE_CASE_RECORD";
  current?: never;
  reopened?: never;
  kind?: never;
  previously_visited?: never;
}
/** Level 1, Layer B: a later master stage (expected). */
export interface Level1StageExpected extends L1StageBase {
  layer: "B";
  kind: "EXPECTED";
  epistemic: "EXPECTED_PROCESS";
  previously_visited?: true;
  state?: never;
  note?: never;
  current?: never;
  reopened?: never;
}
export type Level1Stage = Level1StageActual | Level1StageUnverified | Level1StageExpected;
interface Level1Common {
  exists: true;
  flags: CaseFlagsResolved;
  source_event_id: string | null;
  recorded_at: string | null;
  anomalies: Anomaly[];
}
/** A recognised status code. */
export interface Level1Known extends Level1Common {
  stage: Bilingual & { code: string };
  substate: Bilingual & { code: string };
  epistemic: "RECORDED_FACT" | "UNVERIFIED_INFORMATION";
  current_state: ActualState;
  stages: Level1Stage[];
  derivation: "HISTORY" | "DOMINATORS";
}
/** An unknown status code: fail closed — no stage, every stage unverified, nothing current. */
export interface Level1Unknown extends Level1Common {
  stage: null;
  substate: null;
  epistemic: "UNVERIFIED_INFORMATION";
  current_state: null;
  stages: Level1StageUnverified[];
  derivation: "NONE";
}
export type Level1Result = Level1Known | Level1Unknown;

/** Layer A (actual progress) row. Cannot be assigned to or from ExpectedRow. */
export interface ActualRow {
  layer?: "A";
  step_id: string;
  state: ActualState;
  actual: ActualState;
  evidence_event_id: string | null;
  epistemic: EpistemicClass;
  label: Bilingual;
  stage: number;
  kind: StepKind | "CHOICE";
  completion_event_type: string | null;
  completion_any_of?: string[];
  visibility: readonly Visibility[];
  note?: NoteCode;
  governance_status?: string;
  stage_level?: true;
  step_kind?: never;
  condition?: never;
}
/** Layer B (expected process) row: never an actual state, never evidence. Cannot be assigned to or from ActualRow. */
export interface ExpectedRow {
  layer?: "B";
  step_id: string;
  kind: ExpectedKind;
  label: Bilingual;
  condition?: Bilingual;
  stage: number;
  step_kind: StepKind;
  epistemic: EpistemicClass;
  visibility: readonly Visibility[];
  note?: NoteCode;
  governance_status?: string;
  state?: never;
  actual?: never;
  evidence_event_id?: never;
  stage_level?: never;
}
interface StageSummaryBase {
  n: number;
  key: string;
  ar: string;
  en: string;
}
export interface StageSummaryA extends StageSummaryBase {
  layer: "A";
  kind: StageKind;
  state: ActualState;
  epistemic: EpistemicClass;
  note?: "EVIDENCE_GAP";
}
export interface StageSummaryB extends StageSummaryBase {
  layer: "B";
  kind: "ALTERNATIVE" | "CONDITIONAL" | "EXPECTED";
  epistemic: EpistemicClass;
  state?: never;
  note?: never;
}
export type StageSummary = StageSummaryA | StageSummaryB;
export interface PreviousRoundRow {
  step_id: string;
  state: "COMPLETED";
  evidence_event_id: string;
  epistemic: "RECORDED_FACT";
  superseded_by: string;
  reason: "RETURN" | "REOPEN";
  label: Bilingual;
  stage: number;
}
export interface AlternativeGroup {
  group_id: string;
  steps: string[];
  selected: string | null;
  selected_count: number;
}
export interface NoticeStep {
  assignment_id: string;
  step_id: string;
  location: "actual" | "previous_round" | "expected" | "stage";
  stage: number;
}
export interface ResolvedLifecycle {
  cancelled: boolean;
  suspended: boolean;
  returned: boolean;
  reopened: boolean;
  terminated: boolean;
  failed: boolean;
  closed: boolean;
  not_applicable: boolean;
}
export interface DerivedFacts {
  ballot_open: boolean;
  ballot_open_event_id: string | null;
  recommendation_adopted: boolean;
  decision_recorded: boolean;
  decision_event_id: string | null;
  decision_outcome: unknown;
  minutes_final: { event_id: string; basis: unknown } | null;
}
export interface ResolvedDeadline {
  kind: string;
  rule_id: string;
  label?: Bilingual | null;
  basis_rule: string;
  at: string | null;
  basis_event_id: string | null;
  status: string;
  epistemic: EpistemicClass;
  reason: string;
  rule_status?: string;
}
export interface IgnoredEvent {
  event_id: string | null;
  reason: "MALFORMED" | "OBJECT_MISMATCH" | "CASE_MISMATCH" | "SUPERSEDED_VERSION";
}
export interface ResolvedJourney {
  id: string;
  object: Bilingual;
  capacity: Bilingual;
  capacity_by_recipient?: Readonly<Record<string, Bilingual>>;
  disclosure: string;
  structure: string;
  summary5: boolean;
  closure: Bilingual;
  lifecycle_flags: {
    returnable: boolean;
    suspendable: boolean;
    reopenable: boolean;
    cancellable: boolean;
    early_termination: boolean;
  };
}
export interface AssignmentEcho {
  id: string;
  journey: string;
  stage: number;
  step_id: string | null;
  reports_event_type: string | null | undefined;
  completes: boolean;
  reports_any_of?: string[];
}
export interface CurrentStage {
  n: number;
  ar: string;
  en: string;
  kind: StageKind;
  state: ActualState | null;
  layer: "A" | "B";
}
interface Level23Common {
  assignment: AssignmentEcho | null;
  anomalies: Anomaly[];
  notes: ResolverNote[];
  ignored_events: IgnoredEvent[];
}
export interface Level23Resolved extends Level23Common {
  journey: ResolvedJourney;
  stage: CurrentStage;
  assignment_stage: number | null;
  stages: StageSummary[];
  actual: ActualRow[];
  expected: ExpectedRow[];
  previous_round: PreviousRoundRow[];
  alternative_groups: AlternativeGroup[];
  notice_step: NoticeStep | null;
  lifecycle: ResolvedLifecycle;
  derived: DerivedFacts;
  deadlines: ResolvedDeadline[];
}
/** No journey could be identified: fail closed, nothing resolved. */
export interface Level23Unresolved extends Level23Common {
  journey: null;
  stage: null;
  assignment_stage: number | null;
  stages: [];
  actual: [];
  expected: [];
  previous_round: [];
  alternative_groups: [];
  notice_step: null;
  lifecycle: null;
  derived: null;
  deadlines: [];
}
export type Level23Result = Level23Resolved | Level23Unresolved;

// ================================================================== internals
const EVIDENCED = new Set<string>(["COMPLETED", "IN_PROGRESS", "FAILED", "CANCELLED"]);
const MANDATORY = new Set<string>(["STEP", "PARALLEL"]);
const DAY_MS = 86400000;

interface StepEntry {
  step: CatalogueStep;
  stage: CatalogueStage;
  journey: CatalogueJourney;
}
interface CatalogueIndex {
  cat: Catalogue;
  journeys: Map<string, CatalogueJourney>;
  steps: Map<string, StepEntry>;
  order: Map<string, string[]>;
  trans: Map<string, MasterTransition>;
  sub: Readonly<Record<string, Bilingual>>;
  master: readonly MasterStage[];
  rules: Readonly<Record<string, DeadlineRule>>;
}
/** An in-scope event, normalised. */
interface Ev {
  e: JourneyEvent;
  i: number;
  id: string;
  type: string;
  payload: Record<string, unknown>;
  t: string;
  r: string;
  v: number;
  pos: number;
}

// ------------------------------------------------------------------ catalogue index (cached per catalogue object)
const INDEX = new WeakMap<object, CatalogueIndex>();
function indexCatalogue(cat: Catalogue): CatalogueIndex {
  if (!cat || typeof cat !== "object") throw new TypeError("resolve: catalogue is required");
  let ix = INDEX.get(cat);
  if (ix) return ix;
  const journeys = new Map<string, CatalogueJourney>();
  const steps = new Map<string, StepEntry>();
  const order = new Map<string, string[]>();
  for (const j of cat.journeys || []) {
    journeys.set(j.id, j);
    const list: string[] = [];
    for (const st of j.stages || [])
      for (const s of st.steps || []) {
        steps.set(s.id, { step: s, stage: st, journey: j });
        list.push(s.id);
      }
    order.set(j.id, list);
  }
  const trans = new Map((cat.master_transitions || []).map((t) => [t.id, t] as const));
  ix = {
    cat,
    journeys,
    steps,
    order,
    trans,
    sub: cat.master_sub || {},
    master: cat.master || [],
    rules: cat.deadline_rules || {},
  };
  INDEX.set(cat, ix);
  return ix;
}

// ------------------------------------------------------------------ small helpers
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const label = (x: Bilingual): Bilingual => ({ ar: x.ar, en: x.en });
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>,
    rb = b as Record<string, unknown>;
  const ka = Object.keys(ra),
    kb = Object.keys(rb);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(ra[k], rb[k]));
}
function payloadMatches(filter: Payload | null | undefined, payload: Payload | null | undefined): boolean {
  if (!filter) return true;
  for (const [k, want] of Object.entries(filter)) {
    const got = payload ? payload[k] : undefined;
    if (Array.isArray(want)) {
      if (!want.some((w: unknown) => (w === null ? got === undefined || got === null : deepEqual(w, got))))
        return false;
    } else if (!deepEqual(want, got)) return false;
  }
  return true;
}
function matches(x: Ev, pat: EventPattern | null | undefined): boolean {
  return !!pat && !!pat.type && x.type === pat.type && payloadMatches(pat.payload, x.payload);
}
// Patterns of a step: the *_any_of list when present (lead ruling L-05: separate completion events), else the single type.
const patList = (
  list: readonly EventPattern[] | null | undefined,
  type: string | null | undefined,
  payload: Payload | null | undefined,
): readonly EventPattern[] | null =>
  Array.isArray(list) && list.length ? list : type ? [{ type, payload }] : null;
const compPats = (s: CatalogueStep) =>
  patList(s.completion_any_of, s.completion_event_type, s.completion_payload);
const trigPats = (s: CatalogueStep) => patList(s.trigger_any_of, s.trigger_event_type, s.trigger_payload);
const matchesAny = (x: Ev, pats: readonly EventPattern[] | null): boolean =>
  !!pats && pats.some((p) => matches(x, p));
const preList = (s: CatalogueStep): readonly string[] =>
  s.precondition_any_of || (s.precondition ? [s.precondition] : []);

// Objects an event names in its payload: subject_object_id (NOTIFICATION_SENT, W-C convention), object_id,
// target and related (W-A convention, lib/domain/concepts EVENT_CATALOGUE note). Ids or {type,id}.
function payloadNames(p: unknown): string[] {
  if (!p || typeof p !== "object") return [];
  const q = p as Record<string, unknown>;
  const out: string[] = [];
  const add = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (isObj(v) && typeof v.id === "string") out.push(v.id);
  };
  add(q.subject_object_id);
  add(q.object_id);
  add(q.target);
  if (Array.isArray(q.related)) q.related.forEach(add);
  else add(q.related);
  return out;
}

function normalisePayload(e: JourneyEvent, ix: CatalogueIndex): Record<string, unknown> {
  const p: Record<string, unknown> = e.payload && typeof e.payload === "object" ? { ...e.payload } : {};
  if (e.type === "CASE_STATUS_RECORDED") {
    if (p.transition_id === undefined && p.transition !== undefined) p.transition_id = p.transition; // earlier W-C name
    const t = typeof p.transition_id === "string" ? ix.trans.get(p.transition_id) : null;
    if (t) {
      if (p.to === undefined) p.to = t.to;
      if (p.from === undefined) p.from = t.from;
    }
  }
  if (e.type === "LEGAL_OPINION_SUBMITTED" && p.opinion === undefined && p.position !== undefined)
    p.opinion = p.position; // earlier W-C name
  return p;
}

// The object an event completes or closes: payload.target when present (W-A convention), else event.object.
function completedObjectId(x: Ev): string | null {
  const t = x.payload ? x.payload.target : undefined;
  if (typeof t === "string") return t;
  if (isObj(t) && typeof t.id === "string") return t.id;
  return x.e.object && typeof x.e.object.id === "string" ? x.e.object.id : null;
}

// ================================================================== LEVEL 1
/**
 * Level 1 (master journey) from the case record only.
 * @returns null when there is no case (exists !== true): no master journey is rendered at all.
 */
export function resolveLevel1(
  caseRecord: CaseRecordInput | null | undefined,
  catalogue: Catalogue,
): Level1Result | null {
  if (!caseRecord || caseRecord.exists !== true) return null;
  const ix = indexCatalogue(catalogue);
  const anomalies: Anomaly[] = [];
  const status = caseRecord.status || {};
  const f = caseRecord.flags || {};
  const flags: CaseFlagsResolved = {
    suspended: !!f.suspended,
    returned: !!f.returned,
    cancelled: !!f.cancelled,
    reopened: !!f.reopened,
    closed: !!f.closed,
  };
  const code = typeof status.code === "string" ? status.code : null;
  // plain property lookup, as in the reference (a key is coerced to a string)
  const subOf = (k: unknown): Bilingual | undefined =>
    (ix.sub as Readonly<Record<PropertyKey, Bilingual | undefined>>)[k as PropertyKey];
  const sub = code ? subOf(code) : null;
  const mcode = code ? code.split(".")[0] : null;
  const ci = ix.master.findIndex((m) => m.code === mcode);
  if (!sub || ci < 0) {
    anomalies.push({ code: "UNKNOWN_STATUS_CODE", detail: String(code) });
    return {
      exists: true,
      stage: null,
      substate: null,
      flags,
      epistemic: "UNVERIFIED_INFORMATION",
      source_event_id: status.source_event_id ?? null,
      recorded_at: status.recorded_at ?? null,
      current_state: null,
      stages: ix.master.map((m) => ({
        code: m.code,
        ar: m.ar,
        en: m.en,
        layer: "A",
        state: "UNVERIFIED",
        epistemic: "UNVERIFIED_INFORMATION",
      })),
      derivation: "NONE",
      anomalies,
    };
  }
  const known = code as string; // non-null: a sub-state was found for it
  let epistemic: "RECORDED_FACT" | "UNVERIFIED_INFORMATION" = "RECORDED_FACT";
  if (!status.source_event_id || !status.recorded_at) {
    epistemic = "UNVERIFIED_INFORMATION";
    anomalies.push({ code: "STATUS_SOURCE_MISSING", detail: known });
  }
  const m = ix.master[ci]!;
  let current: ActualState = "IN_PROGRESS";
  if (flags.cancelled) current = "CANCELLED";
  else if (flags.closed && mcode === "S5") current = "COMPLETED";
  else if (flags.suspended) current = "SUSPENDED";
  else if (flags.returned) current = "RETURNED";
  if (flags.closed && mcode !== "S5") anomalies.push({ code: "CLOSED_OUTSIDE_S5", detail: known });

  // History of recorded positions (optional contract addition, PROPOSAL); otherwise dominators over the V8 transitions.
  let history: CaseHistoryEntry[] | null = null;
  if (Array.isArray(caseRecord.history)) {
    history = [];
    for (const h of caseRecord.history as readonly unknown[]) {
      const hc = isObj(h) ? h.code : undefined;
      if (h && subOf(hc)) history.push(h as CaseHistoryEntry);
      else anomalies.push({ code: "HISTORY_ENTRY_IGNORED", detail: String(h && hc) });
    }
    history.sort((a, b) => cmp(a.recorded_at || "", b.recorded_at || ""));
  }
  const stages: Level1Stage[] = [];
  let derivation: "HISTORY" | "DOMINATORS";
  if (history) {
    derivation = "HISTORY";
    const visited = new Set(history.map((h) => h.code.split(".")[0]));
    ix.master.forEach((x, i) => {
      const base = { code: x.code, ar: x.ar, en: x.en };
      if (i < ci) {
        stages.push(
          visited.has(x.code)
            ? { ...base, layer: "A", state: "COMPLETED", epistemic: "RECORDED_FACT" }
            : {
                ...base,
                layer: "A",
                state: "NOT_APPLICABLE",
                epistemic: "NOT_APPLICABLE",
                note: "NOT_VISITED",
              },
        );
      } else if (i === ci) {
        stages.push({
          ...base,
          layer: "A",
          state: current,
          epistemic,
          current: true,
          ...(flags.reopened ? { reopened: true as const } : {}),
        });
      } else if (flags.cancelled) {
        stages.push({
          ...base,
          layer: "A",
          state: "NOT_APPLICABLE",
          epistemic: "NOT_APPLICABLE",
          note: "CANCELLED",
        });
      } else {
        stages.push({
          ...base,
          layer: "B",
          kind: "EXPECTED",
          epistemic: "EXPECTED_PROCESS",
          ...(visited.has(x.code) ? { previously_visited: true as const } : {}),
        });
      }
    });
  } else {
    derivation = "DOMINATORS";
    const dom = dominators(ix, known) || new Set<string>();
    const domStages = new Set([...dom].map((c) => c.split(".")[0]));
    ix.master.forEach((x, i) => {
      const base = { code: x.code, ar: x.ar, en: x.en };
      if (i < ci) {
        stages.push(
          domStages.has(x.code)
            ? {
                ...base,
                layer: "A",
                state: "COMPLETED",
                epistemic: "DERIVED_FROM_VERIFIED_FACTS",
                note: "ON_EVERY_PATH",
              }
            : {
                ...base,
                layer: "A",
                state: "UNVERIFIED",
                epistemic: "UNVERIFIED_INFORMATION",
                note: "NOT_ESTABLISHED_BY_THE_CASE_RECORD",
              },
        );
      } else if (i === ci) {
        stages.push({
          ...base,
          layer: "A",
          state: current,
          epistemic,
          current: true,
          ...(flags.reopened ? { reopened: true as const } : {}),
        });
      } else if (flags.cancelled) {
        stages.push({
          ...base,
          layer: "A",
          state: "NOT_APPLICABLE",
          epistemic: "NOT_APPLICABLE",
          note: "CANCELLED",
        });
      } else {
        stages.push({ ...base, layer: "B", kind: "EXPECTED", epistemic: "EXPECTED_PROCESS" });
      }
    });
  }
  return {
    exists: true,
    stage: { code: m.code, ar: m.ar, en: m.en },
    substate: { code: known, ar: sub.ar, en: sub.en },
    flags,
    epistemic,
    source_event_id: status.source_event_id ?? null,
    recorded_at: status.recorded_at ?? null,
    current_state: current,
    stages,
    derivation,
    anomalies,
  };
}

// Sub-states that every path from S1.01 to `target` must pass (removal makes the target unreachable).
function dominators(ix: CatalogueIndex, target: string): Set<string> | null {
  const adj = new Map<string, string[]>();
  for (const t of ix.trans.values()) {
    if (!adj.has(t.from)) adj.set(t.from, []);
    adj.get(t.from)!.push(t.to);
  }
  const start = "S1.01";
  const reach = (removed: string | null): boolean => {
    if (removed === start) return false;
    const seen = new Set([start]);
    const q = [start];
    while (q.length) {
      const x = q.shift()!;
      if (x === target) return true;
      for (const y of adj.get(x) || [])
        if (y !== removed && !seen.has(y)) {
          seen.add(y);
          q.push(y);
        }
    }
    return false;
  };
  if (!reach(null)) return null;
  const dom = new Set([start]);
  for (const s of Object.keys(ix.sub)) if (s !== target && s !== start && !reach(s)) dom.add(s);
  return dom;
}

// ================================================================== LEVEL 2 / 3
// Internal per-step state while resolving (Layer A or Layer B).
interface AState {
  layer: "A";
  state: ActualState;
  evidence_event_id: string | null;
  epistemic: EpistemicClass;
  note?: NoteCode;
  kind?: never;
}
interface BState {
  layer: "B";
  kind: ExpectedKind;
  epistemic: EpistemicClass;
  note?: NoteCode;
  state?: never;
  evidence_event_id?: never;
}
type StepState = AState | BState;
interface Reset {
  pos: number;
  kind: "RETURN" | "REOPEN";
  lo: number;
  hi: number;
  cause: number;
  event_id: string;
}

/**
 * Level 2 (this notification's object) and Level 3 (steps) as Layer A (actual) and Layer B (expected).
 * @param proceduralObject  charter 3.2 (optional related_objects: [{type,id}] — PROPOSAL)
 * @param catalogue         catalogue_v13.json
 * @param assignment        one entry of catalogue.assignments (the notification being rendered)
 * @param events            charter 3.3 events; events on other objects are ignored (OBJECT_MISMATCH)
 */
export function resolveLevel2_3(
  proceduralObject: ProceduralObjectInput | null | undefined,
  catalogue: Catalogue,
  assignment: CatalogueAssignment | null | undefined,
  events: readonly unknown[] | null | undefined,
): Level23Result {
  const ix = indexCatalogue(catalogue);
  const po = proceduralObject && typeof proceduralObject === "object" ? proceduralObject : null;
  const anomalies: Anomaly[] = [];
  const notes: ResolverNote[] = [];
  const ignored: IgnoredEvent[] = [];
  if (!po) anomalies.push({ code: "PROCEDURAL_OBJECT_MISSING" });
  const jid = (po && po.journey_id) || (assignment && assignment.journey) || null;
  if (po && po.journey_id && assignment && assignment.journey && po.journey_id !== assignment.journey) {
    anomalies.push({
      code: "JOURNEY_MISMATCH",
      detail: `object ${po.journey_id}; assignment ${assignment.id} ${assignment.journey}`,
    });
  }
  const J = jid ? ix.journeys.get(jid) : null;
  const asgEcho: AssignmentEcho | null = assignment
    ? {
        id: assignment.id,
        journey: assignment.journey,
        stage: assignment.stage,
        step_id: assignment.step_id ?? null,
        reports_event_type: assignment.reports_event_type,
        completes: !!assignment.completes,
        ...(Array.isArray(assignment.reports_any_of) && assignment.reports_any_of.length
          ? { reports_any_of: assignment.reports_any_of.map((p) => p.type) }
          : {}),
      }
    : null;
  if (!J) {
    anomalies.push({ code: "JOURNEY_NOT_FOUND", detail: String(jid) });
    return {
      journey: null,
      assignment: asgEcho,
      stage: null,
      assignment_stage: assignment ? assignment.stage : null,
      stages: [],
      actual: [],
      expected: [],
      previous_round: [],
      alternative_groups: [],
      notice_step: null,
      lifecycle: null,
      derived: null,
      deadlines: [],
      anomalies,
      notes,
      ignored_events: ignored,
    };
  }
  const asg = assignment && assignment.journey === J.id ? assignment : null;

  // ---- events in scope, ordered
  const scope = new Set(
    [po && po.object_id, ...((po && po.related_objects) || []).map((o) => o && o.id)].filter(Boolean),
  );
  const byId = new Map<string, Ev>();
  (Array.isArray(events) ? events : []).forEach((raw: unknown, i: number) => {
    if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string") {
      // a malformed entry's event_id passes through unchanged, as in the reference
      ignored.push({
        event_id: ((raw && (raw as { event_id?: string | null }).event_id) ?? null) as string | null,
        reason: "MALFORMED",
      });
      return;
    }
    const e = raw as JourneyEvent;
    const objHit = !!(e.object && scope.has(e.object.id));
    const payHit = payloadNames(e.payload).some((id) => scope.has(id));
    const caseHit = !!(e.object && e.object.type === "CASE" && po && po.case_id && e.case_id === po.case_id);
    if (!(objHit || payHit || caseHit)) {
      ignored.push({ event_id: e.event_id ?? null, reason: "OBJECT_MISMATCH" });
      return;
    }
    if (objHit && po && po.case_id && e.case_id && e.case_id !== po.case_id) {
      ignored.push({ event_id: e.event_id ?? null, reason: "CASE_MISMATCH" });
      return;
    }
    const x: Ev = {
      e,
      i,
      id: e.event_id ?? `#${i}`,
      type: e.type,
      payload: normalisePayload(e, ix),
      t: String(e.occurred_at || e.recorded_at || ""),
      r: String(e.recorded_at || ""),
      v: Number(e.version) || 1,
      pos: 0,
    };
    const prev = byId.get(x.id);
    if (prev) {
      if (prev.v === x.v) anomalies.push({ code: "DUPLICATE_EVENT_ID", detail: x.id });
      if (x.v >= prev.v) {
        ignored.push({ event_id: x.id, reason: "SUPERSEDED_VERSION" });
        byId.set(x.id, x);
      } else ignored.push({ event_id: x.id, reason: "SUPERSEDED_VERSION" });
      return;
    }
    byId.set(x.id, x);
  });
  const evs = [...byId.values()].sort((a, b) => cmp(a.t, b.t) || cmp(a.r, b.r) || a.i - b.i);
  evs.forEach((x, pos) => {
    x.pos = pos;
  });
  const evById = new Map(evs.map((x) => [x.id, x] as const));
  const evGet = (id: string | null | undefined): Ev | undefined =>
    id === null || id === undefined ? undefined : evById.get(id);

  // ---- steps
  const order = ix.order.get(J.id)!;
  const S = order.map((id) => ix.steps.get(id)!);
  const idx = (id: string | null | undefined): number => (order as readonly unknown[]).indexOf(id);
  const lc: JourneyLifecycle = J.lifecycle || {};
  const lcEv: LifecycleEvents = lc.events || {};

  // ---- rounds: returns and reopenings reset the steps they cover
  const resets: Reset[] = [];
  for (const x of evs) {
    S.forEach(({ step }, k) => {
      if (step.return_on && matches(x, step.return_on)) {
        const lo = idx(step.returns_to);
        resets.push({ pos: x.pos, kind: "RETURN", lo: lo < 0 ? k : lo, hi: k, cause: k, event_id: x.id });
      }
    });
    if ((lcEv.reopen_on || []).some((p) => matches(x, p))) {
      resets.push({
        pos: x.pos,
        kind: "REOPEN",
        lo: Math.max(0, idx(lcEv.reopen_to)),
        hi: S.length - 1,
        cause: idx(lcEv.reopen_step),
        event_id: x.id,
      });
    }
  }
  const ws: number[] = new Array<number>(S.length).fill(0);
  const wsBy: (Reset | null)[] = new Array<Reset | null>(S.length).fill(null);
  S.forEach((_, k) => {
    for (const r of resets) {
      if ((k >= r.lo && k <= r.hi) || k === r.cause) {
        const v = k === r.cause ? r.pos : r.pos + 1;
        if (v > ws[k]!) {
          ws[k] = v;
          wsBy[k] = r;
        }
      }
    }
  });
  // completion / trigger tests of a step (any_of lists; completion_target SELF needs the object itself;
  // an event that matches the step's fail_on is never its completion, e.g. BALLOT_CLOSED with result NO_QUORUM)
  const selfId = po && typeof po.object_id === "string" ? po.object_id : null;
  const compOk = (x: Ev, step: CatalogueStep): boolean =>
    matchesAny(x, compPats(step)) &&
    !(step.fail_on && matches(x, step.fail_on)) &&
    (step.completion_target !== "SELF" || (!!selfId && completedObjectId(x) === selfId));
  const trigOk = (x: Ev, step: CatalogueStep): boolean => matchesAny(x, trigPats(step));
  const latestIn = (k: number, pred: (x: Ev) => boolean): Ev | null => {
    let f: Ev | null = null;
    for (const x of evs) if (x.pos >= ws[k]! && pred(x)) f = x;
    return f;
  };
  const lastMatch = (pats: readonly EventPattern[] | undefined): Ev | null => {
    let f: Ev | null = null;
    for (const x of evs) if ((pats || []).some((p) => matches(x, p))) f = x;
    return f;
  };

  // ---- phase A: states with evidence
  const st: (StepState | null)[] = new Array<StepState | null>(S.length).fill(null);
  const A = (
    state: ActualState,
    x: Ev | null | undefined,
    epistemic: EpistemicClass = "RECORDED_FACT",
    note?: NoteCode,
  ): AState => ({
    layer: "A",
    state,
    evidence_event_id: x ? x.id : null,
    epistemic,
    ...(note ? { note } : {}),
  });
  const NA = (note: NoteCode): AState => ({
    layer: "A",
    state: "NOT_APPLICABLE",
    evidence_event_id: null,
    epistemic: "NOT_APPLICABLE",
    note,
  });
  const B = (kind: ExpectedKind, note?: NoteCode): BState => ({
    layer: "B",
    kind,
    epistemic: kind === "CONDITIONAL" || kind === "ALTERNATIVE" ? "CONDITIONAL_STEP" : "EXPECTED_PROCESS",
    ...(note ? { note } : {}),
  });
  S.forEach(({ step }, k) => {
    const comp = latestIn(k, (x) => compOk(x, step));
    const trig = latestIn(k, (x) => trigOk(x, step));
    const fail = step.fail_on ? latestIn(k, (x) => matches(x, step.fail_on)) : null;
    const ret = step.return_on ? latestIn(k, (x) => matches(x, step.return_on)) : null;
    if (ret && !(comp && comp.pos > ret.pos)) st[k] = A("RETURNED", ret);
    else if (fail && (!comp || fail.pos > comp.pos)) st[k] = A("FAILED", fail);
    else if (comp) st[k] = A(step.terminal === "CANCELLED" ? "CANCELLED" : "COMPLETED", comp);
    else if (trig) st[k] = A("IN_PROGRESS", trig);
  });
  const previousRound: PreviousRoundRow[] = [];
  S.forEach(({ step }, k) => {
    if (!ws[k]) return;
    if (!compPats(step)) return;
    let f: Ev | null = null;
    for (const x of evs) if (x.pos < ws[k]! && compOk(x, step)) f = x;
    if (f)
      previousRound.push({
        step_id: step.id,
        state: "COMPLETED",
        evidence_event_id: f.id,
        epistemic: "RECORDED_FACT",
        superseded_by: wsBy[k]!.event_id,
        reason: wsBy[k]!.kind,
        label: label(step),
        stage: Number(step.id.split("/").slice(-2)[0]),
      });
  });

  // ---- phase A': object-recorded non-completion claims (accepted only with an in-scope evidence event)
  const claims = po && Array.isArray(po.steps) ? po.steps : [];
  for (const c of claims) {
    const k = c ? idx(c.step_id) : -1;
    if (k < 0) {
      anomalies.push({ code: "UNKNOWN_STEP_CLAIM", detail: String(c && c.step_id) });
      continue;
    }
    const cl = c as StepClaim; // non-null: idx(...) >= 0
    if (!["NOT_APPLICABLE", "SUSPENDED", "RETURNED", "CANCELLED", "FAILED"].includes(cl.actual as string))
      continue;
    const ev = cl.evidence_event_id ? evById.get(cl.evidence_event_id) : null;
    if (!ev) {
      anomalies.push({
        code: "UNVERIFIED_STEP_CLAIM",
        detail: `${cl.step_id} ${cl.actual} (${cl.evidence_event_id ?? "no evidence"})`,
      });
      continue;
    }
    const cur = st[k];
    if (cur && cur.state === "COMPLETED") {
      anomalies.push({
        code: "CLAIM_CONFLICTS_WITH_EVIDENCE",
        detail: `${cl.step_id} claimed ${cl.actual}; completion recorded (${cur.evidence_event_id})`,
      });
      continue;
    }
    st[k] =
      cl.actual === "NOT_APPLICABLE"
        ? { ...NA("OBJECT_RECORD"), evidence_event_id: ev.id }
        : A(cl.actual as ActualState, ev, "RECORDED_FACT", "OBJECT_RECORD");
  }

  // ---- phase B: lifecycle facts (facts win over declared flags)
  let poStatus: string | null = null,
    poStatusEv: Ev | null = null;
  if (po && po.status) {
    const se = po.status_source_event_id ? evById.get(po.status_source_event_id) : null;
    if (se) {
      poStatus = po.status;
      poStatusEv = se;
    } else
      anomalies.push({
        code: "STATUS_SOURCE_EVENT_NOT_FOUND",
        detail: `${po.status} (${po.status_source_event_id ?? "none"})`,
      });
  }
  const after = (x: Ev | null, y: Ev | null): boolean => !!x && (!y || x.pos > y.pos);
  const reopenEv = lastMatch(lcEv.reopen_on);
  const cancelEv = lastMatch(lcEv.cancel_on);
  const termEv = lastMatch(lcEv.terminate_on);
  const suspEv = lastMatch(lcEv.suspend_on);
  const resEv = lastMatch(lcEv.resume_on);
  const cancelStep = st.findIndex((s) => s && s.state === "CANCELLED" && s.note !== "OBJECT_RECORD");
  const cancelled = (cancelEv && after(cancelEv, reopenEv)) || poStatus === "CANCELLED" || cancelStep >= 0;
  const terminated = !!termEv && after(termEv, reopenEv);
  const suspended = poStatus === "ON_HOLD" || (!!suspEv && after(suspEv, resEv));
  const reopened = !!reopenEv;
  const notApplicable = poStatus === "NOT_APPLICABLE";
  const failedStatus = poStatus === "FAILED";
  const declared: readonly [
    string,
    boolean,
    "cancellable" | "suspendable" | "reopenable" | "early_termination" | "returnable",
  ][] = [
    ["cancelled", cancelled, "cancellable"],
    ["suspended", suspended, "suspendable"],
    ["reopened", reopened, "reopenable"],
    ["terminated", terminated, "early_termination"],
    ["returned", st.some((s) => s && s.state === "RETURNED") || poStatus === "RETURNED", "returnable"],
  ];
  for (const [what, fact, flag] of declared)
    if (fact && !lc[flag])
      anomalies.push({ code: "LIFECYCLE_NOT_DECLARED", detail: `${what} recorded but ${flag} is false` });
  if (poStatus === "RETURNED" && !st.some((s) => s && s.state === "RETURNED"))
    anomalies.push({
      code: "RETURN_NOT_MAPPED",
      detail: `${(po as ProceduralObjectInput).status_source_event_id}`,
    });
  const closedIdx = S.findIndex(
    ({ step }, k) => step.terminal === "CLOSED" && st[k] && st[k]!.state === "COMPLETED",
  );
  const closed = closedIdx >= 0;

  // ---- phase C: hard not-applicable
  S.forEach(({ step }, k) => {
    const cur = st[k];
    if (cur) {
      if (terminated && !step.after_termination && cur.state === "IN_PROGRESS")
        st[k] = NA("TERMINATED_BEFORE_COMPLETION");
      return;
    }
    if (notApplicable) st[k] = NA("OBJECT_NOT_APPLICABLE");
    else if (terminated && !step.after_termination) st[k] = NA("TERMINATED");
    else if (closed && k > closedIdx && !step.after_termination) st[k] = NA("CLOSED");
  });

  // ---- phase D: applicability, alternatives, gaps, frontier, Layer B
  type Applies = "YES" | "NO" | "UNKNOWN";
  function evalApplies(rule: AppliesRule | undefined, from: number): Applies {
    if (!rule) return "YES";
    for (const x of evs) {
      if (x.pos < from) continue;
      if ((rule.excluded_by || []).some((p) => matches(x, p))) return "NO";
      if ((rule.match || []).some((p) => matches(x, p))) return "YES";
    }
    return rule.match && rule.match.length ? "UNKNOWN" : "YES";
  }
  const app: Applies[] = S.map(({ step, stage }, k) => {
    const a1 = evalApplies(stage.applies_if, ws[k]!);
    const a2 = evalApplies(step.applies_if, ws[k]!);
    if (a1 === "NO" || a2 === "NO") return "NO";
    let a: Applies = a1 === "UNKNOWN" || a2 === "UNKNOWN" ? "UNKNOWN" : "YES";
    if (step.kind === "CONDITIONAL" && !step.applies_if && a === "YES") a = "UNKNOWN";
    return a;
  });
  S.forEach(({ step }, k) => {
    const cur = st[k];
    if (cur && cur.evidence_event_id && app[k] === "NO" && cur.note !== "OBJECT_RECORD")
      notes.push({
        code: "APPLICABILITY_CONFLICT",
        detail: `${step.id} has recorded evidence although its condition reads not applicable`,
      });
  });
  let lastEv = -1;
  st.forEach((s, k) => {
    if (s && EVIDENCED.has(s.state as string) && s.evidence_event_id) lastEv = k;
  });
  const groups = new Map<string, number[]>();
  S.forEach(({ step }, k) => {
    const cur = st[k];
    if (step.alternative_group && cur && cur.state === "COMPLETED") {
      if (!groups.has(step.alternative_group)) groups.set(step.alternative_group, []);
      groups.get(step.alternative_group)!.push(k);
    }
  });
  for (const [g, ks] of groups)
    if (ks.length > 1)
      anomalies.push({
        code: "MULTIPLE_ALTERNATIVES_SELECTED",
        detail: `${g}: ${ks.map((k) => S[k]!.step.id).join(", ")}`,
      });
  const preSatisfied = (step: CatalogueStep): boolean => {
    const pres = preList(step);
    if (!pres.length) return true;
    return pres.some((p) => {
      const k2 = idx(p);
      const s2 = st[k2];
      if (!s2 || s2.layer !== "A") return false;
      if (S[k2]!.step.kind === "ALTERNATIVE") return s2.state === "COMPLETED";
      return s2.state === "COMPLETED" || s2.state === "NOT_APPLICABLE";
    });
  };
  // A step reachable only through alternatives: BRANCH_NOT_TAKEN when another alternative of the group was selected,
  // BRANCH_NOT_DECIDED while none is selected yet (it is one possible path, not an expected step); null otherwise.
  const branchState = (step: CatalogueStep): "BRANCH_NOT_TAKEN" | "BRANCH_NOT_DECIDED" | null => {
    const pres = preList(step);
    if (!pres.length) return null;
    if (!pres.every((p) => S[idx(p)]!.step.kind === "ALTERNATIVE")) return null;
    if (pres.some((p) => st[idx(p)] && st[idx(p)]!.state === "COMPLETED")) return null;
    const grps = new Set(pres.map((p) => S[idx(p)]!.step.alternative_group).filter(Boolean) as string[]);
    return [...grps].some((g) => groups.has(g)) ? "BRANCH_NOT_TAKEN" : "BRANCH_NOT_DECIDED";
  };
  const stageLevel = new Map<number, ActualRow>();
  let frontier = st.some((s) => s && s.state === "IN_PROGRESS");
  let frontierParallelStage: number | null = null;
  S.forEach(({ step, stage }, k) => {
    // CHOICE stage with nothing selected yet: the decision itself is the pending action (stage-level entry)
    if (stage.kind === "CHOICE" && stage.steps[0]!.id === step.id) {
      const anySel = stage.steps.some((s2) => {
        const s = st[idx(s2.id)];
        return s && s.evidence_event_id;
      });
      if (
        !anySel &&
        !frontier &&
        k > lastEv &&
        app[k] !== "NO" &&
        preSatisfied(step) &&
        !notApplicable &&
        !(terminated && !step.after_termination) &&
        !closed
      ) {
        stageLevel.set(stage.n, {
          step_id: `${J.id}/${stage.n}`,
          stage_level: true,
          layer: "A",
          state: "PENDING",
          actual: "PENDING",
          evidence_event_id: null,
          epistemic: "DERIVED_FROM_VERIFIED_FACTS",
          label: label(stage),
          stage: stage.n,
          kind: "CHOICE",
          completion_event_type: null,
          visibility: step.visibility,
        });
        frontier = true;
      }
    }
    if (st[k]) return;
    const a = app[k];
    if (a === "NO") {
      st[k] = NA("CONDITION_NOT_MET");
      return;
    }
    if (step.kind === "ALTERNATIVE") {
      const g = step.alternative_group && groups.get(step.alternative_group);
      st[k] = closed ? NA("NOT_SELECTED") : B("ALTERNATIVE", g && g.length ? "NOT_SELECTED" : undefined);
      return;
    }
    const br = branchState(step);
    if (br) {
      st[k] = closed
        ? NA(br === "BRANCH_NOT_TAKEN" ? "BRANCH_NOT_TAKEN" : "NOT_SELECTED")
        : B("ALTERNATIVE", br);
      return;
    }
    if (a === "UNKNOWN") {
      if (k < lastEv && step.kind !== "OPTIONAL") {
        st[k] = NA("CONDITION_DID_NOT_ARISE");
        return;
      }
      if (step.kind === "OPTIONAL") {
        st[k] = closed ? NA("CLOSED") : B("OPTIONAL");
        return;
      }
      st[k] = B(step.requires_approval ? "SUBJECT_TO_APPROVAL" : "CONDITIONAL");
      return;
    }
    if (step.kind === "OPTIONAL") {
      st[k] = closed ? NA("CLOSED") : B("OPTIONAL");
      return;
    }
    if (k < lastEv) {
      if (step.kind === "PARALLEL") {
        st[k] = {
          layer: "A",
          state: "PENDING",
          evidence_event_id: null,
          epistemic: "DERIVED_FROM_VERIFIED_FACTS",
        };
        return;
      }
      st[k] = {
        layer: "A",
        state: "PENDING",
        evidence_event_id: null,
        epistemic: "UNVERIFIED_INFORMATION",
        note: "EVIDENCE_GAP",
      };
      anomalies.push({
        code: "EVIDENCE_GAP",
        detail: `${step.id} has no recorded event although later steps do`,
      });
      return;
    }
    const eligible = (MANDATORY.has(step.kind) || step.kind === "CONDITIONAL") && preSatisfied(step);
    if (eligible && (!frontier || (frontierParallelStage === stage.n && step.kind === "PARALLEL"))) {
      st[k] = {
        layer: "A",
        state: "PENDING",
        evidence_event_id: null,
        epistemic: "DERIVED_FROM_VERIFIED_FACTS",
      };
      frontier = true;
      frontierParallelStage = step.kind === "PARALLEL" ? stage.n : null;
      return;
    }
    if (step.kind === "STEP" || step.kind === "CONDITIONAL")
      st[k] = B(step.requires_approval ? "SUBJECT_TO_APPROVAL" : "EXPECTED");
    else st[k] = B(step.kind);
  });
  // every step now has a state (phase D assigns one on every path); same array, non-null view
  const full = st as StepState[];

  // ---- phase E: lifecycle overrides
  if (cancelled) {
    const cev =
      (cancelStep >= 0 ? evGet(full[cancelStep]!.evidence_event_id) : null) || cancelEv || poStatusEv;
    let hasCancelled = full.some((s) => s && s.state === "CANCELLED");
    full.forEach((s, k) => {
      if (s.layer === "A" && s.state === "IN_PROGRESS") {
        full[k] = A("CANCELLED", cev);
        hasCancelled = true;
      }
    });
    full.forEach((s, k) => {
      if (s.layer === "A" && s.state === "PENDING" && s.note !== "EVIDENCE_GAP") {
        if (!hasCancelled) {
          full[k] = A("CANCELLED", cev);
          hasCancelled = true;
        } else full[k] = NA("CANCELLED");
      } else if (s.layer === "B") full[k] = NA("CANCELLED");
    });
    stageLevel.clear();
  }
  if (suspended && !cancelled) {
    const sev = suspEv && after(suspEv, resEv) ? suspEv : poStatusEv;
    full.forEach((s, k) => {
      if (
        s.layer === "A" &&
        (s.state === "IN_PROGRESS" || s.state === "PENDING") &&
        s.note !== "EVIDENCE_GAP"
      ) {
        full[k] = {
          layer: "A",
          state: "SUSPENDED",
          evidence_event_id: sev ? sev.id : null,
          epistemic: sev ? "RECORDED_FACT" : "DERIVED_FROM_VERIFIED_FACTS",
        };
      }
    });
    for (const [n, e] of stageLevel)
      stageLevel.set(n, {
        ...e,
        state: "SUSPENDED",
        actual: "SUSPENDED",
        evidence_event_id: sev ? sev.id : null,
        epistemic: sev ? "RECORDED_FACT" : e.epistemic,
      });
  }
  if (failedStatus && !cancelled) {
    full.forEach((s, k) => {
      if (s.layer === "A" && s.state === "PENDING" && s.note !== "EVIDENCE_GAP")
        full[k] = A("FAILED", poStatusEv, "RECORDED_FACT", "OBJECT_RECORD");
    });
  }

  // ---- phase F: verify object-recorded completion / in-progress claims (claims never raise a state)
  for (const c of claims) {
    const k = c ? idx(c.step_id) : -1;
    if (k < 0 || !["COMPLETED", "IN_PROGRESS"].includes((c as StepClaim).actual as string)) continue;
    const cl = c as StepClaim;
    const ev = cl.evidence_event_id ? evById.get(cl.evidence_event_id) : null;
    const ok = !!ev && (cl.actual === "COMPLETED" ? compOk(ev, S[k]!.step) : trigOk(ev, S[k]!.step));
    if (!ok) {
      anomalies.push({
        code: "UNVERIFIED_STEP_CLAIM",
        detail: `${cl.step_id} ${cl.actual} (${cl.evidence_event_id ?? "no evidence"})`,
      });
      continue;
    }
    const cur = full[k]!;
    if (cur.state !== cl.actual)
      anomalies.push({
        code: "CLAIM_CONFLICTS_WITH_EVIDENCE",
        detail: `${cl.step_id} claimed ${cl.actual}; resolved ${cur.state || cur.kind}`,
      });
  }

  // ---- assemble
  const actual: ActualRow[] = [];
  const expected: ExpectedRow[] = [];
  S.forEach(({ step, stage }, k) => {
    if (stage.steps[0]!.id === step.id && stageLevel.has(stage.n)) actual.push(stageLevel.get(stage.n)!);
    const s = full[k]!;
    const common: {
      step_id: string;
      label: Bilingual;
      stage: number;
      kind: StepKind;
      visibility: readonly Visibility[];
      governance_status?: string;
    } = {
      step_id: step.id,
      label: label(step),
      stage: stage.n,
      kind: step.kind,
      visibility: step.visibility,
    };
    if (step.governance_status) common.governance_status = step.governance_status;
    if (s.layer === "A") {
      // completion_event_type of a completed row = the type of the evidence actually matched (one of completion_any_of)
      const evd = s.state === "COMPLETED" && s.evidence_event_id ? evById.get(s.evidence_event_id) : null;
      actual.push({
        step_id: step.id,
        state: s.state,
        actual: s.state,
        evidence_event_id: s.evidence_event_id,
        epistemic: s.epistemic,
        label: common.label,
        stage: stage.n,
        kind: step.kind,
        completion_event_type: evd ? evd.type : (step.completion_event_type ?? null),
        ...(step.completion_any_of ? { completion_any_of: step.completion_any_of.map((p) => p.type) } : {}),
        visibility: step.visibility,
        ...(s.note ? { note: s.note } : {}),
        ...(step.governance_status ? { governance_status: step.governance_status } : {}),
      });
    } else {
      const cond = step.condition || stage.condition || null;
      expected.push({
        step_id: step.id,
        kind: s.kind,
        label: common.label,
        ...(cond && (s.kind === "CONDITIONAL" || s.kind === "SUBJECT_TO_APPROVAL" || s.kind === "ALTERNATIVE")
          ? { condition: cond }
          : {}),
        stage: stage.n,
        step_kind: step.kind,
        epistemic: s.epistemic,
        visibility: step.visibility,
        ...(s.note ? { note: s.note } : {}),
        ...(step.governance_status ? { governance_status: step.governance_status } : {}),
      });
    }
  });

  // ---- stage summary
  const stages: StageSummary[] = J.stages.map((stage): StageSummary => {
    const ids = new Set(stage.steps.map((s) => s.id));
    const a = actual.filter((x) => x.stage === stage.n && (ids.has(x.step_id) || x.stage_level));
    const b = expected.filter((x) => x.stage === stage.n);
    const has = (state: ActualState): boolean =>
      a.some((x) => x.state === state && x.note !== "EVIDENCE_GAP");
    const base = { n: stage.n, key: stage.key, ar: stage.ar, en: stage.en, kind: stage.kind };
    for (const state of ["CANCELLED", "FAILED", "RETURNED", "SUSPENDED", "IN_PROGRESS", "PENDING"] as const)
      if (has(state))
        return {
          ...base,
          layer: "A",
          state,
          epistemic: state === "PENDING" ? "DERIVED_FROM_VERIFIED_FACTS" : "RECORDED_FACT",
        };
    if (a.some((x) => x.state === "PENDING"))
      return {
        ...base,
        layer: "A",
        state: "PENDING",
        epistemic: "UNVERIFIED_INFORMATION",
        note: "EVIDENCE_GAP",
      };
    if (has("COMPLETED")) {
      const mandatoryLeft = b.some(
        (x) => x.kind === "EXPECTED" || x.kind === "SUBJECT_TO_APPROVAL" || x.kind === "PARALLEL",
      );
      return mandatoryLeft
        ? { ...base, layer: "A", state: "PENDING", epistemic: "DERIVED_FROM_VERIFIED_FACTS" }
        : { ...base, layer: "A", state: "COMPLETED", epistemic: "RECORDED_FACT" };
    }
    if (!b.length) return { ...base, layer: "A", state: "NOT_APPLICABLE", epistemic: "NOT_APPLICABLE" };
    const allCond = b.every(
      (x) => x.kind === "CONDITIONAL" || x.kind === "ALTERNATIVE" || x.kind === "OPTIONAL",
    );
    return {
      ...base,
      layer: "B",
      kind: allCond ? (b.every((x) => x.kind === "ALTERNATIVE") ? "ALTERNATIVE" : "CONDITIONAL") : "EXPECTED",
      epistemic: allCond ? "CONDITIONAL_STEP" : "EXPECTED_PROCESS",
    };
  });

  // ---- current stage
  const pick = (pred: (x: ActualRow) => boolean): ActualRow | undefined => actual.find(pred);
  const cur: { stage: number } | undefined =
    pick((x) => x.state === "IN_PROGRESS" || x.state === "SUSPENDED") ||
    pick((x) => x.state === "PENDING" && x.note !== "EVIDENCE_GAP") ||
    [...actual]
      .filter((x) => ["RETURNED", "CANCELLED", "FAILED"].includes(x.state))
      .sort((p, q) => (evGet(q.evidence_event_id)?.pos ?? -1) - (evGet(p.evidence_event_id)?.pos ?? -1))[0] ||
    (closed ? { stage: Number(S[closedIdx]!.stage.n) } : null) ||
    [...actual].reverse().find((x) => x.state === "COMPLETED");
  const curN = cur ? cur.stage : 1;
  const curStage = J.stages.find((s) => s.n === curN)!;
  const curSummary = stages.find((s) => s.n === curN)!;

  // ---- notice marker
  let notice: NoticeStep | null = null;
  if (asg) {
    const sid = asg.step_id || `${J.id}/${asg.stage}`;
    // A notice that completes its step points at the round holding the completion evidence; any other notice points
    // at the step as it stands in the current round.
    const inA = actual.find((x) => x.step_id === sid);
    const inP = previousRound.some((x) => x.step_id === sid);
    const inE = expected.some((x) => x.step_id === sid);
    const where = asg.completes
      ? inA && inA.evidence_event_id
        ? "actual"
        : inP
          ? "previous_round"
          : inA
            ? "actual"
            : inE
              ? "expected"
              : "stage"
      : inA
        ? "actual"
        : inE
          ? "expected"
          : inP
            ? "previous_round"
            : "stage";
    notice = { assignment_id: asg.id, step_id: sid, location: where, stage: asg.stage };
    const repPats = patList(asg.reports_any_of, asg.reports_event_type, asg.reports_payload);
    if (!evs.some((x) => matchesAny(x, repPats)))
      anomalies.push({
        code: "REPORTED_EVENT_NOT_FOUND",
        detail: `${asg.id}: ${repPats ? repPats.map((p) => p.type).join(" | ") : "none"}`,
      });
    if (asg.completes && asg.step_id) {
      const k = idx(asg.step_id);
      const done =
        (full[k] && full[k]!.state === "COMPLETED") || previousRound.some((p) => p.step_id === asg.step_id);
      if (!done)
        anomalies.push({
          code: "ASSIGNMENT_COMPLETION_UNEVIDENCED",
          detail: `${asg.id}: ${asg.step_id} has no recorded ${S[k]!.step.completion_event_type}`,
        });
    }
    if (asg.stage !== curN)
      notes.push({
        code: "STAGE_DIFFERS_FROM_ASSIGNMENT",
        detail: `assignment stage ${asg.stage}; resolved stage ${curN}`,
      });
  }

  // ---- alternative groups (one selected at most; selecting one never completes the others)
  const altGroups = new Map<string, string[]>();
  for (const st2 of J.stages)
    for (const s2 of st2.steps)
      if (s2.alternative_group) {
        if (!altGroups.has(s2.alternative_group)) altGroups.set(s2.alternative_group, []);
        altGroups.get(s2.alternative_group)!.push(s2.id);
      }
  const alternative_groups: AlternativeGroup[] = [...altGroups].map(([group_id, ids]) => {
    const sel = ids.filter((id) => actual.some((x) => x.step_id === id && x.state === "COMPLETED"));
    return { group_id, steps: ids, selected: sel.length === 1 ? sel[0]! : null, selected_count: sel.length };
  });

  // ---- derived facts (never inferred: vote opening from a direction, decision from a recommendation)
  const lastOf = (type: string): Ev | null => {
    let f: Ev | null = null;
    for (const x of evs) if (x.type === type) f = x;
    return f;
  };
  const bo = lastOf("BALLOT_OPENED"),
    bc = lastOf("BALLOT_CLOSED");
  const ra = lastOf("RECOMMENDATION_ADOPTED"),
    rr = lastOf("RECOMMENDATION_RETURNED");
  const adr = lastOf("AUTHORITY_DECISION_RECORDED"),
    mf = lastOf("MINUTES_FINAL");
  const derived: DerivedFacts = {
    ballot_open: !!bo && after(bo, bc),
    ballot_open_event_id: bo && after(bo, bc) ? bo.id : null,
    recommendation_adopted: !!ra && after(ra, rr),
    decision_recorded: !!adr,
    decision_event_id: adr ? adr.id : null,
    decision_outcome: adr ? (adr.payload.outcome ?? null) : null,
    minutes_final: mf ? { event_id: mf.id, basis: mf.payload.basis ?? null } : null,
  };

  // ---- deadlines (a deadline needs a recorded basis event and a stated rule; otherwise at = null with the reason)
  const deadlines: ResolvedDeadline[] = [];
  for (const d of J.deadlines || []) {
    const rule = ix.rules[d.rule_id];
    if (!rule) {
      deadlines.push({
        kind: d.kind,
        rule_id: d.rule_id,
        at: null,
        basis_event_id: null,
        basis_rule: "SOURCE_REQUIRED",
        status: "SOURCE_REQUIRED",
        epistemic: "UNVERIFIED_INFORMATION",
        reason: "RULE_NOT_IN_CATALOGUE",
      });
      continue;
    }
    const basis = lastOf(rule.basis_event_type);
    const base = { kind: d.kind, rule_id: d.rule_id, label: rule.label || null, basis_rule: d.rule_id };
    if (!basis) {
      deadlines.push({
        ...base,
        at: null,
        basis_event_id: null,
        status: "NO_BASIS_EVENT",
        epistemic: "NOT_APPLICABLE",
        reason: `${rule.basis_event_type} not recorded`,
      });
      continue;
    }
    const fromPayload = rule.at_from_payload ? basis.payload[rule.at_from_payload] : undefined;
    // Date.parse coerces its argument exactly as in the reference
    if (fromPayload && !Number.isNaN(Date.parse(fromPayload as string))) {
      deadlines.push({
        ...base,
        at: new Date(Date.parse(fromPayload as string)).toISOString(),
        basis_event_id: basis.id,
        status: "RECORDED",
        epistemic: "RECORDED_FACT",
        reason: `${rule.at_from_payload} recorded on ${basis.type}`,
      });
    } else if (
      rule.computable &&
      Number.isInteger(rule.duration_days) &&
      !Number.isNaN(Date.parse(basis.e.occurred_at as string))
    ) {
      deadlines.push({
        ...base,
        at: new Date(
          Date.parse(basis.e.occurred_at as string) + (rule.duration_days as number) * DAY_MS,
        ).toISOString(),
        basis_event_id: basis.id,
        status: rule.status,
        epistemic: "DERIVED_FROM_VERIFIED_FACTS",
        reason: `${basis.type} + ${rule.duration_days} days (${rule.day_count || "days"})`,
      });
    } else {
      // the basis is recorded but the rule cannot produce a date (duration or calendar SOURCE_REQUIRED): no date is shown
      deadlines.push({
        ...base,
        at: null,
        basis_event_id: basis.id,
        status: "SOURCE_REQUIRED",
        rule_status: rule.status,
        epistemic: "UNVERIFIED_INFORMATION",
        reason: "SOURCE_REQUIRED",
      });
    }
  }
  for (const c of po && Array.isArray(po.deadlines) ? po.deadlines : []) {
    const mine = deadlines.find((d) => d.kind === c.kind);
    if (!mine) {
      anomalies.push({ code: "DEADLINE_CLAIM_REJECTED", detail: `${c.kind}: not a deadline of ${J.id}` });
      continue;
    }
    const claimAt = c.at && !Number.isNaN(Date.parse(c.at)) ? new Date(Date.parse(c.at)).toISOString() : null;
    if (claimAt !== mine.at)
      anomalies.push({
        code: "DEADLINE_CLAIM_REJECTED",
        detail: `${c.kind}: object says ${c.at ?? "null"} (${c.basis_rule ?? "no rule"}); resolved ${mine.at ?? "null"} (${mine.reason})`,
      });
  }

  return {
    journey: {
      id: J.id,
      object: label(J.object),
      capacity: label(J.capacity),
      ...(J.capacity_by_recipient ? { capacity_by_recipient: J.capacity_by_recipient } : {}),
      disclosure: J.disclosure,
      structure: J.structure,
      summary5: !!J.summary5,
      closure: label(J.closure),
      lifecycle_flags: {
        returnable: !!lc.returnable,
        suspendable: !!lc.suspendable,
        reopenable: !!lc.reopenable,
        cancellable: !!lc.cancellable,
        early_termination: !!lc.early_termination,
      },
    },
    assignment: asgEcho,
    stage: {
      n: curN,
      ar: curStage.ar,
      en: curStage.en,
      kind: curStage.kind,
      state: curSummary.state ?? null,
      layer: curSummary.layer,
    },
    assignment_stage: asg ? asg.stage : null,
    stages,
    actual,
    expected,
    previous_round: previousRound,
    alternative_groups,
    notice_step: notice,
    lifecycle: {
      cancelled: !!cancelled,
      suspended: !!suspended && !cancelled,
      returned: actual.some((x) => x.state === "RETURNED"),
      reopened,
      terminated,
      failed: actual.some((x) => x.state === "FAILED"),
      closed,
      not_applicable: notApplicable,
    },
    derived,
    deadlines,
    anomalies,
    notes,
    ignored_events: ignored,
  };
}
