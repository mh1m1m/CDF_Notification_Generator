// Portfolio URL state (FE-003, SCREENS S2). The filter form is a GET form, so the query string is the whole view:
// opening a case and coming back shows the same filters and page (Scenario A). Everything here is untrusted input;
// it is parsed into a CaseListFilter (validated again by listPortfolio and by the database) plus a bounded trail of
// earlier cursors for the "previous" link. Keyset paging only moves forward, so the trail is how "previous" works.
import type { CaseListFilter, LifecycleStage, RecordsState } from "@/lib/contracts";

/**
 * Stage codes the filter offers, in procedural order, mirroring migration 0002's check constraint on
 * case_record.stage. Replace with the lib/domain stage catalogue once PROC publishes it.
 */
export const PORTFOLIO_STAGES = [
  "INTAKE",
  "PRELIMINARY_REVIEW",
  "INVESTIGATION",
  "COMMITTEE_DELIBERATION",
  "DECISION",
  "CLOSURE",
] as const satisfies readonly LifecycleStage[];
export type PortfolioStage = (typeof PORTFOLIO_STAGES)[number];

export const PORTFOLIO_RECORDS_STATES = ["ACTIVE", "CLOSED"] as const satisfies readonly RecordsState[];

export const PORTFOLIO_PAGE_SIZE = 25;
/** Earlier pages remembered for "previous". Deeper than this, "previous" returns to the first page. */
export const MAX_TRAIL = 20;
const CURSOR_SHAPE = /^[A-Za-z0-9_-]{1,512}$/;

export type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

export interface PortfolioQuery {
  readonly text?: string;
  readonly stage?: PortfolioStage;
  readonly state?: RecordsState;
  /** Only cases where the persona holds an active case assignment (URL mine=1). */
  readonly mine?: true;
  /** Cursor of the current page (absent on the first page). */
  readonly after?: string;
  /** Cursors of the pages before the current one, oldest first; "" stands for the first page. */
  readonly trail: readonly string[];
}

export type ParsedPortfolioQuery =
  { readonly ok: true; readonly query: PortfolioQuery } | { readonly ok: false };

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

/**
 * Query string → PortfolioQuery. Repeated parameters, unknown stage or state codes, malformed cursors and over-long
 * text are refused as a whole (the page shows the generic VALIDATION state): the form never produces them, so they
 * come from an edited URL. An empty value means "no filter".
 */
export function parsePortfolioQuery(params: RawSearchParams): ParsedPortfolioQuery {
  for (const key of ["q", "stage", "state", "mine", "after", "back"]) {
    if (Array.isArray(params[key])) return { ok: false };
  }
  const text = one(params.q)?.trim() || undefined;
  const stage = one(params.stage) || undefined;
  const state = one(params.state) || undefined;
  const mine = one(params.mine) || undefined;
  const after = one(params.after) || undefined;
  const back = one(params.back);

  if (text !== undefined && text.length > 100) return { ok: false };
  if (stage !== undefined && !(PORTFOLIO_STAGES as readonly string[]).includes(stage)) return { ok: false };
  if (mine !== undefined && mine !== "1") return { ok: false };
  if (state !== undefined && !(PORTFOLIO_RECORDS_STATES as readonly string[]).includes(state))
    return { ok: false };
  if (after !== undefined && !CURSOR_SHAPE.test(after)) return { ok: false };

  const trail = back === undefined || back === "" ? [] : back.split(".");
  if (trail.length > MAX_TRAIL || trail.some((c) => c !== "~" && !CURSOR_SHAPE.test(c))) return { ok: false };
  // A trail only makes sense behind a current cursor.
  if (trail.length > 0 && after === undefined) return { ok: false };

  return {
    ok: true,
    query: {
      ...(text !== undefined ? { text } : {}),
      ...(stage !== undefined ? { stage: stage as PortfolioStage } : {}),
      ...(state !== undefined ? { state: state as RecordsState } : {}),
      ...(mine !== undefined ? { mine: true as const } : {}),
      ...(after !== undefined ? { after } : {}),
      trail: trail.map((c) => (c === "~" ? "" : c)),
    },
  };
}

export function toCaseListFilter(query: PortfolioQuery): CaseListFilter {
  return {
    limit: PORTFOLIO_PAGE_SIZE,
    ...(query.text !== undefined ? { text: query.text } : {}),
    ...(query.stage !== undefined ? { lifecycle_stage: query.stage } : {}),
    ...(query.state !== undefined ? { records_state: query.state } : {}),
    ...(query.mine ? { assigned_to_me: true } : {}),
    ...(query.after !== undefined ? { cursor: query.after } : {}),
  };
}

/**
 * Identity of the filter form's values (OI-043). The form's controls are uncontrolled (defaultValue), so React keeps
 * the old values when a client-side navigation (Clear, Back, a paging link) re-renders it with other filters; keying
 * the form on this value remounts it whenever the filters change, so the controls always show the URL's filters.
 */
export function filterFormKey(query: PortfolioQuery): string {
  return JSON.stringify([query.text ?? "", query.stage ?? "", query.state ?? "", query.mine === true]);
}

export function hasFilters(query: PortfolioQuery): boolean {
  return (
    query.text !== undefined || query.stage !== undefined || query.state !== undefined || query.mine === true
  );
}

function href(
  query: Pick<PortfolioQuery, "text" | "stage" | "state" | "mine">,
  after?: string,
  trail: readonly string[] = [],
) {
  const params = new URLSearchParams();
  if (query.text !== undefined) params.set("q", query.text);
  if (query.stage !== undefined) params.set("stage", query.stage);
  if (query.state !== undefined) params.set("state", query.state);
  if (query.mine) params.set("mine", "1");
  if (after !== undefined) {
    params.set("after", after);
    if (trail.length > 0) params.set("back", trail.map((c) => (c === "" ? "~" : c)).join("."));
  }
  const search = params.toString();
  return search ? `/portfolio?${search}` : "/portfolio";
}

/** Link to the next page, or null when there is none. */
export function nextHref(query: PortfolioQuery, nextCursor: string | null): string | null {
  if (nextCursor === null || !CURSOR_SHAPE.test(nextCursor)) return null;
  const trail = [...query.trail, query.after ?? ""].slice(-MAX_TRAIL);
  return href(query, nextCursor, trail);
}

/** Link to the previous page, or null on the first page. */
export function prevHref(query: PortfolioQuery): string | null {
  if (query.after === undefined) return null;
  const previous = query.trail.at(-1);
  // Beyond the remembered trail (or one step after the first page) "previous" is the first page.
  if (previous === undefined || previous === "") return href(query);
  return href(query, previous, query.trail.slice(0, -1));
}

/** Link that clears every filter (back to the first page). */
export const CLEAR_FILTERS_HREF = "/portfolio";
