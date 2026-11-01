/**
 * export — EML export of one notification version, labelled by its lifecycle state (W-D1, charter §9; SEC "export
 * validation"). Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * Why (FACT, V12 evidence read-only): all 77 generator sample EMLs carry `X-Unsent: 1` — they are drafts — yet read as
 * issued notices (W7 §1, #19); the V12 UI logs the .eml download as «exported» (generator/source/ui_v9.js:460) and a
 * manual button sets the status to 'sent' (:478) — an export or a click was treated as delivery (W4-07, PC-15).
 *
 * Rules applied here (PROPOSAL; tests SEC-4x / LC-xx):
 *   - the label follows the lifecycle state and is printed in the subject, at the top of every body part and in an
 *     ASCII header: DRAFT — NOT SENT · APPROVED — NOT YET SENT · COPY — NOT DELIVERY EVIDENCE · CANCELLED — DO NOT SEND
 *     · SUPERSEDED — DO NOT SEND (Arabic beside English);
 *   - `X-Unsent: 1` on every export (an export is never the sent message); no `Date:` header (it would read as a send
 *     time) — `X-CDF-Exported-At` instead, and `X-CDF-Issued-At` only when the evidence records an issue time;
 *   - no `To:` header and no address: the recipient is an opaque reference (`X-CDF-Recipient-Ref`) and a class;
 *   - a CR or LF in any header value is refused (header injection, W4-02); header values are ASCII or RFC 2047 words;
 *   - control characters, bidi embeddings, overrides, isolates and marks, zero-width characters and the BOM are stripped
 *     from the supplied subject, text and HTML (V13-PROC-022);
 *   - an HTML part with active content (script, frames, forms, inline event handlers, javascript:/vbscript:/data: URLs)
 *     is refused (ACTIVE_CONTENT_IN_EXPORT; charter §12 SEC "HTML injection, unsafe URLs");
 *   - for a version that was never sent, rendered text that affirms it was sent or delivered is refused
 *     (SENT_CLAIM_IN_UNSENT_EXPORT): the label and the text must not contradict each other;
 *   - deterministic: same input → same bytes (boundary derived from a hash, no clock or randomness inside).
 * The builder is pure: it never changes a record, the outbox or any store. lib/notifications/lifecycle/notification.ts#exportEml
 * checks the model and appends the NOTIFICATION_EXPORTED audit event and the EXPORT evidence entry.
 * PRODUCTION_SUBSTITUTION_REQUIRED: e-mail client rendering (Outlook, Gmail, Apple Mail) is UNVERIFIED (no tenant).
 */
import "server-only";
import { createHash } from "node:crypto";
import { stripControls } from "@/lib/notifications/render/escape";

export interface ExportLabel {
  readonly code: string;
  readonly en: string;
  readonly ar: string;
}

export const EXPORT_LABELS = Object.freeze({
  DRAFT: Object.freeze({ code: "DRAFT_NOT_SENT", en: "DRAFT — NOT SENT", ar: "مسودة — لم تُرسل" }),
  APPROVED: Object.freeze({
    code: "APPROVED_NOT_YET_SENT",
    en: "APPROVED — NOT YET SENT",
    ar: "معتمد — لم يُرسل بعد",
  }),
  COPY: Object.freeze({
    code: "COPY_NOT_DELIVERY_EVIDENCE",
    en: "COPY — NOT DELIVERY EVIDENCE",
    ar: "نسخة — ليست دليلاً على التسليم",
  }),
  CANCELLED: Object.freeze({
    code: "CANCELLED_DO_NOT_SEND",
    en: "CANCELLED — DO NOT SEND",
    ar: "ملغى — لا يُرسل",
  }),
  SUPERSEDED: Object.freeze({
    code: "SUPERSEDED_DO_NOT_SEND",
    en: "SUPERSEDED — DO NOT SEND",
    ar: "مُستبدل — لا يُرسل",
  }),
} as const);

export type ExportLabelKey = keyof typeof EXPORT_LABELS;

