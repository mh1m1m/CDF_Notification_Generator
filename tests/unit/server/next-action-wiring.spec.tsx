// V13-FE-015 (REQ-IA-009): the Case Workspace overview's Next Action Card, wired to PROC-026's nextActionForCase over
// the FIRST page of the persona's own open tasks (FE-014, DB-022), whatever page of that list the URL shows (ARCH
// rulings, 1 Nov). The card's link is the overview URL with no paging parameters at the row anchor `#task-<id>`, built
// by the wiring from the task id; the overview's own list carries that anchor. NONE renders nothing. Synthetic only.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CaseTask, ProceduralRecordsReader } from "@/lib/contracts";
import { createTranslator, type Locale } from "@/lib/i18n";
import { CaseWorkspace } from "@/app/(platform)/cases/[caseId]/_components/CaseWorkspace";
import { FIRST_PAGE, parseListPage, type ParsedListPage } from "@/lib/server/case-list-paging";
import {
  loadCaseWorkspace,
  nextActionHref,
  type CaseTab,
  type CaseWorkspaceView,
} from "@/lib/server/case-workspace";
import * as nextAction from "@/lib/domain/next-action";
import { caseIdOf, createFakeCaseSource } from "./support/fake-case-source";
import {
  caseTaskId,
  createFakeNotificationRecords,
  createFakeProceduralRecords,
  withPages,
} from "./support/fake-records";
import { ctxFor, GOVERNANCE, SECRETARY } from "./support/identities";

vi.mock("@/lib/domain/next-action", async (importOriginal) => {
  const actual = await importOriginal<typeof nextAction>();
  return { ...actual, nextActionForCase: vi.fn(actual.nextActionForCase) };
});

const C1 = caseIdOf(1);
/** 2026-11-01 08:00 in Riyadh. */
const NOW = () => new Date("2026-11-01T05:00:00Z");

type Calls = string[];
/** A reader whose own open tasks on every case are `mine` (in the database's order), recording each read. */
function reader(mine: readonly CaseTask[], calls: Calls): ProceduralRecordsReader {
  const base = createFakeProceduralRecords();
  const r = withPages({
    listEvents: (i, c) => base.listEvents(i, c),
    listTasks: async (_i, c) => mine.map((t) => ({ ...t, case_id: c })),
  });
  return {
    ...r,
    listMyOpenTasksPage: (i, c, p) => {
      calls.push(`listMyOpenTasksPage:${p.limit}:${p.cursor ?? ""}`);
      return r.listMyOpenTasksPage(i, c, p);
    },
  };
}

const task = (n: number, extra: Partial<CaseTask> = {}): CaseTask => ({
  id: caseTaskId(1, n),
  case_id: C1,
  task_code: `TASK_${String(n).padStart(3, "0")}`,
  title: { ar: `مهمة ${n}`, en: `Task ${n}` },
  assignee_capacity: "SECRETARY",
  is_mine: true,
  status: "OPEN",
  due_date: null,
  row_version: 1,
  status_event_id: null,
  ...extra,
});

async function load(
  tab: CaseTab,
  page: ParsedListPage = FIRST_PAGE,
  procedural: ProceduralRecordsReader = createFakeProceduralRecords(),
  identity = SECRETARY,
  caseIndex = 1,
) {
  return loadCaseWorkspace(
    {
      ctx: ctxFor(identity),
      source: createFakeCaseSource(),
      procedural,
      notifications: createFakeNotificationRecords(),
      page,
      now: NOW,
    },
    caseIdOf(caseIndex),
    tab,
  );
}
const html = (v: CaseWorkspaceView, locale: Locale = "ar") =>
  renderToStaticMarkup(<CaseWorkspace t={createTranslator(locale)} locale={locale} view={v} />);
const card = (v: CaseWorkspaceView) => (v.tab === "overview" ? v.nextAction : undefined);

