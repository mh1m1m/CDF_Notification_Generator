/**
 * lib/domain/types.ts — CDF Notifications V13 · workstream W-A (domain model), TypeScript port.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
 *
 * Shared types of the domain model. The reference implementation (plain JavaScript) reads free-form JSON and checks it
 * fail-closed; the input shapes below are therefore permissive (optional fields, nullable values) so that a malformed
 * record still reaches the checks that report it. Catalogue shapes (frozen, built in this package) are precise.
 */

/** concepts.ts LABELS. */
export type Label = "FACT" | "INFERENCE" | "PROPOSAL" | "UNVERIFIED";
/** Charter §2 — the seven logical domains. */
export type OwnerDomain = "A" | "B" | "C" | "D" | "E" | "F" | "G";
/** Domains used by event types (A case · B procedural · F communication · G evidence and audit). */
export type EventDomain = "A" | "B" | "F" | "G";

export interface Bilingual {
  readonly ar: string;
  readonly en: string;
}

/** A reference to an object, as named by an event (`object`, `payload.target`, `payload.related[]`). */
export interface ObjectRef {
  type: string;
  id: string;
}

/** Free event payload (charter §3.3: Event.payload is free). */
export type Payload = Record<string, unknown>;

export interface EventActor {
  capacity?: string;
  id?: string;
}

export interface EventProvenance {
  source?: string;
  ref?: string;
}

/**
 * A recorded event (charter §3.3). Fields other than `event_id` and `type` are optional so that the invariant checks
 * can report a malformed event instead of failing to accept it.
 */
export interface DomainEvent {
  event_id: string;
  type: string;
  occurred_at?: string;
  recorded_at?: string;
  case_id?: string | null;
  object?: ObjectRef | null;
  actor?: EventActor | null;
  provenance?: EventProvenance | null;
  version?: number;
  causation_id?: string | null;
  correlation_id?: string | null;
  payload?: Payload | null;
}

/** A transition guard: reads the event payload only (`path` starts with `payload.`). */
export interface Guard {
  readonly path: string;
  readonly eq?: unknown;
  readonly ne?: unknown;
  readonly in?: readonly unknown[];
}

/** A row of a concept's transition table (concepts.ts `tr`). `from: null` = an initial row. */
export interface TransitionRow {
  readonly from: readonly (string | null)[] | null;
  readonly to: string;
  readonly on: readonly string[];
  readonly when: Guard | null;
  readonly label?: Label;
  readonly source?: string;
  readonly note?: string | null;
}

/** A hold row (concepts.ts `hold`; work/LEAD_notes.md L-10): the event is admitted and the status is unchanged. */
export interface HoldRow {
  readonly from: readonly (string | null)[];
  readonly on: readonly string[];
  readonly when: Guard | null;
  readonly hold: true;
  readonly label: Label;
  readonly source: string;
  readonly note?: string | null;
}
