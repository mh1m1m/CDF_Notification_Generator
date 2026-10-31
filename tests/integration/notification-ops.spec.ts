// V13-DB-015 — migration 0010: the Notification Operations Center reads (UX S4, FE-006). notifications_page and
// notifications_count are SECURITY INVOKER: RLS decides which notifications exist before filters, order, limit, count
// and summaries, with exactly the access of the case Notifications tab (case_notifications). Negative cases: other case,
// other workspace, other persona, restricted 0009, closed 0010, unknown filter values, expired/inactive personas,
// forged contexts, the app login itself. Commands used for set-up run in rolled-back transactions.
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimsMac, type Tx } from "@/lib/db/security-context";
import { TEST_CLAIMS_KEY } from "./support/claims";
import { clusterAvailable, errorCodeOf, PRIMARY_ADMIN_URL } from "./support/clusters";
import { adminClient, appClient, asPersona, asRaw, claimsText, PERSONA, WORKSPACE } from "./support/context";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);

async function ready(): Promise<boolean> {
  if (!available) return false;
  const admin = adminClient();
  try {
    const [row] = await admin<{ present: boolean; notifications: number }[]>`
      select pg_catalog.to_regprocedure('cdf_notifications_v13.notifications_count(text, text, text, timestamptz, timestamptz)') is not null as present,
             (select count(*)::int from cdf_notifications_v13.notification) as notifications`;
    return Boolean(row?.present) && (row?.notifications ?? 0) >= 5;
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const present = await ready();
if (available && !present)
  console.warn("[integration] skipping notification-ops: migration 0010 or cases seed missing");

const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const NOTIFICATION = (n: number) => `2f000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TEMPLATE_VERSION = (n: number) => `1f000000-0000-4000-8000-00000000000${n}`;
const ALL_CASES = Array.from({ length: 10 }, (_, k) => CASE(k + 1));
const key = (label: string) => createHash("sha256").update(`db-015:${label}`).digest("hex");

const PAGE_SIGNATURE =
  "cdf_notifications_v13.notifications_page(text, uuid, integer, text, text, text, timestamptz, timestamptz)";
const COUNT_SIGNATURE =
  "cdf_notifications_v13.notifications_count(text, text, text, timestamptz, timestamptz)";

interface OpsRow {
  notification_id: string;
  case_id: string;
  case_number: string;
  case_title_ar: string;
  case_title_en: string;
  template_code: string;
  template_name_ar: string;
  template_name_en: string;
  template_version: number;
  language: string;
  recipient_class: string;
  lifecycle_status: string;
  created_at: Date;
  created_at_cursor: string;
  last_event_at: Date | null;
  row_version: number;
}

interface Filters {
  status?: string | null;
  template?: string | null;
  caseNumber?: string | null;
  from?: string | null;
  before?: string | null;
}

const page =
  (
    f: Filters = {},
    after: { at: string | null; id: string | null } = { at: null, id: null },
    limit: number | null = 25,
  ) =>
  (tx: Tx) =>
    tx<OpsRow[]>`
      select * from cdf_notifications_v13.notifications_page(
        ${after.at}::text, ${after.id}::uuid, ${limit}::integer, ${f.status ?? null}::text,
        ${f.template ?? null}::text, ${f.caseNumber ?? null}::text, ${f.from ?? null}::timestamptz,
        ${f.before ?? null}::timestamptz)`;

const count =
  (f: Filters = {}) =>
  async (tx: Tx) =>
    Number(
      (
        await tx<{ n: string }[]>`
      select cdf_notifications_v13.notifications_count(
        ${f.status ?? null}::text, ${f.template ?? null}::text, ${f.caseNumber ?? null}::text,
        ${f.from ?? null}::timestamptz, ${f.before ?? null}::timestamptz)::text as n`
      )[0]!.n,
    );

/** The union of the case tabs (case_notifications) over every seeded case: the oracle for "never more than the tab". */
const tabUnion = async (tx: Tx) => {
  const ids: string[] = [];
  for (const c of ALL_CASES) {
    const rows = await tx<{ notification_id: string }[]>`
      select notification_id from cdf_notifications_v13.case_notifications(${c}::uuid)`;
    ids.push(...rows.map((r) => r.notification_id));
  }
  return ids.sort();
};

/** Every page with the given limit, following the returned cursors. */
const allPages = (f: Filters, limit: number) => async (tx: Tx) => {
  const rows: OpsRow[] = [];
  let after: { at: string | null; id: string | null } = { at: null, id: null };
  for (let guard = 0; guard < 100; guard += 1) {
    const batch = await page(f, after, limit)(tx);
    rows.push(...batch);
    if (batch.length < limit) break;
    const last = batch[batch.length - 1]!;
    after = { at: last.created_at_cursor, id: last.notification_id };
  }
  return rows;
};

const draft = (caseId: string, label: string) => (tx: Tx) =>
  tx<{ notification_id: string }[]>`
    select notification_id from cdf_notifications_v13.api_create_notification_draft(
      ${caseId}::uuid, ${TEMPLATE_VERSION(2)}::uuid, 'CASE_TEAM', ${key(label)})`;

const ids = (rows: { notification_id: string }[]) => rows.map((r) => r.notification_id).sort();

/**
 * Switches the request context inside the current transaction (claims + MAC for this transaction id), so a second
 * persona can look at rows the first one wrote and has not committed. The transaction is rolled back by asRaw.
 */
const switchTo = async (tx: Tx, persona: string, workspace: string) => {
  const claims = claimsText(persona, workspace);
  const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
  await tx`select pg_catalog.set_config('request.v13.claims', ${claims}, true),
                  pg_catalog.set_config('request.v13.claims_mac', ${claimsMac(TEST_CLAIMS_KEY, claims, row!.xid)}, true)`;
};

// Visibility in the seed (DATA_MODEL §5): notifications 01 → case 0001, 02 + 03 → 0003, 04 → 0009 (restricted, Beta
// assigned), 05 → 0010 (closed).
const EXPECTED: Record<string, { persona: string; workspace: string; notifications: number[] }> = {
  "Alpha in SECRETARIAT": {
    persona: PERSONA.alpha,
    workspace: WORKSPACE.SECRETARIAT,
    notifications: [1, 2, 3, 5],
  },
  "Beta in INVESTIGATIONS": {
    persona: PERSONA.beta,
    workspace: WORKSPACE.INVESTIGATIONS,
    notifications: [1, 2, 3, 4, 5],
  },
  "Gamma in INVESTIGATIONS": {
    persona: PERSONA.gamma,
    workspace: WORKSPACE.INVESTIGATIONS,
    notifications: [1, 2, 3, 5],
  },
  "Delta in GOVERNANCE": {
    persona: PERSONA.delta,
    workspace: WORKSPACE.GOVERNANCE,
    notifications: [1, 2, 3, 5],
  },
  "Delta in SECRETARIAT": {
    persona: PERSONA.delta,
    workspace: WORKSPACE.SECRETARIAT,
    notifications: [1, 2, 3, 5],
  },
};

describe.skipIf(!present)("Notification Operations Center reads (migration 0010)", () => {
  let app: postgres.Sql;
  let admin: postgres.Sql;
  const as = <T>(persona: string, workspace: string, fn: (tx: Tx) => Promise<T>) =>
    asRaw(app, { claims: claimsText(persona, workspace), mac: "valid" }, fn);
  const alpha = <T>(fn: (tx: Tx) => Promise<T>) => as(PERSONA.alpha, WORKSPACE.SECRETARIAT, fn);

  beforeAll(async () => {
    app = appClient();
    admin = adminClient();
    await asPersona(app, PERSONA.alpha, "SECRETARIAT", async () => undefined); // installs the test key if needed
  });
  afterAll(async () => {
    await app.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
  });

  it("shape: invoker, empty search_path, EXECUTE for cdf_v13_user only, no person column", async () => {
    const rows = await admin<
      { sig: string; definer: boolean; config: string[] | null; acl: string; cols: string }[]
    >`
      select p.oid::regprocedure::text as sig, p.prosecdef as definer, p.proconfig as config, p.proacl::text as acl,
             pg_catalog.pg_get_function_result(p.oid) as cols
        from pg_catalog.pg_proc p
       where p.oid in (${PAGE_SIGNATURE}::regprocedure, ${COUNT_SIGNATURE}::regprocedure)
       order by 1`;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.definer, r.sig).toBe(false);
      expect(r.config, r.sig).toEqual(['search_path=""']);
      expect(r.acl, r.sig).toBe("{cdf_v13_owner=X/cdf_v13_owner,cdf_v13_user=X/cdf_v13_owner}");
    }
    const pageCols = rows.find((r) => r.sig.includes("notifications_page"))!.cols;
    expect(pageCols).toBe(
      "TABLE(notification_id uuid, case_id uuid, case_number text, case_title_ar text, case_title_en text, " +
        "template_code text, template_name_ar text, template_name_en text, template_version integer, language text, " +
        "recipient_class text, lifecycle_status text, created_at timestamp with time zone, created_at_cursor text, " +
        "last_event_at timestamp with time zone, row_version integer)",
    );
    expect(pageCols).not.toMatch(/persona|recipient_id|email|author|actor|subject|body/i);
  });

  it("values: each row names its case and template, and last_event_at is the latest event", async () => {
    const rows = await as(PERSONA.beta, WORKSPACE.INVESTIGATIONS, page());
    const n4 = rows.find((r) => r.notification_id === NOTIFICATION(4))!;
    expect(n4).toMatchObject({
      case_id: CASE(9),
      case_number: "CDF-DEMO-2026-0009",
      case_title_en: "Demo case 0009 — restricted",
      template_code: "CF-20_INVESTIGATION_ASSIGNED",
      template_name_en: "Investigation assigned",
      template_name_ar: "إسناد التحقيق",
      template_version: 1,
      language: "ar",
      recipient_class: "CASE_TEAM",
      lifecycle_status: "DRAFT",
      created_at_cursor: "2026-10-04T09:00:00.000000Z",
      row_version: 1,
    });
    expect(n4.last_event_at?.toISOString()).toBe("2026-10-04T09:00:00.000Z");
    // Newest first, id as tie-breaker.
    expect(rows.map((r) => r.notification_id)).toEqual([4, 3, 2, 1, 5].map(NOTIFICATION));
  });

  for (const [label, e] of Object.entries(EXPECTED)) {
    it(`${label}: rows = the union of its case tabs = the expected set, and count equals rows`, async () => {
      const result = await as(e.persona, e.workspace, async (tx) => ({
        rows: ids(await page()(tx)),
        tabs: await tabUnion(tx),
        n: await count()(tx),
      }));
      expect(result.rows).toEqual(e.notifications.map(NOTIFICATION).sort());
      expect(result.rows).toEqual(result.tabs);
      expect(result.n).toBe(result.rows.length);
    });
  }

  it("restricted 0009 only for its assignee (Beta), never for Gamma in the same workspace or Alpha where it is visible", async () => {
    const filter = { caseNumber: "CDF-DEMO-2026-0009" };
    expect(ids(await as(PERSONA.beta, WORKSPACE.INVESTIGATIONS, page(filter)))).toEqual([NOTIFICATION(4)]);
    expect(await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, page(filter))).toEqual([]);
    expect(await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, count(filter))).toBe(0);
    expect(await alpha(page(filter))).toEqual([]);
    expect(await alpha(count(filter))).toBe(0);
  });

  it("closed 0010 stays readable (records are read-only, not hidden), as in its case tab", async () => {
    const rows = await alpha(page({ caseNumber: "CDF-DEMO-2026-0010" }));
    expect(ids(rows)).toEqual([NOTIFICATION(5)]);
  });

  it("other workspace: an uncommitted draft in 0002 is seen in GOVERNANCE (0002 visible there), never in SECRETARIAT", async () => {
    const seen = await as(PERSONA.gamma, WORKSPACE.INVESTIGATIONS, async (tx) => {
      const [created] = await draft(CASE(2), "other-workspace")(tx);
      const gamma = ids(await page()(tx));
      await switchTo(tx, PERSONA.delta, WORKSPACE.GOVERNANCE);
      const governance = { rows: ids(await page()(tx)), n: await count()(tx) };
      await switchTo(tx, PERSONA.delta, WORKSPACE.SECRETARIAT);
      const secretariat = {
        rows: ids(await page()(tx)),
        n: await count()(tx),
        byNumber: await page({ caseNumber: "CDF-DEMO-2026-0002" })(tx),
      };
      return { id: created!.notification_id, gamma, governance, secretariat };
    });
    expect(seen.gamma).toContain(seen.id);
    expect(seen.governance.rows).toContain(seen.id);
    expect(seen.governance.n).toBe(5);
    expect(seen.secretariat.rows).not.toContain(seen.id);
    expect(seen.secretariat.rows).toEqual([1, 2, 3, 5].map(NOTIFICATION).sort());
    expect(seen.secretariat.n).toBe(4);
    expect(seen.secretariat.byNumber).toEqual([]);
  });

  it("other persona: Beta's uncommitted draft in restricted 0009 is invisible to Gamma (same workspace) and Delta", async () => {
    const seen = await as(PERSONA.beta, WORKSPACE.INVESTIGATIONS, async (tx) => {
      const [created] = await draft(CASE(9), "other-persona")(tx);
      const beta = ids(await page({ caseNumber: "CDF-DEMO-2026-0009" })(tx));
      await switchTo(tx, PERSONA.gamma, WORKSPACE.INVESTIGATIONS);
      const gamma = { rows: ids(await page()(tx)), n: await count({ caseNumber: "CDF-DEMO-2026-0009" })(tx) };
      await switchTo(tx, PERSONA.delta, WORKSPACE.GOVERNANCE);
      const delta = { rows: ids(await page()(tx)), n: await count({ caseNumber: "CDF-DEMO-2026-0009" })(tx) };
      return { id: created!.notification_id, beta, gamma, delta };
    });
    expect(seen.beta).toEqual([NOTIFICATION(4), seen.id].sort());
    for (const other of [seen.gamma, seen.delta]) {
      expect(other.rows).not.toContain(seen.id);
      expect(other.rows).not.toContain(NOTIFICATION(4));
      expect(other.n).toBe(0);
    }
  });

  it("Scenario E (database half): a draft created in 0001 appears under 0001 only, with that case's number", async () => {
    const seen = await alpha(async (tx) => {
      const [created] = await draft(CASE(1), "scenario-e")(tx);
      const rows = await page()(tx);
      const mine = rows.filter((r) => r.notification_id === created!.notification_id);
      const under0002 = await page({ caseNumber: "CDF-DEMO-2026-0002" })(tx);
      const under0001 = await page({ caseNumber: "CDF-DEMO-2026-0001" })(tx);
      const tab0001 = await tx<{ notification_id: string }[]>`
        select notification_id from cdf_notifications_v13.case_notifications(${CASE(1)}::uuid)`;
      const tab0002 = await tx<{ notification_id: string }[]>`
        select notification_id from cdf_notifications_v13.case_notifications(${CASE(2)}::uuid)`;
      return {
        id: created!.notification_id,
        mine,
        under0001,
        under0002,
        tab0001,
        tab0002,
        n: await count()(tx),
      };
    });
    expect(seen.mine).toHaveLength(1);
    expect(seen.mine[0]).toMatchObject({
      case_id: CASE(1),
      case_number: "CDF-DEMO-2026-0001",
      lifecycle_status: "DRAFT",
    });
    expect(seen.mine[0]!.last_event_at).not.toBeNull();
    expect(ids(seen.under0001)).toContain(seen.id);
    expect(ids(seen.under0002)).not.toContain(seen.id);
    expect(ids(seen.tab0001)).toContain(seen.id);
    expect(ids(seen.tab0002)).not.toContain(seen.id);
    expect(seen.n).toBe(5);
  });

  it("filters: lifecycle, template code, case number and created range; page and count agree", async () => {
    const cases: [Filters, number[]][] = [
      [{ status: "DRAFT" }, [1, 2, 3, 5]],
      [{ status: "DISPATCHED" }, []],
      [{ template: "CF-24_MEETING_INVITATION" }, [2, 3, 5]],
      [{ template: "CF-20_INVESTIGATION_ASSIGNED" }, [1]],
      [{ caseNumber: "CDF-DEMO-2026-0003" }, [2, 3]],
      [{ from: "2026-10-02T09:00:00Z" }, [2, 3]],
      [{ before: "2026-10-02T09:00:00Z" }, [1, 5]],
      [{ from: "2026-10-01T00:00:00Z", before: "2026-10-03T00:00:00Z" }, [1, 2]],
      [{ status: "", template: "", caseNumber: "" }, [1, 2, 3, 5]],
      [{ template: "CF-24_MEETING_INVITATION", caseNumber: "CDF-DEMO-2026-0010" }, [5]],
    ];
    for (const [f, expected] of cases) {
      const got = await alpha(async (tx) => ({ rows: ids(await page(f)(tx)), n: await count(f)(tx) }));
      expect(got.rows, JSON.stringify(f)).toEqual(expected.map(NOTIFICATION).sort());
      expect(got.n, JSON.stringify(f)).toBe(expected.length);
    }
  });

  it("unknown filter values match nothing and count 0 (no error, no hint)", async () => {
    const unknown: Filters[] = [
      { status: "NO_SUCH_STATUS" },
      { status: "draft" },
      { template: "CF-99_UNKNOWN" },
      { caseNumber: "CDF-DEMO-2026-0099" },
      { caseNumber: "cdf-demo-2026-0001" },
      { caseNumber: "CDF-DEMO-2026-000" },
      { caseNumber: CASE(1) },
      { caseNumber: "%" },
      { from: "2027-01-01T00:00:00Z" },
      { before: "2026-01-01T00:00:00Z" },
      { from: "2026-10-03T00:00:00Z", before: "2026-10-02T00:00:00Z" },
    ];
    for (const f of unknown) {
      const got = await alpha(async (tx) => ({ rows: await page(f)(tx), n: await count(f)(tx) }));
      expect(got.rows, JSON.stringify(f)).toEqual([]);
      expect(got.n, JSON.stringify(f)).toBe(0);
    }
  });

  it("paging: limit 1..100, every row once over all pages (ties included), count = rows over all pages", async () => {
    const result = await alpha(async (tx) => {
      // Two drafts in one transaction share created_at (now()): the id breaks the tie.
      await draft(CASE(1), "tie-a")(tx);
      await draft(CASE(3), "tie-b")(tx);
      const one = await page()(tx);
      const byOne = await allPages({}, 1)(tx);
      const byTwo = await allPages({}, 2)(tx);
      const zero = await page({}, undefined, 0)(tx);
      const negative = await page({}, undefined, -5)(tx);
      const nullLimit = await page({}, undefined, null)(tx);
      return { one, byOne, byTwo, zero, negative, nullLimit, n: await count()(tx) };
    });
    expect(result.n).toBe(6);
    expect(result.one).toHaveLength(6);
    for (const all of [result.byOne, result.byTwo]) {
      expect(all.map((r) => r.notification_id)).toEqual(result.one.map((r) => r.notification_id));
      expect(new Set(all.map((r) => r.notification_id)).size).toBe(all.length);
    }
    expect(result.zero).toHaveLength(1);
    expect(result.negative).toHaveLength(1);
    expect(result.nullLimit).toHaveLength(6);
    const ties = result.one.filter((r) => r.created_at_cursor === result.one[0]!.created_at_cursor);
    expect(ties).toHaveLength(2);
  });

  it("paging: the limit is capped at 100", async () => {
    const result = await alpha(async (tx) => {
      for (let k = 0; k < 101; k += 1) await draft(CASE(1), `cap-${k}`)(tx);
      return { capped: await page({}, undefined, 1000)(tx), n: await count()(tx) };
    });
    expect(result.n).toBe(105);
    expect(result.capped).toHaveLength(100);
  });

  it("paging: half a cursor, or a cursor text in another form, matches nothing (fail closed)", async () => {
    const rows = await alpha(page());
    const last = rows[rows.length - 1]!;
    expect(await alpha(page({}, { at: last.created_at_cursor, id: null }))).toEqual([]);
    expect(await alpha(page({}, { at: null, id: last.notification_id }))).toEqual([]);
    // Half a cursor whose present half would admit every row (SEC review 0bb7f09): still nothing.
    expect(await alpha(page({}, { at: "2100-01-01T00:00:00.000000Z", id: null }))).toEqual([]);
    expect(await alpha(page({}, { at: null, id: rows[0]!.notification_id }))).toEqual([]);
    expect(await alpha(page({}, { at: null, id: "ffffffff-ffff-4fff-bfff-ffffffffffff" }))).toEqual([]);
    expect(await alpha(page({}, { at: "", id: null }))).toEqual([]);
    expect(await alpha(page({}, { at: last.created_at_cursor, id: last.notification_id }))).toEqual([]);
    expect(ids(await alpha(page({}, { at: "2100-01-01T00:00:00.000000Z", id: NOTIFICATION(1) })))).toEqual(
      ids(rows),
    );
    // The cursor text has one form (microseconds, UTC, Z). Any other form matches nothing, never an error or a guess.
    for (const at of [
      "2100-01-01T00:00:00Z",
      "2100-01-01T00:00:00.000Z",
      "2100-01-01 00:00:00.000000+00",
      "2100-01-01T00:00:00.000000",
      "not a time",
      "",
    ]) {
      expect(await alpha(page({}, { at, id: NOTIFICATION(1) })), at).toEqual([]);
    }
  });

  it("a cursor from another persona's row reveals nothing beyond the caller's own rows", async () => {
    // Beta's restricted notification 04 as a cursor for Gamma: Gamma gets only its own older rows.
    const beta = await as(PERSONA.beta, WORKSPACE.INVESTIGATIONS, page());
    const n4 = beta.find((r) => r.notification_id === NOTIFICATION(4))!;
    const gamma = await as(
      PERSONA.gamma,
      WORKSPACE.INVESTIGATIONS,
      page({}, { at: n4.created_at_cursor, id: n4.notification_id }),
    );
    expect(ids(gamma)).toEqual([1, 2, 3, 5].map(NOTIFICATION).sort());
  });

  it("Epsilon (expired membership) and Zeta (inactive) see nothing and count 0, with any filter", async () => {
    for (const persona of [PERSONA.epsilon, PERSONA.zeta, PERSONA.unknown]) {
      for (const f of [{}, { status: "DRAFT" }, { caseNumber: "CDF-DEMO-2026-0001" }]) {
        const got = await as(persona, WORKSPACE.SECRETARIAT, async (tx) => ({
          rows: await page(f)(tx),
          n: await count(f)(tx),
        }));
        expect(got.rows, persona).toEqual([]);
        expect(got.n, persona).toBe(0);
      }
    }
  });

  it("forged or missing contexts see nothing and count 0", async () => {
    const claims = claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT);
    const contexts = [
      {},
      { claims },
      { claims, mac: "00".repeat(32) },
      { claims, mac: "valid" as const, macOver: claimsText(PERSONA.beta, WORKSPACE.INVESTIGATIONS) },
    ];
    for (const ctx of contexts) {
      const got = await asRaw(app, ctx, async (tx) => ({ rows: await page()(tx), n: await count()(tx) }));
      expect(got.rows, JSON.stringify(ctx)).toEqual([]);
      expect(got.n, JSON.stringify(ctx)).toBe(0);
    }
  });

  it("the app login cannot call them without the request role (42501)", async () => {
    const codes: string[] = [];
    for (const call of [
      (tx: postgres.TransactionSql) => tx`select * from cdf_notifications_v13.notifications_page()`,
      (tx: postgres.TransactionSql) => tx`select cdf_notifications_v13.notifications_count()`,
    ]) {
      codes.push(
        await app
          .begin(async (tx) => {
            await call(tx);
            return "OK";
          })
          .catch((error: unknown) => errorCodeOf(error)),
      );
    }
    expect(codes).toEqual(["42501", "42501"]);
  });
});
