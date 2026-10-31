// tests/unit/journeys/journeys.test.ts — W-C (V13-05). Three-level journey resolution: the mandatory CF cases (charter §12)
// and the journey-resolution checks JR-01…JR-24. Ported from tests/journeys.test.js (node:test → Vitest).
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Read-only.
// CF fixtures: lib/journeys/scenarios/*.json (expectations hand-derived by W-C from catalogue_v13.json; PROPOSED).
// Each scenario test checks the complete Layer A and Layer B lists, the evidence rule, the must-not list and the
// case-specific assertions the charter names; each variant is its own test. JR-05 is the event-type test (lead ruling L-05).
// Reference files outside src/ (V12 catalogue, work/ CSVs and notes) are read from ./__evidence__ (synthetic copies).
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as WA from "@/lib/domain/concepts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveLevel1,
  resolveLevel2_3,
  ACTUAL_STATES,
  EXPECTED_KINDS,
  ANOMALY_CODES,
  type ActualRow,
  type ExpectedRow,
  type Catalogue,
  type CatalogueStep,
  type CatalogueStage,
  type CatalogueJourney,
  type CatalogueAssignment,
  type CaseRecordInput,
  type ProceduralObjectInput,
  type JourneyEvent,
  type EventPattern,
  type Payload,
  type Level1Result,
  type Level1Known,
  type Level23Resolved,
  type DeadlineRule,
  type Bilingual,
  type AppliesRule,
} from "@/lib/journeys/resolve";
import {
  buildProgressView,
  RECIPIENT_POLICY,
  type ProgressView,
  type ViewItemA,
  type ViewItemB,
} from "@/lib/journeys/progress";
import {
  CATALOGUE_V13,
  SCENARIO_INDEX,
  loadScenario,
  type Scenario,
  type ScenarioVariant,
  type ScenarioExpected,
} from "@/lib/journeys";

type Cat = Required<Catalogue> & { deadline_rules: Record<string, DeadlineRule> };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const EVIDENCE = join(HERE, "__evidence__");
const readJSON = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const CAT_PATH = join(ROOT, "lib", "journeys", "catalogue_v13.json");
const CAT = CATALOGUE_V13 as Cat;
const SCEN = join(ROOT, "lib", "journeys", "scenarios");
const INDEX = SCENARIO_INDEX;
const V12_PATH = join(EVIDENCE, "level2_journeys.json");
interface V12Catalogue {
  journeys: {
    id: string;
    object_ar: string;
    object_en: string;
    capacity_ar: string;
    capacity_en: string;
    stages: { n: number; sub?: Bilingual[] }[];
  }[];
  assignments: { id: string; journey: string; stage: number }[];
  master: { code: string; ar: string; en: string }[];
  master_sub_en: Record<string, string>;
}
const V12 = readJSON<V12Catalogue>(V12_PATH); // required: a missing copy fails at load
const AR = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;
const MANDATORY_CF = [
  "CF-15",
  "CF-16",
  "CF-17",
  "CF-18",
  "CF-19",
  "CF-23b",
  "CF-27",
  "CF-28",
  "CF-31",
  "CF-33",
  "CF-34",
  "CF-35",
  "CF-36",
  "CF-37",
];
const REPLACED_L05 = [
  "GRIEVANCE_REGISTERED",
  "GRIEVANCE_CONCLUDED",
  "PROCEDURE_CLOSED",
  "REFERRAL_DECIDED",
  "REMINDER_ISSUED",
];

// Compile-time only (never called): Layer A and Layer B are distinct types that cannot be assigned to each other,
// in the resolver output and in the view model.
function layerTypesAreDistinct(a: ActualRow, b: ExpectedRow, va: ViewItemA, vb: ViewItemB): void {
  // @ts-expect-error a Layer-A row is not a Layer-B row
  const b2: ExpectedRow = a;
  // @ts-expect-error a Layer-B row is not a Layer-A row
  const a2: ActualRow = b;
  // @ts-expect-error a Layer-A view item is not a Layer-B view item
  const vb2: ViewItemB = va;
  // @ts-expect-error a Layer-B view item is not a Layer-A view item
  const va2: ViewItemA = vb;
  void [a2, b2, va2, vb2];
}
void layerTypesAreDistinct;

// ------------------------------------------------------------------ catalogue helpers
interface StepEntry {
  step: CatalogueStep;
  stage: CatalogueStage;
  journey: CatalogueJourney;
}
const STEPS = new Map<string, StepEntry>();
for (const j of CAT.journeys)
  for (const st of j.stages) for (const s of st.steps) STEPS.set(s.id, { step: s, stage: st, journey: j });
const JOURNEYS = new Map(CAT.journeys.map((j) => [j.id, j] as const));
const ASG = new Map(CAT.assignments.map((a) => [a.id, a] as const));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const deq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const patList = (
  list: readonly EventPattern[] | undefined,
  type: string | null | undefined,
  payload: Payload | undefined,
): readonly EventPattern[] => (Array.isArray(list) && list.length ? list : type ? [{ type, payload }] : []);
const compPats = (s: Partial<CatalogueStep>) =>
  patList(s.completion_any_of, s.completion_event_type, s.completion_payload);
const trigPats = (s: Partial<CatalogueStep>) =>
  patList(s.trigger_any_of, s.trigger_event_type, s.trigger_payload);
const compTypes = (s: Partial<CatalogueStep>) => [...new Set(compPats(s).map((p) => p.type))];
const stepOf = (id: string): CatalogueStep => STEPS.get(id)!.step;

/** Every event type the catalogue names, with where it is named. */
function catalogueEventTypes(cat: Cat): Map<string, string[]> {
  const used = new Map<string, string[]>();
  const add = (type: unknown, where: string) => {
    if (typeof type !== "string" || !type) return;
    if (!used.has(type)) used.set(type, []);
    used.get(type)!.push(where);
  };
  const addPats = (list: readonly (EventPattern | null)[] | undefined, where: string) =>
    (list || []).forEach((p) => p && add(p.type, where));
  const addRule = (rule: AppliesRule | undefined, where: string) => {
    if (rule) {
      addPats(rule.match, where);
      addPats(rule.excluded_by, where);
    }
  };
  for (const j of cat.journeys) {
    for (const [k, list] of Object.entries((j.lifecycle && j.lifecycle.events) || {}))
      if (Array.isArray(list)) addPats(list as EventPattern[], `${j.id} lifecycle.${k}`);
    for (const st of j.stages) {
      addRule(st.applies_if, `${j.id}/${st.n} applies_if`);
      for (const s of st.steps) {
        addPats(compPats(s), s.id);
        addPats(trigPats(s), s.id);
        if (s.return_on) add(s.return_on.type, `${s.id} return_on`);
        if (s.fail_on) add(s.fail_on.type, `${s.id} fail_on`);
        addRule(s.applies_if, `${s.id} applies_if`);
      }
    }
  }
  for (const a of cat.assignments) {
    add(a.reports_event_type, `assignment ${a.id}`);
    addPats(a.reports_any_of, `assignment ${a.id}`);
  }
  for (const [id, r] of Object.entries(cat.deadline_rules || {}))
    add(r.basis_event_type, `deadline_rules.${id}`);
  for (const key of Object.keys(cat.payload_conventions || {}))
    for (const t of key.split(/,\s*/)) if (!t.endsWith("*")) add(t, "payload_conventions");
  for (const t of (cat.event_types &&
    cat.event_types.formal_notices &&
    cat.event_types.formal_notices.types) ||
    [])
    add(t, "formal_notices");
  return used;
}

// ------------------------------------------------------------------ synthetic fixtures (JR tests)
const CASE_ID = "ca5e0000-0000-4000-8000-0000000a0001";
const OTHER_CASE = "ca5e0000-0000-4000-8000-0000000a00ff";
const OBJ = "0b1ec700-0000-4000-8000-0000000a0001";
const OTHER = "0b1ec700-0000-4000-8000-0000000a00ff";
const GRV = "0b1ec700-0000-4000-8000-0000000a0099";
type EvOpts = {
  id?: string;
  at?: string;
  case_id?: string;
  object?: { type: string; id: string };
  version?: number;
};
type EvSpec = [string, Record<string, unknown>?, EvOpts?];
interface TestEvent extends JourneyEvent {
  event_id: string;
  occurred_at: string;
  recorded_at: string;
  payload: Record<string, unknown>;
}
/** events([[type, payload, opts], ...]) — times one minute apart, all on OBJ unless opts say otherwise. */
function events(list: EvSpec[]): TestEvent[] {
  return list.map(([type, payload = {}, o = {}], i) => ({
    event_id: o.id || `evt-JR-${String(i + 1).padStart(2, "0")}`,
    type,
    occurred_at: o.at || new Date(Date.UTC(2026, 9, 1, 8, i)).toISOString(),
    recorded_at: o.at || new Date(Date.UTC(2026, 9, 1, 8, i, 30)).toISOString(),
    case_id: o.case_id || CASE_ID,
    object: o.object || { type: "PROCEDURE", id: OBJ },
    actor: { capacity: "SECRETARY", id: "usr-demo-secretary" },
    provenance: { source: "SYNTHETIC_DEMO", ref: "tests/journeys.test.js" },
    version: o.version || 1,
    causation_id: null,
    correlation_id: "corr-JR",
    payload,
  }));
}
const procObj = (journey_id: string, extra: Record<string, unknown> = {}): ProceduralObjectInput => ({
  object_id: OBJ,
  type: "PROCEDURE",
  case_id: CASE_ID,
  journey_id,
  status: null,
  status_source_event_id: null,
  steps: [],
  deadlines: [],
  ...extra,
});
// The resolved shape (every journey used here exists); the cast changes nothing at run time.
const resolve23 = (
  po: ProceduralObjectInput | null,
  cat: Catalogue,
  asg: CatalogueAssignment | null | undefined,
  evs: readonly unknown[],
): Level23Resolved => resolveLevel2_3(po, cat, asg, evs) as Level23Resolved;
const run = (
  journey: string,
  evs: readonly unknown[],
  {
    asg = null,
    extra = {},
    cat = CAT,
  }: { asg?: CatalogueAssignment | null; extra?: Record<string, unknown>; cat?: Catalogue } = {},
) => resolve23(procObj(journey, extra), cat, asg, evs);
const rowA = (r: Level23Resolved, id: string): ActualRow | null =>
  r.actual.find((x) => x.step_id === id) || null;
const rowB = (r: Level23Resolved, id: string): ExpectedRow | null =>
  r.expected.find((x) => x.step_id === id) || null;
const stateOf = (r: Level23Resolved, id: string): string | null => {
  const a = rowA(r, id);
  if (a) return a.state + (a.note ? "/" + a.note : "");
  const b = rowB(r, id);
  return b ? "B:" + b.kind + (b.note ? "/" + b.note : "") : null;
};
const codes = (r: { anomalies: readonly { code: string }[] }): string[] => r.anomalies.map((a) => a.code);
const caseRec = (code: string, extra: Record<string, unknown> = {}): CaseRecordInput => ({
  case_id: CASE_ID,
  internal_ref: "CDF-DEMO-2026-0901",
  track: "IR",
  classification: "INTERNAL",
  exists: true,
  status: { code, recorded_at: "2026-10-01T08:00:00Z", source_event_id: "evt-JR-case" },
  flags: { suspended: false, returned: false, cancelled: false, reopened: false, closed: false },
  restrictions: { rca_required: false },
  ...extra,
});
const known = (l1: Level1Result | null): Level1Known => l1 as Level1Known;
/** A payload that satisfies a pattern payload (array → first non-null value; null-only → key omitted). */
function satisfy(payload: Payload | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (Array.isArray(v)) {
      const w = v.find((x: unknown) => x !== null);
      if (w !== undefined) out[k] = w;
    } else out[k] = v;
  }
  return out;
}

// ------------------------------------------------------------------ scenario check (Layer A / Layer B / evidence / must-not)
function materialise(sc: Scenario, v: ScenarioVariant | null) {
  const caseRecord = clone(sc.case) as Mutable<CaseRecordInput> & Record<string, unknown>;
  let po: ProceduralObjectInput = clone(sc.procedural_object);
  let evs = clone(sc.events) as Mutable<JourneyEvent>[];
  let expected: ScenarioExpected = clone(sc.expected);
  if (v) {
    if (v.events) evs = clone(v.events) as Mutable<JourneyEvent>[];
    if (v.events_add) evs = [...evs, ...(clone(v.events_add) as Mutable<JourneyEvent>[])];
    if (v.events_replace)
      for (const r of v.events_replace) {
        const e = evs.find((x) => x.event_id === r.event_id);
        assert.ok(e, `${v.id}: events_replace names ${r.event_id}`);
        e.payload = clone(r.payload);
      }
    if (v.procedural_object_patch) po = { ...po, ...clone(v.procedural_object_patch) };
    if (v.case_patch)
      for (const [k, val] of Object.entries(v.case_patch)) {
        if (val === null) delete caseRecord[k];
        else caseRecord[k] = clone(val);
      }
    expected = { l1: expected.l1, notice_location: expected.notice_location, ...clone(v.expected) };
  }
  return { caseRecord: caseRecord as CaseRecordInput, po, events: evs as JourneyEvent[], expected };
}
const SYM2STATE: Record<string, string> = { "✔": "COMPLETED", "●": "IN_PROGRESS", "○": "PENDING" };

interface CheckResult {
  f: string[];
  l1: Level1Result | null;
  r: Level23Resolved;
  view: ProgressView;
  events: JourneyEvent[];
  po: ProceduralObjectInput;
  caseRecord: CaseRecordInput;
  asg: CatalogueAssignment;
}

