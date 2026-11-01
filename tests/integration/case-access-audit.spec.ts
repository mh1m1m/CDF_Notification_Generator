// V13-DB-023 — migration 0015 (REQ-AUD-001): api_record_access writes one hash-chained access row for a case open
// (CASE_OPENED, or RESTRICTED_CASE_OPENED for a restricted case) or a notification preview, ids only, in the caller's
// transaction. Unknown and unauthorised cases leave the same id-less COMMAND_REFUSED row (SEC Q3). Negative cases:
// other case, other workspace, other persona, restricted 0009, unknown case and notification, another case's
// notification, invalid kinds, no or forged context, the app login itself, a second command in the transaction, a
// failing append (fail closed; the window never replaces a row, SEC point 3), row shapes the ledger must refuse.
// Every transaction is rolled back. SYNTHETIC seed data only.
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Tx } from "@/lib/db/security-context";
import { DB_PERSONAS } from "../fixtures/db-personas";
import { clusterAvailable, errorCodeOf, PRIMARY_ADMIN_URL } from "./support/clusters";
import {
  adminClient,
  appClient,
  asPersona,
  asRaw,
  claimsText,
  CORRELATION,
  PERSONA,
  WORKSPACE,
} from "./support/context";
import { clearRefusalWindows } from "./support/refusal";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function ready(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean; cases: number }[]>`
      select pg_catalog.to_regprocedure('cdf_notifications_v13.api_record_access(text, uuid, uuid)') is not null as present,
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
  console.warn("[integration] skipping case-access-audit: migration 0015 or cases seed missing");

const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const NOTIFICATION = (n: number) => `2f000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ALL_CASES = Array.from({ length: 10 }, (_, k) => CASE(k + 1));
const UNKNOWN_CASE = "0c000000-0000-4000-8000-0000000000ff";
const UNKNOWN_NOTIFICATION = "2f000000-0000-4000-8000-0000000000ff";
const RESTRICTED = CASE(9);

const PERSONA_ID: Record<string, string> = {
  "secretary-alpha": PERSONA.alpha,
  "investigator-beta": PERSONA.beta,
  "investigator-gamma": PERSONA.gamma,
  "governance-officer-delta": PERSONA.delta,
};

interface LedgerRow {
  action: string;
  outcome: string;
  entity_type: string;
  entity_id: string | null;
  case_id: string | null;
  actor_persona_id: string | null;
  workspace_id: string | null;
  correlation_id: string | null;
  metadata: Record<string, unknown>;
}

/** Ledger rows appended after `seq` (administrator; the request role cannot read the ledger). */
const rowsAfter = (tx: Tx, seq: string) =>
  tx<LedgerRow[]>`
    select action, outcome, entity_type, entity_id, case_id, actor_persona_id, workspace_id, correlation_id, metadata
      from cdf_notifications_v13.audit_event where seq > ${seq}::bigint order by seq`;

/** The current highest seq, as the administrator, then back to the request role. */
async function mark(tx: Tx): Promise<string> {
  await tx`reset role`;
  const [row] = await tx<{ seq: string }[]>`
    select coalesce(max(seq), 0)::text as seq from cdf_notifications_v13.audit_event`;
  await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
  return row!.seq;
}

/** Reads the rows written since `seq` as the administrator, then returns to the request role. */
async function since(tx: Tx, seq: string): Promise<LedgerRow[]> {
  await tx`reset role`;
  const rows = await rowsAfter(tx, seq);
  await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
  return [...rows];
}

const record = (tx: Tx, kind: string | null, caseId: string | null, notificationId: string | null = null) =>
  tx<{ refusal: string | null }[]>`
    select refusal from cdf_notifications_v13.api_record_access(${kind}::text, ${caseId}::uuid, ${notificationId}::uuid)`;

/** The command's body as the administrator under this transaction's claims (several opens in one transaction). */
async function impl(tx: Tx, kind: string, caseId: string, notificationId: string | null = null) {
  await tx`reset role`;
  await tx`select cdf_notifications_v13._api_record_access_impl(${kind}, ${caseId}::uuid, ${notificationId}::uuid)`;
  await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
}

