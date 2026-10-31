// Per-transaction security context: exact claims JSON, the claims MAC, the key install, the order of the statements,
// bound parameters only, and refusal of invalid identities before any SQL runs. The database side (MAC verification,
// forged and replayed claims) is covered by tests/integration/security-context.spec.ts.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { RequestIdentitySchema, type RequestIdentity } from "@/lib/contracts";
import type { Sql } from "@/lib/db/client";
import {
  ClaimsKeyError,
  claimsMac,
  ensureClaimsKey,
  REQUEST_ROLE,
  requestClaims,
  withRequestContext,
  type Tx,
} from "@/lib/db/security-context";

const ALPHA = "0b000000-0000-4000-8000-000000000001";
const DELTA = "0b000000-0000-4000-8000-000000000004";
const CORRELATION = "6f1c2a9e-3b7d-4c1e-9a2f-0d8e7b6a5c41";
/** Synthetic test key; never a deployed value. */
const KEY = new Uint8Array(32).fill(0x5a);
const OTHER_KEY = new Uint8Array(32).fill(0x33);
const XID = "7421";

const alpha: RequestIdentity = RequestIdentitySchema.parse({
  persona_id: ALPHA,
  active_workspace: "SECRETARIAT",
  roles: ["COMMITTEE_SECRETARY"],
});

interface Call {
  text: string;
  values: unknown[];
}

interface FakeOptions {
  /** Result of api_install_claims_key (default INSTALLED). */
  install?: string;
  /** Error raised by api_install_claims_key, if any. */
  installError?: unknown;
}

/**
 * A stand-in for postgres.js: records each tagged-template call, grouped by transaction. Answers the transaction-id
 * query and the key install; everything else returns no rows. No `unsafe` member exists.
 */
function fakeSql(options: FakeOptions = {}) {
  const transactions: Call[][] = [];
  const begin = vi.fn(async (fn: (t: Tx) => Promise<unknown>) => {
    const calls: Call[] = [];
    transactions.push(calls);
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("$?").replace(/\s+/g, " ").trim();
      calls.push({ text, values });
      if (text.includes("pg_current_xact_id")) return Promise.resolve([{ xid: XID }]);
      if (text.includes("api_install_claims_key")) {
        if (options.installError) return Promise.reject(options.installError);
        return Promise.resolve([{ result: options.install ?? "INSTALLED" }]);
      }
      return Promise.resolve([]);
    }) as unknown as Tx;
    return fn(tx);
  });
  return { sql: { begin } as unknown as Sql, begin, transactions };
}

describe("requestClaims", () => {
  it("is exactly {v, persona_id, workspace_id, correlation_id} with the workspace's seed UUID", () => {
    expect(requestClaims(alpha, CORRELATION)).toBe(
      `{"v":1,"persona_id":"${ALPHA}","workspace_id":"0a000000-0000-4000-8000-000000000001","correlation_id":"${CORRELATION}"}`,
    );
    const delta = RequestIdentitySchema.parse({
      persona_id: DELTA,
      active_workspace: "GOVERNANCE",
      roles: ["GOVERNANCE_OFFICER"],
    });
    expect(JSON.parse(requestClaims(delta, CORRELATION))).toEqual({
      v: 1,
      persona_id: DELTA,
      workspace_id: "0a000000-0000-4000-8000-000000000003",
      correlation_id: CORRELATION,
    });
  });

  it("never carries roles: the database derives them from its membership rows", () => {
    expect(Object.keys(JSON.parse(requestClaims(alpha, CORRELATION)))).toEqual([
      "v",
      "persona_id",
      "workspace_id",
      "correlation_id",
    ]);
  });

  it("refuses identities and correlation ids that do not match the contracts", () => {
    const bad: unknown[] = [
      { ...alpha, persona_id: "not-a-uuid" },
      { ...alpha, persona_id: ALPHA.toUpperCase() },
      { ...alpha, active_workspace: "PUBLIC" },
      { ...alpha, roles: [] },
      { ...alpha, roles: ["SUPERUSER"] },
      { ...alpha, extra: "x" },
    ];
    for (const identity of bad)
      expect(() => requestClaims(identity as RequestIdentity, CORRELATION)).toThrow();
    expect(() => requestClaims(alpha, "')); drop table x; --")).toThrow();
  });
});