function checkScenario(sc: Scenario, v: ScenarioVariant | null): CheckResult {
  const f: string[] = [];
  const { caseRecord, po, events: evs, expected: X } = materialise(sc, v);
  const asg = ASG.get(sc.assignment_id);
  if (!asg) f.push(`assignment ${sc.assignment_id} not in the catalogue`);
  const l1 = resolveLevel1(caseRecord, CAT);
  const r = resolve23(po, CAT, asg, evs);
  const vcls = (RECIPIENT_POLICY as Record<string, unknown>)[sc.recipient_class]
    ? sc.recipient_class
    : "SECRETARY";
  const view = buildProgressView(l1, r, vcls);
  // Level 1
  if (X.l1 === null) {
    if (l1 !== null) f.push("Level 1 should be absent");
    if (view.level1 !== null) f.push("view Level 1 should be absent");
  } else if (X.l1) {
    if (!l1) f.push("Level 1 missing");
    else {
      if (l1.stage?.code !== X.l1.stage) f.push(`L1 stage ${l1.stage?.code} != ${X.l1.stage}`);
      if (l1.substate?.code !== X.l1.substate) f.push(`L1 substate ${l1.substate?.code} != ${X.l1.substate}`);
      if (l1.current_state !== X.l1.current_state)
        f.push(`L1 current_state ${l1.current_state} != ${X.l1.current_state}`);
      if (l1.derivation !== X.l1.derivation) f.push(`L1 derivation ${l1.derivation} != ${X.l1.derivation}`);
      for (const xs of X.l1.stages) {
        const s = l1.stages.find((y) => y.code === xs.code);
        if (!s) {
          f.push(`L1 stage ${xs.code} missing`);
          continue;
        }
        if (s.layer !== xs.layer) f.push(`L1 ${xs.code} layer ${s.layer} != ${xs.layer}`);
        if (xs.layer === "A" && s.state !== xs.state) f.push(`L1 ${xs.code} state ${s.state} != ${xs.state}`);
        if (xs.layer === "B" && s.kind !== xs.kind) f.push(`L1 ${xs.code} kind ${s.kind} != ${xs.kind}`);
        if (!!s.current !== !!xs.current) f.push(`L1 ${xs.code} current ${!!s.current} != ${!!xs.current}`);
        for (const k of ["note", "reopened", "previously_visited"] as const)
          if (xs[k] !== undefined && s[k] !== xs[k]) f.push(`L1 ${xs.code} ${k} ${s[k]} != ${xs[k]}`);
      }
      if (X.l1.flags)
        for (const [k, val] of Object.entries(X.l1.flags))
          if ((l1.flags as Record<string, boolean>)[k] !== val)
            f.push(`L1 flag ${k} ${(l1.flags as Record<string, boolean>)[k]} != ${val}`);
    }
  }
  // Layer A and Layer B: complete lists
  const gotA = new Map(r.actual.map((x) => [x.step_id, x] as const));
  const gotB = new Map(r.expected.map((x) => [x.step_id, x] as const));
  if (X.actual) {
    const want = new Map(X.actual.map((x) => [x.step_id, x] as const));
    for (const [id, w] of want) {
      const g = gotA.get(id);
      if (!g) {
        f.push(`A ${id} missing (got ${gotB.has(id) ? "B " + gotB.get(id)!.kind : "nothing"})`);
        continue;
      }
      if (g.state !== w.state) f.push(`A ${id} state ${g.state} != ${w.state}`);
      if (w.evidence_event_id !== undefined && g.evidence_event_id !== w.evidence_event_id)
        f.push(`A ${id} evidence ${g.evidence_event_id} != ${w.evidence_event_id}`);
      if ((g.note ?? null) !== (w.note ?? null)) f.push(`A ${id} note ${g.note} != ${w.note}`);
      if (!!g.stage_level !== !!w.stage_level)
        f.push(`A ${id} stage_level ${!!g.stage_level} != ${!!w.stage_level}`);
    }
    for (const [id, g] of gotA)
      if (!want.has(id)) f.push(`A ${id} unexpected (${g.state}${g.note ? "/" + g.note : ""})`);
  }
  if (X.expected_steps) {
    const want = new Map(X.expected_steps.map((x) => [x.step_id, x] as const));
    for (const [id, w] of want) {
      const g = gotB.get(id);
      if (!g) {
        f.push(`B ${id} missing (got ${gotA.has(id) ? "A " + gotA.get(id)!.state : "nothing"})`);
        continue;
      }
      if (g.kind !== w.kind) f.push(`B ${id} kind ${g.kind} != ${w.kind}`);
      if ((g.note ?? null) !== (w.note ?? null)) f.push(`B ${id} note ${g.note} != ${w.note}`);
    }
    for (const [id, g] of gotB)
      if (!want.has(id)) f.push(`B ${id} unexpected (${g.kind}${g.note ? "/" + g.note : ""})`);
  }
  // evidence rule (charter 3.2): COMPLETED only with an input event of one of the step's completion types
  f.push(...evidenceViolations(r, evs, po));
  for (const id of gotA.keys()) if (gotB.has(id)) f.push(`${id} in both layers`);
  if (X.previous_round) {
    const want = new Map(X.previous_round.map((x) => [x.step_id, x] as const));
    const got = new Map(r.previous_round.map((x) => [x.step_id, x] as const));
    for (const [id, w] of want) {
      const g = got.get(id);
      if (!g) {
        f.push(`previous round ${id} missing`);
        continue;
      }
      if (g.state !== w.state) f.push(`previous round ${id} state ${g.state} != ${w.state}`);
      if (w.evidence_event_id !== undefined && g.evidence_event_id !== w.evidence_event_id)
        f.push(`previous round ${id} evidence ${g.evidence_event_id} != ${w.evidence_event_id}`);
    }
    for (const id of got.keys()) if (!want.has(id)) f.push(`previous round ${id} unexpected`);
  }
  if (X.stage_n !== undefined && r.stage?.n !== X.stage_n) f.push(`stage ${r.stage?.n} != ${X.stage_n}`);
  if (X.notice_location !== undefined && r.notice_step?.location !== X.notice_location)
    f.push(`notice location ${r.notice_step?.location} != ${X.notice_location}`);
  const derived = r.derived as unknown as Record<string, unknown>;
  if (X.derived)
    for (const [k, val] of Object.entries(X.derived))
      if (!deq(derived[k], val))
        f.push(`derived.${k} ${JSON.stringify(derived[k])} != ${JSON.stringify(val)}`);
  if (X.deadlines)
    for (const d of X.deadlines) {
      const g = r.deadlines.find((y) => y.kind === d.kind) as unknown as Record<string, unknown> | undefined;
      if (!g) {
        f.push(`deadline ${d.kind} missing`);
        continue;
      }
      for (const [k, val] of Object.entries(d))
        if (!deq(g[k], val))
          f.push(`deadline ${d.kind}.${k} ${JSON.stringify(g[k])} != ${JSON.stringify(val)}`);
    }
  const lifecycle = r.lifecycle as unknown as Record<string, boolean>;
  if (X.lifecycle)
    for (const [k, val] of Object.entries(X.lifecycle))
      if (lifecycle[k] !== val) f.push(`lifecycle.${k} ${lifecycle[k]} != ${val}`);
  if (X.ignored)
    for (const i of X.ignored)
      if (!r.ignored_events.some((y) => y.event_id === i.event_id && y.reason === i.reason))
        f.push(`ignored ${i.event_id} ${i.reason} missing`);
  const an = new Set(codes(r));
  for (const c of X.anomalies_include || [])
    if (!an.has(c)) f.push(`anomaly ${c} missing (${[...an].join(", ")})`);
  for (const c of X.anomalies_exclude || []) if (an.has(c)) f.push(`anomaly ${c} present`);
  const nt = new Set(r.notes.map((a) => a.code));
  for (const c of X.notes_include || []) if (!nt.has(c)) f.push(`note ${c} missing`);
  if (X.stages)
    for (const s of X.stages) {
      const g = r.stages.find((y) => y.n === s.n);
      if (!g || g.state !== s.state) f.push(`stage ${s.n} ${g?.layer}:${g?.state || g?.kind} != ${s.state}`);
    }
  if (X.view)
    for (const [cls, w] of Object.entries(X.view)) {
      const vv = buildProgressView(l1, r, cls);
      if ("level1" in w && w.level1 === null && vv.level1 !== null) f.push(`${cls} view shows Level 1`);
      if (w.l1_mode && vv.policy?.l1_mode !== w.l1_mode)
        f.push(`${cls} view l1_mode ${vv.policy?.l1_mode} != ${w.l1_mode}`);
      if (w.hidden) {
        const shown = new Set(
          [...(vv.level3?.actual || []), ...(vv.level3?.expected || [])].map((x) => x.step_id),
        );
        for (const h of w.hidden) if (shown.has(h)) f.push(`${cls} view shows hidden ${h}`);
        if (w.hidden.length === 0 && vv.level3?.hidden_steps !== 0)
          f.push(`${cls} view hides ${vv.level3?.hidden_steps} steps`);
      }
      if (w.summary5 !== undefined && (vv.level2?.summary5?.length ?? null) !== w.summary5)
        f.push(`${cls} view summary5 ${vv.level2?.summary5?.length} != ${w.summary5}`);
    }
  for (const m of X.must_not || []) f.push(...mustNot(m, { l1, r, view }));
  return { f, l1, r, view, events: evs, po, caseRecord, asg: asg as CatalogueAssignment };
}

function evidenceViolations(
  r: Level23Resolved,
  evs: readonly JourneyEvent[],
  po: ProceduralObjectInput,
): string[] {
  const f: string[] = [];
  const byId = new Map(evs.map((e) => [e.event_id, e] as const));
  const ign = new Set(r.ignored_events.map((x) => x.event_id));
  for (const a of r.actual) {
    if (a.state !== "COMPLETED") continue;
    const e = byId.get(a.evidence_event_id);
    const st = STEPS.get(a.step_id)?.step;
    if (!e) {
      f.push(`EVIDENCE ${a.step_id} COMPLETED without an input event (${a.evidence_event_id})`);
      continue;
    }
    if (ign.has(e.event_id ?? null)) f.push(`EVIDENCE ${a.step_id} cites an ignored event`);
    if (!st) {
      f.push(`EVIDENCE ${a.step_id} unknown step`);
      continue;
    }
    if (!compTypes(st).includes(e.type))
      f.push(
        `EVIDENCE ${a.step_id} event type ${e.type} is not a completion type of the step (${compTypes(st).join(" | ")})`,
      );
    if (st.completion_target === "SELF") {
      const t = e.payload && (e.payload.target as string | { id?: string } | undefined);
      const closedId = typeof t === "string" ? t : t && t.id ? t.id : e.object && e.object.id;
      if (closedId !== po.object_id) f.push(`EVIDENCE ${a.step_id} closes another object (${closedId})`);
    }
    if (a.completion_event_type !== e.type)
      f.push(`ROW ${a.step_id} completion_event_type ${a.completion_event_type} != evidence type ${e.type}`);
  }
  return f;
}

function mustNot(
  m: string,
  { l1, r, view }: { l1: Level1Result | null; r: Level23Resolved; view: ProgressView },
): string[] {
  const f: string[] = [];
  let mm: RegExpExecArray | null;
  const items = (vv: ProgressView) => [...(vv.level3?.actual || []), ...(vv.level3?.expected || [])];
  if ((mm = /^([✔●○]) on (J-[A-Z-]+\/\d+\/\d+)$/.exec(m))) {
    const [, sym, sid] = mm as unknown as [string, string, string];
    const g = r.actual.find((x) => x.step_id === sid);
    if (g && g.state === SYM2STATE[sym]) f.push(`MUST NOT ${m} (resolver)`);
    if (items(view).some((x) => x.step_id === sid && x.symbol === sym)) f.push(`MUST NOT ${m} (view)`);
  } else if (m === "L1") {
    if (l1 !== null || view.level1 !== null) f.push("MUST NOT L1");
  } else if ((mm = /^L1 (S\d\.\d\d)$/.exec(m))) {
    if (l1?.substate?.code === mm[1]) f.push(`MUST NOT ${m}`);
    if (JSON.stringify(view.level1 || {}).includes(`"${mm[1]}"`)) f.push(`MUST NOT ${m} (view)`);
  } else if ((mm = /^L1 ✔ on (S\d)$/.exec(m))) {
    const code = mm[1];
    if (l1?.stages.find((y) => y.code === code)?.state === "COMPLETED") f.push(`MUST NOT ${m}`);
    if (view.level1?.stages.find((y) => y.code === code)?.symbol === "✔") f.push(`MUST NOT ${m} (view)`);
  } else if ((mm = /^derived\.(\w+)$/.exec(m))) {
    if ((r.derived as unknown as Record<string, unknown>)[mm[1]!]) f.push(`MUST NOT ${m}`);
  } else if (m === "deadline.at") {
    if (r.deadlines.some((d) => d.at !== null)) f.push(`MUST NOT ${m}`);
  } else if ((mm = /^L1 in the (\w+) view$/.exec(m))) {
    if (buildProgressView(l1, r, mm[1]).level1 !== null) f.push(`MUST NOT ${m}`);
  } else if ((mm = /^(J-[A-Z-]+\/\d+\/\d+) in the (\w+) view$/.exec(m))) {
    const sid = mm[1];
    if (items(buildProgressView(l1, r, mm[2])).some((x) => x.step_id === sid)) f.push(`MUST NOT ${m}`);
  } else f.push(`UNPARSED must_not «${m}»`);
  return f;
}

const evOf = (res: CheckResult, type: string) => res.events.filter((e) => e.type === type);
const completedBy = (res: CheckResult, id: string) => {
  const a = rowA(res.r, id);
  return a && a.state === "COMPLETED" ? res.events.find((e) => e.event_id === a.evidence_event_id) : null;
};

