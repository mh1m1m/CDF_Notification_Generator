// V13-FE-013 (OI-026): paging of the Case Workspace's Events, Tasks and Notifications tabs. URL state as the portfolio
// (after + a bounded back trail), previous / next links, one bounded page read only after the route's case passed the
// pre-check, no count or total. Negatives: a tampered URL (repeated, malformed, a trail without a cursor) and a cursor
// the reader refuses show the tab's empty state with a link to the first page and never an error, nothing is read
// with a tampered URL, another failure still propagates. Synthetic data only.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CASE_RECORDS_PAGE_SIZE,
  InvalidCursorError,
  type CaseNotification,
  type NotificationRecordsReader,
  type ProceduralRecordsReader,
} from "@/lib/contracts";
import { createTranslator } from "@/lib/i18n";
import { CaseWorkspace } from "@/app/(platform)/cases/[caseId]/_components/CaseWorkspace";
import {
  FIRST_PAGE,
  listPaging,
  pageSearch,
  parseListPage,
  type ParsedListPage,
} from "@/lib/server/case-list-paging";
import { loadCaseWorkspace, type CaseTab, type CaseWorkspaceView } from "@/lib/server/case-workspace";
import { MAX_TRAIL } from "@/lib/server/portfolio-query";
import { caseIdOf, createFakeCaseSource } from "./support/fake-case-source";
import {
  caseEventId,
  caseNotificationId,
  caseTaskId,
  createFakeNotificationRecords,
  createFakeProceduralRecords,
  withNotificationPages,
  withPages,
} from "./support/fake-records";
import { ctxFor, SECRETARY } from "./support/identities";

const logServerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/errors", () => ({ logServerError }));

const C1 = caseIdOf(1);
const PATH = (tab: string) => `/cases/${C1}/${tab}`;
const A = "QUFB";
const B = "QkJC";

describe("parseListPage", () => {
  it("no parameters, or none of its own, is the first page", () => {
    expect(parseListPage(undefined)).toEqual(FIRST_PAGE);
    expect(parseListPage({})).toEqual({ ok: true, query: { trail: [] } });
    expect(parseListPage({ n: "x", after: "" })).toEqual({ ok: true, query: { trail: [] } });
  });

  it("a cursor and its trail ('~' is the first page)", () => {
    expect(parseListPage({ after: B, back: `~.${A}` })).toEqual({
      ok: true,
      query: { after: B, trail: ["", A] },
    });
  });

  it.each([
    ["a repeated after", { after: [A, B] }],
    ["a repeated back", { after: A, back: ["~", "~"] }],
    ["a malformed cursor", { after: "a.b" }],
    ["a cursor with SQL", { after: "x' or 1=1" }],
    ["an over-long cursor", { after: "A".repeat(513) }],
    ["a malformed trail entry", { after: A, back: "~.a$b" }],
    ["a trail without a cursor", { back: "~" }],
    [
      "a trail longer than the bound",
      { after: A, back: Array.from({ length: MAX_TRAIL + 1 }, () => "~").join(".") },
    ],
  ])("refuses %s (tampered URL)", (_n, params) => {
    expect(parseListPage(params as never)).toEqual({ ok: false });
  });
});

describe("listPaging", () => {
  const ok = (after?: string, trail: string[] = []): ParsedListPage => ({
    ok: true,
    query: { ...(after ? { after } : {}), trail },
  });

  it("first page: next only, carrying the first page in its trail", () => {
    expect(listPaging(PATH("events"), ok(), A)).toEqual({
      prevHref: null,
      nextHref: `${PATH("events")}?after=${A}&back=%7E`,
      search: "",
    });
  });

  it("second page: previous is the first page; third page: previous is the second", () => {
    expect(listPaging(PATH("events"), ok(A, [""]), B)).toEqual({
      prevHref: PATH("events"),
      nextHref: `${PATH("events")}?after=${B}&back=%7E.${A}`,
      search: `after=${A}&back=%7E`,
    });
    expect(listPaging(PATH("events"), ok(B, ["", A]), null).prevHref).toBe(
      `${PATH("events")}?after=${A}&back=%7E`,
    );
  });

  it("the last page has no next; a single page has neither", () => {
    expect(listPaging(PATH("tasks"), ok(), null)).toEqual({ prevHref: null, nextHref: null, search: "" });
  });

  it("the trail stays within its bound", () => {
    const long = Array.from({ length: MAX_TRAIL }, () => A);
    const next = new URL(listPaging(PATH("tasks"), ok(B, long), A).nextHref!, "http://x");
    expect(next.searchParams.get("back")!.split(".")).toHaveLength(MAX_TRAIL);
  });

  it("a tampered page links back to the first page and offers no next", () => {
    expect(listPaging(PATH("tasks"), { ok: false }, A)).toEqual({
      prevHref: PATH("tasks"),
      nextHref: null,
      search: "",
    });
  });

  it("never links a next cursor of another shape", () => {
    expect(listPaging(PATH("tasks"), ok(), "a.b").nextHref).toBeNull();
  });

  it("pageSearch keeps a page in a link", () => {
    expect(pageSearch()).toBe("");
    expect(pageSearch(A, ["", B])).toBe(`after=${A}&back=%7E.${B}`);
  });
});

