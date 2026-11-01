// REQ-CICD-006 (V13-ARCH-012): CHANGELOG.md's structure, checked in `pnpm lint`, and the notes the release workflow
// publishes when the owner merges a milestone into `main`.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareSemver, isSemver, parseChangelog, releaseNotes } from "@/scripts/ci/release-notes.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const changelog = (...sections: string[]) => ["# Changelog", "", "Preamble.", "", ...sections, ""].join("\n");
const UNRELEASED = "## [Unreleased]\n\nNothing yet.\n";
const R020 = "## [0.2.0] - 2026-12-01\n\n- Second milestone (#200).\n";
const R010 = "## [0.1.0] - 2026-11-15\n\n- First milestone (#121).\n";

describe("isSemver", () => {
  it("accepts MAJOR.MINOR.PATCH with an optional pre-release", () => {
    for (const v of ["0.1.0", "1.2.3", "10.20.30", "1.0.0-rc.1", "1.0.0-alpha", "1.0.0-0.3.7", "1.0.0-x-y.1"])
      expect(isSemver(v), v).toBe(true);
  });

  it("rejects leading zeros, missing parts, a v prefix, build metadata and empty identifiers", () => {
    for (const v of [
      "01.2.3",
      "1.02.3",
      "1.2",
      "v1.2.3",
      "1.2.3+build.1",
      "1.2.3-",
      "1.2.3-01",
      "1.2.3-a..b",
      "",
    ])
      expect(isSemver(v), v).toBe(false);
  });
});

describe("compareSemver", () => {
  it("orders by SemVer precedence (§11)", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
    ];
    ordered.push("1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0", "10.0.0");
    for (let i = 1; i < ordered.length; i += 1) {
      expect(compareSemver(ordered[i - 1]!, ordered[i]!), `${ordered[i - 1]} < ${ordered[i]}`).toBeLessThan(
        0,
      );
      expect(
        compareSemver(ordered[i]!, ordered[i - 1]!),
        `${ordered[i]} > ${ordered[i - 1]}`,
      ).toBeGreaterThan(0);
    }
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });
});

describe("parseChangelog", () => {
  it("reads the releases newest first, with their dates and text", () => {
    const { releases, errors } = parseChangelog(changelog(UNRELEASED, R020, R010));
    expect(errors).toEqual([]);
    expect(releases.map((r) => [r.version, r.date, r.body])).toEqual([
      ["0.2.0", "2026-12-01", "- Second milestone (#200)."],
      ["0.1.0", "2026-11-15", "- First milestone (#121)."],
    ]);
  });

  it("accepts a changelog with no release yet, and CRLF line ends", () => {
    expect(parseChangelog(changelog(UNRELEASED))).toEqual({ releases: [], errors: [] });
    expect(parseChangelog(changelog(UNRELEASED, R010).replace(/\n/g, "\r\n")).errors).toEqual([]);
  });

  it("requires one [Unreleased] section, first", () => {
    expect(parseChangelog(changelog(R010)).errors).toEqual([
      "line 5: [Unreleased] must be the first section",
      "no [Unreleased] section",
    ]);
    expect(parseChangelog(changelog(R010, UNRELEASED)).errors).toContain(
      "line 9: [Unreleased] must be the first section",
    );
    expect(parseChangelog(changelog(UNRELEASED, UNRELEASED)).errors).toContain(
      "line 9: a second [Unreleased] section",
    );
  });

  it("rejects a level-2 heading that is not a release heading", () => {
    for (const heading of ["## 0.1.0 - 2026-11-15", "## [v0.1.0] - 2026-11-15", "## [0.1.0]", "## Notes"]) {
      const { errors } = parseChangelog(changelog(UNRELEASED, `${heading}\n\n- x\n`));
      expect(errors.join("; "), heading).toMatch(/line 9: not a (release heading|SemVer version)/);
    }
  });

  it("rejects a version that is not SemVer and a date that is not on the calendar", () => {
    expect(parseChangelog(changelog(UNRELEASED, "## [0.1] - 2026-11-15\n\n- x\n")).errors).toEqual([
      "line 9: not a SemVer version: 0.1",
    ]);
    expect(parseChangelog(changelog(UNRELEASED, "## [0.1.0] - 2026-13-01\n\n- x\n")).errors).toEqual([
      "line 9: not a calendar date: 2026-13-01",
    ]);
    expect(parseChangelog(changelog(UNRELEASED, "## [0.1.0] - 2026-02-30\n\n- x\n")).errors).toEqual([
      "line 9: not a calendar date: 2026-02-30",
    ]);
  });

  it("rejects a release listed twice, releases out of order and an empty release", () => {
    expect(parseChangelog(changelog(UNRELEASED, R010, R010)).errors).toEqual([
      "line 13: release 0.1.0 appears twice",
    ]);
    expect(parseChangelog(changelog(UNRELEASED, R010, R020)).errors).toEqual([
      "line 13: release 0.2.0 is newer than 0.1.0 above it (newest first)",
    ]);
    expect(parseChangelog(changelog(UNRELEASED, "## [0.2.0] - 2026-12-01\n\n", R010)).errors).toEqual([
      "line 9: release 0.2.0 is empty",
    ]);
  });
});

describe("releaseNotes", () => {
  const text = changelog(UNRELEASED, R020, R010);

  it("returns the newest release's text when it is package.json's version", () => {
    expect(releaseNotes(text, "0.2.0")).toEqual({ ok: true, notes: "- Second milestone (#200)." });
  });

  it("refuses a version with no section, an older release and an invalid version", () => {
    expect(releaseNotes(text, "0.3.0")).toEqual({
      ok: false,
      error: 'CHANGELOG.md has no section for 0.3.0: the milestone PR adds "## [0.3.0] - YYYY-MM-DD"',
    });
    expect(releaseNotes(text, "0.1.0")).toEqual({
      ok: false,
      error: "0.1.0 is not the newest release in CHANGELOG.md (0.2.0 is)",
    });
    expect(releaseNotes(text, "v0.2.0")).toEqual({
      ok: false,
      error: "package.json version is not SemVer: v0.2.0",
    });
  });

  it("refuses a changelog with structural errors", () => {
    expect(releaseNotes(changelog(UNRELEASED, R010, R010), "0.1.0")).toEqual({
      ok: false,
      error: "line 13: release 0.1.0 appears twice",
    });
  });
});

describe("the repository's own CHANGELOG.md and package.json", () => {
  it("pass --check, as `pnpm lint` runs it", () => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/ci/release-notes.mjs"), "--check"], {
      encoding: "utf8",
    });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;
    expect(r.stdout).toContain(`package.json is ${version}`);
  });

  it("--release writes the notes file and prints version= only for a released version", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
    try {
      const r = spawnSync(
        process.execPath,
        [join(ROOT, "scripts/ci/release-notes.mjs"), "--release", join(dir, "n.md")],
        {
          encoding: "utf8",
        },
      );
      const { releases } = parseChangelog(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
      const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;
      if (releases[0]?.version === version) {
        expect(r.status).toBe(0);
        expect(r.stdout).toBe(`version=${version}\n`);
        expect(readFileSync(join(dir, "n.md"), "utf8")).toBe(`${releases[0].body}\n`);
      } else {
        expect(r.status).toBe(1);
        expect(r.stdout).toBe("");
        expect(r.stderr).toContain(`no section for ${version}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown mode", () => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/ci/release-notes.mjs"), "--publish"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });
});
