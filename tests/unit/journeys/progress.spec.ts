// tests/unit/journeys/progress.test.ts — W-C (V13-06). Actual Progress (Layer A) vs Expected Process (Layer B): the
// progress view model built by lib/journeys/progress.ts for each recipient class (charter §3.6, §5; owner decisions on
// Level 1). Ported from tests/progress.test.js (node:test → Vitest).
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Read-only.
// Inputs: every scenario and variant of lib/journeys/scenarios/ resolved by lib/journeys/resolve.ts, viewed by every
// recipient class. The view model leaves progress.ts with _disclosure_applied === false (W-F policy, W-D2 projection).
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  resolveLevel1,
  resolveLevel2_3,
  ACTUAL_STATES,
  EXPECTED_KINDS,
  type Catalogue,
  type CaseRecordInput,
  type ProceduralObjectInput,
  type JourneyEvent,
  type Level1Result,
  type Level23Resolved,
  type Bilingual,
  type ExpectedKind,
} from "@/lib/journeys/resolve";
import {
  buildProgressView,
  SYMBOLS,
  STATE_LABELS,
  EXPECTED_SYMBOL,
  KIND_LABELS,
  L1_EXPECTED_LABEL,
  UNVERIFIED_SYMBOL,
  L1_UNVERIFIED_LABELS,
  NOTE_LABELS,
  COLOUR_TOKENS,
  NOTICE_MARKER,
  RECIPIENT_POLICY,
  FORBIDDEN_LAYER_B,
  forbiddenWords,
  type ProgressView,
  type ViewStyle,
  type ViewNoteCode,
} from "@/lib/journeys/progress";
import {
  CATALOGUE_V13,
  SCENARIO_INDEX,
  loadScenario,
  type Scenario,
  type ScenarioVariant,
} from "@/lib/journeys";

type Cat = Required<Catalogue>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const CAT = CATALOGUE_V13 as Cat;
const INDEX = SCENARIO_INDEX;
const ASG = new Map(CAT.assignments.map((a) => [a.id, a] as const));
const JOURNEYS = new Map(CAT.journeys.map((j) => [j.id, j] as const));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const CLASSES = Object.keys(RECIPIENT_POLICY) as (keyof typeof RECIPIENT_POLICY)[];
const INTERNAL = [
  "SECRETARY",
  "CHAIR",
  "MEMBER",
  "INVESTIGATOR",
  "LEGAL_REVIEWER",
  "RESTRICTED_CASE_AUTHORITY",
];
const STAGE_NAME_CLASSES = ["REPORTER", "REFERRING_BODY", "EVIDENCE_HOLDER", "SUBJECT", "RECUSED_MEMBER"];

// Charter §3.6, verbatim.
const CHARTER_A: Record<string, [string, string]> = {
  COMPLETED: ["✔", "اكتمل — تم تسجيل الإجراء"],
  IN_PROGRESS: ["●", "جارٍ"],
  PENDING: ["○", "بانتظار إجراء محدد"],
  SUSPENDED: ["⏸", "موقوف مؤقتاً"],
  RETURNED: ["↩", "أُعيد لاستكمال متطلبات"],
  CANCELLED: ["✕", "أُلغي"],
  FAILED: ["⚠", "تعذر إتمامه"],
  NOT_APPLICABLE: ["—", "لا ينطبق"],
};
const CHARTER_B: Record<string, string> = {
  EXPECTED: "خطوة متوقعة",
  CONDITIONAL: "خطوة محتملة — بحسب …",
  OPTIONAL: "خطوة اختيارية",
  ALTERNATIVE: "مسار بديل",
  PARALLEL: "بالتوازي",
  SUBJECT_TO_APPROVAL: "رهن الاعتماد",
};
const A_SYMBOLS = new Set<string>(Object.values(SYMBOLS));

// English V12 step and stage names that read as completion wording (PROPOSAL finding, V13-06 §7): pinned so that no
// new one appears; Arabic names carry none. Their English rewording is an owner wording decision.
const KNOWN_EN_COMPLETION_WORDING = [
  "J-WB-REPORTER/1/2",
  "J-WB-REPORTER/2/1",
  "J-IR-REFERRER/4/3",
  "J-CHAIR-DIRECTION/5/1",
  "J-MEETING/3/1",
  "J-INVESTIGATION/3/4",
  "J-RECOMMENDATION-COMMITTEE/5",
  "J-RECOMMENDATION-COMMITTEE/5/1",
  "J-LEGAL-REVIEW/4",
  "J-LEGAL-REVIEW/4/1",
  "J-DECISION-AUTHORITY/3/2",
];

