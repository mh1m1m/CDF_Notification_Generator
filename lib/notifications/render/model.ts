import "server-only";
/**
 * CDF Notifications V13 — notification view model (W-D2). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
 * buildNotificationModel(scenario, recipient, opts) → UNPROJECTED model {meta, fields, safe_refs} (charter §3 contracts in,
 * charter §5 field names out). It must pass project() (@/lib/disclosure/project) before any renderer sees it.
 *
 * Level resolution (charter §4, §3.5–3.6):
 *  - Level 1 only from CaseRecord.status.code (`exists:false` ⇒ no master journey);
 *  - Level 2/3: W-C's resolveLevel2_3 + buildProgressView (@/lib/journeys/resolve, progress) with W-C's catalogue when all
 *    three are present — W-C owns journey resolution and the recipient's progress view; W-D2 adapts the view to its
 *    renderers and never re-derives a state. Otherwise the local fallback below: Layer A from ProceduralObject.steps; a
 *    step is COMPLETED only with a recorded, in-scope evidence event of the step's completion_event_type (and payload);
 *    Layer B from the catalogue's remaining steps (EXPECTED / CONDITIONAL / OPTIONAL / ALTERNATIVE / PARALLEL); an alternative
 *    whose sibling was selected is never shown as expected and never as completed (PC-17).
 * Provenance (catalogue, resolver, W-C diagnostics codes) is recorded per model.
 * Port note: the reference read both catalogues from disk and imported the W-C resolver behind a guard; here the catalogues
 * are static JSON imports (each load returns a fresh deep copy, as a fresh file read did) and the resolver is imported statically.
 */
import { deriveNextAction, ruleFor, type NextAction } from "../next-action/rules";
import { check, loadAuthority, isAllowed } from "@/lib/authority/check";
import { project, EXTERNAL_CLASSES } from "@/lib/disclosure/project";
import { resolveLevel2_3 } from "@/lib/journeys/resolve";
import { buildProgressView, VIEW_VERSION } from "@/lib/journeys/progress";
import WC_CATALOGUE from "@/lib/journeys/catalogue_v13.json";
import SUBSET_CATALOGUE from "./catalogue_subset.json";
import { demoUuid, sha256Hex } from "./escape";
import { MARKING, CONFIDENTIALITY, CLASSIFICATION, fill } from "./i18n";
import { ar as AR } from "@/lib/i18n/notificationRender/ar";
import { en as EN } from "@/lib/i18n/notificationRender/en";
import type {
  Bi,
  DemoEvent,
  ProceduralObject,
  CaseRecord,
  Recipient,
  Scenario,
  L1Stage,
  L1Substate,
  L2Journey,
  L3Steps,
  L3Stage,
  StageView,
  StepView,
  ModelFields,
  ModelMeta,
  ObjectRef,
} from "./types";
import { isNil } from "@/lib/domain/nil";

/** where the two catalogues come from (informational; both are imported statically) */
export const CATALOGUE_PATHS = Object.freeze({
  wc: "lib/journeys/catalogue_v13.json",
  subset: "lib/notifications/render/catalogue_subset.json",
});
export const GENERATED_AT = "2026-10-27T15:00:00+03:00";
export const TEMPLATE_VERSION = "V13-WD2-DEMO-2026-10-27";

// ---------------------------------------------------------------------------------------------------------------
// catalogue shapes (W-C catalogue_v13.json and the W-D2 subset; open shapes — extra keys are kept)
// ---------------------------------------------------------------------------------------------------------------
export interface EventSpec {
  type: string;
  payload?: Readonly<Record<string, unknown>> | null;
}
export interface AppliesIf {
  match?: readonly EventSpec[];
  excluded_by?: readonly EventSpec[];
}
export interface CatalogueStep extends Bi {
  id: string;
  kind?: string;
  alternative_group?: string;
  trigger_event_type?: string | null;
  trigger_payload?: Readonly<Record<string, unknown>> | null;
  completion_event_type?: string | null;
  completion_payload?: Readonly<Record<string, unknown>> | null;
  visibility?: readonly string[];
  next?: readonly string[];
  [k: string]: unknown;
}
export interface CatalogueStage extends Bi {
  n: number;
  kind?: string;
  applies_if?: AppliesIf | null;
  steps: CatalogueStep[];
  [k: string]: unknown;
}
export interface Journey {
  id: string;
  object?: Bi | null;
  capacity?: Bi | null;
  capacity_by_recipient?: Readonly<Record<string, Bi>>;
  structure?: unknown;
  stages: CatalogueStage[];
  closure?: Bi | null;
  closure_ar?: string;
  closure_en?: string;
  [k: string]: unknown;
}
export interface MasterStage {
  code: string;
  ar?: string | null;
  en?: string | null;
  [k: string]: unknown;
}
export interface Assignment {
  id: string;
  journey?: string;
  stage?: number;
  step_id?: string | null;
  [k: string]: unknown;
}
export interface Catalogue {
  master: MasterStage[];
  master_sub?: Readonly<Record<string, Bi>>;
  journeys: Journey[];
  assignments?: Assignment[];
  deadline_rules?: Readonly<Record<string, { basis_event_type?: string; [k: string]: unknown } | null>>;
  version?: string;
  __source?: string;
  __note?: string;
  [k: string]: unknown;
}

function catalogueOk(c: unknown): c is Catalogue {
  if (!c || typeof c !== "object") return false;
  const x = c as { master?: unknown; journeys?: unknown };
  return (
    Array.isArray(x.master) &&
    x.master.length === 5 &&
    Array.isArray(x.journeys) &&
    x.journeys.every(
      (j: unknown) =>
        !!j &&
        typeof j === "object" &&
        !!(j as { id?: unknown }).id &&
        Array.isArray((j as { stages?: unknown }).stages),
    )
  );
}
/** W-C's catalogue when present and well-formed; else the W-D2 subset. `needs` = journey ids that must be present. */
export function loadCatalogue({
  needs = [],
  preferSubset = false,
}: { needs?: readonly string[]; preferSubset?: boolean } = {}): Catalogue {
  // a fresh copy per call (the reference parsed the file on every call; callers may annotate the returned object)
  const subset = structuredClone(SUBSET_CATALOGUE) as unknown as Catalogue;
  subset.__source = "W-D2 subset of L2-2026-10-26b (lib/notifications/render/catalogue_subset.json)";
  if (!preferSubset) {
    try {
      const wc: unknown = structuredClone(WC_CATALOGUE);
      if (catalogueOk(wc) && needs.every((id) => wc.journeys.some((j) => j.id === id))) {
        wc.__source = "W-C src/journeys/catalogue_v13.json";
        return wc;
      }
      subset.__note = "W-C catalogue present but incomplete or not in the expected shape for this scenario";
    } catch (e) {
      subset.__note = `W-C catalogue unreadable (${e instanceof Error ? e.message : String(e)})`;
    }
  }
  return subset;
}

