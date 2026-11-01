import "server-only";
/**
 * CDF Notifications V13 — Experience B: e-mail (charter §11). Workstream W-D2.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Every output is a DESIGN_PREVIEW draft (X-Unsent: 1).
 * PRODUCTION_SUBSTITUTION_REQUIRED: the platform's e-mail delivery is a stub (notify.claim_email_batch /
 * notify.record_email_delivery, migration 1920); a real mail transport, sender domain, DKIM/SPF and archive are out of scope.
 * Client rendering (Outlook / Gmail / Apple Mail) is UNVERIFIED — no tenant was available; nothing here claims compatibility.
 *
 * renderEmail(projected, {lang, density, tokens, to, from, attachIcs}) →
 *   {subject, preheader, html, text, card, card_mode, card_bytes, card_errors, eml, headers, components, marking}
 *  - throws RenderError when the model did not pass project() (UNPROJECTED_MODEL via assertProjected), was projected for
 *    another experience (WRONG_EXPERIENCE), belongs to a suppressed recipient (NOTIFICATION_SUPPRESSED) or has every field
 *    withheld on the e-mail surfaces (CHANNEL_PROHIBITED, e.g. the reporter under DEC-24);
 *  - HTML: table layout, inline CSS, ≤ 600 px, <html lang dir>, system + Arabic-capable font stack, hidden preheader,
 *    DESIGN_PREVIEW banner first and last, no script except the gated Adaptive Card embed, no external resource;
 *  - text twin: complete on its own (same components, same order, same decisions); marking first and last line;
 *  - Adaptive Card 1.0: TextBlock / Container elements only, no actions (card_content is PROHIBITED in the policy until
 *    D11-074 is decided); when the full card exceeds the 28,000-byte project convention (not a Microsoft limit) a
 *    single-TextBlock compact card is used (V12 `buildActionableCard` levelsMode full → compact, reworked);
 *  - EML: RFC 5322/2045 multipart/alternative (multipart/mixed when an .ics is attached), 8bit bodies, CRLF, lines ≤ 998
 *    octets, RFC 2047 encoded words for non-ASCII headers, CR/LF and controls stripped from every header value,
 *    synthetic-domain address allowlist, deterministic boundary and Message-ID (hashes, no personal data), X-Unsent: 1.
 * Surface composition (W-F policy_v13.json `surface_composition`, FACT): subject = event_title + notice_reference only;
 * preheader = event_title only (preheader field PROHIBITED); metadata headers = notice_reference + template_code only.
 * Reused from V12 (copied and reworked, origin named; never imported at runtime):
 *  - buildEml structure + X-Unsent + encHeader ← notifications/generator/source/build_notification_generator.py lines 563–577
 *    (V12 used base64 bodies and one unfolded encoded word; V13 uses 8bit bodies and folded ≤64-char words);
 *  - card budget + compact fallback + cardJsonForHtml ← notifications/generator/source/engine_v9.js ~520–575
 *    (V12 escaped only "</"; V13 escapes <, >, &, U+2028, U+2029).
 */
import { recordRendering } from "./provenance";
import { assertProjected, outcomeOf, type Projected, type ProjectedModel } from "@/lib/disclosure/project";
import { COMPONENTS, type RenderCtx, type CardElement, type ComponentOutput } from "./components";
import {
  componentsFor,
  GROUP_OF,
  assertDensity,
  GROUPS,
  type ComponentName,
  type GroupName,
} from "./densities";
import {
  escHtml,
  oneLine,
  jsonForHtmlScript,
  encodeHeaderValue,
  formatAddressHeader,
  sanitizeHeaderText,
  rfc5322Date,
  sanitizeFilename,
  sha256Hex,
  validateAddress,
  parseZoned,
  NOT_AVAILABLE,
  stripControls,
} from "./escape";
import { MARKING, MARKING_SUBJECT_PREFIX, S, pick } from "./i18n";
import { loadTokens, type Tokens } from "./tokens";
import type { RenderModel, Lang, Experience, MeetingInfo } from "./types";
import { isNil } from "@/lib/domain/nil";
import { ar as AR } from "@/lib/i18n/notificationRender/ar";
import { en as EN } from "@/lib/i18n/notificationRender/en";

