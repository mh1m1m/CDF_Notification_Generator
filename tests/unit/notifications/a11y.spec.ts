/**
 * A11Y — accessibility of the rendered outputs (W-D2; charter §11; protocol §42 Arabic RTL / English LTR; WCAG 2.1 AA as the
 * design target — this file checks structure statically; no screen reader, browser or e-mail client was used, so client
 * behaviour stays UNVERIFIED). SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Ported from tests/a11y.test.js (node:test → Vitest).
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { loadTokens, TEXT_PAIRS, contrastRatio, V12_COLORS } from "@/lib/notifications/render/tokens";
import { platformCss } from "@/lib/notifications/render/platform";
import { LAYER_A, LAYER_B } from "@/lib/notifications/render/i18n";
import { inlineScenarios } from "@/tests/unit/notifications/support/scenarios_inline";
import * as B from "@/tests/unit/notifications/support/build_demo";

const tokens = loadTokens();
const SCENARIOS = inlineScenarios();
const DEMO = B.renderAll({ scenarios: SCENARIOS, tokens });
const HTML = DEMO.files.filter((f) => f.surface === "EMAIL_HTML" || f.surface === "PLATFORM");
const PLATFORM = HTML.filter((f) => f.surface === "PLATFORM");
const EMAIL = HTML.filter((f) => f.surface === "EMAIL_HTML");
const CSS = platformCss(tokens);
const textOf = (h: string): string =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
type Words = Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;
const wordsOf = (table: Words, key: string, lang: string): string => {
  const w = table[key]?.[lang];
  return typeof w === "string" ? w : `«no wording for ${key}/${lang}»`;
};
/** elements (outer HTML) with the given attribute marker; nested same-tag elements are not used by the renderer for these */
function elementsWith(h: string, attrRe: RegExp): string[] {
  const out: string[] = [];
  for (const m of h.matchAll(new RegExp(`<(li|p|div|td|span|tr)\\b[^>]*${attrRe.source}[^>]*>`, "g"))) {
    const tag = m[1] ?? "";
    const start = m.index;
    const close = `</${tag}>`;
    let depth = 0;
    let i = start;
    const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
    re.lastIndex = start;
    for (let x = re.exec(h); x; x = re.exec(h)) {
      if (x[0] === close) {
        depth--;
        if (depth === 0) {
          i = x.index + close.length;
          break;
        }
      } else depth++;
    }
    out.push(h.slice(start, i));
  }
  return out;
}

test("A11Y-01 every page declares its language and direction (ar/rtl, en/ltr) consistently with the manifest, a charset, a viewport and a non-empty title", () => {
  assert.ok(HTML.length > 150);
  for (const f of HTML) {
    const h = f.content;
    assert.ok(h.startsWith("<!DOCTYPE html>"), `${f.file}: doctype`);
    const m = h.match(/<html lang="(ar|en)" dir="(rtl|ltr)">/);
    assert.ok(m, `${f.file}: <html lang dir>`);
    assert.equal(m[1], f.lang, `${f.file}: lang = manifest lang`);
    assert.equal(m[2], f.lang === "ar" ? "rtl" : "ltr", `${f.file}: dir follows lang`);
    assert.match(h, /<meta charset="utf-8">/i, f.file);
    assert.match(h, /<meta name="viewport" content="width=device-width, initial-scale=1">/, f.file);
    const t = h.match(/<title>([^<]*)<\/title>/);
    assert.ok(t && (t[1] ?? "").trim().length > 3, `${f.file}: title`);
  }
  // both languages and both directions are produced for every surface
  for (const s of ["EMAIL_HTML", "PLATFORM"])
    for (const l of ["ar", "en"])
      assert.ok(
        HTML.some((f) => f.surface === s && f.lang === l),
        `${s} ${l}`,
      );
});