// ---------------------------------------------------------------------------------------------------------------
// Level resolution (local; W-C's resolver preferred when it passes the shape check)
// ---------------------------------------------------------------------------------------------------------------
interface TypedEvent {
  type?: string;
  event_type?: string;
}
const evType = (e: TypedEvent | null | undefined): string | undefined => e?.type ?? e?.event_type;
export function resolveLevel1(caseRecord: CaseRecord | null | undefined, catalogue: Catalogue): L1Stage {
  if (!caseRecord || caseRecord.exists === false) return { exists: false };
  const code = caseRecord.status?.code ?? "";
  const m = /^S(\d)\.(\d{2})$/.exec(code);
  const master = m ? catalogue.master.find((x) => x.code === "S" + m[1]) : null;
  if (!m || !master)
    return {
      exists: true,
      code: null,
      ar: null,
      en: null,
      position: null,
      of: catalogue.master.length,
      stages: [],
    };
  return {
    exists: true,
    code: master.code,
    ar: master.ar,
    en: master.en,
    position: Number(m[1]),
    of: catalogue.master.length,
    stages: catalogue.master.map((x, i) => ({ code: x.code, position: i + 1, ar: x.ar, en: x.en })),
    status_source_event_id: caseRecord.status?.source_event_id ?? null,
  };
}
export function resolveSubstate(
  caseRecord: CaseRecord | null | undefined,
  catalogue: Catalogue,
): L1Substate | null {
  if (!caseRecord || caseRecord.exists === false) return null;
  const code = caseRecord.status?.code;
  const s = code ? catalogue.master_sub?.[code] : null;
  return code
    ? {
        code,
        ar: s?.ar ?? null,
        en: s?.en ?? null,
        status_source_event_id: caseRecord.status?.source_event_id ?? null,
      }
    : null;
}

const B_KIND: Readonly<Record<string, string>> = {
  STEP: "EXPECTED",
  CONDITIONAL: "CONDITIONAL",
  OPTIONAL: "OPTIONAL",
  ALTERNATIVE: "ALTERNATIVE",
  PARALLEL: "PARALLEL",
};
const DONE = new Set(["COMPLETED", "NOT_APPLICABLE", "CANCELLED"]);
const RECORDED_STATES = new Set(["COMPLETED", "IN_PROGRESS", "PENDING", "SUSPENDED", "RETURNED"]);

/** payload names: W-A's (lib/domain/concepts) and the earlier W-C names, read as aliases of each other (W-C resolve does the
 *  same: CASE_STATUS_RECORDED.transition_id ↔ transition, LEGAL_OPINION_SUBMITTED.opinion ↔ position) */
export const PAYLOAD_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  transition_id: "transition",
  transition: "transition_id",
  opinion: "position",
  position: "opinion",
});
/** W-C payload filter (catalogue field_notes): a scalar must be equal; an array means any of; null inside an array matches an
 *  absent key. A missing filter matches every payload. */
export function payloadMatches(filter: unknown, payload: unknown): boolean {
  if (isNil(filter)) return true;
  if (typeof filter !== "object" || Array.isArray(filter)) return false;
  const p = (payload && typeof payload === "object" ? payload : {}) as Readonly<Record<string, unknown>>;
  const own = (k: unknown): k is string =>
    typeof k === "string" && Object.prototype.hasOwnProperty.call(p, k) && !isNil(p[k]);
  return Object.entries(filter as Readonly<Record<string, unknown>>).every(([k, want]) => {
    const alias = Object.hasOwn(PAYLOAD_ALIASES, k) ? PAYLOAD_ALIASES[k] : undefined;
    const key = own(k) ? k : own(alias) ? alias : null;
    const has = key !== null;
    if (Array.isArray(want)) return want.some((w: unknown) => (w === null ? !has : has && p[key] === w));
    if (want === null) return !has;
    return has && p[key] === want;
  });
}
/** an event counts only when it is recorded (recorded_at present; a notification is never its own evidence) */
export const isRecorded = (
  e: { event_id?: unknown; recorded_at?: unknown; type?: string; event_type?: string } | null | undefined,
): boolean => !!(e && e.event_id && e.recorded_at && !/^NOTIFICATION_/.test(evType(e) ?? ""));
const specMatches = (e: DemoEvent, spec: EventSpec): boolean =>
  isRecorded(e) && evType(e) === spec.type && payloadMatches(spec.payload ?? null, e.payload);

/** recipient class → W-C visibility class (catalogue visibility_classes: public, scope, internal, restricted). Unknown → internal
 *  for internal classes; a step without a visibility list is internal only (fail closed for external recipients). */
export const VISIBILITY_OF: Readonly<Record<string, string>> = Object.freeze({
  REPORTER: "public",
  PUBLIC: "public",
  REFERRING_BODY: "scope",
  EVIDENCE_HOLDER: "scope",
  SUBJECT: "restricted",
  WITNESS: "restricted",
  RECUSED_MEMBER: "none",
});
export const visibilityOf = (cls: unknown): string =>
  typeof cls === "string" && Object.hasOwn(VISIBILITY_OF, cls)
    ? (VISIBILITY_OF[cls] ?? "internal")
    : "internal";
const visibleTo = (step: CatalogueStep, vis: string): boolean =>
  vis !== "none" &&
  (Array.isArray(step.visibility) && step.visibility.length
    ? step.visibility.includes(vis)
    : vis === "internal");

/** W-C scope rule: an event is evidence for an object only when it is on the object or one of its related objects, names one of
 *  them in its payload, or is a CASE event of the same case. An object without an id has nothing in scope (fail closed). */
