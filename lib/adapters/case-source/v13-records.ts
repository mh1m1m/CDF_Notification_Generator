// CaseSourceAdapter over V13's own synthetic case records (ADR-001), schema cdf_notifications_v13, migration 0002.
//
// Every call runs inside the per-transaction security context (withRequestContext: claims + SET LOCAL ROLE
// cdf_v13_user), so RLS (can_access_case) filters rows before filters, ordering, paging or counting. Only the
// SECURITY INVOKER read functions portfolio_page, portfolio_count and case_header are called; nothing here reads a table directly
// or builds SQL from strings. Rows that do not satisfy the CaseSummary contract are refused as a whole (the call
// fails; the BFF answers UNAVAILABLE) rather than partly shown.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production replaces this adapter with one that calls the authoritative CDF case
// system through the ASP.NET Core API on Alibaba Cloud Riyadh.
import "server-only";
import {
  CaseListExtrasSchema,
  CaseListFilterSchema,
  CaseSummarySchema,
  type CaseId,
  type CaseListFilter,
  type CaseListItem,
  type CaseListPage,
  type CaseSourceAdapter,
  type CaseSummary,
  type RequestIdentity,
} from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { decodeCursor, encodeCursor } from "./cursor";

export const V13_SOURCE_SYSTEM = "V13_SYNTHETIC";

/** Runs `fn` in one request-context transaction for `identity` (normally lib/db withRequestContext). */
export type RequestContextRunner = <T>(identity: RequestIdentity, fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** A row of portfolio_page / case_header (migration 0002). */
export interface CaseRow {
  id: string;
  display_number: string;
  title_ar: string;
  title_en: string;
  stage: string;
  is_restricted: boolean;
  records_state: string;
  source_system?: string | null;
  source_ref?: string | null;
  updated_at?: Date | string | null;
}

/** A portfolio_page row: CaseRow plus the row summaries (migration 0003, DB PR #15). */
export interface PortfolioRow extends CaseRow {
  last_event_id?: string | null;
  last_event_at?: Date | string | null;
  my_open_task_count?: number | null;
}

/** bigint count → number; anything that is not a non-negative safe integer is refused. */
function toCount(value: string | number | bigint | undefined): number {
  const n = typeof value === "bigint" ? Number(value) : typeof value === "string" ? Number(value) : value;
  if (n === undefined || !Number.isSafeInteger(n) || n < 0) throw new Error("portfolio_count: bad count");
  return n;
}

const iso = (value: Date | string | null | undefined): string | undefined =>
  value instanceof Date ? value.toISOString() : (value ?? undefined);

/**
 * Row → CaseSummary, validated by the contract schema (throws on any mismatch). Both title languages are carried; the
 * page picks one (ARCH ruling on FE-OPEN-1, 28 Oct 2026). Rows without updated_at, source_system or source_ref are
 * refused (0002's read functions return them from DB PR (b) on).
 */
export function rowToCaseSummary(row: CaseRow): CaseSummary {
  return CaseSummarySchema.parse({
    case_id: row.id,
    case_number: row.display_number,
    title_key: null,
    synthetic_title: { ar: row.title_ar, en: row.title_en },
    lifecycle_stage: row.stage,
    is_restricted: row.is_restricted,
    records_state: row.records_state,
    source_system: row.source_system ?? undefined,
    source_ref: row.source_ref ?? undefined,
    updated_at: iso(row.updated_at),
  });
}

/** Portfolio row → CaseListItem; the row summaries are required (a source without them is refused). */
export function rowToCaseListItem(row: PortfolioRow): CaseListItem {
  const extras = CaseListExtrasSchema.parse({
    last_event_id: row.last_event_id ?? null,
    last_event_at: iso(row.last_event_at) ?? null,
    my_open_task_count: row.my_open_task_count,
  });
  return { ...rowToCaseSummary(row), ...extras };
}

export function createV13RecordsCaseSource(run: RequestContextRunner): CaseSourceAdapter {
  return {
    sourceSystem: V13_SOURCE_SYSTEM,

    async listCases(identity: RequestIdentity, filter: CaseListFilter): Promise<CaseListPage> {
      const f = CaseListFilterSchema.parse(filter);
      const after = decodeCursor(f.cursor);
      // One extra row tells whether another page exists; never more than 101 rows per call. The authorised total
      // comes from the same statement (one snapshot, same filters, RLS before the count), so page and total agree.
      // The count row is always present; when the page is empty its case columns are null.
      const joined = await run(
        identity,
        (tx) =>
          tx<(PortfolioRow & { total: string | number | bigint })[]>`
          select t.total, p.*
            from (select cdf_notifications_v13.portfolio_count(
                    ${f.lifecycle_stage ?? null}, ${f.records_state ?? null}, ${f.text ?? null},
                    ${f.assigned_to_me}) as total) t
            left join lateral cdf_notifications_v13.portfolio_page(
                    ${after}, ${f.limit + 1}, ${f.lifecycle_stage ?? null}, ${f.records_state ?? null},
                    ${f.text ?? null}, ${f.assigned_to_me}) p on true`,
      );
      const total = toCount(joined[0]?.total);
      const rows = joined.filter((r) => r.id !== null);
      const items = rows.slice(0, f.limit).map(rowToCaseListItem);
      // A page larger than its own authorised total is inconsistent: refuse it rather than show it.
      if (items.length > total) throw new Error("portfolio_count: total below page size");
      const last = items.at(-1);
      return {
        items,
        next_cursor: rows.length > f.limit && last ? encodeCursor(last.case_number) : null,
        total,
      };
    },

    async getCase(identity: RequestIdentity, caseId: CaseId): Promise<CaseSummary | null> {
      const rows = await run(
        identity,
        (tx) => tx<CaseRow[]>`select * from cdf_notifications_v13.case_header(${caseId}::uuid)`,
      );
      const row = rows[0];
      return row ? rowToCaseSummary(row) : null;
    },
  };
}
