// The 404 page (V13-QA-005): one page for an unknown route and for anything the persona may not see. Outside the
// platform shell (an unknown route) it is clean today; inside it (a case the persona may not see, or a display number
// used as a case URL) it is not. SYNTHETIC data only.
//
// KNOWN DEFECT (QA finding F1, reported to ARCH 31 Oct): notFound() thrown by a case page renders app/not-found.tsx,
// whose own <main id="main"> sits inside the platform AppShell's <main id="main">: two main landmarks, one nested, and
// a duplicate id that is also the skip link's target. axe reports landmark-main-is-top-level, landmark-no-duplicate-main
// and landmark-unique (moderate, so the serious/critical smoke did not see it). test.fail() runs every assertion: when
// the page has one top-level main this test "unexpectedly passes" and fails the run, and the annotation is removed in
// the PR that fixes it.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "../fixtures/personas";

async function expectOneMain(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBe(404);
  await expect(page.getByTestId("not-found-state"), path).toBeVisible();
  await expect(page, "the document has a non-empty <title> before the scan").toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).analyze();
  const all = results.violations.map((v) => `${v.id} (${v.impact})`);
  expect(all, `${path}: no axe violation at any impact`).toEqual([]);
  await expect(page.locator("main"), path).toHaveCount(1);
  await expect(page.locator("#main"), path).toHaveCount(1);
}

test("unknown route, signed in: one main landmark, no axe violation", async ({ page }) => {
  await signInAs(page, "investigator-gamma");
  await expectOneMain(page, "/no-such-route");
});

test("case 404 inside the platform shell: one main landmark, no axe violation", async ({ page }) => {
  test.fail(true, "QA finding F1: app/not-found.tsx nests a second <main id=main> inside the AppShell");
  await signInAs(page, "investigator-gamma");
  for (const path of ["/cases/0c000000-0000-4000-8000-000000000009", "/cases/CDF-DEMO-2026-0009"]) {
    await expectOneMain(page, path);
  }
});
