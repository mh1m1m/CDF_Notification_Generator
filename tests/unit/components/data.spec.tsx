// V13-UX-003 data components, rendered to static HTML (ADR-013 D8). StatusBadge's epistemic rule is tested from three
// sides: the attributes it writes, the four variants being different without colour, and the negatives it must
// refuse. The rendered markup is also run through QA's Procedural Truth Inspector (tests/truth/inspector.ts).
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseWorkspace } from "@/components/shell/CaseWorkspace";
import { Button, ButtonLink } from "@/components/data/Button";
import { ConfirmDialog } from "@/components/data/ConfirmDialog";
import { DataTable } from "@/components/data/DataTable";
import { DeadlineText } from "@/components/data/DeadlineText";
import { ExpectedSteps } from "@/components/data/ExpectedSteps";
import { FilterBar } from "@/components/data/FilterBar";
import { Pagination } from "@/components/data/Pagination";
import { RecordedEventDate } from "@/components/data/RecordedEventDate";
import { EmptyState, ErrorState, LoadingState, NotFoundState } from "@/components/data/States";
import {
  claimsCompletion,
  COMPLETED_CLASS,
  LAYER_A_LABEL_KEYS,
  LAYER_A_STATES,
  StatusBadge,
  type StatusBadgeProps,
} from "@/components/data/StatusBadge";
import { Timeline, type TimelineEntry } from "@/components/data/Timeline";
import { calendarDaysBetween, formatDateTime, formatDays } from "@/components/format";
import { COMPLETED_CLASS_STATUSES, isCompletedClassStatus } from "@/lib/domain";
import { createTranslator, messagesFor, type Locale } from "@/lib/i18n";
import { checkTruth, inMemoryOracle, type EpistemicNode } from "../../truth/inspector";

const LOCALES: readonly Locale[] = ["ar", "en"];
const tr = (l: Locale) => createTranslator(l);
const msg = (l: Locale) => messagesFor(l);
const render = (node: React.ReactElement) => renderToStaticMarkup(node);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const noop = async (_f: FormData) => undefined;

// Synthetic fixtures (CLAUDE.md §1). UUIDs are version 4 so the inspector's strict pattern accepts them.
const CASE_1 = { id: "6f1c2a40-0000-4000-8000-000000000001", ref: "CDF-DEMO-2026-0001" };
const CASE_2 = { id: "6f1c2a40-0000-4000-8000-000000000002", ref: "CDF-DEMO-2026-0002" };
const EVT_1 = "0c3e6b1a-1111-4111-8111-000000000001";
const EVT_2 = "0c3e6b1a-1111-4111-8111-000000000002";
const AT = "2026-10-20T06:30:00Z";

function badge(
  l: Locale,
  variant: "recorded" | "expected" | "conditional" | "awaiting_approval",
  extra = {},
) {
  const base = {
    t: tr(l),
    locale: l,
    statusKind: "task",
    label: l === "ar" ? "مراجعة المذكرة" : "Memo review",
  };
  const byVariant: Record<string, StatusBadgeProps> = {
    recorded: {
      ...base,
      epistemic: "recorded",
      status: "IN_PROGRESS",
      evidence: { eventId: EVT_1, recordedAt: AT },
    },
    expected: { ...base, epistemic: "expected", status: "PENDING" },
    conditional: {
      ...base,
      epistemic: "conditional",
      status: "PENDING",
      condition: l === "ar" ? "قرار اللجنة" : "the committee decision",
    },
    awaiting_approval: { ...base, epistemic: "awaiting_approval", status: "PENDING", approver: "Chair" },
  };
  return render(<StatusBadge {...({ ...byVariant[variant], ...extra } as StatusBadgeProps)} />);
}

