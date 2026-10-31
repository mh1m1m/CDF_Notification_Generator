// FE-004 Case Workspace: loader (the URL's case id is the only context; every negative is NOT_FOUND before any V13
// record is read), generic errors with the correlation id, and markup (S3 test ids, ADR-013 attributes, recorded task
// statuses name their event, nothing from another case). Fake adapters; the SQL adapter is covered in
// v13-case-records-adapter.spec.ts and, against the database, in tests/integration/fe.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NotificationRecordsReader, ProceduralRecordsReader } from "@/lib/contracts";
import { createTranslator, type Locale } from "@/lib/i18n";
import {
  CASE_TABS,
  loadCaseWorkspace,
  resolveCaseWorkspace,
  type CaseTab,
  type CaseWorkspaceView,
} from "@/lib/server/case-workspace";
import { AppError } from "@/lib/server/errors";
import {
  CaseErrorState,
  CaseWorkspace,
  tabHref,
} from "@/app/(platform)/cases/[caseId]/_components/CaseWorkspace";
import { caseIdOf, createFakeCaseSource } from "./support/fake-case-source";
import {
  caseEventId,
  caseTaskId,
  createFakeNotificationRecords,
  createFakeProceduralRecords,
} from "./support/fake-records";
import {
  CORRELATION,
  ctxFor,
  EPSILON,
  GOVERNANCE,
  GOVERNANCE_AT_SECRETARIAT,
  id,
  INVESTIGATOR_BETA,
  INVESTIGATOR_GAMMA,
  SECRETARY,
} from "./support/identities";

const logServerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/errors", () => ({ logServerError }));

function deps(
  identity = SECRETARY,
  procedural: ProceduralRecordsReader = createFakeProceduralRecords(),
  notifications: NotificationRecordsReader = createFakeNotificationRecords(),
) {
  return { ctx: ctxFor(identity), source: createFakeCaseSource(), procedural, notifications };
}

async function view(tab: CaseTab, i = 1, identity = SECRETARY): Promise<CaseWorkspaceView> {
  return loadCaseWorkspace(deps(identity), caseIdOf(i), tab);
}

function html(v: CaseWorkspaceView, locale: Locale = "ar"): string {
  return renderToStaticMarkup(<CaseWorkspace t={createTranslator(locale)} locale={locale} view={v} />);
}

const attrs = (markup: string, name: string): string[] =>
  [...markup.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]!);

describe("loadCaseWorkspace", () => {
  it("overview: the case, the persona's capacity, the last events newest first and own open tasks", async () => {
    const v = await view("overview");
    if (v.tab !== "overview") throw new Error("wrong tab");
    expect(v.summary.case_id).toBe(caseIdOf(1));
    expect(v.capacity).toBe("SECRETARY");
    expect(v.events.map((e) => e.event_code)).toEqual(["TASK_STATUS_CHANGED", "CASE_OPENED"]);
    expect(v.myTasks.map((t) => t.id)).toEqual([caseTaskId(1, 2)]);
  });

  it("overview shows at most five events and only own tasks that are still open", async () => {
    const many = createFakeProceduralRecords();
    const base = await many.listEvents(SECRETARY, caseIdOf(1));
    const records: ProceduralRecordsReader = {
      listEvents: async () =>
        Array.from({ length: 7 }, (_, k) => ({ ...base[0]!, id: caseEventId(1, 10 + k) })),
      listTasks: async () => {
        const [lead, mine] = await many.listTasks(SECRETARY, caseIdOf(1));
        return [
          mine!,
          { ...mine!, id: caseTaskId(1, 3), status: "DONE" as const, status_event_id: caseEventId(1, 2) },
          { ...mine!, id: caseTaskId(1, 4), status: "BLOCKED" as const, status_event_id: caseEventId(1, 2) },
          lead!,
        ];
      },
    };
    const v = await loadCaseWorkspace(deps(SECRETARY, records), caseIdOf(1), "overview");
    if (v.tab !== "overview") throw new Error("wrong tab");
    expect(v.events).toHaveLength(5);
    expect(v.myTasks.map((t) => t.id)).toEqual([caseTaskId(1, 2), caseTaskId(1, 4)]);
  });

  it("reads the header once through the case source, then only the tab's own records", async () => {
    for (const [tab, reads] of [
      ["overview", ["listEvents", "listTasks"]],
      ["events", ["listEvents"]],
      ["tasks", ["listTasks"]],
      ["notifications", ["listCaseNotifications"]],
    ] as const) {
      const procedural = createFakeProceduralRecords();
      const notifications = createFakeNotificationRecords();
      const d = deps(SECRETARY, procedural, notifications);
      const v = await loadCaseWorkspace(d, caseIdOf(1), tab);
      expect(v.tab).toBe(tab);
      expect(d.source.calls).toEqual(["getCaseHeader"]);
      expect([...procedural.calls, ...notifications.calls]).toEqual(reads);
    }
  });

  it("a persona with no capacity on a visible case gets null", async () => {
    const v = await view("overview", 2, INVESTIGATOR_BETA);
    expect(v.capacity).toBeNull();
  });

  it("the capacity is not part of the summary handed to the view", async () => {
    const v = await view("overview");
    expect(v.summary).not.toHaveProperty("my_capacity");
  });

  it.each([
    ["unknown case id", SECRETARY, "0c000000-0000-4000-8000-000000000099"],
    ["malformed id", SECRETARY, "CDF-DEMO-2026-0001"],
    ["upper-case uuid", SECRETARY, caseIdOf(1).toUpperCase()],
    ["non-string id", SECRETARY, 1],
    ["case the persona may not see (Alpha, 0002)", SECRETARY, caseIdOf(2)],
    ["restricted case outside the named list (Alpha, 0009)", SECRETARY, caseIdOf(9)],
    ["restricted case outside the named list (Gamma, 0009)", INVESTIGATOR_GAMMA, caseIdOf(9)],
    ["other workspace of the same persona (Delta@GOVERNANCE, 0006)", GOVERNANCE, caseIdOf(6)],
    ["persona with no visible cases", id(EPSILON, "SECRETARIAT", ["COMMITTEE_SECRETARY"]), caseIdOf(1)],
    ["unknown workspace code", id(SECRETARY.persona_id, "NOWHERE", ["COMMITTEE_SECRETARY"]), caseIdOf(1)],
  ])("%s → NOT_FOUND, and no V13 record is read", async (_n, identity, raw) => {
    for (const tab of CASE_TABS) {
      const procedural = createFakeProceduralRecords();
      const notifications = createFakeNotificationRecords();
      await expect(loadCaseWorkspace(deps(identity, procedural, notifications), raw, tab)).rejects.toEqual(
        new AppError("NOT_FOUND"),
      );
      expect([...procedural.calls, ...notifications.calls]).toEqual([]);
    }
  });

  it("the same persona in its other workspace sees the case (Delta@SECRETARIAT, 0006)", async () => {
    const v = await view("overview", 6, GOVERNANCE_AT_SECRETARIAT);
    expect(v.summary.case_id).toBe(caseIdOf(6));
  });

  it("a records failure is not hidden: it propagates from the loader", async () => {
    const records = { ...createFakeProceduralRecords(), listTasks: () => Promise.reject(new Error("boom")) };
    await expect(loadCaseWorkspace(deps(SECRETARY, records), caseIdOf(1), "tasks")).rejects.toThrow("boom");
  });
});

