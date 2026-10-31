// In-memory ProceduralRecordsReader and NotificationRecordsReader for unit tests. Visibility follows the fake case source (seed table); case 0001 carries
// DB's seed facts for Employee Alpha (DB-008, PR #21): two events newest first, task 1 LEAD_INVESTIGATOR IN_PROGRESS
// with its status event, task 2 SECRETARY mine OPEN without one. Synthetic only.
import type {
  CaseEvent,
  CaseId,
  CaseNotification,
  CaseTask,
  NotificationRecordsReader,
  ProceduralRecordsReader,
  RequestIdentity,
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
  };
}

export function createFakeNotificationRecords(): NotificationRecordsReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listCaseNotifications(identity, caseId) {
      calls.push("listCaseNotifications");
      return indexOf(identity, caseId) === 1 ? notificationsOf(1) : [];
    },
  };
}
