// REG — regression: the V12 capabilities V13 must keep (directive §25 anti-regression rules; charter §4, §12).
// Author: lead. Reads the V12 evidence read-only; runs the V12 engine suite on a temporary copy only.
// Synthetic-data reference implementation; not CDF production.
// Ported from tests/regression.test.js (node:test → Vitest). Port notes:
//  - the V12 evidence the reference read from notifications/journeys/ is copied unchanged into __evidence__/journeys/, and the
//    hash ledger (reference work/) into __evidence__/; the V13 catalogue is the port's @/lib/journeys/catalogue_v13.json;
//  - the reference read out/demo/MANIFEST.json and the files it lists from disk (written by `node src/demo/build_demo.js`);
//    the port builds the same demo IN MEMORY with buildDemo() (support/build_demo.ts — same scenarios, policy, authority,
//    tokens and W-D1 engine as the reference CLI), parses its MANIFEST JSON text and reads each listed file from the
//    in-memory contents map;
//  - REG-13 is NOT PORTED (the V12 generator and its engine suite are not part of this repository), see there;
//  - REG-14 checks the ledger rows whose files are in __evidence__/ (journeys/); generator/source/ rows are reported, see there.
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import V13_CATALOGUE from "@/lib/journeys/catalogue_v13.json";
import { buildDemo } from "@/tests/unit/notifications/support/build_demo";
import { isNil } from "@/lib/domain/nil";

const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "__evidence__");
const PKG = EVIDENCE; // the reference's notifications/ (V12 evidence, read-only) → the copies in __evidence__/
const V12_CAT = join(PKG, "journeys", "level2_journeys.json");
const LEDGER = join(EVIDENCE, "v12_package_sha256_ledger_2026-10-27T1325Z.csv");

interface Bi {
  ar?: string;
  en?: string;
}
interface V12Catalogue {
  journeys: {
    id: string;
    object_ar?: string;
    object_en?: string;
    capacity_ar?: string;
    capacity_en?: string;
    stages: { n: number; ar?: string }[];
  }[];
  assignments: { id: string; journey: string; stage: number }[];
  master: { code: string; ar?: string; en?: string }[];
  master_sub_en: Record<string, string>;
}
interface V13Catalogue {
  journeys?: {
    id: string;
    renamed_from?: string;
    object?: Bi;
    capacity?: Bi;
    wording_change?: { reason?: string };
    stages?: {
      n: number;
      ar?: string;
      en?: string;
      v12_stage?: number | number[] | null;
      steps?: { id: string; ar?: string; en?: string }[];
    }[];
    removed_v12_stages?: { n: number; reason?: string }[];
  }[];
  assignments?: {
    id: string;
    journey: string;
    stage: number;
    step_id?: string | null;
    changed_from?: { reason?: string };
  }[];
  master?: { code: string; ar?: string; en?: string }[];
  master_sub?: Record<string, Bi | undefined>;
}
interface ManifestEntry {
  file: string;
  scenario?: string;
  recipient?: string;
  density?: string;
  surface?: string;
  sha256?: string;
  lang?: string;
}

const readJSON = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
const v12 = readJSON(V12_CAT) as V12Catalogue;
// the catalogue JSON read through the fields this file checks (open shape)
const v13: V13Catalogue | null = (V13_CATALOGUE as unknown as V13Catalogue | null) ?? null;
// in-memory demo build (replaces out/demo/ on disk; see the header)
const DEMO_BUILD = await buildDemo();
const manifestRaw = JSON.parse(DEMO_BUILD.manifestJson) as
  ManifestEntry[] | { files?: ManifestEntry[] } | null;
const entries: ManifestEntry[] = manifestRaw
  ? Array.isArray(manifestRaw)
    ? manifestRaw
    : manifestRaw.files || []
  : [];
const AR = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;
const INTERNAL = new Set([
  "SECRETARY",
  "CHAIR",
  "MEMBER",
  "INVESTIGATOR",
  "LEGAL_REVIEWER",
  "AUTHORITY",
  "RESTRICTED_CASE_AUTHORITY",
]);

/** port: returns the checked catalogue (each test shadows `v13` with it, so the checks below read it as present) */
function needCatalogue(): V13Catalogue {
  assert.ok(
    v13,
    `src/journeys/catalogue_v13.json not found: the V13 catalogue is missing, so this regression check cannot pass`,
  );
  return v13;
}
function needManifest(): void {
  assert.ok(manifestRaw, `out/demo/MANIFEST.json not found: no demo output to check`);
  assert.ok(entries.length > 0, "out/demo/MANIFEST.json has no entries");
}
const v13Journeys = () => new Map((v13?.journeys || []).map((j) => [j.id, j]));
const renameMap = () =>
  new Map((v13?.journeys || []).filter((j) => j.renamed_from).map((j) => [j.renamed_from as string, j.id]));
