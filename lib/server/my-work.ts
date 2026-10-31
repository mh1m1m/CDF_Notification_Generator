// My Work (FE-005, SCREENS S1): the persona's own open tasks in the active workspace, the count strip and the task
// status command. Order for the read: request context → lib/authz pre-check ("tasks.mine.read") → MyWorkReader inside
// the database security context (RLS). Order for the command: request context → pre-check ("task.status.update") →
// Zod parse of the form → TaskCommandPort (api_update_task_status re-checks assignment, version, case state and
// transition, and writes the procedural event and the audit event in the same transaction).
//
// The counts are computed from the authorised rows only (never a separate unfiltered count). Dates are compared with
// "today" in the CDF time zone (Asia/Riyadh).
import "server-only";
import { precheck } from "@/lib/authz";
import {
  UpdateTaskStatusCommandSchema,
  type MyWorkReader,
  type MyWorkTask,
  type TaskCommandPort,
  type TaskStatus,
} from "@/lib/contracts";
import { TaskCommandRefusedError } from "@/lib/adapters/my-work/v13-my-work";
import { logServerError } from "@/lib/http/errors";
import type { RequestContext } from "./context";
import { AppError, toUserError } from "./errors";

export const MY_WORK_FILTERS = ["all", "overdue", "week"] as const;
export type MyWorkFilter = (typeof MY_WORK_FILTERS)[number];

/** Days counted as "due this week": today and the next six days. */
export const WEEK_DAYS = 7;

/**
 * Transitions api_update_task_status accepts (migration 0003). DONE and CANCELLED are terminal. The form offers only
 * these; the database refuses anything else (INVALID_TRANSITION) whatever the browser sends.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = Object.freeze({
  OPEN: ["IN_PROGRESS", "BLOCKED", "CANCELLED"],
  IN_PROGRESS: ["BLOCKED", "DONE", "CANCELLED", "OPEN"],
  BLOCKED: ["IN_PROGRESS", "OPEN", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
});

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date (YYYY-MM-DD) in Asia/Riyadh. */
export function riyadhToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new RangeError("dates must be YYYY-MM-DD");
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export type Deadline =
  | { readonly kind: "none" }
  | { readonly kind: "overdue" | "today" | "upcoming"; readonly days: number; readonly date: string };

export function deadlineOf(due: string | null, today: string): Deadline {
  if (due === null) return { kind: "none" };
  const days = daysBetween(today, due);
  return { kind: days < 0 ? "overdue" : days === 0 ? "today" : "upcoming", days, date: due };
}

const isOverdue = (d: Deadline) => d.kind === "overdue";
const isThisWeek = (d: Deadline) => d.kind !== "none" && d.kind !== "overdue" && d.days < WEEK_DAYS;

export interface MyWorkRow {
  readonly task: MyWorkTask;
  readonly deadline: Deadline;
  /** Statuses the form may offer; empty for a closed case or a terminal status (no form is shown). */
  readonly transitions: readonly TaskStatus[];
}

export interface MyWorkCounts {
  readonly overdue: number;
  readonly week: number;
  readonly open: number;
}

export type MyWorkView =
  | {
      readonly kind: "list";
      readonly filter: MyWorkFilter;
      readonly counts: MyWorkCounts;
      readonly rows: readonly MyWorkRow[];
    }
  | { readonly kind: "error"; readonly correlationId: string };

export function parseMyWorkFilter(raw: unknown): MyWorkFilter {
  return typeof raw === "string" && (MY_WORK_FILTERS as readonly string[]).includes(raw)
    ? (raw as MyWorkFilter)
    : "all";
}

export function transitionsFor(task: MyWorkTask): readonly TaskStatus[] {
  if (task.case_records_state !== "ACTIVE") return [];
  return TASK_TRANSITIONS[task.status];
}

export interface MyWorkDeps {
  readonly ctx: RequestContext;
  readonly reader: MyWorkReader;
  readonly now?: () => Date;
}

