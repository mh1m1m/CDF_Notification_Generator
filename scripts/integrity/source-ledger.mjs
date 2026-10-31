#!/usr/bin/env node
// @ts-check
// QG-01 source integrity (V13-PROC-010): a hash ledger that proves the frozen V12/V13 evidence under
// /mnt/project-files/notifications/ is unchanged. SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
//
//   node scripts/integrity/source-ledger.mjs capture --out <ledger.json> <root> [<root> …]
//   node scripts/integrity/source-ledger.mjs verify  --ledger <ledger.json>
//
// capture  writes {path, size, sha256} for every regular file under the roots, sorted by path, plus the totals.
// verify   re-hashes the ledger's roots and reports added, removed and changed files (exit 1 on any difference).
//
// Safety rules (they hold for the command line and for the exported functions):
//   - it only reads, and only under the allowed base; a root outside it (after resolving symbolic links) is refused;
//   - it never writes under the allowed base: the ledger goes in an existing folder elsewhere (nothing is created);
//   - it never reads the excluded upload (real personal data): a root that is, is inside or contains it is refused;
//   - it never follows a symbolic link: a link is recorded as a link (target not read) so a change still shows.
// The command line prints counts, bytes and the ledger's own sha256. File names appear only in verify's difference
// report, on the local terminal; they never belong in Git (the folders hold mailbox exports).
import { createHash } from "node:crypto";
import { createReadStream, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The only tree the command line may read. */
export const ALLOWED_BASE = "/mnt/project-files/notifications";
/** Never read, whatever root is given (CLAUDE.md §1: real personal data). */
export const EXCLUDED_PATHS = Object.freeze([
  "/mnt/project-files/uploads/hearth/be02c96c-1d82-4401-89e9-9cd0406d23ec",
]);
export const LEDGER_FORMAT = "cdf-v13-source-ledger/1";

export class LedgerError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

/** @param {string} child @param {string} parent */
const isInside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
/** @param {string} p @param {readonly string[]} excluded */
const isExcluded = (p, excluded) => excluded.some((x) => isInside(p, x) || isInside(x, p));

/** @param {string} p */
const realOrNull = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/**
 * Check the roots, first by their written path (nothing is touched), then by their resolved path. Returns the real
 * base and each root relative to it.
 * @param {string} base
 * @param {readonly string[]} roots
 * @param {readonly string[]} [excluded]
 */
export function checkRoots(base, roots, excluded = EXCLUDED_PATHS) {
  if (typeof base !== "string" || !isAbsolute(base))
    throw new LedgerError("BAD_BASE", "the base must be absolute");
  if (!Array.isArray(roots) || roots.length === 0)
    throw new LedgerError("NO_ROOTS", "at least one root is required");
  for (const r of roots) {
    if (typeof r !== "string" || r === "")
      throw new LedgerError("BAD_ROOT", "a root must be a non-empty path");
    const abs = resolve(base, r);
    if (isExcluded(abs, excluded)) throw new LedgerError("EXCLUDED_ROOT", "this path is never read");
    if (!isInside(abs, resolve(base)))
      throw new LedgerError("ROOT_OUTSIDE_BASE", `root outside the allowed base: ${r}`);
  }
  const realBase = realOrNull(base);
  if (realBase === null) throw new LedgerError("BASE_MISSING", "the allowed base does not exist here");
  const rels = roots.map((r) => {
    const abs = resolve(realBase, r);
    let real;
    try {
      real = realpathSync(abs);
    } catch {
      throw new LedgerError("ROOT_MISSING", `root does not exist: ${r}`);
    }
    if (!isInside(real, realBase) || isExcluded(real, excluded))
      throw new LedgerError("ROOT_OUTSIDE_BASE", `root resolves outside the allowed base: ${r}`);
    return relative(realBase, real).split(sep).join("/");
  });
  const unique = [...new Set(rels)].sort();
  for (const a of unique)
    for (const b of unique)
      if (a !== b && (a === "" || b.startsWith(`${a}/`)))
        throw new LedgerError("OVERLAPPING_ROOTS", `roots overlap: ${a || "."} contains ${b}`);
  return { realBase, roots: unique };
}

/** @param {string} file @returns {Promise<string>} */
function sha256File(file) {
  return new Promise((ok, fail) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("error", fail)
      .on("end", () => ok(h.digest("hex")));
  });
}

/**
 * @typedef {{ path: string, kind: "file", size: number, sha256: string }
 *   | { path: string, kind: "symlink", size: 0, sha256: null }} Entry
 */

/**
 * Walk one root without following links. An excluded path cannot be reached: checkRoots refuses a root that is, is
 * inside or contains an excluded path, and a link is never followed.
 * @param {string} realBase @param {string} rel @param {Entry[]} out
 */
async function walk(realBase, rel, out) {
  const abs = rel === "" ? realBase : `${realBase}/${rel}`;
  // The entry is lstat-checked here and then opened by path below, so a swap between the two is possible in theory;
  // on a frozen folder that nothing writes to it is not a practical risk (SEC INFO on #64).
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) {
    out.push({ path: rel, kind: "symlink", size: 0, sha256: null });
  } else if (st.isDirectory()) {
    for (const name of readdirSync(abs).sort())
      await walk(realBase, rel === "" ? name : `${rel}/${name}`, out);
  } else if (st.isFile()) {
    out.push({ path: rel, kind: "file", size: st.size, sha256: await sha256File(abs) });
  }
  // sockets, devices and fifos are neither read nor recorded
}