// ------------------------------------------------------------------ case-specific assertions (charter §12; W-C brief)
const EXTRA: Record<string, (res: CheckResult) => void> = {
  "CF-15": (res) => {
    const stage2 = res.r.actual.find((x) => x.stage_level && x.stage === 2);
    assert.ok(
      stage2 && stage2.state === "PENDING",
      "the direction itself is the pending action (stage-level ○)",
    );
    for (const id of res.r.alternative_groups.find((g) => g.steps.includes("J-CHAIR-DIRECTION/2/1"))!.steps) {
      assert.equal(rowA(res.r, id), null, `${id} is an option, not a step in Actual Progress`);
      assert.equal(rowB(res.r, id)?.kind, "ALTERNATIVE");
    }
  },
  "CF-16": (res) => {
    assert.equal(stateOf(res.r, "J-CHAIR-DIRECTION/2/1"), "COMPLETED");
    assert.equal(
      stateOf(res.r, "J-CHAIR-DIRECTION/3/1"),
      "PENDING",
      "scheduling awaits action (○), it is not in progress",
    );
    for (const id of [
      "J-CHAIR-DIRECTION/2/2",
      "J-CHAIR-DIRECTION/2/3",
      "J-CHAIR-DIRECTION/2/4",
      "J-CHAIR-DIRECTION/2/5",
    ])
      assert.equal(stateOf(res.r, id), "B:ALTERNATIVE/NOT_SELECTED");
  },
  "CF-17": (res) => {
    assert.equal(known(res.l1).substate.code, res.caseRecord.status!.code, "Level 1 = the case record");
    assert.notEqual(
      res.asg.master_hint,
      res.caseRecord.status!.code,
      "fixture: the notification hint differs from the record",
    );
    assert.notEqual(
      known(res.l1).substate.code,
      res.asg.master_hint,
      "the notification type (master_hint) never sets Level 1",
    );
  },
  "CF-18": (res) => {
    const g = res.r.alternative_groups.find((x) => x.steps.includes("J-CHAIR-DIRECTION/2/3"))!;
    assert.equal(g.selected_count, 1);
    assert.equal(g.selected, "J-CHAIR-DIRECTION/2/3");
    assert.deepEqual(
      g.steps.filter((id) => rowA(res.r, id)),
      ["J-CHAIR-DIRECTION/2/3"],
      "exactly one direction in Layer A",
    );
    for (const id of g.steps.filter((x) => x !== "J-CHAIR-DIRECTION/2/3"))
      assert.equal(rowB(res.r, id)?.kind, "ALTERNATIVE", `${id} is a Layer-B alternative path`);
    const completed = res.r.actual.filter((x) => x.state === "COMPLETED");
    assert.equal(
      completed.length,
      3,
      "COMPLETED only where an event is recorded: presented (1/1, 1/2) and the direction (2/3)",
    );
    assert.ok(completed.every((x) => res.events.some((e) => e.event_id === x.evidence_event_id)));
    assert.notEqual(
      stateOf(res.r, "J-CHAIR-DIRECTION/3/2"),
      "IN_PROGRESS",
      "the information request is not shown in progress before it is sent",
    );
  },
  "CF-19": (res) => {
    assert.equal(evOf(res, "BALLOT_OPENED").length, 0, "fixture: no BALLOT_OPENED recorded");
    assert.equal(res.r.derived.ballot_open, false);
    assert.ok(
      !["IN_PROGRESS", "COMPLETED"].includes(rowA(res.r, "J-CHAIR-DIRECTION/3/3")?.state as string),
      "the vote is not shown open",
    );
    assert.ok(
      res.r.anomalies.some(
        (a) => a.code === "UNVERIFIED_STEP_CLAIM" && a.detail!.startsWith("J-CHAIR-DIRECTION/3/3"),
      ),
      "the object's claim that the vote is open is rejected",
    );
  },
  "CF-19-V1": (res) => {
    const bo = evOf(res, "BALLOT_OPENED");
    assert.equal(bo.length, 1);
    assert.equal(
      res.r.derived.ballot_open_event_id,
      bo[0]!.event_id,
      "the vote opens on BALLOT_OPENED and nothing else",
    );
    const without = resolve23(
      res.po,
      CAT,
      res.asg,
      res.events.filter((e) => e.type !== "BALLOT_OPENED"),
    );
    assert.equal(
      without.derived.ballot_open,
      false,
      "negative: the same input without BALLOT_OPENED shows no open vote",
    );
  },
  "CF-23b": (res) => {
    assert.equal(res.asg.completes, false, "a reminder notice completes nothing on its own sending");
    assert.notEqual(res.asg.reports_event_type, "NOTIFICATION_SENT");
    assert.equal(evOf(res, "NOTIFICATION_SENT").length, 0, "fixture: no reminder recorded as sent yet");
    assert.equal(stateOf(res.r, "J-DEFENCE/4/1"), "B:OPTIONAL");
    assert.notEqual(
      rowA(res.r, "J-DEFENCE/4/2")?.state,
      "COMPLETED",
      "the defence itself still awaits submission",
    );
    const d = res.r.deadlines.find((x) => x.kind === "DEFENCE_DUE")!;
    assert.equal(
      evOf(res, "DEFENCE_PERIOD_STARTED").find((e) => e.event_id === d.basis_event_id)?.payload!.due_at !==
        undefined,
      true,
      "the due date is the recorded due_at",
    );
  },
  "CF-23b-V1": (res) => {
    const d = res.r.deadlines.find((x) => x.kind === "DEFENCE_DUE")!;
    assert.equal(d.at, null, "no recorded due_at: no date is invented");
    assert.equal(d.status, "SOURCE_REQUIRED");
  },
  "CF-23b-V2": (res) => {
    const e = completedBy(res, "J-DEFENCE/4/1");
    assert.ok(
      e && e.type === "NOTIFICATION_SENT",
      "the reminder step completes on the recorded sending of an earlier reminder",
    );
    assert.equal(rowA(res.r, "J-DEFENCE/4/1")!.completion_event_type, "NOTIFICATION_SENT");
    assert.notEqual(
      rowA(res.r, "J-DEFENCE/4/2")?.state,
      "COMPLETED",
      "a reminder never completes the defence",
    );
  },
  "CF-25": (res) => {
    assert.equal(stateOf(res.r, "J-MEETING/1/5"), "CANCELLED");
    const after = res.r.actual.filter((x) => x.stage > 1 || x.step_id === "J-MEETING/1/4");
    assert.ok(
      after.every((x) => x.state === "NOT_APPLICABLE"),
      "nothing after the cancellation progresses or awaits action",
    );
    assert.equal(res.r.expected.length, 0, "nothing after the cancellation is expected");
  },
  "CF-27": (res) => {
    assert.equal(stateOf(res.r, "J-MEETING/4/2"), "IN_PROGRESS", "minutes under review");
    for (const id of ["J-MEETING/3/3", "J-MEETING/3/4"])
      assert.notEqual(rowA(res.r, id)?.state, "COMPLETED", `${id}: no vote was taken`);
    const d = res.r.deadlines.find((x) => x.kind === "MINUTES_REVIEW_DUE")!;
    assert.deepEqual(
      [d.at, d.status, d.rule_id],
      [null, "SOURCE_REQUIRED", "MINUTES_REVIEW_WINDOW"],
      "no date without an approved holiday calendar",
    );
    assert.equal(res.r.derived.minutes_final, null);
  },
  "CF-28": (res) => {
    const ns = evOf(res, "NOTIFICATION_SENT");
    assert.equal(ns.length, 1, "fixture: an earlier reminder is recorded as sent");
    assert.equal(
      stateOf(res.r, "J-MEETING/4/2"),
      "IN_PROGRESS",
      "the recorded reminder never completes the review",
    );
    assert.ok(
      !res.r.actual.some(
        (x) =>
          x.evidence_event_id === ns[0]!.event_id &&
          x.state === "COMPLETED" &&
          stepOf(x.step_id).completion_event_type !== "NOTIFICATION_SENT",
      ),
    );
    assert.equal(res.asg.completes, false);
    assert.equal(res.r.derived.minutes_final, null);
  },
  "CF-28-V1": (res) => {
    const mf = evOf(res, "MINUTES_FINAL")[0]!;
    assert.deepEqual(res.r.derived.minutes_final, { event_id: mf.event_id, basis: "DEEMED_APPROVED" });
    assert.equal(
      completedBy(res, "J-MEETING/4/2")?.type,
      "MINUTES_FINAL",
      "the review completes on MINUTES_FINAL, not on the reminder",
    );
    assert.equal(stateOf(res.r, "J-MEETING/4/3"), "PENDING");
  },
  "CF-31": (res) => {
    assert.equal(evOf(res, "BALLOT_OPENED").length, 0);
    assert.equal(res.r.derived.ballot_open, false);
    assert.notEqual(
      rowA(res.r, "J-RECOMMENDATION-COMMITTEE/2/2")?.state,
      "IN_PROGRESS",
      "no vote shown open before BALLOT_OPENED",
    );
  },
  "CF-31-V1": (res) => {
    const bo = evOf(res, "BALLOT_OPENED")[0]!;
    assert.equal(res.r.derived.ballot_open_event_id, bo.event_id);
    assert.equal(rowA(res.r, "J-RECOMMENDATION-COMMITTEE/2/2")?.state, "IN_PROGRESS");
    assert.equal(
      rowA(res.r, "J-RECOMMENDATION-COMMITTEE/2/2")?.evidence_event_id,
      bo.event_id,
      "the vote is open on the BALLOT_OPENED record",
    );
    const without = resolve23(
      res.po,
      CAT,
      res.asg,
      res.events.filter((e) => e.type !== "BALLOT_OPENED"),
    );
    assert.notEqual(
      rowA(without, "J-RECOMMENDATION-COMMITTEE/2/2")?.state,
      "IN_PROGRESS",
      "negative: MEETING_OPENED alone does not open the vote",
    );
    assert.equal(without.derived.ballot_open, false);
  },
  "CF-33": (res) => {
    assert.ok(
      res.r.ignored_events.some(
        (x) =>
          x.reason === "OBJECT_MISMATCH" &&
          res.events.find((e) => e.event_id === x.event_id)?.type === "RECOMMENDATION_ADOPTED",
      ),
      "the adoption belongs to another object",
    );
    assert.equal(res.r.derived.recommendation_adopted, false);
    const lr = JOURNEYS.get("J-LEGAL-REVIEW")!;
    for (const st of lr.stages)
      for (const s of st.steps)
        assert.ok(
          !compTypes(s).includes("RECOMMENDATION_ADOPTED"),
          `${s.id}: the legal review never completes on an adoption`,
        );
  },
  "CF-34": (res) => {
    const rr = evOf(res, "RECOMMENDATION_RETURNED")[0]!;
    const ret = res.r.actual.filter((x) => x.state === "RETURNED");
    assert.equal(ret.length, 1);
    assert.equal(
      ret[0]!.evidence_event_id,
      rr.event_id,
      "↩ on the returning step, backed by RECOMMENDATION_RETURNED",
    );
    assert.ok(
      res.r.previous_round.every((p) => p.reason === "RETURN" && p.superseded_by === rr.event_id),
      "the earlier round is kept as history, superseded by the return",
    );
    assert.equal(
      res.r.derived.recommendation_adopted,
      false,
      "an adoption followed by a return is not an adoption now",
    );
    assert.ok(
      !res.r.actual.some(
        (x) =>
          x.state === "COMPLETED" &&
          res.events.find((e) => e.event_id === x.evidence_event_id)?.type === "LEGAL_OPINION_SUBMITTED" &&
          compTypes(stepOf(x.step_id)).includes("RECOMMENDATION_ADOPTED"),
      ),
    );
  },
  "CF-34-V1": (res) => {
    assert.equal(res.r.derived.recommendation_adopted, true);
    const adoptSteps = res.r.actual.filter(
      (x) => x.state === "COMPLETED" && compTypes(stepOf(x.step_id)).includes("RECOMMENDATION_ADOPTED"),
    );
    assert.ok(adoptSteps.length >= 1);
    for (const x of adoptSteps)
      assert.equal(
        res.events.find((e) => e.event_id === x.evidence_event_id)!.type,
        "RECOMMENDATION_ADOPTED",
        `${x.step_id}: adoption only on its own record`,
      );
  },
  "CF-34-V2": (res) => {
    assert.equal(evOf(res, "RECOMMENDATION_ADOPTED").length, 0, "fixture: an opinion, no adoption");
    assert.equal(res.r.derived.recommendation_adopted, false, "the legal opinion is never an adoption");
    for (const x of res.r.actual)
      if (compTypes(STEPS.get(x.step_id)?.step || {}).includes("RECOMMENDATION_ADOPTED"))
        assert.notEqual(x.state, "COMPLETED", `${x.step_id} not completed by the opinion`);
  },
  "CF-35": (res) => {
    const adr = evOf(res, "AUTHORITY_DECISION_RECORDED")[0]!;
    assert.equal(
      completedBy(res, "J-RECOMMENDATION-COMMITTEE/5/1")?.event_id,
      adr.event_id,
      "the decision step completes on AUTHORITY_DECISION_RECORDED",
    );
    assert.deepEqual(compTypes(stepOf("J-RECOMMENDATION-COMMITTEE/5/1")), ["AUTHORITY_DECISION_RECORDED"]);
    const notice = evOf(res, "DECISION_NOTICE_ISSUED")[0]!;
    assert.ok(
      res.r.ignored_events.some((x) => x.event_id === notice.event_id && x.reason === "OBJECT_MISMATCH"),
      "the decision notice is a separate object",
    );
    assert.ok(!res.r.actual.some((x) => x.evidence_event_id === notice.event_id));
  },
  "CF-35-V1": (res) => {
    assert.equal(evOf(res, "AUTHORITY_DECISION_RECORDED").length, 0);
    assert.notEqual(
      rowA(res.r, "J-RECOMMENDATION-COMMITTEE/5/1")?.state,
      "COMPLETED",
      "no decision without its record (the object's claim is rejected)",
    );
    assert.equal(res.r.derived.decision_recorded, false);
    assert.ok(codes(res.r).includes("UNVERIFIED_STEP_CLAIM"));
  },
  "CF-36": (res) => {
    assert.equal(
      known(res.l1).substate.code,
      res.caseRecord.status!.code,
      "Level 1 is the record of the case the sanction comes from",
    );
    assert.notEqual(known(res.l1).substate.code, res.asg.master_hint);
    const foreign = res.r.ignored_events.filter((x) => x.reason === "OBJECT_MISMATCH").map((x) => x.event_id);
    assert.ok(foreign.length >= 1, "an event of the requesting case is ignored");
    const v = buildProgressView(res.l1, res.r, "RESTRICTED_CASE_AUTHORITY");
    const shown = JSON.stringify({
      level1: v.level1,
      level2: v.level2,
      level3: v.level3,
      notice: v.notice,
      deadlines: v.deadlines,
    });
    for (const id of foreign) assert.ok(!shown.includes(id as string), `nothing of ${id} reaches the view`);
    assert.equal(
      stepOf(res.asg.step_id!).completion_event_type,
      res.asg.reports_event_type,
      "the notice reports the approval request it is about (register CF-36)",
    );
  },
  "CF-37": (res) => {
    const d = res.r.deadlines.find((x) => x.kind === "GRIEVANCE_DUE")!;
    assert.equal(evOf(res, "GRIEVANCE_WINDOW_STARTED").length, 0);
    assert.deepEqual(
      [d.at, d.status, d.rule_id, d.basis_event_id],
      [null, "NO_BASIS_EVENT", "DEC-F15", null],
    );
    assert.ok(
      codes(res.r).includes("DEADLINE_CLAIM_REJECTED"),
      "a date claimed by the object without a basis event is rejected",
    );
  },
  "CF-37-V1": (res) => {
    const d = res.r.deadlines.find((x) => x.kind === "GRIEVANCE_DUE")!;
    const gw = evOf(res, "GRIEVANCE_WINDOW_STARTED")[0]!;
    assert.equal(d.basis_event_id, gw.event_id, "the basis is the recorded GRIEVANCE_WINDOW_STARTED");
    assert.equal(d.rule_id, "DEC-F15");
    assert.equal(CAT.deadline_rules["DEC-F15"]!.basis_event_type, "GRIEVANCE_WINDOW_STARTED");
    assert.equal(
      d.at,
      new Date(
        Date.parse(gw.occurred_at as string) +
          (CAT.deadline_rules["DEC-F15"]!.duration_days as number) * 86400000,
      ).toISOString(),
    );
    assert.equal(d.status, "OWNER_DEFAULT");
  },
  "EC-01": (res) => {
    for (const code of ["S3", "S4"])
      assert.notEqual(
        known(res.l1).stages.find((s) => s.code === code)!.state,
        "COMPLETED",
        `${code}: the case never entered it`,
      );
    assert.equal(res.r.lifecycle.terminated, true);
  },
  "NOCASE-01": (res) => {
    assert.equal(res.l1, null);
    assert.equal(res.view.level1, null);
    assert.notEqual(res.r.journey, null, "Levels 2 and 3 still resolve for the referral");
  },
  "WIT-01": (res) => {
    assert.equal(buildProgressView(res.l1, res.r, "WITNESS").level1, null);
  },
};

// ------------------------------------------------------------------ CF and scenario tests (one test per scenario and per variant)
const SCENARIOS = INDEX.scenarios.map((e) => ({ entry: e, sc: loadScenario(e.file) }));
for (const { entry, sc } of SCENARIOS) {
  for (const v of [null, ...(sc.variants || [])]) {
    const id = v ? v.id : sc.id;
    const title = v ? v.title.en : sc.title.en;
    test(`${id} ${title}`, () => {
      assert.equal(sc.id, entry.id);
      assert.equal(sc.journey, entry.journey);
      const res = checkScenario(sc, v);
      assert.deepEqual(res.f, [], `${id}: ${res.f.join("; ")}`);
      if (EXTRA[id]) EXTRA[id](res);
    });
  }
}