/** The persona's own tasks. Throws AppError("NOT_FOUND") when the pre-check refuses (never reached in M1). */
export async function listMyWork({ ctx, reader, now = () => new Date() }: MyWorkDeps): Promise<{
  readonly counts: MyWorkCounts;
  readonly rows: readonly MyWorkRow[];
}> {
  if (!precheck(ctx.identity, "tasks.mine.read").allow) throw new AppError("NOT_FOUND");
  const today = riyadhToday(now());
  const tasks = await reader.listMyTasks(ctx.identity);
  const rows = tasks.map((task) => ({
    task,
    deadline: deadlineOf(task.due_date, today),
    transitions: transitionsFor(task),
  }));
  return {
    counts: {
      overdue: rows.filter((r) => isOverdue(r.deadline)).length,
      week: rows.filter((r) => isThisWeek(r.deadline)).length,
      open: rows.length,
    },
    rows,
  };
}

/** The page's view model: never throws except UNAUTHENTICATED (the page redirects to sign-in). */
export async function loadMyWork(deps: MyWorkDeps, rawFilter: unknown): Promise<MyWorkView> {
  const filter = parseMyWorkFilter(rawFilter);
  try {
    const { counts, rows } = await listMyWork(deps);
    const shown =
      filter === "overdue"
        ? rows.filter((r) => isOverdue(r.deadline))
        : filter === "week"
          ? rows.filter((r) => isThisWeek(r.deadline))
          : rows;
    return { kind: "list", filter, counts, rows: shown };
  } catch (error) {
    const user = toUserError(error, deps.ctx.correlationId, "my_work_error");
    if (user.code === "UNAUTHENTICATED") throw error;
    return { kind: "error", correlationId: user.correlationId };
  }
}

export type TaskUpdateOutcome =
  | { readonly kind: "updated"; readonly taskId: string }
  /** The task changed since the form was rendered (V1409): the user reloads and decides again. */
  | { readonly kind: "stale"; readonly correlationId: string }
  /** Anything else (not found or unauthorised, closed case, invalid transition, invalid form, failure): generic. */
  | { readonly kind: "error"; readonly correlationId: string };

/** Untrusted form fields. `expected_version` arrives as text and is converted before the schema checks it. */
export interface TaskUpdateForm {
  readonly task_id: unknown;
  readonly new_status: unknown;
  readonly expected_version: unknown;
}

function toVersion(raw: unknown): number | null {
  return typeof raw === "string" && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

/**
 * Runs the task status command for the current persona. Refusals are logged as `{event, correlation_id, code}` with
 * the refusal code only (never the task, case or status). The outcome never says which check refused.
 */
export async function updateMyTaskStatus(
  { ctx, command }: { readonly ctx: RequestContext; readonly command: TaskCommandPort },
  form: TaskUpdateForm,
): Promise<TaskUpdateOutcome> {
  const correlationId = ctx.correlationId;
  if (!precheck(ctx.identity, "task.status.update").allow) {
    logServerError("task_status_refused", correlationId, { code: "PRECHECK" });
    return { kind: "error", correlationId };
  }
  const parsed = UpdateTaskStatusCommandSchema.safeParse({
    task_id: form.task_id,
    new_status: form.new_status,
    expected_version: toVersion(form.expected_version),
  });
  if (!parsed.success) {
    logServerError("task_status_refused", correlationId, { code: "VALIDATION" });
    return { kind: "error", correlationId };
  }
  try {
    const change = await command.updateStatus(ctx.identity, parsed.data);
    return { kind: "updated", taskId: change.task_id };
  } catch (error) {
    if (error instanceof TaskCommandRefusedError) {
      logServerError("task_status_refused", correlationId, { code: error.refusal });
      return error.refusal === "STALE" ? { kind: "stale", correlationId } : { kind: "error", correlationId };
    }
    logServerError("task_status_failed", correlationId, error);
    return { kind: "error", correlationId };
  }
}
