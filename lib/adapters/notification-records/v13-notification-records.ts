// NotificationRecordsReader over V13's case_notifications (migration 0004): metadata only, inside the request
// security context, bound values, explicit columns. Strict rows: an extra column, a malformed row or a row of another
// case refuses the whole result.
//
// V13 is the system of record for its notifications. PRODUCTION_SUBSTITUTION_REQUIRED for this implementation only:
// prototype PostgreSQL (Supabase); production uses RDS PostgreSQL behind the ASP.NET Core API on Alibaba Cloud Riyadh.
import "server-only";
import {
  CaseNotificationSchema,
  type CaseId,
  type CaseNotification,
  type NotificationRecordsReader,
  type RequestIdentity,
} from "@/lib/contracts";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";
import { sameCase } from "@/lib/adapters/procedural-records/v13-procedural-records";

interface NotificationRow {
  notification_id: string;
  case_id: string;
  template_code: string;
  template_version: number;
  language: string;
  recipient_class: string;
  lifecycle_status: string;
  created_at: Date | string;
  row_version: number;
}

export function rowToCaseNotification(r: NotificationRow): CaseNotification {
  return CaseNotificationSchema.parse({
    ...r,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  });
}

export function createV13NotificationRecordsReader(run: RequestContextRunner): NotificationRecordsReader {
  return {
    async listForCase(identity: RequestIdentity, caseId: CaseId): Promise<readonly CaseNotification[]> {
      const rows = await run(
        identity,
        (tx) =>
          tx<NotificationRow[]>`
          select n.notification_id, n.case_id, n.template_code, n.template_version, n.language, n.recipient_class,
                 n.lifecycle_status, n.created_at, n.row_version
            from cdf_notifications_v13.case_notifications(${caseId}::uuid) n`,
      );
      return sameCase(caseId, rows.map(rowToCaseNotification));
    },
  };
}