// ------------------------------------------------------------------ all scenarios, all variants, resolved once
function materialise(sc: Scenario, v: ScenarioVariant | null) {
  const caseRecord = clone(sc.case) as Mutable<CaseRecordInput> & Record<string, unknown>;
  let po: ProceduralObjectInput = clone(sc.procedural_object);
  let events = clone(sc.events) as Mutable<JourneyEvent>[];
  if (v) {
    if (v.events) events = clone(v.events) as Mutable<JourneyEvent>[];
    if (v.events_add) events = [...events, ...(clone(v.events_add) as Mutable<JourneyEvent>[])];
    if (v.events_replace)
      for (const r of v.events_replace) {
        const e = events.find((x) => x.event_id === r.event_id)!;
        e.payload = clone(r.payload);
      }
    if (v.procedural_object_patch) po = { ...po, ...clone(v.procedural_object_patch) };
    if (v.case_patch)
      for (const [k, val] of Object.entries(v.case_patch)) {
        if (val === null) delete caseRecord[k];
        else caseRecord[k] = clone(val);
      }
  }
  return { caseRecord: caseRecord as CaseRecordInput, po, events: events as JourneyEvent[] };
}
interface Run {
  id: string;
  sc: Scenario;
  l1: Level1Result | null;
  r: Level23Resolved;
  recipient: string;
}
const RUNS: Run[] = [];
for (const e of INDEX.scenarios) {
  const sc = loadScenario(e.file);
  for (const v of [null, ...(sc.variants || [])]) {
    const m = materialise(sc, v);
    const l1 = resolveLevel1(m.caseRecord, CAT);
    // every scenario names an existing journey: the resolved shape (the cast changes nothing at run time)
    const r = resolveLevel2_3(m.po, CAT, ASG.get(sc.assignment_id), m.events) as Level23Resolved;
    RUNS.push({ id: v ? v.id : sc.id, sc, l1, r, recipient: sc.recipient_class });
  }
}
const run = (id: string): Run => RUNS.find((x) => x.id === id)!;
const view = (id: string, cls: string): ProgressView => {
  const x = run(id);
  return buildProgressView(x.l1, x.r, cls);
};
function* allViews() {
  for (const x of RUNS) for (const cls of CLASSES) yield { ...x, cls, v: buildProgressView(x.l1, x.r, cls) };
}

/** Any Layer-A or Layer-B item of the view, read through the fields the checks below use. */
interface AnyItem {
  readonly layer: string;
  readonly symbol: string;
  readonly label: Bilingual;
  readonly aria: Bilingual;
  readonly style: ViewStyle;
  readonly state?: string;
  readonly state_label?: Bilingual;
  readonly kind?: string;
  readonly kind_label?: Bilingual;
  readonly step_id?: string;
  readonly code?: string;
  readonly n?: number;
  readonly note?: string;
  readonly note_label?: Bilingual;
  readonly condition?: Bilingual;
  readonly previously_visited?: boolean;
  readonly epistemic?: string;
}
const layerB = (v: ProgressView): AnyItem[] => [
  ...(v.level3?.expected || []),
  ...(v.level3?.current_stage?.expected || []),
  ...(v.level1?.stages || []).filter((s) => s.layer === "B"),
  ...(v.level2?.stages || []).filter((s) => s.layer === "B"),
  ...(v.level2?.summary5 || []).filter((s) => s.layer === "B"),
];
const layerA = (v: ProgressView): AnyItem[] => [
  ...(v.level3?.actual || []),
  ...(v.level3?.current_stage?.actual || []),
  ...(v.level3?.previous_round || []),
  ...(v.level1?.stages || []).filter((s) => s.layer === "A"),
  ...(v.level2?.stages || []).filter((s) => s.layer === "A"),
  ...(v.level2?.summary5 || []).filter((s) => s.layer === "A"),
];
const shownJSON = (v: ProgressView) =>
  JSON.stringify({
    level1: v.level1,
    level2: v.level2,
    level3: v.level3,
    notice: v.notice,
    deadlines: v.deadlines,
  });
const masterNames = () => CAT.master.flatMap((m) => [m.ar, m.en]);
const subNames = () => Object.entries(CAT.master_sub).flatMap(([k, s]) => [`"${k}"`, s.ar, s.en]);