/** Visible text: markup without tags and without the visually hidden spans. */
function visibleText(html: string): string {
  return html
    .replace(/<span class="v13-sr-only">.*?<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimal ADR-013 snapshot from static markup, the same fields the inspector collects in a browser. */
function epistemicNodes(html: string): EpistemicNode[] {
  const tags = [...html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/g)];
  const nodes: EpistemicNode[] = [];
  const caseStack: (string | null)[] = [];
  tags.forEach((m, i) => {
    const [, close, , attrs, selfClose] = m;
    if (selfClose) return;
    if (close) {
      caseStack.pop();
      return;
    }
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(attrs ?? "")?.[1] ?? null;
    caseStack.push(attr("data-case-id"));
    const epistemic = attr("data-epistemic");
    if (epistemic === null) return;
    let depth = 0;
    let end = html.length;
    for (let j = i; j < tags.length; j += 1) {
      const t = tags[j]!;
      if (t[4]) continue;
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index!;
        break;
      }
    }
    const inner = html.slice(m.index! + m[0].length, end);
    nodes.push({
      path: `${m[2]}#${i}`,
      epistemic,
      eventId: attr("data-event-id"),
      statusKind: attr("data-status-kind"),
      status: attr("data-status"),
      caseId: [...caseStack].reverse().find((c) => c !== null) ?? null,
      text: inner.replace(/<[^>]+>/g, "").trim(),
    });
  });
  return nodes;
}

describe("StatusBadge — attributes (ADR-013)", () => {
  it.each(LOCALES)("recorded: data-epistemic, kind, status and data-event-id (%s)", (l) => {
    const html = badge(l, "recorded");
    expect(html).toMatch(
      /^<span data-epistemic="recorded" data-status-kind="task" data-status="IN_PROGRESS" data-event-id="[^"]+"/,
    );
    expect(html).toContain(`data-event-id="${EVT_1}"`);
    expect(html).toContain(esc(tr(l)("common.epistemic.recordedAria", { time: formatDateTime(l, AT) })));
  });

  it.each(LOCALES)("recorded without recordedAt: says recorded, never a time (%s)", (l) => {
    const html = render(
      <StatusBadge
        t={tr(l)}
        locale={l}
        epistemic="recorded"
        statusKind="task"
        status="DONE"
        label={l === "ar" ? "منجزة" : "Done"}
        evidence={{ eventId: EVT_1 }}
      />,
    );
    expect(html).toContain('data-epistemic="recorded"');
    expect(html).toContain(`data-event-id="${EVT_1}"`);
    expect(html).toContain(esc(tr(l)("common.epistemic.recordedAriaUndated")));
    expect(html).not.toContain("<time");
    // No digits of any script: no date or time was invented.
    expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/[0-9\u0660-\u0669]/);
  });

  it("passes data-* attributes through and never lets them override its own", () => {
    const html = render(
      <StatusBadge
        t={tr("en")}
        locale="en"
        testId="my-work-task-status"
        data={{ "data-task-status": "DONE", "data-epistemic": "expected", "data-event-id": "x" }}
        epistemic="recorded"
        statusKind="task"
        status="DONE"
        label="Done"
        evidence={{ eventId: EVT_1 }}
      />,
    );
    expect(html).toContain('data-task-status="DONE"');
    expect(html).toContain('data-testid="my-work-task-status"');
    expect(html).toContain('data-epistemic="recorded"');
    expect(html).toContain(`data-event-id="${EVT_1}"`);
    expect(html).not.toContain('data-epistemic="expected"');
    expect(() =>
      render(
        <StatusBadge
          t={tr("en")}
          locale="en"
          data={{ "data-x": "1", onclick: "x" } as unknown as Record<`data-${string}`, string>}
          epistemic="expected"
          statusKind="task"
          status="PENDING"
          label="Memo review"
        />,
      ),
    ).toThrow(/data-\* attributes only/);
  });

  it.each(LOCALES)(
    "non-recorded variants never carry data-event-id; awaiting approval is its own value (%s)",
    (l) => {
      for (const v of ["expected", "conditional", "awaiting_approval"] as const) {
        const html = badge(l, v);
        expect(html).toContain(`data-epistemic="${v}"`);
        expect(html).not.toContain("data-event-id");
      }
    },
  );
});

