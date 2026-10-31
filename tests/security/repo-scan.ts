// V13-SEC-008 · repository scans (REQ-SEC-002, REQ-GOV-001). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
//
// Two scans over the files Git tracks (`git ls-files`), nothing else:
//  - credentials: every tracked text file is searched for credential shapes (private keys, connection strings that
//    carry a password, signed tokens, provider token prefixes, literal secret assignments);
//  - personal data: the files that feed the demo or its tests (seeds, fixtures, e2e specs) are searched for the
//    personal-data shapes of the copy-time evidence scan (tests/unit/domain/evidence-scan.spec.ts, SEC on PR #3).
// A finding names the rule, the file and the line only. The matched text is never returned, printed or logged, so a
// real secret that slipped in does not travel further through test output or CI logs (ARCH condition 2).
// Binary files, symbolic links and anything outside the repository root are skipped; /mnt/project-files is never read.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";

export interface Finding {
  readonly rule: string;
  readonly file: string;
  readonly line: number;
}

/** An exception: one file, one rule, and why the hits there are not credentials or personal data. */
export interface AllowEntry {
  readonly file: string;
  readonly rule: string;
  readonly reason: string;
}

/**
 * The repository's convention for a synthetic credential in a test, a CI service container or the local tooling: the
 * value contains "not-a-secret", "not-a-real-secret" or "not-a-real-password" (e.g. `local-only-not-a-secret`). Such a
 * value is never a credential anywhere, so the URL and assignment rules skip it; every other value is a finding.
 */
export const NOT_A_SECRET_MARKER = /not-a-(?:real-)?(?:secret|password)/;

/** Credential shapes. Each is specific enough that a hit is worth a human look. */
export const CREDENTIAL_RULES: Readonly<Record<string, RegExp>> = {
  private_key_block: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
  // scheme://user:password@host for the database and broker schemes. Not a password: a ${…} or <…> placeholder, or a
  // value carrying the repository's placeholder marker (NOT_A_SECRET_MARKER below).
  url_with_password:
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@/'"`]+:(?![$<{])(?![^\s@/'"`]*not-a-(?:real-)?(?:secret|password))[^\s@/'"`]+@/gi,
  jwt_like: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/g,
  github_token: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g,
  aws_access_key_id: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  slack_token: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  provider_secret_key: /\b(?:sk_live_|rk_live_|sk-ant-|sk-proj-)[A-Za-z0-9_-]{16,}/g,
  google_api_key: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // NAME = "literal" / NAME: 'literal' for a secret-like name (SECRETARIAT and SECRETARY are not) and a literal of 16+
  // characters with no spaces that does not carry the placeholder marker.
  secret_assignment:
    /\b[A-Za-z_]*(?:password|passwd|secret(?!ar)|api_?key|access_?token|private_?key|service_?role(?:_key)?)[A-Za-z_]*["']?\s*[:=]\s*["'`](?![^"'`\s]*not-a-(?:real-)?(?:secret|password))[^"'`\s$]{16,}["'`]/gi,
};

/**
 * Personal-data shapes: the same seven rules as the copy-time evidence scan (EVS-01), kept in step by a test in
 * repo-scans.spec.ts. That file is PROC-owned and does not export them, so SEC holds its own copy here.
 */
export const PERSONAL_DATA_RULES: Readonly<Record<string, RegExp>> = {
  email_not_example_test: /[A-Za-z0-9._%+-]+@(?!example\.test\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  gov_sa: /gov\.sa/gi,
  national_id_like: /(?<![0-9A-Za-z])[12]\d{9}(?![0-9A-Za-z])/g,
  phone_966: /(?:\+|00)966[\s-]?\d/g,
  phone_05: /(?<![0-9A-Za-z])05\d{8}(?![0-9A-Za-z])/g,
  sa_iban: /\bSA\d{2}\s?(?:\d{4}\s?){4,5}\d{0,4}/gi,
  case_ref_not_cdf_demo: /\bCDF-(?!DEMO-\d{4}-)[A-Z]{2,}-\d{4}-[A-Z0-9-]+/g,
};

/** The tracked files whose content feeds the demo or its tests: the personal-data scan's scope. */
export const PERSONAL_DATA_SCOPE: readonly RegExp[] = [
  /^database\/seed\//,
  /^tests\/fixtures\//,
  /^tests\/e2e\//,
  /^tests\/security\/e2e\//,
  /^tests\/sentinel\//,
  /^tests\/integration\//,
  /^tests\/security\/db\//,
];

/** Files Git tracks under `root`, repository-relative with forward slashes, sorted. */
export function trackedFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter((p) => p !== "")
    .sort();
}

/** A NUL byte in the first 8 KiB marks a binary file, as Git does. */
const isBinary = (bytes: Buffer): boolean => bytes.subarray(0, 8192).includes(0);

/** Reads a tracked text file, or null for a binary file, a symbolic link, a missing file or a path outside root. */
export function readTracked(root: string, rel: string): string | null {
  if (isAbsolute(rel) || normalize(rel).split(sep).includes("..")) return null;
  const abs = join(root, rel);
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return null; // deleted in the working tree but still in the index
  }
  if (!st.isFile()) return null; // symbolic links and anything else are never followed
  const bytes = readFileSync(abs);
  return isBinary(bytes) ? null : bytes.toString("utf8");
}

/** Every hit of every rule in `text`, as rule, file and line; the matched text is not kept. */
export function scanText(rules: Readonly<Record<string, RegExp>>, file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  for (const [rule, rx] of Object.entries(rules)) {
    for (const m of text.matchAll(
      new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`),
    )) {
      findings.push({ rule, file, line: text.slice(0, m.index).split("\n").length });
    }
  }
  return findings;
}

/** Splits findings into those an ALLOW entry covers (same file and rule) and the rest. */
export function applyAllow(
  findings: readonly Finding[],
  allow: readonly AllowEntry[],
): { hits: Finding[]; allowed: Finding[]; unusedAllow: AllowEntry[] } {
  const used = new Set<AllowEntry>();
  const hits: Finding[] = [];
  const allowed: Finding[] = [];
  for (const f of findings) {
    const entry = allow.find((a) => a.file === f.file && a.rule === f.rule);
    if (entry) {
      used.add(entry);
      allowed.push(f);
    } else hits.push(f);
  }
  return { hits, allowed, unusedAllow: allow.filter((a) => !used.has(a)) };
}

/** Scans the given tracked files with the rules; `files` defaults to every tracked file. */
export function scanRepository(
  root: string,
  rules: Readonly<Record<string, RegExp>>,
  files: readonly string[] = trackedFiles(root),
): { scanned: number; skipped: number; findings: Finding[] } {
  let scanned = 0;
  let skipped = 0;
  const findings: Finding[] = [];
  for (const rel of files) {
    const text = readTracked(root, rel);
    if (text === null) {
      skipped += 1;
      continue;
    }
    scanned += 1;
    findings.push(...scanText(rules, rel, text));
  }
  return { scanned, skipped, findings };
}

/** One line per finding, without the matched text. */
export const describeFinding = (f: Finding): string => `${f.rule} ${f.file}:${f.line}`;
