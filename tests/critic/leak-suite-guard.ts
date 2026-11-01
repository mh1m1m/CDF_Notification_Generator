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
//   G6  the runners' options-object and annotation forms (ARCH, review of 488d93d): an object property `skip`,
//       `only`, `todo` or `fails` (Vitest: it/describe(name, { skip: true }) skips, { only } focuses, { todo } makes a
//       todo, { fails } expects a failure), and a property `type` whose value is "skip", "fixme" or "fail" (Playwright:
//       test(name, { annotation: { type: "skip" } }) skips, "fixme" skips, "fail" inverts), however the key is written;
//       and (V13-QA-011, SEC's INFO on #88) any annotation the parser cannot read as plain literals: an `annotation`
//       option that is not an object or array literal, a spread or computed key in one, a `type` that is not a plain
//       string literal (`"sk" + "ip"`, a variable, a template with a substitution), and `annotations` reached other
//       than by `.push(` of such object literals
// The source is tokenised by the TypeScript parser and comments and string, template and regular-expression literals
// are blanked before matching, so prose that names test.fail() is not a hit and a quote inside a regular expression
// cannot hide the rest of a file. G5 and G6 work on the syntax tree. Limit: a helper defined in another file that pins or
// skips is out of reach of a per-file scan (TEST_ARCHITECTURE.md §7.1); the listing check below (L1, V13-QA-011) closes
// it for the Playwright suites at load time, by comparing what the runner registers with the file's own test calls.
// A skip a helper makes at run time (test.skip() inside a body, or a conditional test.skip(fn) at file level) is not
// visible at load time and stays out of reach; review covers that.
// Pure functions over source text: the planted-negative self-test feeds them synthetic sources. SYNTHETIC only.
import ts from "typescript";

export interface GuardViolation {
  rule: "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "L1";
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
      "since V13-SEC-012 a missing .next/static fails the test before this line whenever a truthy CI, " +
      "GITHUB_ACTIONS=true or V13_DB_TESTS_REQUIRED=1 is set (requireBuildWhenSignalled), so the skip applies only " +
      "to a local run without a build",
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
const OPTION_KEYS = new Set(["skip", "only", "todo", "fails"]);
const ANNOTATION_TYPES = new Set(["skip", "fixme", "fail"]);

/** An object property's key as text, however it is written (`a`, `"a"`, `["a"]`, `[`a`]`), or null. */
function keyText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return null;
}

/** `x.annotations` or `x["annotations"]`: the run-time annotation list of a test. */
function isAnnotationsAccess(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  return (
    (ts.isPropertyAccessExpression(node) && node.name.text === "annotations") ||
    (ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "annotations")
  );
}

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

/** G5 and G6: the forms a textual match cannot see, found on the syntax tree. */
export function scanForms(file: string, src: string): GuardViolation[] {
  const sf = ts.createSourceFile("guarded.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: GuardViolation[] = [];
  const text = (node: ts.Node) => brief(node.getText(sf).replace(/\s+/g, " "));
  const lineAt = (node: ts.Node) => ({
    file,
    line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
  });
  const hit = (node: ts.Node, what: string) =>
    out.push({
      rule: "G5",
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      detail: `${what}: ${brief(node.getText(sf).replace(/\s+/g, " "))}`,
    });
  /** An annotation must be an object literal of plain properties whose `type` is a plain string literal. */
  const checkAnnotation = (item: ts.Node) => {
    const bad = (why: string, at: ts.Node) =>
      out.push({ ...lineAt(at), rule: "G6", detail: `${why}: ${text(at)}` });
    if (!ts.isObjectLiteralExpression(item)) return bad("an annotation that is not an object literal", item);
    for (const prop of item.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        bad("an annotation property that is not a plain key: value", prop);
        continue;
      }
      const key = keyText(prop.name);
      if (key === null) bad("an annotation key the parser cannot read", prop);
      else if (key === "type" && !ts.isStringLiteralLike(prop.initializer))
        bad("an annotation type that is not a plain string literal", prop);
    }
  };
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
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isMethodDeclaration(node)) &&
      ts.isObjectLiteralExpression(node.parent)
    ) {
      const key = keyText(node.name);
      if (key !== null && RETRY_OPTIONS.has(key)) hit(node, "a retry option on a leak-detection suite");
      if (key !== null && OPTION_KEYS.has(key)) {
        out.push({
          ...lineAt(node),
          rule: "G6",
          detail: `a ${key} option (skips, focuses or pins): ${text(node)}`,
        });
      }
      if (
        key === "type" &&
        ts.isPropertyAssignment(node) &&
        ts.isStringLiteralLike(node.initializer) &&
        ANNOTATION_TYPES.has(node.initializer.text)
      )
        out.push({
          ...lineAt(node),
          rule: "G6",
          detail: `a "${node.initializer.text}" annotation (skips or pins): ${text(node)}`,
        });
      if (key === "annotation") {
        if (!ts.isPropertyAssignment(node))
          out.push({
            ...lineAt(node),
            rule: "G6",
            detail: `an annotation that is not an object or array literal: ${text(node)}`,
          });
        else {
          const value = node.initializer;
          const items = ts.isArrayLiteralExpression(value) ? [...value.elements] : [value];
          for (const item of items) checkAnnotation(item);
        }
      }
    }
    if (isAnnotationsAccess(node)) {
      const push = node.parent;
      const call = push.parent;
      const pushed =
        ts.isPropertyAccessExpression(push) &&
        push.expression === node &&
        push.name.text === "push" &&
        ts.isCallExpression(call) &&
        call.expression === push;
      if (!pushed)
        out.push({
          ...lineAt(node),
          rule: "G6",
          detail: `annotations reached other than by .push( of object literals: ${text(push)}`,
        });
      else for (const arg of call.arguments) checkAnnotation(arg);
    }
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

