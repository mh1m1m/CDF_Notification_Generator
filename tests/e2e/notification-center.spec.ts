// FE-006 part 2 — Notification Operations Center (SCREENS S4, /notifications). D6 / SEC-APP-17: for an investigator
// the route answers exactly like an unknown route, whatever the query string, and is absent from the navigation. The
// Secretary and the Governance Officer see notifications of their visible cases only, each row naming its case; a
// hidden case filters like an unknown one; an edited URL is the generic invalid state with a reference. Counts are
// relative (rows on the page = the authorised total), so drafts created by other specs never break this one.
// SYNTHETIC personas only.
import { expect, test, type Page } from "@playwright/test";
import { messagesFor } from "@/lib/i18n";
import { signInAs } from "../fixtures/personas";

const ar = messagesFor("ar");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ref = (n: string) => `CDF-DEMO-2026-${n}`;

async function caseRefs(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="notification-row-"]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-case-ref") ?? ""));
}

async function expectCountMatchesRows(page: Page) {
  const rows = await page.locator('[data-testid^="notification-row-"]').count();
  await expect(page.getByTestId("count-notifications-results")).toHaveAttribute("data-count", String(rows));
  return rows;
}

test.describe("D6 — investigators: /notifications answers like an unknown route", () => {
  for (const slug of ["investigator-beta", "investigator-gamma"]) {
    test(`${slug}: 404 with the unknown-route page on every URL; no navigation item`, async ({ page }) => {
      await signInAs(page, slug);
      await expect(page.getByTestId("platform-nav")).toBeVisible();
      await expect(page.getByTestId("nav-notifications")).toHaveCount(0);

      const unknown = await page.goto("/no-such-route-v13");
      expect(unknown?.status()).toBe(404);
      const unknownText = await page.getByTestId("not-found-state").innerText();
      const unknownTitle = await page.title();

      for (const url of [
        "/notifications",
        "/notifications?case=CDF-DEMO-2026-0001",
        "/notifications?status=DELIVERED",
        "/notifications?after=a+b",
      ]) {
        const res = await page.goto(url);
        expect(res?.status(), url).toBe(404);
        expect(await page.getByTestId("not-found-state").innerText(), url).toBe(unknownText);
        expect(await page.title(), url).toBe(unknownTitle);
        await expect(page.getByTestId("notifications-page")).toHaveCount(0);
        // Visible text only: the RSC payload echoes the requested URL itself, which is the persona's own input.
        const text = await page.locator("body").innerText();
        for (const n of ["0001", "0003", "0009", "0010"]) expect(text, url).not.toContain(ref(n));
        expect(text, url).not.toContain(ar["notifications.heading"]);
      }
    });
  }
});

test.describe("Notification Operations Center — Secretary and Governance Officer", () => {
  test("Alpha opens it from the navigation; every row names a case she may see; count = rows", async ({
    page,
  }) => {
    await signInAs(page, "secretary-alpha");
    await page.getByTestId("nav-notifications").click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ar["notifications.heading"]);
    await expect(page.getByTestId("notifications-filters")).toBeVisible();
    await expect(page.getByTestId("notifications-table")).toBeVisible();
    expect(await expectCountMatchesRows(page)).toBeGreaterThanOrEqual(4);
    const refs = await caseRefs(page);
    expect(new Set(refs)).toEqual(new Set([ref("0001"), ref("0003"), ref("0010")]));
    for (const row of await page.locator('[data-testid^="notification-row-"]').all()) {
      expect(await row.getAttribute("data-case-id")).toMatch(UUID);
      await expect(row.getByRole("link").first()).toHaveAttribute("href", /^\/cases\/[0-9a-f-]{36}$/);
    }
    expect(await page.content()).not.toContain(ref("0009"));
  });

  test("filtering by case number keeps that case only; a hidden case filters like an unknown one", async ({
    page,
  }) => {
    await signInAs(page, "secretary-alpha");
    await page.goto("/notifications");
    await page.getByTestId("notifications-filter-case").fill(ref("0003"));
    await page.getByTestId("notifications-apply").click();
    await expect(page).toHaveURL(/case=CDF-DEMO-2026-0003/);
    await expectCountMatchesRows(page);
    expect(new Set(await caseRefs(page))).toEqual(new Set([ref("0003")]));
    await expect(page.getByTestId("notifications-clear")).toBeVisible();

    for (const hidden of ["0009", "0002", "9999"]) {
      await page.goto(`/notifications?case=${ref(hidden)}`);
      await expect(page.getByTestId("notifications-no-results")).toBeVisible();
      await expect(page.getByTestId("count-notifications-results")).toHaveAttribute("data-count", "0");
      await expect(page.getByTestId("notifications-table")).toHaveCount(0);
    }
  });

  test("an edited URL shows the generic invalid state with a reference, never details", async ({ page }) => {
    await signInAs(page, "secretary-alpha");
    const res = await page.goto("/notifications?status=DELIVERED");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("notifications-invalid")).toBeVisible();
    await expect(page.getByTestId("correlation-id")).toHaveText(UUID);
    await expect(page.getByTestId("notifications-table")).toHaveCount(0);
  });

  test("Delta (GOVERNANCE) reads the Center; rows name their cases", async ({ page }) => {
    await signInAs(page, "governance-officer-delta");
    await page.goto("/notifications");
    await expect(page.getByTestId("notifications-table")).toBeVisible();
    await expectCountMatchesRows(page);
    for (const r of await caseRefs(page)) expect(r).toMatch(/^CDF-DEMO-2026-\d{4}$/);
    expect(await page.content()).not.toContain(ref("0009"));
  });
});
