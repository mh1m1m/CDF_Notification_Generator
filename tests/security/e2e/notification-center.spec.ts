// V13-SEC-007 · Notification Operations Center adversarial tests (SEC-APP-02, -07, -10 on /notifications; TM-I3,
// TM-I4, TM-I10). FE's tests/e2e/notification-center.spec.ts covers D6 (SEC-APP-17), the happy paths and one hidden
// number; this suite attacks the URL the Center trusts least: forged and replayed cursors, the "previous" trail,
// repeated or odd parameters, and spellings of a hidden case number. Every refusal must be the generic invalid state
// with a reference (never a 500, a stack, SQL or another case), and a hidden number must answer exactly like a number
// that does not exist. Counts are relative, so drafts written by other specs never break this one.
// SYNTHETIC personas only.
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "../../fixtures/personas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ref = (n: string) => `CDF-DEMO-2026-${n}`;
const caseId = (n: string) => `0c000000-0000-4000-8000-00000000${n}`;
/** DATA_MODEL §5: cases visible in the persona's sign-in workspace. */
const VISIBLE = {
  "secretary-alpha": ["0001", "0003", "0004", "0006", "0007", "0008", "0010"],
  "governance-officer-delta": ["0001", "0002", "0003", "0004", "0007", "0008", "0010"],
} as const;
const HIDDEN = {
  "secretary-alpha": ["0002", "0005", "0009"],
  "governance-officer-delta": ["0005", "0006", "0009"],
} as const;
type Slug = keyof typeof VISIBLE;

const b64 = (value: unknown) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8").toString("base64url");
const AT = "2026-10-31T12:00:00.000000Z";
const ID = "0e000000-0000-4000-8000-000000000001";

/** Cursors the reader never issued: each must be refused before any read. */
const FORGED_CURSORS: Readonly<Record<string, string>> = {
  "not JSON": b64("not json at all"),
  "JSON array": b64([1, AT, ID]),
  "version 2": b64({ v: 2, at: AT, id: ID }),
  "extra key": b64({ v: 1, at: AT, id: ID, case_id: caseId("0009") }),
  "missing id": b64({ v: 1, at: AT }),
  "millisecond instant": b64({ v: 1, at: "2026-10-31T12:00:00.000Z", id: ID }),
  "SQL in the instant": b64({ v: 1, at: `${AT}' or '1'='1`, id: ID }),
  "id not a UUID": b64({ v: 1, at: AT, id: "0009" }),
  "id upper case": b64({ v: 1, at: AT, id: ID.toUpperCase() }),
  "number instead of string": b64({ v: 1, at: 1, id: ID }),
  "prototype key": b64(
    '{"v":1,"at":"2026-10-31T12:00:00.000000Z","id":"0e000000-0000-4000-8000-000000000001","__proto__":{}}',
  ),
};

async function rowCases(page: Page): Promise<{ ids: string[]; refs: string[] }> {
  const rows = page.locator('[data-testid^="notification-row-"]');
  return {
    ids: await rows.evaluateAll((rs) => rs.map((r) => r.getAttribute("data-case-id") ?? "")),
    refs: await rows.evaluateAll((rs) => rs.map((r) => r.getAttribute("data-case-ref") ?? "")),
  };
}