// ------------------------------------------------------------------ tests
test("PG-01 Layer A: eight actual states with the charter symbols and Arabic labels (aria), English labels, solid outline; every Layer-A item uses them", () => {
  assert.deepEqual(Object.keys(SYMBOLS), Object.keys(CHARTER_A));
  assert.deepEqual([...ACTUAL_STATES], Object.keys(CHARTER_A), "resolver and view share the eight states");
  for (const [s, [sym, ar]] of Object.entries(CHARTER_A)) {
    assert.equal((SYMBOLS as Record<string, string>)[s], sym, s);
    assert.equal((STATE_LABELS as Record<string, Bilingual>)[s]!.ar, ar, `${s}: Arabic label = charter aria`);
    assert.match((STATE_LABELS as Record<string, Bilingual>)[s]!.en, /^[A-Z][a-z]/, `${s}: English label`);
  }
  assert.equal(new Set(Object.values(SYMBOLS)).size, 8, "eight distinct symbols");
  let n = 0;
  for (const { id, cls, v } of allViews())
    for (const it of layerA(v)) {
      n++;
      assert.equal(
        it.symbol,
        (SYMBOLS as Record<string, string>)[it.state!],
        `${id} ${cls} ${it.step_id || it.code || it.n}`,
      );
      assert.deepEqual(it.state_label, (STATE_LABELS as Record<string, Bilingual>)[it.state!]);
      assert.equal(it.style.outline, "solid");
      for (const lang of ["ar", "en"] as const)
        assert.ok(
          it.aria[lang].includes(it.label[lang]) && it.aria[lang].includes(it.state_label![lang]),
          `${id} ${cls}: aria carries the name and the state`,
        );
    }
  assert.ok(n > 1000, `Layer-A items checked: ${n}`);
});

test("PG-02 Layer B: six expected kinds, all ◇ with the charter text labels, dashed outline, muted tone; every Layer-B item uses them", () => {
  assert.equal(EXPECTED_SYMBOL, "◇");
  assert.deepEqual(Object.keys(KIND_LABELS), Object.keys(CHARTER_B));
  assert.deepEqual([...EXPECTED_KINDS], Object.keys(CHARTER_B));
  for (const [k, ar] of Object.entries(CHARTER_B)) {
    assert.equal(KIND_LABELS[k as ExpectedKind].ar, ar, k);
    assert.ok(KIND_LABELS[k as ExpectedKind].en.length > 3, k);
  }
  assert.equal(new Set(Object.values(KIND_LABELS).map((x) => x.ar)).size, 6, "six distinct labels");
  let n = 0;
  for (const { id, cls, v } of allViews())
    for (const it of layerB(v)) {
      n++;
      assert.equal(it.symbol, EXPECTED_SYMBOL, `${id} ${cls} ${it.step_id || it.code || it.n}`);
      assert.deepEqual(
        [it.style.outline, it.style.tone, it.style.token],
        ["dashed", "muted", COLOUR_TOKENS.EXPECTED],
      );
      assert.ok((EXPECTED_KINDS as readonly string[]).includes(it.kind!), `${id} ${cls}: kind ${it.kind}`);
      assert.ok(it.kind_label && it.kind_label.ar && it.kind_label.en);
      for (const lang of ["ar", "en"] as const)
        assert.ok(it.aria[lang].includes(it.label[lang]) && it.aria[lang].includes(it.kind_label[lang]));
      assert.equal(it.state, undefined, "a Layer-B item carries no actual state");
    }
  assert.ok(n > 500, `Layer-B items checked: ${n}`);
});

test("PG-03 no ✔ or ● (no actual-state symbol) in Layer B, no step in both layers, and every ✔ step cites its recorded event", () => {
  for (const { id, cls, v } of allViews()) {
    for (const it of layerB(v)) assert.ok(!A_SYMBOLS.has(it.symbol), `${id} ${cls}: ${it.symbol} in Layer B`);
    const a = new Set((v.level3?.actual || []).map((x) => x.step_id));
    for (const b of v.level3?.expected || [])
      assert.ok(!a.has(b.step_id), `${id} ${cls}: ${b.step_id} in both layers`);
    for (const it of v.level3?.actual || [])
      if (it.state === "COMPLETED" && !it.stage_level) {
        assert.ok(it.evidence_event_id, `${id} ${cls}: ✔ ${it.step_id} without evidence`);
        assert.equal(it.epistemic, "RECORDED_FACT");
      }
    for (const s of v.level1?.stages || [])
      if (s.state === "COMPLETED")
        assert.ok(
          ["RECORDED_FACT", "DERIVED_FROM_VERIFIED_FACTS"].includes(s.epistemic as string),
          `${id} ${cls}: L1 ✔ ${s.code} is ${s.epistemic}`,
        );
  }
});