const resolveJourney = (id: string): string => renameMap().get(id) || id;
const read = (rel: string): string => {
  const c = DEMO_BUILD.contents.get(rel);
  assert.ok(c !== undefined, `${rel}: listed in the manifest but not built`);
  return c;
};
const sha256 = (buf: Uint8Array | string): string => createHash("sha256").update(buf).digest("hex");

test("REG-01 every V12 journey id (22) is kept in V13 or carries a recorded rename", () => {
  needCatalogue();
  assert.equal(v12.journeys.length, 22, "V12 baseline must have 22 journeys");
  const js = v13Journeys();
  const missing = v12.journeys.map((j) => j.id).filter((id) => !js.has(resolveJourney(id)));
  assert.deepEqual(
    missing,
    [],
    `V12 journeys missing from V13 without a recorded rename: ${missing.join(", ")}`,
  );
});

test("REG-02 every V12 assignment id (112) is kept in V13, ids unique", () => {
  const v13 = needCatalogue();
  assert.equal(v12.assignments.length, 112, "V12 baseline must have 112 assignments");
  const ids = (v13.assignments || []).map((a) => a.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dup, [], `duplicate assignment ids in V13: ${[...new Set(dup)].join(", ")}`);
  const have = new Set(ids);
  const missing = v12.assignments.map((a) => a.id).filter((id) => !have.has(id));
  assert.deepEqual(missing, [], `V12 assignments missing from V13: ${missing.join(", ")}`);
});

test("REG-03 every V13 assignment points to an existing journey, stage and step", () => {
  const v13 = needCatalogue();
  const js = v13Journeys();
  const bad: string[] = [];
  for (const a of v13.assignments || []) {
    const j = js.get(a.journey);
    if (!j) {
      bad.push(`${a.id}: journey ${a.journey} not found`);
      continue;
    }
    const st = (j.stages || []).find((s) => s.n === a.stage);
    if (!st) {
      bad.push(`${a.id}: stage ${a.stage} not in ${a.journey}`);
      continue;
    }
    if (!isNil(a.step_id)) {
      if (!String(a.step_id).startsWith(`${a.journey}/${a.stage}/`))
        bad.push(`${a.id}: step_id ${a.step_id} not under ${a.journey}/${a.stage}/`);
      else if (!(st.steps || []).some((s) => s.id === a.step_id))
        bad.push(`${a.id}: step ${a.step_id} not found`);
    }
  }
  assert.deepEqual(bad, [], bad.slice(0, 15).join("; "));
});

test("REG-04 a V12 assignment changes journey or stage only with a recorded reason", () => {
  const v13 = needCatalogue();
  const byId = new Map((v13.assignments || []).map((a) => [a.id, a]));
  const silent: string[] = [],
    recorded: string[] = [];
  for (const a12 of v12.assignments) {
    const a13 = byId.get(a12.id);
    if (!a13) continue; // REG-02 reports missing ids
    const sameJourney = a13.journey === resolveJourney(a12.journey);
    const sameStage = a13.stage === a12.stage;
    if (sameJourney && sameStage) continue;
    const cf = a13.changed_from;
    if (cf && cf.reason && String(cf.reason).trim()) recorded.push(a12.id);
    else silent.push(`${a12.id} (${a12.journey}/${a12.stage} → ${a13.journey}/${a13.stage})`);
  }
  console.warn(
    "[diagnostic]",
    `recorded journey/stage changes: ${recorded.length}${recorded.length ? " — " + recorded.join(", ") : ""}`,
  );
  assert.deepEqual(silent, [], `silent changes: ${silent.slice(0, 15).join("; ")}`);
});

test("REG-05 Level-2 wording per notification object and recipient capacity is kept (or the change is recorded)", () => {
  needCatalogue();
  const js = v13Journeys();
  const silent: string[] = [],
    recorded: string[] = [];
  for (const j12 of v12.journeys) {
    const j = js.get(resolveJourney(j12.id));
    if (!j) continue; // REG-01 reports missing journeys
    const same =
      j.object?.ar === j12.object_ar &&
      j.object?.en === j12.object_en &&
      j.capacity?.ar === j12.capacity_ar &&
      j.capacity?.en === j12.capacity_en;
    if (same) continue;
    if (j.wording_change && String(j.wording_change.reason || "").trim()) recorded.push(j.id);
    else silent.push(j.id);
  }
  console.warn(
    "[diagnostic]",
    `recorded wording changes: ${recorded.length}${recorded.length ? " — " + recorded.join(", ") : ""}`,
  );
  assert.deepEqual(
    silent,
    [],
    `journeys whose object/capacity wording changed silently: ${silent.join(", ")}`,
  );
});

