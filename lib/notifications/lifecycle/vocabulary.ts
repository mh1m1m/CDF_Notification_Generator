/**
 * vocabulary — pure constants and projections the lifecycle shares with its adapters (W-D1, charter §3.3, §5).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Moved here from the reference adapters (src/lifecycle/adapters/auditLedger.js#toEvent and
 * src/lifecycle/adapters/recipientResolution.js#RECIPIENT_CLASSES) so that lib code never imports a test double;
 * the fakes re-export them unchanged.
 */
import "server-only";
import type { CharterEvent } from "./ports";
import type { DeepReadonly } from "./util";

/** Charter §5 recipient classes (13). */
export const RECIPIENT_CLASSES = Object.freeze([
  "SECRETARY",
  "CHAIR",
  "MEMBER",
  "INVESTIGATOR",
  "LEGAL_REVIEWER",
  "AUTHORITY",
  "REFERRING_BODY",
  "REPORTER",
  "SUBJECT",
  "WITNESS",
  "EVIDENCE_HOLDER",
  "RECUSED_MEMBER",
  "RESTRICTED_CASE_AUTHORITY",
] as const);

export type RecipientClass = (typeof RECIPIENT_CLASSES)[number];

/** The charter §3.3 projection of a stored entry (no audit envelope, no chain fields). */
export function toEvent(entry: DeepReadonly<CharterEvent>): DeepReadonly<CharterEvent> {
  const {
    event_id,
    type,
    occurred_at,
    recorded_at,
    case_id,
    object,
    actor,
    provenance,
    version,
    causation_id,
    correlation_id,
    payload,
  } = entry;
  return {
    event_id,
    type,
    occurred_at,
    recorded_at,
    case_id,
    object,
    actor,
    provenance,
    version,
    causation_id,
    correlation_id,
    payload,
  };
}
