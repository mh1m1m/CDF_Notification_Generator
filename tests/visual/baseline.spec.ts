// Visual baselines (V13-QA-015; REQ-VIS-012; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §5, D2). The committed subset
// (library-plan.ts BASELINE_ROWS: each screen's data state and the open switcher, desktop and mobile, ar and en,
// light) is compared with tests/visual/__screenshots__/ through toMatchSnapshot on the image capture.ts makes (the
// library's own capture path): threshold 0.2, not one pixel more.
// Each cell is opened and proven exactly as the library does (capture.ts openCell: status, language, state marker,
// data check V1–V5) before the comparison, with the same masks and capture style.
//
// Never auto-approved (§5.2): playwright.config.ts sets updateSnapshots to "none" for every run, and the leak-suite guard's
// G7 fails any other setting and any --update-snapshots in a workflow or package script. A changed baseline fails here
// and Playwright writes the expected, actual and diff images to the job's artifact. A missing one fails too, and since
// Playwright then writes no image, this spec writes the candidate itself to test-results/baseline-candidates/ with the
// same options; a new baseline is such a candidate from the CI visual job, committed in a PR that lists it, never one
// made in a sandbox (fonts differ by machine).
// Runs only in the `visual-baseline` project (V13_E2E_VISUAL=baseline), after `pnpm db:reset`. SYNTHETIC data only.
//
// The mask width probe (V13-QA-023, mask-probe.ts) runs on every cell after its comparison: each masked element is
// rewritten to values the app can show and the cell captured again, and every image must be byte-identical to the
// cell's own capture. Each row writes how many elements each mask matched and rewritten, per cell, to the results JSON
// (an annotation) and to the project's output directory; the last test fails when a mask a baseline row names matched
// nothing in any cell, so a selector that drifted can never pass silently (the library job checks all of MASKS). The file runs in order in one worker for that last
// test; a failed row does not skip the others.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { captureCell, openCell, startRow } from "./capture";
import {
  BASELINE_CANDIDATES_DIR,
  BASELINE_COMPARE,
  BASELINE_ROWS,
  BASELINE_THEME,
  BASELINE_VIEWPORTS,
  baselineFile,
  LANGUAGES,
  MASKS,
} from "./library-plan";
import { probeMasks, type MaskCount } from "./mask-probe";

test.describe.configure({ mode: "default" });

/** Where each row writes its mask counts; Playwright empties the project's output directory at the start of a run. */
const probeDir = () => join(test.info().project.outputDir, "mask-probe");

for (const c of BASELINE_ROWS) {
  test(`baseline: ${c.screen} / ${c.state}`, async ({ page, context, baseURL }) => {
    test.setTimeout(300_000);
    const { draft, route } = await startRow(page, context, baseURL!, c);
    const counts: Record<string, Record<string, MaskCount>> = {};
    for (const lang of LANGUAGES) {
      for (const viewport of BASELINE_VIEWPORTS) {
        await openCell(page, context, baseURL!, c, route, { lang, viewport, theme: BASELINE_THEME });
        const name = baselineFile(c, lang, viewport);
        // The one capture path the library uses (capture.ts): masks counted, frames painted, the same capture style.
        const { png } = await captureCell(page, c, draft);
        if (!existsSync(test.info().snapshotPath(name, { kind: "snapshot" }))) {
          // The candidate for review; the comparison below still fails, so a missing baseline is never green.
          mkdirSync(BASELINE_CANDIDATES_DIR, { recursive: true });
          writeFileSync(join(BASELINE_CANDIDATES_DIR, name), png);
        }
        // Soft, so one changed screen still lets the other cells of the row be compared and reported. The image is
        // compared, not re-taken: toHaveScreenshot did not apply the draft row's capture style (its time kept its own
        // width, 174 px instead of 146 px), so the comparison would have depended on the clock.
        expect.soft(png).toMatchSnapshot(name, BASELINE_COMPARE);
        // The mask width probe: masked text changed to the app's own extremes must not move one pixel.
        const probe = await probeMasks(page, c, draft, lang, png);
        counts[name] = probe.masks;
        for (const v of probe.variants) {
          if (!v.identical)
            await test.info().attach(`${name} probe ${v.name}`, { body: v.png, contentType: "image/png" });
          expect
            .soft(v.identical, `${name}: masked text "${v.name}" moved the page (mask width probe)`)
            .toBe(true);
        }
      }
    }
    test.info().annotations.push({ type: "mask-probe", description: JSON.stringify(counts) });
    mkdirSync(probeDir(), { recursive: true });
    writeFileSync(join(probeDir(), `${c.screen}-${c.state}.json`), JSON.stringify(counts));
  });
}

test("mask width probe: every mask a baseline row names matched an element in at least one cell", () => {
  const dir = probeDir();
  const rows = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  expect(rows.length, "every baseline row wrote its mask counts").toBe(BASELINE_ROWS.length);
  const matched = new Map<string, number>();
  const rewritten = new Map<string, number>();
  for (const f of rows) {
    const cells = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, Record<string, MaskCount>>;
    for (const masks of Object.values(cells))
      for (const [mask, n] of Object.entries(masks)) {
        matched.set(mask, (matched.get(mask) ?? 0) + n.matched);
        rewritten.set(mask, (rewritten.get(mask) ?? 0) + n.rewritten);
      }
  }
  test.info().annotations.push({
    type: "mask-probe-total",
    description: JSON.stringify(
      Object.fromEntries([...matched].map(([m, n]) => [m, { matched: n, rewritten: rewritten.get(m) }])),
    ),
  });
  // The library job checks every mask in MASKS the same way (library-teardown.ts); correlationId shows only on error
  // and refusal states, which are library rows, never baseline rows.
  const named = new Set(BASELINE_ROWS.flatMap((r) => r.masks));
  expect([...named].every((m) => m in MASKS)).toBe(true);
  for (const mask of named) {
    expect(
      matched.get(mask) ?? 0,
      `mask ${mask} matched an element in at least one captured cell`,
    ).toBeGreaterThan(0);
    expect(rewritten.get(mask), `mask ${mask}: every matched element was rewritten`).toBe(matched.get(mask));
  }
});
