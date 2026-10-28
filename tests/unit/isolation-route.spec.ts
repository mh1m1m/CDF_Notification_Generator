// GET /api/health/isolation with the probe mocked (flag, status codes, counts only), plus the probe's own shaping:
// the static SQL, the forced rollback, result validation and the fail-closed verdict.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "@/lib/db/client";
import type * as IsolationProbe from "@/lib/db/isolation-probe";
import type { IsolationProbeCounts } from "@/lib/db/isolation-probe";

const db = vi.hoisted(() => ({
  configured: true,
  run: vi.fn<() => Promise<IsolationProbeCounts>>(),
}));

vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => db.configured, getSql: () => undefined }));
vi.mock("@/lib/db/isolation-probe", async (importOriginal) => ({
  ...(await importOriginal<typeof IsolationProbe>()),
  runIsolationProbe: db.run,
}));

const { GET } = await import("@/app/api/health/isolation/route");
const probe = await vi.importActual<typeof IsolationProbe>("@/lib/db/isolation-probe");

const passing: IsolationProbeCounts = {
  session_user_ok: true,
  set_role: { refused: 14, allowed: 1, unexpected: 0, user_allowed: true, inconclusive: 0 },
  foreign_select: {
    app: { refused: 9, allowed: 0, inconclusive: 0 },
    user: { refused: 9, allowed: 0, inconclusive: 0 },
  },
  foreign_create: { refused: 4, allowed: 0, inconclusive: 0 },
  own_schema: { usage: true },
};

beforeEach(() => {
  vi.stubEnv("V13_ISOLATION_PROBE", "enabled");
  db.configured = true;
  db.run.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/health/isolation", () => {
  it("is 404 with an empty body unless V13_ISOLATION_PROBE is exactly 'enabled'", async () => {
    for (const flag of [undefined, "", "true", "ENABLED", "enabled "]) {
      if (flag === undefined) vi.stubEnv("V13_ISOLATION_PROBE", undefined);
      else vi.stubEnv("V13_ISOLATION_PROBE", flag);
      const response = await GET();
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(db.run).not.toHaveBeenCalled();
  });

  it("200 PASS with counts only", async () => {
    db.run.mockResolvedValue(passing);
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.verdict).toBe("PASS");
    expect(body.checks).toEqual(probe.isolationChecks(passing));
    expect(response.headers.get("x-correlation-id")).toBe(body.correlation_id);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual(["checks", "commit", "correlation_id", "verdict"]);
  });

  it("503 FAIL when any check fails", async () => {
    db.run.mockResolvedValue({
      ...passing,
      foreign_select: { ...passing.foreign_select, user: { refused: 8, allowed: 1, inconclusive: 0 } },
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).verdict).toBe("FAIL");
  });

  it("503 FAIL DB_NOT_CONFIGURED / DB_UNAVAILABLE without error details", async () => {
    db.configured = false;
    let response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ verdict: "FAIL", error: "DB_NOT_CONFIGURED" });

    db.configured = true;
    db.run.mockRejectedValue(
      Object.assign(new Error("relation auth.users: permission denied"), { code: "42501" }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    response = await GET();
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ verdict: "FAIL", error: "DB_UNAVAILABLE" });
    expect(text).not.toContain("auth.users");
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: "health.isolation_probe_failed",
      code: "42501",
    });
  });
});

describe("isolation verdict", () => {
  const verdict = (counts: IsolationProbeCounts) => probe.isolationVerdict(probe.isolationChecks(counts));

  it("passes only the clean baseline", () => {
    expect(verdict(passing)).toBe("PASS");
  });

  it.each<[string, IsolationProbeCounts]>([
    ["wrong login", { ...passing, session_user_ok: false }],
    ["extra SET ROLE target", { ...passing, set_role: { ...passing.set_role, allowed: 2, unexpected: 1 } }],
    [
      "cdf_v13_user not reachable",
      { ...passing, set_role: { ...passing.set_role, allowed: 0, user_allowed: false } },
    ],
    ["SET ROLE inconclusive", { ...passing, set_role: { ...passing.set_role, inconclusive: 1 } }],
    [
      "foreign select as the login",
      {
        ...passing,
        foreign_select: { ...passing.foreign_select, app: { refused: 8, allowed: 1, inconclusive: 0 } },
      },
    ],
    [
      "foreign select inconclusive",
      {
        ...passing,
        foreign_select: { ...passing.foreign_select, user: { refused: 8, allowed: 0, inconclusive: 1 } },
      },
    ],
    ["foreign create", { ...passing, foreign_create: { refused: 3, allowed: 1, inconclusive: 0 } }],
    [
      "foreign create inconclusive",
      { ...passing, foreign_create: { refused: 3, allowed: 0, inconclusive: 1 } },
    ],
    ["no usage on the V13 schema", { ...passing, own_schema: { usage: false } }],
  ])("fails closed: %s", (_name, counts) => {
    expect(verdict(counts)).toBe("FAIL");
  });
});

describe("runIsolationProbe", () => {
  /** Fake driver: the DO block returns nothing, the current_setting read returns `result`. */
  function fakeSql(result: string | null) {
    const calls: { text: string; values: unknown[] }[] = [];
    const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("$?");
      calls.push({ text, values });
      return Promise.resolve(text.includes("current_setting") ? [{ result }] : []);
    };
    let rolledBack = false;
    const sql = {
      begin: async (fn: (t: typeof tx) => Promise<unknown>) => {
        try {
          return await fn(tx);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    } as unknown as Sql;
    return { sql, calls, rolledBack: () => rolledBack };
  }

  it("runs one static block (no bound values, no interpolation), always rolls back, and validates the counts", async () => {
    const fake = fakeSql(JSON.stringify(passing));
    await expect(probe.runIsolationProbe(fake.sql)).resolves.toEqual(passing);
    expect(fake.rolledBack()).toBe(true);
    expect(fake.calls).toHaveLength(4);
    // Time limits first: the database is shared with GC Review.
    expect(fake.calls[0]?.text).toBe("set local lock_timeout = '2s'");
    expect(fake.calls[1]?.text).toBe("set local statement_timeout = '15s'");
    expect(fake.calls[2]?.text.trimStart().startsWith("do $v13_isolation_probe$")).toBe(true);
    expect(fake.calls[3]?.text).toContain("current_setting('v13.isolation_probe', true)");
    expect(fake.calls.every((c) => c.values.length === 0)).toBe(true);
  });

  it("fails when the block produced no result or an unexpected shape", async () => {
    await expect(probe.runIsolationProbe(fakeSql(null).sql)).rejects.toThrow(/no result/);
    await expect(
      probe.runIsolationProbe(fakeSql(JSON.stringify({ ...passing, extra: true })).sql),
    ).rejects.toThrow();
    await expect(
      probe.runIsolationProbe(
        fakeSql(JSON.stringify({ ...passing, foreign_create: { refused: -1, allowed: 0, inconclusive: 0 } }))
          .sql,
      ),
    ).rejects.toThrow();
  });
});
