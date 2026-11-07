// Screenshot library (V13-QA-014; UXQA-05; REQ-VIS-001, -004, -005, -010, -011, -015; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md
// §2–§4). Every row of library-plan.ts is captured in every viewport, language and theme it applies to. Before each
// capture the state's own marker must be visible (a wrong state never yields an image) and the data check
// (data-check.ts, V1–V5) must pass on the unmasked page and every frame (a finding fails the test and writes no image).
//
// Runs only in the `visual-library` project (V13_E2E_VISUAL=library; playwright.config.ts), after `pnpm db:reset`.
// Images go to test-results/library/<screen>/<state>.<lang>.<viewport>.<theme>.png and are never committed; each test
// writes its manifest part, and library-teardown.ts merges the parts into test-results/library/manifest.json. No
// baseline is compared here (§5 adds the committed subset). Each cell also runs the mask width probe (V13-QA-023,
// mask-probe.ts). SYNTHETIC personas and seeded cases only.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { captureCell, openCell, startRow } from "./capture";
import {
  CAPTURES,
  captureFile,
  LANGUAGES,
  LIBRARY_DIR,
  MANIFEST_PARTS_DIR,
  MASKS,
  THEMES,
  viewportsOf,
  withDraft,
} from "./library-plan";
import { probeMasks } from "./mask-probe";

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
          // To memory first: an empty frame or a frame mask with no element never yields an image (capture.ts).
          const { png, maskCounts, attempts } = await captureCell(page, c, draft);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, png);
          // The mask width probe (V13-QA-023, mask-probe.ts), as in the baseline job; library-teardown.ts fails the run
          // when a mask in MASKS matched nothing in any cell.
          const probe = await probeMasks(page, c, draft, lang, png);
          for (const v of probe.variants)
            expect
              .soft(v.identical, `${file}: masked text "${v.name}" moved the page (mask width probe)`)
              .toBe(true);
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
            captureAttempts: attempts,
            masks: c.masks.map((m, i) => ({
              name: m,
              selector: withDraft(MASKS[m].selector, draft),
              frame: (MASKS[m] as { frame?: string }).frame ?? null,
              reason: MASKS[m].reason,
              count: maskCounts[i],
            })),
            maskProbe: {
              masks: probe.masks,
              variants: probe.variants.map((v) => ({ name: v.name, identical: v.identical })),
            },
          });
        }
      }
    }

    mkdirSync(MANIFEST_PARTS_DIR, { recursive: true });
    writeFileSync(join(MANIFEST_PARTS_DIR, `${c.screen}.${c.state}.json`), JSON.stringify(entries, null, 2));
  });
}
