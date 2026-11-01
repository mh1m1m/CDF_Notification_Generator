// V13-UX-015 (REQ-IA-009): the Next Action Card on PROC's contract (docs/teams/proc/NEXT_ACTION_SOURCES.md §4).
// NONE renders nothing; a TASK shows its title as escaped text in <bdi>, its status as FE renders it, its recorded due
// date (never an invented one) and a link to the task; the card carries no other persona, task, case or count.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextActionCard, type NextActionCardTask } from "@/components/data/NextActionCard";
import { createTranslator, type Locale } from "@/lib/i18n";

const TASK_ID = "0d000000-0000-4000-8000-000000000001";
const HREF = `#task-${TASK_ID}`;

const task = (over: Partial<NextActionCardTask> = {}): NextActionCardTask => ({
  taskId: TASK_ID,
  taskCode: "PREPARE_EVIDENCE_SUMMARY",
  title: { ar: "إعداد ملخص الأدلة", en: "Prepare the evidence summary" },
  status: <span data-testid="case-task-status">OPEN</span>,
  due: { date: "2026-11-03", days: 2 },
  href: HREF,
  ...over,
});

const render = (locale: Locale, action: NextActionCardTask | null) =>
  renderToStaticMarkup(<NextActionCard t={createTranslator(locale)} locale={locale} action={action} />);

describe("NextActionCard: NONE", () => {
  it.each(["ar", "en"] as const)(
    "renders nothing at all in %s (no element, no heading, no line)",
    (locale) => {
      expect(render(locale, null)).toBe("");
    },
  );
});

describe("NextActionCard: a task", () => {
  it.each([
    ["ar", "إجراؤك التالي", "إعداد ملخص الأدلة", "الحالة", "تاريخ الاستحقاق"],
    ["en", "Your next action", "Prepare the evidence summary", "Status", "Due date"],
  ] as const)(
    "in %s: a labelled section with the heading, the title link, status and due date",
    (locale, ...words) => {
      const html = render(locale, task());
      const [heading, title, status, due] = words;
      expect(html).toMatch(/^<section class="v13-next-action" aria-labelledby="next-action-heading"/);
      expect(html).toContain(`<h2 id="next-action-heading" class="v13-next-action-heading">${heading}</h2>`);
      expect(html).toContain(`<a href="${HREF}" data-testid="next-action-link"><bdi>${title}</bdi></a>`);
      expect(html).toContain(`<dt>${status}</dt><dd data-testid="next-action-status">`);
      expect(html).toContain(`<dt>${due}</dt><dd data-testid="next-action-due">`);
      expect(html).toContain(`data-task-id="${TASK_ID}"`);
      expect(html).toContain('data-task-code="PREPARE_EVIDENCE_SUMMARY"');
      expect(html.replace(/data-task-code="[^"]*"/, "")).not.toContain("PREPARE_EVIDENCE_SUMMARY");
    },
  );

  it("shows the title in the page language only", () => {
    expect(render("ar", task())).not.toContain("Prepare the evidence summary");
    expect(render("en", task())).not.toContain("إعداد ملخص الأدلة");
  });

  it("shows the status FE rendered, unchanged", () => {
    expect(render("en", task())).toContain(
      '<dd data-testid="next-action-status"><span data-testid="case-task-status">OPEN</span></dd>',
    );
  });

  it("shows the recorded due date with DeadlineText's words and state", () => {
    const html = render("en", task({ due: { date: "2026-10-30", days: -2 } }));
    expect(html).toContain('data-deadline-state="overdue"');
    expect(html).toContain('<time dateTime="2026-10-30">');
    expect(html).toContain("Overdue by 2 days");
  });

  it("with no recorded due date, shows no due line and invents no date", () => {
    const html = render("en", task({ due: null }));
    expect(html).not.toContain("next-action-due");
    expect(html).not.toContain("Due date");
    expect(html).not.toContain("<time");
  });

  it("escapes the title: recorded text is text, never markup", () => {
    const html = render("en", task({ title: { ar: "x", en: '<img src=x onerror="alert(1)">' } }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("carries only this task: no case id, persona, other task or count in the markup (in-page link only)", () => {
    const html = render("en", task());
    const uuids = [...html.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map(
      (m) => m[0],
    );
    // Only this task's id: on the card and in FE's in-page link.
    expect(new Set(uuids)).toEqual(new Set([TASK_ID]));
    expect(html).not.toMatch(/data-count|persona/);
  });

  it("is the page's only use of the heading id (one card per page)", () => {
    expect(render("ar", task()).match(/id="next-action-heading"/g)).toHaveLength(1);
  });
});

describe("NextActionCard: stylesheet", () => {
  const css = readFileSync("styles/globals.css", "utf8");
  const block = (selector: string) => {
    const m = new RegExp(`\\s${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1]!;
  };

  it("marks the card by more than colour: a start-side bar and a bold title", () => {
    expect(block(".v13-next-action")).toMatch(/border-inline-start:\s*4px solid var\(--cdf-primary\)/);
    expect(block(".v13-next-action-title")).toMatch(/font-weight:\s*700/);
  });

  it("wraps instead of scrolling at 320 px (WCAG 1.4.10)", () => {
    expect(block(".v13-next-action")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(block(".v13-next-action")).toMatch(/max-inline-size:\s*100%/);
    expect(block(".v13-next-action-facts")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("underlines the title link (WCAG 1.4.1)", () => {
    expect(block(".v13-next-action-title a")).toMatch(/text-decoration-line:\s*underline/);
  });
});
