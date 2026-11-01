// Leak-suite guard (V13-QA-008; REQ-CASE-014, TEST_ARCHITECTURE.md §7.1): the automated half of the leak triage rule
// "no severity downgrade, waiver or test.fail() pin applies to a leak". It reads the source of every suite §7.1 names
// and refuses, before any test runs:
//   G1  a pin: test.fail / test.fails / test.fixme / .todo on test / it / describe / suite (Playwright or Vitest, any
//       depth: test.describe.fixme, test.step.fixme, …), and the testInfo forms (test.info().fail(), testInfo.fixme())
//   G2  a focus: .only on test / it / describe / suite (any depth), fit / fdescribe
//   G3  a skip that is not on the allow-list: .skip / .skipIf / .runIf on test / it / describe / suite (any depth:
//       test.step.skip, …), xit / xdescribe / xtest, testInfo.skip(). Only an environment-conditional skip can be allow-listed (file + a pattern on the call
//       + the reason); an unconditional one (no argument, a title string, or `true`) never can.
//   G4  a suite §7.1 names is missing (a rename must not drop it from the guard), or an allow-list entry matches
//       nothing (a stale waiver)
//   G5  test / it / describe / suite reached other than by a plain dotted chain or call (SEC, review of bf063a9): an
//       alias (`const t = test`, `import { test as base }`, a namespace import, an argument), element access
//       (`test["fail"]`), `?.`, `!`, parentheses, a redeclaration, or an import from anywhere but @playwright/test or
//       vitest; a pin, focus or skip method called on anything else (`const info = test.info(); info.fail()`); and a
//       `retry` / `retries` option, so neither runner can turn an intermittent leak green
// The source is tokenised by the TypeScript parser and comments and string, template and regular-expression literals
// are blanked before matching, so prose that names test.fail() is not a hit and a quote inside a regular expression
// cannot hide the rest of a file. G5 works on the syntax tree. Limit: a helper defined in another file that pins or
// skips is out of reach of a per-file scan (TEST_ARCHITECTURE.md §7.1).
// Pure functions over source text: the planted-negative self-test feeds them synthetic sources. SYNTHETIC only.
import ts from "typescript";

export interface GuardViolation {
  rule: "G1" | "G2" | "G3" | "G4" | "G5";
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
  "tests/security/e2e/notification-center.spec.ts",
  "tests/security/e2e/surface.spec.ts",
];

/** The conditional skips that exist today, each with its reason (ARCH, 1 Nov). */
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
      "SEC's matrix needs the migrated, seeded database (databaseReady); since V13-SEC-010/011 a database that is not " +
      "ready fails the suite whenever CI, GITHUB_ACTIONS or V13_DB_TESTS_REQUIRED=1 is set, so it skips only locally",
  },
  {
    file: "tests/security/e2e/surface.spec.ts",
    call: /^test\.skip\(!LOCAL_BUILD, "",? ?\)$/,
    reason:
      "SEC-APP-13 knows the session secret and app password, and has a .next/static to scan, only for a locally " +
      "started build; LOCAL_BUILD is false only against an external V13_E2E_BASE_URL (two calls)",
  },
  {
    file: "tests/security/e2e/surface.spec.ts",
    call: /^test\.skip\(!existsSync\(root\), "",? ?\)$/,
    reason:
      "runs after the LOCAL_BUILD skip, where playwright.config.ts has just built the app, so .next/static exists; " +
      "a build-state condition, not an environment one (SEC may make it fail instead, as SEC-010 did for the database)",
  },
];

/**
 * The source with comments removed and every string, template and regular-expression literal reduced to `""`, keeping
 * line breaks so line numbers stay right. It is tokenised by the TypeScript parser (already the repository's type
 * checker), so a quote inside a regular expression (`/relation "/`) or a division cannot put it out of step with the
 * code. Template substitutions (`${…}`) stay code. JSDoc and other comments become spaces.
 */
export function codeOnly(src: string): string {
  const sf = ts.createSourceFile("guarded.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let out = "";
  let pos = 0;
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  const visit = (node: ts.Node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sf);
    if (children.length > 0) {
      for (const c of children) visit(c);
      return;
    }
    const start = node.getStart(sf);
    if (start < pos) return;
    out += blank(src.slice(pos, start)); // whitespace and comments
    const text = src.slice(start, node.end);
    out += LITERALS.has(node.kind) ? `""${text.replace(/[^\n]/g, "")}` : text;
    pos = node.end;
  };
  visit(sf);
  return out + blank(src.slice(pos));
}

const LITERALS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

