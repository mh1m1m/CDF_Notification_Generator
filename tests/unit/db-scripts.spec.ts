// Database tooling that needs no database: history drift detection, runner selection, target refusals, the reset
// guard, SCRAM verifiers and the URL helpers. tests/integration/ runs the same scripts against real clusters.
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  adminUrl,
  defaultAdminUrl,
  describeUrl,
  isLoopbackUrl,
  MIGRATION_LOCK_SQL,
  MigrationSetError,
  readMigrations,
  sha256,
  withCredentials,
  withDatabase,
} from "@/scripts/db/lib/migrations.mjs";
import { randomTestPassword, scramVerifier, TEST_PASSWORD_PATTERN } from "@/scripts/db/lib/scram.mjs";
import { migrate, MigrationError, pendingMigrations, runnerFromEnv } from "@/scripts/db/migrate.mjs";
import { assertResettable, DEFAULT_LOCAL_APP_PASSWORD, ResetError } from "@/scripts/db/reset-local.mjs";

const OWNER = "set local role cdf_v13_owner;\n";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function migrationsDir(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "v13-migrate-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

const sampleSet = () =>
  readMigrations(
    migrationsDir({
      "0000_bootstrap.sql": "create schema cdf_notifications_v13;\n",
      "0001_first.sql": `${OWNER}comment on schema cdf_notifications_v13 is 'one';\n`,
      "0002_second.sql": `${OWNER}comment on schema cdf_notifications_v13 is 'two';\n`,
    }),
  );

const historyOf = (files: ReturnType<typeof readMigrations>, n: number) =>
  files.slice(0, n).map((f) => ({ version: f.version, name: f.name, checksum_sha256: f.checksum }));

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof MigrationError) return error.code;
    throw error;
  }
  return null;
};

describe("readMigrations", () => {
  it("reads versions, names and sha256 checksums of the exact bytes", () => {
    const files = sampleSet();
    expect(files.map((f) => [f.version, f.name])).toEqual([
      ["0000", "bootstrap"],
      ["0001", "first"],
      ["0002", "second"],
    ]);
    expect(files[1]?.checksum).toBe(sha256(`${OWNER}comment on schema cdf_notifications_v13 is 'one';\n`));
  });

  it("refuses gaps and invalid names", () => {
    expect(() => readMigrations(migrationsDir({ "0000_a_b.sql": ";", "0002_c_d.sql": ";" }))).toThrow(
      MigrationSetError,
    );
    rmSync(dir!, { recursive: true, force: true });
    expect(() => readMigrations(migrationsDir({ "0000_Bootstrap.sql": ";" }))).toThrow(MigrationSetError);
  });
});

describe("pendingMigrations (history drift)", () => {
  it("returns the files after the recorded history", () => {
    const files = sampleSet();
    expect(pendingMigrations(files, []).map((f) => f.version)).toEqual(["0000", "0001", "0002"]);
    expect(pendingMigrations(files, historyOf(files, 2)).map((f) => f.version)).toEqual(["0002"]);
    expect(pendingMigrations(files, historyOf(files, 3))).toEqual([]);
  });

  it("refuses a history with a gap, an unknown version, another name or another checksum", () => {
    const files = sampleSet();
    const history = historyOf(files, 3);
    expect(codeOf(() => pendingMigrations(files, [history[0]!, history[2]!]))).toBe("HISTORY_GAP");
    expect(
      codeOf(() =>
        pendingMigrations(files, [
          ...history,
          { version: "0003", name: "elsewhere", checksum_sha256: "0".repeat(64) },
        ]),
      ),
    ).toBe("HISTORY_UNKNOWN_VERSION");
    expect(codeOf(() => pendingMigrations(files, [history[0]!, { ...history[1]!, name: "renamed" }]))).toBe(
      "HISTORY_NAME_DRIFT",
    );
    expect(
      codeOf(() =>
        pendingMigrations(files, [history[0]!, { ...history[1]!, checksum_sha256: "f".repeat(64) }]),
      ),
    ).toBe("HISTORY_CHECKSUM_DRIFT");
  });
});

describe("migrate: refusals before any connection", () => {
  it("records runner local, or ci under CI; never hosted", () => {
    expect(runnerFromEnv({})).toBe("local");
    expect(runnerFromEnv({ CI: "true" })).toBe("ci");
    expect(runnerFromEnv({ V13_MIGRATION_RUNNER: "ci" })).toBe("ci");
    expect(runnerFromEnv({ CI: "true", V13_MIGRATION_RUNNER: "local" })).toBe("local");
    expect(codeOf(() => runnerFromEnv({ V13_MIGRATION_RUNNER: "hosted" }))).toBe("RUNNER_INVALID");
  });

  it("refuses non-loopback targets: the hosted project is migrated through the reviewed bundle", async () => {
    await expect(
      migrate({ url: "postgres://postgres@db.example.test:5432/postgres", runner: "local" }),
    ).rejects.toMatchObject({ code: "NON_LOOPBACK_TARGET" });
    await expect(
      migrate({ url: "postgres://postgres@127.0.0.1:1/v13_local", runner: "hosted" }),
    ).rejects.toMatchObject({ code: "RUNNER_INVALID" });
  });

  it("refuses to migrate when db:lint reports findings, and logs them", async () => {
    const d = migrationsDir({ "0000_bootstrap.sql": "truncate cdf_notifications_v13.t;\n" });
    const lines: string[] = [];
    await expect(
      // Port 1 is never listened on: the lint failure must stop the run before any connection attempt.
      migrate({
        url: "postgres://postgres@127.0.0.1:1/v13_local",
        dir: d,
        runner: "local",
        log: (l) => lines.push(l),
      }),
    ).rejects.toMatchObject({ code: "LINT_FAILED" });
    expect(lines.join("\n")).toContain("[truncate]");
  });

  it("serialises on the V13 advisory-lock namespace with key 0", () => {
    expect(MIGRATION_LOCK_SQL).toBe(
      "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'), 0)",
    );
  });
});