describe("resolveCaseWorkspace", () => {
  it("returns the view", async () => {
    const r = await resolveCaseWorkspace(deps(), caseIdOf(1), "events");
    expect(r.kind).toBe("view");
  });

  it("re-throws NOT_FOUND for the page's notFound()", async () => {
    await expect(resolveCaseWorkspace(deps(), caseIdOf(2), "overview")).rejects.toEqual(
      new AppError("NOT_FOUND"),
    );
  });

  it("turns any other failure into a generic error with the correlation id, logged without detail", async () => {
    logServerError.mockClear();
    const records = {
      ...createFakeProceduralRecords(),
      listEvents: () => Promise.reject(new Error("relation case_event does not exist")),
    };
    const r = await resolveCaseWorkspace(deps(SECRETARY, records), caseIdOf(1), "events");
    expect(r).toEqual({ kind: "error", correlationId: CORRELATION });
    expect(logServerError).toHaveBeenCalledWith("case_workspace_error", CORRELATION, expect.any(Error));
    const markup = renderToStaticMarkup(
      <CaseErrorState t={createTranslator("ar")} correlationId={r.kind === "error" ? r.correlationId : ""} />,
    );
    expect(markup).toContain('data-testid="case-error"');
    expect(markup).toContain(CORRELATION);
    expect(markup).not.toContain("does not exist");
    expect(markup).not.toContain("case_event");
  });
});

