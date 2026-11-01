// Screenshot library (V13-QA-014; UXQA-05; REQ-VIS-001, -004, -005, -010, -011, -015; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md
// §2–§4). Every row of library-plan.ts is captured in every viewport, language and theme it applies to. Before each
// capture the state's own marker must be visible (a wrong state never yields an image), every frame must be in view and
// loaded (frames.ts), and the data check (data-check.ts, V1–V5) must pass on the unmasked page and every frame (a
// finding fails the test and writes no image). After the capture, a frame's area of the image must not be empty.
//
// Runs only in the `visual-library` project (V13_E2E_VISUAL=library; playwright.config.ts), after `pnpm db:reset`.
// Images go to test-results/library/<screen>/<state>.<lang>.<viewport>.<theme>.png and are never committed; each test
// writes its manifest part, and library-teardown.ts merges the parts into test-results/library/manifest.json. No
// baseline is compared here (§5 adds the committed subset). SYNTHETIC personas and seeded cases only.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { mintSession, persona, signInAs } from "../fixtures/personas";
import { checkSynthetic, formatFindings, type DataInput } from "./data-check";
import { expectFramesPainted, frameBoxes, settleFrames } from "./frames";
import {
  BROWSER_TIME,
  CAPTURES,
  captureStyle,
  captureFile,
  LANGUAGES,
  LIBRARY_DIR,
  MANIFEST_PARTS_DIR,
  MASK_COLOR,
  MASKS,
  THEMES,
  VIEWPORTS,
  viewportsOf,
  withDraft,
  type Capture,
} from "./library-plan";

/** A row is captured as a 404 page when it is the not-found screen; every other row must answer 200. */
const expectedStatus = (c: Capture) => (c.screen === "not-found" ? 404 : 200);

/** Makes a WITNESS draft on the case through its own draft form (Scenario E's path); returns the new id. */
async function makeWitnessDraft(page: Page, caseId: string): Promise<string> {
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
async function dataInputs(page: Page): Promise<DataInput[]> {
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

async function secretsOf(context: BrowserContext): Promise<string[]> {
  const values = (await context.cookies()).map((c) => c.value);
  return [...values, process.env.V13_E2E_SESSION_SECRET ?? ""].filter((v) => v.length > 0);
}

for (const c of CAPTURES) {
  test(`library: ${c.screen} / ${c.state}`, async ({ page, context, baseURL }) => {
    // 12 captures per row with a sign-in; generous, a stuck capture still fails.
    test.setTimeout(300_000);
    await page.clock.setFixedTime(new Date(BROWSER_TIME));
    await signIn(page, context, baseURL!, c.persona);
    const draft = c.draftOnCase ? await makeWitnessDraft(page, c.draftOnCase) : null;
    const route = withDraft(c.route, draft);
    const entries: object[] = [];

    for (const lang of LANGUAGES) {
      await context.addCookies([{ name: LOCALE_COOKIE, value: lang, url: baseURL! }]);
      for (const viewport of viewportsOf(c)) {
        await page.setViewportSize(VIEWPORTS[viewport]);
        for (const theme of THEMES) {
          await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
          const res = await page.goto(route);
          expect(res?.status(), `${c.route} answers ${expectedStatus(c)}`).toBe(expectedStatus(c));
          await expect(page.locator("html")).toHaveAttribute("lang", lang);
          await expect(page, "the page has rendered its title").toHaveTitle(/\S/);
          await expect(page.locator(c.ready).first(), `the ${c.state} state's marker`).toBeVisible();
          if (c.openSwitcher) {
            await page.getByTestId("workspace-switcher").click();
            await expect(page.locator('[data-testid^="workspace-menu-option-"]').first()).toBeVisible();
          }
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          // Frames in view, loaded and with their fonts, before the data check reads them and before the capture
          // (ARCH C1, C2 on #140).
          await settleFrames(page);

          const findings = checkSynthetic(await dataInputs(page), {
            personaNames: await page.locator('[data-testid="persona-menu-name"]').allTextContents(),
            secrets: await secretsOf(context),
          });
          expect(findings, formatFindings(findings)).toEqual([]);

          const file = captureFile(c, lang, viewport, theme);
          const path = join(LIBRARY_DIR, file);
          mkdirSync(dirname(path), { recursive: true });
          const masks = c.masks.map((m) => {
            const mask: { selector: string; frame?: string } = MASKS[m];
            const selector = withDraft(mask.selector, draft);
            return mask.frame ? page.frameLocator(mask.frame).locator(selector) : page.locator(selector);
          });
          // Counted before the capture, so the manifest records what the capture masked (ARCH C3 on #140). A mask inside
          // a frame always has its element once the frame has loaded; none means the frame was not what was drawn.
          const maskCounts = await Promise.all(masks.map((m) => m.count()));
          c.masks.forEach((m, i) => {
            if ((MASKS[m] as { frame?: string }).frame)
              expect(maskCounts[i], `mask ${m} covers its element in the frame`).toBeGreaterThan(0);
          });
          const options = {
            animations: "disabled" as const,
            caret: "hide" as const,
            mask: masks,
            maskColor: MASK_COLOR,
            style: captureStyle(draft),
          };
          // Captured to memory and written only after the frame check: an empty frame never yields an image.
          let png: Buffer;
          if (c.element) png = await page.locator(c.element).screenshot(options);
          else {
            const boxes = await frameBoxes(page);
            png = await page.screenshot({ ...options, fullPage: true });
            await expectFramesPainted(page, png, boxes, MASK_COLOR);
          }
          writeFileSync(path, png);

          entries.push({
            file,
            screen: c.screen,
            state: c.state,
            persona: c.persona,
            route,
            lang,
            viewport,
            theme,
            element: c.element ?? null,
            masks: c.masks.map((m, i) => ({
              name: m,
              selector: withDraft(MASKS[m].selector, draft),
              frame: (MASKS[m] as { frame?: string }).frame ?? null,
              reason: MASKS[m].reason,
              count: maskCounts[i],
            })),
          });
        }
      }
    }

    mkdirSync(MANIFEST_PARTS_DIR, { recursive: true });
    writeFileSync(join(MANIFEST_PARTS_DIR, `${c.screen}.${c.state}.json`), JSON.stringify(entries, null, 2));
  });
}
