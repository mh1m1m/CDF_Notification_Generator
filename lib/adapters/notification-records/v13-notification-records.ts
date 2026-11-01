// NotificationRecordsReader over V13's case_notifications (migration 0004) joined to the template catalogue's names
// (notification_template, unique code; M1-07), in the function's own order: metadata only, inside the request
// security context, bound values, explicit columns. Strict rows: an extra column, a malformed row or a row of another
// case refuses the whole result.
//
// V13 is the system of record for its notifications. PRODUCTION_SUBSTITUTION_REQUIRED for this implementation only:
// prototype PostgreSQL (Supabase); production uses RDS PostgreSQL behind the ASP.NET Core API on Alibaba Cloud Riyadh.
import "server-only";
import {
  CaseNotificationSchema,
  type CaseId,
  type CaseRecordsPage,
  type CaseRecordsPageRequest,
  type CaseNotification,
  type NotificationRecordsReader,
  type RequestIdentity,
} from "@/lib/contracts";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";
import { sameCase } from "@/lib/adapters/procedural-records/v13-procedural-records";
import { readCaseListPage } from "@/lib/adapters/case-list/page";

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
  name_ar: string;
  name_en: string;
}

export function rowToCaseNotification(r: NotificationRow): CaseNotification {
  const { name_ar, name_en, ...rest } = r;
  return CaseNotificationSchema.parse({
    ...rest,
    created_at: rest.created_at instanceof Date ? rest.created_at.toISOString() : rest.created_at,
    template_name: { ar: name_ar, en: name_en },
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
                 n.lifecycle_status, n.created_at, n.row_version, t.name_ar, t.name_en
            from cdf_notifications_v13.case_notifications(${caseId}::uuid) n
            join cdf_notifications_v13.notification_template t on t.code = n.template_code
           order by n.created_at desc, n.notification_id`,
      );
      return sameCase(caseId, rows.map(rowToCaseNotification));
    },

    // V13-FE-013: the same read one page at a time (case_notifications_page, migration 0011), same order.
    async listForCasePage(
      identity: RequestIdentity,
      caseId: CaseId,
      page: CaseRecordsPageRequest,
    ): Promise<CaseRecordsPage<CaseNotification>> {
      return readCaseListPage(
        "notifications",
        caseId,
        page,
        (after, limit) =>
          run(
            identity,
            (tx) =>
              tx<(NotificationRow & { page_cursor: string })[]>`
              select n.notification_id, n.case_id, n.template_code, n.template_version, n.language, n.recipient_class,
                     n.lifecycle_status, n.created_at, n.row_version, t.name_ar, t.name_en, n.page_cursor
                from cdf_notifications_v13.case_notifications_page(${caseId}::uuid, ${after.at}::text,
                                                                    ${after.id}::uuid, ${limit}::integer) n
                join cdf_notifications_v13.notification_template t on t.code = n.template_code
               order by n.created_at desc, n.notification_id`,
          ),
        ({ page_cursor: _cursor, ...row }) => rowToCaseNotification(row),
        (n) => n.notification_id,
      );
    },
  };
}
