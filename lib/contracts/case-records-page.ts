// One bounded page of a case's events, tasks or notifications (V13-FE-013, OI-026; DB-019 migration 0011). The readers
// ask the database for limit + 1 rows of case_events_page, case_tasks_page or case_notifications_page (the extra row
// tells whether a next page exists); those functions accept 1..100, so 99 is the most a caller may ask for. The same
// rows in the same order as the unpaged reads, one page at a time. No count or total: nothing is counted.
import { z } from "zod";

/** Rows per page on the Case Workspace's Events, Tasks and Notifications tabs (as the portfolio). */
export const CASE_RECORDS_PAGE_SIZE = 25;
/** Largest page a caller may ask for (limit + 1 must stay within the database's 1..100). */
export const CASE_RECORDS_PAGE_MAX = 99;

/** `cursor` is the opaque value the reader returned as `next_cursor`; absent for the first page. */
export const CaseRecordsPageRequestSchema = z.strictObject({
  limit: z.number().int().min(1).max(CASE_RECORDS_PAGE_MAX),
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,512}$/)
    .optional(),
});
export type CaseRecordsPageRequest = z.infer<typeof CaseRecordsPageRequestSchema>;

export interface CaseRecordsPage<T> {
  readonly items: readonly T[];
  /** Opaque cursor of the next page, or null on the last page. */
  readonly next_cursor: string | null;
}
