// Database half of QA's browser scenarios (TEST_ARCHITECTURE.md §5.3). The fixture connects to the same loopback
// database as the started app, as cdf_v13_app, and reads every row inside the persona's own security context: one
// transaction with the authenticated claims and SET LOCAL ROLE cdf_v13_user, exactly as lib/db/security-context.ts
// does (ADR-003, ADR-014). So "what the database shows" is what RLS lets that persona see, never an owner's view.
// It never writes: every read is a read-only transaction that is rolled back. The claims key comes from the run's
// session secret (playwright.config.ts gives the app the same one), so a wrong derivation makes every read empty and
// the scenarios fail; it cannot make them pass.
//
// lib/db/security-context.ts and lib/auth/claims-key.ts start with `import "server-only"`, which throws outside a React
// Server Components bundle, so the two derivations are repeated here; a drift makes every read empty, which fails the
// scenarios. SYNTHETIC data only.
import { createHmac, hkdfSync, randomUUID } from "node:crypto";
import postgres from "postgres";
import { sessionKey } from "@/lib/auth/session";
import { WORKSPACE_IDS, type WorkspaceCode } from "@/lib/contracts";
import {
  adminUrl,
  describeUrl,
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

/** Carries a read's result out of the transaction while making postgres.js roll it back. */
class Rollback extends Error {
  constructor(readonly result: unknown) {
    super("rollback");
  }
}

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
      // A read-only transaction that is always rolled back: the result leaves through the Rollback "error". Repeatable
      // read gives every statement inside `fn` the same snapshot, so a check across tables never sees a write that
      // a parallel test committed between two of its statements.
      try {
        await sql.begin("isolation level repeatable read read only", async (tx) => {
          const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
          const mac = createHmac("sha256", key).update(`${claims}|${row!.xid}`, "utf8").digest("base64url");
          await tx`
            select pg_catalog.set_config('request.v13.claims', ${claims}, true),
                   pg_catalog.set_config('request.v13.claims_mac', ${mac}, true),
                   pg_catalog.set_config('role', 'cdf_v13_user', true)`;
          throw new Rollback(await fn(tx));
        });
      } catch (error) {
        if (error instanceof Rollback) return error.result as T;
        throw error;
      }
      throw new Error("unreachable: the scenario transaction always rolls back");
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

// ---------------------------------------------------------------------------------------------------------------------
// The access-audit ledger as the browser tests read it (V13-QA-022, DB-023 D1, REQ-AUD-001). The audit ledger and the
// access window are deny-all to every application role (migrations 0001, 0015), so no persona context can read them.
// The ledger reader below is the one exception to "the persona's own context" above, and the only administrator
// connection here: the same target `pnpm db:reset` writes (V13_ADMIN_DATABASE_URL, default
// postgres@127.0.0.1:54329/v13_local). LOCAL AND CI ONLY: the URL must be a loopback address, the run must have started
// the app itself (no V13_E2E_BASE_URL), and every read is a READ ONLY transaction, so it can never write, delete or
// reset anything. It returns ids, actions and counts only.

/** The three rows of migration 0015. */
export const ACCESS_ACTIONS = [
  "CASE_OPENED",
  "RESTRICTED_CASE_OPENED",
  "NOTIFICATION_PREVIEW_OPENED",
] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export interface AccessRow {
  seq: number;
  action: string;
  outcome: string;
  actor_persona_id: string | null;
  case_id: string | null;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
}

export interface Ledger {
  /** The highest ledger sequence number now: rows written later have a larger one. */
  mark(): Promise<number>;
  /** The persona's access rows after `mark` (every action of 0015), and its refused api_record_access rows. */
  accessRowsSince(mark: number, personaId: string): Promise<AccessRow[]>;
  /** The persona's suppressed count in the open window of (case, action, entity), 0 when there is none. */
  windowSuppressed(
    personaId: string,
    caseId: string,
    action: AccessAction,
    entityId: string,
  ): Promise<number>;
  end(): Promise<void>;
}

function ledgerUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (env.V13_E2E_BASE_URL?.trim())
    throw new Error("the ledger fixture needs the locally started app (V13_E2E_BASE_URL is set)");
  const url = adminUrl(env);
  if (!isLoopbackUrl(url))
    throw new Error(`the ledger fixture reads a loopback database only: ${describeUrl(url)}`);
  return url;
}

export function ledger(): Ledger {
  const sql = postgres(ledgerUrl(), { max: 1, prepare: false, onnotice: () => {} });
  const read = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
    sql.begin("read only", fn) as Promise<T>;
  return {
    mark: () =>
      read(async (tx) => {
        const [r] = await tx<{ m: string }[]>`
          select coalesce(max(seq), 0)::text as m from cdf_notifications_v13.audit_event`;
        return Number(r!.m);
      }),
    accessRowsSince: (mark, personaId) =>
      read(async (tx) =>
        (
          await tx<(Omit<AccessRow, "seq"> & { seq: string })[]>`
            select seq::text, action, outcome, actor_persona_id::text, case_id::text, entity_type, entity_id::text,
                   metadata
              from cdf_notifications_v13.audit_event
             where seq > ${mark}
               and actor_persona_id = ${personaId}::uuid
               and (action in ${tx(ACCESS_ACTIONS)}
                    or (action = 'COMMAND_REFUSED' and metadata ->> 'command' = 'api_record_access'))
             order by seq`
        ).map((r) => ({ ...r, seq: Number(r.seq) })),
      ),
    windowSuppressed: (personaId, caseId, action, entityId) =>
      read(async (tx) => {
        const [r] = await tx<{ suppressed: number }[]>`
          select suppressed from cdf_notifications_v13.access_window
           where persona_id = ${personaId}::uuid and case_id = ${caseId}::uuid and action = ${action}
             and entity_id = ${entityId}::uuid`;
        return r?.suppressed ?? 0;
      }),
    end: () => sql.end({ timeout: 5 }),
  };
}

/**
 * Opens of one (persona, case, action, entity) key between two readings, whatever the 300 s window did: each open
 * either appends a row or adds one to the window's suppressed count; a row that ends a window carries that count in
 * its metadata and resets the counter to 0 (migration 0015 §3). So opens = new rows + their carried counts + the
 * counter's change, and every open counts exactly once.
 */
export function opensBetween(
  rows: readonly AccessRow[],
  suppressedBefore: number,
  suppressedAfter: number,
): number {
  const carried = rows.reduce(
    (n, r) => n + (typeof r.metadata.suppressed === "number" ? r.metadata.suppressed : 0),
    0,
  );
  return rows.length + carried + (suppressedAfter - suppressedBefore);
}
