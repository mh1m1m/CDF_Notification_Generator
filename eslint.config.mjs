// Flat ESLint configuration for the V13 Enterprise app (single Next.js App Router app at the repository root).
// Import boundaries use ESLint's built-in no-restricted-imports (no extra plugin; docs/DEPENDENCIES.md).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

const NO_SUPABASE = {
  group: ["@supabase/*", "@supabase/**"],
  message:
    "No Supabase SDKs in V13: database access is server-side SQL with the postgres driver inside lib/db/.",
};
const NO_POSTGRES = {
  group: ["postgres"],
  message:
    "The postgres driver is imported only inside lib/db/** (plus scripts/db and the database test suites).",
};
const PURE_LAYER = {
  group: [
    "next",
    "next/*",
    "react",
    "react/*",
    "react-dom",
    "react-dom/*",
    "jose",
    "server-only",
    "@/app/*",
    "@/components/*",
    "@/lib/auth",
    "@/lib/auth/*",
    "@/lib/db",
    "@/lib/db/*",
    "@/lib/i18n",
    "@/lib/i18n/*",
  ],
  message:
    "lib/contracts and lib/domain are pure TypeScript (zod only): no frameworks, infrastructure or outer layers.",
};
const EDGE_SAFE = {
  group: ["@/lib/db", "@/lib/db/*", "server-only", "node:*"],
  message: "proxy.ts stays edge-safe: no database access, no Node.js built-ins.",
};
const NO_TESTS = {
  // @/tests/…, ./tests/… (root files) and ../tests/… at any depth.
  regex: "^(?:@/tests|\\./tests|(?:\\.\\./)+tests)(?:/|$)",
  message:
    "Application code never imports from tests/: fixtures, test keys and test helpers stay out of the app bundle.",
};
/** Application code: everything that ships in the Next.js build. */
const APP_CODE = [
  "app/**/*.{ts,tsx}",
  "components/**/*.{ts,tsx}",
  "lib/**/*.{ts,tsx}",
  "proxy.ts",
  "instrumentation.ts",
  "next.config.ts",
];

const NO_UNSAFE_SQL_MESSAGE =
  "Raw SQL (`unsafe`) is allowed only in scripts/db and integration tests: SEC finding TM-S4 (claims forgery through SQL injection). Use postgres tagged templates with bound parameters.";
/** Any member named `unsafe` (postgres raw SQL): calls, aliases and destructuring. */
const NO_UNSAFE_SQL = [
  { selector: "MemberExpression[property.name='unsafe']", message: NO_UNSAFE_SQL_MESSAGE },
  { selector: "MemberExpression[property.value='unsafe']", message: NO_UNSAFE_SQL_MESSAGE },
  { selector: "ObjectPattern > Property[key.name='unsafe']", message: NO_UNSAFE_SQL_MESSAGE },
  { selector: "ObjectPattern > Property[key.value='unsafe']", message: NO_UNSAFE_SQL_MESSAGE },
];

const I18N_MESSAGE =
  "User-facing text comes from lib/i18n dictionaries (ar + en); no hard-coded strings in components.";
const LOGICAL_CSS_MESSAGE =
  "Use logical CSS properties (marginInlineStart, paddingInlineEnd, insetInlineStart, …), never left/right.";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      ".next/**",
      ".local/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
      "next-env.d.ts",
      // Frozen evidence copies (byte-exact, sha256-recorded; docs/DEPENDENCIES.md decision 15).
      "tests/unit/**/__evidence__/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-imports": ["error", { patterns: [NO_SUPABASE, NO_POSTGRES] }],
      "no-restricted-syntax": ["error", ...NO_UNSAFE_SQL],
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // Rule options do not merge across blocks, so every block below restates the full pattern list for its files.
    files: APP_CODE,
    rules: { "no-restricted-imports": ["error", { patterns: [NO_SUPABASE, NO_POSTGRES, NO_TESTS] }] },
  },
  {
    // The only places that may hold a postgres connection: lib/db in the app ...
    files: ["lib/db/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [NO_SUPABASE, NO_TESTS] }] },
  },
  {
    // ... and the migration tooling and database test suites outside it, plus QA's read-only scenario oracle (raw SQL
    // stays banned there: it is not in the next block).
    files: [
      "scripts/db/**/*.mjs",
      "tests/integration/**/*.ts",
      "tests/security/db/**/*.ts",
      "tests/fixtures/db.ts",
    ],
    rules: { "no-restricted-imports": ["error", { patterns: [NO_SUPABASE] }] },
  },
  {
    // Migration tooling and database test suites run reviewed SQL files and fixtures as raw SQL.
    files: ["scripts/db/**/*.mjs", "tests/integration/**/*.ts", "tests/security/db/**/*.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["lib/contracts/**/*.ts", "lib/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_SUPABASE, NO_POSTGRES, PURE_LAYER, NO_TESTS] }],
    },
  },
  {
    files: ["proxy.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_SUPABASE, NO_POSTGRES, EDGE_SAFE, NO_TESTS] }],
    },
  },
  {
    // Developer and CI command-line scripts report progress on stdout.
    files: ["scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "@next/next/no-html-link-for-pages": "off",
      "no-restricted-syntax": [
        "error",
        ...NO_UNSAFE_SQL,
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML is prohibited.",
        },
        { selector: "JSXText[value=/\\S/]", message: I18N_MESSAGE },
        { selector: "JSXElement > JSXExpressionContainer > Literal[value=/\\S/]", message: I18N_MESSAGE },
        { selector: "JSXElement > JSXExpressionContainer > TemplateLiteral", message: I18N_MESSAGE },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|aria-description|aria-placeholder|aria-roledescription|aria-valuetext|title|placeholder|alt)$/] > Literal",
          message: I18N_MESSAGE,
        },
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name=/^((margin|padding|border|scrollMargin|scrollPadding)(Left|Right)\\w*|left|right)$/]",
          message: LOGICAL_CSS_MESSAGE,
        },
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name=/^(textAlign|float|clear)$/] > Literal[value=/^(left|right)$/]",
          message: LOGICAL_CSS_MESSAGE,
        },
      ],
    },
  },
);
