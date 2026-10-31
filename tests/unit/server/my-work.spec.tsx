// FE-005 My Work (SCREENS S1): dates in Asia/Riyadh, counts from authorised rows only, filters, the status command
// (pre-check → Zod → command; every refusal generic except STALE; nothing sent when the form is invalid), the Server
// Action's order, and the markup (S1 test ids, ADR-013 attributes on recorded statuses only, no form for a closed
// case, only allowed transitions offered). Fake adapters; the SQL adapter is covered in v13-my-work-adapter.spec.ts and
// against the database in tests/integration/fe/my-work-command.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ActionsModule from "@/app/(platform)/my-work/actions";
import type { MyWorkReader, TaskCommandPort } from "@/lib/contracts";
import { createTranslator, type Locale } from "@/lib/i18n";
import { AppError } from "@/lib/server/errors";
import {
  daysBetween,
  deadlineOf,
  listMyWork,
  loadMyWork,
  parseMyWorkFilter,
  riyadhToday,
  TASK_TRANSITIONS,
  updateMyTaskStatus,
  type MyWorkView,
} from "@/lib/server/my-work";
import { caseIdOf } from "./support/fake-case-source";
import { createFakeMyWork, taskEventIdOf, taskIdOf } from "./support/fake-my-work";
import {
  ALPHA,
  BETA,
  CORRELATION,
  ctxFor,
  GAMMA,
  GOVERNANCE,
  id,
  INVESTIGATOR_BETA,
  INVESTIGATOR_GAMMA,
  SECRETARY,
} from "./support/identities";

const logServerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/errors", () => ({ logServerError }));
const updateTaskStatus = vi.hoisted(() => vi.fn());
vi.mock("@/app/(platform)/my-work/actions", () => ({ updateTaskStatus }));
// For the Server Action tests (the real action is loaded with vi.importActual; its dependencies stay mocked).
const action = vi.hoisted(() => ({ session: null as unknown, command: null as unknown }));
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("@/lib/auth/server-session", () => ({ getCurrentSession: async () => action.session }));
vi.mock("@/lib/server/my-work-binding", () => ({ myWorkFor: () => action.command }));

beforeEach(() => logServerError.mockClear());

/** 31 Oct 2026 12:00 in Riyadh. */
const OCT31 = () => new Date("2026-10-31T09:00:00Z");
/** 9 Nov 2026 12:00 in Riyadh. */
const NOV9 = () => new Date("2026-11-09T09:00:00Z");

const ALPHA_TASKS = [2, 5, 7, 8, 13, 14, 16];

describe("dates (Asia/Riyadh)", () => {
  it("today follows Riyadh, not UTC", () => {
    expect(riyadhToday(new Date("2026-10-31T20:59:00Z"))).toBe("2026-10-31");
    expect(riyadhToday(new Date("2026-10-31T21:00:00Z"))).toBe("2026-11-01");
  });

  it("deadline kinds and day counts", () => {
    expect(deadlineOf(null, "2026-11-01")).toEqual({ kind: "none" });
    expect(deadlineOf("2026-10-29", "2026-11-01")).toEqual({ kind: "overdue", days: -3, date: "2026-10-29" });
    expect(deadlineOf("2026-11-01", "2026-11-01")).toEqual({ kind: "today", days: 0, date: "2026-11-01" });
    expect(deadlineOf("2026-11-08", "2026-11-01")).toEqual({ kind: "upcoming", days: 7, date: "2026-11-08" });
  });

  it("refuses dates that are not YYYY-MM-DD", () => {
    expect(() => daysBetween("2026-11-01", "1 Nov 2026")).toThrow(RangeError);
    expect(() => daysBetween("", "2026-11-01")).toThrow(RangeError);
  });
});

