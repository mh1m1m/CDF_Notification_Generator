// V13-FE-008 (OI-044): the own-membership read against the local primary cluster as cdf_v13_app → cdf_v13_user (M1
// seed). It confirms exactly the active memberships of an active persona: Alpha and Delta get theirs; Secretary
// Epsilon (membership expired 30 Jun 2026) and Persona Zeta (inactive) get none, although their sessions still claim
// COMMITTEE_SECRETARY in SECRETARIAT. A claimed workspace never adds a row. Synthetic data only.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequestIdentitySchema, type RequestIdentity } from "@/lib/contracts";
import { createV13MembershipReader } from "@/lib/adapters/identity/v13-memberships";
import { databaseClientOptions } from "@/lib/db/client";
import { withRequestContext } from "@/lib/db/security-context";
import { TEST_CLAIMS_KEY } from "../support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL, PRIMARY_APP_URL } from "../support/clusters";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);
const who = (persona: number, active_workspace: string, role: string): RequestIdentity =>
  RequestIdentitySchema.parse({
    persona_id: `0b000000-0000-4000-8000-00000000000${persona}`,
    active_workspace,
    roles: [role],
  });

describe.skipIf(!available)("V13 own memberships on the primary cluster (FE-008)", () => {
  let sql: postgres.Sql;
  let reader: ReturnType<typeof createV13MembershipReader>;
  beforeAll(() => {
    sql = postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
    reader = createV13MembershipReader((identity, fn) =>
      withRequestContext(identity, fn, { sql, claimsKey: TEST_CLAIMS_KEY }),
    );
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("Alpha: COMMITTEE_SECRETARY in SECRETARIAT only", async () => {
    expect(await reader.confirmedMemberships(who(1, "SECRETARIAT", "COMMITTEE_SECRETARY"))).toEqual([
      { workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY" },
    ]);
  });

  it("Delta: the same rows from either active workspace (the claim never adds or removes one)", async () => {
    const want = [
      { workspace: "GOVERNANCE", role: "GOVERNANCE_OFFICER" },
      { workspace: "SECRETARIAT", role: "GOVERNANCE_OFFICER" },
    ];
    expect(await reader.confirmedMemberships(who(4, "GOVERNANCE", "GOVERNANCE_OFFICER"))).toEqual(want);
    expect(await reader.confirmedMemberships(who(4, "SECRETARIAT", "GOVERNANCE_OFFICER"))).toEqual(want);
  });

  it("Beta: INVESTIGATOR in INVESTIGATIONS, nothing from a workspace it claims but does not hold", async () => {
    const rows = await reader.confirmedMemberships(who(2, "INVESTIGATIONS", "INVESTIGATOR"));
    expect(rows).toEqual([{ workspace: "INVESTIGATIONS", role: "INVESTIGATOR" }]);
    expect(await reader.confirmedMemberships(who(2, "SECRETARIAT", "COMMITTEE_SECRETARY"))).toEqual(rows);
  });

  it("negative: Secretary Epsilon (expired) and Persona Zeta (inactive) are confirmed nothing", async () => {
    expect(await reader.confirmedMemberships(who(5, "SECRETARIAT", "COMMITTEE_SECRETARY"))).toEqual([]);
    expect(await reader.confirmedMemberships(who(6, "SECRETARIAT", "COMMITTEE_SECRETARY"))).toEqual([]);
  });

  it("negative: an unknown persona is confirmed nothing", async () => {
    expect(
      await reader.confirmedMemberships(
        RequestIdentitySchema.parse({
          persona_id: "0b000000-0000-4000-8000-0000000000ff",
          active_workspace: "GOVERNANCE",
          roles: ["GOVERNANCE_OFFICER"],
        }),
      ),
    ).toEqual([]);
  });
});