test("PG-04 Layer-B wording: no سُجل / اكتُمل / تم in any Arabic Layer-B text; kind and note labels clean in both languages; English completion wording only in the pinned V12 names (PROPOSAL finding)", () => {
  const enHits = new Set<string>();
  for (const { id, cls, v } of allViews())
    for (const it of layerB(v)) {
      for (const k of ["label", "kind_label", "aria", "note_label", "condition"] as const) {
        const val = it[k];
        if (!val) continue;
        assert.deepEqual(
          forbiddenWords(val.ar, "ar"),
          [],
          `${id} ${cls} ${it.step_id || it.code || it.n} ${k}: «${val.ar}»`,
        );
        if (k === "kind_label" || k === "note_label" || k === "condition")
          assert.deepEqual(forbiddenWords(val.en, "en"), [], `${id} ${cls} ${k}: «${val.en}»`);
        if (k === "label" && forbiddenWords(val.en, "en").length)
          enHits.add(it.step_id || `${v.level2!.journey_id}/${it.n}`);
      }
    }
  // notes a Layer-B item can carry (resolver: alternatives and branches; Level 1: previously visited). The noun «سجل»
  // (record) in the Layer-A notes OBJECT_RECORD and NOT_ESTABLISHED_BY_THE_CASE_RECORD never reaches Layer B.
  const B_NOTES: ViewNoteCode[] = [
    "NOT_SELECTED",
    "BRANCH_NOT_TAKEN",
    "BRANCH_NOT_DECIDED",
    "PREVIOUSLY_VISITED",
  ];
  for (const { v } of allViews())
    for (const it of layerB(v))
      if (it.note || it.previously_visited)
        assert.ok((B_NOTES as string[]).includes(it.note || "PREVIOUSLY_VISITED"), `Layer-B note ${it.note}`);
  for (const lbl of [
    ...Object.values(KIND_LABELS),
    L1_EXPECTED_LABEL,
    ...B_NOTES.map((k) => NOTE_LABELS[k]),
  ]) {
    assert.deepEqual(forbiddenWords(lbl.ar, "ar"), [], lbl.ar);
    assert.deepEqual(forbiddenWords(lbl.en, "en"), [], lbl.en);
  }
  const catHits: string[] = [];
  for (const j of CAT.journeys)
    for (const st of j.stages) {
      assert.deepEqual(forbiddenWords(st.ar, "ar"), [], `${j.id}/${st.n} «${st.ar}»`);
      if (forbiddenWords(st.en, "en").length) catHits.push(`${j.id}/${st.n}`);
      for (const s of st.steps) {
        assert.deepEqual(forbiddenWords(s.ar, "ar"), [], `${s.id} «${s.ar}»`);
        if (forbiddenWords(s.en, "en").length) {
          catHits.push(s.id);
          assert.equal(s.wording, "V12", `${s.id}: completion wording introduced by V13`);
        }
      }
    }
  assert.deepEqual(
    catHits.sort(),
    [...KNOWN_EN_COMPLETION_WORDING].sort(),
    "English names with completion wording: only the pinned V12 names",
  );
  for (const id of enHits)
    assert.ok(KNOWN_EN_COMPLETION_WORDING.includes(id), `${id}: new English completion wording on Layer B`);
  console.warn(
    "[diagnostic]",
    `PROPOSAL finding: ${catHits.length} English V12 names read as completed when shown on Layer B (${[...enHits].length} reached a scenario view): ${catHits.join(", ")}`,
  );
});

test("PG-05 forbiddenWords: finds the forbidden words with or without diacritics and with a prefixed و or ف; leaves other words alone", () => {
  assert.deepEqual(FORBIDDEN_LAYER_B.ar, ["سجل", "سجلت", "اكتمل", "اكتملت", "تم", "تمت"]);
  assert.deepEqual(forbiddenWords("سُجِّل الطلب", "ar"), ["سجل"]);
  assert.deepEqual(forbiddenWords("اكتُمل", "ar"), ["اكتمل"]);
  assert.deepEqual(forbiddenWords("تمّ الإرسال", "ar"), ["تم"]);
  assert.deepEqual(forbiddenWords("وتم الرد ثم فاكتملت", "ar"), ["وتم", "فاكتملت"]);
  assert.deepEqual(forbiddenWords("تمهيد الملف وسجلات أخرى", "ar"), []);
  assert.deepEqual(forbiddenWords("خطوة متوقعة", "ar"), []);
  assert.deepEqual(forbiddenWords("Receipt Recorded; done.", "en"), ["recorded", "done"]);
  assert.deepEqual(forbiddenWords("Completion of handling", "en"), []);
  assert.deepEqual(forbiddenWords("Completed", "ar"), [], "Arabic check reads Arabic letters only");
  for (const x of [null, undefined, 3, {}, ""]) assert.deepEqual(forbiddenWords(x, "ar"), []);
});

test("PG-06 no Level 1 when the case does not exist: no master journey for any recipient, Levels 2 and 3 still shown", () => {
  const x = run("NOCASE-01");
  assert.equal(x.l1, null);
  for (const cls of CLASSES) {
    const v = buildProgressView(null, x.r, cls);
    assert.equal(v.level1, null, cls);
    assert.ok(!v.diagnostics.notes.some((n) => n.code === "LEVEL1_WITHHELD"), `${cls}: nothing to withhold`);
    if (RECIPIENT_POLICY[cls].audience !== "none") assert.ok(v.level2 && v.level3, cls);
  }
  for (const r of RUNS.filter((y) => y.l1 === null))
    for (const cls of CLASSES) assert.equal(buildProgressView(null, r.r, cls).level1, null, r.id);
});