describe("Case Workspace markup", () => {
  it("frame: ADR-013 attributes, number, stage, capacity and tab links by UUID", async () => {
    const markup = html(await view("overview"));
    expect(markup).toContain(`data-testid="case-workspace" data-case-id="${caseIdOf(1)}"`);
    expect(markup).toContain('data-case-ref="CDF-DEMO-2026-0001"');
    expect(markup).toContain('data-testid="case-header"');
    expect(markup).toContain('data-testid="case-number"');
    expect(markup).toContain('data-stage="INVESTIGATION"');
    expect(markup).toContain('data-capacity="SECRETARY"');
    expect(markup).toContain("صفتك: أمين سر");
    for (const tab of CASE_TABS) {
      expect(markup).toContain(`href="${tabHref(caseIdOf(1), tab)}"`);
      expect(markup).toContain(`data-testid="case-tab-${tab}"`);
    }
    expect(markup).not.toContain("case-closed-notice");
    expect(markup).not.toContain("case-restricted");
  });

  it("marks only the active tab with aria-current", async () => {
    for (const tab of CASE_TABS) {
      const markup = html(await view(tab));
      const current = [...markup.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((m) => m[0]);
      expect(current).toHaveLength(1);
      expect(current[0]).toContain(`data-testid="case-tab-${tab}"`);
    }
  });

  it("every data-case-id on the page is the route's case; every event and task belongs to it", async () => {
    for (const tab of CASE_TABS) {
      const markup = html(await view(tab));
      expect(new Set(attrs(markup, "data-case-id"))).toEqual(new Set([caseIdOf(1)]));
      for (const eventId of attrs(markup, "data-event-id")) expect(eventId.slice(-12, -6)).toBe("000001");
    }
  });

  it("a recorded task status carries the ADR-013 epistemic attributes and names its event", async () => {
    const markup = html(await view("tasks"));
    expect(markup).toContain(
      `data-epistemic="recorded" data-status-kind="task" data-status="IN_PROGRESS" data-event-id="${caseEventId(1, 2)}"`,
    );
    expect(attrs(markup, "data-epistemic")).toEqual(["recorded"]);
  });

  it("an untouched OPEN task makes no epistemic claim", async () => {
    const markup = html(await view("tasks"));
    const open = markup.match(/<span[^>]*data-task-status="OPEN"[^>]*>/)?.[0] ?? "";
    expect(open).not.toBe("");
    expect(open).not.toContain("data-epistemic");
    expect(open).not.toContain("data-event-id");
  });

  it("timeline entries name their event and provenance, with no epistemic claim", async () => {
    const markup = html(await view("events"));
    expect(attrs(markup, "data-event-id")).toEqual([caseEventId(1, 2), caseEventId(1, 1)]);
    expect(markup).toContain('data-provenance="SEED_SYNTHETIC"');
    expect(markup).toContain("بيانات اصطناعية أولية");
    expect(markup).toContain("دون صفة مسجلة");
    expect(markup).not.toContain("data-epistemic");
  });

  it("dates use the CDF time zone and Arabic-Indic digits in Arabic, Latin digits in English", async () => {
    const v = await view("events");
    expect(html(v, "ar")).toMatch(/[٠-٩]/);
    const en = html(v, "en");
    expect(en).toContain('dateTime="2026-10-05T10:30:00.000Z"');
    expect(en).toContain("13:30"); // 10:30 UTC is 13:30 in Riyadh
  });

  it("overview lists the persona's own open task and the last events", async () => {
    const markup = html(await view("overview"), "en");
    expect(markup).toContain('data-testid="case-my-tasks"');
    expect(markup).toContain(`data-testid="case-task-${caseTaskId(1, 2)}"`);
    expect(markup).not.toContain(`data-testid="case-task-${caseTaskId(1, 1)}"`);
    expect(markup).toContain('data-testid="case-task-mine"');
    expect(markup).toContain('data-testid="case-last-events"');
  });

  it("overview without own open tasks says so", async () => {
    const markup = html(await view("overview", 1, INVESTIGATOR_GAMMA), "en");
    expect(markup).toContain('data-testid="case-my-tasks-empty"');
    expect(markup).toContain("You hold no recorded capacity on this case");
  });

  it("a closed case shows the lock and the reference-only notice", async () => {
    const markup = html(await view("overview", 10));
    expect(markup).toContain('data-records-state="CLOSED"');
    expect(markup).toContain('data-testid="case-closed-notice"');
  });

  it("a restricted case the persona is named on shows the named-access flag", async () => {
    const markup = html(await view("overview", 9, INVESTIGATOR_BETA));
    expect(markup).toContain('data-testid="case-restricted"');
  });

  it("notifications: metadata only, the status code as recorded", async () => {
    const markup = html(await view("notifications"), "en");
    expect(markup).toContain('data-testid="case-notifications" data-count="1"');
    expect(markup).toContain('data-lifecycle-status="DRAFT"');
    expect(markup).toContain('data-language="ar"');
  });

  it("empty tabs say so", async () => {
    const records: ProceduralRecordsReader = { listEvents: async () => [], listTasks: async () => [] };
    const none: NotificationRecordsReader = { listCaseNotifications: async () => [] };
    for (const [tab, testId] of [
      ["events", "case-events-empty"],
      ["tasks", "case-tasks-empty"],
      ["notifications", "case-notifications-empty"],
    ] as const) {
      const v = await loadCaseWorkspace(deps(SECRETARY, records, none), caseIdOf(1), tab);
      expect(html(v)).toContain(`data-testid="${testId}"`);
    }
  });

  it("an unknown event code is shown as the code itself", async () => {
    const base = createFakeProceduralRecords();
    const [first] = await base.listEvents(SECRETARY, caseIdOf(1));
    const records = { ...base, listEvents: async () => [{ ...first!, event_code: "SOMETHING_NEW" }] };
    const v = await loadCaseWorkspace(deps(SECRETARY, records), caseIdOf(1), "events");
    expect(html(v)).toContain("SOMETHING_NEW");
  });
});

describe("lib/domain stays on the server", () => {
  it("no Case Workspace module is a client module", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = "app/(platform)/cases/[caseId]/_components";
    for (const name of readdirSync(dir).filter((n) => /\.tsx?$/.test(n))) {
      expect(readFileSync(`${dir}/${name}`, "utf8"), name).not.toMatch(/^\s*["']use client["']/m);
    }
  });
});
