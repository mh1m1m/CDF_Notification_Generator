// The repository's ESLint boundaries, checked through the ESLint API with the real eslint.config.mjs: raw SQL
// (`unsafe`, SEC finding TM-S4), Supabase SDKs, the postgres driver outside lib/db, pure layers, edge-safe proxy, no
// imports from tests/ in application code, and hard-coded text in components.
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../..", import.meta.url)) });

async function messagesFor(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => `${m.ruleId}: ${m.message}`);
}

const TM_S4 = /SEC finding TM-S4/;

describe("raw SQL (`unsafe`) — SEC finding TM-S4", () => {
  const variants = [
    'export async function f(sql: { unsafe(q: string): Promise<unknown> }) { return sql.unsafe("select 1"); }\n',
    'export function f(sql: Record<string, unknown>) { return sql["unsafe"]; }\n',
    "export function f(tx: { unsafe: unknown }) { const { unsafe } = tx; return unsafe; }\n",
    "export function f(tx: { unsafe: unknown }) { const { unsafe: raw } = tx; return raw; }\n",
  ];

  it.each([
    "lib/db/example.ts",
    "lib/auth/example.ts",
    "app/api/example/route.ts",
    "proxy.ts",
    "tests/unit/x.spec.ts",
  ])("is an error in %s", async (file) => {
    for (const code of variants)
      expect(
        (await messagesFor(file, code)).some((m) => TM_S4.test(m)),
        code,
      ).toBe(true);
  });

  it.each(["scripts/db/example.mjs", "tests/integration/example.spec.ts"])(
    "is allowed in %s",
    async (file) => {
      const code = 'export async function f(sql) { return sql.unsafe("select 1"); }\n';
      expect((await messagesFor(file, code)).filter((m) => TM_S4.test(m))).toEqual([]);
    },
  );

  it("does not flag tagged templates", async () => {
    const code =
      "export async function f(sql: (s: TemplateStringsArray, ...v: unknown[]) => unknown, id: string) {\n" +
      "  return sql`select ${id}`;\n}\n";
    expect(await messagesFor("lib/db/example.ts", code)).toEqual([]);
  });
});

describe("import boundaries", () => {
  it("forbids Supabase SDKs everywhere, including lib/db", async () => {
    for (const file of ["lib/db/example.ts", "app/page-example.tsx", "scripts/db/example.mjs"]) {
      const messages = await messagesFor(
        file,
        'import { createClient } from "@supabase/supabase-js";\nexport const c = createClient;\n',
      );
      expect(
        messages.some((m) => m.includes("No Supabase SDKs")),
        file,
      ).toBe(true);
    }
  });

  it("allows the postgres driver only in lib/db, scripts/db and integration tests", async () => {
    const code = 'import postgres from "postgres";\nexport const p = postgres;\n';
    for (const file of ["app/api/example/route.ts", "lib/auth/example.ts", "components/Example.tsx"]) {
      expect(
        (await messagesFor(file, code)).some((m) => m.includes("postgres driver")),
        file,
      ).toBe(true);
    }
    for (const file of ["lib/db/example.ts", "tests/integration/example.spec.ts"]) {
      expect(await messagesFor(file, code), file).toEqual([]);
    }
  });

  it("keeps lib/contracts and lib/domain pure, and proxy.ts edge-safe", async () => {
    const framework = 'import { cookies } from "next/headers";\nexport const c = cookies;\n';
    expect(
      (await messagesFor("lib/domain/example.ts", framework)).some((m) => m.includes("pure TypeScript")),
    ).toBe(true);
    expect(
      (await messagesFor("lib/contracts/example.ts", framework)).some((m) => m.includes("pure TypeScript")),
    ).toBe(true);
    const node = 'import { readFileSync } from "node:fs";\nexport const r = readFileSync;\n';
    expect((await messagesFor("proxy.ts", node)).some((m) => m.includes("edge-safe"))).toBe(true);
  });
});

describe("application code never imports from tests/", () => {
  const importing = (source: string) => `import { x } from "${source}";\nexport const y = x;\n`;
  const fromTests = (messages: string[]) => messages.some((m) => m.includes("never imports from tests/"));

  it.each([
    ["app/page-example.tsx", "@/tests/support/fixtures"],
    ["app/(platform)/example/page.tsx", "../../../tests/support/fixtures"],
    ["components/Example.tsx", "../tests/e2e/helpers"],
    ["lib/auth/example.ts", "../../tests/support/keys"],
    ["lib/db/example.ts", "../../tests/integration/support/clusters"],
    ["lib/domain/example.ts", "@/tests/support/fixtures"],
    ["lib/contracts/example.ts", "@/tests"],
    ["proxy.ts", "./tests/support/keys"],
    ["instrumentation.ts", "./tests/support/keys"],
    ["next.config.ts", "./tests/support/headers"],
  ])("is an error in %s (%s)", async (file, source) => {
    expect(fromTests(await messagesFor(file, importing(source))), `${file} ← ${source}`).toBe(true);
  });

  it("leaves test files and look-alike paths alone", async () => {
    for (const [file, source] of [
      ["tests/unit/x.spec.ts", "@/tests/support/fixtures"],
      ["tests/integration/x.spec.ts", "../support/server-only"],
      ["lib/auth/example.ts", "@/lib/testsuite"],
      ["lib/auth/example.ts", "@/testsuite/x"],
    ] as const) {
      expect(fromTests(await messagesFor(file, importing(source))), `${file} ← ${source}`).toBe(false);
    }
  });
});

describe("frozen evidence copies (docs/DEPENDENCIES.md decision 15)", () => {
  it("ignores files under tests/unit/**/__evidence__/ only", async () => {
    for (const file of ["tests/unit/domain/__evidence__/ui_v9.js", "tests/unit/a/b/__evidence__/c/d.js"]) {
      expect(await eslint.isPathIgnored(file), file).toBe(true);
    }
    for (const file of [
      "tests/unit/domain/helper.js",
      "tests/unit/domain/status.spec.ts",
      "tests/unit/domain/__evidence__.spec.ts",
      "lib/domain/__evidence__/x.ts",
      "tests/integration/__evidence__/x.ts",
    ]) {
      expect(await eslint.isPathIgnored(file), file).toBe(false);
    }
  });
});

describe("components", () => {
  it("rejects hard-coded text, dangerouslySetInnerHTML and physical inline styles", async () => {
    const hardCoded = "export function X() { return <p>Hello</p>; }\n";
    expect((await messagesFor("components/X.tsx", hardCoded)).some((m) => m.includes("lib/i18n"))).toBe(true);
    const html = 'export function X() { return <div dangerouslySetInnerHTML={{ __html: "" }} />; }\n';
    expect(
      (await messagesFor("components/X.tsx", html)).some((m) => m.includes("dangerouslySetInnerHTML")),
    ).toBe(true);
    const style = "export function X() { return <div style={{ marginLeft: 4 }} />; }\n";
    expect((await messagesFor("components/X.tsx", style)).some((m) => m.includes("logical CSS"))).toBe(true);
  });
});
