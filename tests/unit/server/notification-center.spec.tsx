// FE-006 part 2, Notification Operations Center (SCREENS S4): URL state (filters, Riyadh day range, keyset trail),
// loader (D6: investigators answered like an unknown route before anything is parsed or read; authorised rows and
// total only; generic errors with the correlation id) and markup (S4 test ids, ADR-013 attributes, every row names its
// case, "sent" never "delivered", no person data). Fake reader with the seed visibility table.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InvalidCursorError, type NotificationCenterReader } from "@/lib/contracts";
import { createTranslator } from "@/lib/i18n";
import { AppError } from "@/lib/server/errors";
import { loadNotificationCenter, type NotificationCenterView } from "@/lib/server/notification-center";
import {
  CENTER_MAX_TRAIL,
  CENTER_PAGE_SIZE,
  centerFilterFormKey,
  centerNextHref,
  centerPositionOf,
  centerPrevHref,
  parseCenterQuery,
  toCenterFilter,
  type CenterQuery,
} from "@/lib/server/notification-center-query";
import { NotificationCenterView as View } from "@/app/(platform)/notifications/_components/NotificationCenterView";
import { caseIdOf } from "./support/fake-case-source";
import { createFakeNotificationCenter, notificationIdOf } from "./support/fake-notification-center";
import {
  ALPHA,
  CORRELATION,
  ctxFor,
  DELTA,
  GOVERNANCE,
  GOVERNANCE_AT_SECRETARIAT,
  id,
  INVESTIGATOR_BETA,
  INVESTIGATOR_GAMMA,
  SECRETARY,
} from "./support/identities";
import { scrollRegionProblems } from "./support/scroll-regions";

vi.mock("@/lib/http/errors", () => ({ logServerError: vi.fn() }));

const ok = (params: Record<string, string | string[] | undefined>): CenterQuery => {
  const parsed = parseCenterQuery(params);
  if (!parsed.ok) throw new Error("expected a valid query");
  return parsed.query;
};
const CURSOR_A = "eyJ2IjoxLCJhdCI6IngifQ";
const CURSOR_B = "eyJ2IjoxLCJhdCI6InkifQ";

describe("parseCenterQuery", () => {
  it("reads filters; empty values mean no filter; text inputs are trimmed and upper-cased", () => {
    expect(ok({})).toEqual({ trail: [] });
    expect(
      ok({
        status: "DISPATCHED",
        template: " cf-20_investigation_assigned ",
        case: " cdf-demo-2026-0001",
        from: "2026-10-01",
        to: "2026-10-31",
      }),
    ).toEqual({
      status: "DISPATCHED",
      template: "CF-20_INVESTIGATION_ASSIGNED",
      caseNumber: "CDF-DEMO-2026-0001",
      from: "2026-10-01",
      to: "2026-10-31",
      trail: [],
    });
    expect(ok({ status: "", template: "", case: "", from: "", to: "", after: "", back: "" })).toEqual({
      trail: [],
    });
  });

  it.each([
    ["a repeated parameter", { status: ["DRAFT", "APPROVED"] }],
    ["an unknown status", { status: "DELIVERED" }],
    ["a lower-case status", { status: "draft" }],
    ["a case UUID where a display number belongs", { case: "0c000000-0000-4000-8000-000000000001" }],
    ["a partial case number", { case: "0001" }],
    ["a template code with spaces", { template: "CF 20" }],
    ["an over-long template code", { template: `C${"X".repeat(61)}` }],
    ["a date that is not a calendar day", { from: "2026-02-30" }],
    ["a date with a time", { to: "2026-10-01T00:00" }],
    ["a range ending before it starts", { from: "2026-10-02", to: "2026-10-01" }],
    ["a malformed cursor", { after: "a+b" }],
    ["a trail without a cursor", { back: "~" }],
    [
      "a trail past its bound",
      {
        after: CURSOR_A,
        back: Array(CENTER_MAX_TRAIL + 1)
          .fill("~")
          .join("."),
      },
    ],
  ])("refuses %s", (_n, params) => {
    expect(parseCenterQuery(params as never)).toEqual({ ok: false });
  });

  it("maps to the filter contract: fixed page size, inclusive Riyadh days as [from, next day)", () => {
    expect(toCenterFilter(ok({}))).toEqual({ limit: CENTER_PAGE_SIZE });
    expect(
      toCenterFilter(
        ok({
          status: "DRAFT",
          case: "CDF-DEMO-2026-0001",
          from: "2026-10-01",
          to: "2026-10-31",
          after: CURSOR_A,
        }),
      ),
    ).toEqual({
      limit: CENTER_PAGE_SIZE,
      lifecycle_status: "DRAFT",
      case_number: "CDF-DEMO-2026-0001",
      created_from: "2026-10-01T00:00:00+03:00",
      created_before: "2026-11-01T00:00:00+03:00",
      cursor: CURSOR_A,
    });
    expect(toCenterFilter(ok({ to: "2026-12-31" })).created_before).toBe("2027-01-01T00:00:00+03:00");
  });
});

