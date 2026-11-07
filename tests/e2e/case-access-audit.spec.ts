// Case-access audit in a real browser against a production build (V13-QA-022; DB-023 D1, REQ-AUD-001; FE-017).
// A link prefetch is not an open: viewing the portfolio and My Work, with every case link in view and hovered, records
// no access row and counts no open. A page request is one open: a document load, a client navigation, a reload and a
// tab change each record exactly one. Restricted case 0009 is never windowed (every open is a row), so its rows are
// counted exactly; for 0001 the 300 s window may turn an open into a suppressed count, so opens are counted as rows +
// carried counts + the window's change (tests/fixtures/db.ts, opensBetween). The oracle is FE's production-build measurement
// on #147: 7 rows from viewing the portfolio and 2 per page before the fix, 0 and 1 after.
//
// The ledger is read as the local administrator, read-only (no persona may read it). The spec runs in its own project,
// after every other browser test, so no other spec opens a case for Investigator Beta while it counts
// (playwright.config.ts). A positive control proves the browser really prefetched case routes, so a build that stops
// prefetching cannot pass the first test vacuously. SYNTHETIC data only.
import { expect, test, type Page, type Request } from "@playwright/test";
import {
  databaseEventOracle,
  ledger,
  opensBetween,
  scenarioDb,
  visibleCases,
  type AccessRow,
  type Ledger,
  type ScenarioDb,
} from "../fixtures/db";
import { persona, signInAs } from "../fixtures/personas";
import { caseId, casePath, expectCaseShown } from "../fixtures/scenario";

// One after the other in one worker (both count Beta's rows), and a failure does not skip the other test.
test.describe.configure({ mode: "default" });

const BETA = "investigator-beta";
const WS = "INVESTIGATIONS" as const;
const BETA_ID = persona(BETA).persona_id;
const BETA_SEES = ["01", "02", "03", "05", "06", "09", "10"].map(caseId);
const ONE = caseId("01");
const RESTRICTED = caseId("09");

let db: ScenarioDb;
let audit: Ledger;
test.beforeAll(() => {
  db = scenarioDb();
  audit = ledger();
});
test.afterAll(async () => {
  await db?.end();
  await audit?.end();
});

const caseRoute = /\/cases\/([0-9a-f-]{36})(?:\/(?:events|tasks|notifications))?(?:\?|$)/;

/** Requests the router made for a case route without navigating to it: the prefetches. */
function recordPrefetches(page: Page): Set<string> {
  const prefetched = new Set<string>();
  page.on("request", (r: Request) => {
    const m = caseRoute.exec(new URL(r.url()).pathname + new URL(r.url()).search);
    const h = r.headers();
    if (m && (h["next-router-prefetch"] !== undefined || h["next-router-segment-prefetch"] !== undefined))
      prefetched.add(m[1]!);
  });
  return prefetched;
}

/** Ids only, as migration 0015 writes them: the case (or the notification) and an empty or suppressed-only metadata. */
function expectIdsOnly(rows: readonly AccessRow[]) {
  for (const r of rows) {
    expect(r.outcome).toBe("SUCCEEDED");
    expect(r.entity_type).toBe("case");
    expect(r.entity_id).toBe(r.case_id);
    expect(Object.keys(r.metadata).filter((k) => k !== "suppressed")).toEqual([]);
  }
}

const describeRows = (rows: readonly AccessRow[]) =>
  rows.map((r) => `${r.seq} ${r.action} ${r.case_id ?? "-"} ${JSON.stringify(r.metadata)}`).join("\n") ||
  "(none)";

