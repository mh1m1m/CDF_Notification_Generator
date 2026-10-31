// OI-023, FE side: confirmWorkspaceSwitch (the Server Action's database step) against the local primary cluster as
// cdf_v13_app → cdf_v13_user. A member target commits exactly one WORKSPACE_SWITCHED audit row with this request's
// correlation id before the function returns; every refused target throws and writes nothing. Synthetic personas only.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RequestIdentitySchema,
  WORKSPACE_IDS,
  type RequestIdentity,
  type WorkspaceCode,
} from "@/lib/contracts";
import { databaseClientOptions } from "@/lib/db/client";
import { withRequestContext } from "@/lib/db/security-context";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";
import { confirmWorkspaceSwitch } from "@/lib/server/workspace";
import { TEST_CLAIMS_KEY } from "../support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL, PRIMARY_APP_URL } from "../support/clusters";
import { adminClient } from "../support/context";

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
        actor_persona_id: string;
        workspace_id: string | null;
        metadata: Record<string, string>;
      }[]
    >`
      select action, actor_persona_id, workspace_id, metadata
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
    ["Delta to INVESTIGATIONS (not a member)", DELTA_GOV, "INVESTIGATIONS"],
    ["Alpha to GOVERNANCE (not a member)", ALPHA, "GOVERNANCE"],
    ["Epsilon (membership expired) to SECRETARIAT", EPSILON, "SECRETARIAT"],
  ] as const)("%s: refused, nothing written", async (_n, identity, target: WorkspaceCode) => {
    const correlationId = crypto.randomUUID();
    await expect(confirmWorkspaceSwitch(run(correlationId), identity, target)).rejects.toMatchObject({
      code: expect.stringMatching(/^V140[14]$/),
    });
    expect(await auditFor(correlationId)).toEqual([]);
  });
});