test("PG-07 the witness sees no Level 1 in any scenario: no master stage or sub-state name or code reaches the witness view", () => {
  for (const x of RUNS) {
    const v = buildProgressView(x.l1, x.r, "WITNESS");
    assert.equal(v.level1, null, x.id);
    assert.equal(v.policy!.l1_mode, "NONE");
    if (x.l1)
      assert.ok(
        v.diagnostics.notes.some((n) => n.code === "LEVEL1_WITHHELD"),
        x.id,
      );
    const s = shownJSON(v);
    for (const name of [...masterNames(), ...subNames()])
      assert.ok(!s.includes(name), `${x.id}: «${name}» in the witness view`);
  }
});

test("PG-08 public, scope and restricted recipients see Level-1 stage names only: no sub-state, flags, source or record time", () => {
  for (const x of RUNS.filter((y) => y.l1 && y.l1.stage))
    for (const cls of STAGE_NAME_CLASSES) {
      const v = buildProgressView(x.l1, x.r, cls);
      const l1v = v.level1!;
      assert.equal(l1v.mode, "STAGE_NAMES", `${x.id} ${cls}`);
      assert.equal(l1v.current?.substate, undefined);
      for (const k of ["flags", "source_event_id", "recorded_at"] as const)
        assert.equal(l1v[k], undefined, `${x.id} ${cls}: ${k}`);
      const s = JSON.stringify(l1v);
      for (const [code, sub] of Object.entries(CAT.master_sub)) {
        assert.ok(!s.includes(`"${code}"`), `${x.id} ${cls}: ${code}`);
        assert.ok(!s.includes(sub.ar) && !s.includes(sub.en), `${x.id} ${cls}: sub-state name`);
      }
      for (const st of l1v.stages) {
        assert.ok(!st.reopened && !st.previously_visited, `${x.id} ${cls}: reopening detail`);
        if (st.note) assert.equal(st.note, "NOT_VISITED");
      }
    }
});

test("PG-09 internal recipients see the stage and the recorded sub-state (policy field l1_substate) with its source", () => {
  for (const x of RUNS.filter((y) => y.l1 && y.l1.stage))
    for (const cls of INTERNAL) {
      const v = buildProgressView(x.l1, x.r, cls);
      const l1v = v.level1!;
      assert.equal(l1v.mode, "SUBSTATE", `${x.id} ${cls}`);
      assert.equal(l1v.current!.substate!.code, x.l1!.substate!.code);
      assert.equal(l1v.current!.substate!.policy_field, "l1_substate");
      assert.equal(l1v.source_event_id, x.l1!.source_event_id);
      assert.deepEqual(l1v.flags, x.l1!.flags);
    }
});

test("PG-10 the authority reads a scope journey as a scope recipient (stage names, internal steps hidden) and an internal journey as internal", () => {
  const v = view("SUM-01", "AUTHORITY");
  assert.equal(JOURNEYS.get("J-DR-AUTHORITY")!.disclosure, "scope");
  assert.equal(v.audience, "scope");
  assert.equal(v.policy!.l1_mode, "STAGE_NAMES");
  assert.ok(
    ![...v.level3!.actual, ...v.level3!.expected].some((x) => x.step_id === "J-DR-AUTHORITY/5/1"),
    "internal step hidden",
  );
  assert.ok(v.level3!.hidden_steps >= 1);
  const s = view("SUM-01", "SECRETARY");
  assert.equal(s.level3!.hidden_steps, 0);
  const i = view("CF-35", "AUTHORITY");
  assert.equal(JOURNEYS.get("J-RECOMMENDATION-COMMITTEE")!.disclosure, "internal");
  assert.deepEqual([i.audience, i.policy!.l1_mode], ["internal", "SUBSTATE"]);
});

test("PG-11 an unknown recipient class fails closed: nothing shown, UNKNOWN_RECIPIENT_CLASS reported (PREPARER and SECTOR_HEAD are not recipient classes of the charter)", () => {
  const x = run("CF-18");
  for (const cls of [
    "PREPARER",
    "SECTOR_HEAD",
    "secretary",
    "",
    undefined,
    null,
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
  ]) {
    const v = buildProgressView(x.l1, x.r, cls);
    for (const k of ["level1", "level2", "level3", "notice", "interaction", "audience", "policy"] as const)
      assert.equal(v[k], null, `${String(cls)}: ${k}`);
    assert.deepEqual([v.deadlines.length, v.legend.length], [0, 0]);
    assert.ok(
      v.diagnostics.anomalies.some((a) => a.code === "UNKNOWN_RECIPIENT_CLASS"),
      String(cls),
    );
    assert.equal(v._disclosure_applied, false);
  }
  const np = view("NOCASE-01", "SECRETARY");
  assert.ok(
    np.level2,
    "the NOCASE-01 notice is addressed to a sector head; the scenario view uses an internal class",
  );
});