describe("StatusBadge — reflow (WCAG 1.4.10, QA #16)", () => {
  const css = readFileSync("styles/globals.css", "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(`\n  ${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("lets a badge wrap inside its container instead of scrolling the page sideways", () => {
    const badge = rule(".v13-badge");
    expect(badge).not.toMatch(/white-space:\s*nowrap/);
    expect(badge).toMatch(/max-inline-size:\s*100%/);
    expect(badge).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(".v13-badge > span:not(.v13-badge-glyph)")).toMatch(/min-inline-size:\s*0/);
  });

  it("keeps the glyph whole and on the first line when the words wrap", () => {
    const glyph = rule(".v13-badge-glyph");
    expect(glyph).toMatch(/flex:\s*none/);
    expect(glyph).toMatch(/align-self:\s*flex-start/);
  });
});

describe("StatusBadge — four variants distinct without colour", () => {
  it.each(LOCALES)("each pair differs in at least two of glyph, outline, fill and words (%s)", (l) => {
    const variants = ["recorded", "expected", "conditional", "awaiting_approval"] as const;
    const features = Object.fromEntries(
      variants.map((v) => {
        const html = badge(l, v);
        const text = visibleText(html);
        return [
          v,
          {
            glyph: /class="v13-badge-glyph">([^<]*)</.exec(html)?.[1] ?? "",
            outline: /v13-badge-(recorded|expected|conditional|awaiting)/.exec(html)?.[1] ?? "",
            fill: v === "recorded" ? "tint" : "none",
            words: text.replace(/^[^\p{L}(]+/u, ""),
          },
        ];
      }),
    );
    for (let i = 0; i < variants.length; i += 1)
      for (let j = i + 1; j < variants.length; j += 1) {
        const a = features[variants[i]!]!;
        const b = features[variants[j]!]!;
        const differences = (["glyph", "outline", "fill", "words"] as const).filter(
          (k) => a[k] !== b[k],
        ).length;
        expect(differences, `${variants[i]} vs ${variants[j]}`).toBeGreaterThanOrEqual(2);
      }
  });

  it.each(LOCALES)("projected variants state their status in words (%s)", (l) => {
    expect(visibleText(badge(l, "expected"))).toContain(msg(l)["common.epistemic.expectedSuffix"]);
    expect(visibleText(badge(l, "conditional"))).toContain(msg(l)["common.epistemic.conditionalPrefix"]);
    expect(visibleText(badge(l, "awaiting_approval"))).toContain(msg(l)["common.epistemic.awaitingSuffix"]);
    expect(badge(l, "awaiting_approval")).toContain("◇⎘");
    expect(badge(l, "conditional")).toContain(
      esc(
        tr(l)("common.epistemic.conditionalJoin", {
          condition: l === "ar" ? "قرار اللجنة" : "the committee decision",
        }),
      ),
    );
  });

  it("uses the Layer A glyph for every recorded state and a neutral glyph for an unknown code", () => {
    const glyphs = LAYER_A_STATES.map(
      (s) => /class="v13-badge-glyph">([^<]*)</.exec(badge("en", "recorded", { status: s }))?.[1],
    );
    expect(glyphs).toEqual(["✔", "●", "○", "⏸", "↩", "✕", "⚠", "—"]);
    const unknown = badge("en", "recorded", { status: "DOMAIN_CODE" });
    expect(unknown).toContain(">▪<");
    expect(unknown).toContain("v13-tone-neutral");
    expect(unknown).not.toContain("v13-tone-danger");
    for (const s of LAYER_A_STATES) expect(msg("ar")[LAYER_A_LABEL_KEYS[s]]).toBeTruthy();
  });
});

describe("StatusBadge — negatives (refuse, render nothing, warn without content)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it("refuses a recorded badge without an event id (untyped caller)", () => {
    const props = {
      t: tr("en"),
      locale: "en",
      epistemic: "recorded",
      statusKind: "task",
      status: "COMPLETED",
      label: "x",
    };
    expect(render(<StatusBadge {...(props as unknown as StatusBadgeProps)} />)).toBe("");
    expect(
      render(
        <StatusBadge
          {...({ ...props, evidence: { eventId: "", recordedAt: AT } } as unknown as StatusBadgeProps)}
        />,
      ),
    ).toBe("");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("x");
  });

  it.each(["expected", "conditional", "awaiting_approval"] as const)(
    "refuses %s with a completed-class status (rule T5)",
    (v) => {
      for (const status of COMPLETED_CLASS) expect(badge("ar", v, { status })).toBe("");
    },
  );

  it.each(["expected", "conditional", "awaiting_approval"] as const)(
    "refuses %s whose words or glyphs claim completion",
    (v) => {
      for (const label of [
        "✔ مراجعة",
        "● review",
        "تم الإرسال",
        "سُجل القرار",
        "سُجِّل القرار",
        "اكتُمل التحقق",
        "Review completed",
        "Recorded step",
      ])
        expect(badge("ar", v, { label }), label).toBe("");
      if (v === "conditional") expect(badge("en", v, { condition: "it was recorded" })).toBe("");
    },
  );

  it("does not over-match ordinary words", () => {
    for (const ok of ["تمهيد", "تسجيل الدخول", "مراجعة المذكرة", "Review", "Committee approval"])
      expect(claimsCompletion(ok), ok).toBe(false);
  });

  it("keeps its completed class equal to the domain list the Procedural Truth Inspector uses", () => {
    expect([...COMPLETED_CLASS].sort()).toEqual([...COMPLETED_CLASS_STATUSES].sort());
    for (const status of COMPLETED_CLASS) expect(isCompletedClassStatus(status), status).toBe(true);
  });
});