// L1 (V13-QA-011): what the runner registers must be exactly the file's own test calls. The per-file scan cannot see a
// helper defined in another file that pins, skips or declares tests (its stated limit). `playwright test --list
// --reporter=json` reports every test the runner would run, with the file and line of the call that declared it, its
// expected status and its static annotations. For each Playwright leak suite:
//   - every registered test is declared in that file, on the line of one of its own plain test( calls;
//   - every one of those calls registers at least one test (none sits in dead code or behind a condition);
//   - every registered test is expected to pass, with no skip, fixme or fail annotation.
// The Vitest suite (SEC's case matrix) is out of L1's reach: `vitest list` leaves out a skipped suite instead of
// reporting it, so it is guarded by G1–G6 and SEC's own fail-in-CI rule (V13-SEC-010/011).
// Limit (ARCH R1 on #136): the listing is what the runner registers at load time. A helper in another file that calls
// test.skip() inside a test body, or test.skip(({ browserName }) => …) at file level, decides at run time, and --list
// reports that test as expected to pass with no annotation (probed with Playwright 1.63; test.skip(true, …) at load time
// lists as skipped and is caught). Run-time skips from helpers are out of L1's reach; review covers that.

/** One test as `playwright test --list --reporter=json` reports it. */
export interface ListedTest {
  /** Repository-relative path of the file whose call declared it. */
  readonly file: string;
  readonly line: number;
  readonly title: string;
  readonly expectedStatus: string;
  readonly annotations: readonly { readonly type: string }[];
}

interface JsonSpec {
  title: string;
  file: string;
  line: number;
  tests: { expectedStatus: string; annotations: { type: string }[] }[];
}
interface JsonSuite {
  file: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

/** The listing's tests per top-level file, paths made repository-relative (`testDir` is `tests/`). */
export function listedTests(json: { suites: JsonSuite[] }, testDir = "tests/"): Map<string, ListedTest[]> {
  const out = new Map<string, ListedTest[]>();
  const walk = (suite: JsonSuite, into: ListedTest[]) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests)
        into.push({
          file: testDir + spec.file,
          line: spec.line,
          title: spec.title,
          expectedStatus: t.expectedStatus,
          annotations: t.annotations,
        });
    for (const child of suite.suites ?? []) walk(child, into);
  };
  for (const top of json.suites) {
    const list: ListedTest[] = [];
    walk(top, list);
    out.set(testDir + top.file, [...(out.get(testDir + top.file) ?? []), ...list]);
  }
  return out;
}

