// FE-006 part 2: the V13 NotificationCenterReader against DB-015 (migration 0010) on the local primary cluster, as
// cdf_v13_app → cdf_v13_user with the M1 seed. Seeded notifications: 2f…01 (0001), 2f…02 and 2f…03 (0003), 2f…04
// (restricted 0009, Beta assigned), 2f…05 (closed 0010). RLS removes every notification of a case the persona may not
// see before filters, order, limit and count; a hidden case answers like an unknown one. The Scenario E check creates
// a draft and reads the Center in the same transaction, then rolls back.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InvalidCursorError,
  RequestIdentitySchema,
  type NotificationCenterFilter,
  type NotificationCenterReader,
  type RequestIdentity,
} from "@/lib/contracts";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";
import {
  createV13NotificationCenterReader,
  decodeCenterCursor,
} from "@/lib/adapters/notification-records/v13-notification-center";
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
const EPSILON = who(5, "SECRETARIAT", "COMMITTEE_SECRETARY");
const n = (i: number) => `2f000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
const caseId = (i: number) => `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
const PAGE = { limit: 25 } as const;

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

describe.skipIf(!available)("Notification Operations Center reader on the primary cluster (DB-015)", () => {
  let sql: postgres.Sql;
  let reader: NotificationCenterReader;
  const ids = async (identity: RequestIdentity, filter: NotificationCenterFilter = PAGE) => {
    const page = await reader.listNotifications(identity, filter);
    expect(page.total).toBe(page.items.length);
    return page.items.map((x) => x.notification_id);
  };

  beforeAll(() => {
    sql = postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
    const run: RequestContextRunner = (identity, fn) =>
      withRequestContext(identity, fn, { sql, claimsKey: TEST_CLAIMS_KEY });
    reader = createV13NotificationCenterReader(run);
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("Alpha (SECRETARIAT): notifications of 0001, 0003 and closed 0010, newest first; never restricted 0009", async () => {
    const page = await reader.listNotifications(ALPHA, PAGE);
    expect(page.items.map((x) => x.notification_id)).toEqual([n(3), n(2), n(1), n(5)]);
    expect(page.total).toBe(4);
    expect(page.next_cursor).toBeNull();
    expect(page.items.map((x) => x.case_number)).toEqual([
      "CDF-DEMO-2026-0003",
      "CDF-DEMO-2026-0003",
      "CDF-DEMO-2026-0001",
      "CDF-DEMO-2026-0010",
    ]);
  });

  it("each row names its case and template; metadata only; last event is the seeded DRAFT_CREATED", async () => {
    const [first] = (await reader.listNotifications(ALPHA, { ...PAGE, case_number: "CDF-DEMO-2026-0001" }))
      .items;
    expect(first).toEqual({
      notification_id: n(1),
      case_id: caseId(1),
      case_number: "CDF-DEMO-2026-0001",
      case_title: expect.objectContaining({ ar: expect.any(String), en: expect.any(String) }),
      template_code: "CF-20_INVESTIGATION_ASSIGNED",
      template_name: { ar: "إسناد التحقيق", en: "Investigation assigned" },
      template_version: 1,
      language: "ar",
      recipient_class: "CASE_TEAM",
      lifecycle_status: "DRAFT",
      created_at: "2026-10-01T09:00:00.000Z",
      last_event_at: "2026-10-01T09:00:00.000Z",
      row_version: 1,
    });
  });

  it("Governance Officer Delta reads the same authorised set in GOVERNANCE and SECRETARIAT", async () => {
    expect(await ids(DELTA_GOV)).toEqual([n(3), n(2), n(1), n(5)]);
    expect(await ids(DELTA_SEC)).toEqual([n(3), n(2), n(1), n(5)]);
  });

  it("restricted 0009: Beta (assigned) sees its notification; Gamma never does, by listing or by case number", async () => {
    expect(await ids(BETA)).toContain(n(4));
    expect(await ids(GAMMA)).not.toContain(n(4));
    expect(await ids(GAMMA, { ...PAGE, case_number: "CDF-DEMO-2026-0009" })).toEqual([]);
  });

  it.each([
    ["a hidden case (0009 for Alpha)", ALPHA, "CDF-DEMO-2026-0009"],
    ["a case outside the workspace (0002 for Alpha)", ALPHA, "CDF-DEMO-2026-0002"],
    ["an unknown case number", ALPHA, "CDF-DEMO-2026-9999"],
    ["Epsilon (membership expired) on 0001", EPSILON, "CDF-DEMO-2026-0001"],
  ])("%s: no rows and total 0, like an unknown case", async (_n, identity, case_number) => {
    expect(await reader.listNotifications(identity, { ...PAGE, case_number })).toEqual({
      items: [],
      next_cursor: null,
      total: 0,
    });
  });

  it("Epsilon (membership expired) sees nothing at all", async () => {
    expect(await reader.listNotifications(EPSILON, PAGE)).toEqual({ items: [], next_cursor: null, total: 0 });
  });

  it("filters by status, template, case number and created range; the count follows the filters", async () => {
    expect(await ids(ALPHA, { ...PAGE, lifecycle_status: "DRAFT" })).toEqual([n(3), n(2), n(1), n(5)]);
    expect(await ids(ALPHA, { ...PAGE, lifecycle_status: "DISPATCHED" })).toEqual([]);
    expect(await ids(ALPHA, { ...PAGE, template_code: "CF-24_MEETING_INVITATION" })).toEqual([
      n(3),
      n(2),
      n(5),
    ]);
    expect(await ids(ALPHA, { ...PAGE, case_number: "CDF-DEMO-2026-0003" })).toEqual([n(3), n(2)]);
    // Riyadh day 2 Oct 2026 = [1 Oct 21:00Z, 2 Oct 21:00Z).
    expect(
      await ids(ALPHA, {
        ...PAGE,
        created_from: "2026-10-02T00:00:00+03:00",
        created_before: "2026-10-03T00:00:00+03:00",
      }),
    ).toEqual([n(2)]);
  });

  it("keyset paging one row at a time walks the same order, no duplicates, constant total", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await reader.listNotifications(ALPHA, { limit: 1, ...(cursor ? { cursor } : {}) });
      expect(page.total).toBe(4);
      seen.push(...page.items.map((x) => x.notification_id));
      if (page.next_cursor === null) break;
      expect(decodeCenterCursor(page.next_cursor)?.at).toMatch(/\.\d{6}Z$/);
      cursor = page.next_cursor;
    }
    expect(seen).toEqual([n(3), n(2), n(1), n(5)]);
  });

  it("a cursor that does not decode is refused before the database", async () => {
    await expect(reader.listNotifications(ALPHA, { limit: 1, cursor: "bm90LWEtY3Vyc29y" })).rejects.toThrow(
      InvalidCursorError,
    );
  });

  it("Scenario E: a draft created in 0001 appears in the Center with case 0001 only, newest first (rolled back)", async () => {
    const outcome = await withRequestContext(
      ALPHA,
      async (tx) => {
        const [created] = await tx<{ notification_id: string }[]>`
          select d.notification_id
            from cdf_notifications_v13.api_create_notification_draft(
                   ${caseId(1)}::uuid, '1f000000-0000-4000-8000-000000000003'::uuid, 'WITNESS',
                   ${randomBytes(32).toString("hex")}) d`;
        const inTx = createV13NotificationCenterReader((_identity, fn) => fn(tx as never));
        const all = await inTx.listNotifications(ALPHA, PAGE);
        const other = await inTx.listNotifications(ALPHA, { ...PAGE, case_number: "CDF-DEMO-2026-0003" });
        throw new Rollback({ id: created!.notification_id, all, other });
      },
      { sql, claimsKey: TEST_CLAIMS_KEY },
    ).catch((e: unknown) => {
      if (e instanceof Rollback)
        return e.value as {
          id: string;
          all: Awaited<ReturnType<typeof reader.listNotifications>>;
          other: { items: { notification_id: string }[] };
        };
      throw e;
    });
    expect(outcome.all.total).toBe(5);
    expect(outcome.all.items[0]).toMatchObject({
      notification_id: outcome.id,
      case_id: caseId(1),
      case_number: "CDF-DEMO-2026-0001",
      recipient_class: "WITNESS",
      lifecycle_status: "DRAFT",
    });
    expect(outcome.all.items.filter((x) => x.notification_id === outcome.id)).toHaveLength(1);
    expect(outcome.other.items.map((x) => x.notification_id)).not.toContain(outcome.id);
    // Rolled back: the Center is back to the seed.
    expect(await ids(ALPHA)).toEqual([n(3), n(2), n(1), n(5)]);
  });
});