describe("RecordedEventDate", () => {
  it.each(LOCALES)("is a <time> with the recorded-event attributes (%s)", (l) => {
    const html = render(
      <RecordedEventDate locale={l} eventId={EVT_1} statusKind="procedure" status="IN_PROGRESS" at={AT} />,
    );
    expect(html).toBe(
      `<time dateTime="${AT}" data-testid="recorded-event-date" data-epistemic="recorded" data-event-id="${EVT_1}" data-status-kind="procedure" data-status="IN_PROGRESS">${formatDateTime(l, AT)}</time>`,
    );
  });

  it("formats Gregorian dates with Arabic-Indic digits in Arabic, Riyadh time", () => {
    expect(formatDateTime("ar", AT)).toMatch(/٢٠ أكتوبر ٢٠٢٦/);
    expect(formatDateTime("en", AT)).toBe("20 October 2026 at 9:30");
    expect(() => formatDateTime("en", "yesterday")).toThrow();
  });
});

describe("DataTable", () => {
  type Row = { id: string; caseId: string; caseRef: string; title: string };
  const rows: Row[] = [
    { id: "r1", caseId: CASE_1.id, caseRef: CASE_1.ref, title: "Alpha" },
    { id: "r2", caseId: CASE_2.id, caseRef: CASE_2.ref, title: "Beta" },
  ];
  const columns = [
    {
      key: "ref",
      header: "Case",
      cell: (r: Row) => <bdi dir="ltr">{r.caseRef}</bdi>,
      rowHeader: true,
      sort: { href: "?sort=ref&dir=desc", direction: "ascending" as const },
    },
    { key: "title", header: "Title", cell: (r: Row) => r.title, sort: { href: "?sort=title" } },
    { key: "plain", header: "Plain", cell: () => "-" },
  ];

  it.each(LOCALES)("case scope: every row carries its own data-case-id and data-case-ref (%s)", (l) => {
    const html = render(
      <DataTable
        t={tr(l)}
        testId="portfolio-table"
        caption="Cases"
        scope="case"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowCaseId={(r) => r.caseId}
        rowCaseRef={(r) => r.caseRef}
        empty={<p>empty</p>}
      />,
    );
    expect(html).toContain(
      `<tr data-testid="portfolio-table-row-r1" data-case-id="${CASE_1.id}" data-case-ref="${CASE_1.ref}">`,
    );
    expect(html).toContain(
      `<tr data-testid="portfolio-table-row-r2" data-case-id="${CASE_2.id}" data-case-ref="${CASE_2.ref}">`,
    );
    expect(html).toContain(
      '<table class="v13-table" data-testid="portfolio-table"><caption><span class="v13-table-caption-text">Cases</span></caption>',
    );
    expect(html).toContain(`role="region" aria-label="${esc(msg(l)["common.scrollRegion"])}" tabindex="0"`);
    expect(html.match(/<th scope="row">/g)).toHaveLength(2);
  });

  it("sort headers are links with aria-sort; unsortable headers have none", () => {
    const html = render(
      <DataTable
        t={tr("en")}
        testId="t"
        caption="c"
        scope="none"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={null}
      />,
    );
    expect(html).toContain(
      '<th scope="col" aria-sort="ascending"><a href="?sort=ref&amp;dir=desc" class="v13-sort-link">',
    );
    expect(html).toContain('<th scope="col" aria-sort="none"><a href="?sort=title"');
    expect(html).toContain('<th scope="col">Plain</th>');
    expect(html).toContain("Sort descending");
    expect(html).not.toContain("data-case-id");
  });

  it("shows the empty state instead of an empty table", () => {
    const html = render(
      <DataTable
        t={tr("ar")}
        testId="t"
        caption="c"
        scope="none"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<EmptyState title="لا توجد قضايا" />}
      />,
    );
    expect(html).not.toContain("<table");
    expect(html).toContain('data-testid="empty-state"');
  });

  it("refuses a case row whose identity is swapped or missing", () => {
    const bad = [{ ...rows[0]!, caseId: CASE_1.ref }];
    expect(() =>
      render(
        <DataTable
          t={tr("en")}
          testId="t"
          caption="c"
          scope="case"
          columns={columns}
          rows={bad}
          rowKey={(r) => r.id}
          rowCaseId={(r) => r.caseId}
          rowCaseRef={(r) => r.caseRef}
          empty={null}
        />,
      ),
    ).toThrow(/UUID/);
  });
});