describe("db:reset guard", () => {
  it("only drops and recreates v13_local on a loopback host", () => {
    expect(() => assertResettable("postgres://postgres@127.0.0.1:54329/v13_local")).not.toThrow();
    expect(() => assertResettable("postgres://postgres@localhost:5432/v13_local")).not.toThrow();
    for (const url of [
      "postgres://postgres@db.example.test:5432/v13_local",
      "postgres://postgres@127.0.0.1:54329/postgres",
      "postgres://postgres@127.0.0.1:54329/",
      "postgres://postgres@127.0.0.1:54329/v13_local_copy",
    ]) {
      expect(() => assertResettable(url), url).toThrow(ResetError);
    }
  });
});

describe("SCRAM verifiers", () => {
  it("produce PostgreSQL's SCRAM-SHA-256 format that verifies against the password", () => {
    const password = DEFAULT_LOCAL_APP_PASSWORD;
    const verifier = scramVerifier(password);
    const m = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(verifier);
    expect(m).not.toBeNull();
    const [, iterations, salt, storedKey, serverKey] = m as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    expect(Number(iterations)).toBe(4096);
    const salted = pbkdf2Sync(password, Buffer.from(salt, "base64"), Number(iterations), 32, "sha256");
    const clientKey = createHmac("sha256", salted).update("Client Key").digest();
    expect(createHash("sha256").update(clientKey).digest("base64")).toBe(storedKey);
    expect(createHmac("sha256", salted).update("Server Key").digest("base64")).toBe(serverKey);
    expect(verifier).not.toContain(password);
    expect(scramVerifier(password)).not.toBe(verifier); // random salt
  });

  it("refuse passwords SASLprep could change, and generate valid random test passwords", () => {
    for (const bad of ["short", "has a space in it ok", "ünïcödé-password-x", ""]) {
      expect(() => scramVerifier(bad)).toThrow();
    }
    const a = randomTestPassword();
    expect(a).toMatch(TEST_PASSWORD_PATTERN);
    expect(randomTestPassword()).not.toBe(a);
  });
});

describe("connection URL helpers", () => {
  it("never print the password", () => {
    const url = "postgres://cdf_v13_app:not-a-real-password@127.0.0.1:54329/v13_local";
    expect(describeUrl(url)).toBe("cdf_v13_app@127.0.0.1:54329/v13_local");
    expect(describeUrl("postgres://db.example.test")).toBe("(default user)@db.example.test:5432/(default)");
  });

  it("recognise loopback hosts only", () => {
    expect(isLoopbackUrl("postgres://u@127.0.0.1/x")).toBe(true);
    expect(isLoopbackUrl("postgres://u@localhost/x")).toBe(true);
    expect(isLoopbackUrl("postgres://u@[::1]/x")).toBe(true);
    expect(isLoopbackUrl("postgres://u@127.0.0.2/x")).toBe(false);
    expect(isLoopbackUrl("postgres://u@localhost.example.test/x")).toBe(false);
  });

  it("swap database and credentials with encoding", () => {
    const base = "postgres://postgres@127.0.0.1:54329/v13_local";
    expect(withDatabase(base, "postgres")).toBe("postgres://postgres@127.0.0.1:54329/postgres");
    expect(withCredentials(base, "cdf_v13_app", "p@ss/word:x")).toBe(
      "postgres://cdf_v13_app:p%40ss%2Fword%3Ax@127.0.0.1:54329/v13_local",
    );
  });

  it("default to the local primary cluster unless V13_ADMIN_DATABASE_URL is set", () => {
    expect(defaultAdminUrl({})).toBe("postgres://postgres@127.0.0.1:54329/v13_local");
    expect(defaultAdminUrl({ V13_LOCAL_PG_PORT: "5432" })).toBe(
      "postgres://postgres@127.0.0.1:5432/v13_local",
    );
    expect(adminUrl({ V13_ADMIN_DATABASE_URL: "postgres://postgres@127.0.0.1:5433/v13_local" })).toBe(
      "postgres://postgres@127.0.0.1:5433/v13_local",
    );
    expect(adminUrl({ V13_ADMIN_DATABASE_URL: "  " })).toBe("postgres://postgres@127.0.0.1:54329/v13_local");
  });
});
