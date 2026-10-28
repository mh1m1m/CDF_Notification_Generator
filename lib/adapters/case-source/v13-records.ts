// CaseSourceAdapter over V13's own synthetic case records (ADR-001), schema cdf_notifications_v13, migration 0002.
//
// Every call runs inside the per-transaction security context (withRequestContext: claims + SET LOCAL ROLE
// cdf_v13_user), so RLS (can_access_case) filters rows before filters, ordering, paging or counting. Only the
// SECURITY INVOKER read functions portfolio_page and case_header are called; nothing here reads a table directly
// or builds SQL from strings. Rows that do not satisfy the CaseSummary contract are refused as a whole (the call
// fails; the BFF answers UNAVAILABLE) rather than partly shown.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production replaces this adapter with one that calls the authoritative CDF case
// system through the ASP.NET Core API on Alibaba Cloud Riyadh.
import "server-only";
import {
  CaseListFilterSchema,
  CaseSummarySchema,
  type CaseId,
  type CaseListFilter,
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

/** A row of portfolio_page / case_header as FE expects it once DB returns the CaseSummary columns (see mapping). */
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

const iso = (value: Date | string | null | undefined): string | undefined =>
  value instanceof Date ? value.toISOString() : (value ?? undefined);

/**
 * Row → CaseSummary, validated by the contract schema (throws on any mismatch).
 *
 * OPEN (FE → ARCH/DB, 28 Oct 2026): CaseSummary has one synthetic_title while case_record stores title_ar and
 * title_en, and 0002's read functions do not yet return updated_at, source_system, source_ref. Until that is ruled,
 * the Arabic title (primary language) is used and rows without the other columns are refused.
 */
export function rowToCaseSummary(row: CaseRow): CaseSummary {
  return CaseSummarySchema.parse({
    case_id: row.id,
    case_number: row.display_number,
    title_key: null,
    synthetic_title: row.title_ar,
    lifecycle_stage: row.stage,
    is_restricted: row.is_restricted,
    records_state: row.records_state,
    source_system: row.source_system ?? undefined,
    source_ref: row.source_ref ?? undefined,
    updated_at: iso(row.updated_at),
  });
}

export function createV13RecordsCaseSource(run: RequestContextRunner): CaseSourceAdapter {
  return {
    sourceSystem: V13_SOURCE_SYSTEM,

    async listCases(identity: RequestIdentity, filter: CaseListFilter): Promise<CaseListPage> {
      const f = CaseListFilterSchema.parse(filter);
      const after = decodeCursor(f.cursor);
      // One extra row tells whether another page exists; never more than 101 rows per call.
      const rows = await run(
        identity,
        (tx) =>
          tx<CaseRow[]>`
          select * from cdf_notifications_v13.portfolio_page(
            ${after}, ${f.limit + 1}, ${f.lifecycle_stage ?? null}, ${f.records_state ?? null}, ${f.text ?? null})`,
      );
      const page = rows.slice(0, f.limit).map(rowToCaseSummary);
      const last = page.at(-1);
      return {
        items: page,
        next_cursor: rows.length > f.limit && last ? encodeCursor(last.case_number) : null,
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
