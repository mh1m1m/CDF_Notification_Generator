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
  buildHostedSeedBundle,
  GUARD_TAG,
  HostedBundleError,
  md5Hex,
  textGuard,
} from "@/scripts/db/hosted-bundle.mjs";
import { readFileSync } from "node:fs";
import {
  MIGRATION_LOCK_SQL,
  MIGRATIONS_DIR,
  ROOT,
  readMigrations,
  SEED_DIR,
  sha256,
} from "@/scripts/db/lib/migrations.mjs";

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

const CLOSING = `${GUARD_TAG};`;

/** The text after the guard block, as generated. */
const afterGuard = (text: string) => text.slice(text.indexOf(CLOSING) + CLOSING.length);

/**
 * What the server's guard does (plan §5.7), step for step, with the values embedded in the guard: (1) the text starts
 * with the guard and its closing tag occurs once; (2) md5 of the next N characters; (3) then the final statement and a
 * newline; (4) then only whitespace and line comments. Returns true when the text passes.
 * tests/integration/hosted-sim.spec.ts runs the guard itself in PostgreSQL.
 */
function guardPasses(received: string): boolean {
  const n = /md5\(pg_catalog\.left\(after_guard, (\d+)\)\) is distinct from '([0-9a-f]{32})'/.exec(received);
  const final = /is distinct from '(commit;|rollback;)' \|\| pg_catalog\.chr\(10\)/.exec(received);
  if (!n || !final) throw new Error("no text guard in the text");
  const first = received.indexOf(CLOSING);
  if (!received.startsWith(`do ${GUARD_TAG}`) || first === -1) return false;
  const after = [...received.slice(first + CLOSING.length)];
  if (after.join("").includes(GUARD_TAG)) return false;
  const length = Number(n[1]);
  if (md5Hex(after.slice(0, length).join("")) !== n[2]) return false;
  const finalPart = after.slice(length).join("");
  const expected = `${final[1]}\n`;
  return finalPart.startsWith(expected) && /^(\s|--[^\n]*)*$/.test(finalPart.slice(expected.length));
}

