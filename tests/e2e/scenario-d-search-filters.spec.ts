// Scenario D — search and filters, M1 basics (V13-QA-002; TEST_ARCHITECTURE.md §6, UXQA-04).
// Investigator Gamma (INVESTIGATIONS) filters the portfolio by stage, records state and "mine" through the GET form,
// opens a case and comes back. Filters live in the URL only and survive the round trip and a reload; rows and the
// authorised count equal the database, read in Gamma's own security context, for every stage × state combination.
// Restricted case 0009 is visible in the workspace but Gamma is not assigned: it is absent from rows and counts, also
// when its own stage is selected and when its number is searched; Investigator Beta (assigned) sees it, as a control.
// Negatives: the display number as a case URL and a random UUID give the same 404 page; an edited filter value gives
// the generic invalid-filter state with a correlation id and no rows. The seed has at most seven cases per persona and
// the page size is 25, so there is one page and no paging links (paging itself waits for a larger synthetic seed).
// SYNTHETIC data only.
import { expect, test, type Page } from "@playwright/test";
import { databaseEventOracle, scenarioDb, visibleCases, type CaseRow, type ScenarioDb } from "../fixtures/db";
import { signInAs } from "../fixtures/personas";
import { caseId, caseRef, expectCaseShown, SEEDED_CASE_IDS } from "../fixtures/scenario";
import { formatViolations, inspectCaseContext, recordPayloads } from "../sentinel/sentinel";

const GAMMA = "investigator-gamma";
const BETA = "investigator-beta";
const WS = "INVESTIGATIONS" as const;
const RESTRICTED = caseId("09");
const STAGES = [
  "INTAKE",
  "PRELIMINARY_REVIEW",
  "INVESTIGATION",
  "COMMITTEE_DELIBERATION",
  "DECISION",
  "CLOSURE",
];
const STATES = ["ACTIVE", "CLOSED"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let db: ScenarioDb;
test.beforeAll(() => {
  db = scenarioDb();
});
test.afterAll(async () => {
  await db?.end();
});

const rowIds = (page: Page) =>
  page
    .locator('[data-testid^="portfolio-row-"]')
    .evaluateAll((rows) =>
      rows.map((r) => r.getAttribute("data-testid")!.replace("portfolio-row-", "")).sort(),
    );

/** Rows and both counts equal `expected`; the Sentinel finds no case outside `visible`. */
async function expectRows(
  page: Page,
  expected: CaseRow[],
  visible: ReadonlyMap<string, string>,
  label: string,
) {
  await expect(page.getByTestId("portfolio-page")).toBeVisible();
  expect(await rowIds(page), label).toEqual(expected.map((c) => c.id).sort());
  await expect(page.getByTestId("count-portfolio-results"), label).toHaveAttribute(
    "data-count",
    String(expected.length),
  );
  const total = page.getByTestId("count-portfolio-total");
  if (expected.length > 0) await expect(total, label).toHaveAttribute("data-count", String(expected.length));
  else await expect(total, label).toHaveCount(0);
  await expect(page.getByTestId("portfolio-next"), label).toHaveCount(0);
  await expect(page.getByTestId("portfolio-prev"), label).toHaveCount(0);
  const v = await inspectCaseContext(page, { visible });
  expect(v, `${label}\n${formatViolations(v)}`).toEqual([]);
}

/** The portfolio URL carries exactly these filters (the GET form also sends empty fields, which mean "no filter"). */
async function expectFilterUrl(page: Page, filters: Record<string, string>) {
  await expect
    .poll(() => {
      const u = new URL(page.url());
      const set = Object.fromEntries([...u.searchParams].filter(([, v]) => v !== ""));
      return { path: u.pathname, filters: set };
    })
    .toEqual({ path: "/portfolio", filters });
}

async function gammaView() {
  const cases = await visibleCases(db, GAMMA, WS);
  expect([...cases.keys()].sort(), "Gamma's visible cases (DATA_MODEL §5)").toEqual(
    ["01", "02", "03", "05", "06", "10"].map(caseId),
  );
  expect(cases.has(RESTRICTED)).toBe(false);
  return { all: [...cases.values()], visible: new Map([...cases].map(([id, c]) => [id, c.ref])) };
}

test("Scenario D — filters set through the form stay in the URL across open, back and reload", async ({
  page,
}) => {
  const { all, visible } = await gammaView();
  const oracle = databaseEventOracle(db, GAMMA, WS);
  // The stage with the most of Gamma's cases, so the filtered list is not trivially empty.
  const byStage = new Map<string, CaseRow[]>();
  for (const c of all) byStage.set(c.stage, [...(byStage.get(c.stage) ?? []), c]);
  const [stage, inStage] = [...byStage].sort((a, b) => b[1].length - a[1].length)[0]!;
  const expected = inStage.filter((c) => c.records_state === "ACTIVE");
  expect(expected.length, `Gamma has an ACTIVE case in ${stage}`).toBeGreaterThan(0);

  await signInAs(page, GAMMA);
  await page.goto("/portfolio");
  await expectRows(page, all, visible, "unfiltered");
  await page.getByTestId("portfolio-stage").selectOption(stage);
  await page.getByTestId("portfolio-state").selectOption("ACTIVE");
  await page.getByTestId("portfolio-apply").click();
  await expectFilterUrl(page, { stage, state: "ACTIVE" });
  const filteredUrl = page.url();
  await expectRows(page, expected, visible, `${stage}/ACTIVE`);
  await expect(page.getByTestId("portfolio-stage")).toHaveValue(stage);
  await expect(page.getByTestId("portfolio-state")).toHaveValue("ACTIVE");
  await expect(page.getByTestId("portfolio-clear")).toBeVisible();

  const open = expected[0]!.id;
  await page.getByTestId(`portfolio-open-${open}`).click();
  await expectCaseShown(page, open, "overview", visible, oracle);

  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expectRows(page, expected, visible, "after back");
  await expect(page.getByTestId("portfolio-stage")).toHaveValue(stage);
  await expect(page.getByTestId("portfolio-state")).toHaveValue("ACTIVE");

  await page.reload();
  await expectRows(page, expected, visible, "after reload");
  await expect(page.getByTestId("portfolio-stage")).toHaveValue(stage);

  // "mine" through the form, on top of no other filter (a fresh load: see the known-defect test for Clear).
  await page.goto("/portfolio");
  await expectRows(page, all, visible, "unfiltered again");
  await page.getByTestId("portfolio-mine").check();
  await page.getByTestId("portfolio-apply").click();
  await expectFilterUrl(page, { mine: "1" });
  const mine = all.filter((c) => c.mine);
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.length).toBeLessThan(all.length);
  await expectRows(page, mine, visible, "mine");
  await expect(page.getByTestId("portfolio-mine")).toBeChecked();
});

