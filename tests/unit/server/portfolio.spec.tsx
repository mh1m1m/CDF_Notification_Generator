// FE-003 Case Portfolio: URL state (filters and keyset trail), loader (authorised rows and total only, generic errors
// with the correlation id), and markup (S2 test ids, ADR-013 attributes, counts equal visible rows). Fake adapter with
// the seed visibility table; the SQL adapter is covered in v13-records-adapter.spec.ts and integration.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CaseSourceAdapter } from "@/lib/contracts";
import { InvalidCursorError } from "@/lib/contracts";
import { createTranslator } from "@/lib/i18n";
import { AppError } from "@/lib/server/errors";
import { loadPortfolio, positionOf, type PortfolioView } from "@/lib/server/portfolio";
import {
  MAX_TRAIL,
  nextHref,
  parsePortfolioQuery,
  prevHref,
  toCaseListFilter,
  type PortfolioQuery,
} from "@/lib/server/portfolio-query";
import { caseIdOf, createFakeCaseSource } from "./support/fake-case-source";
import {
  CORRELATION,
  ctxFor,
  EPSILON,
  GOVERNANCE,
  id,
  INVESTIGATOR_BETA,
  INVESTIGATOR_GAMMA,
  SECRETARY,
} from "./support/identities";
import { scrollRegionProblems } from "./support/scroll-regions";

vi.mock("@/lib/http/errors", () => ({ logServerError: vi.fn() }));

const ok = (params: Record<string, string | string[] | undefined>): PortfolioQuery => {
  const parsed = parsePortfolioQuery(params);
  if (!parsed.ok) throw new Error("expected a valid query");
  return parsed.query;
};
const CURSOR_A = "eyJ2IjoxLCJhZnRlciI6IkNERi1ERU1PLTIwMjYtMDAyNSJ9";
const CURSOR_B = "eyJ2IjoxLCJhZnRlciI6IkNERi1ERU1PLTIwMjYtMDA1MCJ9";

describe("parsePortfolioQuery", () => {
  it("reads filters; empty values mean no filter", () => {
    expect(ok({})).toEqual({ trail: [] });
    expect(ok({ q: "  0003 ", stage: "INVESTIGATION", state: "CLOSED" })).toEqual({
      text: "0003",
      stage: "INVESTIGATION",
      state: "CLOSED",
      trail: [],
    });
    expect(ok({ q: "", stage: "", state: "", after: "", back: "" })).toEqual({ trail: [] });
  });

  it.each([
    ["repeated parameter", { q: ["a", "b"] }],
    ["unknown stage", { stage: "investigation" }],
    ["stage code not in the catalogue", { stage: "ARCHIVED" }],
    ["unknown records state", { state: "DELETED" }],
    ["assigned-to-me other than 1", { mine: "true" }],
    ["over-long search", { q: "x".repeat(101) }],
    ["cursor with forbidden characters", { after: "a b" }],
    ["over-long cursor", { after: "a".repeat(513) }],
    ["trail without a current cursor", { back: "~" }],
    ["trail with a bad entry", { after: CURSOR_A, back: "~.a+b" }],
    [
      "trail too long",
      {
        after: CURSOR_A,
        back: Array(MAX_TRAIL + 1)
          .fill("~")
          .join("."),
      },
    ],
  ])("refuses %s", (_n, params) => {
    expect(parsePortfolioQuery(params).ok).toBe(false);
  });

  it("maps to the CaseListFilter contract with the fixed page size", () => {
    expect(
      toCaseListFilter(ok({ q: "x", stage: "CLOSURE", state: "CLOSED", after: CURSOR_A, back: "~" })),
    ).toEqual({
      limit: 25,
      text: "x",
      lifecycle_stage: "CLOSURE",
      records_state: "CLOSED",
      cursor: CURSOR_A,
    });
  });
});

