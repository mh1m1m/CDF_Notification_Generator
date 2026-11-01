// V13-FE-017 (DB-023, migration 0015): opening a case and a notification preview through the BFF loaders with the real
// V13 adapters, against the local primary cluster as cdf_v13_app → cdf_v13_user. Each request commits its own
// transactions, as a page request does; a separate administrator client reads the ledger before and after.
//   - every tab (overview, events, tasks, notifications) and a paged tab leave exactly one CASE_OPENED row for the
//     route's case, ids only, metadata {}; a second open inside the 300 s window adds no row and one suppressed count;
//   - restricted 0009 (Beta) leaves one RESTRICTED_CASE_OPENED row per request, never windowed;
//   - a preview leaves one CASE_OPENED and one NOTIFICATION_PREVIEW_OPENED row (entity the notification);
//   - negatives: an unknown case, a case of another workspace and restricted 0009 for an unassigned persona read as
//     NOT_FOUND and leave one id-less COMMAND_REFUSED row (V1404), no access row, no case id; another case's notification
//     shows "unavailable" and leaves a refused row, no preview row; a malformed ?n= never reaches the command;
//   - the draft command's transaction writes no access row (SEC point 5).
// access_window and refusal_window are cleared before each test (local cluster only). Synthetic data only.
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RequestIdentitySchema,
  type CaseId,
  type CorrelationId,
  type CreateNotificationDraftCommand,
  type RequestIdentity,
} from "@/lib/contracts";
import { createV13RecordsCaseSource } from "@/lib/adapters/case-source/v13-records";
import { createV13NotificationDrafts } from "@/lib/adapters/notification-records/v13-notification-drafts";
import { createV13NotificationPreviewReader } from "@/lib/adapters/notification-records/v13-notification-preview";
import { createV13NotificationRecordsReader } from "@/lib/adapters/notification-records/v13-notification-records";
import { createV13ProceduralRecordsReader } from "@/lib/adapters/procedural-records/v13-procedural-records";
import { databaseClientOptions } from "@/lib/db/client";
import { withRequestContext } from "@/lib/db/security-context";
import { CASE_TABS, loadCaseWorkspace, type CaseTab } from "@/lib/server/case-workspace";
import type { RequestContext } from "@/lib/server/context";
import { AppError } from "@/lib/server/errors";
import { TEST_CLAIMS_KEY } from "../support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL, PRIMARY_APP_URL } from "../support/clusters";

const logServerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/errors", () => ({ logServerError }));

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);
const who = (persona: number, active_workspace: string, role: string): RequestIdentity =>
  RequestIdentitySchema.parse({
    persona_id: `0b000000-0000-4000-8000-00000000000${persona}`,
    active_workspace,
    roles: [role],
  });
