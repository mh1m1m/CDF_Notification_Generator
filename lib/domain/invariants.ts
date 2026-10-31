/**
 * lib/domain/invariants.ts — CDF Notifications V13 · workstream W-A (domain model), TypeScript port.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
 *
 * The semantic invariants INV-01 … INV-27. Each entry: {id, ar, en, severity BLOCK|WARN, origin, related_pc, label,
 * sources, test, directive_example?, check(ctx) → {ok, detail, violations[]}}. checkAll(ctx) runs them all.
 *
 * Origin (FACT): the master execution directive (work/owner_messages_2026-10-27/master_execution_directive_en_16-08-26Z.txt)
 * §4.3 :366-375 gives ten example invariants; each is carried as `directive_example` {text, ref (file:line), label} on
 * INV-03 (:366), INV-04 (:367), INV-05 (:368), INV-07 (:369), INV-06 (:370), INV-08 (:371), INV-09 (:372),
 * INV-10 (:373), INV-20 (:374) and INV-11 (:375); :377-379 ("Create an authoritative invariant catalogue." "Every
 * invariant must have a corresponding test.") are INVARIANTS and tests/invariants.test.js INV-00c. Directive §4.1
 * :306-338 (separate status objects): INV-15 … INV-17; §4.2 :342, :356-358 (knowledge status, certainty ceiling):
 * INV-18, INV-19; §6 :517-522 (Level 1): INV-01, INV-02, INV-14; §6 :584 (alternative directions): INV-12; §7 :607,
 * :622 (actual vs expected): INV-11. The others follow from the charter sections and lead rulings (work/LEAD_notes.md)
 * named in each entry.
 *
 * The context `ctx` uses the charter contracts (§3.1 CaseRecord, §3.2 ProceduralObject, §3.3 Event, §7 next action)
 * plus shapes the charter does not define (contract gap G-01, PROPOSAL — see docs/V13-02_domain_model.md §6.2, §9):
 *   ctx = {
 *     case: CaseRecord (+ history?: [{code, recorded_at, source_event_id}], L-05) | null,
 *     objects: [ProceduralObject (+ related_objects?: [{type, id}], L-05)],          events: [Event],
 *     catalogue: {steps: {[step_id]: {kind, alternative_group, trigger_event_type, completion_event_type,
 *                 completion_payload?, completion_any_of?, trigger_any_of?, completion_target?, fail_on?}}},
 *                 // projection of charter §4 and of W-C src/journeys/catalogue_v13.json (read-only)
 *     deadline_rules: {[rule_id]: {trigger_event_type, label}},
 *     notification: NotificationRecord | null,  notification_versions: [NotificationRecord],
 *     evidence: [{entry_id, seq, notification_id, version, kind, recorded_at, data}],   // W-D1 evidence entries (L-07, D5)
 *     delivery_confirmation: 'ACCEPTANCE' (default) | 'SETTLEMENT',                     // L-07
 *     delivery_attempts: [{attempt_id, notification_id, version, channel, status, status_source_event_id}], // legacy shape
 *     progress: {l1: {code, stage, source:'CASE_RECORD', source_event_id} | null,
 *                layer_a: [{step_id, object_id, display_state, symbol?, epistemic, evidence_event_id, text}],
 *                layer_b: [{step_id, kind, symbol, epistemic, text}]},
 *   }
 *   NotificationRecord = {notification_id, version, type_code, channel?: 'EMAIL' | 'IN_APP', case_id, object,
 *     recipient: {id, class, email?}, status, status_source_event_id, corrects?: {version, reason_code}, l1,
 *     statements: [Statement], next_action (charter §7) | null, deadlines: [{kind, at, basis_event_id, basis_rule}],
 *     case_effect: 'CASE_UNCHANGED' | 'REPORTS_RECORDED_CASE_EVENT', originating_event_id?, internal_ref?, links?,
 *     _disclosure_applied}
 *   Statement = {id, about: {type, id}, asserts_event?, asserts_status?, display_state?, epistemic,
 *     evidence_event_id, source: {kind, event_id?}, actor_capacity?, text: {ar, en}}
 */
import {
  COMMUNICATION_EVENTS,
  CASE_EVENTS,
  CASE_CODE_EVENTS,
  PROCEDURAL_OBJECT_TYPES,
  EVENT_CATALOGUE,
  isKnownEventType,
  FORMAL_NOTICE_EVENTS,
  PROTECTED_EVENT_RULES,
  DELIVERY_CONFIRMATION_MODES,
  DEFAULT_DELIVERY_CONFIRMATION,
  DELIVERY_EVIDENCE_KINDS,
} from "./concepts";
import {
  STATUS_OBJECTS,
  LIFECYCLE_CONCEPTS,
  CASE_FLAGS,
  isV8Code,
  stageOf,
  eventConcerns,
  evidenceEventsInto,
  isEvidenceFree,
  transitionsOf,
  guardHolds,
  compareEvents,
  checkStatusEvidence,
  checkCaseEvidence,
  checkHistory,
  checkLineage,
  lifecycleOf,
} from "./status";
import type { CaseRecord, EvidenceEntry, FoldOptions, LineageVersion, StatusRecord } from "./status";
import {
  EPISTEMIC_CLASSES,
  LAYER_A_STATES,
  LAYER_A_STATE_IDS,
  LAYER_B_KIND_IDS,
  LAYER_B_KINDS,
  displayStateAllows,
  sourceCeiling,
  exceeds,
  carriesActualMark,
  containsCompletionWording,
  findForbiddenInference,
  PROVENANCE_CEILING,
  DIRECTIVE,
} from "./epistemic";
import type { ForbiddenInference, StatementSource } from "./epistemic";
import type { DomainEvent, Label, ObjectRef, Payload } from "./types";
import type { StatusObjectName } from "./concepts";
import { isNil } from "./nil";

// ---------------------------------------------------------------------------------------------------------------------
// Context types (contract gap G-01, PROPOSAL). Every field is optional so that a malformed context reaches the check
// that reports it (the checks are fail-closed and read free-form JSON).
// ---------------------------------------------------------------------------------------------------------------------
/** Bilingual display text as a context carries it (either side may be missing in malformed input). */
export interface LooseText {
  ar?: string | null;
  en?: string | null;
}
/** A step of a ProceduralObject (charter §3.2). */
export interface ObjectStep {
  step_id?: string;
  actual?: string | null;
  evidence_event_id?: string | null;
  epistemic?: string | null;
  display_state?: string | null;
}
/** A deadline as displayed (notification.deadlines, next_action.deadline) or carried by an object. */
export interface DeadlineRecord {
  kind?: string;
  at?: string | null;
  basis_event_id?: string | null;
  basis_rule?: string | null;
}
/** A ProceduralObject (charter §3.2) plus related_objects (L-05). */
export interface ProceduralObjectRecord extends StatusRecord {
  case_id?: string | null;
  related_objects?: readonly (ObjectRef | null)[] | null;
  steps?: readonly ObjectStep[] | null;
  deadlines?: readonly DeadlineRecord[] | null;
}
/** A catalogue pattern: an event type and an optional payload filter. */
export interface StepPattern {
  type?: string | null;
  payload?: Payload | null;
}
/** A catalogue step (projection of charter §4 and of the journey catalogue). */
export interface CatalogueStep {
  kind?: string;
  alternative_group?: string | null;
  trigger_event_type?: string | null;
  trigger_payload?: Payload | null;
  trigger_any_of?: readonly (StepPattern | null)[] | null;
  completion_event_type?: string | null;
  completion_payload?: Payload | null;
  completion_any_of?: readonly (StepPattern | null)[] | null;
  completion_target?: string | null;
  fail_on?: StepPattern | null;
}
/** A deadline rule: the event type that triggers it. */
export interface DeadlineRule {
  trigger_event_type?: string;
  label?: string;
}
/** The Level 1 display (charter §3.1). */
export interface L1Display {
  code?: string | null;
  stage?: string | null;
  source?: string | null;
  source_event_id?: string | null;
}
/** A displayed statement (contract gap G-01). */
export interface Statement {
  id?: string;
  about?: ObjectRef | null;
  asserts_event?: string | null;
  asserts_status?: string | null;
  display_state?: string | null;
  epistemic?: string | null;
  evidence_event_id?: string | null;
  source?: StatementSource | null;
  actor_capacity?: string | null;
  text?: LooseText | null;
}
/** One entry of next_action.what_next. */
export interface WhatNextItem extends LooseText {
  kind?: string;
  text?: LooseText | null;
}
/** The next action (charter §7). */
export interface NextAction {
  kind?: string;
  object?: ObjectRef | null;
  epistemic?: string | null;
  what_next?: readonly (WhatNextItem | null)[] | null;
  deadline?: DeadlineRecord | null;
}
/** The recipient of a notification. */
export interface RecipientRecord {
  id?: string | null;
  class?: string | null;
  email?: string | null;
}
/** A notification version (W-D1 record, the fields the invariants read). */
export interface NotificationRecord extends LineageVersion {
  notification_id?: string;
  type_code?: string;
  channel?: string | null;
  case_id?: string | null;
  object?: ObjectRef | null;
  recipient?: RecipientRecord | null;
  status_source_event_id?: string | null;
  l1?: L1Display | null;
  statements?: readonly Statement[] | null;
  next_action?: NextAction | null;
  deadlines?: readonly DeadlineRecord[] | null;
  case_effect?: string | null;
  originating_event_id?: string | null;
  internal_ref?: string | null;
  case_number?: string | null;
  links?: unknown;
  _disclosure_applied?: unknown;
}
/** A delivery attempt in the legacy shape. */
export interface DeliveryAttemptRecord {
  attempt_id?: string;
  notification_id?: string;
  version?: number | null;
  channel?: string;
  status?: string | null;
  status_source_event_id?: string | null;
}
/** An Actual Progress (Layer A) row. */
export interface LayerARow {
  step_id?: string;
  object_id?: string | null;
  display_state?: string | null;
  symbol?: string | null;
  epistemic?: string | null;
  evidence_event_id?: string | null;
  text?: LooseText | null;
  actual?: string | null;
}
/** An Expected Process (Layer B) row. */
export interface LayerBRow {
  step_id?: string;
  kind?: string | null;
  symbol?: string | null;
  epistemic?: string | null;
  text?: LooseText | null;
  aria?: LooseText | null;
  display_state?: string | null;
  evidence_event_id?: string | null;
}
/** The progress display. */
export interface ProgressRecord {
  l1?: L1Display | null;
  layer_a?: readonly LayerARow[] | null;
  layer_b?: readonly LayerBRow[] | null;
}
/** The context every invariant reads (see the header). */
export interface InvariantContext {
  case?: CaseRecord | null;
  objects?: readonly ProceduralObjectRecord[] | null;
  events?: readonly DomainEvent[] | null;
  catalogue?: { steps?: Readonly<Record<string, CatalogueStep>> | null } | null;
  deadline_rules?: Readonly<Record<string, DeadlineRule>> | null;
  notification?: NotificationRecord | null;
  notification_versions?: readonly (NotificationRecord | null)[] | null;
  evidence?: readonly (EvidenceEntry | null)[] | null;
  delivery_confirmation?: string | null;
  delivery_attempts?: readonly DeliveryAttemptRecord[] | null;
  progress?: ProgressRecord | null;
}
/** The result of one check. */
export interface InvariantResult {
  ok: boolean;
  detail: string;
  violations: string[];
}
export type InvariantSeverity = "BLOCK" | "WARN";
/** A directive §4.3 example carried by an invariant. */
export interface DirectiveExample {
  readonly text: string;
  readonly ref: string;
  readonly line: number;
  readonly section: "§4.3";
  readonly label: "FACT";
}
/** A catalogue entry. */
export interface Invariant {
  readonly id: string;
  readonly severity: InvariantSeverity;
  readonly origin: string;
  readonly label: Label;
  readonly related_pc: readonly string[];
  readonly ar: string;
  readonly en: string;
  readonly sources: readonly string[];
  readonly test: string;
  readonly directive_example?: DirectiveExample;
  check(ctx: InvariantContext): InvariantResult;
}
type InvariantDef = Omit<Invariant, "related_pc" | "sources" | "test"> & {
  related_pc?: readonly string[];
  sources?: readonly string[];
};
/** checkInvariant result. */
export interface CheckedInvariant extends InvariantResult {
  id: string;
  severity: InvariantSeverity;
}
/** checkAll result. */
export interface CheckAllResult {
  ok: boolean;
  results: CheckedInvariant[];
  violations: CheckedInvariant[];
  warnings: CheckedInvariant[];
}
/** checkClaim result. */
export interface ClaimCheck {
  ok: boolean;
  claim: boolean;
  detail?: string;
  ev?: DomainEvent;
  fi?: ForbiddenInference | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Context accessors and small helpers
// ---------------------------------------------------------------------------------------------------------------------
type Ctx = InvariantContext | null | undefined;
/** `list.includes(v)` for a value of any type (the reference compares free-form JSON values against fixed lists). */
const has = (list: readonly unknown[], v: unknown): boolean => list.includes(v);
const arr = <T>(x: readonly T[] | null | undefined): readonly T[] => (Array.isArray(x) ? x : []);
const evs = (ctx: Ctx): readonly DomainEvent[] => arr(ctx && ctx.events);
const evById = (ctx: Ctx, id: unknown): DomainEvent | null =>
  isNil(id) ? null : evs(ctx).find((e) => e && e.event_id === id) || null;
const objs = (ctx: Ctx): readonly ProceduralObjectRecord[] => arr(ctx && ctx.objects);
const notif = (ctx: Ctx): NotificationRecord | null => (ctx && ctx.notification) || null;
const stmts = (ctx: Ctx): readonly Statement[] => arr(notif(ctx) && notif(ctx)!.statements);
const layerA = (ctx: Ctx): readonly LayerARow[] => arr(ctx && ctx.progress && ctx.progress.layer_a);
const layerB = (ctx: Ctx): readonly LayerBRow[] => arr(ctx && ctx.progress && ctx.progress.layer_b);
const catStep = (ctx: Ctx, id: unknown): CatalogueStep | null =>
  (ctx && ctx.catalogue && ctx.catalogue.steps && ctx.catalogue.steps[id as string]) || null;
const attempts = (ctx: Ctx): readonly DeliveryAttemptRecord[] => arr(ctx && ctx.delivery_attempts);
/** W-D1 evidence entries (work/LEAD_notes.md L-07, W-D1 diagnostic D5): attempts, exports and acknowledgements are evidence, not ledger events. */
const evidenceOf = (ctx: Ctx, nid: unknown, version: number | null, kind: string | null): EvidenceEntry[] =>
  arr(ctx && ctx.evidence).filter(
    (x): x is EvidenceEntry =>
      !!x &&
      x.notification_id === nid &&
      (isNil(version) || (x.version ?? 1) === version) &&
      (!kind || x.kind === kind),
  );
const entryTime = (x: EvidenceEntry): number =>
  Date.parse(((x.data && x.data.at) ?? x.recorded_at) as string);
const entryRef = (x: EvidenceEntry): string => x.entry_id ?? `#${String(x.seq)}`;
const deliveryMode = (ctx: Ctx): string =>
  ctx && !isNil(ctx.delivery_confirmation) ? ctx.delivery_confirmation : DEFAULT_DELIVERY_CONFIRMATION;
const objId = (o: StatusRecord): string | null | undefined => o.object_id ?? o.id;
const objById = (ctx: Ctx, id: unknown): ProceduralObjectRecord | null =>
  objs(ctx).find((o) => objId(o) === id) || null;
const isIso = (s: unknown): s is string =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s) &&
  !Number.isNaN(Date.parse(s));
