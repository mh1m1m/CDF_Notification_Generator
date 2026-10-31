// Notification Operations Center URL state (FE-006, SCREENS S4). The filter form is a GET form, so the query string is
// the whole view. Everything here is untrusted input: it is parsed into a NotificationCenterFilter (validated again by
// the reader and, by matching nothing, by the database) plus a bounded trail of earlier cursors for "previous"
// (keyset paging only moves forward). Dates are calendar days in the CDF time zone (Asia/Riyadh, UTC+03:00 all year):
// "from" is inclusive, "to" is inclusive and becomes the exclusive start of the next day.
import {
  CASE_NUMBER_PATTERN,
  NOTIFICATION_LIFECYCLE_STATUSES,
  type NotificationCenterFilter,
  type NotificationLifecycleStatus,
} from "@/lib/contracts";

export const CENTER_PAGE_SIZE = 25;
/** Earlier pages remembered for "previous". Deeper than this, "previous" returns to the first page. */
export const CENTER_MAX_TRAIL = 20;
const CURSOR_SHAPE = /^[A-Za-z0-9_-]{1,512}$/;
const TEMPLATE_CODE = /^[A-Z][A-Z0-9_-]{2,60}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RIYADH_OFFSET = "+03:00";
const PARAMS = ["status", "template", "case", "from", "to", "after", "back"] as const;

export type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

export interface CenterQuery {
  readonly status?: NotificationLifecycleStatus;
  readonly template?: string;
  readonly caseNumber?: string;
  /** YYYY-MM-DD, inclusive. */
  readonly from?: string;
  /** YYYY-MM-DD, inclusive. */
  readonly to?: string;
  readonly after?: string;
  /** Cursors of the pages before the current one, oldest first; "" stands for the first page. */
  readonly trail: readonly string[];
}

export type ParsedCenterQuery = { readonly ok: true; readonly query: CenterQuery } | { readonly ok: false };

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

/** A real calendar date (2026-02-30 is refused). */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function nextDay(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Query string → CenterQuery. Repeated parameters, unknown status codes, malformed template codes, case numbers,
 * dates or cursors, and a range that ends before it starts are refused as a whole (the page shows the generic
 * "invalid filters" state): the form never produces them. An empty value means "no filter". Case number and template
 * code are trimmed and upper-cased (the form's text inputs), then must match their exact shapes.
 */
export function parseCenterQuery(params: RawSearchParams): ParsedCenterQuery {
  for (const key of PARAMS) {
    if (Array.isArray(params[key])) return { ok: false };
  }
  const status = one(params.status) || undefined;
  const template = one(params.template)?.trim().toUpperCase() || undefined;
  const caseNumber = one(params.case)?.trim().toUpperCase() || undefined;
  const from = one(params.from) || undefined;
  const to = one(params.to) || undefined;
  const after = one(params.after) || undefined;
  const back = one(params.back);

  if (status !== undefined && !(NOTIFICATION_LIFECYCLE_STATUSES as readonly string[]).includes(status))
    return { ok: false };
  if (template !== undefined && !TEMPLATE_CODE.test(template)) return { ok: false };
  if (caseNumber !== undefined && !CASE_NUMBER_PATTERN.test(caseNumber)) return { ok: false };
  if (from !== undefined && !isCalendarDate(from)) return { ok: false };
  if (to !== undefined && !isCalendarDate(to)) return { ok: false };
  if (from !== undefined && to !== undefined && to < from) return { ok: false };
  if (after !== undefined && !CURSOR_SHAPE.test(after)) return { ok: false };

  const trail = back === undefined || back === "" ? [] : back.split(".");
  if (trail.length > CENTER_MAX_TRAIL || trail.some((c) => c !== "~" && !CURSOR_SHAPE.test(c)))
    return { ok: false };
  if (trail.length > 0 && after === undefined) return { ok: false };

  return {
    ok: true,
    query: {
      ...(status !== undefined ? { status: status as NotificationLifecycleStatus } : {}),
      ...(template !== undefined ? { template } : {}),
      ...(caseNumber !== undefined ? { caseNumber } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(after !== undefined ? { after } : {}),
      trail: trail.map((c) => (c === "~" ? "" : c)),
    },
  };
}

export function toCenterFilter(query: CenterQuery): NotificationCenterFilter {
  return {
    limit: CENTER_PAGE_SIZE,
    ...(query.status !== undefined ? { lifecycle_status: query.status } : {}),
    ...(query.template !== undefined ? { template_code: query.template } : {}),
    ...(query.caseNumber !== undefined ? { case_number: query.caseNumber } : {}),
    ...(query.from !== undefined ? { created_from: `${query.from}T00:00:00${RIYADH_OFFSET}` } : {}),
    ...(query.to !== undefined ? { created_before: `${nextDay(query.to)}T00:00:00${RIYADH_OFFSET}` } : {}),
    ...(query.after !== undefined ? { cursor: query.after } : {}),
  };
}

export function hasCenterFilters(query: CenterQuery): boolean {
  return (
    query.status !== undefined ||
    query.template !== undefined ||
    query.caseNumber !== undefined ||
    query.from !== undefined ||
    query.to !== undefined
  );
}

export const CENTER_PATH = "/notifications";

function href(query: CenterQuery, after?: string, trail: readonly string[] = []): string {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set("status", query.status);
  if (query.template !== undefined) params.set("template", query.template);
  if (query.caseNumber !== undefined) params.set("case", query.caseNumber);
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  if (after !== undefined) {
    params.set("after", after);
    if (trail.length > 0) params.set("back", trail.map((c) => (c === "" ? "~" : c)).join("."));
  }
  const search = params.toString();
  return search ? `${CENTER_PATH}?${search}` : CENTER_PATH;
}

/** Link to the next page, or null when there is none. */
export function centerNextHref(query: CenterQuery, nextCursor: string | null): string | null {
  if (nextCursor === null || !CURSOR_SHAPE.test(nextCursor)) return null;
  const trail = [...query.trail, query.after ?? ""].slice(-CENTER_MAX_TRAIL);
  return href(query, nextCursor, trail);
}

/** Link to the previous page, or null on the first page. */
export function centerPrevHref(query: CenterQuery): string | null {
  if (query.after === undefined) return null;
  const previous = query.trail.at(-1);
  if (previous === undefined || previous === "") return href({ ...query, trail: [] });
  return href(query, previous, query.trail.slice(0, -1));
}

/** 1-based position of the page's first row, or 0 when the trail is incomplete (the summary is then hidden). */
export function centerPositionOf(query: CenterQuery): number {
  if (query.after === undefined) return 1;
  return query.trail[0] === "" ? query.trail.length * CENTER_PAGE_SIZE + 1 : 0;
}
