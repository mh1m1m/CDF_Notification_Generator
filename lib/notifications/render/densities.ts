import "server-only";
/**
 * CDF Notifications V13 — densities (charter §11). W-D2. SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
 * Density never substitutes for authorization: the disclosure projection runs first; a density only SELECTS among the
 * components (and the parts of a component) whose content survived the projection. It never adds a field.
 * Order inside every output (owner directive / G6): identity → core message → required action → procedure status → details → help.
 */
export const DENSITIES = Object.freeze(["COMPACT", "STANDARD", "ADVANCED"] as const);
export type Density = (typeof DENSITIES)[number];

export const GROUPS = Object.freeze([
  ["identity", ["NotificationHeader", "ClassificationBadge"]],
  ["core", ["EventSummary", "ExceptionWarning"]],
  ["action", ["SmartNextActionCard", "DeadlineIndicator", "SecureActionLink"]],
  [
    "status",
    ["SimplifiedView", "ProceduralStatusCard", "JourneySummary", "ActualProgress", "ExpectedProcess"],
  ],
  ["details", ["EvidenceReference", "DecisionRightsIndicator", "DeliveryStatus", "AuditReference"]],
  ["help", ["ConfidentialityNotice", "ContextualHelp"]],
] as const);
export type GroupName = (typeof GROUPS)[number][0];
export type ComponentName = (typeof GROUPS)[number][1][number];
export const COMPONENT_NAMES: readonly ComponentName[] = Object.freeze(GROUPS.flatMap(([, c]) => c));
export const ORDER: readonly ComponentName[] = COMPONENT_NAMES;
export const GROUP_OF = Object.freeze(
  Object.fromEntries(GROUPS.flatMap(([g, cs]) => cs.map((c) => [c, g]))),
) as Readonly<Record<ComponentName, GroupName>>;

type DensityFlags = Readonly<Record<Density, boolean>>;
const ALL: DensityFlags = { COMPACT: true, STANDARD: true, ADVANCED: true };
const STD_ADV: DensityFlags = { COMPACT: false, STANDARD: true, ADVANCED: true };
const ADV: DensityFlags = { COMPACT: false, STANDARD: false, ADVANCED: true };
/** component × density (true = may render when its content is present and allowed) */
export const MATRIX: Readonly<Record<ComponentName, DensityFlags>> = Object.freeze({
  NotificationHeader: ALL,
  ClassificationBadge: ALL,
  EventSummary: ALL,
  ExceptionWarning: ALL,
  SmartNextActionCard: ALL,
  DeadlineIndicator: ALL,
  SecureActionLink: ALL,
  SimplifiedView: { COMPACT: true, STANDARD: false, ADVANCED: false },
  ProceduralStatusCard: STD_ADV,
  JourneySummary: STD_ADV,
  ActualProgress: STD_ADV,
  ExpectedProcess: STD_ADV,
  EvidenceReference: ADV,
  DecisionRightsIndicator: ADV,
  DeliveryStatus: ADV,
  AuditReference: ADV,
  ConfidentialityNotice: ALL,
  ContextualHelp: ALL,
});
/** what each density adds inside a component (documentation + used by components.ts) */
export const DEPTH = Object.freeze({
  COMPACT: { journey: "one line per allowed level (SimplifiedView)", steps: "current step only" },
  STANDARD: {
    journey: "the five stages of the journey, one line each",
    steps: "current stage: recorded steps + its expected steps",
  },
  ADVANCED: {
    journey: "five stages + structure + closure scope",
    steps: "every stage: all recorded steps + all expected steps",
  },
});
/** default density per recipient class (W-F V13-07 §3/§4 recipient matrix; used by the demo; any density may be requested) */
export const DEFAULT_DENSITY: Readonly<Record<string, Density>> = Object.freeze({
  SECRETARY: "ADVANCED",
  CHAIR: "ADVANCED",
  RESTRICTED_CASE_AUTHORITY: "ADVANCED",
  MEMBER: "STANDARD",
  INVESTIGATOR: "STANDARD",
  LEGAL_REVIEWER: "STANDARD",
  AUTHORITY: "STANDARD",
  RECUSED_MEMBER: "COMPACT",
  REFERRING_BODY: "COMPACT",
  REPORTER: "COMPACT",
  SUBJECT: "COMPACT",
  WITNESS: "COMPACT",
  EVIDENCE_HOLDER: "COMPACT",
});

export function assertDensity(d: unknown): Density {
  if (!(DENSITIES as readonly unknown[]).includes(d)) throw new RangeError(`unknown density: ${String(d)}`);
  return d as Density;
}
/** components a density may show, in output order */
export function componentsFor(density: unknown): ComponentName[] {
  const d = assertDensity(density);
  return ORDER.filter((c) => MATRIX[c][d]);
}
