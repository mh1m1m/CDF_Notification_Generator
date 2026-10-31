import "server-only";
/**
 * CDF Notifications V13 — design tokens for the renderers (W-D2). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
 * Source order: W-E's design tokens (bundled as ./email_tokens.json, single token source per charter §11) → V12 tokens.
 * V12 values (copied, origin named; never imported at runtime):
 *   ink #161616, t2 #374151, t3 #686B6E, line #E5E7EB, surface #F3F4F6, panel #FFFFFF, powder #BBDDE6, yellow #FDD086,
 *   ok #22633D, warn #7A4A00, danger #8A2F1B, info #245667, font stack 'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial
 *   ← notifications/generator/source/build_notification_generator.py `:root` (lines 596–597)
 *   hero #183B43, secondary text #5E646B, light surface #F7FBFC, warn surface #FEF6E9, mono 'IBM Plex Mono'
 *   ← notifications/templates/institutional-referral/v4/IR_v4_ar.template.html (inline styles)
 *   info surface #E6F1F5 ← build_notification_generator.py `.warnbar.info`
 * Every text/background pair the renderers use is listed in TEXT_PAIRS and must reach 4.5:1 (WCAG 2.x formula); a W-E
 * colour that would break a pair is not used for that slot (recorded in `warnings`), so the rendered pairs always pass.
 * Port note: the reference read design/tokens.json from disk; here the file is a static JSON import. `loadTokens` keeps its
 * override behaviour: `tokens` (or `path` given as an object) replaces the bundled token document.
 */
import WE_TOKENS from "./email_tokens.json";
import { isNil } from "@/lib/domain/nil";

/** where the bundled W-E token document lives (informational; it is imported statically, never read from disk) */
export const WE_TOKENS_PATH = "lib/notifications/render/email_tokens.json";

export const V12_COLORS = Object.freeze({
  text: "#161616",
  textSecondary: "#374151",
  textMuted: "#5E646B",
  bg: "#FFFFFF",
  pageBg: "#F3F4F6",
  border: "#E5E7EB",
  accentBg: "#BBDDE6",
  markingBg: "#FDD086",
  ok: "#22633D",
  warn: "#7A4A00",
  warnBg: "#FEF6E9",
  danger: "#8A2F1B",
  info: "#245667",
  infoBg: "#E6F1F5",
  hero: "#183B43",
  heroText: "#FFFFFF",
  layerBBg: "#F7FBFC",
  link: "#245667",
});
export type ColorSlot = keyof typeof V12_COLORS;
export type Colors = Readonly<Record<ColorSlot, string>>;
export const FONTS = Object.freeze({
  body: "'IBM Plex Sans Arabic','Segoe UI',Tahoma,'Geeza Pro','Noto Sans Arabic',Arial,sans-serif",
  mono: "'IBM Plex Mono',Consolas,'Courier New',monospace",
});
export type Fonts = Readonly<{ body: string; mono: string }>;
/** [foreground slot, background slot, where it is used] — checked by tests/unit/notifications/a11y.test.ts (A11Y-04) */
export const TEXT_PAIRS: readonly (readonly [ColorSlot, ColorSlot, string])[] = Object.freeze([
  ["text", "bg", "body text"],
  ["text", "pageBg", "text on the page background"],
  ["textSecondary", "bg", "secondary text"],
  ["textMuted", "bg", "muted labels"],
  ["textMuted", "layerBBg", "Layer B (expected process) items"],
  ["text", "layerBBg", "Layer B step names"],
  ["text", "accentBg", "action card text"],
  ["text", "markingBg", "DESIGN_PREVIEW marking banner"],
  ["ok", "bg", "completed state label"],
  ["warn", "warnBg", "exception / warning text"],
  ["danger", "bg", "restricted classification badge"],
  ["info", "infoBg", "information note"],
  ["info", "bg", "information text"],
  ["heroText", "hero", "header band"],
  ["link", "bg", "link text"],
  ["heroText", "text", "action button"],
] as const);

function lum(hex: string): number {
  const v = hex.replace("#", "");
  const c = [0, 2, 4]
    .map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}
