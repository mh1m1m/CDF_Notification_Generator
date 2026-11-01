// V13-SEC-010 · SEC's database suites fail in CI when the database is not ready, and skip only locally
// (tests/security/db/readiness.ts). SYNTHETIC data only; no database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readinessVerdict } from "../db/readiness";

afterEach(() => vi.restoreAllMocks());

describe("SEC-APP-21 a database suite never skips silently in CI", () => {
  it("a ready database runs the suite, in CI and locally", () => {
    expect(readinessVerdict("case-matrix", true, "n/a", { CI: "true" })).toBe(true);
    expect(readinessVerdict("case-matrix", true, "n/a", {})).toBe(true);
  });

  it("not ready in CI fails with the suite's label and reason, for every truthy CI value", () => {
    for (const CI of ["true", "1", "TRUE", "yes"]) {
      expect(
        () => readinessVerdict("case-matrix", false, "migration 0006 or the cases seed is missing", { CI }),
        CI,
      ).toThrow(/case-matrix: migration 0006 or the cases seed is missing; in CI .* fails, never skips/);
    }
  });

  it("not ready locally skips with a warning (CI unset, empty, 0 or false)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const env of [{}, { CI: "" }, { CI: "0" }, { CI: "false" }]) {
      expect(readinessVerdict("case-matrix", false, "schema not present", env), JSON.stringify(env)).toBe(
        false,
      );
    }
    expect(warn).toHaveBeenCalledTimes(4);
    expect(String(warn.mock.calls[0]?.[0])).toContain("skipping case-matrix: schema not present");
  });
});
