// V13-DB-009 (OI-022) — migration 0007: claims_key_state and the claims-key code in GET /api/health.
// All three states, forged and replayed probes, the request role cannot read claims_key, the app login cannot call the
// function, and neither the health response nor any log line carries key bytes. Key changes happen only inside
// rolled-back transactions; the shared test key stays installed.
import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { requestClaimsKey } from "@/lib/auth/claims-key";
import { closeSql } from "@/lib/db/client";
import { claimsKeyProbe, isProbeHealthy, probeDatabase, probeStatus } from "@/lib/db/health-probe";
import { claimsMac, type Tx } from "@/lib/db/security-context";
import { TEST_CLAIMS_KEY, TEST_SESSION_SECRET } from "./support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL, PRIMARY_APP_URL } from "./support/clusters";
import {
  adminClient,
  appClient,
  asOwner,
  asPersona,
  asRaw,
  claimsText,
  PERSONA,
  WORKSPACE,
} from "./support/context";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function ready(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean }[]>`
      select pg_catalog.to_regprocedure('cdf_notifications_v13.claims_key_state(text)') is not null as present`;
    return Boolean(row?.present);
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const present = await ready();
if (available && !present) console.warn("[integration] skipping claims-key-state: migration 0007 missing");

/** Synthetic, test-only secrets and keys (never used outside tests). */
const OTHER_SESSION_SECRET = Buffer.alloc(32, 0x3c).toString("base64url");
const OTHER_KEY = requestClaimsKey({ V13_SESSION_SECRET: OTHER_SESSION_SECRET });

async function xidOf(tx: Tx): Promise<string> {
  const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
  return row!.xid;
}

async function stateOf(tx: Tx, probe: string | null): Promise<string> {
  const [row] = await tx<{ state: string }[]>`
    select cdf_notifications_v13.claims_key_state(${probe}::text) as state`;
  return row!.state;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return String((error as { code?: unknown }).code ?? "UNKNOWN");
  }
}

/** Every encoding of a key or secret a leak could take. */
function encodings(bytes: Uint8Array | string): string[] {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "base64url") : Buffer.from(bytes);
  return [
    buf.toString("hex"),
    buf.toString("base64"),
    buf.toString("base64url"),
    ...(typeof bytes === "string" ? [bytes] : []),
  ];
}

