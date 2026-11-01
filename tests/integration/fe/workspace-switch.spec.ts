// OI-023, FE side: confirmWorkspaceSwitch (the Server Action's database step) against the local primary cluster as
// cdf_v13_app → cdf_v13_user. A member target commits exactly one WORKSPACE_SWITCHED audit row with this request's
// correlation id before the function returns; every refused target throws WorkspaceSwitchRefusedError after its
// transaction has committed exactly one COMMAND_REFUSED row (migration 0013, V13-DB-021: codes only, no workspace id in
// the target columns or metadata). Synthetic personas only.
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  RequestIdentitySchema,
  WORKSPACE_IDS,
  type RequestIdentity,
  type WorkspaceCode,
} from "@/lib/contracts";
import { databaseClientOptions } from "@/lib/db/client";
import { withRequestContext } from "@/lib/db/security-context";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";
import { confirmWorkspaceSwitch, WorkspaceSwitchRefusedError } from "@/lib/server/workspace";
import { TEST_CLAIMS_KEY } from "../support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL, PRIMARY_APP_URL } from "../support/clusters";
import { adminClient } from "../support/context";
import { clearRefusalWindows } from "../support/refusal";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);
const who = (persona: number, active_workspace: string, role: string): RequestIdentity =>
  RequestIdentitySchema.parse({
    persona_id: `0b000000-0000-4000-8000-00000000000${persona}`,
    active_workspace,
    roles: [role],
  });
const ALPHA = who(1, "SECRETARIAT", "COMMITTEE_SECRETARY");
const DELTA_GOV = who(4, "GOVERNANCE", "GOVERNANCE_OFFICER");
const EPSILON = who(5, "SECRETARIAT", "COMMITTEE_SECRETARY"); // membership expired

describe.skipIf(!available)("confirmWorkspaceSwitch on the primary cluster", () => {
  let sql: postgres.Sql;
  let admin: postgres.Sql;
  beforeAll(() => {
    sql = postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
    admin = adminClient();
  });
  beforeEach(async () => {
    await clearRefusalWindows(admin);
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await admin?.end({ timeout: 5 });
  });

  const run =
    (correlationId: string): RequestContextRunner =>
    (identity, fn) =>
      withRequestContext(identity, fn, { sql, claimsKey: TEST_CLAIMS_KEY, correlationId });
  const auditFor = (correlationId: string) =>
    admin<
      {
        action: string;
        actor_persona_id: string | null;
        outcome: string;
        entity_id: string | null;
        case_id: string | null;
        workspace_id: string | null;
        metadata: Record<string, string>;
      }[]
    >`
      select action, actor_persona_id, outcome, entity_id, case_id, workspace_id, metadata
        from cdf_notifications_v13.audit_event where correlation_id = ${correlationId}::uuid order by seq`;

  it("Delta GOVERNANCE → SECRETARIAT: committed, one WORKSPACE_SWITCHED row, ids only", async () => {
    const correlationId = crypto.randomUUID();
    await confirmWorkspaceSwitch(run(correlationId), DELTA_GOV, "SECRETARIAT");
    const rows = await auditFor(correlationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "WORKSPACE_SWITCHED",
      actor_persona_id: DELTA_GOV.persona_id,
      workspace_id: WORKSPACE_IDS.GOVERNANCE,
    });
    expect(rows[0]!.metadata).toEqual({
      from_workspace_id: WORKSPACE_IDS.GOVERNANCE,
      to_workspace_id: WORKSPACE_IDS.SECRETARIAT,
    });
  });

  it.each([
    // The row's workspace is the verified one from the claims; Epsilon's expired membership verifies none.
    [
      "Delta to INVESTIGATIONS (not a member)",
      DELTA_GOV,
      "INVESTIGATIONS",
      "NOT_FOUND",
      WORKSPACE_IDS.GOVERNANCE,
    ],
    ["Alpha to GOVERNANCE (not a member)", ALPHA, "GOVERNANCE", "NOT_FOUND", WORKSPACE_IDS.SECRETARIAT],
    ["Epsilon (membership expired) to SECRETARIAT", EPSILON, "SECRETARIAT", "NOT_FOUND", null],
  ] as const)(
    "%s: refused after one committed COMMAND_REFUSED row, nothing else",
    async (_n, identity, target: WorkspaceCode, refusal, workspaceId) => {
      const correlationId = crypto.randomUUID();
      const error = await confirmWorkspaceSwitch(run(correlationId), identity, target).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(WorkspaceSwitchRefusedError);
      expect((error as WorkspaceSwitchRefusedError).refusal).toBe(refusal);
      expect(await auditFor(correlationId)).toEqual([
        {
          action: "COMMAND_REFUSED",
          actor_persona_id: identity.persona_id,
          outcome: "REFUSED",
          entity_id: null,
          case_id: null,
          workspace_id: workspaceId,
          metadata: { command: "api_switch_workspace", refusal: "V1404" },
        },
      ]);
    },
  );
});
