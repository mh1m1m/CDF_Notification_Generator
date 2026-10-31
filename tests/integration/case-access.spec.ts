// V13-DB-002..005 — migrations 0002–0004 with the cases seed: the case-access rule (can_access_case) per persona
// context, portfolio reads, case header, tasks and api_update_task_status, notifications and
// api_create_notification_draft. Negative cases: other case, other workspace, restricted, closed, unknown id, wrong
// role, no context, stale version, invalid input. Unknown and unauthorised give the same answer (V1404 or no row).
// Every command runs in a transaction that is rolled back, so the suite can run again without db:reset.
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceCode } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { clusterAvailable, PRIMARY_ADMIN_URL } from "./support/clusters";
import {
  adminClient,
  appClient,
  asOwner,
  asPersona,
  asRaw,
  claimsText,
  CORRELATION,
  PERSONA,
  WORKSPACE,
} from "./support/context";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function casesSeedPresent(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    return await asOwner(admin, async (tx) => {
      const [t] = await tx<{ present: boolean }[]>`
        select pg_catalog.to_regclass('cdf_notifications_v13.notification') is not null as present`;
      if (!t?.present) return false;
      const [c] = await tx<{ n: number }[]>`select count(*)::int as n from cdf_notifications_v13.case_record`;
      return (c?.n ?? 0) >= 10;
    });
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const seeded = await casesSeedPresent();
if (available && !seeded) console.warn("[integration] skipping case-access: no cases seed (V13-DB-002..005)");

const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TASK = (n: number) => `0d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TEMPLATE_VERSION = (n: number) => `1f000000-0000-4000-8000-00000000000${n}`;
const UNKNOWN = "0c000000-0000-4000-8000-0000000000ff";
const demo = (ns: number[]) => ns.map((n) => `CDF-DEMO-2026-${String(n).padStart(4, "0")}`);
const key = (label: string) => createHash("sha256").update(`test:${label}`).digest("hex");

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return String((error as { code?: unknown }).code ?? "UNKNOWN");
  }
}

/** Visibility matrix of the M1 seed (docs/architecture/DATA_MODEL.md §5). */
const VISIBLE: [string, string, WorkspaceCode, number[]][] = [
  ["Secretary Alpha @ Secretariat", PERSONA.alpha, "SECRETARIAT", [1, 3, 4, 6, 7, 8, 10]],
  ["Investigator Beta @ Investigations", PERSONA.beta, "INVESTIGATIONS", [1, 2, 3, 5, 6, 9, 10]],
  ["Investigator Gamma @ Investigations", PERSONA.gamma, "INVESTIGATIONS", [1, 2, 3, 5, 6, 10]],
  ["Governance Officer Delta @ Governance", PERSONA.delta, "GOVERNANCE", [1, 2, 3, 4, 7, 8, 10]],
  ["Delta @ Secretariat", PERSONA.delta, "SECRETARIAT", [1, 3, 4, 6, 7, 8, 10]],
  ["Delta @ Investigations (no membership)", PERSONA.delta, "INVESTIGATIONS", []],
  ["Secretary Epsilon (expired)", PERSONA.epsilon, "SECRETARIAT", []],
  ["Persona Zeta (deactivated)", PERSONA.zeta, "SECRETARIAT", []],
  ["unknown persona", PERSONA.unknown, "SECRETARIAT", []],
];

describe.skipIf(!seeded)("case access, tasks and notifications (migrations 0002–0004)", () => {
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

  /** Runs `fn` as the persona on the app login and rolls everything back. */
  async function rolledBack<T>(
    persona: string,
    workspace: WorkspaceCode,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return asRaw(app, { claims: claimsText(persona, WORKSPACE[workspace]), mac: "valid" }, fn);
  }

  /**
   * Runs `command` as the persona, then `inspect` as cdf_v13_owner in the SAME transaction (administrator connection:
   * RESET ROLE returns to the administrator), and rolls everything back.
   */
  async function commandThenInspect<C, I>(
    persona: string,
    workspace: WorkspaceCode,
    command: (tx: Tx) => Promise<C>,
    inspect: (tx: Tx, result: C) => Promise<I>,
  ): Promise<{ result: C; inspected: I }> {
    return asRaw(admin, { claims: claimsText(persona, WORKSPACE[workspace]), mac: "valid" }, async (tx) => {
      const result = await command(tx);
      await tx.unsafe("reset role");
      await tx.unsafe("set local role cdf_v13_owner");
      return { result, inspected: await inspect(tx, result) };
    });
  }

  describe("case-access rule and portfolio reads", () => {
    it.each(VISIBLE)("%s sees exactly the expected cases", async (_name, persona, workspace, expected) => {
      const rows = await asPersona(
        app,
        persona,
        workspace,
        (tx) =>
          tx<{ display_number: string }[]>`
          select display_number from cdf_notifications_v13.portfolio_page(null, 100)`,
      );
      expect(rows.map((r) => r.display_number)).toEqual(demo(expected));
      const [count] = await asPersona(
        app,
        persona,
        workspace,
        (tx) => tx<{ n: string }[]>`select cdf_notifications_v13.portfolio_count() as n`,
      );
      expect(Number(count?.n)).toBe(expected.length);
      const [direct] = await asPersona(
        app,
        persona,
        workspace,
        (tx) => tx<{ n: number }[]>`select count(*)::int as n from cdf_notifications_v13.case_record`,
      );
      expect(direct?.n).toBe(expected.length);
    });

    it("the restricted case 0009 needs an assignment: visible to Beta, hidden from Gamma, Alpha and Delta", async () => {
      const access = async (persona: string, ws: WorkspaceCode) =>
        (
          await asPersona(
            app,
            persona,
            ws,
            (tx) => tx<{ ok: boolean }[]>`select cdf_notifications_v13.can_access_case(${CASE(9)}) as ok`,
          )
        )[0]?.ok;
      expect(await access(PERSONA.beta, "INVESTIGATIONS")).toBe(true);
      expect(await access(PERSONA.gamma, "INVESTIGATIONS")).toBe(false);
      expect(await access(PERSONA.alpha, "SECRETARIAT")).toBe(false);
      expect(await access(PERSONA.delta, "GOVERNANCE")).toBe(false);
    });

    it("unknown and unauthorised case ids look identical: no header row, can_access_case false", async () => {
      for (const id of [UNKNOWN, CASE(2), CASE(9)]) {
        const rows = await asPersona(
          app,
          PERSONA.alpha,
          "SECRETARIAT",
          (tx) => tx`select * from cdf_notifications_v13.case_header(${id})`,
        );
        expect(rows, id).toHaveLength(0);
      }
      const own = await asPersona(
        app,
        PERSONA.alpha,
        "SECRETARIAT",
        (tx) =>
          tx<
            { display_number: string }[]
          >`select display_number from cdf_notifications_v13.case_header(${CASE(1)})`,
      );
      expect(own.map((r) => r.display_number)).toEqual(["CDF-DEMO-2026-0001"]);
    });

    it("portfolio rows and the header carry updated_at, source_system and source_ref (FE contract)", async () => {
      const [header] = await asPersona(
        app,
        PERSONA.alpha,
        "SECRETARIAT",
        (tx) =>
          tx<{ updated_at: Date; source_system: string; source_ref: string }[]>`
          select updated_at, source_system, source_ref from cdf_notifications_v13.case_header(${CASE(1)})`,
      );
      expect(header).toMatchObject({ source_system: "V13_SYNTHETIC", source_ref: "seed:m1:0001" });
      expect(header?.updated_at).toBeInstanceOf(Date);
      const page = await asPersona(
        app,
        PERSONA.beta,
        "INVESTIGATIONS",
        (tx) =>
          tx<{ display_number: string; source_system: string; source_ref: string; updated_at: Date }[]>`
          select display_number, source_system, source_ref, updated_at
            from cdf_notifications_v13.portfolio_page(null, 100)`,
      );
      for (const row of page) {
        expect(row.source_system).toBe("V13_SYNTHETIC");
        expect(row.source_ref).toBe(`seed:m1:${row.display_number.slice(-4)}`);
        expect(row.updated_at).toBeInstanceOf(Date);
      }
    });

    it("source_ref is required and pattern-checked (23502, 23514)", async () => {
      const insert = (ref: string | null) =>
        asOwner(
          admin,
          (tx) => tx`
          insert into cdf_notifications_v13.case_record
            (display_number, title_ar, title_en, stage, owning_workspace_id, source_ref)
          values ('CDF-DEMO-2026-0099', 'تجريبي', 'Synthetic', 'INTAKE', ${WORKSPACE.SECRETARIAT}, ${ref})`,
        );
      expect(await codeOf(insert(null))).toBe("23502");
      expect(await codeOf(insert("bad ref with spaces"))).toBe("23514");
      expect(await codeOf(insert("seed:m1:0099"))).toBe("OK");
    });

    const ASSIGNED: [string, string, WorkspaceCode, number[]][] = [
      ["Alpha @ Secretariat", PERSONA.alpha, "SECRETARIAT", [1, 3, 4, 7, 8, 10]],
      ["Beta @ Investigations", PERSONA.beta, "INVESTIGATIONS", [1, 3, 5, 6, 9]],
      ["Gamma @ Investigations", PERSONA.gamma, "INVESTIGATIONS", [2, 6, 10]],
      ["Delta @ Governance", PERSONA.delta, "GOVERNANCE", [8]],
      ["Delta @ Secretariat", PERSONA.delta, "SECRETARIAT", [8]],
      ["Delta @ Investigations (no membership)", PERSONA.delta, "INVESTIGATIONS", []],
    ];

    it.each(ASSIGNED)(
      "assigned-to-me filter: %s, page and count agree (FE-003 a, d)",
      async (_n, persona, ws, expected) => {
        const rows = await asPersona(
          app,
          persona,
          ws,
          (tx) =>
            tx<{ display_number: string }[]>`
          select display_number from cdf_notifications_v13.portfolio_page(null, 100, null, null, null, true)`,
        );
        expect(rows.map((r) => r.display_number)).toEqual(demo(expected));
        const [count] = await asPersona(
          app,
          persona,
          ws,
          (tx) =>
            tx<{ n: string }[]>`select cdf_notifications_v13.portfolio_count(null, null, null, true) as n`,
        );
        expect(Number(count?.n)).toBe(expected.length);
      },
    );

    it("count takes exactly the page's filter set (stage, records state, search, assigned-to-me)", async () => {
      const combos: [string | null, string | null, string | null, boolean][] = [
        ["INVESTIGATION", null, null, false],
        [null, "ACTIVE", null, true],
        [null, null, "joint", false],
        ["CLOSURE", "CLOSED", "0010", true],
      ];
      for (const [stage, state, search, mine] of combos) {
        const page = await asPersona(
          app,
          PERSONA.beta,
          "INVESTIGATIONS",
          (tx) =>
            tx`select id from cdf_notifications_v13.portfolio_page(null, 100, ${stage}, ${state}, ${search}, ${mine})`,
        );
        const [count] = await asPersona(
          app,
          PERSONA.beta,
          "INVESTIGATIONS",
          (tx) =>
            tx<
              { n: string }[]
            >`select cdf_notifications_v13.portfolio_count(${stage}, ${state}, ${search}, ${mine}) as n`,
        );
        expect(Number(count?.n), JSON.stringify([stage, state, search, mine])).toBe(page.length);
      }
    });

    it("each row carries the case's last recorded event and the persona's own open-task count (FE-003 b, c)", async () => {
      const rows = await asPersona(
        app,
        PERSONA.beta,
        "INVESTIGATIONS",
        (tx) =>
          tx<{ id: string; last_event_id: string; last_event_at: Date; my_open_task_count: number }[]>`
          select id, last_event_id, last_event_at, my_open_task_count
            from cdf_notifications_v13.portfolio_page(null, 100)`,
      );
      const expectedLast = await asOwner(
        admin,
        (tx) =>
          tx<{ case_id: string; id: string; occurred_at: Date }[]>`
          select distinct on (case_id) case_id, id, occurred_at from cdf_notifications_v13.procedural_event
           order by case_id, occurred_at desc, recorded_at desc, id desc`,
      );
      const last = new Map(expectedLast.map((e) => [e.case_id, e]));
      for (const row of rows) {
        expect(row.last_event_id, row.id).toBe(last.get(row.id)?.id);
        expect(row.last_event_at.toISOString()).toBe(last.get(row.id)?.occurred_at.toISOString());
      }
      expect(rows.find((r) => r.id === CASE(10))?.last_event_id).toBe("0e000000-0000-4000-8000-000000000110");
      expect(Object.fromEntries(rows.map((r) => [r.id, r.my_open_task_count]))).toEqual({
        [CASE(1)]: 1,
        [CASE(2)]: 0,
        [CASE(3)]: 1,
        [CASE(5)]: 2,
        [CASE(6)]: 1,
        [CASE(9)]: 2,
        [CASE(10)]: 0,
      });
    });

    it("row summaries follow a command in the same transaction: new last event, one open task fewer", async () => {
      const after = await rolledBack(PERSONA.beta, "INVESTIGATIONS", async (tx) => {
        const [changed] = await tx<{ row_version: number }[]>`
          select row_version from cdf_notifications_v13.api_update_task_status(${TASK(1)}, 'DONE', 1)`;
        const [row] = await tx<{ last_event_id: string; my_open_task_count: number }[]>`
          select last_event_id, my_open_task_count from cdf_notifications_v13.portfolio_page(null, 1)`;
        const [event] = await tx<{ id: string }[]>`
          select id from cdf_notifications_v13.procedural_event
           where subject_id = ${TASK(1)} and provenance = 'RECORDED_IN_V13'`;
        return { changed, row, event };
      });
      expect(after.changed?.row_version).toBe(2);
      expect(after.row).toEqual({ last_event_id: after.event?.id, my_open_task_count: 0 });
    });

    it("search, filters and counts never reveal a hidden case", async () => {
      const [hidden] = await asPersona(
        app,
        PERSONA.alpha,
        "SECRETARIAT",
        (tx) => tx<{ n: string }[]>`select cdf_notifications_v13.portfolio_count(null, null, '0009') as n`,
      );
      expect(Number(hidden?.n)).toBe(0);
      const [restricted] = await asPersona(
        app,
        PERSONA.gamma,
        "INVESTIGATIONS",
        (tx) =>
          tx<{ n: string }[]>`select cdf_notifications_v13.portfolio_count(null, null, 'restricted') as n`,
      );
      expect(Number(restricted?.n)).toBe(0);
      const [closed] = await asPersona(
        app,
        PERSONA.alpha,
        "SECRETARIAT",
        (tx) => tx<{ n: string }[]>`select cdf_notifications_v13.portfolio_count(null, 'CLOSED') as n`,
      );
      expect(Number(closed?.n)).toBe(1);
    });

    it("keyset pages are consistent and the limit is clamped to 1..100", async () => {
      const page = (after: string | null, limit: number) =>
        asPersona(
          app,
          PERSONA.beta,
          "INVESTIGATIONS",
          (tx) =>
            tx<{ display_number: string }[]>`
            select display_number from cdf_notifications_v13.portfolio_page(${after}, ${limit})`,
        );
      const first = await page(null, 3);
      const second = await page(first.at(-1)!.display_number, 3);
      const third = await page(second.at(-1)!.display_number, 3);
      expect([...first, ...second, ...third].map((r) => r.display_number)).toEqual(
        demo([1, 2, 3, 5, 6, 9, 10]),
      );
      expect(await page(null, 0)).toHaveLength(1);
      expect(await page(null, -5)).toHaveLength(1);
      expect(await page(null, 100000)).toHaveLength(7);
    });

    it("visibility and assignment rows follow the same rule (current workspace, accessible cases only)", async () => {
      const [row] = await asPersona(
        app,
        PERSONA.alpha,
        "SECRETARIAT",
        (tx) =>
          tx<{ other_ws: number; hidden_assignments: number; assignments: number }[]>`
          select (select count(*)::int from cdf_notifications_v13.case_workspace_visibility
                   where workspace_id <> ${WORKSPACE.SECRETARIAT}) as other_ws,
                 (select count(*)::int from cdf_notifications_v13.case_assignment
                   where case_id in (${CASE(2)}, ${CASE(5)}, ${CASE(9)})) as hidden_assignments,
                 (select count(*)::int from cdf_notifications_v13.case_assignment) as assignments`,
      );
      expect(row).toMatchObject({ other_ws: 0, hidden_assignments: 0 });
      expect(row!.assignments).toBeGreaterThan(0);
    });

    it("the request role cannot write case tables", async () => {
      const writes: ((tx: Tx) => Promise<unknown>)[] = [
        (tx) => tx`update cdf_notifications_v13.case_record set is_restricted = false where id = ${CASE(9)}`,
        (tx) => tx`insert into cdf_notifications_v13.case_assignment (case_id, persona_id, capacity)
                   values (${CASE(9)}, ${PERSONA.gamma}, 'INVESTIGATOR')`,
        (tx) => tx`insert into cdf_notifications_v13.case_workspace_visibility (case_id, workspace_id)
                   values (${CASE(2)}, ${WORKSPACE.SECRETARIAT})`,
        (tx) => tx`delete from cdf_notifications_v13.task`,
        (tx) => tx`update cdf_notifications_v13.task set status = 'DONE'`,
        (
          tx,
        ) => tx`insert into cdf_notifications_v13.procedural_event (case_id, event_code, occurred_at, provenance)
                   values (${CASE(1)}, 'FORGED', now(), 'RECORDED_IN_V13')`,
      ];
      for (const write of writes)
        expect(await codeOf(rolledBack(PERSONA.beta, "INVESTIGATIONS", write))).toBe("42501");
    });
  });

  describe("api_update_task_status", () => {
    const update = (task: string, status: string | null, version: number | null) => (tx: Tx) =>
      tx<{ task_id: string; case_id: string; status: string; row_version: number }[]>`
        select * from cdf_notifications_v13.api_update_task_status(${task}, ${status}, ${version})`;

    it("the assignee changes a task: task, procedural event and audit row in one transaction", async () => {
      const { result, inspected } = await commandThenInspect(
        PERSONA.beta,
        "INVESTIGATIONS",
        update(TASK(1), "BLOCKED", 1),
        async (tx) => {
          const [task] = await tx<{ status: string; row_version: number }[]>`
            select status, row_version from cdf_notifications_v13.task where id = ${TASK(1)}`;
          const events = await tx<
            { attributes: unknown; recorded_by_persona_id: string; provenance: string }[]
          >`
            select attributes, recorded_by_persona_id, provenance from cdf_notifications_v13.procedural_event
             where subject_id = ${TASK(1)} and provenance = 'RECORDED_IN_V13'`;
          const audit = await tx<
            {
              actor_persona_id: string;
              workspace_id: string;
              case_id: string;
              correlation_id: string;
              metadata: Record<string, unknown>;
            }[]
          >`
            select actor_persona_id, workspace_id, case_id, correlation_id, metadata
              from cdf_notifications_v13.audit_event
             where action = 'TASK_STATUS_CHANGED' and entity_id = ${TASK(1)}`;
          const [chain] = await tx<
            { is_valid: boolean }[]
          >`select is_valid from cdf_notifications_v13.verify_audit_chain()`;
          return { task, events: [...events], audit: [...audit], chain };
        },
      );
      expect([...result]).toEqual([
        { task_id: TASK(1), case_id: CASE(1), status: "BLOCKED", row_version: 2 },
      ]);
      expect(inspected.task).toEqual({ status: "BLOCKED", row_version: 2 });
      expect(inspected.events).toEqual([
        {
          attributes: { from: "IN_PROGRESS", to: "BLOCKED" },
          recorded_by_persona_id: PERSONA.beta,
          provenance: "RECORDED_IN_V13",
        },
      ]);
      expect(inspected.audit).toHaveLength(1);
      expect(inspected.audit[0]).toMatchObject({
        actor_persona_id: PERSONA.beta,
        workspace_id: WORKSPACE.INVESTIGATIONS,
        case_id: CASE(1),
        correlation_id: CORRELATION,
        metadata: { from: "IN_PROGRESS", to: "BLOCKED", row_version: 2 },
      });
      expect(inspected.chain?.is_valid).toBe(true);
    });

    it("a case-assigned persona who is not the assignee may change it; Governance only on its own assignment", async () => {
      // Alpha is SECRETARY on case 0001; task 01 is Beta's.
      expect(await codeOf(rolledBack(PERSONA.alpha, "SECRETARIAT", update(TASK(1), "BLOCKED", 1)))).toBe(
        "OK",
      );
      // Delta is GOVERNANCE_REVIEWER on case 0008 and assignee of task 15.
      expect(await codeOf(rolledBack(PERSONA.delta, "GOVERNANCE", update(TASK(15), "DONE", 1)))).toBe("OK");
      // Delta sees case 0001 in Governance but holds no assignment there.
      expect(await codeOf(rolledBack(PERSONA.delta, "GOVERNANCE", update(TASK(1), "BLOCKED", 1)))).toBe(
        "V1404",
      );
    });

    const refusals: [string, string, WorkspaceCode, ReturnType<typeof update>, string][] = [
      [
        "unknown task id",
        PERSONA.beta,
        "INVESTIGATIONS",
        update("0d000000-0000-4000-8000-0000000000ff", "DONE", 1),
        "V1404",
      ],
      ["NULL task id", PERSONA.beta, "INVESTIGATIONS", update(null as unknown as string, "DONE", 1), "V1404"],
      [
        "task of a case outside the workspace (Alpha, case 0002)",
        PERSONA.alpha,
        "SECRETARIAT",
        update(TASK(3), "IN_PROGRESS", 1),
        "V1404",
      ],
      [
        "task of the restricted case without assignment (Gamma, 0009)",
        PERSONA.gamma,
        "INVESTIGATIONS",
        update(TASK(17), "IN_PROGRESS", 1),
        "V1404",
      ],
      [
        "visible case, neither assignee nor assigned (Gamma, task 01)",
        PERSONA.gamma,
        "INVESTIGATIONS",
        update(TASK(1), "BLOCKED", 1),
        "V1404",
      ],
      [
        "closed case, own task (Gamma, task 20 in 0010)",
        PERSONA.gamma,
        "INVESTIGATIONS",
        update(TASK(20), "IN_PROGRESS", 1),
        "V1423",
      ],
      [
        "closed case, terminal task (Alpha, task 19)",
        PERSONA.alpha,
        "SECRETARIAT",
        update(TASK(19), "OPEN", 1),
        "V1423",
      ],
      ["stale version", PERSONA.beta, "INVESTIGATIONS", update(TASK(1), "BLOCKED", 7), "V1409"],
      ["NULL version", PERSONA.beta, "INVESTIGATIONS", update(TASK(1), "BLOCKED", null), "V1409"],
      [
        "transition not in the graph (OPEN → DONE)",
        PERSONA.beta,
        "INVESTIGATIONS",
        update(TASK(9), "DONE", 1),
        "V1422",
      ],
      ["unknown status", PERSONA.beta, "INVESTIGATIONS", update(TASK(9), "ARCHIVED", 1), "V1422"],
      ["NULL status", PERSONA.beta, "INVESTIGATIONS", update(TASK(9), null, 1), "V1422"],
      [
        "no workspace (Delta @ Investigations)",
        PERSONA.delta,
        "INVESTIGATIONS",
        update(TASK(15), "DONE", 1),
        "V1401",
      ],
      [
        "expired membership (Epsilon)",
        PERSONA.epsilon,
        "SECRETARIAT",
        update(TASK(2), "IN_PROGRESS", 1),
        "V1401",
      ],
      ["deactivated persona (Zeta)", PERSONA.zeta, "SECRETARIAT", update(TASK(2), "IN_PROGRESS", 1), "V1401"],
    ];

    it.each(refusals)("refuses: %s", async (_name, persona, ws, command, expected) => {
      expect(await codeOf(rolledBack(persona, ws, command))).toBe(expected);
    });

    it("takes no correlation id argument: the audit row uses the claims' id (the old signature does not exist)", async () => {
      expect(
        await codeOf(
          rolledBack(
            PERSONA.beta,
            "INVESTIGATIONS",
            (tx) =>
              tx`select * from cdf_notifications_v13.api_update_task_status(${TASK(1)}, 'BLOCKED', 1,
                 '6f1c2a9e-3b7d-4c1e-9a2f-0d8e7b6a5c42'::uuid)`,
          ),
        ),
      ).toBe("42883");
    });

    it("refuses without any claims (V1401) and writes nothing when refused", async () => {
      expect(await codeOf(asRaw(app, {}, update(TASK(1), "BLOCKED", 1)))).toBe("V1401");
      const [row] = await asOwner(
        admin,
        (tx) =>
          tx<{ status: string; row_version: number }[]>`
          select status, row_version from cdf_notifications_v13.task where id = ${TASK(1)}`,
      );
      expect(row).toEqual({ status: "IN_PROGRESS", row_version: 1 });
    });

    it("My Work lists the persona's own open tasks in accessible cases only", async () => {
      const beta = await asPersona(
        app,
        PERSONA.beta,
        "INVESTIGATIONS",
        (tx) => tx<{ task_id: string }[]>`select task_id from cdf_notifications_v13.my_work_tasks()`,
      );
      expect(beta.map((r) => r.task_id).sort()).toEqual([1, 6, 9, 10, 12, 17, 18].map(TASK).sort());
      const alphaAll = await asPersona(
        app,
        PERSONA.alpha,
        "SECRETARIAT",
        (tx) => tx<{ task_id: string }[]>`select task_id from cdf_notifications_v13.my_work_tasks(true)`,
      );
      expect(alphaAll.map((r) => r.task_id)).toContain(TASK(19));
      expect(alphaAll.map((r) => r.task_id)).not.toContain(TASK(1));
      const none = await asPersona(
        app,
        PERSONA.delta,
        "INVESTIGATIONS",
        (tx) => tx`select task_id from cdf_notifications_v13.my_work_tasks(true)`,
      );
      expect(none).toHaveLength(0);
    });
  });

  describe("api_update_task_status takes the task lock only after the access check (SEC LOW)", () => {
    /** Holds FOR UPDATE on a task in another session while `fn` runs, then releases it. */
    async function whileLocked<T>(task: string, fn: () => Promise<T>): Promise<T> {
      let release!: () => void;
      let locked!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const isLocked = new Promise<void>((r) => (locked = r));
      const holder = admin.begin(async (tx) => {
        await tx`select 1 from cdf_notifications_v13.task where id = ${task} for update`;
        locked();
        await held;
      });
      await isLocked;
      try {
        return await fn();
      } finally {
        release();
        await holder;
      }
    }

    const tryUpdate = (persona: string, task: string) =>
      codeOf(
        rolledBack(persona, "INVESTIGATIONS", async (tx) => {
          await tx.unsafe("set local lock_timeout = '500ms'");
          return tx`select * from cdf_notifications_v13.api_update_task_status(${task}, 'BLOCKED', 1)`;
        }),
      );

    it("a caller without access gets V1404 at once while another session holds the row (no wait, no lock)", async () => {
      // Control: the assigned investigator does wait for the lock (55P03 after lock_timeout), so the row is held.
      expect(await whileLocked(TASK(18), () => tryUpdate(PERSONA.beta, TASK(18)))).toBe("55P03");
      // Gamma cannot see restricted case 0009: same answer as an unknown task, without touching the lock.
      expect(await whileLocked(TASK(18), () => tryUpdate(PERSONA.gamma, TASK(18)))).toBe("V1404");
      expect(await whileLocked(TASK(18), () => tryUpdate(PERSONA.gamma, UNKNOWN))).toBe("V1404");
    });
  });

  describe("api_create_notification_draft and notification reads", () => {
    const draft =
      (caseId: string | null, tv: string | null, recipient: string | null, idem: string | null) => (tx: Tx) =>
        tx<{ notification_id: string; case_id: string; lifecycle_status: string; row_version: number }[]>`
        select * from cdf_notifications_v13.api_create_notification_draft(${caseId}, ${tv}, ${recipient}, ${idem})`;

    it("creates a DRAFT with one DRAFT_CREATED event and one audit row carrying the claims correlation id", async () => {
      const { result, inspected } = await commandThenInspect(
        PERSONA.alpha,
        "SECRETARIAT",
        draft(CASE(1), TEMPLATE_VERSION(2), "CASE_TEAM", key("create")),
        async (tx, rows) => {
          const id = rows[0]!.notification_id;
          const events = await tx<{ event_code: string; provenance: string; actor_persona_id: string }[]>`
            select event_code, provenance, actor_persona_id from cdf_notifications_v13.notification_event
             where notification_id = ${id}`;
          const audit = await tx<{ correlation_id: string; metadata: unknown; case_id: string }[]>`
            select correlation_id, metadata, case_id from cdf_notifications_v13.audit_event
             where action = 'NOTIFICATION_DRAFT_CREATED' and entity_id = ${id}`;
          const outbox = await tx<{ n: number }[]>`
            select count(*)::int as n from cdf_notifications_v13.dispatch_outbox where notification_id = ${id}`;
          return { events: [...events], audit: [...audit], outbox: outbox[0]?.n };
        },
      );
      expect(result[0]).toMatchObject({ case_id: CASE(1), lifecycle_status: "DRAFT", row_version: 1 });
      expect(inspected.events).toEqual([
        { event_code: "DRAFT_CREATED", provenance: "COMMAND", actor_persona_id: PERSONA.alpha },
      ]);
      expect(inspected.audit).toEqual([
        {
          correlation_id: CORRELATION,
          case_id: CASE(1),
          metadata: { template_version_id: TEMPLATE_VERSION(2), recipient_class: "CASE_TEAM" },
        },
      ]);
      expect(inspected.outbox).toBe(0);
    });

    it("takes no correlation id argument (the old five-argument signature does not exist)", async () => {
      expect(
        await codeOf(
          rolledBack(
            PERSONA.alpha,
            "SECRETARIAT",
            (tx) =>
              tx`select * from cdf_notifications_v13.api_create_notification_draft(${CASE(1)}, ${TEMPLATE_VERSION(2)},
                 'CASE_TEAM', ${key("corr")}, '6f1c2a9e-3b7d-4c1e-9a2f-0d8e7b6a5c42'::uuid)`,
          ),
        ),
      ).toBe("42883");
    });

    it("an investigator may draft on the restricted case it is assigned to", async () => {
      expect(
        await codeOf(
          rolledBack(
            PERSONA.beta,
            "INVESTIGATIONS",
            draft(CASE(9), TEMPLATE_VERSION(1), "CASE_TEAM", key("r")),
          ),
        ),
      ).toBe("OK");
    });

    const seedKey = (n: string) => createHash("sha256").update(`seed-m1:${n}`).digest("hex");

    it("an idempotency key is used once per author: a replay, or the caller's own seed key, is V1409", async () => {
      const code = await codeOf(
        rolledBack(PERSONA.alpha, "SECRETARIAT", async (tx) => {
          await draft(CASE(1), TEMPLATE_VERSION(2), "CASE_TEAM", key("dup"))(tx);
          await draft(CASE(1), TEMPLATE_VERSION(2), "CASE_TEAM", key("dup"))(tx);
        }),
      );
      expect(code).toBe("V1409");
      // Seed notification 01 was drafted by Secretary Alpha.
      expect(
        await codeOf(
          rolledBack(
            PERSONA.alpha,
            "SECRETARIAT",
            draft(CASE(1), TEMPLATE_VERSION(2), "CASE_TEAM", seedKey("01")),
          ),
        ),
      ).toBe("V1409");
    });

    it("another persona's key gives no signal on a case the caller can access (no V1409)", async () => {
      // Alpha's seed key 01, used by Investigator Beta on case 0001, which Beta can access.
      expect(
        await codeOf(
          rolledBack(
            PERSONA.beta,
            "INVESTIGATIONS",
            draft(CASE(1), TEMPLATE_VERSION(1), "CASE_TEAM", seedKey("01")),
          ),
        ),
      ).toBe("OK");
    });

    it("another persona's key on a hidden case is V1404, exactly like an unknown case", async () => {
      // Beta's seed key 04 belongs to restricted case 0009, which Alpha cannot see.
      const hidden = await codeOf(
        rolledBack(
          PERSONA.alpha,
          "SECRETARIAT",
          draft(CASE(9), TEMPLATE_VERSION(2), "CASE_TEAM", seedKey("04")),
        ),
      );
      const unknown = await codeOf(
        rolledBack(
          PERSONA.alpha,
          "SECRETARIAT",
          draft(UNKNOWN, TEMPLATE_VERSION(2), "CASE_TEAM", seedKey("04")),
        ),
      );
      expect(hidden).toBe("V1404");
      expect(unknown).toBe("V1404");
      // And on a case Alpha can access, Beta's key is simply free for Alpha.
      expect(
        await codeOf(
          rolledBack(
            PERSONA.alpha,
            "SECRETARIAT",
            draft(CASE(1), TEMPLATE_VERSION(2), "CASE_TEAM", seedKey("04")),
          ),
        ),
      ).toBe("OK");
    });

    it("the key is unique per author in the table (not globally)", async () => {
      const [row] = await admin<{ def: string }[]>`
        select pg_catalog.pg_get_constraintdef(c.oid) as def from pg_catalog.pg_constraint c
         where c.conrelid = 'cdf_notifications_v13.notification'::regclass
           and c.conname = 'notification_author_idempotency_unique'`;
      expect(row?.def).toBe("UNIQUE (created_by_persona_id, idempotency_key)");
      const globals = await admin<{ conname: string }[]>`
        select c.conname from pg_catalog.pg_constraint c
         where c.conrelid = 'cdf_notifications_v13.notification'::regclass and c.contype = 'u'
           and pg_catalog.pg_get_constraintdef(c.oid) = 'UNIQUE (idempotency_key)'`;
      expect(globals).toHaveLength(0);
    });

    const refusals: [string, string, WorkspaceCode, ReturnType<typeof draft>, string][] = [
      [
        "unknown case",
        PERSONA.alpha,
        "SECRETARIAT",
        draft(UNKNOWN, TEMPLATE_VERSION(2), "CASE_TEAM", key("a")),
        "V1404",
      ],
      [
        "NULL case",
        PERSONA.alpha,
        "SECRETARIAT",
        draft(null, TEMPLATE_VERSION(2), "CASE_TEAM", key("b")),
        "V1404",
      ],
      [
        "case outside the workspace (Alpha, 0002)",
        PERSONA.alpha,
        "SECRETARIAT",
        draft(CASE(2), TEMPLATE_VERSION(2), "CASE_TEAM", key("c")),
        "V1404",
      ],
      [
        "restricted case without assignment (Alpha, 0009)",
        PERSONA.alpha,
        "SECRETARIAT",
        draft(CASE(9), TEMPLATE_VERSION(2), "CASE_TEAM", key("d")),
        "V1404",
      ],
      [
        "role without the right (Governance Officer Delta)",
        PERSONA.delta,
        "GOVERNANCE",
        draft(CASE(1), TEMPLATE_VERSION(2), "CASE_TEAM", key("e")),
        "V1404",
      ],
      [
        "closed case (Alpha, 0010)",
        PERSONA.alpha,
        "SECRETARIAT",
        draft(CASE(10), TEMPLATE_VERSION(2), "CASE_TEAM", key("f")),
        "V1423",
      ],
      [
        "malformed idempotency key",
        PERSONA.alpha,
        "SECRETARIAT",
        draft(CASE(1), TEMPLATE_VERSION(2), "CASE_TEAM", "ABC"),
        "V1422",
      ],
      [
        "upper-case idempotency key",
        PERSONA.alpha,
        "SECRETARIAT",
        draft(CASE(1), TEMPLATE_VERSION(2), "CASE_TEAM", key("g").toUpperCase()),
        "V1422",
      ],
      [
        "unknown recipient class",
        PERSONA.alpha,
        "SECRETARIAT",
        draft(CASE(1), TEMPLATE_VERSION(2), "EVERYONE", key("h")),
        "V1422",
      ],
      [
        "unknown template version",
        PERSONA.alpha,
        "SECRETARIAT",
        draft(CASE(1), "1f000000-0000-4000-8000-0000000000ff", "CASE_TEAM", key("i")),
        "V1422",
      ],
      [
        "no workspace (Delta @ Investigations)",
        PERSONA.delta,
        "INVESTIGATIONS",
        draft(CASE(1), TEMPLATE_VERSION(2), "CASE_TEAM", key("j")),
        "V1401",
      ],
      [
        "deactivated persona (Zeta)",
        PERSONA.zeta,
        "SECRETARIAT",
        draft(CASE(1), TEMPLATE_VERSION(2), "CASE_TEAM", key("k")),
        "V1401",
      ],
    ];

    it.each(refusals)("refuses: %s", async (_name, persona, ws, command, expected) => {
      expect(await codeOf(rolledBack(persona, ws, command))).toBe(expected);
    });

    it("case_notifications is empty for unknown and unauthorised cases alike", async () => {
      const read = (persona: string, ws: WorkspaceCode, id: string) =>
        asPersona(
          app,
          persona,
          ws,
          (tx) => tx`select * from cdf_notifications_v13.case_notifications(${id})`,
        );
      expect(await read(PERSONA.beta, "INVESTIGATIONS", CASE(9))).not.toHaveLength(0);
      expect(await read(PERSONA.gamma, "INVESTIGATIONS", CASE(9))).toHaveLength(0);
      expect(await read(PERSONA.alpha, "SECRETARIAT", CASE(9))).toHaveLength(0);
      expect(await read(PERSONA.alpha, "SECRETARIAT", UNKNOWN)).toHaveLength(0);
      const [direct] = await asPersona(
        app,
        PERSONA.gamma,
        "INVESTIGATIONS",
        (tx) =>
          tx<{ n: number; e: number }[]>`
          select (select count(*)::int from cdf_notifications_v13.notification where case_id = ${CASE(9)}) as n,
                 (select count(*)::int from cdf_notifications_v13.notification_event where case_id = ${CASE(9)}) as e`,
      );
      expect(direct).toEqual({ n: 0, e: 0 });
    });

    it("the outbox is unreadable and unwritable for the request role; notification tables are read-only", async () => {
      const refused: ((tx: Tx) => Promise<unknown>)[] = [
        (tx) => tx`select count(*) from cdf_notifications_v13.dispatch_outbox`,
        (tx) => tx`update cdf_notifications_v13.notification set lifecycle_status = 'APPROVED'`,
        (tx) => tx`insert into cdf_notifications_v13.notification_event (notification_id, case_id, event_code)
                   values ('2f000000-0000-4000-8000-000000000001', ${CASE(1)}, 'DISPATCHED')`,
        (tx) => tx`update cdf_notifications_v13.notification_template_version set body = 'x'`,
      ];
      for (const query of refused)
        expect(await codeOf(rolledBack(PERSONA.alpha, "SECRETARIAT", query))).toBe("42501");
    });
  });

  describe("integrity and seed invariants", () => {
    it("template versions are immutable and hashed by the database (subject LF body)", async () => {
      expect(
        await codeOf(
          asOwner(
            admin,
            (tx) => tx`update cdf_notifications_v13.notification_template_version set body = 'x'`,
          ),
        ),
      ).toBe("V1403");
      const rows = await asOwner(
        admin,
        (tx) =>
          tx<{ subject: string; body: string; content_sha256: string }[]>`
          select subject, body, content_sha256 from cdf_notifications_v13.notification_template_version`,
      );
      expect(rows.length).toBe(4);
      for (const row of rows)
        expect(row.content_sha256).toBe(
          createHash("sha256").update(`${row.subject}\n${row.body}`, "utf8").digest("hex"),
        );
    });

    it("procedural and notification events are append-only, also for the owner", async () => {
      for (const statement of [
        "update cdf_notifications_v13.procedural_event set event_code = 'X_X_X'",
        "delete from cdf_notifications_v13.procedural_event",
        "truncate cdf_notifications_v13.procedural_event cascade",
        "update cdf_notifications_v13.notification_event set event_code = 'X_X_X'",
        "delete from cdf_notifications_v13.notification_event",
      ])
        expect(await codeOf(asOwner(admin, (tx) => tx.unsafe(statement))), statement).toBe("V1403");
    });

    it("cross-case links are refused by the composite foreign keys (23503)", async () => {
      // A causation from case 0002 cannot be cited by an event of case 0001.
      expect(
        await codeOf(
          asOwner(
            admin,
            (tx) => tx`
            insert into cdf_notifications_v13.procedural_event (case_id, event_code, occurred_at, provenance, causation_id)
            values (${CASE(1)}, 'TEST_LINK', now(), 'RECORDED_IN_V13', '0e000000-0000-4000-8000-000000000002')`,
          ),
        ),
      ).toBe("23503");
      // A notification of case 0001 cannot supersede one of case 0003.
      expect(
        await codeOf(
          asOwner(
            admin,
            (tx) => tx`
            insert into cdf_notifications_v13.notification
              (case_id, template_version_id, recipient_class, idempotency_key, created_by_persona_id, supersedes_id)
            select ${CASE(1)}, ${TEMPLATE_VERSION(2)}, 'CASE_TEAM', ${key("x")}, ${PERSONA.alpha}, n.id
              from cdf_notifications_v13.notification n where n.case_id = ${CASE(3)} limit 1`,
          ),
        ),
      ).toBe("23503");
      // A notification event must name its notification's own case.
      expect(
        await codeOf(
          asOwner(
            admin,
            (tx) => tx`
            insert into cdf_notifications_v13.notification_event (notification_id, case_id, event_code)
            select n.id, ${CASE(2)}, 'TEST_LINK' from cdf_notifications_v13.notification n
             where n.case_id = ${CASE(1)} limit 1`,
          ),
        ),
      ).toBe("23503");
    });

    it("the seed holds no APPROVED or DISPATCHED state, and every state has its event", async () => {
      const [row] = await asOwner(
        admin,
        (tx) =>
          tx<
            {
              not_draft: number;
              without_event: number;
              other_events: number;
              tasks_without_event: number;
              outbox: number;
            }[]
          >`
          select (select count(*)::int from cdf_notifications_v13.notification where lifecycle_status <> 'DRAFT') as not_draft,
                 (select count(*)::int from cdf_notifications_v13.notification n
                   where not exists (select 1 from cdf_notifications_v13.notification_event e
                                      where e.notification_id = n.id and e.event_code = 'DRAFT_CREATED')) as without_event,
                 (select count(*)::int from cdf_notifications_v13.notification_event
                   where event_code <> 'DRAFT_CREATED') as other_events,
                 (select count(*)::int from cdf_notifications_v13.task t
                   where t.status <> 'OPEN' and not exists (
                     select 1 from cdf_notifications_v13.procedural_event e
                      where e.subject_id = t.id and e.event_code = 'TASK_STATUS_CHANGED')) as tasks_without_event,
                 (select count(*)::int from cdf_notifications_v13.dispatch_outbox) as outbox`,
      );
      expect(row).toEqual({
        not_draft: 0,
        without_event: 0,
        other_events: 0,
        tasks_without_event: 0,
        outbox: 0,
      });
    });

    it("case numbers are labels only: every key is a UUID and lookups take UUIDs", async () => {
      expect(
        await codeOf(
          asPersona(
            app,
            PERSONA.alpha,
            "SECRETARIAT",
            (tx) => tx`select * from cdf_notifications_v13.case_header('CDF-DEMO-2026-0001')`,
          ),
        ),
      ).toBe("22P02");
    });
  });
});
