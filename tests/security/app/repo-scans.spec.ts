// V13-SEC-008 · REQ-SEC-002 (no credential reaches GitHub) and REQ-GOV-001 (no real data in the demo).
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION. Scans what Git tracks (tests/security/repo-scan.ts) and fails on any finding
// that a reviewed ALLOW entry does not cover. Failure messages carry rule, file and line only, never the matched text.
// The planted samples below are assembled at runtime from fragments, in a temporary folder, so no committed file holds
// a credential-shaped or personal-data-shaped string (this scan and GitHub's secret scanning stay quiet on this file).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CREDENTIAL_RULES,
  NOT_A_SECRET_MARKER,
  PERSONAL_DATA_RULES,
  PERSONAL_DATA_SCOPE,
  applyAllow,
  describeFinding,
  scanRepository,
  scanText,
  trackedFiles,
  type AllowEntry,
} from "../repo-scan";

const ROOT = process.cwd();

/** Reviewed exceptions: one file and one rule each, with the reason. Never a folder. */
const CREDENTIAL_ALLOW: readonly AllowEntry[] = [
  {
    file: "tests/unit/db-client.spec.ts",
    rule: "url_with_password",
    reason:
      "the database client's redaction test feeds a synthetic mysql:// URL on db.example.test to prove the password is never echoed",
  },
  {
    file: "tests/unit/db-scripts.spec.ts",
    rule: "url_with_password",
    reason:
      "the URL parser test uses a percent-encoded synthetic password on the loopback address to prove decoding; no real host",
  },
];

const PERSONAL_DATA_ALLOW: readonly AllowEntry[] = [];

/** Joins fragments at runtime, so the assembled sample never appears in a committed file. */
const j = (...parts: string[]) => parts.join("");

/** One planted sample per credential rule, each built from fragments. */
const CREDENTIAL_SAMPLES: Readonly<Record<string, string>> = {
  private_key_block: j("-----BEGIN ", "RSA ", "PRIVATE ", "KEY-----"),
  url_with_password: j("postgres", "://app_user:", "Plant3d", "Pw", "@db.example.test/x"),
  jwt_like: j("ey", "JhbGciOiJIUzI1NiJ9", ".", "ey", "JzdWIiOiJwbGFudCJ9", ".", "c2lnbmF0dXJlLXBsYW50ZWQ"),
  github_token: j("gh", "p_", "A".repeat(18), "b".repeat(18)),
  aws_access_key_id: j("AK", "IA", "PLANTED0", "EXAMPLE0"),
  slack_token: j("xo", "xb-", "0000000000", "-planted"),
  provider_secret_key: j("sk", "_live_", "planted", "0123456789abcdef"),
  google_api_key: j("AI", "za", "Sy", "P".repeat(33)),
  secret_assignment: j("const API", "_KEY = ", '"', "planted", "0123456789abcdef", '"'),
};

/** One planted sample per personal-data rule, each built from fragments. */
const PERSONAL_DATA_SAMPLES: Readonly<Record<string, string>> = {
  email_not_example_test: j("person", "@", "corp.invalid", ".org"),
  gov_sa: j("portal.", "gov", ".sa"),
  national_id_like: j("1", "0", "23456789"),
  phone_966: j("+", "966", " 5"),
  phone_05: j("0", "5", "12345678"),
  sa_iban: j("S", "A", "03 8000 0000 6080 1016 7519"),
  case_ref_not_cdf_demo: j("CDF-", "IC-", "2026-", "0042"),
};

describe("SEC-APP-19 no credential in any tracked file (REQ-SEC-002, TM-I8)", () => {
  const scan = scanRepository(ROOT, CREDENTIAL_RULES);
  const result = applyAllow(scan.findings, CREDENTIAL_ALLOW);

  it("scans the repository's tracked files (control)", () => {
    expect(scan.scanned).toBeGreaterThan(300);
    expect(trackedFiles(ROOT)).toContain("package.json");
  });

  it("finds no credential shape outside the reviewed exceptions", () => {
    expect(result.hits.map(describeFinding)).toEqual([]);
  });

  it("every exception is narrow (one file, one rule, a reason) and still needed", () => {
    for (const a of CREDENTIAL_ALLOW) {
      expect(a.file, "a file, never a folder").not.toMatch(/\/$|\*/);
      expect(Object.keys(CREDENTIAL_RULES)).toContain(a.rule);
      expect(a.reason.length).toBeGreaterThan(20);
    }
    expect(result.unusedAllow).toEqual([]);
  });
});

describe("SEC-APP-20 no personal-data shape in the demo's data and test inputs (REQ-GOV-001)", () => {
  const files = trackedFiles(ROOT).filter((f) => PERSONAL_DATA_SCOPE.some((rx) => rx.test(f)));
  const scan = scanRepository(ROOT, PERSONAL_DATA_RULES, files);
  const result = applyAllow(scan.findings, PERSONAL_DATA_ALLOW);

  it("the scope holds the seeds, migrations, hosted scripts, fixtures and e2e specs (control)", () => {
    expect(files.some((f) => f.startsWith("database/seed/"))).toBe(true);
    expect(files.some((f) => f.startsWith("database/migrations/"))).toBe(true);
    expect(files.some((f) => f.startsWith("database/hosted/"))).toBe(true);
    expect(files.some((f) => f.startsWith("tests/fixtures/"))).toBe(true);
    expect(files.some((f) => f.startsWith("tests/e2e/"))).toBe(true);
    expect(scan.scanned).toBe(files.length);
  });

  it("finds no personal-data shape outside the reviewed exceptions", () => {
    expect(result.hits.map(describeFinding)).toEqual([]);
    expect(result.unusedAllow).toEqual([]);
  });

  it("uses the same seven rules as the copy-time evidence scan (EVS-01)", () => {
    const evs = readFileSync(join(ROOT, "tests/unit/domain/evidence-scan.spec.ts"), "utf8");
    for (const [rule, rx] of Object.entries(PERSONAL_DATA_RULES)) {
      expect(evs, rule).toContain(`${rule}: /${rx.source}/${rx.flags}`);
    }
  });
});

