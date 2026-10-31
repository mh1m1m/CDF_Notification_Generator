/**
 * PRODUCTION_SUBSTITUTION_REQUIRED: in-memory test double
 *
 * notifyOutbox — in-memory mock of the platform notification outbox (W-D1, charter §10).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Production is schema `notify` in RDS PostgreSQL; e-mail delivery runs through the
 * NotificationSender port from a CDF-approved job service (migration header 1920:14-18; ADR-025;
 * packages/infrastructure/src/notifications/outbox.ts:1-3).
 *
 * Platform objects mirrored — FACT, infrastructure/supabase/migrations/20261007001920_notification_engine.sql:
 *   notify.template (:36-60)      template code `^[A-Z][A-Z0-9_]{2,63}$` (:37), object types (:38-39), the 14 seeded codes (:46-60)
 *   notify.rule defaults (:87-94) mandatory → IN_APP + EMAIL; others → IN_APP on, EMAIL off; SYSTEM_MANDATORY never muted
 *   notify.preference (:96-105)   per-user mutes; a mandatory template cannot be muted (api.set_notification_preference :523)
 *   notify.outbox (:107-126)      columns id, recipient_id, template_code, channel, object_type, object_id, deep_link,
 *                                 dedupe_key (unique, ≤ 300), status PENDING|SENT|FAILED, attempts 0..5, created_at,
 *                                 delivered_at, read_at; checks (:123-125). NO content column: no case number, name,
 *                                 allegation, narrative or evidence (§39, N18; :11-12, :131)
 *   notify.protect_outbox (:134-154) facts immutable, rows never deleted
 *   notify.deep_link (:202-215)   ids-only path; check `^(/[a-z0-9-]+)+$`, ≤ 200 chars (:116)
 *   notify.delivers (:219-238)    mandatory → true; else rule enabled and not muted (committee-default layer not mocked)
 *   notify.enqueue (:242-268)     null recipient → no-op (:253); inactive recipient → no-op (:254); unknown template →
 *                                 error (`into strict`, :255); object type taken from the template (:255, :260);
 *                                 dedupe_key = p_dedupe||':'||recipient||':'||channel (:261) `on conflict do nothing` (:264);
 *                                 IN_APP inserted SENT with delivered_at = now, EMAIL inserted PENDING (:262-263)
 *   notify.claim_email_batch (:581-594) limit 1..100 else error (:587); PENDING EMAIL rows with attempts < 5, oldest first,
 *                                 attempts + 1; returns id, recipient_id, template_code, deep_link, attempts only (:582, :593)
 *   notify.record_email_delivery (:598-617) only a claimed PENDING EMAIL row (:606-608); SENT, or FAILED at attempts ≥ 5,
 *                                 else PENDING (:609); audit NOTIFICATION_DELIVERY ADMIN SUCCESS|FAILURE {template_code,
 *                                 status, attempts} (:612-614)
 *   api.mark_notification_read (:490-507) own IN_APP row only, else NOT_FOUND; idempotent; audit NOTIFICATION_READ (:504)
 *   notify.emit_due_reminders (:620-638) defence responses due within two days; idempotent per notice ('defence-due:'||id)
 *
 * Deliberate, documented extensions (each is a GAP the platform does not provide — see docs/V13-11):
 *   GAP-OUT-01 enqueue returns {inserted, id, reason}; the SQL function returns void, so a caller cannot link a lifecycle
 *              record to its outbox row nor learn why nothing was queued (inactive recipient, rule off, duplicate).
 *   GAP-OUT-02 registerTemplate(): V13 notification types beyond the 14 seeded codes need a migration (notify.template rows).
 *   GAP-OUT-03 there is no cancel / withdraw for a queued row (protect_outbox forbids changing facts; status has no
 *              CANCELLED value) — the lifecycle suppresses dispatch instead, and the row stays PENDING.
 *   GAP-OUT-04 SENT means "the sender adapter returned true" (stub); there is no bounce / DSN / acknowledgement column.
 * Ported to strict TypeScript from the V13 reference (src/lifecycle/adapters/notifyOutbox.js); behaviour unchanged.
 */
