// V13-DB-007 — api_switch_workspace (migration 0005): a verified persona may switch only to an active workspace where
// it holds an active membership; the switch writes one WORKSPACE_SWITCHED audit row with ids only; every unusable
// target gets the same V1404, and no verified persona gets V1401. Every call is rolled back.
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
import { outcomeOf } from "./support/refusal";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function commandPresent(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean }[]>`
      select pg_catalog.to_regprocedure('cdf_notifications_v13.api_switch_workspace(uuid)') is not null as present`;
    return Boolean(row?.present);
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const present = await commandPresent();
if (available && !present)
  console.warn("[integration] skipping workspace-switch: migration 0005 not applied");

const UNKNOWN_WS = "0a000000-0000-4000-8000-0000000000ff";

/** A command's refusal (migration 0013), its raised SQLSTATE, or "OK". */
const codeOf = outcomeOf;

const switchTo = (target: string | null) => (tx: Tx) =>
  tx<{ workspace_id: string; workspace_code: string; role_codes: string[] }[]>`
    select * from cdf_notifications_v13.api_switch_workspace(${target})`;

describe.skipIf(!present)("api_switch_workspace (migration 0005)", () => {
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

  /** Runs the switch as the persona on the administrator connection, then reads the audit rows it wrote; rolled back. */
  async function switchAndAudit(persona: string, from: WorkspaceCode, target: string) {
    return asRaw(admin, { claims: claimsText(persona, WORKSPACE[from]), mac: "valid" }, async (tx) => {
      const [start] = await tx<{ before: string }[]>`select pg_catalog.clock_timestamp()::text as before`;
      const before = start!.before;
      const result = await switchTo(target)(tx);
      await tx.unsafe("reset role");
      await tx.unsafe("set local role cdf_v13_owner");
      const audit = await tx<
        {
          action: string;
          entity_type: string;
          entity_id: string;
          case_id: string | null;
          actor_persona_id: string;
          workspace_id: string | null;
          correlation_id: string;
          metadata: Record<string, unknown>;
        }[]
      >`
        select action, entity_type, entity_id, case_id, actor_persona_id, workspace_id, correlation_id, metadata
          from cdf_notifications_v13.audit_event where occurred_at >= ${before}::timestamptz order by seq`;
      const [chain] = await tx<
        { is_valid: boolean }[]
      >`select is_valid from cdf_notifications_v13.verify_audit_chain()`;
      return { result: [...result], audit: [...audit], valid: chain?.is_valid };
    });
  }

  it("Delta switches from the Secretariat to Governance: target, roles there, one ids-only audit row", async () => {
    const { result, audit, valid } = await switchAndAudit(PERSONA.delta, "SECRETARIAT", WORKSPACE.GOVERNANCE);
    expect(result).toEqual([
      {
        workspace_id: WORKSPACE.GOVERNANCE,
        workspace_code: "GOVERNANCE",
        role_codes: ["GOVERNANCE_OFFICER"],
        refusal: null,
      },
    ]);
    expect(audit).toEqual([
      {
        action: "WORKSPACE_SWITCHED",
        entity_type: "workspace",
        entity_id: WORKSPACE.GOVERNANCE,
        case_id: null,
        actor_persona_id: PERSONA.delta,
        workspace_id: WORKSPACE.SECRETARIAT,
        correlation_id: CORRELATION,
        metadata: { from_workspace_id: WORKSPACE.SECRETARIAT, to_workspace_id: WORKSPACE.GOVERNANCE },
      },
    ]);
    expect(valid).toBe(true);
  });

  it("switching away from a workspace the persona cannot use records from = NULL", async () => {
    const { result, audit } = await switchAndAudit(PERSONA.delta, "INVESTIGATIONS", WORKSPACE.GOVERNANCE);
    expect(result[0]?.workspace_code).toBe("GOVERNANCE");
    expect(audit[0]).toMatchObject({
      workspace_id: null,
      metadata: { from_workspace_id: null, to_workspace_id: WORKSPACE.GOVERNANCE },
    });
  });

  it("switching to the current workspace is allowed and audited (the BFF re-issues the same cookie)", async () => {
    const { result, audit } = await switchAndAudit(PERSONA.alpha, "SECRETARIAT", WORKSPACE.SECRETARIAT);
    expect(result[0]).toMatchObject({ workspace_code: "SECRETARIAT", role_codes: ["COMMITTEE_SECRETARY"] });
    expect(audit).toHaveLength(1);
  });

  const refusals: [string, string, WorkspaceCode, string | null, string][] = [
    [
      "a workspace without membership (Alpha → Governance)",
      PERSONA.alpha,
      "SECRETARIAT",
      WORKSPACE.GOVERNANCE,
      "V1404",
    ],
    [
      "a workspace without membership (Beta → Secretariat)",
      PERSONA.beta,
      "INVESTIGATIONS",
      WORKSPACE.SECRETARIAT,
      "V1404",
    ],
    [
      "an expired membership (Epsilon → Secretariat)",
      PERSONA.epsilon,
      "SECRETARIAT",
      WORKSPACE.SECRETARIAT,
      "V1404",
    ],
    ["an unknown workspace id", PERSONA.delta, "GOVERNANCE", UNKNOWN_WS, "V1404"],
    ["a NULL workspace id", PERSONA.delta, "GOVERNANCE", null, "V1404"],
    ["a deactivated persona (Zeta)", PERSONA.zeta, "SECRETARIAT", WORKSPACE.SECRETARIAT, "V1401"],
    ["an unknown persona", PERSONA.unknown, "SECRETARIAT", WORKSPACE.SECRETARIAT, "V1401"],
  ];

  it.each(refusals)("refuses %s", async (_name, persona, from, target, expected) => {
    expect(
      await codeOf(
        asRaw(app, { claims: claimsText(persona, WORKSPACE[from]), mac: "valid" }, switchTo(target)),
      ),
    ).toBe(expected);
  });

  it("refuses without claims or with a forged MAC (V1401)", async () => {
    expect(await codeOf(asRaw(app, {}, switchTo(WORKSPACE.GOVERNANCE)))).toBe("V1401");
    expect(
      await codeOf(
        asRaw(
          app,
          { claims: claimsText(PERSONA.delta, WORKSPACE.SECRETARIAT), mac: "forged-mac" },
          switchTo(WORKSPACE.GOVERNANCE),
        ),
      ),
    ).toBe("V1401");
  });

  it("refuses a deactivated workspace with the same V1404 (deactivation rolled back)", async () => {
    const code = await codeOf(
      asRaw(admin, { claims: claimsText(PERSONA.delta, WORKSPACE.SECRETARIAT), mac: "valid" }, async (tx) => {
        await tx.unsafe("reset role");
        await tx.unsafe("set local role cdf_v13_owner");
        await tx`update cdf_notifications_v13.workspace set is_active = false where id = ${WORKSPACE.GOVERNANCE}`;
        await tx.unsafe("set local role cdf_v13_user");
        return switchTo(WORKSPACE.GOVERNANCE)(tx);
      }),
    );
    expect(code).toBe("V1404");
  });

  it("a refused switch writes no audit row", async () => {
    const before = await asOwner(
      admin,
      (tx) =>
        tx<{ n: number }[]>`select count(*)::int as n from cdf_notifications_v13.audit_event
                           where action = 'WORKSPACE_SWITCHED'`,
    );
    await codeOf(asPersona(app, PERSONA.alpha, "SECRETARIAT", (tx) => switchTo(WORKSPACE.GOVERNANCE)(tx)));
    const after = await asOwner(
      admin,
      (tx) =>
        tx<{ n: number }[]>`select count(*)::int as n from cdf_notifications_v13.audit_event
                           where action = 'WORKSPACE_SWITCHED'`,
    );
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("is a definer command executable by the request role only", async () => {
    const [row] = await admin<
      { definer: boolean; user_exec: boolean; app_exec: boolean; public_exec: boolean }[]
    >`
      select p.prosecdef as definer,
             pg_catalog.has_function_privilege('cdf_v13_user', p.oid, 'EXECUTE') as user_exec,
             pg_catalog.has_function_privilege('cdf_v13_app', p.oid, 'EXECUTE') as app_exec,
             pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
        from pg_catalog.pg_proc p
       where p.oid = 'cdf_notifications_v13.api_switch_workspace(uuid)'::regprocedure`;
    expect(row).toEqual({ definer: true, user_exec: true, app_exec: false, public_exec: false });
  });
});
