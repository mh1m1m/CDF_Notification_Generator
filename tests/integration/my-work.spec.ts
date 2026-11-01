// V13-DB-010 — migration 0008: my_work_tasks gains case_title_ar, case_title_en, case_records_state and status_event_id
// (FE-005). Still SECURITY INVOKER: the current persona's own tasks in cases visible in the current workspace, in the
// same order. Negative cases: other workspace, other persona, restricted, closed, unknown. Set-up writes are rolled back.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceCode } from "@/lib/contracts";
import { claimsMac, type Tx } from "@/lib/db/security-context";
import { TEST_CLAIMS_KEY } from "./support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL } from "./support/clusters";
import { adminClient, appClient, asPersona, asRaw, claimsText, PERSONA, WORKSPACE } from "./support/context";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function ready(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ cols: string | null; cases: number }[]>`
      select pg_catalog.pg_get_function_result('cdf_notifications_v13.my_work_tasks(boolean)'::regprocedure) as cols,
             (select count(*)::int from cdf_notifications_v13.case_record) as cases`;
    return Boolean(row?.cols?.includes("status_event_id")) && (row?.cases ?? 0) >= 10;
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const present = await ready();
if (available && !present)
  console.warn("[integration] skipping my-work: migration 0008 or cases seed missing");

