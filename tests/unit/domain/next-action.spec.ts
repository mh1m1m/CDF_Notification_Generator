/**
 * NXA — Next Action Card source (REQ-IA-009; V13-PROC-026; design docs/teams/proc/NEXT_ACTION_SOURCES.md, PROC-025).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Synthetic ids, codes and titles only.
 *
 * N1–N13 are the design note's negative and ordering cases. N14 pins ARCH's code-point order for task codes (comment
 * 6553666688 on #124), N15 SEC's INFO that no persona field exists to widen anything.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import * as Domain from "@/lib/domain";
import { NEXT_ACTION_TASK_STATUSES, nextActionForCase, type CaseNextAction } from "@/lib/domain/next-action";

const CASE_1 = "00000000-0000-4000-8000-0000000c0001";
const CASE_2 = "00000000-0000-4000-8000-0000000c0002";
const TASK = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, "0")}`;
const EVENT = "00000000-0000-4000-8000-0000000e0001";

type Task = {
  id: string;
  case_id: string;
  task_code: string;
  title: { ar: string; en: string };
  assignee_capacity: "LEAD_INVESTIGATOR" | "INVESTIGATOR" | "SECRETARY" | "GOVERNANCE_REVIEWER" | null;
  is_mine: boolean;
  status: string;
  due_date: string | null;
  row_version: number;
  status_event_id: string | null;
};
const task = (n: number, over: Partial<Task> = {}): Task => {
  const t: Task = {
    id: TASK(n),
    case_id: CASE_1,
    task_code: `COLLECT_DOCUMENTS_${n}`,
    title: { ar: `مهمة تجريبية ${n}`, en: `Synthetic task ${n}` },
    assignee_capacity: "SECRETARY",
    is_mine: true,
    status: "OPEN",
    due_date: "2026-11-03",
    row_version: 1,
    status_event_id: null,
    ...over,
  };
  // the contract: a status other than OPEN names the event that set it
  if (t.status !== "OPEN" && over.status_event_id === undefined) t.status_event_id = EVENT;
  return t;
};
const input = (
  tasks: Task[],
  over: {
    is_restricted?: boolean;
    records_state?: string;
    my_capacity?: string | null;
    capacity?: string | null;
  } = {},
) => {
  const my = over.my_capacity === undefined ? "SECRETARY" : over.my_capacity;
  return {
    case: {
      case_id: CASE_1,
      is_restricted: over.is_restricted ?? false,
      records_state: over.records_state ?? "ACTIVE",
      my_capacity: my,
    },
    capacity: over.capacity === undefined ? my : over.capacity,
    records: { tasks },
  };
};
const NONE = { kind: "NONE" };
const taskOf = (r: CaseNextAction) => {
  assert.equal(r.kind, "TASK");
  return r as Extract<CaseNextAction, { kind: "TASK" }>;
};
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
};

describe("NXA the persona's own open task is the only source (REQ-IA-009)", () => {
  test("NXA-00 control: the persona's open task on an active case, with its recorded due date and sources", () => {
    const r = taskOf(nextActionForCase(input([task(1)])));
    assert.deepEqual(r, {
      kind: "TASK",
      epistemic: "RECORDED_FACT",
      case_id: CASE_1,
      task_id: TASK(1),
      task_code: "COLLECT_DOCUMENTS_1",
      title: { ar: "مهمة تجريبية 1", en: "Synthetic task 1" },
      status: "OPEN",
      row_version: 1,
      source: { kind: "task", task_id: TASK(1), status_event_id: null },
      deadlines: [
        {
          kind: "TASK_DUE_DATE",
          date: "2026-11-03",
          epistemic: "RECORDED_FACT",
          source: { kind: "task.due_date", task_id: TASK(1) },
        },
      ],
    });
    assert.deepEqual([...NEXT_ACTION_TASK_STATUSES], ["OPEN", "IN_PROGRESS", "BLOCKED"]);
    assert.equal(Domain.nextActionForCase, nextActionForCase);
  });

  test("N1 no tasks gives NONE", () => {
    assert.deepEqual(nextActionForCase(input([])), NONE);
  });

  test("N2 only DONE or CANCELLED tasks of the persona give NONE; IN_PROGRESS and BLOCKED are named", () => {
    assert.deepEqual(
      nextActionForCase(input([task(1, { status: "DONE" }), task(2, { status: "CANCELLED" })])),
      NONE,
    );
    for (const status of ["IN_PROGRESS", "BLOCKED"]) {
      const r = taskOf(nextActionForCase(input([task(1, { status: "DONE" }), task(2, { status })])));
      assert.equal(r.status, status);
      assert.equal(r.source.status_event_id, EVENT);
    }
  });

  test("N3 another persona's and unassigned tasks never win, even when they are due earlier", () => {
    const others = [
      task(1, { is_mine: false, due_date: "2026-11-01" }),
      task(2, { is_mine: false, assignee_capacity: null, due_date: "2026-11-02" }),
    ];
    assert.deepEqual(nextActionForCase(input(others)), NONE);
    const r = taskOf(nextActionForCase(input([...others, task(3, { due_date: "2026-12-31" })])));
    assert.equal(r.task_id, TASK(3));
  });

  test("N4 the persona's open task on a CLOSED case gives NONE", () => {
    assert.deepEqual(nextActionForCase(input([task(1)], { records_state: "CLOSED" })), NONE);
  });

  test("N5 a restricted case without a capacity gives NONE", () => {
    assert.deepEqual(nextActionForCase(input([task(1)], { is_restricted: true, my_capacity: null })), NONE);
  });

  test("N6 control: a restricted case with a capacity names the persona's own task", () => {
    const r = taskOf(
      nextActionForCase(input([task(1)], { is_restricted: true, my_capacity: "INVESTIGATOR" })),
    );
    assert.equal(r.task_id, TASK(1));
  });

  test("N7 malformed input gives NONE: ids, statuses, states, capacities, missing and extra fields", () => {
    const bad: unknown[] = [
      undefined,
      null,
      "x",
      {},
      { ...input([task(1)]), case: { ...input([]).case, case_id: "CDF-DEMO-2026-0001" } },
      { ...input([task(1)]), case: { ...input([]).case, case_id: CASE_1.toUpperCase() } },
      input([task(1, { id: "not-a-uuid" })]),
      input([task(1, { case_id: "00000000-0000-0000-0000-000000000000" })]),
      input([task(1, { status: "WAITING" })]),
      input([task(1, { status: "DONE", status_event_id: null })]),
      input([task(1, { due_date: "03/11/2026" })]),
      input([task(1, { title: { ar: "", en: "x" } })]),
      input([task(1)], { records_state: "ARCHIVED" }),
      input([task(1)], { my_capacity: "CHAIR", capacity: "CHAIR" }),
      { ...input([task(1)]), extra: true },
      { ...input([task(1)]), records: { tasks: [task(1)], events: [] } },
      { ...input([task(1)]), records: { tasks: [{ ...task(1), assignee_persona_id: TASK(9) }] } },
      { case: input([]).case, capacity: "SECRETARY" },
      input([task(1), task(1)]),
    ];
    for (const [i, b] of bad.entries()) assert.deepEqual(nextActionForCase(b), NONE, `case ${i}`);
  });

  test("N8 one row of another case refuses the whole input, wherever it sits", () => {
    const foreign = task(9, { case_id: CASE_2, is_mine: false });
    assert.deepEqual(nextActionForCase(input([task(1), foreign])), NONE);
    assert.deepEqual(nextActionForCase(input([foreign, task(1)])), NONE);
    assert.deepEqual(nextActionForCase(input([task(1, { case_id: CASE_2 })])), NONE);
  });

  test("N9 a capacity that differs from the case header's gives NONE", () => {
    assert.deepEqual(nextActionForCase(input([task(1)], { capacity: "INVESTIGATOR" })), NONE);
    assert.deepEqual(nextActionForCase(input([task(1)], { capacity: null })), NONE);
    assert.deepEqual(nextActionForCase(input([task(1)], { my_capacity: null, capacity: "SECRETARY" })), NONE);
  });

  test("N10 the reader's order wins (due date, nulls last, then code, then id), whatever the input order", () => {
    const pick = (tasks: Task[]) => taskOf(nextActionForCase(input(tasks))).task_id;
    const undated = task(1, { due_date: null });
    const nov3 = task(2, { due_date: "2026-11-03" });
    const nov2 = task(3, { due_date: "2026-11-02" });
    assert.equal(pick([undated, nov3]), TASK(2));
    assert.equal(pick([nov3, nov2]), TASK(3));
    assert.equal(pick([undated, nov3, nov2]), TASK(3));
    assert.equal(pick([nov2, nov3, undated].reverse()), TASK(3));
    const codeB = task(4, { task_code: "PREPARE_AGENDA", due_date: "2026-11-02" });
    const codeA = task(5, { task_code: "COLLECT_DOCUMENTS", due_date: "2026-11-02" });
    assert.equal(pick([codeB, codeA]), TASK(5));
    const sameA = task(7, { task_code: "SAME_CODE", due_date: null });
    const sameB = task(6, { task_code: "SAME_CODE", due_date: null });
    assert.equal(pick([sameA, sameB]), TASK(6));
    assert.equal(pick([sameB, sameA]), TASK(6));
  });

  test("N11 a task with no due date is named with no deadline (no date is invented)", () => {
    const r = taskOf(nextActionForCase(input([task(1, { due_date: null })])));
    assert.deepEqual(r.deadlines, []);
  });

  test("N12 the output carries only its own fields: no persona, no other task, no count, no reason", () => {
    const r = nextActionForCase(input([task(1), task(2, { is_mine: false }), task(3, { due_date: null })]));
    assert.deepEqual(Object.keys(r).sort(), [
      "case_id",
      "deadlines",
      "epistemic",
      "kind",
      "row_version",
      "source",
      "status",
      "task_code",
      "task_id",
      "title",
    ]);
    const text = JSON.stringify(r);
    assert.ok(!text.includes(TASK(2)) && !text.includes(TASK(3)), "no other task");
    assert.ok(!/assignee|persona|count|reason/i.test(text), "no persona, count or reason");
    assert.deepEqual(Object.keys(nextActionForCase(input([]))), ["kind"]);
    const t = taskOf(r);
    assert.deepEqual(Object.keys(t.deadlines[0]!).sort(), ["date", "epistemic", "kind", "source"]);
  });

  test("N13 pure: same input, same output; a deeply frozen input passes; the result is frozen", () => {
    const make = () => input([task(2, { due_date: null }), task(1)]);
    const frozen = deepFreeze(make());
    const a = nextActionForCase(frozen);
    const b = nextActionForCase(make());
    assert.deepEqual(a, b);
    assert.deepEqual(frozen, make(), "input unchanged");
    const t = taskOf(a);
    assert.ok(Object.isFrozen(t) && Object.isFrozen(t.title) && Object.isFrozen(t.deadlines));
    assert.ok(Object.isFrozen(t.deadlines[0]) && Object.isFrozen(t.source));
  });

  test('N14 task codes compare by code point, as collate "C" does (ARCH on #124): ABB before AB_A', () => {
    const abA = task(1, { task_code: "AB_A" });
    const abb = task(2, { task_code: "ABB" });
    assert.equal(taskOf(nextActionForCase(input([abA, abb]))).task_code, "ABB");
    assert.equal(taskOf(nextActionForCase(input([abb, abA]))).task_code, "ABB");
    // a locale's order would put AB_A first; the function must not
    assert.equal(["ABB", "AB_A"].sort((x, y) => x.localeCompare(y, "en"))[0], "AB_A");
  });

  test("N15 there is no persona input: a persona field is refused like any extra field (SEC INFO on #124)", () => {
    const withPersona = { ...input([task(1)]), persona: { persona_id: TASK(99) } };
    assert.deepEqual(nextActionForCase(withPersona), NONE);
  });

  test("N16 the title is returned as plain recorded text, markup included verbatim, never interpreted", () => {
    const title = { ar: "<b>عنوان</b> & تجريبي", en: '<img src=x onerror="1">' };
    const r = taskOf(nextActionForCase(input([task(1, { title })])));
    assert.deepEqual(r.title, title);
  });
});
