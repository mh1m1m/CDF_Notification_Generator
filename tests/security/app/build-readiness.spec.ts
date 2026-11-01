// V13-SEC-012 · SEC-APP-22: SEC-APP-13's bundle scan fails in CI when the local build is missing, and skips only
// locally (tests/security/build-readiness.ts). The source check pins the call in surface.spec.ts, so removing the
// fail-in-CI branch fails this test. SYNTHETIC data only; nothing is built or served.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requireBuildWhenSignalled } from "../build-readiness";

describe("SEC-APP-22 the bundle scan never skips silently in CI", () => {
  it("a present build passes, with or without a signal", () => {
    expect(() => requireBuildWhenSignalled("scan", true, { CI: "true" })).not.toThrow();
    expect(() => requireBuildWhenSignalled("scan", true, {})).not.toThrow();
  });

  it("a missing build fails when any requiredBy() signal is set, naming the signals", () => {
    for (const env of [
      { CI: "true" },
      { CI: "1" },
      { CI: "false", GITHUB_ACTIONS: "true" },
      { V13_DB_TESTS_REQUIRED: "1" },
    ]) {
      expect(
        () => requireBuildWhenSignalled("SEC-APP-13 bundle scan", false, env),
        JSON.stringify(env),
      ).toThrow(
        /SEC-APP-13 bundle scan: no local build \(\.next\/static\); in CI the build must exist \(.+\), so this fails/,
      );
    }
  });

  it("a missing build returns normally in a local run, leaving the allow-listed skip to act", () => {
    for (const env of [{}, { CI: "" }, { CI: "0" }, { CI: "false" }, { GITHUB_ACTIONS: "false" }])
      expect(() => requireBuildWhenSignalled("scan", false, env), JSON.stringify(env)).not.toThrow();
  });

  it("surface.spec.ts calls the fail-in-CI branch immediately before its missing-build skip", () => {
    const src = readFileSync(join(process.cwd(), "tests/security/e2e/surface.spec.ts"), "utf8").split("\n");
    const skip = src.findIndex((l) => l.trim() === 'test.skip(!existsSync(root), "no local build");');
    expect(skip, "the allow-listed skip is present, with its exact text").toBeGreaterThan(0);
    expect(src[skip - 1]?.trim()).toBe(
      'requireBuildWhenSignalled("SEC-APP-13 bundle scan", existsSync(root));',
    );
    expect(src.filter((l) => l.includes("requireBuildWhenSignalled(")).length).toBe(1);
  });
});
