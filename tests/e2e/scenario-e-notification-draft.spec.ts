// Scenario E — notification draft from the case Notifications tab (V13-FE-006; SCREENS S3, DESIGN §6). Rides FE's PR
// with ARCH's agreement (31 Oct); QA reviews it. Secretary Alpha creates a WITNESS draft on 0001: it is listed under
// 0001 only. SEC condition 2: a reused key and case ids the persona cannot draft on (restricted 0009, another
// workspace's 0002, closed 0010, unknown, malformed) are refused with the same generic reference on the page the
// persona is on, and the draft counts do not change. The closed case and a role that may not draft get no form.
// Assertions are on this test's own rows by id (TEST_ARCHITECTURE §5.3), so the suite holds on a database that earlier
// or parallel runs wrote to. At 375 px the tab with the form has no horizontal page scroll (WCAG 1.4.10, QA review).
// SYNTHETIC personas only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "../fixtures/personas";

const C = (i: number) => `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The ids of the notifications the persona sees on a case's Notifications tab (empty for the empty state). */
async function notificationIds(page: Page, i: number): Promise<string[]> {
  await page.goto(`/cases/${C(i)}/notifications`);
  return page
    .locator('tr[data-testid^="case-notification-"]')
    .evaluateAll((rows) =>
      rows.map((r) => r.getAttribute("data-testid")!.slice("case-notification-".length)).sort(),
    );
}

/** Rewrites one hidden field of the draft form on 0001 (a tampered POST) and submits it. */
async function submitTampered(page: Page, field: string, value: string) {
  await page.goto(`/cases/${C(1)}/notifications`);
  await page
    .locator(`[data-testid="draft-form"] input[name="${field}"]`)
    .evaluate((el, v) => ((el as HTMLInputElement).value = v), value);
  await page.getByTestId("draft-submit").click();
}

test.describe("Scenario E — notification draft", () => {
  test("Alpha drafts a WITNESS notice on 0001: listed there only; every refusal is generic and writes nothing", async ({
    page,
  }) => {
    const csp: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) csp.push(m.text());
    });
    await signInAs(page, "secretary-alpha");

    const before1 = await notificationIds(page, 1);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    await page.getByTestId("draft-recipient").selectOption("WITNESS");
    const key = await page.locator('[data-testid="draft-form"] input[name="idempotency_key"]').inputValue();
    await page.getByTestId("draft-submit").click();
    await expect(page.getByTestId("draft-created")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/cases/${C(1)}/notifications\\?created=`));
    const created = new URL(page.url()).searchParams.get("created");
    expect(created).toMatch(UUID);
    expect(before1).not.toContain(created);
    await expect(page.getByTestId(`case-notification-${created}`)).toHaveAttribute("data-created", "true");

    // Never under another case.
    await page.goto(`/cases/${C(3)}/notifications`);
    await expect(page.getByTestId(`case-notification-${created}`)).toHaveCount(0);

    // SEC condition 2: refusals.
    const after1 = await notificationIds(page, 1);
    expect(after1).toContain(created);
    const before10 = await notificationIds(page, 10);
    for (const [field, value] of [
      ["idempotency_key", key], // the same key again
      ["case_id", C(9)], // restricted, Alpha not assigned
      ["case_id", C(2)], // another workspace's case
      ["case_id", C(10)], // closed
      ["case_id", "0c000000-0000-4000-8000-0000000000ff"], // unknown
      ["case_id", "CDF-DEMO-2026-0001"], // malformed (a display number is never a key)
    ] as const) {
      await submitTampered(page, field, value);
      const error = page.getByTestId("draft-error");
      await expect(error).toBeVisible();
      await expect(error.getByTestId("correlation-id")).toHaveText(UUID);
      // Focus moves to the refusal, so keyboard users keep their place (QA review, item 1).
      await expect(error).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`/cases/${C(1)}/notifications$`));
      expect(await error.innerText()).not.toMatch(/0c000000|CDF-DEMO|V14|sql|stack/i);
    }
    // Refusals wrote nothing on the form's case or on closed 0010 (no row this persona did not already see).
    expect(await notificationIds(page, 1)).toEqual(after1);
    expect(await notificationIds(page, 10)).toEqual(before10);
    // The closed case offers no form.
    await expect(page.getByTestId("draft-form")).toHaveCount(0);
    expect(csp).toEqual([]);
  });

  test("at 375 px the Notifications tab with the draft form has no horizontal page scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAs(page, "secretary-alpha");
    for (const i of [1, 3]) {
      await page.goto(`/cases/${C(i)}/notifications`);
      await expect(page.getByTestId("draft-form")).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `case ${i}`).toBe(clientWidth);
    }
  });

  test("Governance Officer Delta sees the tab but no draft form", async ({ page }) => {
    await signInAs(page, "governance-officer-delta");
    await page.goto(`/cases/${C(1)}/notifications`);
    await expect(page.getByTestId("case-notifications")).toBeVisible();
    await expect(page.getByTestId("draft-form")).toHaveCount(0);
  });
});
