// Paging state of the Case Workspace's Events, Tasks and Notifications tabs (V13-FE-013, OI-026). As the portfolio
// (FE-003): the query string is the whole view, `after` is the current page's opaque cursor and `back` a bounded trail
// of earlier cursors for "previous" (keyset paging only moves forward). Everything here is untrusted input. A value the
// app never produces (repeated, malformed, a trail without a cursor) is a tampered URL: the tab shows its empty state
// with a link back to the first page, never an error, and nothing is read with it.
import { MAX_TRAIL, type RawSearchParams } from "./portfolio-query";

const CURSOR_SHAPE = /^[A-Za-z0-9_-]{1,512}$/;

export interface ListPageQuery {
  /** Cursor of the current page (absent on the first page). */
  readonly after?: string;
  /** Cursors of the pages before the current one, oldest first; "" stands for the first page. */
  readonly trail: readonly string[];
}

export type ParsedListPage = { readonly ok: true; readonly query: ListPageQuery } | { readonly ok: false };

export const FIRST_PAGE: ParsedListPage = Object.freeze({ ok: true, query: Object.freeze({ trail: [] }) });

export function parseListPage(params: RawSearchParams | undefined): ParsedListPage {
  if (!params) return FIRST_PAGE;
  if (Array.isArray(params.after) || Array.isArray(params.back)) return { ok: false };
  const after = typeof params.after === "string" && params.after !== "" ? params.after : undefined;
  const back = typeof params.back === "string" ? params.back : undefined;
  if (after !== undefined && !CURSOR_SHAPE.test(after)) return { ok: false };
  const trail = back === undefined || back === "" ? [] : back.split(".");
  if (trail.length > MAX_TRAIL || trail.some((c) => c !== "~" && !CURSOR_SHAPE.test(c))) return { ok: false };
  if (trail.length > 0 && after === undefined) return { ok: false };
  return {
    ok: true,
    query: { ...(after !== undefined ? { after } : {}), trail: trail.map((c) => (c === "~" ? "" : c)) },
  };
}

/** The query string that keeps a page ("" on the first page). */
export function pageSearch(after?: string, trail: readonly string[] = []): string {
  if (after === undefined) return "";
  const params = new URLSearchParams({ after });
  if (trail.length > 0) params.set("back", trail.map((c) => (c === "" ? "~" : c)).join("."));
  return params.toString();
}

const withSearch = (path: string, search: string) => (search ? `${path}?${search}` : path);

export interface ListPaging {
  readonly prevHref: string | null;
  readonly nextHref: string | null;
  /** The current page's query string ("" on the first page), kept by links that stay on this page. */
  readonly search: string;
}

/** Links for one rendered page of the list at `path`. */
export function listPaging(path: string, page: ParsedListPage, nextCursor: string | null): ListPaging {
  if (!page.ok) return { prevHref: path, nextHref: null, search: "" };
  const { after, trail } = page.query;
  const next =
    nextCursor !== null && CURSOR_SHAPE.test(nextCursor)
      ? withSearch(path, pageSearch(nextCursor, [...trail, after ?? ""].slice(-MAX_TRAIL)))
      : null;
  let prev: string | null = null;
  if (after !== undefined) {
    const previous = trail.at(-1);
    // Beyond the remembered trail (or one step after the first page) "previous" is the first page.
    prev =
      previous === undefined || previous === ""
        ? path
        : withSearch(path, pageSearch(previous, trail.slice(0, -1)));
  }
  return { prevHref: prev, nextHref: next, search: pageSearch(after, trail) };
}