describe("Pagination", () => {
  it.each(LOCALES)("links with rel, a summary whose total is a Count (%s)", (l) => {
    const html = render(
      <Pagination
        t={tr(l)}
        locale={l}
        prevHref="?cursor=a"
        nextHref="?cursor=b"
        summary={{ from: 1, to: 10, total: 37, name: "portfolio-results" }}
      />,
    );
    expect(html).toContain(`aria-label="${esc(msg(l)["common.pagination.label"])}"`);
    expect(html).toContain('<a href="?cursor=a" rel="prev" data-testid="pagination-prev">');
    expect(html).toContain('<a href="?cursor=b" rel="next" data-testid="pagination-next">');
    expect(html).toContain('data-testid="count-portfolio-results-total" data-count="37"');
    expect(html).toContain(l === "ar" ? ">٣٧<" : ">37<");
  });

  it("marks a missing direction as disabled text, not a link, and omits an unauthorised summary", () => {
    const html = render(<Pagination t={tr("en")} locale="en" nextHref="?cursor=b" />);
    expect(html).toMatch(
      /<span aria-disabled="true" class="v13-pagination-off" data-testid="pagination-prev">/,
    );
    expect(html).not.toContain("data-count");
  });
});

describe("Timeline and ExpectedSteps", () => {
  const entries = (l: Locale): TimelineEntry[] => [
    {
      eventId: EVT_1,
      caseId: CASE_1.id,
      caseRef: CASE_1.ref,
      title: "Opened",
      occurredAt: "2026-10-01T06:00:00Z",
      recordedAt: "2026-10-01T06:00:00Z",
      status: { statusKind: "procedure", status: "IN_PROGRESS", label: msg(l)["common.layerA.inProgress"] },
    },
    {
      eventId: EVT_2,
      caseId: CASE_1.id,
      caseRef: CASE_1.ref,
      title: "Memo filed",
      occurredAt: "2026-10-05T06:00:00Z",
      recordedAt: "2026-10-06T08:00:00Z",
      actor: "Secretary",
      status: { statusKind: "task", status: "COMPLETED", label: msg(l)["common.layerA.completed"] },
    },
  ];

  it.each(LOCALES)(
    "lists recorded entries newest first, each with event, status and case attributes (%s)",
    (l) => {
      const html = render(
        <Timeline t={tr(l)} locale={l} label="Events" entries={entries(l)} testId="case-timeline" />,
      );
      expect(html).toMatch(/^<ol class="v13-timeline" aria-label="Events" data-testid="case-timeline">/);
      expect(html.indexOf(EVT_2)).toBeLessThan(html.indexOf(EVT_1));
      expect(html).toContain(
        `data-testid="timeline-entry-${EVT_2}" data-epistemic="recorded" data-event-id="${EVT_2}" data-status-kind="task" data-status="COMPLETED" data-case-id="${CASE_1.id}" data-case-ref="${CASE_1.ref}"`,
      );
      // Times differ → both, with words; equal → only "recorded".
      expect(html).toContain(
        esc(tr(l)("common.time.occurred", { time: formatDateTime(l, "2026-10-05T06:00:00Z") })),
      );
      expect(html).not.toContain(
        esc(tr(l)("common.time.occurred", { time: formatDateTime(l, "2026-10-01T06:00:00Z") })),
      );
      expect(html).not.toMatch(/data-epistemic="(expected|conditional|awaiting_approval)"/);
    },
  );

  it("refuses an entry with a swapped case identity or no event id", () => {
    const bad = [{ ...entries("en")[0]!, caseRef: CASE_1.id }];
    expect(() => render(<Timeline t={tr("en")} locale="en" label="E" entries={bad} />)).toThrow();
    const noEvent = [{ ...entries("en")[0]!, eventId: "" }];
    expect(() => render(<Timeline t={tr("en")} locale="en" label="E" entries={noEvent} />)).toThrow(
      /event id/,
    );
  });

  it.each(LOCALES)(
    "expected steps are a separate list with its own heading and only projected badges (%s)",
    (l) => {
      const html = render(
        <ExpectedSteps
          t={tr(l)}
          locale={l}
          steps={[
            { key: "a", epistemic: "expected", statusKind: "task", status: "PENDING", label: "Hearing" },
            {
              key: "b",
              epistemic: "awaiting_approval",
              statusKind: "decision",
              status: "PENDING",
              label: "Decision",
            },
          ]}
        />,
      );
      expect(html).toContain(
        `<h2 id="expected-steps-title">${msg(l)["common.epistemic.expectedHeading"]}</h2>`,
      );
      expect(html).toContain('data-testid="expected-steps"');
      expect(html).not.toContain('data-epistemic="recorded"');
      expect(html.match(/data-epistemic=/g)).toHaveLength(2);
      expect(render(<ExpectedSteps t={tr(l)} locale={l} steps={[]} />)).toBe("");
    },
  );
});

