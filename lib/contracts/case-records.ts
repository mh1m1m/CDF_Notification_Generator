// V13's own procedural records of one case (events, tasks, notifications) and the caller's capacity on it. These are
// not the external case source: they live in V13's schema and are read through CaseRecordsReader. Synthetic only.
// Shapes mirror DB's read functions case_events, case_tasks, case_notifications and case_header.my_capacity
// (DB-008, migrations 0004 and 0006). No field identifies a persona or a protected party; capacities are codes.
import { z } from "zod";
import { CaseIdSchema, UuidSchema, type CaseId } from "./ids";
import type { RequestIdentity } from "./identity";

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const Instant = z.iso.datetime({ offset: true });

/** A persona's capacity on a case (case_assignment.capacity), in DB's precedence order. */
export const CASE_CAPACITIES = [
  "LEAD_INVESTIGATOR",
  "INVESTIGATOR",
  "SECRETARY",
  "GOVERNANCE_REVIEWER",
] as const;
export const CaseCapacitySchema = z.enum(CASE_CAPACITIES);
export type CaseCapacity = z.infer<typeof CaseCapacitySchema>;

/** One recorded procedural event (case_events). Only recorded entries exist; nothing here is expected or planned. */
export const CaseEventSchema = z.strictObject({
  id: UuidSchema,
  case_id: CaseIdSchema,
  event_code: z.string().regex(CODE),
  occurred_at: Instant,
  recorded_at: Instant,
  actor_capacity: CaseCapacitySchema.nullable(),
  provenance: z.enum(["RECORDED_IN_V13", "SEED_SYNTHETIC"]),
  subject_type: z
    .string()
    .regex(/^[a-z][a-z0-9_]{2,60}$/)
    .nullable(),
  subject_id: UuidSchema.nullable(),
  causation_id: UuidSchema.nullable(),
});
export type CaseEvent = z.infer<typeof CaseEventSchema>;

export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

const TaskTitleSchema = z.string().trim().min(1).max(200).regex(NO_CONTROL_CHARS);

/** One task of a case (case_tasks). `status_event_id` is the event that set the status; null for an untouched OPEN. */
export const CaseTaskSchema = z
  .strictObject({
    id: UuidSchema,
    case_id: CaseIdSchema,
    task_code: z.string().regex(CODE),
    title: z.strictObject({ ar: TaskTitleSchema, en: TaskTitleSchema }),
    assignee_capacity: CaseCapacitySchema.nullable(),
    is_mine: z.boolean(),
    status: TaskStatusSchema,
    due_date: z.iso.date().nullable(),
    row_version: z.number().int().min(1),
    status_event_id: UuidSchema.nullable(),
  })
  .refine((t) => t.status === "OPEN" || t.status_event_id !== null, {
    message: "a status other than OPEN needs the event that set it",
    path: ["status_event_id"],
  });
export type CaseTask = z.infer<typeof CaseTaskSchema>;

/** One notification of a case (case_notifications): metadata only, never its content or a recipient's details. */
export const CaseNotificationSchema = z.strictObject({
  notification_id: UuidSchema,
  case_id: CaseIdSchema,
  template_code: z.string().regex(/^[A-Z][A-Z0-9_-]{2,60}$/),
  template_version: z.number().int().min(1),
  language: z.enum(["ar", "en"]),
  recipient_class: z.string().regex(CODE),
  lifecycle_status: z.string().regex(CODE),
  created_at: Instant,
  row_version: z.number().int().min(1),
});
export type CaseNotification = z.infer<typeof CaseNotificationSchema>;

/**
 * V13's procedural records of a case.
 *
 * Contract, as for CaseSourceAdapter: authorisation inside every call (database RLS); an unknown case and a case the
 * identity may not see give the same empty result; every row belongs to the case asked for.
 *
 * PRODUCTION_SUBSTITUTION_REQUIRED: production reads these records from the CDF platform's RDS PostgreSQL through the
 * ASP.NET Core API on Alibaba Cloud Riyadh.
 */
export interface CaseRecordsReader {
  /** The identity's capacity on the case, or null (none, unknown or unauthorised case). */
  myCapacity(identity: RequestIdentity, caseId: CaseId): Promise<CaseCapacity | null>;
  /** Recorded events, newest first (occurred_at, recorded_at, id). */
  listEvents(identity: RequestIdentity, caseId: CaseId): Promise<readonly CaseEvent[]>;
  /** Tasks, by due date (nulls last), task code, id. */
  listTasks(identity: RequestIdentity, caseId: CaseId): Promise<readonly CaseTask[]>;
  /** Notifications, newest first. */
  listNotifications(identity: RequestIdentity, caseId: CaseId): Promise<readonly CaseNotification[]>;
}
