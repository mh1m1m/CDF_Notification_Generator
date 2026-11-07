#!/usr/bin/env node
// @ts-check
// The visual job's mode (V13-ARCH-015, SEC's INFO 1 on #156; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §5, §8; ruling D2).
//
// ci.yml's `visual` job compares the committed baselines under tests/visual/__screenshots__/, and makes candidates
// (scripts/ci/visual-candidates.mjs) only while no baseline has ever been committed. Once baselines are committed,
// deleting every one of them must fail the job, never turn it into a passing candidate run. This command decides from
// git alone, so the decision does not rest on a file the same change could delete:
//   compare     the checked-out commit holds at least one baseline PNG;
//   candidates  it holds none, and neither does its first parent;
//   refused     it holds none, and its first parent holds some (every baseline deleted), or the first parent cannot be
//               read (a root commit, or a shallow checkout without it): exit 1, so the job fails.
// In a pull_request run the checked-out commit is GitHub's merge commit, whose first parent is the base branch; in a
// push run it is the pushed commit, whose first parent is the branch's previous commit. The job checks out with
// fetch-depth 2 so that this parent is present.
//
//   node scripts/ci/visual-mode.mjs <screenshots dir, relative to the repository root>
//     prints "compare" or "candidates" on stdout (exit 0); "refused" exits 1 with the reason on stderr; usage exits 2.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** @typedef {"compare" | "candidates" | "refused"} VisualMode */

/**
 * The mode for a commit holding `headPngs` baseline PNGs whose first parent holds `parentPngs` (null: the parent cannot
 * be read).
 * @param {{ headPngs: number, parentPngs: number | null }} counts
 * @returns {{ mode: VisualMode, reason: string }}
 */
export function decideVisualMode({ headPngs, parentPngs }) {
  if (headPngs > 0) {
    return { mode: "compare", reason: `${headPngs} committed baselines` };
  }
  if (parentPngs === null) {
    return {
      mode: "refused",
      reason:
        "no baseline is committed and the first parent commit cannot be read, so it is unknown whether baselines were deleted; candidate mode is refused",
    };
  }
  if (parentPngs > 0) {
    return {
      mode: "refused",
      reason: `the first parent commit holds ${parentPngs} baselines and this commit holds none: deleting every baseline fails the job (V13-ARCH-015); candidate mode is refused`,
    };
  }
  return { mode: "candidates", reason: "no baseline has been committed, here or in the first parent commit" };
}

/**
 * The PNG files git records under `dir` in commit `rev`; null when `rev` is not a commit this clone holds.
 * @param {string} rev
 * @param {string} dir
 * @param {string} cwd
 * @returns {number | null}
 */
export function countCommittedPngs(rev, dir, cwd) {
  const commit = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], {
    cwd,
    encoding: "utf8",
  });
  if (commit.status !== 0) return null;
  const tree = spawnSync("git", ["ls-tree", "-r", "-z", "--name-only", commit.stdout.trim(), "--", dir], {
    cwd,
    encoding: "utf8",
  });
  if (tree.status !== 0) return null;
  return tree.stdout.split("\0").filter((path) => path.toLowerCase().endsWith(".png")).length;
}

/**
 * @param {string[]} argv
 * @param {string} cwd
 */
function main(argv, cwd) {
  const [dir, ...rest] = argv;
  if (!dir || rest.length > 0) {
    console.error(
      "usage: node scripts/ci/visual-mode.mjs <screenshots dir, relative to the repository root>",
    );
    return 2;
  }
  const headPngs = countCommittedPngs("HEAD", dir, cwd);
  if (headPngs === null) {
    console.error("visual mode: refused: HEAD is not a commit in this repository");
    return 1;
  }
  const parentPngs = headPngs > 0 ? null : countCommittedPngs("HEAD^1", dir, cwd);
  const { mode, reason } = decideVisualMode({ headPngs, parentPngs });
  if (mode === "refused") {
    console.error(`visual mode: refused: ${reason}`);
    return 1;
  }
  console.error(`visual mode: ${mode}: ${reason}`);
  console.log(mode);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2), process.cwd());
}
