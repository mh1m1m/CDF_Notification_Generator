/**
 * RI — the renderers' wording lives in the i18n namespace `notificationRender` (V13-PROC-007, OI-036; CLAUDE.md §9).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ar as AR } from "@/lib/i18n/notificationRender/ar";
import { en as EN } from "@/lib/i18n/notificationRender/en";
import { I18N_NAMESPACES } from "@/lib/i18n";
import * as I from "@/lib/notifications/render/i18n";

const RENDER_DIR = join(process.cwd(), "lib", "notifications", "render");
const ARABIC = /[؀-ۿ]/;
/** code lines only: block-comment bodies (` * …`), `//` comments and trailing `// …` are not wording */
const codeOf = (line: string): string => {
  const t = line.trim();
  if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) return "";
  const i = line.indexOf(" // ");
  return i >= 0 ? line.slice(0, i) : line;
};

test("RI-01 no Arabic wording is written in the renderer code; it comes from lib/i18n/notificationRender", () => {
  const hits: string[] = [];
  for (const f of readdirSync(RENDER_DIR).filter((n) => n.endsWith(".ts")))
    readFileSync(join(RENDER_DIR, f), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (ARABIC.test(codeOf(line))) hits.push(`${f}:${i + 1}`);
      });
  assert.deepEqual(hits, []);
});

test("RI-02 the namespace is registered, and every bilingual renderer text is a dictionary entry in both languages", () => {
  assert.equal(I18N_NAMESPACES.notificationRender.ar, AR);
  assert.equal(I18N_NAMESPACES.notificationRender.en, EN);
  const arTexts = new Set<string>(Object.values(AR));
  const enTexts = new Set<string>(Object.values(EN));
  let n = 0;
  const walk = (v: unknown, path: string): void => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.ar === "string" && typeof o.en === "string") {
      n++;
      assert.ok(arTexts.has(o.ar), `${path}.ar`);
      assert.ok(enTexts.has(o.en), `${path}.en`);
    }
    for (const [k, x] of Object.entries(o)) if (k !== "ar" && k !== "en") walk(x, `${path}.${k}`);
  };
  for (const name of [
    "LAYER_A",
    "LAYER_B",
    "S",
    "CONFIDENTIALITY",
    "HELP_STATIC",
    "CLASSIFICATION",
    "DELIVERY",
  ] as const)
    walk(I[name], name);
  assert.ok(n >= 120, `${n} bilingual texts checked`);
  assert.equal(I.MARKING, AR.marking);
  assert.equal(I.MARKING_SUBJECT_PREFIX, AR.markingSubjectPrefix);
});

test("RI-03 symbols, the marking and the subject prefix are the same in both languages", () => {
  for (const k of Object.keys(AR) as (keyof typeof AR)[])
    if (k.endsWith(".sym") || k === "marking" || k === "markingSubjectPrefix") assert.equal(EN[k], AR[k], k);
});
