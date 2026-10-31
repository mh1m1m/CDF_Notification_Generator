// MyWorkReader and TaskCommandPort over V13's my_work_tasks (SECURITY INVOKER read, migration 0003, columns added by
// V13-DB-010 in migration 0008) and api_update_task_status (SECURITY DEFINER command, 0003). Inside the request
// security context, bound values, explicit columns. A row that breaks the contract refuses the whole list; the command's refusal codes are
// mapped to TaskCommandRefusedError (never shown to the user as such).
//
// V13 is the system of record for tasks. PRODUCTION_SUBSTITUTION_REQUIRED for this implementation only: prototype
// PostgreSQL (Supabase); production runs the same functions on RDS PostgreSQL behind the ASP.NET Core API on Alibaba
// Cloud Riyadh.
import "server-only";
import {
  MyWorkTaskSchema,
  TaskCommandRefusedError,
  TaskStatusChangeSchema,
  UpdateTaskStatusCommandSchema,
  type MyWorkReader,
  type MyWorkTask,
  type RequestIdentity,
  type TaskCommandPort,
  type TaskCommandRefusal,
  type TaskStatusChange,
  type UpdateTaskStatusCommand,
} from "@/lib/contracts";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";

interface MyWorkRow {
  task_id: string;
  case_id: string;
  display_number: string;
  task_code: string;
  title_ar: string;
  title_en: string;
  status: string;
  due_date: Date | string | null;
  row_version: number;
  case_title_ar: string;
  case_title_en: string;
  case_records_state: string;
  status_event_id: string | null;
}

const day = (value: Date | string | null): string | null =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value;

export function rowToMyWorkTask(r: MyWorkRow): MyWorkTask {
  return MyWorkTaskSchema.parse({
    task_id: r.task_id,
    case_id: r.case_id,
    case_number: r.display_number,
    case_title: { ar: r.case_title_ar, en: r.case_title_en },
    case_records_state: r.case_records_state,
    task_code: r.task_code,
    title: { ar: r.title_ar, en: r.title_en },
    status: r.status,
    due_date: day(r.due_date),
    row_version: r.row_version,
    status_event_id: r.status_event_id,
  });
}

/** The command's SQLSTATEs (migration 0003). Anything else is an unexpected failure and propagates unchanged. */
const REFUSALS: Readonly<Record<string, TaskCommandRefusal>> = {
  V1401: "NO_CONTEXT",
  V1404: "NOT_FOUND",
  V1409: "STALE",
  V1422: "INVALID_TRANSITION",
  V1423: "CASE_CLOSED",
};

export function createV13MyWork(run: RequestContextRunner): MyWorkReader & TaskCommandPort {
  return {
    async listMyTasks(identity: RequestIdentity): Promise<readonly MyWorkTask[]> {
      const rows = await run(
        identity,
        (tx) =>
          tx<MyWorkRow[]>`
          select w.task_id, w.case_id, w.display_number, w.task_code, w.title_ar, w.title_en, w.status, w.due_date,
                 w.row_version, w.case_title_ar, w.case_title_en, w.case_records_state, w.status_event_id
            from cdf_notifications_v13.my_work_tasks(${false}) w`,
      );
      return rows.map(rowToMyWorkTask);
    },

    async updateStatus(
      identity: RequestIdentity,
      command: UpdateTaskStatusCommand,
    ): Promise<TaskStatusChange> {
      const c = UpdateTaskStatusCommandSchema.parse(command);
      let rows: readonly unknown[];
      try {
        rows = await run(
          identity,
          (tx) =>
            tx<{ task_id: string; case_id: string; status: string; row_version: number }[]>`
            select r.task_id, r.case_id, r.status, r.row_version
              from cdf_notifications_v13.api_update_task_status(
                     ${c.task_id}::uuid, ${c.new_status}, ${c.expected_version}::integer) r`,
        );
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        const refusal = typeof code === "string" ? REFUSALS[code] : undefined;
        if (refusal) throw new TaskCommandRefusedError(refusal);
        throw error;
      }
      if (rows.length !== 1) throw new Error("api_update_task_status: expected one row");
      const change = TaskStatusChangeSchema.parse(rows[0]);
      // The database must answer for the task and status asked for, at the next version (fail closed otherwise).
      if (
        change.task_id !== c.task_id ||
        change.status !== c.new_status ||
        change.row_version !== c.expected_version + 1
      ) {
        throw new Error("api_update_task_status: answer does not match the command");
      }
      return change;
    },
  };
}