// Member access may be split over lines (`test\n  .fail(`), so every dot allows whitespace around it.
const D = String.raw`\s*\.\s*`;
const CHAIN = String.raw`(?:${D}(?:describe|serial|parallel|concurrent|sequential|each|step))*`;
const INFO = String.raw`(?:test${D}info\(\)|testInfo)`;
const PIN = new RegExp(
  String.raw`\b(?:test|it|describe|suite)${CHAIN}${D}(?:fail|fails|fixme|todo)\b|\b${INFO}${D}(?:fail|fixme)\b`,
  "g",
);
const FOCUS = new RegExp(
  String.raw`\b(?:test|it|describe|suite)${CHAIN}${D}only\b|\bf(?:it|describe)\s*\(`,
  "g",
);
const SKIP = new RegExp(
  String.raw`\b(?:test|it|describe|suite)${CHAIN}${D}(?:skip|skipIf|runIf)\b|\bx(?:it|test|describe)\s*\(|\b${INFO}${D}skip\b`,
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
  return [...out, ...scanForms(file, src)].sort((a, b) => a.line - b.line);
}

const RUNNER_NAMES = new Set(["test", "it", "describe", "suite"]);
const RUNNER_MODULES = new Set(["@playwright/test", "vitest"]);
const GUARDED_METHODS = new Set(["fail", "fails", "fixme", "only", "todo", "skip", "skipIf", "runIf"]);
const RETRY_OPTIONS = new Set(["retry", "retries"]);

/** The innermost expression a member or call chain starts from (`a` in `a.b().c["d"]!`). */
function chainRoot(e: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isCallExpression(e))
      e = e.expression;
    else if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    else return e;
  }
}

/** Positions where a runner name is not a reference: a member name, a property key, an import's own parts. */
function isNameSlot(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    (ts.isQualifiedName(p) && p.right === id) ||
    ((ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isEnumMember(p)) &&
      p.name === id) ||
    (ts.isBindingElement(p) && p.propertyName === id) ||
    ts.isImportSpecifier(p)
  );
}

/** G5: the forms a textual match cannot see, found on the syntax tree. */
export function scanForms(file: string, src: string): GuardViolation[] {
  const sf = ts.createSourceFile("guarded.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: GuardViolation[] = [];
  const hit = (node: ts.Node, what: string) =>
    out.push({
      rule: "G5",
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      detail: `${what}: ${brief(node.getText(sf).replace(/\s+/g, " "))}`,
    });
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause) {
      const from = node.moduleSpecifier.text;
      const runner = RUNNER_MODULES.has(from);
      const clause = node.importClause;
      if (runner && clause.name) hit(node, "a default import of a test runner");
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named) && runner) hit(node, "a namespace import of a test runner");
      if (named && ts.isNamedImports(named))
        for (const el of named.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (!RUNNER_NAMES.has(imported) && !RUNNER_NAMES.has(el.name.text)) continue;
          if (el.propertyName && el.propertyName.text !== el.name.text)
            hit(el, "a runner name imported under another name");
          else if (!runner) hit(el, `a runner name imported from ${from}`);
        }
    }
    if (ts.isIdentifier(node) && RUNNER_NAMES.has(node.text) && !isNameSlot(node)) {
      const p = node.parent;
      if (
        (ts.isVariableDeclaration(p) ||
          ts.isParameter(p) ||
          ts.isBindingElement(p) ||
          ts.isFunctionDeclaration(p) ||
          ts.isClassDeclaration(p)) &&
        p.name === node
      ) {
        hit(p, "a runner name declared again in the suite");
      } else {
        let top: ts.Expression = node;
        let plain = true;
        while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) {
          if (top.parent.questionDotToken) plain = false;
          top = top.parent;
        }
        const q = top.parent;
        const called =
          (ts.isCallExpression(q) && q.expression === top && !q.questionDotToken) ||
          (ts.isTaggedTemplateExpression(q) && q.tag === top);
        if (!plain || !called) hit(q, "a runner reached other than by a plain dotted chain or call");
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const method = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
          ? callee.argumentExpression.text
          : null;
      if (method !== null && GUARDED_METHODS.has(method)) {
        const root = chainRoot(callee);
        const direct =
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(root) &&
          (RUNNER_NAMES.has(root.text) || (root.text === "testInfo" && callee.expression === root));
        if (!direct) hit(node, `.${method}() called on something other than test / it / describe / suite`);
      }
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      RETRY_OPTIONS.has(node.name.text)
    )
      hit(node, "a retry option on a leak-detection suite");
    ts.forEachChild(node, visit);
  };
  visit(sf);
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