describe.skipIf(!present)("claims_key_state and the health claims-key code (V13-DB-009)", () => {
  let app: postgres.Sql;
  let admin: postgres.Sql;

  beforeAll(async () => {
    app = appClient();
    admin = adminClient();
    await asPersona(app, PERSONA.alpha, "SECRETARIAT", async () => undefined); // installs the test key if needed
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeSql();
    await app.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  describe("the three states", () => {
    it("INSTALLED_MATCH: the probe for this transaction under the installed key", async () => {
      const state = await asRaw(app, {}, async (tx) =>
        stateOf(tx, claimsKeyProbe(TEST_CLAIMS_KEY, await xidOf(tx))),
      );
      expect(state).toBe("INSTALLED_MATCH");

      const probe = await probeDatabase(app, { claimsKey: TEST_CLAIMS_KEY });
      expect(probe.claims_key).toBe("INSTALLED_MATCH");
      expect(isProbeHealthy(probe)).toBe(true);
    });

    it("INSTALLED_MISMATCH: a probe under another deployment's key", async () => {
      const state = await asRaw(app, {}, async (tx) =>
        stateOf(tx, claimsKeyProbe(OTHER_KEY, await xidOf(tx))),
      );
      expect(state).toBe("INSTALLED_MISMATCH");

      const probe = await probeDatabase(app, { claimsKey: OTHER_KEY });
      expect(probe.claims_key).toBe("INSTALLED_MISMATCH");
      expect(probeStatus(probe)).toBe("CLAIMS_KEY_MISMATCH");
    });

    it("NOT_INSTALLED: no key row, whatever the probe (key cleared and rolled back)", async () => {
      const states = await asOwner(admin, async (tx) => {
        await tx`delete from cdf_notifications_v13.claims_key where key_version = 1`;
        await tx.unsafe("set local role cdf_v13_user");
        const xid = await xidOf(tx);
        return [
          await stateOf(tx, claimsKeyProbe(TEST_CLAIMS_KEY, xid)),
          await stateOf(tx, "forged"),
          await stateOf(tx, null),
        ];
      });
      expect(states).toEqual(["NOT_INSTALLED", "NOT_INSTALLED", "NOT_INSTALLED"]);
    });

    it("after a rotation (old key cleared, new key installed; rolled back) the old key mismatches and the new matches", async () => {
      const states = await asOwner(admin, async (tx) => {
        await tx`delete from cdf_notifications_v13.claims_key where key_version = 1`;
        await tx`select cdf_notifications_v13.api_install_claims_key(${Buffer.from(OTHER_KEY)})`;
        await tx.unsafe("set local role cdf_v13_user");
        const xid = await xidOf(tx);
        return [
          await stateOf(tx, claimsKeyProbe(TEST_CLAIMS_KEY, xid)),
          await stateOf(tx, claimsKeyProbe(OTHER_KEY, xid)),
        ];
      });
      expect(states).toEqual(["INSTALLED_MISMATCH", "INSTALLED_MATCH"]);
      // The rotation was rolled back: the shared test key still matches.
      expect((await probeDatabase(app, { claimsKey: TEST_CLAIMS_KEY })).claims_key).toBe("INSTALLED_MATCH");
    });
  });

  describe("forged and replayed probes", () => {
    it("are INSTALLED_MISMATCH: null, empty, garbage, padded, other transaction, other label, a claims MAC", async () => {
      const states = await asRaw(app, {}, async (tx) => {
        const xid = await xidOf(tx);
        const valid = claimsKeyProbe(TEST_CLAIMS_KEY, xid);
        const previousXid = String(BigInt(xid) - 1n);
        const forged = [
          null,
          "",
          "A".repeat(43),
          `${valid}=`,
          ` ${valid}`,
          valid.toUpperCase() === valid ? valid.toLowerCase() : valid.toUpperCase(),
          claimsKeyProbe(TEST_CLAIMS_KEY, previousXid), // replay of an earlier transaction's probe
          claimsMac(TEST_CLAIMS_KEY, "cdf-v13/claims-key-probe/v2", xid), // other label
          claimsMac(TEST_CLAIMS_KEY, claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), xid), // a claims MAC
        ];
        const out: string[] = [];
        for (const p of forged) out.push(await stateOf(tx, p));
        out.push(await stateOf(tx, valid)); // control
        return out;
      });
      expect(states.slice(0, -1).every((s) => s === "INSTALLED_MISMATCH")).toBe(true);
      expect(states.at(-1)).toBe("INSTALLED_MATCH");
    });

    it("a valid probe is not a valid claims MAC: it never yields a persona", async () => {
      const persona = await asRaw(app, {}, async (tx) => {
        const probeText = "cdf-v13/claims-key-probe/v1";
        await tx`select pg_catalog.set_config('request.v13.claims', ${probeText}, true),
                        pg_catalog.set_config('request.v13.claims_mac',
                          ${claimsKeyProbe(TEST_CLAIMS_KEY, await xidOf(tx))}, true)`;
        const [row] = await tx<
          { persona: string | null }[]
        >`select cdf_notifications_v13.current_persona_id() as persona`;
        return row?.persona ?? null;
      });
      expect(persona).toBeNull();
    });
  });

  describe("privileges", () => {
    it("the request role cannot read claims_key (42501)", async () => {
      const code = await asRaw(app, {}, async (tx) =>
        codeOf(tx`select key_version from cdf_notifications_v13.claims_key`),
      );
      expect(code).toBe("42501");
    });

    it("the app login cannot call claims_key_state without the request role (42501)", async () => {
      expect(await codeOf(app`select cdf_notifications_v13.claims_key_state('x')`)).toBe("42501");
    });

    it("only cdf_v13_user holds EXECUTE; the function is a definer owned by cdf_v13_owner with search_path ''", async () => {
      const [row] = await admin<
        {
          definer: boolean;
          owner: string;
          config: string[] | null;
          app: boolean;
          user: boolean;
          volatility: string;
        }[]
      >`
        select p.prosecdef as definer, pg_catalog.pg_get_userbyid(p.proowner) as owner, p.proconfig as config,
               p.provolatile::text as volatility,
               pg_catalog.has_function_privilege('cdf_v13_app', p.oid, 'EXECUTE') as app,
               pg_catalog.has_function_privilege('cdf_v13_user', p.oid, 'EXECUTE') as user
          from pg_catalog.pg_proc p
         where p.oid = 'cdf_notifications_v13.claims_key_state(text)'::regprocedure`;
      expect(row).toEqual({
        definer: true,
        owner: "cdf_v13_owner",
        config: ['search_path=""'],
        volatility: "s",
        app: false,
        user: true,
      });
    });

    it("writes no audit row per call", async () => {
      const count = async () => {
        const [row] = await admin<
          { n: number }[]
        >`select count(*)::int as n from cdf_notifications_v13.audit_event`;
        return row!.n;
      };
      const before = await count();
      for (let i = 0; i < 3; i++) await probeDatabase(app, { claimsKey: TEST_CLAIMS_KEY });
      expect(await count()).toBe(before);
    });
  });

  describe("GET /api/health", () => {
    async function health(secret: string) {
      vi.stubEnv("V13_DATABASE_URL", PRIMARY_APP_URL);
      vi.stubEnv("V13_SESSION_SECRET", secret);
      await closeSql();
      const logs: string[] = [];
      for (const method of ["log", "info", "warn", "error", "debug"] as const)
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          logs.push(args.map(String).join(" "));
        });
      try {
        const response = await (await import("@/app/api/health/route")).GET();
        const text = await response.text();
        return {
          status: response.status,
          text,
          body: JSON.parse(text) as { db: Record<string, unknown> },
          logs,
        };
      } finally {
        await closeSql();
      }
    }

    it("200 with db.claims_key INSTALLED_MATCH for this deployment's secret; no key bytes in the response or logs", async () => {
      const { status, text, body, logs } = await health(TEST_SESSION_SECRET);
      expect(status).toBe(200);
      expect(body.db).toMatchObject({ status: "ok", claims_key: "INSTALLED_MATCH" });
      for (const leak of [...encodings(TEST_CLAIMS_KEY), ...encodings(TEST_SESSION_SECRET)]) {
        expect(text).not.toContain(leak);
        for (const line of logs) expect(line).not.toContain(leak);
      }
    });

    it("503 degraded with CLAIMS_KEY_MISMATCH for another secret; no key bytes in the response or logs", async () => {
      const { status, text, body, logs } = await health(OTHER_SESSION_SECRET);
      expect(status).toBe(503);
      expect(body).toMatchObject({
        status: "degraded",
        db: { status: "CLAIMS_KEY_MISMATCH", claims_key: "INSTALLED_MISMATCH" },
      });
      for (const leak of [
        ...encodings(OTHER_KEY),
        ...encodings(OTHER_SESSION_SECRET),
        ...encodings(TEST_CLAIMS_KEY),
      ]) {
        expect(text).not.toContain(leak);
        for (const line of logs) expect(line).not.toContain(leak);
      }
    });
  });
});
