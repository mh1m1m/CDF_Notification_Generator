/**
 * Badge epistemic mapping (ADR-013 `data-epistemic`; Chief Architect rulings 28 Oct 2026 01:54 and 02:00 UTC).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * The domain keeps the reference package's seven epistemic classes. A status badge, timeline entry or progress mark
 * carries one of four DOM values; this module is the only mapping between them, and it fails closed:
 *   RECORDED_FACT               → recorded           (event id required)
 *   DERIVED_FROM_VERIFIED_FACTS → recorded           (only when the shown status is exactly what the fold of the
 *                                                     case's own recorded events gives; event id = the fold's source event)
 *   EXPECTED_PROCESS            → expected           (no event id)
 *   CONDITIONAL_STEP            → conditional        (no event id)
 *   SUBJECT_TO_APPROVAL (Layer A state) → awaiting_approval (no event id)
 *   PROPOSED_ACTION, UNVERIFIED_INFORMATION, NOT_APPLICABLE → refused: never a badge.
 * Counts, percentages and forecasts are never badges (plain text with `data-count`); they never reach this function.
 * A badge that is not `recorded` never shows a completed-class status (QA Truth Inspector rule T5, DESIGN_SYSTEM §3.1):
 * an expected, conditional or awaiting-approval mark carries its step code or a not-yet state instead.
 */
import { EpistemicError, type EpistemicClass } from "./epistemic";
import { isNil } from "./nil";
import { statusFromEvents } from "./status";
import type { DomainEvent } from "./types";

export const BADGE_EPISTEMIC_VALUES = Object.freeze([
  "recorded",
  "expected",
  "conditional",
  "awaiting_approval",
] as const);
export type BadgeEpistemic = (typeof BADGE_EPISTEMIC_VALUES)[number];

/**
 * The completed-class statuses (Truth Inspector rule T5): only a `recorded` badge may show one of them. Exported so the
 * Inspector imports this one list instead of keeping its own copy.
 */
export const COMPLETED_CLASS_STATUSES = Object.freeze([
  "COMPLETED",
  "APPROVED",
  "SENT",
  "DELIVERED",
  "DECIDED",
  "CLOSED",
  "ADOPTED",
  // ARCH 28 Oct 03:50: every status that says something has happened is shown only from a recorded event.
  "DELIVERY_CONFIRMED",
  "MINUTES_FINAL",
  "ACCEPTED_BY_PROVIDER",
  "SUBSTANTIATED",
] as const);
export type CompletedClassStatus = (typeof COMPLETED_CLASS_STATUSES)[number];
/** A status code: upper snake case (e.g. `IN_PROGRESS`). */
export const STATUS_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
/** A catalogue journey, stage or step id (e.g. `J-DEMO-COMMITTEE/2/1`): what an expected step shows instead. */
export const STEP_CODE_PATTERN = /^J-[A-Z0-9]+(?:-[A-Z0-9]+)*(?:\/\d+){0,2}$/;
/** True when `s` is a code a badge may show: a status code or a step code. Anything else (case, spacing) is refused. */
export const isShownCode = (s: unknown): s is string =>
  typeof s === "string" && (STATUS_CODE_PATTERN.test(s) || STEP_CODE_PATTERN.test(s));
/**
 * Rule T5 match, exact and fail closed (SEC LOW note, 31 Oct): true for a completed-class code, and also for any string
 * that is not a shown code (e.g. "completed", " COMPLETED", "Completed"), so a variant spelling is never let through as
 * "not completed". Only a well-formed code outside the list returns false.
 */
export const isCompletedClassStatus = (s: unknown): boolean =>
  typeof s === "string" && (!isShownCode(s) || (COMPLETED_CLASS_STATUSES as readonly string[]).includes(s));

/** What the UI may put on a badge: `event_id` is present exactly when the value is `recorded`. */
export type BadgeEpistemicResult =
  | { readonly value: "recorded"; readonly event_id: string }
  | { readonly value: "expected" | "conditional" | "awaiting_approval"; readonly event_id: null };

/** A derived status: the object, the status the screen wants to show, and the recorded events of that one case. */
export interface Derivation {
  readonly case_id: string;
  readonly object_type: string;
  readonly object_id: string;
  readonly shown_status: string;
  readonly events: readonly DomainEvent[];
}

export type BadgeInput =
  | { readonly epistemic: "RECORDED_FACT"; readonly event_id: string }
  | { readonly epistemic: "DERIVED_FROM_VERIFIED_FACTS"; readonly derivation: Derivation }
  | {
      readonly epistemic: "EXPECTED_PROCESS" | "CONDITIONAL_STEP" | "SUBJECT_TO_APPROVAL";
      /** The status or step code the mark would show; a completed-class status is refused (rule T5). */
      readonly shown_status?: string | null;
    }
  | {
      readonly epistemic: Exclude<
        EpistemicClass,
        "RECORDED_FACT" | "DERIVED_FROM_VERIFIED_FACTS" | "EXPECTED_PROCESS" | "CONDITIONAL_STEP"
      >;
    };

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function refuse(code: string, message: string, detail: unknown = null): never {
  throw new EpistemicError(code, message, detail);
}