// Readers with many rows on case 0001 (Alpha visible), paged by the fakes' own cursor.
function manyRecords(n: number) {
  const base = createFakeProceduralRecords();
  const notes = createFakeNotificationRecords();
  const calls: string[] = [];
  const procedural: ProceduralRecordsReader = withPages({
    listEvents: async (i, c) => {
      const [first] = await base.listEvents(i, c);
      return first ? Array.from({ length: n }, (_, k) => ({ ...first, id: caseEventId(1, 100 + k) })) : [];
    },
    listTasks: async (i, c) => {
      const [, mine] = await base.listTasks(i, c);
      return mine ? Array.from({ length: n }, (_, k) => ({ ...mine, id: caseTaskId(1, 100 + k) })) : [];
    },
  });
  const notifications: NotificationRecordsReader = withNotificationPages({
    listForCase: async (i, c) => {
      const [first] = await notes.listForCase(i, c);
      return first
        ? Array.from({ length: n }, (_, k): CaseNotification => ({
            ...first,
            notification_id: caseNotificationId(1, 100 + k),
          }))
        : [];
    },
  });
  const spy = <R extends object>(r: R): R =>
    Object.fromEntries(
      Object.entries(r).map(([k, f]) => [
        k,
        (...a: unknown[]) => {
          calls.push(k);
          return (f as (...x: unknown[]) => unknown)(...a);
        },
      ]),
    ) as R;
  return { procedural: spy(procedural), notifications: spy(notifications), calls };
}

const LIST_TABS = [
  ["events", (v: CaseWorkspaceView) => (v.tab === "events" ? v.events.map((e) => e.id) : [])],
  ["tasks", (v: CaseWorkspaceView) => (v.tab === "tasks" ? v.tasks.map((t) => t.id) : [])],
  [
    "notifications",
    (v: CaseWorkspaceView) =>
      v.tab === "notifications" ? v.notifications.map((n) => n.notification_id) : [],
  ],
] as const;
const pagingOf = (v: CaseWorkspaceView) =>
  v.tab === "events" || v.tab === "tasks" || v.tab === "notifications" ? v.paging : null;

async function load(tab: CaseTab, page: ParsedListPage, r = manyRecords(60), identity = SECRETARY) {
  return loadCaseWorkspace({ ctx: ctxFor(identity), source: createFakeCaseSource(), ...r, page }, C1, tab);
}

