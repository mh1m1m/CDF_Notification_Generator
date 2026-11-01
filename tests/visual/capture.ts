// Shared steps of the visual suites (V13-QA-014 library, V13-QA-015 baselines; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §2–§5):
// sign in, make the row's draft, open one cell of the matrix and prove it is the right state with only synthetic data,
// and build the masks. A capture happens only after openCell() returned. SYNTHETIC personas and seeded cases only.
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { mintSession, persona, signInAs } from "../fixtures/personas";
import { checkSynthetic, formatFindings, type DataInput } from "./data-check";
import { expectFramesPainted, frameBoxes, settleFrames } from "./frames";
import {
  BROWSER_TIME,
  captureStyle,
  MASK_COLOR,
  MASKS,
  VIEWPORTS,
  withDraft,
  type Capture,
  type Language,
  type Theme,
  type ViewportName,
} from "./library-plan";

/** A row is captured as a 404 page when it is the not-found screen; every other row must answer 200. */
const expectedStatus = (c: Capture) => (c.screen === "not-found" ? 404 : 200);

/** Makes a WITNESS draft on the case through its own draft form (Scenario E's path); returns the new id. */
export async function makeWitnessDraft(page: Page, caseId: string): Promise<string> {
  await page.goto(`/cases/${caseId}/notifications`);
  await page.getByTestId("draft-recipient").selectOption("WITNESS");
  await page.getByTestId("draft-submit").click();
  await expect(page.getByTestId("draft-created")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("created");
  expect(id, "the created draft's id").toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  return id!;
}

async function signIn(page: Page, context: BrowserContext, baseURL: string, slug: string) {
  if (persona(slug).negative_test) {
    await mintSession(context, baseURL, slug, "SECRETARIAT");
  } else {
    await signInAs(page, slug);
  }
}

/** Page text, page markup and every frame's markup: what the data check reads. */
export async function dataInputs(page: Page): Promise<DataInput[]> {
  const inputs: DataInput[] = [
    { where: "page text", text: await page.locator("body").innerText() },
    { where: "page markup", text: await page.content() },
  ];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    // A frame that cannot be read cannot be checked: that fails, it is never skipped.
    inputs.push({ where: `frame ${frame.name() || frame.url()}`, text: await frame.content() });
  }
  return inputs;
}

export async function secretsOf(context: BrowserContext): Promise<string[]> {
  const values = (await context.cookies()).map((c) => c.value);
  return [...values, process.env.V13_E2E_SESSION_SECRET ?? ""].filter((v) => v.length > 0);
}

/** Signs the row's persona in with the browser clock fixed, and makes its draft; returns the route with {draft} filled. */
export async function startRow(page: Page, context: BrowserContext, baseURL: string, c: Capture) {
  await page.clock.setFixedTime(new Date(BROWSER_TIME));
  await signIn(page, context, baseURL, c.persona);
  const draft = c.draftOnCase ? await makeWitnessDraft(page, c.draftOnCase) : null;
  return { draft, route: withDraft(c.route, draft) };
}

/**
 * Opens one cell (language, viewport, theme) of a row and proves it: the expected status, the page language, a title,
 * the state's own marker, the open switcher where asked, fonts loaded, every frame in view and loaded, and the data
 * check (V1–V5) on the page and every frame. Throws (fails the test) before any capture otherwise.
 */
export async function openCell(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  c: Capture,
  route: string,
  cell: { lang: Language; viewport: ViewportName; theme: Theme },
) {
  await context.addCookies([{ name: LOCALE_COOKIE, value: cell.lang, url: baseURL }]);
  await page.setViewportSize(VIEWPORTS[cell.viewport]);
  await page.emulateMedia({ colorScheme: cell.theme, reducedMotion: "reduce" });
  const res = await page.goto(route);
  expect(res?.status(), `${c.route} answers ${expectedStatus(c)}`).toBe(expectedStatus(c));
  await expect(page.locator("html")).toHaveAttribute("lang", cell.lang);
  await expect(page, "the page has rendered its title").toHaveTitle(/\S/);
  await expect(page.locator(c.ready).first(), `the ${c.state} state's marker`).toBeVisible();
  if (c.openSwitcher) {
    await page.getByTestId("workspace-switcher").click();
    await expect(page.locator('[data-testid^="workspace-menu-option-"]').first()).toBeVisible();
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Frames in view, loaded and with their fonts, before the data check reads them and before the capture (ARCH C1, C2
  // on #140; frames.ts).
  await settleFrames(page);
  const findings = checkSynthetic(await dataInputs(page), {
    personaNames: await page.locator('[data-testid="persona-menu-name"]').allTextContents(),
    secrets: await secretsOf(context),
  });
  expect(findings, formatFindings(findings)).toEqual([]);
}

/** The row's masks as locators (a frame mask inside its frame), with {draft} filled. */
export function masksFor(page: Page, c: Capture, draft: string | null): Locator[] {
  return c.masks.map((m) => {
    const mask: { selector: string; frame?: string } = MASKS[m];
    const selector = withDraft(mask.selector, draft);
    return mask.frame ? page.frameLocator(mask.frame).locator(selector) : page.locator(selector);
  });
}

/** Options shared by every capture and comparison of a row. */
export function captureOptions(page: Page, c: Capture, draft: string | null) {
  return {
    animations: "disabled" as const,
    caret: "hide" as const,
    mask: masksFor(page, c, draft),
    maskColor: MASK_COLOR,
    style: captureStyle(draft),
  };
}

/**
 * Captures the opened cell to memory: mask counts first (ARCH C3 on #140; a mask inside a frame must cover its
 * element), then the image, which must show every frame painted. The caller writes the image only after this returns.
 */
export async function captureCell(page: Page, c: Capture, draft: string | null) {
  const options = captureOptions(page, c, draft);
  const maskCounts = await Promise.all(options.mask.map((m) => m.count()));
  c.masks.forEach((m, i) => {
    if ((MASKS[m] as { frame?: string }).frame)
      expect(maskCounts[i], `mask ${m} covers its element in the frame`).toBeGreaterThan(0);
  });
  if (c.element) return { png: await page.locator(c.element).screenshot(options), maskCounts };
  const boxes = await frameBoxes(page);
  const png = await page.screenshot({ ...options, fullPage: true });
  await expectFramesPainted(page, png, boxes, MASK_COLOR);
  return { png, maskCounts };
}