describe("Procedural Truth Inspector over rendered components", () => {
  const facts = [
    {
      eventId: EVT_1,
      caseId: CASE_1.id,
      statusKind: "procedure",
      status: "IN_PROGRESS",
      recordedAt: "2026-10-01T06:00:00Z",
    },
    {
      eventId: EVT_2,
      caseId: CASE_1.id,
      statusKind: "task",
      status: "COMPLETED",
      recordedAt: "2026-10-06T08:00:00Z",
    },
  ];
  const page = (l: Locale) =>
    render(
      <CaseWorkspace caseId={CASE_1.id} caseRef={CASE_1.ref}>
        <StatusBadge
          t={tr(l)}
          locale={l}
          epistemic="recorded"
          statusKind="procedure"
          status="IN_PROGRESS"
          label={msg(l)["common.layerA.inProgress"]}
          evidence={{ eventId: EVT_1, recordedAt: facts[0]!.recordedAt }}
        />
        <RecordedEventDate
          locale={l}
          eventId={EVT_2}
          statusKind="task"
          status="COMPLETED"
          at={facts[1]!.recordedAt}
        />
        <Timeline
          t={tr(l)}
          locale={l}
          label="Events"
          entries={[
            {
              eventId: EVT_2,
              caseId: CASE_1.id,
              caseRef: CASE_1.ref,
              title: "Memo",
              occurredAt: facts[1]!.recordedAt,
              recordedAt: facts[1]!.recordedAt,
              status: { statusKind: "task", status: "COMPLETED", label: msg(l)["common.layerA.completed"] },
            },
          ]}
        />
        <ExpectedSteps
          t={tr(l)}
          locale={l}
          steps={[
            {
              key: "n",
              epistemic: "expected",
              statusKind: "task",
              status: "PENDING",
              label: msg(l)["common.layerA.pending"],
            },
          ]}
        />
        <StatusBadge
          t={tr(l)}
          locale={l}
          epistemic="recorded"
          statusKind="task"
          status="PENDING"
          label={msg(l)["common.layerA.pending"]}
          evidence={{ eventId: EVT_1, recordedAt: facts[0]!.recordedAt }}
        />
      </CaseWorkspace>,
    );

  it.each(LOCALES)(
    "finds no violation in correctly composed components except the planted one (%s)",
    async (l) => {
      const nodes = epistemicNodes(page(l));
      expect(nodes.length).toBeGreaterThanOrEqual(6);
      const violations = await checkTruth(nodes, inMemoryOracle(facts), new Date("2026-10-28T00:00:00Z"));
      // The last badge cites EVT_1 for a status EVT_1 did not set: the inspector must catch it, and only it.
      expect(violations.map((v) => v.rule)).toEqual(["T4"]);
      // The expected PENDING step does not read like the recorded PENDING badge (T6).
      expect(violations.some((v) => v.rule === "T6")).toBe(false);
    },
  );
});

