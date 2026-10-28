// Claims-key install at server start (ADR-014 §4), called from instrumentation.ts before any request is served.
//
// Installs the request-claims key once (api_install_claims_key: INSTALLED, or ALREADY_INSTALLED for the same key).
// It never throws, because a throw in register() would take down every route, health included:
//   - database not configured (no V13_DATABASE_URL) or session secret unusable: does nothing (status SKIPPED_*);
//   - a different key in the database (ClaimsKeyError) or a connection failure (bounded by the client's 10 s connect
//     timeout): logs ONE line with a code only (never the URL, the key, the secret or an error message) and returns.
//     Requests then fail closed: their claims MAC does not verify, so they see nothing, and withRequestContext
//     retries the install on the next request.
// Rotation after a mismatch: database/hosted/reset_claims_key.sql (Chief Architect), then redeploy.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production holds the key in CDF KMS; there is no install from the application.
import "server-only";
import { isSessionConfigured } from "@/lib/auth/session";
import { requestClaimsKey } from "@/lib/auth/claims-key";
import { getSql, isDatabaseConfigured, type Sql } from "./client";
import { ClaimsKeyError, ensureClaimsKey } from "./security-context";

export type ClaimsKeyStartupStatus =
  "INSTALLED_OR_PRESENT" | "SKIPPED_DB_NOT_CONFIGURED" | "SKIPPED_SESSION_NOT_CONFIGURED" | "FAILED";

export interface ClaimsKeyStartupDeps {
  env: Readonly<Record<string, string | undefined>>;
  getSql: (env: Readonly<Record<string, string | undefined>>) => Sql;
  claimsKey: (env: Readonly<Record<string, string | undefined>>) => Uint8Array;
  ensure: (sql: Sql, key: Uint8Array) => Promise<void>;
  log: (line: string) => void;
}

const defaultDeps: ClaimsKeyStartupDeps = {
  env: process.env,
  getSql: (env) => getSql(env),
  claimsKey: (env) => requestClaimsKey(env),
  ensure: ensureClaimsKey,
  log: (line) => console.error(line),
};

/** Short code for the log line: never a message, URL or value. */
function failureCode(error: unknown): string {
  if (error instanceof ClaimsKeyError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
  return "CLAIMS_KEY_INSTALL_FAILED";
}

export async function installClaimsKeyAtStartup(
  deps: Partial<ClaimsKeyStartupDeps> = {},
): Promise<ClaimsKeyStartupStatus> {
  const d = { ...defaultDeps, ...deps };
  try {
    if (!isDatabaseConfigured(d.env)) return "SKIPPED_DB_NOT_CONFIGURED";
    if (!isSessionConfigured(d.env)) return "SKIPPED_SESSION_NOT_CONFIGURED";
    await d.ensure(d.getSql(d.env), d.claimsKey(d.env));
    return "INSTALLED_OR_PRESENT";
  } catch (error) {
    try {
      d.log(JSON.stringify({ event: "claims_key_install", code: failureCode(error) }));
    } catch {
      // Logging must not throw either.
    }
    return "FAILED";
  }
}
