// StatusBadge — the epistemic rule (DESIGN_SYSTEM.md §3.1): the certainty shown never exceeds the certainty of the
// source. The props are a union on `epistemic`, so a recorded badge cannot be written without the recorded event that
// set it. The four variants differ without colour, each from every other in at least two of glyph, outline, fill and
// words. Attributes read by QA's Procedural Truth Inspector (ADR-013): data-epistemic, data-status-kind, data-status,
// and data-event-id exactly when recorded.
//
// Runtime guards, for callers outside the type system: a recorded badge without an event id, a non-recorded badge
// whose status claims something happened (inspector rule T5) or whose label uses "recorded/completed" words, renders
// nothing and logs a warning without content.
import { formatDateTime } from "@/components/format";
import { COMPLETED_CLASS_STATUSES } from "@/lib/domain";
import type { Locale, MessageKey, Translator } from "@/lib/i18n";

/** The status domain: procedure, task, meeting, decision, notification, … (PROC's lib/domain). */
export type StatusKind = string;
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const LAYER_A_STATES = [
  "COMPLETED",
  "IN_PROGRESS",
  "PENDING",
  "SUSPENDED",
  "RETURNED",
  "CANCELLED",
  "FAILED",
  "NOT_APPLICABLE",
] as const;
export type LayerAState = (typeof LAYER_A_STATES)[number];

/** Layer A glyphs (V13 epistemic.js). Status glyphs never mirror in RTL. */
const LAYER_A_GLYPH: Readonly<Record<LayerAState, string>> = {
  COMPLETED: "✔",
  IN_PROGRESS: "●",
  PENDING: "○",
  SUSPENDED: "⏸",
  RETURNED: "↩",
  CANCELLED: "✕",
  FAILED: "⚠",
  NOT_APPLICABLE: "—",
};
const LAYER_A_TONE: Readonly<Record<LayerAState, Tone>> = {
  COMPLETED: "success",
  IN_PROGRESS: "info",
  PENDING: "neutral",
  SUSPENDED: "warning",
  RETURNED: "warning",
  CANCELLED: "neutral",
  FAILED: "danger",
  NOT_APPLICABLE: "neutral",
};
/** Message keys of the Layer A labels, for pages that show a Layer A state without a domain label. */
export const LAYER_A_LABEL_KEYS: Readonly<Record<LayerAState, MessageKey>> = {
  COMPLETED: "common.layerA.completed",
  IN_PROGRESS: "common.layerA.inProgress",
  PENDING: "common.layerA.pending",
  SUSPENDED: "common.layerA.suspended",
  RETURNED: "common.layerA.returned",
  CANCELLED: "common.layerA.cancelled",
  FAILED: "common.layerA.failed",
  NOT_APPLICABLE: "common.layerA.notApplicable",
};
const UNKNOWN_GLYPH = "▪";
const PROJECTED_GLYPH = "◇";
const STAMP_GLYPH = "⎘";

/**
 * Statuses that claim something has happened; they are shown only from a recorded event. The list is the domain's
 * (lib/domain COMPLETED_CLASS_STATUSES), the same one the Procedural Truth Inspector uses for rule T5.
 */
export const COMPLETED_CLASS: ReadonlySet<string> = new Set(COMPLETED_CLASS_STATUSES);

interface BadgeCore {
  statusKind: StatusKind;
  /** Status code, e.g. a Layer A state or the domain's own code. */
  status: string;
  /** Localised status label. */
  label: string;
}

export interface RecordedBadge extends BadgeCore {
  epistemic: "recorded";
  /** The recorded event that set this status, in the same case. */
  evidence: { eventId: string; recordedAt: string };
  /** Domain tone from the status kind's registry; Layer A states have a default, unknown codes are neutral. */
  tone?: Tone;
}
export interface ExpectedBadge extends BadgeCore {
  epistemic: "expected";
}
export interface ConditionalBadge extends BadgeCore {
  epistemic: "conditional";
  /** Localised condition, e.g. "قرار اللجنة". */
  condition: string;
}
export interface AwaitingApprovalBadge extends BadgeCore {
  epistemic: "awaiting_approval";
  /** Localised approver role. */
  approver?: string;
}

export type StatusBadgeVariant = RecordedBadge | ExpectedBadge | ConditionalBadge | AwaitingApprovalBadge;
export type ProjectedBadge = ExpectedBadge | ConditionalBadge | AwaitingApprovalBadge;
export type StatusBadgeProps = StatusBadgeVariant & { t: Translator; locale: Locale; testId?: string };

