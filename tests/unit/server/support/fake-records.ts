// In-memory ProceduralRecordsReader and NotificationRecordsReader for unit tests. Visibility follows the fake case source (seed table); case 0001 carries
// DB's seed facts for Employee Alpha (DB-008, PR #21): two events newest first, task 1 LEAD_INVESTIGATOR IN_PROGRESS
// with its status event, task 2 SECRETARY mine OPEN without one. Synthetic only.
import {
  InvalidCursorError,
  type CaseEvent,
  type CaseId,
  type CaseNotification,
  type CaseRecordsPage,
  type CaseRecordsPageRequest,
  type CaseTask,
  type NotificationRecordsReader,
  type ProceduralRecordsReader,
  type RequestIdentity,
} from "@/lib/contracts";
import { caseIdOf, visibleTo } from "./fake-case-source";
import { ALPHA } from "./identities";

const uuid = (prefix: string, i: number, k: number) =>
  `${prefix}000000-0000-4000-8000-${String(i).padStart(6, "0")}${String(k).padStart(6, "0")}`;
export const caseEventId = (i: number, k: number) => uuid("0e", i, k);
export const caseTaskId = (i: number, k: number) => uuid("0d", i, k);
export const caseNotificationId = (i: number, k: number) => uuid("0f", i, k);

function eventsOf(i: number): CaseEvent[] {
  const base = {
    case_id: caseIdOf(i),
    actor_capacity: null,
    provenance: "SEED_SYNTHETIC" as const,
    causation_id: null,
  };
  const opened: CaseEvent = {
    ...base,
    id: caseEventId(i, 1),
    event_code: "CASE_OPENED",
    occurred_at: "2026-10-01T09:00:00.000Z",
    recorded_at: "2026-10-01T09:00:00.000Z",
    subject_type: "case_record",
    subject_id: caseIdOf(i),
  };
  const changed: CaseEvent = {
    ...base,
    id: caseEventId(i, 2),
    event_code: "TASK_STATUS_CHANGED",
    occurred_at: "2026-10-05T10:30:00.000Z",
    recorded_at: "2026-10-05T10:31:00.000Z",
    subject_type: "case_task",
    subject_id: caseTaskId(i, 1),
  };
  const closed: CaseEvent = {
    ...base,
    id: caseEventId(i, 3),
    event_code: "CASE_CLOSED",
    occurred_at: "2026-10-20T12:00:00.000Z",
    recorded_at: "2026-10-20T12:00:00.000Z",
    subject_type: "case_record",
    subject_id: caseIdOf(i),
  };
  return i === 10 ? [closed, changed, opened] : [changed, opened];
}

function tasksOf(i: number, identity: RequestIdentity): CaseTask[] {
  const alpha = identity.persona_id === ALPHA;
  return [
    {
      id: caseTaskId(i, 1),
      case_id: caseIdOf(i),
      task_code: "INTAKE_REVIEW",
      title: { ar: "مراجعة الاستلام", en: "Intake review" },
      assignee_capacity: "LEAD_INVESTIGATOR",
      is_mine: false,
      status: "IN_PROGRESS",
      due_date: "2026-11-05",
      row_version: 2,
      status_event_id: caseEventId(i, 2),
    },
    {
      id: caseTaskId(i, 2),
      case_id: caseIdOf(i),
      task_code: "MINUTES_DRAFT",
      title: { ar: "مسودة المحضر", en: "Draft the minutes" },
      assignee_capacity: "SECRETARY",
      is_mine: alpha,
      status: "OPEN",
      due_date: null,
      row_version: 1,
      status_event_id: null,
    },
  ];
}

function notificationsOf(i: number): CaseNotification[] {
  return [
    {
      notification_id: caseNotificationId(i, 1),
      case_id: caseIdOf(i),
      template_code: "CASE-OPENED-NOTICE",
      template_version: 1,
      template_name: { ar: "إشعار فتح القضية", en: "Case opened notice" },
      language: "ar",
      recipient_class: "CASE_TEAM",
      lifecycle_status: "DRAFT",
      created_at: "2026-10-02T08:00:00.000Z",
      row_version: 1,
    },
  ];
}