export const CARD_BUDGET_BYTES = 28000; // project convention (charter §11), not a Microsoft limit
export const EMAIL_MAX_WIDTH = 600;
export const SENDER = Object.freeze({
  address: "notifications.demo@example.test",
  ar: AR["sender.name"],
  en: EN["sender.name"],
});
const MAX_LINE_OCTETS = 998;

export type RenderErrorCode =
  | "WRONG_EXPERIENCE"
  | "NOTIFICATION_SUPPRESSED"
  | "CHANNEL_PROHIBITED"
  | "LINE_TOO_LONG"
  | "BARE_LINE_BREAK"
  | "BAD_HEADER_NAME";
export class RenderError extends Error {
  readonly code: RenderErrorCode;
  constructor(code: RenderErrorCode, message: string) {
    super(message);
    this.name = "RenderError";
    this.code = code;
  }
}

const GROUP_HEADING: Readonly<Record<Exclude<GroupName, "identity">, { ar: string; en: string }>> = {
  core: S.whatHappened,
  action: S.required,
  status: S.status,
  details: S.details,
  help: S.helpGroup,
};
const allowed = (m: RenderModel, f: string): boolean => outcomeOf(m, f) === "ALLOWED";
const byteLen = (s: string): number => Buffer.byteLength(s, "utf8");

interface DisclosureSummary {
  experience?: unknown;
  suppressed?: unknown;
  channel_prohibited?: unknown;
  recipient?: unknown;
}
/** the gate every renderer applies before drawing anything (charter §0.6) */
export function assertRenderable(projected: unknown, experience: Experience): RenderModel {
  assertProjected(projected);
  // assertProjected accepted it: a frozen projection with its disclosure summary
  const m = projected as RenderModel;
  const s = (m._disclosure_summary ?? {}) as DisclosureSummary;
  if (s.experience !== experience)
    throw new RenderError(
      "WRONG_EXPERIENCE",
      `model projected for ${String(s.experience)}, renderer is ${experience}`,
    );
  if (s.suppressed)
    throw new RenderError(
      "NOTIFICATION_SUPPRESSED",
      "restricted case: the recipient is not on the approved access list — no notification is generated",
    );
  if (s.channel_prohibited)
    throw new RenderError(
      "CHANNEL_PROHIBITED",
      `every field is withheld for ${String(s.recipient)} on ${experience}`,
    );
  return m;
}

export interface RenderedComponent extends ComponentOutput {
  name: ComponentName;
  group: GroupName;
}
/** run the density's components in charter order; returns [{name, group, html, text, card}] */
export function renderComponents(projected: Projected<ProjectedModel>, ctx: RenderCtx): RenderedComponent[] {
  const outList: RenderedComponent[] = [];
  for (const name of componentsFor(ctx.density)) {
    const r = COMPONENTS[name](projected, ctx);
    if (r) outList.push({ name, group: GROUP_OF[name], ...r });
  }
  return outList;
}

// ---------------------------------------------------------------------------------------------------------------
// subject, preheader
// ---------------------------------------------------------------------------------------------------------------
function titleOf(m: RenderModel, lang: string): string | null {
  const t = m.fields.event_title;
  return t && allowed(m, "event_title") ? (typeof t === "string" ? t : pick(t, lang)) : null;
}
export function buildSubject(m: RenderModel, lang: string): string {
  const parts = [
    MARKING_SUBJECT_PREFIX,
    titleOf(m, lang) ?? (lang === "en" ? EN["email.defaultTitle"] : AR["email.defaultTitle"]),
  ];
  if (allowed(m, "notice_reference") && typeof m.fields.notice_reference === "string")
    parts.push("— " + m.fields.notice_reference);
  return oneLine(parts.join(" "));
}
export function buildPreheader(m: RenderModel, lang: string): string {
  const title = titleOf(m, lang);
  if (!title) return MARKING;
  if (allowed(m, "preheader") && m.fields.next_action && allowed(m, "next_action"))
    return oneLine(`${title} — ${pick(m.fields.next_action, lang)}`);
  return oneLine(title);
}

