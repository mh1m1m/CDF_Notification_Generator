// FE-006 part 2 — Notification Operations Center (SCREENS S4, /notifications). D6 / SEC-APP-17: for an investigator
// the route answers exactly like an unknown route, whatever the query string, and is absent from the navigation. The
// Secretary and the Governance Officer see notifications of their visible cases only, each row naming its case; a
// hidden case filters like an unknown one; an edited URL is the generic invalid state with a reference. Counts are
// relative (rows on the page = the authorised total), so drafts created by other specs never break this one.
// SYNTHETIC personas only.
import { expect, test, type Page } from "@playwright/test";
import { LOCALE_COOKIE, messagesFor } from "@/lib/i18n";
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

  test("a row opens its own notification's preview on its own case (FE-006 part 3)", async ({ page }) => {
    await signInAs(page, "secretary-alpha");
    await page.goto(`/notifications?case=${ref("0003")}`);
    const row = page.locator('tr[data-testid^="notification-row-"]').first();
    const id = await row.getAttribute("data-notification-id");
    const caseId = await row.getAttribute("data-case-id");
    await page.getByTestId(`notifications-open-${id}`).click();
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/notifications\\?n=${id}$`));
    // the seed's rows carry database recipient classes, so the preview shows the OI-037 state for that row
    await expect(page.getByTestId("case-preview")).toBeVisible();
    await expect(page.getByTestId("case-preview-unmapped")).toHaveAttribute("data-notification-id", id!);
    await expect(page.getByTestId(`case-notification-${id}`)).toHaveAttribute("data-selected", "true");
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

// V13-FE-009 (UX's S4 review, 31 Oct): M1-15 at 360 px the table keeps its minimum width and scrolls inside its
// region, never the page; M1-15/16 a template code and a case number stay on one line (no break at a hyphen);
// M1-17 the version is Latin in <bdi>; M1-18 dates carry the month in words (Arabic-Indic digits in Arabic).
test.describe("Center layout at narrow widths (V13-FE-009)", () => {
  const cases = [
    { locale: "ar", width: 360 },
    { locale: "en", width: 360 },
    { locale: "ar", width: 768 },
    { locale: "en", width: 768 },
  ] as const;
  for (const { locale, width } of cases) {
    test(`${locale} at ${width} px: no page scroll; the region scrolls; codes on one line`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: LOCALE_COOKIE, value: locale, url: baseURL! }]);
      await page.setViewportSize({ width, height: 800 });
      await signInAs(page, "secretary-alpha");
      await page.goto("/notifications");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByTestId("notifications-table")).toBeVisible();

      const page_ = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(page_.scrollWidth).toBe(page_.clientWidth);

      const region = page
        .locator("[data-scroll-region]")
        .filter({ has: page.getByTestId("notifications-table") });
      const r = await region.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      if (width === 360) expect(r.scrollWidth).toBeGreaterThan(r.clientWidth);

      const oneLine = async (testId: string) =>
        page.getByTestId(testId).evaluateAll((els) =>
          els.map((el) => {
            const lh =
              parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5;
            return el.getClientRects().length === 1 && el.getBoundingClientRect().height < lh * 1.5;
          }),
        );
      const codes = await oneLine("notification-template-code");
      expect(codes.length).toBeGreaterThan(0);
      expect(codes.every(Boolean)).toBe(true);

      const versions = await page.getByTestId("notification-template-version").allInnerTexts();
      expect(versions.length).toBeGreaterThan(0);
      for (const v of versions) expect(v).toMatch(/^[0-9]+$/);

      const created = await page.locator('[data-testid^="notification-row-"] time').first().innerText();
      if (locale === "ar") {
        expect(created).toMatch(/[٠-٩]/);
        expect(created).not.toMatch(/[0-9]/);
      }
      expect(created).not.toMatch(/\d+\/\d+\/\d+|[٠-٩]+\/[٠-٩]+/);
    });
  }
});

// V13-FE-010 (UX-009 R-04): at 320 px (the reflow width, = 1280 px at 400%) the caption of the Center table and of the
// case Notifications tab table stays inside its scroll region and wraps, before and after the region is scrolled to
// its far end. It failed on the old markup (the caption was a plain cell-width caption that scrolled with the table).
test.describe("Notification table captions at 320 px (V13-FE-010)", () => {
  const C1 = "0c000000-0000-4000-8000-000000000001";
  const targets = [
    {
      name: "Center",
      path: "/notifications",
      table: "notifications-table",
      caption: "notifications-table-caption",
    },
    {
      name: "case Notifications tab",
      path: `/cases/${C1}/notifications`,
      table: "case-notifications",
      caption: "case-notifications-caption",
    },
  ] as const;
  for (const locale of ["ar", "en"] as const) {
    for (const target of targets) {
      test(`${locale}: ${target.name} caption stays within its region`, async ({
        page,
        context,
        baseURL,
      }) => {
        await context.addCookies([{ name: LOCALE_COOKIE, value: locale, url: baseURL! }]);
        await page.setViewportSize({ width: 320, height: 800 });
        await signInAs(page, "secretary-alpha");
        await page.goto(target.path);
        await expect(page.getByTestId(target.table)).toBeVisible();
        const inside = () =>
          page.getByTestId(target.table).evaluate((table, captionId) => {
            const region = table.closest('[role="region"]') as HTMLElement;
            const caption = document.getElementById(captionId)!;
            const text = (caption.firstElementChild ?? caption) as HTMLElement;
            const r = region.getBoundingClientRect();
            const c = text.getBoundingClientRect();
            return {
              scrolls: region.scrollWidth > region.clientWidth,
              fits: c.left >= r.left - 1 && c.right <= r.right + 1,
            };
          }, target.caption);
        const before = await inside();
        expect(before.scrolls).toBe(true);
        expect(before.fits).toBe(true);
        await page.getByTestId(target.table).evaluate((table) => {
          const region = table.closest('[role="region"]') as HTMLElement;
          const rtl = getComputedStyle(region).direction === "rtl";
          region.scrollLeft = rtl ? -region.scrollWidth : region.scrollWidth;
        });
        const after = await inside();
        expect(after.fits).toBe(true);
      });
    }
  }
});
