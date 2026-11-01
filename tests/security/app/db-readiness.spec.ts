// V13-SEC-010 · SEC's database suites fail in CI when the database is not ready, and skip only locally
// (tests/security/db/readiness.ts); V13-SEC-011 adds V13_DB_TESTS_REQUIRED=1 and GITHUB_ACTIONS=true as signals.
// SYNTHETIC data only; no database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readinessVerdict, requiredBy } from "../db/readiness";

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

  // V13-SEC-011: CI=false alone cannot turn the requirement off.
  it("V13_DB_TESTS_REQUIRED=1 or GITHUB_ACTIONS=true requires the database even with CI=false or unset", () => {
    for (const env of [
      { CI: "false", V13_DB_TESTS_REQUIRED: "1" },
      { V13_DB_TESTS_REQUIRED: "1" },
      { CI: "0", GITHUB_ACTIONS: "true" },
      { GITHUB_ACTIONS: "TRUE" },
      { CI: "", V13_DB_TESTS_REQUIRED: " 1 ", GITHUB_ACTIONS: "true" },
    ]) {
      expect(
        () => readinessVerdict("commands", false, "the local cluster does not answer", env),
        JSON.stringify(env),
      ).toThrow(
        /commands: the local cluster does not answer; in CI the database must be ready \(.+\), so this fails/,
      );
    }
  });

  it("names every signal that required the database, and none locally", () => {
    expect(requiredBy({ CI: "true", V13_DB_TESTS_REQUIRED: "1", GITHUB_ACTIONS: "true" })).toEqual([
      "CI",
      "V13_DB_TESTS_REQUIRED=1",
      "GITHUB_ACTIONS",
    ]);
    expect(requiredBy({})).toEqual([]);
    // Values that do not require it: V13_DB_TESTS_REQUIRED other than 1, GITHUB_ACTIONS other than true.
    expect(requiredBy({ CI: "false", V13_DB_TESTS_REQUIRED: "0", GITHUB_ACTIONS: "false" })).toEqual([]);
    expect(requiredBy({ V13_DB_TESTS_REQUIRED: "", GITHUB_ACTIONS: "" })).toEqual([]);
  });
});
