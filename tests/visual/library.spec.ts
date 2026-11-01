// Screenshot library (V13-QA-014; UXQA-05; REQ-VIS-001, -004, -005, -010, -011, -015; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md
// §2–§4). Every row of library-plan.ts is captured in every viewport, language and theme it applies to. Before each
// capture the state's own marker must be visible (a wrong state never yields an image) and the data check
// (data-check.ts, V1–V5) must pass on the unmasked page and every frame (a finding fails the test and writes no image).
//
// Runs only in the `visual-library` project (V13_E2E_VISUAL=library; playwright.config.ts), after `pnpm db:reset`.
// Images go to test-results/library/<screen>/<state>.<lang>.<viewport>.<theme>.png and are never committed; each test
// writes its manifest part, and library-teardown.ts merges the parts into test-results/library/manifest.json. No
// baseline is compared here (§5 adds the committed subset). SYNTHETIC personas and seeded cases only.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "@playwright/test";
import { masksFor, openCell, startRow } from "./capture";
import {
  CAPTURES,
  CAPTURE_STYLE,
  captureFile,
  LANGUAGES,
  LIBRARY_DIR,
  MANIFEST_PARTS_DIR,
  MASK_COLOR,
  MASKS,
  THEMES,
  viewportsOf,
  withDraft,
} from "./library-plan";

for (const c of CAPTURES) {
  test(`library: ${c.screen} / ${c.state}`, async ({ page, context, baseURL }) => {
    // 12 captures per row with a sign-in; generous, a stuck capture still fails.
    test.setTimeout(300_000);
    const { draft, route } = await startRow(page, context, baseURL!, c);
    const entries: object[] = [];

    for (const lang of LANGUAGES) {
      for (const viewport of viewportsOf(c)) {
        for (const theme of THEMES) {
          await openCell(page, context, baseURL!, c, route, { lang, viewport, theme });
          const file = captureFile(c, lang, viewport, theme);
          const path = join(LIBRARY_DIR, file);
          mkdirSync(dirname(path), { recursive: true });
          const masks = masksFor(page, c, draft);
          const options = {
            path,
            animations: "disabled" as const,
            caret: "hide" as const,
            mask: masks,
            maskColor: MASK_COLOR,
            style: CAPTURE_STYLE,
          };
          if (c.element) await page.locator(c.element).screenshot(options);
          else await page.screenshot({ ...options, fullPage: true });

          const maskCounts = await Promise.all(masks.map((m) => m.count()));
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
