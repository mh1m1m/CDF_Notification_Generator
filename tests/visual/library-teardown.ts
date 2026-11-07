// Global teardown of the `visual-library` project (V13-QA-014; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §2.4, §3): merges
// the manifest parts each library test wrote into test-results/library/manifest.json, with the commit and the font
// packages and versions of the machine that made the images. Font versions come from dpkg-query, so they are recorded
// in the CI visual job (Ubuntu); elsewhere the manifest says they were not recorded, which marks the images as local
// ones that are never baselines.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAPTURE_STYLE,
  DRAFT_TIME_STYLE,
  BROWSER_TIME,
  FONT_PACKAGES,
  imageCount,
  LIBRARY_DIR,
  MANIFEST_PARTS_DIR,
  MASK_COLOR,
  MASKS,
} from "./library-plan";

function run(cmd: string, args: readonly string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export default function libraryTeardown(): void {
  if (!existsSync(MANIFEST_PARTS_DIR)) return;
  const images = readdirSync(MANIFEST_PARTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(MANIFEST_PARTS_DIR, f), "utf8")) as object[]);
  const fonts = run("dpkg-query", ["-W", "-f=${Package} ${Version}\\n", ...FONT_PACKAGES]);
  const manifest = {
    classification: "SYNTHETIC-DATA REFERENCE IMPLEMENTATION: seeded synthetic data only",
    commit: process.env.GITHUB_SHA ?? run("git", ["rev-parse", "HEAD"]),
    madeIn: process.env.CI === "true" ? "CI" : "local (never a baseline: fonts differ by machine)",
    browserTime: BROWSER_TIME,
    maskColor: MASK_COLOR,
    captureStyle: CAPTURE_STYLE,
    draftTimeStyle: DRAFT_TIME_STYLE,
    fonts: fonts
      ? fonts.split("\n").map((line) => (/^\S+ \S/.test(line) ? line : `${line.trim()} (not installed)`))
      : "not recorded (not the CI visual job): these images are never baselines",
    planned: imageCount(),
    written: images.length,
    images,
  };
  writeFileSync(join(LIBRARY_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  maskCoverage(images as LibraryEntry[]);
}

export interface LibraryEntry {
  file: string;
  maskProbe?: { masks: Record<string, { matched: number; rewritten: number }> };
}

/**
 * The mask width probe's coverage (V13-QA-023): every mask in MASKS matched an element in at least one captured cell,
 * and every matched element was rewritten, so a selector that drifted can never pass silently. Thrown errors fail
 * the run. Checked only when every planned image was written (a partial run already failed on its own tests).
 */
export function maskCoverage(images: LibraryEntry[], planned = imageCount()): void {
  if (images.length !== planned) return;
  for (const mask of Object.keys(MASKS)) {
    const counts = images.map((e) => e.maskProbe?.masks[mask]).filter((n) => n !== undefined);
    const matched = counts.reduce((sum, n) => sum + n.matched, 0);
    const rewritten = counts.reduce((sum, n) => sum + n.rewritten, 0);
    if (matched === 0)
      throw new Error(`mask width probe: mask ${mask} matched no element in any library cell`);
    if (rewritten !== matched)
      throw new Error(`mask width probe: mask ${mask} matched ${matched} elements but rewrote ${rewritten}`);
  }
}
