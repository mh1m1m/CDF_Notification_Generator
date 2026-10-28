// V13-SEC-003 · SEC-APP-12, SEC-APP-13 (static part), SEC-APP-18 (static part) · threats TM-S4, TM-T4, TM-I8, TM-E5.
// Source-level guards over the application code (app/, components/, lib/, proxy.ts, next.config.ts):
//  - the claims setting, SET ROLE and set_config appear only in lib/db (TM-S4: no other path shapes the security context);
//  - no client component imports server-only infrastructure;
//  - every module that imports the postgres driver or node:crypto is server-only;
//  - no NEXT_PUBLIC_ variable exists, and .env.example holds names only (TM-I8);
//  - every exported Server Action outside the public allow-list checks the session itself (TM-E5).
// SYNTHETIC DATA ONLY. These checks read files; they never run application code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_ACTIONS } from "../public-actions";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const APP_ROOTS = ["app", "components", "lib", "proxy.ts", "next.config.ts"];
const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;

function walk(path: string): string[] {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }
  if (stat.isFile()) return SOURCE.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => (name === "node_modules" ? [] : walk(join(path, name))));
}

const files = APP_ROOTS.flatMap((p) => walk(join(ROOT, p))).map((abs) => ({
  path: relative(ROOT, abs).split("\\").join("/"),
  text: readFileSync(abs, "utf8"),
}));

/** Source without line and block comments (good enough for these guards; strings are kept). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const hits = (pattern: RegExp) => files.filter((f) => pattern.test(code(f.text))).map((f) => f.path);

describe("SEC-APP-12 the request security context is shaped only in lib/db (TM-S4, TM-T4)", () => {
  it("found the application sources", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.path === "lib/db/security-context.ts")).toBe(true);
  });

  it("only lib/db/security-context.ts writes request.v13.claims", () => {
    expect(hits(/set_config\s*\(\s*'request\.v13\.claims/)).toEqual(["lib/db/security-context.ts"]);
    expect(
      hits(/request\.v13\.claims/).filter((p) => !p.startsWith("lib/db/") && !p.startsWith("lib/contracts/")),
    ).toEqual([]);
  });

  it("set_config, SET ROLE, RESET ROLE and SET SESSION AUTHORIZATION appear only in lib/db", () => {
    expect(hits(/set_config\s*\(/i).filter((p) => !p.startsWith("lib/db/"))).toEqual([]);
    expect(
      hits(/\b(set\s+(local\s+)?role|reset\s+role|set\s+session\s+authorization)\b/i).filter(
        (p) => !p.startsWith("lib/db/"),
      ),
    ).toEqual([]);
  });

  it("no raw-SQL escape hatch anywhere in application code (.unsafe, sql.file, new Function)", () => {
    expect(hits(/\.\s*unsafe\s*\(|\[\s*["'`]unsafe["'`]\s*\]/)).toEqual([]);
    expect(hits(/\.\s*file\s*\(/).filter((p) => p.startsWith("lib/db/"))).toEqual([]);
    expect(hits(/\bnew\s+Function\s*\(|\beval\s*\(/)).toEqual([]);
  });

  it("only lib/db imports the postgres driver", () => {
    expect(
      hits(/from\s+["']postgres["']|require\(\s*["']postgres["']\s*\)/).filter(
        (p) => !p.startsWith("lib/db/"),
      ),
    ).toEqual([]);
  });
});

describe("client / server boundary (TM-I8, TM-I6)", () => {
  const isClient = (text: string) => /^\s*(["'])use client\1/m.test(text.split("\n").slice(0, 5).join("\n"));
  const SERVER_ONLY_IMPORTS =
    /from\s+["'](@\/lib\/db[^"']*|@\/lib\/auth\/(server-session|claims-key)|@\/lib\/(disclosure|authority)[^"']*|@\/lib\/server[^"']*|postgres|node:[^"']+|server-only)["']/;

  it("no client component imports database, session-key, disclosure, authority, BFF or Node.js modules", () => {
    const offenders = files
      .filter((f) => isClient(f.text) && SERVER_ONLY_IMPORTS.test(code(f.text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("every module importing the postgres driver or a node: built-in starts server-only (except edge-safe test helpers)", () => {
    const needs = files.filter(
      (f) => /from\s+["'](postgres|node:[^"']+)["']/.test(code(f.text)) && !f.path.startsWith("app/api/"),
    );
    expect(needs.length).toBeGreaterThan(0);
    const missing = needs
      .filter((f) => !/^\s*import\s+["']server-only["'];?/m.test(f.text))
      .map((f) => f.path);
    expect(missing).toEqual([]);
  });

  it("no NEXT_PUBLIC_ variable is read or defined by application code", () => {
    expect(hits(/NEXT_PUBLIC_/)).toEqual([]);
  });

  it(".env.example holds variable names only: every assignment is empty and none is NEXT_PUBLIC_", () => {
    const lines = readFileSync(join(ROOT, ".env.example"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^[A-Z][A-Z0-9_]*=$/);
      expect(line.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });
});

describe("SEC-APP-18 Server Actions check the session themselves (TM-E5, static part)", () => {
  // The allow-list lives in tests/security/public-actions.ts; the browser probes use the same list.
  const actionFiles = files.filter((f) => /^\s*(["'])use server\1/.test(f.text));
  const exported = actionFiles.flatMap((f) =>
    [...code(f.text).matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([\s\S]*?)\n\}/g)].map(
      (m) => ({
        id: `${f.path}#${m[1]}`,
        body: m[2] ?? "",
      }),
    ),
  );

  it("finds the current actions, and every allow-listed action still exists", () => {
    const ids = exported.map((a) => a.id);
    for (const id of Object.keys(PUBLIC_ACTIONS)) expect(ids).toContain(id);
  });

  it("'use server' appears only as a file directive (no inline actions that could escape this check)", () => {
    const inline = files.filter((f) => {
      const body = code(f.text).replace(/^\s*(["'])use server\1;?/, "");
      return /(["'])use server\1/.test(body);
    });
    expect(inline.map((f) => f.path)).toEqual([]);
  });

  it("files with 'use server' export only async functions (no exported constants or re-exports of helpers)", () => {
    for (const f of actionFiles) {
      const src = code(f.text);
      expect(src).not.toMatch(/export\s+(const|let|var|class|default|\{|\*)/);
    }
  });

  it("every other exported action calls getCurrentSession() itself", () => {
    const unguarded = exported
      .filter((a) => !(a.id in PUBLIC_ACTIONS))
      .filter((a) => !/\bgetCurrentSession\s*\(/.test(a.body))
      .map((a) => a.id);
    expect(unguarded).toEqual([]);
  });
});
