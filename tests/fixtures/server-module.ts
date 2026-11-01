// Loads a server module (one that starts with `import "server-only"`) into the Playwright test process, for oracles
// that must come from the app's own code (e.g. lib/disclosure). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
//
// Two Node module hooks, registered once per worker, for this process only:
//   - `server-only` resolves to an empty module (Vitest does the same through its alias, tests/support/server-only.ts);
//   - lib/disclosure/policy_v13.json, which the module imports without an import attribute (Next.js bundles it), is
//     served as an ES module whose default export is the file's JSON.
// Nothing else is changed: every other specifier goes to Playwright's own loader.
import { register } from "node:module";

const HOOKS = `
import { readFileSync } from "node:fs";
export async function resolve(specifier, context, next) {
  if (specifier === "server-only")
    return { url: "data:text/javascript,export%20%7B%7D", format: "module", shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith("file:") && url.endsWith("/lib/disclosure/policy_v13.json"))
    return { format: "module", source: "export default " + readFileSync(new URL(url), "utf8"), shortCircuit: true };
  return next(url, context);
}
`;

let registered = false;

/** Registers the hooks (once); call before the first dynamic import of a server module. */
export function allowServerModules(): void {
  if (registered) return;
  register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
  registered = true;
}