const result = (violations: string[], okDetail = ""): InvariantResult =>
  violations.length
    ? { ok: false, detail: violations.join("; "), violations }
    : { ok: true, detail: okDetail, violations: [] };
const ACTIVE_DISPLAY: readonly string[] = ["IN_PROGRESS", "PENDING"];
const MEETING_HELD: readonly string[] = [
  "OPENED",
  "CLOSED",
  "MINUTES_DRAFT",
  "MINUTES_UNDER_REVIEW",
  "MINUTES_FINAL",
];
/** Before dispatch. CORRECTED is the entry state of a correcting version (work/LEAD_notes.md L-04), not yet validated. */
const PRE_QUEUE: readonly string[] = [
  "DRAFT",
  "CORRECTED",
  "VALIDATED",
  "AUTHORIZATION_PENDING",
  "AUTHORIZED",
];
const DISCLOSED_STATES: readonly string[] = [
  "VALIDATED",
  "AUTHORIZATION_PENDING",
  "AUTHORIZED",
  "QUEUED",
  "SENT",
  "DELIVERY_CONFIRMED",
  "DELIVERY_FAILED",
  "SUPERSEDED",
];
/** Events recorded by one capacity for a deciding body: attribution needs payload.performed_by (INV-25). */
export const RECORDED_ON_BEHALF_EVENTS = Object.freeze([
  "AUTHORITY_DECISION_RECORDED",
  "RECOMMENDATION_ADOPTED",
  "RECOMMENDATION_NOT_ADOPTED",
  "CHAIR_DIRECTION_RECORDED",
] as const);

const claimText = (st: Statement): string =>
  (st.asserts_event ? `event ${st.asserts_event}` : `status ${String(st.asserts_status)}`) +
  ` of ${String(st.about && st.about.type)}`;

type ClaimRequirement = {
  kind: "event" | "case_code" | "invalid" | "evidence_free" | "status";
  types: readonly string[];
};
/** What a statement claims and which recorded event types may support it (null when it claims nothing). */
function claimRequirement(st: Statement): ClaimRequirement | null {
  const t = st && st.about && st.about.type;
  if (st.asserts_event) return { kind: "event", types: [st.asserts_event] };
  if (st.asserts_status === undefined || st.asserts_status === null) return null;
  if (t === "CASE")
    return isV8Code(st.asserts_status)
      ? { kind: "case_code", types: CASE_CODE_EVENTS }
      : { kind: "invalid", types: [] };
  if (!has(LIFECYCLE_CONCEPTS, t)) return { kind: "invalid", types: [] };
  const lc = lifecycleOf(t);
  if (lc === "none" || !has(STATUS_OBJECTS[lc].states, st.asserts_status))
    return { kind: "invalid", types: [] };
  if (isEvidenceFree(t, st.asserts_status)) return { kind: "evidence_free", types: [] };
  return { kind: "status", types: evidenceEventsInto(t, st.asserts_status) };
}

/** Is the statement's claim backed by a recorded event that names its object, has an allowed type and passes guards? */
export function checkClaim(ctx: InvariantContext | null | undefined, st: Statement): ClaimCheck {
  const req = claimRequirement(st);
  if (!req) return { ok: true, claim: false };
  if (req.kind === "evidence_free") return { ok: true, claim: true };
  if (req.kind === "invalid")
    return {
      ok: false,
      claim: true,
      detail: `${String(st.id)}: ${String(st.asserts_status)} is not a status of ${String(st.about && st.about.type)}`,
    };
  const about = st.about as ObjectRef;
  const ev = evById(ctx, st.evidence_event_id);
  if (!ev)
    return {
      ok: false,
      claim: true,
      detail: `${String(st.id)}: claims ${claimText(st)} without a recorded evidence event`,
    };
  if (!eventConcerns(ev, about.type, about.id))
    return {
      ok: false,
      claim: true,
      ev,
      detail: `${String(st.id)}: evidence ${ev.event_id} (${ev.type}) does not name ${about.type} ${about.id}`,
    };
  if (!req.types.includes(ev.type)) {
    const fi = findForbiddenInference({
      premise_event_type: ev.type,
      about_type: about.type,
      asserts_status: st.asserts_status ?? null,
      asserts_event: st.asserts_event ?? null,
    });
    return {
      ok: false,
      claim: true,
      ev,
      fi,
      detail: `${String(st.id)}: claims ${claimText(st)} from ${ev.type}${fi ? ` — forbidden inference ${fi.id} (${fi.rule.en})` : ""}; requires ${req.types.join(" / ")}`,
    };
  }
  if (req.kind === "status") {
    const rows = transitionsOf(about.type).filter(
      (r) => r.to === st.asserts_status && r.on.includes(ev.type),
    );
    if (!rows.some((r) => guardHolds(r.when, ev)))
      return {
        ok: false,
        claim: true,
        ev,
        detail: `${String(st.id)}: ${ev.type} payload does not support ${String(st.asserts_status)} (guard)`,
      };
  }
  if (req.kind === "case_code" && (!ev.payload || ev.payload.to !== st.asserts_status))
    return {
      ok: false,
      claim: true,
      ev,
      detail: `${String(st.id)}: ${ev.event_id} records ${String(ev.payload && ev.payload.to)}, not ${String(st.asserts_status)}`,
    };
  return { ok: true, claim: true, ev };
}

type Push = (m: string) => unknown;
type ClaimPred = (type: string, status: string | null, event: string | null) => boolean;
/** Statements whose claim matches a predicate on (about.type, asserts_status, asserts_event). */
const claims = (ctx: Ctx, pred: ClaimPred): Statement[] =>
  stmts(ctx).filter(
    (s) => s && s.about && pred(s.about.type, s.asserts_status ?? null, s.asserts_event ?? null),
  );
const checkClaims = (ctx: Ctx, list: readonly Statement[], push: Push): void => {
  for (const s of list) {
    const c = checkClaim(ctx, s);
    if (!c.ok) push(c.detail as string);
  }
};
const checkObjects = (
  ctx: Ctx,
  pred: (type: string | undefined, status: string | null | undefined) => boolean,
  push: Push,
): void => {
  for (const o of objs(ctx)) {
    if (!pred(o.type, o.status)) continue;
    const c = checkStatusEvidence(o, evs(ctx));
    if (!c.ok) push(`${String(o.type)} ${String(objId(o))} ${String(o.status)}: ${c.detail}`);
  }
};
const before = (a: DomainEvent, b: DomainEvent): boolean => compareEvents(a, b) < 0;
const own = (o: unknown, k: unknown): boolean =>
  !isNil(o) && Object.prototype.hasOwnProperty.call(o, k as PropertyKey);

/** The first ancestor of `e` on its causation chain that satisfies `pred` (e itself excluded), or null. */
function causedBy(ctx: Ctx, e: DomainEvent, pred: (p: DomainEvent) => boolean): DomainEvent | null {
  const seen = new Set<string>([e.event_id]);
  let cur: DomainEvent | null = e;
  while (cur && !isNil(cur.causation_id)) {
    const p = evById(ctx, cur.causation_id);
    if (!p || seen.has(p.event_id)) return null;
    if (pred(p)) return p;
    seen.add(p.event_id);
    cur = p;
  }
  return null;
}
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}
/**
 * The journey catalogue's payload filter (W-C src/journeys/catalogue_v13.json field_notes, read-only): a scalar must be
 * equal; an array means any of; null inside an array matches an absent key. No filter matches every payload.
 */
export function payloadFilterMatches(
  filter: Payload | null | undefined,
  payload: Payload | null | undefined,
): boolean {
  if (!filter) return true;
  for (const [k, want] of Object.entries(filter)) {
    const got = payload ? payload[k] : undefined;
    if (Array.isArray(want)) {
      if (!want.some((w: unknown) => (w === null ? got === undefined || got === null : deepEqual(w, got))))
        return false;
    } else if (!deepEqual(want, got)) return false;
  }
  return true;
}
type Pattern = { type: string; payload?: Payload | null };
/** Patterns of a step: the *_any_of list (work/LEAD_notes.md L-05) when present, else the single type and payload. */
const patternsOf = (
  list: readonly (StepPattern | null)[] | null | undefined,
  type: string | null | undefined,
  payload: Payload | null | undefined,
): Pattern[] =>
  Array.isArray(list) && list.length
    ? list.filter((p): p is Pattern => !!p && !!p.type)
    : type
      ? [{ type, payload: payload ?? null }]
      : [];
const completionPatterns = (cs: CatalogueStep): Pattern[] =>
  patternsOf(cs.completion_any_of, cs.completion_event_type, cs.completion_payload);
const triggerPatterns = (cs: CatalogueStep): Pattern[] =>
  patternsOf(cs.trigger_any_of, cs.trigger_event_type, cs.trigger_payload);
const matchesPattern = (ev: DomainEvent | null | undefined, p: StepPattern | null | undefined): boolean =>
  !!ev && !!p && ev.type === p.type && payloadFilterMatches(p.payload, ev.payload);
/** The object an event completes or closes: payload.target when present, else event.object (L-05; completion_target SELF). */
const closedId = (ev: DomainEvent | null | undefined): unknown => {
  const t = ev && ev.payload ? ev.payload.target : undefined;
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && !isNil((t as { id?: unknown }).id)) return (t as { id?: unknown }).id;
  return ev && ev.object ? (ev.object.id ?? null) : null;
};
/** Ids an event names in its payload (the convention W-C resolve.js reads): subject_object_id, object_id, target, related[]. */
const namedIds = (ev: DomainEvent | null | undefined): unknown[] => {
  const p: Payload = (ev && ev.payload) || {};
  const out: unknown[] = [];
  const add = (x: unknown): void => {
    if (typeof x === "string") out.push(x);
    else if (x && typeof x === "object" && !isNil((x as { id?: unknown }).id))
      out.push((x as { id?: unknown }).id);
  };
  add(p.subject_object_id);
  add(p.object_id);
  add(p.target);
  if (Array.isArray(p.related)) p.related.forEach(add);
  else add(p.related);
  return out;
};
/**
 * Is `ev` in the scope of the object that owns a step (PROPOSAL, the scope rule of W-C src/journeys/resolve.js)? It
 * names the object or one of its related_objects (L-05) as its object (same case) or in its payload, or it is a case
 * event of the object's case. Another object's event of the same case is not in scope.
 */
function belongsTo(ev: DomainEvent, owner: ProceduralObjectRecord): boolean {
  const scope = new Set<unknown>(
    [objId(owner), ...arr(owner.related_objects).map((o) => o && o.id)].filter((x) => !isNil(x)),
  );
  const objHit = !!(ev.object && scope.has(ev.object.id));
  if (objHit && owner.case_id && ev.case_id && ev.case_id !== owner.case_id) return false;
  const caseHit =
    !!owner.case_id &&
    ev.case_id === owner.case_id &&
    (CASE_EVENTS.includes(ev.type) || !!(ev.object && ev.object.type === "CASE"));
  return objHit || namedIds(ev).some((x) => scope.has(x)) || caseHit;
}
/** A directive §4.3 example by line (FACT; tests/invariants.test.js INV-00f re-reads the line). */
const dx = (line: number, text: string): DirectiveExample =>
  Object.freeze({ text, ref: `${DIRECTIVE}:${line}`, line, section: "§4.3", label: "FACT" } as const);

// ---------------------------------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------------------------------
const inv = (def: InvariantDef): Invariant =>
  Object.freeze({
    ...def,
    related_pc: Object.freeze(def.related_pc || []),
    sources: Object.freeze(def.sources || []),
    test: `tests/invariants.test.js#${def.id}`,
  });
/** The ten invariants that carry a directive §4.3 example (directive line → invariant id). */
export const DIRECTIVE_EXAMPLE_LINES = Object.freeze({
  366: "INV-03",
  367: "INV-04",
  368: "INV-05",
  369: "INV-07",
  370: "INV-06",
  371: "INV-08",
  372: "INV-09",
  373: "INV-10",
  374: "INV-20",
  375: "INV-11",
} as const);

