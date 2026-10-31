// Claims-key install at server start (lib/db/claims-key-startup.ts): no-op when the database or the session secret is
// not configured, exactly one install when both are, never throws, and the one log line carries a code only (no URL,
// key, secret or message). The instrumentation.ts hook is tested in instrumentation.spec.ts.
import { describe, expect, it, vi } from "vitest";
import type { Sql } from "@/lib/db/client";
import { installClaimsKeyAtStartup } from "@/lib/db/claims-key-startup";
import { ClaimsKeyError } from "@/lib/db/security-context";

/** Synthetic, test-only values; never deployed. */
const SECRET = Buffer.alloc(32, 0x5a).toString("base64url");
const URL_WITH_PASSWORD = "postgres://cdf_v13_app:synthetic-not-a-secret@db.example.test:6543/postgres";
const CONFIGURED = { V13_DATABASE_URL: URL_WITH_PASSWORD, V13_SESSION_SECRET: SECRET };
const FAKE_SQL = { fake: true } as unknown as Sql;

function deps(env: Record<string, string | undefined>, ensure = vi.fn(async () => undefined)) {
  const log = vi.fn((_line: string) => undefined);
  const getSql = vi.fn(() => FAKE_SQL);
  return { env, ensure, log, getSql };
}

describe("installClaimsKeyAtStartup", () => {
  it("does nothing when the database is not configured (the develop deployment today)", async () => {
    const d = deps({ V13_SESSION_SECRET: SECRET });
    await expect(installClaimsKeyAtStartup(d)).resolves.toBe("SKIPPED_DB_NOT_CONFIGURED");
    expect(d.getSql).not.toHaveBeenCalled();
    expect(d.ensure).not.toHaveBeenCalled();
    expect(d.log).not.toHaveBeenCalled();
  });

  it("does nothing when the session secret is missing or unusable", async () => {
    for (const secret of [undefined, "", "not base64url!", Buffer.alloc(8).toString("base64url")]) {
      const d = deps({ V13_DATABASE_URL: URL_WITH_PASSWORD, V13_SESSION_SECRET: secret });
      await expect(installClaimsKeyAtStartup(d)).resolves.toBe("SKIPPED_SESSION_NOT_CONFIGURED");
      expect(d.ensure).not.toHaveBeenCalled();
      expect(d.log).not.toHaveBeenCalled();
    }
  });

  it("installs exactly once with the shared client and the key derived from the session secret", async () => {
    const d = deps(CONFIGURED);
    await expect(installClaimsKeyAtStartup(d)).resolves.toBe("INSTALLED_OR_PRESENT");
    expect(d.getSql).toHaveBeenCalledTimes(1);
    expect(d.ensure).toHaveBeenCalledTimes(1);
    const [sql, key] = d.ensure.mock.calls[0] as unknown as [Sql, Uint8Array];
    expect(sql).toBe(FAKE_SQL);
    expect(Buffer.from(key).toString("hex")).toBe(
      "a2bee1a0e1c614f648933bf27cb65854ba220fbfd0b45d5ccc41b0dd9bd2af87",
    );
    expect(d.log).not.toHaveBeenCalled();
  });

  const failures: [string, unknown, string][] = [
    [
      "a different key in the database",
      new ClaimsKeyError("the database holds a different claims key"),
      "CLAIMS_KEY_MISMATCH",
    ],
    [
      "a refused connection",
      Object.assign(new Error(`connect ECONNREFUSED ${URL_WITH_PASSWORD}`), { code: "ECONNREFUSED" }),
      "ECONNREFUSED",
    ],
    [
      "a database error",
      Object.assign(new Error("password authentication failed for synthetic-not-a-secret"), {
        code: "28P01",
      }),
      "28P01",
    ],
    ["an error without a usable code", new Error(`boom ${SECRET}`), "CLAIMS_KEY_INSTALL_FAILED"],
    ["a thrown non-error", `raw ${SECRET}`, "CLAIMS_KEY_INSTALL_FAILED"],
  ];

  it.each(failures)("never throws on %s and logs one code-only line", async (_name, error, code) => {
    const d = deps(
      CONFIGURED,
      vi.fn(async () => Promise.reject(error)),
    );
    await expect(installClaimsKeyAtStartup(d)).resolves.toBe("FAILED");
    expect(d.log).toHaveBeenCalledTimes(1);
    const line = String(d.log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({ event: "claims_key_install", code });
    for (const secret of [SECRET, "synthetic-not-a-secret", "db.example.test", "a2bee1a0", "password"])
      expect(line).not.toContain(secret);
  });

  it("never throws when getting the client throws, or when logging itself throws", async () => {
    const d = deps(CONFIGURED);
    d.getSql.mockImplementation(() => {
      throw Object.assign(new Error("V13_DATABASE_URL is not a valid URL"), { code: "DB_NOT_CONFIGURED" });
    });
    await expect(installClaimsKeyAtStartup(d)).resolves.toBe("FAILED");
    const quiet = deps(
      CONFIGURED,
      vi.fn(async () => Promise.reject(new Error("x"))),
    );
    quiet.log.mockImplementation(() => {
      throw new Error("stderr closed");
    });
    await expect(installClaimsKeyAtStartup(quiet)).resolves.toBe("FAILED");
  });
});
