// Scenario E — notification draft from the case Notifications tab (V13-FE-006; SCREENS S3, DESIGN §6). Rides FE's PR
// with ARCH's agreement (31 Oct); QA reviews it. Secretary Alpha creates a WITNESS draft on 0001: it is listed under
// 0001 only. SEC condition 2: a reused key and case ids the persona cannot draft on (restricted 0009, another
// workspace's 0002, closed 0010, unknown, malformed) are refused with the same generic reference on the page the
// persona is on, and the draft counts do not change. The closed case and a role that may not draft get no form.
// Counts are relative, so the suite holds on a database that earlier runs wrote to. SYNTHETIC personas only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "../fixtures/personas";

const C = (i: number) => `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The number of notifications the persona sees on a case's Notifications tab (0 for the empty state). */
async function draftCount(page: Page, i: number): Promise<number> {
  await page.goto(`/cases/${C(i)}/notifications`);
  const table = page.getByTestId("case-notifications");
  return (await table.count()) ? Number(await table.getAttribute("data-count")) : 0;
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

    const before1 = await draftCount(page, 1);
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
    await expect(page.getByTestId("case-notifications")).toHaveAttribute("data-count", String(before1 + 1));
    await expect(page.getByTestId(`case-notification-${created}`)).toHaveAttribute("data-created", "true");

    // Never under another case.
    await page.goto(`/cases/${C(3)}/notifications`);
    await expect(page.getByTestId(`case-notification-${created}`)).toHaveCount(0);

    // SEC condition 2: refusals.
    const before10 = await draftCount(page, 10);
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
      await expect(page).toHaveURL(new RegExp(`/cases/${C(1)}/notifications$`));
      expect(await error.innerText()).not.toMatch(/0c000000|CDF-DEMO|V14|sql|stack/i);
    }
    expect(await draftCount(page, 1)).toBe(before1 + 1);
    expect(await draftCount(page, 10)).toBe(before10);
    // The closed case offers no form.
    await expect(page.getByTestId("draft-form")).toHaveCount(0);
    expect(csp).toEqual([]);
  });

  test("Governance Officer Delta sees the tab but no draft form", async ({ page }) => {
    await signInAs(page, "governance-officer-delta");
    await page.goto(`/cases/${C(1)}/notifications`);
    await expect(page.getByTestId("case-notifications")).toBeVisible();
    await expect(page.getByTestId("draft-form")).toHaveCount(0);
  });
});
