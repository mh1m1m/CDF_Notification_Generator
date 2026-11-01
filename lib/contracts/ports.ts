// Ports: the interfaces the application layer depends on. Implementations live outside lib/contracts.
import { z } from "zod";
import type { CaseHeader, CaseListFilter, CaseListPage } from "./case-summary";
import {
  CaseIdSchema,
  CorrelationIdSchema,
  PersonaIdSchema,
  UuidSchema,
  type CaseId,
  type CorrelationId,
} from "./ids";
import type { RequestIdentity } from "./identity";
import { WorkspaceIdSchema } from "./workspaces";

/**
 * A source of cases.
 *
 * Every implementation must honour this contract:
 * - Authorisation is applied inside the adapter on every call (database RLS for SQL adapters), before any
 *   filtering, ordering, counting or paging, so unauthorised cases never influence a result.
 * - `getCase` and `openCase` resolve to `null` both when the case does not exist and when the identity may not see it. Callers
 *   cannot tell the two apart: same value, no distinct error, no distinct log line visible to the user.
 * - Restricted cases (`is_restricted`) are returned only to identities the source authorises for them explicitly.
 * - Results carry nothing beyond `CaseSummary`, plus the caller's own capacity in `CaseHeader` (no narratives,
 *   evidence or reporter identity).
 *
 * PRODUCTION_SUBSTITUTION_REQUIRED: the prototype adapter reads synthetic rows from schema cdf_notifications_v13
 * (and synthetic mirrors of other systems). Production adapters call the CDF case system of record through the
 * ASP.NET Core API on Alibaba Cloud Riyadh.
 */
export interface CaseSourceAdapter {
  /** Upper-snake code identifying this source; equals `CaseSummary.source_system` of what it returns. */
  readonly sourceSystem: string;
  /**
   * One authorised page. Refusal of a cursor: a `filter.cursor` the adapter did not issue, or that does not decode,
   * throws InvalidCursorError (lib/contracts/cursor.ts) before any read.
   */
  listCases(identity: RequestIdentity, filter: CaseListFilter): Promise<CaseListPage>;
  /** The case header: the summary plus the identity's own capacity on the case (null when it holds none). */
  getCase(identity: RequestIdentity, caseId: CaseId): Promise<CaseHeader | null>;
  /**
   * Opening a case (V13-FE-017, DB-023): records that the identity opened the case, then reads the header, both in one
   * transaction, so the header is never shown without its access record. The same `null` as `getCase` for an unknown
   * or unauthorised case (a refused record reads nothing). A record that cannot be written throws: the case is not
   * shown. Only the route's case read (getCaseForRoute) calls it; prefetches, lists and commands never do.
   */
  openCase(identity: RequestIdentity, caseId: CaseId): Promise<CaseHeader | null>;
}

/** The current time. Inject a fixed clock in tests; never call `new Date()` inside domain rules. */
export interface ClockPort {
  now(): Date;
}

/** Identifier generation. Implementations return canonical lowercase random (version 4) UUIDs. */
export interface IdGeneratorPort {
  newUuid(): string;
  newCorrelationId(): CorrelationId;
}

/** Upper-snake action code of the ledger, e.g. SESSION_SIGNED_IN (cdf_notifications_v13.audit_event.action). */
const AUDIT_ACTION = /^[A-Z][A-Z0-9_]{2,60}$/;
/** Lower-snake entity type, e.g. "persona" or "case_record" (audit_event.entity_type). */
const ENTITY_TYPE = /^[a-z][a-z0-9_]{2,60}$/;
const METADATA_KEY = /^[a-z][a-z0-9_]{0,63}$/;
/** The ledger refuses metadata larger than 2048 bytes (audit_event.metadata check). */
const MAX_METADATA_BYTES = 2048;

/**
 * One audit event, shaped like a row of the database ledger (cdf_notifications_v13.audit_event, migration 0001), which
 * is the authority. Technical metadata only: identifiers, codes, counts. Never names, case narratives, evidence
 * content, reporter identity, free-text reasons, tokens or passwords.
 */
export const AuditEventSchema = z.strictObject({
  event_id: UuidSchema,
  occurred_at: z.iso.datetime({ offset: true }),
  /** Null only for events outside a request (for example seeding). */
  correlation_id: CorrelationIdSchema.nullable(),
  /** Null for events before a persona is known (for example a refused sign-in). */
  actor_persona_id: PersonaIdSchema.nullable(),
  workspace_id: WorkspaceIdSchema.nullable(),
  action: z.string().regex(AUDIT_ACTION),
  entity_type: z.string().regex(ENTITY_TYPE),
  entity_id: UuidSchema.nullable(),
  case_id: CaseIdSchema.nullable(),
  metadata: z
    .record(z.string().regex(METADATA_KEY), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
    .refine((m) => Object.keys(m).length <= 20, "at most 20 metadata entries")
    .refine(
      (m) => new TextEncoder().encode(JSON.stringify(m)).byteLength <= MAX_METADATA_BYTES,
      `metadata must stay under ${MAX_METADATA_BYTES} bytes`,
    )
    .default({}),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * Append-only audit sink. `record` must be durable before the command it audits commits (SQL sinks write in the
 * command's own transaction); a failure to record fails the command.
 *
 * PRODUCTION_SUBSTITUTION_REQUIRED: the prototype sink is the hash-chained ledger cdf_notifications_v13.audit_event
 * (written by database commands through _append_audit). Production writes to the CDF append-only audit ledger on RDS
 * PostgreSQL and forwards to SLS/SIEM.
 */
export interface AuditSinkPort {
  record(event: AuditEvent): Promise<void>;
}