describe("paged Case Workspace tabs", () => {
  it.each(LIST_TABS)("%s: 25 rows a page, next / previous walk every row once in order", async (tab, ids) => {
    const r = manyRecords(60);
    const seen: string[] = [];
    let v = await load(tab, FIRST_PAGE, r);
    const first = pagingOf(v)!;
    expect(ids(v)).toHaveLength(CASE_RECORDS_PAGE_SIZE);
    expect(first.prevHref).toBeNull();
    seen.push(...ids(v));
    let next = first.nextHref;
    const pages: string[] = [];
    while (next) {
      pages.push(next);
      const url = new URL(next, "http://x");
      expect(url.pathname).toBe(PATH(tab));
      v = await load(tab, parseListPage(Object.fromEntries(url.searchParams)), r);
      seen.push(...ids(v));
      next = pagingOf(v)!.nextHref;
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    expect(ids(v)).toHaveLength(10);
    // previous from page 3 is page 2, from page 2 the first page
    expect(pagingOf(v)!.prevHref).toBe(pages[0]);
    const page2 = await load(
      tab,
      parseListPage(Object.fromEntries(new URL(pages[0]!, "http://x").searchParams)),
      r,
    );
    expect(pagingOf(page2)!.prevHref).toBe(PATH(tab));
  });

  it.each(LIST_TABS)(
    "%s: a tampered URL shows the empty state, links to the first page, reads nothing",
    async (tab, ids) => {
      const r = manyRecords(60);
      const v = await load(tab, { ok: false }, r);
      expect(ids(v)).toEqual([]);
      expect(pagingOf(v)).toEqual({ prevHref: PATH(tab), nextHref: null, search: "" });
      expect(r.calls).toEqual([]);
      const out = renderToStaticMarkup(<CaseWorkspace t={createTranslator("en")} locale="en" view={v} />);
      expect(out).toContain(`data-testid="case-${tab}-empty"`);
      expect(out).toContain(`data-testid="case-${tab}-prev"`);
      expect(out).not.toContain(`data-testid="case-${tab}-next"`);
      expect(out).not.toContain('data-testid="case-error"');
    },
  );

  it.each(LIST_TABS)(
    "%s: a cursor the reader refuses (forged, another list's) shows the empty state, never an error",
    async (tab, ids) => {
      for (const after of [
        "Zm9yZ2Vk",
        Buffer.from(JSON.stringify({ k: "other", n: 25 })).toString("base64url"),
      ]) {
        const v = await load(tab, { ok: true, query: { after, trail: [""] } });
        expect(ids(v)).toEqual([]);
        expect(pagingOf(v)).toEqual({ prevHref: PATH(tab), nextHref: null, search: "" });
      }
    },
  );

  it("any other failure of a page read still propagates (generic error view)", async () => {
    const r = manyRecords(3);
    const broken = { ...r.procedural, listEventsPage: () => Promise.reject(new Error("boom")) };
    await expect(
      loadCaseWorkspace(
        {
          ctx: ctxFor(SECRETARY),
          source: createFakeCaseSource(),
          ...r,
          procedural: broken,
          page: FIRST_PAGE,
        },
        C1,
        "events",
      ),
    ).rejects.toThrow("boom");
    const refuse = {
      ...r.procedural,
      listEventsPage: () => Promise.reject(new InvalidCursorError("bad cursor")),
    };
    const v = await loadCaseWorkspace(
      { ctx: ctxFor(SECRETARY), source: createFakeCaseSource(), ...r, procedural: refuse, page: FIRST_PAGE },
      C1,
      "events",
    );
    expect(v.tab === "events" && v.events).toEqual([]);
  });

  it("a page of a case the persona may not see is NOT_FOUND before any page is read", async () => {
    const r = manyRecords(60);
    for (const [tab] of LIST_TABS) {
      await expect(
        loadCaseWorkspace(
          {
            ctx: ctxFor(SECRETARY),
            source: createFakeCaseSource(),
            ...r,
            page: { ok: true, query: { after: A, trail: [""] } },
          },
          caseIdOf(2),
          tab,
        ),
      ).rejects.toThrow();
    }
    expect(r.calls).toEqual([]);
  });
});

// V13-FE-014 (DB-022, OI-054): the overview's own open tasks are pages of case_my_open_tasks_page; its last five
// events are one unpaged page of five whatever the URL says.
describe("the overview's own open tasks", () => {
  const OVERVIEW = `/cases/${C1}`;
  const mine = (v: CaseWorkspaceView) => (v.tab === "overview" ? v.myTasks.map((t) => t.id) : []);
  const pagingOfOverview = (v: CaseWorkspaceView) => (v.tab === "overview" ? v.paging : null);

  it("reads one page of five events and one page of own open tasks; never the whole task list", async () => {
    const r = manyRecords(60);
    const v = await load("overview", FIRST_PAGE, r);
    expect(v.tab === "overview" && v.events).toHaveLength(5);
    expect(mine(v)).toHaveLength(CASE_RECORDS_PAGE_SIZE);
    expect(r.calls).toEqual(["listEventsPage", "listMyOpenTasksPage"]);
    expect(r.calls).not.toContain("listTasks");
    expect(r.calls).not.toContain("listTasksPage");
  });

  it("25 rows a page, next / previous walk every own open task once in order; events stay five", async () => {
    const r = manyRecords(60);
    const seen: string[] = [];
    let v = await load("overview", FIRST_PAGE, r);
    expect(pagingOfOverview(v)!.prevHref).toBeNull();
    seen.push(...mine(v));
    let next = pagingOfOverview(v)!.nextHref;
    const pages: string[] = [];
    while (next) {
      pages.push(next);
      const url = new URL(next, "http://x");
      expect(url.pathname).toBe(OVERVIEW);
      v = await load("overview", parseListPage(Object.fromEntries(url.searchParams)), r);
      expect(v.tab === "overview" && v.events).toHaveLength(5);
      seen.push(...mine(v));
      next = pagingOfOverview(v)!.nextHref;
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    expect(pagingOfOverview(v)!.prevHref).toBe(pages[0]);
  });

  it("a tampered URL or a refused cursor: no own task rows, a first-page link, the events still shown", async () => {
    for (const page of [
      { ok: false } as const,
      { ok: true, query: { after: "Zm9yZ2Vk", trail: [""] } } as const,
      {
        ok: true,
        query: {
          after: Buffer.from(JSON.stringify({ k: "tasks", n: 25 })).toString("base64url"),
          trail: [""],
        },
      } as const,
    ]) {
      const r = manyRecords(60);
      const v = await load("overview", page, r);
      expect(mine(v)).toEqual([]);
      expect(v.tab === "overview" && v.events).toHaveLength(5);
      expect(pagingOfOverview(v)).toEqual({ prevHref: OVERVIEW, nextHref: null, search: "" });
      const out = renderToStaticMarkup(<CaseWorkspace t={createTranslator("en")} locale="en" view={v} />);
      expect(out).toContain('data-testid="case-my-tasks-empty"');
      expect(out).toContain('data-testid="case-my-tasks-prev"');
      expect(out).not.toContain('data-testid="case-my-tasks-next"');
      expect(out).not.toContain('data-testid="case-error"');
    }
  });

  it("pager markup: a labelled nav under the own tasks, none on a single page", async () => {
    const many = renderToStaticMarkup(
      <CaseWorkspace t={createTranslator("ar")} locale="ar" view={await load("overview", FIRST_PAGE)} />,
    );
    expect(many).toMatch(/<nav aria-label="صفحات القائمة"[^>]*data-testid="case-my-tasks-pagination"/);
    expect(many).toMatch(/<a[^>]*rel="next"[^>]*data-testid="case-my-tasks-next"[^>]*>التالي<\/a>/);
    const one = renderToStaticMarkup(
      <CaseWorkspace
        t={createTranslator("en")}
        locale="en"
        view={await load("overview", FIRST_PAGE, manyRecords(3))}
      />,
    );
    expect(one).toContain('data-testid="case-my-tasks"');
    expect(one).not.toContain("case-my-tasks-pagination");
  });
});

describe("pager markup", () => {
  it.each(LIST_TABS)("%s: a labelled nav with previous / next links, none on a single page", async (tab) => {
    const r = manyRecords(60);
    const firstOut = renderToStaticMarkup(
      <CaseWorkspace t={createTranslator("ar")} locale="ar" view={await load(tab, FIRST_PAGE, r)} />,
    );
    expect(firstOut).toMatch(
      new RegExp(`<nav aria-label="صفحات القائمة"[^>]*data-testid="case-${tab}-pagination"`),
    );
    expect(firstOut).toMatch(
      new RegExp(`<a[^>]*rel="next"[^>]*data-testid="case-${tab}-next"[^>]*>التالي</a>`),
    );
    expect(firstOut).not.toContain(`data-testid="case-${tab}-prev"`);
    // no count or total in the pager: none is read
    const nav = firstOut.match(new RegExp(`<nav[^>]*case-${tab}-pagination[\\s\\S]*?</nav>`))?.[0] ?? "";
    expect(nav).not.toBe("");
    expect(nav).not.toContain("data-count");
    expect(nav.replace(/<[^>]*>/g, "")).not.toMatch(/[0-9\u0660-\u0669]/);
    const single = renderToStaticMarkup(
      <CaseWorkspace
        t={createTranslator("en")}
        locale="en"
        view={await load(tab, FIRST_PAGE, manyRecords(3))}
      />,
    );
    expect(single).not.toContain(`case-${tab}-pagination`);
  });

  it("on a later page of notifications, preview links and the preview's close link keep the page", async () => {
    const r = manyRecords(60);
    const first = await load("notifications", FIRST_PAGE, r);
    const next = new URL(pagingOf(first)!.nextHref!, "http://x");
    const v = await load("notifications", parseListPage(Object.fromEntries(next.searchParams)), r);
    if (v.tab !== "notifications") throw new Error(v.tab);
    const out = renderToStaticMarkup(<CaseWorkspace t={createTranslator("en")} locale="en" view={v} />);
    const id = v.notifications[0]!.notification_id;
    expect(out).toContain(
      `href="/cases/${C1}/notifications?${v.paging.search.replace(/&/g, "&amp;")}&amp;n=${id}"`,
    );
    const withPreview: CaseWorkspaceView = {
      ...v,
      preview: { kind: "unavailable", correlationId: "11111111-1111-4111-8111-111111111111" },
    };
    const closeOut = renderToStaticMarkup(
      <CaseWorkspace t={createTranslator("en")} locale="en" view={withPreview} />,
    );
    expect(closeOut).toContain(
      `data-testid="case-preview-close" href="/cases/${C1}/notifications?${v.paging.search.replace(/&/g, "&amp;")}"`,
    );
  });
});