describe("States", () => {
  it.each(LOCALES)(
    "ErrorState: generic words, correlation id in <code> inside <bdi dir=ltr>, alert only after a user action (%s)",
    (l) => {
      const html = render(<ErrorState t={tr(l)} correlationId="corr-0001" retryHref="/my-work" />);
      expect(html).toContain('data-testid="error-state"');
      expect(html).not.toContain('role="alert"');
      expect(html).toContain(msg(l)["common.error.title"]);
      expect(html).toContain('<bdi dir="ltr"><code data-testid="correlation-id">corr-0001</code></bdi>');
      expect(render(<ErrorState t={tr(l)} correlationId="c" afterUserAction />)).toContain('role="alert"');
    },
  );

  it("NotFoundState is byte-identical apart from the correlation id (unknown, restricted, other workspace)", () => {
    const props = { title: "t", body: "b", backHref: "/my-work", backLabel: "back", correlationLabel: "ref" };
    const a = render(<NotFoundState {...props} correlationId="AAAA" />);
    const b = render(<NotFoundState {...props} correlationId="BBBB" />);
    expect(a.replace("AAAA", "X")).toBe(b.replace("BBBB", "X"));
    expect(a.match(/<h1/g)).toHaveLength(1);
    expect(a).toContain('data-testid="not-found-state"');
  });

  it.each(LOCALES)(
    "LoadingState: aria-busy status with a hidden label and decorative skeletons (%s)",
    (l) => {
      const html = render(<LoadingState t={tr(l)} rows={2} />);
      expect(html).toMatch(
        /^<div class="v13-state-loading" role="status" aria-busy="true" data-testid="loading-state">/,
      );
      expect(html).toContain(`<span class="v13-sr-only">${msg(l)["common.loading"]}</span>`);
      expect(html.match(/aria-hidden="true" class="v13-skeleton"/g)).toHaveLength(2);
    },
  );

  it("EmptyState: title, optional body and action", () => {
    const html = render(<EmptyState title="Nothing" body="Why" action={<a href="/x">x</a>} />);
    expect(html).toContain('data-testid="empty-state"');
    expect(html).toContain("Why");
  });
});

describe("DeadlineText", () => {
  const NOW = "2026-10-28T05:00:00Z"; // 08:00 Riyadh
  it.each(LOCALES)("overdue, today and upcoming, in words with plural forms (%s)", (l) => {
    const overdue = render(<DeadlineText t={tr(l)} locale={l} due="2026-10-25T05:00:00Z" now={NOW} />);
    expect(overdue).toContain('data-deadline-state="overdue"');
    expect(overdue).toContain("⚠");
    expect(overdue).toContain(esc(tr(l)("common.deadline.overdue", { days: formatDays(l, tr(l), 3) })));
    expect(render(<DeadlineText t={tr(l)} locale={l} due="2026-10-28T20:00:00Z" now={NOW} />)).toContain(
      'data-deadline-state="today"',
    );
    const soon = render(<DeadlineText t={tr(l)} locale={l} due="2026-11-02T05:00:00Z" now={NOW} />);
    expect(soon).toContain('data-deadline-state="upcoming"');
    expect(soon).not.toContain("⚠");
  });

  it("counts Riyadh calendar days and uses Arabic plural forms", () => {
    // 22:30 UTC on the 27th is already the 28th in Riyadh.
    expect(calendarDaysBetween("2026-10-27T22:30:00Z", "2026-10-28T05:00:00Z")).toBe(0);
    expect(calendarDaysBetween("2026-10-28T05:00:00Z", "2026-10-25T05:00:00Z")).toBe(-3);
    const t = tr("ar");
    expect(formatDays("ar", t, 1)).toBe("يوم واحد");
    expect(formatDays("ar", t, 2)).toBe("يومان");
    expect(formatDays("ar", t, 3)).toBe("٣ أيام");
    expect(formatDays("ar", t, 11)).toBe("١١ يومًا");
    expect(formatDays("en", tr("en"), 1)).toBe("1 day");
    expect(formatDays("en", tr("en"), 5)).toBe("5 days");
  });
});

