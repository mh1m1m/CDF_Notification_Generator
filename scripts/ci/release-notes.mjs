#!/usr/bin/env node
// @ts-check
// Version history and release notes (REQ-CICD-006, V13-ARCH-012). CHANGELOG.md holds one section per release, newest
// first, under one `## [Unreleased]` section:
//
//   ## [Unreleased]
//   ## [0.2.0] - 2026-12-01
//   ## [0.1.0] - 2026-11-15
//
//   node scripts/ci/release-notes.mjs --check
//     Part of `pnpm lint`. The changelog parses: `## [Unreleased]` comes first, every other level-2 heading is a release
//     heading with a SemVer version and a real date, versions are unique and in descending order, and no release
//     section is empty. package.json's version is valid SemVer.
//   node scripts/ci/release-notes.mjs --release <notes-file>
//     Used by .github/workflows/release.yml after the owner's milestone merge into `main`. It also fails unless
//     package.json's version has a section and that section is the newest release. It writes the section's text to
//     <notes-file> and prints `version=<x.y.z>` for $GITHUB_OUTPUT.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/** MAJOR.MINOR.PATCH with an optional pre-release; no leading zeros, no build metadata (SemVer 2.0.0 §2, §9). */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;
const UNRELEASED = /^## \[Unreleased\]\s*$/;
const RELEASE = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\s*$/;

/**
 * @typedef {{ version: string, date: string, line: number, body: string }} Release
 * @typedef {{ releases: Release[], errors: string[] }} Changelog
 */

/** @param {string} version */
export function isSemver(version) {
  return SEMVER.test(version);
}

/**
 * SemVer precedence (§11): negative when a < b, positive when a > b, 0 when equal. Both must be valid.
 * @param {string} a
 * @param {string} b
 */
export function compareSemver(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`not SemVer: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  const ra = pa[4];
  const rb = pb[4];
  if (ra === undefined || rb === undefined) return ra === rb ? 0 : ra === undefined ? 1 : -1;
  const ia = ra.split(".");
  const ib = rb.split(".");
  for (let i = 0; i < Math.min(ia.length, ib.length); i += 1) {
    const x = /** @type {string} */ (ia[i]);
    const y = /** @type {string} */ (ib[i]);
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return ia.length - ib.length;
}

/** @param {string} date YYYY-MM-DD */
function isRealDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/**
 * Parses CHANGELOG.md and reports every structural error (line numbers are 1-based).
 * @param {string} text
 * @returns {Changelog}
 */
export function parseChangelog(text) {
  const lines = text.split(/\r?\n/);
  /** @type {string[]} */
  const errors = [];
  /** @type {Release[]} */
  const releases = [];
  /** @type {{ kind: "unreleased" } | { kind: "release", release: Release } | null} */
  let current = null;
  /** @type {string[]} */
  let body = [];
  let unreleasedSeen = false;
  let levelTwoSeen = false;

  const close = () => {
    if (current?.kind === "release") {
      current.release.body = body.join("\n").trim();
      if (current.release.body === "")
        errors.push(`line ${current.release.line}: release ${current.release.version} is empty`);
    }
    body = [];
  };

  lines.forEach((line, index) => {
    const n = index + 1;
    if (!line.startsWith("## ")) {
      if (current) body.push(line);
      return;
    }
    close();
    if (UNRELEASED.test(line)) {
      if (unreleasedSeen) errors.push(`line ${n}: a second [Unreleased] section`);
      else if (levelTwoSeen) errors.push(`line ${n}: [Unreleased] must be the first section`);
      unreleasedSeen = true;
      levelTwoSeen = true;
      current = { kind: "unreleased" };
      return;
    }
    if (!levelTwoSeen) errors.push(`line ${n}: [Unreleased] must be the first section`);
    levelTwoSeen = true;
    const m = RELEASE.exec(line);
    if (!m) {
      errors.push(`line ${n}: not a release heading ("## [x.y.z] - YYYY-MM-DD"): ${line}`);
      current = null;
      return;
    }
    const version = /** @type {string} */ (m[1]);
    const date = /** @type {string} */ (m[2]);
    if (!isSemver(version)) errors.push(`line ${n}: not a SemVer version: ${version}`);
    if (!isRealDate(date)) errors.push(`line ${n}: not a calendar date: ${date}`);
    const release = { version, date, line: n, body: "" };
    const previous = releases.at(-1);
    if (releases.some((r) => r.version === version))
      errors.push(`line ${n}: release ${version} appears twice`);
    else if (
      previous &&
      isSemver(previous.version) &&
      isSemver(version) &&
      compareSemver(version, previous.version) > 0
    )
      errors.push(`line ${n}: release ${version} is newer than ${previous.version} above it (newest first)`);
    releases.push(release);
    current = { kind: "release", release };
  });
  close();
  if (!unreleasedSeen) errors.push("no [Unreleased] section");
  return { releases, errors };
}

/**
 * The notes of `version`, which must be the changelog's newest release.
 * @param {string} text the changelog
 * @param {string} version package.json's version
 * @returns {{ ok: true, notes: string } | { ok: false, error: string }}
 */
export function releaseNotes(text, version) {
  if (!isSemver(version)) return { ok: false, error: `package.json version is not SemVer: ${version}` };
  const { releases, errors } = parseChangelog(text);
  if (errors.length > 0) return { ok: false, error: errors.join("; ") };
  const newest = releases[0];
  const release = releases.find((r) => r.version === version);
  if (!release)
    return {
      ok: false,
      error: `CHANGELOG.md has no section for ${version}: the milestone PR adds "## [${version}] - YYYY-MM-DD"`,
    };
  if (release !== newest)
    return {
      ok: false,
      error: `${version} is not the newest release in CHANGELOG.md (${newest?.version} is)`,
    };
  return { ok: true, notes: release.body };
}

function main() {
  const [mode, out] = process.argv.slice(2);
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  const version = String(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version ?? "");
  if (mode === "--check") {
    const { releases, errors } = parseChangelog(changelog);
    if (!isSemver(version)) errors.push(`package.json version is not SemVer: ${version}`);
    for (const e of errors) console.error(`CHANGELOG.md: ${e}`);
    if (errors.length > 0) {
      console.error(`✗ release-notes: ${errors.length} problem(s)`);
      process.exit(1);
    }
    console.log(
      `✓ release-notes: CHANGELOG.md has ${releases.length} release(s); package.json is ${version}`,
    );
    return;
  }
  if (mode === "--release" && out) {
    const result = releaseNotes(changelog, version);
    if (!result.ok) {
      console.error(`✗ release-notes: ${result.error}`);
      process.exit(1);
    }
    writeFileSync(out, `${result.notes}\n`);
    console.log(`version=${version}`);
    return;
  }
  console.error("usage: release-notes.mjs --check | --release <notes-file>");
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
