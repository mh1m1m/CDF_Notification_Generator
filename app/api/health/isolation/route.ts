// GET /api/health/isolation — the database isolation probe (lib/db/isolation-probe.ts). Disabled (404) unless
// V13_ISOLATION_PROBE=enabled. Runs as the app login in one transaction that is rolled back and returns counts only:
// never object names, row data or error text. 200 for PASS, 503 for FAIL or when the database cannot be reached.
import { NextResponse } from "next/server";
import { commitSha } from "@/lib/build-info";
import { isDatabaseConfigured } from "@/lib/db/client";
import {
  isolationChecks,
  isolationVerdict,
  runIsolationProbe,
  type IsolationChecks,
} from "@/lib/db/isolation-probe";
import { logServerError } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

export type IsolationBody =
  | { verdict: "PASS" | "FAIL"; checks: IsolationChecks; commit: string; correlation_id: string }
  | {
      verdict: "FAIL";
      error: "DB_NOT_CONFIGURED" | "DB_UNAVAILABLE";
      commit: string;
      correlation_id: string;
    };

export async function GET(): Promise<Response> {
  if (process.env.V13_ISOLATION_PROBE !== "enabled") {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const correlationId = crypto.randomUUID();
  const headers = { "cache-control": "no-store", "x-correlation-id": correlationId };
  const commit = commitSha();

  if (!isDatabaseConfigured()) {
    return NextResponse.json<IsolationBody>(
      { verdict: "FAIL", error: "DB_NOT_CONFIGURED", commit, correlation_id: correlationId },
      { status: 503, headers },
    );
  }
  try {
    const checks = isolationChecks(await runIsolationProbe());
    const verdict = isolationVerdict(checks);
    return NextResponse.json<IsolationBody>(
      { verdict, checks, commit, correlation_id: correlationId },
      { status: verdict === "PASS" ? 200 : 503, headers },
    );
  } catch (error) {
    logServerError("health.isolation_probe_failed", correlationId, error);
    return NextResponse.json<IsolationBody>(
      { verdict: "FAIL", error: "DB_UNAVAILABLE", commit, correlation_id: correlationId },
      { status: 503, headers },
    );
  }
}