import {
  deepFreeze,
  clone,
  defaultClock,
  defaultIds,
  UUID,
  type DeepReadonly,
} from "@/lib/notifications/lifecycle/util";
import { parseInstant } from "@/lib/notifications/lifecycle/idempotency";
import type {
  AuditCategory,
  AuditLedgerPort,
  AuditOutcome,
  Channel,
  ClaimedRow,
  EnqueueInput,
  EnqueueResult,
  NotifyOutboxPort,
  OutboxRow,
  OutboxStatus,
  Payload,
} from "@/lib/notifications/lifecycle/ports";

export const OUTBOX_STATUSES = Object.freeze(["PENDING", "SENT", "FAILED"] as const); // 1920:118
export const CHANNELS = Object.freeze(["IN_APP", "EMAIL"] as const); // 1920:111
export const OBJECT_TYPES = Object.freeze([
  "COMMITTEE",
  "MEETING",
  "MINUTES",
  "LEGAL_REVIEW",
  "DEFENCE_NOTICE",
  "GRIEVANCE",
] as const); // 1920:38-39
export type OutboxObjectType = (typeof OBJECT_TYPES)[number];
export const MAX_ATTEMPTS = 5; // 1920:119, :591, :609
export const OUTBOX_COLUMNS = Object.freeze([
  "id",
  "recipient_id",
  "template_code",
  "channel",
  "object_type",
  "object_id",
  "deep_link",
  "dedupe_key",
  "status",
  "attempts",
  "created_at",
  "delivered_at",
  "read_at",
] as const); // 1920:107-126

export interface OutboxTemplate {
  readonly code: string;
  readonly object_type: string;
  readonly is_mandatory: boolean;
  readonly gap?: "GAP-OUT-02";
}

/** The 14 seeded templates (1920:46-60): code, object type, mandatory. Wording lives in packages/i18n, never here. */
export const PLATFORM_TEMPLATES: readonly OutboxTemplate[] = Object.freeze(
  (
    [
      ["COMMITTEE_SEAT_ASSIGNED", "COMMITTEE", false],
      ["COMMITTEE_SEAT_ENDED", "COMMITTEE", false],
      ["MEETING_INVITATION", "MEETING", true],
      ["MEETING_CANCELLED", "MEETING", false],
      ["MINUTES_REVIEW_REQUESTED", "MINUTES", true],
      ["MINUTES_REVIEW_REMINDER", "MINUTES", true],
      ["LEGAL_REVIEW_ASSIGNED", "LEGAL_REVIEW", true],
      ["DEFENCE_NOTICE_ISSUED", "DEFENCE_NOTICE", true],
      ["DEFENCE_DUE_REMINDER", "DEFENCE_NOTICE", true],
      ["GRIEVANCE_RECEIVED", "GRIEVANCE", false],
      ["GRIEVANCE_ADMISSIBILITY_DECIDED", "GRIEVANCE", true],
      ["GRIEVANCE_OUTCOME_RECORDED", "GRIEVANCE", true],
      ["GRIEVANCE_AUTHORITY_APPROVAL_NEEDED", "GRIEVANCE", true],
      ["GRIEVANCE_HANDLING_APPROVED", "GRIEVANCE", true],
    ] as const
  ).map(([code, object_type, is_mandatory]) => Object.freeze({ code, object_type, is_mandatory })),
);

const TEMPLATE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/; // 1920:37
const DEEP_LINK = /^(\/[a-z0-9-]+)+$/; // 1920:116; packages/application/src/notifications.ts:47
const DEDUPE = /^[a-z0-9][a-z0-9:-]{2,199}$/;
const ENQUEUE_KEYS = new Set([
  "template_code",
  "recipient_id",
  "object_type",
  "object_id",
  "channel",
  "dedupe",
]);

export class OutboxError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OutboxError";
    this.code = code;
  }
}

const DEEP_LINK_PREFIX: Readonly<Record<string, string>> = {
  COMMITTEE: "/committees/",
  MEETING: "/meetings/",
  MINUTES: "/minutes/",
  LEGAL_REVIEW: "/legal-reviews/",
  DEFENCE_NOTICE: "/my-defence/",
  GRIEVANCE: "/grievances/",
};

