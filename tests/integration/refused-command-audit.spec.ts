// V13-DB-021 · REQ-AUD-005: migration 0013, a refused command leaves one REFUSED, hash-chained audit row (design:
// docs/teams/db/DB-021_REFUSED_COMMAND_AUDIT.md, accepted on #120; SEC's required items R1–R7, #120 comment 6553371697).
// Proves, against the local primary cluster unless noted:
//   R1  one command per transaction, enforced in the database: a second api_* call in the same transaction is refused
//       (V1500, not recorded), api_install_claims_key included; the request role cannot remove the mark; through the
//       real withRequestContext, a refused first command and a second that would succeed commit only one REFUSED row;
//   R2  only V1401, V1404, V1409, V1422 and V1423 are recorded: 42501, V1500 and a constraint error raised inside a
//       command still raise, and write no ledger row and no refusal_window change;
//   R3  the request role cannot execute the internals (42501; catalog-audit and context-forgery list them too), and on
//       the hosted layout the re-created commands keep exactly the grants they had after 0012;
//   R4  the row-shape constraint refuses every malformed REFUSED or SUCCEEDED row;
//   R6  a refused command's subtransaction is undone: a write, a row lock and an advisory lock planted in the command
//       body are gone (a second session locks the row and takes the advisory lock without waiting);
//   R7  the REFUSED writer re-checks access: targets only for V1409/V1422/V1423 and only while can_access_case holds;
//   §4.5 one row per (persona or none, command, code) per 60 s; later refusals only count, and the count is carried
//       into the next window's row; the chain verifies across SUCCEEDED and REFUSED rows; refusal_window is owner-only.
// Faults are planted in transactions that are rolled back; the window suite commits REFUSED rows (codes only) and
// clears refusal_window first. SYNTHETIC DATA ONLY.
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RequestIdentitySchema, type RequestIdentity } from "@/lib/contracts";
import { claimsMac, withRequestContext, type Tx } from "@/lib/db/security-context";
import { buildHostedBundle } from "@/scripts/db/hosted-bundle.mjs";
import { readMigrations } from "@/scripts/db/lib/migrations.mjs";
import { TEST_CLAIMS_KEY } from "./support/claims";
import {
  clusterAvailable,
  errorCodeOf,
  HOSTED_SIM_SUPERUSER_URL,
  PRIMARY_ADMIN_URL,
} from "./support/clusters";
import { adminClient, appClient, asRaw, claimsText, PERSONA, WORKSPACE } from "./support/context";
import { client, resetHostedSim, run } from "./support/hosted-sim";
import { clearRefusalWindows } from "./support/refusal";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);
const hostedSim = await clusterAvailable("hosted-sim", HOSTED_SIM_SUPERUSER_URL);

async function migrated(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean }[]>`
      select exists (select 1 from cdf_notifications_v13.schema_migrations where version = '0013') as present`;
    return Boolean(row?.present);
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}
const present = await migrated();
if (available && !present)
  console.warn("[integration] skipping refused-command-audit: migration 0013 missing");