describe("paging links keep the filters", () => {
  const q = ok({ status: "DRAFT", case: "CDF-DEMO-2026-0001" });

  it("next from the first page remembers it; previous returns to it", () => {
    const next = centerNextHref(q, CURSOR_A)!;
    expect(next).toBe(`/notifications?status=DRAFT&case=CDF-DEMO-2026-0001&after=${CURSOR_A}&back=%7E`);
    const second = ok(Object.fromEntries(new URL(next, "http://x").searchParams));
    expect(centerPositionOf(second)).toBe(CENTER_PAGE_SIZE + 1);
    expect(centerPrevHref(second)).toBe("/notifications?status=DRAFT&case=CDF-DEMO-2026-0001");
  });

  it("previous from the third page goes to the second", () => {
    const third = ok({ after: CURSOR_B, back: `~.${CURSOR_A}` });
    expect(centerPrevHref(third)).toBe(`/notifications?after=${CURSOR_A}&back=%7E`);
    expect(centerPositionOf(third)).toBe(2 * CENTER_PAGE_SIZE + 1);
  });

  it("no next link without a cursor; no previous link on the first page; unknown position without a trail", () => {
    expect(centerNextHref(q, null)).toBeNull();
    expect(centerNextHref(q, "a+b")).toBeNull();
    expect(centerPrevHref(q)).toBeNull();
    const handMade = ok({ after: CURSOR_A });
    expect(centerPositionOf(handMade)).toBe(0);
    expect(centerPrevHref(handMade)).toBe("/notifications");
  });
});

