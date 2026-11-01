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
  BROWSER_TIME,
  FONT_PACKAGES,
  imageCount,
  LIBRARY_DIR,
  MANIFEST_PARTS_DIR,
  MASK_COLOR,
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
    fonts: fonts
      ? fonts.split("\n").map((line) => (/^\S+ \S/.test(line) ? line : `${line.trim()} (not installed)`))
      : "not recorded (not the CI visual job): these images are never baselines",
    planned: imageCount(),
    written: images.length,
    images,
  };
  writeFileSync(join(LIBRARY_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
}
