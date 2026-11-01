// The records FE-006's in-case preview reads for one notification (V13-FE-006 part 3). Metadata only: the
// case_notifications row of that case plus its template's catalogue name. No subject, body or recipient details.
// buildModelFromRecords (V13-PROC-008) fills the notice from these fields and the case row; projectForRecipient decides
// what the recipient class sees.
import { UuidSchema, type CaseId } from "./ids";
import type { RequestIdentity } from "./identity";
import { CaseNotificationSchema, type CaseNotification } from "./notification-records";

/** One notification of one case with its template's catalogue name: the case_notifications row the list shows. */
export const NotificationPreviewRecordSchema = CaseNotificationSchema;
export type NotificationPreviewRecord = CaseNotification;

/** The URL value that names the notification to preview (`?n=`): a UUID, never a display number. */
export const PreviewNotificationIdSchema = UuidSchema;

/**
 * V13's read of one notification for the preview. Same contract as NotificationRecordsReader: RLS inside every call,
 * keyed by the case and the notification id together. Unknown id, another case's notification and an unauthorised
 * case all return null, so they look identical. A row of another case or a second row refuses the result.
 */
export interface NotificationPreviewReader {
  getForCase(
    identity: RequestIdentity,
    caseId: CaseId,
    notificationId: string,
  ): Promise<NotificationPreviewRecord | null>;
  /**
   * The preview's read (V13-FE-017, DB-023): records that the identity opened this notification's preview, then reads
   * it as `getForCase` does, both in one transaction. A refused record (unknown, another case's or an unauthorised
   * notification) returns null and reads nothing; a record that cannot be written throws.
   */
  getForCaseRecorded(
    identity: RequestIdentity,
    caseId: CaseId,
    notificationId: string,
  ): Promise<NotificationPreviewRecord | null>;
}
