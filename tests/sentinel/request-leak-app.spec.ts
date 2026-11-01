// The Sentinel's outbound half on the real application (V13-QA-007, OI-048; REQ-QA-013 "data submitted for the wrong
// case"): the posts a persona makes from a case page — a notification draft (Server Action), the locale toggle, a
// workspace switch (Governance Officer Delta) and sign-out — and the locale toggle off one name no case but the
// page's own (P3), and every body is read (P4). The check is shown not to be vacuous by the requests it records and
// by catching tampered draft forms. SYNTHETIC personas only. Writes: WITNESS drafts on 0004 (also used by Scenario
// E's preview tests) and on 0001 (the accepted tamper; Scenario E asserts its own rows by id).
//
// Not covered here: My Work's task update (a post off a case page carrying a task id, not a case id). Its write would
// change a seeded task that Scenario B and Scenario D read, and P3 matches case ids and references only, so it would
// add no P3 evidence; the command's own checks (SEC, tests/security) cover it.
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
  // sign-out from a case page, the last step
  await page.goto(`/cases/${caseId("04")}/tasks`);
  await page.getByTestId("persona-menu-button").click();
  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect(requests.count(), "the draft, four locale posts and sign-out were read").toBeGreaterThanOrEqual(6);
  expect(
    requests.recorded().some((x) => x.contextCaseId === caseId("04") && /\/tasks$/.test(x.pageUrl)),
    "sign-out was recorded from the case page",
  ).toBe(true);
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

test("Governance Officer Delta's workspace switch from a case page names no case but the page's own", async ({
  page,
  baseURL,
}) => {
  const gov = await visibleCases(db, "governance-officer-delta", "GOVERNANCE");
  const deltaAllow: RequestAllowance = {
    refs: new Map([...gov].map(([id, c]) => [id, c.ref])),
    knownCaseIds: SEEDED_CASE_IDS,
  };
  await signInAs(page, "governance-officer-delta");
  const requests = recordRequests(page, new URL(baseURL!).origin);
  await page.goto(`/cases/${caseId("04")}/tasks`);
  await expect(page.getByTestId("workspace-switcher")).toHaveAttribute("data-workspace-code", "GOVERNANCE");
  await page.getByTestId("workspace-switcher").click();
  await page.getByTestId("workspace-menu-option-SECRETARIAT").click();
  await expect(page).toHaveURL(/\/my-work\?switched=1$/);
  await expect(page.getByTestId("workspace-switcher")).toHaveAttribute("data-workspace-code", "SECRETARIAT");
  const sw = requests.recorded().filter((x) => x.contextCaseId === caseId("04"));
  expect(sw.length, "the switch was recorded from the case page").toBeGreaterThanOrEqual(1);
  expect(sw.every((x) => x.read)).toBe(true);
  const v = requests.violations(deltaAllow);
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

test("negative: a draft form on 0004 tampered to name visible case 0001 is accepted by the server; P3 is what flags it (OI-049)", async ({
  page,
  baseURL,
}) => {
  // Today's behaviour, pinned until OI-049 binds the draft to the route: the action takes case_id from the form, the
  // command authorises Alpha on 0001 and writes the draft there. Only P3 tells the request was sent from 0004's page.
  await signInAs(page, "secretary-alpha");
  const requests = recordRequests(page, new URL(baseURL!).origin);
  await page.goto(`/cases/${caseId("04")}/notifications`);
  await page.getByTestId("draft-recipient").selectOption("WITNESS");
  await page
    .getByTestId("draft-form")
    .locator('input[name="case_id"]')
    .evaluate((el, id) => ((el as HTMLInputElement).value = id), caseId("01"));
  await page.getByTestId("draft-submit").click();
  await expect(page).toHaveURL(new RegExp(`/cases/${caseId("01")}/notifications\\?created=`));
  await expect(page.getByTestId("draft-created")).toBeVisible();
  const v = requests.violations(allow);
  expect(rulesOf(v)).toEqual(["P3"]);
  expect(formatViolations(v)).toContain(`request carries case id ${caseId("01")}`);
  expect(formatViolations(v)).toContain(`/cases/${caseId("04")}/notifications)`);
});