test("REG-06 every V12 stage of every journey is carried by a V13 stage or recorded as removed", () => {
  needCatalogue();
  const js = v13Journeys();
  const lost: string[] = [];
  for (const j12 of v12.journeys) {
    const j = js.get(resolveJourney(j12.id));
    if (!j) continue;
    const carried = new Set<number>();
    for (const s of j.stages || [])
      for (const n of ([] as (number | null)[]).concat(s.v12_stage ?? []))
        if (!isNil(n)) carried.add(Number(n));
    for (const r of j.removed_v12_stages || [])
      if (r && String(r.reason || "").trim()) carried.add(Number(r.n));
    for (const s12 of j12.stages)
      if (!carried.has(Number(s12.n))) lost.push(`${j12.id} stage ${s12.n} «${s12.ar}»`);
  }
  assert.deepEqual(lost, [], `V12 stages with no V13 trace: ${lost.slice(0, 15).join("; ")}`);
});

test("REG-07 the master journey keeps the five V8 stages S1–S5 and the 28 sub-states, bilingual", () => {
  const v13 = needCatalogue();
  const m = v13.master || [];
  assert.deepEqual(
    m.map((x) => x.code),
    v12.master.map((x) => x.code),
    "master codes differ from V12",
  );
  for (const x of m) {
    const o = v12.master.find((y) => y.code === x.code);
    assert.equal(x.ar, o?.ar, `${x.code} Arabic name differs from V12`);
    assert.equal(x.en, o?.en, `${x.code} English name differs from V12`);
  }
  const sub = v13.master_sub || {};
  assert.deepEqual(
    Object.keys(sub).sort(),
    Object.keys(v12.master_sub_en).sort(),
    "master_sub keys differ from the V12 28 sub-states",
  );
  const bad = Object.entries(sub)
    .filter(([k, v]) => !(v && AR.test(v.ar || "") && v.en === v12.master_sub_en[k]))
    .map(([k]) => k);
  assert.deepEqual(bad, [], `sub-states without Arabic or with changed English: ${bad.join(", ")}`);
});

test("REG-08 the catalogue is bilingual: every journey, stage and step has Arabic and English", () => {
  const v13 = needCatalogue();
  const bad: string[] = [];
  for (const j of v13.journeys || []) {
    if (!AR.test(j.object?.ar || "") || !LATIN.test(j.object?.en || "")) bad.push(`${j.id} object`);
    if (!AR.test(j.capacity?.ar || "") || !LATIN.test(j.capacity?.en || "")) bad.push(`${j.id} capacity`);
    for (const s of j.stages || []) {
      if (!AR.test(s.ar || "") || !LATIN.test(s.en || "")) bad.push(`${j.id} stage ${s.n}`);
      for (const st of s.steps || [])
        if (!AR.test(st.ar || "") || !LATIN.test(st.en || "")) bad.push(`${st.id}`);
    }
  }
  assert.deepEqual(bad, [], `missing Arabic or English: ${bad.slice(0, 20).join("; ")}`);
});

test("REG-09 three levels on every internal card: each internal-recipient demo output shows Level 1, 2 and 3", () => {
  needManifest();
  const cards = entries.filter(
    (e) =>
      INTERNAL.has(String(e.recipient || "").toUpperCase()) &&
      /PLATFORM|EMAIL_HTML/i.test(String(e.surface || "")),
  );
  assert.ok(cards.length > 0, "no internal-recipient platform or e-mail HTML outputs in the manifest");
  const bad: string[] = [];
  for (const e of cards) {
    const h = read(e.file);
    const levels = [1, 2, 3].filter((n) => h.includes(`data-level="${n}"`));
    if (levels.length !== 3) bad.push(`${e.file}: levels ${levels.join(",") || "none"}`);
  }
  console.warn("[diagnostic]", `internal outputs checked: ${cards.length}`);
  assert.deepEqual(bad, [], bad.slice(0, 15).join("; "));
});

test("REG-10 a witness never sees Level 1 (owner rule kept from V12)", () => {
  needManifest();
  const w = entries.filter((e) => String(e.recipient || "").toUpperCase() === "WITNESS");
  assert.ok(w.length > 0, "no witness output in the manifest");
  const L1 = v12.master.flatMap((m) => [m.ar, m.en]).filter((x): x is string => typeof x === "string");
  const bad: string[] = [];
  for (const e of w) {
    const h = read(e.file);
    if (h.includes('data-level="1"')) bad.push(`${e.file}: Level-1 section`);
    for (const s of L1) if (h.includes(s)) bad.push(`${e.file}: «${s}»`);
  }
  console.warn("[diagnostic]", `witness outputs checked: ${w.length}`);
  assert.deepEqual(bad, [], bad.slice(0, 15).join("; "));
});