const S = "cdf_notifications_v13";
const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TASK = (n: number) => `0d000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TEMPLATE_VERSION_2 = "1f000000-0000-4000-8000-000000000002";
const UNKNOWN_TASK = "0d000000-0000-4000-8000-0000000000ff";
const KEY = (label: string) => Buffer.from(`db-021:${label}`).toString("hex").padEnd(64, "0").slice(0, 64);

const update = (task: string, status: string, version: number) => (tx: Tx) =>
  tx<
    Record<string, unknown>[]
  >`select * from cdf_notifications_v13.api_update_task_status(${task}, ${status}, ${version})`;
const draft = (caseId: string, key: string) => (tx: Tx) =>
  tx<Record<string, unknown>[]>`
    select * from cdf_notifications_v13.api_create_notification_draft(${caseId}, ${TEMPLATE_VERSION_2}, 'CASE_TEAM', ${key})`;
const switchTo = (ws: string) => (tx: Tx) =>
  tx<Record<string, unknown>[]>`select * from cdf_notifications_v13.api_switch_workspace(${ws})`;
const install = (tx: Tx) =>
  tx<Record<string, unknown>[]>`select cdf_notifications_v13.api_install_claims_key(${TEST_CLAIMS_KEY}) as r`;

/** The refusal of a command's single answer row, "OK" when it has none, or the SQLSTATE when the call raised. */
async function outcome(tx: Tx, call: (tx: Tx) => Promise<Record<string, unknown>[]>): Promise<string> {
  try {
    const rows = (await tx.savepoint((sp) => call(sp as unknown as Tx))) as Record<string, unknown>[];
    return typeof rows[0]?.refusal === "string" ? (rows[0].refusal as string) : "OK";
  } catch (error) {
    return errorCodeOf(error);
  }
}

const identity = (
  persona: string,
  workspace: "SECRETARIAT" | "INVESTIGATIONS" | "GOVERNANCE",
): RequestIdentity =>
  RequestIdentitySchema.parse({
    persona_id: persona,
    active_workspace: workspace,
    roles: ["COMMITTEE_SECRETARY"],
  });

interface LedgerRow {
  action: string;
  outcome: string;
  actor: string | null;
  workspace: string | null;
  entity: string | null;
  case_id: string | null;
  metadata: Record<string, unknown>;
}
const ledgerFor = (admin: postgres.Sql | Tx, correlationId: string) =>
  admin<LedgerRow[]>`
    select action, outcome, actor_persona_id::text as actor, workspace_id::text as workspace,
           entity_id::text as entity, case_id::text as case_id, metadata
      from cdf_notifications_v13.audit_event where correlation_id = ${correlationId}::uuid order by seq`;

describe.skipIf(!present)("V13-DB-021 refused-command audit (migration 0013)", () => {
  let admin: postgres.Sql;
  let app: postgres.Sql;

  /** Commits `fn` through the real withRequestContext on the app login with its own correlation id. */
  const committed = <T>(who: RequestIdentity, correlationId: string, fn: (tx: Tx) => Promise<T>) =>
    withRequestContext(who, fn, {
      sql: app,
      claimsKey: TEST_CLAIMS_KEY,
      correlationId: correlationId as never,
    });

  /** Commits `fn` as cdf_v13_user with no request context at all. */
  const committedNoContext = <T>(fn: (tx: Tx) => Promise<T>) =>
    app.begin(async (tx) => {
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      return fn(tx as unknown as Tx);
    }) as Promise<T>;

  /**
   * One rolled-back transaction on the administrator connection: verified claims for persona/workspace, then
   * `fn`, which starts as the administrator (plant faults, read anything) and switches to the request role itself.
   */
  async function adminTx<T>(
    persona: string,
    workspaceId: string,
    fn: (tx: Tx) => Promise<T>,
    isolation?: string,
  ): Promise<T> {
    let result: T | undefined;
    class Done extends Error {}
    const body = async (tx: postgres.TransactionSql) => {
      const claims = claimsText(persona, workspaceId);
      const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
      await tx`select pg_catalog.set_config('request.v13.claims', ${claims}, true),
                      pg_catalog.set_config('request.v13.claims_mac', ${claimsMac(TEST_CLAIMS_KEY, claims, row!.xid)}, true)`;
      result = await fn(tx as unknown as Tx);
      throw new Done();
    };
    await (isolation ? admin.begin(isolation, body) : admin.begin(body)).catch((error: unknown) => {
      if (!(error instanceof Done)) throw error;
    });
    return result as T;
  }
  const asUser = (tx: Tx) => tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;

  beforeAll(async () => {
    admin = adminClient();
    app = appClient();
    await committed(identity(PERSONA.alpha, "SECRETARIAT"), randomUUID(), async () => undefined); // test key
  });
  afterAll(async () => {
    await admin?.end({ timeout: 5 });
    await app?.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await clearRefusalWindows(admin);
  });

  describe("R1 one command per transaction", () => {
    it("through withRequestContext: a refused first command and a second that would succeed commit one REFUSED row", async () => {
      const correlationId = randomUUID();
      const key = KEY(`r1-${correlationId}`);
      const answers = await committed(identity(PERSONA.alpha, "SECRETARIAT"), correlationId, async (tx) => [
        [...(await update(UNKNOWN_TASK, "IN_PROGRESS", 1)(tx))],
        [...(await draft(CASE(1), key)(tx))],
      ]);
      expect(answers).toEqual([
        [{ task_id: null, case_id: null, status: null, row_version: null, refusal: "V1404" }],
        [
          {
            notification_id: null,
            case_id: null,
            lifecycle_status: null,
            row_version: null,
            refusal: "V1500",
          },
        ],
      ]);
      expect(await ledgerFor(admin, correlationId)).toEqual([
        {
          action: "COMMAND_REFUSED",
          outcome: "REFUSED",
          actor: PERSONA.alpha,
          workspace: WORKSPACE.SECRETARIAT,
          entity: null,
          case_id: null,
          metadata: { command: "api_update_task_status", refusal: "V1404" },
        },
      ]);
      const notes =
        await admin`select 1 from cdf_notifications_v13.notification where idempotency_key = ${key}`;
      expect(notes).toHaveLength(0);
      // Control: alone in its own transaction (rolled back) the same draft succeeds.
      const alone = await asRaw(
        app,
        { claims: claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), mac: "valid" },
        (tx) => outcome(tx, draft(CASE(1), key)),
      );
      expect(alone).toBe("OK");
    });

    it("every command after any first command is refused V1500; api_install_claims_key takes part (it raises V1500)", async () => {
      const firsts: [string, (tx: Tx) => Promise<Record<string, unknown>[]>, string][] = [
        ["a successful update", update(TASK(1), "BLOCKED", 1), "OK"],
        ["a refused update", update(UNKNOWN_TASK, "BLOCKED", 1), "V1404"],
        ["a successful draft", draft(CASE(1), KEY("r1-first")), "OK"],
        ["a successful switch", switchTo(WORKSPACE.INVESTIGATIONS), "OK"],
        ["api_install_claims_key", install, "OK"],
      ];
      const seconds: [string, (tx: Tx) => Promise<Record<string, unknown>[]>, string][] = [
        ["update", update(TASK(9), "IN_PROGRESS", 1), "V1500"],
        ["draft", draft(CASE(3), KEY("r1-second")), "V1500"],
        ["switch", switchTo(WORKSPACE.INVESTIGATIONS), "V1500"],
        ["api_install_claims_key", install, "V1500"],
      ];
      for (const [firstLabel, first, firstExpected] of firsts)
        for (const [secondLabel, second, expected] of seconds) {
          const got = await asRaw(
            app,
            { claims: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS), mac: "valid" },
            async (tx) => [await outcome(tx, first), await outcome(tx, second)],
          );
          expect(got, `${firstLabel} then ${secondLabel}`).toEqual([firstExpected, expected]);
        }
    });

    it("a V1500 refusal is not recorded: no ledger row, no window", async () => {
      const correlationId = randomUUID();
      await committed(identity(PERSONA.alpha, "SECRETARIAT"), correlationId, async (tx) => {
        await switchTo(WORKSPACE.SECRETARIAT)(tx);
        return switchTo(WORKSPACE.INVESTIGATIONS)(tx);
      });
      expect((await ledgerFor(admin, correlationId)).map((r) => r.action)).toEqual(["WORKSPACE_SWITCHED"]);
      expect(await admin`select 1 from cdf_notifications_v13.refusal_window`).toHaveLength(0);
    });

    it("the request role cannot remove the mark (advisory unlock), and a fresh transaction runs a command again", async () => {
      const got = await asRaw(
        app,
        { claims: claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), mac: "valid" },
        async (tx) => {
          const first = await outcome(tx, switchTo(WORKSPACE.SECRETARIAT));
          const [u] = await tx<{ released: boolean }[]>`
            select pg_catalog.pg_advisory_unlock(pg_catalog.hashtext('cdf_notifications_v13'),
                                                 pg_catalog.pg_backend_pid()) as released`;
          await tx`select pg_catalog.pg_advisory_unlock_all()`;
          return [first, u!.released, await outcome(tx, switchTo(WORKSPACE.SECRETARIAT))];
        },
      );
      expect(got).toEqual(["OK", false, "V1500"]);
      const fresh = await asRaw(
        app,
        { claims: claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), mac: "valid" },
        (tx) => outcome(tx, switchTo(WORKSPACE.SECRETARIAT)),
      );
      expect(fresh).toBe("OK");
    });

    it("rolling back to a savepoint releases the mark together with everything the command did", async () => {
      const got = await asRaw(
        app,
        { claims: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS), mac: "valid" },
        async (tx) => {
          await tx
            .savepoint(async (sp) => {
              await update(TASK(1), "BLOCKED", 1)(sp as unknown as Tx);
              throw new Error("roll back");
            })
            .catch(() => undefined);
          const [task] = await tx<{ row_version: number }[]>`
            select row_version from cdf_notifications_v13.task where id = ${TASK(1)}`;
          return [task?.row_version, await outcome(tx, update(TASK(1), "BLOCKED", 1))];
        },
      );
      expect(got).toEqual([1, "OK"]);
    });
  });

  describe("R2 only the five refusal codes are recorded; any other error raises and writes nothing", () => {
    const snapshot = async (tx: Tx) => {
      // Row count, not max(seq): the sequence also advances in rolled-back transactions.
      const [a] = await tx<{ seq: string }[]>`
        select count(*)::text as seq from cdf_notifications_v13.audit_event`;
      const windows = await tx<{ w: string }[]>`
        select pg_catalog.row_to_json(w)::text as w from cdf_notifications_v13.refusal_window w order by 1`;
      return { seq: a!.seq, windows: windows.map((r) => r.w) };
    };
    const faults: [string, string | null, string | undefined, string][] = [
      [
        "42501 (the owner's UPDATE on task revoked)",
        `revoke update on ${S}.task from cdf_v13_owner`,
        undefined,
        "42501",
      ],
      [
        "a constraint error (a planted check on procedural_event)",
        `alter table ${S}.procedural_event add constraint db021_fault check (false) not valid`,
        undefined,
        "23514",
      ],
      ["V1500 (the audit writer refuses REPEATABLE READ)", null, "isolation level repeatable read", "V1500"],
    ];
    it.each(faults)(
      "%s raises, with no ledger row and no window change",
      async (_label, plant, isolation, code) => {
        const got = await adminTx(
          PERSONA.beta,
          WORKSPACE.INVESTIGATIONS,
          async (tx) => {
            // A window for this persona, command and code already exists, so a wrongly recorded refusal would show.
            await tx`insert into cdf_notifications_v13.refusal_window (actor_key, command, refusal, window_start)
                   values (${PERSONA.beta}, 'api_update_task_status', 'V1409', '-infinity')`;
            if (plant) await tx.unsafe(plant);
            const before = await snapshot(tx);
            await asUser(tx);
            const result = await outcome(tx, update(TASK(1), "BLOCKED", 1));
            await tx`reset role`;
            return { result, same: JSON.stringify(await snapshot(tx)) === JSON.stringify(before) };
          },
          isolation,
        );
        expect(got).toEqual({ result: code, same: true });
      },
    );

    it("control: without a fault the same call succeeds, and a refusal on the same path is recorded", async () => {
      const got = await adminTx(PERSONA.beta, WORKSPACE.INVESTIGATIONS, async (tx) => {
        const before = await snapshot(tx);
        await asUser(tx);
        const refused = await outcome(tx, update(TASK(1), "BLOCKED", 7));
        await tx`reset role`;
        const after = await snapshot(tx);
        return { refused, newRows: Number(after.seq) - Number(before.seq), windows: after.windows.length };
      });
      expect(got).toEqual({ refused: "V1409", newRows: 1, windows: 1 });
    });
  });

  describe("R3 the internals are owner-only", () => {
    it("cdf_v13_user calling a command body, the writers or the slot directly gets 42501", async () => {
      const calls: [string, (tx: Tx) => Promise<unknown>][] = [
        [
          "_api_update_task_status_impl",
          (tx) => tx`select * from ${tx(S)}._api_update_task_status_impl(${TASK(1)}, 'BLOCKED', 1)`,
        ],
        [
          "_api_create_notification_draft_impl",
          (tx) =>
            tx`select * from ${tx(S)}._api_create_notification_draft_impl(${CASE(1)}, ${TEMPLATE_VERSION_2}, 'CASE_TEAM', ${KEY("r3")})`,
        ],
        [
          "_api_switch_workspace_impl",
          (tx) => tx`select * from ${tx(S)}._api_switch_workspace_impl(${WORKSPACE.SECRETARIAT})`,
        ],
        [
          "_api_install_claims_key_impl",
          (tx) => tx`select ${tx(S)}._api_install_claims_key_impl(${TEST_CLAIMS_KEY})`,
        ],
        [
          "_append_audit_refused",
          (tx) =>
            tx`select ${tx(S)}._append_audit_refused('api_switch_workspace', 'V1404', 'workspace', null, null)`,
        ],
        [
          "_append_audit_row",
          (tx) =>
            tx`select ${tx(S)}._append_audit_row('COMMAND_REFUSED', 'task', null, null, '{}'::jsonb, 'REFUSED')`,
        ],
        ["_append_audit", (tx) => tx`select ${tx(S)}._append_audit('TEST', 'test', null, null)`],
        ["_claim_command_slot", (tx) => tx`select ${tx(S)}._claim_command_slot()`],
        ["refusal_window (read)", (tx) => tx`select count(*) from ${tx(S)}.refusal_window`],
        ["refusal_window (write)", (tx) => tx`delete from ${tx(S)}.refusal_window`],
      ];
      const got = await asRaw(
        app,
        { claims: claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), mac: "valid" },
        async (tx) => {
          const out: Record<string, string> = {};
          for (const [label, call] of calls)
            out[label] = await outcome(tx, call as (tx: Tx) => Promise<Record<string, unknown>[]>);
          return out;
        },
      );
      expect(got).toEqual(Object.fromEntries(calls.map(([label]) => [label, "42501"])));
    });
  });

  describe("R4 the row-shape constraint", () => {
    const insert = (cols: Record<string, unknown>) => (tx: Tx) => {
      const row = {
        action: "COMMAND_REFUSED",
        entity_type: "task",
        entity_id: null,
        case_id: null,
        actor_persona_id: PERSONA.alpha,
        outcome: "REFUSED",
        metadata: { command: "api_update_task_status", refusal: "V1404" },
        hash_version: 2,
        policy_version: "V13-ACCESS-0013",
        prev_hash: "0".repeat(64),
        row_hash: "1".repeat(64),
        ...cols,
      };
      return tx`insert into cdf_notifications_v13.audit_event ${tx(row)}` as unknown as Promise<
        Record<string, unknown>[]
      >;
    };
    const refusedRow = (refusal: string, extra: Record<string, unknown> = {}) => ({
      metadata: { command: "api_update_task_status", refusal },
      ...extra,
    });
    const rows: [string, Record<string, unknown>, string][] = [
      ["control: a well-formed V1404 row", {}, "OK"],
      [
        "control: a V1409 row with its target",
        refusedRow("V1409", { entity_id: TASK(1), case_id: CASE(1) }),
        "OK",
      ],
      ["control: a V1401 row without an actor", refusedRow("V1401", { actor_persona_id: null }), "OK"],
      [
        "control: a REFUSED row with a suppressed count",
        refusedRow("V1409", {
          metadata: { command: "api_update_task_status", refusal: "V1409", suppressed: 4 },
        }),
        "OK",
      ],
      ["V1404 with an entity id", { entity_id: TASK(1) }, "23514"],
      ["V1404 with a case id", { case_id: CASE(1) }, "23514"],
      [
        "V1401 with an entity id",
        refusedRow("V1401", { entity_id: TASK(1), actor_persona_id: null }),
        "23514",
      ],
      ["V1401 with a case id", refusedRow("V1401", { case_id: CASE(1), actor_persona_id: null }), "23514"],
      ["a V1404 row without an actor", { actor_persona_id: null }, "23514"],
      ["a V1409 row without an actor", refusedRow("V1409", { actor_persona_id: null }), "23514"],
      ["a REFUSED row with another action", { action: "TASK_STATUS_CHANGED" }, "23514"],
      [
        "a REFUSED row with an extra metadata key",
        { metadata: { command: "api_update_task_status", refusal: "V1404", note: "x" } },
        "23514",
      ],
      ["a REFUSED row without the code", { metadata: { command: "api_update_task_status" } }, "23514"],
      [
        "a REFUSED row with an unknown command",
        { metadata: { command: "api_x", refusal: "V1404" } },
        "23514",
      ],
      ["a REFUSED row with an unknown code", refusedRow("V1500"), "23514"],
      [
        "a suppressed count of 0",
        { metadata: { command: "api_update_task_status", refusal: "V1404", suppressed: 0 } },
        "23514",
      ],
      [
        "a suppressed count as text",
        { metadata: { command: "api_update_task_status", refusal: "V1404", suppressed: "4" } },
        "23514",
      ],
      ["a SUCCEEDED row named COMMAND_REFUSED", { outcome: "SUCCEEDED", metadata: {} }, "23514"],
      [
        "a SUCCEEDED row with a refusal key",
        { outcome: "SUCCEEDED", action: "TASK_STATUS_CHANGED", metadata: { refusal: "V1404" } },
        "23514",
      ],
      [
        "a SUCCEEDED row with a suppressed key",
        { outcome: "SUCCEEDED", action: "TASK_STATUS_CHANGED", metadata: { suppressed: 1 } },
        "23514",
      ],
    ];
    it.each(rows)("%s → %s", async (_label, cols, code) => {
      const got = await adminTx(PERSONA.alpha, WORKSPACE.SECRETARIAT, async (tx) => {
        await tx`alter table cdf_notifications_v13.audit_event disable trigger audit_event_no_update_delete`;
        return outcome(tx, insert(cols));
      });
      expect(got).toBe(code);
    });
  });

  describe("R6 a refused command's subtransaction is undone", () => {
    // Replaces the task command's body inside a rolled-back transaction: it writes a procedural event, locks the task
    // row, takes an advisory lock in the V13 namespace, then raises V1409 when asked to BLOCK (and returns otherwise).
    const PLANTED = `
      create or replace function ${S}._api_update_task_status_impl(
        p_task_id uuid, p_new_status text, p_expected_version integer)
      returns table (task_id uuid, case_id uuid, status text, row_version integer)
      language plpgsql volatile security definer set search_path = '' as $fn$
      #variable_conflict use_column
      declare v_case uuid;
      begin
        select t.case_id into v_case from ${S}.task t where t.id = p_task_id for update;
        insert into ${S}.procedural_event (case_id, event_code, occurred_at, provenance)
        values (v_case, 'DB021_PLANTED', clock_timestamp(), 'SEED_SYNTHETIC');
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'), 777);
        if p_new_status = 'BLOCKED' then
          raise exception 'planted' using errcode = 'V1409';
        end if;
        return query select p_task_id, v_case, p_new_status, p_expected_version + 1;
      end $fn$`;

    async function plantedRun(status: string) {
      const other = adminClient();
      try {
        return await adminTx(PERSONA.beta, WORKSPACE.INVESTIGATIONS, async (tx) => {
          await tx.unsafe("set local role cdf_v13_owner");
          await tx.unsafe(PLANTED);
          await tx`reset role`;
          await asUser(tx);
          const result = await outcome(tx, update(TASK(1), status, 1));
          await tx`reset role`;
          const [planted] = await tx<{ n: number }[]>`
            select count(*)::int as n from cdf_notifications_v13.procedural_event where event_code = 'DB021_PLANTED'`;
          const [held] = await tx<{ n: number }[]>`
            select count(*)::int as n from pg_catalog.pg_locks
             where locktype = 'advisory' and pid = pg_catalog.pg_backend_pid() and objid = 777`;
          const refused = await tx<{ entity: string | null }[]>`
            select entity_id::text as entity from cdf_notifications_v13.audit_event
             where action = 'COMMAND_REFUSED' and seq > (select max(seq) - 1 from cdf_notifications_v13.audit_event)`;
          // A second session: the row lock and the advisory lock must be free (no wait).
          const free = await other.begin(async (o) => {
            await o`set local lock_timeout = '500ms'`;
            const rowFree = await o
              .savepoint(
                (sp) => sp`select id from cdf_notifications_v13.task where id = ${TASK(1)} for update nowait`,
              )
              .then(() => true)
              .catch(() => false);
            const [a] = await o<{ ok: boolean }[]>`
              select pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'), 777) as ok`;
            return { rowFree, advisoryFree: a!.ok };
          });
          return {
            result,
            plantedEvents: planted!.n,
            advisoryHeld: held!.n,
            refusedRows: refused.length,
            ...free,
          };
        });
      } finally {
        await other.end({ timeout: 5 });
      }
    }

    it("the write, the row lock and the advisory lock taken before the raise are gone; the REFUSED row stays", async () => {
      expect(await plantedRun("BLOCKED")).toEqual({
        result: "V1409",
        plantedEvents: 0,
        advisoryHeld: 0,
        refusedRows: 1,
        rowFree: true,
        advisoryFree: true,
      });
    });

    it("control: when the planted body returns, its write and both locks are still held", async () => {
      expect(await plantedRun("DONE")).toEqual({
        result: "OK",
        plantedEvents: 1,
        advisoryHeld: 1,
        refusedRows: 0,
        rowFree: false,
        advisoryFree: false,
      });
    });
  });

  describe("R7 the REFUSED writer re-checks access when it writes", () => {
    const refusedBy = (
      code: string,
      command: string,
      entityType: string,
      entity: string | null,
      caseId: string | null,
    ) =>
      adminTx(PERSONA.alpha, WORKSPACE.SECRETARIAT, async (tx) => {
        await tx`select cdf_notifications_v13._append_audit_refused(${command}, ${code}, ${entityType}, ${entity}, ${caseId})`;
        const [row] = await tx<{ entity: string | null; case_id: string | null }[]>`
          select entity_id::text as entity, case_id::text as case_id from cdf_notifications_v13.audit_event
           order by seq desc limit 1`;
        return row;
      });
    it.each([
      [
        "V1409 on a case Alpha can access (0001): target and case",
        "V1409",
        TASK(2),
        CASE(1),
        { entity: TASK(2), case_id: CASE(1) },
      ],
      [
        "V1422 on a case Alpha can access (0001): target and case",
        "V1422",
        TASK(2),
        CASE(1),
        { entity: TASK(2), case_id: CASE(1) },
      ],
      [
        "V1423 on the closed case Alpha can access (0010)",
        "V1423",
        TASK(19),
        CASE(10),
        { entity: TASK(19), case_id: CASE(10) },
      ],
      [
        "V1409 on a case hidden from Alpha's workspace (0002): no ids",
        "V1409",
        TASK(3),
        CASE(2),
        { entity: null, case_id: null },
      ],
      [
        "V1423 on the restricted case Alpha is not assigned to (0009): no ids",
        "V1423",
        TASK(17),
        CASE(9),
        { entity: null, case_id: null },
      ],
      [
        "V1409 on an unknown case: no ids",
        "V1409",
        UNKNOWN_TASK,
        "0c000000-0000-4000-8000-0000000000ff",
        { entity: null, case_id: null },
      ],
      ["V1404 on an accessible case: no ids", "V1404", TASK(2), CASE(1), { entity: null, case_id: null }],
      ["V1401 on an accessible case: no ids", "V1401", TASK(2), CASE(1), { entity: null, case_id: null }],
    ] as const)("%s", async (_label, code, entity, caseId, expected) => {
      expect(await refusedBy(code, "api_update_task_status", "task", entity, caseId)).toEqual(expected);
    });

    it("refuses (V1422) a command, code or entity type outside the §1 table", async () => {
      const codes = await adminTx(PERSONA.alpha, WORKSPACE.SECRETARIAT, async (tx) => {
        const out: string[] = [];
        for (const [command, code, type] of [
          ["api_switch_workspace", "V1409", "workspace"],
          ["api_install_claims_key", "V1409", "claims_key"],
          ["api_update_task_status", "V1500", "task"],
          ["api_update_task_status", "V1404", "workspace"],
          ["api_create_notification_draft", "V1404", "task"],
        ])
          out.push(
            await outcome(
              tx,
              (t) =>
                t`select cdf_notifications_v13._append_audit_refused(${command!}, ${code!}, ${type!}, null, null)`,
            ),
          );
        return out;
      });
      expect(codes).toEqual(["V1422", "V1422", "V1422", "V1422", "V1422"]);
    });
  });

  describe("§4.5 the window bound (committed; REFUSAL_AUDIT_WINDOW_SECONDS = 60)", () => {
    const DELTA = identity(PERSONA.delta, "GOVERNANCE");
    const refuseAsDelta = async () => {
      const correlationId = randomUUID();
      const [row] = await committed(DELTA, correlationId, (tx) => update(UNKNOWN_TASK, "IN_PROGRESS", 1)(tx));
      return { correlationId, refusal: row?.refusal };
    };
    const window = async (actor: string) =>
      admin<{ suppressed: number }[]>`
        select suppressed from cdf_notifications_v13.refusal_window
         where actor_key = ${actor}::uuid and command = 'api_update_task_status' and refusal = 'V1404'`;

    it("N refusals in a window give one row and suppressed = N − 1, carried into the next window's row", async () => {
      const [seqBefore] = await admin<{ seq: string }[]>`
        select count(*)::text as seq from cdf_notifications_v13.audit_event`;
      const first = await refuseAsDelta();
      const more = [await refuseAsDelta(), await refuseAsDelta()];
      expect([first, ...more].map((r) => r.refusal)).toEqual(["V1404", "V1404", "V1404"]);
      expect(await ledgerFor(admin, first.correlationId)).toHaveLength(1);
      for (const r of more) expect(await ledgerFor(admin, r.correlationId)).toEqual([]);
      expect(await window(PERSONA.delta)).toEqual([{ suppressed: 2 }]);
      const [seqAfter] = await admin<{ seq: string }[]>`
        select count(*)::text as seq from cdf_notifications_v13.audit_event`;
      expect(Number(seqAfter!.seq) - Number(seqBefore!.seq)).toBe(1);

      // The window ends (moved back 61 s as the administrator): the next refusal writes a row carrying the count.
      await admin`update cdf_notifications_v13.refusal_window set window_start = window_start - interval '61 seconds'`;
      const next = await refuseAsDelta();
      expect(await ledgerFor(admin, next.correlationId)).toEqual([
        {
          action: "COMMAND_REFUSED",
          outcome: "REFUSED",
          actor: PERSONA.delta,
          workspace: WORKSPACE.GOVERNANCE,
          entity: null,
          case_id: null,
          metadata: { command: "api_update_task_status", refusal: "V1404", suppressed: 2 },
        },
      ]);
      expect(await window(PERSONA.delta)).toEqual([{ suppressed: 0 }]);
    });

    it("another persona, command or code has its own window; no context shares one key", async () => {
      const a = await refuseAsDelta();
      const otherPersona = randomUUID();
      await committed(identity(PERSONA.alpha, "SECRETARIAT"), otherPersona, (tx) =>
        update(UNKNOWN_TASK, "IN_PROGRESS", 1)(tx),
      );
      const otherCommand = randomUUID();
      await committed(DELTA, otherCommand, (tx) => switchTo(WORKSPACE.INVESTIGATIONS)(tx));
      for (const id of [a.correlationId, otherPersona, otherCommand])
        expect(await ledgerFor(admin, id), id).toHaveLength(1);
      const [seqBefore] = await admin<{ seq: string }[]>`
        select count(*)::text as seq from cdf_notifications_v13.audit_event`;
      for (let k = 0; k < 3; k += 1) await committedNoContext((tx) => update(TASK(1), "BLOCKED", 1)(tx));
      const [seqAfter] = await admin<{ seq: string }[]>`
        select count(*)::text as seq from cdf_notifications_v13.audit_event`;
      expect(Number(seqAfter!.seq) - Number(seqBefore!.seq)).toBe(1);
      expect(await window("00000000-0000-0000-0000-000000000000")).toEqual([]); // V1401, not V1404
      const [nil] = await admin<{ suppressed: number; refusal: string }[]>`
        select suppressed, refusal from cdf_notifications_v13.refusal_window
         where actor_key = '00000000-0000-0000-0000-000000000000'`;
      expect(nil).toEqual({ suppressed: 2, refusal: "V1401" });
    });

    it("the chain verifies across SUCCEEDED and REFUSED rows", async () => {
      const [v] = await admin<{ is_valid: boolean; refused: number }[]>`
        select (select is_valid from cdf_notifications_v13.verify_audit_chain()) as is_valid,
               (select count(*)::int from cdf_notifications_v13.audit_event where outcome = 'REFUSED') as refused`;
      expect(v!.is_valid).toBe(true);
      expect(v!.refused).toBeGreaterThan(0);
    });
  });
});

