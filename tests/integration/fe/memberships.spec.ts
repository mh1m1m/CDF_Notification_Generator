// V13-FE-008 (OI-044): the own-membership read against the local primary cluster as cdf_v13_app → cdf_v13_user (M1
// seed). It confirms exactly the active memberships of an active persona: Alpha and Delta get theirs; Secretary
// Epsilon (membership expired 30 Jun 2026) and Persona Zeta (inactive) get none, although their sessions still claim
// COMMITTEE_SECRETARY in SECRETARIAT. A claimed workspace never adds a row. Synthetic data only.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequestIdentitySchema, type RequestIdentity } from "@/lib/contracts";
import { createV13MembershipReader } from "@/lib/adapters/identity/v13-memberships";
import { databaseClientOptions } from "@/lib/db/client";
import {
  claimsMac,
  ensureClaimsKey,
  REQUEST_ROLE,
  requestClaims,
  withRequestContext,
  type Tx,
} from "@/lib/db/security-context";
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

  // ARCH pre-review of fad4803: RLS does not check the membership's window or workspace.is_active; the adapter's WHERE
  // clause does. These plant rows in ONE admin transaction that is always rolled back, then run the reader on that
  // same transaction as cdf_v13_user with MAC-authenticated claims, so nothing is committed and no other test sees
  // the rows. A positive control on the same harness shows an empty result is not an artefact of the harness.
  describe("predicates the RLS policies do not cover (planted rows, rolled back)", () => {
    let admin: postgres.Sql;
    const ROLLBACK = Symbol("rollback");
    beforeAll(async () => {
      admin = postgres(PRIMARY_ADMIN_URL, { ...databaseClientOptions(PRIMARY_ADMIN_URL, {}), max: 1 });
      await ensureClaimsKey(sql, TEST_CLAIMS_KEY);
    });
    afterAll(async () => {
      await admin?.end({ timeout: 5 });
    });

    async function planted(
      plant: (tx: Tx) => Promise<unknown>,
      identity: RequestIdentity,
    ): Promise<readonly { workspace: string; role: string }[]> {
      const plantedReader = createV13MembershipReader(
        async <R>(who: RequestIdentity, fn: (tx: Tx) => Promise<R>): Promise<R> => {
          let result: unknown;
          await admin
            .begin(async (tx) => {
              await plant(tx);
              const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
              const claims = requestClaims(who, crypto.randomUUID());
              const mac = claimsMac(TEST_CLAIMS_KEY, claims, row!.xid);
              await tx`
              select pg_catalog.set_config('request.v13.claims', ${claims}, true),
                     pg_catalog.set_config('request.v13.claims_mac', ${mac}, true),
                     pg_catalog.set_config('role', ${REQUEST_ROLE}, true)`;
              result = await fn(tx);
              throw ROLLBACK;
            })
            .catch((error: unknown) => {
              if (error !== ROLLBACK) throw error;
            });
          return result as R;
        },
      );
      return plantedReader.confirmedMemberships(identity);
    }

    // Planted in SECRETARIAT, where Alpha already holds a current membership: workspace_select_member then shows the
    // workspace, so only the adapter's window predicate can drop a future row (in a workspace Alpha does not hold, RLS
    // would hide the workspace and the test would pass without the predicate; checked by deleting it).
    const plantAlphaSecretariat = (validFrom: string) => (tx: Tx) => tx`
      insert into cdf_notifications_v13.persona_workspace_membership (persona_id, workspace_id, role_id, valid_from)
      select '0b000000-0000-4000-8000-000000000001'::uuid, w.id, r.id, now() + ${validFrom}::interval
        from cdf_notifications_v13.workspace w, cdf_notifications_v13.role r
       where w.code = 'SECRETARIAT' and r.code = 'GOVERNANCE_OFFICER'`;

    it("positive control: a membership planted with a window containing now() is confirmed", async () => {
      expect(
        await planted(plantAlphaSecretariat("-1 hour"), who(1, "SECRETARIAT", "COMMITTEE_SECRETARY")),
      ).toEqual([
        { workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY" },
        { workspace: "SECRETARIAT", role: "GOVERNANCE_OFFICER" },
      ]);
    });

    it("negative: a membership whose valid_from is in the future gives no row", async () => {
      expect(
        await planted(plantAlphaSecretariat("1 day"), who(1, "SECRETARIAT", "COMMITTEE_SECRETARY")),
      ).toEqual([{ workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY" }]);
    });

    it("negative: a membership in a workspace with is_active = false gives no row", async () => {
      expect(
        await planted(
          (tx) => tx`update cdf_notifications_v13.workspace set is_active = false where code = 'GOVERNANCE'`,
          who(4, "SECRETARIAT", "GOVERNANCE_OFFICER"),
        ),
      ).toEqual([{ workspace: "SECRETARIAT", role: "GOVERNANCE_OFFICER" }]);
    });

    it("the planted rows never outlive their transaction", async () => {
      const [row] = await admin<{ n: number; inactive: number }[]>`
        select (select count(*)::int from cdf_notifications_v13.persona_workspace_membership m
                  join cdf_notifications_v13.workspace w on w.id = m.workspace_id
                 where m.persona_id = '0b000000-0000-4000-8000-000000000001'
                   and (w.code = 'GOVERNANCE' or m.role_id <> (select id from cdf_notifications_v13.role
                                                              where code = 'COMMITTEE_SECRETARY'))) as n,
               (select count(*)::int from cdf_notifications_v13.workspace where not is_active) as inactive`;
      expect(row).toEqual({ n: 0, inactive: 0 });
    });
  });
});