/** Statements outside the verbatim file section, in order (comments dropped). */
function frame(bundle: string): string[] {
  const [before, rest] = afterGuard(bundle).split(/^-- ---- .* \(verbatim\) ----$/m) as [string, string];
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

  it("dry run and apply differ only in the final statement and the guard's expected one; same guard hash", () => {
    const dry = buildHostedBundle({ version: "0000", dryRun: true });
    expect(dry.endsWith("\nrollback;\n")).toBe(true);
    expect(bundle.endsWith("\ncommit;\n")).toBe(true);
    expect(afterGuard(dry).slice(0, -"rollback;\n".length)).toBe(
      afterGuard(bundle).slice(0, -"commit;\n".length),
    );
    const applyLines = bundle.split("\n");
    const differing = dry
      .split("\n")
      .map((line, k) => [line, applyLines[k]] as const)
      .filter(([d, a]) => d !== a);
    expect(differing).toEqual([
      [
        "  if pg_catalog.left(final_part, 10) is distinct from 'rollback;' || pg_catalog.chr(10)",
        "  if pg_catalog.left(final_part, 8) is distinct from 'commit;' || pg_catalog.chr(10)",
      ],
      [
        "     or pg_catalog.substr(final_part, 11) !~ '^(\\s|--[^\\n]*)*$' then",
        "     or pg_catalog.substr(final_part, 9) !~ '^(\\s|--[^\\n]*)*$' then",
      ],
      ["rollback;", "commit;"],
    ]);
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
  const dryRun = buildHostedBundle({ version: "0000", dryRun: true });
  const guard = bundle.slice(0, bundle.indexOf(CLOSING) + CLOSING.length);
  const body = afterGuard(bundle).slice(0, -"commit;\n".length);

  it("is the first statement, before begin;, and hashes the whole generated text after it", () => {
    expect(bundle.startsWith(`do ${GUARD_TAG}\n`)).toBe(true);
    expect(body.startsWith("\n-- V13 hosted migration bundle")).toBe(true);
    expect(body.indexOf("\nbegin;\n")).toBeGreaterThan(0);
    expect(body.endsWith("reset role;\n\n")).toBe(true);
    expect(guard).toBe(`do ${GUARD_TAG}
declare
  received text := pg_catalog.current_query();
  tag text := '$v13_text' || '_guard$';
  after_guard text;
  final_part text;
begin
  -- V13 text guard (plan §5.7). It runs first: nothing in this text has run yet when it checks the text.
  -- 1. Nothing was put in front of this block, and its closing tag occurs exactly once.
  after_guard := pg_catalog.substr(received, pg_catalog.strpos(received, tag || ';') + pg_catalog.length(tag) + 1);
  if pg_catalog.left(received, pg_catalog.length('do ' || tag)) is distinct from 'do ' || tag
     or pg_catalog.strpos(received, tag || ';') = 0
     or pg_catalog.strpos(after_guard, tag) <> 0 then
    raise exception 'V13 text guard: the text received does not start with the guard' using errcode = 'P0001';
  end if;
  -- 2. After the closing tag: the repository text, byte for byte.
  if pg_catalog.md5(pg_catalog.left(after_guard, ${[...body].length})) is distinct from '${md5Hex(body)}' then
    raise exception 'V13 text guard: the text received differs from the repository text' using errcode = 'P0001';
  end if;
  -- 3. and 4. Then exactly the final statement, and nothing that can execute.
  final_part := pg_catalog.substr(after_guard, ${[...body].length + 1});
  if pg_catalog.left(final_part, 8) is distinct from 'commit;' || pg_catalog.chr(10)
     or pg_catalog.substr(final_part, 9) !~ '^(\\s|--[^\\n]*)*$' then
    raise exception 'V13 text guard: the text after the repository text is not the expected final statement'
      using errcode = 'P0001';
  end if;
end
${CLOSING}`);
    // The closing tag occurs once: the block cannot contain it, so the guard assembles it from two literals.
    expect(bundle.split(GUARD_TAG)).toHaveLength(3); // the opening tag and the closing tag
    // md5 is over UTF-8 bytes and the length in characters, as PostgreSQL computes them in a UTF8 database; the
    // bundle has non-ASCII text, so the two lengths differ.
    expect([...body].length).toBeLessThan(Buffer.byteLength(body, "utf8"));
  });

  it("the unchanged texts pass, including with whitespace and line-comment trailers", () => {
    expect(guardPasses(bundle)).toBe(true);
    expect(guardPasses(dryRun)).toBe(true);
    expect(guardPasses(`${bundle}-- connector trailer\n`)).toBe(true);
    expect(guardPasses(`${bundle}  \n\t\n-- trailer one\n  -- trailer two`)).toBe(true);
  });

  const lines = bundle.split("\n");
  const comment = lines.findIndex((line) => line.startsWith("-- Classification"));
  const tampered: [string, string][] = [
    ["a changed byte", bundle.replace("SYNTHETIC-DATA", "SYNTHETIC-DATB")],
    ["a changed string literal", bundle.replace("lock_timeout = '5s'", "lock_timeout = '6s'")],
    ["a trailing space", bundle.replace("begin;\n", "begin; \n")],
    ["a dropped line", [...lines.slice(0, comment), ...lines.slice(comment + 1)].join("\n")],
    ["an added blank line", bundle.replace("begin;\n", "begin;\n\n")],
    ["CRLF line endings", bundle.replaceAll("\n", "\r\n")],
    ["a statement put in front of the guard", `commit;\n${bundle}`],
    ["a comment put in front of the guard", `-- note\n${bundle}`],
    ["a statement between the guard and the text", bundle.replace(`${CLOSING}\n`, `${CLOSING}\ncommit;\n`)],
    [
      "a dry run with commit; inserted after the guard",
      dryRun.replace(`${CLOSING}\n`, `${CLOSING}\ncommit;\n`),
    ],
    ["a statement inserted mid-text", bundle.replace("begin;\n", "begin;\nselect 1;\n")],
    ["a second closing tag followed by a statement", `${bundle}${CLOSING}\nselect 1;\n`],
    ["a second closing tag in a trailer comment", `${bundle}-- ${CLOSING}\n`],
    ["a dry run whose rollback; was edited to commit;", dryRun.replace(/rollback;\n$/, "commit;\n")],
    ["an apply whose commit; was edited to rollback;", bundle.replace(/commit;\n$/, "rollback;\n")],
    ["a statement appended after the final line", `${bundle}select 1;\n`],
    ["a statement appended on the final line", bundle.replace(/commit;\n$/, "commit; select 1;\n")],
    ["a statement after a comment trailer", `${bundle}-- trailer\nselect 1;\n`],
    ["a block comment appended", `${bundle}/* trailer */\n`],
    ["the final statement missing", bundle.replace(/commit;\n$/, "")],
    ["the final newline missing", bundle.replace(/commit;\n$/, "commit;")],
    ["a blank line removed before the final statement", bundle.replace(/\n\ncommit;\n$/, "\ncommit;\n")],
  ];
  it.each(tampered)("%s raises the guard", (_label, changed) => {
    expect(changed).not.toBe(bundle);
    expect(guardPasses(changed)).toBe(false);
  });

  it("refuses a migration or body that contains the guard tag, a body without a final newline, another final", () => {
    const d = twoMigrations(`${FIXTURE_0001}-- ${GUARD_TAG}\n`);
    expect(() => buildHostedBundle({ version: "0001", dir: d })).toThrow(/contains the text-guard tag/);
    expect(() => textGuard(`select ${GUARD_TAG}x${GUARD_TAG};\n`, "commit;")).toThrow(/guard tag/);
    expect(() => textGuard("select 1;", "commit;")).toThrow(HostedBundleError);
    expect(() => textGuard("select 1;\n", "end;" as "commit;")).toThrow(/commit; or rollback;/);
  });

  it("guards any text the same way (for the seed texts sent in the same frame)", () => {
    const guarded = textGuard("begin;\nselect 1;\n", "rollback;");
    expect(guarded.startsWith(`do ${GUARD_TAG}\n`)).toBe(true);
    expect(guarded.endsWith(`${CLOSING}\nbegin;\nselect 1;\nrollback;\n`)).toBe(true);
    expect(guarded).toContain(`'${md5Hex("\nbegin;\nselect 1;\n")}'`);
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

describe("seed bundle (--seed, V13-DB-016)", () => {
  const seedText = (file: string) => readFileSync(join(SEED_DIR, file), "utf8");

  it("guards the seed file verbatim inside the migration frame, after a whole-history guard", () => {
    const migrations = readMigrations();
    const latest = migrations[migrations.length - 1]!;
    for (const [version, file] of [
      ["0001", "0001_m1_synthetic.sql"],
      ["0002", "0002_m1_cases.sql"],
    ] as const) {
      const bundle = buildHostedSeedBundle({ version });
      expect(bundle.startsWith(`do ${GUARD_TAG}\n`)).toBe(true);
      expect(bundle.endsWith("\ncommit;\n")).toBe(true);
      expect(guardPasses(bundle)).toBe(true);
      const body = afterGuard(bundle);
      expect(body).toContain(`-- Seed:      database/seed/${file}\n`);
      expect(body).toContain(`-- sha256:    ${sha256(readFileSync(join(SEED_DIR, file)))}\n`);
      expect(body).toContain(
        `\n-- ---- ${file} (verbatim) ----\n${seedText(file)}-- ---- end of ${file} ----\n`,
      );
      expect(frame(bundle)).toEqual([
        "begin;",
        "set local lock_timeout = '5s';",
        "set local search_path = '';",
        `${MIGRATION_LOCK_SQL};`,
        "do $v13_bundle_guard$",
        "begin",
        "if not exists (",
        "select 1",
        "from pg_catalog.pg_class c",
        "join pg_catalog.pg_namespace n on n.oid = c.relnamespace",
        "where n.nspname = 'cdf_notifications_v13' and c.relname = 'schema_migrations' and c.relkind = 'r'",
        ") then",
        `raise exception 'V13 seed ${version} refused: the V13 bootstrap (0000) is not applied' using errcode = 'P0001';`,
        "end if;",
        "end",
        "$v13_bundle_guard$;",
        "set local role cdf_v13_owner;",
        "do $v13_bundle_history_guard$",
        "begin",
        "if exists (",
        "select 1",
        "from (values",
        ...migrations.map(
          (m, k) => `('${m.version}', '${m.name}', '${m.checksum}')${k < migrations.length - 1 ? "," : ""}`,
        ),
        ") as expected (version, name, checksum_sha256)",
        "full join cdf_notifications_v13.schema_migrations as recorded on recorded.version = expected.version",
        "where recorded.version is null",
        "or expected.version is null",
        "or recorded.name is distinct from expected.name",
        "or recorded.checksum_sha256 is distinct from expected.checksum_sha256",
        ") then",
        `raise exception 'V13 seed ${version} refused: the recorded history is not the repository''s 0000–${latest.version} (name or sha256)'`,
        "using errcode = 'P0001';",
        "end if;",
        "end",
        "$v13_bundle_history_guard$;",
        "reset role;",
        "commit;",
      ]);
      // No history row: seeds are idempotent and not versioned in schema_migrations.
      expect(body).not.toContain("insert into cdf_notifications_v13.schema_migrations");
    }
  });

  it("dry run and apply differ only in the final statement and carry the same hash", () => {
    const apply = buildHostedSeedBundle({ version: "0002" });
    const dry = buildHostedSeedBundle({ version: "0002", dryRun: true });
    expect(dry.endsWith("\nrollback;\n")).toBe(true);
    expect(guardPasses(dry)).toBe(true);
    const hash = (t: string) => /is distinct from '([0-9a-f]{32})'/.exec(t)?.[1];
    expect(hash(dry)).toBe(hash(apply));
    expect(afterGuard(dry).replace(/rollback;\n$/, "commit;\n")).toBe(afterGuard(apply));
    expect(buildHostedSeedBundle({ version: "0002" })).toBe(apply);
  });

  it("refuses a missing or ambiguous seed, a bad version, and a seed that carries the guard tag", () => {
    expect(() => buildHostedSeedBundle({ version: "0099" })).toThrow(/no seed with version 0099/);
    expect(() => buildHostedSeedBundle({ version: "1" })).toThrow(/four digits/);
    dir = mkdtempSync(join(tmpdir(), "v13-seed-"));
    writeFileSync(join(dir, "0001_a.sql"), "select 1;\n");
    writeFileSync(join(dir, "0001_b.sql"), "select 1;\n");
    writeFileSync(join(dir, "0002_tagged.sql"), `select '${GUARD_TAG}';\n`);
    expect(() => buildHostedSeedBundle({ version: "0001", seedDir: dir })).toThrow(/more than one seed/);
    expect(() => buildHostedSeedBundle({ version: "0002", seedDir: dir })).toThrow(HostedBundleError);
    expect(() => buildHostedSeedBundle({ version: "0002", seedDir: dir })).toThrow(/guard tag/);
  });

  it("command line: --seed prints the seed bundle; --seed-dir without a value is a usage error", () => {
    const ok = spawnSync(process.execPath, [SCRIPT, "--seed", "0001", "--dry-run"], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe(buildHostedSeedBundle({ version: "0001", dryRun: true }));
    expect(
      spawnSync(process.execPath, [SCRIPT, "--seed", "0001", "--seed-dir"], { encoding: "utf8" }).status,
    ).toBe(2);
    const missing = spawnSync(process.execPath, [SCRIPT, "--seed", "0099"], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
  });
});