async function expectInvalid(page: Page, url: string, label: string) {
  const res = await page.goto(url);
  expect(res?.status(), label).toBeLessThan(500);
  await expect(page.getByTestId("notifications-invalid"), label).toBeVisible();
  await expect(page.getByTestId("correlation-id"), label).toHaveText(UUID);
  await expect(page.getByTestId("notifications-table"), label).toHaveCount(0);
  const text = await page.locator("body").innerText();
  for (const bad of [
    /stack|at\s+\S+\s+\(/i,
    /syntax error|postgres|sqlstate|cdf_notifications_v13/i,
    /InvalidCursorError/,
  ]) {
    expect(text, `${label}: internals`).not.toMatch(bad);
  }
}

/** The visible answer to a case-number filter: what the persona can tell apart. */
async function numberAnswer(page: Page, value: string) {
  const res = await page.goto(`/notifications?case=${encodeURIComponent(value)}`);
  expect(res?.status(), value).toBe(200);
  return {
    noResults: await page.getByTestId("notifications-no-results").isVisible(),
    invalid: await page.getByTestId("notifications-invalid").isVisible(),
    count: await page
      .getByTestId("count-notifications-results")
      .getAttribute("data-count")
      .catch(() => null),
    rows: await page.locator('[data-testid^="notification-row-"]').count(),
  };
}

for (const slug of Object.keys(VISIBLE) as Slug[]) {
  test.describe(`SEC-APP-07 / SEC-APP-02 Notification Center as ${slug}`, () => {
    test("every row names a visible case, by id and number, and no hidden case appears anywhere on the page", async ({
      page,
    }) => {
      await signInAs(page, slug);
      await page.goto("/notifications");
      await expect(page.getByTestId("notifications-page")).toBeVisible();
      const { ids, refs } = await rowCases(page);
      expect(ids.length, "control: the persona has notifications to see").toBeGreaterThan(0);
      const visibleIds = VISIBLE[slug].map(caseId);
      const visibleRefs = VISIBLE[slug].map(ref);
      for (const id of ids) expect(visibleIds, id).toContain(id);
      for (const r of refs) expect(visibleRefs, r).toContain(r);
      const html = await page.content();
      for (const n of HIDDEN[slug]) {
        expect(html, n).not.toContain(caseId(n));
        expect(html, n).not.toContain(ref(n));
      }
    });

    test("a hidden case number, in any spelling the form accepts, answers exactly like a number that does not exist", async ({
      page,
    }) => {
      await signInAs(page, slug);
      const unknown = await numberAnswer(page, ref("0999"));
      expect(unknown).toEqual({ noResults: true, invalid: false, count: "0", rows: 0 });
      for (const n of HIDDEN[slug]) {
        for (const spelling of [ref(n), ` ${ref(n)} `, ref(n).toLowerCase()]) {
          expect(await numberAnswer(page, spelling), JSON.stringify(spelling)).toEqual(unknown);
        }
      }
      // a fragment of a hidden number is not a number: refused like any malformed value, never a partial match
      for (const fragment of ["2026-0009", "0009", "CDF-DEMO-2026-000%", "CDF-DEMO-2026-0009' or '1'='1"]) {
        await expectInvalid(page, `/notifications?case=${encodeURIComponent(fragment)}`, fragment);
      }
    });

    test("forged cursors and trails are refused with a reference, before any read", async ({ page }) => {
      await signInAs(page, slug);
      for (const [label, cursor] of Object.entries(FORGED_CURSORS)) {
        await expectInvalid(page, `/notifications?after=${cursor}`, label);
      }
      await expectInvalid(page, `/notifications?after=${"A".repeat(513)}`, "cursor too long");
      await expectInvalid(page, "/notifications?after=a.b", "cursor with a dot");
      await expectInvalid(
        page,
        `/notifications?back=${b64({ v: 1, at: AT, id: ID })}`,
        "trail without after",
      );
      await expectInvalid(
        page,
        `/notifications?after=${b64({ v: 1, at: AT, id: ID })}&back=${Array(21).fill("~").join(".")}`,
        "trail longer than 20",
      );
      await expectInvalid(page, "/notifications?case=A&case=B", "repeated parameter");
      await expectInvalid(page, "/notifications?from=2026-02-30", "impossible date");
      await expectInvalid(page, "/notifications?from=2026-11-02&to=2026-11-01", "inverted range");
    });

    test("a well-formed cursor the reader could have issued still pages only visible cases", async ({
      page,
    }) => {
      await signInAs(page, slug);
      // positioned just after a far-future instant and an id the persona has never seen: the next page is every
      // authorised row older than it, nothing else
      const res = await page.goto(
        `/notifications?after=${b64({ v: 1, at: "2099-12-31T23:59:59.999999Z", id: "ffffffff-ffff-4fff-bfff-ffffffffffff" })}`,
      );
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId("notifications-invalid")).toHaveCount(0);
      const { ids } = await rowCases(page);
      expect(ids.length, "control: every authorised row is older than the cursor").toBeGreaterThan(0);
      const visibleIds = VISIBLE[slug].map(caseId);
      for (const id of ids) expect(visibleIds, id).toContain(id);
      for (const n of HIDDEN[slug]) expect(await page.content(), n).not.toContain(caseId(n));
    });
  });
}