test("REG-11 every e-mail HTML has a plain-text twin carrying the synthetic marking", () => {
  needManifest();
  const key = (e: ManifestEntry): string => [e.scenario, e.recipient, e.density, e.lang || ""].join("|");
  const texts = new Map(
    entries.filter((e) => /EMAIL_TEXT/i.test(String(e.surface || ""))).map((e) => [key(e), e]),
  );
  const html = entries.filter((e) => /EMAIL_HTML/i.test(String(e.surface || "")));
  assert.ok(html.length > 0, "no e-mail HTML outputs in the manifest");
  const bad: string[] = [];
  for (const e of html) {
    const tw = texts.get(key(e));
    if (!tw) {
      bad.push(`${e.file}: no text twin`);
      continue;
    }
    const tx = read(tw.file);
    if (tx.trim().length < 40) bad.push(`${tw.file}: empty text twin`);
    if (!/بيانات اصطناعية|SYNTHETIC/i.test(tx)) bad.push(`${tw.file}: no synthetic marking`);
  }
  assert.deepEqual(bad, [], bad.slice(0, 15).join("; "));
});

test("REG-12 the demo is bilingual: Arabic RTL and English LTR outputs both exist, each HTML declares lang and dir", () => {
  needManifest();
  const html = entries.filter((e) => /\.html?$/i.test(String(e.file || "")));
  assert.ok(html.length > 0, "no HTML outputs in the manifest");
  let ar = 0,
    en = 0;
  const bad: string[] = [];
  for (const e of html) {
    const h = read(e.file);
    const lang = (h.match(/<html[^>]*\blang="([a-zA-Z-]+)"/) || [])[1];
    const dir = (h.match(/<html[^>]*\bdir="(rtl|ltr)"/) || [])[1];
    if (!lang || !dir) {
      bad.push(`${e.file}: <html> lacks lang or dir`);
      continue;
    }
    if (lang.startsWith("ar") && dir === "rtl") ar++;
    else if (lang.startsWith("en") && dir === "ltr") en++;
    else bad.push(`${e.file}: lang ${lang} with dir ${dir}`);
  }
  assert.deepEqual(bad, [], bad.slice(0, 15).join("; "));
  assert.ok(ar > 0 && en > 0, `Arabic RTL outputs ${ar}, English LTR outputs ${en}`);
});

// REG-13 'the V12 engine suite still passes on an untouched copy (86 tests)' is NOT PORTED (docs/teams/proc/PORT_PLAN.md §5):
// it copies the V12 generator (part of the 437 MB V12 package) and runs its 86-test engine suite. Neither is part of this
// repository, so the test stays in the reference package only. It is not skipped here: it does not exist here.

// Port: the ledger rows are checked against the evidence copies in __evidence__/. The journeys/ rows (the V12 journey
// catalogue and its build scripts) are all copied and verified byte for byte (size + sha256). The generator/source/ rows
// (the V12 engine sources, see REG-13) are not in the repository: they are counted and reported as a diagnostic, not
// verified — this check therefore covers the V12 journey catalogue only.
test("REG-14 the V12 journey catalogue and engine sources are unchanged since the first review (hash ledger)", () => {
  assert.ok(existsSync(LEDGER), "hash ledger not found in work/");
  const rows = readFileSync(LEDGER, "utf8")
    .replace(/^\uFEFF/, "")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","));
  const subset = rows.filter((r) => /^(journeys\/|generator\/source\/)/.test(r[0] ?? ""));
  assert.ok(subset.length > 0, "no journeys/ or generator/source/ rows in the ledger");
  const inRepo = subset.filter((r) => (r[0] ?? "").startsWith("journeys/"));
  const notInRepo = subset.filter((r) => !(r[0] ?? "").startsWith("journeys/"));
  assert.ok(inRepo.length > 0, "no journeys/ rows in the ledger");
  const changed: string[] = [];
  for (const r of inRepo) {
    const p = join(PKG, r[0] ?? "");
    if (!existsSync(p)) {
      changed.push(`${r[0]}: missing`);
      continue;
    }
    if (statSync(p).size !== Number(r[2]) || sha256(readFileSync(p)) !== r[3])
      changed.push(`${r[0]}: changed`);
  }
  console.warn(
    "[diagnostic]",
    `ledger rows verified: ${inRepo.length} (journeys/); not verified, not in the repository: ${notInRepo.length} (generator/source/)`,
  );
  assert.deepEqual(changed, [], changed.slice(0, 15).join("; "));
});
