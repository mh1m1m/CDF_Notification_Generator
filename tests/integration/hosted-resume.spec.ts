// V13-DB-016 · Rehearsal of the hosted resume: the hosted project stands at 0005 (docs/TEST_EVIDENCE.md §2.1); the
// Chief Architect will send, through the Supabase connector, the bundles 0006, 0007, 0008, 0009 and 0010 (each dry run,
// then apply), then seeds 0001 and 0002 (each dry run, then apply). This file runs that exact sequence on the
// Supabase-like cluster (tests/integration/support/hosted-sim.ts: non-superuser administrator `postgres`, API roles,
// foreign schemas) and proves:
//   - every text is the one scripts/db/hosted-bundle.mjs generates, sent as ONE simple query with a connector-like
//     comment trailer after its final newline, and every text guard passes;
//   - each dry run leaves nothing behind (history, catalogue fingerprint and seed row counts unchanged);
//   - each apply writes the repository's history row (version, name, sha256, runner 'hosted', applied_by 'postgres');
//   - a seed sent before the schema is complete is refused (its guard requires the whole repository history);
//   - at the end, database/hosted/v13_catalog_fingerprint.sql equals the same query on fresh builds of the same commit
//     (the runner plus the seeds on the same layout, and the db:reset primary when it is reachable), the seed rows
//     equal the fresh build's, and database/hosted/post_apply_checks.sql reports VERDICT PASS.
// database/hosted/** is read only here (ARCH's path). SYNTHETIC DATA ONLY.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildHostedBundle, buildHostedSeedBundle } from "@/scripts/db/hosted-bundle.mjs";
import { listFiles, readMigrations, ROOT, SEED_DIR } from "@/scripts/db/lib/migrations.mjs";
import { migrate } from "@/scripts/db/migrate.mjs";
import {
  clusterAvailable,
  errorCodeOf,
  HOSTED_SIM_SUPERUSER_URL,
  PRIMARY_ADMIN_URL,
} from "./support/clusters";
import { client, resetHostedSim, run } from "./support/hosted-sim";

const available = await clusterAvailable("hosted-sim", HOSTED_SIM_SUPERUSER_URL);
const primary = available && (await clusterAvailable("primary", PRIMARY_ADMIN_URL));

const HOSTED = join(ROOT, "database", "hosted");
const FINGERPRINT_SQL = readFileSync(join(HOSTED, "v13_catalog_fingerprint.sql"), "utf8");
const POST_APPLY_SQL = readFileSync(join(HOSTED, "post_apply_checks.sql"), "utf8");

/** What the Supabase connector appends to every text it sends (a comment after the final newline). */
const CONNECTOR_TRAILER = "-- source: connector";
const viaConnector = (text: string) => `${text}${CONNECTOR_TRAILER}`;

const MIGRATIONS = readMigrations();
const HOSTED_AT = "0005";
const RESUME = MIGRATIONS.filter((m) => m.version > HOSTED_AT).map((m) => m.version);
const SEEDS = listFiles(SEED_DIR).map((f) => f.slice(0, 4));

