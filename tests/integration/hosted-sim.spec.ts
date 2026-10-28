// The migration runner and the hosted bundle against a Supabase-like cluster whose administrator `postgres` is NOT a
// superuser (tests/integration/support/hosted-sim.ts). Proves: the history is read and written as cdf_v13_owner; the
// bundle's dry run leaves nothing behind; its guards refuse re-application, out-of-order versions, drifted history and
// a missing bootstrap; and runner and bundle share one history.
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildHostedBundle } from "@/scripts/db/hosted-bundle.mjs";
import { MIGRATIONS_DIR, readMigrations } from "@/scripts/db/lib/migrations.mjs";
import { migrate } from "@/scripts/db/migrate.mjs";
import { clusterAvailable, errorCodeOf, HOSTED_SIM_SUPERUSER_URL } from "./support/clusters";
import { client, resetHostedSim, run } from "./support/hosted-sim";

const available = await clusterAvailable("hosted-sim", HOSTED_SIM_SUPERUSER_URL);

const fixture = (n: number) =>
  `set local role cdf_v13_owner;\ncomment on schema cdf_notifications_v13 is 'Synthetic fixture migration ${n}.';\nreset role;\n`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The repository bootstrap followed by fixture migrations 0001…n (contents overridable per version). */
function migrationSet(n: number, overrides: Record<number, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "v13-hosted-sim-"));
  dirs.push(dir);
  copyFileSync(join(MIGRATIONS_DIR, "0000_bootstrap.sql"), join(dir, "0000_bootstrap.sql"));
  for (let v = 1; v <= n; v += 1) {
    writeFileSync(join(dir, `${String(v).padStart(4, "0")}_fixture_${v}.sql`), overrides[v] ?? fixture(v));
  }
  return dir;
}