// ------------------------------------------------------------------ JR tests
test("JR-01 the catalogue keeps the 22 V12 journeys and the 112 V12 assignments; every assignment points to an existing stage and step", () => {
  assert.match(CAT.classification, /SYNTHETIC-DATA REFERENCE IMPLEMENTATION/);
  assert.equal(CAT.journeys.length, 22);
  assert.equal(CAT.assignments.length, 112);
  assert.equal(new Set(CAT.assignments.map((a) => a.id)).size, 112, "assignment ids unique");
  assert.equal(new Set(CAT.journeys.map((j) => j.id)).size, 22, "journey ids unique");
  assert.deepEqual(
    CAT.journeys.map((j) => j.id),
    V12.journeys.map((j) => j.id),
    "the 22 V12 journey ids, in order",
  );
  assert.deepEqual(
    CAT.assignments.map((a) => a.id).sort(),
    V12.assignments.map((a) => a.id).sort(),
    "the 112 V12 assignment ids",
  );
  const bad: string[] = [];
  for (const a of CAT.assignments) {
    const j = JOURNEYS.get(a.journey);
    if (!j) {
      bad.push(`${a.id}: journey ${a.journey}`);
      continue;
    }
    if (!j.stages.some((s) => s.n === a.stage)) bad.push(`${a.id}: stage ${a.stage}`);
    if (
      a.step_id !== null &&
      a.step_id !== undefined &&
      (!a.step_id.startsWith(`${a.journey}/${a.stage}/`) || !STEPS.has(a.step_id))
    )
      bad.push(`${a.id}: step ${a.step_id}`);
    if (!a.reports_event_type && !(a.reports_any_of && a.reports_any_of.length))
      bad.push(`${a.id}: reports nothing`);
  }
  assert.deepEqual(bad, []);
});

test("JR-02 the master journey: five V8 stages S1–S5 and 28 sub-states, bilingual; every sub-state is reachable from S1.01 over the V8 transitions", () => {
  assert.deepEqual(
    CAT.master.map((m) => m.code),
    ["S1", "S2", "S3", "S4", "S5"],
  );
  const subs = Object.keys(CAT.master_sub);
  assert.equal(subs.length, 28);
  for (const m of CAT.master) assert.ok(AR.test(m.ar) && LATIN.test(m.en), m.code);
  for (const [k, v] of Object.entries(CAT.master_sub)) {
    assert.ok(AR.test(v.ar) && LATIN.test(v.en), k);
    assert.ok(
      CAT.master.some((m) => k.startsWith(m.code + ".")),
      k,
    );
  }
  const knownSubs = new Set(subs);
  for (const t of CAT.master_transitions) {
    assert.ok(knownSubs.has(t.from) && knownSubs.has(t.to), `${t.id} ${t.from}→${t.to}`);
  }
  for (const code of subs) {
    const l1 = known(resolveLevel1(caseRec(code), CAT));
    assert.equal(l1.substate.code, code);
    assert.equal(l1.derivation, "DOMINATORS");
    assert.deepEqual(l1.anomalies, [], code);
  }
});

