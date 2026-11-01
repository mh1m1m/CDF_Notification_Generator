/**
 * Next Action Card: the persona's next authorized action on one case (REQ-IA-009; V13-PROC-026).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * Design: docs/teams/proc/NEXT_ACTION_SOURCES.md (V13-PROC-025, SEC and ARCH ACCEPT a578228). The only decided source
 * today is the persona's own open task on the case. The task row, `is_mine` (computed by the database from the
 * verified claims) and the status are recorded, and api_update_task_status enforces who may act. The only deadline is
 * that task's recorded due date. Nothing else is shown: authority-model actions, the capacity mapping, stage-derived
 * steps and SOURCE_REQUIRED values wait for the owner (REQ-GOV-014, OI-037, OI-039). No action, state or deadline is
 * invented (REQ-VIS-005).
 *
 * The function is pure. It reads no data of its own; it takes the authorised rows the Case Workspace overview already
 * reads for "My open tasks in this case" (`listTasks` over `case_tasks`). It fails closed: anything unexpected gives
 * NONE, and NONE carries no reason, so an unknown case, a hidden case, a closed case and "no task of yours" look the
 * same. The title is the recorded text as the contract schema yields it (plain text, never markup); the page renders
 * it as escaped text inside <bdi>.
 *
 * The input has no persona field (SEC INFO on #124): the persona is already applied by the database (`is_mine`), and
 * a field nothing reads could later become a filter. An input that carries one is refused like any other extra field.
 *
 * PRODUCTION_SUBSTITUTION_REQUIRED: in production the next action comes from the procedural read model and the
 * authorization layer (@cdf/authorization + authz.*).
 */
import { z } from "zod";
import { CaseCapacitySchema, RecordsStateSchema } from "@/lib/contracts/case-summary";
import { CaseIdSchema } from "@/lib/contracts/ids";
import { CaseTaskSchema, type CaseTask } from "@/lib/contracts/procedural-records";

/** The task statuses the card may name: the non-terminal ones, as the overview's "My open tasks" (migration 0003). */
export const NEXT_ACTION_TASK_STATUSES = Object.freeze(["OPEN", "IN_PROGRESS", "BLOCKED"] as const);
export type CaseNextActionTaskStatus = (typeof NEXT_ACTION_TASK_STATUSES)[number];

const NextActionInputSchema = z.strictObject({
  /** The case as CaseSourceAdapter.getCase returned it for this identity (CaseHeader fields). */
  case: z.strictObject({
    case_id: CaseIdSchema,
    is_restricted: z.boolean(),
    records_state: RecordsStateSchema,
    my_capacity: CaseCapacitySchema.nullable(),
  }),
  /** The persona's capacity on this case; must equal case.my_capacity. */
  capacity: CaseCapacitySchema.nullable(),
  /** ProceduralRecordsReader.listTasks(identity, case_id), as read. */
  records: z.strictObject({ tasks: z.array(CaseTaskSchema).readonly() }),
});
export type CaseNextActionInput = z.input<typeof NextActionInputSchema>;

export interface CaseNextActionDeadline {
  readonly kind: "TASK_DUE_DATE";
  /** YYYY-MM-DD as recorded; the page classifies it with My Work's deadlineOf (Asia/Riyadh). */
  readonly date: string;
  readonly epistemic: "RECORDED_FACT";
  readonly source: { readonly kind: "task.due_date"; readonly task_id: string };
}

export type CaseNextAction =
  | { readonly kind: "NONE" }
  | {
      readonly kind: "TASK";
      readonly epistemic: "RECORDED_FACT";
      readonly case_id: string;
      readonly task_id: string;
      readonly task_code: string;
      /** Recorded text as CaseTaskSchema yields it. Render as escaped text. */
      readonly title: { readonly ar: string; readonly en: string };
      readonly status: CaseNextActionTaskStatus;
      readonly row_version: number;
      readonly source: {
        readonly kind: "task";
        readonly task_id: string;
        readonly status_event_id: string | null;
      };
      /** Zero or one entry in M1. */
      readonly deadlines: readonly CaseNextActionDeadline[];
    };

const NONE: CaseNextAction = Object.freeze({ kind: "NONE" as const });

/** Code-point order (the order of `collate "C"`), never a locale's: ICU puts AB_A before ABB, "C" puts ABB first. */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The reader's order: due date (nulls last), task code, id (case_tasks, migrations 0006 and 0011). */
function readerOrder(a: CaseTask, b: CaseTask): number {
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return byCodePoint(a.due_date, b.due_date);
  }
  return byCodePoint(a.task_code, b.task_code) || byCodePoint(a.id, b.id);
}

const isCardStatus = (s: string): s is CaseNextActionTaskStatus =>
  (NEXT_ACTION_TASK_STATUSES as readonly string[]).includes(s);

/**
 * The persona's next authorized action on one case: NONE, or the persona's first open task in the reader's order with
 * its recorded due date. Steps (first failure gives NONE): parse; one case; capacity agrees; active case; a restricted
 * case needs a capacity; choose; deadline.
 */
export function nextActionForCase(input: unknown): CaseNextAction {
  // 1. Parse with the existing contract schemas (strict: extra or missing fields refuse).
  const parsed = NextActionInputSchema.safeParse(input);
  if (!parsed.success) return NONE;
  const { case: c, capacity, records } = parsed.data;

  // 2. One case: one foreign row refuses the whole input (as the journey resolver's CASE_MISMATCH, V13-PROC-018).
  //    A task id seen twice is refused too.
  const ids = new Set<string>();
  for (const t of records.tasks) {
    if (t.case_id !== c.case_id || ids.has(t.id)) return NONE;
    ids.add(t.id);
  }

  // 3. The capacity given must be the case header's own.
  if (capacity !== c.my_capacity) return NONE;

  // 4. Only an ACTIVE case: the command refuses on a closed one (V1423).
  if (c.records_state !== "ACTIVE") return NONE;

  // 5. A restricted case needs a capacity on it (the access rule again, as a second line).
  if (c.is_restricted && capacity === null) return NONE;

  // 6. The persona's own open tasks, in the reader's order, sorted here rather than trusted.
  const mine = records.tasks.filter((t) => t.is_mine && isCardStatus(t.status)).sort(readerOrder);
  const task = mine[0];
  if (!task || !isCardStatus(task.status)) return NONE;

  // 7. The recorded due date, if any. No date is invented.
  const deadlines: readonly CaseNextActionDeadline[] =
    task.due_date === null
      ? Object.freeze([])
      : Object.freeze([
          Object.freeze({
            kind: "TASK_DUE_DATE" as const,
            date: task.due_date,
            epistemic: "RECORDED_FACT" as const,
            source: Object.freeze({ kind: "task.due_date" as const, task_id: task.id }),
          }),
        ]);

  return Object.freeze({
    kind: "TASK" as const,
    epistemic: "RECORDED_FACT" as const,
    case_id: c.case_id,
    task_id: task.id,
    task_code: task.task_code,
    title: Object.freeze({ ar: task.title.ar, en: task.title.en }),
    status: task.status,
    row_version: task.row_version,
    source: Object.freeze({ kind: "task" as const, task_id: task.id, status_event_id: task.status_event_id }),
    deadlines,
  });
}