function payloadNames(p: unknown): string[] {
  if (!p || typeof p !== "object") return [];
  const q = p as { subject_object_id?: unknown; object_id?: unknown; target?: unknown; related?: unknown };
  const out: string[] = [];
  const add = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string")
      out.push((v as { id: string }).id);
  };
  add(q.subject_object_id);
  add(q.object_id);
  add(q.target);
  if (Array.isArray(q.related)) q.related.forEach(add);
  else add(q.related);
  return out;
}
export function inScopeOf(
  object: ProceduralObject | null | undefined,
): (e: DemoEvent | null | undefined) => boolean {
  const ids = new Set(
    [
      object?.object_id,
      ...(object?.related_objects ?? []).map((o: ObjectRef | null | undefined) => o?.id),
    ].filter((x): x is string => typeof x === "string" && !!x),
  );
  return (e) =>
    !!(
      e &&
      ids.size &&
      ((e.object && ids.has(e.object.id as string)) ||
        payloadNames(e.payload).some((id) => ids.has(id)) ||
        (e.object?.type === "CASE" && object?.case_id && e.case_id === object.case_id))
    );
}

/** applies_if of a CONDITION stage or step (W-C): match → applies; excluded_by → NOT_APPLICABLE; neither → unknown */
export function appliesIf(
  rule: AppliesIf | null | undefined,
  events: readonly DemoEvent[],
): "UNCONDITIONAL" | "EXCLUDED" | "APPLIES" | "UNKNOWN" {
  if (!rule) return "UNCONDITIONAL";
  if ((rule.excluded_by ?? []).some((spec) => events.some((e) => specMatches(e, spec)))) return "EXCLUDED";
  if ((rule.match ?? []).some((spec) => events.some((e) => specMatches(e, spec)))) return "APPLIES";
  return (rule.match ?? []).length ? "UNKNOWN" : "APPLIES"; // W-C: no match list = applies unless excluded
}

interface RecordedStep {
  step_id: string;
  state: string | undefined;
  evidence_event_id?: string | null;
  epistemic?: string;
  derived?: string;
  [k: string]: unknown;
}
export interface Levels23 {
  l2: L2Journey | null;
  l3: L3Steps | null;
  downgraded: string[];
}

/**
 * resolveLevels23(object, journey, events, {recipient_class}) → {l2, l3, downgraded:[step ids shown below their claimed state]}
 *  - Layer A from object.steps only. COMPLETED needs a recorded evidence event of the step's completion_event_type whose payload
 *    passes completion_payload (W-C rule 2; charter §3.2); otherwise IN_PROGRESS when the step's trigger event is recorded, else
 *    PENDING. A claimed IN_PROGRESS whose catalogue step names a trigger_event_type that is not recorded is shown PENDING (W-C rule 3).
 *  - Layer B from the catalogue's remaining steps of the current and later stages; a CONDITION stage is CONDITIONAL unless its
 *    applies_if matched (EXPECTED) or excluded it (NOT_APPLICABLE, derived from recorded events).
 *  - Alternatives (W-C rule 4): once one alternative of a group is recorded, its siblings are never expected and never completed:
 *    NOT_APPLICABLE when the selected one is COMPLETED (derived), otherwise omitted (PC-17).
 *  - Visibility: only steps whose catalogue visibility includes the recipient's class are shown; a stage without a visible step
 *    is omitted from Levels 2 and 3.
 */