const indexOf = (identity: RequestIdentity, caseId: CaseId): number | null => {
  const c = visibleTo(identity).find((s) => s.case_id === caseId);
  return c ? Number(c.case_number.slice(-4)) : null;
};

/**
 * One page of `items` for the fakes (V13-FE-013): the cursor is base64url JSON {k, n} (the list and the offset of the
 * next row); anything else throws InvalidCursorError, as the adapters do. Not the adapters' format, which the adapter
 * and integration tests pin.
 */
export function fakePage<T>(
  kind: string,
  items: readonly T[],
  page: CaseRecordsPageRequest,
): CaseRecordsPage<T> {
  let from = 0;
  if (page.cursor !== undefined) {
    let v: unknown;
    try {
      v = JSON.parse(Buffer.from(page.cursor, "base64url").toString("utf8"));
    } catch {
      throw new InvalidCursorError("bad cursor");
    }
    const c = v as { k?: unknown; n?: unknown } | null;
    if (!c || c.k !== kind || !Number.isSafeInteger(c.n) || (c.n as number) < 1)
      throw new InvalidCursorError("bad cursor");
    from = c.n as number;
  }
  const to = from + page.limit;
  return {
    items: items.slice(from, to),
    next_cursor:
      items.length > to
        ? Buffer.from(JSON.stringify({ k: kind, n: to }), "utf8").toString("base64url")
        : null,
  };
}

/** The paged methods over a reader's unpaged ones (for readers written inline in a test). */
export function withPages(
  r: Pick<ProceduralRecordsReader, "listEvents" | "listTasks">,
): ProceduralRecordsReader {
  return {
    ...r,
    listEventsPage: async (identity, caseId, page) =>
      fakePage("events", await r.listEvents(identity, caseId), page),
    listTasksPage: async (identity, caseId, page) =>
      fakePage("tasks", await r.listTasks(identity, caseId), page),
  };
}

export function withNotificationPages(
  r: Pick<NotificationRecordsReader, "listForCase">,
): NotificationRecordsReader {
  return {
    ...r,
    listForCasePage: async (identity, caseId, page) =>
      fakePage("notifications", await r.listForCase(identity, caseId), page),
  };
}

export function createFakeProceduralRecords(): ProceduralRecordsReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listEvents(identity, caseId) {
      calls.push("listEvents");
      const i = indexOf(identity, caseId);
      return i === null ? [] : eventsOf(i);
    },
    async listTasks(identity, caseId) {
      calls.push("listTasks");
      const i = indexOf(identity, caseId);
      return i === null ? [] : tasksOf(i, identity);
    },
    async listEventsPage(identity, caseId, page) {
      calls.push(`listEventsPage:${page.limit}:${page.cursor ?? ""}`);
      const i = indexOf(identity, caseId);
      return fakePage("events", i === null ? [] : eventsOf(i), page);
    },
    async listTasksPage(identity, caseId, page) {
      calls.push(`listTasksPage:${page.limit}:${page.cursor ?? ""}`);
      const i = indexOf(identity, caseId);
      return fakePage("tasks", i === null ? [] : tasksOf(i, identity), page);
    },
  };
}

export function createFakeNotificationRecords(): NotificationRecordsReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listForCase(identity, caseId) {
      calls.push("listForCase");
      return indexOf(identity, caseId) === 1 ? notificationsOf(1) : [];
    },
    async listForCasePage(identity, caseId, page) {
      calls.push(`listForCasePage:${page.limit}:${page.cursor ?? ""}`);
      return fakePage("notifications", indexOf(identity, caseId) === 1 ? notificationsOf(1) : [], page);
    },
  };
}
