// V13's own procedural records of one case: recorded events and tasks (procedural intelligence, E02). They are not the
// external case registry (CaseSourceAdapter) and are read through ProceduralRecordsReader. Synthetic only. Shapes
// mirror DB's read functions case_events and case_tasks (DB-008, migration 0006). No field identifies a persona or a
// protected party; capacities are codes.
import { z } from "zod";
import { CaseCapacitySchema } from "./case-summary";
import { CaseIdSchema, UuidSchema, type CaseId } from "./ids";
import type { RequestIdentity } from "./identity";

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const Instant = z.iso.datetime({ offset: true });

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

/**
 * V13's procedural records of a case. V13 is the system of record for them.
 *
 * Contract, as for CaseSourceAdapter: authorisation inside every call (database RLS); an unknown case and a case the
 * identity may not see give the same empty result; every row belongs to the case asked for.
 */
export interface ProceduralRecordsReader {
  /** Recorded events, newest first (occurred_at, recorded_at, id). */
  listEvents(identity: RequestIdentity, caseId: CaseId): Promise<readonly CaseEvent[]>;
  /** Tasks, by due date (nulls last), task code, id. */
  listTasks(identity: RequestIdentity, caseId: CaseId): Promise<readonly CaseTask[]>;
}
