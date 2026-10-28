// Per-transaction security context: exact claims JSON, order of the two settings, bound parameters only, and refusal
// of invalid identities before any SQL runs. The database side is covered by tests/integration/security-context.spec.ts.
import { describe, expect, it, vi } from "vitest";
import { RequestIdentitySchema, type RequestIdentity } from "@/lib/contracts";
import type { Sql } from "@/lib/db/client";
import {
  CLAIMS_SETTING,
  REQUEST_ROLE,
  requestClaims,
  withRequestContext,
  type Tx,
} from "@/lib/db/security-context";

const ALPHA = "0b000000-0000-4000-8000-000000000001";
const DELTA = "0b000000-0000-4000-8000-000000000004";
const CORRELATION = "6f1c2a9e-3b7d-4c1e-9a2f-0d8e7b6a5c41";

const alpha: RequestIdentity = RequestIdentitySchema.parse({
  persona_id: ALPHA,
  active_workspace: "SECRETARIAT",
  roles: ["COMMITTEE_SECRETARY"],
});

interface Call {
  text: string;
  values: unknown[];
}

/** A stand-in for postgres.js: records each tagged-template call of the transaction. No `unsafe` member exists. */
function fakeSql(result: unknown[] = []) {
  const calls: Call[] = [];
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("$?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(result);
  }) as unknown as Tx;
  const begin = vi.fn(async (fn: (t: Tx) => Promise<unknown>) => fn(tx));
  return { sql: { begin } as unknown as Sql, begin, calls, tx };
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

describe("withRequestContext", () => {
  it("sets the claims, then SET LOCAL ROLE cdf_v13_user, then runs the work in the same transaction", async () => {
    const { sql, begin, calls, tx } = fakeSql();
    const work = vi.fn(async (t: Tx) => {
      expect(t).toBe(tx);
      return "result";
    });
    await expect(withRequestContext(alpha, work, { sql, correlationId: CORRELATION })).resolves.toBe(
      "result",
    );
    expect(begin).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      {
        text: `select pg_catalog.set_config('${CLAIMS_SETTING}', $?, true)`,
        values: [requestClaims(alpha, CORRELATION)],
      },
      { text: `set local role ${REQUEST_ROLE}`, values: [] },
    ]);
  });

  it("passes the claims as one bound parameter, never as SQL text", async () => {
    const { sql, calls } = fakeSql();
    await withRequestContext(alpha, async () => undefined, { sql, correlationId: CORRELATION });
    for (const call of calls) {
      expect(call.text).not.toContain(ALPHA);
      expect(call.text).not.toContain(CORRELATION);
    }
    expect(calls[0]?.values).toHaveLength(1);
  });

  it("generates a random correlation id when none is given", async () => {
    const { sql, calls } = fakeSql();
    await withRequestContext(alpha, async () => undefined, { sql });
    await withRequestContext(alpha, async () => undefined, { sql });
    const ids = [calls[0], calls[2]].map((c) => JSON.parse(String(c?.values[0])).correlation_id as string);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("refuses an invalid identity or correlation id before opening a transaction", async () => {
    const { sql, begin } = fakeSql();
    const work = vi.fn(async () => "never");
    await expect(
      withRequestContext({ ...alpha, roles: [] } as unknown as RequestIdentity, work, { sql }),
    ).rejects.toThrow();
    await expect(withRequestContext(alpha, work, { sql, correlationId: "x" })).rejects.toThrow();
    expect(begin).not.toHaveBeenCalled();
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
        { sql, correlationId: CORRELATION },
      ),
    ).rejects.toBe(failure);
  });
});