describe("listMyWork", () => {
  it("Secretary Alpha sees exactly its own seven open tasks (the DONE one is excluded)", async () => {
    const reader = createFakeMyWork();
    const { rows, counts } = await listMyWork({ ctx: ctxFor(SECRETARY), reader, now: OCT31 });
    expect(rows.map((r) => r.task.task_id)).toEqual(
      [5, 13, 7, 2, 16, 8, 14].map(taskIdOf), // by due date
    );
    expect(new Set(rows.map((r) => r.task.task_id))).toEqual(new Set(ALPHA_TASKS.map(taskIdOf)));
    expect(rows.map((r) => r.task.task_id)).not.toContain(taskIdOf(19));
    expect(counts).toEqual({ overdue: 0, week: 2, open: 7 });
  });

  it("counts move with the Riyadh date", async () => {
    const { counts } = await listMyWork({ ctx: ctxFor(SECRETARY), reader: createFakeMyWork(), now: NOV9 });
    expect(counts).toEqual({ overdue: 3, week: 3, open: 7 });
  });

  it("never lists another persona's task, nor a task in a case the persona may not see", async () => {
    for (const [who, persona] of [
      [SECRETARY, ALPHA],
      [INVESTIGATOR_BETA, BETA],
      [INVESTIGATOR_GAMMA, GAMMA],
    ] as const) {
      const reader = createFakeMyWork();
      const { rows } = await listMyWork({ ctx: ctxFor(who), reader, now: OCT31 });
      const own = new Set(reader.rows.filter((r) => r.assignee === persona).map((r) => taskIdOf(r.n)));
      for (const r of rows) expect(own.has(r.task.task_id)).toBe(true);
    }
    const gamma = await listMyWork({
      ctx: ctxFor(INVESTIGATOR_GAMMA),
      reader: createFakeMyWork(),
      now: OCT31,
    });
    expect(gamma.rows.map((r) => r.task.case_id)).not.toContain(caseIdOf(9));
    const beta = await listMyWork({ ctx: ctxFor(INVESTIGATOR_BETA), reader: createFakeMyWork(), now: OCT31 });
    expect(beta.rows.map((r) => r.task.case_id)).toContain(caseIdOf(9)); // assigned investigator of 0009
  });

  it("the same persona in another workspace sees only that workspace's cases", async () => {
    const elsewhere = id(ALPHA, "GOVERNANCE", ["COMMITTEE_SECRETARY"]);
    const { rows } = await listMyWork({ ctx: ctxFor(elsewhere), reader: createFakeMyWork(), now: OCT31 });
    expect(rows).toEqual([]);
  });

  it("a task in a closed case is listed without transitions; terminal statuses offer none", async () => {
    const { rows } = await listMyWork({
      ctx: ctxFor(INVESTIGATOR_GAMMA),
      reader: createFakeMyWork(),
      now: OCT31,
    });
    const closed = rows.find((r) => r.task.task_id === taskIdOf(20));
    expect(closed?.task.case_records_state).toBe("CLOSED");
    expect(closed?.transitions).toEqual([]);
    expect(closed?.deadline.kind).toBe("overdue");
    expect(TASK_TRANSITIONS.DONE).toEqual([]);
    expect(TASK_TRANSITIONS.CANCELLED).toEqual([]);
    expect(TASK_TRANSITIONS.OPEN).not.toContain("DONE");
  });

  it("refuses before any read when the pre-check denies", async () => {
    const reader = createFakeMyWork();
    const nobody = id(ALPHA, "SECRETARIAT", []);
    await expect(listMyWork({ ctx: ctxFor(nobody), reader, now: OCT31 })).rejects.toBeInstanceOf(AppError);
    expect(reader.calls).toEqual([]);
  });
});

describe("loadMyWork", () => {
  it.each([
    ["overdue", "overdue", 3],
    ["week", "week", 3],
    [undefined, "all", 7],
    ["bogus", "all", 7],
    [["overdue"], "all", 7],
  ])("filter %j → %s (%i rows)", async (raw, filter, n) => {
    const view = await loadMyWork({ ctx: ctxFor(SECRETARY), reader: createFakeMyWork(), now: NOV9 }, raw);
    expect(view.kind).toBe("list");
    if (view.kind !== "list") return;
    expect(view.filter).toBe(filter);
    expect(view.rows).toHaveLength(n);
    expect(view.counts).toEqual({ overdue: 3, week: 3, open: 7 }); // counts never follow the filter
  });

  it("parseMyWorkFilter accepts only the three filters", () => {
    expect(parseMyWorkFilter("overdue")).toBe("overdue");
    expect(parseMyWorkFilter("OVERDUE")).toBe("all");
    expect(parseMyWorkFilter(42)).toBe("all");
  });

  it("a reader failure becomes a generic error view with the correlation id (logged, no detail)", async () => {
    const broken: MyWorkReader = {
      listMyTasks: async () => {
        throw Object.assign(new Error('relation "secret" does not exist'), { code: "42P01" });
      },
    };
    const view = await loadMyWork({ ctx: ctxFor(SECRETARY), reader: broken }, undefined);
    expect(view).toEqual({ kind: "error", correlationId: CORRELATION });
    expect(logServerError).toHaveBeenCalledWith("my_work_error", CORRELATION, expect.anything());
  });

  it("UNAUTHENTICATED is re-thrown for the sign-in redirect", async () => {
    const reader: MyWorkReader = {
      listMyTasks: async () => {
        throw new AppError("UNAUTHENTICATED");
      },
    };
    await expect(loadMyWork({ ctx: ctxFor(SECRETARY), reader }, undefined)).rejects.toThrow(
      "UNAUTHENTICATED",
    );
  });
});

