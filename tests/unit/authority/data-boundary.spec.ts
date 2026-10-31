// tests/unit/authority/data-boundary.spec.ts — SEC ruling on PR #3, item 2: the policy and authority data stay on the server.
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
//
// authority_v13.json is imported only by lib/authority/check.ts, and policy_v13.json only by lib/disclosure/project.ts
// (lands with PROC-003). Both modules start with `import "server-only"`. lib/domain and lib/journeys, which client
// components may import, never import lib/authority or lib/disclosure, so they cannot re-export the data.
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SOURCE_DIRS = ["app", "lib", "components", "styles"];
const SKIP = new Set(["node_modules", ".next"]);
const walk = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((f) => {
      if (SKIP.has(f)) return [];
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
const sources = (): string[] =>
  SOURCE_DIRS.map((d) => join(ROOT, d))
    .filter(existsSync)
    .flatMap(walk)
    .filter((p) => /\.(?:ts|tsx|mts|js|mjs|jsx)$/.test(p));
const rel = (p: string) => relative(ROOT, p).split("\\").join("/");
const importsOf = (text: string): string[] =>
  [
    ...text.matchAll(
      /(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g,
    ),
  ].map((m) => (m[1] ?? m[2] ?? m[3]) as string);

/** The repository path an import specifier points at (alias `@/` or relative), or null for a package import. */
const targetOf = (fromRel: string, spec: string): string | null => {
  if (spec.startsWith("@/")) return spec.slice(2);
  if (spec.startsWith("./") || spec.startsWith("../"))
    return rel(resolve(join(ROOT, dirname(fromRel)), spec));
  return null;
};
/** ARCH 31 Oct, condition 1 for PROC-003: until PROC-005 lands with the full DIS suite, only these may import it. */
const DISCLOSURE_IMPORTERS = /^lib\/(?:disclosure|notifications)\//;
const disclosureImports = (fromRel: string, text: string): string[] =>
  importsOf(text).filter((spec) => {
    const t = targetOf(fromRel, spec);
    return t !== null && /^lib\/disclosure(?:\/|$)/.test(t);
  });

/** data file → the one module allowed to import it */
const OWNERS: Record<string, string> = {
  "authority_v13.json": "lib/authority/check.ts",
  "policy_v13.json": "lib/disclosure/project.ts",
};

describe("server-only data boundary (SEC, PR #3 item 2)", () => {
  test("BND-01 each data file is imported by its one server-only owner and by nothing else in app/, lib/, components/", () => {
    const files = sources();
    assert.ok(
      files.some((p) => rel(p) === "lib/authority/check.ts"),
      "lib/authority/check.ts is in scope",
    );
    const found: Record<string, string[]> = {};
    for (const p of files) {
      for (const spec of importsOf(readFileSync(p, "utf8"))) {
        for (const data of Object.keys(OWNERS)) if (spec.endsWith(data)) (found[data] ??= []).push(rel(p));
      }
    }
    for (const [data, owner] of Object.entries(OWNERS)) {
      const importers = found[data] ?? [];
      if (existsSync(join(ROOT, owner))) assert.deepEqual(importers, [owner], `${data} importers`);
      else assert.deepEqual(importers, [], `${data}: no importer until ${owner} lands`);
    }
  });

  test("BND-02 the owners and their package entry points are server-only", () => {
    for (const p of [
      "lib/authority/check.ts",
      "lib/authority/index.ts",
      "lib/disclosure/project.ts",
      "lib/disclosure/index.ts",
    ]) {
      const abs = join(ROOT, p);
      if (!existsSync(abs)) continue;
      const first = readFileSync(abs, "utf8")
        .split("\n")
        .find((l) => /^\s*import\b/.test(l));
      assert.match(first ?? "", /^import\s+["']server-only["'];?\s*$/, `${p}: first import is server-only`);
    }
    assert.ok(existsSync(join(ROOT, "lib/authority/check.ts")));
  });

  test("BND-03 lib/domain and lib/journeys never import lib/authority or lib/disclosure (no re-export path to a client bundle)", () => {
    const hits: string[] = [];
    for (const p of sources().filter((x) => /^lib\/(?:domain|journeys)\//.test(rel(x)))) {
      for (const spec of importsOf(readFileSync(p, "utf8"))) {
        if (
          /(?:^|\/)lib\/(?:authority|disclosure)(?:\/|$)|^\.\.\/(?:authority|disclosure)(?:\/|$)/.test(spec)
        )
          hits.push(`${rel(p)} → ${spec}`);
      }
    }
    assert.deepEqual(hits, []);
  });

  test("BND-04 negative: the import scanner sees static, re-export, dynamic and require forms", () => {
    const text = [
      'import a from "../authority/authority_v13.json";',
      "export { b } from '@/lib/disclosure/policy_v13.json';",
      'const c = await import("./authority_v13.json");',
      'const d = require("policy_v13.json");',
    ].join("\n");
    assert.deepEqual(importsOf(text), [
      "../authority/authority_v13.json",
      "@/lib/disclosure/policy_v13.json",
      "./authority_v13.json",
      "policy_v13.json",
    ]);
  });

  test("BND-05 nothing outside lib/disclosure and lib/notifications imports lib/disclosure (ARCH, until PROC-005)", () => {
    const hits: string[] = [];
    for (const p of sources()) {
      const r = rel(p);
      if (DISCLOSURE_IMPORTERS.test(r)) continue;
      for (const spec of disclosureImports(r, readFileSync(p, "utf8"))) hits.push(`${r} → ${spec}`);
    }
    assert.deepEqual(hits, []);
  });

  test("BND-06 negative: the lib/disclosure import check sees the alias, relative paths and the bare directory", () => {
    const text = [
      'import { project } from "@/lib/disclosure";',
      'import type { Projected } from "@/lib/disclosure/project";',
      'export * from "../disclosure/project";',
      'const m = await import("../../lib/disclosure");',
      'import { x } from "@/lib/disclosures-other";',
      'import { y } from "@/lib/domain";',
      'import "server-only";',
    ].join("\n");
    assert.deepEqual(disclosureImports("lib/authority/check.ts", text), [
      "@/lib/disclosure",
      "@/lib/disclosure/project",
      "../disclosure/project",
      "../../lib/disclosure",
    ]);
    assert.deepEqual(disclosureImports("app/x/page.tsx", 'const m = await import("../../lib/disclosure");'), [
      "../../lib/disclosure",
    ]);
    assert.ok(
      !DISCLOSURE_IMPORTERS.test("app/x/page.tsx") &&
        DISCLOSURE_IMPORTERS.test("lib/notifications/render/model.ts"),
    );
  });
});