describe("loadNotificationCenter", () => {
  const load = (
    identity = SECRETARY,
    params: Record<string, string> = {},
    reader = createFakeNotificationCenter(),
  ) => loadNotificationCenter({ ctx: ctxFor(identity), reader }, params);
  const ids = (view: NotificationCenterView) =>
    view.kind === "page" ? view.page.items.map((n) => n.notification_id) : [];

  it("D6 / SEC-APP-17: an investigator gets NOT_FOUND before any parsing or read, whatever the URL", async () => {
    for (const identity of [INVESTIGATOR_BETA, INVESTIGATOR_GAMMA]) {
      const urls: Record<string, string>[] = [
        {},
        { status: "DELIVERED" },
        { after: "a+b" },
        { case: "CDF-DEMO-2026-0001" },
      ];
      for (const params of urls) {
        const reader = createFakeNotificationCenter();
        await expect(load(identity, params, reader)).rejects.toEqual(new AppError("NOT_FOUND"));
        expect(reader.calls).toHaveLength(0);
      }
    }
  });

  it("a session without a Center role in its active workspace gets NOT_FOUND too", async () => {
    for (const identity of [id(ALPHA, "SECRETARIAT", []), id(DELTA, "INVESTIGATIONS", ["INVESTIGATOR"])]) {
      const reader = createFakeNotificationCenter();
      await expect(load(identity, {}, reader)).rejects.toEqual(new AppError("NOT_FOUND"));
      expect(reader.calls).toHaveLength(0);
    }
  });

  it("the Secretary sees only notifications of her visible cases, newest first, total equal", async () => {
    const view = await load(SECRETARY);
    // Cases visible at SECRETARIAT: 1, 3, 4, 6, 7, 8, 10. Never 0002 (notification 3) or restricted 0009 (5).
    expect(ids(view)).toEqual([6, 4, 2, 1].map(notificationIdOf));
    expect(view.kind === "page" && view.page.total).toBe(4);
  });

  it("the Governance Officer reads her own workspace's view; the same persona at SECRETARIAT reads that one", async () => {
    expect(ids(await load(GOVERNANCE))).toEqual([6, 4, 3, 2, 1].map(notificationIdOf));
    expect(ids(await load(GOVERNANCE_AT_SECRETARIAT))).toEqual([6, 4, 2, 1].map(notificationIdOf));
  });

  it("filters by status, template, case number and date range; the reader gets the parsed filter", async () => {
    const reader = createFakeNotificationCenter();
    expect(ids(await load(SECRETARY, { status: "DISPATCHED" }, reader))).toEqual([notificationIdOf(2)]);
    expect(ids(await load(SECRETARY, { case: "CDF-DEMO-2026-0001" }, reader))).toEqual(
      [2, 1].map(notificationIdOf),
    );
    expect(ids(await load(SECRETARY, { template: "CF-24_MEETING_INVITATION" }, reader))).toEqual(
      [6, 4, 2].map(notificationIdOf),
    );
    expect(ids(await load(SECRETARY, { from: "2026-10-12", to: "2026-10-14" }, reader))).toEqual(
      [4, 2].map(notificationIdOf),
    );
    expect(reader.calls.at(-1)!.filter).toEqual({
      limit: CENTER_PAGE_SIZE,
      created_from: "2026-10-12T00:00:00+03:00",
      created_before: "2026-10-15T00:00:00+03:00",
    });
  });

  it("a case number the persona may not see answers like one that does not exist: no rows, total 0", async () => {
    for (const caseNumber of ["CDF-DEMO-2026-0002", "CDF-DEMO-2026-0009", "CDF-DEMO-2026-9999"]) {
      const view = await load(SECRETARY, { case: caseNumber });
      expect(view).toMatchObject({ kind: "page", page: { items: [], total: 0, next_cursor: null } });
    }
  });

  it("an edited URL is the invalid state, before the reader is called", async () => {
    const reader = createFakeNotificationCenter();
    expect(await load(SECRETARY, { status: "DELIVERED" }, reader)).toEqual({
      kind: "invalid",
      correlationId: CORRELATION,
    });
    expect(reader.calls).toHaveLength(0);
  });

  it("a cursor the reader refuses is the invalid state", async () => {
    expect(await load(SECRETARY, { after: "bm90LWEtY3Vyc29y" })).toEqual({
      kind: "invalid",
      correlationId: CORRELATION,
    });
  });

  it("a database failure is a generic error carrying only the correlation id", async () => {
    const failing: NotificationCenterReader = {
      listNotifications: () => Promise.reject(new Error('relation "x" does not exist at character 12')),
    };
    const view = await load(SECRETARY, {}, failing as never);
    expect(view).toEqual({ kind: "error", correlationId: CORRELATION });
    expect(JSON.stringify(view)).not.toContain("does not exist");
  });

  it("UNAUTHENTICATED from the reader is re-thrown for the sign-in redirect", async () => {
    const failing: NotificationCenterReader = {
      listNotifications: () => Promise.reject(new AppError("UNAUTHENTICATED")),
    };
    await expect(load(SECRETARY, {}, failing as never)).rejects.toEqual(new AppError("UNAUTHENTICATED"));
  });

  it("an InvalidCursorError from the reader is never shown as an error page", async () => {
    const refusing: NotificationCenterReader = {
      listNotifications: () => Promise.reject(new InvalidCursorError("bad")),
    };
    expect((await load(SECRETARY, { after: CURSOR_A }, refusing as never)).kind).toBe("invalid");
  });

  it("pages forward with a next link that keeps the filters", async () => {
    const reader = createFakeNotificationCenter();
    const big = {
      ...reader,
      listNotifications: (i: never, f: never) =>
        reader.listNotifications(i, { ...(f as object), limit: 2 } as never),
    };
    const first = await loadNotificationCenter({ ctx: ctxFor(SECRETARY), reader: big }, { status: "" });
    expect(first.kind === "page" && first.nextHref).toMatch(
      /^\/notifications\?after=[A-Za-z0-9_-]+&back=%7E$/,
    );
  });
});