/** The history as its owner sees it. */
async function history(adminUrl: string) {
  const sql = client(adminUrl);
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe("set local role cdf_v13_owner");
      return tx<
        { version: string; name: string; checksum_sha256: string; runner: string; applied_by: string }[]
      >`
        select version, name, checksum_sha256, runner, applied_by
          from cdf_notifications_v13.schema_migrations order by version`;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Runs a bundle as the administrator; returns null on success or the SQLSTATE and message of the refusal. */
async function applyBundle(
  adminUrl: string,
  bundle: string,
): Promise<{ code: string; message: string } | null> {
  const sql = client(adminUrl);
  try {
    await sql.unsafe(bundle);
    return null;
  } catch (error) {
    await sql.unsafe("rollback").catch(() => undefined);
    return { code: errorCodeOf(error), message: (error as Error).message };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function v13Objects(superuserUrl: string) {
  const [row] = await run(
    superuserUrl,
    `select (select count(*) from pg_catalog.pg_roles where rolname like 'cdf\\_v13\\_%')::int as roles,
            (select count(*) from pg_catalog.pg_namespace where nspname = 'cdf_notifications_v13')::int as schemas`,
  );
  return row as { roles: number; schemas: number };
}

describe.skipIf(!available)("hosted simulation: runner as a non-superuser administrator", () => {
  it("applies the bootstrap and records it as cdf_v13_owner", async () => {
    const sim = await resetHostedSim();
    const [who] = await run(
      sim.adminUrl,
      "select rolsuper, rolcreaterole, rolbypassrls from pg_catalog.pg_roles where rolname = current_user",
    );
    expect(who).toEqual({ rolsuper: false, rolcreaterole: true, rolbypassrls: true });

    const result = await migrate({ url: sim.adminUrl, runner: "ci" });
    expect(result.applied).toEqual(["0000_bootstrap.sql"]);
    const [bootstrap] = readMigrations();
    expect(await history(sim.adminUrl)).toEqual([
      {
        version: "0000",
        name: "bootstrap",
        checksum_sha256: bootstrap?.checksum,
        runner: "ci",
        applied_by: "postgres",
      },
    ]);
    // Re-running applies nothing; a dry run has nothing to apply.
    expect((await migrate({ url: sim.adminUrl, runner: "ci" })).applied).toEqual([]);
    expect((await migrate({ url: sim.adminUrl, runner: "ci", dryRun: true })).alreadyApplied).toBe(1);
  });

  it("leaves the administrator without direct access to the history (RLS on, no grants)", async () => {
    const sim = await resetHostedSim();
    await migrate({ url: sim.adminUrl, runner: "ci" });
    await expect(
      run(sim.adminUrl, "select count(*) from cdf_notifications_v13.schema_migrations"),
    ).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("applies pending fixture migrations one transaction at a time and stops at the first failure", async () => {
    const sim = await resetHostedSim();
    const broken = "set local role cdf_v13_owner;\nselect pg_catalog.no_such_function();\nreset role;\n";
    await expect(
      migrate({ url: sim.adminUrl, runner: "ci", dir: migrationSet(3, { 2: broken }) }),
    ).rejects.toMatchObject({ code: "MIGRATION_FAILED" });
    expect((await history(sim.adminUrl)).map((r) => r.version)).toEqual(["0000", "0001"]);
  });
});

describe.skipIf(!available)("hosted simulation: bundle", () => {
  it("dry run applies the bootstrap and rolls everything back", async () => {
    const sim = await resetHostedSim();
    expect(await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0000", dryRun: true }))).toBeNull();
    expect(await v13Objects(sim.superuserUrl)).toEqual({ roles: 0, schemas: 0 });
  });

  it("applies the bootstrap once, records runner 'hosted', and refuses a second application", async () => {
    const sim = await resetHostedSim();
    expect(await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0000" }))).toBeNull();
    expect(await v13Objects(sim.superuserUrl)).toEqual({ roles: 3, schemas: 1 });
    expect((await history(sim.adminUrl)).map((r) => [r.version, r.runner])).toEqual([["0000", "hosted"]]);

    const again = await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0000" }));
    expect(again?.code).toBe("P0001");
    expect(again?.message).toContain("V13 bundle 0000 refused");
    expect((await history(sim.adminUrl)).length).toBe(1);
  });

  it("guards later versions: bootstrap present, not yet applied, in order, predecessors unchanged", async () => {
    const sim = await resetHostedSim();
    const set = migrationSet(3);

    const noBootstrap = await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0001", dir: set }));
    expect(noBootstrap?.message).toContain("the V13 bootstrap (0000) is not applied");

    expect(await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0000", dir: set }))).toBeNull();
    expect(await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0001", dir: set }))).toBeNull();

    const twice = await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0001", dir: set }));
    expect(twice?.message).toContain("version 0001 is already applied");

    const outOfOrder = await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0003", dir: set }));
    expect(outOfOrder?.message).toContain("the latest applied version is 0001, expected 0002");

    const drifted = migrationSet(2, { 1: fixture(1).replace("migration 1", "migration one") });
    const drift = await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0002", dir: drifted }));
    expect(drift?.message).toContain("the recorded history differs from the repository");

    expect((await history(sim.adminUrl)).map((r) => r.version)).toEqual(["0000", "0001"]);
  });

  it("shares one history with the runner, which refuses drift against bundle-applied rows", async () => {
    const sim = await resetHostedSim();
    const set = migrationSet(2);
    expect(await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0000", dir: set }))).toBeNull();
    expect(await applyBundle(sim.adminUrl, buildHostedBundle({ version: "0001", dir: set }))).toBeNull();

    const drifted = migrationSet(2, { 1: fixture(1).replace("migration 1", "migration one") });
    await expect(migrate({ url: sim.adminUrl, runner: "ci", dir: drifted })).rejects.toMatchObject({
      code: "HISTORY_CHECKSUM_DRIFT",
    });

    const result = await migrate({ url: sim.adminUrl, runner: "ci", dir: set });
    expect(result).toMatchObject({ applied: ["0002_fixture_2.sql"], alreadyApplied: 2 });
    expect((await history(sim.adminUrl)).map((r) => [r.version, r.runner])).toEqual([
      ["0000", "hosted"],
      ["0001", "hosted"],
      ["0002", "ci"],
    ]);
  });
});