/** Sends one text as one simple query as the administrator; null on success, else the SQLSTATE and message. */
async function send(adminUrl: string, text: string): Promise<{ code: string; message: string } | null> {
  const sql = client(adminUrl);
  try {
    await sql.unsafe(text);
    return null;
  } catch (error) {
    await sql.unsafe("rollback").catch(() => undefined);
    return { code: errorCodeOf(error), message: (error as Error).message };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

type HistoryRow = {
  version: string;
  name: string;
  checksum_sha256: string;
  runner: string;
  applied_by: string;
};

/** The history as its owner sees it. */
async function history(adminUrl: string): Promise<HistoryRow[]> {
  const sql = client(adminUrl);
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe("set local role cdf_v13_owner");
      return tx<HistoryRow[]>`
        select version, name, checksum_sha256, runner, applied_by
          from cdf_notifications_v13.schema_migrations order by version`;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The catalogue fingerprint, exactly as ARCH runs it (category → objects:hash). */
async function fingerprint(url: string): Promise<Record<string, string>> {
  const rows = (await run(url, FINGERPRINT_SQL)) as unknown as {
    category: string;
    objects: string | number;
    hash: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.category, `${Number(r.objects)}:${r.hash}`]));
}

/** Row counts of the seeded tables and the audit ledger, as the owner; tables not created yet count as null. */
async function seedCounts(adminUrl: string): Promise<Record<string, number | null>> {
  const tables = [
    "workspace",
    "persona",
    "persona_workspace_membership",
    "case_record",
    "task",
    "notification",
    "audit_event",
  ];
  const sql = client(adminUrl);
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe("set local role cdf_v13_owner");
      const out: Record<string, number | null> = {};
      for (const t of tables) {
        const [exists] = await tx<{ present: boolean }[]>`
          select pg_catalog.to_regclass(${`cdf_notifications_v13.${t}`}) is not null as present`;
        if (!exists?.present) {
          out[t] = null;
          continue;
        }
        const [row] = await tx.unsafe<{ n: string }[]>(
          `select count(*)::text as n from cdf_notifications_v13.${t}`,
        );
        out[t] = Number(row?.n);
      }
      return out;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The repository's history rows up to a version, as the bundles record them. */
const expectedHistory = (upTo: string) =>
  MIGRATIONS.filter((m) => m.version <= upTo).map((m) => ({
    version: m.version,
    name: m.name,
    checksum_sha256: m.checksum,
    runner: "hosted",
    applied_by: "postgres",
  }));

describe.skipIf(!available)(
  "V13-DB-016 hosted resume rehearsal: 0005 → 0010, then seeds 0001 and 0002",
  () => {
    let adminUrl: string;
    let freshFingerprint: Record<string, string>;
    let freshCounts: Record<string, number | null>;
    let primaryFingerprint: Record<string, string> | undefined;

    beforeAll(async () => {
      // EXPECTED: a fresh build of the same commit on the same layout (the runner, then the seeds in one transaction
      // each, as db:reset applies them), and the db:reset primary when it is reachable.
      const fresh = await resetHostedSim();
      await migrate({ url: fresh.adminUrl, runner: "ci", log: () => undefined });
      for (const file of listFiles(SEED_DIR)) {
        const text = readFileSync(join(SEED_DIR, file), "utf8");
        const sql = client(fresh.adminUrl);
        try {
          await sql.begin(async (tx) => {
            await tx.unsafe("set local search_path = ''");
            await tx.unsafe(text);
          });
        } finally {
          await sql.end({ timeout: 5 });
        }
      }
      freshFingerprint = await fingerprint(fresh.adminUrl);
      freshCounts = await seedCounts(fresh.adminUrl);
      if (primary) primaryFingerprint = await fingerprint(PRIMARY_ADMIN_URL);

      // ACTUAL starts where the hosted project stands: 0000–0005 applied by their bundles (dry run, then apply).
      const sim = await resetHostedSim();
      adminUrl = sim.adminUrl;
      for (const m of MIGRATIONS.filter((x) => x.version <= HOSTED_AT)) {
        expect(
          await send(adminUrl, viaConnector(buildHostedBundle({ version: m.version, dryRun: true }))),
          m.version,
        ).toBeNull();
        expect(
          await send(adminUrl, viaConnector(buildHostedBundle({ version: m.version }))),
          m.version,
        ).toBeNull();
      }
    }, 180_000);

    it("the plan: the repository holds 0006–0010 after 0005, and seeds 0001 and 0002", () => {
      expect(RESUME).toEqual(["0006", "0007", "0008", "0009", "0010"]);
      expect(SEEDS).toEqual(["0001", "0002"]);
    });

    it("the starting point equals the hosted project's: history 0000–0005, runner hosted, no seed rows", async () => {
      expect(await history(adminUrl)).toEqual(expectedHistory(HOSTED_AT));
      const counts = await seedCounts(adminUrl);
      for (const [table, n] of Object.entries(counts)) {
        if (table === "audit_event") continue;
        expect(n, table).toBe(0);
      }
    });

    it("a seed sent before the schema is complete is refused, and leaves nothing behind", async () => {
      const before = await seedCounts(adminUrl);
      for (const v of SEEDS) {
        const refused = await send(
          adminUrl,
          viaConnector(buildHostedSeedBundle({ version: v, dryRun: true })),
        );
        expect(refused?.code, v).toBe("P0001");
        expect(refused?.message, v).toMatch(
          /V13 seed \d{4} refused: the recorded history is not the repository's/,
        );
      }
      expect(await seedCounts(adminUrl)).toEqual(before);
      expect(await history(adminUrl)).toEqual(expectedHistory(HOSTED_AT));
    });

    it("0006–0010: each dry run leaves nothing behind, each apply records the repository's row", async () => {
      for (const version of RESUME) {
        const historyBefore = await history(adminUrl);
        const fingerprintBefore = await fingerprint(adminUrl);

        const dry = await send(adminUrl, viaConnector(buildHostedBundle({ version, dryRun: true })));
        expect(dry, `${version} dry run`).toBeNull();
        expect(await history(adminUrl), `${version} dry run: history`).toEqual(historyBefore);
        expect(await fingerprint(adminUrl), `${version} dry run: fingerprint`).toEqual(fingerprintBefore);

        const applied = await send(adminUrl, viaConnector(buildHostedBundle({ version })));
        expect(applied, `${version} apply`).toBeNull();
        expect(await history(adminUrl), `${version} apply: history`).toEqual(expectedHistory(version));
      }
    }, 120_000);

    it("seeds 0001 and 0002: each dry run leaves nothing behind, each apply loads the fresh build's rows", async () => {
      for (const version of SEEDS) {
        const countsBefore = await seedCounts(adminUrl);
        const fingerprintBefore = await fingerprint(adminUrl);

        const dry = await send(adminUrl, viaConnector(buildHostedSeedBundle({ version, dryRun: true })));
        expect(dry, `seed ${version} dry run`).toBeNull();
        expect(await seedCounts(adminUrl), `seed ${version} dry run: rows`).toEqual(countsBefore);
        expect(await fingerprint(adminUrl), `seed ${version} dry run: fingerprint`).toEqual(
          fingerprintBefore,
        );

        const applied = await send(adminUrl, viaConnector(buildHostedSeedBundle({ version })));
        expect(applied, `seed ${version} apply`).toBeNull();
        expect(await seedCounts(adminUrl), `seed ${version} apply: rows changed`).not.toEqual(countsBefore);
      }
      expect(await seedCounts(adminUrl)).toEqual(freshCounts);
      expect(await history(adminUrl)).toEqual(expectedHistory(MIGRATIONS[MIGRATIONS.length - 1]!.version));
    }, 60_000);

    it("the catalogue fingerprint equals the fresh builds' (same layout, and the db:reset primary)", async () => {
      const actual = await fingerprint(adminUrl);
      expect(Object.keys(actual)).toContain("TOTAL");
      expect(actual).toEqual(freshFingerprint);
      if (primaryFingerprint) expect(actual).toEqual(primaryFingerprint);
    });

    it("post_apply_checks.sql as written: VERDICT PASS", async () => {
      const results = (await run(adminUrl, POST_APPLY_SQL)) as unknown as unknown[];
      const rows = (results.find(
        (r) => Array.isArray(r) && (r as { check_id?: string }[]).some((x) => x?.check_id === "VERDICT"),
      ) ?? []) as { check_id: string; detail: string; breaches: number | string }[];
      for (const r of rows) expect(Number(r.breaches), `${r.check_id}: ${r.detail}`).toBe(0);
      expect(rows.find((r) => r.check_id === "VERDICT")?.detail).toBe("PASS");
    });

    it("a re-sent seed is refused by nothing and changes nothing (idempotent seeds)", async () => {
      const before = await seedCounts(adminUrl);
      for (const version of SEEDS)
        expect(await send(adminUrl, viaConnector(buildHostedSeedBundle({ version }))), version).toBeNull();
      expect(await seedCounts(adminUrl)).toEqual(before);
    });
  },
);
