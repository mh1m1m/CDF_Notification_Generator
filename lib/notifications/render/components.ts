import "server-only";
/**
 * CDF Notifications V13 — the 18 rendering components (charter §11). Workstream W-D2.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * Every component: render<Name>(model, ctx) → {html, text, card} | null (null = not visible for this recipient/density/content).
 *  - model: a PROJECTED notification model (assertProjected is called first; an unprojected model throws).
 *  - ctx: {lang:'ar'|'en', density, experience:'EMAIL'|'PLATFORM', tokens}. ctx never widens disclosure: the recipient class
 *    is read from the projected model, not from ctx.
 * Markers (lead's gate checker and regression tests): data-component on every root; Layer A items data-layer="actual" +
 * data-state; Layer B items data-layer="expected" + data-kind (never ✔ / ● inside); level roots data-level="1|2|3";
 * value elements data-field="<field>"; every symbol is <span role="img" aria-label="…">.
 * Error states: missing data → the component is omitted, or shows an explicit «غير متاح» — never a fabricated value.
 * Reused from V12 (copied, origin named): the three-level block idea and its compact fallback
 * (notifications/generator/source/v12_block.js + engine_v9.js `buildActionableCard` levelsMode full/compact); the card
 * element shapes (engine_v9.js `amText` / FactSet / emphasis containers). Everything else is new in V13.
 */
import { assertProjected, INTERNAL_CLASSES } from "@/lib/disclosure/project";
import { escHtml, oneLine, mdEsc, fmtRiyadh, safeHref, NOT_AVAILABLE, stripControls } from "./escape";
import {
  LAYER_A,
  LAYER_B,
  S,
  CONFIDENTIALITY,
  HELP_STATIC,
  CLASSIFICATION,
  DELIVERY,
  pick,
  fill,
} from "./i18n";
import { loadTokens, type Tokens } from "./tokens";
import type { Density, ComponentName } from "./densities";
import {
  fieldOf as F,
  type RenderModel,
  type Lang,
  type Experience,
  type Bi,
  type L3Steps,
  type StepView,
  type DeliveryInput,
} from "./types";
import { isNil } from "@/lib/domain/nil";
import { dataEpistemicFor } from "@/lib/notifications/data-epistemic";
import { ar as AR } from "@/lib/i18n/notificationRender/ar";
import { en as EN } from "@/lib/i18n/notificationRender/en";

const DEFAULT_TOKENS = loadTokens();

/** render context; extra keys are ignored (they can never widen disclosure) */
export interface RenderCtx {
  lang: Lang;
  density: Density;
  experience: Experience;
  tokens?: Tokens;
  readonly [extra: string]: unknown;
}
/** an Adaptive Card element emitted by the components (TextBlock / Container only) */
export interface CardElement {
  type: string;
  text?: string;
  wrap?: boolean;
  items?: CardElement[];
  [k: string]: unknown;
}
export interface ComponentOutput {
  html: string;
  text: string;
  card: CardElement[];
}
export type ComponentRenderer = (model: unknown, ctx: RenderCtx) => ComponentOutput | null;

type LayerAState = keyof typeof LAYER_A;
type LayerBKind = keyof typeof LAYER_B;
const layerA = (s: unknown): (typeof LAYER_A)[LayerAState] | undefined =>
  typeof s === "string" && Object.hasOwn(LAYER_A, s) ? LAYER_A[s as LayerAState] : undefined;
const layerB = (k: unknown): (typeof LAYER_B)[LayerBKind] | undefined =>
  typeof k === "string" && Object.hasOwn(LAYER_B, k) ? LAYER_B[k as LayerBKind] : undefined;
