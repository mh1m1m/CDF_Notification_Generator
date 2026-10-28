// The isolation probe (lib/db/isolation-probe.ts) and both health routes against the Supabase-like layout, as the
// real app login cdf_v13_app. Baseline: PASS. Each negative test breaks one isolation property, expects FAIL, and
// restores the layout.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeSql } from "@/lib/db/client";
import { probeDatabase, isProbeHealthy } from "@/lib/db/health-probe";
import { isolationChecks, isolationVerdict, runIsolationProbe } from "@/lib/db/isolation-probe";
import { migrate } from "@/scripts/db/migrate.mjs";
import { clusterAvailable, HOSTED_SIM_SUPERUSER_URL } from "./support/clusters";
import { client, resetHostedSim, run, type HostedSim } from "./support/hosted-sim";

const available = await clusterAvailable("hosted-sim", HOSTED_SIM_SUPERUSER_URL);

describe.skipIf(!available)("isolation probe on the hosted simulation", () => {
  let sim: HostedSim;

  beforeAll(async () => {
    sim = await resetHostedSim();
    await migrate({ url: sim.adminUrl, runner: "ci" });
    await sim.setAppPassword();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeSql();
  });

  async function verdict() {
    const sql = client(sim.appUrl);
    try {
      const checks = isolationChecks(await runIsolationProbe(sql));
      return { checks, verdict: isolationVerdict(checks) };
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  /** Applies `breakSql` as supabase_admin, runs the probe, then always applies `restoreSql`. */
  async function verdictWith(breakSql: string, restoreSql: string) {
    await run(sim.superuserUrl, breakSql);
    try {
      return await verdict();
    } finally {
      await run(sim.superuserUrl, restoreSql);
    }
  }

  it("PASS: only SET ROLE cdf_v13_user succeeds, no foreign relation is readable, nothing can be created", async () => {
    const { checks, verdict: result } = await verdict();
    expect(result).toBe("PASS");
    expect(checks.login.session_user_ok).toBe(true);
    expect(checks.set_role).toMatchObject({ allowed: 1, allowed_targets_ok: true, inconclusive: 0 });
    expect(checks.set_role.refused).toBeGreaterThan(5);
    // auth.users, storage.objects, vault.secrets, public.gc_review_item, cdf.gc_case — as login and as request role.
    expect(checks.foreign_select.app).toEqual({ refused: 5, allowed: 0, inconclusive: 0 });
    expect(checks.foreign_select.user).toEqual({ refused: 5, allowed: 0, inconclusive: 0 });
    expect(checks.foreign_create).toEqual({ refused: 4, allowed: 0, inconclusive: 0 });
    expect(checks.own_schema.usage).toBe(true);
  });

  it("FAIL when cdf_v13_user is granted SELECT on the GC Review table (with schema usage)", async () => {
    const { checks, verdict: result } = await verdictWith(
      "grant usage on schema cdf to cdf_v13_user; grant select on cdf.gc_case to cdf_v13_user;",
      "revoke select on cdf.gc_case from cdf_v13_user; revoke usage on schema cdf from cdf_v13_user;",
    );
    expect(result).toBe("FAIL");
    expect(checks.foreign_select.user.allowed).toBe(1);
    expect(checks.foreign_select.app.allowed).toBe(0);
  });

  it("FAIL when a foreign table is granted to PUBLIC", async () => {
    const { checks, verdict: result } = await verdictWith(
      "grant select on public.gc_review_item to public;",
      "revoke select on public.gc_review_item from public;",
    );
    expect(result).toBe("FAIL");
    expect(checks.foreign_select.app.allowed).toBe(1);
    expect(checks.foreign_select.user.allowed).toBe(1);
  });

  it("FAIL when PUBLIC may create in schema public", async () => {
    const { checks, verdict: result } = await verdictWith(
      "grant create on schema public to public;",
      "revoke create on schema public from public;",
    );
    expect(result).toBe("FAIL");
    expect(checks.foreign_create.allowed).toBe(2);
  });

  it("FAIL when the app login can SET ROLE to another role", async () => {
    const { checks, verdict: result } = await verdictWith(
      "grant authenticated to cdf_v13_app with inherit false, set true;",
      "revoke authenticated from cdf_v13_app;",
    );
    expect(result).toBe("FAIL");
    expect(checks.set_role).toMatchObject({ allowed: 2, allowed_targets_ok: false });
  });

  it("a lock held on a GC Review table never stalls the probe: the wait ends at 2 s and fails the verdict", async () => {
    const holder = client(sim.superuserUrl);
    try {
      const started = Date.now();
      // GC Review holds an exclusive lock (as a migration would) for the whole probe run.
      const result = await holder.begin(async (tx) => {
        await tx`lock table public.gc_review_item in access exclusive mode`;
        return verdict();
      });
      expect(Date.now() - started).toBeLessThan(12_000);
      expect(result.verdict).toBe("FAIL");
      // public is the one foreign schema PUBLIC may use, so only its table is reached and waited on, once per pass.
      expect(result.checks.foreign_select.app).toEqual({ refused: 4, allowed: 0, inconclusive: 1 });
      expect(result.checks.foreign_select.user).toEqual({ refused: 4, allowed: 0, inconclusive: 1 });
    } finally {
      await holder.end({ timeout: 5 });
    }
  });

  it("the probe's transaction leaves nothing behind", async () => {
    await verdict();
    const [row] = await run(
      sim.superuserUrl,
      `select (select count(*) from pg_catalog.pg_namespace where nspname = 'v13_isolation_probe')::int as schemas,
              (select count(*) from pg_catalog.pg_class where relname = 'v13_isolation_probe')::int as tables`,
    );
    expect(row).toEqual({ schemas: 0, tables: 0 });
  });

  it("GET /api/health and GET /api/health/isolation answer 200 against this layout", async () => {
    vi.stubEnv("V13_DATABASE_URL", sim.appUrl);
    vi.stubEnv("V13_ISOLATION_PROBE", "enabled");
    await closeSql();

    const health = await (await import("@/app/api/health/route")).GET();
    const healthBody = await health.json();
    expect(health.status).toBe(200);
    expect(healthBody.db).toMatchObject({
      status: "ok",
      login_is_app_role: true,
      v13_schema_usage: true,
      isolated_from: { auth: true, storage: true, vault: true, cdf: true },
    });

    const isolation = await (await import("@/app/api/health/isolation/route")).GET();
    const isolationBody = await isolation.json();
    expect(isolation.status).toBe(200);
    expect(isolationBody.verdict).toBe("PASS");
    expect(JSON.stringify(isolationBody)).not.toMatch(/gc_case|gc_review_item|auth\.users|vault/);
  });

  it("the health probe reports a foreign schema the request role can use", async () => {
    await run(sim.superuserUrl, "grant usage on schema vault to cdf_v13_user;");
    try {
      const sql = client(sim.appUrl);
      try {
        const probe = await probeDatabase(sql);
        expect(probe.isolated_from.vault).toBe(false);
        expect(isProbeHealthy(probe)).toBe(false);
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await run(sim.superuserUrl, "revoke usage on schema vault from cdf_v13_user;");
    }
  });
});