describe("updateMyTaskStatus", () => {
  const form = (task: number, new_status: unknown, expected_version: unknown = "1") => ({
    task_id: taskIdOf(task),
    new_status,
    expected_version,
  });

  it("updates the persona's own task and answers with the task id only", async () => {
    const command = createFakeMyWork();
    const outcome = await updateMyTaskStatus({ ctx: ctxFor(SECRETARY), command }, form(2, "IN_PROGRESS"));
    expect(outcome).toEqual({ kind: "updated", taskId: taskIdOf(2) });
    expect(command.commands).toEqual([
      { task_id: taskIdOf(2), new_status: "IN_PROGRESS", expected_version: 1 },
    ]);
    expect(command.rows.find((r) => r.n === 2)?.version).toBe(2);
  });

  it("a persona assigned to the case may change a colleague's task (Alpha, SECRETARY on 0001, Beta's task)", async () => {
    const command = createFakeMyWork();
    const outcome = await updateMyTaskStatus({ ctx: ctxFor(SECRETARY), command }, form(1, "BLOCKED"));
    expect(outcome).toEqual({ kind: "updated", taskId: taskIdOf(1) });
  });

  it("a stale version answers STALE with the correlation id and changes nothing", async () => {
    const command = createFakeMyWork();
    await updateMyTaskStatus({ ctx: ctxFor(SECRETARY), command }, form(2, "IN_PROGRESS"));
    const again = await updateMyTaskStatus({ ctx: ctxFor(SECRETARY), command }, form(2, "BLOCKED", "1"));
    expect(again).toEqual({ kind: "stale", correlationId: CORRELATION });
    expect(command.rows.find((r) => r.n === 2)?.status).toBe("IN_PROGRESS");
    expect(logServerError).toHaveBeenLastCalledWith("task_status_refused", CORRELATION, { code: "STALE" });
  });

  it.each([
    [
      "a task in a visible case where the persona holds no assignment (Delta, 0001)",
      GOVERNANCE,
      1,
      "BLOCKED",
      "NOT_FOUND",
    ],
    ["a task in a case the persona may not see (0009)", INVESTIGATOR_GAMMA, 17, "IN_PROGRESS", "NOT_FOUND"],
    ["a task in another workspace's case (0002 for Alpha)", SECRETARY, 3, "IN_PROGRESS", "NOT_FOUND"],
    ["an unknown task id", SECRETARY, 99, "IN_PROGRESS", "NOT_FOUND"],
    ["a task in a closed case (0010)", INVESTIGATOR_GAMMA, 20, "IN_PROGRESS", "CASE_CLOSED"],
    ["a transition outside the table (OPEN → DONE)", SECRETARY, 2, "DONE", "INVALID_TRANSITION"],
  ] as const)("refuses %s with the generic error", async (_n, who, task, status, code) => {
    const command = createFakeMyWork();
    const before = JSON.stringify(command.rows);
    const outcome = await updateMyTaskStatus({ ctx: ctxFor(who), command }, form(task, status));
    expect(outcome).toEqual({ kind: "error", correlationId: CORRELATION });
    expect(JSON.stringify(command.rows)).toBe(before);
    expect(logServerError).toHaveBeenLastCalledWith("task_status_refused", CORRELATION, { code });
  });

  it.each([
    [
      "a malformed task id",
      { task_id: "CDF-DEMO-2026-0001", new_status: "IN_PROGRESS", expected_version: "1" },
    ],
    [
      "a status outside the catalogue",
      { task_id: taskIdOf(2), new_status: "DELETED", expected_version: "1" },
    ],
    ["no status", { task_id: taskIdOf(2), new_status: null, expected_version: "1" }],
    ["version 0", { task_id: taskIdOf(2), new_status: "IN_PROGRESS", expected_version: "0" }],
    ["a fractional version", { task_id: taskIdOf(2), new_status: "IN_PROGRESS", expected_version: "1.5" }],
    ["a negative version", { task_id: taskIdOf(2), new_status: "IN_PROGRESS", expected_version: "-1" }],
    [
      "a version above int4",
      { task_id: taskIdOf(2), new_status: "IN_PROGRESS", expected_version: "2147483648" },
    ],
    [
      "a numeric (non-form) version",
      { task_id: taskIdOf(2), new_status: "IN_PROGRESS", expected_version: 1 },
    ],
    [
      "a file instead of text",
      { task_id: new Blob(["x"]), new_status: "IN_PROGRESS", expected_version: "1" },
    ],
  ])("refuses %s before the command (VALIDATION, nothing sent)", async (_n, f) => {
    const command = createFakeMyWork();
    const outcome = await updateMyTaskStatus({ ctx: ctxFor(SECRETARY), command }, f);
    expect(outcome).toEqual({ kind: "error", correlationId: CORRELATION });
    expect(command.calls).toEqual([]);
    expect(logServerError).toHaveBeenLastCalledWith("task_status_refused", CORRELATION, {
      code: "VALIDATION",
    });
  });

  it("refuses before parsing or sending when the pre-check denies", async () => {
    const command = createFakeMyWork();
    const outcome = await updateMyTaskStatus(
      { ctx: ctxFor(id(ALPHA, "SECRETARIAT", [])), command },
      form(2, "IN_PROGRESS"),
    );
    expect(outcome).toEqual({ kind: "error", correlationId: CORRELATION });
    expect(command.calls).toEqual([]);
  });

  it("an unexpected failure is generic and logged by code only", async () => {
    const broken: TaskCommandPort = {
      updateStatus: async () => {
        throw Object.assign(new Error("password authentication failed for user x"), { code: "28P01" });
      },
    };
    const outcome = await updateMyTaskStatus(
      { ctx: ctxFor(SECRETARY), command: broken },
      form(2, "IN_PROGRESS"),
    );
    expect(outcome).toEqual({ kind: "error", correlationId: CORRELATION });
    expect(logServerError).toHaveBeenLastCalledWith("task_status_failed", CORRELATION, expect.anything());
  });

  it("every refusal other than STALE has the identical shape (no reason leaks to the user)", async () => {
    const shapes = new Set<string>();
    for (const [who, task, status] of [
      [GOVERNANCE, 1, "BLOCKED"],
      [SECRETARY, 99, "BLOCKED"],
      [INVESTIGATOR_GAMMA, 20, "IN_PROGRESS"],
      [SECRETARY, 2, "DONE"],
      [SECRETARY, 2, "NOPE"],
    ] as const) {
      shapes.add(
        JSON.stringify(
          await updateMyTaskStatus({ ctx: ctxFor(who), command: createFakeMyWork() }, form(task, status)),
        ),
      );
    }
    expect(shapes.size).toBe(1);
  });
});