describe("Next Action Card wiring (FE-015)", () => {
  it("first page: the card is the first own open task, from the rows already read (no extra read)", async () => {
    const calls: Calls = [];
    const v = await load("overview", FIRST_PAGE, reader([task(1), task(2), task(3)], calls));
    expect(card(v)?.task.id).toBe(caseTaskId(1, 1));
    expect(v.tab === "overview" && v.myTasks[0]?.id).toBe(caseTaskId(1, 1));
    expect(calls).toEqual(["listMyOpenTasksPage:25:"]);
  });

  it("the href is the overview with no paging parameters at #task-<id>, built from the task id", async () => {
    const v = await load("overview", FIRST_PAGE, reader([task(7)], []));
    expect(card(v)?.href).toBe(`/cases/${C1}#task-${caseTaskId(1, 7)}`);
    expect(nextActionHref(C1, caseTaskId(1, 7))).toBe(`/cases/${C1}#task-${caseTaskId(1, 7)}`);
    const markup = html(v);
    expect(markup).toContain(`href="/cases/${C1}#task-${caseTaskId(1, 7)}" data-testid="next-action-link"`);
    expect(markup).not.toMatch(/data-testid="next-action-link"[^>]*(after|back)=/);
    expect(markup).not.toMatch(/href="[^"]*[?&](after|back)=[^"]*" data-testid="next-action-link"/);
  });

  it("the overview's own list carries the row anchor the card links to; the Tasks tab carries none", async () => {
    const v = await load("overview", FIRST_PAGE, reader([task(1), task(2)], []));
    const markup = html(v);
    expect(markup).toContain(`<span id="task-${caseTaskId(1, 1)}">مهمة 1</span>`);
    expect(markup).toContain(`<span id="task-${caseTaskId(1, 2)}">مهمة 2</span>`);
    expect(markup.match(/id="task-/g)).toHaveLength(2);
    // the card is first in the overview, above the stage card
    expect(markup.indexOf('data-testid="next-action-card"')).toBeLessThan(
      markup.indexOf('data-testid="case-overview-stage"'),
    );
    expect(html(await load("tasks", FIRST_PAGE, reader([task(1)], [])))).not.toContain('id="task-');
  });

  it("page 2 of the own tasks shows the same card as page 1, from one extra first-page read", async () => {
    const many = Array.from({ length: 60 }, (_, k) => task(10 + k));
    const calls: Calls = [];
    const first = await load("overview", FIRST_PAGE, reader(many, calls));
    const next = first.tab === "overview" ? first.paging.nextHref : null;
    expect(next).not.toBeNull();
    calls.length = 0;
    const second = await load(
      "overview",
      parseListPage(Object.fromEntries(new URL(next!, "http://x").searchParams)),
      reader(many, calls),
    );
    expect(second.tab === "overview" && second.myTasks[0]?.id).toBe(caseTaskId(1, 35));
    expect(card(second)).toEqual(card(first));
    expect(card(second)?.task.id).toBe(caseTaskId(1, 10));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/^listMyOpenTasksPage:25:.+/);
    expect(calls[1]).toBe("listMyOpenTasksPage:25:");
    const markup = html(second);
    expect(markup).toContain(`href="/cases/${C1}#task-${caseTaskId(1, 10)}" data-testid="next-action-link"`);
  });

  it("a tampered or refused page still shows the first page's card (the list itself is empty)", async () => {
    for (const page of [
      { ok: false } as const,
      { ok: true, query: { after: "Zm9yZ2Vk", trail: [""] } } as const,
    ]) {
      const v = await load("overview", page, reader([task(1), task(2)], []));
      expect(v.tab === "overview" && v.myTasks).toEqual([]);
      expect(card(v)?.task.id).toBe(caseTaskId(1, 1));
    }
  });

  it("the due date and its day count from today in Asia/Riyadh; none recorded, no due line", async () => {
    const withDue = await load("overview", FIRST_PAGE, reader([task(1, { due_date: "2026-11-04" })], []));
    expect(card(withDue)?.due).toEqual({ date: "2026-11-04", days: 3 });
    expect(html(withDue)).toContain('data-testid="next-action-due"');
    const overdue = await load("overview", FIRST_PAGE, reader([task(1, { due_date: "2026-10-30" })], []));
    expect(card(overdue)?.due).toEqual({ date: "2026-10-30", days: -2 });
    const none = await load("overview", FIRST_PAGE, reader([task(1)], []));
    expect(card(none)?.due).toBeNull();
    expect(html(none)).not.toContain('data-testid="next-action-due"');
  });

  it("the status is the Tasks tab's rendering (label and recorded badge)", async () => {
    const v = await load(
      "overview",
      FIRST_PAGE,
      reader(
        [task(1, { status: "IN_PROGRESS", status_event_id: "0e000000-0000-4000-8000-000001000002" })],
        [],
      ),
    );
    const markup = html(v, "en");
    const status = markup.match(/<dd data-testid="next-action-status">[\s\S]*?<\/dd>/)?.[0] ?? "";
    expect(status).toContain('data-task-status="IN_PROGRESS"');
    expect(status).toContain("In progress");
  });

  it("passes exactly the four CaseHeader fields, the capacity and the first page's rows (SEC INFO on #130)", async () => {
    const spy = vi.mocked(nextAction.nextActionForCase);
    spy.mockClear();
    const rows = [task(1), task(2)];
    await load("overview", FIRST_PAGE, reader(rows, []));
    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0]![0] as {
      case: Record<string, unknown>;
      capacity: unknown;
      records: { tasks: readonly CaseTask[] };
    };
    expect(Object.keys(input).sort()).toEqual(["capacity", "case", "records"]);
    expect(Object.keys(input.case).sort()).toEqual([
      "case_id",
      "is_restricted",
      "my_capacity",
      "records_state",
    ]);
    expect(input.case.case_id).toBe(C1);
    expect(input.capacity).toBe(input.case.my_capacity);
    expect(input.records.tasks.map((t) => t.id)).toEqual(rows.map((t) => t.id));
  });

  it("NONE renders nothing: no own open task, a closed case, another persona", async () => {
    for (const v of [
      await load("overview", FIRST_PAGE, reader([], [])),
      await load("overview", FIRST_PAGE, reader([task(1)], []), SECRETARY, 10),
    ]) {
      expect(card(v)).toBeNull();
      const markup = html(v);
      expect(markup).not.toContain("next-action");
      expect(markup).not.toContain('id="next-action-heading"');
    }
    // the shared fakes: Delta has no own open task on 0001 (Alpha's task there is not Delta's)
    const delta = await load("overview", FIRST_PAGE, createFakeProceduralRecords(), GOVERNANCE, 1);
    expect(card(delta)).toBeNull();
  });

  it("other tabs never compute a card", async () => {
    const spy = vi.mocked(nextAction.nextActionForCase);
    spy.mockClear();
    for (const tab of ["events", "tasks", "notifications"] as const) await load(tab);
    expect(spy).not.toHaveBeenCalled();
  });
});
