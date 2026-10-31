// GET /api/health with the database probe mocked: response shape, status codes, headers, and no error details.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as HealthProbe from "@/lib/db/health-probe";
import type { DatabaseProbe } from "@/lib/db/health-probe";

const db = vi.hoisted(() => ({
  configured: true,
  probe: vi.fn<() => Promise<DatabaseProbe>>(),
}));

vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => db.configured }));
vi.mock("@/lib/db/health-probe", async (importOriginal) => ({
  ...(await importOriginal<typeof HealthProbe>()),
  probeDatabase: db.probe,
}));

const { GET } = await import("@/app/api/health/route");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const healthy: DatabaseProbe = {
  server_version_num: 170011,
  login_is_app_role: true,
  v13_schema_usage: true,
  isolated_from: { auth: true, storage: true, vault: true, cdf: "absent" },
  claims_key: "INSTALLED_MATCH",
};

beforeEach(() => {
  db.configured = true;
  db.probe.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function call() {
  const response = await GET();
  return {
    response,
    body: (await response.json()) as Record<string, unknown> & { db: Record<string, unknown> },
  };
}

describe("GET /api/health", () => {
  it("200 ok with the probe's booleans when the database is healthy", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
    db.probe.mockResolvedValue(healthy);
    const { response, body } = await call();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      app: "v13-enterprise",
      commit: "0123456789abcdef0123456789abcdef01234567",
      db: { status: "ok", ...healthy },
    });
    expect(body.correlation_id).toMatch(UUID);
    expect(response.headers.get("x-correlation-id")).toBe(body.correlation_id);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("503 ISOLATION_FAILED when the app login or the isolation is wrong", async () => {
    for (const probe of [
      { ...healthy, login_is_app_role: false },
      { ...healthy, v13_schema_usage: false },
      { ...healthy, isolated_from: { ...healthy.isolated_from, auth: false } },
      { ...healthy, isolated_from: { ...healthy.isolated_from, cdf: false } },
    ]) {
      db.probe.mockResolvedValue(probe);
      const { response, body } = await call();
      expect(response.status).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.db.status).toBe("ISOLATION_FAILED");
    }
  });

  it("503 when the claims key is another deployment's or missing; isolation failures are reported first", async () => {
    for (const [probe, status] of [
      [{ ...healthy, claims_key: "INSTALLED_MISMATCH" }, "CLAIMS_KEY_MISMATCH"],
      [{ ...healthy, claims_key: "NOT_INSTALLED" }, "CLAIMS_KEY_NOT_INSTALLED"],
      [{ ...healthy, claims_key: "INSTALLED_MISMATCH", login_is_app_role: false }, "ISOLATION_FAILED"],
    ] as const) {
      db.probe.mockResolvedValue(probe);
      const { response, body } = await call();
      expect(response.status).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.db).toMatchObject({ status, claims_key: probe.claims_key });
    }
  });

  it("200 with claims_key NOT_CHECKED when no session secret is configured", async () => {
    db.probe.mockResolvedValue({ ...healthy, claims_key: "NOT_CHECKED" });
    const { response, body } = await call();
    expect(response.status).toBe(200);
    expect(body.db).toMatchObject({ status: "ok", claims_key: "NOT_CHECKED" });
  });

  it("503 DB_NOT_CONFIGURED without a database URL, and never runs the probe", async () => {
    db.configured = false;
    const { response, body } = await call();
    expect(response.status).toBe(503);
    expect(body.db).toEqual({ status: "DB_NOT_CONFIGURED" });
    expect(db.probe).not.toHaveBeenCalled();
    expect(body.commit).toBe("local");
  });

  it("503 DB_UNAVAILABLE on a probe failure, logging only event, correlation id and code", async () => {
    const leak = "password authentication failed for user cdf_v13_app at db.example.test";
    db.probe.mockRejectedValue(Object.assign(new Error(leak), { code: "28P01" }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { response, body } = await call();
    expect(response.status).toBe(503);
    expect(body.db).toEqual({ status: "DB_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toContain("db.example.test");
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "health.db_probe_failed",
      correlation_id: body.correlation_id,
      code: "28P01",
    });
    expect(line).not.toContain("db.example.test");
  });
});
