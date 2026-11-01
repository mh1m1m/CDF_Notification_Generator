// V13-FE-006 part 3: the in-case preview against the local primary cluster as cdf_v13_app → cdf_v13_user (M1 seed,
// migrations 0004 and 0006). The reader is keyed by the case AND the notification id under RLS: another case's
// notification, a hidden case and an unknown id all read as null. The whole path (case header → preview read → events →
// buildModelFromRecords → projectForRecipient → renderPlatform) runs inside one request transaction with a WITNESS
// draft created by the real command and rolled back, so the seed is unchanged. Negatives: the seed's database recipient
// classes (OI-037) never render; restricted case 0009 fails closed (no access-list result). Synthetic data only.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  RequestIdentitySchema,
  type CaseId,
  type CaseSummary,
  type NotificationPreviewReader,
  type RequestIdentity,
} from "@/lib/contracts";
import { createV13RecordsCaseSource } from "@/lib/adapters/case-source/v13-records";
import { createV13NotificationDrafts } from "@/lib/adapters/notification-records/v13-notification-drafts";
import { createV13NotificationPreviewReader } from "@/lib/adapters/notification-records/v13-notification-preview";
import { createV13NotificationRecordsReader } from "@/lib/adapters/notification-records/v13-notification-records";
import { createV13ProceduralRecordsReader } from "@/lib/adapters/procedural-records/v13-procedural-records";
import { databaseClientOptions } from "@/lib/db/client";
import { withRequestContext, type Tx } from "@/lib/db/security-context";
import { loadNotificationPreview, type NotificationPreviewView } from "@/lib/server/notification-preview";
import { TEST_CLAIMS_KEY } from "../support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL, PRIMARY_APP_URL } from "../support/clusters";

const logServerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/errors", () => ({ logServerError }));

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);
const who = (persona: number, active_workspace: string, role: string): RequestIdentity =>
  RequestIdentitySchema.parse({
    persona_id: `0b000000-0000-4000-8000-00000000000${persona}`,
    active_workspace,
    roles: [role],
  });
