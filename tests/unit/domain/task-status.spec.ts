/** CTS — case task status catalogue (OI-029, migration 0003 `task.status`). Synthetic data only. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Domain from "@/lib/domain";
import { COMPLETED_CLASS_STATUSES, isCompletedClassStatus, toBadgeEpistemic } from "@/lib/domain/badge";
import { STATUS_OBJECTS } from "@/lib/domain/status";
import {
  CASE_TASK_COMPLETED_STATUSES,
  CASE_TASK_STATUS_LABELS,
  CASE_TASK_STATUS_PROPOSED_LABELS,
  CASE_TASK_STATUSES,
  CASE_TASK_TERMINAL_STATUSES,
  caseTaskStatusLabel,
  isCaseTaskStatus,
  isTerminalCaseTaskStatus,
} from "@/lib/domain/task-status";

const MIGRATION = "database/migrations/0003_procedural_core.sql";

describe("CTS case task status catalogue", () => {
  test("CTS-01 exactly migration 0003's five codes, in order, frozen, re-exported by lib/domain", () => {
    assert.deepEqual([...CASE_TASK_STATUSES], ["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]);
    assert.ok(Object.isFrozen(CASE_TASK_STATUSES));
    assert.equal(Domain.CASE_TASK_STATUSES, CASE_TASK_STATUSES);
    assert.equal(Domain.caseTaskStatusLabel, caseTaskStatusLabel);
  });

  test("CTS-02 the list matches the task.status check constraint in the migration file", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const m = /check \(status in \(([^)]*)\)\)/.exec(sql);
    assert.ok(m?.[1], "task.status check constraint found in 0003");
    const codes = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
    assert.deepEqual(codes, [...CASE_TASK_STATUSES]);
  });

  test("CTS-03 DONE and CANCELLED are terminal; the migration says the same", () => {
    assert.deepEqual([...CASE_TASK_TERMINAL_STATUSES], ["DONE", "CANCELLED"]);
    assert.ok(Object.isFrozen(CASE_TASK_TERMINAL_STATUSES));
    for (const s of CASE_TASK_STATUSES)
      assert.equal(isTerminalCaseTaskStatus(s), s === "DONE" || s === "CANCELLED", s);
    const sql = readFileSync(MIGRATION, "utf8");
    assert.match(sql, /DONE and CANCELLED are terminal/);
    // No allowed transition starts from a terminal status.
    const graph =
      /_task_transition_allowed\(p_from text, p_to text\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/.exec(sql)?.[1] ?? "";
    const pairs = [...graph.matchAll(/\('([A-Z_]+)', '([A-Z_]+)'\)/g)].map((x) => x[1]);
    assert.equal(pairs.length, 10, "the ten transition pairs of _task_transition_allowed");
    for (const from of pairs) assert.ok(!isTerminalCaseTaskStatus(from), `transition from ${from}`);
  });

  test("CTS-04 DONE is the one completed-class task status (rule T5); the others are not", () => {
    assert.deepEqual([...CASE_TASK_COMPLETED_STATUSES], ["DONE"]);
    assert.ok((COMPLETED_CLASS_STATUSES as readonly string[]).includes("DONE"));
    for (const s of CASE_TASK_STATUSES) assert.equal(isCompletedClassStatus(s), s === "DONE", s);
  });

  test("CTS-05 negative (rule T5): an expected, conditional or awaiting-approval badge never shows DONE", () => {
    for (const epistemic of ["EXPECTED_PROCESS", "CONDITIONAL_STEP", "SUBJECT_TO_APPROVAL"] as const) {
      assert.throws(
        () => toBadgeEpistemic({ epistemic, shown_status: "DONE" }),
        (e: unknown) => (e as { code?: string }).code === "COMPLETED_STATUS_NOT_RECORDED",
      );
      for (const s of ["OPEN", "IN_PROGRESS", "BLOCKED", "CANCELLED"])
        assert.equal(toBadgeEpistemic({ epistemic, shown_status: s }).event_id, null);
    }
  });

  test("CTS-06 every code has a frozen {ar,en} label; BLOCKED and DONE are marked PROPOSED wording", () => {
    assert.deepEqual(Object.keys(CASE_TASK_STATUS_LABELS), [...CASE_TASK_STATUSES]);
    assert.ok(Object.isFrozen(CASE_TASK_STATUS_LABELS));
    for (const s of CASE_TASK_STATUSES) {
      const l = caseTaskStatusLabel(s);
      assert.ok(Object.isFrozen(l));
      assert.ok(l.ar.trim().length > 0 && l.en.trim().length > 0, s);
      assert.match(l.ar, /[؀-ۿ]/, `${s} Arabic label`);
    }
    assert.deepEqual([...CASE_TASK_STATUS_PROPOSED_LABELS], ["BLOCKED", "DONE"]);
  });

  test("CTS-07 OPEN, IN_PROGRESS and CANCELLED reuse the domain's existing labels word for word", () => {
    const proc = STATUS_OBJECTS.ProcedureStatus.labels;
    for (const s of ["OPEN", "IN_PROGRESS", "CANCELLED"] as const)
      assert.deepEqual({ ...caseTaskStatusLabel(s) }, { ...proc[s] }, s);
  });

  test("CTS-08 negative: unknown, lower-case, padded or procedural-only codes are refused", () => {
    for (const bad of [
      "done",
      " DONE",
      "Done",
      "COMPLETED",
      "ON_HOLD",
      "ASSIGNED",
      "",
      null,
      undefined,
      3,
      {},
    ]) {
      assert.equal(isCaseTaskStatus(bad), false, String(bad));
      assert.equal(isTerminalCaseTaskStatus(bad), false, String(bad));
      assert.throws(() => caseTaskStatusLabel(bad), TypeError);
    }
  });
});