export function resolveLevels23(
  object: ProceduralObject | null | undefined,
  journey: Journey | null | undefined,
  events0: readonly DemoEvent[] | null = [],
  opts: { recipient_class?: string } = {},
): Levels23 {
  if (!object || !journey) return { l2: null, l3: null, downgraded: [] };
  const vis = visibilityOf(opts.recipient_class);
  const events = (Array.isArray(events0) ? events0 : []).filter(inScopeOf(object)); // evidence must be on this object (W-C scope rule)
  const evById = new Map(events.map((e) => [e.event_id, e]));
  const recorded = events.filter(isRecorded);
  // a step's trigger is recorded when an event of its trigger_event_type whose payload passes trigger_payload is in scope
  const triggerRecorded = (cat: CatalogueStep | undefined): boolean =>
    !!cat?.trigger_event_type &&
    recorded.some(
      (e) => evType(e) === cat.trigger_event_type && payloadMatches(cat.trigger_payload ?? null, e.payload),
    );
  const catSteps = new Map(journey.stages.flatMap((st) => st.steps.map((x) => [x.id, x] as const)));
  const rec = new Map<string, RecordedStep>();
  const downgraded: string[] = [];
  for (const s of object.steps || []) {
    if (!s || !s.step_id) continue;
    const cat = catSteps.get(s.step_id);
    const wcShape = !!cat && Object.prototype.hasOwnProperty.call(cat, "trigger_event_type");
    let state = s.actual;
    if (state === "COMPLETED") {
      const ev = s.evidence_event_id ? evById.get(s.evidence_event_id) : null;
      const typeOk = !cat?.completion_event_type || (ev && evType(ev) === cat.completion_event_type);
      const payloadOk =
        !cat?.completion_payload || (ev && payloadMatches(cat.completion_payload, ev.payload));
      if (!isRecorded(ev) || !typeOk || !payloadOk) {
        state = wcShape ? (triggerRecorded(cat) ? "IN_PROGRESS" : "PENDING") : "IN_PROGRESS";
        downgraded.push(s.step_id);
      }
    } else if (state === "IN_PROGRESS" && wcShape && cat?.trigger_event_type && !triggerRecorded(cat)) {
      state = "PENDING";
      downgraded.push(s.step_id);
    }
    rec.set(s.step_id, {
      ...s,
      state,
      epistemic:
        state === "COMPLETED"
          ? "RECORDED_FACT"
          : s.epistemic === "RECORDED_FACT"
            ? "DERIVED_FROM_VERIFIED_FACTS"
            : (s.epistemic ?? "DERIVED_FROM_VERIFIED_FACTS"),
    });
  }
  // alternatives: selected = any recorded state; siblings of a COMPLETED selection are NOT_APPLICABLE (derived)
  const groups = new Map<string, string[]>();
  for (const x of catSteps.values())
    if (x.kind === "ALTERNATIVE") {
      const g = x.alternative_group ?? `stage-of-${x.id.split("/").slice(0, 2).join("/")}`;
      let list = groups.get(g);
      if (!list) {
        list = [];
        groups.set(g, list);
      }
      list.push(x.id);
    }
  const altSelected = new Map<string, "NA" | "HIDE">(); // step id → 'NA' | 'HIDE'
  for (const ids of groups.values()) {
    const chosen = ids.filter((id) => RECORDED_STATES.has(String(rec.get(id)?.state)));
    if (!chosen.length) continue;
    const doneSel = chosen.some((id) => rec.get(id)?.state === "COMPLETED");
    for (const id of ids) if (!rec.has(id)) altSelected.set(id, doneSel ? "NA" : "HIDE");
  }
  for (const [id, how] of altSelected)
    if (how === "NA")
      rec.set(id, {
        step_id: id,
        state: "NOT_APPLICABLE",
        evidence_event_id: null,
        epistemic: "NOT_APPLICABLE",
        derived: "ALTERNATIVE_NOT_SELECTED",
      });

  // BRANCH stages (W-C structure): once an alternative is COMPLETED, only the steps on its `next` path apply (the others are
  // omitted); before any selection the branch steps are Layer B ALTERNATIVE.
  const selectedNext = new Set<string>();
  for (const ids of groups.values())
    for (const id of ids)
      if (rec.get(id)?.state === "COMPLETED")
        for (const n of catSteps.get(id)?.next ?? []) selectedNext.add(n);
  const branchHidden = new Set<string>();
  const branchOpen = new Set<number>();
  for (const st of journey.stages)
    if (st.kind === "BRANCH") {
      if (st.steps.some((x) => selectedNext.has(x.id))) {
        for (const x of st.steps) if (!selectedNext.has(x.id) && !rec.has(x.id)) branchHidden.add(x.id);
      } else branchOpen.add(st.n);
    }
  const visibleStages = journey.stages
    .map((st) => ({ st, steps: st.steps.filter((x) => visibleTo(x, vis) && !branchHidden.has(x.id)) }))
    .filter((x) => x.steps.length);
  const stageInfo = visibleStages.map(({ st, steps }) => {
    const applies = st.kind === "CONDITION" ? appliesIf(st.applies_if, events) : "UNCONDITIONAL";
    const recs = steps.map((x) => rec.get(x.id)).filter((r): r is RecordedStep => Boolean(r));
    let state: string | null = null;
    if (applies === "EXCLUDED" && !recs.some((r) => r.state !== "NOT_APPLICABLE")) state = "NOT_APPLICABLE";
    else if (recs.length) {
      if (recs.every((r) => r.state === "NOT_APPLICABLE")) state = "NOT_APPLICABLE";
      else if (["SUSPENDED", "RETURNED", "FAILED"].some((k) => recs.some((r) => r.state === k)))
        state = ["SUSPENDED", "RETURNED", "FAILED"].find((k) => recs.some((r) => r.state === k)) ?? null;
      else if (recs.every((r) => r.state === "CANCELLED")) state = "CANCELLED";
      else {
        const hasAlt = steps.some((x) => x.kind === "ALTERNATIVE");
        const required = steps.filter((x) => (x.kind ?? "STEP") === "STEP" || x.kind === "PARALLEL");
        const reqDone = required.every((x) => rec.get(x.id)?.state === "COMPLETED");
        const altDone =
          !hasAlt || steps.some((x) => x.kind === "ALTERNATIVE" && rec.get(x.id)?.state === "COMPLETED");
        const restDone = recs.every((r) => DONE.has(String(r.state)));
        if (reqDone && altDone && restDone) state = "COMPLETED";
        else if (recs.some((r) => r.state === "IN_PROGRESS" || r.state === "COMPLETED"))
          state = "IN_PROGRESS";
        else state = "PENDING";
      }
    }
    return { st, steps, applies, state };
  });
  const open = stageInfo.find((x) => x.state && !DONE.has(x.state));
  const lastRecorded = [...stageInfo].reverse().find((x) => x.state && x.state !== "NOT_APPLICABLE");
  const lastN = stageInfo.length ? (stageInfo[stageInfo.length - 1]?.st.n ?? 1) : 1;
  const current = open
    ? open.st.n
    : lastRecorded
      ? Math.min(lastRecorded.st.n + 1, lastN)
      : (stageInfo[0]?.st.n ?? 1);
  const stageKindB = (x: (typeof stageInfo)[number]): string =>
    x.st.kind === "CONDITION" && x.applies !== "APPLIES" ? "CONDITIONAL" : "EXPECTED";
  const l2stages: StageView[] = stageInfo.map((x) => {
    const { st, state } = x;
    if (state)
      return {
        n: st.n,
        ar: st.ar,
        en: st.en,
        layer: "actual",
        state,
        ...(state === "COMPLETED" ? { evidence_recorded: true } : {}),
        ...(state === "NOT_APPLICABLE" && x.applies === "EXCLUDED" ? { derived: "APPLIES_IF_EXCLUDED" } : {}),
      };
    if (st.n >= current) return { n: st.n, ar: st.ar, en: st.en, layer: "expected", kind: stageKindB(x) };
    return { n: st.n, ar: st.ar, en: st.en, layer: "actual", state: null, unknown: true };
  });
  const l3stages: L3Stage[] = [];
  for (const x of stageInfo) {
    const { st, state } = x;
    if (state === "NOT_APPLICABLE" && x.applies === "EXCLUDED") continue;
    const steps: StepView[] = [];
    for (const c of x.steps) {
      const r = rec.get(c.id);
      if (r)
        steps.push({
          step_id: c.id,
          ar: c.ar,
          en: c.en,
          layer: "actual",
          state: r.state ?? null,
          evidence_event_id: r.evidence_event_id ?? null,
          epistemic: r.epistemic ?? null,
          ...(r.derived ? { derived: r.derived } : {}),
        });
      else if (st.n >= current && altSelected.get(c.id) !== "HIDE") {
        const k = branchOpen.has(st.n) && (c.kind ?? "STEP") === "STEP" ? "ALTERNATIVE" : (c.kind ?? "STEP");
        const kind =
          st.kind === "CONDITION" && x.applies !== "APPLIES" && (k === "STEP" || k === "PARALLEL")
            ? "CONDITIONAL"
            : ((Object.hasOwn(B_KIND, k) ? B_KIND[k] : undefined) ?? "EXPECTED");
        steps.push({
          step_id: c.id,
          ar: c.ar,
          en: c.en,
          layer: "expected",
          kind,
          epistemic: kind === "CONDITIONAL" ? "CONDITIONAL_STEP" : "EXPECTED_PROCESS",
        });
      }
    }
    if (steps.length) l3stages.push({ n: st.n, ar: st.ar, en: st.en, state, steps });
  }
  const rc = opts.recipient_class;
  const capacity =
    (!isNil(rc) && journey.capacity_by_recipient && Object.hasOwn(journey.capacity_by_recipient, rc)
      ? journey.capacity_by_recipient[rc]
      : undefined) ??
    journey.capacity ??
    null;
  return {
    l2: {
      journey_id: journey.id,
      object: journey.object,
      capacity,
      structure: journey.structure ?? null,
      current_stage: current,
      stages: l2stages,
      closure:
        journey.closure ?? (journey.closure_ar ? { ar: journey.closure_ar, en: journey.closure_en } : null),
      visibility: vis,
    },
    l3: { journey_id: journey.id, current_stage: current, stages: l3stages, visibility: vis },
    downgraded,
  };
}

