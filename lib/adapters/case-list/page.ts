// Shared paging step for the Case Workspace's lists (V13-FE-013): validate the request, decode the cursor (before any
// read), ask case_*_page for limit + 1 rows, keep limit rows and issue the next cursor from the last kept row. The
// rows are mapped and checked by the caller's strict mapper; every row must carry its page_cursor in the database's
// exact format and belong to the case asked for, otherwise the whole result is refused.
import "server-only";
import {
  CaseRecordsPageRequestSchema,
  type CaseId,
  type CaseRecordsPage,
  type CaseRecordsPageRequest,
} from "@/lib/contracts";
import { CaseRecordsMismatchError } from "@/lib/adapters/procedural-records/v13-procedural-records";
import { decodeCaseListCursor, encodeCaseListCursor, PAGE_CURSOR, type CaseListKind } from "./cursor";

export interface PagedRow {
  readonly page_cursor: string;
}

export async function readCaseListPage<R extends PagedRow, T extends { case_id: string }>(
  kind: CaseListKind,
  caseId: CaseId,
  page: CaseRecordsPageRequest,
  read: (after: { at: string | null; id: string | null }, limit: number) => Promise<readonly R[]>,
  toItem: (row: R) => T,
  idOf: (item: T) => string,
): Promise<CaseRecordsPage<T>> {
  const request = CaseRecordsPageRequestSchema.parse(page);
  const after = decodeCaseListCursor(kind, request.cursor);
  const rows = await read({ at: after?.at ?? null, id: after?.id ?? null }, request.limit + 1);
  for (const r of rows) {
    if (typeof r.page_cursor !== "string" || !PAGE_CURSOR[kind].test(r.page_cursor)) {
      throw new Error(`case_${kind}_page: bad cursor column`);
    }
  }
  const items = rows.map(toItem);
  if (items.some((i) => i.case_id !== caseId)) throw new CaseRecordsMismatchError("CASE_RECORDS_MISMATCH");
  const kept = items.slice(0, request.limit);
  const last = kept.at(-1);
  const lastRow = rows[kept.length - 1];
  return {
    items: kept,
    next_cursor:
      rows.length > request.limit && last !== undefined && lastRow !== undefined
        ? encodeCaseListCursor(kind, { at: lastRow.page_cursor, id: idOf(last) })
        : null,
  };
}
