/**
 * PRODUCTION_SUBSTITUTION_REQUIRED: in-memory test double
 *
 * proceduralReadModel — mock read model for Domain B (procedural objects) and Domain D (their recorded event stream)
 * (W-D1, charter §2 B/D, §3.2, §3.3, §10).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Production reads the procedural tables and the audit ledger / case history through api.* under RLS. This mock replays
 * synthetic objects and synthetic event streams (charter §2 D).
 *
 * Platform objects mirrored (FACT, read-only):
 *   committee.meeting status SCHEDULED|OPEN|CLOSED|CANCELLED (20261007001890_committee_meetings_votes_minutes.sql:58)
 *   committee.vote_item status OPEN|AWAITING_CASTING_VOTE|CLOSED, result APPROVED|REJECTED|TIED|NO_DECISION|NO_QUORUM (1890:142-152)
 *   decision.legal_review_request status ASSIGNED|OPINION_GIVEN, opinion CONCURS|CONCURS_WITH_COMMENTS|CONFLICTS — an
 *     advisory opinion, not an adoption (20261007001900_recommendations_legal_review_authority.sql:182-197)
 *   decision.authority_decision outcome APPROVE_AS_RECOMMENDED|MODIFY|REJECT|RETURN_TO_COMMITTEE|APPROVE_PARTIALLY|OTHER,
 *     `check (decided_at <= recorded_at)` (1900:260-278)
 * Platform → charter MeetingStatus mapping (INFERENCE): SCHEDULED→SCHEDULED, OPEN→OPENED, CLOSED→CLOSED,
 * CANCELLED→CANCELLED; RESCHEDULED and MINUTES_* are not meeting statuses in the platform (minutes are their own table) —
 * they are derived from events here.
 * Ported to strict TypeScript from the V13 reference (src/lifecycle/adapters/proceduralReadModel.js); behaviour unchanged.
 */
import { deepFreeze, clone, UUID, type DeepReadonly } from "@/lib/notifications/lifecycle/util";
import { orderEvents } from "@/lib/notifications/lifecycle/idempotency";
import type {
  CharterEvent,
  ProceduralObject,
  ProceduralObjectView,
  ProceduralReadModelPort,
} from "@/lib/notifications/lifecycle/ports";

export const PROCEDURAL_TYPES = Object.freeze([
  "REFERRAL",
  "REPORT",
  "ALLEGATION",
  "PROCEDURE",
  "INVESTIGATION",
  "TASK",
  "MEETING",
  "HEARING",
  "BALLOT",
  "RECOMMENDATION",
  "LEGAL_OPINION",
  "DECISION",
  "IMPLEMENTATION_ACTION",
] as const); // charter §3.2

const PLATFORM_MEETING_STATUS: Readonly<Record<string, string>> = Object.freeze({
  SCHEDULED: "SCHEDULED",
  OPEN: "OPENED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
});

/** committee.meeting.status (1890:58) → charter MeetingStatus; null for anything else (fail closed). */
export function mapPlatformMeetingStatus(status: unknown): string | null {
  return Object.hasOwn(PLATFORM_MEETING_STATUS, String(status))
    ? (PLATFORM_MEETING_STATUS[String(status)] ?? null)
    : null;
}

export class ProceduralReadModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProceduralReadModelError";
    this.code = code;
  }
}

export interface ProceduralReadModelInput {
  objects?: readonly Partial<ProceduralObject>[];
  events?: readonly (Partial<CharterEvent> | DeepReadonly<CharterEvent>)[];
}

export interface ProceduralReadModel extends ProceduralReadModelPort {
  readonly kind: "mock-procedural-read-model";
}

export function createProceduralReadModel({
  objects = [],
  events = [],
}: ProceduralReadModelInput = {}): ProceduralReadModel {
  const table = new Map<unknown, ProceduralObjectView>();
  for (const o of objects) {
    if (!UUID.test(o.object_id ?? ""))
      throw new ProceduralReadModelError("INVALID_OBJECT", "object_id must be a uuid");
    if (!(PROCEDURAL_TYPES as readonly unknown[]).includes(o.type))
      throw new ProceduralReadModelError("INVALID_OBJECT", "unknown procedural type");
    table.set(o.object_id, deepFreeze({ ...clone(o as ProceduralObject), exists: true as const }));
  }
  const stream = deepFreeze(orderEvents(clone(events as readonly CharterEvent[]))); // throws on a zone-less timestamp (fail closed)
  return Object.freeze({
    kind: "mock-procedural-read-model" as const,
    getObject(objectId: unknown): ProceduralObjectView {
      if (table.has(objectId)) return table.get(objectId) as ProceduralObjectView;
      return deepFreeze({
        object_id: typeof objectId === "string" ? objectId : null,
        exists: false as const,
      });
    },
    /** Recorded events for an object and/or a case, ordered by occurred_at then recorded_at. */
    eventsFor({
      object_id,
      case_id,
    }: { object_id?: string; case_id?: string } = {}): DeepReadonly<CharterEvent>[] {
      return stream.filter(
        (e) =>
          (object_id === undefined || e.object?.id === object_id) &&
          (case_id === undefined || e.case_id === case_id),
      );
    },
  });
}
