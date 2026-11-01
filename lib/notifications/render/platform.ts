import "server-only";
/**
 * CDF Notifications V13 — Experience A: platform (in-app notification detail, UI-03 in W-F's V13-07). Workstream W-D2.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * PRODUCTION_SUBSTITUTION_REQUIRED: in the platform this view is a Next.js server component of apps/investigation-web (the
 * reporter's view belongs to apps/whistleblowing-web /follow-up) fed by a server-side projection; the page re-authorises
 * every object on open (deep links are ids-only, notify.deep_link).
 *
 * renderPlatform(projected, {lang, density, tokens}) → {html, text, components, title}
 *  - text is the plain-text twin of the page (V13-PROC-021, REQ-NOTIF-011): built like renderEmail's text twin — marking
 *    first and last, identity without a heading, "== heading ==" per group, a blank line after every component, the
 *    preview notice, controls and bidi characters stripped from the whole text, lines ≤ 900 octets — from the same
 *    rendered components as the HTML, so the two forms carry the same components in the same order;
 *  - the same disclosure gate as e-mail (assertRenderable: projected for PLATFORM, not suppressed, not channel-prohibited);
 *  - semantic HTML: skip link, header / main / footer landmarks, one h1 (the event title), h2 per group, h3 inside components,
 *    lists for steps, <details>/<summary> for the expected process (Layer B, expandable, keyboard operable natively);
 *  - CSS: design tokens as custom properties, rem units, logical properties (margin-inline / padding-inline /
 *    border-inline-start), visible :focus-visible outline, no animation, no transition, prefers-reduced-motion respected,
 *    single-column reflow below 40rem; no external font, script or image.
 */
import { assertRenderable, renderComponents, wrapLongLines } from "./email";
import { GROUPS, assertDensity, type GroupName, type ComponentName } from "./densities";
import { escHtml, stripControls } from "./escape";
import { MARKING, S, pick } from "./i18n";
import { loadTokens, type Tokens } from "./tokens";
import type { Lang } from "./types";
import { ar as AR } from "@/lib/i18n/notificationRender/ar";
import { en as EN } from "@/lib/i18n/notificationRender/en";
import type { Projected, ProjectedModel } from "@/lib/disclosure/project";

const GROUP_HEADING: Readonly<Record<Exclude<GroupName, "identity">, { ar: string; en: string }>> = {
  core: S.whatHappened,
  action: S.required,
  status: S.status,
  details: S.details,
  help: S.helpGroup,
};
const PREVIEW_PLATFORM: Readonly<Record<Lang, string>> = {
  ar: AR["platform.previewNotice"],
  en: EN["platform.previewNotice"],
};

export function platformCss(tokens: Tokens): string {
  const c = tokens.colors;
  const f = tokens.fonts;
  return `:root{--ink:${c.text};--ink-2:${c.textSecondary};--ink-3:${c.textMuted};--bg:${c.bg};--page:${c.pageBg};--line:${c.border};--accent:${c.accentBg};--marking:${c.markingBg};--ok:${c.ok};--warn:${c.warn};--warn-bg:${c.warnBg};--danger:${c.danger};--info:${c.info};--info-bg:${c.infoBg};--hero:${c.hero};--on-hero:${c.heroText};--layer-b:${c.layerBBg};--link:${c.link};--font:${f.body};--mono:${f.mono}}
*{box-sizing:border-box}
html{font-size:100%;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--ink);font-family:var(--font);font-size:1rem;line-height:1.6}
.skip{position:absolute;inset-inline-start:0.5rem;inset-block-start:-3rem;padding:0.5rem 1rem;background:var(--ink);color:var(--on-hero);text-decoration:none;font-weight:700}
.skip:focus{inset-block-start:0.5rem}
a{color:var(--link)}
a:focus-visible,summary:focus-visible,main:focus-visible{outline:0.1875rem solid var(--info);outline-offset:0.125rem}
.marking{margin:0;padding:0.625rem 1rem;background:var(--marking);color:var(--ink);font-weight:700;font-size:0.875rem}
.page{max-inline-size:48rem;margin-inline:auto;padding:1rem}
.ntf{background:var(--bg);border:0.0625rem solid var(--line);padding-block:1.25rem;padding-inline:1.5rem}
.grp{margin-block-start:1.25rem}
.grp-h{margin:0 0 0.5rem;padding-inline-start:0.5rem;border-inline-start:0.1875rem solid var(--info);font-size:1.0625rem;line-height:1.4}
.c-block{margin-block-end:0.75rem}
.c-org{margin:0 0 0.375rem;font-size:0.8125rem;color:var(--ink-2)}
.c-h1{margin:0 0 0.5rem;font-size:1.375rem;line-height:1.35}
.c-h2{margin:1.125rem 0 0.5rem;font-size:1.0625rem}
.c-h3{margin:0.75rem 0 0.375rem;font-size:0.9375rem}
.c-p{margin:0 0 0.5rem}
.c-meta{margin:0 0 0.25rem;font-size:0.875rem;color:var(--ink-2)}
.c-muted{margin:0 0 0.375rem;font-size:0.8125rem;color:var(--ink-3)}
.c-ref{font-family:var(--mono);font-size:0.8125rem}
.c-action{margin:0 0 0.5rem;padding:0.875rem 1rem;background:var(--accent);border-inline-start:0.25rem solid var(--ink)}
.c-action-text{margin:0 0 0.5rem;font-size:1rem;font-weight:700}
.c-note{margin:0.5rem 0;padding:0.5rem 0.75rem;font-size:0.875rem;color:var(--info);background:var(--info-bg)}
.c-warn{margin:0.5rem 0;padding:0.625rem 0.75rem;color:var(--warn);background:var(--warn-bg);border:0.0625rem solid var(--warn)}
.c-list{margin:0 0 0.5rem;padding:0;list-style:none}
.c-item{margin:0 0 0.25rem}
.c-item--expected{padding:0.25rem 0.5rem;color:var(--ink-3);background:var(--layer-b);border:0.0625rem dashed var(--ink-3)}
.c-item--plain{color:var(--ink-2);font-size:0.875rem}
.c-state{font-size:0.8125rem;color:var(--ink-3)}
.c-name{color:var(--ink)}
.c-sym{display:inline-block;min-inline-size:1.2em;font-weight:700}
.c-sym--COMPLETED{color:var(--ok)}.c-sym--IN_PROGRESS{color:var(--info)}.c-sym--PENDING,.c-sym--NOT_APPLICABLE,.c-sym--B{color:var(--ink-3)}
.c-sym--SUSPENDED,.c-sym--RETURNED{color:var(--warn)}.c-sym--CANCELLED,.c-sym--FAILED{color:var(--danger)}
.c-badge{display:inline-block;margin:0 0 0.5rem;padding:0.125rem 0.625rem;font-size:0.8125rem;border:0.0625rem solid currentColor;background:var(--bg)}
.c-badge--PUBLIC{color:var(--info)}.c-badge--INTERNAL{color:var(--warn);background:var(--warn-bg)}.c-badge--RESTRICTED{color:var(--danger)}.c-badge--UNKNOWN{color:var(--ink-2)}
.c-button{display:inline-block;padding:0.625rem 1.125rem;background:var(--ink);color:var(--on-hero);text-decoration:none;font-weight:700}
.c-details{margin:0 0 0.5rem}
.c-summary{cursor:pointer;color:var(--ink-2);font-size:0.875rem;padding-block:0.25rem}
footer.foot{max-inline-size:48rem;margin-inline:auto;padding:0 1rem 1.5rem;font-size:0.8125rem;color:var(--ink-2)}
@media (max-width:40rem){.page{padding:0.5rem}.ntf{padding-inline:1rem}.c-h1{font-size:1.25rem}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@media print{.skip{display:none}}`;
}

