// The Sentinel's outbound half on the real application (V13-QA-007, OI-048; REQ-QA-013 "data submitted for the wrong
// case"): the posts a persona makes — a notification draft (Server Action), the locale toggle on a case page and
// off one — name no case but the page's own (P3), and every body is read (P4). The check
// is shown not to be vacuous by counting the requests it read and by catching a tampered draft form. SYNTHETIC
// personas only; the one write is a WITNESS draft on 0004, which Scenario E's preview tests also use.
import { expect, test } from "@playwright/test";
import { scenarioDb, visibleCases, type ScenarioDb } from "../fixtures/db";
import { signInAs } from "../fixtures/personas";
import { caseId, SEEDED_CASE_IDS } from "../fixtures/scenario";
import { formatViolations, recordRequests, type RequestAllowance } from "./sentinel";

let db: ScenarioDb;
let allow: RequestAllowance;
test.beforeAll(async () => {
  db = scenarioDb();
  const cases = await visibleCases(db, "secretary-alpha", "SECRETARIAT");
  allow = { refs: new Map([...cases].map(([id, c]) => [id, c.ref])), knownCaseIds: SEEDED_CASE_IDS };
});
test.afterAll(async () => {
  await db?.end();
});

const rulesOf = (vs: { rule: string }[]) => [...new Set(vs.map((v) => v.rule))].sort();

test("Secretary Alpha's posts name only the page's own case (P3) and are all read (P4)", async ({
  page,
  baseURL,
}) => {
  await signInAs(page, "secretary-alpha");
  const requests = recordRequests(page, new URL(baseURL!).origin);
  // a Server Action from a case page
  await page.goto(`/cases/${caseId("04")}/notifications`);
  await page.getByTestId("draft-recipient").selectOption("WITNESS");
  await page.getByTestId("draft-submit").click();
  await expect(page.getByTestId("draft-created")).toBeVisible();
  // a form post from a case page that is not about the case
  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  // a form post off a case page
  await page.goto("/portfolio");
  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  expect(requests.count(), "the draft and four locale posts were read").toBeGreaterThanOrEqual(5);
  // The control ARCH asked for: the legitimate same-case Server Action was recorded, read and judged against 0004.
  const draftPosts = requests
    .recorded()
    .filter(
      (x) =>
        x.kind === "server-action" && new URL(x.pageUrl).pathname === `/cases/${caseId("04")}/notifications`,
    );
  expect(draftPosts.length, "the draft Server Action was recorded").toBeGreaterThanOrEqual(1);
  expect(draftPosts.every((x) => x.read && x.contextCaseId === caseId("04"))).toBe(true);
  expect(
    requests.recorded().some((x) => x.contextCaseId === null),
    "a post off a case page was recorded too",
  ).toBe(true);
  const v = requests.violations(allow);
  expect(v, formatViolations(v)).toEqual([]);
});

test("negative: a draft form tampered to name hidden case 0002 is caught by P3, and the server refuses it", async ({
  page,
  baseURL,
}) => {
  await signInAs(page, "secretary-alpha");
  const requests = recordRequests(page, new URL(baseURL!).origin);
  await page.goto(`/cases/${caseId("04")}/notifications`);
  await page.getByTestId("draft-recipient").selectOption("WITNESS");
  await page
    .getByTestId("draft-form")
    .locator('input[name="case_id"]')
    .evaluate((el, id) => ((el as HTMLInputElement).value = id), caseId("02"));
  await page.getByTestId("draft-submit").click();
  // one generic refusal with a reference, on the page the form was on
  await expect(page.getByTestId("draft-error")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/cases/${caseId("04")}/notifications$`));
  const v = requests.violations(allow);
  expect(rulesOf(v)).toEqual(["P3"]);
  expect(formatViolations(v)).toContain(`request carries case id ${caseId("02")}`);
});
