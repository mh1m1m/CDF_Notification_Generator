/**
 * The notification documents' data-epistemic vocabulary (V13-PROC-011). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
 *
 * Every value the renderer can write into a `data-epistemic` attribute. Today the only writer is the EventSummary
 * component (lib/notifications/render/components.ts). It writes:
 * - GENERALIZED when the projection generalised the event summary (a disclosure marker, not a certainty class);
 * - otherwise the event summary's own class, which must be one of the charter §3.5 classes (RECORDED_FACT when none
 *   is given);
 * - UNVERIFIED_INFORMATION for any other declared value (fail closed: an unknown class never claims a recorded fact).
 *
 * Consumers (QA's Truth Inspector rule set for the preview frame) import this list and never copy it (ADR-016 §2). The
 * module is plain data with no `server-only` marker, so a test or a browser-side rule set can import it. The seven
 * certainty classes are the charter's list (`EPISTEMIC_CLASSES` in lib/domain/epistemic.ts, which is server-only); a
 * unit test pins the two lists together.
 */
export const DATA_EPISTEMIC_VALUES = Object.freeze([
  "RECORDED_FACT",
  "DERIVED_FROM_VERIFIED_FACTS",
  "EXPECTED_PROCESS",
  "CONDITIONAL_STEP",
  "PROPOSED_ACTION",
  "UNVERIFIED_INFORMATION",
  "NOT_APPLICABLE",
  "GENERALIZED",
] as const);
export type DataEpistemic = (typeof DATA_EPISTEMIC_VALUES)[number];

/** What the renderer writes for a declared class outside the charter list. */
export const DATA_EPISTEMIC_FALLBACK = "UNVERIFIED_INFORMATION" satisfies DataEpistemic;

export const isDataEpistemic = (v: unknown): v is DataEpistemic =>
  (DATA_EPISTEMIC_VALUES as readonly unknown[]).includes(v);

/**
 * The value for an element: GENERALIZED when the projection generalised it, else the declared class when it is a
 * charter class (RECORDED_FACT when none is declared), else the fallback. A content-declared "GENERALIZED" is not a
 * charter class and falls back too: only the projection may mark a value generalised.
 */
export function dataEpistemicFor(declared: unknown, generalized: boolean): DataEpistemic {
  if (generalized) return "GENERALIZED";
  const v = declared ?? "RECORDED_FACT";
  return isDataEpistemic(v) && v !== "GENERALIZED" ? v : DATA_EPISTEMIC_FALLBACK;
}
