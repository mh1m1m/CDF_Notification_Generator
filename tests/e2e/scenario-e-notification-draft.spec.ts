// Scenario E — notification draft from the case Notifications tab (V13-FE-006; SCREENS S3, DESIGN §6). Rides FE's PR
// with ARCH's agreement (31 Oct); QA reviews it. Secretary Alpha creates a WITNESS draft on 0001: it is listed under
// 0001 only. SEC condition 2: a reused key and case ids the persona cannot draft on (restricted 0009, another
// workspace's 0002, closed 0010, unknown, malformed) are refused with the same generic reference on the page the
// persona is on, and the draft counts do not change. The closed case and a role that may not draft get no form.
// Assertions are on this test's own rows by id (TEST_ARCHITECTURE §5.3), so the suite holds on a database that earlier
// or parallel runs wrote to. At 375 px the tab with the form has no horizontal page scroll (WCAG 1.4.10, QA review).
// Preview (FE-006 part 3): a WITNESS draft opens in UX-006's sandboxed frame from its row's link; the seed's database
// recipient classes show the OI-037 state; another case's id, an unknown id and a malformed value show one generic
// state; a WITNESS draft on restricted 0009 fails closed with that same state.
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

test.describe("Scenario E — notification preview", () => {
  const NTF = (n: number) => `2f000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  // Alpha's preview drafts are written on 0004, so they never race the draft test's row checks on 0001 and 0010.
  const ALPHA_CASE = 4;

  /** Creates a WITNESS draft on case i with the first offered template; returns its id. */
  async function witnessDraft(page: Page, i: number): Promise<string> {
    await page.goto(`/cases/${C(i)}/notifications`);
    await page.getByTestId("draft-recipient").selectOption("WITNESS");
    await page.getByTestId("draft-submit").click();
    await expect(page.getByTestId("draft-created")).toBeVisible();
    const created = new URL(page.url()).searchParams.get("created");
    expect(created).toMatch(UUID);
    return created!;
  }

  /** The generic state's visible text with the reference number removed (it differs per request). */
  async function genericText(page: Page): Promise<string> {
    const box = page.getByTestId("case-preview-unavailable");
    await expect(box).toBeVisible();
    await expect(box.getByTestId("case-preview-correlation-id")).toHaveText(UUID);
    const ref = await box.getByTestId("case-preview-correlation-id").innerText();
    return (await box.innerText()).replace(ref, "<ref>");
  }

  test("a WITNESS draft opens in the sandboxed frame from its row; nothing runs and nothing leaks into the page", async ({
    page,
  }) => {
    const csp: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) csp.push(m.text());
    });
    await signInAs(page, "secretary-alpha");
    const id = await witnessDraft(page, ALPHA_CASE);
    await page.getByTestId(`case-notification-preview-link-${id}`).click();
    await expect(page).toHaveURL(new RegExp(`/cases/${C(ALPHA_CASE)}/notifications\\?n=${id}$`));
    const ready = page.getByTestId("case-preview-ready");
    await expect(ready).toHaveAttribute("data-notification-id", id);
    await expect(page.getByTestId(`case-notification-${id}`)).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId(`case-notification-preview-link-${id}`)).toHaveAttribute(
      "aria-current",
      "true",
    );
    const frame = page.getByTestId("case-notification-preview-frame");
    // UX finding on #74: the frame's name is a UI string (event title + the localised preview word), never the raw marking.
    const frameTitle = (await frame.getAttribute("title")) ?? "";
    expect(frameTitle).toMatch(/^.+ — عرض تجريبي$/);
    expect(frameTitle).not.toContain("DESIGN_PREVIEW");
    await expect(frame).toHaveAttribute("sandbox", "");
    expect(await frame.getAttribute("src")).toBeNull();
    expect(await frame.getAttribute("srcdoc")).toContain('data-marking="DESIGN_PREVIEW"');
    // the notice is inside the frame only
    await expect(page.locator('[data-marking="DESIGN_PREVIEW"]')).toHaveCount(0);
    const inner = page.frameLocator('[data-testid="case-notification-preview-frame"]');
    await expect(inner.locator("h1#ntf-title")).toBeVisible();
    await expect(inner.locator('[data-marking="DESIGN_PREVIEW"]')).toBeVisible();
    // The page around the frame. axe cannot run inside a frame that allows no script, and the default runner waits on
    // it, so this run stays in the top document (legacy mode, iframes not entered)…
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .options({ iframes: false })
      .setLegacyMode(true)
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    // …and the framed document itself, opened as its own page from the same srcdoc.
    const doc = await page.context().newPage();
    await doc.setContent((await frame.getAttribute("srcdoc"))!);
    const inside = await new AxeBuilder({ page: doc })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(inside.violations.map((v) => v.id)).toEqual([]);
    await doc.close();
    await page.getByTestId("case-preview-close").click();
    await expect(page).toHaveURL(new RegExp(`/cases/${C(ALPHA_CASE)}/notifications$`));
    await expect(page.getByTestId("case-preview")).toHaveCount(0);
    expect(csp).toEqual([]);
  });

  test("the seed's database recipient classes show the OI-037 state, never a frame", async ({ page }) => {
    await signInAs(page, "secretary-alpha");
    await page.goto(`/cases/${C(1)}/notifications?n=${NTF(1)}`); // CASE_TEAM
    await expect(page.getByTestId("case-preview-unmapped")).toContainText("CASE_TEAM");
    // QA CHANGES 982bd76: the class label, with the code in <bdi> beside it, not the bare code in the sentence.
    await expect(page.getByTestId("case-preview-unmapped-class")).toContainText("فريق القضية");
    await expect(page.getByTestId("case-preview-unmapped-code")).toHaveText("CASE_TEAM");
    await expect(page.getByTestId("case-preview-unmapped-code")).toHaveAttribute("dir", "ltr");
    // …and the preview link's accessible name uses the row's words, never raw codes.
    const templateName = await page
      .getByTestId(`case-notification-${NTF(1)}`)
      .getByTestId("case-notification-template-name")
      .innerText();
    await expect(page.getByTestId(`case-notification-preview-link-${NTF(1)}`)).toHaveAccessibleName(
      `معاينة ${templateName} للفئة فريق القضية`,
    );
    // M1-07: the row itself shows labels and the template's name, not raw codes
    const seeded = page.getByTestId(`case-notification-${NTF(1)}`);
    await expect(seeded.getByTestId("case-notification-recipient")).toHaveText("فريق القضية");
    await expect(seeded.getByTestId("case-notification-status")).toHaveText("مسودة");
    await expect(seeded.getByTestId("case-notification-template-name")).not.toBeEmpty();
    await expect(page.getByTestId("case-notification-preview-frame")).toHaveCount(0);
    await page.goto(`/cases/${C(3)}/notifications?n=${NTF(2)}`); // COMMITTEE_MEMBERS
    await expect(page.getByTestId("case-preview-unmapped")).toContainText("COMMITTEE_MEMBERS");
    await expect(page.getByTestId("case-notification-preview-frame")).toHaveCount(0);
  });

  test("another case's notification, an unknown id and a malformed value show one generic state", async ({
    page,
  }) => {
    await signInAs(page, "secretary-alpha");
    const texts: string[] = [];
    for (const n of [
      NTF(2), // case 0003's notification under 0001
      NTF(4), // restricted 0009's notification, hidden from Alpha
      "2f000000-0000-4000-8000-0000000000ff", // unknown
      "CDF-DEMO-2026-0001", // a display number is never a key
      "%27--",
    ]) {
      await page.goto(`/cases/${C(1)}/notifications?n=${n}`);
      texts.push(await genericText(page));
      await expect(page.getByTestId("case-notification-preview-frame")).toHaveCount(0);
      await expect(page.getByTestId("case-preview-unmapped")).toHaveCount(0);
      expect(await page.getByTestId("case-preview").innerText()).not.toMatch(
        /2f000000|0c000000|COMMITTEE|CASE_TEAM|WITNESS|sql|stack/i,
      );
    }
    expect(new Set(texts).size).toBe(1);
    // the generic state of the preview is also what a hidden case's notification gives its own case page
    await page.goto(`/cases/${C(9)}/notifications?n=${NTF(4)}`);
    await expect(page.getByTestId("not-found-state")).toBeVisible();
  });

  test("negative: a WITNESS draft on restricted 0009 fails closed (no access-list result) with the generic state", async ({
    page,
  }) => {
    await signInAs(page, "investigator-beta");
    const id = await witnessDraft(page, 9);
    await page.goto(`/cases/${C(9)}/notifications?n=${id}`);
    await genericText(page);
    await expect(page.getByTestId("case-notification-preview-frame")).toHaveCount(0);
  });

  test("at 375 px the tab with an open preview has no horizontal page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAs(page, "secretary-alpha");
    const id = await witnessDraft(page, ALPHA_CASE);
    await page.goto(`/cases/${C(ALPHA_CASE)}/notifications?n=${id}`);
    await expect(page.getByTestId("case-notification-preview-frame")).toBeVisible();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBe(clientWidth);
  });
});
