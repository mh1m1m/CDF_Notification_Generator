// GET /api/health — liveness plus a database probe as the app login (lib/db/health-probe.ts). Public: it returns
// booleans, a server version number and the commit only. 200 when everything holds, 503 otherwise.
import { NextResponse } from "next/server";
import { APP_ID, commitSha } from "@/lib/build-info";
import { isDatabaseConfigured } from "@/lib/db/client";
import { isProbeHealthy, probeDatabase, type DatabaseProbe } from "@/lib/db/health-probe";
import { logServerError } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

type DbStatus = "ok" | "ISOLATION_FAILED" | "DB_UNAVAILABLE" | "DB_NOT_CONFIGURED";

export interface HealthBody {
  status: "ok" | "degraded";
  app: typeof APP_ID;
  commit: string;
  correlation_id: string;
  db: { status: DbStatus } & Partial<DatabaseProbe>;
}

export async function GET(): Promise<NextResponse<HealthBody>> {
  const correlationId = crypto.randomUUID();
  const reply = (db: HealthBody["db"]) =>
    NextResponse.json<HealthBody>(
      {
        status: db.status === "ok" ? "ok" : "degraded",
        app: APP_ID,
        commit: commitSha(),
        correlation_id: correlationId,
        db,
      },
      {
        status: db.status === "ok" ? 200 : 503,
        headers: { "cache-control": "no-store", "x-correlation-id": correlationId },
      },
    );

  if (!isDatabaseConfigured()) return reply({ status: "DB_NOT_CONFIGURED" });
  try {
    const probe = await probeDatabase();
    return reply({ status: isProbeHealthy(probe) ? "ok" : "ISOLATION_FAILED", ...probe });
  } catch (error) {
    logServerError("health.db_probe_failed", correlationId, error);
    return reply({ status: "DB_UNAVAILABLE" });
  }
}