/** @param {Entry} a @param {Entry} b */
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Hash every file under the roots. Reads only; writes nothing.
 * @param {{ base: string, roots: readonly string[], now?: () => Date, excluded?: readonly string[] }} opts
 */
export async function capture({ base, roots, now = () => new Date(), excluded = EXCLUDED_PATHS }) {
  const checked = checkRoots(base, roots, excluded);
  /** @type {Entry[]} */
  const entries = [];
  for (const r of checked.roots) await walk(checked.realBase, r, entries);
  entries.sort(byPath);
  return {
    format: LEDGER_FORMAT,
    base: checked.realBase,
    roots: checked.roots,
    captured_at: now().toISOString(),
    file_count: entries.length,
    total_bytes: entries.reduce((s, e) => s + e.size, 0),
    entries,
  };
}

/**
 * Compare a ledger with a fresh capture of the same roots.
 * @param {{ base: string, ledger: Awaited<ReturnType<typeof capture>>, excluded?: readonly string[] }} opts
 */
export async function verify({ base, ledger, excluded = EXCLUDED_PATHS }) {
  if (
    !ledger ||
    ledger.format !== LEDGER_FORMAT ||
    !Array.isArray(ledger.entries) ||
    !Array.isArray(ledger.roots)
  )
    throw new LedgerError("BAD_LEDGER", "not a source ledger");
  if (realOrNull(base) !== ledger.base)
    throw new LedgerError("BASE_MISMATCH", "the ledger was captured elsewhere");
  const fresh = await capture({ base, roots: ledger.roots, excluded });
  const before = new Map(ledger.entries.map((e) => [e.path, e]));
  const after = new Map(fresh.entries.map((e) => [e.path, e]));
  const added = [...after.keys()].filter((p) => !before.has(p)).sort();
  const removed = [...before.keys()].filter((p) => !after.has(p)).sort();
  const changed = [...after.keys()]
    .filter((p) => {
      const a = before.get(p);
      const b = after.get(p);
      return a && b && (a.kind !== b.kind || a.size !== b.size || a.sha256 !== b.sha256);
    })
    .sort();
  return { ok: added.length + removed.length + changed.length === 0, added, removed, changed, fresh };
}

/** Serialise a ledger deterministically (stable key order, trailing newline). @param {object} ledger */
export const serialise = (ledger) => `${JSON.stringify(ledger, null, 1)}\n`;
/** @param {string | Buffer} bytes */
export const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Refuse a ledger path under the allowed base (it never writes there) or under an excluded path.
 * @param {string} out @param {string} base
 */
export function checkOut(out, base) {
  if (typeof out !== "string" || !isAbsolute(out))
    throw new LedgerError("BAD_OUT", "the ledger path must be absolute");
  const realBase = realOrNull(base) ?? resolve(base);
  const abs = resolve(out);
  const under = (/** @type {string} */ p) =>
    isInside(p, realBase) || isInside(p, resolve(base)) || isExcluded(p, EXCLUDED_PATHS);
  if (under(abs))
    throw new LedgerError("OUT_UNDER_BASE", "the ledger is never written under the read-only base");
  // The folder must already exist (SEC-F-064-1): nothing is created, so no link on the way can lead a new folder into
  // the base. The check is on the folder's real path; the file itself is opened with O_EXCL ("wx"), which also refuses
  // an existing link in its place.
  const realDir = realOrNull(dirname(abs));
  if (realDir === null) throw new LedgerError("OUT_DIR_MISSING", "the ledger's folder must already exist");
  const real = `${realDir}/${basename(abs)}`;
  if (under(real))
    throw new LedgerError("OUT_UNDER_BASE", "the ledger is never written under the read-only base");
  return real;
}

/** @param {string[]} argv @param {{ base?: string, log?: (s: string) => void }} [env] */
export async function main(argv, env = {}) {
  const base = env.base ?? ALLOWED_BASE;
  const log = env.log ?? ((s) => console.log(s));
  const [mode, ...rest] = argv;
  /** @param {string} flag */
  const take = (flag) => {
    const i = rest.indexOf(flag);
    if (i < 0 || i + 1 >= rest.length) throw new LedgerError("USAGE", `missing ${flag}`);
    const [v] = rest.splice(i, 2).slice(1);
    return /** @type {string} */ (v);
  };
  if (mode === "capture") {
    const out = checkOut(take("--out"), base);
    const ledger = await capture({ base, roots: rest });
    const text = serialise(ledger);
    writeFileSync(out, text, { flag: "wx" });
    log(`captured roots=${ledger.roots.length} files=${ledger.file_count} bytes=${ledger.total_bytes}`);
    log(`ledger sha256=${sha256Of(text)}`);
    return 0;
  }
  if (mode === "verify") {
    const file = take("--ledger");
    const text = readFileSync(file);
    const ledger = JSON.parse(text.toString("utf8"));
    const r = await verify({ base, ledger });
    log(`ledger sha256=${sha256Of(text)} files=${ledger.file_count} now=${r.fresh.file_count}`);
    log(`added=${r.added.length} removed=${r.removed.length} changed=${r.changed.length}`);
    for (const [label, list] of /** @type {const} */ ([
      ["ADDED", r.added],
      ["REMOVED", r.removed],
      ["CHANGED", r.changed],
    ]))
      for (const p of list) log(`${label} ${p}`);
    log(r.ok ? "VERIFY PASS" : "VERIFY FAIL");
    return r.ok ? 0 : 1;
  }
  throw new LedgerError("USAGE", "usage: capture --out <ledger> <root…> | verify --ledger <ledger>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof LedgerError ? `${e.code}: ${e.message}` : "unexpected error");
      process.exit(2);
    },
  );
}