/** own-key lookup in a frozen wording table (no inherited keys) */
function own<T>(table: Readonly<Record<string, T>>, key: unknown): T | undefined {
  return typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Style plumbing: inline styles for e-mail, classes for the platform (CSS in platform.ts)
// ---------------------------------------------------------------------------------------------------------------
function emailStyles(ctx: RenderCtx): Record<string, string> {
  const c = (ctx.tokens ?? DEFAULT_TOKENS).colors;
  const f = (ctx.tokens ?? DEFAULT_TOKENS).fonts;
  const side = ctx.lang === "en" ? "left" : "right";
  const base = `font-family:${f.body};`;
  return {
    org: `${base}margin:0 0 6px;font-size:13px;line-height:1.5;color:${c.textSecondary};`,
    h1: `${base}margin:0 0 8px;font-size:22px;line-height:1.35;font-weight:700;color:${c.text};`,
    h2: `${base}margin:18px 0 8px;font-size:17px;line-height:1.4;font-weight:700;color:${c.text};`,
    h3: `${base}margin:12px 0 6px;font-size:15px;line-height:1.4;font-weight:700;color:${c.text};`,
    p: `${base}margin:0 0 8px;font-size:15px;line-height:1.6;color:${c.text};`,
    meta: `${base}margin:0 0 4px;font-size:14px;line-height:1.6;color:${c.textSecondary};`,
    muted: `${base}margin:0 0 6px;font-size:13px;line-height:1.5;color:${c.textMuted};`,
    ref: `font-family:${f.mono};font-size:13px;`,
    action: `${base}margin:0 0 8px;padding:14px 16px;background-color:${c.accentBg};border-${side}:4px solid ${c.text};`,
    actionText: `${base}margin:0 0 8px;font-size:16px;line-height:1.6;font-weight:700;color:${c.text};`,
    note: `${base}margin:8px 0;padding:8px 12px;font-size:14px;line-height:1.6;color:${c.info};background-color:${c.infoBg};`,
    warn: `${base}margin:8px 0;padding:10px 12px;font-size:15px;line-height:1.6;color:${c.warn};background-color:${c.warnBg};border:1px solid ${c.warn};`,
    itemA: `${base}margin:0 0 4px;font-size:15px;line-height:1.6;color:${c.text};`,
    itemB: `${base}margin:0 0 4px;padding:4px 8px;font-size:14px;line-height:1.6;color:${c.textMuted};background-color:${c.layerBBg};border:1px dashed ${c.textMuted};`,
    itemPlain: `${base}margin:0 0 4px;font-size:14px;line-height:1.6;color:${c.textSecondary};`,
    stateLabel: `font-size:13px;color:${c.textMuted};`,
    nameB: `color:${c.text};`,
    sym: `display:inline-block;min-width:1.2em;font-weight:700;`,
    "sym-COMPLETED": `display:inline-block;min-width:1.2em;font-weight:700;color:${c.ok};`,
    "sym-IN_PROGRESS": `display:inline-block;min-width:1.2em;font-weight:700;color:${c.info};`,
    "sym-PENDING": `display:inline-block;min-width:1.2em;font-weight:700;color:${c.textMuted};`,
    "sym-SUSPENDED": `display:inline-block;min-width:1.2em;font-weight:700;color:${c.warn};`,
    "sym-RETURNED": `display:inline-block;min-width:1.2em;font-weight:700;color:${c.warn};`,
    "sym-CANCELLED": `display:inline-block;min-width:1.2em;font-weight:700;color:${c.danger};`,
    "sym-FAILED": `display:inline-block;min-width:1.2em;font-weight:700;color:${c.danger};`,
    "sym-NOT_APPLICABLE": `display:inline-block;min-width:1.2em;font-weight:700;color:${c.textMuted};`,
    "sym-B": `display:inline-block;min-width:1.2em;font-weight:700;color:${c.textMuted};`,
    "badge-PUBLIC": `${base}display:inline-block;margin:0 0 8px;padding:2px 10px;font-size:13px;line-height:1.6;color:${c.info};border:1px solid ${c.info};background-color:${c.bg};`,
    "badge-INTERNAL": `${base}display:inline-block;margin:0 0 8px;padding:2px 10px;font-size:13px;line-height:1.6;color:${c.warn};border:1px solid ${c.warn};background-color:${c.warnBg};`,
    "badge-RESTRICTED": `${base}display:inline-block;margin:0 0 8px;padding:2px 10px;font-size:13px;line-height:1.6;color:${c.danger};border:1px solid ${c.danger};background-color:${c.bg};`,
    "badge-UNKNOWN": `${base}display:inline-block;margin:0 0 8px;padding:2px 10px;font-size:13px;line-height:1.6;color:${c.textSecondary};border:1px solid ${c.textSecondary};background-color:${c.bg};`,
    button: `${base}display:inline-block;padding:10px 18px;background-color:${c.text};color:${c.heroText};text-decoration:none;font-weight:700;font-size:15px;line-height:1.4;`,
    root: "",
  };
}
const PLATFORM_CLASS: Readonly<Record<string, string>> = {
  org: "c-org",
  h1: "c-h1",
  h2: "c-h2",
  h3: "c-h3",
  p: "c-p",
  meta: "c-meta",
  muted: "c-muted",
  ref: "c-ref",
  action: "c-action",
  actionText: "c-action-text",
  note: "c-note",
  warn: "c-warn",
  itemA: "c-item c-item--actual",
  itemB: "c-item c-item--expected",
  itemPlain: "c-item c-item--plain",
  stateLabel: "c-state",
  nameB: "c-name",
  sym: "c-sym",
  button: "c-button",
  root: "c-block",
};
const styleCache = new WeakMap<RenderCtx, Record<string, string>>();
function sty(ctx: RenderCtx, key: string): string {
  if (ctx.experience === "EMAIL") {
    let m = styleCache.get(ctx);
    if (!m) {
      m = emailStyles(ctx);
      styleCache.set(ctx, m);
    }
    const s = own(m, key);
    return s ? ` style="${s}"` : "";
  }
  if (key.startsWith("sym-")) return ` class="c-sym c-sym--${key.slice(4)}"`;
  if (key.startsWith("badge-")) return ` class="c-badge c-badge--${key.slice(6)}"`;
  const cls = own(PLATFORM_CLASS, key);
  return cls ? ` class="${cls}"` : "";
}
type Attrs = Readonly<Record<string, string | number | boolean | null | undefined>>;
function attrs(a: Attrs | null | undefined): string {
  return Object.entries(a || {})
    .filter(([, v]) => !isNil(v) && v !== false)
    .map(([k, v]) => ` ${k}="${escHtml(v)}"`)
    .join("");
}
const el = (ctx: RenderCtx, tag: string, key: string, a: Attrs, inner: string): string =>
  `<${tag}${attrs(a)}${sty(ctx, key)}>${inner}</${tag}>`;
const listTag = (ctx: RenderCtx): string => (ctx.experience === "EMAIL" ? "p" : "li");
const wrapList = (ctx: RenderCtx, items: readonly string[]): string =>
  ctx.experience === "EMAIL" ? items.join("") : `<ul class="c-list">${items.join("")}</ul>`;
const sym = (ctx: RenderCtx, glyph: string, aria: string, key: string): string =>
  `<span role="img" aria-label="${escHtml(aria)}"${sty(ctx, key)}>${glyph}</span>`;
const bdi = (ctx: RenderCtx, s: unknown, field?: string): string =>
  `<bdi dir="ltr"${field ? ` data-field="${field}"` : ""}${sty(ctx, "ref")}>${escHtml(s)}</bdi>`;
const root = (ctx: RenderCtx, name: ComponentName, extra: Attrs, inner: string): string =>
  `<div data-component="${name}"${attrs(extra)}${sty(ctx, "root")}>${inner}</div>`;
const heading = (ctx: RenderCtx, level: number, text: string, id?: string): string =>
  `<h${level}${id && ctx.experience !== "EMAIL" ? ` id="${id}"` : ""}${sty(ctx, "h" + level)}>${escHtml(text)}</h${level}>`;
const tb = (text: unknown, o: Readonly<Record<string, unknown>> = {}): CardElement => ({
  type: "TextBlock",
  text: mdEsc(text),
  wrap: true,
  ...o,
});

// ---------------------------------------------------------------------------------------------------------------
// Model access (projected model only)
// ---------------------------------------------------------------------------------------------------------------
const present = (m: RenderModel, f: Parameters<typeof F>[1]): boolean => !isNil(F(m, f));
/** bilingual / generalized / safe-reference value → display text; null when absent */
function show(v: unknown, lang: string): string | null {
  if (isNil(v)) return null;
  if (typeof v === "string" || typeof v === "number") return String(v);
  const o = v as { safe_reference?: unknown; token?: unknown; generalized?: unknown };
  if (o.safe_reference) return o.token as string;
  if (o.generalized) return pick(v, lang) || null;
  const s = pick(v, lang);
  return s === "" ? null : s;
}
const NA = (lang: string): string => (lang === "en" ? NOT_AVAILABLE.en : NOT_AVAILABLE.ar);
const isInternal = (m: RenderModel): boolean =>
  (INTERNAL_CLASSES as readonly string[]).includes(m.meta.recipient_class);
const L = (ctx: RenderCtx, v: unknown): string => pick(v, ctx.lang);
function check(model: unknown, ctx: RenderCtx): RenderModel {
  assertProjected(model);
  if (!ctx || !["ar", "en"].includes(ctx.lang)) throw new TypeError('render ctx.lang must be "ar" or "en"');
  if (!["EMAIL", "PLATFORM"].includes(ctx.experience))
    throw new TypeError("render ctx.experience must be EMAIL or PLATFORM");
  // assertProjected accepted it: a frozen projection carrying meta and fields
  return model as RenderModel;
}
const missing = (ctx: RenderCtx, field: string, label?: string): { html: string; text: string } => {
  const t = `${label ? label + ": " : ""}${NA(ctx.lang)}`;
  return {
    html: el(ctx, "p", "muted", { "data-field": field, "data-missing": "true" }, escHtml(t)),
    text: t,
  };
};

interface ItemOpts {
  field?: string;
  evidence?: unknown;
  note?: unknown;
  condition?: unknown;
}
/** Layer A item */
function itemA(
  ctx: RenderCtx,
  state: unknown,
  name: string | null | undefined,
  { field, evidence, note }: ItemOpts = {},
): { html: string; text: string } {
  const a = layerA(state) ?? LAYER_A.PENDING;
  const st = layerA(state) ? String(state) : "PENDING";
  const nm = isNil(name) || name === "" ? NA(ctx.lang) : name;
  const nt = note ? L(ctx, note) : "";
  const ev = evidence
    ? ` <span${sty(ctx, "stateLabel")}>· ${escHtml(L(ctx, S.evidenceRecorded))}</span>`
    : "";
  const nh = nt ? ` <span${sty(ctx, "stateLabel")}>· ${escHtml(nt)}</span>` : "";
  const html = el(
    ctx,
    listTag(ctx),
    "itemA",
    { "data-layer": "actual", "data-state": st, "data-field": field },
    `${sym(ctx, a.sym, L(ctx, a), "sym-" + st)} <span>${escHtml(nm)}</span> <span${sty(ctx, "stateLabel")}>(${escHtml(L(ctx, a))})</span>${ev}${nh}`,
  );
  const text = `${a.sym} ${nm} (${L(ctx, a)})${evidence ? " · " + L(ctx, S.evidenceRecorded) : ""}${nt ? " · " + nt : ""}`;
  return { html, text };
}
/** Layer B item: ◇ + label, dashed, muted; the name never follows a completion word */
function itemB(
  ctx: RenderCtx,
  kind: unknown,
  name: string | null | undefined,
  { condition, field, note }: ItemOpts = {},
): { html: string; text: string } {
  const k = layerB(kind) ? String(kind) : "EXPECTED";
  const b = layerB(k) ?? LAYER_B.EXPECTED;
  let label = L(ctx, b);
  if (k === "CONDITIONAL")
    label = `${label} ${condition ? L(ctx, condition) : L(ctx, LAYER_B.CONDITIONAL.defaultCondition)}`;
  const nm = isNil(name) || name === "" ? NA(ctx.lang) : name;
  const nt = note ? L(ctx, note) : ""; // W-C note label (e.g. «لم يُختر»); never a completion word (W-C FORBIDDEN_LAYER_B)
  const html = el(
    ctx,
    listTag(ctx),
    "itemB",
    { "data-layer": "expected", "data-kind": k, "data-field": field },
    `${sym(ctx, b.sym, label, "sym-B")} <span${sty(ctx, "stateLabel")}>${escHtml(label)}:</span> <span${sty(ctx, "nameB")}>${escHtml(nm)}</span>${nt ? ` <span${sty(ctx, "stateLabel")}>(${escHtml(nt)})</span>` : ""}`,
  );
  return { html, text: `${b.sym} ${label}: ${nm}${nt ? ` (${nt})` : ""}` };
}
/** plain-text parts: controls, bidi overrides/isolates, zero-width and line/paragraph separators removed (as in HTML and card) */
const joinText = (parts: readonly unknown[]): string =>
  parts
    .filter((x) => !isNil(x) && x !== "")
    .map((x) => stripControls(x))
    .join("\n");
const out = (html: string, textParts: unknown, card?: CardElement[]): ComponentOutput => ({
  html,
  text: joinText(Array.isArray(textParts) ? textParts : [textParts]),
  card: card ?? [],
});

// ---------------------------------------------------------------------------------------------------------------
// 1 NotificationHeader — identity: organisation, title, recipient capacity, date, references
// ---------------------------------------------------------------------------------------------------------------
export function renderNotificationHeader(model0: unknown, ctx: RenderCtx): ComponentOutput {
  const model = check(model0, ctx);
  const lang = ctx.lang;
  const title = show(F(model, "event_title"), lang);
  const cap = show(F(model, "recipient_capacity_label"), lang);
  const issuer = show(F(model, "issuer"), lang);
  const at = present(model, "event_at") ? fmtRiyadh(F(model, "event_at"), lang) : null;
  const refs: { field: string; label: string; v: string }[] = [];
  const shown = new Set<string>();
  for (const [field, label] of [
    ["notice_reference", S.noticeRef],
    ["internal_ref", S.ref],
    ["report_id", S.reportId],
    ["case_number", S.caseRef],
  ] as const) {
    const raw = F(model, field);
    const v = show(raw, lang);
    if (!v || shown.has(v)) continue; // a safe reference equal to the notice reference is shown once
    shown.add(v);
    // SAFE_REFERENCE: "the field and its label are replaced by safe_reference" (W-F outcome_semantics)
    const sr = raw && typeof raw === "object" && raw.safe_reference ? raw : null;
    const lab = sr
      ? sr.label
        ? (pick(sr.label, lang).split("{notice_ref}")[0] ?? "").replace(/[:：]\s*$/, "").trim()
        : L(ctx, S.noticeRef)
      : L(ctx, label);
    refs.push({ field, label: lab || L(ctx, S.noticeRef), v });
  }
  const metaBits: string[] = [];
  const metaTxt: string[] = [];
  if (cap) {
    metaBits.push(
      `${escHtml(L(ctx, S.to))}: <span data-field="recipient_capacity_label">${escHtml(cap)}</span>`,
    );
    metaTxt.push(`${L(ctx, S.to)}: ${cap}`);
  }
  if (issuer) {
    metaBits.push(`${escHtml(L(ctx, S.from))}: <span data-field="issuer">${escHtml(issuer)}</span>`);
    metaTxt.push(`${L(ctx, S.from)}: ${issuer}`);
  }
  if (present(model, "event_at")) {
    metaBits.push(
      `${escHtml(L(ctx, S.date))}: <span data-field="event_at">${escHtml(at ?? NA(lang))}</span>`,
    );
    metaTxt.push(`${L(ctx, S.date)}: ${at ?? NA(lang)}`);
  }
  const titleHtml = title
    ? `<h1 data-field="event_title"${ctx.experience === "PLATFORM" ? ' id="ntf-title"' : ""}${sty(ctx, "h1")}>${escHtml(title)}</h1>`
    : `<h1 data-field="event_title" data-missing="true"${ctx.experience === "PLATFORM" ? ' id="ntf-title"' : ""}${sty(ctx, "h1")}>${escHtml(NA(lang))}</h1>`;
  const refHtml = refs.map((r) => `${escHtml(r.label)}: ${bdi(ctx, r.v, r.field)}`).join(" · ");
  const html = root(
    ctx,
    "NotificationHeader",
    {},
    [
      el(ctx, "p", "org", {}, escHtml(L(ctx, S.org))),
      titleHtml,
      metaBits.length ? el(ctx, "p", "meta", {}, metaBits.join(" · ")) : "",
      refs.length ? el(ctx, "p", "meta", {}, refHtml) : "",
    ].join(""),
  );
  const text = [L(ctx, S.org), title ?? NA(lang), ...metaTxt, ...refs.map((r) => `${r.label}: ${r.v}`)];
  const card = [
    tb(L(ctx, S.org), { size: "Small", isSubtle: true }),
    tb(title ?? NA(lang), { size: "Large", weight: "Bolder" }),
  ];
  if (metaTxt.length) card.push(tb(metaTxt.join(" · "), { size: "Small" }));
  if (refs.length)
    card.push(tb(refs.map((r) => `${r.label}: ${r.v}`).join(" · "), { size: "Small", weight: "Bolder" }));
  return out(html, text, card);
}

// 2 ClassificationBadge
export function renderClassificationBadge(model0: unknown, ctx: RenderCtx): ComponentOutput {
  const model = check(model0, ctx);
  const v = F(model, "classification_marking");
  const code =
    v && typeof v === "object" && own(CLASSIFICATION, v.code)
      ? (v.code as keyof typeof CLASSIFICATION)
      : null;
  const label = code ? L(ctx, CLASSIFICATION[code]) : v ? show(v, ctx.lang) : null;
  const t = `${L(ctx, S.classification)}: ${label ?? NA(ctx.lang)}`;
  const html = root(
    ctx,
    "ClassificationBadge",
    {},
    el(
      ctx,
      "p",
      "badge-" + (code ?? (v && v.generalized ? "INTERNAL" : "UNKNOWN")),
      { "data-field": "classification_marking", "data-missing": label ? null : "true" },
      escHtml(t),
    ),
  );
  return out(html, t, [tb(t, { size: "Small", color: code === "RESTRICTED" ? "Attention" : "Default" })]);
}

// 3 EventSummary — what happened (recorded fact)
export function renderEventSummary(model0: unknown, ctx: RenderCtx): ComponentOutput {
  const model = check(model0, ctx);
  const v = F(model, "event_summary");
  const s = show(v, ctx.lang);
  if (!s) {
    const m = missing(ctx, "event_summary");
    return out(root(ctx, "EventSummary", {}, m.html), m.text, [tb(m.text)]);
  }
  const generalized = !!v && v.generalized === true;
  // one value from the exported vocabulary (lib/notifications/data-epistemic.ts); an unknown class fails closed
  const epistemic = dataEpistemicFor(v?.epistemic, generalized);
  const tag =
    epistemic === "RECORDED_FACT"
      ? ` <span${sty(ctx, "stateLabel")}>(${escHtml(L(ctx, S.recordedFact))})</span>`
      : "";
  const mt = meetingLine(F(model, "meeting_info"), ctx);
  const html = root(
    ctx,
    "EventSummary",
    { "data-epistemic": epistemic },
    el(ctx, "p", "p", {}, `<span data-field="event_summary">${escHtml(s)}</span>${tag}`) +
      (mt ? el(ctx, "p", "meta", { "data-field": "meeting_info" }, escHtml(mt)) : ""),
  );
  return out(html, [s, mt], [tb(s), ...(mt ? [tb(mt, { weight: "Bolder" })] : [])]);
}
/** meeting/hearing logistics (time, place, mode) — only when meeting_info survived the projection */
function meetingLine(m: unknown, ctx: RenderCtx): string | null {
  if (!m || typeof m !== "object") return null;
  const mi = m as { generalized?: unknown; at?: unknown; place?: unknown; mode?: unknown };
  if (mi.generalized) return pick(m, ctx.lang) || null;
  const parts: string[] = [];
  if (mi.at) parts.push(`${L(ctx, S.meetingAt)}: ${fmtRiyadh(mi.at, ctx.lang) ?? NA(ctx.lang)}`);
  if (mi.place) parts.push(`${L(ctx, S.meetingPlace)}: ${pick(mi.place, ctx.lang) || NA(ctx.lang)}`);
  if (mi.mode) parts.push(pick(mi.mode, ctx.lang));
  return parts.length ? parts.join(" — ") : null;
}

// 4 ExceptionWarning — suspension, return, cancellation, failure, correction (only when present)
const EXC_STATE: Readonly<Record<string, "SUSPENDED" | "RETURNED" | "CANCELLED" | "FAILED">> = {
  SUSPENDED: "SUSPENDED",
  RETURNED: "RETURNED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
};
export function renderExceptionWarning(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const v = F(model, "exception_indicator");
  if (!v) return null;
  const s = show(v, ctx.lang) ?? NA(ctx.lang);
  // a generalized indicator carries no state: a neutral notice glyph, never a Layer A state symbol
  const st = v.generalized ? null : (own(EXC_STATE, v.kind) ?? "FAILED");
  const glyph = st ? LAYER_A[st].sym : "⚠︎";
  const aria = st ? L(ctx, LAYER_A[st]) : L(ctx, S.exception);
  const html = root(
    ctx,
    "ExceptionWarning",
    { role: ctx.experience === "PLATFORM" ? "note" : null },
    el(
      ctx,
      "p",
      "warn",
      {},
      `${sym(ctx, glyph, aria, st ? "sym-" + st : "sym-B")} <strong>${escHtml(L(ctx, S.exception))}:</strong> <span data-field="exception_indicator">${escHtml(s)}</span>`,
    ),
  );
  return out(html, `${glyph} ${L(ctx, S.exception)}: ${s}`, [
    tb(`${L(ctx, S.exception)}: ${s}`, { color: "Warning", weight: "Bolder" }),
  ]);
}

// 5 SmartNextActionCard — always rendered (READ_ONLY / NONE included); «غير متاح» when withheld or absent
export function renderSmartNextActionCard(model0: unknown, ctx: RenderCtx): ComponentOutput {
  const model = check(model0, ctx);
  const na = F(model, "next_action");
  const lang = ctx.lang;
  if (!na || typeof na !== "object" || na.generalized || na.safe_reference || !na.kind) {
    const t = `${L(ctx, S.required)}: ${NA(lang)}`;
    const html = root(
      ctx,
      "SmartNextActionCard",
      { "data-action-kind": "UNAVAILABLE" },
      el(
        ctx,
        "div",
        "action",
        {},
        el(
          ctx,
          "p",
          "actionText",
          { "data-field": "next_action", "data-missing": "true" },
          escHtml(NA(lang)),
        ),
      ),
    );
    return out(
      html,
      [`[${L(ctx, S.required)}]`, NA(lang)],
      [{ type: "Container", style: "emphasis", items: [tb(t, { weight: "Bolder" })] }],
    );
  }
  const main = pick(na, lang) || NA(lang);
  const parts = [el(ctx, "p", "actionText", { "data-field": "next_action" }, escHtml(main))];
  const text = [`[${L(ctx, S.required)}]`, main];
  const cardItems = [
    tb(L(ctx, S.required), { weight: "Bolder" }),
    tb(main, { weight: "Bolder", color: "Accent" }),
  ];
  const channel = own(S.channel, na.how?.channel);
  if (na.kind !== "READ_ONLY" && na.how?.channel && channel) {
    const h = `${L(ctx, S.how)}: ${L(ctx, channel)}`;
    parts.push(el(ctx, "p", "meta", {}, escHtml(h)));
    text.push(h);
    cardItems.push(tb(h, { size: "Small" }));
  }
  const auth = na.authority as { code?: unknown } | null | undefined;
  if (auth?.code === "SOURCE_REQUIRED_DRAFT") {
    const d = L(ctx, S.draftBasis);
    parts.push(el(ctx, "p", "muted", {}, escHtml(d)));
    text.push(d);
    cardItems.push(tb(d, { size: "Small", isSubtle: true }));
  }
  const rights = ((na.optional_rights || []) as readonly (Bi | null | undefined)[]).filter(
    (r): r is Bi => !!r && !!(r.ar || r.en),
  );
  if (rights.length) {
    const items = rights.map((r) => itemB(ctx, "OPTIONAL", pick(r, lang), { field: "next_action" }));
    parts.push(
      heading(ctx, 3, L(ctx, S.optionalRights)),
      wrapList(
        ctx,
        items.map((i) => i.html),
      ),
    );
    text.push(`${L(ctx, S.optionalRights)}:`, ...items.map((i) => i.text));
    cardItems.push(tb(items.map((i) => i.text).join("\n")));
  }
  const wn = (
    (na.what_next || []) as readonly ((Bi & { kind?: string; condition?: Bi }) | null | undefined)[]
  ).filter((w): w is Bi & { kind?: string; condition?: Bi } => !!w && !!(w.ar || w.en));
  if (wn.length) {
    const items = wn.map((w) =>
      itemB(ctx, w.kind, pick(w, lang), { field: "next_action", condition: w.condition }),
    );
    parts.push(
      heading(ctx, 3, L(ctx, S.whatNext)),
      wrapList(
        ctx,
        items.map((i) => i.html),
      ),
    );
    text.push(`${L(ctx, S.whatNext)}:`, ...items.map((i) => i.text));
    cardItems.push(
      tb(L(ctx, S.whatNext), { weight: "Bolder", size: "Small" }),
      tb(items.map((i) => i.text).join("\n"), { size: "Small" }),
    );
  }
  const html = root(
    ctx,
    "SmartNextActionCard",
    { "data-action-kind": na.kind, "data-informational": na.informational ? "true" : "false" },
    el(ctx, "div", "action", {}, parts.join("")),
  );
  return out(html, text, [{ type: "Container", style: "emphasis", items: cardItems }]);
}

// 6 DeadlineIndicator — a date only with a recorded basis event and a rule id; otherwise the reason (never an invented date)
export function renderDeadlineIndicator(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const d = F(model, "deadline");
  if (!d || typeof d !== "object" || d.generalized || d.safe_reference) return null;
  const lang = ctx.lang;
  const kindLabel = own(S.deadlineKinds, d.kind);
  const label = kindLabel ? L(ctx, kindLabel) : L(ctx, S.deadline);
  let line: string;
  let basisLine: string | null = null;
  if (d.at) {
    const when = fmtRiyadh(d.at, lang) ?? NA(lang);
    line = `${label}: ${when}`;
    const basis = F(model, "deadline_basis");
    if (basis && (basis.ar || basis.en)) basisLine = `${L(ctx, S.deadlineBasis)}: ${pick(basis, lang)}`;
    else if (d.basis_withheld) basisLine = L(ctx, S.basisWithheld);
  } else {
    line = `${label}: ${d.reason ? pick(d.reason, lang) : NA(lang)}`;
  }
  const html = root(
    ctx,
    "DeadlineIndicator",
    { "data-deadline": d.at ? "SET" : "SOURCE_REQUIRED" },
    [
      el(ctx, "p", d.at ? "p" : "muted", { "data-field": "deadline" }, escHtml(line)),
      basisLine ? el(ctx, "p", "muted", { "data-field": "deadline_basis" }, escHtml(basisLine)) : "",
    ].join(""),
  );
  return out(
    html,
    [line, basisLine],
    [
      tb(line, { weight: d.at ? "Bolder" : "Default" }),
      ...(basisLine ? [tb(basisLine, { size: "Small", isSubtle: true })] : []),
    ],
  );
}

// 7 SecureActionLink — https, allowlisted origin, platform path shape; otherwise no anchor
export function renderSecureActionLink(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const na = F(model, "next_action");
  if (!na || typeof na !== "object" || !na.how || na.kind === "READ_ONLY") return null;
  const how = na.how as {
    link_kind?: unknown;
    channel?: unknown;
    link_note?: unknown;
    app?: unknown;
    path?: unknown;
  };
  if (how.link_kind === "NONE") {
    const msg =
      how.channel === "SECRETARIAT_MAILBOX"
        ? L(ctx, S.mailboxHow)
        : how.link_note === "NO_DEEP_LINK_FOR_OBJECT_TYPE"
          ? L(ctx, S.noDeepLink)
          : null;
    if (!msg) return null;
    return out(
      root(ctx, "SecureActionLink", { "data-link": "NONE" }, el(ctx, "p", "muted", {}, escHtml(msg))),
      msg,
      [tb(msg, { size: "Small", isSubtle: true })],
    );
  }
  const href = safeHref(how.app, how.path);
  if (!href) {
    const msg = L(ctx, S.linkUnavailable);
    return out(
      root(
        ctx,
        "SecureActionLink",
        { "data-link": "REJECTED" },
        el(ctx, "p", "muted", { "data-missing": "true" }, escHtml(msg)),
      ),
      msg,
      [tb(msg, { size: "Small" })],
    );
  }
  // safeHref accepted it: the path is a platform path string
  const label =
    how.app === "WHISTLEBLOWING_WEB"
      ? L(ctx, S.openFollowUp)
      : /^\/my-defence\//.test(String(how.path))
        ? L(ctx, S.openDefence)
        : L(ctx, S.open);
  const host = new URL(href).host; // href passed safeHref: own allowlisted origin + platform path
  const anchor = `<a href="${escHtml(href)}"${sty(ctx, "button")}>${escHtml(label)}</a>`;
  const html = root(
    ctx,
    "SecureActionLink",
    { "data-link": how.link_kind as string | undefined },
    [
      el(ctx, "p", "p", {}, anchor),
      el(ctx, "p", "muted", {}, `${escHtml(L(ctx, S.destination))}: ${bdi(ctx, host)}`),
    ].join(""),
  );
  return out(html, [`${label}: ${href}`], [tb(`${label}: ${host}`, { size: "Small" })]);
}

// ---------------------------------------------------------------------------------------------------------------
// Procedure status: Level 1 (case, master journey), Level 2 (journey of the notification object), Level 3 (steps)
// ---------------------------------------------------------------------------------------------------------------
function l1Line(model: RenderModel, ctx: RenderCtx): { text: string; exists: boolean } | null {
  const v = F(model, "l1_stage_name");
  if (isNil(v)) return null;
  if (v.generalized) return { text: pick(v, ctx.lang), exists: true };
  if (v.exists === false) return { text: L(ctx, S.noCasePath), exists: false };
  const name = pick(v, ctx.lang);
  const pos = v.position && v.of ? fill(L(ctx, S.stageOf), { n: v.position, of: v.of }) : null;
  return { text: pos ? `${pos}: ${name || NA(ctx.lang)}` : name || NA(ctx.lang), exists: true };
}
function currentStepOf(l3: L3Steps | null | undefined): StepView | null {
  const st = (l3?.stages || []).find((s) => s.n === l3?.current_stage) ?? null;
  const actual = (st?.steps || []).filter((x) => x.layer === "actual");
  return (
    actual.find((x) => !["COMPLETED", "NOT_APPLICABLE", "CANCELLED"].includes(String(x.state))) ??
    actual.filter((x) => x.state === "COMPLETED").pop() ??
    null
  );
}

// 8 ProceduralStatusCard — Level 1 (data-level="1"): master stage from CaseRecord.status.code only
export function renderProceduralStatusCard(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const internal = isInternal(model);
  const line = l1Line(model, ctx);
  if (!line && !internal) return null;
  const parts = [heading(ctx, 3, L(ctx, S.level1))];
  const text = [`${L(ctx, S.level1)}:`];
  const card: CardElement[] = [];
  if (!line) {
    const m = missing(ctx, "l1_stage_name");
    parts.push(m.html);
    text.push(m.text);
    card.push(tb(m.text));
  } else {
    parts.push(el(ctx, "p", "p", { "data-field": "l1_stage_name" }, escHtml(line.text)));
    text.push(line.text);
    card.push(tb(line.text, { weight: "Bolder" }));
    const sub = F(model, "l1_substate");
    if (line.exists && internal && sub && !sub.generalized) {
      const t = `${L(ctx, S.subState)}: ${sub.code ? sub.code + " — " : ""}${pick(sub, ctx.lang) || NA(ctx.lang)}`;
      parts.push(el(ctx, "p", "meta", { "data-field": "l1_substate" }, escHtml(t)));
      text.push(t);
      card.push(tb(t, { size: "Small" }));
    }
    const v = F(model, "l1_stage_name");
    if (
      ctx.density === "ADVANCED" &&
      internal &&
      line.exists &&
      Array.isArray(v?.stages) &&
      v.stages.length
    ) {
      const items = v.stages.map((s) => {
        const nm = `${s.code} ${pick(s, ctx.lang)}`;
        if (s.code === v.code)
          return itemA(ctx, "IN_PROGRESS", `${nm} — ${L(ctx, S.currentStage)}`, { field: "l1_stage_name" });
        const rel = s.position < (v.position ?? 0) ? S.earlierStage : S.laterStage;
        return {
          html: el(
            ctx,
            listTag(ctx),
            "itemPlain",
            { "data-field": "l1_stage_name" },
            `${escHtml(nm)} <span${sty(ctx, "stateLabel")}>(${escHtml(L(ctx, rel))})</span>`,
          ),
          text: `${nm} (${L(ctx, rel)})`,
        };
      });
      parts.push(
        wrapList(
          ctx,
          items.map((i) => i.html),
        ),
      );
      text.push(...items.map((i) => "  " + i.text));
    }
  }
  const pst = F(model, "procedural_status_text");
  if (pst) {
    const t = pick(pst, ctx.lang);
    if (t) {
      parts.push(el(ctx, "p", "meta", { "data-field": "procedural_status_text" }, escHtml(t)));
      text.push(t);
      card.push(tb(t, { size: "Small" }));
    }
  }
  return out(root(ctx, "ProceduralStatusCard", { "data-level": "1" }, parts.join("")), text, card);
}

// 9 JourneySummary — Level 2 (data-level="2"): the journey of the notification object in the recipient's capacity wording
export function renderJourneySummary(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const internal = isInternal(model);
  const j = F(model, "l2_journey");
  if (!j && !internal) return null;
  const lang = ctx.lang;
  if (!j) {
    const m = missing(ctx, "l2_journey");
    return out(
      root(ctx, "JourneySummary", { "data-level": "2" }, heading(ctx, 3, L(ctx, S.level2)) + m.html),
      [`${L(ctx, S.level2)}:`, m.text],
      [tb(m.text)],
    );
  }
  if (j.generalized) {
    const t = pick(j, lang);
    return out(
      root(
        ctx,
        "JourneySummary",
        { "data-level": "2" },
        heading(ctx, 3, L(ctx, S.level2)) + el(ctx, "p", "p", { "data-field": "l2_journey" }, escHtml(t)),
      ),
      t,
      [tb(t)],
    );
  }
  const object = pick(j.object, lang) || NA(lang);
  const capacity = pick(j.capacity, lang);
  const parts = [heading(ctx, 3, `${L(ctx, S.level2)}: ${object}`)];
  const text = [`${L(ctx, S.level2)}: ${object}`];
  if (capacity) {
    const c = `${L(ctx, S.capacity)}: ${capacity}`;
    parts.push(el(ctx, "p", "meta", { "data-field": "l2_journey" }, escHtml(c)));
    text.push(c);
  }
  const items = (j.stages || []).map((s) => {
    const nm = `${s.n}. ${pick(s, lang) || NA(lang)}`;
    if (s.layer === "actual" && !layerA(s.state)) {
      // a past stage with no recorded state: shown as «غير متاح», never with a fabricated Layer A state
      return {
        html: el(
          ctx,
          listTag(ctx),
          "itemPlain",
          { "data-field": "l2_journey", "data-missing": "true" },
          `${escHtml(nm)} <span${sty(ctx, "stateLabel")}>(${escHtml(NA(lang))})</span>`,
        ),
        text: `${nm} (${NA(lang)})`,
      };
    }
    return s.layer === "actual"
      ? itemA(ctx, s.state, nm, {
          field: "l2_journey",
          evidence: s.state === "COMPLETED" && (s.evidence_recorded || s.evidence_event_id),
          note: s.note_label,
        })
      : itemB(ctx, s.kind, nm, { field: "l2_journey", condition: s.condition, note: s.note_label });
  });
  if (items.length) {
    parts.push(
      wrapList(
        ctx,
        items.map((i) => i.html),
      ),
    );
    text.push(...items.map((i) => "  " + i.text));
  } else {
    const m = missing(ctx, "l2_journey");
    parts.push(m.html);
    text.push(m.text);
  }
  if (ctx.density === "ADVANCED" && j.closure) {
    const c = `${L(ctx, S.closure)}: ${pick(j.closure, lang)}`;
    parts.push(el(ctx, "p", "muted", { "data-field": "l2_journey" }, escHtml(c)));
    text.push(c);
  }
  const cur = (j.stages || []).find((s) => s.n === j.current_stage);
  const card = [tb(`${L(ctx, S.level2)}: ${object}`, { weight: "Bolder" })];
  if (cur)
    card.push(
      tb(`${fill(L(ctx, S.stageOf), { n: cur.n, of: (j.stages || []).length })}: ${pick(cur, lang)}`),
    );
  return out(root(ctx, "JourneySummary", { "data-level": "2" }, parts.join("")), text, card);
}

function stagesForDensity(l3: L3Steps, density: Density): NonNullable<L3Steps["stages"]> {
  const all = (l3?.stages || []).filter((s) => (s.steps || []).length);
  if (density === "ADVANCED") return all;
  const cur = all.find((s) => s.n === l3.current_stage);
  return cur ? [cur] : [];
}
// 10 ActualProgress — Level 3 (data-level="3"), Layer A: recorded steps only
export function renderActualProgress(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const internal = isInternal(model);
  const l3 = F(model, "l3_steps");
  if (!l3 && !internal) return null;
  const lang = ctx.lang;
  const parts = [
    heading(ctx, 3, L(ctx, S.level3)),
    el(ctx, "p", "muted", {}, escHtml(L(ctx, S.actualProgress))),
  ];
  const text = [`${L(ctx, S.level3)} — ${L(ctx, S.actualProgress)}:`];
  if (!l3 || l3.generalized) {
    const m = l3?.generalized
      ? {
          html: el(ctx, "p", "p", { "data-field": "l3_steps" }, escHtml(pick(l3, lang))),
          text: pick(l3, lang),
        }
      : missing(ctx, "l3_steps");
    parts.push(m.html);
    text.push(m.text);
    return out(root(ctx, "ActualProgress", { "data-level": "3" }, parts.join("")), text, [tb(m.text)]);
  }
  let count = 0;
  for (const st of stagesForDensity(l3, ctx.density)) {
    const actual = st.steps.filter((x) => x.layer === "actual");
    if (!actual.length) continue;
    const items = actual.map((x) =>
      itemA(ctx, x.state, pick(x, lang), {
        field: "l3_steps",
        evidence: x.state === "COMPLETED" && (x.evidence_recorded || x.evidence_event_id),
        note: x.note_label,
      }),
    );
    count += items.length;
    const sh = `${st.n}. ${pick(st, lang) || NA(lang)}`;
    parts.push(
      el(ctx, "p", "meta", {}, escHtml(sh)),
      wrapList(
        ctx,
        items.map((i) => i.html),
      ),
    );
    text.push(sh, ...items.map((i) => "  " + i.text));
  }
  if (!count) {
    const m = missing(ctx, "l3_steps");
    parts.push(m.html);
    text.push(m.text);
  }
  const cs = currentStepOf(l3);
  const card = cs
    ? [tb(`${L(ctx, S.currentStep)}: ${pick(cs, lang)} (${L(ctx, layerA(cs.state) ?? LAYER_A.PENDING)})`)]
    : [];
  return out(root(ctx, "ActualProgress", { "data-level": "3" }, parts.join("")), text, card);
}

// 11 ExpectedProcess — Level 3 (data-level="3"), Layer B: what is expected but has not happened (expandable on the platform)
export function renderExpectedProcess(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const l3 = F(model, "l3_steps");
  if (!l3 || l3.generalized) return null;
  const lang = ctx.lang;
  const groups: { head: string; items: { html: string; text: string }[] }[] = [];
  const stages = (l3.stages || []).filter((s) => (s.steps || []).some((x) => x.layer === "expected"));
  const curN = l3.current_stage ?? Number.NaN;
  let chosen: NonNullable<L3Steps["stages"]>;
  if (ctx.density === "ADVANCED") chosen = stages;
  else {
    const cur = stages.find((s) => s.n === l3.current_stage);
    const next = stages.find((s) => s.n > curN);
    chosen = [cur, next].filter((x): x is NonNullable<typeof x> => Boolean(x));
  }
  for (const st of chosen) {
    let exp = st.steps.filter((x) => x.layer === "expected");
    if (ctx.density !== "ADVANCED" && st.n !== l3.current_stage) exp = exp.slice(0, 1);
    const items = exp.map((x) =>
      itemB(ctx, x.kind, pick(x, lang), { field: "l3_steps", condition: x.condition, note: x.note_label }),
    );
    if (items.length) groups.push({ head: `${st.n}. ${pick(st, lang) || NA(lang)}`, items });
  }
  if (!groups.length) return null;
  const inner = groups
    .map(
      (g) =>
        el(ctx, "p", "meta", {}, escHtml(g.head)) +
        wrapList(
          ctx,
          g.items.map((i) => i.html),
        ),
    )
    .join("");
  const title = L(ctx, S.expectedProcess);
  const body =
    ctx.experience === "PLATFORM"
      ? `<details class="c-details"><summary class="c-summary">${escHtml(L(ctx, S.showExpected))} — ${escHtml(title)}</summary>${inner}</details>`
      : el(ctx, "p", "muted", {}, escHtml(title)) + inner;
  const text = [`${title}:`, ...groups.flatMap((g) => [g.head, ...g.items.map((i) => "  " + i.text)])];
  return out(root(ctx, "ExpectedProcess", { "data-level": "3" }, body), text, [
    tb(
      `${title}: ${groups
        .flatMap((g) => g.items.map((i) => i.text))
        .slice(0, 3)
        .join(" · ")}`,
      { size: "Small", isSubtle: true },
    ),
  ]);
}

// 12 SimplifiedView — COMPACT: one line per allowed level; internal recipients always get three lines («غير متاح» if withheld)
export function renderSimplifiedView(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const internal = isInternal(model);
  const lang = ctx.lang;
  const lines: { level: number; html: string; text: string }[] = [];
  const l1 = l1Line(model, ctx);
  if (l1)
    lines.push({
      level: 1,
      html: el(
        ctx,
        "p",
        "p",
        { "data-level": "1", "data-field": "l1_stage_name" },
        escHtml(`${L(ctx, S.levelLine1)}: ${l1.text}`),
      ),
      text: `${L(ctx, S.levelLine1)}: ${l1.text}`,
    });
  else if (internal) {
    const t = `${L(ctx, S.levelLine1)}: ${NA(lang)}`;
    lines.push({
      level: 1,
      html: el(
        ctx,
        "p",
        "muted",
        { "data-level": "1", "data-field": "l1_stage_name", "data-missing": "true" },
        escHtml(t),
      ),
      text: t,
    });
  }
  const j = F(model, "l2_journey");
  if (j && !j.generalized) {
    const cur = (j.stages || []).find((s) => s.n === j.current_stage);
    const lab = `${pick(j.object, lang) || NA(lang)}: ${cur ? fill(L(ctx, S.stageOf), { n: cur.n, of: (j.stages || []).length }) + " — " + pick(cur, lang) : NA(lang)}`;
    if (cur && cur.layer === "actual") {
      const a = itemA(ctx, cur.state, lab, { field: "l2_journey" });
      lines.push({ level: 2, html: `<div data-level="2">${wrapList(ctx, [a.html])}</div>`, text: a.text });
    } else
      lines.push({
        level: 2,
        html: el(ctx, "p", "p", { "data-level": "2", "data-field": "l2_journey" }, escHtml(lab)),
        text: lab,
      });
  } else if (j && j.generalized)
    lines.push({
      level: 2,
      html: el(ctx, "p", "p", { "data-level": "2", "data-field": "l2_journey" }, escHtml(pick(j, lang))),
      text: pick(j, lang),
    });
  else if (internal) {
    const t = `${L(ctx, S.level2)}: ${NA(lang)}`;
    lines.push({
      level: 2,
      html: el(
        ctx,
        "p",
        "muted",
        { "data-level": "2", "data-field": "l2_journey", "data-missing": "true" },
        escHtml(t),
      ),
      text: t,
    });
  }
  const l3 = F(model, "l3_steps");
  const cs = l3 && !l3.generalized ? currentStepOf(l3) : null;
  if (cs) {
    const a = itemA(ctx, cs.state, `${L(ctx, S.levelLine3)}: ${pick(cs, lang) || NA(lang)}`, {
      field: "l3_steps",
    });
    lines.push({ level: 3, html: `<div data-level="3">${wrapList(ctx, [a.html])}</div>`, text: a.text });
  } else if (l3 || internal) {
    const t = `${L(ctx, S.levelLine3)}: ${NA(lang)}`;
    lines.push({
      level: 3,
      html: el(
        ctx,
        "p",
        "muted",
        { "data-level": "3", "data-field": "l3_steps", "data-missing": "true" },
        escHtml(t),
      ),
      text: t,
    });
  }
  if (!lines.length) return null;
  const html = root(
    ctx,
    "SimplifiedView",
    {},
    heading(ctx, 3, L(ctx, S.simplified)) + lines.map((l) => l.html).join(""),
  );
  return out(
    html,
    [`${L(ctx, S.simplified)}:`, ...lines.map((l) => l.text)],
    lines.map((l) => tb(l.text, { size: "Small" })),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Details (ADVANCED): evidence references, decision rights, delivery status, audit reference
// ---------------------------------------------------------------------------------------------------------------
// 13 EvidenceReference — references of recorded events that establish Layer A states (never evidence content)
export function renderEvidenceReference(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const refs = F(model, "evidence_refs");
  if (!Array.isArray(refs) || !refs.length) return null;
  const lines = refs.map(
    (r) =>
      `${r.event_id ?? NA(ctx.lang)} — ${r.type ?? NA(ctx.lang)}${r.recorded_at ? " — " + (fmtRiyadh(r.recorded_at, ctx.lang) ?? NA(ctx.lang)) : ""}`,
  );
  // the event type is a Latin code: isolated like the id, so a following date's digits are not pulled into its LTR run
  const items = refs.map((r) =>
    el(
      ctx,
      listTag(ctx),
      "itemPlain",
      { "data-field": "evidence_refs" },
      `${bdi(ctx, r.event_id ?? NA(ctx.lang))} — ${r.type ? bdi(ctx, r.type) : escHtml(NA(ctx.lang))}${r.recorded_at ? " — " + escHtml(fmtRiyadh(r.recorded_at, ctx.lang) ?? NA(ctx.lang)) : ""}`,
    ),
  );
  return out(
    root(ctx, "EvidenceReference", {}, heading(ctx, 3, L(ctx, S.evidence)) + wrapList(ctx, items)),
    [`${L(ctx, S.evidence)}:`, ...lines.map((l) => "  " + l)],
    [tb(`${L(ctx, S.evidence)}: ${refs.length}`, { size: "Small", isSubtle: true })],
  );
}

// 14 DecisionRightsIndicator — the recipient's authority for the action (administrative vs formal; basis status)
export function renderDecisionRightsIndicator(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const r = F(model, "decision_rights");
  if (!r || typeof r !== "object") return null;
  const lang = ctx.lang;
  if (r.generalized) {
    const g = pick(r, lang);
    return out(
      root(
        ctx,
        "DecisionRightsIndicator",
        { "data-result": "GENERALIZED" },
        heading(ctx, 3, L(ctx, S.rights)) +
          el(ctx, "p", "p", { "data-field": "decision_rights" }, escHtml(g)),
      ),
      [`${L(ctx, S.rights)}:`, g],
      [tb(`${L(ctx, S.rights)}: ${g}`, { size: "Small" })],
    );
  }
  const lines: { text: string; field: string; key: string; warn?: boolean }[] = [];
  const role = own(S.roles, r.role);
  if (r.action)
    lines.push({
      text: `${pick(r.action, lang)}${r.role && role ? " — " + L(ctx, role) : ""}`,
      field: "decision_rights",
      key: "p",
    });
  lines.push({
    text: r.administrative ? L(ctx, S.administrative) : L(ctx, S.formal),
    field: "decision_rights",
    key: "meta",
  });
  const basis = own(S.basisStatus, r.basis_status);
  if (r.basis_status && basis)
    lines.push({
      text: L(ctx, basis),
      field: "decision_rights",
      key: "meta",
      warn: r.basis_status === "SOURCE_REQUIRED",
    });
  if (r.reason) lines.push({ text: pick(r.reason, lang), field: "decision_rights", key: "meta" });
  const names = F(model, "member_names");
  if (Array.isArray(names) && names.length)
    lines.push({
      text: `${L(ctx, S.holders)}: ${names.join(lang === "ar" ? AR["separator.list"] : EN["separator.list"])}`,
      field: "member_names",
      key: "meta",
    });
  const html = root(
    ctx,
    "DecisionRightsIndicator",
    { "data-result": r.result ?? null },
    heading(ctx, 3, L(ctx, S.rights)) +
      lines
        .map((l) =>
          el(
            ctx,
            "p",
            l.key,
            { "data-field": l.field },
            (l.warn ? sym(ctx, "⚠︎", L(ctx, S.basisStatus.SOURCE_REQUIRED), "sym-FAILED") + " " : "") +
              escHtml(l.text),
          ),
        )
        .join(""),
  );
  return out(
    html,
    [`${L(ctx, S.rights)}:`, ...lines.map((l) => l.text)],
    [
      tb(
        `${L(ctx, S.rights)}: ${lines
          .slice(0, 2)
          .map((l) => l.text)
          .join(" — ")}`,
        { size: "Small" },
      ),
    ],
  );
}

export type DeliveryKey = keyof typeof DELIVERY;
/**
 * deliveryWording(d, experience) → {key, wording:{ar,en}} — the notification's own status in words (lead rulings, 27 Oct 2026):
 *  - L-07: e-mail is read as ACCEPTANCE: a sender success (SENT / DELIVERY_ACCEPTED_BY_PROVIDER) is «أُرسل — لم يُؤكَّد التسليم»;
 *    DELIVERY_CONFIRMED on e-mail is worded as delivered only with a provider delivery report (`provider_report === true`),
 *    otherwise it falls back to the acceptance wording (fail safe);
 *  - L-02: IN_APP — the committed inbox row is the delivery to the inbox;
 *  - a read (`read === true`) is never an acknowledgement; acknowledgement is a domain record and is not shown here;
 *  - L-04: SUPERSEDED only when the correcting version is SENT (`superseded_by_sent === true`); otherwise, and whenever a
 *    correction is in progress, the notice is the current version and «يجري إعداد تصحيح» is shown.
 */
export function deliveryWording(
  d: DeliveryInput | null | undefined,
  experience?: string,
): { key: DeliveryKey; wording: { ar: string; en: string } } {
  const st = String(d?.notification_status ?? "");
  const channel = d?.channel ?? (experience === "PLATFORM" ? "IN_APP" : "EMAIL");
  let key: DeliveryKey;
  if (["DRAFT"].includes(st)) key = "DRAFT";
  else if (["VALIDATED", "AUTHORIZATION_PENDING", "AUTHORIZED", "QUEUED", "CORRECTED"].includes(st))
    key = "NOT_SENT";
  else if (["SENT", "DELIVERY_ACCEPTED_BY_PROVIDER"].includes(st))
    key = channel === "IN_APP" ? "IN_APP" : "SENT_EMAIL";
  else if (st === "DELIVERY_CONFIRMED")
    key =
      channel === "IN_APP" ? "IN_APP" : d?.provider_report === true ? "DELIVERED_EMAIL_REPORT" : "SENT_EMAIL";
  else if (st === "DELIVERY_FAILED") key = "FAILED";
  else if (st === "CANCELLED") key = "CANCELLED";
  else if (st === "SUPERSEDED") key = d?.superseded_by_sent === true ? "SUPERSEDED" : "CORRECTION_PREPARING";
  else key = "UNKNOWN";
  const parts: { ar: string; en: string }[] = [DELIVERY[key]];
  if (d?.correction_in_progress === true && key !== "SUPERSEDED" && key !== "CORRECTION_PREPARING")
    parts.push(DELIVERY.CORRECTION_PREPARING);
  if (d?.read === true && !["DRAFT", "NOT_SENT", "CANCELLED", "UNKNOWN"].includes(key))
    parts.push(DELIVERY.OPENED);
  return {
    key,
    wording: {
      ar: parts.map((x) => x.ar).join(AR["separator.clause"]),
      en: parts.map((x) => x.en).join(EN["separator.clause"]),
    },
  };
}

// 15 DeliveryStatus — the notification's own status; never claims delivery or reading (L-07, L-02, L-04)
export function renderDeliveryStatus(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const d = F(model, "delivery_status");
  if (!d || typeof d !== "object") return null;
  const w = deliveryWording(d, ctx.experience);
  const t = `${L(ctx, S.delivery)}: ${L(ctx, w.wording)}${d.note ? " — " + pick(d.note, ctx.lang) : ""}`;
  const html = root(
    ctx,
    "DeliveryStatus",
    {},
    heading(ctx, 3, L(ctx, S.delivery)) +
      el(ctx, "p", "p", { "data-field": "delivery_status", "data-delivery": w.key }, escHtml(t)) +
      el(ctx, "p", "muted", {}, escHtml(L(ctx, S.deliveryNote))),
  );
  return out(html, [t, L(ctx, S.deliveryNote)], [tb(t, { size: "Small", isSubtle: true })]);
}

// 16 AuditReference — audit ledger ids (append-only ledger; ids only, no content)
export function renderAuditReference(model0: unknown, ctx: RenderCtx): ComponentOutput | null {
  const model = check(model0, ctx);
  const a = F(model, "audit_refs");
  if (!Array.isArray(a) || !a.length) return null;
  // an entry is the audit id itself (scenario shape) or {audit_id}; anything else is shown as «غير متاح», never guessed
  const ids = (a as readonly unknown[]).map((x) => {
    if (typeof x === "string" && x) return x;
    const o = x && typeof x === "object" ? (x as { audit_id?: unknown }) : null;
    return o && typeof o.audit_id === "string" && o.audit_id ? o.audit_id : NA(ctx.lang);
  });
  const html = root(
    ctx,
    "AuditReference",
    {},
    heading(ctx, 3, L(ctx, S.audit)) +
      el(ctx, "p", "meta", { "data-field": "audit_refs" }, ids.map((id) => bdi(ctx, id)).join(" · ")),
  );
  return out(html, `${L(ctx, S.audit)}: ${ids.join(" · ")}`, [
    tb(`${L(ctx, S.audit)}: ${ids.join(" · ")}`, { size: "Small", isSubtle: true }),
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// Help: confidentiality and contextual help (static wording per recipient group + the allowed `help` field)
// ---------------------------------------------------------------------------------------------------------------
const groupOf = (cls: string): string =>
  (INTERNAL_CLASSES as readonly string[]).includes(cls) ? "INTERNAL" : cls;
// 17 ConfidentialityNotice — always rendered
export function renderConfidentialityNotice(model0: unknown, ctx: RenderCtx): ComponentOutput {
  const model = check(model0, ctx);
  const f = F(model, "confidentiality_notice");
  const g = groupOf(model.meta.recipient_class);
  // the class's static sentence travels as the confidentiality_notice field (one decision per field); the static i18n
  // sentence is the fallback for a model built without it (it is fixed wording, never case data)
  const t = f ? pick(f, ctx.lang) : L(ctx, own(CONFIDENTIALITY, g) ?? CONFIDENTIALITY.INTERNAL);
  const html = root(
    ctx,
    "ConfidentialityNotice",
    {},
    heading(ctx, 3, L(ctx, S.confidentiality)) +
      el(ctx, "p", "note", f ? { "data-field": "confidentiality_notice" } : {}, escHtml(t)),
  );
  return out(html, [`${L(ctx, S.confidentiality)}: ${t}`], [tb(t, { size: "Small", isSubtle: true })]);
}
// 18 ContextualHelp — always rendered (static text when `help` is withheld)
export function renderContextualHelp(model0: unknown, ctx: RenderCtx): ComponentOutput {
  const model = check(model0, ctx);
  const h = F(model, "help");
  const internal = isInternal(model);
  const lines = [
    h ? pick(h, ctx.lang) : L(ctx, internal ? HELP_STATIC.INTERNAL : HELP_STATIC.EXTERNAL),
    L(ctx, S.notADecision),
  ].filter(Boolean);
  const html = root(
    ctx,
    "ContextualHelp",
    {},
    heading(ctx, 3, L(ctx, S.help)) +
      lines
        .map((l, i) =>
          el(ctx, "p", i === 0 ? "p" : "muted", i === 0 && h ? { "data-field": "help" } : {}, escHtml(l)),
        )
        .join(""),
  );
  return out(
    html,
    [`${L(ctx, S.help)}:`, ...lines],
    [tb(lines.join(" "), { size: "Small", isSubtle: true })],
  );
}

/** registry: charter §11 names → renderer */
export const COMPONENTS: Readonly<Record<ComponentName, ComponentRenderer>> = Object.freeze({
  NotificationHeader: renderNotificationHeader,
  ClassificationBadge: renderClassificationBadge,
  EventSummary: renderEventSummary,
  SmartNextActionCard: renderSmartNextActionCard,
  ProceduralStatusCard: renderProceduralStatusCard,
  ActualProgress: renderActualProgress,
  ExpectedProcess: renderExpectedProcess,
  JourneySummary: renderJourneySummary,
  EvidenceReference: renderEvidenceReference,
  DecisionRightsIndicator: renderDecisionRightsIndicator,
  DeadlineIndicator: renderDeadlineIndicator,
  ConfidentialityNotice: renderConfidentialityNotice,
  SecureActionLink: renderSecureActionLink,
  ContextualHelp: renderContextualHelp,
  ExceptionWarning: renderExceptionWarning,
  DeliveryStatus: renderDeliveryStatus,
  AuditReference: renderAuditReference,
  SimplifiedView: renderSimplifiedView,
});
export { oneLine };
