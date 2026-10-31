// Notification Operations Center (SCREENS S4, V13-FE-006): notifications across every case the persona may see in
// the active workspace, newest first, with an authorised total. Shapes mirror DB-015's notifications_page and
// notifications_count (migration 0010). Metadata only: no recipient, author or actor, no notification content.
import { z } from "zod";
import { CASE_NUMBER_PATTERN } from "./case-summary";
import { CaseIdSchema, UuidSchema } from "./ids";
import type { RequestIdentity } from "./identity";

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const TEMPLATE_CODE = /^[A-Z][A-Z0-9_-]{2,60}$/;
// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const Text = z.string().trim().min(1).max(200).regex(NO_CONTROL_CHARS);
const Bilingual = z.strictObject({ ar: Text, en: Text });
const Instant = z.iso.datetime({ offset: true });

/** Lifecycle codes of migration 0004's notification.lifecycle_status check. */
export const NOTIFICATION_LIFECYCLE_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "DISPATCHED",
  "CANCELLED",
  "SUPERSEDED",
] as const;
export const NotificationLifecycleStatusSchema = z.enum(NOTIFICATION_LIFECYCLE_STATUSES);
export type NotificationLifecycleStatus = z.infer<typeof NotificationLifecycleStatusSchema>;

/** One row of the Center. Every row names its case (S4 rule: no notification without its case). */
export const NotificationCenterRowSchema = z.strictObject({
  notification_id: UuidSchema,
  case_id: CaseIdSchema,
  case_number: z.string().regex(CASE_NUMBER_PATTERN),
  case_title: Bilingual,
  template_code: z.string().regex(TEMPLATE_CODE),
  template_name: Bilingual,
  template_version: z.number().int().min(1),
  language: z.enum(["ar", "en"]),
  recipient_class: z.string().regex(CODE),
  lifecycle_status: NotificationLifecycleStatusSchema,
  created_at: Instant,
  last_event_at: Instant.nullable(),
  row_version: z.number().int().min(1),
});
export type NotificationCenterRow = z.infer<typeof NotificationCenterRowSchema>;

/** Rows per page and the database's own bound (notifications_page clamps its limit to 1..100). */
export const NOTIFICATION_CENTER_PAGE_MAX = 99;

/**
 * Filters (all optional; validated here, again by the BFF's URL parser and, by matching nothing, the database).
 * `case_number` is an exact display number applied after authorisation, never a key. The date range is
 * [created_from, created_before). `cursor` is the opaque value the reader returned as `next_cursor`.
 */
export const NotificationCenterFilterSchema = z.strictObject({
  limit: z.number().int().min(1).max(NOTIFICATION_CENTER_PAGE_MAX),
  lifecycle_status: NotificationLifecycleStatusSchema.optional(),
  template_code: z.string().regex(TEMPLATE_CODE).optional(),
  case_number: z.string().regex(CASE_NUMBER_PATTERN).optional(),
  created_from: Instant.optional(),
  created_before: Instant.optional(),
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,512}$/)
    .optional(),
});
export type NotificationCenterFilter = z.infer<typeof NotificationCenterFilterSchema>;

export interface NotificationCenterPage {
  readonly items: readonly NotificationCenterRow[];
  readonly next_cursor: string | null;
  /** The authorised number of rows matching the filters over all pages (notifications_count). */
  readonly total: number;
}

/** A cursor the reader did not issue, or one that does not decode. Callers answer with the generic error state. */
export class InvalidCursorError extends Error {
  override readonly name = "InvalidCursorError";
  readonly code = "INVALID_CURSOR";
}

/**
 * The Center's reader. Contract: authorisation inside the call (RLS) before any filter, order, limit or count;
 * newest first (created_at, then notification_id, both descending); unknown and unauthorised cases look alike
 * (their rows are absent and uncounted). A cursor that does not decode throws InvalidCursorError.
 */
export interface NotificationCenterReader {
  listNotifications(
    identity: RequestIdentity,
    filter: NotificationCenterFilter,
  ): Promise<NotificationCenterPage>;
}