test("JR-03 every journey, stage and step is bilingual; wording is V12, REWORDED or PROPOSED-NEW and Level-2/3 wording stays PROPOSED", () => {
  const bad: string[] = [];
  for (const j of CAT.journeys) {
    for (const k of ["object", "capacity", "closure"] as const)
      if (!AR.test(j[k]?.ar || "") || !LATIN.test(j[k]?.en || "")) bad.push(`${j.id} ${k}`);
    if (!AR.test(j.ar || "") || !LATIN.test(j.en || "")) bad.push(`${j.id} name`);
    if (j.status !== "PROPOSED") bad.push(`${j.id} status ${j.status}`);
    for (const st of j.stages) {
      if (!AR.test(st.ar || "") || !LATIN.test(st.en || "")) bad.push(`${j.id}/${st.n}`);
      for (const s of st.steps) {
        if (!AR.test(s.ar || "") || !LATIN.test(s.en || "")) bad.push(s.id);
        if (!["V12", "REWORDED", "PROPOSED-NEW"].includes(s.wording as string))
          bad.push(`${s.id} wording ${s.wording}`);
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.match(JSON.stringify(CAT.wording_status), /PROPOSED/);
});

test("JR-04 schema: step and stage kinds, visibility, references, alternatives, five stages ending in the closure of the journey's own object, summary5 only on linear journeys", () => {
  const STEP_KINDS = new Set(["STEP", "OPTIONAL", "ALTERNATIVE", "PARALLEL", "CONDITIONAL"]);
  const STAGE_KINDS = new Set(["SEQUENCE", "CHOICE", "BRANCH", "PARALLEL", "CONDITION", "TERMINAL"]);
  const VIS = new Set(["internal", "scope", "public", "restricted"]);
  const caps = new Set([
    ...(CAT.capacities?.charter || []),
    ...Object.keys(CAT.capacities?.extensions_proposed || {}),
  ]);
  const bad: string[] = [];
  for (const j of CAT.journeys) {
    if (j.stages.length !== 5) bad.push(`${j.id}: ${j.stages.length} stages`);
    j.stages.forEach((st, i) => {
      if (st.n !== i + 1) bad.push(`${j.id}: stage order`);
      if (!STAGE_KINDS.has(st.kind)) bad.push(`${j.id}/${st.n} kind ${st.kind}`);
    });
    const s5 = j.stages[4]!;
    if (s5.kind !== "TERMINAL") bad.push(`${j.id}: stage 5 is ${s5.kind}`);
    if (
      /\b(case (is )?closed|close[sd]? the case|closure of the case)\b/i.test(s5.en) ||
      /(إغلاق|إقفال) (القضية|الحالة)/.test(s5.ar)
    )
      bad.push(`${j.id}: stage 5 names the case closure`);
    if (!/(clos|ended|ends)/i.test(s5.en) && !/(إقفال|إغلاق|تُغلق|يُقفل)/.test(s5.ar))
      bad.push(`${j.id}: stage 5 does not name a closure`);
    if (j.summary5 && j.structure !== "LINEAR") bad.push(`${j.id}: summary5 on a ${j.structure} journey`);
    if (caps.size && j.default_responsible_capacity && !caps.has(j.default_responsible_capacity))
      bad.push(`${j.id}: capacity ${j.default_responsible_capacity}`);
    for (const st of j.stages)
      for (const s of st.steps) {
        if (!s.id.startsWith(`${j.id}/${st.n}/`)) bad.push(`${s.id}: id prefix`);
        if (!STEP_KINDS.has(s.kind)) bad.push(`${s.id}: kind ${s.kind}`);
        if (!Array.isArray(s.visibility) || !s.visibility.length || s.visibility.some((v) => !VIS.has(v)))
          bad.push(`${s.id}: visibility`);
        for (const ref of [
          ...(s.next || []),
          ...(s.precondition_any_of || []),
          ...(s.precondition ? [s.precondition] : []),
          ...(s.returns_to ? [s.returns_to] : []),
        ])
          if (!STEPS.has(ref) || STEPS.get(ref)!.journey.id !== j.id) bad.push(`${s.id}: reference ${ref}`);
        if (s.alternative_group && s.kind !== "ALTERNATIVE")
          bad.push(`${s.id}: alternative_group on ${s.kind}`);
        if (s.kind === "ALTERNATIVE" && !s.alternative_group)
          bad.push(`${s.id}: ALTERNATIVE without a group`);
        if (s.return_on && !s.returns_to) bad.push(`${s.id}: return_on without returns_to`);
        if (compPats(s).length === 0 && !s.return_on && !s.fail_on)
          bad.push(`${s.id}: no completion, return or failure event`);
        if (s.completion_target && s.completion_target !== "SELF")
          bad.push(`${s.id}: completion_target ${s.completion_target}`);
      }
    const lc = (j.lifecycle || {}) as Record<string, unknown> & { events?: Record<string, unknown> };
    for (const k of ["returnable", "suspendable", "reopenable", "cancellable", "early_termination"])
      if (typeof lc[k] !== "boolean") bad.push(`${j.id}: lifecycle.${k}`);
    for (const k of ["reopen_to", "reopen_step"])
      if (lc.events?.[k] && !STEPS.has(lc.events[k] as string)) bad.push(`${j.id}: ${k}`);
  }
  const groups = new Map<string, string[]>();
  for (const [id, { step }] of STEPS)
    if (step.alternative_group)
      groups.set(step.alternative_group, [...(groups.get(step.alternative_group) || []), id]);
  for (const [g, ids] of groups) if (ids.length < 2) bad.push(`${g}: a group of ${ids.length}`);
  assert.deepEqual(bad, []);
});

test("JR-05 event types (lead ruling L-05): every type named by the catalogue and the scenarios is a charter type, a W-A type or one of the 58 adopted as written; the five replaced names are gone", () => {
  const et = CAT.event_types;
  assert.equal(et.charter.length, 49, "charter 3.3 minimum");
  assert.equal(et.adopted_l05.length, 58, "L-05 item 2: 58 adopted");
  assert.equal(new Set(et.adopted_l05).size, 58);
  const wa = WA; // lib/domain is on develop (PROC-001): the W-A list is always checked
  const waTypes = new Set<string>(wa.EVENT_TYPES);
  {
    assert.deepEqual(
      [...et.charter].sort(),
      [...wa.EVENT_TYPES_CHARTER_MINIMUM].sort(),
      "charter list = W-A EVENT_TYPES_CHARTER_MINIMUM",
    );
    for (const x of et.w_a_additions_used) assert.ok(waTypes.has(x), `${x} is a W-A type`);
    for (const x of [
      "GRIEVANCE_RECEIVED",
      "PROCEDURE_COMPLETED",
      "PROCEDURE_CANCELLED",
      "REFERRAL_ACCEPTED",
      "REFERRAL_RETURNED",
      "REFERRAL_REJECTED",
      "NOTIFICATION_SENT",
    ])
      assert.ok(waTypes.has(x), `replacement ${x} is a W-A type`);
    const have = et.adopted_l05.filter((x) => waTypes.has(x));
    console.warn(
      "[diagnostic]",
      `adopted types already in W-A EVENT_TYPES: ${have.length} of 58 (W-A adds them under L-05 item 2)`,
    );
  }
  for (const x of et.adopted_l05)
    assert.ok(
      !et.charter.includes(x) && !et.w_a_additions_used.includes(x),
      `${x} adopted but already a charter or W-A type`,
    );
  const allowed = new Set([...et.charter, ...waTypes, ...et.adopted_l05]);
  const used = catalogueEventTypes(CAT);
  const unknown = [...used.keys()].filter((x) => !allowed.has(x));
  for (const key of Object.keys(CAT.payload_conventions))
    if (key.endsWith("*"))
      assert.ok(
        [...allowed].some((x) => x.startsWith(key.slice(0, -1))),
        `payload convention ${key} names no known type`,
      );
  assert.deepEqual(
    unknown,
    [],
    `unknown types: ${unknown.map((x) => `${x} (${used.get(x)![0]})`).join(", ")}`,
  );
  const unused = et.adopted_l05.filter((x) => !used.has(x));
  assert.deepEqual(unused, [], "every adopted type is used by a step, an assignment or a lifecycle event");
  for (const { sc } of SCENARIOS) {
    const evs = [
      ...sc.events,
      ...(sc.variants || []).flatMap((v) => [...(v.events || []), ...(v.events_add || [])]),
    ];
    const bad = evs.filter((e) => !allowed.has(e.type)).map((e) => `${e.event_id} ${e.type}`);
    assert.deepEqual(bad, [], `${sc.id}: unknown event types`);
  }
  const catText = readFileSync(CAT_PATH, "utf8");
  for (const n of REPLACED_L05) {
    assert.ok(!catText.includes(n), `${n} still in catalogue_v13.json`);
    for (const { entry } of SCENARIOS)
      assert.ok(
        !readFileSync(join(SCEN, entry.file), "utf8").includes(n),
        `${n} still in scenario ${entry.file}`,
      );
  }
  const md = readFileSync(join(EVIDENCE, "new_event_types.md"), "utf8");
  const sec3 = md.split(/^## /m).find((s) => s.startsWith("3."));
  assert.ok(sec3, "work/new_event_types.md section 3");
  const mdTypes = [...sec3.matchAll(/^\| \d+ \| `([A-Z_]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(
    [...mdTypes].sort(),
    [...et.adopted_l05].sort(),
    "work/new_event_types.md section 3 lists exactly the adopted types",
  );
  const sec1 = md.split(/^## /m).find((s) => s.startsWith("1."))!;
  for (const n of REPLACED_L05)
    assert.ok(sec1.includes("`" + n + "`"), `the replacement of ${n} is documented`);
  for (const x of et.formal_notices.types)
    assert.ok(
      allowed.has(x) && x !== "NOTIFICATION_SENT",
      `formal notice ${x} is a domain event (L-05 item 3)`,
    );
});

test("JR-06 Level 1 comes from CaseRecord.status.code only: no case → none; unknown code fails closed; missing source is unverified; flags never invent a stage", () => {
  assert.equal(
    resolveLevel1.length,
    2,
    "resolveLevel1(caseRecord, catalogue): no events, no assignment, no master_hint",
  );
  assert.equal(resolveLevel1(null, CAT), null);
  assert.equal(resolveLevel1({ ...caseRec("S2.01"), exists: false }, CAT), null);
  assert.equal(resolveLevel1({ case_id: CASE_ID }, CAT), null, "exists must be true");
  const u = resolveLevel1(caseRec("S9.99"), CAT)!;
  assert.equal(u.stage, null);
  assert.equal(u.current_state, null);
  assert.ok(u.stages.every((s) => s.state === "UNVERIFIED"));
  assert.deepEqual(codes(u), ["UNKNOWN_STATUS_CODE"]);
  const m = resolveLevel1(caseRec("S2.01", { status: { code: "S2.01" } }), CAT)!;
  assert.equal(m.epistemic, "UNVERIFIED_INFORMATION");
  assert.ok(codes(m).includes("STATUS_SOURCE_MISSING"));
  const c = resolveLevel1(caseRec("S3.02", { flags: { closed: true } }), CAT)!;
  assert.ok(codes(c).includes("CLOSED_OUTSIDE_S5"));
  assert.notEqual(c.current_state, "COMPLETED", "a closed flag outside S5 never completes the stage");
  const x = resolveLevel1(caseRec("S3.02", { flags: { cancelled: true } }), CAT)!;
  assert.equal(x.current_state, "CANCELLED");
  assert.ok(
    x.stages
      .filter((s) => s.code > "S3")
      .every((s) => s.layer === "A" && s.state === "NOT_APPLICABLE" && s.note === "CANCELLED"),
    "nothing is expected after a cancellation",
  );
  assert.equal(
    resolveLevel1(caseRec("S3.02", { flags: { suspended: true } }), CAT)!.current_state,
    "SUSPENDED",
  );
  assert.equal(
    resolveLevel1(caseRec("S3.02", { flags: { returned: true } }), CAT)!.current_state,
    "RETURNED",
  );
  assert.equal(resolveLevel1(caseRec("S5.04", { flags: { closed: true } }), CAT)!.current_state, "COMPLETED");
  // the same record gives the same Level 1 whatever notification is rendered (master_hint is documentation only)
  const a = resolveLevel1(caseRec("S3.03"), CAT);
  for (const id of ["CF-17", "CF-36", "WB-01"]) {
    assert.deepEqual(resolveLevel1(caseRec("S3.03"), CAT), a, id);
  }
  const hinted = CAT.assignments.filter((g) => g.master_hint && g.master_hint !== "S3.03");
  assert.ok(hinted.length > 0);
});

test("JR-07 Level-1 history: recorded positions give HISTORY (unvisited stages not applicable); without history only dominators are ✔; invalid entries are ignored", () => {
  const h = known(
    resolveLevel1(
      caseRec("S5.05", {
        history: [
          { code: "S1.01", recorded_at: "2026-09-01T00:00:00Z" },
          { code: "S2.02", recorded_at: "2026-09-02T00:00:00Z" },
          { code: "S5.05", recorded_at: "2026-09-03T00:00:00Z" },
          { code: "S7.77", recorded_at: "2026-09-04T00:00:00Z" },
        ],
      }),
      CAT,
    ),
  );
  assert.equal(h.derivation, "HISTORY");
  assert.deepEqual(
    h.stages.map((s) => `${s.code}:${s.state}${s.note ? "/" + s.note : ""}`),
    [
      "S1:COMPLETED",
      "S2:COMPLETED",
      "S3:NOT_APPLICABLE/NOT_VISITED",
      "S4:NOT_APPLICABLE/NOT_VISITED",
      "S5:IN_PROGRESS",
    ],
  );
  assert.ok(codes(h).includes("HISTORY_ENTRY_IGNORED"));
  const d = known(resolveLevel1(caseRec("S5.05"), CAT));
  assert.equal(d.derivation, "DOMINATORS");
  for (const code of ["S3", "S4"]) {
    const s = d.stages.find((x) => x.code === code)!;
    assert.equal(s.state, "UNVERIFIED", `${code}: not on every path to S5.05`);
  }
  for (const code of ["S1", "S2"]) {
    const s = d.stages.find((x) => x.code === code)!;
    assert.deepEqual(
      [s.state, s.note, s.epistemic],
      ["COMPLETED", "ON_EVERY_PATH", "DERIVED_FROM_VERIFIED_FACTS"],
    );
  }
  const r = known(
    resolveLevel1(
      caseRec("S3.01", {
        flags: { reopened: true },
        history: [
          { code: "S1.01", recorded_at: "2026-09-01T00:00:00Z" },
          { code: "S5.04", recorded_at: "2026-09-02T00:00:00Z" },
          { code: "S3.01", recorded_at: "2026-09-03T00:00:00Z" },
        ],
      }),
      CAT,
    ),
  );
  const s5 = r.stages.find((x) => x.code === "S5")!;
  assert.deepEqual(
    [s5.layer, s5.kind, s5.previously_visited],
    ["B", "EXPECTED", true],
    "a stage visited before reopening is expected again, not completed",
  );
  assert.equal(r.stages.find((x) => x.code === "S3")!.reopened, true);
});

test("JR-08 alternatives: selecting one direction never completes the others; two selections raise MULTIPLE_ALTERNATIVES_SELECTED; with none selected the choice itself is the pending action", () => {
  const grp = [...STEPS.values()]
    .filter((x) => x.step.alternative_group === "J-CHAIR-DIRECTION/G-DIRECTION")
    .map((x) => x.step);
  assert.equal(grp.length, 5);
  const base: EvSpec[] = [["MATTER_PRESENTED_TO_CHAIR", { purpose: "DIRECTION" }]];
  for (const s of grp) {
    const p = compPats(s)[0]!;
    const r = run("J-CHAIR-DIRECTION", events([...base, [p.type, satisfy(p.payload)]]));
    assert.equal(stateOf(r, s.id), "COMPLETED", s.id);
    for (const o of grp.filter((x) => x.id !== s.id))
      assert.equal(stateOf(r, o.id), "B:ALTERNATIVE/NOT_SELECTED", `${o.id} after ${s.id}`);
    const g = r.alternative_groups.find((x) => x.group_id === "J-CHAIR-DIRECTION/G-DIRECTION")!;
    assert.deepEqual([g.selected, g.selected_count], [s.id, 1]);
  }
  const two = run(
    "J-CHAIR-DIRECTION",
    events([
      ...base,
      ...grp.slice(0, 2).map((s): EvSpec => [compPats(s)[0]!.type, satisfy(compPats(s)[0]!.payload)]),
    ]),
  );
  assert.ok(codes(two).includes("MULTIPLE_ALTERNATIVES_SELECTED"));
  const none = run("J-CHAIR-DIRECTION", events(base));
  assert.ok(
    none.actual.some((x) => x.stage_level && x.step_id === "J-CHAIR-DIRECTION/2" && x.state === "PENDING"),
  );
  for (const s of grp) {
    assert.equal(rowA(none, s.id), null);
    assert.equal(rowB(none, s.id)!.kind, "ALTERNATIVE");
  }
  for (const id of ["J-CHAIR-DIRECTION/3/1", "J-CHAIR-DIRECTION/3/2", "J-CHAIR-DIRECTION/3/3"])
    assert.equal(stateOf(none, id), "B:ALTERNATIVE/BRANCH_NOT_DECIDED");
});

test("JR-09 evidence (negative cases): unbacked claims, trigger-only events, other objects, other cases, superseded versions, duplicates and malformed events never complete a step", () => {
  const J = "J-DECISION-SUBJECT";
  // claim without evidence, and claim with evidence of the wrong type
  const ev1 = events([
    ["DECISION_NOTICE_ISSUED"],
    [
      "NOTIFICATION_SENT",
      { purpose: "OTHER", subject_object_id: OBJ },
      { object: { type: "NOTIFICATION", id: OTHER } },
    ],
  ]);
  const claims = run(J, ev1, {
    extra: {
      steps: [
        { step_id: `${J}/1/1`, actual: "COMPLETED", evidence_event_id: "evt-none" },
        { step_id: `${J}/2/1`, actual: "COMPLETED", evidence_event_id: ev1[1]!.event_id },
        { step_id: "J-NOWHERE/1/1", actual: "COMPLETED" },
      ],
    },
  });
  assert.equal(stateOf(claims, `${J}/1/1`), "IN_PROGRESS", "trigger only: in progress, never completed");
  assert.notEqual(rowA(claims, `${J}/2/1`)?.state, "COMPLETED");
  assert.equal(codes(claims).filter((c) => c === "UNVERIFIED_STEP_CLAIM").length, 2);
  assert.ok(codes(claims).includes("UNKNOWN_STEP_CLAIM"));
  assert.equal(
    stateOf(run(J, events([["DECISION_NOTICE_ISSUED"], ["DECISION_NOTICE_DELIVERED"]])), `${J}/1/1`),
    "COMPLETED",
  );
  // other object, other case
  const ev2 = events([
    ["DECISION_NOTICE_DELIVERED", {}, { object: { type: "PROCEDURE", id: OTHER } }],
    ["GRIEVANCE_WINDOW_STARTED", {}, { case_id: OTHER_CASE }],
  ]);
  const r2 = run(J, ev2);
  assert.deepEqual(
    r2.ignored_events.map((x) => x.reason),
    ["OBJECT_MISMATCH", "CASE_MISMATCH"],
  );
  assert.ok(!r2.actual.some((x) => x.state === "COMPLETED"));
  // superseded version: version 2 replaces version 1 of the same event id; same version twice is a duplicate
  const v1 = events([
    ["REFERRAL_CREATED"],
    ["REFERRAL_SUBMITTED"],
    ["REFERRAL_HEAD_DECIDED", { decision: "APPROVED" }, { id: "evt-JR-head" }],
  ]);
  const v2 = {
    ...clone(v1[2]!),
    version: 2,
    payload: { decision: "RETURNED" },
    recorded_at: "2026-10-01T09:00:00.000Z",
  };
  const r3 = run("J-DR-PREPARER", [...v1, v2]);
  assert.equal(stateOf(r3, "J-DR-PREPARER/2/2"), "RETURNED", "the later version of the record counts");
  assert.ok(r3.ignored_events.some((x) => x.event_id === "evt-JR-head" && x.reason === "SUPERSEDED_VERSION"));
  const r4 = run("J-DR-PREPARER", [...v1, clone(v1[2]!)]);
  assert.ok(codes(r4).includes("DUPLICATE_EVENT_ID"));
  const r5 = run(J, [null, { event_id: "evt-JR-x" }, ...events([["DECISION_NOTICE_ISSUED"]])]);
  assert.deepEqual(
    r5.ignored_events.map((x) => x.reason),
    ["MALFORMED", "MALFORMED"],
  );
  // a not-applicable claim needs its own evidence too
  const r6 = run(J, events([["DECISION_NOTICE_ISSUED"]]), {
    extra: { steps: [{ step_id: `${J}/1/2`, actual: "NOT_APPLICABLE" }] },
  });
  assert.ok(codes(r6).includes("UNVERIFIED_STEP_CLAIM"));
  assert.notEqual(rowA(r6, `${J}/1/2`)?.note, "OBJECT_RECORD");
});

test("JR-10 referral decisions (L-05): REFERRAL_ACCEPTED, REFERRAL_RETURNED or REFERRAL_REJECTED complete the decision steps by round; a return shows ↩; the objection-round rejection terminates; CF-08 reports either outcome", () => {
  const J = "J-DR-PREPARER";
  const pre: EvSpec[] = [
    ["REFERRAL_CREATED"],
    ["REFERRAL_SUBMITTED"],
    ["REFERRAL_HEAD_DECIDED", { decision: "APPROVED" }],
    ["REFERRAL_RECEIVED"],
    ["REFERRAL_ACKNOWLEDGED"],
  ];
  const acc = run(J, events([...pre, ["REFERRAL_ACCEPTED", { round: "FIRST" }]]));
  for (const id of [`${J}/3/2`, `${J}/4/1`]) {
    assert.equal(stateOf(acc, id), "COMPLETED");
    assert.equal(rowA(acc, id)!.completion_event_type, "REFERRAL_ACCEPTED");
  }
  for (const id of [`${J}/4/2`, `${J}/4/4`])
    assert.equal(stateOf(acc, id), "NOT_APPLICABLE/CONDITION_NOT_MET");
  const rej = run(J, events([...pre, ["REFERRAL_REJECTED", { round: "FIRST" }]]));
  assert.equal(rowA(rej, `${J}/4/1`)!.completion_event_type, "REFERRAL_REJECTED");
  for (const id of [`${J}/4/2`, `${J}/4/4`])
    assert.equal(rowB(rej, id)?.kind, "ALTERNATIVE", `${id}: objection or resubmission, one of them`);
  assert.notEqual(rowA(rej, `${J}/5/1`)?.state, "COMPLETED");
  const ret = run(J, events([...pre, ["REFERRAL_RETURNED", { round: "FIRST" }]]));
  assert.equal(stateOf(ret, `${J}/4/1`), "RETURNED");
  assert.equal(ret.lifecycle.returned, true);
  assert.ok(ret.previous_round.some((p) => p.step_id === `${J}/1/2` && p.reason === "RETURN"));
  const obj = events([
    ...pre,
    ["REFERRAL_REJECTED", { round: "FIRST" }],
    ["REFERRAL_OBJECTED"],
    ["REFERRAL_REJECTED", { round: "OBJECTION" }],
  ]);
  const term = run(J, obj);
  assert.equal(term.lifecycle.terminated, true);
  assert.equal(stateOf(term, `${J}/4/3`), "COMPLETED");
  assert.equal(
    rowA(term, `${J}/4/1`)!.evidence_event_id,
    obj[5]!.event_id,
    "the objection-round decision never re-completes the first-round step",
  );
  assert.ok(
    ["NOT_APPLICABLE/TERMINATED", "NOT_APPLICABLE/CONDITION_NOT_MET"].includes(
      stateOf(term, `${J}/5/1`) as string,
    ),
  );
  const okEsc = run(
    J,
    events([
      ...pre,
      ["REFERRAL_REJECTED", { round: "FIRST" }],
      ["REFERRAL_OBJECTED"],
      ["REFERRAL_ACCEPTED", { round: "OBJECTION" }],
    ]),
  );
  assert.equal(rowA(okEsc, `${J}/4/3`)!.completion_event_type, "REFERRAL_ACCEPTED");
  assert.equal(okEsc.lifecycle.terminated, false);
  // J-DR-SECRETARY 3/2: any decision starts the notification step; only a recorded sending completes it
  const S = "J-DR-SECRETARY";
  const spre: EvSpec[] = [
    ["REFERRAL_SUBMITTED"],
    ["REFERRAL_HEAD_DECIDED", { decision: "APPROVED" }],
    ["REFERRAL_RECEIVED"],
    ["INTAKE_CHECK_RECORDED", { check: "BASIS" }],
    ["INTAKE_CHECK_RECORDED", { check: "ATTACHMENTS" }],
  ];
  for (const d of ["REFERRAL_ACCEPTED", "REFERRAL_RETURNED", "REFERRAL_REJECTED"])
    assert.equal(stateOf(run(S, events([...spre, [d, { round: "FIRST" }]])), `${S}/3/2`), "IN_PROGRESS", d);
  const sent = run(
    S,
    events([
      ...spre,
      ["REFERRAL_ACCEPTED", { round: "FIRST" }],
      [
        "NOTIFICATION_SENT",
        { template_code: "CF-05", subject_object_id: OBJ },
        { object: { type: "NOTIFICATION", id: OTHER } },
      ],
    ]),
  );
  assert.equal(stateOf(sent, `${S}/3/2`), "COMPLETED");
  // CF-08 reports REFERRAL_ACCEPTED or REFERRAL_REJECTED of the objection round
  const a8 = ASG.get("CF-08")!;
  assert.deepEqual(
    a8.reports_any_of!.map((p) => `${p.type}/${p.payload!.round}`),
    ["REFERRAL_ACCEPTED/OBJECTION", "REFERRAL_REJECTED/OBJECTION"],
  );
  assert.ok(!codes(run(J, obj, { asg: a8 })).includes("REPORTED_EVENT_NOT_FOUND"));
  assert.ok(
    codes(run(J, events([...pre, ["REFERRAL_REJECTED", { round: "FIRST" }]]), { asg: a8 })).includes(
      "REPORTED_EVENT_NOT_FOUND",
    ),
    "a first-round rejection is not the escalation decision",
  );
});

test("JR-11 closure and grievance (L-05): PROCEDURE_COMPLETED closes a step with completion_target SELF only when it names the object itself; the grievance conclusion is PROCEDURE_COMPLETED with proceeding_type GRIEVANCE", () => {
  const selfSteps = [...STEPS.values()]
    .filter((x) => x.step.completion_target === "SELF")
    .map((x) => x.step.id);
  assert.equal(selfSteps.length, 11);
  for (const [id, { step }] of STEPS)
    if (compTypes(step).includes("PROCEDURE_COMPLETED"))
      assert.ok(
        step.completion_target === "SELF" ||
          compPats(step).every((p) => p.type !== "PROCEDURE_COMPLETED" || p.payload?.proceeding_type),
        `${id}: PROCEDURE_COMPLETED needs SELF or a proceeding_type`,
      );
  const J = "J-DECISION-SUBJECT";
  const pre: EvSpec[] = [
    ["DECISION_NOTICE_ISSUED"],
    ["DECISION_NOTICE_DELIVERED"],
    ["GRIEVANCE_WINDOW_STARTED"],
    ["GRIEVANCE_WINDOW_ENDED"],
  ];
  const closeOther = run(J, events([...pre, ["PROCEDURE_COMPLETED", { target: OTHER, reason: "DONE" }]]));
  assert.notEqual(
    rowA(closeOther, `${J}/5/1`)?.state,
    "COMPLETED",
    "closing another object never closes this one",
  );
  for (const [label, p, o] of [
    ["payload.target", { target: OBJ, reason: "DONE" }, {}],
    ["event.object", { reason: "DONE" }, {}],
    [
      "payload.target from another object",
      { target: { type: "PROCEDURE", id: OBJ } },
      { object: { type: "PROCEEDING", id: OTHER } },
    ],
  ] as [string, Record<string, unknown>, EvOpts][]) {
    const r = run(J, events([...pre, ["PROCEDURE_COMPLETED", p, o]]));
    assert.equal(stateOf(r, `${J}/5/1`), "COMPLETED", label);
    assert.equal(r.lifecycle.closed, true, label);
  }
  const grvEv = (payload: Record<string, unknown>): EvSpec => [
    "PROCEDURE_COMPLETED",
    { target: GRV, ...payload },
    { object: { type: "PROCEEDING", id: GRV } },
  ];
  const pre2: EvSpec[] = [
    ["DECISION_NOTICE_ISSUED"],
    ["DECISION_NOTICE_DELIVERED"],
    ["GRIEVANCE_WINDOW_STARTED"],
    ["GRIEVANCE_RECEIVED"],
  ];
  const g = run(J, events([...pre2, grvEv({ proceeding_type: "GRIEVANCE", outcomes: ["UPHELD"] })]), {
    extra: { related_objects: [{ type: "PROCEEDING", id: GRV }] },
  });
  for (const id of [`${J}/3/1`, `${J}/3/2`])
    assert.equal(rowA(g, id)?.completion_event_type, "GRIEVANCE_RECEIVED", id);
  for (const id of [`${J}/4/1`, `${J}/4/2`]) assert.equal(stateOf(g, id), "COMPLETED", id);
  assert.notEqual(
    rowA(g, `${J}/5/1`)?.state,
    "COMPLETED",
    "the grievance conclusion does not close the notification procedure",
  );
  const noType = run(J, events([...pre2, grvEv({ outcomes: ["UPHELD"] })]), {
    extra: { related_objects: [{ type: "PROCEEDING", id: GRV }] },
  });
  assert.equal(
    stateOf(noType, `${J}/4/1`),
    "IN_PROGRESS",
    "without proceeding_type GRIEVANCE it is not the grievance conclusion",
  );
  assert.notEqual(rowA(noType, `${J}/4/2`)?.state, "COMPLETED");
  const unrelated = run(J, events([...pre2, grvEv({ proceeding_type: "GRIEVANCE" })]));
  assert.notEqual(
    rowA(unrelated, `${J}/4/2`)?.state,
    "COMPLETED",
    "a grievance proceeding outside related_objects is out of scope",
  );
});

test("JR-12 reminders (L-05, FD-06/FD-12): NOTIFICATION_SENT completes only a reminder or notified step, never a procedural step, status, return, deadline or lifecycle; reminder notices complete nothing", () => {
  const bad: string[] = [];
  for (const [id, { step, stage, journey }] of STEPS) {
    const cp = compPats(step);
    if (cp.some((p) => p.type === "NOTIFICATION_SENT")) {
      if (!cp.every((p) => p.type === "NOTIFICATION_SENT"))
        bad.push(`${id}: mixes NOTIFICATION_SENT with procedural events`);
      if (!cp.every((p) => p.payload && (p.payload.purpose || p.payload.template_code)))
        bad.push(`${id}: NOTIFICATION_SENT without purpose or template_code`);
      if (step.terminal && step.terminal !== "CLOSED") bad.push(`${id}: terminal ${step.terminal}`);
    }
    for (const [k, p] of [
      ["return_on", step.return_on],
      ["fail_on", step.fail_on],
    ] as const)
      if (p && p.type === "NOTIFICATION_SENT") bad.push(`${id}: ${k}`);
    for (const rule of [step.applies_if, stage.applies_if])
      if (
        rule &&
        [...(rule.match || []), ...(rule.excluded_by || [])].some((p) => p.type === "NOTIFICATION_SENT")
      )
        bad.push(`${id}: applies_if`);
    for (const [k, list] of Object.entries(journey.lifecycle?.events || {}))
      if (Array.isArray(list) && (list as EventPattern[]).some((p) => p.type === "NOTIFICATION_SENT"))
        bad.push(`${journey.id}: lifecycle ${k}`);
  }
  for (const [rid, r] of Object.entries(CAT.deadline_rules))
    if (r.basis_event_type === "NOTIFICATION_SENT") bad.push(`deadline ${rid}`);
  for (const a of CAT.assignments)
    if (
      a.reports_event_type === "NOTIFICATION_SENT" ||
      (a.reports_any_of || []).some((p) => p.type === "NOTIFICATION_SENT")
    )
      bad.push(`${a.id}: a notice reports its own sending`);
  assert.deepEqual([...new Set(bad)], []);
  for (const id of ["COM-05", "COM-14", "COM-19", "INV-11", "CF-23b", "CF-28"])
    assert.equal(ASG.get(id)!.completes, false, `${id}: a reminder notice completes nothing`);
  const J = "J-DEFENCE";
  const pre: EvSpec[] = [
    ["RIGHTS_NOTICE_ISSUED"],
    ["DEFENCE_NOTICE_ISSUED"],
    ["DEFENCE_PERIOD_STARTED", { due_at: "2026-11-05T13:00:00Z" }],
    ["DEFENCE_PACKET_RELEASED"],
  ];
  const rem = (payload: Record<string, unknown>): EvSpec => [
    "NOTIFICATION_SENT",
    { subject_object_id: OBJ, ...payload },
    { object: { type: "NOTIFICATION", id: OTHER } },
  ];
  for (const p of [{ purpose: "DEFENCE_DUE_REMINDER" }, { template_code: "DEFENCE_DUE_REMINDER" }]) {
    const evs = events([...pre, rem(p)]);
    const r = run(J, evs, {
      extra: { steps: [{ step_id: `${J}/4/2`, actual: "COMPLETED", evidence_event_id: evs[4]!.event_id }] },
    });
    assert.equal(stateOf(r, `${J}/4/1`), "COMPLETED", JSON.stringify(p));
    assert.notEqual(rowA(r, `${J}/4/2`)?.state, "COMPLETED", "the reminder never completes the defence");
    assert.ok(
      codes(r).includes("UNVERIFIED_STEP_CLAIM"),
      "a claim that the reminder completed the defence is rejected",
    );
  }
  const other = run(J, events([...pre, rem({ purpose: "OTHER" })]));
  assert.equal(rowA(other, `${J}/4/1`), null, "another notification is not the due reminder");
});

test("JR-13 W-A payload names: CASE_STATUS_RECORDED.transition_id (legacy transition read as an alias, to/from derived) and LEGAL_OPINION_SUBMITTED.opinion (legacy position read as an alias)", () => {
  const caseEv = (payload: Record<string, unknown>): EvSpec => [
    "CASE_STATUS_RECORDED",
    payload,
    { object: { type: "CASE", id: CASE_ID } },
  ];
  const J = "J-WB-REPORTER";
  const pre: EvSpec[] = [["REPORT_RECEIVED"], ["REPORT_ACKNOWLEDGED"]];
  for (const p of [{ transition_id: "T01" }, { transition: "T01" }])
    assert.equal(stateOf(run(J, events([...pre, caseEv(p)])), `${J}/2/1`), "COMPLETED", JSON.stringify(p));
  assert.notEqual(
    stateOf(run(J, events([...pre, caseEv({ transition_id: "T02" })])), `${J}/2/1`),
    "COMPLETED",
  );
  const t = CAT.master_transitions.find((x) => x.to === "S5.05");
  assert.ok(t, "a V8 transition into S5.05");
  for (const p of [{ transition_id: t.id }, { transition: t.id }]) {
    const r = run(J, events([...pre, caseEv(p)]));
    assert.equal(
      stateOf(r, `${J}/5/2`),
      "COMPLETED",
      `${JSON.stringify(p)}: the to sub-state of ${t.id} is derived from the V8 transition`,
    );
    assert.equal(stateOf(r, `${J}/5/1`), "IN_PROGRESS", "the outcome communication is started, not done");
  }
  assert.notEqual(
    stateOf(run(J, events([...pre, caseEv({ transition_id: "T99" })])), `${J}/5/2`),
    "COMPLETED",
    "an unknown transition derives nothing",
  );
  const sc = clone(loadScenario("CF-34.json"));
  const v1 = sc.variants!.find((v) => v.id === "CF-34-V1")!;
  const asg = ASG.get(sc.assignment_id);
  const po = { ...clone(sc.procedural_object), ...clone(v1.procedural_object_patch || {}) };
  const modern = resolve23(po, CAT, asg, clone(v1.events!));
  const legacyEvents = clone(v1.events!).map((e) =>
    e.type === "LEGAL_OPINION_SUBMITTED"
      ? { ...e, payload: { target: e.payload!.target, position: e.payload!.opinion } }
      : e,
  );
  const legacy = resolve23(po, CAT, asg, legacyEvents);
  assert.equal(stateOf(modern, "J-RECOMMENDATION-COMMITTEE/3/3"), "NOT_APPLICABLE/CONDITION_NOT_MET");
  assert.deepEqual(
    legacy.actual.map((x) => [x.step_id, x.state, x.note ?? null]),
    modern.actual.map((x) => [x.step_id, x.state, x.note ?? null]),
  );
});

test("JR-14 returns and reopenings: the earlier round moves to previous_round (superseded_by, reason), the returning step shows ↩, nothing of the earlier round reads as current", () => {
  const J = "J-DR-PREPARER";
  const ev = events([
    ["REFERRAL_CREATED"],
    ["REFERRAL_SUBMITTED"],
    ["REFERRAL_HEAD_DECIDED", { decision: "RETURNED" }],
  ]);
  const r = run(J, ev);
  assert.equal(stateOf(r, `${J}/2/2`), "RETURNED");
  assert.deepEqual(
    r.previous_round.map((p) => [p.step_id, p.reason, p.superseded_by]),
    [
      [`${J}/1/2`, "RETURN", ev[2]!.event_id],
      [`${J}/2/1`, "RETURN", ev[2]!.event_id],
    ],
  );
  assert.equal(stateOf(r, `${J}/1/2`), "PENDING", "resubmission awaits action");
  const again = run(
    J,
    events([
      ["REFERRAL_CREATED"],
      ["REFERRAL_SUBMITTED"],
      ["REFERRAL_HEAD_DECIDED", { decision: "RETURNED" }],
      ["REFERRAL_SUBMITTED"],
      ["REFERRAL_HEAD_DECIDED", { decision: "APPROVED" }],
    ]),
  );
  assert.equal(stateOf(again, `${J}/2/2`), "COMPLETED", "a later completion clears the return");
  const pre: EvSpec[] = [
    ["REFERRAL_CREATED"],
    ["REFERRAL_SUBMITTED"],
    ["REFERRAL_HEAD_DECIDED", { decision: "APPROVED" }],
    ["REFERRAL_RECEIVED"],
    ["REFERRAL_ACKNOWLEDGED"],
    ["REFERRAL_REJECTED", { round: "FIRST" }],
  ];
  const ro = events([...pre, ["REFERRAL_SUBMITTED", { resubmission: true }]]);
  const re = run(J, ro);
  assert.equal(re.lifecycle.reopened, true);
  assert.equal(stateOf(re, `${J}/4/4`), "COMPLETED", "the resubmission is the selected response");
  assert.ok(
    re.previous_round.some(
      (p) => p.step_id === `${J}/4/1` && p.reason === "REOPEN" && p.superseded_by === ro[6]!.event_id,
    ),
  );
  assert.notEqual(
    rowA(re, `${J}/4/1`)?.state,
    "COMPLETED",
    "the first-round decision is history, not the current state",
  );
  assert.ok(!codes(re).includes("LIFECYCLE_NOT_DECLARED"));
});

test("JR-15 lifecycle facts win over declared flags, and an undeclared fact is reported (LIFECYCLE_NOT_DECLARED); cancellation and suspension never leave a step in progress", () => {
  const J = "J-DECISION-SUBJECT";
  const s = run(J, events([["DECISION_NOTICE_ISSUED"], ["PROCEDURE_SUSPENDED"]]));
  assert.equal(s.lifecycle.suspended, true);
  assert.ok(s.anomalies.some((a) => a.code === "LIFECYCLE_NOT_DECLARED" && /suspended/.test(a.detail!)));
  assert.equal(stateOf(s, `${J}/1/1`), "SUSPENDED");
  const resumed = run(
    J,
    events([["DECISION_NOTICE_ISSUED"], ["PROCEDURE_SUSPENDED"], ["PROCEDURE_RESUMED"]]),
  );
  assert.equal(resumed.lifecycle.suspended, false);
  assert.equal(stateOf(resumed, `${J}/1/1`), "IN_PROGRESS");
  const ev = events([["RIGHTS_NOTICE_ISSUED"], ["DEFENCE_NOTICE_ISSUED"]]);
  const c = run("J-DEFENCE", ev, { extra: { status: "CANCELLED", status_source_event_id: ev[1]!.event_id } });
  assert.equal(c.lifecycle.cancelled, true);
  assert.ok(c.anomalies.some((a) => a.code === "LIFECYCLE_NOT_DECLARED" && /cancelled/.test(a.detail!)));
  assert.ok(!c.actual.some((x) => ["IN_PROGRESS", "PENDING"].includes(x.state)));
  assert.equal(c.expected.length, 0);
  assert.equal(
    c.actual.filter((x) => x.state === "CANCELLED").length,
    1,
    "one ✕ where the procedure stopped",
  );
  const na = run("J-DEFENCE", ev, {
    extra: { status: "IN_PROGRESS", status_source_event_id: "evt-not-in-input" },
  });
  assert.ok(
    codes(na).includes("STATUS_SOURCE_EVENT_NOT_FOUND"),
    "an object status without its source event is not used",
  );
});

test("JR-16 deadlines: a date only from a recorded basis event and a catalogue rule; otherwise at is null with the reason; claimed dates the record cannot establish are rejected", () => {
  const J = "J-DECISION-SUBJECT";
  const none = run(J, events([["DECISION_NOTICE_ISSUED"]]), {
    extra: {
      deadlines: [
        { kind: "GRIEVANCE_DUE", at: "2026-11-15T00:00:00Z", basis_rule: "DEC-F15" },
        { kind: "NOT_A_DEADLINE", at: null },
      ],
    },
  });
  assert.deepEqual(
    none.deadlines.map((d) => [d.kind, d.at, d.status]),
    [["GRIEVANCE_DUE", null, "NO_BASIS_EVENT"]],
  );
  assert.equal(codes(none).filter((x) => x === "DEADLINE_CLAIM_REJECTED").length, 2);
  const ev = events([
    ["DECISION_NOTICE_ISSUED"],
    ["DECISION_NOTICE_DELIVERED"],
    ["GRIEVANCE_WINDOW_STARTED", {}, { at: "2026-10-02T09:00:00Z" }],
  ]);
  const ok = run(J, ev, {
    extra: { deadlines: [{ kind: "GRIEVANCE_DUE", at: "2026-11-01T09:00:00Z", basis_rule: "DEC-F15" }] },
  });
  assert.deepEqual(
    ok.deadlines.map((d) => [d.at, d.status, d.basis_event_id, d.rule_id, d.epistemic]),
    [
      [
        "2026-11-01T09:00:00.000Z",
        "OWNER_DEFAULT",
        ev[2]!.event_id,
        "DEC-F15",
        "DERIVED_FROM_VERIFIED_FACTS",
      ],
    ],
  );
  assert.ok(
    !codes(ok).includes("DEADLINE_CLAIM_REJECTED"),
    "a claimed date equal to the resolved one is accepted",
  );
  const noRule = clone(CAT);
  delete noRule.deadline_rules["DEC-F15"];
  const nr = run(J, ev, { cat: noRule });
  assert.deepEqual(
    nr.deadlines.map((d) => [d.at, d.status, d.reason]),
    [[null, "SOURCE_REQUIRED", "RULE_NOT_IN_CATALOGUE"]],
  );
  const D = "J-DEFENCE";
  const rec = run(
    D,
    events([
      ["RIGHTS_NOTICE_ISSUED"],
      ["DEFENCE_NOTICE_ISSUED"],
      ["DEFENCE_PERIOD_STARTED", { due_at: "2026-11-05T13:00:00Z" }],
    ]),
  );
  assert.deepEqual(
    rec.deadlines.map((d) => [d.at, d.status, d.epistemic]),
    [["2026-11-05T13:00:00.000Z", "RECORDED", "RECORDED_FACT"]],
  );
  const nodue = run(
    D,
    events([["RIGHTS_NOTICE_ISSUED"], ["DEFENCE_NOTICE_ISSUED"], ["DEFENCE_PERIOD_STARTED"]]),
  );
  assert.deepEqual(
    nodue.deadlines.map((d) => [d.at, d.status]),
    [[null, "SOURCE_REQUIRED"]],
    "no fixed defence period is invented (DEC-F18)",
  );
  for (const j of CAT.journeys)
    for (const d of j.deadlines || []) assert.ok(CAT.deadline_rules[d.rule_id], `${j.id}: rule ${d.rule_id}`);
  for (const [id, r] of Object.entries(CAT.deadline_rules)) {
    assert.ok(r.basis_event_type && r.source && r.label?.ar && r.label?.en, id);
    if (r.computable)
      assert.ok(Number.isInteger(r.duration_days), `${id}: computable rules need an integer duration`);
  }
});

test("JR-17 lead traceability (V12 → V13): no silent rename, wording change, stage loss or assignment move; V12 wording kept where marked V12", () => {
  const v12j = new Map(V12.journeys.map((j) => [j.id, j] as const));
  const bad: string[] = [];
  for (const j of CAT.journeys) {
    const o = v12j.get(j.renamed_from || j.id);
    if (!o) {
      bad.push(`${j.id}: no V12 journey`);
      continue;
    }
    const same =
      j.object.ar === o.object_ar &&
      j.object.en === o.object_en &&
      j.capacity.ar === o.capacity_ar &&
      j.capacity.en === o.capacity_en;
    if (!same && !(j.wording_change && String(j.wording_change.reason || "").trim() && j.wording_change.from))
      bad.push(`${j.id}: object/capacity wording changed without wording_change`);
    const carried = new Set<number>();
    for (const st of j.stages)
      for (const n of ([] as (number | null | undefined)[]).concat(st.v12_stage ?? []))
        if (n !== null && n !== undefined) carried.add(Number(n));
    for (const r of j.removed_v12_stages || []) if (String(r.reason || "").trim()) carried.add(Number(r.n));
    for (const s12 of o.stages)
      if (!carried.has(Number(s12.n))) bad.push(`${j.id}: V12 stage ${s12.n} not carried`);
    for (const st of j.stages)
      for (const s of st.steps) {
        if (s.wording === "V12" || s.wording === "REWORDED") {
          const ref = s.v12_ref;
          const sub = ref && o.stages.find((x) => x.n === ref.stage)?.sub?.[ref.step - 1];
          if (!sub) {
            bad.push(`${s.id}: v12_ref`);
            continue;
          }
          const equal = sub.ar === s.ar && sub.en === s.en;
          if (s.wording === "V12" && !equal) bad.push(`${s.id}: marked V12 but differs from V12`);
          if (s.wording === "REWORDED" && equal) bad.push(`${s.id}: marked REWORDED but equals V12`);
        } else if (s.v12_ref) bad.push(`${s.id}: PROPOSED-NEW with a v12_ref`);
      }
  }
  const v12a = new Map(V12.assignments.map((a) => [a.id, a] as const));
  const moved: string[] = [];
  for (const a of CAT.assignments) {
    const o = v12a.get(a.id)!;
    if (a.journey !== o.journey || a.stage !== o.stage) {
      moved.push(a.id);
      const cf = a.changed_from;
      if (!(cf && cf.journey === o.journey && cf.stage === o.stage && String(cf.reason || "").trim()))
        bad.push(`${a.id}: moved without changed_from {journey, stage, reason}`);
    } else if (a.changed_from) bad.push(`${a.id}: changed_from without a move`);
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(moved, ["INV-09"]);
  assert.deepEqual(
    CAT.master.map((m) => [m.code, m.ar, m.en]),
    V12.master.map((m) => [m.code, m.ar, m.en]),
  );
  for (const [k, en] of Object.entries(V12.master_sub_en)) assert.equal(CAT.master_sub[k]?.en, en, k);
});

/** Minimal RFC 4180 reader (quotes, doubled quotes, commas and newlines inside quotes; BOM removed). */
function readCSV(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}

test("JR-18 the work CSVs agree with the catalogue: 112 assignment rows and the journey-change trace (every new or reworded step recorded)", () => {
  const asg = readCSV(join(EVIDENCE, "V13-05_assignments_112.csv"));
  assert.equal(asg.length, 112);
  for (const row of asg) {
    const a = ASG.get(row.id!);
    assert.ok(a, row.id);
    assert.equal(row.journey, a.journey, row.id);
    assert.equal(Number(row.stage), a.stage, row.id);
    assert.equal(row.step_id || null, a.step_id ?? null, row.id);
    assert.equal(
      row.reports_event_type,
      a.reports_any_of ? [...new Set(a.reports_any_of.map((p) => p.type))].join(" | ") : a.reports_event_type,
      row.id,
    );
    assert.equal(row.completes, String(!!a.completes), row.id);
  }
  const ch = readCSV(join(EVIDENCE, "V13-05_journey_changes.csv"));
  assert.equal(ch.length, 156);
  for (const row of ch)
    assert.ok(JOURNEYS.has(row.journey!), `change row for unknown journey ${row.journey}`);
  for (const [id, { step }] of STEPS)
    if (step.wording !== "V12")
      assert.ok(
        ch.some((row) => row.stage_or_step === id && String(row.reason).trim()),
        `${id} (${step.wording}) has a change row with a reason`,
      );
  for (const j of CAT.journeys)
    assert.ok(
      ch.some((row) => row.journey === j.id && row.stage_or_step === "(lifecycle)"),
      `${j.id}: lifecycle row`,
    );
});

test("JR-19 the 14 mandatory CF cases of charter §12 each have a scenario quoting the V12 behaviour as FACT with evidence", () => {
  const ids = new Set(INDEX.scenarios.map((e) => e.id));
  for (const id of MANDATORY_CF) {
    assert.ok(ids.has(id), `${id} scenario`);
    const sc = SCENARIOS.find((x) => x.sc.id === id)!.sc;
    assert.equal(sc.v12_behaviour?.label, "FACT", `${id}: V12 behaviour labelled FACT`);
    assert.ok(
      String(sc.v12_behaviour!.fact || "").length > 20 && sc.v12_behaviour!.evidence?.length >= 1,
      `${id}: V12 fact with evidence`,
    );
    assert.ok(AR.test(sc.title.ar) && LATIN.test(sc.title.en), `${id}: bilingual title`);
    assert.ok(ASG.has(sc.assignment_id), `${id}: assignment`);
  }
});

// Port note (brief rule 5): the synthetic case reference is now CDF-DEMO-2026-NNNN; the regex below checks that shape.
// The test title is kept verbatim.
test("JR-20 the scenarios carry synthetic data only (CDF-IC-2026-DEMO references, SYNTHETIC_DEMO provenance, demo actors, @example.test addresses)", () => {
  for (const { entry, sc } of SCENARIOS) {
    const text = readFileSync(join(SCEN, entry.file), "utf8");
    assert.match(sc.classification, /SYNTHETIC-DATA REFERENCE IMPLEMENTATION/, entry.file);
    if (sc.case && sc.case.exists)
      assert.match(sc.case.internal_ref as string, /^CDF-DEMO-2026-\d{4}$/, entry.file);
    else
      assert.ok(
        !sc.case || sc.case.internal_ref === null || sc.case.internal_ref === undefined,
        `${entry.file}: no reference without a case`,
      );
    const evs = [
      ...sc.events,
      ...(sc.variants || []).flatMap((v) => [...(v.events || []), ...(v.events_add || [])]),
    ];
    for (const e of evs) {
      const ev = e as JourneyEvent & { provenance?: { source?: string }; actor?: { id?: string } };
      assert.equal(ev.provenance?.source, "SYNTHETIC_DEMO", `${entry.file} ${e.event_id}`);
      if (ev.actor?.id) assert.match(ev.actor.id, /^usr-demo-/, `${entry.file} ${e.event_id}`);
    }
    for (const m of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+/g) || [])
      assert.match(m, /@example\.test$/, `${entry.file}: ${m}`);
    assert.ok(!/\b[12]\d{9}\b/.test(text), `${entry.file}: nothing shaped like a national id`);
  }
});

test("JR-21 the resolver is pure and deterministic: frozen inputs are accepted, nothing is mutated, the same input gives the same output", () => {
  const deepFreeze = <T>(o: T): T => {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.values(o).forEach(deepFreeze);
    }
    return o;
  };
  const cat = deepFreeze(clone(CAT));
  for (const { sc } of SCENARIOS) {
    const caseRecord = deepFreeze(clone(sc.case));
    const po = deepFreeze(clone(sc.procedural_object));
    const evs = deepFreeze(clone(sc.events));
    const asg = cat.assignments.find((a) => a.id === sc.assignment_id);
    const r1 = JSON.stringify([resolveLevel1(caseRecord, cat), resolveLevel2_3(po, cat, asg, evs)]);
    const r2 = JSON.stringify([resolveLevel1(caseRecord, cat), resolveLevel2_3(po, cat, asg, evs)]);
    assert.equal(r1, r2, sc.id);
    const r = resolve23(po, cat, asg, evs);
    for (const x of r.actual)
      assert.ok((ACTUAL_STATES as readonly string[]).includes(x.state), `${sc.id} ${x.step_id} ${x.state}`);
    for (const x of r.expected)
      assert.ok((EXPECTED_KINDS as readonly string[]).includes(x.kind), `${sc.id} ${x.step_id} ${x.kind}`);
    for (const a of r.anomalies)
      assert.ok((ANOMALY_CODES as readonly string[]).includes(a.code), `${sc.id} anomaly ${a.code}`);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(cat)), CAT, "the catalogue is unchanged");
});

test("JR-22 failure and parallel steps: an event matching fail_on never completes the step (a no-quorum ballot closure gives ⚠, not ✔; a lapsed defence period fails the submission); parallel steps wait together (two ○) and are ◇ PARALLEL before they are due", () => {
  const R = "J-RECOMMENDATION-COMMITTEE";
  const pre: EvSpec[] = [
    ["RECOMMENDATION_DRAFTED"],
    ["PACKAGE_SUBMITTED_FOR_VOTE"],
    ["MEETING_OPENED"],
    ["BALLOT_OPENED"],
  ];
  const nq = run(R, events([...pre, ["BALLOT_CLOSED", { result: "NO_QUORUM" }]]));
  assert.equal(
    stateOf(nq, `${R}/2/2`),
    "FAILED",
    "a no-quorum closure is the failure of the vote, never its completion",
  );
  assert.equal(rowA(nq, `${R}/2/2`)!.evidence_event_id, "evt-JR-05");
  assert.ok(
    !nq.actual.some((x) => x.state === "COMPLETED" && x.evidence_event_id === "evt-JR-05"),
    "the failing event completes no step of the object",
  );
  assert.equal(nq.lifecycle.failed, true);
  assert.deepEqual([nq.stage.n, nq.stage.state], [2, "FAILED"]);
  assert.equal(stateOf(nq, `${R}/2/3`), "B:EXPECTED", "adoption is not reached through a failed vote");
  assert.equal(
    stateOf(run(R, events([...pre, ["BALLOT_CLOSED", { result: "APPROVED" }]])), `${R}/2/2`),
    "COMPLETED",
  );
  const again = run(
    R,
    events([
      ...pre,
      ["BALLOT_CLOSED", { result: "NO_QUORUM" }],
      ["BALLOT_OPENED"],
      ["BALLOT_CLOSED", { result: "APPROVED" }],
    ]),
  );
  assert.equal(stateOf(again, `${R}/2/2`), "COMPLETED", "a later valid closure completes the vote");
  assert.equal(rowA(again, `${R}/2/2`)!.evidence_event_id, "evt-JR-07");
  const D = "J-DEFENCE";
  const lapse = run(
    D,
    events([
      ["RIGHTS_NOTICE_ISSUED"],
      ["DEFENCE_NOTICE_ISSUED"],
      ["DEFENCE_PERIOD_STARTED", { due_at: "2026-11-05T13:00:00Z" }],
      ["DEFENCE_PACKET_RELEASED"],
      ["DEFENCE_PERIOD_CLOSED", { reason: "LAPSED" }],
    ]),
  );
  assert.equal(stateOf(lapse, `${D}/4/2`), "FAILED", "a lapsed period: the defence could not be submitted");
  assert.equal(stateOf(lapse, `${D}/5/1`), "COMPLETED", "the period itself is closed on record");
  assert.equal(stateOf(lapse, `${D}/5/2`), "NOT_APPLICABLE/CONDITION_NOT_MET", "no defence is passed on");
  const S = "J-STATEMENT-PARTY";
  const none = run(S, []);
  assert.equal(stateOf(none, `${S}/1/1`), "PENDING");
  assert.deepEqual(
    [stateOf(none, `${S}/2/1`), stateOf(none, `${S}/2/2`)],
    ["B:PARALLEL", "B:PARALLEL"],
    "parallel steps not yet due are ◇ In parallel",
  );
  const req = run(S, events([["STATEMENT_REQUESTED"]]));
  assert.deepEqual(
    [stateOf(req, `${S}/2/1`), stateOf(req, `${S}/2/2`)],
    ["PENDING", "PENDING"],
    "both parallel steps await action together",
  );
  assert.deepEqual([req.stage.n, req.stage.state], [2, "PENDING"]);
  assert.deepEqual(
    [stateOf(req, `${S}/3/1`), stateOf(req, `${S}/3/2`)],
    ["B:ALTERNATIVE", "B:ALTERNATIVE"],
    "the two statement modes stay options",
  );
});

test("JR-23 a vote without quorum is never shown as cast (lead ruling L-10): every step that completes on a ballot closure fails on result NO_QUORUM; in J-MEETING, 3/3 and 3/4 give ⚠, not ✔, and the meeting goes on; a later valid closure completes the vote", () => {
  const admitsNoQuorum = (p: EventPattern) =>
    p.type === "BALLOT_CLOSED" &&
    (!p.payload ||
      p.payload.result === undefined ||
      ([] as unknown[]).concat(p.payload.result).includes("NO_QUORUM"));
  const failsNoQuorum = (s: CatalogueStep) =>
    !!s.fail_on &&
    s.fail_on.type === "BALLOT_CLOSED" &&
    ([] as unknown[]).concat(s.fail_on.payload?.result ?? []).includes("NO_QUORUM");
  const ballot = [...STEPS.values()]
    .map((x) => x.step)
    .filter((s) => compPats(s).some((p) => p.type === "BALLOT_CLOSED"));
  for (const id of ["J-MEETING/3/3", "J-MEETING/3/4", "J-RECOMMENDATION-COMMITTEE/2/2"])
    assert.ok(
      ballot.some((s) => s.id === id),
      `${id} completes on a ballot closure`,
    );
  for (const s of ballot)
    assert.ok(
      !compPats(s).some(admitsNoQuorum) || failsNoQuorum(s),
      `${s.id} completes on a closure for lack of quorum but does not fail on it`,
    );
  const M = "J-MEETING";
  const pre: EvSpec[] = [
    ["AGENDA_DRAFTED"],
    ["AGENDA_APPROVED"],
    ["MEETING_SCHEDULED"],
    ["PARTICIPANTS_INVITED"],
    ["MEETING_PACK_RELEASED"],
    ["COI_DECLARATION_REQUESTED"],
    ["COI_DECLARATIONS_COMPLETE"],
    ["MEETING_OPENED"],
    ["BALLOT_OPENED"],
  ];
  const nq = run(M, events([...pre, ["BALLOT_CLOSED", { result: "NO_QUORUM" }]]));
  assert.deepEqual(codes(nq), [], "a complete synthetic record raises no anomaly");
  assert.equal(stateOf(nq, `${M}/3/3`), "FAILED", "a vote that did not reach quorum is never shown as cast");
  assert.equal(rowA(nq, `${M}/3/3`)!.evidence_event_id, "evt-JR-10");
  assert.equal(stateOf(nq, `${M}/3/4`), "FAILED", "nor are its votes shown as counted");
  assert.ok(
    !nq.actual.some((x) => x.state === "COMPLETED" && x.evidence_event_id === "evt-JR-10"),
    "the no-quorum closure completes no step",
  );
  assert.equal(stateOf(nq, `${M}/3/2`), "IN_PROGRESS", "the deliberation goes on");
  assert.deepEqual([nq.stage.n, nq.stage.state, nq.lifecycle.failed], [3, "FAILED", true]);
  const closed = run(M, events([...pre, ["BALLOT_CLOSED", { result: "NO_QUORUM" }], ["MEETING_CLOSED"]]));
  assert.deepEqual(
    ["3/2", "3/3", "3/4", "4/1"].map((x) => stateOf(closed, `${M}/${x}`)),
    ["COMPLETED", "FAILED", "FAILED", "PENDING"],
    "the meeting closes and the minutes await drafting; the vote stays ⚠",
  );
  const ok = run(M, events([...pre, ["BALLOT_CLOSED", { result: "APPROVED" }]]));
  assert.deepEqual(
    [stateOf(ok, `${M}/3/3`), stateOf(ok, `${M}/3/4`)],
    ["COMPLETED", "COMPLETED"],
    "a closure with a result completes both steps",
  );
  const again = run(
    M,
    events([
      ...pre,
      ["BALLOT_CLOSED", { result: "NO_QUORUM" }],
      ["BALLOT_OPENED"],
      ["BALLOT_CLOSED", { result: "APPROVED" }],
    ]),
  );
  assert.deepEqual(
    [stateOf(again, `${M}/3/3`), stateOf(again, `${M}/3/4`)],
    ["COMPLETED", "COMPLETED"],
    "a later valid closure completes the vote",
  );
  assert.equal(rowA(again, `${M}/3/3`)!.evidence_event_id, "evt-JR-12");
  assert.equal(again.lifecycle.failed, false);
});

test("JR-24 a ballot closed with NO_DECISION is a recorded outcome, not a failure (lead ruling L-11): it completes the vote steps J-MEETING/3/3, J-MEETING/3/4 and J-RECOMMENDATION-COMMITTEE/2/2, never an adoption or decision step, and nothing it completes says a decision or adoption occurred; a later ballot on the same item is read as in JR-23", () => {
  const ND = { result: "NO_DECISION" };
  const admits = (p: EventPattern, v: string) =>
    p.type === "BALLOT_CLOSED" &&
    (!p.payload || p.payload.result === undefined || ([] as unknown[]).concat(p.payload.result).includes(v));
  const failsOn = (s: CatalogueStep, v: string) =>
    !!s.fail_on &&
    s.fail_on.type === "BALLOT_CLOSED" &&
    ([] as unknown[]).concat(s.fail_on.payload?.result ?? []).includes(v);
  const VOTE = ["J-MEETING/3/3", "J-MEETING/3/4", "J-RECOMMENDATION-COMMITTEE/2/2"];
  const DECIDES = new Set(
    [...STEPS.values()].flatMap(({ step }) => compTypes(step)).filter((t) => /ADOPT|DECI(SION|DED)/.test(t)),
  );
  for (const t of ["RECOMMENDATION_ADOPTED", "AUTHORITY_DECISION_RECORDED"])
    assert.ok(DECIDES.has(t), `${t} is an adoption or decision event of the catalogue`);
  const isDecisionStep = (id: string) => compTypes(stepOf(id)).some((t) => DECIDES.has(t));
  // the catalogue: every step that completes on a ballot closure completes on NO_DECISION and does not fail on it; no adoption or decision step completes on a ballot closure
  const ballot = [...STEPS.values()]
    .map((x) => x.step)
    .filter((s) => compPats(s).some((p) => p.type === "BALLOT_CLOSED"));
  for (const id of VOTE)
    assert.ok(
      ballot.some((s) => s.id === id),
      `${id} completes on a ballot closure`,
    );
  for (const s of ballot) {
    assert.ok(
      compPats(s).some((p) => admits(p, "NO_DECISION")),
      `${s.id} does not complete on a closure with NO_DECISION`,
    );
    assert.ok(
      !failsOn(s, "NO_DECISION"),
      `${s.id} fails on a closure with NO_DECISION, which is a recorded outcome`,
    );
    assert.ok(!isDecisionStep(s.id), `${s.id}: an adoption or decision step completes on a ballot closure`);
  }
  // what a run shows: the NO_DECISION closure completes exactly the vote steps; nothing it completes says a decision or adoption occurred
  const WORDS = { ar: /اعتماد|اعتمد|قرار|البت/, en: /adopt|decision|decided|approv/i };
  const plain = (x: string) => x.replace(/[ً-ْٰ]/g, "");
  const says = (lab: Bilingual) => WORDS.ar.test(plain(lab.ar)) || WORDS.en.test(lab.en);
  const done = (r: Level23Resolved) =>
    new Set([
      ...r.actual.filter((x) => x.state === "COMPLETED").map((x) => x.step_id),
      ...r.stages.filter((s) => s.state === "COMPLETED").map((s) => `S${s.n}`),
    ]);
  const viewDone = (r: Level23Resolved): [string, Bilingual][] => {
    const w = buildProgressView(null, r, "SECRETARY");
    return [
      ...w
        .level3!.actual.filter((x) => x.state === "COMPLETED")
        .map((x): [string, Bilingual] => [x.step_id, x.label]),
      ...w
        .level2!.stages.filter((s) => s.state === "COMPLETED")
        .map((s): [string, Bilingual] => [`S${s.n}`, s.label]),
    ];
  };
  const check = (
    j: string,
    base: Level23Resolved,
    nd: Level23Resolved,
    ndId: string,
    expectIds: string[],
  ) => {
    assert.deepEqual(codes(nd), [], `${j}: a complete synthetic record raises no anomaly`);
    assert.deepEqual(
      nd.actual
        .filter((x) => x.state === "COMPLETED" && x.evidence_event_id === ndId)
        .map((x) => x.step_id)
        .sort(),
      [...expectIds].sort(),
      `${j}: the NO_DECISION closure completes exactly the vote steps`,
    );
    assert.ok(
      !nd.actual.some((x) => x.state === "COMPLETED" && isDecisionStep(x.step_id)),
      `${j}: no adoption or decision step is completed`,
    );
    assert.deepEqual(
      [nd.derived.recommendation_adopted, nd.derived.decision_recorded, nd.derived.decision_outcome],
      [false, false, null],
      `${j}: no adoption or decision is derived`,
    );
    assert.equal(nd.lifecycle.failed, false, `${j}: NO_DECISION is not a failure`);
    const before = done(base);
    const fresh = viewDone(nd).filter(([k]) => !before.has(k));
    assert.ok(fresh.length >= expectIds.length, `${j}: the vote steps show ✔`);
    for (const [k, lab] of fresh)
      assert.ok(!says(lab), `${j} ${k} "${lab.en}" / «${lab.ar}» says a decision or adoption occurred`);
  };
  const M = "J-MEETING";
  const pre: EvSpec[] = [
    ["AGENDA_DRAFTED"],
    ["AGENDA_APPROVED"],
    ["MEETING_SCHEDULED"],
    ["PARTICIPANTS_INVITED"],
    ["MEETING_PACK_RELEASED"],
    ["COI_DECLARATION_REQUESTED"],
    ["COI_DECLARATIONS_COMPLETE"],
    ["MEETING_OPENED"],
    ["BALLOT_OPENED"],
  ];
  const nd = run(M, events([...pre, ["BALLOT_CLOSED", ND]]));
  check(M, run(M, events(pre)), nd, "evt-JR-10", [`${M}/3/3`, `${M}/3/4`]);
  assert.deepEqual(
    ["3/2", "3/3", "3/4"].map((x) => stateOf(nd, `${M}/${x}`)),
    ["IN_PROGRESS", "COMPLETED", "COMPLETED"],
    "the vote is cast and counted; the deliberation goes on",
  );
  const closed = run(M, events([...pre, ["BALLOT_CLOSED", ND], ["MEETING_CLOSED"]]));
  check(M, run(M, events([...pre, ["MEETING_CLOSED"]])), closed, "evt-JR-10", [`${M}/3/3`, `${M}/3/4`]);
  assert.deepEqual(
    ["3/3", "3/4", "4/1"].map((x) => stateOf(closed, `${M}/${x}`)),
    ["COMPLETED", "COMPLETED", "PENDING"],
    "the item is closed and the minutes await drafting; nothing stays ◇",
  );
  assert.deepEqual([closed.stage.n, closed.stages.find((s) => s.n === 3)!.state], [4, "COMPLETED"]);
  const RC = "J-RECOMMENDATION-COMMITTEE";
  const preR: EvSpec[] = [
    ["RECOMMENDATION_DRAFTED"],
    ["PACKAGE_SUBMITTED_FOR_VOTE"],
    ["MEETING_OPENED"],
    ["BALLOT_OPENED"],
  ];
  const ndR = run(RC, events([...preR, ["BALLOT_CLOSED", ND]]));
  check(RC, run(RC, events(preR)), ndR, "evt-JR-05", [`${RC}/2/2`]);
  assert.equal(
    stateOf(ndR, `${RC}/2/3`),
    "PENDING",
    "adoption and minutes still await RECOMMENDATION_ADOPTED",
  );
  assert.notEqual(
    ndR.stages.find((s) => s.n === 2)!.state,
    "COMPLETED",
    "the stage that names the adoption is not shown complete",
  );
  for (const id of [`${RC}/4/2`, `${RC}/5/1`])
    assert.ok(!rowA(ndR, id) || rowA(ndR, id)!.state !== "COMPLETED", `${id}: no decision is shown recorded`);
  // a later ballot on the same item is read as in JR-23: the latest closure governs the vote steps
  const later = (j: string, p: EvSpec[], first: Record<string, unknown>, second: Record<string, unknown>) =>
    run(j, events([...p, ["BALLOT_CLOSED", first], ["BALLOT_OPENED"], ["BALLOT_CLOSED", second]]));
  const ndAp = later(M, pre, ND, { result: "APPROVED" });
  assert.deepEqual(
    [
      stateOf(ndAp, `${M}/3/3`),
      stateOf(ndAp, `${M}/3/4`),
      rowA(ndAp, `${M}/3/4`)!.evidence_event_id,
      ndAp.lifecycle.failed,
    ],
    ["COMPLETED", "COMPLETED", "evt-JR-12", false],
    "a later closure with a result completes the vote on its own evidence",
  );
  const ndNq = later(M, pre, ND, { result: "NO_QUORUM" });
  assert.deepEqual(
    [
      stateOf(ndNq, `${M}/3/3`),
      stateOf(ndNq, `${M}/3/4`),
      rowA(ndNq, `${M}/3/4`)!.evidence_event_id,
      ndNq.lifecycle.failed,
    ],
    ["FAILED", "FAILED", "evt-JR-12", true],
    "a later closure for lack of quorum fails the vote, as in JR-23",
  );
  const nqNd = later(M, pre, { result: "NO_QUORUM" }, ND);
  assert.deepEqual(
    [
      stateOf(nqNd, `${M}/3/3`),
      stateOf(nqNd, `${M}/3/4`),
      rowA(nqNd, `${M}/3/4`)!.evidence_event_id,
      nqNd.lifecycle.failed,
    ],
    ["COMPLETED", "COMPLETED", "evt-JR-12", false],
    "a NO_DECISION closure after a no-quorum one completes the vote, as a valid closure does in JR-23",
  );
  const ndApR = later(RC, preR, ND, { result: "APPROVED" });
  assert.deepEqual(
    [
      stateOf(ndApR, `${RC}/2/2`),
      rowA(ndApR, `${RC}/2/2`)!.evidence_event_id,
      stateOf(ndApR, `${RC}/2/3`),
      ndApR.derived.recommendation_adopted,
    ],
    ["COMPLETED", "evt-JR-07", "PENDING", false],
    "even after a later approving ballot the adoption needs its own record",
  );
  const nqNdR = later(RC, preR, { result: "NO_QUORUM" }, ND);
  assert.deepEqual(
    [
      stateOf(nqNdR, `${RC}/2/2`),
      rowA(nqNdR, `${RC}/2/2`)!.evidence_event_id,
      stateOf(nqNdR, `${RC}/2/3`),
      nqNdR.lifecycle.failed,
    ],
    ["COMPLETED", "evt-JR-07", "PENDING", false],
  );
  const ndNqR = later(RC, preR, ND, { result: "NO_QUORUM" });
  assert.deepEqual(
    [stateOf(ndNqR, `${RC}/2/2`), rowA(ndNqR, `${RC}/2/2`)!.evidence_event_id, ndNqR.lifecycle.failed],
    ["FAILED", "evt-JR-07", true],
  );
});