const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TASK = (n: number) => `0d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const UNKNOWN_WORKSPACE = "0a000000-0000-4000-8000-0000000000ff";

const COLUMNS = [
  "task_id",
  "case_id",
  "display_number",
  "task_code",
  "title_ar",
  "title_en",
  "status",
  "due_date",
  "row_version",
  "case_title_ar",
  "case_title_en",
  "case_records_state",
  "status_event_id",
];

interface WorkRow {
  task_id: string;
  case_id: string;
  display_number: string;
  task_code: string;
  status: string;
  due_date: string | null;
  case_title_ar: string;
  case_title_en: string;
  case_records_state: string;
  status_event_id: string | null;
}

const SELECT_WORK = (includeClosed: boolean) =>
  `select task_id::text, case_id::text, display_number, task_code, status, due_date::text, case_title_ar,
          case_title_en, case_records_state, status_event_id::text
     from cdf_notifications_v13.my_work_tasks(${includeClosed})`;

function work(tx: Tx, includeClosed = false): Promise<WorkRow[]> {
  return tx.unsafe<WorkRow[]>(SELECT_WORK(includeClosed));
}

const taskNo = (rows: { task_id: string }[]) => rows.map((r) => Number(r.task_id.slice(-2)));

describe.skipIf(!present)("my_work_tasks with case columns (migration 0008, V13-DB-010)", () => {
  let app: postgres.Sql;
  let admin: postgres.Sql;

  beforeAll(async () => {
    app = appClient();
    admin = adminClient();
    await asPersona(app, PERSONA.alpha, "SECRETARIAT", async () => undefined); // installs the test key if needed
  });

  afterAll(async () => {
    await app.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  /**
   * One administrator transaction, always rolled back: `setup` runs as cdf_v13_owner, then a verified context for the
   * persona and workspace id is set and `fn` runs as cdf_v13_user.
   */
  async function afterSetup<T>(
    setup: (tx: Tx) => Promise<unknown>,
    persona: string,
    workspaceId: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    let result: T | undefined;
    await admin
      .begin(async (tx) => {
        await tx.unsafe("set local role cdf_v13_owner");
        await setup(tx);
        await tx.unsafe("reset role");
        const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
        const claims = claimsText(persona, workspaceId);
        await tx`select pg_catalog.set_config('request.v13.claims', ${claims}, true),
                        pg_catalog.set_config('request.v13.claims_mac', ${claimsMac(TEST_CLAIMS_KEY, claims, row!.xid)}, true),
                        pg_catalog.set_config('role', 'cdf_v13_user', true)`;
        result = await fn(tx);
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      });
    return result as T;
  }

  describe("shape and values", () => {
    it("keeps the nine columns and appends the four, in order; invoker, search_path '', request role only", async () => {
      const [row] = await admin<
        { names: string[]; definer: boolean; config: string[] | null; app: boolean; user: boolean }[]
      >`
        select p.proargnames[2:] as names, p.prosecdef as definer, p.proconfig as config,
               pg_catalog.has_function_privilege('cdf_v13_app', p.oid, 'EXECUTE') as app,
               pg_catalog.has_function_privilege('cdf_v13_user', p.oid, 'EXECUTE') as user
          from pg_catalog.pg_proc p
         where p.oid = 'cdf_notifications_v13.my_work_tasks(boolean)'::regprocedure`;
      expect(row).toEqual({
        names: COLUMNS,
        definer: false,
        config: ['search_path=""'],
        app: false,
        user: true,
      });
      const fields = await asPersona(app, PERSONA.alpha, "SECRETARIAT", async (tx) => {
        const result = await tx`select * from cdf_notifications_v13.my_work_tasks(true)`;
        return result.columns.map((c) => c.name);
      });
      expect(fields).toEqual(COLUMNS);
    });

    it("case titles and records state are the case's; status_event_id is the newest event about the task", async () => {
      const rows = await asPersona(app, PERSONA.alpha, "SECRETARIAT", (tx) => work(tx, true));
      expect(rows.length).toBeGreaterThan(0);
      const cases = await admin<{ id: string; title_ar: string; title_en: string; records_state: string }[]>`
        select id::text, title_ar, title_en, records_state from cdf_notifications_v13.case_record`;
      const latest = await admin<{ task_id: string; event_id: string }[]>`
        select distinct on (subject_id) subject_id::text as task_id, id::text as event_id
          from cdf_notifications_v13.procedural_event
         where subject_type = 'task'
         order by subject_id, occurred_at desc, recorded_at desc, id desc`;
      const byCase = new Map(cases.map((c) => [c.id, c]));
      const byTask = new Map(latest.map((e) => [e.task_id, e.event_id]));
      for (const r of rows) {
        const c = byCase.get(r.case_id)!;
        expect(r, r.task_code).toMatchObject({
          case_title_ar: c.title_ar,
          case_title_en: c.title_en,
          case_records_state: c.records_state,
          status_event_id: byTask.get(r.task_id) ?? null,
        });
      }
      // Seed: Alpha's tasks 05, 08 and 19 have a status event; the others are untouched.
      expect(taskNo(rows.filter((r) => r.status_event_id !== null)).sort((a, b) => a - b)).toEqual([
        5, 8, 19,
      ]);
    });

    it("status_event_id equals case_tasks' for the same task and context", async () => {
      const mismatches = await asPersona(app, PERSONA.beta, "INVESTIGATIONS", async (tx) => {
        const out: string[] = [];
        for (const r of await work(tx, true)) {
          const [ct] = await tx<{ status_event_id: string | null }[]>`
            select status_event_id::text from cdf_notifications_v13.case_tasks(${r.case_id}::uuid)
             where id = ${r.task_id}::uuid`;
          if ((ct?.status_event_id ?? null) !== r.status_event_id) out.push(r.task_code);
        }
        return out;
      });
      expect(mismatches).toEqual([]);
    });

    it("the newest event wins, and an event of another case naming the task is ignored (rolled back)", async () => {
      const [ids] = await admin<{ newer: string; foreign: string }[]>`
        select gen_random_uuid()::text as newer, gen_random_uuid()::text as foreign`;
      const rows = await afterSetup(
        async (tx) => {
          await tx`
            insert into cdf_notifications_v13.procedural_event
              (id, case_id, event_code, occurred_at, provenance, subject_type, subject_id)
            values (${ids!.newer}::uuid, ${CASE(1)}::uuid, 'TASK_STATUS_CHANGED', now() - interval '1 minute',
                    'SEED_SYNTHETIC', 'task', ${TASK(2)}::uuid),
                   (${ids!.foreign}::uuid, ${CASE(3)}::uuid, 'TASK_STATUS_CHANGED', now(),
                    'SEED_SYNTHETIC', 'task', ${TASK(2)}::uuid)`;
        },
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        (tx) => work(tx),
      );
      expect(rows.find((r) => r.task_id === TASK(2))?.status_event_id).toBe(ids!.newer);
    });

    it("row set and order are unchanged: due date (nulls last), display number, task code", async () => {
      const beta = await asPersona(app, PERSONA.beta, "INVESTIGATIONS", (tx) => work(tx));
      expect(taskNo(beta).sort((a, b) => a - b)).toEqual([1, 6, 9, 10, 12, 17, 18]);
      const ordered = [...beta].sort(
        (a, b) =>
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
          (a.display_number < b.display_number ? -1 : a.display_number > b.display_number ? 1 : 0) ||
          (a.task_code < b.task_code ? -1 : a.task_code > b.task_code ? 1 : 0),
      );
      expect(beta.map((r) => r.task_id)).toEqual(ordered.map((r) => r.task_id));
    });
  });

  describe("negative", () => {
    it("other workspace: a task in a case not visible in the current workspace never appears (rolled back)", async () => {
      // Case 02 is visible in GOVERNANCE and INVESTIGATIONS, not in SECRETARIAT. Delta is a member of GOVERNANCE and
      // SECRETARIAT.
      const extra = "0d000000-0000-4000-8000-0000000000e1";
      const setup = (tx: Tx) => tx`
        insert into cdf_notifications_v13.task (id, case_id, task_code, title_ar, title_en, assignee_persona_id)
        values (${extra}::uuid, ${CASE(2)}::uuid, 'REVIEW_SYNTHETIC', 'مهمة تجريبية', 'Synthetic task',
                ${PERSONA.delta}::uuid)`;
      const inGovernance = await afterSetup(setup, PERSONA.delta, WORKSPACE.GOVERNANCE, (tx) => work(tx));
      const inSecretariat = await afterSetup(setup, PERSONA.delta, WORKSPACE.SECRETARIAT, (tx) => work(tx));
      expect(inGovernance.map((r) => r.task_id)).toContain(extra);
      expect(inGovernance.find((r) => r.task_id === extra)?.case_title_en).toBeTruthy();
      expect(inSecretariat.map((r) => r.task_id)).not.toContain(extra);
      expect(JSON.stringify(inSecretariat)).not.toContain(CASE(2));
      expect(taskNo(inSecretariat)).toEqual([15]);
    });

    it("other workspace: a persona that is not a member of the claimed workspace, or an unknown workspace, gets nothing", async () => {
      for (const workspace of [WORKSPACE.INVESTIGATIONS, UNKNOWN_WORKSPACE]) {
        const rows = await asRaw(app, { claims: claimsText(PERSONA.alpha, workspace), mac: "valid" }, (tx) =>
          work(tx, true),
        );
        expect(rows, workspace).toEqual([]);
      }
    });

    it("other persona: only the caller's own tasks, never a colleague's in the same cases", async () => {
      const assignees = new Map(
        (
          await admin<{ id: string; assignee: string | null }[]>`
            select id::text, assignee_persona_id::text as assignee from cdf_notifications_v13.task`
        ).map((t) => [t.id, t.assignee]),
      );
      const contexts: [string, WorkspaceCode][] = [
        [PERSONA.alpha, "SECRETARIAT"],
        [PERSONA.beta, "INVESTIGATIONS"],
        [PERSONA.gamma, "INVESTIGATIONS"],
        [PERSONA.delta, "GOVERNANCE"],
        [PERSONA.delta, "SECRETARIAT"],
      ];
      for (const [persona, workspace] of contexts) {
        const rows = await asPersona(app, persona, workspace, (tx) => work(tx, true));
        for (const r of rows) expect(assignees.get(r.task_id), `${persona} ${r.task_code}`).toBe(persona);
      }
      // Gamma shares cases 01–03 with Beta and Alpha but sees only tasks 03, 04, 11 (and 20 on closed 0010).
      const gamma = await asPersona(app, PERSONA.gamma, "INVESTIGATIONS", (tx) => work(tx, true));
      expect(taskNo(gamma).sort((a, b) => a - b)).toEqual([3, 4, 11, 20]);
    });

    it("restricted: Beta sees 0009's tasks only while assigned; with the assignment ended they vanish (rolled back)", async () => {
      const assigned = await asPersona(app, PERSONA.beta, "INVESTIGATIONS", (tx) => work(tx));
      expect(
        assigned
          .filter((r) => r.case_id === CASE(9))
          .map((r) => r.task_id)
          .sort(),
      ).toEqual([TASK(17), TASK(18)]);
      const ended = await afterSetup(
        (tx) => tx`
          update cdf_notifications_v13.case_assignment set valid_to = now() - interval '1 second'
           where case_id = ${CASE(9)}::uuid and persona_id = ${PERSONA.beta}::uuid`,
        PERSONA.beta,
        WORKSPACE.INVESTIGATIONS,
        (tx) => work(tx, true),
      );
      expect(ended.length).toBeGreaterThan(0);
      expect(JSON.stringify(ended)).not.toContain(CASE(9));
      const [titles] = await admin<{ ar: string; en: string }[]>`
        select title_ar as ar, title_en as en from cdf_notifications_v13.case_record where id = ${CASE(9)}::uuid`;
      expect(JSON.stringify(ended)).not.toContain(titles!.en);
      expect(JSON.stringify(ended)).not.toContain(titles!.ar);
    });

    it("restricted: a persona never assigned to 0009 never sees its title, even with a task there (rolled back)", async () => {
      const rows = await afterSetup(
        (tx) => tx`update cdf_notifications_v13.task set assignee_persona_id = ${PERSONA.gamma}::uuid
                    where id = ${TASK(17)}::uuid`,
        PERSONA.gamma,
        WORKSPACE.INVESTIGATIONS,
        (tx) => work(tx, true),
      );
      expect(rows.map((r) => r.task_id)).not.toContain(TASK(17));
      expect(JSON.stringify(rows)).not.toContain(CASE(9));
    });

    it("closed: DONE tasks only with p_include_closed; an open task on a closed case carries the CLOSED hint", async () => {
      const alphaOpen = await asPersona(app, PERSONA.alpha, "SECRETARIAT", (tx) => work(tx));
      const alphaAll = await asPersona(app, PERSONA.alpha, "SECRETARIAT", (tx) => work(tx, true));
      expect(alphaOpen.map((r) => r.task_id)).not.toContain(TASK(19));
      expect(alphaAll.find((r) => r.task_id === TASK(19))).toMatchObject({
        status: "DONE",
        case_records_state: "CLOSED",
      });
      const gamma = await asPersona(app, PERSONA.gamma, "INVESTIGATIONS", (tx) => work(tx));
      expect(gamma.find((r) => r.task_id === TASK(20))).toMatchObject({
        status: "OPEN",
        case_records_state: "CLOSED",
      });
      for (const r of [...alphaOpen, ...gamma].filter((r) => r.case_id !== CASE(10)))
        expect(r.case_records_state, r.task_code).toBe("ACTIVE");
    });

    it("closed: the hint is a hint, the command still refuses (V1423) a task on the closed case", async () => {
      const code = await asPersona(app, PERSONA.gamma, "INVESTIGATIONS", async (tx) => {
        // Since 0013 the refusal is the command's answer (V13-DB-021), not a raised error.
        const [row] = await tx<{ refusal: string | null }[]>`
          select refusal from cdf_notifications_v13.api_update_task_status(${TASK(20)}::uuid, 'IN_PROGRESS', 1)`;
        return row?.refusal ?? "OK";
      });
      expect(code).toBe("V1423");
    });

    it("unknown: no context, a forged MAC, an unknown or inactive persona all get zero rows", async () => {
      const contexts = [
        {},
        { claims: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS), mac: "forged" },
        { claims: claimsText(PERSONA.unknown, WORKSPACE.SECRETARIAT), mac: "valid" as const },
        { claims: claimsText(PERSONA.zeta, WORKSPACE.SECRETARIAT), mac: "valid" as const },
      ];
      for (const ctx of contexts) expect(await asRaw(app, ctx, (tx) => work(tx, true))).toEqual([]);
    });

    it("the app login cannot call it without the request role (42501)", async () => {
      await expect(app`select * from cdf_notifications_v13.my_work_tasks(true)`).rejects.toMatchObject({
        code: "42501",
      });
    });
  });
});

class RolledBack extends Error {}
