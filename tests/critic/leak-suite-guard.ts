// Leak-suite guard (V13-QA-008; REQ-CASE-014, TEST_ARCHITECTURE.md §7.1): the automated half of the leak triage rule
// "no severity downgrade, waiver or test.fail() pin applies to a leak". It reads the source of every suite §7.1 names
// and refuses, before any test runs:
//   G1  a pin: test.fail / test.fails / test.fixme / .todo (Playwright or Vitest, any depth: test.describe.fixme, …),
//       and the testInfo forms (test.info().fail(), testInfo.fixme())
//   G2  a focus: .only on test / it / describe (any depth), fit / fdescribe
//   G3  a skip that is not on the allow-list: .skip / .skipIf / .runIf on test / it / describe, xit / xdescribe /
//       xtest, testInfo.skip(). Only an environment-conditional skip can be allow-listed (file + a pattern on the call
//       + the reason); an unconditional one (no argument, a title string, or `true`) never can.
//   G4  a suite §7.1 names is missing (a rename must not drop it from the guard), or an allow-list entry matches
//       nothing (a stale waiver)
// Comments, strings and template literals are blanked before matching, so prose that names test.fail() is not a hit.
// Pure functions over source text: the planted-negative self-test feeds them synthetic sources. SYNTHETIC only.

export interface GuardViolation {
  rule: "G1" | "G2" | "G3" | "G4";
  file: string;
  line: number;
  detail: string;
}

export interface SkipAllowance {
  /** Repository-relative path. */
  file: string;
  /** Matches the whole call text from the method name to its closing parenthesis, whitespace collapsed. */
  call: RegExp;
  /** Why the skip is environment-conditional and cannot hide a leak in CI. */
  reason: string;
}

/** The suites TEST_ARCHITECTURE.md §7 and §7.1 name as leak detection (pages, payloads, requests, database). */
export const LEAK_SUITES: readonly string[] = [
  "tests/sentinel/planted-leak.spec.ts",
  "tests/sentinel/planted-request-leak.spec.ts",
  "tests/sentinel/request-leak-app.spec.ts",
  "tests/sentinel/db.spec.ts",
  "tests/sentinel/db-functions.spec.ts",
  "tests/e2e/scenario-a-case-switching.spec.ts",
  "tests/e2e/scenario-b-two-cases-two-tabs.spec.ts",
  "tests/e2e/scenario-c-workspace-switch.spec.ts",
  "tests/e2e/scenario-d-search-filters.spec.ts",
  "tests/e2e/scenario-e-notification-draft.spec.ts",
  "tests/e2e/negative-personas-pinning.spec.ts",
  "tests/security/db/case-matrix.spec.ts",
  "tests/security/e2e/case-pages.spec.ts",
];

/** The environment-conditional skips that exist today, each with its reason (ARCH, 1 Nov). */
export const SKIP_ALLOWANCES: readonly SkipAllowance[] = [
  {
    file: "tests/e2e/negative-personas-pinning.spec.ts",
    call: /^test\.skip\(!process\.env\.V13_E2E_SESSION_SECRET, "",? ?\)$/,
    reason:
      "minting Epsilon's and Zeta's sessions needs the run's session secret; playwright.config.ts sets it for every " +
      "locally started build (CI included), so the skip applies only against an external V13_E2E_BASE_URL",
  },
  {
    file: "tests/e2e/scenario-c-workspace-switch.spec.ts",
    call: /^test\.skip\(!process\.env\.V13_E2E_SESSION_SECRET, "",? ?\)$/,
    reason: "the same session-secret condition, for Epsilon's minted session (Scenario C negative)",
  },
  {
    file: "tests/security/db/case-matrix.spec.ts",
    call: /^describe\.skipIf\(!present\)$/,
    reason:
      "SEC's matrix needs the migrated, seeded database (databaseReady); the CI test:db job resets it first, and the " +
      "missing-database case logs a warning",
  },
];

/**
 * The source with comments removed and every string and template literal reduced to its quotes (`""`), keeping line
 * breaks so line numbers stay right. Regular-expression literals are left as they are (none of the guarded forms can
 * appear in one without also appearing outside it in a suite).
 */
