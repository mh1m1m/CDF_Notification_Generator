// Runs a server module (one that starts with `import "server-only"`) in a separate Node process and returns what the
// given script prints as JSON, for oracles that must come from the app's own code (e.g. lib/disclosure).
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
//
// The child process gets Node module hooks that the Playwright worker never sees (hooks registered in a worker stay
// for its life and changed how other specs load CommonJS):
//   - `server-only` resolves to an empty module (Vitest does the same through tests/support/server-only.ts);
//   - `@/…` resolves from the repository root, and an import without an extension gets `.ts` (TypeScript is run with
//     Node's type stripping);
//   - lib/disclosure/policy_v13.json, imported without an import attribute (Next.js bundles it), is served as an ES
//     module whose default export is the file's JSON.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = pathToFileURL(`${process.cwd()}/`).href;

const HOOKS = `
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const ROOT = ${JSON.stringify(ROOT)};
export async function resolve(specifier, context, next) {
  if (specifier === "server-only")
    return { url: "data:text/javascript,export%20%7B%7D", format: "module", shortCircuit: true };
  let s = specifier.startsWith("@/") ? new URL(specifier.slice(2), ROOT).href : specifier;
  if ((s.startsWith("file:") || s.startsWith(".")) && !/\\.[a-z]+$/.test(s)) {
    const candidate = new URL(s + ".ts", context.parentURL ?? ROOT);
    if (existsSync(fileURLToPath(candidate))) s = candidate.href;
  }
  return next(s, context);
}
export async function load(url, context, next) {
  if (url.startsWith("file:") && url.endsWith(".json"))
    return { format: "module", source: "export default " + readFileSync(new URL(url), "utf8"), shortCircuit: true };
  return next(url, context);
}
`;

const REGISTER = `import { register } from "node:module"; register(${JSON.stringify(
  `data:text/javascript,${encodeURIComponent(HOOKS)}`,
)});`;

/**
 * Runs `script` (an ES module body; it may `await import("@/lib/…")`) in a child Node process with the hooks above and
 * returns the JSON it prints on its last line.
 */
export function runServerScript<T>(script: string): T {
  if (!existsSync("lib")) throw new Error("runServerScript must run from the repository root");
  const out = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      `data:text/javascript,${encodeURIComponent(REGISTER)}`,
      "--input-type=module",
      "-e",
      script,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 },
  );
  const last = out.trim().split("\n").pop() ?? "";
  return JSON.parse(last) as T;
}
