// V13-SEC-006 · SEC-APP-01, SEC-APP-02, SEC-APP-09 (GET part), SEC-APP-11 · threats TM-I1, TM-I2, TM-I3, TM-S7, TM-T6.
// The case pages for signed-in personas (the negative-test personas are QA's, tests/e2e/negative-personas-pinning):
//  - SEC-APP-01: every case a persona may not see (other workspace, restricted without assignment) answers on every
//    Case Workspace tab exactly like an unknown id: 404, the same visible text, no case context. Malformed ids never
//    reach a server error or internals. A control proves each visible case still opens.
//  - SEC-APP-02: display numbers are never keys (a number in the case URL is an unknown id) and searching the
//    portfolio for a case the persona cannot see gives the same empty answer as a number that does not exist.
//  - SEC-APP-09 (GET part): a GET never changes state; the workspace page with a forged query keeps the session.
//  - SEC-APP-11: the workspace switch ignores extra and repeated fields; only the session decides who switches.
// Visibility comes from docs/architecture/DATA_MODEL.md §5 (seed measured as cdf_v13_user). SYNTHETIC DATA ONLY.
import { expect, test, type Page } from "@playwright/test";
import { signInAs, SESSION_COOKIE } from "../../fixtures/personas";
import { formatViolations, inspectCaseContext } from "../../sentinel/sentinel";

const SEEDED = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));
const caseId = (n: string) => `0c000000-0000-4000-8000-0000000000${n}`;
const caseRef = (n: string) => `CDF-DEMO-2026-00${n}`;
const UNKNOWN = "0c000000-0000-4000-8000-000000000099";
const TABS = ["", "/events", "/tasks", "/notifications"];

/** DATA_MODEL §5: the cases each persona sees in the workspace it signs in to. */
const VISIBLE: Record<string, readonly string[]> = {
  "secretary-alpha": ["01", "03", "04", "06", "07", "08", "10"],
  "investigator-beta": ["01", "02", "03", "05", "06", "09", "10"],
  "investigator-gamma": ["01", "02", "03", "05", "06", "10"],
  "governance-officer-delta": ["01", "02", "03", "04", "07", "08", "10"],
};

