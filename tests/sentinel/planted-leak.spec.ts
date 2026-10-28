// Acceptance self-test of the Case Context Sentinel (V13-QA-003): a clean page passes, and every planted cross-case
// leak makes it fail with the right rule. Fixture pages only (tests/fixtures/synthetic-case-page.ts); no application
// code or database is involved, so a Sentinel that cannot see a leak fails here before it is trusted on real pages.
import { expect, test } from "@playwright/test";
import {
  ALL_CASE_IDS,
  CASES,
  FIXTURE_ORIGIN,
  caseWorkspaceHtml,
  openFixture,
  portfolioHtml,
} from "../fixtures/synthetic-case-page";
import { formatViolations, inspectCaseContext, recordPayloads, type PayloadAllowance } from "./sentinel";

const c1 = CASES.c0001;
const casePath = `/cases/${c1.id}`;
const visibleToAlpha = new Map([CASES.c0001, CASES.c0002, CASES.c0003].map((c) => [c.id, c.ref] as const));
const allowOn0001: PayloadAllowance = {
  caseIds: new Set([c1.id]),
  caseRefs: new Set([c1.ref]),
  knownCaseIds: ALL_CASE_IDS,
};

const rulesOf = (vs: { rule: string }[]) => [...new Set(vs.map((v) => v.rule))].sort();

test.describe("clean fixtures pass", () => {
  test("case workspace of 0001", async ({ page }) => {
    const payloads = recordPayloads(page, FIXTURE_ORIGIN);
    await openFixture(page, casePath, caseWorkspaceHtml());
    const dom = await inspectCaseContext(page, { contextCaseId: c1.id, visible: visibleToAlpha });
    expect(dom, formatViolations(dom)).toEqual([]);
    const p = await payloads.violations(allowOn0001);
    expect(p, formatViolations(p)).toEqual([]);
    expect(await payloads.count()).toBeGreaterThanOrEqual(2); // the document and the RSC stand-in were scanned
  });

  test("portfolio list of three visible cases", async ({ page }) => {
    await openFixture(page, "/portfolio", portfolioHtml());
    const dom = await inspectCaseContext(page, { visible: visibleToAlpha });
    expect(dom, formatViolations(dom)).toEqual([]);
  });
});

test.describe("planted leaks are detected", () => {
  test("(a) another case's element inside the case workspace → S1 and S5", async ({ page }) => {
    const c2 = CASES.c0002;
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: `<div data-testid="notification-row-x" data-case-id="${c2.id}" data-case-ref="${c2.ref}">إشعار</div>`,
      }),
    );
    const v = await inspectCaseContext(page, { contextCaseId: c1.id, visible: visibleToAlpha });
    expect(rulesOf(v)).toEqual(expect.arrayContaining(["S1", "S5"]));
  });

  test("(b) another case's reference in visible text → S4", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({ insideWorkspace: `<p>انظر أيضًا <bdi dir="ltr">${CASES.c0003.ref}</bdi></p>` }),
    );
    const v = await inspectCaseContext(page, { contextCaseId: c1.id });
    expect(rulesOf(v)).toEqual(["S4"]);
  });

  test("(b′) another case's reference hidden in an accessible label → S4", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({ insideWorkspace: `<button aria-label="فتح ${CASES.c0002.ref}">فتح</button>` }),
    );
    expect(rulesOf(await inspectCaseContext(page, { contextCaseId: c1.id }))).toEqual(["S4"]);
  });

  test("(c) restricted 0009's id in an RSC payload → P1, while the DOM stays clean", async ({ page }) => {
    const payloads = recordPayloads(page, FIXTURE_ORIGIN);
    await openFixture(page, casePath, caseWorkspaceHtml(), `1:{"caseId":"${CASES.c0009.id}"}\n`);
    expect(await inspectCaseContext(page, { contextCaseId: c1.id })).toEqual([]);
    const p = await payloads.violations(allowOn0001);
    expect(rulesOf(p)).toEqual(["P1"]);
    expect(formatViolations(p)).toContain(CASES.c0009.id);
  });

  test("(c′) restricted 0009's reference in the document HTML (not rendered) → P1", async ({ page }) => {
    const payloads = recordPayloads(page, FIXTURE_ORIGIN);
    await openFixture(page, casePath, caseWorkspaceHtml({ afterWorkspace: `<!-- ${CASES.c0009.ref} -->` }));
    expect(await inspectCaseContext(page, { contextCaseId: c1.id })).toEqual([]);
    expect(rulesOf(await payloads.violations(allowOn0001))).toEqual(["P1"]);
  });

  test("(d) a case outside the persona's visibility in a list → S6", async ({ page }) => {
    const c9 = CASES.c0009;
    await openFixture(
      page,
      "/portfolio",
      portfolioHtml(`<tr data-case-id="${c9.id}" data-case-ref="${c9.ref}"><th>${c9.ref}</th></tr>`),
    );
    expect(rulesOf(await inspectCaseContext(page, { visible: visibleToAlpha }))).toEqual(["S6"]);
  });

  test("(e) a row without data-case-ref, and a reference used for two ids → S2 and S3", async ({ page }) => {
    await openFixture(
      page,
      "/portfolio",
      portfolioHtml(
        `<tr data-case-id="${CASES.c0002.id}"><th>x</th></tr>` +
          `<tr data-case-id="${CASES.c0003.id}" data-case-ref="${c1.ref}"><th>y</th></tr>`,
      ),
    );
    expect(rulesOf(await inspectCaseContext(page, {}))).toEqual(["S2", "S3"]);
  });

  test("(f) case page without its case-workspace root → S5", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml().replace('data-testid="case-workspace"', 'data-testid="x"'),
    );
    expect(rulesOf(await inspectCaseContext(page, { contextCaseId: c1.id }))).toEqual(["S5"]);
  });

  test("(g) a count without an integer data-count → S7", async ({ page }) => {
    await openFixture(page, "/portfolio", portfolioHtml().replace('data-count="3"', 'data-count="many"'));
    expect(rulesOf(await inspectCaseContext(page, {}))).toEqual(["S7"]);
  });
});
