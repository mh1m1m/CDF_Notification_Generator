import "server-only";
/**
 * CDF Notifications V13 — output encoding, URL allowlist, address/header/MIME helpers and Riyadh time (W-D2).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Reused from V12 (copied, never imported at runtime; origin named per item, defects from the first review fixed):
 *  - mdEsc            ← notifications/generator/source/engine_v9.js `mdEsc` (unchanged pattern)
 *  - jsonForHtmlScript← engine_v9.js `cardJsonForHtml` — W4-01 fixed: escapes < > & U+2028 U+2029, not only "</"
 *  - fmtRiyadh        ← generator/source/build_notification_generator.py `fmtRiyadh` — W4-09 fixed: the offset (or Z) is
 *                       parsed and converted to Riyadh (UTC+3, no daylight saving); zone-less input is refused (→ null)
 *  - encodeHeaderValue← build_notification_generator.py `encHeader` — fixed: RFC 2047 words ≤ 75 chars, folded lines,
 *                       CR/LF and control characters removed before encoding
 *  - address checks   — new (W4-02: strict validation instead of raw interpolation into To/Cc)
 * PRODUCTION_SUBSTITUTION_REQUIRED: application origins come from deployment configuration, not from constants.
 */
import { createHash } from "node:crypto";
import { isNil } from "@/lib/domain/nil";

export const NOT_AVAILABLE = Object.freeze({ ar: "غير متاح", en: "Not available" } as const);

