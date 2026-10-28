// db:hosted-bundle (scripts/db/hosted-bundle.mjs): the reviewed SQL text for one hosted migration. It connects
// nowhere; these tests check its structure. tests/integration/hosted-sim.spec.ts executes it against a Supabase-like
// cluster (guards, dry run, drift).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildHostedBundle, HostedBundleError } from "@/scripts/db/hosted-bundle.mjs";
import { MIGRATION_LOCK_SQL, MIGRATIONS_DIR, ROOT, readMigrations } from "@/scripts/db/lib/migrations.mjs";

const SCRIPT = join(ROOT, "scripts", "db", "hosted-bundle.mjs");
const FIXTURE_0001 = `set local role cdf_v13_owner;
comment on schema cdf_notifications_v13 is 'Synthetic fixture migration.';
reset role;
`;

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** The repository bootstrap plus a fixture 0001. */
function twoMigrations(fixture = FIXTURE_0001): string {
  dir = mkdtempSync(join(tmpdir(), "v13-bundle-"));
  copyFileSync(join(MIGRATIONS_DIR, "0000_bootstrap.sql"), join(dir, "0000_bootstrap.sql"));
  writeFileSync(join(dir, "0001_fixture.sql"), fixture);
  return dir;
}

/** Statements outside the verbatim file section, in order (comments dropped). */
function frame(bundle: string): string[] {
  const [before, rest] = bundle.split(/^-- ---- .* \(verbatim\) ----$/m) as [string, string];
  const after = rest.split(/^-- ---- end of .* ----$/m)[1] ?? "";
  return [before, after].flatMap((part) =>
    part
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("--"))
      .map((line) => line.trim()),
  );
}

describe("bundle for the bootstrap (0000)", () => {
  const bootstrap = readMigrations()[0]!;
  const bundle = buildHostedBundle({ version: "0000" });

  it("wraps the verbatim file in one transaction with the lock, guard and history row", () => {
    expect(bundle).toContain(`-- sha256:    ${bootstrap.checksum}`);
    expect(bundle).toContain(bootstrap.sql);
    const lines = frame(bundle);
    expect(lines.slice(0, 4)).toEqual([
      "begin;",
      "set local lock_timeout = '5s';",
      "set local search_path = '';",
      `${MIGRATION_LOCK_SQL};`,
    ]);
    expect(bundle).toMatch(/V13 bundle 0000 refused: the V13 migration history already exists/);
    expect(lines.slice(-5)).toEqual([
      "set local role cdf_v13_owner;",
      "insert into cdf_notifications_v13.schema_migrations (version, name, checksum_sha256, runner)",
      `values ('0000', 'bootstrap', '${bootstrap.checksum}', 'hosted');`,
      "reset role;",
      "commit;",
    ]);
  });

  it("dry run ends in ROLLBACK and never commits", () => {
    const dry = buildHostedBundle({ version: "0000", dryRun: true });
    expect(dry.trimEnd().endsWith("rollback;")).toBe(true);
    expect(frame(dry)).not.toContain("commit;");
    expect(dry.split("\n")[0]).toContain("DRY RUN");
  });

  it("is deterministic and carries no credentials or connection details", () => {
    expect(buildHostedBundle({ version: "0000" })).toBe(bundle);
    expect(bundle).not.toMatch(/postgres(ql)?:\/\//i);
    expect(bundle).not.toMatch(/password\s+'/i);
    expect(bundle).toContain("SYNTHETIC-DATA REFERENCE IMPLEMENTATION");
  });
});

describe("bundle for a later migration", () => {
  it("guards: bootstrap present, version not applied, predecessor latest, recorded history matches", () => {
    const d = twoMigrations();
    const [bootstrap, fixture] = readMigrations(d) as [
      ReturnType<typeof readMigrations>[number],
      ReturnType<typeof readMigrations>[number],
    ];
    const bundle = buildHostedBundle({ version: "0001", dir: d });
    expect(bundle).toContain("refused: the V13 bootstrap (0000) is not applied");
    expect(bundle).toContain("where version = '0001'");
    expect(bundle).toContain("if latest is distinct from '0000' then");
    expect(bundle).toContain(`('0000', 'bootstrap', '${bootstrap.checksum}')`);
    expect(bundle).toContain(`values ('0001', 'fixture', '${fixture.checksum}', 'hosted');`);
    // History is read and written as its owner; the administrator holds no privilege on it.
    const guardStart = bundle.indexOf("-- Guards 2–4");
    expect(bundle.indexOf("set local role cdf_v13_owner;", guardStart)).toBeGreaterThan(guardStart);
    expect(bundle.indexOf("reset role;", guardStart)).toBeLessThan(bundle.indexOf("(verbatim) ----"));
    expect(bundle).toContain(FIXTURE_0001);
  });

  it("refuses to build when db:lint reports findings, an unknown version or a malformed version", () => {
    expect(() =>
      buildHostedBundle({ version: "0001", dir: twoMigrations("truncate cdf_notifications_v13.t;\n") }),
    ).toThrow(/db:lint reports \d+ finding\(s\); no bundle is produced/);
    expect(() => buildHostedBundle({ version: "0099" })).toThrow(HostedBundleError);
    for (const version of ["1", "00001", "abcd", "0000; drop"]) {
      expect(() => buildHostedBundle({ version })).toThrow(HostedBundleError);
    }
  });
});

describe("command line", () => {
  it("prints the bundle on stdout and exits 0; usage errors exit 2", () => {
    const ok = spawnSync(process.execPath, [SCRIPT, "0000", "--dry-run"], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe(buildHostedBundle({ version: "0000", dryRun: true }));

    for (const args of [[], ["0000", "0001"], ["0000", "--commit"]]) {
      expect(
        spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" }).status,
        args.join(" "),
      ).toBe(2);
    }
    const missing = spawnSync(process.execPath, [SCRIPT, "0099"], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
  });
});
