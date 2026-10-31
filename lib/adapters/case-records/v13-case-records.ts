// CaseRecordsReader over V13's procedural records (schema cdf_notifications_v13): case_events, case_tasks and
// case_header.my_capacity (DB-008, migration 0006) and case_notifications (migration 0004). Every call runs inside the
// request security context, so RLS decides what exists; unknown and unauthorised cases both give empty results. Only
// SECURITY INVOKER read functions are called, with bound values, and explicit column lists. Any row that breaks the
// contract, or belongs to another case, refuses the whole result (the BFF answers UNAVAILABLE).
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production reads these records through the ASP.NET Core API on Alibaba Cloud
// Riyadh (RDS PostgreSQL).
import "server-only";
import {
  CaseCapacitySchema,
  CaseEventSchema,
  CaseNotificationSchema,
  CaseTaskSchema,
  type CaseCapacity,
  type CaseEvent,
  type CaseId,
  type CaseNotification,
  type CaseRecordsReader,
  type CaseTask,
  type RequestIdentity,
} from "@/lib/contracts";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";

type Instant = Date | string | null;
const iso = (value: Instant): string | null => (value instanceof Date ? value.toISOString() : value);
/** `date` columns arrive as Date (UTC midnight) or "YYYY-MM-DD"; the contract wants the calendar date. */
const day = (value: Date | string | null): string | null =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value;

export class CaseRecordsMismatchError extends Error {
  override readonly name = "CaseRecordsMismatchError";
  readonly code = "CASE_RECORDS_MISMATCH";
}

/** Every row must belong to the case asked for (defence in depth over the database's own filter). */
function sameCase<T extends { case_id: string }>(caseId: CaseId, rows: readonly T[]): readonly T[] {
  if (rows.some((r) => r.case_id !== caseId)) throw new CaseRecordsMismatchError("CASE_RECORDS_MISMATCH");
  return rows;
}

interface EventRow {
  id: string;
  case_id: string;
  event_code: string;
  occurred_at: Instant;
  recorded_at: Instant;
  actor_capacity: string | null;
  provenance: string;
  subject_type: string | null;
  subject_id: string | null;
  causation_id: string | null;
}

interface TaskRow {
  id: string;
  case_id: string;
  task_code: string;
  title_ar: string;
  title_en: string;
  assignee_capacity: string | null;
  is_mine: boolean;
  status: string;
  due_date: Date | string | null;
  row_version: number;
  status_event_id: string | null;
}

interface NotificationRow {
  notification_id: string;
  case_id: string;
  template_code: string;
  template_version: number;
  language: string;
  recipient_class: string;
  lifecycle_status: string;
  created_at: Instant;
  row_version: number;
}

export function rowToCaseEvent(r: EventRow): CaseEvent {
  return CaseEventSchema.parse({
    id: r.id,
    case_id: r.case_id,
    event_code: r.event_code,
    occurred_at: iso(r.occurred_at),
    recorded_at: iso(r.recorded_at),
    actor_capacity: r.actor_capacity,
    provenance: r.provenance,
    subject_type: r.subject_type,
    subject_id: r.subject_id,
    causation_id: r.causation_id,
  });
}

export function rowToCaseTask(r: TaskRow): CaseTask {
  return CaseTaskSchema.parse({
    id: r.id,
    case_id: r.case_id,
    task_code: r.task_code,
    title: { ar: r.title_ar, en: r.title_en },
    assignee_capacity: r.assignee_capacity,
    is_mine: r.is_mine,
    status: r.status,
    due_date: day(r.due_date),
    row_version: r.row_version,
    status_event_id: r.status_event_id,
  });
}

export function rowToCaseNotification(r: NotificationRow): CaseNotification {
  return CaseNotificationSchema.parse({ ...r, created_at: iso(r.created_at) });
}

export function createV13CaseRecordsReader(run: RequestContextRunner): CaseRecordsReader {
  return {
    async myCapacity(identity: RequestIdentity, caseId: CaseId): Promise<CaseCapacity | null> {
      const rows = await run(
        identity,
        (tx) =>
          tx<{ my_capacity: string | null }[]>`
          select h.my_capacity from cdf_notifications_v13.case_header(${caseId}::uuid) h`,
      );
      const value = rows[0]?.my_capacity ?? null;
      return value === null ? null : CaseCapacitySchema.parse(value);
    },

    async listEvents(identity: RequestIdentity, caseId: CaseId): Promise<readonly CaseEvent[]> {
      const rows = await run(
        identity,
        (tx) =>
          tx<EventRow[]>`
          select e.id, e.case_id, e.event_code, e.occurred_at, e.recorded_at, e.actor_capacity, e.provenance,
                 e.subject_type, e.subject_id, e.causation_id
            from cdf_notifications_v13.case_events(${caseId}::uuid) e`,
      );
      return sameCase(caseId, rows.map(rowToCaseEvent));
    },

    async listTasks(identity: RequestIdentity, caseId: CaseId): Promise<readonly CaseTask[]> {
      const rows = await run(
        identity,
        (tx) =>
          tx<TaskRow[]>`
          select t.id, t.case_id, t.task_code, t.title_ar, t.title_en, t.assignee_capacity, t.is_mine, t.status,
                 t.due_date, t.row_version, t.status_event_id
            from cdf_notifications_v13.case_tasks(${caseId}::uuid) t`,
      );
      return sameCase(caseId, rows.map(rowToCaseTask));
    },

    async listNotifications(identity: RequestIdentity, caseId: CaseId): Promise<readonly CaseNotification[]> {
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
