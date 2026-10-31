// My Work (SCREENS S1): the signed-in persona's own tasks across the cases it may see in the active workspace, and the
// task status command. Shapes mirror DB's my_work_tasks (migration 0003, columns added by V13-DB-010 in migration
// 0008) and api_update_task_status (0003). Synthetic only; no field identifies another persona.
import { z } from "zod";
import { CASE_NUMBER_PATTERN, RecordsStateSchema } from "./case-summary";
import { CaseIdSchema, UuidSchema } from "./ids";
import type { RequestIdentity } from "./identity";
import { TaskStatusSchema } from "./procedural-records";

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const Text = z.string().trim().min(1).max(200).regex(NO_CONTROL_CHARS);
const Bilingual = z.strictObject({ ar: Text, en: Text });

/** One of the persona's own tasks (my_work_tasks). `status_event_id` as in CaseTask: null only for an untouched OPEN. */
export const MyWorkTaskSchema = z
  .strictObject({
    task_id: UuidSchema,
    case_id: CaseIdSchema,
    case_number: z.string().regex(CASE_NUMBER_PATTERN),
    case_title: Bilingual,
    case_records_state: RecordsStateSchema,
    task_code: z.string().regex(CODE),
    title: Bilingual,
    status: TaskStatusSchema,
    due_date: z.iso.date().nullable(),
    row_version: z.number().int().min(1),
    status_event_id: UuidSchema.nullable(),
  })
  .refine((t) => t.status === "OPEN" || t.status_event_id !== null, {
    message: "a status other than OPEN needs the event that set it",
    path: ["status_event_id"],
  });
export type MyWorkTask = z.infer<typeof MyWorkTaskSchema>;

/**
 * The identity's own tasks. Contract: authorisation inside the call (RLS); only tasks assigned to the identity, in
 * cases it may see in its active workspace; open tasks only (DONE and CANCELLED excluded); by due date (nulls last),
 * case number, task code.
 */
export interface MyWorkReader {
  listMyTasks(identity: RequestIdentity): Promise<readonly MyWorkTask[]>;
}

/** The task status command (api_update_task_status). One schema: the form, the server and the database all check it. */
export const UpdateTaskStatusCommandSchema = z.strictObject({
  task_id: UuidSchema,
  new_status: TaskStatusSchema,
  expected_version: z.number().int().min(1).max(2_147_483_647),
});
export type UpdateTaskStatusCommand = z.infer<typeof UpdateTaskStatusCommandSchema>;

export const TaskStatusChangeSchema = z.strictObject({
  task_id: UuidSchema,
  case_id: CaseIdSchema,
  status: TaskStatusSchema,
  row_version: z.number().int().min(2),
});
export type TaskStatusChange = z.infer<typeof TaskStatusChangeSchema>;

/** Why the database refused a task command (its codes, mapped by the adapter; never shown to the user as such). */
export const TASK_COMMAND_REFUSALS = [
  "NOT_FOUND",
  "STALE",
  "CASE_CLOSED",
  "INVALID_TRANSITION",
  "NO_CONTEXT",
] as const;
export type TaskCommandRefusal = (typeof TASK_COMMAND_REFUSALS)[number];

/**
 * Task commands. Contract: authorisation, version, case state and transition are checked inside the database command
 * in one transaction that also writes the procedural event and the audit event; a refusal changes nothing.
 */
export interface TaskCommandPort {
  updateStatus(identity: RequestIdentity, command: UpdateTaskStatusCommand): Promise<TaskStatusChange>;
}