// W-C resolver + progress view. Used with W-C's catalogue only; the view is adapted, never re-derived.
type ResolveFn = (...args: Parameters<typeof resolveLevel2_3>) => unknown;
type ViewFn = (...args: Parameters<typeof buildProgressView>) => unknown;
const WC: { resolveLevel2_3: ResolveFn; buildProgressView: ViewFn; viewVersion: string | null } | null =
  typeof resolveLevel2_3 === "function" && typeof buildProgressView === "function"
    ? { resolveLevel2_3, buildProgressView, viewVersion: VIEW_VERSION ?? null }
    : null;
const WC_RESOLVE_NOTE = WC
  ? `W-C resolve.js + progress.js (${VIEW_VERSION ?? "view version not stated"}) — used with the W-C catalogue`
  : "W-C resolve.js / progress.js present without resolveLevel2_3 / buildProgressView — local resolution used";
export const RESOLVER_NOTE = (): string => WC_RESOLVE_NOTE;
export const WC_RESOLVER_PRESENT = (): boolean => !!WC;

const bi = (x: unknown): { ar: string | null; en: string | null } => {
  const o = x && typeof x === "object" ? (x as { ar?: unknown; en?: unknown }) : {};
  return { ar: typeof o.ar === "string" ? o.ar : null, en: typeof o.en === "string" ? o.en : null };
};
const condOf = (c: unknown): { ar: string; en: string } | null => {
  const o = c && typeof c === "object" ? (c as { ar?: unknown; en?: unknown }) : null;
  return o && typeof o.ar === "string" && typeof o.en === "string" ? { ar: o.ar, en: o.en } : null;
};

/** the parts of W-C's progress view and Level 2/3 resolution that this adapter reads (open shapes) */
interface WcItem {
  step_id: string;
  stage?: number;
  label?: unknown;
  state?: string;
  kind?: string;
  evidence_event_id?: string | null;
  epistemic?: string | null;
  note?: string;
  note_label?: unknown;
  condition?: unknown;
  is_notice?: boolean;
  stage_level?: boolean;
  [k: string]: unknown;
}
interface WcStage {
  n: number;
  label?: unknown;
  layer?: string;
  state?: string;
  kind?: string;
  note?: string;
  note_label?: unknown;
  current?: boolean;
  [k: string]: unknown;
}
export interface WcView {
  version?: string | null;
  audience?: string | null;
  diagnostics?: { anomalies?: readonly { code: string }[]; notes?: readonly { code: string }[] } | null;
  level2?: {
    journey_id?: string;
    object?: unknown;
    capacity?: unknown;
    structure?: unknown;
    current_stage?: number;
    stages?: readonly WcStage[];
    closure?: unknown;
  } | null;
  level3?: {
    actual?: readonly WcItem[];
    expected?: readonly WcItem[];
    hidden_steps?: number | null;
    stage_n?: number;
    note?: unknown;
  } | null;
  [k: string]: unknown;
}
export interface WcLevels23 {
  ignored_events?: readonly unknown[];
  notice_step?: { step_id?: string } | null;
  actual?: readonly { step_id: string; state?: string; stage_level?: boolean }[];
  alternative_groups?: unknown;
  [k: string]: unknown;
}
export interface WcDiagnostics {
  view_version: string | null;
  audience: string | null;
  anomalies: string[];
  notes: string[];
  ignored_events: number;
  hidden_steps: number | null;
  notice_step: string | null;
}
export interface AdaptedLevels extends Levels23 {
  wc: WcDiagnostics;
}

/**
 * adaptWcView(view, l23, object, journey) → {l2, l3, downgraded, wc} in the renderers' shape. Layer A items keep W-C's state and
 * evidence id; Layer B items keep W-C's kind (and condition); notes keep W-C's note label. A view without Level 2/3 (unknown
 * recipient class, journey not found) yields no levels: the renderers then show «غير متاح» to internal recipients (fail closed).
 */