const refusedRow = (code: string, actor: string | null, workspace: string | null): LedgerRow => ({
  action: "COMMAND_REFUSED",
  outcome: "REFUSED",
  entity_type: "case",
  entity_id: null,
  case_id: null,
  actor_persona_id: actor,
  workspace_id: workspace,
  correlation_id: actor === null ? null : CORRELATION,
  metadata: { command: "api_record_access", refusal: code },
});

describe.skipIf(!present)("case access audit (migration 0015)", () => {
  let app: postgres.Sql;
  let admin: postgres.Sql;
  /** A rolled-back transaction as the persona, on the administrator connection so the ledger can be read. */
  const as = <T>(persona: string, workspace: string, fn: (tx: Tx) => Promise<T>) =>
    asRaw(admin, { claims: claimsText(persona, workspace), mac: "valid" }, fn);
  const beta = <T>(fn: (tx: Tx) => Promise<T>) => as(PERSONA.beta, WORKSPACE.INVESTIGATIONS, fn);

  beforeAll(async () => {
    app = appClient();
    admin = adminClient();
    await asPersona(app, PERSONA.alpha, "SECRETARIAT", async () => undefined); // installs the test key if needed
  });
  beforeEach(async () => {
    await clearRefusalWindows(admin);
    await admin`delete from cdf_notifications_v13.access_window`;
  });
  afterAll(async () => {
    await app.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("shape: the command is a definer with an empty search_path, EXECUTE for cdf_v13_user only; its body and writer are never granted", async () => {
    const rows = await admin<{ sig: string; definer: boolean; config: string[] | null; acl: string }[]>`
      select replace(p.oid::regprocedure::text, 'cdf_notifications_v13.', '') as sig, p.prosecdef as definer,
             p.proconfig as config, p.proacl::text as acl
        from pg_catalog.pg_proc p
       where p.pronamespace = 'cdf_notifications_v13'::regnamespace
         and p.proname in ('api_record_access', '_api_record_access_impl', '_record_access_row')
       order by 1`;
    expect(rows.map((r) => [r.sig, r.definer, r.config, r.acl])).toEqual([
      [
        "_api_record_access_impl(text,uuid,uuid)",
        true,
        ['search_path=""'],
        "{cdf_v13_owner=X/cdf_v13_owner}",
      ],
      [
        "_record_access_row(text,text,uuid,uuid)",
        true,
        ['search_path=""'],
        "{cdf_v13_owner=X/cdf_v13_owner}",
      ],
      [
        "api_record_access(text,uuid,uuid)",
        true,
        ['search_path=""'],
        "{cdf_v13_owner=X/cdf_v13_owner,cdf_v13_user=X/cdf_v13_owner}",
      ],
    ]);
  });

  it("access_window: RLS on, one restrictive deny-all policy, no privilege for any application role", async () => {
    const [table] = await admin<{ rls: boolean; acl: string | null; owner: string }[]>`
      select c.relrowsecurity as rls, c.relacl::text as acl, pg_catalog.pg_get_userbyid(c.relowner) as owner
        from pg_catalog.pg_class c where c.oid = 'cdf_notifications_v13.access_window'::regclass`;
    expect(table).toEqual({ rls: true, acl: null, owner: "cdf_v13_owner" });
    const policies = await admin<{ name: string; permissive: string; qual: string }[]>`
      select policyname as name, permissive, qual from pg_catalog.pg_policies
       where schemaname = 'cdf_notifications_v13' and tablename = 'access_window'`;
    expect(policies).toEqual([{ name: "access_window_deny_all", permissive: "RESTRICTIVE", qual: "false" }]);
    const code = await beta((tx) => tx`select count(*) from cdf_notifications_v13.access_window`).catch(
      (error: unknown) => errorCodeOf(error),
    );
    expect(code).toBe("42501");
  });

  for (const pair of DB_PERSONAS) {
    it(`${pair.persona} in ${pair.workspace}: a visible case writes one open row; any other case one id-less V1404 row`, async () => {
      const persona = PERSONA_ID[pair.persona]!;
      const ws = WORKSPACE[pair.workspace];
      const opened: string[] = [];
      for (const caseId of [...ALL_CASES, UNKNOWN_CASE]) {
        const { answer, rows } = await as(persona, ws, async (tx) => {
          const seq = await mark(tx);
          const answer = await record(tx, "CASE", caseId);
          return { answer, rows: await since(tx, seq) };
        });
        expect(answer, caseId).toHaveLength(1);
        if (answer[0]!.refusal === null) {
          opened.push(caseId);
          expect(rows, caseId).toEqual([
            {
              action: caseId === RESTRICTED ? "RESTRICTED_CASE_OPENED" : "CASE_OPENED",
              outcome: "SUCCEEDED",
              entity_type: "case",
              entity_id: caseId,
              case_id: caseId,
              actor_persona_id: persona,
              workspace_id: ws,
              correlation_id: CORRELATION,
              metadata: {},
            },
          ]);
        } else {
          expect(answer[0]!.refusal, caseId).toBe("V1404");
          // Unknown and unauthorised: the same row, whatever the case.
          expect(rows, caseId).toEqual([refusedRow("V1404", persona, ws)]);
        }
      }
      // Pinned to the seed's visibility table (DATA_MODEL §5): never vacuous, never more than the persona sees.
      expect(opened.sort()).toEqual(pair.sees);
    });
  }

  it("restricted is decided by the database at write time, from the case record, never by the caller", async () => {
    const result = await beta(async (tx) => {
      await tx`reset role`;
      await tx`update cdf_notifications_v13.case_record set is_restricted = true where id = ${CASE(5)}::uuid`;
      await tx`update cdf_notifications_v13.case_record set is_restricted = false where id = ${RESTRICTED}::uuid`;
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      const seq = await mark(tx);
      await impl(tx, "CASE", CASE(5));
      await impl(tx, "CASE", RESTRICTED);
      return (await since(tx, seq)).map((r) => [r.action, r.case_id]);
    });
    expect(result).toEqual([
      ["RESTRICTED_CASE_OPENED", CASE(5)],
      ["CASE_OPENED", RESTRICTED],
    ]);
  });

  it("window: one CASE_OPENED row per persona and case per 300 s; later opens are counted and carried by the next row", async () => {
    const result = await beta(async (tx) => {
      const seq = await mark(tx);
      for (let k = 0; k < 3; k += 1) await impl(tx, "CASE", CASE(1));
      const inWindow = await since(tx, seq);
      await tx`reset role`;
      const [counter] = await tx<{ suppressed: number }[]>`
        select suppressed from cdf_notifications_v13.access_window
         where persona_id = ${PERSONA.beta}::uuid and case_id = ${CASE(1)}::uuid`;
      // The window ends (moved back past 300 s, as the administrator).
      await tx`update cdf_notifications_v13.access_window set window_start = window_start - interval '301 seconds'`;
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      const seq2 = await mark(tx);
      await impl(tx, "CASE", CASE(1));
      await impl(tx, "CASE", CASE(1));
      const after = await since(tx, seq2);
      await tx`reset role`;
      const [reset] = await tx<{ suppressed: number; fresh: boolean }[]>`
        select suppressed, window_start > clock_timestamp() - interval '5 seconds' as fresh
          from cdf_notifications_v13.access_window
         where persona_id = ${PERSONA.beta}::uuid and case_id = ${CASE(1)}::uuid`;
      return { inWindow, counter, after, reset };
    });
    expect(result.inWindow.map((r) => [r.action, r.metadata])).toEqual([["CASE_OPENED", {}]]);
    expect(result.counter).toEqual({ suppressed: 2 });
    expect(result.after.map((r) => [r.action, r.metadata])).toEqual([["CASE_OPENED", { suppressed: 2 }]]);
    expect(result.reset).toEqual({ suppressed: 1, fresh: true });
  });

  it("window: an open 299 s into the window is still suppressed", async () => {
    const rows = await beta(async (tx) => {
      await impl(tx, "CASE", CASE(1));
      await tx`reset role`;
      await tx`update cdf_notifications_v13.access_window set window_start = window_start - interval '299 seconds'`;
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      const seq = await mark(tx);
      await impl(tx, "CASE", CASE(1));
      return since(tx, seq);
    });
    expect(rows).toEqual([]);
  });

  it("restricted opens are never windowed: three opens of 0009 are three rows, and no counter exists", async () => {
    const result = await beta(async (tx) => {
      const seq = await mark(tx);
      for (let k = 0; k < 3; k += 1) await impl(tx, "CASE", RESTRICTED);
      const rows = await since(tx, seq);
      await tx`reset role`;
      const [n] = await tx<
        { n: number }[]
      >`select count(*)::int as n from cdf_notifications_v13.access_window`;
      return { rows, counters: n!.n };
    });
    expect(result.rows.map((r) => [r.action, r.metadata])).toEqual([
      ["RESTRICTED_CASE_OPENED", {}],
      ["RESTRICTED_CASE_OPENED", {}],
      ["RESTRICTED_CASE_OPENED", {}],
    ]);
    expect(result.counters).toBe(0);
  });

  it("windows are per persona, case, action and entity", async () => {
    const rows = await beta(async (tx) => {
      const seq = await mark(tx);
      await impl(tx, "CASE", CASE(3));
      await impl(tx, "CASE", CASE(1)); // another case
      await impl(tx, "NOTIFICATION_PREVIEW", CASE(3), NOTIFICATION(2)); // another action
      await impl(tx, "NOTIFICATION_PREVIEW", CASE(3), NOTIFICATION(3)); // another entity
      await impl(tx, "NOTIFICATION_PREVIEW", CASE(3), NOTIFICATION(2)); // suppressed
      return since(tx, seq);
    });
    expect(rows.map((r) => [r.action, r.entity_id])).toEqual([
      ["CASE_OPENED", CASE(3)],
      ["CASE_OPENED", CASE(1)],
      ["NOTIFICATION_PREVIEW_OPENED", NOTIFICATION(2)],
      ["NOTIFICATION_PREVIEW_OPENED", NOTIFICATION(3)],
    ]);
    const gamma = await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, async (tx) => {
      await tx`reset role`;
      await tx`insert into cdf_notifications_v13.access_window (persona_id, case_id, action, entity_id, window_start)
               values (${PERSONA.beta}::uuid, ${CASE(3)}::uuid, 'CASE_OPENED', ${CASE(3)}::uuid, clock_timestamp())`;
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      const seq = await mark(tx);
      await impl(tx, "CASE", CASE(3)); // Beta's open window does not suppress Gamma's
      return since(tx, seq);
    });
    expect(gamma.map((r) => [r.action, r.actor_persona_id])).toEqual([["CASE_OPENED", PERSONA.gamma]]);
  });

  it("preview: a visible notification of the case writes NOTIFICATION_PREVIEW_OPENED with the notification id", async () => {
    const rows = await as(PERSONA.alpha, WORKSPACE.SECRETARIAT, async (tx) => {
      const seq = await mark(tx);
      expect(await record(tx, "NOTIFICATION_PREVIEW", CASE(1), NOTIFICATION(1))).toEqual([{ refusal: null }]);
      return since(tx, seq);
    });
    expect(rows).toEqual([
      {
        action: "NOTIFICATION_PREVIEW_OPENED",
        outcome: "SUCCEEDED",
        entity_type: "notification",
        entity_id: NOTIFICATION(1),
        case_id: CASE(1),
        actor_persona_id: PERSONA.alpha,
        workspace_id: WORKSPACE.SECRETARIAT,
        correlation_id: CORRELATION,
        metadata: {},
      },
    ]);
  });

  it("preview parity (SEC point 4): unknown, another case's and an invisible case's notification give the same refused row", async () => {
    const probes: [string, string, string][] = [
      ["unknown notification", CASE(1), UNKNOWN_NOTIFICATION],
      ["another case's notification (0003's, asked of 0001)", CASE(1), NOTIFICATION(2)],
      ["a notification of a case Gamma cannot see (0009)", RESTRICTED, NOTIFICATION(4)],
      ["unknown case", UNKNOWN_CASE, NOTIFICATION(1)],
    ];
    for (const [label, caseId, notificationId] of probes) {
      const { answer, rows } = await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, async (tx) => {
        const seq = await mark(tx);
        const answer = await record(tx, "NOTIFICATION_PREVIEW", caseId, notificationId);
        return { answer, rows: await since(tx, seq) };
      });
      expect(answer, label).toEqual([{ refusal: "V1404" }]);
      expect(rows, label).toEqual([refusedRow("V1404", PERSONA.gamma, WORKSPACE.INVESTIGATIONS)]);
    }
  });

  it("invalid requests are V1422 before any id is looked at, and the row carries no id", async () => {
    const probes: [string, string | null, string | null, string | null][] = [
      ["lower-case kind", "case", CASE(1), null],
      ["unknown kind", "TAB", CASE(1), null],
      ["no kind", null, CASE(1), null],
      ["no case", "CASE", null, null],
      ["CASE with a notification", "CASE", CASE(1), NOTIFICATION(1)],
      ["preview without a notification", "NOTIFICATION_PREVIEW", CASE(1), null],
      ["bad kind on an unknown case", "TAB", UNKNOWN_CASE, null],
      ["bad kind on an invisible case", "TAB", RESTRICTED, null],
    ];
    for (const [label, kind, caseId, notificationId] of probes) {
      const { answer, rows } = await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, async (tx) => {
        const seq = await mark(tx);
        const answer = await record(tx, kind, caseId, notificationId);
        return { answer, rows: await since(tx, seq) };
      });
      expect(answer, label).toEqual([{ refusal: "V1422" }]);
      expect(rows, label).toEqual([refusedRow("V1422", PERSONA.gamma, WORKSPACE.INVESTIGATIONS)]);
    }
  });

  it("no context and forged contexts: V1401 with one id-less row and no actor; Epsilon, Zeta and an unknown persona likewise", async () => {
    const claims = claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT);
    const contexts = [
      {},
      { claims },
      { claims, mac: "00".repeat(32) },
      { claims, mac: "valid" as const, macOver: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS) },
    ];
    for (const ctx of contexts) {
      const { answer, rows } = await asRaw(admin, ctx, async (tx) => {
        const seq = await mark(tx);
        const answer = await record(tx, "CASE", CASE(1));
        return { answer, rows: await since(tx, seq) };
      });
      expect(answer, JSON.stringify(ctx)).toEqual([{ refusal: "V1401" }]);
      expect(
        rows.map(({ workspace_id: _w, correlation_id: _c, ...r }) => r),
        JSON.stringify(ctx),
      ).toEqual([
        {
          action: "COMMAND_REFUSED",
          outcome: "REFUSED",
          entity_type: "case",
          entity_id: null,
          case_id: null,
          actor_persona_id: null,
          metadata: { command: "api_record_access", refusal: "V1401" },
        },
      ]);
    }
  });

  it("Epsilon (membership expired) has a verified persona but no workspace: V1404, id-less; Zeta and an unknown persona: V1401", async () => {
    const outcomes: Record<string, { refusal: string | null; rows: LedgerRow[] }> = {};
    for (const [label, persona] of [
      ["epsilon", PERSONA.epsilon],
      ["zeta", PERSONA.zeta],
      ["unknown", PERSONA.unknown],
    ] as const) {
      outcomes[label] = await as(persona, WORKSPACE.SECRETARIAT, async (tx) => {
        const seq = await mark(tx);
        const answer = await record(tx, "CASE", CASE(1));
        return { refusal: answer[0]!.refusal, rows: await since(tx, seq) };
      });
    }
    expect(outcomes.epsilon).toEqual({
      refusal: "V1404",
      rows: [refusedRow("V1404", PERSONA.epsilon, null)],
    });
    for (const label of ["zeta", "unknown"]) {
      expect(outcomes[label]!.refusal, label).toBe("V1401");
      expect(
        outcomes[label]!.rows.map((r) => [r.action, r.entity_id, r.case_id, r.actor_persona_id]),
        label,
      ).toEqual([["COMMAND_REFUSED", null, null, null]]);
    }
  });

  it("refused opens share 0013's window: a burst of unknown-case probes leaves one row", async () => {
    const rows = await beta(async (tx) => {
      const seq = await mark(tx);
      await tx`reset role`;
      for (const c of [UNKNOWN_CASE, CASE(4), CASE(7), CASE(8)])
        await tx`select cdf_notifications_v13._append_audit_refused('api_record_access', 'V1404', 'case', ${c}::uuid, ${c}::uuid)`;
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      return since(tx, seq);
    });
    // Even when the writer is handed ids, an access refusal never carries one.
    expect(rows).toEqual([refusedRow("V1404", PERSONA.beta, WORKSPACE.INVESTIGATIONS)]);
    // V1422 on a case Beta can see: 0013 would keep ids for V1422, an access refusal never does.
    const v1422 = await beta(async (tx) => {
      const seq = await mark(tx);
      await tx`reset role`;
      await tx`select cdf_notifications_v13._append_audit_refused('api_record_access', 'V1422', 'case',
                 ${CASE(1)}::uuid, ${CASE(1)}::uuid)`;
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      return since(tx, seq);
    });
    expect(v1422).toEqual([refusedRow("V1422", PERSONA.beta, WORKSPACE.INVESTIGATIONS)]);
  });

  it("one command per transaction: the access record and any other command never share a transaction (V1500)", async () => {
    const result = await beta(async (tx) => {
      const first = await record(tx, "CASE", CASE(1));
      const second = await tx<{ refusal: string | null }[]>`
        select refusal from cdf_notifications_v13.api_switch_workspace(${WORKSPACE.INVESTIGATIONS}::uuid)`;
      const third = await record(tx, "CASE", CASE(2));
      return [first, second, third].map((r) => r[0]!.refusal);
    });
    expect(result).toEqual([null, "V1500", "V1500"]);
    const reverse = await beta(async (tx) => {
      const first = await tx<{ refusal: string | null }[]>`
        select refusal from cdf_notifications_v13.api_switch_workspace(${WORKSPACE.INVESTIGATIONS}::uuid)`;
      const second = await record(tx, "CASE", CASE(1));
      return [first, second].map((r) => r[0]!.refusal);
    });
    expect(reverse).toEqual([null, "V1500"]);
  });

  it("fail closed: a failing append raises (nothing to serve), and leaves no window row, so the next open writes (SEC point 3)", async () => {
    const result = await beta(async (tx) => {
      await tx`reset role`;
      // A planted fault, rolled back with the transaction: the ledger refuses CASE_OPENED rows.
      await tx`alter table cdf_notifications_v13.audit_event
                 add constraint planted_fault check (action <> 'CASE_OPENED') not valid`;
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      await tx`savepoint before_open`;
      const failed = await record(tx, "CASE", CASE(1))
        .then(() => "OK")
        .catch((error: unknown) => errorCodeOf(error));
      await tx`rollback to savepoint before_open`;
      await tx`reset role`;
      const [left] = await tx<
        { n: number }[]
      >`select count(*)::int as n from cdf_notifications_v13.access_window`;
      await tx`alter table cdf_notifications_v13.audit_event drop constraint planted_fault`;
      await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
      const seq = await mark(tx);
      const next = await record(tx, "CASE", CASE(1));
      return { failed, windows: left!.n, next, rows: await since(tx, seq) };
    });
    expect(result.failed).toBe("23514");
    expect(result.windows).toBe(0);
    expect(result.next).toEqual([{ refusal: null }]);
    expect(result.rows.map((r) => [r.action, r.metadata])).toEqual([["CASE_OPENED", {}]]);
  });

  it("the ledger's shape check refuses access rows with content, a wrong entity, a count on a restricted open, or ids on a refusal", async () => {
    const attempts: [string, string][] = [
      ["metadata with a tab", `'CASE_OPENED', 'case', '${CASE(1)}', '${CASE(1)}', '{"tab": "events"}'`],
      ["metadata with a title", `'CASE_OPENED', 'case', '${CASE(1)}', '${CASE(1)}', '{"title": "x"}'`],
      ["entity is not the case", `'CASE_OPENED', 'case', '${CASE(2)}', '${CASE(1)}', '{}'`],
      ["wrong entity type", `'NOTIFICATION_PREVIEW_OPENED', 'case', '${CASE(1)}', '${CASE(1)}', '{}'`],
      ["no case", `'CASE_OPENED', 'case', '${CASE(1)}', null, '{}'`],
      ["suppressed as text", `'CASE_OPENED', 'case', '${CASE(1)}', '${CASE(1)}', '{"suppressed": "2"}'`],
      ["suppressed zero", `'CASE_OPENED', 'case', '${CASE(1)}', '${CASE(1)}', '{"suppressed": 0}'`],
      [
        "count on a restricted open",
        `'RESTRICTED_CASE_OPENED', 'case', '${CASE(9)}', '${CASE(9)}', '{"suppressed": 2}'`,
      ],
    ];
    for (const [label, args] of attempts) {
      const code = await beta(async (tx) => {
        await tx`reset role`;
        return tx
          .unsafe(`select cdf_notifications_v13._append_audit_row(${args}, 'SUCCEEDED')`)
          .then(() => "OK")
          .catch((error: unknown) => errorCodeOf(error));
      });
      expect(code, label).toBe("23514");
    }
    const refusedWithIds = await beta(async (tx) => {
      await tx`reset role`;
      return tx
        .unsafe(
          `select cdf_notifications_v13._append_audit_row('COMMAND_REFUSED', 'case', '${CASE(1)}', '${CASE(1)}',
             '{"command": "api_record_access", "refusal": "V1422"}', 'REFUSED')`,
        )
        .then(() => "OK")
        .catch((error: unknown) => errorCodeOf(error));
    });
    expect(refusedWithIds).toBe("23514");
    // Control: the same writer accepts a well-formed access row.
    const control = await beta(async (tx) => {
      await tx`reset role`;
      await tx`select cdf_notifications_v13._append_audit_row('CASE_OPENED', 'case', ${CASE(1)}::uuid,
                 ${CASE(1)}::uuid, '{"suppressed": 3}'::jsonb, 'SUCCEEDED')`;
      return "OK";
    });
    expect(control).toBe("OK");
  });

  it("the app login cannot call the command, its body or the writer (42501); the request role cannot call the body or the writer", async () => {
    const codes: string[] = [];
    for (const q of [
      `select * from cdf_notifications_v13.api_record_access('CASE', '${CASE(1)}')`,
      `select cdf_notifications_v13._api_record_access_impl('CASE', '${CASE(1)}', null)`,
      `select cdf_notifications_v13._record_access_row('CASE_OPENED', 'case', '${CASE(1)}', '${CASE(1)}')`,
    ])
      codes.push(
        await app
          .begin(async (tx) => {
            await tx.unsafe(q);
            return "OK";
          })
          .catch((error: unknown) => errorCodeOf(error)),
      );
    for (const q of [
      `select cdf_notifications_v13._api_record_access_impl('CASE', '${CASE(1)}', null)`,
      `select cdf_notifications_v13._record_access_row('CASE_OPENED', 'case', '${CASE(1)}', '${CASE(1)}')`,
    ])
      codes.push(
        await asRaw(app, { claims: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS), mac: "valid" }, (tx) =>
          tx.unsafe(q).then(() => "OK"),
        ).catch((error: unknown) => errorCodeOf(error)),
      );
    expect(codes).toEqual(["42501", "42501", "42501", "42501", "42501"]);
  });

  it("through the app login as the request role: one open commits nothing until the transaction does, and its row is chained", async () => {
    // The real role path (cdf_v13_app → cdf_v13_user), rolled back: the command answers and the chain stays valid.
    const answer = await asRaw(
      app,
      { claims: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS), mac: "valid" },
      (tx) => record(tx, "CASE", RESTRICTED),
    );
    expect(answer).toEqual([{ refusal: null }]);
    const [verdict] = await admin<{ is_valid: boolean }[]>`
      select is_valid from cdf_notifications_v13.verify_audit_chain()`;
    expect(verdict!.is_valid).toBe(true);
  });
});