export const INVARIANTS = Object.freeze([
  inv({
    id: "INV-01",
    severity: "BLOCK",
    origin: "charter §3.1, §4; directive §6 :517-519",
    label: "FACT",
    related_pc: ["PC-11"],
    ar: "المستوى الأول يُستمد من رمز الحالة المسجَّل في سجل القضية وحده، لا من نوع الإشعار أو قالبه أو تلميح المسار؛ وسجلّ رموز القضية (history)، إن وُجد، يتبع الأحداث المسجَّلة وينتهي بالرمز الحالي.",
    en: "Level 1 comes only from the recorded case code (CaseRecord.status.code), never from the notification type, template or master hint; the case code history, when given, follows the recorded events and ends in the current code.",
    sources: [
      'CHARTER.md §3.1 ("status.code is the only source of Level 1"), §4 (master_hint documentation only)',
      `${DIRECTIVE}:517-519 (§6 "Master case progress must originate from authoritative case data." … "No journey catalogue may override the recorded case stage.")`,
      "work/LEAD_notes.md L-05 (CaseRecord.history [{code, recorded_at, source_event_id}], contract addition)",
      "review/v12-forensic/deliverables/D6_findings_register.csv:9 (MF-008)",
    ],
    check(ctx) {
      const v: string[] = [];
      const c = ctx.case;
      for (const [where, l1] of [
        ["notification.l1", notif(ctx) && notif(ctx)!.l1],
        ["progress.l1", ctx.progress && ctx.progress.l1],
      ] as [string, L1Display | null | undefined][]) {
        if (isNil(l1)) continue;
        if (!c || c.exists === false) {
          v.push(`${where} shown without an existing case record`);
          continue;
        }
        if (l1.source !== "CASE_RECORD")
          v.push(`${where}.source is ${String(l1.source)}; Level 1 comes only from CASE_RECORD`);
        if (!isV8Code(l1.code))
          v.push(`${where}.code ${String(l1.code)} is not a V8 code (Level 1 must not be shown)`);
        else if (!isNil(l1.stage) && l1.stage !== stageOf(l1.code))
          v.push(`${where}.stage ${l1.stage} ≠ stageOf(${l1.code})`);
        if (!c.status || l1.code !== c.status.code)
          v.push(`${where}.code ${String(l1.code)} ≠ recorded ${String(c.status && c.status.code)}`);
        if (!isNil(l1.source_event_id) && c.status && l1.source_event_id !== c.status.source_event_id)
          v.push(`${where}.source_event_id ≠ CaseRecord.status.source_event_id`);
        const ce = checkCaseEvidence(c, evs(ctx), { flags: false });
        if (!ce.ok) v.push(`${where}: ${ce.detail}`);
      }
      const hist = c && c.exists !== false ? c.history : undefined;
      if (!isNil(hist)) {
        if (!Array.isArray(hist)) v.push("case.history is not a list");
        else {
          let prevT = null;
          for (const [k, h] of hist.entries()) {
            const where = `case.history[${k}]`;
            if (!h || !isV8Code(h.code)) {
              v.push(`${where}: ${String(h && h.code)} is not a V8 code`);
              continue;
            }
            if (!isNil(h.recorded_at)) {
              if (!isIso(h.recorded_at))
                v.push(`${where}: recorded_at ${String(h.recorded_at)} is not an ISO timestamp`);
              else {
                if (!isNil(prevT) && Date.parse(h.recorded_at) < prevT)
                  v.push(`${where}: recorded_at goes back in time`);
                prevT = Date.parse(h.recorded_at);
              }
            }
            if (evs(ctx).length) {
              const ev = evById(ctx, h.source_event_id);
              if (!ev) v.push(`${where}: source event ${String(h.source_event_id)} not recorded`);
              else if (
                !has(CASE_CODE_EVENTS, ev.type) ||
                !(
                  ev.case_id === c!.case_id ||
                  (ev.object && ev.object.type === "CASE" && ev.object.id === c!.case_id)
                ) ||
                !ev.payload ||
                ev.payload.to !== h.code
              ) {
                v.push(`${where}: ${ev.event_id} (${ev.type}) does not record ${h.code} for this case`);
              }
            }
          }
          const last = hist.at(-1);
          if (last && c!.status && last.code !== c!.status.code)
            v.push(`case.history ends in ${String(last.code)}, status.code is ${String(c!.status.code)}`);
        }
      }
      return result(v, "Level 1 equals the recorded case code");
    },
  }),
  inv({
    id: "INV-02",
    severity: "BLOCK",
    origin: "charter §3.1; directive §6 :520",
    label: "FACT",
    related_pc: ["PC-07"],
    ar: "إذا لم توجد القضية (exists:false) فلا مستوى أول ولا مسار رئيسي ولا إشارة إلى القضية في الإشعار.",
    en: "When the case does not exist (exists:false) there is no Level 1, no master journey and no reference to a case in the notification.",
    sources: [
      'CHARTER.md §3.1 ("exists:false … no master journey is rendered at all"), §8 PC-07',
      `${DIRECTIVE}:520 (§6 "No master journey should be displayed when the case does not yet exist."), :1118 (§16 "Notification refers to a nonexistent case.")`,
    ],
    check(ctx) {
      const c = ctx.case;
      const n = notif(ctx);
      if (c && c.exists !== false) return result([], "case exists");
      const v: string[] = [];
      if (n && !isNil(n.l1)) v.push("notification.l1 present for a non-existent case");
      if (ctx.progress && !isNil(ctx.progress.l1)) v.push("progress.l1 present for a non-existent case");
      if (n && !isNil(n.case_id)) v.push(`notification.case_id ${n.case_id} refers to a non-existent case`);
      if (n && (!isNil(n.internal_ref) || !isNil(n.case_number)))
        v.push("notification carries a case number for a non-existent case");
      for (const s of stmts(ctx))
        if (s.about && s.about.type === "CASE") v.push(`${s.id}: statement about a non-existent case`);
      return result(v);
    },
  }),
  inv({
    id: "INV-03",
    severity: "BLOCK",
    origin: "directive §4.3 :366; charter §3.1, §3.5 never-inferred #5",
    label: "FACT",
    related_pc: ["PC-11"],
    directive_example: dx(366, "A notification cannot establish case closure."),
    ar: "الإشعار لا يُثبت إغلاق القضية، ولا يُنشئ حالتها ولا يغيّرها: لا يُسبَّب حدث قضية بحدث تواصلي.",
    en: "A notification cannot establish case closure, nor establish or change any case status: no case event is caused by a communication event.",
    sources: [
      `${DIRECTIVE}:366 (§4.3)`,
      'CHARTER.md §3.1 ("CASE_UNCHANGED notifications never move it"), §3.5',
      'review/v12-forensic/work/W3_journeys_review.md:68 (V12 "unchanged" mode)',
    ],
    check(ctx) {
      const v: string[] = [];
      const comm = new Set(COMMUNICATION_EVENTS);
      for (const e of evs(ctx)) {
        if (!has(CASE_EVENTS, e.type)) continue;
        const seen = new Set([e.event_id]);
        let cur = e;
        while (cur && !isNil(cur.causation_id)) {
          const p = evById(ctx, cur.causation_id);
          if (!p || seen.has(p.event_id)) break;
          if (comm.has(p.type)) {
            v.push(`${e.event_id} ${e.type} is caused by ${p.event_id} ${p.type}`);
            break;
          }
          seen.add(p.event_id);
          cur = p;
        }
        if (e.provenance && typeof e.provenance.ref === "string" && /^notify\./i.test(e.provenance.ref))
          v.push(`${e.event_id} ${e.type} was recorded from ${e.provenance.ref}`);
      }
      const c = ctx.case;
      if (c && c.status) {
        const src = evById(ctx, c.status.source_event_id);
        if (src && comm.has(src.type))
          v.push(`case code source ${src.event_id} is the communication event ${src.type}`);
      }
      const n = notif(ctx);
      if (
        n &&
        !isNil(n.case_effect) &&
        !has(["CASE_UNCHANGED", "REPORTS_RECORDED_CASE_EVENT"], n.case_effect)
      )
        v.push(`notification.case_effect ${n.case_effect}: a notification has no effect on the case`);
      for (const s of stmts(ctx)) {
        if (!s.about || s.about.type !== "CASE") continue;
        const asserting = (s.asserts_event && has(CASE_EVENTS, s.asserts_event)) || !isNil(s.asserts_status);
        if (!asserting) continue;
        if (n && n.case_effect === "CASE_UNCHANGED") {
          v.push(`${s.id}: a CASE_UNCHANGED notification asserts a case change (${claimText(s)})`);
          continue;
        }
        const ev = evById(ctx, s.evidence_event_id);
        if (!ev || !has(CASE_EVENTS, ev.type))
          v.push(
            `${s.id}: asserts ${claimText(s)} without a recorded case event${ev ? ` (evidence ${ev.type})` : ""}`,
          );
      }
      return result(v, "no case change originates in a notification");
    },
  }),
  inv({
    id: "INV-04",
    severity: "BLOCK",
    origin: "directive §4.3 :367; charter §3.5 never-inferred #3, §8 PC-01",
    label: "FACT",
    related_pc: ["PC-01"],
    directive_example: dx(367, "A recommendation cannot establish a competent-authority decision."),
    ar: "التوصية لا تُثبت قرار جهة الاختصاص: لا يُعرض قرار صادر إلا بحدث تسجيل قرار صاحب الصلاحية، و«الإعادة إلى اللجنة» ليست قراراً في الموضوع.",
    en: "A recommendation cannot establish a competent-authority decision: a decision is shown as made only with AUTHORITY_DECISION_RECORDED, and RETURN_TO_COMMITTEE is not a decision on the merits.",
    sources: [
      `${DIRECTIVE}:367 (§4.3), :1112 (§16 "Decision described as issued when no decision record exists.")`,
      "CHARTER.md §3.5, §8 PC-01",
      "review/v12-forensic/deliverables/D6_findings_register.csv:16 (MF-015)",
    ],
    check(ctx) {
      const v: string[] = [];
      const push = (m: string) => v.push(m);
      checkClaims(
        ctx,
        claims(
          ctx,
          (t, s, e) =>
            (t === "DECISION" && (s === "DECIDED" || e === "AUTHORITY_DECISION_RECORDED")) ||
            (t === "RECOMMENDATION" && s === "DECIDED"),
        ),
        push,
      );
      checkObjects(ctx, (t, s) => (t === "DECISION" || t === "RECOMMENDATION") && s === "DECIDED", push);
      return result(v, "every decision claim rests on AUTHORITY_DECISION_RECORDED");
    },
  }),
  inv({
    id: "INV-05",
    severity: "BLOCK",
    origin: "directive §4.3 :368; charter §8 PC-04, PC-12",
    label: "FACT",
    related_pc: ["PC-04", "PC-12"],
    directive_example: dx(368, "A submitted legal opinion cannot establish adoption of the recommendation."),
    ar: "الرأي النظامي المقدَّم لا يُثبت اعتماد التوصية: لا يثبت الاعتماد إلا بحدث اعتماد التوصية.",
    en: "A submitted legal opinion cannot establish adoption of the recommendation: adoption is established only by RECOMMENDATION_ADOPTED.",
    sources: [
      `${DIRECTIVE}:368 (§4.3), :1115 (§16 "Recommendation described as approved before approval.")`,
      "CHARTER.md §8 PC-04, PC-12",
      "cdf_case_management/docs/business-architecture/TARGET_WORKFLOW_STATE_MODEL.md §3.6",
      "review/v12-forensic/deliverables/D6_findings_register.csv:15 (MF-014: one wording for two legal-opinion outcomes)",
    ],
    check(ctx) {
      const v: string[] = [];
      const push = (m: string) => v.push(m);
      checkClaims(
        ctx,
        claims(
          ctx,
          (t, s, e) => t === "RECOMMENDATION" && (s === "ADOPTED" || e === "RECOMMENDATION_ADOPTED"),
        ),
        push,
      );
      checkObjects(ctx, (t, s) => t === "RECOMMENDATION" && s === "ADOPTED", push);
      return result(v, "adoption rests on RECOMMENDATION_ADOPTED");
    },
  }),
  inv({
    id: "INV-06",
    severity: "BLOCK",
    origin: "directive §4.3 :370; charter §3.5 never-inferred #2, §8 PC-02",
    label: "FACT",
    related_pc: ["PC-02"],
    directive_example: dx(370, "A requested vote cannot establish that voting opened."),
    ar: "طلب التصويت لا يُثبت فتح التصويت، ولا توجيهُ الرئيس: لا يُعرض التصويت مفتوحاً أو مغلقاً إلا بحدث فتحه أو إغلاقه.",
    en: "A requested vote cannot establish that voting opened, nor can a chair direction: a vote is shown open or closed only with BALLOT_OPENED / BALLOT_CLOSED.",
    sources: [
      `${DIRECTIVE}:370 (§4.3), :1113 (§16 "Vote described as open before authorization.")`,
      "CHARTER.md §3.5, §8 PC-02",
      "cdf_case_management/infrastructure/supabase/migrations/20261007001900_recommendations_legal_review_authority.sql:795-798 (a requested vote sets the package VOTING), :841 (the vote opens)",
      "review/v12-forensic/deliverables/D6_findings_register.csv:14 (MF-013: «Voting open» without a vote item)",
    ],
    check(ctx) {
      const v: string[] = [];
      const push = (m: string) => v.push(m);
      checkClaims(
        ctx,
        claims(
          ctx,
          (t, s, e) =>
            (t === "BALLOT" &&
              (has(["OPEN", "COMPLETED", "FAILED"], s) || has(["BALLOT_OPENED", "BALLOT_CLOSED"], e))) ||
            (t === "RECOMMENDATION" && (s === "UNDER_VOTE" || e === "BALLOT_OPENED")),
        ),
        push,
      );
      checkObjects(
        ctx,
        (t, s) =>
          (t === "BALLOT" && has(["OPEN", "COMPLETED", "FAILED"], s)) ||
          (t === "RECOMMENDATION" && s === "UNDER_VOTE"),
        push,
      );
      return result(v, "vote claims rest on ballot events");
    },
  }),
  inv({
    id: "INV-07",
    severity: "BLOCK",
    origin: "directive §4.3 :369; charter §8 PC-03, PC-13",
    label: "FACT",
    related_pc: ["PC-03", "PC-13"],
    directive_example: dx(369, "A meeting invitation cannot establish that the meeting occurred."),
    ar: "دعوة الاجتماع لا تُثبت انعقاده: لا يُعرض الاجتماع أو الجلسة منعقداً أو مختتماً أو بمحضر إلا بأحداث الافتتاح والاختتام والمحضر.",
    en: "A meeting invitation cannot establish that the meeting occurred: a meeting or hearing is shown held, closed or minuted only with MEETING_OPENED / MEETING_CLOSED / minutes events.",
    sources: [
      `${DIRECTIVE}:369 (§4.3), :1114 (§16 "Meeting described as completed before its recorded completion.")`,
      "CHARTER.md §8 PC-03, PC-13",
      "review/v12-forensic/work/W2_committee_register_review.md:64 (CF-24 invitation card ticks steps with no recorded command)",
    ],
    check(ctx) {
      const v: string[] = [];
      const push = (m: string) => v.push(m);
      checkClaims(
        ctx,
        claims(
          ctx,
          (t, s, e) =>
            has(["MEETING", "HEARING"], t) &&
            (has(MEETING_HELD, s) || has(["MEETING_OPENED", "MEETING_CLOSED", "MINUTES_FINAL"], e)),
        ),
        push,
      );
      checkObjects(ctx, (t, s) => has(["MEETING", "HEARING"], t) && has(MEETING_HELD, s), push);
      return result(v, "occurrence rests on meeting events");
    },
  }),
  inv({
    id: "INV-08",
    severity: "BLOCK",
    origin: "directive §4.3 :371; charter §8 PC-14, §9; work/LEAD_notes.md L-05 (G-06)",
    label: "FACT",
    related_pc: ["PC-14"],
    directive_example: dx(371, "A drafted notification cannot establish that it was issued."),
    ar: "الإشعار المسوَّد لا يُثبت صدوره: لا يُعرض إشعار مرسلاً ولا تبليغ رسمي صادراً ولا محضر نهائياً إلا بحدث الإصدار نفسه، والتبليغ الرسمي حدث إجرائي لا يُنشئه إشعار.",
    en: "A drafted notification cannot establish that it was issued: a sent notification, an issued formal notice or final minutes are shown only with their own issuing event, and a formal notice is a domain event that no notification creates.",
    sources: [
      `${DIRECTIVE}:371 (§4.3), :1003-1006 (§13: draft creation, validation, authorization and dispatch are distinct)`,
      "CHARTER.md §8 PC-14, §9",
      "work/LEAD_notes.md L-05 G-06 (RIGHTS_NOTICE_ISSUED, DEFENCE_NOTICE_ISSUED, DEFENCE_PACKET_RELEASED, ALLEGATIONS_NOTIFIED, AUTHORISED_OUTCOME_COMMUNICATED are domain events, distinct from notify.*)",
    ],
    check(ctx) {
      const v: string[] = [];
      const push = (m: string) => v.push(m);
      checkClaims(
        ctx,
        claims(
          ctx,
          (t, s, e) =>
            (has(["MEETING", "HEARING"], t) && (s === "MINUTES_FINAL" || e === "MINUTES_FINAL")) ||
            (t === "DECISION" && has(["DECISION_NOTICE_ISSUED", "DECISION_NOTICE_DELIVERED"], e)) ||
            (!isNil(e) && own(FORMAL_NOTICE_EVENTS, e)) ||
            (t === "NOTIFICATION" && (has(["QUEUED", "SENT"], s) || e === "NOTIFICATION_SENT")),
        ),
        push,
      );
      for (const e of evs(ctx)) {
        if (!e || !own(FORMAL_NOTICE_EVENTS, e.type)) continue;
        const p = causedBy(ctx, e, (x) => has(COMMUNICATION_EVENTS, x.type));
        if (p)
          v.push(
            `${e.event_id} ${e.type} is caused by the notification event ${p.event_id} ${p.type}: a formal notice is a domain event, never a notification's effect (L-05 G-06)`,
          );
      }
      const n = notif(ctx);
      if (n && has(PRE_QUEUE, n.status)) {
        const id = n.notification_id;
        const ver = n.version ?? 1;
        if (attempts(ctx).some((a) => a.notification_id === id && (isNil(a.version) || a.version === ver)))
          v.push(`notification ${id} is ${n.status} but has delivery attempts`);
        const ent = evidenceOf(ctx, id, ver, "DELIVERY_ATTEMPT");
        if (ent.length)
          v.push(
            `notification ${id} is ${n.status} but has ${ent.length} delivery attempt evidence entr${ent.length === 1 ? "y" : "ies"} for this version`,
          );
        for (const e of evs(ctx))
          if (
            has(
              ["NOTIFICATION_SENT", "DELIVERY_CONFIRMED", "DELIVERY_FAILED", "DELIVERY_ATTEMPTED"],
              e.type,
            ) &&
            (eventConcerns(e, "NOTIFICATION", id) || (e.payload && e.payload.notification_id === id)) &&
            (isNil(e.version) || e.version === n.version)
          )
            v.push(`notification ${id} is ${n.status} but ${e.event_id} ${e.type} exists for this version`);
      }
      return result(v, "issuance claims rest on issuing events");
    },
  }),
  inv({
    id: "INV-09",
    severity: "BLOCK",
    origin: "directive §4.3 :372; charter §3.5 never-inferred #4, §8 PC-15, §9",
    label: "FACT",
    related_pc: ["PC-15"],
    directive_example: dx(372, "An exported EML file cannot establish delivery."),
    ar: "ملف EML المُصدَّر لا يُثبت التسليم، والإرسال ليس تسليماً مؤكداً: تستند حالة «أُرسل — لم يُؤكَّد التسليم» وحالات التسليم إلى أحداثها وإلى محاولات التسليم، لا إلى التصدير.",
    en: "An exported EML file cannot establish delivery, and dispatch is not confirmed delivery: SENT and the delivery states rest on their own events and on delivery attempts, never on an export.",
    sources: [
      `${DIRECTIVE}:372 (§4.3), :1006-1008 (§13: dispatch, provider acceptance and delivery evidence are distinct)`,
      "CHARTER.md §3.5, §8 PC-15, §9",
      "W-D1 src/lifecycle/notification.js (NOTIFICATION_EXPORTED is audit-only; an EXPORT evidence entry; an export never changes state)",
      'review/v12-forensic/deliverables/D3_architecture_reconstruction.md:28 (.eml download, manual "sent")',
    ],
    check(ctx) {
      const v: string[] = [];
      const push = (m: string) => v.push(m);
      const n = notif(ctx);
      checkClaims(
        ctx,
        claims(
          ctx,
          (t, s, e) =>
            t === "NOTIFICATION" &&
            (has(["SENT", "DELIVERY_CONFIRMED"], s) || has(["NOTIFICATION_SENT", "DELIVERY_CONFIRMED"], e)),
        ),
        push,
      );
      if (n && has(["SENT", "DELIVERY_CONFIRMED", "DELIVERY_FAILED"], n.status)) {
        const c = checkStatusEvidence(
          {
            type: "NOTIFICATION",
            notification_id: n.notification_id,
            version: n.version,
            status: n.status,
            status_source_event_id: n.status_source_event_id,
          },
          evs(ctx),
        );
        if (!c.ok) v.push(`notification ${n.status}: ${c.detail}`);
        const ver = n.version ?? 1;
        const exports = evidenceOf(ctx, n.notification_id, ver, "EXPORT");
        const tries =
          evidenceOf(ctx, n.notification_id, ver, "DELIVERY_ATTEMPT").length +
          attempts(ctx).filter(
            (a) => a.notification_id === n.notification_id && (isNil(a.version) || a.version === ver),
          ).length +
          evs(ctx).filter(
            (e) =>
              e.type === "DELIVERY_ATTEMPTED" &&
              eventConcerns(e, "NOTIFICATION", n.notification_id) &&
              (e.version ?? 1) === ver,
          ).length;
        if (exports.length && tries === 0)
          v.push(
            `notification ${n.status} rests on an export only (${exports.length} EXPORT evidence entr${exports.length === 1 ? "y" : "ies"}, no delivery attempt)`,
          );
      }
      for (const e of evs(ctx)) {
        if (!has(["NOTIFICATION_SENT", "DELIVERY_ACCEPTED_BY_PROVIDER", "DELIVERY_CONFIRMED"], e.type))
          continue;
        const p = causedBy(ctx, e, (x) => x.type === "NOTIFICATION_EXPORTED");
        if (p) v.push(`${e.event_id} ${e.type} is caused by the export ${p.event_id}`);
      }
      for (const a of attempts(ctx)) {
        const src = evById(ctx, a.status_source_event_id);
        if (src && src.type === "NOTIFICATION_EXPORTED")
          v.push(`attempt ${a.attempt_id} rests on an export (${src.event_id})`);
      }
      return result(v, "delivery rests on delivery events");
    },
  }),
  inv({
    id: "INV-10",
    severity: "BLOCK",
    origin: "directive §4.3 :373; charter §3.4, §8 PC-16, §9",
    label: "FACT",
    related_pc: ["PC-16"],
    directive_example: dx(373, "A delivery attempt cannot establish recipient acknowledgment."),
    ar: "محاولة التسليم لا تُثبت إقرار المستلم بالاستلام، ولا التسليمُ نفسه: الإقرار فعل مسجَّل للمستلم نفسه (RECIPIENT_ACKNOWLEDGED)، وليس حالة تسليم ولا حالة إشعار.",
    en: "A delivery attempt cannot establish recipient acknowledgment, nor can a delivery: acknowledgement is the recipient’s own recorded act (RECIPIENT_ACKNOWLEDGED), never a delivery or notification status.",
    sources: [
      `${DIRECTIVE}:373 (§4.3), :1009-1011 (§13 "Recipient acknowledgment. … Do not treat these as interchangeable.")`,
      "CHARTER.md §3.4, §8 PC-16, §9",
      "W-D1 src/lifecycle/notification.js (an ACKNOWLEDGEMENT evidence entry cites the RECIPIENT_ACKNOWLEDGED event)",
    ],
    check(ctx) {
      const v: string[] = [];
      const push = (m: string) => v.push(m);
      const n = notif(ctx);
      checkClaims(
        ctx,
        claims(ctx, (t, s, e) => t === "NOTIFICATION" && e === "RECIPIENT_ACKNOWLEDGED"),
        push,
      );
      if (n) {
        for (const e of evs(ctx)) {
          if (e.type !== "RECIPIENT_ACKNOWLEDGED" || !eventConcerns(e, "NOTIFICATION", n.notification_id))
            continue;
          const r = n.recipient || {};
          if (!e.actor || e.actor.id !== r.id)
            v.push(
              `${e.event_id}: acknowledgement recorded by ${String(e.actor && e.actor.id)}, not by the recipient ${String(r.id)}`,
            );
          else if (r.class && e.actor.capacity && e.actor.capacity !== r.class)
            v.push(
              `${e.event_id}: acknowledgement in capacity ${e.actor.capacity} ≠ recipient class ${r.class}`,
            );
        }
        if (has(["ACKNOWLEDGED", "READ"], n.status))
          v.push(`notification status ${n.status} is not a status (acknowledgement is an event)`);
      }
      for (const a of attempts(ctx))
        if (has(["ACKNOWLEDGED", "READ", "DELIVERED"], a.status))
          v.push(`attempt ${a.attempt_id} status ${a.status} is not a DeliveryStatus`);
      for (const x of arr(ctx.evidence)) {
        if (!x || !x.data) continue;
        if (x.kind === "DELIVERY_ATTEMPT" && has(["ACKNOWLEDGED", "READ", "DELIVERED"], x.data.status))
          v.push(
            `evidence ${entryRef(x)}: attempt status ${x.data.status} is not a DeliveryStatus (an attempt never establishes acknowledgement)`,
          );
        if (x.kind === "ACKNOWLEDGEMENT" && evs(ctx).length) {
          const ev = evById(ctx, x.data.event_id);
          if (!ev || ev.type !== "RECIPIENT_ACKNOWLEDGED")
            v.push(
              `evidence ${entryRef(x)}: ACKNOWLEDGEMENT without a recorded RECIPIENT_ACKNOWLEDGED event (cites ${String(x.data.event_id)})`,
            );
        }
      }
      return result(v, "acknowledgement only as the recipient's event");
    },
  }),
  inv({
    id: "INV-11",
    severity: "BLOCK",
    origin: "directive §4.3 :375, §7 :607, :622, :647; charter §3.2, §3.5 never-inferred #1, §3.6",
    label: "FACT",
    related_pc: ["PC-09"],
    directive_example: dx(
      375,
      "An expected step cannot display the same completion indicator as a verified completed step.",
    ),
    ar: "الخطوة المتوقعة لا تُعرض بمؤشر الإكمال الذي تحمله الخطوة المكتملة المتحقَّق منها: لا خطوة مكتملة دون حدث إكمالها المحدد في نطاق كائنها، ولا تحمل طبقة الإجراء المتوقع ✔ أو ● أو ألفاظ الإنجاز، ولا تحمل طبقة الإنجاز الفعلي ◇.",
    en: "An expected step cannot display the same completion indicator as a verified completed step: no step is COMPLETED without its catalogue completion event in its object’s scope; Expected Process never carries ✔ / ● or completion wording, and Actual Progress never carries ◇.",
    sources: [
      `${DIRECTIVE}:375 (§4.3), :607 (§7 "Completion must be supported by the appropriate authoritative record."), :622 ("Expected steps must never display verified-completion symbols."), :641-647, :1120 (§16 "An expected step is marked completed.")`,
      "CHARTER.md §3.2, §3.5, §3.6, §8 PC-09",
      "work/LEAD_notes.md L-05; src/journeys/catalogue_v13.json field_notes (completion_any_of, completion_target SELF, payload filters; W-C, read-only)",
      "review/v12-forensic/deliverables/D6_findings_register.csv:11 (MF-010)",
    ],
    check(ctx) {
      const v: string[] = [];
      const completionOk = (
        where: string,
        stepId: string | undefined,
        evidenceId: string | null | undefined,
        owner: ProceduralObjectRecord | null,
      ): void => {
        const cs = catStep(ctx, stepId);
        if (!cs) {
          v.push(`${where}: step ${stepId} is not in the catalogue`);
          return;
        }
        const pats = completionPatterns(cs);
        if (!pats.length) {
          v.push(`${where}: step ${stepId} has no completion_event_type and can never be COMPLETED`);
          return;
        }
        const ev = evById(ctx, evidenceId);
        if (!ev) {
          v.push(`${where}: COMPLETED without a recorded evidence event`);
          return;
        }
        const types = [...new Set(pats.map((p) => p.type))];
        if (!has(types, ev.type))
          v.push(`${where}: evidence ${ev.event_id} is ${ev.type}, not ${types.join(" / ")}`);
        else if (!pats.some((p) => matchesPattern(ev, p)))
          v.push(
            `${where}: evidence ${ev.event_id} ${ev.type} payload ${JSON.stringify(ev.payload ?? null)} matches no completion pattern of the step`,
          );
        if (cs.fail_on && matchesPattern(ev, cs.fail_on))
          v.push(
            `${where}: evidence ${ev.event_id} matches the step's fail_on ${JSON.stringify(cs.fail_on.payload ?? null)}: never its completion`,
          );
        if (owner && !belongsTo(ev, owner))
          v.push(
            `${where}: evidence ${ev.event_id} belongs to neither the object, its related objects nor its case`,
          );
        if (owner && cs.completion_target === "SELF" && closedId(ev) !== objId(owner))
          v.push(
            `${where}: evidence ${ev.event_id} ${ev.type} completes ${String(closedId(ev))}, not the object itself (completion_target SELF)`,
          );
      };
      for (const o of objs(ctx))
        for (const s of arr(o.steps)) {
          const where = `${o.type} ${objId(o)} step ${s.step_id}`;
          if (s.actual === "COMPLETED") {
            completionOk(where, s.step_id, s.evidence_event_id, o);
            if (!has(["RECORDED_FACT", "DERIVED_FROM_VERIFIED_FACTS"], s.epistemic))
              v.push(`${where}: COMPLETED with epistemic ${String(s.epistemic)}`);
          } else if (s.actual === "IN_PROGRESS") {
            const cs = catStep(ctx, s.step_id);
            const tp = cs ? triggerPatterns(cs) : [];
            if (tp.length) {
              const ev = evById(ctx, s.evidence_event_id);
              if (!tp.some((p) => matchesPattern(ev, p)))
                v.push(
                  `${where}: IN_PROGRESS without its trigger event ${[...new Set(tp.map((p) => p.type))].join(" / ")}`,
                );
            }
          }
        }
      const expectedSymbols = new Set<unknown>(LAYER_B_KIND_IDS.map((k) => LAYER_B_KINDS[k].symbol));
      for (const a of layerA(ctx)) {
        const where = `Actual Progress ${a.step_id}`;
        if (a.display_state === "COMPLETED")
          completionOk(where, a.step_id, a.evidence_event_id, objById(ctx, a.object_id));
        if (!isNil(a.symbol)) {
          const st = (LAYER_A_STATES as Readonly<Record<string, { symbol: string } | undefined>>)[
            a.display_state as string
          ];
          if (expectedSymbols.has(a.symbol))
            v.push(`${where}: carries the Expected Process symbol ${a.symbol}`);
          else if (st && a.symbol !== st.symbol)
            v.push(`${where}: symbol ${a.symbol} instead of ${st.symbol}`);
        }
      }
      for (const b of layerB(ctx)) {
        const where = `Expected Process ${b.step_id}`;
        if (!has(LAYER_B_KIND_IDS, b.kind)) v.push(`${where}: kind ${String(b.kind)} is not a Layer B kind`);
        if (b.display_state && has(LAYER_A_STATE_IDS, b.display_state))
          v.push(`${where}: carries the Actual Progress state ${b.display_state}`);
        const bk = b.kind
          ? (LAYER_B_KINDS as Readonly<Record<string, { symbol: string } | undefined>>)[b.kind]
          : undefined;
        if (!isNil(b.symbol) && b.kind && bk && b.symbol !== bk.symbol)
          v.push(`${where}: symbol ${b.symbol} instead of ${bk.symbol}`);
        if (!isNil(b.evidence_event_id))
          v.push(
            `${where}: an expected step carries evidence ${b.evidence_event_id} (it belongs to Actual Progress)`,
          );
        for (const t of [
          b.symbol,
          b.text && b.text.ar,
          b.text && b.text.en,
          b.aria && b.aria.ar,
          b.aria && b.aria.en,
        ]) {
          if (isNil(t)) continue;
          if (carriesActualMark(t)) v.push(`${where}: carries a completion / in-progress mark in «${t}»`);
          const w = containsCompletionWording(t);
          if (w) v.push(`${where}: completion wording «${w}»`);
        }
      }
      const na = notif(ctx) && notif(ctx)!.next_action;
      for (const [i, w] of arr(na && na.what_next).entries()) {
        for (const t of [w && w.ar, w && w.en, w && w.text && w.text.ar, w && w.text && w.text.en]) {
          if (isNil(t)) continue;
          if (carriesActualMark(t))
            v.push(`next_action.what_next[${i}]: carries a completion / in-progress mark`);
          const wd = containsCompletionWording(t);
          if (wd) v.push(`next_action.what_next[${i}]: completion wording «${wd}»`);
        }
      }
      for (const s of stmts(ctx)) {
        if (!s.display_state || !has(LAYER_B_KIND_IDS, s.display_state)) continue;
        for (const t of [s.text && s.text.ar, s.text && s.text.en]) {
          if (isNil(t)) continue;
          if (carriesActualMark(t)) v.push(`${s.id}: expected statement carries a mark`);
          const w = containsCompletionWording(t);
          if (w) v.push(`${s.id}: expected statement uses completion wording «${w}»`);
        }
      }
      return result(v, "no unrecorded completion; Expected Process carries no completion sign");
    },
  }),
  inv({
    id: "INV-12",
    severity: "BLOCK",
    origin: "directive §6 :584; charter §4, §8 PC-17",
    label: "FACT",
    related_pc: ["PC-17"],
    ar: "لا يظهر بديلٌ مكتملاً لأن بديلاً آخر اختير: في مجموعة البدائل لا يكتمل إلا البديل الذي يطابق حدثُ إكماله نوعَه وحمولتَه، ولا يُكمل حدثٌ واحد بديلين.",
    en: "An alternative never appears completed because another was selected: in an alternative group only the alternative whose completion event matches it (type and payload) is COMPLETED, and one event never completes two siblings.",
    sources: [
      `${DIRECTIVE}:584 (§6 "Ensure alternative chair directions cannot appear as completed sequential steps merely because another direction was selected.")`,
      "CHARTER.md §4 (alternative_group), §8 PC-17",
      "review/v12-forensic/work/W3_journeys_review.md:28 (F1, CF-18/CF-19)",
      "review/v12-forensic/deliverables/D6_findings_register.csv:10 (MF-009)",
    ],
    check(ctx) {
      const v: string[] = [];
      type ScanItem = {
        step_id?: string;
        actual?: string | null;
        display_state?: string | null;
        evidence_event_id?: string | null;
      };
      const scan = <T extends ScanItem>(
        where: string,
        items: readonly T[],
        ownerOf: (it: T) => unknown,
      ): void => {
        const groups = new Map<string, { it: T; cs: CatalogueStep }[]>();
        for (const it of items) {
          const cs = catStep(ctx, it.step_id);
          if (!cs || !cs.alternative_group) continue;
          const key = `${ownerOf(it)}|${cs.alternative_group}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push({ it, cs });
        }
        for (const [key, list] of groups) {
          const done = list.filter((x) => (x.it.actual ?? x.it.display_state) === "COMPLETED");
          if (done.length > 1)
            v.push(
              `${where} ${key}: ${done.length} alternatives COMPLETED (${done.map((x) => x.it.step_id).join(", ")})`,
            );
          const ids = done.map((x) => x.it.evidence_event_id).filter(Boolean);
          if (new Set(ids).size < ids.length)
            v.push(`${where} ${key}: one event completes several alternatives`);
          for (const x of done) {
            const ev = evById(ctx, x.it.evidence_event_id);
            const same = completionPatterns(x.cs).filter((p) => ev && p.type === ev.type && p.payload);
            if (same.length && !same.some((p) => payloadFilterMatches(p.payload, ev!.payload)))
              v.push(
                `${where} ${String(x.it.step_id)}: evidence payload ${JSON.stringify(ev && ev.payload)} does not select ${JSON.stringify(same.length === 1 ? same[0]!.payload : same.map((p) => p.payload))}`,
              );
          }
        }
      };
      for (const o of objs(ctx)) scan(`${o.type} ${objId(o)}`, arr(o.steps), () => objId(o));
      scan("Actual Progress", layerA(ctx), (a) => a.object_id);
      return result(v, "alternatives exclusive");
    },
  }),
  inv({
    id: "INV-13",
    severity: "BLOCK",
    origin: "charter §6; directive §12 :961, §16 :1112",
    label: "FACT",
    related_pc: ["PC-01", "PC-14"],
    ar: "تبليغ القرار يفترض قراراً مسجَّلاً قبله؛ ولا يُبلَّغ بـ«الإعادة إلى اللجنة» بوصفها قراراً.",
    en: "A decision notice presupposes an earlier recorded decision; RETURN_TO_COMMITTEE is never notified as a decision.",
    sources: [
      'CHARTER.md §6 ("Issuing a decision notice never equals making the decision")',
      `${DIRECTIVE}:961 (§12 "Issuing a decision notification must not be confused with making the decision."), :1112 (§16)`,
      `work/owner_messages_2026-10-27/second_independent_review_ar_16-08-21Z.txt:1223 («لا يمكن إصدار إشعار القرار قبل تسجيل قرار صاحب الصلاحية»)`,
      "src/authority/authority_v13.json ISSUE_DECISION_NOTICE (W-F: DECISION_NOT_FINAL)",
    ],
    check(ctx) {
      const v: string[] = [];
      const all = evs(ctx);
      const decided = (did: unknown, e: DomainEvent | null) =>
        all.find(
          (d) =>
            d.type === "AUTHORITY_DECISION_RECORDED" &&
            eventConcerns(d, "DECISION", did) &&
            d.payload &&
            !isNil(d.payload.outcome) &&
            d.payload.outcome !== "RETURN_TO_COMMITTEE" &&
            (!e || before(d, e)),
        );
      for (const e of all) {
        if (!has(["DECISION_NOTICE_ISSUED", "DECISION_NOTICE_DELIVERED", "GRIEVANCE_WINDOW_STARTED"], e.type))
          continue;
        const did = e.object && e.object.type === "DECISION" ? e.object.id : null;
        if (!did) {
          v.push(`${e.event_id} ${e.type} names no DECISION`);
          continue;
        }
        if (!decided(did, e))
          v.push(`${e.event_id} ${e.type} for decision ${did} without an earlier recorded decision`);
        if (
          e.type === "DECISION_NOTICE_DELIVERED" &&
          !all.some(
            (x) => x.type === "DECISION_NOTICE_ISSUED" && eventConcerns(x, "DECISION", did) && before(x, e),
          )
        )
          v.push(`${e.event_id} delivered before any DECISION_NOTICE_ISSUED`);
      }
      for (const s of claims(
        ctx,
        (t, st, ev) => t === "DECISION" && has(["DECISION_NOTICE_ISSUED", "DECISION_NOTICE_DELIVERED"], ev),
      )) {
        if (!decided(s.about!.id, null))
          v.push(`${String(s.id)}: notice of decision ${s.about!.id} without a recorded decision`);
      }
      return result(v, "every notice follows its decision");
    },
  }),
  inv({
    id: "INV-14",
    severity: "BLOCK",
    origin: "charter §8 PC-10; directive §6 :522, §16 :1121",
    label: "FACT",
    related_pc: ["PC-10"],
    ar: "الكائن الملغى لا يُعرض نشطاً: لا خطوة جارية ولا حالة نشطة ولا إجراء مطلوب بشأنه.",
    en: "A cancelled object is never presented as active: no ongoing step, no active status and no required action about it.",
    sources: [
      "CHARTER.md §8 PC-10",
      `${DIRECTIVE}:522 (§6 "Returned, suspended, cancelled and reopened states must be represented accurately."), :1121 (§16 "A cancelled procedure is presented as active.")`,
      "review/v12-forensic/work/W3_journeys_review.md:33 (F6: a cancelled meeting rendered as progressing)",
    ],
    check(ctx) {
      const v: string[] = [];
      const n = notif(ctx);
      const na = n && n.next_action;
      const naObject = na ? na.object || (n && n.object) || null : null; // charter §7 names no object: the notification's object (PROPOSAL)
      for (const o of objs(ctx)) {
        if (o.status !== "CANCELLED") continue;
        const id = objId(o);
        const so = STATUS_OBJECTS[lifecycleOf(o.type) as StatusObjectName];
        for (const s of arr(o.steps))
          if (has(ACTIVE_DISPLAY, s.actual))
            v.push(`${o.type} ${id} is CANCELLED but step ${s.step_id} is ${s.actual}`);
        for (const s of stmts(ctx)) {
          if (!s.about || s.about.id !== id) continue;
          if (s.asserts_status && has(so.active, s.asserts_status))
            v.push(`${s.id}: presents cancelled ${o.type} ${id} as ${s.asserts_status}`);
          if (has(ACTIVE_DISPLAY, s.display_state))
            v.push(`${s.id}: shows cancelled ${o.type} ${id} as ${s.display_state}`);
        }
        for (const a of layerA(ctx))
          if (a.object_id === id && has(ACTIVE_DISPLAY, a.display_state))
            v.push(`Actual Progress ${a.step_id}: cancelled ${o.type} ${id} shown ${a.display_state}`);
        if (naObject && naObject.id === id && !has(["READ_ONLY", "NONE"], na!.kind))
          v.push(`next action ${String(na!.kind)} on cancelled ${String(o.type)} ${String(id)}`);
      }
      if (
        ctx.case &&
        ctx.case.flags &&
        ctx.case.flags.cancelled === true &&
        na &&
        !has(["READ_ONLY", "NONE"], na.kind)
      )
        v.push(`next action ${na.kind} on a cancelled case`);
      if (n && n.status === "CANCELLED") {
        const ver = n.version ?? 1;
        const sameVersion = (e: DomainEvent): boolean =>
          eventConcerns(e, "NOTIFICATION", n.notification_id) && (e.version ?? 1) === ver;
        const cancel = evs(ctx).find((e) => e.type === "NOTIFICATION_CANCELLED" && sameVersion(e));
        if (cancel) {
          for (const e of evs(ctx))
            if (
              has(
                [
                  "NOTIFICATION_QUEUED",
                  "NOTIFICATION_SENT",
                  "DELIVERY_ATTEMPTED",
                  "DELIVERY_ACCEPTED_BY_PROVIDER",
                  "DELIVERY_CONFIRMED",
                ],
                e.type,
              ) &&
              sameVersion(e) &&
              before(cancel, e)
            )
              v.push(`${e.event_id} ${e.type} after the cancellation ${cancel.event_id}`);
          const tc = Date.parse(cancel.occurred_at as string);
          for (const x of evidenceOf(ctx, n.notification_id, ver, "DELIVERY_ATTEMPT"))
            if (x.data && x.data.status === "ATTEMPTED" && entryTime(x) > tc)
              v.push(
                `evidence ${entryRef(x)}: delivery attempt ${String(x.data.attempt)} after the cancellation ${cancel.event_id}`,
              );
        }
      }
      return result(v, "cancelled objects are shown as cancelled");
    },
  }),
  inv({
    id: "INV-15",
    severity: "BLOCK",
    origin: "directive §4.1 :306-338; charter §3.4",
    label: "FACT",
    related_pc: [],
    ar: "كائنات الحالة السبعة لا تُدمج: لكل كائن قيمة من تعداده فقط، والتأخر والإقرار ليسا حالتين.",
    en: "The seven status objects are never collapsed: each holds a value of its own enum only; OVERDUE and acknowledgement are never statuses.",
    sources: [
      'CHARTER.md §3.4 ("never collapsed into one field")',
      `${DIRECTIVE}:306-338 (§4.1: seven distinct objects; :338 "Do not collapse these concepts into a universal status field.")`,
      "cdf_case_management/docs/business-architecture/TARGET_WORKFLOW_STATE_MODEL.md §1 (one current value per dimension)",
    ],
    check(ctx) {
      const v: string[] = [];
      for (const o of objs(ctx)) {
        const id = objId(o);
        if (!has(PROCEDURAL_OBJECT_TYPES, o.type)) {
          v.push(`object ${id}: type ${String(o.type)} is not a ProceduralObject type`);
          continue;
        }
        const lc = lifecycleOf(o.type);
        if (lc === "none") {
          if (!isNil(o.status))
            v.push(
              `${o.type} ${id}: has status ${o.status} but ${o.type} has no status object (SOURCE_REQUIRED)`,
            );
          continue;
        }
        if (!has(STATUS_OBJECTS[lc].states, o.status))
          v.push(`${o.type} ${id}: status ${String(o.status)} is not a ${lc} value`);
        for (const s of arr(o.steps))
          if (!has(LAYER_A_STATE_IDS, s.actual))
            v.push(
              `${o.type} ${id} step ${s.step_id}: actual ${String(s.actual)} is not an Actual Progress state`,
            );
      }
      const n = notif(ctx);
      if (n && !has(STATUS_OBJECTS.NotificationStatus.states, n.status))
        v.push(`notification status ${String(n.status)} is not a NotificationStatus value`);
      for (const a of attempts(ctx))
        if (!has(STATUS_OBJECTS.DeliveryStatus.states, a.status))
          v.push(`attempt ${a.attempt_id}: ${String(a.status)} is not a DeliveryStatus value`);
      for (const x of arr(ctx.evidence))
        if (
          x &&
          x.kind === "DELIVERY_ATTEMPT" &&
          !has(STATUS_OBJECTS.DeliveryStatus.states, x.data && x.data.status)
        )
          v.push(
            `evidence ${entryRef(x)}: attempt status ${String(x.data && x.data.status)} is not a DeliveryStatus value`,
          );
      for (const x of arr(ctx.notification_versions))
        if (x && x !== n && !has(STATUS_OBJECTS.NotificationStatus.states, x.status))
          v.push(
            `notification ${x.notification_id} v${String(x.version)}: status ${String(x.status)} is not a NotificationStatus value`,
          );
      const c = ctx.case;
      if (c && c.exists !== false) {
        if (!c.status || !isV8Code(c.status.code))
          v.push(`case status.code ${String(c.status && c.status.code)} is not a V8 code`);
        for (const [k, val] of Object.entries(c.flags || {})) {
          if (!has(CASE_FLAGS, k)) v.push(`case flag ${k} is not one of ${CASE_FLAGS.join(", ")}`);
          else if (typeof val !== "boolean") v.push(`case flag ${k} is not boolean`);
        }
      }
      for (const s of stmts(ctx)) {
        if (isNil(s.asserts_status) || !s.about) continue;
        const t = s.about.type;
        if (t === "CASE") {
          if (!isV8Code(s.asserts_status)) v.push(`${s.id}: ${s.asserts_status} is not a CaseStatus value`);
          continue;
        }
        if (!has(LIFECYCLE_CONCEPTS, t)) {
          v.push(`${s.id}: ${t} has no status object`);
          continue;
        }
        const so = STATUS_OBJECTS[lifecycleOf(t) as StatusObjectName];
        if (!has(so.states, s.asserts_status))
          v.push(`${s.id}: ${s.asserts_status} is not a ${so.name} value (status vocabularies collapsed)`);
      }
      for (const a of layerA(ctx))
        if (!has(LAYER_A_STATE_IDS, a.display_state))
          v.push(`Actual Progress ${a.step_id}: ${String(a.display_state)} is not a Layer A state`);
      for (const b of layerB(ctx))
        if (!has(LAYER_B_KIND_IDS, b.kind))
          v.push(`Expected Process ${b.step_id}: ${String(b.kind)} is not a Layer B kind`);
      return result(v, "seven separate enums respected");
    },
  }),
  inv({
    id: "INV-16",
    severity: "BLOCK",
    origin: "directive §4.1 :306-338; charter §3.2, §3.4",
    label: "FACT",
    related_pc: [],
    ar: "استقلال الحالة: كل حالة مسجَّلة يسندها حدث مسجَّل يسمّي الكائن نفسه ويقود إلى تلك الحالة في جدوله؛ لا تُشتق حالة كائن من حالة كائن آخر.",
    en: "Status independence: every recorded status rests on a recorded event that names the object itself and leads into that status in its own table; no object's status is derived from another's.",
    sources: [
      "CHARTER.md §3.2 (status_source_event_id), §3.4",
      "src/domain/status.js FORBIDDEN_DERIVATIONS FD-01…FD-12",
    ],
    check(ctx) {
      const v: string[] = [];
      for (const o of objs(ctx)) {
        if (!has(LIFECYCLE_CONCEPTS, o.type)) continue;
        const c = checkStatusEvidence(o, evs(ctx));
        if (!c.ok) v.push(`${o.type} ${objId(o)}: ${c.detail}`);
      }
      const n = notif(ctx);
      if (n) {
        const c = checkStatusEvidence(
          {
            type: "NOTIFICATION",
            notification_id: n.notification_id,
            version: n.version,
            status: n.status,
            status_source_event_id: n.status_source_event_id,
          },
          evs(ctx),
        );
        if (!c.ok) v.push(`notification: ${c.detail}`);
      }
      for (const a of attempts(ctx)) {
        const c = checkStatusEvidence(
          {
            type: "DELIVERY_ATTEMPT",
            attempt_id: a.attempt_id,
            status: a.status,
            status_source_event_id: a.status_source_event_id,
          },
          evs(ctx),
        );
        if (!c.ok) v.push(`attempt ${a.attempt_id}: ${c.detail}`);
      }
      if (ctx.case && ctx.case.exists !== false) {
        const c = checkCaseEvidence(ctx.case, evs(ctx));
        if (!c.ok) v.push(`case: ${c.detail}`);
      }
      return result(v, "every status rests on its own event");
    },
  }),
  inv({
    id: "INV-17",
    severity: "WARN",
    origin: "directive §4.1 :306-338; charter §3.4, §9",
    label: "PROPOSAL",
    related_pc: [],
    ar: "صحة الانتقالات: تتابع الأحداث المسجَّلة لكل كائن يتبع جدول انتقالاته وينتهي بالحالة المسجَّلة؛ ويُعرض الانتقال خارج V8 كما سُجّل مع تنبيه، ولا يُصحَّح بصمت.",
    en: "Transition validity: each object’s recorded events follow its transition table and end in the recorded status; a case move outside V8 is shown as recorded and flagged, never silently corrected.",
    sources: ["CHARTER.md §3.4, §9", "notifications/generator/source/tests/v9_data.json transitions[34]"],
    check(ctx) {
      const v: string[] = [];
      const hist = (
        type: string,
        id: unknown,
        recorded: string | null | undefined,
        options: FoldOptions = {},
      ): void => {
        const h = checkHistory(type, id, evs(ctx), options);
        const tag = !isNil(options.version)
          ? `${type} ${String(id)} v${options.version}`
          : `${type} ${String(id)}`;
        for (const p of h.problems) v.push(`${tag}: ${p}`);
        if (!isNil(h.final) && !isNil(recorded) && h.final !== recorded)
          v.push(`${tag}: events end in ${h.final}, record says ${recorded}`);
      };
      for (const o of objs(ctx))
        if (has(LIFECYCLE_CONCEPTS, o.type)) hist(o.type as string, objId(o), o.status);
      // A notification lineage mixes its versions' lifecycles: each version is folded on its own (L-04).
      const n = notif(ctx);
      const seenV = new Set();
      for (const x of [...arr(ctx.notification_versions), ...(n ? [n] : [])]) {
        const key = x ? `${x.notification_id}#${x.version ?? 1}` : null;
        if (!x || seenV.has(key)) continue;
        seenV.add(key);
        hist("NOTIFICATION", x.notification_id, x.status, { version: x.version ?? 1 });
      }
      for (const a of attempts(ctx)) hist("DELIVERY_ATTEMPT", a.attempt_id, a.status);
      if (ctx.case && ctx.case.exists !== false)
        hist("CASE", ctx.case.case_id, ctx.case.status && ctx.case.status.code);
      return result(v, "recorded histories follow the tables");
    },
  }),
  inv({
    id: "INV-18",
    severity: "BLOCK",
    origin: "directive §4.2 :342, §7; charter §3.5, §3.6, §7",
    label: "FACT",
    related_pc: ["PC-09"],
    ar: "كل عبارة إجرائية معروضة تحمل فئة معرفية صحيحة تلائم حالة عرضها؛ الإنجاز الفعلي وقائع، والإجراء المتوقع توقعات، والإجراء التالي مقترح.",
    en: "Every displayed procedural statement carries a valid epistemic class matching its display state; actual progress is fact, expected process is expectation, the next action is proposed.",
    sources: [
      `${DIRECTIVE}:342 (§4.2 "Every displayed procedural statement must have a defined knowledge status."), :346-352 (the seven classes)`,
      'CHARTER.md §3.5 ("every displayed procedural statement carries one"), §3.2 (step epistemic), §3.6, §7 ("epistemic":"PROPOSED_ACTION")',
    ],
    check(ctx) {
      const v: string[] = [];
      for (const s of stmts(ctx)) {
        if (!has(EPISTEMIC_CLASSES, s.epistemic)) {
          v.push(`${s.id}: epistemic ${String(s.epistemic)} is not a class`);
          continue;
        }
        if (!isNil(s.display_state) && !displayStateAllows(s.display_state, s.epistemic))
          v.push(`${s.id}: ${s.display_state} cannot carry ${s.epistemic}`);
      }
      for (const a of layerA(ctx)) {
        if (!has(["RECORDED_FACT", "DERIVED_FROM_VERIFIED_FACTS", "NOT_APPLICABLE"], a.epistemic))
          v.push(`Actual Progress ${a.step_id}: epistemic ${String(a.epistemic)}`);
        else if (!displayStateAllows(a.display_state, a.epistemic))
          v.push(`Actual Progress ${a.step_id}: ${a.display_state} cannot carry ${a.epistemic}`);
      }
      for (const b of layerB(ctx)) {
        if (!has(["EXPECTED_PROCESS", "CONDITIONAL_STEP", "PROPOSED_ACTION"], b.epistemic))
          v.push(`Expected Process ${b.step_id}: epistemic ${String(b.epistemic)}`);
        else if (!displayStateAllows(b.kind, b.epistemic))
          v.push(`Expected Process ${b.step_id}: ${b.kind} cannot carry ${b.epistemic}`);
      }
      const na = notif(ctx) && notif(ctx)!.next_action;
      if (na) {
        if (na.epistemic !== "PROPOSED_ACTION")
          v.push(`next_action epistemic ${String(na.epistemic)} ≠ PROPOSED_ACTION`);
        for (const w of arr(na.what_next))
          if (!has(["EXPECTED", "CONDITIONAL"], w!.kind))
            v.push(`next_action.what_next kind ${String(w!.kind)}`);
      }
      for (const o of objs(ctx))
        for (const s of arr(o.steps))
          if (!has(["RECORDED_FACT", "DERIVED_FROM_VERIFIED_FACTS", "NOT_APPLICABLE"], s.epistemic))
            v.push(`${o.type} ${objId(o)} step ${s.step_id}: epistemic ${String(s.epistemic)}`);
      return result(v, "every statement classed");
    },
  }),
  inv({
    id: "INV-19",
    severity: "BLOCK",
    origin: "directive §4.2 :356-358; charter §0.5",
    label: "FACT",
    related_pc: [],
    ar: "سقف اليقين: لا تتجاوز درجة يقين العرض درجة يقين مصدره؛ والادعاء غير المسنود يُعدّ معلومة غير متحقَّق منها.",
    en: "Certainty ceiling: no display claims more certainty than its source; an unsupported claim counts as unverified information.",
    sources: [
      `${DIRECTIVE}:356-358 (§4.2 mandatory invariant: "The certainty of the interface must never exceed the certainty of its authoritative source."), :162 (§2.2)`,
      'CHARTER.md §0.5 ("The certainty of any display never exceeds the certainty of its authoritative source")',
    ],
    check(ctx) {
      const v: string[] = [];
      for (const s of stmts(ctx)) {
        if (!has(EPISTEMIC_CLASSES, s.epistemic)) continue; // INV-18
        let ceiling: string = sourceCeiling(s.source, evs(ctx));
        const c = checkClaim(ctx, s);
        if (c.claim && !c.ok) ceiling = "UNVERIFIED_INFORMATION";
        if (exceeds(s.epistemic as string, ceiling))
          v.push(
            `${s.id}: ${s.epistemic} exceeds its ceiling ${ceiling} (source ${String(s.source && s.source.kind)}${c.claim && !c.ok ? "; claim unsupported" : ""})`,
          );
      }
      for (const a of layerA(ctx)) {
        if (!has(["RECORDED_FACT", "DERIVED_FROM_VERIFIED_FACTS"], a.epistemic)) continue;
        let ceiling: string = "UNVERIFIED_INFORMATION";
        if (!isNil(a.evidence_event_id)) {
          const ev = evById(ctx, a.evidence_event_id);
          if (ev)
            ceiling =
              PROVENANCE_CEILING[(ev.provenance && ev.provenance.source) as string] ||
              "UNVERIFIED_INFORMATION";
        } else if (has(["PENDING", "NOT_APPLICABLE"], a.display_state))
          ceiling = "DERIVED_FROM_VERIFIED_FACTS";
        if (exceeds(a.epistemic as string, ceiling))
          v.push(`Actual Progress ${a.step_id}: ${a.epistemic} exceeds ${ceiling}`);
      }
      return result(v, "no display exceeds its source");
    },
  }),
  inv({
    id: "INV-20",
    severity: "BLOCK",
    origin: "directive §4.3 :374; charter §3.2, §3.5, §7",
    label: "FACT",
    related_pc: ["PC-05"],
    directive_example: dx(374, "A procedural deadline cannot start from an assumed event."),
    ar: "لا تبدأ مهلة إجرائية من حدث مفترض: لكل مهلة معروضة حدث أساس مسجَّل ومتحقَّق منه، وقاعدة مسمّاة (≠ SOURCE_REQUIRED) حدثُها المُطلِق هو نوع حدث الأساس.",
    en: "A procedural deadline cannot start from an assumed event: every displayed deadline has a recorded, verified basis event and a named rule (≠ SOURCE_REQUIRED) whose trigger is the basis event type.",
    sources: [
      `${DIRECTIVE}:374 (§4.3), :1116 (§16 "Deadline calculated from the wrong triggering event.")`,
      'CHARTER.md §3.5 (safe inference), §7 ("else null + reason SOURCE_REQUIRED"), §8 PC-05',
      "review/v12-forensic/deliverables/D6_findings_register.csv:4 (MF-003)",
    ],
    check(ctx) {
      const v: string[] = [];
      const rules = ctx.deadline_rules || null;
      const n = notif(ctx);
      const displayed: [string, DeadlineRecord][] = [
        ...arr(n && n.deadlines).map((d): [string, DeadlineRecord] => ["notification.deadlines", d]),
        ...(n && n.next_action && n.next_action.deadline
          ? [["next_action.deadline", n.next_action.deadline] as [string, DeadlineRecord]]
          : []),
      ];
      for (const [where, d] of displayed) {
        if (!isIso(d.at)) v.push(`${where}: at ${String(d.at)} is not an ISO timestamp`);
        const ev = evById(ctx, d.basis_event_id);
        if (!ev) {
          v.push(`${where}: basis event ${String(d.basis_event_id)} not recorded`);
          continue;
        }
        if (
          exceeds(
            "DERIVED_FROM_VERIFIED_FACTS",
            PROVENANCE_CEILING[(ev.provenance && ev.provenance.source) as string] || "UNVERIFIED_INFORMATION",
          )
        )
          v.push(
            `${where}: basis ${ev.event_id} has provenance ${String(ev.provenance && ev.provenance.source)}, not a verified record: a deadline never starts from an assumed event`,
          );
        if (!d.basis_rule || d.basis_rule === "SOURCE_REQUIRED") {
          v.push(`${where}: rule ${String(d.basis_rule)} — a SOURCE_REQUIRED deadline is never displayed`);
          continue;
        }
        if (!rules || !rules[d.basis_rule]) {
          v.push(`${where}: rule ${d.basis_rule} is not in the rule set (never invented)`);
          continue;
        }
        if (rules[d.basis_rule]!.trigger_event_type !== ev.type)
          v.push(
            `${where}: basis ${ev.type} is not the trigger ${String(rules[d.basis_rule]!.trigger_event_type)} of ${d.basis_rule}`,
          );
      }
      for (const o of objs(ctx))
        for (const d of arr(o.deadlines)) {
          const where = `${o.type} ${objId(o)} deadline ${d.kind}`;
          if (isNil(d.basis_event_id)) {
            if (d.basis_rule !== "SOURCE_REQUIRED") v.push(`${where}: no basis event`);
            continue;
          }
          const ev = evById(ctx, d.basis_event_id);
          if (!ev) {
            v.push(`${where}: basis event ${d.basis_event_id} not recorded`);
            continue;
          }
          if (
            d.basis_rule &&
            d.basis_rule !== "SOURCE_REQUIRED" &&
            rules &&
            rules[d.basis_rule] &&
            rules[d.basis_rule]!.trigger_event_type !== ev.type
          )
            v.push(`${where}: basis ${ev.type} is not the trigger of ${d.basis_rule}`);
        }
      return result(v, "deadlines have recorded bases");
    },
  }),
  inv({
    id: "INV-21",
    severity: "BLOCK",
    origin: "charter §3.3, §9",
    label: "FACT",
    related_pc: [],
    ar: "سلامة الأحداث: معرّف فريد، ونوع معروف، وتسجيل لا يسبق الوقوع، وسببية إلى حدث سابق، وإصدار ≥ 1، ومصدر من القائمة، وكائن يلائم النوع.",
    en: "Event integrity: unique id, known type, recorded not before occurred, causation to an earlier event, version ≥ 1, provenance from the list, object type allowed for the event type.",
    sources: ["CHARTER.md §3.3 (Event), §9 (ordering by occurred_at then recorded_at)"],
    check(ctx) {
      const v: string[] = [];
      const seen = new Set();
      for (const e of evs(ctx)) {
        const id = e && e.event_id;
        if (!id) {
          v.push("event without event_id");
          continue;
        }
        if (seen.has(id)) v.push(`${id}: duplicate event_id`);
        seen.add(id);
        if (!isKnownEventType(e.type)) {
          v.push(`${id}: unknown type ${String(e.type)}`);
          continue;
        }
        if (!isIso(e.occurred_at) || !isIso(e.recorded_at))
          v.push(`${id}: occurred_at / recorded_at not ISO`);
        else if (Date.parse(e.recorded_at as string) < Date.parse(e.occurred_at as string))
          v.push(`${id}: recorded_at before occurred_at`);
        if (!Number.isInteger(e.version) || (e.version as number) < 1)
          v.push(`${id}: version ${String(e.version)} < 1`);
        if (!e.provenance || !has(Object.keys(PROVENANCE_CEILING), e.provenance.source))
          v.push(`${id}: provenance ${String(e.provenance && e.provenance.source)}`);
        if (!e.actor || !e.actor.capacity) v.push(`${id}: actor capacity missing`);
        if (!e.correlation_id) v.push(`${id}: correlation_id missing`);
        if (!isNil(e.causation_id)) {
          const p = evById(ctx, e.causation_id);
          if (!p) v.push(`${id}: causation ${e.causation_id} not recorded`);
          else if (
            p.event_id === id ||
            Date.parse(p.occurred_at as string) > Date.parse(e.occurred_at as string)
          )
            v.push(`${id}: caused by a later event ${p.event_id}`);
        }
        const cat = EVENT_CATALOGUE[e.type]!;
        if (!isNil(e.object)) {
          if (!has(cat.object_types, e.object.type))
            v.push(
              `${id}: ${e.type} cannot name a ${String(e.object.type)} as object (allowed ${cat.object_types.join(", ")})`,
            );
        } else if (cat.domain !== "A") v.push(`${id}: ${e.type} names no object`);
        if (cat.domain === "A" && !e.case_id) v.push(`${id}: case event without case_id`);
      }
      return result(v, `${evs(ctx).length} events well-formed`);
    },
  }),
  inv({
    id: "INV-22",
    severity: "BLOCK",
    origin: "charter §3.4, §9, §10 read per work/LEAD_notes.md L-07 and L-02; directive §13 :1001-1011",
    label: "FACT",
    related_pc: ["PC-15", "PC-16"],
    ar: "سلسلة دليل التسليم: لا محاولة قبل الإدراج في الطابور، ولا «أُرسل — لم يُؤكَّد التسليم» دون محاولة، ولا «تأكد التسليم» إلا بدليل تسليم من نوعه: تقرير تسليم من مزوّد البريد للبريد الإلكتروني (ونجاحُ المرسِل في الإعداد الصريح SETTLEMENT وحده)، وصفُّ صندوق الإشعارات في المنصة للإشعار داخل التطبيق؛ ونجاح المرسِل وحده يُبقي الإشعار «أُرسل — لم يُؤكَّد التسليم».",
    en: "Delivery evidence chain: no attempt before QUEUED, no SENT without an attempt, and DELIVERY_CONFIRMED only with delivery evidence of its kind: a provider delivery report for e-mail (the sender’s success only under the explicit SETTLEMENT configuration), the committed platform inbox row for in-app; a sender success alone leaves the notification SENT (“Sent — delivery not confirmed”).",
    sources: [
      "work/LEAD_notes.md L-07 (ACCEPTANCE default: a sender success is DELIVERY_ACCEPTED_BY_PROVIDER and the notification stays SENT; DELIVERY_CONFIRMED needs a provider delivery report; SETTLEMENT explicit and non-default; INV-22 reads the evidence entries, D5), L-02 (in-app: SENT = DELIVERY_CONFIRMED), L-08 (one wording for SENT)",
      `${DIRECTIVE}:1001-1011 (§13 "Distinguish: … Dispatch. Provider acceptance. Delivery evidence. Recipient acknowledgment. … Do not treat these as interchangeable.")`,
      "CHARTER.md §3.4 (DeliveryStatus per attempt), §9",
      "cdf_case_management/infrastructure/supabase/migrations/20261007001920_notification_engine.sql:118-125, 580-615",
      "W-D1 src/lifecycle/notification.js (DELIVERY_ATTEMPT evidence entries; DELIVERY_CONFIRMED.payload.evidence_kind)",
    ],
    check(ctx) {
      const v: string[] = [];
      const n = notif(ctx);
      if (!n) return result([], "no notification");
      const mode = deliveryMode(ctx);
      if (!has(DELIVERY_CONFIRMATION_MODES, mode))
        return result([
          `delivery_confirmation ${String(mode)} is not one of ${DELIVERY_CONFIRMATION_MODES.join(", ")} (L-07)`,
        ]);
      const nid = n.notification_id;
      const ver = n.version ?? 1;
      const channel = n.channel ?? "EMAIL";
      const all = evs(ctx);
      const mineEv = (e: DomainEvent) =>
        (eventConcerns(e, "NOTIFICATION", nid) || (e.payload && e.payload.notification_id === nid)) &&
        (e.version ?? 1) === ver;
      const queued =
        all.filter((e) => e.type === "NOTIFICATION_QUEUED" && mineEv(e)).sort(compareEvents)[0] || null;
      const tQueued = queued ? Date.parse(queued.occurred_at as string) : null;
      const entries = evidenceOf(ctx, nid, ver, "DELIVERY_ATTEMPT");
      const legacy = attempts(ctx).filter(
        (a) => a.notification_id === nid && (isNil(a.version) || a.version === ver),
      );
      const attemptEvents = all.filter((e) => e.type === "DELIVERY_ATTEMPTED" && mineEv(e));
      for (const e of attemptEvents)
        if (!queued || !before(queued, e)) v.push(`${e.event_id}: attempt before NOTIFICATION_QUEUED`);
      for (const x of entries) {
        const t = entryTime(x);
        if (isNil(tQueued) || Number.isNaN(t) || t < tQueued)
          v.push(
            `evidence ${entryRef(x)}: delivery attempt ${String(x.data && x.data.attempt)} (${String(x.data && x.data.status)}) before NOTIFICATION_QUEUED`,
          );
      }
      if (legacy.length && !queued) v.push(`attempt records exist but notification ${nid} was never queued`);
      const count = entries.length + legacy.length + attemptEvents.length;
      if (has(["SENT", "DELIVERY_CONFIRMED", "DELIVERY_FAILED"], n.status) && count === 0)
        v.push(`notification ${n.status} without any delivery attempt`);
      if (has(PRE_QUEUE, n.status) && count > 0)
        v.push(`notification ${n.status} already has delivery attempts`);
      const acceptedCount =
        entries.filter((x) => x.data && x.data.status === "ACCEPTED_BY_PROVIDER").length +
        legacy.filter((a) => a.status === "ACCEPTED_BY_PROVIDER").length +
        all.filter((e) => e.type === "DELIVERY_ACCEPTED_BY_PROVIDER" && mineEv(e)).length;
      if (n.status === "DELIVERY_CONFIRMED") {
        const dc =
          all
            .filter((e) => e.type === "DELIVERY_CONFIRMED" && mineEv(e))
            .sort(compareEvents)
            .at(-1) || evById(ctx, n.status_source_event_id);
        const kind = dc && dc.payload ? (dc.payload.evidence_kind ?? null) : null;
        const kinds = Object.keys(DELIVERY_EVIDENCE_KINDS).filter(
          (k) =>
            DELIVERY_EVIDENCE_KINDS[k]!.channel === channel && has(DELIVERY_EVIDENCE_KINDS[k]!.modes, mode),
        );
        if (channel === "IN_APP") {
          if (!isNil(kind) && !has(kinds, kind))
            v.push(
              `IN_APP DELIVERY_CONFIRMED with evidence_kind ${kind}; in-app delivery is the inbox row (${kinds.join(" / ")}, L-02)`,
            );
          if (acceptedCount === 0 && kind !== "IN_APP_ROW_CREATED")
            v.push(
              "IN_APP DELIVERY_CONFIRMED without the inbox row (an accepted attempt or evidence_kind IN_APP_ROW_CREATED, L-02)",
            );
        } else {
          if (!has(kinds, kind))
            v.push(
              `${channel} DELIVERY_CONFIRMED with evidence_kind ${String(kind)}; under ${mode} it needs ${kinds.join(" or ") || "a delivery evidence kind of its channel"} (L-07)${kind === "SENDER_ADAPTER_REPORTED_SUCCESS" ? ": a sender success alone leaves the notification SENT" : ""}`,
            );
          if (acceptedCount === 0) v.push("DELIVERY_CONFIRMED without an attempt ACCEPTED_BY_PROVIDER");
        }
      }
      if (n.status === "DELIVERY_FAILED") {
        const latest =
          [...entries].sort((a, b) => entryTime(a) - entryTime(b) || (a.seq ?? 0) - (b.seq ?? 0)).at(-1) ||
          null;
        const lastStatus = latest
          ? latest.data && latest.data.status
          : legacy.length
            ? legacy.at(-1)!.status
            : null;
        if (lastStatus === "ACCEPTED_BY_PROVIDER")
          v.push("DELIVERY_FAILED while the latest attempt is ACCEPTED_BY_PROVIDER");
      }
      return result(v, "delivery chain complete");
    },
  }),
  inv({
    id: "INV-23",
    severity: "BLOCK",
    origin: "charter §0.6, §9; directive §2.4 :168-170",
    label: "FACT",
    related_pc: ["PC-06"],
    ar: "الإفصاح قبل العرض: الإشعار الذي بلغ VALIDATED أو ما بعدها مرّ بإسقاط الإفصاح (_disclosure_applied === true).",
    en: "Disclosure before rendering: a notification at VALIDATED or later has passed the disclosure projection (_disclosure_applied === true).",
    sources: [
      'CHARTER.md §0.6, §9 ("VALIDATED (consistency ok, disclosure applied)")',
      `${DIRECTIVE}:170 (§2.4 "Confidentiality restrictions must be applied before content is passed to any renderer.")`,
      "work/LEAD_notes.md L-04 (CORRECTED is the entry state of a correcting version, before its validation)",
    ],
    check(ctx) {
      const n = notif(ctx);
      if (!n || !has(DISCLOSED_STATES, n.status)) return result([], "not yet validated");
      return result(
        n._disclosure_applied === true
          ? []
          : [`notification ${n.status} with _disclosure_applied = ${String(n._disclosure_applied)}`],
        "projection applied",
      );
    },
  }),
  inv({
    id: "INV-24",
    severity: "BLOCK",
    origin: "charter §9 (corrections) read per work/LEAD_notes.md L-04; §2 G; directive §13 :997-999",
    label: "FACT",
    related_pc: [],
    ar: "التصحيح يحفظ التاريخ: يُصحَّح الإشعار الصادر بإصدار أحدث يبدأ بحالة «تصحيح قيد الإعداد» ويذكر الإصدار الذي يصححه وسبب التصحيح، ويبقى الإصدار الأقدم هو الساري حتى يُرسل الإصدار المصحِّح فيصبح عندها «حلّ محله إصدار أحدث أُرسل»؛ ولا يُعدَّل إصدار صدر، والتصحيح الملغى يُبقي الأقدم سارياً.",
    en: "Corrections preserve history: an issued notification is corrected by a newer version that enters in CORRECTED, naming the version it corrects and a reason; the older version stays current until the correcting version is SENT, and only then becomes SUPERSEDED; an issued version is never edited, and a cancelled correction leaves the older version current.",
    sources: [
      "work/LEAD_notes.md L-04 items 1-5 (lead decision, binding for V13; closes W-A gap G-03)",
      'CHARTER.md §9 ("SENT/DELIVERY_* → CORRECTED (new version, old SUPERSEDED)", lineage level per L-04 item 5), §2 G (notification versions)',
      `${DIRECTIVE}:997-999 (§13 states CORRECTED, SUPERSEDED)`,
      "W-D1 src/lifecycle/notification.js (ALLOWED_TRANSITIONS, LINEAGE_TRANSITIONS, lineage(); tests/lifecycle.test.js LC-23)",
      "src/domain/status.js checkLineage",
    ],
    check(ctx) {
      const v: string[] = [];
      const explicit = arr(ctx.notification_versions).length > 0;
      const list = explicit ? arr(ctx.notification_versions) : notif(ctx) ? [notif(ctx)] : [];
      const groups = new Map();
      for (const x of list) {
        if (!x) continue;
        if (!groups.has(x.notification_id)) groups.set(x.notification_id, []);
        groups.get(x.notification_id).push(x);
      }
      for (const e of evs(ctx))
        if (
          e &&
          has(["NOTIFICATION_CORRECTED", "NOTIFICATION_SUPERSEDED"], e.type) &&
          e.object &&
          e.object.type === "NOTIFICATION" &&
          !groups.has(e.object.id)
        )
          groups.set(e.object.id, []);
      for (const [nid, vs] of groups) {
        const mine = evs(ctx).filter((e) => e && eventConcerns(e, "NOTIFICATION", nid));
        const evidence = Array.isArray(ctx.evidence)
          ? ctx.evidence.filter((x) => x && x.notification_id === nid)
          : null;
        const r = checkLineage(vs, mine, { ...(evidence ? { evidence } : {}), partial: !explicit });
        for (const p of r.problems) v.push(`${nid} ${p}`);
      }
      return result(v, "version history preserved; one current version (L-04)");
    },
  }),
  inv({
    id: "INV-25",
    severity: "BLOCK",
    origin:
      "second independent review :748-756 (Knowledge ≠ Authority ≠ Execution); directive §2.3 :164-166; charter §2 C, §6",
    label: "INFERENCE",
    related_pc: ["PC-08"],
    ar: "الإسناد من السجل: يُنسب الفعل إلى من قام به كما سُجّل (performed_by)، لا إلى من سجّله؛ ومن سجّل القرار ليس صاحب القرار.",
    en: "Attribution from the record: an act is attributed to its recorded performer (performed_by), not to whoever recorded it; the recorder of a decision is not its maker.",
    sources: [
      `work/owner_messages_2026-10-27/second_independent_review_ar_16-08-21Z.txt:748-756 ("Knowledge ≠ Authority ≠ Execution": الاطلاع لا يمنح صلاحية القرار…)`,
      `${DIRECTIVE}:166 (§2.3 "The software must enforce authorized decision rights, not create them.")`,
      "CHARTER.md §2 C, §6",
      "cdf_case_management/docs/business-architecture/TARGET_WORKFLOW_STATE_MODEL.md §3.7 (decision RECORDED by the secretary)",
      "review/v12-forensic/deliverables/D8_future_state_V13_design.md:72 (2 of 62 authority claims SUPPORTED)",
    ],
    check(ctx) {
      const v: string[] = [];
      for (const s of stmts(ctx)) {
        if (!s.actor_capacity) continue;
        const ev = evById(ctx, s.evidence_event_id);
        if (!ev) {
          v.push(`${s.id}: attributes an act to ${s.actor_capacity} without a recorded event`);
          continue;
        }
        const performedBy =
          ev.payload &&
          ev.payload.performed_by &&
          (ev.payload.performed_by as { capacity?: unknown }).capacity;
        if (has(RECORDED_ON_BEHALF_EVENTS, ev.type) && !performedBy) {
          v.push(
            `${s.id}: ${ev.type} records no performed_by; the recorder ${String(ev.actor && ev.actor.capacity)} is not the maker`,
          );
          continue;
        }
        const performer = performedBy || (ev.actor && ev.actor.capacity);
        if (performer !== s.actor_capacity)
          v.push(
            `${s.id}: attributes ${ev.type} to ${s.actor_capacity}; the record says ${String(performer)}`,
          );
      }
      return result(v, "attribution follows the record");
    },
  }),
  inv({
    id: "INV-26",
    severity: "BLOCK",
    origin: "charter §0.2; CLAUDE.md data safety (protocol §2)",
    label: "FACT",
    related_pc: [],
    ar: "بيانات اصطناعية فقط: كل بريد ينتهي بـ example.test، وكل مرجع قضية بصيغة CDF-DEMO-2026-nnnn، وكل رابط على نطاق example.test.",
    en: "Synthetic data only: every e-mail ends in @example.test, every case reference is CDF-DEMO-YYYY-nnnn, every URL host is example.test.",
    sources: ["CHARTER.md §0.2", 'cdf_case_management/CLAUDE.md section 1 "Data safety" (protocol §2)'],
    check(ctx) {
      const v: string[] = [];
      const seen = new WeakSet<object>();
      const walk = (x: unknown, path: string): void => {
        if (typeof x === "string") {
          for (const m of x.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g))
            if (!/@([a-z0-9-]+\.)*example\.test$/i.test(m[0]))
              v.push(`${path}: e-mail ${m[0]} is not @example.test`);
          for (const m of x.matchAll(/https?:\/\/([^/\s:?#"'<>]+)/gi))
            if (!/^([a-z0-9-]+\.)*example\.test$/i.test(m[1] as string))
              v.push(`${path}: URL host ${m[1]} is not example.test`);
          for (const m of x.matchAll(/\bCDF-(?:[A-Z]{2}|DEMO)-\d{4}-[A-Z0-9-]+/g))
            if (!/^CDF-DEMO-\d{4}-\d{4}$/.test(m[0]))
              v.push(`${path}: case reference ${m[0]} is not a DEMO reference`);
          return;
        }
        if (!x || typeof x !== "object" || seen.has(x)) return;
        seen.add(x);
        for (const [k, val] of Object.entries(x)) {
          if (
            (k === "internal_ref" || k === "case_number") &&
            !isNil(val) &&
            !(typeof val === "string" && /^CDF-DEMO-\d{4}-\d{4}$/.test(val))
          )
            v.push(`${path}.${k}: ${String(val)} is not a DEMO reference`);
          walk(val, `${path}.${k}`);
        }
      };
      walk(ctx, "ctx");
      return result(v, "synthetic markers only");
    },
  }),
  inv({
    id: "INV-27",
    severity: "BLOCK",
    origin: "work/LEAD_notes.md L-06; CLAUDE.md protocol §22, §39; platform 1890:875, 0700:799-801",
    label: "FACT",
    related_pc: ["PC-06"],
    ar: "الأحداث المحمية: لا تحمل حمولتها إلا ما يُسمح به (كشف هوية المبلِّغ: معرّف الطلب وحده؛ التصويت: دون الاختيار)، ولا يستشهد إشعار بحدث كشف الهوية ولا ينشأ عنه ولا يذكره.",
    en: "Protected events: their payloads carry only what is allowed (identity reveal: the request id only; votes: never the choice), and a notification never cites, follows from or names an identity-reveal event.",
    sources: [
      'work/LEAD_notes.md L-06 ("REPORTER_IDENTITY_REVEALED stays ids-only and never appears in a notification")',
      "cdf_case_management/CLAUDE.md security rules (protocol §22 protected identity, §39 notifications carry no investigation content)",
      "cdf_case_management/infrastructure/supabase/migrations/20261007000700_api_commands.sql:799-801 (identity values never written to the ledger; payload {reveal_request_id})",
      "cdf_case_management/infrastructure/supabase/migrations/20261007001890_committee_meetings_votes_minutes.sql:875 (the ledger never records the choice)",
      "src/domain/concepts.js PROTECTED_EVENT_RULES",
    ],
    check(ctx) {
      const v: string[] = [];
      for (const e of evs(ctx)) {
        const r = e && own(PROTECTED_EVENT_RULES, e.type) ? PROTECTED_EVENT_RULES[e.type]! : null;
        if (!r) continue;
        const keys = Object.keys(e.payload || {});
        if (r.allowed_keys)
          for (const k of keys)
            if (!has(r.allowed_keys, k))
              v.push(`${e.event_id} ${e.type}: payload key ${k} (only ${r.allowed_keys.join(", ")})`);
        for (const k of r.forbidden_keys)
          if (has(keys, k)) v.push(`${e.event_id} ${e.type}: payload carries ${k}`);
      }
      const hiddenTypes = Object.keys(PROTECTED_EVENT_RULES).filter(
        (t) => PROTECTED_EVENT_RULES[t]!.never_in_notification,
      );
      const hiddenIds = new Set(
        evs(ctx)
          .filter((e) => e && has(hiddenTypes, e.type))
          .map((e) => e.event_id),
      );
      const n = notif(ctx);
      if (n) {
        for (const s of stmts(ctx)) {
          const cited = [
            s.evidence_event_id,
            s.source && s.source.event_id,
            ...arr(s.source && s.source.event_ids),
          ].filter((x) => !isNil(x));
          for (const id of cited) if (hiddenIds.has(id)) v.push(`${s.id}: cites the protected event ${id}`);
          if (s.asserts_event && has(hiddenTypes, s.asserts_event))
            v.push(`${s.id}: asserts ${s.asserts_event}`);
        }
        if (!isNil(n.originating_event_id) && hiddenIds.has(n.originating_event_id))
          v.push(`the notification originates in the protected event ${n.originating_event_id}`);
        const seen = new WeakSet<object>();
        const walk = (x: unknown, path: string): void => {
          if (typeof x === "string") {
            if (hiddenIds.has(x) || has(hiddenTypes, x)) v.push(`${path}: names ${x}`);
            return;
          }
          if (!x || typeof x !== "object" || seen.has(x)) return;
          seen.add(x);
          for (const [k, val] of Object.entries(x)) walk(val, `${path}.${k}`);
        };
        walk(n, "notification");
      }
      for (const x of arr(ctx.evidence))
        if (x && x.data && hiddenIds.has(x.data.originating_event_id as string))
          v.push(
            `evidence ${entryRef(x)}: issuance context originates in the protected event ${x.data.originating_event_id}`,
          );
      for (const e of evs(ctx)) {
        if (!e || !has(COMMUNICATION_EVENTS, e.type)) continue;
        const p = causedBy(ctx, e, (x) => hiddenIds.has(x.event_id));
        if (p) v.push(`${e.event_id} ${e.type} follows from the protected event ${p.event_id} ${p.type}`);
      }
      return result(v, "protected events stay out of notifications");
    },
  }),
]);

export const INVARIANT_IDS = Object.freeze(INVARIANTS.map((i) => i.id));

export function getInvariant(id: unknown): Invariant {
  const i = INVARIANTS.find((x) => x.id === id);
  if (!i) throw new Error(`UNKNOWN_INVARIANT: ${String(id)}`);
  return i;
}

/** Runs one invariant; a checker that throws is reported as a violation (fail closed), never swallowed. */
export function checkInvariant(id: unknown, ctx?: InvariantContext | null): CheckedInvariant {
  const i = getInvariant(id);
  try {
    return { id: id as string, severity: i.severity, ...i.check(ctx || {}) };
  } catch (e) {
    return {
      id: id as string,
      severity: i.severity,
      ok: false,
      detail: `checker error: ${(e as Error).message}`,
      violations: [`checker error: ${(e as Error).message}`],
    };
  }
}

/** checkAll(ctx) → {ok (no BLOCK violation), results[], violations[] (BLOCK), warnings[] (WARN)}. */
export function checkAll(ctx?: InvariantContext | null): CheckAllResult {
  const results = INVARIANTS.map((i) => checkInvariant(i.id, ctx));
  const violations = results.filter((r) => !r.ok && r.severity === "BLOCK");
  const warnings = results.filter((r) => !r.ok && r.severity === "WARN");
  return { ok: violations.length === 0, results, violations, warnings };
}
