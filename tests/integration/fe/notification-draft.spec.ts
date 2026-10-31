// FE-006 Scenario E: the V13 NotificationDraftPort (template options under RLS and api_create_notification_draft,
// migration 0004) through the adapter and withRequestContext, against the local primary cluster. A draft in case 0001
// adds exactly one notification, one notification event and one case-bound audit event there (with this request's
// correlation id) and changes nothing in any other case. Negatives: the same idempotency key twice (DUPLICATE), a
// case the persona may not see or draft on (NOT_FOUND, nothing written), a closed case (CASE_CLOSED), an unknown
// template version or recipient class (INVALID_INPUT). Every command runs inside a transaction the test rolls back, so
// the seed is unchanged for the other suites. Synthetic data only.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  NotificationCommandRefusedError,
  RequestIdentitySchema,
  type CreateNotificationDraftCommand,
  type RequestIdentity,
} from "@/lib/contracts";
import { createV13NotificationDrafts } from "@/lib/adapters/notification-records/v13-notification-drafts";
import { databaseClientOptions } from "@/lib/db/client";
import { withRequestContext, type Tx } from "@/lib/db/security-context";
import { TEST_CLAIMS_KEY } from "../support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL } from "../support/clusters";

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
const CASE = (n: number) => `0c000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TV = (n: number) => `1f000000-0000-4000-8000-00000000000${n}`;
const KEY = "a".repeat(64);
const SEEDED_KEY = "f".repeat(64); // overwritten below with seed notification 01's key (Alpha's own)
const CORRELATION = "5e000000-0000-4000-8000-0000000000f6";

interface Snapshot {
  readonly notifications: Record<string, number>;
  readonly events: Record<string, number>;
  readonly audit: Record<string, number>;
  readonly auditForCorrelation: { action: string; case_id: string; entity_id: string }[];
  readonly created: { id: string; case_id: string; recipient_class: string; lifecycle_status: string }[];
}

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super("rollback");
  }
}

describe.skipIf(!available)("V13 notification draft command on the primary cluster (FE-006)", () => {
  let admin: postgres.Sql;
  let seededKey = SEEDED_KEY;

  /** Notifications, notification events and case-bound audit events per case, read as the administrator. */
  async function snapshot(tx: Tx | postgres.Sql): Promise<Snapshot> {
    const count = async (table: string) =>
      Object.fromEntries(
        (
          await tx.unsafe<{ case_id: string; n: number }[]>(
            `select case_id::text, count(*)::int as n from cdf_notifications_v13.${table}
              where case_id is not null group by case_id`,
          )
        ).map((r) => [r.case_id, r.n]),
      );
    const mine = await tx<{ action: string; case_id: string; entity_id: string }[]>`
      select action, case_id::text, entity_id::text from cdf_notifications_v13.audit_event
       where correlation_id = ${CORRELATION}::uuid`;
    const created = await tx<
      { id: string; case_id: string; recipient_class: string; lifecycle_status: string }[]
    >`
      select id::text, case_id::text, recipient_class, lifecycle_status from cdf_notifications_v13.notification
       where idempotency_key = ${KEY}`;
    return {
      notifications: await count("notification"),
      events: await count("notification_event"),
      audit: await count("audit_event"),
      auditForCorrelation: [...mine],
      created: [...created],
    };
  }

  const port = (onSuccess: (tx: Tx) => Promise<Snapshot>) =>
    createV13NotificationDrafts((id, fn) =>
      withRequestContext(
        id,
        async (tx) => {
          // A refusal raises inside fn and aborts the transaction; a success is inspected here, then rolled back.
          const rows = await fn(tx);
          await tx.unsafe("reset role");
          throw new Rollback({ rows, after: await onSuccess(tx) });
        },
        { sql: admin, claimsKey: TEST_CLAIMS_KEY, correlationId: CORRELATION as never },
      ),
    );

  async function attempt(
    identity: RequestIdentity,
    command: Partial<CreateNotificationDraftCommand>,
  ): Promise<{ outcome: string; after: Snapshot; rows?: unknown }> {
    const full = {
      case_id: CASE(1),
      template_version_id: TV(1),
      recipient_class: "WITNESS",
      idempotency_key: KEY,
      ...command,
    } as CreateNotificationDraftCommand;
    try {
      await port(snapshot).createDraft(identity, full);
      return { outcome: "NOT_ROLLED_BACK", after: await snapshot(admin) };
    } catch (error) {
      if (error instanceof Rollback) {
        const v = error.value as { rows: unknown; after: Snapshot };
        return { outcome: "OK", after: v.after, rows: v.rows };
      }
      if (error instanceof NotificationCommandRefusedError)
        return { outcome: error.refusal, after: await snapshot(admin) };
      throw error;
    }
  }

  let before: Snapshot;
  beforeAll(async () => {
    admin = postgres(PRIMARY_ADMIN_URL, { ...databaseClientOptions(PRIMARY_ADMIN_URL, {}), max: 1 });
    before = await snapshot(admin);
    const [row] = await admin<{ k: string }[]>`
      select idempotency_key as k from cdf_notifications_v13.notification
       where id = '2f000000-0000-4000-8000-000000000001'::uuid`;
    seededKey = row?.k ?? SEEDED_KEY;
  });
  afterAll(async () => {
    // The seed is untouched: every attempt was rolled back or refused.
    expect(await snapshot(admin)).toEqual(before);
    await admin?.end({ timeout: 5 });
  });

  it("options: the active template versions (2 templates × ar/en) and the 5 recipient classes, no text", async () => {
    const options = await createV13NotificationDrafts((id, fn) =>
      withRequestContext(id, fn, { sql: admin, claimsKey: TEST_CLAIMS_KEY }),
    ).options(ALPHA);
    expect(options.templates.map((o) => `${o.template_code}@${o.version}/${o.language}`)).toEqual([
      "CF-20_INVESTIGATION_ASSIGNED@1/ar",
      "CF-20_INVESTIGATION_ASSIGNED@1/en",
      "CF-24_MEETING_INVITATION@1/ar",
      "CF-24_MEETING_INVITATION@1/en",
    ]);
    expect(options.recipientClasses.map((c) => c.code)).toEqual([
      "CASE_TEAM",
      "COMMITTEE_MEMBERS",
      "GOVERNANCE",
      "SUBJECT_EMPLOYEE",
      "WITNESS",
    ]);
    expect(JSON.stringify(options)).not.toMatch(/case_reference|\(Synthetic data\)/);
  });

  it("Scenario E: Alpha's draft in 0001 adds one notification, one event and one audit row there, nothing elsewhere", async () => {
    const { outcome, after, rows } = await attempt(ALPHA, {});
    expect(outcome).toBe("OK");
    expect(after.created).toEqual([
      { id: expect.any(String), case_id: CASE(1), recipient_class: "WITNESS", lifecycle_status: "DRAFT" },
    ]);
    expect(rows).toEqual([
      { notification_id: after.created[0]?.id, case_id: CASE(1), lifecycle_status: "DRAFT", row_version: 1 },
    ]);
    for (const k of ["notifications", "events", "audit"] as const) {
      for (const c of new Set([...Object.keys(before[k]), ...Object.keys(after[k])])) {
        expect(after[k][c] ?? 0, `${k} ${c}`).toBe((before[k][c] ?? 0) + (c === CASE(1) ? 1 : 0));
      }
    }
    expect(after.auditForCorrelation).toEqual([
      { action: "NOTIFICATION_DRAFT_CREATED", case_id: CASE(1), entity_id: after.created[0]?.id },
    ]);
  });

  it("a swapped id to another case Alpha may draft on (0003) lands the draft and its audit event there only (known limit)", async () => {
    const { outcome, after } = await attempt(ALPHA, { case_id: CASE(3) as never });
    expect(outcome).toBe("OK");
    expect(after.created.map((r) => r.case_id)).toEqual([CASE(3)]);
    for (const k of ["notifications", "events", "audit"] as const) {
      for (const c of new Set([...Object.keys(before[k]), ...Object.keys(after[k])])) {
        expect(after[k][c] ?? 0, `${k} ${c}`).toBe((before[k][c] ?? 0) + (c === CASE(3) ? 1 : 0));
      }
    }
    expect(after.auditForCorrelation).toEqual([
      { action: "NOTIFICATION_DRAFT_CREATED", case_id: CASE(3), entity_id: after.created[0]?.id },
    ]);
  });

  it("an investigator (Beta, Investigations) may draft on 0001 too", async () => {
    expect((await attempt(BETA, {})).outcome).toBe("OK");
  });

  it("the author's own key used again is DUPLICATE and writes nothing", async () => {
    const { outcome, after } = await attempt(ALPHA, { idempotency_key: seededKey });
    expect(outcome).toBe("DUPLICATE");
    expect(after).toEqual(before);
  });

  it("another persona's key gives no signal: Beta may use the key Alpha used", async () => {
    expect((await attempt(BETA, { idempotency_key: seededKey })).outcome).toBe("OK");
  });

  it.each([
    // SEC on #51 (1): a case the persona cannot see in its workspace.
    ["Alpha (Secretariat) on 0002, not visible in Secretariat", ALPHA, 2],
    ["Alpha (Secretariat) on 0005, not visible in Secretariat", ALPHA, 5],
    // SEC (2): the restricted case for an unassigned persona.
    ["Alpha on restricted 0009 (not assigned)", ALPHA, 9],
    ["Gamma (Investigations) on restricted 0009 (not assigned)", GAMMA, 9],
    // SEC (3): an unknown case UUID.
    ["Alpha on an unknown case id", ALPHA, 99],
    // SEC (4): a case visible only in other workspaces, for a role that may draft.
    ["Gamma (Investigations) on 0008, visible only in Governance and Secretariat", GAMMA, 8],
    ["Delta in Governance on 0001 (role may not draft)", DELTA_GOV, 1],
  ] as const)("%s is NOT_FOUND and writes nothing", async (_n, identity, c) => {
    const { outcome, after } = await attempt(identity, { case_id: CASE(c) as never });
    expect(outcome).toBe("NOT_FOUND");
    expect(after).toEqual(before);
  });

  it("the closed case 0010 is CASE_CLOSED and writes nothing", async () => {
    const { outcome, after } = await attempt(ALPHA, { case_id: CASE(10) as never });
    expect(outcome).toBe("CASE_CLOSED");
    expect(after).toEqual(before);
  });

  it.each([
    ["an unknown template version", { template_version_id: TV(9) }],
    ["an unknown recipient class", { recipient_class: "REPORTER" }],
  ] as const)("%s is INVALID_INPUT and writes nothing", async (_n, command) => {
    const { outcome, after } = await attempt(ALPHA, command);
    expect(outcome).toBe("INVALID_INPUT");
    expect(after).toEqual(before);
  });
});
