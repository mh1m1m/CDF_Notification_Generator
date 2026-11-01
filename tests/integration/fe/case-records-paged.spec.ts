// V13-FE-013 (OI-026): the paged readers (DB-019's case_events_page, case_tasks_page, case_notifications_page through
// the V13 adapters) against the local primary cluster as cdf_v13_app → cdf_v13_user. Walking every page with small
// limits gives exactly the unpaged read, in the same order. Negatives: another case's cursor, another list's cursor, a
// forged or malformed cursor, an unknown case, a case the persona may not see, another workspace (all empty or
// refused before any read; never another case's rows). M1 seed, synthetic only.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InvalidCursorError,
  RequestIdentitySchema,
  type CaseId,
  type CaseRecordsPage,
  type CaseRecordsPageRequest,
  type RequestIdentity,
} from "@/lib/contracts";
import { createV13NotificationRecordsReader } from "@/lib/adapters/notification-records/v13-notification-records";
import { createV13ProceduralRecordsReader } from "@/lib/adapters/procedural-records/v13-procedural-records";
import type { createV13RecordsCaseSource } from "@/lib/adapters/case-source/v13-records";
import { encodeCaseListCursor } from "@/lib/adapters/case-list/cursor";
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
const GAMMA = who(3, "INVESTIGATIONS", "INVESTIGATOR");
const DELTA_GOV = who(4, "GOVERNANCE", "GOVERNANCE_OFFICER");
const caseId = (i: number) => `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}` as CaseId;
const UNKNOWN = "0c000000-0000-4000-8000-000000000099" as CaseId;
/** A case Alpha sees with more than one row of the list (the seed has two notifications on 0003, one on 0001). */
const MULTI = (kind: string) => (kind === "notifications" ? caseId(3) : caseId(1));

type Lister = {
  kind: "events" | "tasks" | "notifications";
  all: (i: RequestIdentity, c: CaseId) => Promise<readonly { case_id: string }[]>;
  page: (
    i: RequestIdentity,
    c: CaseId,
    p: CaseRecordsPageRequest,
  ) => Promise<CaseRecordsPage<{ case_id: string }>>;
};

