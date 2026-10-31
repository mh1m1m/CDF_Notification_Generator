// tests/unit/domain/evidence-scan.spec.ts — CDF Notifications V13 · copy-time scan of PROC test evidence and data files.
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
//
// SEC ruling on PR #3: every file copied from the reference package into the repository is scanned for personal-data
// shapes. Scope: every tests/unit/<proc folder>/__evidence__ file and every JSON data file under the PROC lib folders.
// A hit fails the test unless ALLOW lists it exactly (file name, pattern, matched text) with the reviewed reason.
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROC = ["domain", "journeys", "disclosure", "authority", "notifications"];

const PATTERNS: Readonly<Record<string, RegExp>> = {
  email_not_example_test: /[A-Za-z0-9._%+-]+@(?!example\.test\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  gov_sa: /gov\.sa/gi,
  national_id_like: /(?<![0-9A-Za-z])[12]\d{9}(?![0-9A-Za-z])/g,
  phone_966: /(?:\+|00)966[\s-]?\d/g,
  phone_05: /(?<![0-9A-Za-z])05\d{8}(?![0-9A-Za-z])/g,
  sa_iban: /\bSA\d{2}\s?(?:\d{4}\s?){4,5}\d{0,4}/gi,
  case_ref_not_cdf_demo: /\bCDF-(?!DEMO-\d{4}-)[A-Z]{2,}-\d{4}-[A-Z0-9-]+/g,
};

/**
 * Reviewed false positives: `${file name}|${pattern}|${matched text}` → reason. Empty: the one former entry (a superseded
 * synthetic reference in v9_data.json) was renamed to CDF-DEMO-2026-0001 in the copy instead (ARCH, 28 Oct 04:05).
 */
const ALLOW: Readonly<Record<string, string>> = {};

function scanText(
  name: string,
  text: string,
  allow: Readonly<Record<string, string>> = ALLOW,
): { hits: string[]; allowed: string[] } {
  const hits: string[] = [];
  const allowed: string[] = [];
  for (const [pattern, rx] of Object.entries(PATTERNS)) {
    for (const m of text.matchAll(rx)) {
      const line = text.slice(0, m.index).split("\n").length;
      const key = `${name}|${pattern}|${m[0]}`;
      (allow[key] === undefined ? hits : allowed).push(`${pattern} ${name}:${line} ${JSON.stringify(m[0])}`);
    }
  }
  return { hits, allowed };
}

const walk = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

function scope(): string[] {
  const files: string[] = [];
  for (const team of PROC) {
    const ev = join(ROOT, "tests", "unit", team, "__evidence__");
    if (existsSync(ev)) files.push(...walk(ev));
    const lib = join(ROOT, "lib", team);
    if (existsSync(lib)) files.push(...walk(lib).filter((p) => p.endsWith(".json")));
  }
  return files;
}

describe("copy-time evidence scan (SEC, PR #3)", () => {
  test("EVS-01 every PROC evidence and data file is free of personal-data shapes, apart from the reviewed ALLOW entries", () => {
    const files = scope();
    assert.ok(
      files.some((p) => p.includes(join("tests", "unit", "domain", "__evidence__"))),
      "the domain evidence is in scope",
    );
    const hits: string[] = [];
    const used = new Set<string>();
    for (const p of files) {
      const r = scanText(basename(p), readFileSync(p, "utf8"));
      hits.push(...r.hits.map((h) => `${h} (${relative(ROOT, p)})`));
      for (const a of r.allowed) used.add(a);
    }
    assert.deepEqual(hits, [], "no personal-data shape in copied evidence");
    assert.equal(
      used.size,
      Object.keys(ALLOW).length,
      "every ALLOW entry still matches (no stale allowance)",
    );
  });

  test("EVS-02 negative: the scanner flags each pattern on a synthetic sample, and ALLOW is exact (same text in another file is a hit)", () => {
    const samples: Record<string, string> = {
      email_not_example_test: "reach person@corp.invalid now",
      gov_sa: "see portal.gov.sa",
      national_id_like: "id 1000000000 here",
      phone_966: "call +966 5",
      phone_05: "call 0500000000",
      sa_iban: "SA00 0000 0000 0000 0000 0000",
      case_ref_not_cdf_demo: "case CDF-ZZ-0000-0000",
    };
    for (const [pattern, text] of Object.entries(samples)) {
      assert.ok(
        scanText("sample.txt", text).hits.some((h) => h.startsWith(`${pattern} `)),
        `${pattern} is detected`,
      );
    }
    assert.deepEqual(
      scanText("sample.txt", "Employee Alpha, alpha@example.test, CDF-DEMO-2026-0001, sha 1234567890abcdef")
        .hits,
      [],
      "synthetic shapes pass",
    );
    const fixture = { "fixture.json|case_ref_not_cdf_demo|CDF-ZZ-0000-0000": "test-only allowance" };
    assert.equal(
      scanText("other.json", "CDF-ZZ-0000-0000", fixture).hits.length,
      1,
      "an allowance is bound to its file",
    );
    assert.equal(scanText("fixture.json", "CDF-ZZ-0000-0000", fixture).allowed.length, 1);
    assert.deepEqual(Object.keys(ALLOW), [], "no allowance in the committed scan");
  });
});