/** C0 controls except TAB/LF, DEL, C1 controls, bidi embeddings/overrides/isolates and marks, BOM, ZWSP, line/para separators */
const CONTROL_RE =
  // eslint-disable-next-line no-control-regex -- the control characters are what this pattern strips
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
export function stripControls(s: unknown): string {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, " ")
    .replace(CONTROL_RE, "");
}
const HTML_MAP: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
/** text and attribute context (always quoted attributes) */
export function escHtml(s: unknown): string {
  return stripControls(s).replace(/[&<>"']/g, (c) => HTML_MAP[c] ?? c);
}
/** single-line plain text (text twin, card) */
export function oneLine(s: unknown): string {
  return stripControls(s)
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** V12 engine_v9.js mdEsc — Adaptive Card TextBlock markdown subset */
export function mdEsc(s: unknown): string {
  return oneLine(s).replace(/([\\*_#`[\]~])/g, "\\$1");
}

/** JSON inside <script type="application/adaptivecard+json"> — W4-01 fix (no "<", ">", "&", U+2028/9 survive) */
export function jsonForHtmlScript(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ---------------------------------------------------------------------------------------------------------------
// Links: https only, allowlisted application origins, platform path shape (notify.deep_link: /segment/uuid), ≤ 200 chars
// ---------------------------------------------------------------------------------------------------------------
export const APP_ORIGINS = Object.freeze({
  INVESTIGATION_WEB: "https://cdf-platform.example.test",
  WHISTLEBLOWING_WEB: "https://cdf-portal.example.test",
} as const);
export type AppKey = keyof typeof APP_ORIGINS;
export const PATH_RE = /^(\/[a-z0-9-]+)+$/;
export function safeHref(app: unknown, path: unknown): string | null {
  const key = String(app);
  // own keys only: '__proto__', 'constructor', 'toString' … must not resolve to an inherited value
  const origin: unknown = Object.hasOwn(APP_ORIGINS, key) ? APP_ORIGINS[key as AppKey] : null;
  if (typeof origin !== "string" || typeof path !== "string" || path.length > 200 || !PATH_RE.test(path))
    return null;
  return origin + path;
}
export function isAllowedUrl(u: unknown): boolean {
  // eslint-disable-next-line no-control-regex
  if (typeof u !== "string" || u.length > 260 || /[\s\u0000-\u001F]/.test(u)) return false;
  let x: URL;
  try {
    x = new URL(u);
  } catch {
    return false;
  }
  return (
    x.protocol === "https:" &&
    (Object.values(APP_ORIGINS) as string[]).includes(x.origin) &&
    !x.username &&
    !x.password &&
    !x.port &&
    !x.search &&
    !x.hash &&
    PATH_RE.test(x.pathname) &&
    x.pathname.length <= 200 &&
    u === x.origin + x.pathname
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Time: Riyadh wall time (UTC+3, no DST), Western digits, no zone label (V12 owner direction 18 Oct 2026)
// ---------------------------------------------------------------------------------------------------------------
const MONTHS = Object.freeze({
  ar: [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
} as const);
export const ZONED_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export function parseZoned(iso: unknown): number | null {
  if (typeof iso !== "string" || !ZONED_ISO.test(iso)) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
const pad2 = (n: number): string => String(n).padStart(2, "0");
/** → formatted string, or null when the input is missing, invalid or zone-less (callers print «غير متاح») */
export function fmtRiyadh(
  iso: unknown,
  lang: string = "ar",
  { dateOnly = false }: { dateOnly?: boolean } = {},
): string | null {
  const t = parseZoned(iso);
  if (isNil(t)) return null;
  const d = new Date(t + 3 * 3600 * 1000);
  const Y = d.getUTCFullYear(),
    M = d.getUTCMonth(),
    D = d.getUTCDate(),
    h = d.getUTCHours(),
    m = d.getUTCMinutes();
  const L = lang === "en" ? "en" : "ar";
  const date = `${D} ${MONTHS[L][M] ?? ""} ${Y}`;
  if (dateOnly) return date;
  return L === "ar"
    ? `${date}، ${h % 12 || 12}:${pad2(m)} ${h < 12 ? "ص" : "م"}`
    : `${date}, ${h % 12 || 12}:${pad2(m)} ${h < 12 ? "AM" : "PM"}`;
}
/** RFC 5322 date in Riyadh time (+0300) */
export function rfc5322Date(iso: unknown): string {
  const t = parseZoned(iso);
  if (isNil(t)) throw new TypeError("rfc5322Date: a zoned ISO timestamp is required");
  const d = new Date(t + 3 * 3600 * 1000);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${DAYS[d.getUTCDay()] ?? ""}, ${pad2(d.getUTCDate())} ${MON[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} +0300`;
}

// ---------------------------------------------------------------------------------------------------------------
// Headers: sanitise, RFC 2047 (B, UTF-8, words ≤ 75 chars, folded), addresses, RFC 2231 file names
// ---------------------------------------------------------------------------------------------------------------
export type HeaderErrorCode = "INVALID_ADDRESS" | "ADDRESS_NOT_ALLOWED";
export class HeaderError extends Error {
  readonly code: HeaderErrorCode;
  constructor(code: HeaderErrorCode, message: string) {
    super(message);
    this.name = "HeaderError";
    this.code = code;
  }
}

/** CR/LF and every control character removed; whitespace collapsed (a header value is one logical line) */
export function sanitizeHeaderText(s: unknown): string {
  return stripControls(s)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

const enc = new TextEncoder();
/** split into UTF-8 chunks of ≤ 39 bytes on code-point boundaries → base64 ≤ 52 chars → word ≤ 64 chars, so even the
 *  first line "Subject: <word>" stays ≤ 76 chars (RFC 2047 §2) */
function chunks39(s: string): string[] {
  const out: string[] = [];
  let cur = "",
    bytes = 0;
  for (const ch of s) {
    const b = enc.encode(ch).length;
    if (bytes + b > 39 && cur) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  if (cur) out.push(cur);
  return out;
}
export function encodedWords(s: string): string[] {
  return chunks39(s).map((c) => `=?UTF-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`);
}
/** one header line, folded at ≤ 78 chars where possible; non-ASCII → RFC 2047 encoded words */
export function encodeHeaderValue(name: string, value: unknown): string {
  const v = sanitizeHeaderText(value);
  const parts = /^[\x20-\x7E]*$/.test(v) ? v.split(" ").filter(Boolean) : encodedWords(v);
  const lines: string[] = [];
  let line = `${name}:`;
  for (const p of parts) {
    if (line.length + 1 + p.length > 78 && line.length > name.length + 1) {
      lines.push(line);
      line = " " + p;
    } else line += " " + p;
  }
  lines.push(line);
  return lines.join("\r\n");
}
/** decode RFC 2047 B-words of a (possibly folded) header value — used by tests */
export function decodeHeaderValue(v: unknown): string {
  return String(v)
    .replace(/\r\n[ \t]/g, " ")
    .replace(/(=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=)\s+(?==\?UTF-8\?B\?)/g, "$1")
    .replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (_: string, b: string) =>
      Buffer.from(b, "base64").toString("utf8"),
    );
}

const ADDR_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9._+-]{0,62}[A-Za-z0-9])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
export interface AddressOptions {
  allowedDomains?: readonly string[] | null;
}
/** strict address check (W4-02); the demo also refuses any domain outside the synthetic allowlist */
export function validateAddress(
  addr: unknown,
  { allowedDomains = ["example.test"] }: AddressOptions = {},
): string {
  const a = String(addr ?? "");
  if (
    a !== a.trim() ||
    /[\s\r\n<>",;:()\\[\]]/.test(a) ||
    a.length > 254 ||
    !ADDR_RE.test(a) ||
    a.includes("..")
  ) {
    throw new HeaderError("INVALID_ADDRESS", "address rejected: not a plain addr-spec");
  }
  const domain = (a.split("@")[1] ?? "").toLowerCase();
  if (allowedDomains && !allowedDomains.some((d) => domain === d || domain.endsWith("." + d))) {
    throw new HeaderError("ADDRESS_NOT_ALLOWED", "address rejected: domain outside the synthetic allowlist");
  }
  return a;
}
/** display name (encoded when non-ASCII, quoted when ASCII) + validated address */
export function formatAddressHeader(
  name: string,
  displayName: unknown,
  address: unknown,
  opts?: AddressOptions,
): string {
  const addr = validateAddress(address, opts);
  const dn = sanitizeHeaderText(displayName ?? "").replace(/[<>"\\]/g, "");
  if (!dn) return `${name}: ${addr}`;
  if (/^[\x20-\x7E]*$/.test(dn)) return `${name}: "${dn}" <${addr}>`;
  const head = encodeHeaderValue(name, dn);
  const last = head.split("\r\n").pop() ?? "";
  return last.length + addr.length + 3 > 76 ? `${head}\r\n <${addr}>` : `${head} <${addr}>`;
}

export interface SanitizedFilename {
  name: string;
  ascii: string;
  rfc2231: string;
}
/** attachment file name: no path, no controls, no quotes/separators; ASCII fallback + RFC 2231 extended value */
export function sanitizeFilename(name: unknown, fallback: string = "attachment"): SanitizedFilename {
  let n = (
    stripControls(name)
      .replace(/[\r\n]/g, "")
      .split(/[\\/]/)
      .pop() ?? ""
  )
    .replace(/["';:*?<>|=%]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  if (!n) n = fallback;
  if ([...n].length > 120) n = [...n].slice(0, 120).join("");
  const ascii = n.replace(/[^\x20-\x7E]/g, "_").replace(/ +/g, "_") || fallback;
  const ext = encodeURIComponent(n).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return { name: n, ascii, rfc2231: `UTF-8''${ext}` };
}

/** deterministic synthetic uuid-shaped id (demo only) */
export function demoUuid(seed: unknown): string {
  const h = createHash("sha256").update(String(seed)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function sha256Hex(s: string | Uint8Array): string {
  return createHash("sha256").update(s).digest("hex");
}