const ALPHA = who(1, "SECRETARIAT", "COMMITTEE_SECRETARY");
const BETA = who(2, "INVESTIGATIONS", "INVESTIGATOR");
const DELTA_GOV = who(4, "GOVERNANCE", "GOVERNANCE_OFFICER");
const caseId = (i: number) => `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}` as CaseId;
const NTF = (n: number) => `2f000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TV = (n: number) => `1f000000-0000-4000-8000-00000000000${n}`;
const CORRELATION = "5e000000-0000-4000-8000-0000000000f7";

const unrecorded = (r: NotificationPreviewReader): NotificationPreviewReader => ({
  ...r,
  getForCaseRecorded: (i, c, n) => r.getForCase(i, c, n),
});

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

describe.skipIf(!available)("V13 notification preview on the primary cluster (FE-006 part 3)", () => {
  let sql: postgres.Sql;
  let admin: postgres.Sql;
  let reader: ReturnType<typeof createV13NotificationPreviewReader>;
  let before: number;

  const countNotifications = async () =>
    (await admin<{ n: number }[]>`select count(*)::int as n from cdf_notifications_v13.notification`)[0]?.n;

  beforeAll(async () => {
    sql = postgres(PRIMARY_APP_URL, { ...databaseClientOptions(PRIMARY_APP_URL, {}), max: 1 });
    admin = postgres(PRIMARY_ADMIN_URL, { ...databaseClientOptions(PRIMARY_ADMIN_URL, {}), max: 1 });
    reader = createV13NotificationPreviewReader((identity, fn) =>
      withRequestContext(identity, fn, { sql, claimsKey: TEST_CLAIMS_KEY }),
    );
    before = (await countNotifications()) ?? -1;
  });
  afterAll(async () => {
    expect(await countNotifications()).toBe(before);
    await sql?.end({ timeout: 5 });
    await admin?.end({ timeout: 5 });
  });

  it("reads a seed notification of its own case with the template's catalogue name and no text", async () => {
    const r = await reader.getForCase(ALPHA, caseId(1), NTF(1));
    expect(r).toMatchObject({
      notification_id: NTF(1),
      case_id: caseId(1),
      recipient_class: "CASE_TEAM",
      lifecycle_status: "DRAFT",
    });
    expect(r?.template_name.ar.length).toBeGreaterThan(0);
    expect(r?.template_name.en.length).toBeGreaterThan(0);
    expect(Object.keys(r ?? {})).not.toContain("subject");
  });

  it("negative: another case's notification, a hidden case, an unknown id and another workspace all read as null", async () => {
    expect(await reader.getForCase(ALPHA, caseId(3), NTF(1))).toBeNull(); // 0001's row under 0003
    expect(await reader.getForCase(ALPHA, caseId(1), NTF(2))).toBeNull(); // 0003's row under 0001
    expect(await reader.getForCase(ALPHA, caseId(9), NTF(4))).toBeNull(); // 0009 restricted, Beta only
    expect(await reader.getForCase(ALPHA, caseId(1), NTF(99))).toBeNull(); // unknown
    expect(await reader.getForCase(DELTA_GOV, caseId(9), NTF(4))).toBeNull();
    expect(await reader.getForCase(BETA, caseId(9), NTF(4))).toMatchObject({ case_id: caseId(9) });
  });

  it("M1-07: the case list carries each template's catalogue name and keeps the function's newest-first order", async () => {
    const list = await createV13NotificationRecordsReader((identity, fn) =>
      withRequestContext(identity, fn, { sql, claimsKey: TEST_CLAIMS_KEY }),
    ).listForCase(ALPHA, caseId(3));
    expect(list.map((n) => n.notification_id)).toEqual([NTF(3), NTF(2)]);
    const names = await admin<{ code: string; name_ar: string; name_en: string }[]>`
      select code, name_ar, name_en from cdf_notifications_v13.notification_template`;
    for (const n of list) {
      const t = names.find((x) => x.code === n.template_code);
      expect(n.template_name).toEqual({ ar: t?.name_ar, en: t?.name_en });
    }
  });

  /** One request transaction: the real draft command, then the whole preview path, then rollback. */
  async function previewOfNewDraft(
    identity: RequestIdentity,
    i: number,
    recipientClass: string,
    tv = 4,
  ): Promise<{ view: NotificationPreviewView; id: string }> {
    try {
      await withRequestContext(
        identity,
        async (tx: Tx) => {
          const run = <T>(_: RequestIdentity, fn: (t: Tx) => Promise<T>) => fn(tx);
          const created = await createV13NotificationDrafts(run).createDraft(identity, {
            case_id: caseId(i),
            template_version_id: TV(tv),
            recipient_class: recipientClass,
            idempotency_key: "c".repeat(64),
          } as never);
          const header = await createV13RecordsCaseSource(run).getCase(identity, caseId(i));
          if (!header) throw new Error("case not visible");
          const { my_capacity: _cap, ...summary } = header;
          const view = await loadNotificationPreview(
            {
              ctx: { identity, correlationId: CORRELATION as never } as never,
              // V13-FE-017: the draft command took this transaction's one api_* slot, so the recorded read would get
              // V1500; the render path is under test here, the access record in case-access-audit.spec.ts.
              reader: unrecorded(createV13NotificationPreviewReader(run)),
              procedural: createV13ProceduralRecordsReader(run),
            },
            summary as CaseSummary,
            created.notification_id,
          );
          throw new Rollback({ view, id: created.notification_id });
        },
        { sql, claimsKey: TEST_CLAIMS_KEY, correlationId: CORRELATION as never },
      );
    } catch (error) {
      if (error instanceof Rollback) return error.value as { view: NotificationPreviewView; id: string };
      throw error;
    }
    throw new Error("not rolled back");
  }

  it("a WITNESS draft on 0001 renders: the projected model only, in the template's language, marked DESIGN_PREVIEW", async () => {
    const { view, id } = await previewOfNewDraft(ALPHA, 1, "WITNESS", 4);
    expect(view.kind).toBe("preview");
    if (view.kind !== "preview") return;
    expect(view.notificationId).toBe(id);
    expect(view.lang).toBe("en"); // template version 1f…04 is the English one
    expect(view.html).toContain('data-marking="DESIGN_PREVIEW"');
    expect(view.html).toContain('data-experience="PLATFORM"');
    expect(view.html).not.toMatch(/<script|\son[a-z]+=|\{\{/i);
    // the template's text (subject, body) is never read, so it cannot appear
    expect(view.html).not.toContain("You are invited to a committee meeting");
  });

  it("negative: a WITNESS draft on restricted 0009 (Beta) fails closed with the generic state", async () => {
    logServerError.mockClear();
    const { view } = await previewOfNewDraft(BETA, 9, "WITNESS", 1);
    expect(view).toEqual({ kind: "unavailable", correlationId: CORRELATION });
    expect((logServerError.mock.calls[0]?.[2] as { code?: string }).code).toBe("NO_ACCESS_LIST_RESULT");
  });

  it.each(["CASE_TEAM", "COMMITTEE_MEMBERS", "SUBJECT_EMPLOYEE", "GOVERNANCE"])(
    "negative: a %s draft (a database class the policy does not know, OI-037) shows the OI-037 state",
    async (rc) => {
      const { view, id } = await previewOfNewDraft(ALPHA, 1, rc, 4);
      expect(view).toEqual({ kind: "unmapped", notificationId: id, recipientClass: rc });
    },
  );
});