describe("claimsMac", () => {
  it("is base64url HMAC-SHA256 over claims|xid with no padding", () => {
    const claims = requestClaims(alpha, CORRELATION);
    const expected = createHmac("sha256", KEY).update(`${claims}|${XID}`).digest("base64url");
    expect(claimsMac(KEY, claims, XID)).toBe(expected);
    expect(claimsMac(KEY, claims, XID)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("changes with the key, the claims and the transaction id", () => {
    const claims = requestClaims(alpha, CORRELATION);
    const mac = claimsMac(KEY, claims, XID);
    expect(claimsMac(OTHER_KEY, claims, XID)).not.toBe(mac);
    expect(claimsMac(KEY, claims.replace(ALPHA, DELTA), XID)).not.toBe(mac);
    expect(claimsMac(KEY, claims, "7422")).not.toBe(mac);
  });

  it("refuses a transaction id that is not a decimal number", () => {
    const claims = requestClaims(alpha, CORRELATION);
    for (const xid of ["", "-1", "1|2", "12a", "1".repeat(21)])
      expect(() => claimsMac(KEY, claims, xid)).toThrow();
  });
});

describe("ensureClaimsKey", () => {
  it("installs the key once per client and key, as cdf_v13_user, with the key as a bound parameter", async () => {
    const { sql, begin, transactions } = fakeSql();
    await ensureClaimsKey(sql, KEY);
    await ensureClaimsKey(sql, KEY);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(transactions[0]).toEqual([
      { text: "select pg_catalog.set_config('role', $?, true)", values: [REQUEST_ROLE] },
      {
        text: "select cdf_notifications_v13.api_install_claims_key($?) as result",
        values: [Buffer.from(KEY)],
      },
    ]);
  });

  it("accepts ALREADY_INSTALLED for the same key", async () => {
    const { sql } = fakeSql({ install: "ALREADY_INSTALLED" });
    await expect(ensureClaimsKey(sql, KEY)).resolves.toBeUndefined();
  });

  it("turns V1409 (a different key is installed) into ClaimsKeyError and retries next time", async () => {
    const { sql, begin } = fakeSql({ installError: Object.assign(new Error("db"), { code: "V1409" }) });
    await expect(ensureClaimsKey(sql, KEY)).rejects.toBeInstanceOf(ClaimsKeyError);
    await expect(ensureClaimsKey(sql, KEY)).rejects.toBeInstanceOf(ClaimsKeyError);
    expect(begin).toHaveBeenCalledTimes(2);
  });

  it("refuses an unexpected install result", async () => {
    const { sql } = fakeSql({ install: "SOMETHING_ELSE" });
    await expect(ensureClaimsKey(sql, KEY)).rejects.toBeInstanceOf(ClaimsKeyError);
  });

  it("passes other database errors through unchanged", async () => {
    const failure = Object.assign(new Error("db down"), { code: "08006" });
    const { sql } = fakeSql({ installError: failure });
    await expect(ensureClaimsKey(sql, KEY)).rejects.toBe(failure);
  });
});

describe("withRequestContext", () => {
  it("installs the key, then reads the xid, then sets claims, MAC and role in one statement, then runs the work", async () => {
    const { sql, begin, transactions } = fakeSql();
    const work = vi.fn(async () => "result");
    await expect(
      withRequestContext(alpha, work, { sql, correlationId: CORRELATION, claimsKey: KEY }),
    ).resolves.toBe("result");
    expect(begin).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledTimes(1);
    const claims = requestClaims(alpha, CORRELATION);
    expect(transactions[1]).toEqual([
      { text: "select pg_catalog.pg_current_xact_id()::text as xid", values: [] },
      {
        text:
          "select pg_catalog.set_config('request.v13.claims', $?, true), " +
          "pg_catalog.set_config('request.v13.claims_mac', $?, true), " +
          "pg_catalog.set_config('role', $?, true)",
        values: [claims, claimsMac(KEY, claims, XID), REQUEST_ROLE],
      },
    ]);
  });

  it("installs the key only once across requests on the same client", async () => {
    const { sql, begin } = fakeSql();
    await withRequestContext(alpha, async () => undefined, { sql, claimsKey: KEY });
    await withRequestContext(alpha, async () => undefined, { sql, claimsKey: KEY });
    expect(begin).toHaveBeenCalledTimes(3);
  });

  it("passes claims and MAC as bound parameters, never as SQL text", async () => {
    const { sql, transactions } = fakeSql();
    await withRequestContext(alpha, async () => undefined, {
      sql,
      correlationId: CORRELATION,
      claimsKey: KEY,
    });
    for (const call of transactions.flat()) {
      expect(call.text).not.toContain(ALPHA);
      expect(call.text).not.toContain(CORRELATION);
      expect(call.text).not.toContain(XID);
    }
  });

  it("generates a random correlation id when none is given", async () => {
    const { sql, transactions } = fakeSql();
    await withRequestContext(alpha, async () => undefined, { sql, claimsKey: KEY });
    await withRequestContext(alpha, async () => undefined, { sql, claimsKey: KEY });
    const ids = [transactions[1], transactions[2]].map(
      (t) => JSON.parse(String(t?.[1]?.values[0])).correlation_id as string,
    );
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("refuses an invalid identity or correlation id before opening a transaction", async () => {
    const { sql, begin } = fakeSql();
    const work = vi.fn(async () => "never");
    await expect(
      withRequestContext({ ...alpha, roles: [] } as unknown as RequestIdentity, work, {
        sql,
        claimsKey: KEY,
      }),
    ).rejects.toThrow();
    await expect(
      withRequestContext(alpha, work, { sql, correlationId: "x", claimsKey: KEY }),
    ).rejects.toThrow();
    expect(begin).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it("does not run the work when the key install is refused", async () => {
    const { sql } = fakeSql({ installError: Object.assign(new Error("db"), { code: "V1409" }) });
    const work = vi.fn(async () => "never");
    await expect(withRequestContext(alpha, work, { sql, claimsKey: KEY })).rejects.toBeInstanceOf(
      ClaimsKeyError,
    );
    expect(work).not.toHaveBeenCalled();
  });

  it("propagates a failure of the work, so the driver rolls the transaction back", async () => {
    const { sql } = fakeSql();
    const failure = new Error("work failed");
    await expect(
      withRequestContext(
        alpha,
        async () => {
          throw failure;
        },
        { sql, correlationId: CORRELATION, claimsKey: KEY },
      ),
    ).rejects.toBe(failure);
  });
});
