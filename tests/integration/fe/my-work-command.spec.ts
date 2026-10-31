// FE-005: the V13 TaskCommandPort (api_update_task_status, migration 0003) through the adapter and withRequestContext,
// against the local primary cluster. Scenario B: an update in case 0001 changes that one task, adds exactly one
// procedural event and one audit event (with this request's correlation id) in case 0001, and changes nothing in any
// other case. Negatives: stale version (STALE), a task the persona may not change (NOT_FOUND, nothing written), a
// closed case (CASE_CLOSED), a transition outside the table (INVALID_TRANSITION). Every command runs inside a
// transaction that the test rolls back, so the seed is unchanged for the other suites. Synthetic data only.
//
// The read side (my_work_tasks with DB-010's columns, migration 0008) is added here when 0008 is on develop.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequestIdentitySchema, type RequestIdentity, type TaskStatus } from "@/lib/contracts";
import { createV13MyWork } from "@/lib/adapters/my-work/v13-my-work";
import { TaskCommandRefusedError } from "@/lib/contracts";
import { databaseClientOptions } from "@/lib/db/client";
import { withRequestContext, type Tx } from "@/lib/db/security-context";
import { TEST_CLAIMS_KEY } from "../support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL } from "../support/clusters";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);
const who = (persona: number, active_workspace: string, role: string): RequestIdentity =>
  RequestIdentitySchema.parse({
    persona_id: `0b000000-0000-4000-8000-00000000000${persona}`,
    active_workspace,
    roles: [role],
  });