describe("NotificationCenterView markup", () => {
  const render = (locale: "ar" | "en", view: NotificationCenterView) =>
    renderToStaticMarkup(<View t={createTranslator(locale)} locale={locale} view={view} />);
  const load = (identity = SECRETARY, params: Record<string, string> = {}) =>
    loadNotificationCenter({ ctx: ctxFor(identity), reader: createFakeNotificationCenter() }, params);

  it("has one h1 with the S4 heading and the filter form", async () => {
    const html = render("ar", await load());
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("مركز عمليات الإشعارات");
    expect(html).toContain('data-testid="notifications-filters"');
    const form = html.match(/<form[^>]*>/)![0];
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/notifications"');
  });

  it("the table sits in a focusable scroll region named by its caption (WCAG 2.1.1)", async () => {
    for (const locale of ["ar", "en"] as const) {
      expect(scrollRegionProblems(render(locale, await load()))).toEqual([]);
    }
  });

  it("every row names its case (ADR-013 attributes, number link by UUID, title); the count equals the rows", async () => {
    const view = await load();
    const html = render("en", view);
    expect(html).toContain('data-testid="notifications-table"');
    const rows = html.match(/data-testid="notification-row-[^"]+"/g) ?? [];
    expect(rows).toHaveLength(4);
    expect(html).toContain('data-count="4"');
    expect(html).toContain(
      `data-testid="notification-row-${notificationIdOf(1)}" data-notification-id="${notificationIdOf(1)}" data-case-id="${caseIdOf(1)}" data-case-ref="CDF-DEMO-2026-0001"`,
    );
    expect(html).toContain(`href="/cases/${caseIdOf(1)}"`);
    expect(html).toContain(`href="/cases/${caseIdOf(1)}/notifications"`);
    expect(html).toContain("Demo case 1");
    expect(html).toContain("CF-20_INVESTIGATION_ASSIGNED");
    expect(html).not.toContain("CDF-DEMO-2026-0002");
    expect(html).not.toContain("CDF-DEMO-2026-0009");
  });

  it("sent is never delivered (V13 L-07), in both languages", async () => {
    const view = await load(SECRETARY, { status: "DISPATCHED" });
    expect(render("ar", view)).toContain("أُرسل — لم يُؤكَّد التسليم");
    const en = render("en", view);
    expect(en).toContain("Sent — delivery not confirmed");
    expect(en.replaceAll("delivery not confirmed", "")).not.toMatch(/deliver/i);
  });

  it("recipient class is a class label, never a person; the code stays in a data attribute", async () => {
    const html = render("en", await load());
    expect(html).toContain('data-recipient-class="WITNESS"');
    expect(html).toContain(">Witness<");
    expect(html).not.toMatch(/Alpha|Beta|Gamma|Delta|@example\.test/);
  });

  it("Arabic digits in the count and version", async () => {
    const html = render("ar", await load());
    expect(html).toContain("٤ إشعارات");
    expect(html).toContain("الإصدار ١");
  });

  it("empty workspace and no results are distinct states", async () => {
    const empty: NotificationCenterView = {
      kind: "page",
      query: { trail: [] },
      page: { items: [], next_cursor: null, total: 0 },
      from: 1,
      nextHref: null,
      prevHref: null,
    };
    const emptyHtml = render("ar", empty);
    expect(emptyHtml).toContain('data-testid="notifications-empty"');
    expect(emptyHtml).toContain("لا توجد إشعارات في مساحة العمل هذه");
    expect(emptyHtml).not.toContain("notifications-table");
    const noResults = render("ar", await load(SECRETARY, { case: "CDF-DEMO-2026-0002" }));
    expect(noResults).toContain('data-testid="notifications-no-results"');
    expect(noResults).not.toContain('data-testid="notifications-empty"');
  });

  it("the form holds the current values; the caption names them", async () => {
    const html = render(
      "en",
      await load(SECRETARY, { status: "DRAFT", case: "CDF-DEMO-2026-0001", from: "2026-10-01" }),
    );
    expect(html).toMatch(/<option value="DRAFT" selected="">/);
    expect(html).toContain('value="CDF-DEMO-2026-0001"');
    expect(html).toContain('value="2026-10-01"');
    expect(html).toContain("Filters: status: Draft, case: CDF-DEMO-2026-0001, and from 1 Oct 2026.");
    expect(html).toContain('data-testid="notifications-clear"');
  });

  it("errors are generic with the correlation id only", () => {
    for (const kind of ["error", "invalid"] as const) {
      const html = render("en", { kind, correlationId: CORRELATION });
      expect(html).toContain(`data-testid="notifications-${kind}"`);
      expect(html).toContain(CORRELATION);
      expect(html).toContain('role="alert"');
      expect(html).not.toContain("notifications-table");
    }
  });

  it("no investigation content: the markup carries no event, author or narrative fields", async () => {
    const html = render("en", await load());
    expect(html).not.toMatch(/author|narrative|recipient_name|email/i);
  });
});

describe("filter form identity (OI-043 on the Center)", () => {
  it("changes with every filter and only then; the view keys the form with it", async () => {
    const keys = [
      {},
      { status: "DRAFT" },
      { template: "CF-24_MEETING_INVITATION" },
      { case: "CDF-DEMO-2026-0001" },
      { from: "2026-10-01" },
      { to: "2026-10-01" },
    ].map((p) => centerFilterFormKey(ok(p)));
    expect(new Set(keys).size).toBe(keys.length);
    expect(centerFilterFormKey(ok({ status: "DRAFT", after: CURSOR_A, back: "~" }))).toBe(
      centerFilterFormKey(ok({ status: "DRAFT" })),
    );
    for (const params of [{}, { status: "DRAFT" }]) {
      const view = await loadNotificationCenter(
        { ctx: ctxFor(SECRETARY), reader: createFakeNotificationCenter() },
        params,
      );
      const tree = View({ t: createTranslator("en"), locale: "en", view }) as {
        props: { children: unknown[] };
      };
      const form = tree.props.children.find(
        (c): c is { key: string | null } =>
          typeof c === "object" && c !== null && "props" in c && "query" in (c as { props: object }).props,
      );
      expect(form?.key).toBe(view.kind === "page" ? centerFilterFormKey(view.query) : null);
    }
  });
});
