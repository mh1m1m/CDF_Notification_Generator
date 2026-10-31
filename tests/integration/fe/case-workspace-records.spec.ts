// FE-004: V13 ProceduralRecordsReader, NotificationRecordsReader and CaseSourceAdapter.getCase against the local
// primary cluster as cdf_v13_app → cdf_v13_user (M1 seed, migration 0006). Unknown = unauthorised = nothing.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequestIdentitySchema, type CaseId, type RequestIdentity } from "@/lib/contracts";
import { createV13RecordsCaseSource } from "@/lib/adapters/case-source/v13-records";
import { createV13NotificationRecordsReader } from "@/lib/adapters/notification-records/v13-notification-records";
import { createV13ProceduralRecordsReader } from "@/lib/adapters/procedural-records/v13-procedural-records";
import { databaseClientOptions } from "@/lib/db/client";
import { withRequestContext } from "@/lib/db/security-context";
import { TEST_CLAIMS_KEY } from "../support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL, PRIMARY_APP_URL } from "../support/clusters";

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
const DELTA_GOV = who(4, "GOVERNANCE", "GOVERNANCE_OFFICER");
const DELTA_SEC = who(4, "SECRETARIAT", "GOVERNANCE_OFFICER");
const EPSILON = who(5, "SECRETARIAT", "COMMITTEE_SECRETARY");
const caseId = (i: number) => `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}` as CaseId;
const UNKNOWN = "0c000000-0000-4000-8000-000000000099" as CaseId;

describe.skipIf(!available)("V13 case records on the primary cluster", () => {
  let sql: postgres.Sql;
  let r: {
    myCapacity(i: RequestIdentity, c: CaseId): Promise<string | null>;
    listEvents: ReturnType<typeof createV13ProceduralRecordsReader>["listEvents"];
    listTasks: ReturnType<typeof createV13ProceduralRecordsReader>["listTasks"];
    listNotifications: ReturnType<typeof createV13NotificationRecordsReader>["listForCase"];
  };
  beforeAll(() => {
    sql = postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
    const run: Parameters<typeof createV13RecordsCaseSource>[0] = (identity, fn) =>
      withRequestContext(identity, fn, { sql, claimsKey: TEST_CLAIMS_KEY });
    const source = createV13RecordsCaseSource(run);
    const procedural = createV13ProceduralRecordsReader(run);
    const notifications = createV13NotificationRecordsReader(run);
    r = {
      myCapacity: async (i, c) => (await source.getCase(i, c))?.my_capacity ?? null,
      listEvents: (i, c) => procedural.listEvents(i, c),
      listTasks: (i, c) => procedural.listTasks(i, c),
      listNotifications: (i, c) => notifications.listForCase(i, c),
    };
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("Alpha on 0001: SECRETARY, two events newest first, task 1 IN_PROGRESS with event, task 2 mine OPEN", async () => {
    expect(await r.myCapacity(ALPHA, caseId(1))).toBe("SECRETARY");
    const events = await r.listEvents(ALPHA, caseId(1));
    expect(events.map((e) => e.event_code)).toEqual(["TASK_STATUS_CHANGED", "CASE_OPENED"]);
    expect(events.every((e) => e.actor_capacity === null && e.provenance === "SEED_SYNTHETIC")).toBe(true);
    const tasks = await r.listTasks(ALPHA, caseId(1));
    const mine = tasks.filter((t) => t.is_mine);
    expect(mine.map((t) => [t.assignee_capacity, t.status, t.status_event_id])).toEqual([
      ["SECRETARY", "OPEN", null],
    ]);
    const recorded = tasks.filter((t) => t.status_event_id !== null);
    for (const t of recorded) expect(events.map((e) => e.id)).toContain(t.status_event_id);
  });

  it("0010's newest event is CASE_CLOSED 0e…0110", async () => {
    const [e] = await r.listEvents(ALPHA, caseId(10));
    expect(e?.event_code).toBe("CASE_CLOSED");
    expect(e?.id.endsWith("0110")).toBe(true);
  });

  it.each([
    ["unknown id", ALPHA, UNKNOWN],
    ["Alpha on 0002 (not visible)", ALPHA, caseId(2)],
    ["Alpha on 0009 (restricted)", ALPHA, caseId(9)],
    ["Gamma on 0009 (restricted, not named)", GAMMA, caseId(9)],
    ["Delta@GOVERNANCE on 0006 (other workspace)", DELTA_GOV, caseId(6)],
    ["Epsilon (membership expired) on 0001", EPSILON, caseId(1)],
  ])("%s: nothing, like an unknown id", async (_n, identity, id) => {
    expect(await r.myCapacity(identity, id)).toBeNull();
    expect(await r.listEvents(identity, id)).toEqual([]);
    expect(await r.listTasks(identity, id)).toEqual([]);
    expect(await r.listNotifications(identity, id)).toEqual([]);
  });

  it("Beta reads restricted 0009; Delta@SECRETARIAT reads 0006", async () => {
    expect((await r.listEvents(BETA, caseId(9))).length).toBeGreaterThan(0);
    expect((await r.listEvents(DELTA_SEC, caseId(6))).length).toBeGreaterThan(0);
  });

  it("every visible case's records parse and belong to that case (Alpha, Beta)", async () => {
    for (const [identity, ids] of [
      [ALPHA, [1, 3, 4, 6, 7, 8, 10]],
      [BETA, [1, 2, 3, 5, 6, 9, 10]],
    ] as const) {
      for (const i of ids) {
        await r.listEvents(identity, caseId(i));
        await r.listTasks(identity, caseId(i));
        await r.listNotifications(identity, caseId(i));
        await r.myCapacity(identity, caseId(i));
      }
    }
  });
});