// KNOWN DEFECT (OI-043, V13-FE-007; QA finding F2): Clear and Back are client-side navigations, and the filter
// form's fields are uncontrolled (defaultValue), so they keep the previous filters while the list below is unfiltered;
// pressing Apply then silently re-applies them. Local probe: after Clear the search box resets but stage and state keep
// INVESTIGATION/ACTIVE over 6 unfiltered rows; after Back from ?state=CLOSED the state field still reads CLOSED.
// test.fail() runs every assertion and keeps CI honest: the day the form follows the URL this test "unexpectedly
// passes", fails the run, and the annotation is removed in the same PR as the fix. It never hides a new failure mode
// silently, because the assertions are the intended behaviour.
test("Scenario D — the filter form shows only the URL's filters after Clear and after Back", async ({
  page,
}) => {
  test.fail(true, "OI-043: filter fields keep stale values after a client-side navigation");
  await signInAs(page, GAMMA);
  const fields = () =>
    Promise.all(
      ["portfolio-search", "portfolio-stage", "portfolio-state"].map((id) =>
        page.getByTestId(id).inputValue(),
      ),
    );
  await page.goto("/portfolio?q=DEMO&stage=INVESTIGATION&state=ACTIVE");
  expect(await fields()).toEqual(["DEMO", "INVESTIGATION", "ACTIVE"]);
  await page.getByTestId("portfolio-clear").first().click();
  await expectFilterUrl(page, {});
  await expect.poll(fields, { timeout: 3000 }).toEqual(["", "", ""]);

  await page.goto("/portfolio");
  await page.getByTestId("portfolio-state").selectOption("CLOSED");
  await page.getByTestId("portfolio-apply").click();
  await expectFilterUrl(page, { state: "CLOSED" });
  await page.goBack();
  await expectFilterUrl(page, {});
  await expect.poll(fields, { timeout: 3000 }).toEqual(["", "", ""]);
});

