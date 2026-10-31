// instrumentation.ts register(): installs the claims key once in the Node.js runtime, nothing elsewhere, and never
// throws, not even when the startup module fails to load. The install itself (no-op when unconfigured, never throws)
// is tested in claims-key-startup.spec.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const MODULE = "@/lib/db/claims-key-startup";

async function loadRegister(factory: () => Record<string, unknown>) {
  vi.resetModules();
  vi.doMock(MODULE, factory);
  return (await import("@/instrumentation")).register;
}

afterEach(() => {
  vi.doUnmock(MODULE);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("instrumentation.ts register()", () => {
  it("installs the claims key once in the Node.js runtime", async () => {
    const install = vi.fn(async () => "INSTALLED_OR_PRESENT");
    const register = await loadRegister(() => ({ installClaimsKeyAtStartup: install }));
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("does nothing in the Edge runtime or outside Next.js", async () => {
    const install = vi.fn(async () => "INSTALLED_OR_PRESENT");
    const register = await loadRegister(() => ({ installClaimsKeyAtStartup: install }));
    for (const runtime of ["edge", ""]) {
      vi.stubEnv("NEXT_RUNTIME", runtime);
      await register();
    }
    expect(install).not.toHaveBeenCalled();
  });

  it("never throws when the startup module fails to load, and logs one code-only line", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const register = await loadRegister(() => {
      throw new Error("Cannot find module postgres://cdf_v13_app:synthetic-not-a-secret@db.example.test");
    });
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await expect(register()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({ event: "claims_key_install", code: "CLAIMS_KEY_STARTUP_UNAVAILABLE" });
    expect(line).not.toContain("synthetic-not-a-secret");
  });

  it("never throws even if the install itself rejects or logging fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("stderr closed");
    });
    const register = await loadRegister(() => ({
      installClaimsKeyAtStartup: async () => Promise.reject(new Error("unexpected")),
    }));
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await expect(register()).resolves.toBeUndefined();
  });
});