/** The fold's status as a string: a lifecycle status, or the recorded V8 code for CASE. */
function foldOf(d: Derivation): { status: string | null; source: string | null } {
  if (d.object_type === "CASE") {
    const f = statusFromEvents("CASE", d.object_id, d.events);
    return { status: f.code, source: f.source_event_id };
  }
  const f = statusFromEvents(d.object_type, d.object_id, d.events);
  return { status: f.status, source: f.source_event_id };
}

function fromDerivation(d: unknown): BadgeEpistemicResult {
  if (!d || typeof d !== "object") refuse("DERIVATION_REQUIRED", "a derived status needs its derivation");
  const x = d as Partial<Derivation>;
  if (
    !nonEmpty(x.case_id) ||
    !nonEmpty(x.object_type) ||
    !nonEmpty(x.object_id) ||
    !nonEmpty(x.shown_status) ||
    !Array.isArray(x.events)
  ) {
    refuse("DERIVATION_REQUIRED", "case_id, object_type, object_id, shown_status and events are required");
  }
  const der = x as Derivation;
  // Only the case's own events: an event of another case (or without a case) refuses, never silently drops.
  const foreign = der.events.filter((e) => !e || e.case_id !== der.case_id);
  if (foreign.length > 0)
    refuse("CROSS_CASE_EVENT", "a derivation rests only on the events of its own case", {
      count: foreign.length,
    });
  let fold: { status: string | null; source: string | null };
  try {
    fold = foldOf(der);
  } catch (err) {
    refuse("DERIVATION_NOT_FOLDABLE", "the recorded events do not fold under the domain tables", {
      cause: (err as { code?: string }).code ?? null,
    });
  }
  if (fold.status === null || fold.source === null)
    refuse("DERIVATION_UNSUPPORTED", "no recorded event gives this object a status");
  if (fold.status !== der.shown_status)
    refuse("DERIVATION_UNSUPPORTED", "the shown status is not what the recorded events give", {
      shown: der.shown_status,
      fold: fold.status,
    });
  return Object.freeze({ value: "recorded", event_id: fold.source });
}

/**
 * toBadgeEpistemic(input) → { value, event_id }. Throws EpistemicError (fail closed) for every input that may not be a
 * badge: a recorded fact without an event id, a derived status the fold does not produce, an event id on a value that is
 * not `recorded`, and the refused classes.
 */
export function toBadgeEpistemic(input: BadgeInput): BadgeEpistemicResult {
  const x = input as unknown;
  if (!x || typeof x !== "object") refuse("NO_BADGE_VALUE", "no epistemic class given");
  const i = x as Record<string, unknown>;
  const cls = i.epistemic;
  switch (cls) {
    case "RECORDED_FACT":
      if (!nonEmpty(i.event_id))
        refuse("EVENT_ID_REQUIRED", "a recorded badge carries the id of its recorded event");
      return Object.freeze({ value: "recorded", event_id: i.event_id });
    case "DERIVED_FROM_VERIFIED_FACTS":
      return fromDerivation(i.derivation);
    case "EXPECTED_PROCESS":
    case "CONDITIONAL_STEP":
    case "SUBJECT_TO_APPROVAL": {
      if (own(i, "event_id") && i.event_id !== null && i.event_id !== undefined) {
        refuse("EVENT_ID_NOT_ALLOWED", "only a recorded badge carries an event id", { epistemic: cls });
      }
      if (!isNil(i.shown_status) && !isShownCode(i.shown_status)) {
        refuse("SHOWN_STATUS_NOT_A_CODE", "a badge shows an upper-snake status code or a step code only", {
          epistemic: cls,
        });
      }
      if (isCompletedClassStatus(i.shown_status)) {
        refuse(
          "COMPLETED_STATUS_NOT_RECORDED",
          "only a recorded badge shows a completed-class status (rule T5)",
          {
            epistemic: cls,
            shown_status: i.shown_status,
          },
        );
      }
      const value =
        cls === "EXPECTED_PROCESS"
          ? "expected"
          : cls === "CONDITIONAL_STEP"
            ? "conditional"
            : "awaiting_approval";
      return Object.freeze({ value, event_id: null });
    }
    default:
      return refuse("NO_BADGE_VALUE", "this epistemic class is never shown as a badge (ADR-013)", {
        epistemic: typeof cls === "string" ? cls : null,
      });
  }
}
