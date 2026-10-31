// FE-005: the V13 MyWorkReader (my_work_tasks with V13-DB-010's columns, migration 0008) through the adapter and
// withRequestContext as cdf_v13_app → cdf_v13_user. Each persona sees only its own open tasks in the cases visible in
// its active workspace; restricted 0009 only for its assigned investigator; the closed case's task carries CLOSED; a
// recorded status names the seed event that set it; an untouched OPEN task has none. Synthetic data only.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequestIdentitySchema, type RequestIdentity } from "@/lib/contracts";
import { createV13MyWork } from "@/lib/adapters/my-work/v13-my-work";
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
const TASK = (n: number) => `0d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const EVENT = (n: number) => `0e000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;

describe.skipIf(!available)("V13 My Work reads on the primary cluster (FE-005)", () => {
  let sql: postgres.Sql;
  let port: ReturnType<typeof createV13MyWork>;
  beforeAll(() => {
    sql = postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
    port = createV13MyWork((identity, fn) =>
      withRequestContext(identity, fn, { sql, claimsKey: TEST_CLAIMS_KEY }),
    );
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it.each([
    // persona, workspace: own open tasks in visible cases, by due date then case number then task code
    ["Alpha @ Secretariat", who(1, "SECRETARIAT", "COMMITTEE_SECRETARY"), [5, 13, 7, 2, 16, 8, 14]],
    ["Beta @ Investigations", who(2, "INVESTIGATIONS", "INVESTIGATOR"), [9, 1, 17, 10, 6, 12, 18]],
    ["Gamma @ Investigations", who(3, "INVESTIGATIONS", "INVESTIGATOR"), [20, 11, 3, 4]],
    ["Delta @ Governance", who(4, "GOVERNANCE", "GOVERNANCE_OFFICER"), [15]],
    ["Delta @ Secretariat", who(4, "SECRETARIAT", "GOVERNANCE_OFFICER"), [15]],
    ["Alpha @ Governance (not a member)", who(1, "GOVERNANCE", "COMMITTEE_SECRETARY"), []],
  ] as const)("%s sees exactly its own open tasks", async (_n, identity, expected) => {
    const tasks = await port.listMyTasks(identity);
    expect(tasks.map((t) => t.task_id)).toEqual(expected.map(TASK));
  });

  it("Alpha never sees DONE 0010 task 19, nor any task of another persona", async () => {
    const ids = (await port.listMyTasks(who(1, "SECRETARIAT", "COMMITTEE_SECRETARY"))).map((t) => t.task_id);
    expect(ids).not.toContain(TASK(19));
    expect(ids).not.toContain(TASK(1)); // Beta's task in Alpha's case 0001
  });

  it("restricted 0009 tasks appear only for Beta, its assigned investigator", async () => {
    const gamma = await port.listMyTasks(who(3, "INVESTIGATIONS", "INVESTIGATOR"));
    expect(gamma.map((t) => t.case_number)).not.toContain("CDF-DEMO-2026-0009");
    const beta = await port.listMyTasks(who(2, "INVESTIGATIONS", "INVESTIGATOR"));
    expect(beta.filter((t) => t.case_number === "CDF-DEMO-2026-0009").map((t) => t.task_id)).toEqual([
      TASK(17),
      TASK(18),
    ]);
  });

  it("carries the case title and records state, and the event behind a recorded status", async () => {
    const tasks = await port.listMyTasks(who(3, "INVESTIGATIONS", "INVESTIGATOR"));
    const closed = tasks.find((t) => t.task_id === TASK(20));
    expect(closed?.case_records_state).toBe("CLOSED");
    expect(closed?.case_title.en).toBe("Demo case 0010 — closed");
    const inProgress = tasks.find((t) => t.task_id === TASK(11));
    expect(inProgress).toMatchObject({
      status: "IN_PROGRESS",
      status_event_id: EVENT(11),
      case_records_state: "ACTIVE",
    });
    const open = tasks.find((t) => t.task_id === TASK(3));
    expect(open).toMatchObject({ status: "OPEN", status_event_id: null });
  });
});