/** WCAG 2.x contrast ratio */
export function contrastRatio(a: string, b: string): number {
  const [x = 0, y = 0] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** candidate token paths per slot when reading W-E's tokens.json (matched case-insensitively at the end of a dotted path) */
const SLOT_CANDIDATES: Readonly<Record<ColorSlot, readonly string[]>> = Object.freeze({
  text: ["text.primary", "color.text.primary", "ink", "text.default", "fg.default"],
  textSecondary: ["text.secondary", "color.text.secondary", "fg.secondary"],
  textMuted: ["text.muted", "text.tertiary", "color.text.muted", "fg.muted"],
  bg: ["surface.default", "bg.default", "background.default", "surface.panel", "panel"],
  pageBg: ["surface.page", "bg.page", "background.page", "surface.subtle"],
  border: ["border.default", "line", "border"],
  accentBg: ["accent.surface", "action.surface", "powder"],
  markingBg: ["marking.surface", "preview.surface", "yellow"],
  ok: ["status.success", "success", "ok"],
  warn: ["status.warning", "warning", "warn"],
  warnBg: ["status.warning.surface", "warning.surface"],
  danger: ["status.danger", "danger", "error"],
  info: ["status.info", "info"],
  infoBg: ["status.info.surface", "info.surface"],
  hero: ["brand.primary", "hero", "brand.dark"],
  heroText: ["brand.on-primary", "on-hero", "text.inverse"],
  layerBBg: ["progress.expected.surface", "expected.surface", "layer-b.surface"],
  link: ["link", "text.link", "color.link"],
});
function flatten(o: unknown, path: string = "", out: Map<string, string> = new Map()): Map<string, string> {
  if (isNil(o)) return out;
  if (typeof o === "string") {
    if (HEX.test(o)) out.set(path.toLowerCase(), o.toUpperCase());
    return out;
  }
  if (typeof o !== "object") return out;
  const rec = o as Record<string, unknown>;
  for (const k of ["value", "$value", "hex"]) {
    const x = rec[k];
    if (typeof x === "string" && HEX.test(x)) out.set(path.toLowerCase(), x.toUpperCase());
  }
  for (const [k, v] of Object.entries(rec))
    if (!["value", "$value", "hex"].includes(k)) flatten(v, path ? `${path}.${k}` : k, out);
  return out;
}

export interface Tokens {
  readonly source: string;
  readonly colors: Colors;
  readonly fonts: Fonts;
  readonly mapped_from_we: ColorSlot[];
  readonly warnings: string[];
}
export interface LoadTokensOptions {
  /** a W-E token document (object) replacing the bundled one; `null` = no W-E document (V12 only) */
  tokens?: unknown;
  /** reference compatibility: an object is treated like `tokens`; the default path selects the bundled document; any other
   *  string names a file that cannot be read without file access, so it counts as absent (V12 tokens) */
  path?: unknown;
  preferV12?: boolean;
}

/** → {source, colors, fonts, mapped_from_we:[slots], warnings:[]} */
export function loadTokens({
  tokens,
  path = WE_TOKENS_PATH,
  preferV12 = false,
}: LoadTokensOptions = {}): Tokens {
  const colors: Record<ColorSlot, string> = { ...V12_COLORS };
  const warnings: string[] = [];
  const mapped: ColorSlot[] = [];
  let source = "V12 (generator CSS variables + institutional-referral v4 template)";
  const doc: unknown =
    tokens !== undefined
      ? tokens
      : path !== null && typeof path === "object"
        ? path
        : path === WE_TOKENS_PATH
          ? WE_TOKENS
          : null;
  if (!preferV12 && !isNil(doc)) {
    try {
      const flat = flatten(doc);
      for (const [slot, cands] of Object.entries(SLOT_CANDIDATES) as [ColorSlot, readonly string[]][]) {
        const hit = [...flat.entries()].find(([p]) => cands.some((c) => p === c || p.endsWith("." + c)));
        if (hit) {
          colors[slot] = hit[1];
          mapped.push(slot);
        }
      }
      source = mapped.length
        ? `W-E design/tokens.json (${mapped.length} slots) + V12 fallback`
        : "V12 (W-E tokens.json present but no slot matched)";
      for (const [fg, bg, use] of TEXT_PAIRS) {
        if (contrastRatio(colors[fg], colors[bg]) >= 4.5) continue;
        for (const s of [fg, bg])
          if (mapped.includes(s)) {
            warnings.push(`TOKEN_CONTRAST_FALLBACK: ${s} (${use}) reverted to V12`);
            colors[s] = V12_COLORS[s];
          }
      }
    } catch (e) {
      warnings.push(
        `W-E tokens.json unreadable (${e instanceof Error ? e.message : String(e)}); V12 tokens used`,
      );
    }
  }
  return Object.freeze({
    source,
    colors: Object.freeze(colors),
    fonts: FONTS,
    mapped_from_we: mapped,
    warnings,
  });
}
