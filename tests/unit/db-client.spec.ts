// Database client configuration: TLS required off loopback, no prepared statements (Supavisor transaction mode),
// bounded pool, and configuration errors that never echo the connection string.
import { afterEach, describe, expect, it } from "vitest";
import {
  closeSql,
  databaseClientOptions,
  DatabaseConfigError,
  getSql,
  isDatabaseConfigured,
} from "@/lib/db/client";

// Synthetic, never-valid connection strings (example.test is reserved; nothing here is a credential).
const REMOTE = "postgres://cdf_v13_app.synthetic:not-a-real-password@db.example.test:6543/postgres";
const LOCAL = "postgres://cdf_v13_app:local-only-not-a-secret@127.0.0.1:54329/v13_local";

afterEach(async () => {
  await closeSql();
});

describe("databaseClientOptions", () => {
  it("requires TLS for any non-loopback host and disables it only on loopback", () => {
    expect(databaseClientOptions(REMOTE, {}).ssl).toBe("require");
    expect(databaseClientOptions(LOCAL, {}).ssl).toBe(false);
    expect(databaseClientOptions("postgres://u@localhost/v13_local", {}).ssl).toBe(false);
    expect(databaseClientOptions("postgresql://u@[::1]:5432/v13_local", {}).ssl).toBe(false);
    expect(databaseClientOptions("postgres://u@127.0.0.1.example.test/v13", {}).ssl).toBe("require");
  });

  it("never prepares statements, names the application and swallows server notices", () => {
    const options = databaseClientOptions(REMOTE, {});
    expect(options.prepare).toBe(false);
    expect(options.connection).toEqual({ application_name: "cdf-v13-enterprise" });
    expect(options.onnotice()).toBeUndefined();
  });

  it("bounds the pool: default 3, V13_DB_POOL_MAX between 1 and 20", () => {
    expect(databaseClientOptions(REMOTE, {}).max).toBe(3);
    expect(databaseClientOptions(REMOTE, { V13_DB_POOL_MAX: "" }).max).toBe(3);
    expect(databaseClientOptions(REMOTE, { V13_DB_POOL_MAX: "1" }).max).toBe(1);
    expect(databaseClientOptions(REMOTE, { V13_DB_POOL_MAX: "20" }).max).toBe(20);
    for (const bad of ["0", "21", "-1", "1.5", "abc", "1e1"]) {
      expect(() => databaseClientOptions(REMOTE, { V13_DB_POOL_MAX: bad })).toThrow(DatabaseConfigError);
    }
  });

  it("refuses non-postgres and malformed URLs without echoing them", () => {
    for (const bad of [
      "mysql://u:secret-value@db.example.test/x",
      "not a url secret-value",
      "http://db.example.test",
    ]) {
      try {
        databaseClientOptions(bad, {});
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseConfigError);
        expect((error as DatabaseConfigError).code).toBe("DB_NOT_CONFIGURED");
        expect((error as Error).message).not.toContain("secret-value");
        expect((error as Error).message).not.toContain("db.example.test");
      }
    }
  });
});

describe("getSql", () => {
  it("is not configured without V13_DATABASE_URL", () => {
    expect(isDatabaseConfigured({})).toBe(false);
    expect(isDatabaseConfigured({ V13_DATABASE_URL: "   " })).toBe(false);
    expect(isDatabaseConfigured({ V13_DATABASE_URL: LOCAL })).toBe(true);
    expect(() => getSql({})).toThrow(DatabaseConfigError);
  });

  it("creates one shared client lazily (no connection until the first query) and closes it", async () => {
    const first = getSql({ V13_DATABASE_URL: LOCAL });
    expect(getSql({ V13_DATABASE_URL: LOCAL })).toBe(first);
    await closeSql();
    expect(() => getSql({})).toThrow(DatabaseConfigError);
  });
});