test("PG-12 a recused seat sees no steps of the affected object (PROPOSAL fail-closed default): no Level-2 stages, no Level-3 steps, no summary, notice not shown", () => {
  for (const x of RUNS.filter((y) => y.r.journey)) {
    const v = buildProgressView(x.l1, x.r, "RECUSED_MEMBER");
    assert.equal(v.audience, "none");
    assert.deepEqual(
      [
        v.level3!.actual.length,
        v.level3!.expected.length,
        v.level3!.previous_round.length,
        v.level2!.stages.length,
      ],
      [0, 0, 0, 0],
      x.id,
    );
    assert.equal(v.level3!.hidden_steps, x.r.actual.length + x.r.expected.length);
    assert.ok(v.level3!.note?.ar && v.level3!.note?.en);
    assert.equal(v.level2!.summary5, null);
    if (v.notice) assert.equal(v.notice.location, "NOT_SHOWN", x.id);
  }
});

test("PG-13 every view leaves progress.js unprojected (_disclosure_applied === false) and every part carries its W-F policy field", () => {
  for (const { id, cls, v } of allViews()) {
    assert.equal(v._disclosure_applied, false, `${id} ${cls}`);
    assert.equal(v.diagnostics.never_rendered, true);
    if (v.level1) assert.equal(v.level1.policy_field, "l1_stage_name");
    if (v.level2) assert.equal(v.level2.policy_field, "l2_journey");
    if (v.level3) assert.equal(v.level3.policy_field, "l3_steps");
    if (v.level2?.lifecycle) assert.equal(v.level2.lifecycle.policy_field, "exception_indicator");
    for (const d of v.deadlines)
      assert.deepEqual([d.policy_field, d.basis_policy_field], ["deadline", "deadline_basis"]);
    for (const p of v.level3?.previous_round || []) assert.equal(p.policy_field, "exception_indicator");
  }
});

test("PG-14 early closure: stages the case never entered are not applicable (—, NOT_VISITED) or unverified (?), never ✔, for every recipient", () => {
  for (const cls of ["REPORTER", "SECRETARY"]) {
    const v = view("EC-01", cls);
    for (const code of ["S3", "S4"]) {
      const s = v.level1!.stages.find((x) => x.code === code)!;
      assert.deepEqual([s.state, s.symbol, s.note], ["NOT_APPLICABLE", "—", "NOT_VISITED"], `${cls} ${code}`);
      assert.deepEqual(s.note_label, NOTE_LABELS.NOT_VISITED);
    }
    const never = (run("EC-01").sc.expected.must_not || [])
      .map((m) => /^✔ on (\S+)$/.exec(m)?.[1])
      .filter(Boolean) as string[];
    assert.ok(never.length >= 6);
    for (const it of [...v.level3!.actual, ...v.level3!.expected].filter((x) => never.includes(x.step_id)))
      assert.notEqual(it.symbol, "✔", `${cls} ${it.step_id}: the case never got there`);
    assert.equal(v.level2!.lifecycle!.terminated, true);
    const w = view("EC-01-V1", cls);
    for (const code of ["S3", "S4"]) {
      const s = w.level1!.stages.find((x) => x.code === code)!;
      assert.deepEqual(
        [s.state, s.symbol],
        ["UNVERIFIED", UNVERIFIED_SYMBOL],
        `${cls} ${code} without history`,
      );
    }
  }
});

test("PG-15 the five-stage summary appears only on a linear journey that declares it, never for a recused seat, with the five stages", () => {
  let shown = 0;
  for (const { id, cls, v, r } of allViews()) {
    if (!v.level2) continue;
    const J = JOURNEYS.get(v.level2.journey_id)!;
    const may = J.summary5 === true && J.structure === "LINEAR" && v.audience !== "none";
    if (!may) assert.equal(v.level2.summary5, null, `${id} ${cls}`);
    else {
      assert.equal(v.level2.summary5!.length, 5, `${id} ${cls}`);
      shown++;
    }
    assert.equal(r.journey.summary5, J.summary5);
  }
  assert.ok(shown > 0, "a linear scenario shows the summary");
  for (const j of CAT.journeys) if (j.summary5) assert.equal(j.structure, "LINEAR", j.id);
});