export function codeOnly(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += '"';
      i++;
      let depth = 0; // ${ … } nesting inside a template literal
      while (i < src.length) {
        const d = src[i]!;
        if (d === "\\") {
          i += 2;
          continue;
        }
        if (d === "\n") out += "\n";
        if (c === "`" && d === "$" && src[i + 1] === "{") {
          depth++;
          i += 2;
          continue;
        }
        if (c === "`" && depth > 0 && d === "}") {
          depth--;
          i++;
          continue;
        }
        if (d === c && depth === 0) break;
        i++;
      }
      out += '"';
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Member access may be split over lines (`test\n  .fail(`), so every dot allows whitespace around it.
const D = String.raw`\s*\.\s*`;
const CHAIN = String.raw`(?:${D}(?:describe|serial|parallel|concurrent|sequential|each))*`;
const INFO = String.raw`(?:test${D}info\(\)|testInfo)`;
const PIN = new RegExp(
  String.raw`\b(?:test|it|describe)${CHAIN}${D}(?:fail|fails|fixme|todo)\b|\b${INFO}${D}(?:fail|fixme)\b`,
  "g",
);
const FOCUS = new RegExp(String.raw`\b(?:test|it|describe)${CHAIN}${D}only\b|\bf(?:it|describe)\s*\(`, "g");
const SKIP = new RegExp(
  String.raw`\b(?:test|it|describe)${CHAIN}${D}(?:skip|skipIf|runIf)\b|\bx(?:it|test|describe)\s*\(|\b${INFO}${D}skip\b`,
  "g",
);

/** The call text from `start` to its closing parenthesis (or the match alone when no call follows), collapsed. */
function callText(code: string, start: number, matchEnd: number): string {
  let i = matchEnd;
  while (i < code.length && /\s/.test(code[i]!)) i++;
  if (code[i] !== "(") return code.slice(start, matchEnd);
  let depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) break;
  }
  return code
    .slice(start, i + 1)
    .replace(/\s+/g, " ")
    .replace(/ ?\. ?/g, ".")
    .replace(/\( /g, "(");
}

/** A skip with no argument, a title string first, or `true` first: never allowed. */
export function isUnconditionalSkip(call: string): boolean {
  const args = /\((.*)\)$/.exec(call)?.[1]?.trim();
  if (args === undefined) return /^x(?:it|test|describe)/.test(call) || !/skipIf|runIf/.test(call);
  if (/^x(?:it|test|describe)/.test(call)) return true;
  return args === "" || args.startsWith('"') || /^true\b/.test(args);
}

const brief = (call: string) => (call.length > 120 ? `${call.slice(0, 117)}…` : call);

const lineOf = (code: string, index: number) => code.slice(0, index).split("\n").length;

/** Every G1–G3 violation in one file's source. `used` collects the allow-list entries that matched. */
export function scanSuite(
  file: string,
  src: string,
  allow: readonly SkipAllowance[] = SKIP_ALLOWANCES,
  used: Set<SkipAllowance> = new Set(),
): GuardViolation[] {
  const code = codeOnly(src);
  const out: GuardViolation[] = [];
  for (const [rule, re, what] of [
    ["G1", PIN, "a pin (fail/fixme/todo) on a leak-detection suite"],
    ["G2", FOCUS, "a focused test (.only) on a leak-detection suite"],
  ] as const) {
    for (const m of code.matchAll(re))
      out.push({ rule, file, line: lineOf(code, m.index), detail: `${what}: ${m[0].replace(/\s+/g, "")}` });
  }
  for (const m of code.matchAll(SKIP)) {
    const call = callText(code, m.index, m.index + m[0].length);
    const line = lineOf(code, m.index);
    if (isUnconditionalSkip(call)) {
      out.push({ rule: "G3", file, line, detail: `an unconditional skip: ${brief(call)}` });
      continue;
    }
    const entry = allow.find((a) => a.file === file && a.call.test(call));
    if (entry) used.add(entry);
    else out.push({ rule: "G3", file, line, detail: `a skip that is not on the allow-list: ${brief(call)}` });
  }
  return out;
}

/** The whole guard: every suite present and clean, every allow-list entry still used. */
export function guardLeakSuites(
  read: (file: string) => string | null,
  suites: readonly string[] = LEAK_SUITES,
  allow: readonly SkipAllowance[] = SKIP_ALLOWANCES,
): GuardViolation[] {
  const used = new Set<SkipAllowance>();
  const out: GuardViolation[] = [];
  for (const file of suites) {
    const src = read(file);
    if (src === null) {
      out.push({ rule: "G4", file, line: 0, detail: "a leak-detection suite named in §7.1 is missing" });
      continue;
    }
    out.push(...scanSuite(file, src, allow, used));
  }
  for (const a of allow)
    if (!used.has(a))
      out.push({
        rule: "G4",
        file: a.file,
        line: 0,
        detail: `an allow-list entry matches nothing: ${a.call}`,
      });
  return out;
}

export const formatGuardViolations = (vs: readonly GuardViolation[]) =>
  vs.map((v) => `${v.rule} ${v.file}:${v.line} ${v.detail}`).join("\n");