const ALPHA = who(1, "SECRETARIAT", "COMMITTEE_SECRETARY");
const GAMMA = who(3, "INVESTIGATIONS", "INVESTIGATOR");
const DELTA_GOV = who(4, "GOVERNANCE", "GOVERNANCE_OFFICER");
const TASK = (n: number) => `0d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const CORRELATION = "5e000000-0000-4000-8000-0000000000f5";

interface Snapshot {
  readonly tasks: Record<string, string>;
  readonly events: Record<string, number>;
  readonly audit: Record<string, number>;
  readonly auditForCorrelation: { action: string; case_id: string; entity_id: string }[];
}

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

describe.skipIf(!available)("V13 task status command on the primary cluster (FE-005)", () => {
  let admin: postgres.Sql;

  /**
   * Every task (status@version), procedural events and case-bound audit events per case, read as the administrator.
   * Audit rows without a case (claims-key install, sign-in, workspace switch) come from other suites running in
   * parallel and are not part of this comparison.
   */
  async function snapshot(tx: Tx | postgres.Sql): Promise<Snapshot> {
    const tasks = await tx<{ id: string; v: string }[]>`
      select id::text, status || '@' || row_version as v from cdf_notifications_v13.task order by id`;
    const events = await tx<{ case_id: string; n: number }[]>`
      select case_id::text, count(*)::int as n from cdf_notifications_v13.procedural_event group by case_id`;
    const audit = await tx<{ case_id: string; n: number }[]>`
      select case_id::text, count(*)::int as n
        from cdf_notifications_v13.audit_event where case_id is not null group by case_id`;
    const mine = await tx<{ action: string; case_id: string; entity_id: string }[]>`
      select action, case_id::text, entity_id::text from cdf_notifications_v13.audit_event
       where correlation_id = ${CORRELATION}::uuid`;
    return {
      tasks: Object.fromEntries(tasks.map((r) => [r.id, r.v])),
      events: Object.fromEntries(events.map((r) => [r.case_id, r.n])),
      audit: Object.fromEntries(audit.map((r) => [r.case_id, r.n])),
      auditForCorrelation: [...mine],
    };
  }

  /**
   * Runs the adapter's command as `identity` (cdf_v13_user, MAC'd claims, this correlation id), then reads the
   * snapshot as the administrator in the same transaction, and rolls everything back.
   */
  async function attempt(
    identity: RequestIdentity,
    task: number,
    status: TaskStatus,
    version: number,
  ): Promise<{ outcome: string; after: Snapshot }> {
    let after: Snapshot | null = null;
    const port = createV13MyWork((id, fn) =>
      withRequestContext(
        id,
        async (tx) => {
          // A refusal raises inside fn and aborts the transaction; a success is inspected here, then rolled back.
          const rows = await fn(tx);
          await tx.unsafe("reset role");
          after = await snapshot(tx);
          throw new Rollback(rows);
        },
        { sql: admin, claimsKey: TEST_CLAIMS_KEY, correlationId: CORRELATION as never },
      ),
    );
    let outcome: string;
    try {
      await port.updateStatus(identity, {
        task_id: TASK(task),
        new_status: status,
        expected_version: version,
      });
      outcome = "NOT_ROLLED_BACK";
    } catch (error) {
      if (error instanceof Rollback) outcome = "OK";
      else if (error instanceof TaskCommandRefusedError) outcome = error.refusal;
      else throw error;
    }
    return { outcome, after: after ?? (await snapshot(admin)) };
  }

  let before: Snapshot;
  beforeAll(async () => {
    admin = postgres(PRIMARY_ADMIN_URL, { ...databaseClientOptions(PRIMARY_ADMIN_URL, {}), max: 1 });
    before = await snapshot(admin);
  });
  afterAll(async () => {
    // The seed is untouched: every attempt was rolled back or refused.
    expect(await snapshot(admin)).toEqual(before);
    await admin?.end({ timeout: 5 });
  });

  it("Scenario B: Alpha's update in 0001 changes one task, one event and one audit row there, nothing elsewhere", async () => {
    const { outcome, after } = await attempt(ALPHA, 2, "IN_PROGRESS", 1);
    expect(outcome).toBe("OK");
    const changedTasks = Object.keys(after.tasks).filter((k) => after.tasks[k] !== before.tasks[k]);
    expect(changedTasks).toEqual([TASK(2)]);
    expect(after.tasks[TASK(2)]).toBe("IN_PROGRESS@2");
    for (const c of new Set([...Object.keys(before.events), ...Object.keys(after.events)])) {
      expect(after.events[c] ?? 0).toBe((before.events[c] ?? 0) + (c === CASE(1) ? 1 : 0));
    }
    for (const c of new Set([...Object.keys(before.audit), ...Object.keys(after.audit)])) {
      expect(after.audit[c] ?? 0).toBe((before.audit[c] ?? 0) + (c === CASE(1) ? 1 : 0));
    }
    expect(after.auditForCorrelation).toEqual([
      { action: "TASK_STATUS_CHANGED", case_id: CASE(1), entity_id: TASK(2) },
    ]);
  });

  it("a stale version is STALE and writes nothing", async () => {
    const { outcome, after } = await attempt(ALPHA, 2, "IN_PROGRESS", 7);
    expect(outcome).toBe("STALE");
    expect(after).toEqual(before);
  });

  it.each([
    ["Delta in Governance on 0001's task (visible case, no assignment)", DELTA_GOV, 2],
    ["Gamma on a restricted 0009 task", GAMMA, 17],
    ["Alpha on 0002's task (case not visible in Secretariat)", ALPHA, 3],
    ["Alpha on an unknown task id", ALPHA, 99],
  ] as const)("%s is NOT_FOUND and writes nothing", async (_n, identity, task) => {
    const { outcome, after } = await attempt(identity, task, "IN_PROGRESS", 1);
    expect(outcome).toBe("NOT_FOUND");
    expect(after).toEqual(before);
  });

  it("a task in the closed case 0010 is CASE_CLOSED and writes nothing", async () => {
    const { outcome, after } = await attempt(GAMMA, 20, "IN_PROGRESS", 1);
    expect(outcome).toBe("CASE_CLOSED");
    expect(after).toEqual(before);
  });

  it("a transition outside the table (OPEN → DONE) is INVALID_TRANSITION and writes nothing", async () => {
    const { outcome, after } = await attempt(ALPHA, 2, "DONE", 1);
    expect(outcome).toBe("INVALID_TRANSITION");
    expect(after).toEqual(before);
  });
});
