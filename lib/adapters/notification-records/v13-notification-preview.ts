// NotificationPreviewReader over V13's case_notifications (migration 0004, SECURITY INVOKER, RLS) joined to the
// template catalogue (notification_template, SELECT under RLS). Inside the request security context, bound values,
// explicit columns, strict rows: an extra column, a malformed row, a row of another case or of another notification,
// or a second row refuses the whole result. No template text (subject, body) is read.
//
// V13 is the system of record for its notifications. PRODUCTION_SUBSTITUTION_REQUIRED for this implementation only:
// prototype PostgreSQL (Supabase); production uses RDS PostgreSQL behind the ASP.NET Core API on Alibaba Cloud Riyadh.
import "server-only";
import {
  NotificationPreviewRecordSchema,
  PreviewNotificationIdSchema,
  type CaseId,
  type NotificationPreviewReader,
  type NotificationPreviewRecord,
  type RequestIdentity,
} from "@/lib/contracts";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";

export interface PreviewRow {
  notification_id: string;
  case_id: string;
  template_code: string;
  template_version: number;
  language: string;
  recipient_class: string;
  lifecycle_status: string;
  created_at: Date | string;
  row_version: number;
  name_ar: string;
  name_en: string;
}

export const PREVIEW_COLUMNS: readonly string[] = Object.freeze([
  "notification_id",
  "case_id",
  "template_code",
  "template_version",
  "language",
  "recipient_class",
  "lifecycle_status",
  "created_at",
  "row_version",
  "name_ar",
  "name_en",
]);

export function rowToPreviewRecord(r: PreviewRow): NotificationPreviewRecord {
  const keys = Object.keys(r);
  if (keys.length !== PREVIEW_COLUMNS.length || !keys.every((k) => PREVIEW_COLUMNS.includes(k)))
    throw new Error("notification preview: unexpected columns");
  const { name_ar, name_en, ...rest } = r;
  return NotificationPreviewRecordSchema.parse({
    ...rest,
    created_at: rest.created_at instanceof Date ? rest.created_at.toISOString() : rest.created_at,
    template_name: { ar: name_ar, en: name_en },
  });
}

export function createV13NotificationPreviewReader(run: RequestContextRunner): NotificationPreviewReader {
  return {
    async getForCase(
      identity: RequestIdentity,
      caseId: CaseId,
      notificationId: string,
    ): Promise<NotificationPreviewRecord | null> {
      // Never send a malformed id to the database: the caller treats null as "not available".
      if (!PreviewNotificationIdSchema.safeParse(notificationId).success) return null;
      const rows = await run(
        identity,
        (tx) =>
          tx<PreviewRow[]>`
          select n.notification_id, n.case_id, n.template_code, n.template_version, n.language, n.recipient_class,
                 n.lifecycle_status, n.created_at, n.row_version, t.name_ar, t.name_en
            from cdf_notifications_v13.case_notifications(${caseId}::uuid) n
            join cdf_notifications_v13.notification_template t on t.code = n.template_code
           where n.notification_id = ${notificationId}::uuid`,
      );
      if (rows.length === 0) return null;
      if (rows.length > 1) throw new Error("notification preview: more than one row");
      const record = rowToPreviewRecord(rows[0] as PreviewRow);
      if (record.case_id !== caseId || record.notification_id !== notificationId)
        throw new Error("notification preview: a row of another case or notification");
      return record;
    },
  };
}