test("PG-16 the notice marker («هذا الإشعار») points at a shown item, or says NOT_SHOWN when the recipient cannot see the notice's step", () => {
  for (const { id, cls, v } of allViews()) {
    if (!v.notice) continue;
    assert.deepEqual(v.notice.marker, NOTICE_MARKER);
    assert.equal(NOTICE_MARKER.ar, "هذا الإشعار");
    if (v.notice.location === "NOT_SHOWN") {
      assert.equal(v.notice.step_id, null);
      continue;
    }
    const items: { step_id: string; is_notice?: true }[] = [
      ...v.level3!.actual,
      ...v.level3!.expected,
      ...v.level3!.previous_round,
    ];
    const shown =
      items.some((x) => x.step_id === v.notice!.step_id) ||
      (v.notice.location === "stage" && v.level2!.stages.some((s) => s.n === v.notice!.stage));
    assert.ok(shown, `${id} ${cls}: marker on an item the recipient sees`);
    assert.ok(items.filter((x) => x.is_notice).length <= 1, `${id} ${cls}: one marker`);
  }
  const x = run("SUM-01");
  const l23: Level23Resolved = {
    ...x.r,
    notice_step: { ...x.r.notice_step!, step_id: "J-DR-AUTHORITY/5/1", location: "actual", stage: 5 },
  };
  assert.equal(
    buildProgressView(x.l1, l23, "AUTHORITY").notice!.location,
    "NOT_SHOWN",
    "a hidden step is never marked",
  );
  assert.equal(buildProgressView(x.l1, l23, "SECRETARY").notice!.step_id, "J-DR-AUTHORITY/5/1");
});

test("PG-17 deadlines: a date only with its recorded basis event and rule; otherwise no date and the reason (CF-37 grievance, CF-23b defence)", () => {
  for (const { id, cls, v } of allViews())
    for (const d of v.deadlines) {
      if (d.at !== null) {
        assert.ok(d.basis_event_id && d.rule_id, `${id} ${cls} ${d.kind}`);
        assert.ok(["RECORDED", "OWNER_DEFAULT"].includes(d.status), d.status);
      } else assert.ok(String(d.reason || "").length > 0, `${id} ${cls} ${d.kind}: no date and no reason`);
    }
  const g0 = view("CF-37", "SUBJECT").deadlines.find((d) => d.kind === "GRIEVANCE_DUE")!;
  assert.deepEqual([g0.at, g0.status, g0.basis_event_id], [null, "NO_BASIS_EVENT", null]);
  const g1 = view("CF-37-V1", "SUBJECT").deadlines.find((d) => d.kind === "GRIEVANCE_DUE")!;
  assert.ok(g1.at && g1.basis_event_id && g1.rule_id === "DEC-F15");
  assert.equal(view("CF-23b-V1", "SUBJECT").deadlines[0]!.at, null);
});

test("PG-18 interaction: Layer B collapsed and expandable on the platform (bilingual control), static and limited to the current stage in e-mail; the legend has the 8 states and 6 kinds", () => {
  const v = view("CF-18", "SECRETARY");
  assert.equal(v.interaction!.platform.layer_b, "COLLAPSED_EXPANDABLE");
  for (const k of ["control", "control_collapse"] as const)
    assert.ok(v.interaction!.platform[k].ar && v.interaction!.platform[k].en, k);
  assert.deepEqual(v.interaction!.email, { layer_b: "STATIC", scope: "CURRENT_STAGE" });
  assert.equal(v.legend.length, 14);
  assert.deepEqual(
    v.legend.filter((x) => x.layer === "A").map((x) => x.symbol),
    Object.values(SYMBOLS),
  );
  assert.ok(
    v.legend
      .filter((x) => x.layer === "B")
      .every((x) => x.symbol === EXPECTED_SYMBOL && x.style.outline === "dashed"),
  );
  assert.deepEqual(
    v.legend.filter((x) => x.layer === "B").map((x) => x.kind),
    Object.keys(KIND_LABELS),
  );
  for (const { id, cls, v: w } of allViews()) {
    if (!w.level3) continue;
    const n = w.level3.stage_n;
    assert.deepEqual(
      w.level3.current_stage.actual,
      w.level3.actual.filter((x) => x.stage === n),
      `${id} ${cls}`,
    );
    assert.deepEqual(
      w.level3.current_stage.expected,
      w.level3.expected.filter((x) => x.stage === n),
      `${id} ${cls}`,
    );
  }
});

test("PG-19 Level 1: later stages are expected stages (◇ «مرحلة متوقعة»); an unknown status code shows every stage as ? and marks none current", () => {
  const v = view("CF-18", "SECRETARY");
  for (const code of ["S4", "S5"]) {
    const s = v.level1!.stages.find((x) => x.code === code)!;
    assert.deepEqual([s.layer, s.symbol, s.kind_label], ["B", EXPECTED_SYMBOL, L1_EXPECTED_LABEL], code);
  }
  assert.equal(v.level1!.current!.code, "S3");
  const caseRecord = clone(run("CF-18").sc.case) as Mutable<CaseRecordInput> & { status: { code?: unknown } };
  caseRecord.status.code = "S9.99";
  const l1 = resolveLevel1(caseRecord, CAT);
  for (const cls of ["SECRETARY", "REPORTER"]) {
    const u = buildProgressView(l1, run("CF-18").r, cls);
    assert.equal(u.level1!.current, null);
    assert.ok(
      u.level1!.stages.every((s) => s.symbol === UNVERIFIED_SYMBOL && s.style.outline === "dotted"),
      cls,
    );
    assert.deepEqual(
      u.level1!.stages[0]!.state_label,
      (L1_UNVERIFIED_LABELS as Record<string, Bilingual>)[u.level1!.mode],
    );
    assert.ok(u.diagnostics.anomalies.some((a) => a.code === "UNKNOWN_STATUS_CODE"));
  }
});