/** Lifecycle state → export label. */
export const STATE_EXPORT_LABEL = Object.freeze({
  DRAFT: "DRAFT",
  VALIDATED: "DRAFT",
  AUTHORIZATION_PENDING: "DRAFT",
  CORRECTED: "DRAFT",
  AUTHORIZED: "APPROVED",
  QUEUED: "APPROVED",
  SENT: "COPY",
  DELIVERY_CONFIRMED: "COPY",
  DELIVERY_FAILED: "COPY",
  CANCELLED: "CANCELLED",
  SUPERSEDED: "SUPERSEDED",
} as const satisfies Record<string, ExportLabelKey>);

/** States in which this version has never been handed to a sender. */
export const NEVER_SENT_STATES = Object.freeze([
  "DRAFT",
  "VALIDATED",
  "AUTHORIZATION_PENDING",
  "AUTHORIZED",
  "QUEUED",
  "CORRECTED",
  "CANCELLED",
] as const);

/** Affirmative "sent / delivered" statements (English and Arabic). Heuristic list; extend with the wording catalogue. */
const SENT_CLAIMS = [
  /\b(?:has|have)\s+been\s+(?:sent|delivered|dispatched)\b/i,
  /\b(?:was|were)\s+(?:sent|delivered|dispatched)\b/i,
  /تم\s+(?:إرسال|الإرسال|ارسال|الارسال|تسليم|التسليم)/u,
  /(?:أُرسل|أرسل|أُرسلت|أرسلت)\s+(?:إليك|إليكم|لك|لكم)/u,
];

const NOTICE = Object.freeze({
  ar: "ملف تصدير من نموذج مرجعي ببيانات اصطناعية — ليس دليلاً على الإرسال أو التسليم أو الاطلاع.",
  en: "Export from a synthetic-data reference implementation — not evidence of sending, delivery or acknowledgement.",
});

/**
 * Active content and unsafe URL schemes an export never carries (defence in depth: the W-D2 renderer escapes values and
 * builds the HTML; an export of a tampered or hand-written part is refused rather than shipped). Heuristic, not a parser.
 */
