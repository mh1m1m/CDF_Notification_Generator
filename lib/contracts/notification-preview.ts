// The records FE-006's in-case preview reads for one notification (V13-FE-006 part 3). Metadata only: the
// case_notifications row of that case plus its template's catalogue name. No subject, body or recipient details.
// buildModelFromRecords (V13-PROC-008) fills the notice from these fields and the case row; projectForRecipient decides
// what the recipient class sees.
import { z } from "zod";
import { UuidSchema, type CaseId } from "./ids";
import type { RequestIdentity } from "./identity";
import { CaseNotificationSchema } from "./notification-records";

// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const Name = z.string().trim().min(1).max(200).regex(NO_CONTROL_CHARS);

/** One notification of one case with its template's catalogue name (notification_template.name_ar / name_en). */
export const NotificationPreviewRecordSchema = CaseNotificationSchema.extend({
  template_name: z.strictObject({ ar: Name, en: Name }),
}).strict();
export type NotificationPreviewRecord = z.infer<typeof NotificationPreviewRecordSchema>;

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
}