export function adaptWcView(
  view: WcView | null | undefined,
  l23: WcLevels23 | null | undefined,
  object: ProceduralObject | null | undefined,
  journey: Journey,
): AdaptedLevels {
  const diag: WcDiagnostics = {
    view_version: view?.version ?? null,
    audience: view?.audience ?? null,
    anomalies: (view?.diagnostics?.anomalies ?? []).map((a) => a.code),
    notes: (view?.diagnostics?.notes ?? []).map((n) => n.code),
    ignored_events: (l23?.ignored_events ?? []).length,
    hidden_steps: view?.level3?.hidden_steps ?? null,
    notice_step: l23?.notice_step?.step_id ?? null,
  };
  const resolved = new Map(
    (l23?.actual ?? []).filter((x) => !x.stage_level).map((x) => [x.step_id, x.state]),
  );
  const downgraded = (object?.steps ?? [])
    .filter(
      (c) =>
        c &&
        ((c.actual === "COMPLETED" && resolved.get(c.step_id) !== "COMPLETED") ||
          (c.actual === "IN_PROGRESS" &&
            !["IN_PROGRESS", "COMPLETED"].includes(String(resolved.get(c.step_id))))),
    )
    .map((c) => c.step_id);
  if (!view || !view.level2 || !view.level3) return { l2: null, l3: null, downgraded, wc: diag };
  const L2 = view.level2;
  const L3 = view.level3;
  const note = (x: {
    note?: string;
    note_label?: unknown;
  }): { note?: string; note_label?: { ar: string | null; en: string | null } } =>
    x.note ? { note: x.note, ...(x.note_label ? { note_label: bi(x.note_label) } : {}) } : {};
  const l2stages: StageView[] = (L2.stages ?? []).map((st) =>
    st.layer === "A"
      ? {
          n: st.n,
          ...bi(st.label),
          layer: "actual",
          state: st.state,
          ...(st.state === "COMPLETED" ? { evidence_recorded: true } : {}),
          ...note(st),
          ...(st.current ? { current: true } : {}),
        }
      : {
          n: st.n,
          ...bi(st.label),
          layer: "expected",
          kind: st.kind,
          ...(st.current ? { current: true } : {}),
        },
  );
  const order = new Map(journey.stages.flatMap((st) => st.steps.map((x) => x.id)).map((id, i) => [id, i]));
  const firstOf = new Map(journey.stages.map((st) => [st.n, order.get(st.steps[0]?.id ?? "") ?? 0]));
  const ord = (x: WcItem): number =>
    order.has(x.step_id) ? (order.get(x.step_id) ?? 0) : (firstOf.get(x.stage ?? Number.NaN) ?? 0) - 0.5;
  const items = [
    ...(L3.actual ?? []).map((x) => ({ x, A: true })),
    ...(L3.expected ?? []).map((x) => ({ x, A: false })),
  ].sort((a, b) => ord(a.x) - ord(b.x));
  const byStage = new Map<number | undefined, StepView[]>();
  for (const { x, A } of items) {
    const cond = condOf(x.condition);
    const step: StepView = A
      ? {
          step_id: x.step_id,
          ...bi(x.label),
          layer: "actual",
          state: x.state,
          evidence_event_id: x.evidence_event_id ?? null,
          epistemic: x.epistemic ?? null,
          ...note(x),
          ...(x.is_notice ? { is_notice: true } : {}),
          ...(x.stage_level ? { stage_level: true } : {}),
        }
      : {
          step_id: x.step_id,
          ...bi(x.label),
          layer: "expected",
          kind: x.kind,
          epistemic: x.epistemic ?? null,
          ...(cond ? { condition: cond } : {}),
          ...note(x),
          ...(x.is_notice ? { is_notice: true } : {}),
        };
    let list = byStage.get(x.stage);
    if (!list) {
      list = [];
      byStage.set(x.stage, list);
    }
    list.push(step);
  }
  const l3stages: L3Stage[] = journey.stages
    .filter((st) => byStage.has(st.n))
    .map((st) => {
      const sm = l2stages.find((y) => y.n === st.n);
      return {
        n: st.n,
        ar: st.ar,
        en: st.en,
        state: sm?.layer === "actual" ? (sm.state ?? null) : null,
        steps: byStage.get(st.n) ?? [],
      };
    });
  return {
    l2: {
      journey_id: L2.journey_id,
      object: bi(L2.object),
      capacity: L2.capacity ? bi(L2.capacity) : null,
      structure: L2.structure ?? null,
      current_stage: L2.current_stage,
      stages: l2stages,
      closure: L2.closure ? bi(L2.closure) : null,
      visibility: view.audience,
    },
    l3: {
      journey_id: L2.journey_id,
      current_stage: L3.stage_n,
      stages: l3stages,
      visibility: view.audience,
      ...(L3.note ? { note: bi(L3.note) } : {}),
    },
    downgraded,
    wc: diag,
  };
}

const wcCatalogue = (
  catalogue: Catalogue | null | undefined,
): catalogue is Catalogue & { assignments: Assignment[] } =>
  !!catalogue && Array.isArray(catalogue.assignments) && String(catalogue.__source ?? "").startsWith("W-C");
/** W-C's raw Level 2/3 resolution (for cross-checks such as the W-D1 context's alternative groups); null without W-C */
export function wcResolution(
  object: ProceduralObject | null | undefined,
  events: readonly DemoEvent[],
  catalogue: Catalogue | null | undefined,
  assignmentId: string | null = null,
): WcLevels23 | null {
  if (!WC || !object || !wcCatalogue(catalogue)) return null;
  const asg = assignmentId
    ? (catalogue.assignments.find((a) => a.id === assignmentId && a.journey === object.journey_id) ?? null)
    : null;
  try {
    return WC.resolveLevel2_3(
      ...([object, catalogue, asg, events] as unknown as Parameters<typeof resolveLevel2_3>),
    ) as WcLevels23;
  } catch {
    return null;
  }
}

interface LevelsResult extends Levels23 {
  resolver: string;
  assignment?: string | null;
  resolver_error?: string;
  wc?: WcDiagnostics;
}
function levels23(
  object: ProceduralObject,
  journey: Journey,
  events: readonly DemoEvent[],
  opts: { recipient_class: string; catalogue: Catalogue; assignment_id: string | null },
): LevelsResult {
  const cat = opts.catalogue;
  if (WC && wcCatalogue(cat)) {
    try {
      const asg = opts.assignment_id
        ? (cat.assignments.find((a) => a.id === opts.assignment_id && a.journey === journey.id) ?? null)
        : null;
      const l23 = WC.resolveLevel2_3(
        ...([object, cat, asg, events] as unknown as Parameters<typeof resolveLevel2_3>),
      ) as WcLevels23;
      const view = WC.buildProgressView(
        ...([null, l23, opts.recipient_class] as unknown as Parameters<typeof buildProgressView>),
      ) as WcView;
      return {
        ...adaptWcView(view, l23, object, journey),
        resolver: "W-C resolve.js + progress.js",
        assignment: asg?.id ?? null,
      };
    } catch (e) {
      return {
        ...resolveLevels23(object, journey, events, opts),
        resolver: "W-D2 local",
        resolver_error: e instanceof Error ? e.name : "Error",
      };
    }
  }
  return { ...resolveLevels23(object, journey, events, opts), resolver: "W-D2 local" };
}

// ---------------------------------------------------------------------------------------------------------------
// Deadline basis wording (PROPOSED). The rule id is the decision-register reference; the text never states a period
// that has no source.
// ---------------------------------------------------------------------------------------------------------------
const BASIS_TEXT: Readonly<Record<string, { ar: string; en: string }>> = Object.freeze({
  "DEC-F15": { ar: AR["deadlineBasis.decF15"], en: EN["deadlineBasis.decF15"] },
});
const INTERNAL_HELP = { ar: AR["model.internalHelp"], en: EN["model.internalHelp"] };
// the classification marking texts are the renderer's CLASSIFICATION wording (one source)
const CLASS_TEXT: Readonly<Record<string, { ar: string; en: string }>> = {
  PUBLIC: { ar: CLASSIFICATION.PUBLIC.ar, en: CLASSIFICATION.PUBLIC.en },
  INTERNAL: { ar: CLASSIFICATION.INTERNAL.ar, en: CLASSIFICATION.INTERNAL.en },
  RESTRICTED: { ar: CLASSIFICATION.RESTRICTED.ar, en: CLASSIFICATION.RESTRICTED.en },
};
/** the notice version's own opaque correspondence reference (W-F field notice_reference: derived from the notification id;
 *  never from the case number, an address or a name). Also the {notice_ref} of every SAFE_REFERENCE replacement. */
export function noticeReference(notificationId: string): string {
  return "NTF-DEMO-" + sha256Hex(`notice-ref|${notificationId}`).slice(0, 8).toUpperCase();
}