const ACTIVE_HTML = [
  /<\s*(?:script|iframe|frame|object|embed|applet|form|base)\b/i,
  /<\s*meta\b[^>]*http-equiv/i,
  /<[^>]*\son[a-z]+\s*=/i, // inline event handler attribute inside a tag
  /(?:href|src|action|formaction|xlink:href|background)\s*=\s*["']?\s*(?:javascript|vbscript|data)\s*:/i,
];

const MAX_EML_BYTES = 250 * 1024; // D8 §3: EML ≤ 250 KB (PROPOSAL carried from the review)
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ExportErrorCode =
  | "HEADER_INJECTION"
  | "UNKNOWN_STATE"
  | "RECORD_REQUIRED"
  | "INVALID_RECORD"
  | "RENDERED_REQUIRED"
  | "INVALID_SUBJECT"
  | "TEXT_PART_REQUIRED"
  | "INVALID_HTML"
  | "ACTIVE_CONTENT_IN_EXPORT"
  | "SENT_CLAIM_IN_UNSENT_EXPORT"
  | "INVALID_RECIPIENT_REFERENCE"
  | "EML_TOO_LARGE";

export class ExportError extends Error {
  readonly code: ExportErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(code: ExportErrorCode, details: Record<string, unknown> = {}) {
    super(`notification export refused: ${code}`); // generic: never echoes content
    this.name = "ExportError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const utf8 = new TextEncoder();

function base64(text: string): string {
  const bytes = utf8.encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const wrap76 = (b64: string): string => (b64.match(/.{1,76}/g) ?? [""]).join("\r\n");

/** RFC 2047 B-encoded words (≤ 45 UTF-8 bytes each → ≤ 75 characters), folded with CRLF SP. */
export function encodeHeaderWords(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value) && value.length <= 900) return value;
  const words: string[] = [];
  let chunk = "";
  for (const ch of value) {
    if (utf8.encode(chunk + ch).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64(w)}?=`).join("\r\n ");
}

function headerValue(name: string, value: unknown): string {
  const text = String(value);
  if (/[\r\n]/.test(text)) throw new ExportError("HEADER_INJECTION", { header: name });
  return text;
}

const escapeHtml = (s: unknown): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const stripTags = (html: unknown): string => String(html).replace(/<[^>]*>/g, " ");

export function labelFor(status: unknown): ExportLabel {
  const key =
    typeof status === "string" && Object.hasOwn(STATE_EXPORT_LABEL, status)
      ? STATE_EXPORT_LABEL[status as keyof typeof STATE_EXPORT_LABEL]
      : null; // no prototype keys
  if (!key) throw new ExportError("UNKNOWN_STATE", { status: String(status).slice(0, 40) });
  return EXPORT_LABELS[key];
}

/** The record fields the export reads (a lifecycle record snapshot); checked at run time. */
export interface ExportRecordInput {
  readonly notification_id?: unknown;
  readonly version?: unknown;
  readonly status?: unknown;
  readonly type_code?: unknown;
  readonly recipient?: { readonly recipient_id?: unknown; readonly class?: unknown } | null;
}

/** What the renderer hands to the export: subject, text twin and optional HTML; checked at run time. */
export interface RenderedInput {
  readonly subject?: unknown;
  readonly text?: unknown;
  readonly html?: unknown;
}

export interface BuildExportInput {
  record?: ExportRecordInput | null;
  rendered?: RenderedInput | null;
  exportedAt?: string | null;
  issuedAt?: string | null;
  modelHash?: string | null;
}

export interface ExportResult {
  readonly eml: string;
  readonly label: ExportLabel;
  readonly filename: string;
  readonly sha256: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: number;
}

/**
 * Builds the export. `record` is a lifecycle record snapshot; `rendered` = {subject, text, html?} produced from the
 * projected model by the renderer (W-D2). Returns {eml, label, filename, sha256, headers} and changes nothing.
 */
export function buildExportEml({
  record,
  rendered,
  exportedAt,
  issuedAt = null,
  modelHash = null,
}: BuildExportInput = {}): ExportResult {
  if (!record || typeof record !== "object") throw new ExportError("RECORD_REQUIRED");
  const { notification_id, version, status, type_code } = record;
  // RegExp.prototype.test coerces its argument with String(), as in the reference.
  if (
    !ID.test(String(notification_id ?? "")) ||
    !Number.isInteger(version) ||
    !/^[A-Z][A-Z0-9_]{2,63}$/.test(String(type_code ?? ""))
  ) {
    throw new ExportError("INVALID_RECORD");
  }
  const label = labelFor(status);
  if (!rendered || typeof rendered !== "object") throw new ExportError("RENDERED_REQUIRED");
  const { subject: subject0, text: text0, html } = rendered;
  if (typeof subject0 !== "string" || !subject0.trim() || subject0.length > 400)
    throw new ExportError("INVALID_SUBJECT");
  if (/[\r\n]/.test(subject0)) throw new ExportError("HEADER_INJECTION", { header: "Subject" });
  if (typeof text0 !== "string" || !text0.trim()) throw new ExportError("TEXT_PART_REQUIRED"); // the text twin is mandatory
  if (html !== undefined && html !== null && typeof html !== "string") throw new ExportError("INVALID_HTML");
  // V13-PROC-022: controls, bidi embeddings/overrides/isolates and marks, zero-width and BOM never reach the export,
  // whatever the caller supplies (defence in depth: the renderer already strips them, as renderEmail does)
  const subject = stripControls(subject0);
  const text = stripControls(text0);
  const htmlText = typeof html === "string" ? stripControls(html) : null;
  if (htmlText && ACTIVE_HTML.some((re) => re.test(htmlText)))
    throw new ExportError("ACTIVE_CONTENT_IN_EXPORT");
  if ((NEVER_SENT_STATES as readonly unknown[]).includes(status)) {
    const haystack = [subject, text, htmlText ? stripTags(htmlText) : ""].join("\n");
    if (SENT_CLAIMS.some((re) => re.test(haystack)))
      throw new ExportError("SENT_CLAIM_IN_UNSENT_EXPORT", { status });
  }
  const recipientRef = record.recipient?.recipient_id ?? null;
  const recipientClass = record.recipient?.class ?? null;
  for (const [k, v] of [
    ["recipient_ref", recipientRef],
    ["recipient_class", recipientClass],
  ] as const) {
    if (v !== null && (!ID.test(String(v)) || String(v).includes("@")))
      throw new ExportError("INVALID_RECIPIENT_REFERENCE", { field: k });
  }

  const banner = `${label.ar} | ${label.en}`;
  const textBody = `${banner}\n${NOTICE.ar}\n${NOTICE.en}\n\n${text}`.replace(/\r?\n/g, "\r\n");
  const htmlBanner =
    `<div role="note" data-export-label="${label.code}" style="border:2px solid currentColor;padding:8px;margin:0 0 12px">` +
    `<p lang="ar" dir="rtl" style="margin:0"><strong>${escapeHtml(label.ar)}</strong> — ${escapeHtml(NOTICE.ar)}</p>` +
    `<p lang="en" dir="ltr" style="margin:0"><strong>${escapeHtml(label.en)}</strong> — ${escapeHtml(NOTICE.en)}</p></div>`;
  let htmlBody: string | null = null;
  if (htmlText) {
    const m = /<body\b[^>]*>/i.exec(htmlText);
    htmlBody = m
      ? `${htmlText.slice(0, m.index + m[0].length)}${htmlBanner}${htmlText.slice(m.index + m[0].length)}`
      : `${htmlBanner}${htmlText}`;
  }

  const headers = (
    [
      ["MIME-Version", "1.0"],
      ["X-Unsent", "1"],
      ["X-CDF-Classification", "SYNTHETIC-DATA REFERENCE IMPLEMENTATION - NOT CDF PRODUCTION"],
      ["X-CDF-Export-Label", label.code],
      ["X-CDF-Lifecycle-State", status],
      ["X-CDF-Notification-Id", notification_id],
      ["X-CDF-Notification-Version", String(version)],
      ["X-CDF-Notification-Type", type_code],
      ["X-CDF-Recipient-Ref", recipientRef ?? "none"],
      ["X-CDF-Recipient-Class", recipientClass ?? "none"],
      ["X-CDF-Exported-At", exportedAt ?? "unknown"],
      ...(issuedAt ? [["X-CDF-Issued-At", issuedAt] as const] : []),
      ["X-CDF-Model-Hash", modelHash ?? "none"],
    ] as ReadonlyArray<readonly [string, unknown]>
  ).map(([k, v]): [string, string] => [k, headerValue(k, v)]);
  const encodedSubject = encodeHeaderWords(`[${label.en} | ${label.ar}] ${subject}`);

  const seed = createHash("sha256")
    .update(
      `${String(notification_id)}|${String(version)}|${String(status)}|${subject}|${text}|${htmlText ?? ""}`,
    )
    .digest("hex");
  const boundary = `cdf-v13-${seed.slice(0, 24)}`;
  const lines = headers.map(([k, v]) => `${k}: ${v}`);
  lines.push(`Subject: ${encodedSubject}`);
  if (htmlBody) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, "");
    lines.push(
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(base64(textBody)),
    );
    lines.push(
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(base64(htmlBody)),
    );
    lines.push(`--${boundary}--`, "");
  } else {
    lines.push(
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(base64(textBody)),
      "",
    );
  }
  const eml = lines.join("\r\n");
  const size = utf8.encode(eml).length;
  if (size > MAX_EML_BYTES) throw new ExportError("EML_TOO_LARGE", { bytes: size });
  const sha256 = createHash("sha256").update(eml, "utf8").digest("hex");
  const filename = `CDF-V13_${label.code}_${String(type_code)}_v${String(version)}_${sha256.slice(0, 8)}.eml`;
  return Object.freeze({
    eml,
    label,
    filename,
    sha256,
    headers: Object.freeze(Object.fromEntries(headers)),
    bytes: size,
  });
}
