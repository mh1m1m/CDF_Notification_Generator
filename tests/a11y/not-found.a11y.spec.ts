// The 404 page (V13-QA-005): one page for an unknown route and for anything the persona may not see. Outside the
// platform shell (an unknown route) and inside it (a case the persona may not see, or a display number used as a case
// URL) it has exactly one main landmark and no axe violation (OI-042, fixed by V13-FE-007). SYNTHETIC data only.
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
  await signInAs(page, "investigator-gamma");
  for (const path of ["/cases/0c000000-0000-4000-8000-000000000009", "/cases/CDF-DEMO-2026-0009"]) {
    await expectOneMain(page, path);
  }
});
