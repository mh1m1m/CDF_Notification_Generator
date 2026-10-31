// NotificationCenterReader over DB-015's notifications_page and notifications_count (migration 0010): SECURITY
// INVOKER read functions inside the request security context, so RLS removes every notification of a case the persona
// may not see before filters, order, limit and count. Bound values and explicit columns only. Strict rows: an extra
// column, a malformed row or a page larger than its own total refuses the whole result (the BFF shows the generic
// error state).
//
// The cursor is opaque base64url JSON {v, at, id}: `at` is the database's created_at_cursor text verbatim (microsecond
// UTC, never passed through a JS Date, which would drop microseconds) and `id` the row's notification id. Both or
// neither reach the database; anything that does not decode to that exact shape throws InvalidCursorError.
//
// V13 is the system of record for its notifications. PRODUCTION_SUBSTITUTION_REQUIRED for this implementation only:
// prototype PostgreSQL (Supabase); production uses RDS PostgreSQL behind the ASP.NET Core API on Alibaba Cloud Riyadh.
import "server-only";
import {
  InvalidCursorError,
  NotificationCenterFilterSchema,
  NotificationCenterRowSchema,
  type NotificationCenterFilter,
  type NotificationCenterPage,
  type NotificationCenterReader,
  type NotificationCenterRow,
  type RequestIdentity,
} from "@/lib/contracts";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";

const CURSOR_VERSION = 1;
const BASE64URL = /^[A-Za-z0-9_-]{1,512}$/;
/** created_at_cursor as migration 0010 formats it (and the only shape the function accepts). */
const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface CenterPosition {
  readonly at: string;
  readonly id: string;
}

/** The exact columns of notifications_page (migration 0010), in order. */
export const CENTER_COLUMNS = [
  "notification_id",
  "case_id",
  "case_number",
  "case_title_ar",
  "case_title_en",
  "template_code",
  "template_name_ar",
  "template_name_en",
  "template_version",
  "language",
  "recipient_class",
  "lifecycle_status",
  "created_at",
  "created_at_cursor",
  "last_event_at",
  "row_version",
] as const;

export interface CenterRow {
  notification_id: string;
  case_id: string;
  case_number: string;
  case_title_ar: string;
  case_title_en: string;
  template_code: string;
  template_name_ar: string;
  template_name_en: string;
  template_version: number;
  language: string;
  recipient_class: string;
  lifecycle_status: string;
  created_at: Date | string;
  created_at_cursor: string;
  last_event_at: Date | string | null;
  row_version: number;
}

export function encodeCenterCursor(position: CenterPosition): string {
  if (!CURSOR_INSTANT.test(position.at) || !UUID.test(position.id))
    throw new InvalidCursorError("bad position");
  return Buffer.from(
    JSON.stringify({ v: CURSOR_VERSION, at: position.at, id: position.id }),
    "utf8",
  ).toString("base64url");
}

/** The position to page after, or null for the first page. Throws InvalidCursorError on anything else. */
export function decodeCenterCursor(cursor: string | undefined): CenterPosition | null {
  if (cursor === undefined) return null;
  if (!BASE64URL.test(cursor)) throw new InvalidCursorError("bad cursor");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError("bad cursor");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidCursorError("bad cursor");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 3 ||
    v.v !== CURSOR_VERSION ||
    typeof v.at !== "string" ||
    !CURSOR_INSTANT.test(v.at) ||
    typeof v.id !== "string" ||
    !UUID.test(v.id)
  ) {
    throw new InvalidCursorError("bad cursor");
  }
  return { at: v.at, id: v.id };
}

const iso = (value: Date | string | null): string | null =>
  value instanceof Date ? value.toISOString() : value;

/** bigint count → number; anything that is not a non-negative safe integer is refused. */
function toCount(value: unknown): number {
  const n = typeof value === "bigint" || typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
    throw new Error("notifications_count: bad count");
  return n;
}

/** Row → contract row; throws on an extra or missing column or any value outside the contract. */
export function rowToCenterRow(row: CenterRow): NotificationCenterRow {
  const keys = Object.keys(row);
  if (keys.length !== CENTER_COLUMNS.length || !CENTER_COLUMNS.every((c) => keys.includes(c))) {
    throw new Error("notifications_page: unexpected columns");
  }
  if (!CURSOR_INSTANT.test(row.created_at_cursor)) throw new Error("notifications_page: bad cursor column");
  return NotificationCenterRowSchema.parse({
    notification_id: row.notification_id,
    case_id: row.case_id,
    case_number: row.case_number,
    case_title: { ar: row.case_title_ar, en: row.case_title_en },
    template_code: row.template_code,
    template_name: { ar: row.template_name_ar, en: row.template_name_en },
    template_version: row.template_version,
    language: row.language,
    recipient_class: row.recipient_class,
    lifecycle_status: row.lifecycle_status,
    created_at: iso(row.created_at),
    last_event_at: iso(row.last_event_at),
    row_version: row.row_version,
  });
}

export function createV13NotificationCenterReader(run: RequestContextRunner): NotificationCenterReader {
  return {
    async listNotifications(
      identity: RequestIdentity,
      filter: NotificationCenterFilter,
    ): Promise<NotificationCenterPage> {
      const f = NotificationCenterFilterSchema.parse(filter);
      const after = decodeCenterCursor(f.cursor);
      const status = f.lifecycle_status ?? null;
      const template = f.template_code ?? null;
      const caseNumber = f.case_number ?? null;
      const from = f.created_from ?? null;
      const before = f.created_before ?? null;
      // One transaction (one snapshot): the page (one extra row says whether another page exists) and the authorised
      // total with exactly the same filters.
      const { rows, total } = await run(identity, async (tx) => {
        const page = await tx<CenterRow[]>`
          select p.notification_id, p.case_id, p.case_number, p.case_title_ar, p.case_title_en, p.template_code,
                 p.template_name_ar, p.template_name_en, p.template_version, p.language, p.recipient_class,
                 p.lifecycle_status, p.created_at, p.created_at_cursor, p.last_event_at, p.row_version
            from cdf_notifications_v13.notifications_page(
                   ${after?.at ?? null}::text, ${after?.id ?? null}::uuid, ${f.limit + 1}::integer,
                   ${status}::text, ${template}::text, ${caseNumber}::text,
                   ${from}::timestamptz, ${before}::timestamptz) p`;
        const count = await tx<{ total: string | number | bigint }[]>`
          select cdf_notifications_v13.notifications_count(
                   ${status}::text, ${template}::text, ${caseNumber}::text,
                   ${from}::timestamptz, ${before}::timestamptz) as total`;
        return { rows: [...page], total: toCount(count[0]?.total) };
      });
      const shown = rows.slice(0, f.limit);
      const items = shown.map(rowToCenterRow);
      // A page larger than its own authorised total is inconsistent: refuse it rather than show it.
      if (items.length > total) throw new Error("notifications_count: total below page size");
      const last = shown.at(-1);
      return {
        items,
        next_cursor:
          rows.length > f.limit && last
            ? encodeCenterCursor({ at: last.created_at_cursor, id: last.notification_id })
            : null,
        total,
      };
    },
  };
}