describe("updateTaskStatus Server Action", () => {
  async function run(
    session: unknown,
    fields: Record<string, string>,
    command: TaskCommandPort = createFakeMyWork(),
  ): Promise<{ to: string; command: TaskCommandPort }> {
    action.session = session;
    action.command = command;
    const real = await vi.importActual<typeof ActionsModule>("@/app/(platform)/my-work/actions");
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    try {
      await real.updateTaskStatus(fd);
    } catch (e) {
      if (e instanceof Redirect) return { to: e.to, command };
      throw e;
    }
    throw new Error("expected a redirect");
  }

  const fields = { task_id: taskIdOf(2), new_status: "IN_PROGRESS", expected_version: "1" };

  it("without a session: sign-in, and the command is never called", async () => {
    const command = createFakeMyWork();
    const { to } = await run(null, fields, command);
    expect(to).toBe("/sign-in");
    expect(command.calls).toEqual([]);
  });

  it("success, stale and refusal redirect with an outcome flag only", async () => {
    const session = ctxFor(SECRETARY).session;
    const command = createFakeMyWork();
    expect((await run(session, fields, command)).to).toBe(`/my-work?updated=${taskIdOf(2)}`);
    expect((await run(session, fields, command)).to).toMatch(/^\/my-work\?stale=[0-9a-f-]{36}$/);
    expect(
      (await run(session, { ...fields, task_id: taskIdOf(3), expected_version: "1" }, command)).to,
    ).toMatch(/^\/my-work\?ref=[0-9a-f-]{36}$/);
  });
});

// --- Markup --------------------------------------------------------------------------------------------------------

async function render(view: MyWorkView, locale: Locale = "ar"): Promise<string> {
  const { MyWorkTable } = await import("@/app/(platform)/my-work/_components/MyWorkView");
  if (view.kind !== "list") throw new Error("list view expected");
  return renderToStaticMarkup(<MyWorkTable t={createTranslator(locale)} locale={locale} view={view} />);
}