describe("Buttons, dialog and filter bar", () => {
  it("Button variants are square-cornered classes; type defaults to button", () => {
    expect(
      render(
        <Button variant="primary" testId="b">
          x
        </Button>,
      ),
    ).toBe('<button type="button" class="v13-btn v13-btn-primary" data-testid="b">x</button>');
    expect(
      render(
        <ButtonLink variant="secondary" href="/a">
          a
        </ButtonLink>,
      ),
    ).toBe('<a class="v13-btn v13-btn-secondary" href="/a">a</a>');
  });

  it("ConfirmDialog: native dialog labelled by its title, confirm submits hidden ids, cancel is a plain button", () => {
    const html = render(
      <ConfirmDialog
        triggerLabel="Open"
        title="Sure?"
        body="Body"
        confirmLabel="Yes"
        cancelLabel="No"
        action={noop}
        fields={{ caseId: CASE_1.id }}
        critical
      />,
    );
    expect(html).toContain(
      '<dialog class="v13-dialog" aria-labelledby="confirm-dialog-title" data-testid="confirm-dialog">',
    );
    expect(html).toContain(`<input type="hidden" name="caseId" value="${CASE_1.id}"/>`);
    expect(html).toMatch(
      /<button type="submit" class="v13-btn v13-btn-critical" data-testid="confirm-dialog-confirm">Yes<\/button>/,
    );
    expect(html).toMatch(
      /<button type="button" class="v13-btn v13-btn-secondary" data-testid="confirm-dialog-cancel">No<\/button>/,
    );
  });

  it.each(LOCALES)("FilterBar: a GET form with apply and a clear link (%s)", (l) => {
    const html = render(
      <FilterBar t={tr(l)} action="/portfolio" clearHref="/portfolio" label="Filters">
        <input name="q" aria-label="q" />
      </FilterBar>,
    );
    expect(html).toMatch(/^<form [^>]*data-testid="filter-bar"/);
    expect(html).toContain('action="/portfolio" method="get"');
    expect(html).toContain(msg(l)["common.apply"]);
    expect(html).toContain('<a href="/portfolio" class="v13-btn v13-btn-text" data-testid="filter-clear">');
  });
});

describe("strings (STRINGS.md rules)", () => {
  it("no projected-state string uses recorded/completed words", () => {
    for (const l of LOCALES)
      for (const key of [
        "common.epistemic.expectedSuffix",
        "common.epistemic.expectedAria",
        "common.epistemic.conditionalPrefix",
        "common.epistemic.conditionalJoin",
        "common.epistemic.conditionalAria",
        "common.epistemic.awaitingSuffix",
        "common.epistemic.awaitingAria",
        "common.epistemic.expectedHeading",
      ] as const)
        expect(claimsCompletion(msg(l)[key]), `${l} ${key}`).toBe(false);
  });

  it("every {placeholder} in Arabic exists in English and vice versa (common, shell)", () => {
    const vars = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(msg("ar")).filter(
      (k) => k.startsWith("common.") || k.startsWith("shell."),
    ) as (keyof ReturnType<typeof msg>)[])
      expect(vars(msg("en")[key]), key).toEqual(vars(msg("ar")[key]));
  });
});