/** the fields of an unprojected model (a field is absent rather than null) */
export type ModelFieldValues = { [K in keyof ModelFields]?: ModelFields[K] };
export interface ModelProvenance {
  catalogue: string;
  catalogue_version: string | null;
  catalogue_note: string | null;
  resolver: string;
  resolver_note: string;
  resolver_error: string | null;
  assignment: string | null;
  wc_diagnostics: WcDiagnostics | null;
  downgraded_steps: string[];
  authority_source: string;
  authority_version: string;
}
export interface NotificationModel {
  meta: ModelMeta;
  fields: ModelFieldValues;
  safe_refs: { "*": string };
  provenance: ModelProvenance;
}
type AuthorityModel = ReturnType<typeof loadAuthority>;
export interface BuildModelOptions {
  lang?: unknown;
  catalogue?: Catalogue | null;
  authority?: AuthorityModel | null;
  generated_at?: string;
}

/**
 * The help and confidentiality texts a recipient class gets (the same rule for fixture scenarios and server records):
 * an external class gets its own help text from the content, if any, and its own confidentiality text; an internal
 * class gets the content's INTERNAL help or the default internal help, and the INTERNAL (or RECUSED_MEMBER) notice.
 */
export function recipientNotices(
  cls: string,
  help?: Readonly<Record<string, unknown>> | null,
): { help: unknown; confidentiality_notice: { ar: string; en: string } } {
  const external = (EXTERNAL_CLASSES as readonly string[]).includes(cls);
  const helpKey = external ? cls : "INTERNAL";
  const confKey = external ? cls : cls === "RECUSED_MEMBER" ? "RECUSED_MEMBER" : "INTERNAL";
  return {
    help:
      (help && Object.hasOwn(help, helpKey) ? help[helpKey] : undefined) ?? (external ? null : INTERNAL_HELP),
    confidentiality_notice:
      (Object.hasOwn(CONFIDENTIALITY, confKey)
        ? CONFIDENTIALITY[confKey as keyof typeof CONFIDENTIALITY]
        : undefined) ?? CONFIDENTIALITY.INTERNAL,
  };
}

/**
 * buildNotificationModel(scenario, recipient, {lang, catalogue, authority, generated_at}) → unprojected model
 * `recipient` = {class, ref, label:{ar,en}, email, actor:{capacity, seat_active, recused, delegation_active}, on_access_list}
 */
