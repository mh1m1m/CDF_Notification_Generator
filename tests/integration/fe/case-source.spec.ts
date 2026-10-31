// FE-001: V13-records CaseSourceAdapter against the local primary cluster as the real app login (cdf_v13_app →
// cdf_v13_user), with the M1 seed. Proves: seed visibility per persona/workspace, restricted 0009 only for its
// assignee, unknown = unauthorised = null, keyset paging, nothing counted outside authorisation.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequestIdentitySchema, type CaseId, type RequestIdentity } from "@/lib/contracts";
import { createV13RecordsCaseSource } from "@/lib/adapters/case-source/v13-records";
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
const ALPHA = who(1, "SECRETARIAT", "COMMITTEE_SECRETARY");
const BETA = who(2, "INVESTIGATIONS", "INVESTIGATOR");
const GAMMA = who(3, "INVESTIGATIONS", "INVESTIGATOR");
const DELTA_GOV = who(4, "GOVERNANCE", "GOVERNANCE_OFFICER");
const DELTA_SEC = who(4, "SECRETARIAT", "GOVERNANCE_OFFICER");
const DELTA_INV = who(4, "INVESTIGATIONS", "GOVERNANCE_OFFICER"); // not a member: the database refuses
const EPSILON = who(5, "SECRETARIAT", "COMMITTEE_SECRETARY"); // membership expired
const ZETA = who(6, "SECRETARIAT", "COMMITTEE_SECRETARY"); // persona inactive
const caseId = (i: number) => `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}` as CaseId;
const nums = (ids: number[]) => ids.map((i) => `CDF-DEMO-2026-${String(i).padStart(4, "0")}`);

describe.skipIf(!available)("V13-records case source on the primary cluster (M1 seed)", () => {
  let sql: postgres.Sql;
  let source: ReturnType<typeof createV13RecordsCaseSource>;

  beforeAll(() => {
    sql = postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
    source = createV13RecordsCaseSource((identity, fn) =>
      withRequestContext(identity, fn, { sql, claimsKey: TEST_CLAIMS_KEY }),
    );
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it.each([
    ["Secretary Alpha", ALPHA, [1, 3, 4, 6, 7, 8, 10]],
    ["Investigator Beta", BETA, [1, 2, 3, 5, 6, 9, 10]],
    ["Investigator Gamma", GAMMA, [1, 2, 3, 5, 6, 10]],
    ["Delta @ Governance", DELTA_GOV, [1, 2, 3, 4, 7, 8, 10]],
    ["Delta @ Secretariat", DELTA_SEC, [1, 3, 4, 6, 7, 8, 10]],
    ["Delta @ Investigations (not a member)", DELTA_INV, []],
    ["Secretary Epsilon (expired)", EPSILON, []],
    ["Persona Zeta (inactive)", ZETA, []],
  ])("%s lists exactly the seed visibility", async (_n, identity, expected) => {
    const page = await source.listCases(identity, { limit: 50 });
    expect(page.items.map((c) => c.case_number)).toEqual(nums(expected));
    expect(page.next_cursor).toBeNull();
    expect(page.total).toBe(expected.length);
  });

  it("restricted 0009: only its assignee reads it; everyone else gets null like an unknown id", async () => {
    expect((await source.getCase(BETA, caseId(9)))?.is_restricted).toBe(true);
    for (const identity of [GAMMA, ALPHA, DELTA_GOV, DELTA_SEC]) {
      expect(await source.getCase(identity, caseId(9))).toBeNull();
    }
    expect(await source.getCase(ALPHA, "0c000000-0000-4000-8000-0000000000ff" as CaseId)).toBeNull();
    expect(await source.getCase(ALPHA, caseId(2))).toBeNull(); // other workspace
  });

  it("closed 0010 stays readable", async () => {
    expect((await source.getCase(ALPHA, caseId(10)))?.records_state).toBe("CLOSED");
  });

  it("pages by keyset without gaps or repeats", async () => {
    const first = await source.listCases(ALPHA, { limit: 3 });
    const second = await source.listCases(ALPHA, { limit: 3, cursor: first.next_cursor ?? undefined });
    const third = await source.listCases(ALPHA, { limit: 3, cursor: second.next_cursor ?? undefined });
    expect([...first.items, ...second.items, ...third.items].map((c) => c.case_number)).toEqual(
      nums([1, 3, 4, 6, 7, 8, 10]),
    );
    expect(third.next_cursor).toBeNull();
    // The total is the whole authorised match set on every page, not the page size.
    expect([first.total, second.total, third.total]).toEqual([7, 7, 7]);
  });

  it("total and rows agree under filters, and never count restricted 0009 for a non-assignee", async () => {
    for (const [identity, text, expected] of [
      [GAMMA, "0009", 0],
      [BETA, "0009", 1],
      [ALPHA, "CDF-DEMO-2026-001", 1],
      [ALPHA, "nothing-matches", 0],
    ] as const) {
      const page = await source.listCases(identity, { limit: 50, text });
      expect(page.total, `${identity.persona_id} ${text}`).toBe(expected);
      expect(page.items).toHaveLength(expected);
    }
    const closed = await source.listCases(DELTA_GOV, { records_state: "CLOSED" });
    expect(closed.items.map((c) => c.case_number)).toEqual(nums([10]));
    expect(closed.total).toBe(1);
  });

  it("assigned-to-me: active case assignments only, never beyond what the persona may see", async () => {
    for (const [identity, expected] of [
      [ALPHA, [1, 3, 4, 7, 8, 10]],
      [BETA, [1, 3, 5, 6, 9]],
      [GAMMA, [2, 6, 10]],
      [DELTA_GOV, [8]],
      [DELTA_SEC, [8]], // case 8 is visible in Secretariat too
      [EPSILON, []],
    ] as const) {
      const page = await source.listCases(identity, { limit: 50, assigned_to_me: true });
      expect(
        page.items.map((c) => c.case_number),
        identity.persona_id,
      ).toEqual(nums([...expected]));
      expect(page.total).toBe(expected.length);
    }
  });

  it("row summaries: last recorded event and the caller's own open tasks", async () => {
    const page = await source.listCases(ALPHA, { limit: 50 });
    const byNum = new Map(page.items.map((c) => [c.case_number, c]));
    expect(byNum.get("CDF-DEMO-2026-0010")?.last_event_id).toBe("0e000000-0000-4000-8000-000000000110");
    expect(byNum.get("CDF-DEMO-2026-0001")?.my_open_task_count).toBe(1);
    expect(byNum.get("CDF-DEMO-2026-0004")?.my_open_task_count).toBe(2);
    for (const c of page.items) {
      expect(c.last_event_id === null).toBe(c.last_event_at === null);
      expect(c.my_open_task_count).toBeGreaterThanOrEqual(0);
    }
    // Another persona's tasks are never counted as the caller's.
    const gamma = await source.listCases(GAMMA, { limit: 50, text: "0001" });
    expect(gamma.items[0]?.my_open_task_count).toBe(0);
  });

  it("filters apply only inside the authorised set (restricted never matched by text)", async () => {
    const page = await source.listCases(GAMMA, { text: "0009", limit: 50 });
    expect(page.items).toEqual([]);
    const closed = await source.listCases(ALPHA, { records_state: "CLOSED", limit: 50 });
    expect(closed.items.map((c) => c.case_number)).toEqual(nums([10]));
  });
});