describe("assigned-to-me filter", () => {
  it("mine=1 maps to assigned_to_me and survives paging links", () => {
    const q = ok({ mine: "1" });
    expect(toCaseListFilter(q)).toEqual({ limit: 25, assigned_to_me: true });
    expect(nextHref(q, CURSOR_A)).toBe(`/portfolio?mine=1&after=${CURSOR_A}&back=%7E`);
  });

  it("keeps only cases with an active case assignment; the total follows", async () => {
    const alpha = pageOf(await load(SECRETARY, { mine: "1" }));
    expect(alpha.page.items.map((c) => c.case_id)).toEqual([1, 3, 4, 7, 8, 10].map(caseIdOf));
    expect(alpha.page.total).toBe(6);
    const delta = pageOf(await load(GOVERNANCE, { mine: "1" }));
    expect(delta.page.items.map((c) => c.case_id)).toEqual([caseIdOf(8)]);
  });

  it("never widens visibility: Gamma's assignments outside its workspace view stay hidden", async () => {
    const gamma = pageOf(await load(INVESTIGATOR_GAMMA, { mine: "1" }));
    expect(gamma.page.items.map((c) => c.case_id)).toEqual([2, 6, 10].map(caseIdOf));
    expect(gamma.page.items.map((c) => c.case_id)).not.toContain(caseIdOf(9));
  });
});

describe("paging links keep the filters", () => {
  const first = ok({ q: "demo", state: "ACTIVE" });

  it("next from the first page remembers the first page; previous returns to it", () => {
    const next = nextHref(first, CURSOR_A);
    expect(next).toBe(`/portfolio?q=demo&state=ACTIVE&after=${CURSOR_A}&back=%7E`);
    const second = ok(Object.fromEntries(new URL(next!, "http://x").searchParams));
    expect(second.trail).toEqual([""]);
    expect(prevHref(second)).toBe("/portfolio?q=demo&state=ACTIVE");
    expect(positionOf(second)).toBe(26);
  });

  it("previous from the third page goes to the second", () => {
    const third = ok(
      Object.fromEntries(
        new URL(nextHref(ok({ after: CURSOR_A, back: "~" }), CURSOR_B)!, "http://x").searchParams,
      ),
    );
    expect(third.trail).toEqual(["", CURSOR_A]);
    expect(prevHref(third)).toBe(`/portfolio?after=${CURSOR_A}&back=%7E`);
    expect(positionOf(third)).toBe(51);
  });

  it("no next link without a cursor; no previous link on the first page", () => {
    expect(nextHref(first, null)).toBeNull();
    expect(prevHref(first)).toBeNull();
    expect(positionOf(first)).toBe(1);
  });

  it("a hand-made link without a trail: previous is the first page, position unknown", () => {
    const q = ok({ after: CURSOR_A });
    expect(prevHref(q)).toBe("/portfolio");
    expect(positionOf(q)).toBe(0);
  });

  it("the trail never grows past its bound", () => {
    let q = ok({});
    for (let i = 0; i < MAX_TRAIL + 5; i += 1) {
      q = ok(Object.fromEntries(new URL(nextHref(q, CURSOR_A)!, "http://x").searchParams));
    }
    expect(q.trail.length).toBe(MAX_TRAIL);
    expect(positionOf(q)).toBe(0);
  });
});

const pageOf = (v: PortfolioView) => {
  if (v.kind !== "page") throw new Error(`expected a page, got ${v.kind}`);
  return v;
};
const load = (
  identity: Parameters<typeof ctxFor>[0],
  params = {},
  source: CaseSourceAdapter = createFakeCaseSource(),
) => loadPortfolio({ ctx: ctxFor(identity), source }, params);