test("A11Y-02 headings: exactly one h1 (the event title) per page and no skipped level (h1 → h2 → h3, nothing deeper)", () => {
  for (const f of HTML) {
    const levels = [...f.content.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    assert.equal(levels.filter((l) => l === 1).length, 1, `${f.file}: one h1`);
    assert.equal(levels[0], 1, `${f.file}: the first heading is the h1`);
    for (let i = 1; i < levels.length; i++)
      assert.ok((levels[i] ?? 0) <= (levels[i - 1] ?? 0) + 1, `${f.file}: h${levels[i - 1]} → h${levels[i]}`);
    assert.ok(Math.max(...levels) <= 3, `${f.file}: no heading deeper than h3`);
    for (const m of f.content.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/g))
      assert.ok(textOf(m[2] ?? "").length > 1, `${f.file}: empty h${m[1]}`);
  }
});

test('A11Y-03 state is never conveyed by symbol or colour alone: every symbol is role="img" with a label, and every progress item also states its state or kind in words', () => {
  let items = 0;
  for (const f of HTML) {
    const lang = f.lang;
    for (const m of f.content.matchAll(/<span role="img" aria-label="([^"]*)"[^>]*>([^<]*)<\/span>/g)) {
      assert.ok((m[1] ?? "").trim().length > 1, `${f.file}: empty aria-label on ${m[2]}`);
      assert.ok((m[2] ?? "").trim().length >= 1, `${f.file}: symbol span without a glyph`);
    }
    // a glyph used as a status symbol outside a labelled span is not allowed
    const stripped = f.content.replace(/<span role="img"[^>]*>[^<]*<\/span>/g, "");
    for (const g of ["✔", "●", "○", "⏸", "↩", "✕", "⚠", "◇"])
      assert.ok(!textOf(stripped).includes(g), `${f.file}: unlabelled ${g}`);
    for (const el of elementsWith(f.content, /data-layer="actual" data-state="([A-Z_]+)"/)) {
      const st = el.match(/data-state="([A-Z_]+)"/)?.[1] ?? "";
      const w = wordsOf(LAYER_A, st, lang);
      assert.ok(textOf(el).includes(w), `${f.file}: actual item ${st} without the words «${w}»`);
      items++;
    }
    for (const el of elementsWith(f.content, /data-layer="expected" data-kind="([A-Z_]+)"/)) {
      const k = el.match(/data-kind="([A-Z_]+)"/)?.[1] ?? "";
      const w = wordsOf(LAYER_B, k, lang);
      assert.ok(textOf(el).includes(w), `${f.file}: expected item ${k} without the words «${w}»`);
      items++;
    }
  }
  assert.ok(items > 1000, `progress items checked: ${items}`);
});

