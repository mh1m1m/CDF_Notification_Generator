// V13's notification records of one case, as metadata only (no content, no recipient details). Shape mirrors DB's
// read function case_notifications (migration 0004). FE-006's Notification Operations Center extends this port.
import { z } from "zod";
import { CaseIdSchema, UuidSchema, type CaseId } from "./ids";
import type { RequestIdentity } from "./identity";

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** One notification of a case (case_notifications): metadata only, never its content or a recipient's details. */
export const CaseNotificationSchema = z.strictObject({
  notification_id: UuidSchema,
  case_id: CaseIdSchema,
  template_code: z.string().regex(/^[A-Z][A-Z0-9_-]{2,60}$/),
  template_version: z.number().int().min(1),
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
}