const STACK_OR_INTERNALS =
  /\bat\s+[\w.<>]+\s+\(|\.next\/server|node_modules|SQLSTATE|syntax error at|relation "|ECONNREFUSED|V14\d\d|cdf_v13_|cdf_notifications_v13/i;

/** The page's visible text, with the per-request correlation reference taken out. */
async function visibleText(page: Page) {
  const text = await page.locator("body").innerText();
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<ref>");
}

/** `echoed` is the case id or number the request itself carries (the URL); the page may echo the URL in its payload. */
async function expectUnknownAnswer(
  page: Page,
  path: string,
  unknownText: string,
  label: string,
  echoed?: string,
) {
  const res = await page.goto(path);
  expect(res?.status(), label).toBe(404);
  await expect(page.getByTestId("case-workspace"), label).toHaveCount(0);
  await expect(page.locator("[data-case-id]"), label).toHaveCount(0);
  expect(await visibleText(page), label).toBe(unknownText);
  const html = await page.content();
  for (const m of SEEDED) {
    if (echoed === caseRef(m) || echoed === caseId(m)) continue;
    expect(html.includes(caseRef(m)), `${label}: ${caseRef(m)} in the HTML`).toBe(false);
    expect(html.includes(caseId(m)), `${label}: ${caseId(m)} in the HTML`).toBe(false);
  }
  const v = await inspectCaseContext(page, { visible: new Map() });
  expect(v, `${label}: ${formatViolations(v)}`).toEqual([]);
}

for (const [slug, visible] of Object.entries(VISIBLE)) {
  const hidden = SEEDED.filter((n) => !visible.includes(n));

  test.describe(`SEC-APP-01 ${slug}: hidden cases answer like an unknown id (TM-I1, TM-I2)`, () => {
    test.beforeEach(async ({ page }) => {
      await signInAs(page, slug);
    });

    test(`control: every visible case opens (${visible.length})`, async ({ page }) => {
      for (const n of visible) {
        const res = await page.goto(`/cases/${caseId(n)}`);
        expect(res?.status(), n).toBe(200);
        await expect(page.getByTestId("case-workspace"), n).toBeVisible();
      }
    });

    test(`every hidden case (${hidden.join(", ")}) on every tab: 404, the unknown id's text, no case context`, async ({
      page,
    }) => {
      for (const tab of TABS) {
        await page.goto(`/cases/${UNKNOWN}${tab}`);
        const unknownText = await visibleText(page);
        for (const n of hidden)
          await expectUnknownAnswer(page, `/cases/${caseId(n)}${tab}`, unknownText, `${n}${tab}`, caseId(n));
      }
    });

    test("a display number in the case URL is an unknown id, also for a visible case (SEC-APP-02)", async ({
      page,
    }) => {
      await page.goto(`/cases/${UNKNOWN}`);
      const unknownText = await visibleText(page);
      for (const n of [visible[0]!, hidden[0]!]) {
        await expectUnknownAnswer(
          page,
          `/cases/${caseRef(n)}`,
          unknownText,
          `number ${caseRef(n)}`,
          caseRef(n),
        );
        await expectUnknownAnswer(
          page,
          `/cases/${encodeURIComponent(caseRef(n).toLowerCase())}`,
          unknownText,
          "lower",
        );
      }
    });
  });
}

test.describe("SEC-APP-01 malformed case ids never reach a server error (TM-I2, TM-I10)", () => {
  test("odd ids on every tab: < 500, no internals, no case context", async ({ page }) => {
    await signInAs(page, "investigator-beta");
    const odd = [
      "not-a-uuid",
      "0",
      "-1",
      "00000000-0000-0000-0000-000000000000",
      `${caseId("01")}x`,
      `${caseId("01")}%00`,
      `${caseId("01")}%20`,
      `${caseId("01")};drop`,
      "'%20or%20'1'='1",
      "%27%29%3B--",
      "%2e%2e%2f%2e%2e%2fportfolio",
      "a".repeat(2000),
      "%F0%9F%92%A5",
    ];
    for (const id of odd) {
      for (const tab of TABS) {
        const res = await page.goto(`/cases/${id}${tab}`);
        const label = `${id.slice(0, 40)}${tab}`;
        expect(res?.status(), label).toBeLessThan(500);
        expect(res?.status(), label).not.toBe(200);
        const body = (await res?.text()) ?? "";
        expect(body, label).not.toMatch(STACK_OR_INTERNALS);
        await expect(page.locator("[data-case-id]"), label).toHaveCount(0);
      }
    }
  });

  // SEC-F-006-1 (LOW, found by V13-SEC-006): a case id that is not valid UTF-8 after percent-decoding made Next.js
  // answer a bare 500 "Internal Server Error" on every dynamic route (no internals, no case data). Fixed in proxy.ts by
  // V13-ARCH-010: the session gate runs first, then a signed-in request gets the generic not-found page. So the answer
  // is exactly an unknown page's: the same 404 page with a session, the same redirect to sign-in without one.
  test("ids that are not valid UTF-8 answer like an unknown page, never a 500", async ({ page }) => {
    const malformed = ["%C0%AF", "%FF", "%E0%A4%A"];
    const UNKNOWN_PAGE = "/no-such-page";
    await signInAs(page, "investigator-beta");
    expect((await page.goto(UNKNOWN_PAGE))?.status(), "unknown page").toBe(404);
    const unknownPage = await visibleText(page);
    for (const id of malformed) {
      for (const tab of TABS) {
        const label = `${id}${tab} (signed in)`;
        const res = await page.goto(`/cases/${id}${tab}`);
        expect(res?.status(), label).toBe(404);
        expect((await res?.text()) ?? "", label).not.toMatch(STACK_OR_INTERNALS);
        await expect(page.getByTestId("not-found-state"), label).toBeVisible();
        await expect(page.locator("[data-case-id]"), label).toHaveCount(0);
        expect(await visibleText(page), label).toBe(unknownPage);
      }
    }
    await page.context().clearCookies();
    const anonymous = (path: string) => page.request.get(path, { maxRedirects: 0 });
    const unknownPageAnonymous = await anonymous(UNKNOWN_PAGE);
    const unknownIdAnonymous = await anonymous(`/cases/${UNKNOWN}`);
    expect(unknownPageAnonymous.status(), "unknown page (anonymous)").toBe(307);
    expect(unknownIdAnonymous.status(), "unknown id (anonymous)").toBe(307);
    const signIn = unknownPageAnonymous.headers()["location"];
    expect(unknownIdAnonymous.headers()["location"], "unknown id (anonymous)").toBe(signIn);
    for (const id of malformed) {
      for (const tab of TABS) {
        const label = `${id}${tab} (anonymous)`;
        const res = await anonymous(`/cases/${id}${tab}`);
        expect(res.status(), label).toBe(307);
        expect(res.headers()["location"], label).toBe(signIn);
        expect(await res.text(), label).not.toMatch(STACK_OR_INTERNALS);
      }
    }
  });

  test("an upper-case spelling of a visible case's id is either the same case or an unknown id, never an error", async ({
    page,
  }) => {
    await signInAs(page, "investigator-beta");
    const res = await page.goto(`/cases/${caseId("01").toUpperCase()}`);
    expect([200, 404]).toContain(res?.status());
    const body = (await res?.text()) ?? "";
    expect(body).not.toMatch(STACK_OR_INTERNALS);
    // An upper-case spelling of a HIDDEN case must still be hidden.
    const hiddenRes = await page.goto(`/cases/${caseId("04").toUpperCase()}`);
    expect(hiddenRes?.status()).toBe(404);
    await expect(page.locator("[data-case-id]")).toHaveCount(0);
  });
});

test.describe("SEC-APP-02 portfolio search by number leaks no existence (TM-I3)", () => {
  for (const [slug, visible] of Object.entries(VISIBLE)) {
    test(`${slug}: a hidden case's number answers like a number that does not exist`, async ({ page }) => {
      await signInAs(page, slug);
      const hidden = SEEDED.filter((n) => !visible.includes(n));
      const answer = async (q: string) => {
        const res = await page.goto(`/portfolio?q=${encodeURIComponent(q)}`);
        expect(res?.status(), q).toBe(200);
        await expect(page.getByTestId("portfolio-page"), q).toBeVisible();
        const rows = await page.locator('[data-testid^="portfolio-row-"]').count();
        const count = await page.getByTestId("count-portfolio-results").getAttribute("data-count");
        const total = page.getByTestId("count-portfolio-total");
        const totalCount = (await total.count()) > 0 ? await total.getAttribute("data-count") : null;
        const html = await page.content();
        return { rows, count, totalCount, text: (await visibleText(page)).replaceAll(q, "<q>"), html };
      };
      const none = await answer("CDF-DEMO-2026-0999");
      expect(none.rows).toBe(0);
      for (const n of hidden) {
        for (const q of [caseRef(n), `2026-00${n}`, `00${n}`]) {
          const a = await answer(q);
          expect({ rows: a.rows, count: a.count, total: a.totalCount, text: a.text }, `${slug} ${q}`).toEqual(
            {
              rows: none.rows,
              count: none.count,
              total: none.totalCount,
              text: none.text,
            },
          );
          expect(a.html.includes(caseId(n)), `${q}: hidden id in the HTML`).toBe(false);
        }
      }
      // Control: a visible case's number finds it.
      const seen = await answer(caseRef(visible[0]!));
      expect(seen.rows).toBeGreaterThan(0);
    });
  }
});

test.describe("SEC-APP-09 a GET never changes state (TM-S7)", () => {
  test("the workspace page and My Work with forged switch parameters keep the session's workspace", async ({
    page,
    context,
  }) => {
    await signInAs(page, "governance-officer-delta");
    const before = (await context.cookies()).find((c) => c.name === SESSION_COOKIE)?.value;
    const announce = async () => (await page.locator("body").innerText()).slice(0, 4000);
    await page.goto("/my-work");
    const workspaceText = await announce();
    for (const path of [
      "/workspaces?workspace=SECRETARIAT",
      "/workspaces?workspace=INVESTIGATIONS",
      "/my-work?workspace=SECRETARIAT&switched=1",
      "/portfolio?workspace=SECRETARIAT",
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(500);
      const after = (await context.cookies()).find((c) => c.name === SESSION_COOKIE)?.value;
      expect(after === before, `${path}: session cookie changed`).toBe(true);
    }
    await page.goto("/my-work");
    expect(await announce()).toBe(workspaceText);
  });
});

test.describe("SEC-APP-11 the workspace switch takes nothing from the form but the target (TM-T6, TM-E4)", () => {
  test("extra persona, role and session fields are ignored: the switch is Delta's own, into a member workspace only", async ({
    page,
    context,
  }) => {
    await signInAs(page, "governance-officer-delta");
    await page.goto("/workspaces");
    const form = page
      .locator("form")
      .filter({ has: page.locator('[name="workspace"]') })
      .first();
    await expect(form).toHaveCount(1);
    // Add forged fields to the real form and submit it through the browser (same origin, real action id).
    await form.evaluate((f) => {
      const add = (name: string, value: string) => {
        const i = document.createElement("input");
        i.type = "hidden";
        i.name = name;
        i.value = value;
        f.appendChild(i);
      };
      add("persona_id", "0b000000-0000-4000-8000-000000000002");
      add("role", "INVESTIGATOR");
      add("workspace_id", "INVESTIGATIONS");
      add("active_workspace", "INVESTIGATIONS");
      add("claims", '{"persona_id":"0b000000-0000-4000-8000-000000000002"}');
    });
    const target = form.locator('[name="workspace"]').first();
    const value = await target.inputValue();
    expect(["SECRETARIAT", "GOVERNANCE"]).toContain(value);
    await form.locator('[type="submit"]').first().click();
    await page.waitForURL(/\/my-work\?(switched=1|ref=)/);
    // Whatever the outcome, the session never belongs to Beta and never reaches INVESTIGATIONS: Beta's restricted
    // case 0009 stays hidden and Delta's own visibility applies.
    expect((await page.goto(`/cases/${caseId("09")}`))?.status()).toBe(404);
    const session = (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
    expect(session).toBeDefined();
    const res = await page.goto("/portfolio");
    expect(res?.status()).toBe(200);
    const ids = await page
      .locator("[data-case-id]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-case-id")));
    expect(ids).not.toContain(caseId("09"));
    expect(ids).not.toContain(caseId("05"));
  });

  test("a repeated workspace field is refused, nothing switched", async ({ page, context }) => {
    await signInAs(page, "governance-officer-delta");
    const before = (await context.cookies()).find((c) => c.name === SESSION_COOKIE)?.value;
    await page.goto("/workspaces");
    const form = page
      .locator("form")
      .filter({ has: page.locator('[name="workspace"]') })
      .first();
    await form.evaluate((f) => {
      const i = document.createElement("input");
      i.type = "hidden";
      i.name = "workspace";
      i.value = "INVESTIGATIONS";
      f.appendChild(i);
    });
    await form.locator('[type="submit"]').first().click();
    await page.waitForURL(/\/my-work\?/);
    const url = new URL(page.url());
    const after = (await context.cookies()).find((c) => c.name === SESSION_COOKIE)?.value;
    if (url.searchParams.get("switched") === "1") {
      // Accepted only if the first (genuine) value won; the session must never be in INVESTIGATIONS.
      expect((await page.goto(`/cases/${caseId("05")}`))?.status()).toBe(404);
    } else {
      expect(after === before, "refused switch changed the session").toBe(true);
    }
  });
});