describe.skipIf(!hostedSim)("V13-DB-021 R3 on the hosted layout: 0013 keeps the commands' grants", () => {
  const FUNCTIONS = [
    "api_install_claims_key(bytea)",
    "api_update_task_status(uuid, text, integer)",
    "api_create_notification_draft(uuid, uuid, text, text)",
    "api_switch_workspace(uuid)",
    "_append_audit(text, text, uuid, uuid, jsonb)",
  ];
  // Read as supabase_admin: the hosted administrator has no USAGE on the V13 schema.
  const acls = async (url: string) => {
    const sql = client(url);
    try {
      const out: Record<string, string | null> = {};
      for (const f of FUNCTIONS) {
        const [row] = await sql<{ acl: string | null }[]>`
          select p.proacl::text as acl from pg_catalog.pg_proc p
           where p.oid = pg_catalog.to_regprocedure(${`cdf_notifications_v13.${f}`})`;
        out[f] = row?.acl ?? null;
      }
      return out;
    } finally {
      await sql.end({ timeout: 5 });
    }
  };

  it("the ACLs after 0012 and after 0013 are identical; the register holds both rows and the guard holds", async () => {
    const sim = await resetHostedSim();
    for (const m of readMigrations().filter((x) => x.version <= "0012"))
      await run(sim.adminUrl, buildHostedBundle({ version: m.version }));
    const before = await acls(sim.superuserUrl);
    expect(Object.values(before).every((a) => a !== null)).toBe(true);
    await run(sim.adminUrl, buildHostedBundle({ version: "0013", dryRun: true }));
    expect(await acls(sim.superuserUrl)).toEqual(before);
    await run(sim.adminUrl, buildHostedBundle({ version: "0013" }));
    expect(await acls(sim.superuserUrl)).toEqual(before);
    const sql = client(sim.superuserUrl);
    try {
      const rows = await sql<{ version: string; ok: boolean }[]>`
        select pv.version,
               pv.fingerprint = (select cdf_notifications_v13._policy_fingerprint()) as ok
          from cdf_notifications_v13.policy_version pv order by pv.version`;
      expect(rows.map((r) => [r.version, r.ok])).toEqual([
        ["V13-ACCESS-0012", false],
        ["V13-ACCESS-0013", true],
      ]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 180_000);
});