test("Scenario D — every stage × records state combination equals the database, restricted 0009 never counted", async ({
  page,
}) => {
  const { all, visible } = await gammaView();
  await signInAs(page, GAMMA);
  // Recording starts after sign-in: the sign-in POST carries no case and its body is gone once the page moves on.
  const payloads = recordPayloads(page, new URL(test.info().project.use.baseURL!).origin);
  for (const stage of ["", ...STAGES]) {
    for (const state of ["", ...STATES]) {
      for (const mine of [false, true]) {
        const params = new URLSearchParams();
        if (stage) params.set("stage", stage);
        if (state) params.set("state", state);
        if (mine) params.set("mine", "1");
        const url = `/portfolio${params.size ? `?${params}` : ""}`;
        expect((await page.goto(url))?.status(), url).toBe(200);
        const expected = all.filter(
          (c) => (!stage || c.stage === stage) && (!state || c.records_state === state) && (!mine || c.mine),
        );
        await expectRows(page, expected, visible, url);
        await expect(page.getByTestId(`portfolio-row-${RESTRICTED}`)).toHaveCount(0);
      }
    }
  }
  // Searching the restricted case's number finds nothing and counts nothing.
  for (const q of [caseRef("09"), "2026-0009", "0009"]) {
    await page.goto(`/portfolio?q=${encodeURIComponent(q)}`);
    await expectRows(page, [], visible, `q=${q}`);
    await expect(page.getByTestId("portfolio-no-results")).toBeVisible();
  }
  const pv = await payloads.violations({
    caseIds: new Set(visible.keys()),
    caseRefs: new Set([...visible.values(), caseRef("09")]), // the echoed search term, not a leak
    knownCaseIds: SEEDED_CASE_IDS,
  });
  expect(pv, formatViolations(pv)).toEqual([]);
  expect((await payloads.summary()).unreadable).toBe(0);
});

test("Scenario D control — Investigator Beta, assigned to 0009, sees it under its own stage and by number", async ({
  page,
}) => {
  const cases = await visibleCases(db, BETA, WS);
  const restricted = cases.get(RESTRICTED);
  expect(restricted, "Beta can read 0009").toBeDefined();
  expect(restricted!.is_restricted).toBe(true);
  const visible = new Map([...cases].map(([id, c]) => [id, c.ref]));
  await signInAs(page, BETA);
  await page.goto(`/portfolio?stage=${restricted!.stage}`);
  await expectRows(
    page,
    [...cases.values()].filter((c) => c.stage === restricted!.stage),
    visible,
    `Beta stage=${restricted!.stage}`,
  );
  await expect(
    page.getByTestId(`portfolio-row-${RESTRICTED}`).getByTestId("portfolio-restricted"),
  ).toBeVisible();
  await page.goto(`/portfolio?q=${encodeURIComponent(caseRef("09"))}`);
  await expect(page.getByTestId(`portfolio-row-${RESTRICTED}`)).toHaveCount(1);
  await expect(page.getByTestId("count-portfolio-results")).toHaveAttribute("data-count", "1");
});

test("Scenario D negatives — display-number URL and random UUID give one 404 page; edited filters are refused", async ({
  page,
}) => {
  const { visible } = await gammaView();
  await signInAs(page, GAMMA);
  const bodies: string[] = [];
  for (const path of [
    `/cases/${caseRef("09")}`,
    `/cases/${caseRef("01")}`, // a visible case, by number: still not a key
    `/cases/${crypto.randomUUID()}`,
    `/cases/${RESTRICTED}`,
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByTestId("not-found-state"), path).toBeVisible();
    await expect(page.getByTestId("case-workspace"), path).toHaveCount(0);
    const v = await inspectCaseContext(page, { visible: new Map() });
    expect(v, `${path}\n${formatViolations(v)}`).toEqual([]);
    bodies.push(await page.getByTestId("not-found-state").innerText());
  }
  expect(new Set(bodies).size, "every 404 reads the same").toBe(1);

  for (const query of [
    "stage=NOT_A_STAGE",
    "state=OPEN",
    "mine=yes",
    "stage=INTAKE&stage=DECISION",
    "after=!!",
  ]) {
    const res = await page.goto(`/portfolio?${query}`);
    expect(res?.status(), query).toBe(200);
    const invalid = page.getByTestId("portfolio-invalid");
    await expect(invalid, query).toBeVisible();
    await expect(invalid.getByTestId("correlation-id")).toHaveText(UUID);
    await expect(page.locator('[data-testid^="portfolio-row-"]'), query).toHaveCount(0);
    await expect(page.getByTestId("count-portfolio-results"), query).toHaveCount(0);
    const v = await inspectCaseContext(page, { visible });
    expect(v, `${query}\n${formatViolations(v)}`).toEqual([]);
  }
});