const ALPHA = who(1, "SECRETARIAT", "COMMITTEE_SECRETARY");
const BETA = who(2, "INVESTIGATIONS", "INVESTIGATOR");
const GAMMA = who(3, "INVESTIGATIONS", "INVESTIGATOR");
const caseId = (i: number) => `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}` as CaseId;
const UNKNOWN = "0c000000-0000-4000-8000-000000000099" as CaseId;
const NTF = (n: number) => `2f000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TV = (n: number) => `1f000000-0000-4000-8000-00000000000${n}`;
const CORRELATION = "5e000000-0000-4000-8000-0000000000f8" as CorrelationId;
const ACCESS_ACTIONS = ["CASE_OPENED", "RESTRICTED_CASE_OPENED", "NOTIFICATION_PREVIEW_OPENED"];

interface Row {
  action: string;
  outcome: string;
  actor_persona_id: string | null;
  case_id: string | null;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
}

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

describe.skipIf(!available)("V13 case-access audit through the BFF loaders (FE-017, DB-023)", () => {
  let sql: postgres.Sql;
  let admin: postgres.Sql;
  let mark = 0;

  const run = <T>(identity: RequestIdentity, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    withRequestContext(identity, fn as never, {
      sql,
      claimsKey: TEST_CLAIMS_KEY,
      correlationId: CORRELATION,
    });

  const deps = (identity: RequestIdentity, extra: { previewId?: string; page?: unknown } = {}) => ({
    ctx: { identity, correlationId: CORRELATION } as unknown as RequestContext,
    source: createV13RecordsCaseSource(run as never),
    procedural: createV13ProceduralRecordsReader(run as never),
    notifications: createV13NotificationRecordsReader(run as never),
    preview: createV13NotificationPreviewReader(run as never),
    ...(extra.previewId !== undefined ? { previewId: extra.previewId } : {}),
    ...(extra.page !== undefined ? { page: extra.page as never } : {}),
  });

  async function setMark() {
    mark = (
      await admin<{ m: number }[]>`
      select coalesce(max(seq), 0)::bigint::int as m from cdf_notifications_v13.audit_event`
    )[0]!.m;
  }
  const rowsSince = async (): Promise<Row[]> => [
    ...(await admin<Row[]>`
      select action, outcome, actor_persona_id::text, case_id::text, entity_type, entity_id::text, metadata
        from cdf_notifications_v13.audit_event where seq > ${mark} order by seq`),
  ];
  const windowOf = async (persona: RequestIdentity, c: CaseId, action: string, entity: string) =>
    (
      await admin<{ suppressed: number }[]>`
        select suppressed from cdf_notifications_v13.access_window
         where persona_id = ${persona.persona_id}::uuid and case_id = ${c}::uuid and action = ${action}
           and entity_id = ${entity}::uuid`
    )[0]?.suppressed;

  beforeAll(async () => {
    sql = postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
    admin = postgres(PRIMARY_ADMIN_URL, { ...databaseClientOptions(PRIMARY_ADMIN_URL, {}), max: 1 });
    // The first request context installs this run's claims key (its own ledger row); do it before any mark.
    await run(ALPHA, async (tx) => tx`select 1`);
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await admin?.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await admin`delete from cdf_notifications_v13.access_window`;
    await admin`delete from cdf_notifications_v13.refusal_window`;
    logServerError.mockClear();
    await setMark();
  });

  const opened = (persona: RequestIdentity, c: CaseId, action = "CASE_OPENED"): Row => ({
    action,
    outcome: "SUCCEEDED",
    actor_persona_id: persona.persona_id,
    case_id: c,
    entity_type: "case",
    entity_id: c,
    metadata: {},
  });

  it.each(CASE_TABS)(
    "tab %s: one page request leaves exactly one CASE_OPENED row (ids only)",
    async (tab) => {
      const v = await loadCaseWorkspace(deps(ALPHA), caseId(1), tab as CaseTab);
      expect(v.tab).toBe(tab);
      expect(await rowsSince()).toEqual([opened(ALPHA, caseId(1))]);
    },
  );

  it("a second open inside the window adds no row and one suppressed count; other tabs too", async () => {
    await loadCaseWorkspace(deps(ALPHA), caseId(1), "overview");
    expect(await rowsSince()).toHaveLength(1);
    await setMark();
    for (const tab of CASE_TABS) await loadCaseWorkspace(deps(ALPHA), caseId(1), tab);
    expect(await rowsSince()).toEqual([]);
    expect(await windowOf(ALPHA, caseId(1), "CASE_OPENED", caseId(1))).toBe(CASE_TABS.length);
  });

  it("a page request with a cursor (?after=) leaves exactly one row like any other request", async () => {
    const page = { ok: true, query: { after: "x" } };
    for (const tab of ["overview", "events", "tasks", "notifications"] as const) {
      await admin`delete from cdf_notifications_v13.access_window`;
      await setMark();
      await loadCaseWorkspace(deps(ALPHA, { page }), caseId(3), tab);
      expect(await rowsSince(), tab).toEqual([opened(ALPHA, caseId(3))]);
    }
  });

  it("restricted 0009 (Beta): one RESTRICTED_CASE_OPENED row per request, never windowed", async () => {
    await loadCaseWorkspace(deps(BETA), caseId(9), "overview");
    await loadCaseWorkspace(deps(BETA), caseId(9), "tasks");
    const rows = await rowsSince();
    expect(rows.map((r) => [r.action, r.case_id, r.entity_id, r.metadata])).toEqual([
      ["RESTRICTED_CASE_OPENED", caseId(9), caseId(9), {}],
      ["RESTRICTED_CASE_OPENED", caseId(9), caseId(9), {}],
    ]);
  });

  it("a preview: one CASE_OPENED and one NOTIFICATION_PREVIEW_OPENED row (entity the notification)", async () => {
    const v = await loadCaseWorkspace(deps(ALPHA, { previewId: NTF(1) }), caseId(1), "notifications");
    expect(v.tab === "notifications" && v.preview.kind).not.toBe("unavailable");
    const rows = await rowsSince();
    expect(rows.map((r) => [r.action, r.case_id, r.entity_type, r.entity_id, r.metadata])).toEqual([
      ["CASE_OPENED", caseId(1), "case", caseId(1), {}],
      ["NOTIFICATION_PREVIEW_OPENED", caseId(1), "notification", NTF(1), {}],
    ]);
  });

  it.each([
    ["an unknown case", ALPHA, UNKNOWN],
    ["a case of another workspace (Alpha on 0002)", ALPHA, caseId(2)],
    ["restricted 0009 for an unassigned persona (Gamma)", GAMMA, caseId(9)],
  ] as const)(
    "negative: %s is NOT_FOUND with one id-less COMMAND_REFUSED row and no access row",
    async (_n, identity, c) => {
      for (const tab of CASE_TABS) {
        const error = await loadCaseWorkspace(deps(identity), c, tab).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("NOT_FOUND");
      }
      const rows = await rowsSince();
      expect(rows.filter((r) => ACCESS_ACTIONS.includes(r.action))).toEqual([]);
      // one row per refusal window; unknown and unauthorised leave the same shape, never an id
      expect(rows.map((r) => [r.action, r.case_id, r.entity_id, r.metadata])).toEqual([
        ["COMMAND_REFUSED", null, null, { command: "api_record_access", refusal: "V1404" }],
      ]);
    },
  );

  it("negative: another case's notification shows 'unavailable' and leaves no preview row", async () => {
    const v = await loadCaseWorkspace(deps(ALPHA, { previewId: NTF(2) }), caseId(1), "notifications");
    expect(v.tab === "notifications" && v.preview).toEqual({
      kind: "unavailable",
      correlationId: CORRELATION,
    });
    const rows = await rowsSince();
    expect(rows.map((r) => [r.action, r.case_id, r.entity_id])).toEqual([
      ["CASE_OPENED", caseId(1), caseId(1)],
      ["COMMAND_REFUSED", null, null],
    ]);
  });

  it("negative: a malformed ?n= never reaches the command (only the case's row)", async () => {
    const v = await loadCaseWorkspace(
      deps(ALPHA, { previewId: "CDF-DEMO-2026-0001" }),
      caseId(1),
      "notifications",
    );
    expect(v.tab === "notifications" && v.preview.kind).toBe("unavailable");
    expect((await rowsSince()).map((r) => r.action)).toEqual(["CASE_OPENED"]);
  });

  it("negative (SEC point 5): the draft command's transaction writes no access row", async () => {
    let actions: string[] = [];
    const drafts = createV13NotificationDrafts(async (identity, fn) => {
      try {
        await withRequestContext(
          identity,
          async (tx) => {
            const rows = await fn(tx);
            await tx.unsafe("reset role");
            const mine = await tx<{ action: string }[]>`
              select action from cdf_notifications_v13.audit_event where seq > ${mark} order by seq`;
            throw new Rollback({ rows, actions: mine.map((r) => r.action) });
          },
          { sql: admin, claimsKey: TEST_CLAIMS_KEY, correlationId: CORRELATION },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
        const value = error.value as { rows: unknown; actions: string[] };
        actions = value.actions;
        return value.rows as never;
      }
      throw new Error("not rolled back");
    });
    await drafts.createDraft(ALPHA, {
      case_id: caseId(1),
      template_version_id: TV(1),
      recipient_class: "WITNESS",
      idempotency_key: "e".repeat(64),
    } as CreateNotificationDraftCommand);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.filter((a) => ACCESS_ACTIONS.includes(a))).toEqual([]);
  });
});
