// db:hosted-bundle (scripts/db/hosted-bundle.mjs): the reviewed SQL text for one hosted migration. It connects
// nowhere; these tests check its structure. tests/integration/hosted-sim.spec.ts executes it against a Supabase-like
// cluster (guards, dry run, drift).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildHostedBundle,
  HostedBundleError,
  md5Hex,
  TEXT_GUARD_MARKER,
  textGuard,
} from "@/scripts/db/hosted-bundle.mjs";
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

/**
 * What the server's guard does (plan §5.7): md5(split_part(current_query(), marker, 1)) against the hash embedded in
 * the guard. Returns true when the text passes. tests/integration/hosted-sim.spec.ts runs the same check in PostgreSQL.
 */
function guardPasses(received: string): boolean {
  const embedded = /is distinct from '([0-9a-f]{32})' then/.exec(
    received.slice(received.indexOf(TEXT_GUARD_MARKER)),
  );
  if (!embedded) throw new Error("no text guard in the text");
  return md5Hex(received.split(TEXT_GUARD_MARKER)[0]!) === embedded[1];
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
    const history = lines.indexOf(
      "insert into cdf_notifications_v13.schema_migrations (version, name, checksum_sha256, runner)",
    );
    expect(lines.slice(history - 1, history + 3)).toEqual([
      "set local role cdf_v13_owner;",
      "insert into cdf_notifications_v13.schema_migrations (version, name, checksum_sha256, runner)",
      `values ('0000', 'bootstrap', '${bootstrap.checksum}', 'hosted');`,
      "reset role;",
    ]);
    expect(lines.at(-1)).toBe("commit;");
  });

  it("dry run ends in ROLLBACK and never commits", () => {
    const dry = buildHostedBundle({ version: "0000", dryRun: true });
    expect(dry.trimEnd().endsWith("rollback;")).toBe(true);
    expect(frame(dry)).not.toContain("commit;");
  });

  it("dry run and apply differ only in the final ROLLBACK/COMMIT, so they carry the same guard hash", () => {
    const dry = buildHostedBundle({ version: "0000", dryRun: true });
    expect(dry.endsWith("\nrollback;\n")).toBe(true);
    expect(bundle.endsWith("\ncommit;\n")).toBe(true);
    expect(dry.slice(0, -"rollback;\n".length)).toBe(bundle.slice(0, -"commit;\n".length));
    expect(dry.split("\n").filter((line, k) => line !== bundle.split("\n")[k])).toEqual(["rollback;"]);
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

describe("text guard (plan §5.7)", () => {
  const bundle = buildHostedBundle({ version: "0000" });
  const [before] = bundle.split(TEXT_GUARD_MARKER) as [string];

  it("sits after the history row, immediately before the final statement, and hashes every byte before it", () => {
    expect(bundle.split(TEXT_GUARD_MARKER)).toHaveLength(3); // the marker line, then the split_part argument
    expect(before.endsWith("reset role;\n\n")).toBe(true);
    expect(bundle.slice(before.length)).toBe(`${TEXT_GUARD_MARKER}
do $v13_text_guard$
begin
  if pg_catalog.md5(pg_catalog.split_part(pg_catalog.current_query(), '${TEXT_GUARD_MARKER}', 1))
     is distinct from '${md5Hex(before)}' then
    raise exception 'V13 text guard: the text received differs from the repository text' using errcode = 'P0001';
  end if;
end
$v13_text_guard$;

commit;
`);
    expect(md5Hex(before)).toMatch(/^[0-9a-f]{32}$/);
    // md5 is over UTF-8 bytes, as PostgreSQL computes md5(text) in a UTF8 database; the bundle has non-ASCII text.
    expect([...before].some((c) => c.codePointAt(0)! > 0x7f)).toBe(true);
  });

  it("the unchanged text passes, including with a trailer appended after the final statement", () => {
    expect(guardPasses(bundle)).toBe(true);
    expect(guardPasses(buildHostedBundle({ version: "0000", dryRun: true }))).toBe(true);
    expect(guardPasses(`${bundle}-- connector trailer\n`)).toBe(true);
  });

  const lines = before.split("\n");
  const comment = lines.findIndex((line) => line.startsWith("-- Classification"));
  const tampered: [string, string][] = [
    ["a changed byte", before.replace("SYNTHETIC-DATA", "SYNTHETIC-DATB")],
    ["a changed string literal", before.replace("lock_timeout = '5s'", "lock_timeout = '6s'")],
    ["a trailing space", before.replace("begin;\n", "begin; \n")],
    ["a dropped line", [...lines.slice(0, comment), ...lines.slice(comment + 1)].join("\n")],
    ["an added blank line", before.replace("begin;\n", "begin;\n\n")],
    ["CRLF line endings", before.replaceAll("\n", "\r\n")],
  ];
  it.each(tampered)("%s before the marker raises the guard", (_label, changed) => {
    expect(changed).not.toBe(before);
    expect(guardPasses(`${changed}${bundle.slice(before.length)}`)).toBe(false);
  });

  it("refuses a migration or body that already contains the marker, and a body without a final newline", () => {
    const d = twoMigrations(`${FIXTURE_0001}${TEXT_GUARD_MARKER}\n`);
    expect(() => buildHostedBundle({ version: "0001", dir: d })).toThrow(/contains the text-guard marker/);
    expect(() => textGuard(`select 1;\n${TEXT_GUARD_MARKER}\n`, "commit;")).toThrow(HostedBundleError);
    expect(() => textGuard("select 1;", "commit;")).toThrow(HostedBundleError);
  });

  it("guards any text the same way (for the seed texts sent in the same frame)", () => {
    const guarded = textGuard("begin;\nselect 1;\n", "rollback;");
    expect(guarded.startsWith(`begin;\nselect 1;\n${TEXT_GUARD_MARKER}\n`)).toBe(true);
    expect(guarded).toContain(`'${md5Hex("begin;\nselect 1;\n")}'`);
    expect(guarded.endsWith("\nrollback;\n")).toBe(true);
    expect(guardPasses(guarded)).toBe(true);
    expect(guardPasses(guarded.replace("select 1;", "select 2;"))).toBe(false);
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
