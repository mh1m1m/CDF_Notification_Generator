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
// Disclosure (V13-QA-009, REQ-NOTIF-011): for a WITNESS preview in either template language, the fields the policy
// withholds from WITNESS are absent from the frame's document, from its accessible names and from every document and
// RSC payload of the page; the generalized classification shows only the class-safe wording; the allowed fields are
// there (control). The oracle is the policy file itself (lib/disclosure/policy_v13.json), read independently of the
// projector, so a projector that drifts from the policy fails here. Every body searched is read in the test
// (page.route), and the withheld fields are absent from the plain-text version too (V13-QA-012).
// Database precondition (SEC INFO 2 on #114): the tests need no fresh data. They assert on their own rows by id, and
// the whole spec passes twice in a row against one app on one database. What they need, like every database-backed
// e2e test, is a database whose claims key is this app's (ADR-014): an app started with a new session secret on a
// database that still holds the previous run's key refuses every request (CLAIMS_KEY_MISMATCH), the draft form never
// renders and the first step times out at the template select. `pnpm db:reset` before each local run that starts a new
// app, as playwright.config.ts says; CI resets in the e2e job.
// FE-011: the preview's plain-text version opens under the frame as text in the notice's language, with no page
// scroll at 320 px.
// FE-013: one bounded page; a tampered or forged cursor shows the empty state with a link to the first page,
// never an error.
// SYNTHETIC personas only.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createTranslator } from "@/lib/i18n";
import { ar as RENDER_AR } from "@/lib/i18n/notificationRender/ar";
import { en as RENDER_EN } from "@/lib/i18n/notificationRender/en";
import { signInAs } from "../fixtures/personas";
import { runServerScript } from "../fixtures/server-module";