describe.skipIf(!available)("V13 paged case records on the primary cluster (FE-013)", () => {
  let sql: postgres.Sql;
  let lists: Lister[];
  beforeAll(() => {
    sql = postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
    const run: Parameters<typeof createV13RecordsCaseSource>[0] = (identity, fn) =>
      withRequestContext(identity, fn, { sql, claimsKey: TEST_CLAIMS_KEY });
    const procedural = createV13ProceduralRecordsReader(run);
    const notifications = createV13NotificationRecordsReader(run);
    lists = [
      {
        kind: "events",
        all: (i, c) => procedural.listEvents(i, c),
        page: (i, c, p) => procedural.listEventsPage(i, c, p),
      },
      {
        kind: "tasks",
        all: (i, c) => procedural.listTasks(i, c),
        page: (i, c, p) => procedural.listTasksPage(i, c, p),
      },
      {
        kind: "notifications",
        all: (i, c) => notifications.listForCase(i, c),
        page: (i, c, p) => notifications.listForCasePage(i, c, p),
      },
    ];
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  async function walk(l: Lister, identity: RequestIdentity, c: CaseId, limit: number) {
    const rows: { case_id: string }[] = [];
    const cursors: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 200; guard++) {
      const p = await l.page(identity, c, { limit, ...(cursor ? { cursor } : {}) });
      expect(p.items.length).toBeLessThanOrEqual(limit);
      rows.push(...p.items);
      if (p.next_cursor === null) return { rows, cursors };
      expect(p.items).toHaveLength(limit);
      cursors.push(p.next_cursor);
      cursor = p.next_cursor;
    }
    throw new Error("paging did not end");
  }

  it("every page walked with limits 1, 2 and 25 equals the unpaged read, same order, for each list and case", async () => {
    for (const l of lists)
      for (const [identity, c] of [
        [ALPHA, caseId(1)],
        [ALPHA, caseId(3)],
        [ALPHA, caseId(4)],
        [DELTA_GOV, caseId(6)],
      ] as const) {
        const all = await l.all(identity, c);
        for (const limit of [1, 2, 25]) {
          const { rows } = await walk(l, identity, c, limit);
          expect(rows, `${l.kind} ${c} limit ${limit}`).toEqual(all);
        }
      }
  });

  it("a list with rows actually pages (more than one seeded row)", async () => {
    for (const l of lists) {
      const all = await l.all(ALPHA, MULTI(l.kind));
      expect(all.length, l.kind).toBeGreaterThan(1);
      const { cursors } = await walk(l, ALPHA, MULTI(l.kind), 1);
      expect(cursors.length).toBe(all.length - 1);
    }
  });

  it("a cursor issued on one case gives an empty page on another case Alpha may see (0004), never the first case's rows", async () => {
    for (const l of lists) {
      const { cursors } = await walk(l, ALPHA, MULTI(l.kind), 1);
      expect(cursors.length, l.kind).toBeGreaterThan(0);
      for (const cursor of cursors) {
        const p = await l.page(ALPHA, caseId(4), { limit: 25, cursor });
        expect(p, l.kind).toEqual({ items: [], next_cursor: null });
      }
    }
  });

  it("a cursor of one list is refused by another before any read", async () => {
    for (const from of lists)
      for (const to of lists.filter((l) => l !== from)) {
        const { cursors } = await walk(from, ALPHA, MULTI(from.kind), 1);
        expect(cursors.length, from.kind).toBeGreaterThan(0);
        await expect(to.page(ALPHA, MULTI(to.kind), { limit: 25, cursor: cursors[0]! })).rejects.toThrow(
          InvalidCursorError,
        );
      }
  });

  it("a forged but well-formed cursor (unknown row) and a malformed one", async () => {
    const forged = {
      events: encodeCaseListCursor("events", {
        at: "2026-01-01T00:00:00.000000Z|2026-01-01T00:00:00.000000Z",
        id: "0e000000-0000-4000-8000-0000000000ff",
      }),
      tasks: encodeCaseListCursor("tasks", {
        at: "-|INTAKE_REVIEW",
        id: "0d000000-0000-4000-8000-0000000000ff",
      }),
      notifications: encodeCaseListCursor("notifications", {
        at: "2026-01-01T00:00:00.000000Z",
        id: "0f000000-0000-4000-8000-0000000000ff",
      }),
    };
    for (const l of lists) {
      expect(await l.page(ALPHA, caseId(1), { limit: 25, cursor: forged[l.kind] }), l.kind).toEqual({
        items: [],
        next_cursor: null,
      });
      await expect(l.page(ALPHA, caseId(1), { limit: 25, cursor: "Zm9yZ2Vk" })).rejects.toThrow(
        InvalidCursorError,
      );
    }
  });

  it.each([
    ["an unknown case", ALPHA, UNKNOWN],
    ["a case hidden from Alpha's workspace (0002)", ALPHA, caseId(2)],
    ["restricted 0009 for an unassigned persona (Gamma)", GAMMA, caseId(9)],
    ["a case visible only in other workspaces (Gamma on 0008)", GAMMA, caseId(8)],
  ] as const)(
    "%s: an empty page, first page and with a cursor of a visible case",
    async (_n, identity, c) => {
      for (const l of lists) {
        expect(await l.page(identity, c, { limit: 25 }), l.kind).toEqual({ items: [], next_cursor: null });
        const { cursors } = await walk(l, ALPHA, caseId(1), 1);
        expect(await l.page(identity, c, { limit: 25, cursor: cursors[0]! }), l.kind).toEqual({
          items: [],
          next_cursor: null,
        });
      }
    },
  );
});
