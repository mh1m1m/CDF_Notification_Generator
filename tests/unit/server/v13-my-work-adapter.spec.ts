// V13 MyWorkReader and TaskCommandPort (SQL) with a recording transaction stub: only my_work_tasks and
// api_update_task_status are called, with bound values, inside the identity's context; rows are validated against
// the contract (one bad row refuses the list); the command's SQLSTATEs map to refusals and an answer that does not
// match the command is refused.
import { describe, expect, it } from "vitest";
import { createV13MyWork } from "@/lib/adapters/my-work/v13-my-work";
import { TaskCommandRefusedError } from "@/lib/contracts";
import type { RequestIdentity } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { caseIdOf } from "./support/fake-case-source";
import { taskEventIdOf, taskIdOf } from "./support/fake-my-work";
import { SECRETARY } from "./support/identities";

function recorder(answer: () => Promise<unknown[]>) {
  const calls: { text: string; values: unknown[]; identity: RequestIdentity }[] = [];
  const run = async <T>(identity: RequestIdentity, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("$"), values, identity });
      return answer();
    }) as unknown as Tx;
    return fn(tx);
  };
  return { calls, port: createV13MyWork(run) };
}

const row = (extra: Record<string, unknown> = {}) => ({
  task_id: taskIdOf(5),
  case_id: caseIdOf(3),
  display_number: "CDF-DEMO-2026-0003",
  task_code: "PREPARE_AGENDA",
  title_ar: "إعداد جدول الأعمال",
  title_en: "Prepare agenda",
  status: "IN_PROGRESS",
  due_date: new Date("2026-11-03T00:00:00Z"),
  row_version: 1,
  case_title_ar: "قضية تجريبية ٠٠٠٣",
  case_title_en: "Demo case 0003",
  case_records_state: "ACTIVE",
  status_event_id: taskEventIdOf(5),
  ...extra,
});

describe("listMyTasks", () => {
  it("reads my_work_tasks(false) with explicit columns in the identity's context and maps the row", async () => {
    const { calls, port } = recorder(async () => [row()]);
    const tasks = await port.listMyTasks(SECRETARY);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.identity).toBe(SECRETARY);
    expect(calls[0]?.text).toContain("from cdf_notifications_v13.my_work_tasks($) w");
    expect(calls[0]?.values).toEqual([false]);
    expect(calls[0]?.text).not.toMatch(/\*/);
    expect(tasks).toEqual([
      {
        task_id: taskIdOf(5),
        case_id: caseIdOf(3),
        case_number: "CDF-DEMO-2026-0003",
        case_title: { ar: "قضية تجريبية ٠٠٠٣", en: "Demo case 0003" },
        case_records_state: "ACTIVE",
        task_code: "PREPARE_AGENDA",
        title: { ar: "إعداد جدول الأعمال", en: "Prepare agenda" },
        status: "IN_PROGRESS",
        due_date: "2026-11-03",
        row_version: 1,
        status_event_id: taskEventIdOf(5),
      },
    ]);
  });

  it.each([
    ["a status other than OPEN without its event", { status_event_id: null }],
    ["a status outside the catalogue", { status: "ARCHIVED" }],
    ["a display number that is not a demo number", { display_number: "CASE-1" }],
    ["a malformed case id", { case_id: "0001" }],
    ["an unknown records state", { case_records_state: "DELETED" }],
    ["a missing case title (DB-010 columns absent)", { case_title_ar: undefined }],
    ["version 0", { row_version: 0 }],
  ])("refuses the whole list for %s", async (_n, extra) => {
    const { port } = recorder(async () => [
      row({ task_id: taskIdOf(2), status: "OPEN", status_event_id: null }),
      row(extra),
    ]);
    await expect(port.listMyTasks(SECRETARY)).rejects.toThrow();
  });
});

describe("updateStatus", () => {
  const command = { task_id: taskIdOf(5), new_status: "BLOCKED" as const, expected_version: 1 };

  it("calls api_update_task_status with bound values and returns the change", async () => {
    const { calls, port } = recorder(async () => [
      { task_id: taskIdOf(5), case_id: caseIdOf(3), status: "BLOCKED", row_version: 2 },
    ]);
    const change = await port.updateStatus(SECRETARY, command);
    expect(change).toEqual({ task_id: taskIdOf(5), case_id: caseIdOf(3), status: "BLOCKED", row_version: 2 });
    expect(calls[0]?.text).toContain("from cdf_notifications_v13.api_update_task_status(");
    expect(calls[0]?.values).toEqual([taskIdOf(5), "BLOCKED", 1]);
  });

  it.each([
    ["V1401", "NO_CONTEXT"],
    ["V1404", "NOT_FOUND"],
    ["V1409", "STALE"],
    ["V1422", "INVALID_TRANSITION"],
    ["V1423", "CASE_CLOSED"],
  ])("maps SQLSTATE %s to %s", async (code, refusal) => {
    const { port } = recorder(async () => {
      throw Object.assign(new Error("db"), { code });
    });
    const error = await port.updateStatus(SECRETARY, command).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TaskCommandRefusedError);
    expect((error as TaskCommandRefusedError).refusal).toBe(refusal);
    expect((error as Error).message).toBe(refusal);
  });

  it("lets any other failure propagate unchanged", async () => {
    const boom = Object.assign(new Error("db"), { code: "40001" });
    const { port } = recorder(async () => {
      throw boom;
    });
    await expect(port.updateStatus(SECRETARY, command)).rejects.toBe(boom);
  });

  it.each([
    ["no row", []],
    ["two rows", [{ task_id: taskIdOf(5), case_id: caseIdOf(3), status: "BLOCKED", row_version: 2 }, {}]],
    ["another task", [{ task_id: taskIdOf(2), case_id: caseIdOf(3), status: "BLOCKED", row_version: 2 }]],
    ["another status", [{ task_id: taskIdOf(5), case_id: caseIdOf(3), status: "DONE", row_version: 2 }]],
    [
      "a version that is not the next one",
      [{ task_id: taskIdOf(5), case_id: caseIdOf(3), status: "BLOCKED", row_version: 3 }],
    ],
    [
      "an extra column",
      [{ task_id: taskIdOf(5), case_id: caseIdOf(3), status: "BLOCKED", row_version: 2, x: 1 }],
    ],
  ])("refuses an answer with %s", async (_n, rows) => {
    const { port } = recorder(async () => rows);
    await expect(port.updateStatus(SECRETARY, command)).rejects.toThrow();
  });

  it("validates the command before any SQL", async () => {
    const { calls, port } = recorder(async () => []);
    await expect(
      port.updateStatus(SECRETARY, { ...command, new_status: "NOPE" } as unknown as typeof command),
    ).rejects.toThrow();
    await expect(port.updateStatus(SECRETARY, { ...command, expected_version: 0 })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