export interface RenderPlatformOptions {
  lang?: unknown;
  density?: unknown;
  tokens?: Tokens;
}
export interface RenderedPlatform {
  html: string;
  text: string;
  components: ComponentName[];
  title: string;
}
export function renderPlatform(
  projected0: Projected<ProjectedModel>,
  opts: RenderPlatformOptions = {},
): RenderedPlatform {
  const projected = assertRenderable(projected0, "PLATFORM");
  const lang: Lang = opts.lang === "en" ? "en" : "ar";
  const dir = lang === "ar" ? "rtl" : "ltr";
  const density = assertDensity(opts.density ?? "STANDARD");
  const tokens = opts.tokens ?? loadTokens();
  const ctx = { lang, density, experience: "PLATFORM" as const, tokens };
  const rendered = renderComponents(projected0, ctx);
  const t = projected.fields.event_title;
  const title = `${t ? (typeof t === "string" ? t : pick(t, lang)) : pick(S.notAvailable, lang)} — DESIGN_PREVIEW`;
  const sections: string[] = [];
  const text: string[] = [MARKING, ""];
  for (const [g] of GROUPS) {
    const items = rendered.filter((r) => r.group === g);
    if (!items.length) continue;
    if (g === "identity") {
      sections.push(items.map((r) => r.html).join("\n"));
      for (const r of items) text.push(r.text, "");
      continue;
    }
    const id = `grp-${g}`;
    sections.push(
      `<section class="grp" aria-labelledby="${id}">\n<h2 class="grp-h" id="${id}">${escHtml(pick(GROUP_HEADING[g], lang))}</h2>\n${items.map((r) => r.html).join("\n")}\n</section>`,
    );
    text.push(`== ${pick(GROUP_HEADING[g], lang)} ==`);
    for (const r of items) text.push(r.text, "");
  }
  text.push(PREVIEW_PLATFORM[lang], "", MARKING, "");
  const html = [
    "<!DOCTYPE html>",
    `<html lang="${lang}" dir="${dir}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${escHtml(title)}</title>`,
    `<style>\n${platformCss(tokens)}\n</style>`,
    "</head>",
    "<body>",
    `<a class="skip" href="#ntf-main">${escHtml(pick(S.skip, lang))}</a>`,
    `<header role="banner"><p class="marking" data-marking="DESIGN_PREVIEW">${escHtml(MARKING)}</p></header>`,
    `<main id="ntf-main" class="page" tabindex="-1" aria-labelledby="ntf-title">`,
    `<article class="ntf" data-density="${density}" data-experience="PLATFORM">`,
    sections.join("\n"),
    "</article>",
    "</main>",
    `<footer class="foot" role="contentinfo"><p>${escHtml(PREVIEW_PLATFORM[lang])}</p><p>${escHtml(MARKING)}</p></footer>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
  return {
    html,
    // defence in depth, as renderEmail: the components already strip controls from every value
    text: wrapLongLines(stripControls(text.join("\n")), 900),
    components: rendered.map((r) => r.name),
    title: stripControls(title),
  };
}
