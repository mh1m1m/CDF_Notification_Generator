// In-memory MyWorkReader and TaskCommandPort for unit tests. The task table is the seed's (database/seed/0002_m1_cases.sql:
// two tasks per case, task 0d…NN, assignee by persona suffix); visibility follows the fake case source. The command
// mirrors api_update_task_status (0003): the assignee, or a persona assigned to the case, in a case it may see;
// anything else (unknown, other case, not assigned) → NOT_FOUND, stale version → STALE, closed case →
// CASE_CLOSED, transition outside the table → INVALID_TRANSITION. Synthetic only.
import {
  TaskCommandRefusedError,
  UpdateTaskStatusCommandSchema,
  type MyWorkReader,
  type MyWorkTask,
  type RequestIdentity,
  type TaskCommandPort,
  type TaskStatus,
  type TaskStatusChange,
  type UpdateTaskStatusCommand,
} from "@/lib/contracts";
import { TASK_TRANSITIONS } from "@/lib/server/my-work";
import { ASSIGNED, caseIdOf, FAKE_CASES, visibleTo } from "./fake-case-source";

export const taskIdOf = (n: number) => `0d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
export const taskEventIdOf = (n: number) => `0e000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const persona = (p: number) => `0b000000-0000-4000-8000-00000000000${p}`;

/** [task, case, code, assignee persona, status, due] — the seed rows. */
const SEED: readonly [number, number, string, number, TaskStatus, string][] = [
  [1, 1, "COLLECT_DOCUMENTS", 2, "IN_PROGRESS", "2026-11-05"],
  [2, 1, "SCHEDULE_INTERVIEW", 1, "OPEN", "2026-11-10"],
  [3, 2, "COLLECT_DOCUMENTS", 3, "OPEN", "2026-11-07"],
  [4, 2, "DRAFT_FINDINGS", 3, "OPEN", "2026-11-20"],
  [5, 3, "PREPARE_AGENDA", 1, "IN_PROGRESS", "2026-11-03"],
  [6, 3, "PRESENT_RESULTS", 2, "OPEN", "2026-11-12"],
  [7, 4, "PRELIMINARY_REVIEW", 1, "OPEN", "2026-11-08"],
  [8, 4, "REQUEST_INFORMATION", 1, "BLOCKED", "2026-11-15"],
  [9, 5, "REGISTER_REPORT", 2, "OPEN", "2026-11-02"],
  [10, 5, "ASSESS_ADMISSIBILITY", 2, "OPEN", "2026-11-09"],
  [11, 6, "COLLECT_DOCUMENTS", 3, "IN_PROGRESS", "2026-11-06"],
  [12, 6, "WITNESS_INTERVIEW", 2, "OPEN", "2026-11-14"],
  [13, 7, "ISSUE_DECISION_NOTICE", 1, "OPEN", "2026-11-04"],
  [14, 7, "ARCHIVE_MINUTES", 1, "OPEN", "2026-11-18"],
  [15, 8, "GOVERNANCE_REVIEW", 4, "IN_PROGRESS", "2026-11-11"],
  [16, 8, "PREPARE_AGENDA", 1, "OPEN", "2026-11-13"],
  [17, 9, "COLLECT_DOCUMENTS", 2, "OPEN", "2026-11-05"],
  [18, 9, "RESTRICTED_INTERVIEW", 2, "OPEN", "2026-11-16"],
  [19, 10, "ARCHIVE_CASE", 1, "DONE", "2026-07-01"],
  [20, 10, "FINAL_REPORT", 3, "OPEN", "2026-07-01"],
];

interface Row {
  readonly n: number;
  readonly caseNo: number;
  readonly code: string;
  readonly assignee: string;
  status: TaskStatus;
  due: string;
  version: number;
  eventId: string | null;
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set(["DONE", "CANCELLED"]);

export function createFakeMyWork(): MyWorkReader &
  TaskCommandPort & { calls: string[]; rows: Row[]; commands: UpdateTaskStatusCommand[] } {
  const calls: string[] = [];
  const commands: UpdateTaskStatusCommand[] = [];
  const rows: Row[] = SEED.map(([n, caseNo, code, p, status, due]) => ({
    n,
    caseNo,
    code,
    assignee: persona(p),
    status,
    due,
    version: 1,
    eventId: status === "OPEN" ? null : taskEventIdOf(n),
  }));
  const mineAndVisible = (identity: RequestIdentity, r: Row) =>
    r.assignee === identity.persona_id && visibleTo(identity).some((c) => c.case_id === caseIdOf(r.caseNo));

  const toTask = (r: Row): MyWorkTask => {
    const c = FAKE_CASES[r.caseNo - 1]!;
    return {
      task_id: taskIdOf(r.n),
      case_id: c.case_id,
      case_number: c.case_number,
      case_title: c.synthetic_title!,
      case_records_state: c.records_state,
      task_code: r.code,
      title: { ar: `مهمة ${r.n}`, en: `Task ${r.n}` },
      status: r.status,
      due_date: r.due,
      row_version: r.version,
      status_event_id: r.eventId,
    } as MyWorkTask;
  };

  return {
    calls,
    rows,
    commands,
    async listMyTasks(identity) {
      calls.push("listMyTasks");
      return rows
        .filter((r) => mineAndVisible(identity, r) && !TERMINAL.has(r.status))
        .sort((a, b) => a.due.localeCompare(b.due) || a.caseNo - b.caseNo || a.code.localeCompare(b.code))
        .map(toTask);
    },
    async updateStatus(identity, command): Promise<TaskStatusChange> {
      calls.push("updateStatus");
      const c = UpdateTaskStatusCommandSchema.parse(command);
      commands.push(c);
      const r = rows.find((x) => taskIdOf(x.n) === c.task_id);
      const mayChange =
        r !== undefined &&
        visibleTo(identity).some((x) => x.case_id === caseIdOf(r.caseNo)) &&
        (r.assignee === identity.persona_id || (ASSIGNED[identity.persona_id] ?? []).includes(r.caseNo));
      if (!r || !mayChange) throw new TaskCommandRefusedError("NOT_FOUND");
      if (r.version !== c.expected_version) throw new TaskCommandRefusedError("STALE");
      if (FAKE_CASES[r.caseNo - 1]!.records_state !== "ACTIVE")
        throw new TaskCommandRefusedError("CASE_CLOSED");
      if (!TASK_TRANSITIONS[r.status].includes(c.new_status))
        throw new TaskCommandRefusedError("INVALID_TRANSITION");
      r.status = c.new_status;
      r.version += 1;
      r.eventId = `0e000000-0000-4000-8000-0000000009${String(r.n).padStart(2, "0")}`;
      return { task_id: c.task_id, case_id: caseIdOf(r.caseNo), status: r.status, row_version: r.version };
    },
  };
}
