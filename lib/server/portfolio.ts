// Case Portfolio loader (FE-003, SCREENS S2). Order: request context → URL parsing → listPortfolio (lib/authz
// pre-check, then the CaseSourceAdapter inside the database security context). The result is a view model only: the
// page never sees an exception, a SQL error or anything about cases the persona may not see. The total is the
// authorised count from the database (same statement, same filters), never computed in the browser.
import "server-only";
import type { CaseListPage, CaseSourceAdapter } from "@/lib/contracts";
import { listPortfolio } from "./cases";
import type { RequestContext } from "./context";
import { isAppError, toUserError } from "./errors";
import {
  nextHref,
  parsePortfolioQuery,
  PORTFOLIO_PAGE_SIZE,
  prevHref,
  toCaseListFilter,
  type PortfolioQuery,
  type RawSearchParams,
} from "./portfolio-query";

export type PortfolioView =
  | {
      readonly kind: "page";
      readonly query: PortfolioQuery;
      readonly page: CaseListPage;
      /** 1-based position of the first row of this page among all authorised matches. */
      readonly from: number;
      readonly nextHref: string | null;
      readonly prevHref: string | null;
    }
  /** The URL carries filters or a cursor the form cannot produce (edited URL, stale cursor). */
  | { readonly kind: "invalid"; readonly correlationId: string }
  | { readonly kind: "error"; readonly correlationId: string };

/**
 * 1-based position of the page's first row. Pages are fixed-size and the trail starts with "" (the first page) while
 * it is complete, so the position follows from its length. A truncated or missing trail (deep paging, a hand-made
 * link) makes the position unknown: 0, and the page summary is not shown.
 */
export function positionOf(query: PortfolioQuery): number {
  if (query.after === undefined) return 1;
  return query.trail[0] === "" ? query.trail.length * PORTFOLIO_PAGE_SIZE + 1 : 0;
}

export async function loadPortfolio(
  deps: { readonly ctx: RequestContext; readonly source: CaseSourceAdapter },
  params: RawSearchParams,
): Promise<PortfolioView> {
  const correlationId = deps.ctx.correlationId;
  const parsed = parsePortfolioQuery(params);
  if (!parsed.ok) return { kind: "invalid", correlationId };
  const { query } = parsed;
  try {
    const page = await listPortfolio(deps, toCaseListFilter(query));
    return {
      kind: "page",
      query,
      page,
      from: positionOf(query),
      nextHref: nextHref(query, page.next_cursor),
      prevHref: prevHref(query),
    };
  } catch (error) {
    // NOT_FOUND (pre-check refused the portfolio) and UNAUTHENTICATED are re-thrown for the page to answer like an
    // unknown route or a sign-in redirect; VALIDATION is a bad filter or cursor; anything else is logged, generic.
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "UNAUTHENTICATED")) throw error;
    const userError = toUserError(error, correlationId, "portfolio.load_failed");
    return { kind: userError.code === "VALIDATION" ? "invalid" : "error", correlationId };
  }
}