const viewFor = async (who = SECRETARY, raw: unknown = undefined, now = NOV9) =>
  loadMyWork({ ctx: ctxFor(who), reader: createFakeMyWork(), now }, raw);

describe("MyWorkTable markup", () => {
  it("has the S1 test ids, counts as data-count text and one row per task", async () => {
    const html = await render(await viewFor());
    expect(html).toContain('data-testid="my-work-table"');
    expect(html).toMatch(/data-testid="count-my-work-overdue"[^>]*data-count="3"/);
    expect(html).toMatch(/data-testid="count-my-work-due-week"[^>]*data-count="3"/);
    expect(html).toMatch(/data-testid="count-my-work-open"[^>]*data-count="7"/);
    expect(html.match(/data-testid="my-work-row-/g)).toHaveLength(7);
    expect(html).toContain(`data-case-id="${caseIdOf(1)}"`);
    expect(html).toContain('data-case-ref="CDF-DEMO-2026-0001"');
    expect(html).toContain(`href="/cases/${caseIdOf(1)}/tasks"`);
    expect(html).toContain('<th scope="row">');
    // Counts are never badges.
    expect(html).not.toMatch(/data-testid="count-my-work-[^"]*"[^>]*data-epistemic/);
  });

  it("a recorded status names its event; an untouched OPEN carries no epistemic claim", async () => {
    const html = await render(await viewFor());
    const row = (n: number) => {
      const start = html.indexOf(`data-testid="my-work-row-${taskIdOf(n)}"`);
      return html.slice(start, html.indexOf("</tr>", start));
    };
    expect(row(5)).toContain('data-epistemic="recorded"');
    expect(row(5)).toContain(`data-event-id="${taskEventIdOf(5)}"`);
    expect(row(5)).toContain('data-status-kind="task"');
    expect(row(2)).toContain('data-task-status="OPEN"');
    expect(row(2)).not.toContain("data-epistemic");
    expect(row(2)).not.toContain("data-event-id");
  });

  it("the form offers only the allowed transitions and sends the row version", async () => {
    const html = await render(await viewFor());
    const start = html.indexOf(`data-testid="task-status-update-${taskIdOf(8)}"`); // BLOCKED
    const form = html.slice(start, html.indexOf("</details>", start));
    const offered = [...form.matchAll(/<option value="([A-Z_]+)"/g)].map((m) => m[1]);
    expect(offered).toEqual([...TASK_TRANSITIONS.BLOCKED]);
    expect(form).toContain('name="expected_version" value="1"');
    expect(form).toContain(`name="task_id" value="${taskIdOf(8)}"`);
    expect(form).not.toContain('value="BLOCKED"');
  });

  it("a closed case's task has no form", async () => {
    const html = await render(await viewFor(INVESTIGATOR_GAMMA));
    expect(html).toContain(`data-testid="task-status-closed-${taskIdOf(20)}"`);
    expect(html).not.toContain(`data-testid="task-status-update-${taskIdOf(20)}"`);
  });

  it("deadlines are words plus the date, in Arabic digits for Arabic", async () => {
    const ar = await render(await viewFor());
    expect(ar).toContain('data-deadline="overdue"');
    expect(ar).toContain('dateTime="2026-11-03"');
    expect(ar).toMatch(/[٠-٩]/);
    const en = await render(await viewFor(), "en");
    expect(en).toContain("Overdue (was due 6 days ago)");
    expect(en).toContain("Due in 1 day");
  });

  it("filter marks the current count and offers 'show all'; an empty filter has its own text", async () => {
    const html = await render(await viewFor(SECRETARY, "overdue"), "en");
    expect(html).toMatch(
      /aria-current="page"[^>]*>|data-testid="count-my-work-overdue"[^>]*aria-current="page"/,
    );
    expect(html).toContain('data-testid="my-work-filter-all"');
    const empty = await render(await viewFor(SECRETARY, "overdue", OCT31), "en");
    expect(empty).toContain('data-testid="my-work-empty"');
    expect(empty).toContain("No tasks in this view.");
  });

  it("an identity with no tasks gets the empty state", async () => {
    const html = await render(await viewFor(GOVERNANCE, undefined, OCT31), "en");
    // Delta's only task (0008) is visible in Governance, so use a workspace with none.
    expect(html).toContain('data-testid="my-work-table"');
    const none = await render(await viewFor(id(BETA, "GOVERNANCE", ["INVESTIGATOR"])), "en");
    expect(none).toContain('data-testid="my-work-empty"');
    expect(none).toContain("You have no open tasks in this workspace.");
  });
});