export function buildNotificationModel(
  scenario: Scenario,
  recipient: Recipient,
  opts: BuildModelOptions = {},
): NotificationModel {
  if (!scenario || !recipient || !recipient.class)
    throw new TypeError("buildNotificationModel: scenario and recipient.class are required");
  const lang = opts.lang === "en" ? "en" : "ar";
  const object = recipient.object ?? scenario.object ?? null; // a recipient may follow another object of the same notification (owner rule: Level 2 per object and capacity)
  const catalogue = opts.catalogue ?? loadCatalogue({ needs: object?.journey_id ? [object.journey_id] : [] });
  const authority = opts.authority ?? loadAuthority();
  const events = scenario.events ?? [];
  const journey = object ? (catalogue.journeys.find((j) => j.id === object.journey_id) ?? null) : null;
  const trigger =
    events.find((e) => e.event_id === scenario.trigger_event_id) ?? events[events.length - 1] ?? null;
  const caseRec = scenario.case ?? null;
  const cls = recipient.class;
  const nid = demoUuid(`ntf|${scenario.id}|${cls}|${recipient.ref ?? ""}`);
  const po = object ? { ...object, events } : { events };

  const next: NextAction = deriveNextAction({
    notification_type: scenario.type_code,
    recipient,
    procedural_object: po,
    case: caseRec,
    authority_model: authority,
    events,
  });
  const lv: LevelsResult =
    object && journey
      ? levels23(object, journey, events, {
          recipient_class: cls,
          catalogue,
          assignment_id: recipient.assignment_id ?? scenario.assignment_id ?? null,
        })
      : { l2: null, l3: null, downgraded: [], resolver: "none" };
  // assembled with nulls first; every null is removed below (as in the reference)
  const fields: Record<string, unknown> = {};
  const c = scenario.content ?? {};
  const over = recipient.content ?? {};
  fields.event_title = over.event_title ?? c.event_title ?? null;
  fields.event_summary = over.event_summary ?? c.event_summary ?? null;
  fields.event_at = trigger?.occurred_at ?? null;
  fields.recipient_capacity_label = recipient.label ?? null;
  fields.issuer = c.issuer ?? { ar: AR["model.defaultIssuer"], en: EN["model.defaultIssuer"] };
  const noticeRef = noticeReference(nid);
  fields.notice_reference = noticeRef;
  fields.template_code = scenario.type_code ?? null;
  const classification = caseRec?.classification;
  fields.classification_marking = classification
    ? {
        code: classification,
        ...(Object.hasOwn(CLASS_TEXT, classification) ? CLASS_TEXT[classification] : {}),
      }
    : null;
  if (caseRec && caseRec.exists !== false && caseRec.internal_ref) fields.case_number = caseRec.internal_ref;
  if (scenario.report_id) fields.report_id = scenario.report_id;
  if (object?.ref) fields.internal_ref = object.ref;
  fields.l1_stage_name = resolveLevel1(caseRec, catalogue);
  const sub = resolveSubstate(caseRec, catalogue);
  if (sub) fields.l1_substate = sub;
  if (lv.l2) fields.l2_journey = lv.l2;
  if (lv.l3) fields.l3_steps = lv.l3;
  if (c.status_text) fields.procedural_status_text = c.status_text;
  if (scenario.meeting) fields.meeting_info = scenario.meeting;
  const sens = scenario.sensitive ?? {};
  for (const k of [
    "allegations",
    "investigation_details",
    "decision_outcome",
    "decision_reasons",
    "member_names",
    "participant_names",
    "reporter_identity",
  ]) {
    if (!isNil(sens[k])) fields[k] = sens[k];
  }
  // deadline: the action's own, else the first optional right's (never invented: rules.resolveDeadline decides)
  let dl: {
    kind?: string | null;
    at: string | null;
    reason?: unknown;
    basis_event_id?: string;
    basis_rule?: string;
    basis_event_type?: string | undefined;
  } | null = null;
  if (next.deadline) dl = { ...next.deadline };
  else if (next.deadline_reason)
    dl = { kind: next.deadline_reason.kind, at: null, reason: next.deadline_reason };
  else
    for (const r of next.optional_rights || []) {
      if (r.deadline) {
        dl = { ...r.deadline };
        break;
      }
      if (r.deadline_reason) {
        dl = { kind: r.deadline_reason.kind, at: null, reason: r.deadline_reason };
        break;
      }
    }
  if (dl) {
    fields.deadline = dl;
    if (dl.at) {
      const rule = dl.basis_rule ?? "";
      fields.deadline_basis = {
        basis_event_id: dl.basis_event_id,
        basis_rule: dl.basis_rule,
        event_type: dl.basis_event_type ?? null,
        ...((Object.hasOwn(BASIS_TEXT, rule) ? BASIS_TEXT[rule] : undefined) ?? {
          ar: fill(AR["deadlineBasis.rule"], {
            rule: String(dl.basis_rule),
            eventType: dl.basis_event_type ?? "",
          }),
          en: fill(EN["deadlineBasis.rule"], {
            rule: String(dl.basis_rule),
            eventType: dl.basis_event_type ?? "",
          }),
        }),
      };
    }
  }
  const how = next.how ?? {};
  if (how.path && how.link_kind === "PLATFORM_DEEP_LINK")
    fields.links_internal = { app: how.app, path: how.path };
  if (how.path && how.link_kind === "PORTAL_LINK") fields.links_portal = { app: how.app, path: how.path };
  const evIds = new Set<string>();
  for (const s of object?.steps || []) if (s.evidence_event_id) evIds.add(s.evidence_event_id);
  if (caseRec?.status?.source_event_id) evIds.add(caseRec.status.source_event_id);
  const evRefs = events
    .filter((e) => evIds.has(e.event_id))
    .map((e) => ({ event_id: e.event_id, type: evType(e), recorded_at: e.recorded_at ?? null }));
  if (evRefs.length) fields.evidence_refs = evRefs;
  if (Array.isArray(scenario.audit_refs) && scenario.audit_refs.length)
    fields.audit_refs = scenario.audit_refs;
  fields.card_content = { enabled: true };
  fields.preheader = { enabled: true };
  fields.subject_detail = { enabled: true };
  if (scenario.exception) fields.exception_indicator = scenario.exception;
  // every demo output is an unsent design preview (X-Unsent: 1): DRAFT. Wording rules: components.ts deliveryWording (L-07, L-04)
  fields.delivery_status = {
    notification_status: "DRAFT",
    note: { ar: AR["model.designPreviewNote"], en: EN["model.designPreviewNote"] },
  };
  fields.next_action = next;
  if (next.authority?.action_id) {
    const extra = ruleFor(scenario.type_code, cls)?.object_extra ?? {};
    // the outcome echoes the query's action_id (a string here); CheckOutcome types it (and role, basis_status) loosely
    const r = check(authority, {
      action_id: next.authority.action_id,
      actor: recipient.actor ?? {},
      object: { ...po, ...extra },
      purpose: "EXECUTE",
    }) as {
      action_id?: string;
      action?: unknown;
      result?: string;
      code?: string;
      role?: string | null;
      administrative?: boolean;
      basis_status?: string | null;
      reason?: unknown;
    };
    fields.decision_rights = {
      action_id: r.action_id,
      action: r.action ?? null,
      result: r.result,
      code: r.code,
      role: r.role ?? null,
      administrative: r.administrative === true,
      basis_status: r.basis_status ?? null,
      reason: r.reason,
    };
  }
  const notices = recipientNotices(cls, c.help);
  fields.help = notices.help;
  if (isNil(fields.help)) delete fields.help;
  fields.confidentiality_notice = notices.confidentiality_notice;
  for (const k of Object.keys(fields)) if (isNil(fields[k])) delete fields[k];

  const tags = new Set(scenario.context_tags ?? []);
  // CASE_RESTRICTED only for a recipient NOT verified on the restricted case's approved access list (W-F context_resolution;
  // unknown membership counts as not listed — fail closed). A listed recipient is projected under '*'.
  if (
    (caseRec?.classification === "RESTRICTED" || caseRec?.classification === "SECRET") &&
    recipient.on_access_list !== true
  )
    tags.add("CASE_RESTRICTED");
  if (caseRec?.classification === "PUBLIC") tags.add("CASE_PUBLIC");
  // EXTERNAL = the delivery leaves CDF's boundary (W-F context_resolution): always for a referring body; otherwise only when
  // the recipient is addressed outside CDF. A CDF employee who is a witness or the subject is not EXTERNAL.
  if (cls === "REFERRING_BODY" || recipient.delivery_context === "EXTERNAL") tags.add("EXTERNAL");
  return {
    meta: {
      notification_id: nid,
      type_code: scenario.type_code,
      event_type: evType(trigger) ?? null,
      template_version: TEMPLATE_VERSION,
      language: lang,
      recipient_class: cls,
      recipient_ref: recipient.ref ?? null,
      generated_at: opts.generated_at ?? GENERATED_AT,
      synthetic: true,
      marking: MARKING,
      scenario_id: scenario.id,
      release_status: "DESIGN_PREVIEW",
      context: { tags: [...tags], on_access_list: recipient.on_access_list === true },
    },
    // assembled field by field above from the shapes listed in ModelFields
    fields: fields as ModelFieldValues,
    safe_refs: { "*": noticeRef },
    provenance: {
      catalogue: catalogue.__source ?? "unknown",
      catalogue_version: catalogue.version ?? null,
      catalogue_note: catalogue.__note ?? null,
      resolver: lv.resolver,
      resolver_note: WC_RESOLVE_NOTE,
      resolver_error: lv.resolver_error ?? null,
      assignment: lv.assignment ?? null,
      wc_diagnostics: lv.wc ?? null,
      downgraded_steps: lv.downgraded,
      authority_source: authority.source,
      authority_version: authority.version,
    },
  };
}

/** convenience: build and project for one experience ('EMAIL' | 'PLATFORM') */
export function buildProjected(
  scenario: Scenario,
  recipient: Recipient,
  {
    lang,
    experience = "EMAIL",
    policy,
    authority,
    catalogue,
  }: {
    lang?: unknown;
    experience?: "EMAIL" | "PLATFORM";
    policy?: unknown;
    authority?: AuthorityModel | null;
    catalogue?: Catalogue | null;
  } = {},
): { model: NotificationModel; projected: ReturnType<typeof project> } {
  const model = buildNotificationModel(scenario, recipient, { lang, authority, catalogue });
  return {
    model,
    projected: project(model, {
      recipient: recipient.class,
      channel: experience,
      context: model.meta.context,
      policy,
    }),
  };
}
export { isAllowed };