/** notify.deep_link (1920:202-215): ids only; null for an object type it does not know. */
export function deepLink(objectType: unknown, objectId: unknown): string | null {
  const prefix = Object.hasOwn(DEEP_LINK_PREFIX, String(objectType))
    ? DEEP_LINK_PREFIX[String(objectType)]
    : undefined;
  return prefix ? `${prefix}${String(objectId)}` : null;
}

export interface OutboxUser {
  status?: string;
  [key: string]: unknown;
}

export interface NotifyOutboxOptions {
  clock?: () => string;
  ids?: () => string;
  users?: Readonly<Record<string, OutboxUser>>;
  audit?: Pick<AuditLedgerPort, "append"> | null;
}

/** What enqueue reads (read defensively: callers may pass anything; unknown keys are refused). */
export interface EnqueueRequest {
  template_code?: unknown;
  recipient_id?: unknown;
  object_type?: unknown;
  object_id?: unknown;
  channel?: unknown;
  dedupe?: unknown;
  [key: string]: unknown;
}

export interface DueNotice {
  notice_id: string;
  recipient_id: string;
  status: string;
  due_at: string;
}

export interface NotifyOutbox extends NotifyOutboxPort {
  readonly kind: "mock-notify-outbox";
  enqueue(input: EnqueueInput | EnqueueRequest): EnqueueResult;
  enqueueAllChannels(input: {
    template_code: string;
    recipient_id: string | null;
    object_id: string;
    dedupe: string;
  }): EnqueueResult[];
  markRead(id: string, actorId: string): void;
  emitDueReminders(notices: readonly DueNotice[] | null | undefined, nowIso?: string): number;
  deepLink: typeof deepLink;
  delivers(code: string, channel: string, userId: string): boolean;
  setPreference(userId: string, code: string, channel: unknown, muted: unknown): void;
  setEventRule(code: string, channel: unknown, enabled: unknown): void;
  registerTemplate(t: { code?: string; object_type?: unknown; is_mandatory?: unknown }): void;
  template(code: string): OutboxTemplate | null;
  listForRecipient(userId: string): DeepReadonly<OutboxRow>[];
  rows(): DeepReadonly<OutboxRow>[];
  update(...args: unknown[]): never;
  delete(...args: unknown[]): never;
}

