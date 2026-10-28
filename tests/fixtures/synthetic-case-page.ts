// SYNTHETIC fixture pages for the Sentinel and Truth Inspector self-tests. They are static HTML built here and served
// by Playwright routing on a test-only origin; they never touch the application or the database. The case ids and
// references mirror the M1 seed shape (database/seed/0001_m1_synthetic.sql) so plants look like real leaks.
import type { Page } from "@playwright/test";

export const FIXTURE_ORIGIN = "http://fixture.v13.test";

export const CASES = {
  c0001: { id: "0c000000-0000-4000-8000-000000000001", ref: "CDF-DEMO-2026-0001" },
  c0002: { id: "0c000000-0000-4000-8000-000000000002", ref: "CDF-DEMO-2026-0002" },
  c0003: { id: "0c000000-0000-4000-8000-000000000003", ref: "CDF-DEMO-2026-0003" },
  c0009: { id: "0c000000-0000-4000-8000-000000000009", ref: "CDF-DEMO-2026-0009" }, // restricted
} as const;

export const ALL_CASE_IDS = new Set(Object.values(CASES).map((c) => c.id));

export const EVENTS = {
  e0001stage: "0e000000-0000-4000-8000-000000000101",
  e0001task: "0e000000-0000-4000-8000-000000000102",
  e0002stage: "0e000000-0000-4000-8000-000000000201",
} as const;

export interface CasePageOptions {
  /** Raw HTML inserted at the end of the case-workspace root (plants go here). */
  insideWorkspace?: string;
  /** Raw HTML inserted after the root, still inside <main>. */
  afterWorkspace?: string;
  /** Body of /rsc-payload, fetched by the page after load (RSC flight stand-in). */
  rscPayload?: string;
}

const badge = (attrs: Record<string, string | undefined>, text: string) =>
  `<span ${Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ")}>${text}</span>`;

export const recordedBadge = (eventId: string, statusKind: string, status: string, text: string) =>
  badge(
    {
      "data-testid": "status-badge",
      "data-epistemic": "recorded",
      "data-event-id": eventId,
      "data-status-kind": statusKind,
      "data-status": status,
    },
    text,
  );

export const expectedBadge = (statusKind: string, status: string, text: string) =>
  badge(
    {
      "data-testid": "status-badge",
      "data-epistemic": "expected",
      "data-status-kind": statusKind,
      "data-status": status,
    },
    text,
  );

/** A clean case workspace for case 0001: header, a recorded stage, a recorded task, an expected next step, a count. */
export function caseWorkspaceHtml(opts: CasePageOptions = {}): string {
  const c = CASES.c0001;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${c.ref} · نظرة عامة</title></head>
<body><div data-testid="synthetic-banner" role="note">بيئة تجريبية ببيانات اصطناعية فقط</div>
<main id="main">
  <div data-testid="case-workspace" data-case-id="${c.id}" data-case-ref="${c.ref}">
    <header data-testid="case-header" data-case-id="${c.id}" data-case-ref="${c.ref}">
      <bdi dir="ltr" data-testid="case-number">${c.ref}</bdi>
      <span data-testid="case-stage">${recordedBadge(EVENTS.e0001stage, "procedure", "IN_PROGRESS", "قيد التحقيق — تم تسجيله")}</span>
    </header>
    <h1>نظرة عامة</h1>
    <table data-testid="case-tasks-table"><tbody>
      <tr data-testid="case-tasks-row-1" data-case-id="${c.id}" data-case-ref="${c.ref}">
        <td>جمع الأدلة</td><td>${recordedBadge(EVENTS.e0001task, "task", "COMPLETED", "اكتمل — تم تسجيله")}</td>
      </tr>
    </tbody></table>
    <section data-testid="expected-steps">${expectedBadge("procedure", "COMMITTEE_DELIBERATION", "مداولة اللجنة (متوقع)")}</section>
    <p>المهام المفتوحة: <span data-testid="count-case-open-tasks" data-count="2">٢</span></p>
    ${opts.insideWorkspace ?? ""}
  </div>
  ${opts.afterWorkspace ?? ""}
</main>
<script>fetch("/rsc-payload").then(r => r.text()).then(t => { document.body.dataset.rsc = String(t.length); });</script>
</body></html>`;
}

/** A clean cross-case list (portfolio-like) for a persona who sees 0001, 0002 and 0003. */
export function portfolioHtml(extraRows = ""): string {
  const rows = [CASES.c0001, CASES.c0002, CASES.c0003]
    .map(
      (c) =>
        `<tr data-testid="portfolio-row-${c.id}" data-case-id="${c.id}" data-case-ref="${c.ref}"><th scope="row"><a href="/cases/${c.id}"><bdi dir="ltr">${c.ref}</bdi></a></th><td>قضية تجريبية</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>محفظة القضايا</title></head>
<body><main id="main"><h1>محفظة القضايا</h1>
<p><span data-testid="count-portfolio-results" data-count="3">٣</span> قضايا</p>
<table data-testid="portfolio-table"><tbody>${rows}${extraRows}</tbody></table></main></body></html>`;
}

/** Serves `html` at FIXTURE_ORIGIN + path, plus /rsc-payload, and navigates there. */
export async function openFixture(
  page: Page,
  path: string,
  html: string,
  rscPayload = "0:[]\n",
): Promise<void> {
  await page.route(`${FIXTURE_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/rsc-payload")
      return route.fulfill({ status: 200, contentType: "text/x-component", body: rscPayload });
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  });
  await page.goto(`${FIXTURE_ORIGIN}${path}`);
  await page.waitForFunction(
    () => document.body.dataset.rsc !== undefined || !document.querySelector("script"),
  );
}
