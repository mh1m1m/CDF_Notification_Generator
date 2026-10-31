// QG-01 source integrity (V13-PROC-010): the ledger script, tested on temporary fixture folders only (CI cannot reach
// /mnt/project-files). SYNTHETIC-DATA REFERENCE IMPLEMENTATION — the fixtures hold short synthetic texts.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_BASE,
  EXCLUDED_PATHS,
  LEDGER_FORMAT,
  LedgerError,
  capture,
  checkOut,
  checkRoots,
  main,
  serialise,
  sha256Of,
  verify,
} from "@/scripts/integrity/source-ledger.mjs";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const code = (c: string) => (e: unknown) =>
  e instanceof LedgerError && (e as LedgerError & { code: string }).code === c;
const FIXED = () => new Date("2026-10-31T21:00:00Z");

let tmp: string; // holds the fixture base and, beside it, an "outside" folder and the ledger folder
let base: string;
let outside: string;
let ledgerDir: string;

/** every path and mtime under a folder, to prove nothing was written there */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = statSync(p, { throwIfNoEntry: false });
      out.push(`${p}|${st ? `${st.size}|${st.mtimeMs}` : "link"}`);
      if (st?.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ledger-"));
  base = join(tmp, "notifications");
  outside = join(tmp, "outside");
  ledgerDir = join(tmp, "integrity");
  mkdirSync(join(base, "generator", "sub"), { recursive: true });
  mkdirSync(join(base, "review"), { recursive: true });
  mkdirSync(outside);
  mkdirSync(ledgerDir);
  writeFileSync(join(base, "generator", "b.txt"), "Witness Gamma");
  writeFileSync(join(base, "generator", "a.txt"), "Employee Alpha");
  writeFileSync(join(base, "generator", "sub", "c.json"), '{"case":"CDF-DEMO-2026-0001"}');
  writeFileSync(join(base, "review", "r.md"), "Investigator Beta");
  writeFileSync(join(base, "REGISTER.csv"), "code\nREQ-01\n");
  writeFileSync(join(outside, "secret.txt"), "never read");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("capture", () => {
  test("SL-01 records path, size and sha256 of every file under the roots, sorted, with totals", async () => {
    const l = await capture({ base, roots: ["review", "generator", "REGISTER.csv"], now: FIXED });
    expect(l.format).toBe(LEDGER_FORMAT);
    expect(l.roots).toEqual(["REGISTER.csv", "generator", "review"]);
    expect(l.entries).toEqual([
      { path: "REGISTER.csv", kind: "file", size: 12, sha256: sha("code\nREQ-01\n") },
      { path: "generator/a.txt", kind: "file", size: 14, sha256: sha("Employee Alpha") },
      { path: "generator/b.txt", kind: "file", size: 13, sha256: sha("Witness Gamma") },
      {
        path: "generator/sub/c.json",
        kind: "file",
        size: 29,
        sha256: sha('{"case":"CDF-DEMO-2026-0001"}'),
      },
      { path: "review/r.md", kind: "file", size: 17, sha256: sha("Investigator Beta") },
    ]);
    expect(l.file_count).toBe(5);
    expect(l.total_bytes).toBe(12 + 14 + 13 + 29 + 17);
    expect(l.captured_at).toBe("2026-10-31T21:00:00.000Z");
  });

  test("SL-02 the same tree gives the same ledger bytes (deterministic) and the root order does not matter", async () => {
    const a = serialise(await capture({ base, roots: ["generator", "review"], now: FIXED }));
    const b = serialise(await capture({ base, roots: ["review", "generator", "review"], now: FIXED }));
    expect(a).toBe(b);
    expect(sha256Of(a)).toBe(sha(a));
  });

  test("SL-03 capture and verify only read: nothing under the base changes", async () => {
    const before = snapshot(base);
    const l = await capture({ base, roots: ["generator", "review", "REGISTER.csv"] });
    await verify({ base, ledger: l });
    expect(snapshot(base)).toEqual(before);
  });

  test("SL-04 a symbolic link is recorded as a link and never followed, even to a file outside the base", async () => {
    symlinkSync(join(outside, "secret.txt"), join(base, "review", "link.txt"));
    symlinkSync(outside, join(base, "review", "linkdir"));
    const l = await capture({ base, roots: ["review"] });
    expect(l.entries.map((e) => [e.path, e.kind, e.sha256])).toEqual([
      ["review/link.txt", "symlink", null],
      ["review/linkdir", "symlink", null],
      ["review/r.md", "file", sha("Investigator Beta")],
    ]);
    expect(JSON.stringify(l)).not.toContain(sha("never read"));
  });

  test("SL-05 a root that is, is inside or contains an excluded path is refused; other roots still capture", async () => {
    const excluded = [join(base, "generator", "sub")];
    await expect(capture({ base, roots: ["generator"], excluded })).rejects.toSatisfy(code("EXCLUDED_ROOT"));
    await expect(capture({ base, roots: ["generator/sub"], excluded })).rejects.toSatisfy(
      code("EXCLUDED_ROOT"),
    );
    const l = await capture({ base, roots: ["review", "generator/a.txt"], excluded });
    expect(l.entries.map((e) => e.path)).toEqual(["generator/a.txt", "review/r.md"]);
    await expect(capture({ base, roots: ["generator/sub/c.json"], excluded })).rejects.toSatisfy(
      code("EXCLUDED_ROOT"),
    );
  });

  test("SL-06 the real personal-data upload is excluded by default and refused before anything is touched", () => {
    expect(EXCLUDED_PATHS).toContain(
      "/mnt/project-files/uploads/hearth/be02c96c-1d82-4401-89e9-9cd0406d23ec",
    );
    expect(() =>
      checkRoots("/mnt/project-files", ["uploads/hearth/be02c96c-1d82-4401-89e9-9cd0406d23ec"]),
    ).toThrow(expect.objectContaining({ code: "EXCLUDED_ROOT" }));
    expect(() => checkRoots("/mnt/project-files", ["uploads"])).toThrow(
      expect.objectContaining({ code: "EXCLUDED_ROOT" }),
    );
  });
});

describe("refusals (fail closed)", () => {
  test.each([
    ["an absolute path outside the base", () => outside, "ROOT_OUTSIDE_BASE"],
    ["a relative path that climbs out", () => "../outside", "ROOT_OUTSIDE_BASE"],
    ["a sibling whose name starts like the base", () => `${base}-evil`, "ROOT_OUTSIDE_BASE"],
    ["a root that does not exist", () => "missing", "ROOT_MISSING"],
    ["an empty root", () => "", "BAD_ROOT"],
  ])("SL-07 %s is refused", async (_name, root, c) => {
    await expect(capture({ base, roots: [root()] })).rejects.toSatisfy(code(c));
  });

  test("SL-08 a root that is a link out of the base is refused by its resolved path", async () => {
    symlinkSync(outside, join(base, "escape"));
    await expect(capture({ base, roots: ["escape"] })).rejects.toSatisfy(code("ROOT_OUTSIDE_BASE"));
  });

  test("SL-09 no roots, overlapping roots, a relative base and a missing base are refused", async () => {
    await expect(capture({ base, roots: [] })).rejects.toSatisfy(code("NO_ROOTS"));
    await expect(capture({ base, roots: ["generator", "generator/sub"] })).rejects.toSatisfy(
      code("OVERLAPPING_ROOTS"),
    );
    await expect(capture({ base, roots: [".", "review"] })).rejects.toSatisfy(code("OVERLAPPING_ROOTS"));
    await expect(capture({ base: "notifications", roots: ["review"] })).rejects.toSatisfy(code("BAD_BASE"));
    await expect(capture({ base: join(tmp, "gone"), roots: ["review"] })).rejects.toSatisfy(
      code("BASE_MISSING"),
    );
  });

  test("SL-10 the ledger is never written under the base, directly, through a link or by climbing", () => {
    expect(() => checkOut(join(base, "ledger.json"), base)).toThrow(
      expect.objectContaining({ code: "OUT_UNDER_BASE" }),
    );
    expect(() => checkOut(join(base, "new", "ledger.json"), base)).toThrow(
      expect.objectContaining({ code: "OUT_UNDER_BASE" }),
    );
    symlinkSync(base, join(tmp, "via-link"));
    expect(() => checkOut(join(tmp, "via-link", "ledger.json"), base)).toThrow(
      expect.objectContaining({ code: "OUT_UNDER_BASE" }),
    );
    expect(() => checkOut("ledger.json", base)).toThrow(expect.objectContaining({ code: "BAD_OUT" }));
    expect(checkOut(join(ledgerDir, "ledger.json"), base)).toBe(join(ledgerDir, "ledger.json"));
  });

  test("SL-19 a missing ledger folder is refused and never created, even behind a link into the base (SEC-F-064-1)", async () => {
    // SEC's fixture: out/link -> base. Row 1 was already refused; rows 2 and 3 used to create folders under base.
    const outDir = join(tmp, "out");
    mkdirSync(outDir);
    symlinkSync(base, join(outDir, "link"));
    const before = snapshot(base);
    const run = (out: string) => main(["capture", "--out", out, "review"], { base, log: () => {} });
    await expect(run(join(outDir, "link", "ledger.json"))).rejects.toSatisfy(code("OUT_UNDER_BASE"));
    await expect(run(join(outDir, "link", "new", "ledger.json"))).rejects.toSatisfy(code("OUT_DIR_MISSING"));
    await expect(run(join(outDir, "link", "a", "b", "ledger.json"))).rejects.toSatisfy(
      code("OUT_DIR_MISSING"),
    );
    expect(snapshot(base)).toEqual(before);
    expect(existsSync(join(base, "new"))).toBe(false);
    expect(existsSync(join(base, "a"))).toBe(false);
    // a missing folder outside the base is refused too: nothing is ever created
    await expect(run(join(ledgerDir, "missing", "ledger.json"))).rejects.toSatisfy(code("OUT_DIR_MISSING"));
    expect(existsSync(join(ledgerDir, "missing"))).toBe(false);
    // a link put in place of the ledger file is not written through ("wx" refuses an existing path)
    symlinkSync(join(base, "REGISTER.csv"), join(ledgerDir, "planted.json"));
    await expect(run(join(ledgerDir, "planted.json"))).rejects.toThrow(/EEXIST/);
    expect(snapshot(base)).toEqual(before);
  });

  test("SL-11 the command line reads only the fixed notifications base", async () => {
    expect(ALLOWED_BASE).toBe("/mnt/project-files/notifications");
    const logs: string[] = [];
    await expect(
      main(["capture", "--out", join(ledgerDir, "l.json"), outside], { log: (s) => logs.push(s) }),
    ).rejects.toSatisfy(code("ROOT_OUTSIDE_BASE"));
    expect(existsSync(join(ledgerDir, "l.json"))).toBe(false);
  });
});

describe("verify", () => {
  const roots = ["generator", "review", "REGISTER.csv"];

  test("SL-12 an unchanged tree passes", async () => {
    const r = await verify({ base, ledger: await capture({ base, roots }) });
    expect(r).toMatchObject({ ok: true, added: [], removed: [], changed: [] });
  });

  test("SL-13 added, removed and changed files are reported, a same-size edit included", async () => {
    const l = await capture({ base, roots });
    writeFileSync(join(base, "generator", "sub", "new.txt"), "Secretary Alpha");
    unlinkSync(join(base, "review", "r.md"));
    writeFileSync(join(base, "generator", "a.txt"), "Employee alpha"); // same length, other bytes
    appendFileSync(join(base, "REGISTER.csv"), "REQ-02\n");
    const r = await verify({ base, ledger: l });
    expect(r.ok).toBe(false);
    expect(r.added).toEqual(["generator/sub/new.txt"]);
    expect(r.removed).toEqual(["review/r.md"]);
    expect(r.changed).toEqual(["REGISTER.csv", "generator/a.txt"]);
  });

  test("SL-14 a file replaced by a link counts as changed", async () => {
    const l = await capture({ base, roots });
    unlinkSync(join(base, "generator", "b.txt"));
    symlinkSync(join(base, "generator", "a.txt"), join(base, "generator", "b.txt"));
    expect((await verify({ base, ledger: l })).changed).toEqual(["generator/b.txt"]);
  });

  test("SL-15 a ledger from another base, a malformed ledger and planted roots are refused", async () => {
    const l = await capture({ base, roots });
    const other = join(tmp, "other");
    mkdirSync(other);
    await expect(verify({ base: other, ledger: l })).rejects.toSatisfy(code("BASE_MISMATCH"));
    await expect(verify({ base, ledger: { ...l, format: "x" } })).rejects.toSatisfy(code("BAD_LEDGER"));
    await expect(verify({ base, ledger: { ...l, roots: ["../outside"] } })).rejects.toSatisfy(
      code("ROOT_OUTSIDE_BASE"),
    );
  });
});

describe("command line", () => {
  test("SL-16 capture writes one ledger, prints totals and its sha256 but no file name, and never overwrites", async () => {
    mkdirSync(join(ledgerDir, "nested"));
    const out = join(ledgerDir, "nested", "ledger.json");
    const logs: string[] = [];
    const run = (argv: string[]) => main(argv, { base, log: (s) => logs.push(s) });
    expect(await run(["capture", "--out", out, "generator", "review"])).toBe(0);
    const text = readFileSync(out);
    expect(logs).toEqual(["captured roots=2 files=4 bytes=73", `ledger sha256=${sha256Of(text)}`]);
    expect(logs.join("\n")).not.toMatch(/a\.txt|r\.md|c\.json/);
    await expect(run(["capture", "--out", out, "review"])).rejects.toThrow(/EEXIST/);
    expect(readFileSync(out)).toEqual(text);
  });

  test("SL-17 verify exits 0 on an unchanged tree and 1 with the differences listed", async () => {
    const out = join(ledgerDir, "ledger.json");
    const logs: string[] = [];
    const run = (argv: string[]) => main(argv, { base, log: (s) => logs.push(s) });
    await run(["capture", "--out", out, "generator", "review"]);
    logs.length = 0;
    expect(await run(["verify", "--ledger", out])).toBe(0);
    expect(logs.at(-1)).toBe("VERIFY PASS");
    writeFileSync(join(base, "review", "r.md"), "changed");
    logs.length = 0;
    expect(await run(["verify", "--ledger", out])).toBe(1);
    expect(logs).toContain("CHANGED review/r.md");
    expect(logs.at(-1)).toBe("VERIFY FAIL");
  });

  test("SL-18 an unknown mode or a missing flag is a usage error", async () => {
    await expect(main(["hash"], { base })).rejects.toSatisfy(code("USAGE"));
    await expect(main(["capture", "review"], { base })).rejects.toSatisfy(code("USAGE"));
    await expect(main(["verify"], { base })).rejects.toSatisfy(code("USAGE"));
  });
});