/** The lines of the file's own plain `test(` / `it(` calls that declare a test (a title, then a body). */
export function testCallLines(src: string): Set<number> {
  const sf = ts.createSourceFile("guarded.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = new Set<number>();
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "test" || node.expression.text === "it") &&
      node.arguments.length >= 2
    )
      lines.add(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

/** True when the suite runs on Playwright (L1 applies), from its own import. */
export const isPlaywrightSuite = (src: string) => /from\s+["']@playwright\/test["']/.test(src);

const NOT_RUN = new Set(["skip", "fixme", "fail"]);

/** L1 over a listing: what the runner registers equals the suites' own test calls, all expected to pass. */
export function checkListing(
  listing: ReadonlyMap<string, readonly ListedTest[]>,
  read: (file: string) => string | null,
  suites: readonly string[],
): GuardViolation[] {
  const out: GuardViolation[] = [];
  const hit = (file: string, line: number, detail: string) => out.push({ rule: "L1", file, line, detail });
  for (const file of suites) {
    const src = read(file);
    if (src === null || !isPlaywrightSuite(src)) continue;
    const calls = testCallLines(src);
    const listed = listing.get(file) ?? [];
    const seen = new Set<number>();
    for (const t of listed) {
      if (t.file !== file) hit(file, 0, `"${t.title}" is declared in another file: ${t.file}:${t.line}`);
      else if (!calls.has(t.line))
        hit(file, t.line, `"${t.title}" is declared other than by one of the file's own test( calls`);
      else seen.add(t.line);
      if (t.expectedStatus !== "passed")
        hit(file, t.line, `"${t.title}" is registered as expected to be ${t.expectedStatus}`);
      for (const a of t.annotations)
        if (NOT_RUN.has(a.type)) hit(file, t.line, `"${t.title}" carries a "${a.type}" annotation`);
    }
    for (const line of [...calls].sort((a, b) => a - b))
      if (!seen.has(line)) hit(file, line, "a test( call the runner does not register");
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// G7 (V13-QA-015; REQ-VIS-012; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §5.2, D2): visual baselines are never approved by the
// runner, in CI or locally. playwright.config.ts holds exactly one updateSnapshots, the defineConfig object's own
// property, with the value "none" written as a plain string (Playwright's default is "missing", so a missing key would
// write baselines; a local "missing" wrote sandbox images into tests/visual/__screenshots__/, ARCH B2 on #145; the
// baseline spec writes candidates itself, to test-results/baseline-candidates/); no other mention of the name, no computed key and no element access with a built
// name could set it otherwise. No workflow line and no package script passes --update-snapshots (or -u) to the runner.

const UPDATE_SNAPSHOTS = "updateSnapshots";

/** True for exactly the string literal "none": no run, in CI or locally, writes a baseline (ARCH B2 on #145). */
function isPinnedUpdateSnapshots(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) && node.text === "none";
}

/** G7 over playwright.config.ts. */
export function checkSnapshotConfig(file: string, src: string): GuardViolation[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: GuardViolation[] = [];
  const hit = (node: ts.Node, detail: string) =>
    out.push({
      rule: "G7",
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      detail,
    });
  // Inside [ ] only a written string or number can be read: an identifier there is a variable.
  const isPlainLiteral = (n: ts.Node): boolean => ts.isStringLiteralLike(n) || ts.isNumericLiteral(n);

  // The defineConfig({...}) object.
  let configObject: ts.ObjectLiteralExpression | undefined;
  const visitConfig = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "defineConfig" &&
      n.arguments[0] &&
      ts.isObjectLiteralExpression(n.arguments[0])
    )
      configObject ??= n.arguments[0];
    ts.forEachChild(n, visitConfig);
  };
  visitConfig(sf);
  if (!configObject) {
    hit(sf, "no defineConfig({ … }) object to hold updateSnapshots");
    return out;
  }

  // A spread into the config whose object cannot be read could carry updateSnapshots: only object literals (directly or
  // as the branches of a condition) may be spread there.
  const readableSpread = (e: ts.Expression): boolean => {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isObjectLiteralExpression(e)) return true;
    return ts.isConditionalExpression(e) && readableSpread(e.whenTrue) && readableSpread(e.whenFalse);
  };
  for (const p of configObject.properties)
    if (ts.isSpreadAssignment(p) && !readableSpread(p.expression))
      hit(p, "a spread into the config that is not an object literal (it could set updateSnapshots)");

  let pinned = 0;
  const visit = (n: ts.Node) => {
    // Every mention of the name: an identifier, a property name or a string anywhere.
    if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && n.text === UPDATE_SNAPSHOTS) {
      const prop = n.parent;
      const isConfigOwn = ts.isPropertyAssignment(prop) && prop.name === n && prop.parent === configObject;
      if (isConfigOwn && isPinnedUpdateSnapshots((prop as ts.PropertyAssignment).initializer)) pinned += 1;
      else if (isConfigOwn) hit(n, 'updateSnapshots must be exactly "none"');
      else hit(n, "updateSnapshots is set or named outside the config's own property");
    }
    // A key or an element access whose name is built cannot be read; it could be updateSnapshots.
    if (ts.isComputedPropertyName(n) && !isPlainLiteral(n.expression))
      hit(n, "a computed key that is not a plain literal (it could set updateSnapshots)");
    if (ts.isElementAccessExpression(n) && !isPlainLiteral(n.argumentExpression))
      hit(n, "an element access with a built name (it could set updateSnapshots)");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (pinned !== 1 && !out.some((v) => v.detail.startsWith("updateSnapshots must")))
    hit(configObject, 'the config has no updateSnapshots: "none" (the default writes baselines)');
  return out;
}

const UPDATE_FLAG = /--update-snapshots|--update-source-snapshots/;
const SHORT_UPDATE = /(?:^|\s)-u(?:=\S*)?(?=\s|$|["'])/;
const RUNS_PLAYWRIGHT = /playwright|test:e2e|test:visual/;

/** G7 over workflow files and package.json scripts: no line hands the runner an update flag. */
export function checkSnapshotFlags(file: string, text: string): GuardViolation[] {
  const out: GuardViolation[] = [];
  text.split("\n").forEach((line, i) => {
    if (UPDATE_FLAG.test(line) || (RUNS_PLAYWRIGHT.test(line) && SHORT_UPDATE.test(line)))
      out.push({
        rule: "G7",
        file,
        line: i + 1,
        detail: "a runner update flag: baselines are never written by CI",
      });
  });
  return out;
}
