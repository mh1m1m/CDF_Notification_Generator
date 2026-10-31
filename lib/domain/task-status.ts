/**
 * Case task status catalogue (OI-029; Chief Architect ruling 31 Oct 2026).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * The Case Workspace task badges show `cdf_notifications_v13.task.status` (migration 0003). That column has its own
 * five codes. They are a separate catalogue from the procedural status objects in `./status` (the TaskStatus lifecycle there is the
 * reference package's procedural task object), and nothing is renamed between the two.
 *
 * The codes, the terminal pair and the completed class follow migration 0003 exactly: its check constraint and its
 * transition comment ("DONE and CANCELLED are terminal"). An integration test reads the constraint from the database
 * and asserts the same set. The status graph itself stays in the database (`_task_transition_allowed`); this module
 * does not copy it.
 *
 * Labels: OPEN, IN_PROGRESS and CANCELLED reuse the domain's existing wording for those codes. BLOCKED and DONE are
 * PROPOSED wording; the owner may change it.
 */
import type { Bilingual } from "./types";

export const CASE_TASK_STATUSES = Object.freeze([
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "CANCELLED",
] as const);
export type CaseTaskStatus = (typeof CASE_TASK_STATUSES)[number];

/** Terminal task statuses: no transition leaves them (migration 0003). */
export const CASE_TASK_TERMINAL_STATUSES = Object.freeze([
  "DONE",
  "CANCELLED",
] as const satisfies readonly CaseTaskStatus[]);

/** The one task status that says the work has happened: shown only from a recorded event (rule T5). */
export const CASE_TASK_COMPLETED_STATUSES = Object.freeze([
  "DONE",
] as const satisfies readonly CaseTaskStatus[]);

const L = (ar: string, en: string): Bilingual => Object.freeze({ ar, en });

export const CASE_TASK_STATUS_LABELS: Readonly<Record<CaseTaskStatus, Bilingual>> = Object.freeze({
  OPEN: L("مفتوح", "Open"),
  IN_PROGRESS: L("قيد الإجراء", "In progress"),
  BLOCKED: L("متعثّر", "Blocked"),
  DONE: L("منجز", "Done"),
  CANCELLED: L("أُلغي", "Cancelled"),
});

/** Which labels are PROPOSED wording (not taken from the domain's existing labels). */
export const CASE_TASK_STATUS_PROPOSED_LABELS = Object.freeze([
  "BLOCKED",
  "DONE",
] as const satisfies readonly CaseTaskStatus[]);

export const isCaseTaskStatus = (s: unknown): s is CaseTaskStatus =>
  typeof s === "string" && (CASE_TASK_STATUSES as readonly string[]).includes(s);

export const isTerminalCaseTaskStatus = (s: unknown): boolean =>
  isCaseTaskStatus(s) && (CASE_TASK_TERMINAL_STATUSES as readonly string[]).includes(s);

/** The label for a task status; throws on anything that is not one of the five codes (fail closed). */
export function caseTaskStatusLabel(s: unknown): Bilingual {
  if (!isCaseTaskStatus(s)) throw new TypeError("not a task status code");
  return CASE_TASK_STATUS_LABELS[s];
}
