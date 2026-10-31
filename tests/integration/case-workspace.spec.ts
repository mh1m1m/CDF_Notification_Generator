// V13-DB-008 — migration 0006: Case Workspace reads (FE-004). case_events, case_tasks and case_header.my_capacity are
// SECURITY INVOKER: RLS filters every row first; unknown and unauthorised cases both return zero rows; persons appear
// only as a capacity code or an is-mine flag, never as an id or a name. Commands used for set-up are rolled back.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceCode } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { clusterAvailable, PRIMARY_ADMIN_URL } from "./support/clusters";
import { adminClient, appClient, asPersona, asRaw, claimsText, PERSONA, WORKSPACE } from "./support/context";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function ready(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean; cases: number }[]>`
      select pg_catalog.to_regprocedure('cdf_notifications_v13.case_events(uuid)') is not null as present,
             (select count(*)::int from cdf_notifications_v13.case_record) as cases`;
    return Boolean(row?.present) && (row?.cases ?? 0) >= 10;
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const present = await ready();
if (available && !present)
  console.warn("[integration] skipping case-workspace: migration 0006 or cases seed missing");

const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TASK = (n: number) => `0d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const EVENT = (suffix: string) => `0e000000-0000-4000-8000-000000000${suffix}`;
const UNKNOWN = "0c000000-0000-4000-8000-0000000000ff";

interface EventRow {
  id: string;
  case_id: string;
  event_code: string;
  occurred_at: Date;
  recorded_at: Date;
  actor_capacity: string | null;
  provenance: string;
  subject_type: string | null;
  subject_id: string | null;
  causation_id: string | null;
}
interface TaskRow {
  id: string;
  case_id: string;
  task_code: string;
  title_ar: string;
  title_en: string;
  assignee_capacity: string | null;
  is_mine: boolean;
  status: string;
  due_date: Date | null;
  row_version: number;
  status_event_id: string | null;
}

const events = (caseId: string) => (tx: Tx) =>
  tx<EventRow[]>`select * from cdf_notifications_v13.case_events(${caseId}::uuid)`;
const tasks = (caseId: string) => (tx: Tx) =>
  tx<TaskRow[]>`select * from cdf_notifications_v13.case_tasks(${caseId}::uuid)`;
const myCapacity = (caseId: string) => async (tx: Tx) =>
  (
    await tx<{ my_capacity: string | null }[]>`
    select my_capacity from cdf_notifications_v13.case_header(${caseId}::uuid)`
  ).map((r) => r.my_capacity);
const updateTask = (task: string, status: string, version: number) => (tx: Tx) =>
  tx`select * from cdf_notifications_v13.api_update_task_status(${task}, ${status}, ${version})`;

describe.skipIf(!present)("Case Workspace reads (migration 0006)", () => {
  let app: postgres.Sql;
  let admin: postgres.Sql;

  beforeAll(async () => {
    app = appClient();
    admin = adminClient();
    await asPersona(app, PERSONA.alpha, "SECRETARIAT", async () => undefined); // installs the test key if needed
  });

  afterAll(async () => {
    await app?.end({ timeout: 5 });
    await admin?.end({ timeout: 5 });
  });

  /** As the persona, rolled back. */
  const as = <T>(persona: string, workspace: WorkspaceCode, fn: (tx: Tx) => Promise<T>) =>
    asRaw(app, { claims: claimsText(persona, WORKSPACE[workspace]), mac: "valid" }, fn);

  describe("case_events", () => {
    it("lists a case's events newest first; seed rows have no recorder, so no actor capacity", async () => {
      const rows = await as(PERSONA.alpha, "SECRETARIAT", events(CASE(1)));
      expect(
        rows.map((r) => [r.id, r.event_code, r.actor_capacity, r.provenance, r.subject_type, r.subject_id]),
      ).toEqual([
        [EVENT("201"), "TASK_STATUS_CHANGED", null, "SEED_SYNTHETIC", "task", TASK(1)],
        [EVENT("001"), "CASE_OPENED", null, "SEED_SYNTHETIC", null, null],
      ]);
    });

    it("a recorded event shows the recorder's capacity on the case at that time, first in the list", async () => {
      const beta = await as(PERSONA.beta, "INVESTIGATIONS", async (tx) => {
        await updateTask(TASK(1), "BLOCKED", 1)(tx);
        return events(CASE(1))(tx);
      });
      expect(beta[0]).toMatchObject({
        event_code: "TASK_STATUS_CHANGED",
        actor_capacity: "LEAD_INVESTIGATOR",
        provenance: "RECORDED_IN_V13",
        subject_type: "task",
        subject_id: TASK(1),
      });
      expect(beta).toHaveLength(3);

      const alpha = await as(PERSONA.alpha, "SECRETARIAT", async (tx) => {
        await updateTask(TASK(2), "IN_PROGRESS", 1)(tx);
        return events(CASE(1))(tx);
      });
      expect(alpha[0]).toMatchObject({ actor_capacity: "SECRETARY", subject_id: TASK(2) });
    });

    it("several capacities at the event time: the first in the fixed order is shown", async () => {
      const rows = await asRaw(
        admin,
        { claims: claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), mac: "valid" },
        async (tx) => {
          await tx.unsafe("reset role");
          await tx.unsafe("set local role cdf_v13_owner");
          await tx`insert into cdf_notifications_v13.case_assignment (case_id, persona_id, capacity, valid_from)
                   values (${CASE(1)}, ${PERSONA.alpha}, 'GOVERNANCE_REVIEWER', '2026-01-01T00:00:00Z'),
                          (${CASE(1)}, ${PERSONA.alpha}, 'INVESTIGATOR', '2026-01-01T00:00:00Z')`;
          await tx.unsafe("set local role cdf_v13_user");
          await updateTask(TASK(2), "IN_PROGRESS", 1)(tx);
          return { events: await events(CASE(1))(tx), mine: await myCapacity(CASE(1))(tx) };
        },
      );
      expect(rows.events[0]?.actor_capacity).toBe("INVESTIGATOR");
      expect(rows.mine).toEqual(["INVESTIGATOR"]);
    });
  });

  describe("case_tasks", () => {
    it("Secretary Alpha on case 0001: assignee as a capacity, is_mine, and the event that set the status", async () => {
      const rows = await as(PERSONA.alpha, "SECRETARIAT", tasks(CASE(1)));
      expect(
        rows.map((r) => [
          r.id,
          r.task_code,
          r.assignee_capacity,
          r.is_mine,
          r.status,
          r.row_version,
          r.status_event_id,
        ]),
      ).toEqual([
        [TASK(1), "COLLECT_DOCUMENTS", "LEAD_INVESTIGATOR", false, "IN_PROGRESS", 1, EVENT("201")],
        [TASK(2), "SCHEDULE_INTERVIEW", "SECRETARY", true, "OPEN", 1, null],
      ]);
    });

    it("a governance reviewer's task on case 0008 shows GOVERNANCE_REVIEWER, mine only for Delta", async () => {
      const alpha = await as(PERSONA.alpha, "SECRETARIAT", tasks(CASE(8)));
      expect(alpha.find((r) => r.id === TASK(15))).toMatchObject({
        assignee_capacity: "GOVERNANCE_REVIEWER",
        is_mine: false,
      });
      const delta = await as(PERSONA.delta, "GOVERNANCE", tasks(CASE(8)));
      expect(delta.find((r) => r.id === TASK(15))?.is_mine).toBe(true);
    });

    it("follows a task command in the same transaction (new version and status event)", async () => {
      const rows = await as(PERSONA.beta, "INVESTIGATIONS", async (tx) => {
        await updateTask(TASK(1), "BLOCKED", 1)(tx);
        const [latest] = await events(CASE(1))(tx);
        return { task: (await tasks(CASE(1))(tx)).find((r) => r.id === TASK(1)), latest: latest!.id };
      });
      expect(rows.task).toMatchObject({
        status: "BLOCKED",
        row_version: 2,
        status_event_id: rows.latest,
        is_mine: true,
      });
    });
  });

  describe("case_header.my_capacity", () => {
    const cases: [string, string, WorkspaceCode, number, (string | null)[]][] = [
      ["Alpha on 0001", PERSONA.alpha, "SECRETARIAT", 1, ["SECRETARY"]],
      ["Beta on 0001", PERSONA.beta, "INVESTIGATIONS", 1, ["LEAD_INVESTIGATOR"]],
      ["Beta on restricted 0009", PERSONA.beta, "INVESTIGATIONS", 9, ["LEAD_INVESTIGATOR"]],
      ["Delta on 0008", PERSONA.delta, "GOVERNANCE", 8, ["GOVERNANCE_REVIEWER"]],
      ["Delta on 0001 (visible, not assigned)", PERSONA.delta, "GOVERNANCE", 1, [null]],
      ["Gamma on 0001 (visible, not assigned)", PERSONA.gamma, "INVESTIGATIONS", 1, [null]],
    ];
    it.each(cases)("%s", async (_name, persona, workspace, n, expected) => {
      expect(await as(persona, workspace, myCapacity(CASE(n)))).toEqual(expected);
    });
  });

  describe("unknown and unauthorised look the same: zero rows from every function", () => {
    const contexts: [string, string, WorkspaceCode, string][] = [
      ["Gamma on restricted 0009 (not assigned)", PERSONA.gamma, "INVESTIGATIONS", CASE(9)],
      ["Alpha on 0002 (not visible in the Secretariat)", PERSONA.alpha, "SECRETARIAT", CASE(2)],
      ["Delta @ Investigations (no membership) on 0001", PERSONA.delta, "INVESTIGATIONS", CASE(1)],
      ["Epsilon (expired membership) on 0001", PERSONA.epsilon, "SECRETARIAT", CASE(1)],
      ["Zeta (deactivated) on 0001", PERSONA.zeta, "SECRETARIAT", CASE(1)],
      ["Alpha on an unknown id", PERSONA.alpha, "SECRETARIAT", UNKNOWN],
    ];
    it.each(contexts)("%s", async (_name, persona, workspace, caseId) => {
      const counts = await as(persona, workspace, async (tx) => ({
        events: (await events(caseId)(tx)).length,
        tasks: (await tasks(caseId)(tx)).length,
        header: (await myCapacity(caseId)(tx)).length,
      }));
      expect(counts).toEqual({ events: 0, tasks: 0, header: 0 });
    });

    it("no claims, or a forged MAC: zero rows", async () => {
      for (const ctx of [{}, { claims: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS), mac: "forged" }]) {
        const counts = await asRaw(app, ctx, async (tx) => ({
          events: (await events(CASE(9))(tx)).length,
          tasks: (await tasks(CASE(9))(tx)).length,
          header: (await myCapacity(CASE(9))(tx)).length,
        }));
        expect(counts).toEqual({ events: 0, tasks: 0, header: 0 });
      }
    });
  });

  describe("catalogue: invoker, request role only, no person columns", () => {
    const fns = ["case_events(uuid)", "case_tasks(uuid)", "case_header(uuid)"];
    it.each(fns)("%s", async (fn) => {
      const [row] = await admin<
        {
          definer: boolean;
          config: string[] | null;
          result: string;
          user_exec: boolean;
          app_exec: boolean;
          public_exec: boolean;
        }[]
      >`
        select p.prosecdef as definer, p.proconfig as config, pg_catalog.pg_get_function_result(p.oid) as result,
               pg_catalog.has_function_privilege('cdf_v13_user', p.oid, 'EXECUTE') as user_exec,
               pg_catalog.has_function_privilege('cdf_v13_app', p.oid, 'EXECUTE') as app_exec,
               pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
          from pg_catalog.pg_proc p
         where p.oid = ${`cdf_notifications_v13.${fn}`}::regprocedure`;
      expect(row).toMatchObject({
        definer: false,
        config: ['search_path=""'],
        user_exec: true,
        app_exec: false,
        public_exec: false,
      });
      expect(row!.result).not.toMatch(/persona|email|name/i);
    });
  });
});