describe("loadPortfolio", () => {
  it("lists only the persona's authorised cases, total equal to what it may see", async () => {
    const v = pageOf(await load(SECRETARY));
    expect(v.page.items.map((c) => c.case_id)).toEqual([1, 3, 4, 6, 7, 8, 10].map(caseIdOf));
    expect(v.page.total).toBe(7);
  });

  it("Scenario D: restricted 0009 appears for Beta (assigned) and never for Gamma, by listing or by search", async () => {
    expect(pageOf(await load(INVESTIGATOR_BETA, { q: "0009" })).page.items.map((c) => c.case_id)).toEqual([
      caseIdOf(9),
    ]);
    for (const params of [{}, { q: "0009" }, { q: "CDF-DEMO-2026-0009" }]) {
      const v = pageOf(await load(INVESTIGATOR_GAMMA, params));
      expect(v.page.items.map((c) => c.case_id)).not.toContain(caseIdOf(9));
      expect(v.page.total).toBe(v.page.items.length);
    }
    expect(pageOf(await load(INVESTIGATOR_GAMMA, { q: "0009" })).page.total).toBe(0);
  });

  it("filters by records state and stage", async () => {
    const closed = pageOf(await load(GOVERNANCE, { state: "CLOSED" }));
    expect(closed.page.items.map((c) => c.case_id)).toEqual([caseIdOf(10)]);
    expect(closed.page.total).toBe(1);
    const closure = pageOf(await load(GOVERNANCE, { stage: "CLOSURE" }));
    expect(closure.page.items.map((c) => c.case_id)).toEqual([caseIdOf(10)]);
  });

  it("a persona with no visible cases gets an empty page with total 0", async () => {
    const v = pageOf(await load(id(EPSILON, "SECRETARIAT", ["COMMITTEE_SECRETARY"])));
    expect(v.page).toEqual({ items: [], next_cursor: null, total: 0 });
  });

  it("an edited URL is VALIDATION, before the adapter is called", async () => {
    const source = createFakeCaseSource();
    const v = await load(SECRETARY, { stage: "NOPE" }, source);
    expect(v).toEqual({ kind: "invalid", correlationId: CORRELATION });
    expect(source.calls).toEqual([]);
  });

  it("a cursor the adapter refuses is VALIDATION", async () => {
    const source: CaseSourceAdapter = {
      ...createFakeCaseSource(),
      listCases: async () => {
        throw new InvalidCursorError("bad cursor");
      },
    };
    expect(await load(SECRETARY, { after: CURSOR_A }, source)).toEqual({
      kind: "invalid",
      correlationId: CORRELATION,
    });
  });

  it("a database failure is a generic error carrying only the correlation id", async () => {
    const source: CaseSourceAdapter = {
      ...createFakeCaseSource(),
      listCases: async () => {
        throw new Error(
          'relation "cdf_notifications_v13.case_record" permission denied for role cdf_v13_user',
        );
      },
    };
    const v = await load(SECRETARY, {}, source);
    expect(v).toEqual({ kind: "error", correlationId: CORRELATION });
    expect(JSON.stringify(v)).not.toMatch(/relation "|permission|cdf_v13/);
  });

  it("a pre-check refusal is re-thrown as NOT_FOUND (answered like an unknown route)", async () => {
    const source: CaseSourceAdapter = {
      ...createFakeCaseSource(),
      listCases: async () => {
        throw new AppError("NOT_FOUND");
      },
    };
    await expect(load(SECRETARY, {}, source)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PortfolioView markup", async () => {
  const { PortfolioView: View } = await import("@/app/(platform)/portfolio/_components/PortfolioView");
  const render = (locale: "ar" | "en", view: PortfolioView) =>
    renderToStaticMarkup(<View t={createTranslator(locale)} locale={locale} view={view} />);

  it("the table sits in a focusable scroll region named by its caption (WCAG 2.1.1)", async () => {
    for (const locale of ["ar", "en"] as const) {
      expect(scrollRegionProblems(render(locale, await load(SECRETARY)))).toEqual([]);
    }
  });

  it("rows carry ADR-013 attributes and link by UUID; the count equals the visible rows", async () => {
    const view = await load(SECRETARY);
    const html = render("ar", view);
    expect(html).toContain('data-testid="portfolio-filters"');
    expect(html).toContain('data-testid="portfolio-search"');
    expect(html).toContain('data-testid="portfolio-table"');
    const rows = [
      ...html.matchAll(
        /data-testid="portfolio-row-([0-9a-f-]{36})" data-case-id="([0-9a-f-]{36})" data-case-ref="(CDF-DEMO-2026-\d{4})"/g,
      ),
    ];
    expect(rows.map((r) => r[1])).toEqual([1, 3, 4, 6, 7, 8, 10].map(caseIdOf));
    for (const r of rows) {
      expect(r[2]).toBe(r[1]);
      expect(html).toContain(`href="/cases/${r[1]}"`);
    }
    expect(html).toMatch(/data-testid="count-portfolio-results" data-count="7"/);
    expect(html).toMatch(/data-testid="count-portfolio-total" data-count="7"/);
    expect(html).not.toContain("CDF-DEMO-2026-0009");
    expect(html).not.toContain('href="/cases/CDF');
  });

  it("closed 0010 shows the records state with glyph and word; Arabic digits in the count", async () => {
    const html = render("ar", await load(SECRETARY));
    expect(html).toMatch(/data-records-state="CLOSED"><svg aria-hidden="true"[^]*?<\/svg>مغلقة/);
    expect(html).toContain("٧ قضايا");
    expect(html).toContain("عرض ١–٧ من ٧");
    expect(html).toContain('<bdi dir="ltr">CDF-DEMO-2026-0010</bdi>');
  });

  it("last recorded event carries its event id; own open tasks are counted", async () => {
    const html = render("ar", await load(SECRETARY));
    expect(html).toMatch(
      /<time dateTime="2026-10-11T09:00:00.000Z" data-testid="portfolio-last-event" data-event-id="0e000000-0000-4000-8000-000000000001">[^<]*١١[^<]*<\/time>/,
    );
    expect(html).toMatch(/data-testid="portfolio-my-open-tasks" data-count="2">٢</);
    // Not a status: no data-epistemic until the row carries the event's status kind and status (Inspector T2).
    expect(html).not.toContain("data-epistemic");
    const beta = render("en", await load(INVESTIGATOR_BETA));
    expect(beta).toContain('data-testid="portfolio-no-event"');
    expect(beta).toContain("No recorded events yet");
  });

  it("the assigned-to-me box reflects the URL and is named in the caption", async () => {
    const html = render("en", await load(SECRETARY, { mine: "1" }));
    expect(html).toMatch(/<input id="portfolio-mine" type="checkbox"[^>]*checked=""/);
    expect(html).toContain("Filters: assigned to me only.");
    expect(render("en", await load(SECRETARY))).not.toMatch(/id="portfolio-mine"[^>]*checked/);
  });

  it("restricted 0009 carries the named-access flag for its assigned investigator", async () => {
    const html = render("en", await load(INVESTIGATOR_BETA));
    expect(html).toContain('data-testid="portfolio-restricted"');
    expect(html).toContain("Named access");
  });

  it("empty portfolio and no results are distinct states", async () => {
    const empty = render("ar", await load(id(EPSILON, "SECRETARIAT", ["COMMITTEE_SECRETARY"])));
    expect(empty).toContain('data-testid="portfolio-empty"');
    expect(empty).not.toContain('data-testid="portfolio-table"');
    const none = render("ar", await load(SECRETARY, { q: "0009" }));
    expect(none).toContain('data-testid="portfolio-no-results"');
    expect(none).toContain('href="/portfolio"');
    expect(none).toMatch(/data-testid="count-portfolio-results" data-count="0"/);
  });

  it("the filter form is a GET form holding the current values; the caption names them", async () => {
    const html = render("en", await load(GOVERNANCE, { q: "0010", state: "CLOSED" }));
    expect(html).toMatch(/<form [^>]*action="\/portfolio" method="get"/);
    expect(html).toContain('value="0010"');
    expect(html).toMatch(/<option value="CLOSED" selected="">/);
    expect(html).toContain("Filters: search “0010” and records state: Closed.");
    expect(html).toContain('data-testid="portfolio-clear"');
  });

  it("errors are generic with the correlation id only", () => {
    const html = render("ar", { kind: "error", correlationId: CORRELATION });
    expect(html).toContain('data-testid="portfolio-error"');
    expect(html).toContain(CORRELATION);
    expect(html).not.toContain("portfolio-table");
    const invalid = render("en", { kind: "invalid", correlationId: CORRELATION });
    expect(invalid).toContain('data-testid="portfolio-invalid"');
    expect(invalid).toContain('href="/portfolio"');
  });

  it("paging links keep the filters and appear only when there is another page", async () => {
    const view = pageOf(await load(SECRETARY));
    const paged: PortfolioView = { ...view, nextHref: nextHref(view.query, CURSOR_A), prevHref: null };
    const html = render("ar", paged);
    expect(html).toContain('data-testid="portfolio-next"');
    expect(html).not.toContain('data-testid="portfolio-prev"');
    expect(render("ar", view)).not.toContain('data-testid="portfolio-next"');
  });
});