const C = (i: number) => `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The fields the binding puts into a notice's model (lib/notifications/render/model.ts, buildModelFromRecords). */
const MODEL_FIELDS: Readonly<Record<string, true>> = Object.freeze({
  event_title: true,
  issuer: true,
  notice_reference: true,
  template_code: true,
  case_number: true,
  card_content: true,
  preheader: true,
  subject_detail: true,
  classification_marking: true,
  delivery_status: true,
  confidentiality_notice: true,
});

/** The seeded templates' names (database/seed/0002_m1_cases.sql): the event title a WITNESS may see. */
const TEMPLATE_NAMES: Readonly<Record<string, { ar: string; en: string }>> = {
  "CF-20_INVESTIGATION_ASSIGNED": { ar: "إسناد التحقيق", en: "Investigation assigned" },
  "CF-24_MEETING_INVITATION": { ar: "دعوة اجتماع", en: "Meeting invitation" },
};

interface PolicyFile {
  rows: { recipient: string; field: string; channel: string; context: string; outcome: string }[];
  generalized_texts: Record<string, Record<string, { ar: string; en: string }>>;
  restrictiveness_order: string[];
}

/**
 * WITNESS outcomes for the model's fields on the platform preview (channel IN_APP, context CASE_PUBLIC: an
 * unrestricted case), read straight from the policy file with its own precedence (field-exact 4, context-exact 2,
 * channel-exact 1; ties go to the more restrictive outcome). Independent of lib/disclosure.
 */
function witnessOracle(): {
  outcomes: Record<string, string>;
  withheld: string[];
  kept: string[];
  generalized: Record<string, { ar: string; en: string }>;
} {
  const policy = JSON.parse(readFileSync("lib/disclosure/policy_v13.json", "utf8")) as PolicyFile;
  const order = policy.restrictiveness_order;
  const outcome = (field: string): string => {
    let best: { score: number; outcome: string } | null = null;
    for (const r of policy.rows) {
      if (r.recipient !== "WITNESS") continue;
      if (r.field !== field && r.field !== "*") continue;
      if (r.channel !== "IN_APP" && r.channel !== "*") continue;
      if (r.context !== "CASE_PUBLIC" && r.context !== "*") continue;
      const score = (r.field === field ? 4 : 0) + (r.context !== "*" ? 2 : 0) + (r.channel !== "*" ? 1 : 0);
      if (
        !best ||
        score > best.score ||
        (score === best.score && order.indexOf(r.outcome) > order.indexOf(best.outcome))
      )
        best = { score, outcome: r.outcome };
    }
    return best?.outcome ?? "PROHIBITED";
  };
  const outcomes: Record<string, string> = {};
  const withheld: string[] = [];
  const kept: string[] = [];
  const generalized: Record<string, { ar: string; en: string }> = {};
  for (const field of Object.keys(MODEL_FIELDS)) {
    const o = outcome(field);
    outcomes[field] = o;
    if (o === "ALLOWED") kept.push(field);
    else if (o === "GENERALIZED") generalized[field] = policy.generalized_texts[field]!.WITNESS!;
    else withheld.push(field);
  }
  return { outcomes, withheld, kept, generalized };
}

/** A document or RSC body with HTML-attribute and JSON-string escaping undone, so markers match in either. */
function unescapePayload(body: string): string {
  return body
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\"/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * The rendered notice documents inside a payload: around each DESIGN_PREVIEW marking, from the nearest preceding
 * doctype to the next closing html tag (the page's own doctype comes earlier, so it is never part of a match).
 */
function previewDocuments(body: string): string[] {
  const docs: string[] = [];
  const lower = body.toLowerCase();
  let at = body.indexOf('data-marking="DESIGN_PREVIEW"');
  while (at !== -1) {
    const start = lower.lastIndexOf("<!doctype html>", at);
    const end = lower.indexOf("</html>", at);
    if (start !== -1 && end !== -1) docs.push(body.slice(start, end + "</html>".length));
    at = body.indexOf('data-marking="DESIGN_PREVIEW"', end === -1 ? at + 1 : end);
  }
  return docs;
}

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

  // V13-FE-012 (OI-049): the draft is bound to the page's case. A form on 0004's page edited to name another case is
  // refused, whatever that case is. Proof that nothing was written anywhere: the idempotency key is unique per author
  // across all cases, so the same form submitted afterwards with its case id restored (the same key) can only create
  // its draft if none of the tampered posts wrote one.
  test("a form on 0004's page edited to name another case creates nothing on 0001, 0004 or elsewhere", async ({
    page,
  }) => {
    await signInAs(page, "secretary-alpha");
    await page.goto(`/cases/${C(4)}/notifications`);
    await page.getByTestId("draft-recipient").selectOption("WITNESS");
    const form = page.getByTestId("draft-form");
    const setCase = (value: string) =>
      form.locator('input[name="case_id"]').evaluate((el, v) => ((el as HTMLInputElement).value = v), value);
    for (const value of [
      C(1), // visible to Alpha, draftable
      C(2), // another workspace's case
      "0c000000-0000-4000-8000-0000000000ff", // unknown
      "CDF-DEMO-2026-0001", // a display number
    ]) {
      await setCase(value);
      await page.getByTestId("draft-submit").click();
      const error = page.getByTestId("draft-error");
      await expect(error.getByTestId("correlation-id")).toHaveText(UUID);
      await expect(page).toHaveURL(new RegExp(`/cases/${C(4)}/notifications$`));
      expect(await error.innerText()).not.toMatch(/0c000000|CDF-DEMO|sql|stack/i);
    }
    // The same form, case id restored: the unused key creates exactly this draft, on 0004.
    await setCase(C(4));
    await page.getByTestId("draft-submit").click();
    await expect(page.getByTestId("draft-created")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/cases/${C(4)}/notifications\\?created=`));
    const created = new URL(page.url()).searchParams.get("created")!;
    expect(created).toMatch(UUID);
    expect(await notificationIds(page, 1)).not.toContain(created);
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

  /** Creates a WITNESS draft on case i with the given template version (default: the first offered); returns its id. */
  async function witnessDraft(page: Page, i: number, templateVersionId?: string): Promise<string> {
    await page.goto(`/cases/${C(i)}/notifications`);
    if (templateVersionId) await page.getByTestId("draft-template").selectOption(templateVersionId);
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
    const eventTitle = await page
      .getByTestId(`case-notification-${id}`)
      .getByTestId("case-notification-template-name")
      .innerText();
    expect(frameTitle).toBe(createTranslator("ar")("case.preview.frameTitle", { title: eventTitle }));
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

  for (const notice of [
    { lang: "ar", templateVersionId: "1f000000-0000-4000-8000-000000000001" },
    { lang: "en", templateVersionId: "1f000000-0000-4000-8000-000000000002" },
  ] as const) {
    test(`disclosure (${notice.lang} notice): the fields withheld from WITNESS are absent from the frame, its names and every payload`, async ({
      page,
    }) => {
      const { outcomes, withheld, kept, generalized } = witnessOracle();
      // The app's own decision (lib/disclosure, the board's oracle) equals the policy-file derivation, field by field,
      // so a drift in either names the field.
      const decided = runServerScript<Record<string, string>>(`
        const { decide, loadPolicy } = await import("@/lib/disclosure/project");
        const policy = loadPolicy();
        const out = {};
        for (const field of ${JSON.stringify(Object.keys(MODEL_FIELDS))})
          out[field] = decide(policy, { recipient: "WITNESS", field, channel: "IN_APP", context: "CASE_PUBLIC" }).outcome;
        console.log(JSON.stringify(out));
      `);
      for (const field of Object.keys(MODEL_FIELDS))
        expect(decided[field], `lib/disclosure and the policy file disagree on WITNESS ${field}`).toBe(
          outcomes[field],
        );
      // the oracle is not vacuous: the fields ARCH named for QA-009 are where the policy puts them
      expect(withheld).toEqual(
        expect.arrayContaining([
          "case_number",
          "card_content",
          "preheader",
          "subject_detail",
          "delivery_status",
        ]),
      );
      expect(kept).toEqual(
        expect.arrayContaining([
          "event_title",
          "issuer",
          "notice_reference",
          "template_code",
          "confidentiality_notice",
        ]),
      );
      expect(Object.keys(generalized)).toEqual(["classification_marking"]);

      await signInAs(page, "secretary-alpha");
      const id = await witnessDraft(page, ALPHA_CASE, notice.templateVersionId);
      const caseRef = await page.getByTestId("case-header").getAttribute("data-case-ref");
      expect(caseRef).toBe(`CDF-DEMO-2026-${String(ALPHA_CASE).padStart(4, "0")}`);
      const templateOption = page.locator(
        `[data-testid="draft-template"] option[value="${notice.templateVersionId}"]`,
      );
      const templateCode = await templateOption.getAttribute("data-template-code");
      expect(templateCode).toMatch(/^CF-\d+_[A-Z_]+$/);

      // Every document and RSC body the server sends this case's notifications route while the preview opens (link
      // click) and on a reload, prefetches included. The bodies are read in the test, through page.route and
      // route.fetch(), and handed on to the page unchanged. Reading them from the browser afterwards (response.text())
      // is not enough: the router aborts its RSC fetch once it has consumed the payload, Chromium keeps no body for an
      // aborted request, and a body that cannot be read would pass every negative check as "" (SEC INFO 1 on #114; the
      // click's payload was lost that way before V13-QA-012). A body the test cannot fetch is recorded, and there
      // must be none.
      const previewRoute = new RegExp(`/cases/${C(ALPHA_CASE)}/notifications(\\?|$)`);
      const unread: string[] = [];
      let step: string[] = [];
      await page.route(previewRoute, async (route) => {
        const kind = `${route.request().method()} ${route.request().resourceType()}`;
        let response;
        let body: string;
        try {
          response = await route.fetch();
          body = await response.text();
        } catch {
          unread.push(kind);
          return route.abort();
        }
        if (/text\/html|text\/x-component/.test(response.headers()["content-type"] ?? "")) step.push(body);
        // the page may have dropped a prefetch meanwhile; the body was read either way
        await route.fulfill({ response, body }).catch(() => undefined);
      });
      await page.getByTestId(`case-notification-preview-link-${id}`).click();
      await expect(page.getByTestId("case-preview-ready")).toHaveAttribute("data-notification-id", id);
      const onClick = step.map(unescapePayload);
      step = [];
      await page.reload();
      await expect(page.getByTestId("case-preview-ready")).toHaveAttribute("data-notification-id", id);
      const onReload = step.map(unescapePayload);
      await page.unroute(previewRoute);
      expect(unread, "document or RSC bodies the test could not read").toEqual([]);
      const payloads = [...onClick, ...onReload];
      const frameDocs = payloads.flatMap(previewDocuments);
      // the click's RSC payload and the reload's document each carry the frame's document
      expect(
        onClick.flatMap(previewDocuments).length,
        "frame document in the click's payload",
      ).toBeGreaterThanOrEqual(1);
      expect(
        onReload.flatMap(previewDocuments).length,
        "frame document in the reload's document",
      ).toBeGreaterThanOrEqual(1);

      const frame = page.getByTestId("case-notification-preview-frame");
      const srcdoc = (await frame.getAttribute("srcdoc")) ?? "";
      const title = (await frame.getAttribute("title")) ?? "";
      const inner = page.frameLocator('[data-testid="case-notification-preview-frame"]');
      const names = await inner.locator("body").ariaSnapshot();
      const text = await inner.locator("body").innerText();
      const dict = notice.lang === "ar" ? RENDER_AR : RENDER_EN;
      const ownMarking = dict["classification.internal"];

      // Markers a withheld field would leave in the rendered notice, per field. A withheld field the table does not
      // know fails, so a new PROHIBITED field gets a browser check before it can pass.
      const leaks: Record<string, readonly string[]> = {
        case_number: [caseRef!, 'data-field="case_number"', RENDER_AR["ui.caseRef"], RENDER_EN["ui.caseRef"]],
        card_content: [
          'data-field="card_content"',
          "card_content",
          "AdaptiveCard",
          "application/adaptivecard",
        ],
        preheader: ['data-field="preheader"', "preheader", "mso-hide:all"],
        subject_detail: ['data-field="subject_detail"', "subject_detail", "{{case_reference}}"],
        delivery_status: [
          'data-field="delivery_status"',
          "data-delivery=",
          RENDER_AR["ui.delivery"],
          RENDER_EN["ui.delivery"],
          RENDER_AR["ui.deliveryNote"],
          RENDER_EN["ui.deliveryNote"],
        ],
      };
      for (const field of withheld) {
        if (!(field in MODEL_FIELDS)) continue; // a policy field this notice's model does not carry
        const markers = leaks[field];
        expect(markers, `no browser leak markers for withheld field ${field}`).toBeDefined();
        for (const m of markers!) {
          expect(srcdoc, `${field}: ${m} in the frame document`).not.toContain(m);
          expect(text, `${field}: ${m} in the frame text`).not.toContain(m);
          expect(names, `${field}: ${m} in the frame's accessible names`).not.toContain(m);
          expect(title, `${field}: ${m} in the frame title`).not.toContain(m);
          for (const doc of frameDocs)
            expect(doc, `${field}: ${m} in a payload's frame document`).not.toContain(m);
        }
      }
      // field names and the projector's log never travel to the browser at all (the page shows the case number in its
      // own header, so that value is checked inside the frame's document only)
      for (const body of payloads) {
        for (const m of [
          "card_content",
          "subject_detail",
          "delivery_status",
          "_disclosure_log",
          "_disclosure_applied",
        ])
          expect(body, `${m} in a payload`).not.toContain(m);
        expect(body).not.toContain('data-field="case_number"');
        expect(body).not.toContain('data-field="delivery_status"');
        expect(body).not.toContain(RENDER_AR["classification.internal"]);
        expect(body).not.toContain(RENDER_EN["classification.internal"]);
      }

      // GENERALIZED: the classification shows the class-safe wording only, never the notice's own marking
      const badge = inner.locator('[data-field="classification_marking"]');
      await expect(badge).toHaveCount(1);
      await expect(badge).toContainText(generalized.classification_marking![notice.lang]);
      expect(srcdoc).not.toContain(ownMarking);
      expect(names).not.toContain(ownMarking);

      // control: the allowed fields are rendered
      const eventTitle =
        notice.lang === "ar" ? TEMPLATE_NAMES[templateCode!]!.ar : TEMPLATE_NAMES[templateCode!]!.en;
      await expect(inner.locator('[data-field="event_title"]')).toHaveText(eventTitle);
      await expect(inner.locator('[data-field="issuer"]')).not.toBeEmpty();
      await expect(inner.locator('[data-field="notice_reference"]')).toHaveText(/^NTF-DEMO-[0-9A-F]{8}$/);
      await expect(inner.locator('[data-field="confidentiality_notice"]')).not.toBeEmpty();
      // template_code is ALLOWED for WITNESS, but the platform renderer shows it nowhere in the notice (the e-mail
      // renderer carries it in a metadata header only), so there is nothing to find in the frame: not a control here.
      expect(names).toContain(eventTitle);
      expect(title).toBe(createTranslator("ar")("case.preview.frameTitle", { title: eventTitle }));

      // The plain-text version of the same rendering (V13-FE-011) withholds the same fields: no marker of a withheld
      // field and not the notice's own classification marking; the class-safe wording and the allowed fields are in it
      // (control). It is read from the page as it shows it, after opening it (V13-QA-012).
      await page.getByTestId("case-preview-text-toggle").click();
      const twinBody = page.getByTestId("case-preview-text-body");
      await expect(twinBody).toBeVisible();
      const twin = await twinBody.innerText();
      for (const field of withheld) {
        if (!(field in MODEL_FIELDS)) continue;
        for (const m of leaks[field]!)
          expect(twin, `${field}: ${m} in the plain-text version`).not.toContain(m);
        expect(twin, `field name ${field} in the plain-text version`).not.toContain(field);
      }
      expect(twin).not.toContain(ownMarking);
      expect(twin).toContain(generalized.classification_marking![notice.lang]);
      expect(twin).toContain(eventTitle);
      const reference = await inner.locator('[data-field="notice_reference"]').innerText();
      expect(twin).toContain(reference);
      const issuer = await inner.locator('[data-field="issuer"]').innerText();
      expect(twin).toContain(issuer.trim());
      const notice_ = await inner.locator('[data-field="confidentiality_notice"]').innerText();
      expect(twin).toContain(notice_.trim().split("\n")[0]!.trim());
    });
  }

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
  // V13-FE-013 (OI-026): the tab reads one bounded page. The seed holds fewer than 25 notifications per case, so there
  // is no pager; an edited or forged cursor shows the empty state with a link to the first page, never an error.
  test("the Notifications tab: no pager on one page; a tampered or forged cursor shows the empty state, never an error", async ({
    page,
  }) => {
    await signInAs(page, "secretary-alpha");
    await page.goto(`/cases/${C(3)}/notifications`);
    await expect(page.locator('tr[data-testid^="case-notification-"]').first()).toBeVisible();
    await expect(page.getByTestId("case-notifications-pagination")).toHaveCount(0);
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        k: "notifications",
        at: "2026-01-01T00:00:00.000000Z",
        id: "0f000000-0000-4000-8000-0000000000ff",
      }),
      "utf8",
    ).toString("base64url");
    const tasksCursor = Buffer.from(
      JSON.stringify({ v: 1, k: "tasks", at: "-|INTAKE_REVIEW", id: "0d000000-0000-4000-8000-0000000000ff" }),
      "utf8",
    ).toString("base64url");
    for (const query of [
      "after=not$a$cursor",
      "after=a&after=b",
      "back=~",
      `after=${forged}&back=~`,
      `after=${tasksCursor}`,
      "after=Zm9yZ2Vk",
    ]) {
      const response = await page.goto(`/cases/${C(3)}/notifications?${query}`);
      expect(response?.status(), query).toBe(200);
      await expect(page.getByTestId("case-notifications-empty"), query).toBeVisible();
      await expect(page.getByTestId("case-error")).toHaveCount(0);
      await expect(page.getByTestId("case-notifications-next")).toHaveCount(0);
      await expect(page.locator('tr[data-testid^="case-notification-"]')).toHaveCount(0);
    }
    await page.getByTestId("case-notifications-prev").click();
    await expect(page).toHaveURL(new RegExp(`/cases/${C(3)}/notifications$`));
    await expect(page.locator('tr[data-testid^="case-notification-"]').first()).toBeVisible();
  });

  // V13-FE-011 (REQ-NOTIF-011): the plain-text twin of the same rendering, under the frame, closed by default.
  test("the preview's plain-text version opens under the frame in the notice's language, as text, with no page scroll at 320 px", async ({
    page,
  }) => {
    await signInAs(page, "secretary-alpha");
    const id = await witnessDraft(page, ALPHA_CASE);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/cases/${C(ALPHA_CASE)}/notifications?n=${id}`);
    const details = page.getByTestId("case-preview-text");
    const body = page.getByTestId("case-preview-text-body");
    await expect(details).not.toHaveAttribute("open", /.*/);
    await expect(body).toBeHidden();
    await page.getByTestId("case-preview-text-toggle").click();
    await expect(body).toBeVisible();
    const lang = (await body.getAttribute("lang")) ?? "";
    expect(["ar", "en"]).toContain(lang);
    await expect(body).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    const text = await body.innerText();
    expect(text.split("\n")[0]).toContain("DESIGN_PREVIEW");
    // text only: no element inside, and the frame's document is not on the page
    await expect(body.locator("*")).toHaveCount(0);
    await expect(page.locator('[data-marking="DESIGN_PREVIEW"]')).toHaveCount(0);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBe(clientWidth);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .options({ iframes: false })
      .setLegacyMode(true)
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });
});
