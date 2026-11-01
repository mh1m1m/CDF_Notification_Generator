// Visual baselines (V13-QA-015; REQ-VIS-012; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §5, D2). The committed subset
// (library-plan.ts BASELINE_ROWS: each screen's data state and the open switcher, desktop and mobile, ar and en,
// light) is compared with tests/visual/__screenshots__/ through toHaveScreenshot: threshold 0.2, not one pixel more.
// Each cell is opened and proven exactly as the library does (capture.ts openCell: status, language, state marker,
// data check V1–V5) before the comparison, with the same masks and capture style.
//
// Never auto-approved (§5.2): playwright.config.ts sets updateSnapshots to "none" in CI, and the leak-suite guard's
// G7 fails any other setting and any --update-snapshots in a workflow or package script. A changed baseline fails here
// and Playwright writes the expected, actual and diff images to the job's artifact. A missing one fails too, and since
// Playwright then writes no image, this spec writes the candidate itself to test-results/baseline-candidates/ with the
// same options; a new baseline is such a candidate from the CI visual job, committed in a PR that lists it, never one
// made in a sandbox (fonts differ by machine).
// Runs only in the `visual-baseline` project (V13_E2E_VISUAL=baseline), after `pnpm db:reset`. SYNTHETIC data only.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { masksFor, openCell, startRow } from "./capture";
import {
  BASELINE_CANDIDATES_DIR,
  BASELINE_COMPARE,
  BASELINE_ROWS,
  BASELINE_THEME,
  BASELINE_VIEWPORTS,
  baselineFile,
  CAPTURE_STYLE,
  LANGUAGES,
  MASK_COLOR,
} from "./library-plan";

for (const c of BASELINE_ROWS) {
  test(`baseline: ${c.screen} / ${c.state}`, async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    const { draft, route } = await startRow(page, context, baseURL!, c);
    for (const lang of LANGUAGES) {
      for (const viewport of BASELINE_VIEWPORTS) {
        await openCell(page, context, baseURL!, c, route, { lang, viewport, theme: BASELINE_THEME });
        const name = baselineFile(c, lang, viewport);
        const options = {
          ...BASELINE_COMPARE,
          animations: "disabled" as const,
          caret: "hide" as const,
          mask: masksFor(page, c, draft),
          maskColor: MASK_COLOR,
          style: CAPTURE_STYLE,
        };
        if (!existsSync(test.info().snapshotPath(name, { kind: "screenshot" }))) {
          // The candidate for review; the comparison below still fails, so a missing baseline is never green.
          mkdirSync(BASELINE_CANDIDATES_DIR, { recursive: true });
          const path = join(BASELINE_CANDIDATES_DIR, name);
          if (c.element) await page.locator(c.element).screenshot({ ...options, path });
          else await page.screenshot({ ...options, path, fullPage: true });
        }
        // Soft, so one changed screen still lets the other cells of the row be compared and reported.
        if (c.element) await expect.soft(page.locator(c.element)).toHaveScreenshot(name, options);
        else await expect.soft(page).toHaveScreenshot(name, { ...options, fullPage: true });
      }
    }
  });
}