describe("SEC-APP-19/20 negative: planted samples in a temporary repository", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "v13-sec-008-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    git("init", "-q");
    for (const [rule, sample] of Object.entries(CREDENTIAL_SAMPLES))
      writeFileSync(join(dir, `cred-${rule}.txt`), `line one\n${sample}\n`);
    for (const [rule, sample] of Object.entries(PERSONAL_DATA_SAMPLES))
      writeFileSync(join(dir, `pd-${rule}.sql`), `-- synthetic\n${sample}\n`);
    // skipped: a binary file, a symbolic link to a planted file, and an untracked planted file
    writeFileSync(
      join(dir, "binary.bin"),
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(CREDENTIAL_SAMPLES.github_token!)]),
    );
    symlinkSync(join(dir, "cred-github_token.txt"), join(dir, "link.txt"));
    git("add", "-A");
    writeFileSync(join(dir, "untracked.txt"), CREDENTIAL_SAMPLES.github_token!);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("each credential rule fires on its planted sample, on line 2, and reports no matched text", () => {
    const files = trackedFiles(dir).filter((f) => f.startsWith("cred-"));
    const { findings } = scanRepository(dir, CREDENTIAL_RULES, files);
    for (const rule of Object.keys(CREDENTIAL_RULES)) {
      expect(findings, rule).toContainEqual({ rule, file: `cred-${rule}.txt`, line: 2 });
    }
    for (const f of findings) {
      expect(Object.keys(f).sort()).toEqual(["file", "line", "rule"]);
      const text = describeFinding(f);
      for (const sample of Object.values(CREDENTIAL_SAMPLES)) expect(text.includes(sample)).toBe(false);
    }
  });

  it("each personal-data rule fires on its planted sample", () => {
    const files = trackedFiles(dir).filter((f) => f.startsWith("pd-"));
    const { findings } = scanRepository(dir, PERSONAL_DATA_RULES, files);
    for (const rule of Object.keys(PERSONAL_DATA_RULES)) {
      expect(findings, rule).toContainEqual({ rule, file: `pd-${rule}.sql`, line: 2 });
    }
  });

  it("only tracked text files are read: a binary file, a symbolic link and an untracked file are not", () => {
    const tracked = trackedFiles(dir);
    expect(tracked).not.toContain("untracked.txt");
    const scan = scanRepository(dir, CREDENTIAL_RULES, tracked);
    const where = new Set(scan.findings.map((f) => f.file));
    expect(where.has("binary.bin")).toBe(false);
    expect(where.has("link.txt")).toBe(false);
    expect(scan.skipped).toBe(2);
  });

  it("the personal-data scope covers migrations and hosted scripts, and not application code (V13-SEC-009)", () => {
    const inScope = (f: string) => PERSONAL_DATA_SCOPE.some((rx) => rx.test(f));
    for (const f of [
      "database/seed/0001_demo.sql",
      "database/migrations/0011_planted.sql",
      "database/hosted/planted_check.sql",
      "tests/fixtures/x.ts",
      "tests/security/db/x.spec.ts",
    ])
      expect(inScope(f), f).toBe(true);
    for (const f of [
      "lib/server/x.ts",
      "docs/x.md",
      "xdatabase/migrations/a.sql",
      "database/migrationsx/a.sql",
    ])
      expect(inScope(f), f).toBe(false);
  });

  it("an ALLOW entry covers only its own file and rule", () => {
    const findings = [
      { rule: "jwt_like", file: "a.ts", line: 1 },
      { rule: "jwt_like", file: "b.ts", line: 1 },
      { rule: "github_token", file: "a.ts", line: 2 },
    ];
    const r = applyAllow(findings, [
      { file: "a.ts", rule: "jwt_like", reason: "planted for this test only" },
    ]);
    expect(r.allowed).toEqual([findings[0]]);
    expect(r.hits).toEqual([findings[1], findings[2]]);
  });

  it("placeholders are not passwords; everything else is", () => {
    const pw = (p: string) => scanText(CREDENTIAL_RULES, "x", j("postgres://u:", p, "@h/x")).length;
    expect(pw("local-only-not-a-secret")).toBe(0);
    expect(pw("${PASSWORD}")).toBe(0);
    expect(pw("<password>")).toBe(0);
    expect(pw("Plant3dPw")).toBe(1);
    expect(NOT_A_SECRET_MARKER.test("ci-only-not-a-secret")).toBe(true);
    // the workspace and role names that contain "SECRET" are not secret assignments
    expect(scanText(CREDENTIAL_RULES, "x", 'SECRETARIAT: "workspaces.name.secretariat",')).toEqual([]);
  });
});
