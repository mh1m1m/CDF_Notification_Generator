// Database half of QA's browser scenarios (TEST_ARCHITECTURE.md §5.3). The fixture connects to the same loopback
// database as the started app, as cdf_v13_app, and reads every row inside the persona's own security context: one
// transaction with the authenticated claims and SET LOCAL ROLE cdf_v13_user, exactly as lib/db/security-context.ts
// does (ADR-003, ADR-014). So "what the database shows" is what RLS lets that persona see, never an owner's view.
// It never writes. The claims key comes from the run's session secret (playwright.config.ts gives the app the same
// one), so a wrong derivation makes every read empty and the scenarios fail; it cannot make them pass.
//
// lib/db/security-context.ts and lib/auth/claims-key.ts start with `import "server-only"`, which throws outside a React
// Server Components bundle, so the two derivations are repeated here; a drift makes every read empty, which fails the
// scenarios. SYNTHETIC data only.
import { createHmac, hkdfSync, randomUUID } from "node:crypto";
import postgres from "postgres";
import { sessionKey } from "@/lib/auth/session";
import { WORKSPACE_IDS, type WorkspaceCode } from "@/lib/contracts";
import {
  isLoopbackUrl,
  LOCAL_DATABASE,
  localPrimaryPort,
  V13_APP,
} from "../../scripts/db/lib/migrations.mjs";
import { DEFAULT_LOCAL_APP_PASSWORD } from "../../scripts/db/reset-local.mjs";
import type { EventOracle, RecordedEventFact } from "../truth/inspector";
import { persona } from "./personas";

/** lib/auth/claims-key.ts REQUEST_CLAIMS_KEY_INFO. */
const CLAIMS_KEY_INFO = "cdf-v13/request-claims/v1";

/**
 * The URL playwright.config.ts gives the started app: V13_E2E_DATABASE_URL, or the local primary cluster of
 * `pnpm db:local`. The same guard: only the loopback v13_local as cdf_v13_app, no query, no fragment.
 * The error never contains the URL.
 */
function databaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (env.V13_E2E_BASE_URL?.trim()) {
    throw new Error("the scenario database fixture needs the locally started app (V13_E2E_BASE_URL is set)");
  }
  const password = encodeURIComponent(env.V13_LOCAL_APP_PASSWORD || DEFAULT_LOCAL_APP_PASSWORD);
  const url =
    env.V13_E2E_DATABASE_URL?.trim() ||
    `postgres://${V13_APP}:${password}@127.0.0.1:${localPrimaryPort(env)}/${LOCAL_DATABASE}`;
  const u = new URL(url);
  const accepted =
    (u.protocol === "postgres:" || u.protocol === "postgresql:") &&
    isLoopbackUrl(url) &&
    decodeURIComponent(u.username) === V13_APP &&
    decodeURIComponent(u.pathname.replace(/^\//, "")) === LOCAL_DATABASE &&
    u.search === "" &&
    u.hash === "";
  if (!accepted)
    throw new Error(`the scenario database must be the loopback ${LOCAL_DATABASE} as ${V13_APP}`);
  return url;
}

function claimsKey(): Uint8Array {
  const secret = process.env.V13_E2E_SESSION_SECRET;
  if (!secret)
    throw new Error("the scenario database fixture needs V13_E2E_SESSION_SECRET (a locally started build)");
  const ikm = sessionKey({ V13_SESSION_SECRET: secret });
  return new Uint8Array(hkdfSync("sha256", ikm, new Uint8Array(0), CLAIMS_KEY_INFO, 32));
}

export type ScenarioTx = postgres.TransactionSql;

export interface ScenarioDb {
  /** Runs `fn` read-only as cdf_v13_user with the persona's claims in `workspace`. */
  asPersona<T>(slug: string, workspace: WorkspaceCode, fn: (tx: ScenarioTx) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export function scenarioDb(): ScenarioDb {
  const sql = postgres(databaseUrl(), { prepare: false, max: 1, onnotice: () => {} });
  const key = claimsKey();
  return {
    async asPersona<T>(
      slug: string,
      workspace: WorkspaceCode,
      fn: (tx: ScenarioTx) => Promise<T>,
    ): Promise<T> {
      const workspaceId = WORKSPACE_IDS[workspace];
      if (!workspaceId) throw new Error(`unknown workspace ${workspace}`);
      const claims = JSON.stringify({
        v: 1,
        persona_id: persona(slug).persona_id,
        workspace_id: workspaceId,
        correlation_id: randomUUID(),
      });
      return sql.begin("read only", async (tx) => {
        const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
        const mac = createHmac("sha256", key).update(`${claims}|${row!.xid}`, "utf8").digest("base64url");
        await tx`
          select pg_catalog.set_config('request.v13.claims', ${claims}, true),
                 pg_catalog.set_config('request.v13.claims_mac', ${mac}, true),
                 pg_catalog.set_config('role', 'cdf_v13_user', true)`;
        return fn(tx);
      }) as Promise<T>;
    },
    end: () => sql.end({ timeout: 5 }),
  };
}

export interface CaseRow {
  id: string;
  ref: string;
  stage: string;
  records_state: string;
  is_restricted: boolean;
  /** The persona holds an active case assignment (the portfolio's "mine" filter). */
  mine: boolean;
}

/** The cases the database lets the persona see in the workspace, by id. */
export async function visibleCases(
  db: ScenarioDb,
  slug: string,
  workspace: WorkspaceCode,
): Promise<Map<string, CaseRow>> {
  const rows = await db.asPersona(
    slug,
    workspace,
    (tx) =>
      tx<CaseRow[]>`
      select c.id::text as id, c.display_number as ref, c.stage, c.records_state, c.is_restricted,
             exists (select 1
                       from cdf_notifications_v13.case_assignment a
                      where a.case_id = c.id
                        and a.persona_id = ${persona(slug).persona_id}::uuid
                        and a.valid_from <= pg_catalog.now()
                        and (a.valid_to is null or a.valid_to > pg_catalog.now())) as mine
        from cdf_notifications_v13.case_record c
       order by c.id`,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

export interface TaskRow {
  id: string;
  case_id: string;
  status: string;
  row_version: number;
  updated_at: string;
}

/** Every task the persona may see in the workspace, by id. */
export async function visibleTasks(
  db: ScenarioDb,
  slug: string,
  workspace: WorkspaceCode,
): Promise<Map<string, TaskRow>> {
  const rows = await db.asPersona(
    slug,
    workspace,
    (tx) =>
      tx<TaskRow[]>`
      select id::text as id, case_id::text as case_id, status, row_version,
             pg_catalog.to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
        from cdf_notifications_v13.task
       order by id`,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

export interface EventRow {
  id: string;
  case_id: string;
  event_code: string;
  subject_id: string | null;
  from_status: string | null;
  to_status: string | null;
}

/** Every procedural event the persona may see in the workspace, by id. */
export async function visibleEvents(
  db: ScenarioDb,
  slug: string,
  workspace: WorkspaceCode,
): Promise<Map<string, EventRow>> {
  const rows = await db.asPersona(
    slug,
    workspace,
    (tx) =>
      tx<EventRow[]>`
      select id::text as id, case_id::text as case_id, event_code, subject_id::text as subject_id,
             attributes ->> 'from' as from_status, attributes ->> 'to' as to_status
        from cdf_notifications_v13.procedural_event
       order by id`,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Truth Inspector oracle from the database (TEST_ARCHITECTURE.md §5.2): a task status badge's event must be a
 * TASK_STATUS_CHANGED the persona may see, and its `to` is the status the fold yields. Anything else is unknown (T4).
 */
export function databaseEventOracle(db: ScenarioDb, slug: string, workspace: WorkspaceCode): EventOracle {
  return {
    async get(eventId) {
      if (!/^[0-9a-f-]{36}$/.test(eventId)) return undefined;
      const [row] = await db.asPersona(
        slug,
        workspace,
        (tx) =>
          tx<{ case_id: string; to_status: string | null; recorded_at: string }[]>`
          select case_id::text as case_id, attributes ->> 'to' as to_status,
                 pg_catalog.to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as recorded_at
            from cdf_notifications_v13.procedural_event
           where id = ${eventId}::uuid and event_code = 'TASK_STATUS_CHANGED' and subject_type = 'task'`,
      );
      if (!row || row.to_status === null) return undefined;
      const fact: RecordedEventFact = {
        eventId,
        caseId: row.case_id,
        statusKind: "task",
        status: row.to_status,
        recordedAt: row.recorded_at,
      };
      return fact;
    },
  };
}