export function createNotifyOutbox({
  clock = defaultClock,
  ids = defaultIds,
  users = {},
  audit = null,
}: NotifyOutboxOptions = {}): NotifyOutbox {
  const templates = new Map<string, OutboxTemplate>(PLATFORM_TEMPLATES.map((t) => [t.code, t]));
  const eventRules = new Map<string, boolean>(); // `${code}:${channel}` → enabled (EVENT_RULE layer)
  const mutes = new Set<string>(); // `${user}:${code}:${channel}`
  const rows: OutboxRow[] = []; // internal, mutable only through the functions below
  const byId = new Map<string, OutboxRow>();
  const byDedupe = new Map<string, OutboxRow>();
  const directory = new Map<string, OutboxUser>(Object.entries(users));

  function auditRecord(
    type: string,
    category: AuditCategory,
    outcome: AuditOutcome,
    objectId: string,
    payload: Payload,
  ): void {
    if (!audit) return;
    audit.append(
      {
        type,
        occurred_at: clock(),
        object: { type: "NOTIFICATION_OUTBOX", id: objectId },
        actor: { capacity: "SYSTEM", id: "cdf_bff" },
        provenance: { source: "SYNTHETIC_DEMO", ref: "mock notify.outbox" },
        payload,
      },
      { category, outcome },
    );
  }

  function assertRowInvariants(r: OutboxRow): void {
    if (!(OUTBOX_STATUSES as readonly unknown[]).includes(r.status))
      throw new OutboxError("CHECK_VIOLATION", "status");
    if (!(Number.isInteger(r.attempts) && r.attempts >= 0 && r.attempts <= MAX_ATTEMPTS))
      throw new OutboxError("CHECK_VIOLATION", "attempts"); // :119
    if ((r.status === "SENT") !== (r.delivered_at !== null))
      throw new OutboxError("CHECK_VIOLATION", "sent/delivered_at"); // :123
    if (!(r.read_at === null || r.channel === "IN_APP")) throw new OutboxError("CHECK_VIOLATION", "read_at"); // :124
    if (!(r.channel === "EMAIL" || r.status === "SENT"))
      throw new OutboxError("CHECK_VIOLATION", "in-app status"); // :125
  }

  const snapshot = (r: OutboxRow): DeepReadonly<OutboxRow> => deepFreeze(clone(r));

  function delivers(code: string, channel: string, userId: string): boolean {
    const t = templates.get(code);
    if (!t) return false;
    if (t.is_mandatory) return true; // SYSTEM_MANDATORY always delivers (:231)
    const key = `${code}:${channel}`;
    const enabled = eventRules.has(key) ? eventRules.get(key) : channel === "IN_APP"; // :91-94
    if (!enabled) return false;
    return !mutes.has(`${userId}:${code}:${channel}`); // :234-236
  }

  /** notify.enqueue for one channel (the SQL function loops both channels, :256; see enqueueAllChannels). */
  function enqueue(raw: EnqueueInput | EnqueueRequest): EnqueueResult {
    const input = raw as EnqueueRequest;
    if (!input || typeof input !== "object") throw new OutboxError("INVALID", "enqueue input required");
    const extra = Object.keys(input).filter((k) => !ENQUEUE_KEYS.has(k));
    if (extra.length) {
      // The SQL signature has no content parameter at all (:242-244); the outbox never stores content (§39, N18).
      throw new OutboxError(
        "CONTENT_NOT_ALLOWED",
        `notify.outbox stores no content; refused field(s): ${extra.join(", ")}`,
      );
    }
    const { template_code, recipient_id, object_type, object_id, channel, dedupe } = input;
    if (recipient_id === null || recipient_id === undefined)
      return { inserted: false, id: null, reason: "NO_RECIPIENT" }; // :253
    if (typeof recipient_id !== "string" || !UUID.test(recipient_id))
      throw new OutboxError("INVALID", "recipient_id must be a uuid"); // :109
    if (directory.get(recipient_id)?.status !== "ACTIVE")
      return { inserted: false, id: null, reason: "RECIPIENT_NOT_ACTIVE" }; // :254
    const t = typeof template_code === "string" ? templates.get(template_code) : undefined;
    if (!t) throw new OutboxError("UNKNOWN_TEMPLATE", "template code not in notify.template"); // :255 (into strict)
    if (object_type !== undefined && object_type !== t.object_type) {
      throw new OutboxError("OBJECT_TYPE_MISMATCH", "object type is taken from the template"); // :255, :260
    }
    if (typeof object_id !== "string" || !UUID.test(object_id))
      throw new OutboxError("INVALID", "object_id must be a uuid"); // :114
    if (!(CHANNELS as readonly unknown[]).includes(channel))
      throw new OutboxError("INVALID", "channel must be IN_APP or EMAIL"); // :111
    const ch = channel as Channel;
    if (typeof dedupe !== "string" || !DEDUPE.test(dedupe))
      throw new OutboxError("INVALID", "dedupe must be an ids-only key");
    if (!delivers(t.code, ch, recipient_id))
      return { inserted: false, id: null, reason: "RULE_NOT_DELIVERING" }; // :257
    const link = deepLink(t.object_type, object_id);
    if (link === null || !DEEP_LINK.test(link) || link.length > 200)
      throw new OutboxError("CHECK_VIOLATION", "deep_link"); // :116
    const dedupe_key = `${dedupe}:${recipient_id}:${ch}`; // :261
    if (dedupe_key.length > 300) throw new OutboxError("CHECK_VIOLATION", "dedupe_key length"); // :117
    if (byDedupe.has(dedupe_key)) return { inserted: false, id: null, reason: "DUPLICATE_DEDUPE_KEY" }; // :264
    const now = clock();
    const row: OutboxRow = {
      id: ids(),
      recipient_id,
      template_code: t.code,
      channel: ch,
      object_type: t.object_type,
      object_id,
      deep_link: link,
      dedupe_key,
      status: ch === "IN_APP" ? "SENT" : "PENDING", // :262
      attempts: 0,
      created_at: now,
      delivered_at: ch === "IN_APP" ? now : null, // :263
      read_at: null,
    };
    assertRowInvariants(row);
    rows.push(row);
    byId.set(row.id, row);
    byDedupe.set(dedupe_key, row);
    return { inserted: true, id: row.id, status: row.status, channel: ch }; // GAP-OUT-01: the SQL function returns void
  }

  /** notify.enqueue as the SQL function behaves: every channel the rules deliver (:256-266). */
  function enqueueAllChannels({
    template_code,
    recipient_id,
    object_id,
    dedupe,
  }: {
    template_code: string;
    recipient_id: string | null;
    object_id: string;
    dedupe: string;
  }): EnqueueResult[] {
    return CHANNELS.map((channel) => enqueue({ template_code, recipient_id, object_id, channel, dedupe }));
  }

  /** notify.claim_email_batch (:581-594). */
  function claimEmailBatch(limit: number): Readonly<ClaimedRow>[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new OutboxError("INVALID_LIMIT", "invalid limit"); // :587 (22023)
    const pending = rows
      .map((r, i): [OutboxRow, number] => [r, i])
      .filter(([r]) => r.status === "PENDING" && r.channel === "EMAIL" && r.attempts < MAX_ATTEMPTS) // :591
      .sort(([a, ia], [b, ib]) => parseInstant(a.created_at) - parseInstant(b.created_at) || ia - ib) // order by created_at (:592)
      .slice(0, limit)
      .map(([r]) => r);
    return pending.map((r) => {
      r.attempts += 1; // :589
      assertRowInvariants(r);
      return Object.freeze({
        id: r.id,
        recipient_id: r.recipient_id,
        template_code: r.template_code,
        deep_link: r.deep_link,
        attempts: r.attempts,
      }); // :593
    });
  }

  /** notify.record_email_delivery (:598-617). Returns the settled status. */
  function recordEmailDelivery(id: string, delivered: boolean): OutboxStatus {
    if (typeof delivered !== "boolean") throw new OutboxError("INVALID", "delivered must be boolean");
    const r = byId.get(id);
    if (!r || r.channel !== "EMAIL" || r.status !== "PENDING" || !(r.attempts > 0)) {
      throw new OutboxError("UNKNOWN_OR_SETTLED", "unknown or settled notification"); // :606-608 (P0002)
    }
    r.status = delivered ? "SENT" : r.attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING"; // :609
    r.delivered_at = delivered ? clock() : null; // :610
    assertRowInvariants(r);
    auditRecord("NOTIFICATION_DELIVERY", "ADMIN", delivered ? "SUCCESS" : "FAILURE", r.id, {
      template_code: r.template_code,
      status: r.status,
      attempts: r.attempts,
    }); // :612-614
    return r.status;
  }

  /** api.mark_notification_read (:490-507): only the caller's own IN_APP row; anyone else's answers NOT_FOUND. */
  function markRead(id: string, actorId: string): void {
    const r = byId.get(id);
    if (!r || r.recipient_id !== actorId || r.channel !== "IN_APP")
      throw new OutboxError("NOT_FOUND", "NOT_FOUND"); // :499-501
    if (r.read_at !== null) return; // :502
    r.read_at = clock(); // :503
    assertRowInvariants(r);
    auditRecord("NOTIFICATION_READ", "BUSINESS", "SUCCESS", r.id, { template_code: r.template_code }); // :504-505
  }

  /**
   * notify.emit_due_reminders (:620-638): defence responses due within two days, once per notice.
   * `notices` replaces the grievance.defence_notice ⨝ subject_portal_link read (:629-632): [{notice_id, recipient_id, status, due_at}].
   */
  function emitDueReminders(
    notices: readonly DueNotice[] | null | undefined,
    nowIso: string = clock(),
  ): number {
    const now = parseInstant(nowIso, "now");
    let n = 0;
    for (const notice of notices ?? []) {
      const due = parseInstant(notice.due_at, "due_at");
      if (!["ISSUED", "ACKNOWLEDGED"].includes(notice.status)) continue; // :631
      if (!(due > now && due <= now + 2 * 24 * 3600 * 1000)) continue; // :631
      const prefix = `defence-due:${notice.notice_id}:`;
      if ([...byDedupe.keys()].some((k) => k.startsWith(prefix))) continue; // :632
      enqueueAllChannels({
        template_code: "DEFENCE_DUE_REMINDER",
        recipient_id: notice.recipient_id,
        object_id: notice.notice_id,
        dedupe: `defence-due:${notice.notice_id}`,
      }); // :633
      n += 1; // :634
    }
    return n;
  }

  /** api.set_notification_preference (:510-530). */
  function setPreference(userId: string, code: string, channel: unknown, muted: unknown): void {
    const t = templates.get(code);
    if (!t) throw new OutboxError("INVALID", "template_code");
    if (!(CHANNELS as readonly unknown[]).includes(channel)) throw new OutboxError("INVALID", "channel");
    if (typeof muted !== "boolean") throw new OutboxError("INVALID", "muted");
    if (t.is_mandatory && muted) throw new OutboxError("CONFLICT", "MANDATORY_NOTIFICATION"); // :523
    const key = `${userId}:${code}:${String(channel)}`;
    if (muted) mutes.add(key);
    else mutes.delete(key);
  }

  /** EVENT_RULE layer of api.set_notification_rule (:534-570), without effective dating (mock). */
  function setEventRule(code: string, channel: unknown, enabled: unknown): void {
    if (!templates.has(code)) throw new OutboxError("INVALID", "template_code");
    if (!(CHANNELS as readonly unknown[]).includes(channel)) throw new OutboxError("INVALID", "channel");
    eventRules.set(`${code}:${String(channel)}`, Boolean(enabled));
  }

  /** GAP-OUT-02: a V13 type outside the 14 seeded templates needs a migration; the mock lets a test register one explicitly. */
  function registerTemplate({
    code,
    object_type,
    is_mandatory,
  }: {
    code?: string;
    object_type?: unknown;
    is_mandatory?: unknown;
  }): void {
    if (!TEMPLATE_CODE.test(code ?? "")) throw new OutboxError("INVALID", "template code"); // :37
    if (!(OBJECT_TYPES as readonly unknown[]).includes(object_type))
      throw new OutboxError("INVALID", "object_type"); // :38-39
    const c = code as string;
    if (templates.has(c)) throw new OutboxError("DUPLICATE", "template exists");
    templates.set(
      c,
      Object.freeze({
        code: c,
        object_type: object_type as string,
        is_mandatory: Boolean(is_mandatory),
        gap: "GAP-OUT-02" as const,
      }),
    );
  }

  const refuseDelete = (): never => {
    throw new OutboxError("IMMUTABLE", "notify.outbox rows cannot be deleted"); // :141
  };
  const refuseUpdate = (): never => {
    throw new OutboxError("IMMUTABLE", "notify.outbox facts are immutable"); // :148
  };

  return Object.freeze({
    kind: "mock-notify-outbox" as const,
    MAX_ATTEMPTS,
    enqueue,
    enqueueAllChannels,
    claimEmailBatch,
    recordEmailDelivery,
    markRead,
    emitDueReminders,
    deepLink,
    delivers,
    setPreference,
    setEventRule,
    registerTemplate,
    template: (code: string) => templates.get(code) ?? null,
    /** Server-side read of one row (the BFF role sees rows; clients never do). Frozen copy. */
    getRow: (id: string) => {
      const r = byId.get(id);
      return r ? snapshot(r) : null;
    },
    /** outbox_read policy (:195-196): a user's own IN_APP rows only. */
    listForRecipient: (userId: string) =>
      rows.filter((r) => r.recipient_id === userId && r.channel === "IN_APP").map(snapshot),
    rows: () => rows.map(snapshot),
    update: refuseUpdate,
    delete: refuseDelete,
  });
}