test("a prefetch records no access row: the portfolio and My Work with every case link in view and hovered", async ({
  page,
}) => {
  const cases = await visibleCases(db, BETA, WS);
  expect([...cases.keys()].sort(), "Beta's visible cases (DATA_MODEL §5)").toEqual(BETA_SEES);

  await signInAs(page, BETA);
  await page.waitForLoadState("networkidle");
  const before = new Map<string, number>();
  for (const id of BETA_SEES) before.set(id, await audit.windowSuppressed(BETA_ID, id, "CASE_OPENED", id));
  const mark = await audit.mark();
  const prefetched = recordPrefetches(page);

  await page.goto("/portfolio");
  const links = page.locator('[data-testid^="portfolio-open-"]');
  await expect(links).toHaveCount(BETA_SEES.length);
  for (const link of await links.all()) {
    await link.scrollIntoViewIfNeeded();
    await link.hover();
  }
  await page.waitForLoadState("networkidle");

  await page.goto("/my-work");
  for (const link of await page.locator('[data-testid^="my-work-case-"]').all()) {
    await link.scrollIntoViewIfNeeded();
    await link.hover();
  }
  await page.waitForLoadState("networkidle");

  // The control: the router did prefetch case routes (otherwise "no row" would prove nothing).
  expect(prefetched.size, "case routes the browser prefetched").toBeGreaterThan(0);
  for (const id of prefetched) expect(BETA_SEES, "a prefetched case is one Beta may see").toContain(id);

  const rows = await audit.accessRowsSince(mark, BETA_ID);
  expect(rows, `access rows after viewing the lists:\n${describeRows(rows)}`).toEqual([]);
  for (const id of BETA_SEES)
    expect(await audit.windowSuppressed(BETA_ID, id, "CASE_OPENED", id), `opens counted for ${id}`).toBe(
      before.get(id),
    );
});

test("a page request records exactly one: document load, client navigation, reload and tab change", async ({
  page,
}) => {
  const cases = await visibleCases(db, BETA, WS);
  const visible = new Map([...cases].map(([id, c]) => [id, c.ref]));
  const oracle = databaseEventOracle(db, BETA, WS);
  await signInAs(page, BETA);
  await page.waitForLoadState("networkidle");

  // Restricted 0009: every open is a row (never windowed), so each step adds exactly one.
  const restrictedStep = async (label: string, step: () => Promise<void>) => {
    const mark = await audit.mark();
    await step();
    await expectCaseShown(page, RESTRICTED, "overview", visible, oracle);
    await page.waitForLoadState("networkidle");
    const rows = await audit.accessRowsSince(mark, BETA_ID);
    expect(
      rows.map((r) => [r.action, r.case_id]),
      `${label}:\n${describeRows(rows)}`,
    ).toEqual([["RESTRICTED_CASE_OPENED", RESTRICTED]]);
    expectIdsOnly(rows);
    expect(rows[0]!.metadata, `${label}: a restricted row carries no count`).toEqual({});
  };
  await restrictedStep("document load of 0009", async () => {
    await page.goto(casePath(RESTRICTED));
  });
  await restrictedStep("reload of 0009", async () => {
    await page.reload();
  });
  await page.goto("/portfolio");
  await page.getByTestId(`portfolio-open-${RESTRICTED}`).hover();
  await page.waitForLoadState("networkidle");
  await restrictedStep("client navigation from the portfolio to 0009 (after its prefetch)", async () => {
    await page.getByTestId(`portfolio-open-${RESTRICTED}`).click();
  });

  // 0001: an open is a row or a suppressed count in the 300 s window; each step is exactly one open.
  const openStep = async (label: string, tab: "overview" | "tasks", step: () => Promise<void>) => {
    const before = await audit.windowSuppressed(BETA_ID, ONE, "CASE_OPENED", ONE);
    const mark = await audit.mark();
    await step();
    await expectCaseShown(page, ONE, tab, visible, oracle);
    await page.waitForLoadState("networkidle");
    const rows = await audit.accessRowsSince(mark, BETA_ID);
    expect(
      rows.map((r) => [r.action, r.case_id]),
      `${label}: only 0001's CASE_OPENED rows:\n${describeRows(rows)}`,
    ).toEqual(rows.map(() => ["CASE_OPENED", ONE]));
    expectIdsOnly(rows);
    const after = await audit.windowSuppressed(BETA_ID, ONE, "CASE_OPENED", ONE);
    expect(
      opensBetween(rows, before, after),
      `${label}: opens (rows ${rows.length}, window ${before} → ${after})`,
    ).toBe(1);
  };
  await openStep("document load of 0001", "overview", async () => {
    await page.goto(casePath(ONE));
  });
  await openStep("tab change on 0001", "tasks", async () => {
    await page.getByTestId("case-tab-tasks").click();
  });
  await openStep("reload of 0001", "tasks", async () => {
    await page.reload();
  });
});