test("A11Y-04 colour contrast: every text/background token pair reaches 4.5:1 (WCAG 1.4.3) and the Layer B dashed border 3:1 (1.4.11); colours used inline in e-mail are token colours", () => {
  for (const [fg, bg, use] of TEXT_PAIRS) {
    const r = contrastRatio(tokens.colors[fg], tokens.colors[bg]);
    assert.ok(r >= 4.5, `${use}: ${fg} ${tokens.colors[fg]} on ${bg} ${tokens.colors[bg]} = ${r.toFixed(2)}`);
  }
  assert.ok(contrastRatio(tokens.colors.textMuted, tokens.colors.layerBBg) >= 3, "Layer B border");
  assert.ok(contrastRatio(tokens.colors.info, tokens.colors.bg) >= 3, "focus outline against the panel");
  assert.equal(contrastRatio("#000000", "#FFFFFF").toFixed(1), "21.0");
  const palette = new Set(Object.values(tokens.colors).map((x) => x.toUpperCase()));
  for (const f of EMAIL)
    for (const m of f.content.matchAll(/(?:^|[;"\s])(?:color|background-color):\s*(#[0-9A-Fa-f]{6})/g))
      assert.ok(palette.has((m[1] ?? "").toUpperCase()), `${f.file}: colour ${m[1]} outside the tokens`);
  // the V12 fallback palette itself passes (used whenever W-E tokens are absent or fail contrast)
  for (const [fg, bg, use] of TEXT_PAIRS)
    assert.ok(contrastRatio(V12_COLORS[fg], V12_COLORS[bg]) >= 4.5, `V12 ${use}`);
});

test("A11Y-05 no motion, relative units and logical properties on the platform; e-mail text alignment follows the language direction", () => {
  assert.doesNotMatch(CSS, /animation|transition|@keyframes|marquee|blink/i);
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)/);
  for (const m of CSS.matchAll(/font-size:([^;}]+)/g))
    assert.match(m[1] ?? "", /^(\d+(\.\d+)?rem|100%|1em)$/, `font-size ${m[1]}`);
  assert.doesNotMatch(CSS, /(margin|padding|border)-(left|right)\s*:/, "physical margin/padding/border");
  assert.doesNotMatch(CSS, /(^|[;{])\s*(left|right)\s*:/, "physical left/right offsets");
  assert.doesNotMatch(CSS, /text-align:\s*(left|right)/, "physical text alignment");
  for (const f of PLATFORM)
    assert.doesNotMatch(
      f.content.replace(/<style>[\s\S]*?<\/style>/, ""),
      /style="/,
      `${f.file}: inline style on the platform`,
    );
  for (const f of EMAIL) {
    const want = f.lang === "ar" ? "right" : "left";
    const wrong = f.lang === "ar" ? "left" : "right";
    assert.match(f.content, new RegExp(`text-align:${want}`), `${f.file}: text-align:${want}`);
    assert.doesNotMatch(
      f.content,
      new RegExp(`text-align:${wrong}`),
      `${f.file}: text-align:${wrong} in a ${f.lang} e-mail`,
    );
    assert.doesNotMatch(f.content, /animation|transition|<marquee|<blink/i, f.file);
  }
});

test("A11Y-06 platform landmarks: skip link first, banner, main (labelled by the h1), contentinfo; every section is labelled by an existing heading; ids are unique", () => {
  for (const f of PLATFORM) {
    const h = f.content;
    const body = h.slice(h.indexOf("<body>") + 6).trimStart();
    assert.ok(body.startsWith('<a class="skip" href="#ntf-main">'), `${f.file}: skip link first in the body`);
    assert.match(h, /<header role="banner">/);
    assert.match(h, /<footer class="foot" role="contentinfo">/);
    assert.match(h, /<main id="ntf-main" class="page" tabindex="-1" aria-labelledby="ntf-title">/, f.file);
    assert.match(h, /<h1 [^>]*id="ntf-title"/, `${f.file}: main is labelled by the h1`);
    const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? "");
    assert.equal(new Set(ids).size, ids.length, `${f.file}: duplicate id`);
    for (const m of h.matchAll(/aria-labelledby="([^"]+)"/g))
      assert.ok(ids.includes(m[1] ?? ""), `${f.file}: aria-labelledby ${m[1]} has no target`);
    for (const m of h.matchAll(/<section\b([^>]*)>/g))
      assert.match(m[1] ?? "", /aria-labelledby="/, `${f.file}: unlabelled section`);
    assert.equal((h.match(/<main\b/g) ?? []).length, 1);
  }
});

test("A11Y-07 keyboard: a visible focus indicator (≥ 2 px) for links, summaries and main; the skip link appears on focus; no positive tabindex", () => {
  assert.match(
    CSS,
    /a:focus-visible,summary:focus-visible,main:focus-visible\{outline:0\.1875rem solid var\(--info\)/,
  );
  assert.match(CSS, /\.skip:focus\{inset-block-start:0\.5rem\}/);
  for (const f of HTML)
    for (const m of f.content.matchAll(/tabindex="(-?\d+)"/g))
      assert.ok(Number(m[1]) <= 0, `${f.file}: tabindex ${m[1]}`);
  for (const f of PLATFORM) assert.doesNotMatch(f.content, /outline:\s*(none|0)(?![.\d])/, f.file);
});

test('A11Y-08 links say where they go (no "click here"), every anchor has text, and e-mail layout tables are role="presentation"', () => {
  const VAGUE = /^(click here|here|link|more|اضغط هنا|هنا|رابط)$/i;
  let anchors = 0;
  for (const f of HTML) {
    for (const m of f.content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
      const t = textOf(m[2] ?? "");
      assert.ok(t.length > 2, `${f.file}: empty link text`);
      assert.doesNotMatch(t, VAGUE, `${f.file}: vague link text «${t}»`);
      assert.match(m[1] ?? "", /href="(#ntf-main|https:\/\/[^"]+)"/, `${f.file}: link target`);
      anchors++;
    }
  }
  assert.ok(anchors > 50);
  for (const f of EMAIL)
    for (const m of f.content.matchAll(/<table\b([^>]*)>/g))
      assert.match(m[1] ?? "", /role="presentation"/, `${f.file}: layout table without role="presentation"`);
  for (const f of PLATFORM)
    assert.doesNotMatch(f.content, /<table\b/, `${f.file}: layout table on the platform`);
  // the destination host is stated next to every action link (the reader knows where the link leads)
  for (const f of HTML.filter(
    (x) =>
      x.content.includes('data-component="SecureActionLink" data-link="PLATFORM_DEEP_LINK"') ||
      x.content.includes('data-link="PORTAL_LINK"'),
  )) {
    assert.match(
      f.content,
      /<bdi dir="ltr"[^>]*>cdf-(platform|portal)\.example\.test<\/bdi>/,
      `${f.file}: destination host`,
    );
  }
});

test("A11Y-09 the expected process (Layer B) is an expandable <details>/<summary> on the platform (native keyboard operation) and a visible list in e-mail", () => {
  let platformBlocks = 0;
  for (const f of PLATFORM) {
    for (const el of elementsWith(f.content, /data-component="ExpectedProcess"/)) {
      assert.match(
        el,
        /<details class="c-details"[^>]*>\s*<summary class="c-summary"[^>]*>[^<]{3,}/,
        `${f.file}: ExpectedProcess without details/summary`,
      );
      assert.ok(
        /data-layer="expected"/.test(el) || /data-missing="true"|c-muted/.test(el),
        `${f.file}: details without Layer B items`,
      );
      platformBlocks++;
    }
  }
  assert.ok(platformBlocks > 20, `platform ExpectedProcess blocks: ${platformBlocks}`);
  for (const f of EMAIL)
    assert.doesNotMatch(
      f.content,
      /<details|<summary/,
      `${f.file}: details/summary in e-mail (not supported by many clients)`,
    );
});

test("A11Y-10 no images and no external resources (nothing needs alternative text; nothing loads from elsewhere); the preview marking is text", () => {
  for (const f of HTML) {
    assert.doesNotMatch(
      f.content,
      /<img\b|<svg\b|<picture\b|<video\b|<audio\b|<iframe\b|<object\b|<embed\b/i,
      f.file,
    );
    assert.doesNotMatch(f.content, /url\(|@import|<link\b|\ssrc=/i, `${f.file}: external resource`);
    assert.match(
      f.content,
      /data-marking="DESIGN_PREVIEW"[^>]*>[^<]*DESIGN_PREVIEW/,
      `${f.file}: marking as text`,
    );
  }
  for (const f of EMAIL)
    assert.match(
      f.content,
      /role="note" aria-label="[^"]*DESIGN_PREVIEW[^"]*"/,
      `${f.file}: marking announced as a note`,
    );
});

test('A11Y-11 bidirectional text: in Arabic outputs every Latin reference (notice, internal, audit, evidence) is isolated in <bdi dir="ltr">', () => {
  let isolated = 0;
  let refs = 0;
  // port: CDF-DEMO added for the port's synthetic case numbers (CDF-DEMO-YYYY-NNNN, CLAUDE.md §1); the reference prefixes are kept
  const REF = /\b(?:NTF|DIR|REF|AUD|EVD|CDF-DEMO|CDF-IC|CDF-WB|CDF-IR)-[0-9A-Z-]*[0-9][0-9A-Z]*\b/g;
  for (const f of HTML.filter((x) => x.lang === "ar")) {
    for (const m of f.content.matchAll(/<bdi\b([^>]*)>/g)) {
      assert.match(m[1] ?? "", /dir="ltr"/, `${f.file}: <bdi> without dir="ltr"`);
      isolated++;
    }
    const body = f.content.slice(f.content.indexOf("<body"));
    for (const m of body.matchAll(REF)) {
      refs++;
      const before = body.slice(Math.max(0, m.index - 400), m.index);
      const hidden = /<div style="display:none;[^>]*>[^<]*$/.test(before); // the hidden preheader is a single text run
      assert.ok(hidden || /<bdi dir="ltr"[^>]*>[^<]*$/.test(before), `${f.file}: ${m[0]} not isolated`);
    }
  }
  assert.ok(isolated > 50 && refs > 50, `isolated elements ${isolated}, references ${refs}`);
});