// ---------------------------------------------------------------------------------------------------------------
// HTML (table layout, inline CSS)
// ---------------------------------------------------------------------------------------------------------------
interface ShellInput {
  lang: Lang;
  dir: "rtl" | "ltr";
  title: string;
  preheader: string;
  bodyRows: string;
  tokens: Tokens;
  cardScript: string | null;
}
function htmlShell({ lang, dir, title, preheader, bodyRows, tokens, cardScript }: ShellInput): string {
  const c = tokens.colors;
  const f = tokens.fonts.body;
  const align = dir === "rtl" ? "right" : "left";
  const banner = (pos: "top" | "bottom"): string =>
    `<tr>\n<td data-marking="DESIGN_PREVIEW" style="padding:10px 16px;background-color:${c.markingBg};color:${c.text};font-family:${f};font-size:14px;line-height:1.5;font-weight:700;text-align:${align};" role="note" aria-label="${escHtml(MARKING)}">${escHtml(MARKING)}${pos === "bottom" ? `<br>\n<span style="font-weight:400;font-size:13px;">${escHtml(pick(S.previewFooter, lang))}</span>` : ""}</td>\n</tr>`;
  return [
    "<!DOCTYPE html>",
    `<html lang="${lang}" dir="${dir}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escHtml(title)}</title>`,
    cardScript ?? "",
    "</head>",
    `<body style="margin:0;padding:0;background-color:${c.pageBg};" dir="${dir}">`,
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${c.pageBg};">${escHtml(preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${c.pageBg};">`,
    "<tr>",
    '<td align="center" style="padding:16px 8px;">',
    `<table role="presentation" width="${EMAIL_MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:100%;max-width:${EMAIL_MAX_WIDTH}px;background-color:${c.bg};border:1px solid ${c.border};">`,
    banner("top"),
    `<tr>\n<td dir="${dir}" align="${align}" style="padding:20px 24px;text-align:${align};font-family:${f};color:${c.text};">`,
    bodyRows,
    "</td>\n</tr>",
    banner("bottom"),
    "</table>",
    "</td>",
    "</tr>",
    "</table>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function groupHeading(ctx: RenderCtx & { tokens: Tokens }, g: Exclude<GroupName, "identity">): string {
  const c = ctx.tokens.colors;
  const f = ctx.tokens.fonts.body;
  const side = ctx.lang === "en" ? "left" : "right";
  return `<h2 style="font-family:${f};margin:20px 0 8px;padding-${side}:8px;border-${side}:3px solid ${c.info};font-size:17px;line-height:1.4;font-weight:700;color:${c.text};">${escHtml(pick(GROUP_HEADING[g], ctx.lang))}</h2>`;
}

/** split lines longer than `max` octets at a tag boundary or a space (never inside a tag); used for 8bit MIME bodies */
export function wrapLongLines(s: unknown, max: number = 900): string {
  const outLines: string[] = [];
  for (const line of String(s).split("\n")) {
    if (byteLen(line) <= max) {
      outLines.push(line);
      continue;
    }
    let rest = line;
    while (byteLen(rest) > max) {
      // largest prefix within `max` octets
      let cut = 0;
      let bytes = 0;
      for (const ch of rest) {
        const b = byteLen(ch);
        if (bytes + b > max) break;
        bytes += b;
        cut += ch.length;
      }
      const head = rest.slice(0, cut);
      let at = head.lastIndexOf("><");
      if (at > 0) at += 1;
      else {
        at = head.lastIndexOf(" ");
        if (at <= 0) at = cut;
      }
      outLines.push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    outLines.push(rest);
  }
  return outLines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Adaptive Card 1.0 (no actions), compact fallback, validation
// ---------------------------------------------------------------------------------------------------------------
export interface AdaptiveCard {
  type: "AdaptiveCard";
  version: "1.0";
  lang: string;
  body: CardElement[];
}
const CARD_ELEMENTS = new Set(["TextBlock", "Container", "ColumnSet", "Column", "FactSet", "Image"]);
export function buildCard(
  m: RenderModel,
  rendered: readonly Pick<RenderedComponent, "card">[],
  lang: string,
): AdaptiveCard {
  const body: CardElement[] = [
    { type: "TextBlock", text: MARKING, wrap: true, weight: "Bolder", size: "Small", color: "Warning" },
  ];
  for (const r of rendered) for (const item of r.card || []) body.push(item);
  body.push({ type: "TextBlock", text: MARKING, wrap: true, size: "Small", isSubtle: true });
  return { type: "AdaptiveCard", version: "1.0", lang, body };
}
export function buildCompactCard(
  m: RenderModel,
  rendered: readonly Pick<RenderedComponent, "name" | "text">[],
  lang: string,
): AdaptiveCard {
  const lines = [MARKING];
  const title = titleOf(m, lang);
  if (title) lines.push(title);
  const act = rendered.find((r) => r.name === "SmartNextActionCard");
  if (act) lines.push(act.text.split("\n").slice(0, 2).join(" "));
  const dl = rendered.find((r) => r.name === "DeadlineIndicator");
  if (dl) lines.push(dl.text.split("\n")[0] ?? "");
  if (allowed(m, "notice_reference"))
    lines.push(`${pick(S.noticeRef, lang)}: ${String(m.fields.notice_reference)}`);
  return {
    type: "AdaptiveCard",
    version: "1.0",
    lang,
    body: [{ type: "TextBlock", text: lines.map(oneLine).join("\n\n"), wrap: true }],
  };
}
export interface ValidateCardOptions {
  cardContentAllowed?: boolean;
  budget?: number;
}
/** structural checks for the cards this renderer emits → [] when valid */
export function validateCard(
  card: unknown,
  { cardContentAllowed = false, budget = CARD_BUDGET_BYTES }: ValidateCardOptions = {},
): string[] {
  const errs: string[] = [];
  const c = card && typeof card === "object" ? (card as Record<string, unknown>) : null;
  if (!c || c.type !== "AdaptiveCard") errs.push("type must be AdaptiveCard");
  if (c?.version !== "1.0") errs.push("version must be 1.0");
  if (!Array.isArray(c?.body) || !c.body.length) errs.push("body must be a non-empty array");
  if (!cardContentAllowed && c && ("actions" in c || "selectAction" in c))
    errs.push("actions present while card_content is not ALLOWED");
  const walk = (el0: unknown, path: string): void => {
    if (!el0 || typeof el0 !== "object") {
      errs.push(`${path}: not an object`);
      return;
    }
    const el = el0 as Record<string, unknown>;
    if (!CARD_ELEMENTS.has(el.type as string))
      errs.push(`${path}: element type ${String(el.type)} not allowed`);
    if (!cardContentAllowed && ("selectAction" in el || "actions" in el))
      errs.push(`${path}: action present`);
    if (el.type === "TextBlock" && typeof el.text !== "string") errs.push(`${path}: TextBlock without text`);
    if (el.type === "TextBlock" && /https?:\/\//i.test(el.text as string))
      errs.push(`${path}: URL inside a TextBlock`);
    for (const k of ["items", "columns"]) {
      const xs = el[k];
      if (Array.isArray(xs)) xs.forEach((x: unknown, i: number) => walk(x, `${path}.${k}[${i}]`));
    }
  };
  const body = c?.body;
  (Array.isArray(body) ? body : []).forEach((x: unknown, i: number) => walk(x, `body[${i}]`));
  const bytes = byteLen(JSON.stringify(card ?? {}));
  if (bytes > budget) errs.push(`card is ${bytes} bytes, above the ${budget}-byte project budget`);
  if (!JSON.stringify(card ?? {}).includes("DESIGN_PREVIEW")) errs.push("marking missing");
  return errs;
}
export interface CardChoice {
  card: AdaptiveCard;
  mode: "FULL" | "COMPACT_FALLBACK";
  bytes: number;
  full_bytes: number;
}
export function chooseCard(
  m: RenderModel,
  rendered: readonly RenderedComponent[],
  lang: string,
  { budget = CARD_BUDGET_BYTES }: { budget?: number } = {},
): CardChoice {
  const full = buildCard(m, rendered, lang);
  const fullBytes = byteLen(JSON.stringify(full));
  if (fullBytes <= budget && validateCard(full, { budget }).length === 0)
    return { card: full, mode: "FULL", bytes: fullBytes, full_bytes: fullBytes };
  const compact = buildCompactCard(m, rendered, lang);
  return {
    card: compact,
    mode: "COMPACT_FALLBACK",
    bytes: byteLen(JSON.stringify(compact)),
    full_bytes: fullBytes,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// calendar object (.ics) — only when meeting_info survived the projection (W-F: the .ics object is meeting_info and carries
// title, logistics, notice reference and sender only)
// ---------------------------------------------------------------------------------------------------------------
function icsEscape(s: unknown): string {
  return oneLine(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
function icsFold(line: string): string {
  const outL: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = byteLen(ch);
    if (bytes + b > 73) {
      outL.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  outL.push(cur);
  return outL.join("\r\n");
}
const icsDate = (ms: number): string =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
export function buildIcs(m: RenderModel, lang: string, generatedAt: unknown): string | null {
  const mi = m.fields.meeting_info as MeetingInfo | null | undefined;
  if (!allowed(m, "meeting_info") || !mi || typeof mi !== "object" || mi.generalized) return null;
  const start = parseZoned(mi.at ?? "");
  if (isNil(start)) return null;
  const end = parseZoned(mi.ends_at ?? "") ?? start + 3600 * 1000;
  const uid = `${sha256Hex(`ics|${String(m.meta.notification_id)}`).slice(0, 24)}@cdf-demo.example.test`;
  const title = titleOf(m, lang) ?? "DESIGN_PREVIEW";
  const desc = [
    MARKING,
    allowed(m, "notice_reference")
      ? `${pick(S.noticeRef, lang)}: ${String(m.fields.notice_reference)}`
      : null,
  ]
    .filter(Boolean)
    .join(" — ");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CDF V13 W-D2//DESIGN_PREVIEW synthetic//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDate(parseZoned(generatedAt) ?? start)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(`[DESIGN_PREVIEW] ${title}`)}`,
    ...(mi.place ? [`LOCATION:${icsEscape(pick(mi.place, lang))}`] : []),
    `DESCRIPTION:${icsEscape(desc)}`,
    "CLASS:CONFIDENTIAL",
    "STATUS:TENTATIVE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------------------------------------------
// MIME / EML
// ---------------------------------------------------------------------------------------------------------------
const crlf = (s: unknown): string => String(s).replace(/\r\n?/g, "\n").split("\n").join("\r\n");
function assertLines(raw: string): void {
  for (const l of raw.split("\r\n"))
    if (byteLen(l) > MAX_LINE_OCTETS)
      throw new RenderError("LINE_TOO_LONG", "a MIME line exceeds 998 octets");
  if (/\r(?!\n)|(?<!\r)\n/.test(raw))
    throw new RenderError("BARE_LINE_BREAK", "bare CR or LF in the message");
}
export interface EmlAttachment {
  filename: unknown;
  contentType?: string;
  content: string | Uint8Array;
}
export interface EmlInput {
  from: { display?: unknown; address: unknown };
  to: { display?: unknown; address: unknown };
  subject: unknown;
  date: unknown;
  messageId: unknown;
  headers?: Readonly<Record<string, unknown>>;
  text: unknown;
  html: unknown;
  attachments?: readonly EmlAttachment[];
  seed?: string;
}
/**
 * buildEml({from:{display, address}, to:{display, address}, subject, date, messageId, headers:{name:value}, text, html,
 *           attachments:[{filename, contentType, content(Buffer|string)}], seed}) → raw RFC 5322 message (CRLF)
 * Header values are sanitised (controls, CR, LF removed) and RFC 2047-encoded when not ASCII; addresses must be plain
 * addr-specs on the synthetic allowlist; X-* header names must match ^X-[A-Za-z0-9-]+$.
 */
export function buildEml({
  from,
  to,
  subject,
  date,
  messageId,
  headers = {},
  text,
  html,
  attachments = [],
  seed = "eml",
}: EmlInput): string {
  const lines: string[] = [];
  lines.push(`Date: ${sanitizeHeaderText(date)}`);
  lines.push(formatAddressHeader("From", from.display, from.address));
  lines.push(formatAddressHeader("To", to.display, to.address));
  lines.push(encodeHeaderValue("Subject", subject));
  lines.push(`Message-ID: <${sanitizeHeaderText(messageId).replace(/[<>\s]/g, "")}>`);
  lines.push("MIME-Version: 1.0");
  lines.push("X-Unsent: 1");
  for (const [k, v] of Object.entries(headers)) {
    if (!/^X-[A-Za-z0-9-]+$/.test(k))
      throw new RenderError("BAD_HEADER_NAME", `header name rejected: ${k.slice(0, 40)}`);
    lines.push(encodeHeaderValue(k, String(v)));
  }
  const h = sha256Hex(`boundary|${seed}`);
  const alt = `=_cdf_alt_${h.slice(0, 24)}`;
  const mix = `=_cdf_mix_${h.slice(24, 48)}`;
  const part = (type: string, body: unknown): string =>
    [
      `Content-Type: ${type}; charset=UTF-8`,
      "Content-Transfer-Encoding: 8bit",
      "",
      crlf(wrapLongLines(body)),
    ].join("\r\n");
  const altBody = [
    `--${alt}`,
    part("text/plain", text),
    `--${alt}`,
    part("text/html", html),
    `--${alt}--`,
  ].join("\r\n");
  let body: string;
  if (attachments.length) {
    lines.push(`Content-Type: multipart/mixed; boundary="${mix}"`);
    const att = attachments.map((a) => {
      const fn = sanitizeFilename(a.filename, "attachment");
      const ct = /^[a-z]+\/[a-z0-9.+-]+(; ?[a-z-]+=[A-Za-z0-9-]+)*$/.test(a.contentType ?? "")
        ? (a.contentType as string)
        : "application/octet-stream";
      const b64 = (typeof a.content === "string" ? Buffer.from(a.content) : Buffer.from(a.content))
        .toString("base64")
        .replace(/.{76}/g, "$&\r\n");
      return [
        `--${mix}`,
        `Content-Type: ${ct}; name="${fn.ascii}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${fn.ascii}"; filename*=${fn.rfc2231}`,
        "",
        b64,
      ].join("\r\n");
    });
    body = [
      `--${mix}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      altBody,
      ...att,
      `--${mix}--`,
    ].join("\r\n");
  } else {
    lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`);
    body = altBody;
  }
  const raw = `${lines.join("\r\n")}\r\n\r\nThis is a multi-part message in MIME format. ${MARKING}\r\n\r\n${body}\r\n`;
  assertLines(raw);
  return raw;
}

// ---------------------------------------------------------------------------------------------------------------
// renderEmail
// ---------------------------------------------------------------------------------------------------------------
export interface RenderEmailOptions {
  lang?: unknown;
  density?: unknown;
  tokens?: Tokens;
  to?: { address?: unknown; email?: unknown; display?: unknown } | null;
  from?: { address?: unknown } | null;
  attachIcs?: boolean;
}
export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  card: AdaptiveCard;
  card_mode: CardChoice["mode"];
  card_bytes: number;
  card_full_bytes: number;
  card_errors: string[];
  eml: string | null;
  headers: Record<string, string>;
  components: ComponentName[];
  marking: string;
  not_available: string;
}
export function renderEmail(
  projected: Projected<ProjectedModel>,
  opts: RenderEmailOptions = {},
): RenderedEmail {
  const m = assertRenderable(projected, "EMAIL");
  const lang: Lang = opts.lang === "en" ? "en" : "ar";
  const dir = lang === "ar" ? "rtl" : "ltr";
  const density = assertDensity(opts.density ?? "STANDARD");
  const tokens = opts.tokens ?? loadTokens();
  const ctx = { lang, density, experience: "EMAIL" as const, tokens };
  const rendered = renderComponents(projected, ctx);
  const subject = buildSubject(m, lang);
  const preheader = buildPreheader(m, lang);

  // body: identity first (no heading), then one h2 per group in charter order
  const htmlParts: string[] = [];
  const textParts: string[] = [MARKING, "", subject, ""];
  for (const [g] of GROUPS) {
    const items = rendered.filter((r) => r.group === g);
    if (!items.length) continue;
    if (g !== "identity") {
      htmlParts.push(groupHeading(ctx, g));
      textParts.push(`== ${pick(GROUP_HEADING[g], lang)} ==`);
    }
    for (const r of items) {
      htmlParts.push(r.html);
      textParts.push(r.text, "");
    }
  }
  textParts.push(pick(S.previewFooter, lang), "", MARKING, "");
  const text = wrapLongLines(stripControls(textParts.join("\n")), 900); // defence in depth: components already strip controls

  const cardSel = chooseCard(m, rendered, lang);
  const cardContentAllowed = allowed(m, "card_content");
  const card_errors = validateCard(cardSel.card, { cardContentAllowed });
  // the actionable-message embed is used only when card_content is ALLOWED (never under the current policy, D11-074)
  const cardScript =
    cardContentAllowed && card_errors.length === 0
      ? `<script type="application/adaptivecard+json">${jsonForHtmlScript(cardSel.card)}</script>`
      : null;
  const html = wrapLongLines(
    htmlShell({ lang, dir, title: subject, preheader, bodyRows: htmlParts.join("\n"), tokens, cardScript }),
    900,
  );

  // headers: metadata carries the notice reference and template code only (W-F surface_composition METADATA)
  const headers: Record<string, string> = {
    "X-CDF-Marking": "DESIGN_PREVIEW; SYNTHETIC DATA; not CDF production",
    "X-CDF-Release-Status": "DESIGN_PREVIEW",
  };
  if (allowed(m, "notice_reference")) headers["X-CDF-Notice-Ref"] = m.fields.notice_reference as string;
  if (allowed(m, "template_code") && m.fields.template_code)
    headers["X-CDF-Template-Code"] = m.fields.template_code as string;
  let eml: string | null = null;
  if (opts.to) {
    const toAddr = validateAddress(opts.to.address ?? opts.to.email);
    const fromAddr = opts.from?.address ?? SENDER.address;
    const issuer = allowed(m, "issuer") && m.fields.issuer ? pick(m.fields.issuer, lang) : null;
    const fromDisplay = issuer
      ? `${issuer} — ${lang === "ar" ? AR["email.previewSuffix"] : EN["email.previewSuffix"]}`
      : pick(SENDER, lang);
    const date = rfc5322Date(m.meta.generated_at ?? "2026-10-27T15:00:00+03:00");
    const nid = String(m.meta.notification_id);
    const messageId = `${sha256Hex(`mid|${nid}|${lang}|${density}`).slice(0, 32)}@cdf-demo.example.test`;
    const ics = opts.attachIcs === false ? null : buildIcs(m, lang, m.meta.generated_at);
    const attachments = ics
      ? [
          {
            filename: "invitation-design-preview.ics",
            contentType: "text/calendar; method=PUBLISH",
            content: ics,
          },
        ]
      : [];
    eml = buildEml({
      from: { display: fromDisplay, address: fromAddr },
      to: { display: opts.to.display ?? "", address: toAddr },
      subject,
      date,
      messageId,
      headers,
      text,
      html,
      attachments,
      seed: `${nid}|${lang}|${density}`,
    });
  }
  const out: RenderedEmail = {
    subject,
    preheader,
    html,
    text,
    card: cardSel.card,
    card_mode: cardSel.mode,
    card_bytes: cardSel.bytes,
    card_full_bytes: cardSel.full_bytes,
    card_errors,
    eml,
    headers,
    components: rendered.map((r) => r.name),
    marking: MARKING,
    not_available: NOT_AVAILABLE[lang],
  };
  recordRendering(out, projected); // OI-053: the export accepts this rendering only with this projection
  return out;
}
