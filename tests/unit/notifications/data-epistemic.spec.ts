/**
 * DE: the notification documents' data-epistemic vocabulary (V13-PROC-011). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
 * The list QA's Truth Inspector imports must hold every value the renderer writes, over the whole reference set.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DATA_EPISTEMIC_FALLBACK,
  DATA_EPISTEMIC_VALUES,
  dataEpistemicFor,
  isDataEpistemic,
} from "@/lib/notifications/data-epistemic";
import { EPISTEMIC_CLASSES } from "@/lib/domain/epistemic";
import { COMPONENTS } from "@/lib/notifications/render/components";
import { loadTokens } from "@/lib/notifications/render/tokens";
import * as Mo from "@/lib/notifications/render/model";
import { loadPolicy, project } from "@/lib/disclosure/project";
import { loadAuthority } from "@/lib/authority/check";
import { inlineScenarios } from "@/tests/unit/notifications/support/scenarios_inline";
import * as B from "@/tests/unit/notifications/support/build_demo";
import type { Scenario } from "@/lib/notifications/render/types";

const ATTR = /data-epistemic="([^"]*)"/g;
const valuesIn = (html: string): string[] => [...html.matchAll(ATTR)].map((m) => m[1] ?? "");

test("DE-01 the vocabulary is the charter's seven classes plus GENERALIZED, frozen and without duplicates", () => {
  assert.deepEqual([...DATA_EPISTEMIC_VALUES], [...EPISTEMIC_CLASSES, "GENERALIZED"]);
  assert.ok(Object.isFrozen(DATA_EPISTEMIC_VALUES));
  assert.equal(new Set(DATA_EPISTEMIC_VALUES).size, DATA_EPISTEMIC_VALUES.length);
  assert.ok(isDataEpistemic(DATA_EPISTEMIC_FALLBACK));
  for (const bad of ["recorded_fact", "RECORDED_FACT ", "", null, undefined, 1])
    assert.equal(isDataEpistemic(bad), false);
});

test("DE-02 every data-epistemic value in the rendered reference set (516 files) is in the vocabulary", async () => {
  const sel = B.selectScenarios();
  const wd1 = await B.loadWd1();
  const { files } = B.renderAll({ scenarios: sel.scenarios, consistency: wd1.fn });
  assert.equal(files.length, 516);
  const seen = new Map<string, number>();
  for (const f of files)
    for (const v of valuesIn(f.content)) {
      assert.ok(isDataEpistemic(v), `${f.file}: data-epistemic="${v}" is not in the vocabulary`);
      seen.set(v, (seen.get(v) ?? 0) + 1);
    }
  // not vacuous: the reference set does carry the attribute
  assert.ok((seen.get("RECORDED_FACT") ?? 0) > 0, JSON.stringify([...seen]));
});

test("DE-03 dataEpistemicFor: generalised wins, a charter class passes, anything else falls back", () => {
  assert.equal(dataEpistemicFor(undefined, false), "RECORDED_FACT");
  assert.equal(dataEpistemicFor(null, false), "RECORDED_FACT");
  assert.equal(dataEpistemicFor("RECORDED_FACT", true), "GENERALIZED");
  for (const c of EPISTEMIC_CLASSES) assert.equal(dataEpistemicFor(c, false), c);
  for (const bad of ["GENERALIZED", "FACT", "recorded_fact", "<b>", 7, {}])
    assert.equal(dataEpistemicFor(bad, false), DATA_EPISTEMIC_FALLBACK, String(bad));
});

test("DE-04 the EventSummary component writes only vocabulary values, and an unknown class never claims a recorded fact", () => {
  const policy = loadPolicy();
  const authority = loadAuthority();
  const tokens = loadTokens();
  const base = inlineScenarios().find((x) => x.id === "CF-27");
  assert.ok(base);
  const r = base.recipients.find((x) => x.class === "MEMBER");
  assert.ok(r);
  const render = (epistemic: unknown) => {
    const s: Scenario = {
      ...base,
      content: { ...base.content, event_summary: { ...base.content?.event_summary, epistemic } },
    } as Scenario;
    const catalogue = Mo.loadCatalogue({ needs: [s.object?.journey_id ?? ""] });
    const model = Mo.buildNotificationModel(s, r, { lang: "en", authority, catalogue });
    const p = project(model, {
      recipient: "MEMBER",
      channel: "PLATFORM",
      context: model.meta.context,
      policy,
    });
    const out = COMPONENTS.EventSummary(p, {
      lang: "en",
      density: "STANDARD",
      experience: "PLATFORM",
      tokens,
    });
    assert.ok(out);
    return out.html;
  };
  const tagged = (html: string) => html.includes("(Recorded fact)") || html.includes("(recorded fact)");
  const fact = render(undefined);
  assert.deepEqual(valuesIn(fact), ["RECORDED_FACT"]);
  assert.ok(tagged(fact), "a recorded fact keeps its label");
  const expected = render("EXPECTED_PROCESS");
  assert.deepEqual(valuesIn(expected), ["EXPECTED_PROCESS"]);
  assert.ok(!tagged(expected));
  for (const bad of ["MADE_UP", "GENERALIZED", '" onload="x']) {
    const html = render(bad);
    assert.deepEqual(valuesIn(html), [DATA_EPISTEMIC_FALLBACK], bad);
    assert.ok(!tagged(html), bad);
  }
});

test("DE-05 the vocabulary module is importable outside the server (no server-only marker, no imports)", () => {
  const src = readFileSync(join(process.cwd(), "lib", "notifications", "data-epistemic.ts"), "utf8");
  assert.ok(!/["']server-only["']/.test(src));
  assert.ok(!/^\s*import\s/m.test(src));
});