test("PG-20 exceptions carry the exception indicator: ⏸ suspended, ↩ returned, ✕ cancelled, reopened and previously visited stages (internal only)", () => {
  const sus = view("SUS-01", "INVESTIGATOR");
  assert.ok(sus.level3!.actual.some((x) => x.symbol === "⏸"));
  assert.equal(sus.level2!.lifecycle!.suspended, true);
  const ret = view("RET-01", "SECRETARY");
  assert.ok(ret.level3!.actual.some((x) => x.symbol === "↩"));
  assert.ok(
    ret.level3!.previous_round.length > 0 &&
      ret.level3!.previous_round.every((p) => p.policy_field === "exception_indicator" && p.superseded_by),
  );
  const can = view("CF-25", "MEMBER");
  assert.equal(can.level3!.actual.filter((x) => x.symbol === "✕").length, 1);
  assert.equal(can.level3!.expected.length, 0);
  for (const { id, cls, v } of allViews())
    for (const s of v.level1?.stages || [])
      if (["SUSPENDED", "RETURNED", "CANCELLED", "FAILED"].includes(s.state as string))
        assert.equal(s.policy_field, "exception_indicator", `${id} ${cls} ${s.code}`);
  const reo = view("REO-01", "INVESTIGATOR");
  assert.ok(reo.level1!.stages.some((s) => s.reopened && s.policy_field === "exception_indicator"));
  assert.ok(
    reo.level1!.stages.some(
      (s) =>
        s.previously_visited &&
        s.note_label?.ar === NOTE_LABELS.PREVIOUSLY_VISITED.ar &&
        s.note_label?.en === NOTE_LABELS.PREVIOUSLY_VISITED.en,
    ),
  );
  const reoPublic = view("REO-01", "SUBJECT");
  assert.ok(
    !reoPublic.level1!.stages.some((s) => s.reopened || s.previously_visited),
    "stage-name recipients get no reopening detail",
  );
});

test("PG-21 the distinction survives without colour: symbol + text label + aria differ for every state and kind; colours are token names only", () => {
  const legend = view("CF-18", "SECRETARY").legend;
  const keys = legend.map((x) => `${x.symbol}|${x.label.ar}`);
  assert.equal(new Set(keys).size, legend.length, "Arabic symbol + label unique");
  assert.equal(
    new Set(legend.map((x) => `${x.symbol}|${x.label.en}`)).size,
    legend.length,
    "English symbol + label unique",
  );
  assert.ok(
    !A_SYMBOLS.has(EXPECTED_SYMBOL) &&
      !A_SYMBOLS.has(UNVERIFIED_SYMBOL) &&
      (EXPECTED_SYMBOL as string) !== UNVERIFIED_SYMBOL,
  );
  for (const [k, tok] of Object.entries(COLOUR_TOKENS)) assert.match(tok, /^progress\.[a-zA-Z]+$/, k);
  const outlines = new Set(legend.map((x) => x.style.outline));
  assert.deepEqual([...outlines].sort(), ["dashed", "solid"], "Layer A solid, Layer B dashed");
  for (const { id, cls, v } of allViews()) {
    const s = JSON.stringify(v);
    assert.ok(
      !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(s),
      `${id} ${cls}: a colour value in the view model`,
    );
  }
});

test("PG-22 the view model is deeply frozen and pure: same input, same output; inputs unchanged", () => {
  const isDeepFrozen = (o: unknown, path = ""): true | string => {
    if (!o || typeof o !== "object") return true;
    if (!Object.isFrozen(o)) return path;
    for (const [k, val] of Object.entries(o)) {
      const r = isDeepFrozen(val, `${path}.${k}`);
      if (r !== true) return r;
    }
    return true;
  };
  for (const x of RUNS)
    for (const cls of CLASSES) {
      const before = JSON.stringify([x.l1, x.r]);
      const v1 = buildProgressView(x.l1, x.r, cls);
      const v2 = buildProgressView(x.l1, x.r, cls);
      assert.equal(JSON.stringify(v1), JSON.stringify(v2), `${x.id} ${cls}`);
      assert.equal(JSON.stringify([x.l1, x.r]), before, `${x.id} ${cls}: input changed`);
      const fr = isDeepFrozen(v1);
      assert.equal(fr, true, `${x.id} ${cls}: not frozen at ${fr}`);
    }
});