const ARABIC_MARKS = /[ً-ْٰـ]/g;
/** Words that state a completed fact (V13 LAYER_B_FORBIDDEN_WORDS, plus their English counterparts). */
const FORBIDDEN_WORD = /(^|[\s(:،,—-])(سجل|مسجل|اكتمل|تم)($|[\s).:،,—-])|\b(recorded|completed|done)\b/i;
const FORBIDDEN_GLYPH = /[✔●]/;

/** True when a projected (non-recorded) text claims a completed fact. */
export function claimsCompletion(text: string): boolean {
  return FORBIDDEN_GLYPH.test(text) || FORBIDDEN_WORD.test(text.replace(ARABIC_MARKS, ""));
}

/** Screen-reader addition, separated from the visible words. */
const aside = (text: string) => ` — ${text}`;

function refuse(reason: string): null {
  console.warn(`StatusBadge refused: ${reason}`);
  return null;
}

function isLayerA(status: string): status is LayerAState {
  return (LAYER_A_STATES as readonly string[]).includes(status);
}

export function StatusBadge(props: StatusBadgeProps) {
  const { t, locale, statusKind, status, label, testId } = props;
  const common = {
    "data-testid": testId,
    "data-epistemic": props.epistemic,
    "data-status-kind": statusKind,
    "data-status": status,
  };

  if (props.epistemic === "recorded") {
    const eventId = (props as Partial<RecordedBadge>).evidence?.eventId;
    if (!eventId) return refuse("recorded badge without an event id");
    const tone = props.tone ?? (isLayerA(status) ? LAYER_A_TONE[status] : "neutral");
    const glyph = isLayerA(status) ? LAYER_A_GLYPH[status] : UNKNOWN_GLYPH;
    return (
      <span
        {...common}
        data-event-id={eventId}
        className={`v13-badge v13-badge-recorded v13-tone-${tone}${status === "IN_PROGRESS" ? " v13-badge-strong" : ""}`}
      >
        <span aria-hidden="true" className="v13-badge-glyph">
          {glyph}
        </span>
        <span>{label}</span>
        <span className="v13-sr-only">
          {aside(
            t("common.epistemic.recordedAria", { time: formatDateTime(locale, props.evidence.recordedAt) }),
          )}
        </span>
      </span>
    );
  }

  if (COMPLETED_CLASS.has(status)) return refuse(`${props.epistemic} badge with a completed-class status`);
  const words = props.epistemic === "conditional" ? `${label} ${props.condition}` : label;
  if (claimsCompletion(words)) return refuse(`${props.epistemic} badge whose text claims completion`);

  if (props.epistemic === "expected") {
    return (
      <span {...common} className="v13-badge v13-badge-expected">
        <span aria-hidden="true" className="v13-badge-glyph">
          {PROJECTED_GLYPH}
        </span>
        <span>{[label, t("common.epistemic.expectedSuffix")].join(" ")}</span>
        <span className="v13-sr-only">{aside(t("common.epistemic.expectedAria"))}</span>
      </span>
    );
  }

  if (props.epistemic === "conditional") {
    return (
      <span {...common} className="v13-badge v13-badge-conditional">
        <span aria-hidden="true" className="v13-badge-glyph">
          {PROJECTED_GLYPH}
        </span>
        <span>
          {[
            t("common.epistemic.conditionalPrefix"),
            label,
            "—",
            t("common.epistemic.conditionalJoin", { condition: props.condition }),
          ].join(" ")}
        </span>
        <span className="v13-sr-only">{aside(t("common.epistemic.conditionalAria"))}</span>
      </span>
    );
  }

  return (
    <span {...common} className="v13-badge v13-badge-awaiting">
      <span aria-hidden="true" className="v13-badge-glyph">
        {PROJECTED_GLYPH}
        {STAMP_GLYPH}
      </span>
      <span>{[label, t("common.epistemic.awaitingSuffix")].join(" ")}</span>
      {props.approver ? (
        <span className="v13-sr-only">
          {aside(t("common.epistemic.awaitingApprover", { approver: props.approver }))}
        </span>
      ) : null}
      <span className="v13-sr-only">{aside(t("common.epistemic.awaitingAria"))}</span>
    </span>
  );
}
