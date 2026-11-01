// V13's notification records of one case, as metadata only (no content, no recipient details). Shape mirrors DB's
// read function case_notifications (migration 0004). FE-006's Notification Operations Center extends this port.
import { z } from "zod";
import { CaseIdSchema, UuidSchema, type CaseId } from "./ids";
import type { CaseRecordsPage, CaseRecordsPageRequest } from "./case-records-page";
import type { RequestIdentity } from "./identity";

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const Name = z.string().trim().min(1).max(200).regex(NO_CONTROL_CHARS);

/** One notification of a case (case_notifications): metadata only, never its content or a recipient's details. */
export const CaseNotificationSchema = z.strictObject({
  notification_id: UuidSchema,
  case_id: CaseIdSchema,
  template_code: z.string().regex(/^[A-Z][A-Z0-9_-]{2,60}$/),
  template_version: z.number().int().min(1),
  /** The template's catalogue name (notification_template.name_ar / name_en), shown beside its code (M1-07). */
  template_name: z.strictObject({ ar: Name, en: Name }),
  language: z.enum(["ar", "en"]),
  recipient_class: z.string().regex(CODE),
  lifecycle_status: z.string().regex(CODE),
  created_at: z.iso.datetime({ offset: true }),
  row_version: z.number().int().min(1),
});
export type CaseNotification = z.infer<typeof CaseNotificationSchema>;

/**
 * V13's notifications of a case. V13 is the system of record for them. Same contract as ProceduralRecordsReader:
 * RLS inside every call, unknown = unauthorised = empty, every row of the case asked for.
 */
export interface NotificationRecordsReader {
  /** Notifications of one case, newest first. */
  listForCase(identity: RequestIdentity, caseId: CaseId): Promise<readonly CaseNotification[]>;
  /**
   * listForCase one page at a time, same order (V13-FE-013, case_notifications_page). Cursor rules as
   * ProceduralRecordsReader.listEventsPage: InvalidCursorError before any read for a cursor that does not decode; an
   * empty page for another case's, a stale cursor, an unknown or an unauthorised case.
   */
  listForCasePage(
    identity: RequestIdentity,
    caseId: CaseId,
    page: CaseRecordsPageRequest,
  ): Promise<CaseRecordsPage<CaseNotification>>;
}
