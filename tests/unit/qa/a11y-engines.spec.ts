// V13-QA-026 (ARCH's conditions on #181): which engine runs which accessibility suite, read from the runner's own
// listing of the real playwright.config.ts with both engines selected (`--list` loads the files; no browser, no server).
// The axe sweep runs in Chromium (desktop-ar) only, by the engines' testIgnore (CHROMIUM_ONLY in
// tests/fixtures/browsers.ts), never by a skip: in Firefox and WebKit its planted tests failed (Cross-browser
// 42400335710 on 88eaa1f), so there it could pass without seeing a fault. The reflow suite runs in all three engines.
// A later config edit can therefore neither drop the sweep from Chromium nor let it into an engine where its plants are
// not proven.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CHROMIUM_ONLY } from "../../fixtures/browsers";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CLI = join(ROOT, "node_modules", "@playwright", "test", "cli.js");
const SWEEP = "a11y/sweep.a11y.spec.ts";
const REFLOW = "a11y/reflow.a11y.spec.ts";

interface Suite {
  specs?: { title: string; file: string; tests: { projectName: string }[] }[];
  suites?: Suite[];
}

// A listing writes nothing, but an explicit output directory keeps any child run away from the repository's
// test-results/ (ARCH, 7 Nov 2026).
const OUT = mkdtempSync(join(tmpdir(), "qa-a11y-engines-"));
afterAll(() => rmSync(OUT, { recursive: true, force: true }));

/** [project, file, title] for every test the runner lists for the two files, both engines selected. */
function listing(): [string, string, string][] {
  const json = execFileSync(
    process.execPath,
    [CLI, "test", "--list", "--reporter=json", "--output", OUT, `tests/${SWEEP}`, `tests/${REFLOW}`],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        V13_E2E_BROWSERS: "firefox-ar,webkit-ar",
        V13_E2E_VISUAL: "",
        V13_E2E_BASE_URL: "",
      },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const out: [string, string, string][] = [];
  const walk = (s: Suite) => {
    for (const spec of s.specs ?? [])
      for (const t of spec.tests) out.push([t.projectName, spec.file, spec.title]);
    for (const child of s.suites ?? []) walk(child);
  };
  for (const s of (JSON.parse(json) as { suites: Suite[] }).suites) walk(s);
  return out;
}

const count = (rows: [string, string, string][], project: string, file: string) =>
  rows.filter(([p, f]) => p === project && f === file).length;

describe("accessibility suites per engine (V13-QA-026)", () => {
  const rows = listing();

  it("the axe sweep and its five plants run in desktop-ar", () => {
    expect(count(rows, "desktop-ar", SWEEP)).toBe(53);
    const plants = rows.filter(([p, f, t]) => p === "desktop-ar" && f === SWEEP && !/^S\d\d /.test(t));
    expect(plants.map(([, , t]) => t)).toHaveLength(5);
  });

  it("the axe sweep is listed by no other project", () => {
    expect(rows.filter(([p, f]) => f === SWEEP && p !== "desktop-ar")).toEqual([]);
  });

  it("Firefox and WebKit leave the sweep out through CHROMIUM_ONLY (testIgnore), with its reason", () => {
    expect(CHROMIUM_ONLY[`tests/${SWEEP}`]).toMatch(/42400335710/);
  });

  it("reflow runs in all three engines, with its 27 tests each", () => {
    for (const project of ["desktop-ar", "firefox-ar", "webkit-ar"])
      expect(count(rows, project, REFLOW), project).toBe(27);
  });

  it("the sweep has no skip, fixme or engine condition of its own", () => {
    const src = readFileSync(join(ROOT, "tests", SWEEP), "utf8");
    expect(src).not.toMatch(/\btest\.(skip|fixme|fail)\b|\bbrowserName\b/);
  });
});
