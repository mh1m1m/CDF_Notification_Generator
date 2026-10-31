// lib/db/security-context.ts against the primary cluster as the real app login: inside the transaction the request
// role and the exact claims are in effect; afterwards nothing survives on the pooled connection, also after a failure.
// Plus the health probe and the isolation probe on the primary layout.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequestIdentitySchema } from "@/lib/contracts";
import { databaseClientOptions } from "@/lib/db/client";
import { isProbeHealthy, probeDatabase } from "@/lib/db/health-probe";
import { isolationChecks, isolationVerdict, runIsolationProbe } from "@/lib/db/isolation-probe";
import { requestClaims, withRequestContext } from "@/lib/db/security-context";
import { TEST_CLAIMS_KEY } from "./support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL, PRIMARY_APP_URL } from "./support/clusters";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

const alpha = RequestIdentitySchema.parse({
  persona_id: "0b000000-0000-4000-8000-000000000001",
  active_workspace: "SECRETARIAT",
  roles: ["COMMITTEE_SECRETARY"],
});
const CORRELATION = "6f1c2a9e-3b7d-4c1e-9a2f-0d8e7b6a5c41";

describe.skipIf(!available)("request security context on the primary cluster", () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    // The app's own driver options, with ONE connection so every transaction reuses it (the pooled-connection case).
    sql = postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  const sessionState = async () => {
    const [row] = await sql<{ current_user: string; session_user: string; claims: string | null }[]>`
      select current_user as current_user, session_user as session_user,
             pg_catalog.current_setting('request.v13.claims', true) as claims`;
    return row;
  };

  it("runs the work as cdf_v13_user with exactly the claims JSON", async () => {
    const inside = await withRequestContext(
      alpha,
      async (tx) => {
        const [row] = await tx<{ current_user: string; session_user: string; claims: string }[]>`
          select current_user as current_user, session_user as session_user,
                 pg_catalog.current_setting('request.v13.claims') as claims`;
        return row;
      },
      { sql, correlationId: CORRELATION, claimsKey: TEST_CLAIMS_KEY },
    );
    expect(inside).toEqual({
      current_user: "cdf_v13_user",
      session_user: "cdf_v13_app",
      claims: requestClaims(alpha, CORRELATION),
    });
  });

  it("leaves no role and no claims on the connection afterwards, also when the work fails", async () => {
    await withRequestContext(alpha, async () => undefined, { sql, claimsKey: TEST_CLAIMS_KEY });
    expect(await sessionState()).toMatchObject({ current_user: "cdf_v13_app", session_user: "cdf_v13_app" });
    expect((await sessionState())?.claims ?? "").toBe("");

    await expect(
      withRequestContext(
        alpha,
        async (tx) => {
          await tx`select pg_catalog.pg_sleep(0)`;
          throw new Error("work failed");
        },
        { sql, claimsKey: TEST_CLAIMS_KEY },
      ),
    ).rejects.toThrow("work failed");
    expect(await sessionState()).toMatchObject({ current_user: "cdf_v13_app" });
    expect((await sessionState())?.claims ?? "").toBe("");
  });

  it("gives the request role no way up: SET ROLE to the owner and reading the history are refused", async () => {
    await expect(
      withRequestContext(alpha, async (tx) => tx`set local role cdf_v13_owner`, {
        sql,
        claimsKey: TEST_CLAIMS_KEY,
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      withRequestContext(alpha, async (tx) => tx`select 1 from cdf_notifications_v13.schema_migrations`, {
        sql,
        claimsKey: TEST_CLAIMS_KEY,
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("health probe: right login, own schema usable, foreign schemas absent on the primary", async () => {
    const probe = await probeDatabase(sql);
    expect(probe).toMatchObject({
      login_is_app_role: true,
      v13_schema_usage: true,
      isolated_from: { auth: "absent", storage: "absent", vault: "absent", cdf: "absent" },
    });
    expect(probe.server_version_num).toBeGreaterThanOrEqual(160000);
    expect(isProbeHealthy(probe)).toBe(true);
  });

  it("isolation probe passes on the primary layout too", async () => {
    const checks = isolationChecks(await runIsolationProbe(sql));
    expect(isolationVerdict(checks)).toBe("PASS");
    expect(checks.set_role.allowed).toBe(1);
  });
});
