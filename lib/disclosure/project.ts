import "server-only";
/**
 * CDF Notifications V13 — Disclosure projection (charter §5). Workstream W-D2.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * PRODUCTION_SUBSTITUTION_REQUIRED: in the platform the projection must run server-side, per recipient and per
 * notification, inside the notification service before any template is rendered (the platform today sends no
 * content at all: packages/application/src/notifications.ts, §39).
 *
 * Contract (charter §5):
 *   decide(policy, {recipient, field, channel, context}) → {outcome, basis[], rule, overrides[], …}
 *     resolution: most specific row wins — recipient+field+channel+context (15) > recipient+field+channel (14)
 *     > recipient+field+context (13) > recipient+field (12) > recipient+`*` (8…11) > `*`-recipient rows (0…7);
 *     ties → the most restrictive outcome; no matching row → PROHIBITED; unknown field/recipient/channel → PROHIBITED.
 *     Owner-decision ceilings (DEC-24, AMB-181, DEC-22, §39, §22, witness/scope rules, the six mandatory scenarios,
 *     the restricted-case rule) are applied after the rows and can only make an outcome MORE restrictive.
 *   project(model, {recipient, context, channel, policy}) → deep-frozen deep copy:
 *     REDACTED/PROHIBITED → field removed; GENERALIZED → class-safe bilingual generic text; SAFE_REFERENCE → opaque
 *     token; `_disclosure_applied: true`, `_disclosure_log` (field → outcome, basis, per-surface outcomes).
 *     `channel` may be one channel or an experience ('EMAIL' | 'PLATFORM'); for an experience the field is decided on
 *     every surface of that experience and the MOST RESTRICTIVE outcome is the one decision reused by subject,
 *     preheader, HTML, text, card, in-app, links, attachments, metadata, export and log output.
 *   assertProjected(model) — every renderer calls it first; throws on anything that did not come out of project().
 *
 * Restrictiveness order used for ties and ceilings: ALLOWED < SAFE_REFERENCE < GENERALIZED < REDACTED < PROHIBITED.
 * Labels: the rules here implement owner decisions and charter scenarios (FACT: cited); row data comes only from W-F's
 * policy_v13.json (status PROPOSED: PROPOSED ≠ APPROVED; no row is CDF policy until the owner approves it, D11-017).
 * W-F alignment (FACT, policy_v13.json): per-recipient generalized_texts; safe_reference wording «مرجع الإشعار: {notice_ref}»
 * with {notice_ref} = the notice version's own opaque reference; a recipient verified on a restricted case's access list is
 * projected without the CASE_RESTRICTED tag, while the case's RESTRICTED_CASE_AUTHORITY keeps its own rows.
 *
 * Port note: the policy is bundled as a static JSON import (no file system access in lib/). loadPolicy() keeps its name
 * and still accepts an override (`{policy}` object or JSON string); a missing/unreadable/empty override fails closed.
 */
import { createHash } from "node:crypto";
import { isNil } from "@/lib/domain/nil";
import policyJson from "./policy_v13.json";

/** the only policy in the code path: W-F's policy_v13.json (charter §1/§5). Informational in the port: the file is bundled
 *  through a static import. A missing policy fails closed (NO_POLICY), never falls back to a permissive default. */
export const POLICY_PATHS = Object.freeze({ wf: "lib/disclosure/policy_v13.json" } as const);

export type DisclosureErrorCode =
  | "NO_POLICY"
  | "UNKNOWN_CHANNEL"
  | "INVALID_MODEL"
  | "RECIPIENT_MISMATCH"
  | "UNKNOWN_RECIPIENT"
  | "UNPROJECTED_MODEL";
export class DisclosureError extends Error {
  readonly code: DisclosureErrorCode | string;
  constructor(code: DisclosureErrorCode | string, message: string) {
    super(message);
    this.name = "DisclosureError";
    this.code = code;
  }
}

export const OUTCOMES = Object.freeze([
  "ALLOWED",
  "SAFE_REFERENCE",
  "GENERALIZED",
  "REDACTED",
  "PROHIBITED",
] as const);
export type Outcome = (typeof OUTCOMES)[number];
const RANK: Readonly<Record<Outcome, number>> = Object.freeze({
  ALLOWED: 0,
  SAFE_REFERENCE: 1,
  GENERALIZED: 2,
  REDACTED: 3,
  PROHIBITED: 4,
});
const rank = (o: unknown): number =>
  typeof o === "string" && Object.prototype.hasOwnProperty.call(RANK, o)
    ? RANK[o as Outcome]
    : RANK.PROHIBITED;
export function moreRestrictive<T extends string>(a: T, b: T): T {
  return rank(a) >= rank(b) ? a : b;
}
const isOutcome = (o: string): o is Outcome => (OUTCOMES as readonly string[]).includes(o);

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
const isRecipient = (r: unknown): r is RecipientClass =>
  (RECIPIENT_CLASSES as readonly unknown[]).includes(r);
export const INTERNAL_CLASSES = Object.freeze([
  "SECRETARY",
  "CHAIR",
  "MEMBER",
  "INVESTIGATOR",
  "LEGAL_REVIEWER",
  "AUTHORITY",
  "RESTRICTED_CASE_AUTHORITY",
] as const);
/** scope/public recipients (owner decision: they see Level-1 stage names only) */
export const SCOPE_PUBLIC_CLASSES = Object.freeze([
  "REFERRING_BODY",
  "REPORTER",
  "SUBJECT",
  "WITNESS",
  "EVIDENCE_HOLDER",
  "RECUSED_MEMBER",
] as const);
export const EXTERNAL_CLASSES = Object.freeze([
  "REFERRING_BODY",
  "REPORTER",
  "SUBJECT",
  "WITNESS",
  "EVIDENCE_HOLDER",
] as const);
const inList = (list: readonly string[], v: unknown): boolean => list.includes(v as string);

export const CHANNELS = Object.freeze([
  "EMAIL_SUBJECT",
  "EMAIL_PREHEADER",
  "EMAIL_HTML",
  "EMAIL_TEXT",
  "CARD",
  "IN_APP",
  "LINK",
  "ATTACHMENT",
  "METADATA",
  "EXPORT",
  "LOG",
] as const);
export type Channel = (typeof CHANNELS)[number];
const isChannel = (c: unknown): c is Channel => (CHANNELS as readonly unknown[]).includes(c);
const EMAIL_CONTENT_CHANNELS: readonly string[] = Object.freeze([
  "EMAIL_SUBJECT",
  "EMAIL_PREHEADER",
  "EMAIL_HTML",
  "EMAIL_TEXT",
  "CARD",
]);
/** experience → the surfaces one decision must hold for */
export const EXPERIENCES = Object.freeze({
  EMAIL: Object.freeze([
    "EMAIL_SUBJECT",
    "EMAIL_PREHEADER",
    "EMAIL_HTML",
    "EMAIL_TEXT",
    "CARD",
    "LINK",
    "ATTACHMENT",
    "METADATA",
    "EXPORT",
    "LOG",
  ] as const),
  PLATFORM: Object.freeze(["IN_APP", "LINK", "ATTACHMENT", "METADATA", "EXPORT", "LOG"] as const),
});
export type Experience = keyof typeof EXPERIENCES;
export const CONTEXTS = Object.freeze(["CASE_RESTRICTED", "CASE_PUBLIC", "EXTERNAL"] as const);

/** charter §5 minimum field list */
export const CHARTER_FIELDS = Object.freeze([
  "case_number",
  "report_id",
  "internal_ref",
  "classification_marking",
  "l1_stage_name",
  "l1_substate",
  "l2_journey",
  "l3_steps",
  "procedural_status_text",
  "allegations",
  "investigation_details",
  "decision_outcome",
  "decision_reasons",
  "meeting_info",
  "member_names",
  "participant_names",
  "reporter_identity",
  "deadline",
  "deadline_basis",
  "links_internal",
  "links_portal",
  "attachments",
  "evidence_refs",
  "audit_refs",
  "card_content",
  "preheader",
  "subject_detail",
  "exception_indicator",
  "delivery_status",
] as const);
/** fields W-D2 renders that the charter minimum does not name (all present in W-F's policy_v13.json field list) */
export const WD2_FIELDS = Object.freeze([
  "event_title",
  "event_summary",
  "event_at",
  "recipient_capacity_label",
  "issuer",
  "next_action",
  "decision_rights",
  "help",
  "notice_reference",
  "template_code",
  "confidentiality_notice",
] as const);
/** further fields named by W-F's policy_v13.json (V13-08). W-F aliases (FACT, field_definitions): issuer = sender_identity,
 *  help = help_text, next_action = required_action + what_next (outcome = required_action's; the what_next part follows the
 *  what_next field — see GOVERNED composite handling in project()) */
export const WF_EXTRA_FIELDS = Object.freeze([
  "required_action",
  "what_next",
  "sender_identity",
  "help_text",
  "recipient_address",
  "deliberations",
  "vote_info",
  "conflict_info",
  "recommendation_content",
  "legal_opinion",
] as const);
const KNOWN_FIELDS = new Set<string>([...CHARTER_FIELDS, ...WD2_FIELDS, ...WF_EXTRA_FIELDS]);

/** non-content keys a projected model may carry outside `fields` (everything else is dropped) */
export const META_KEYS = Object.freeze([
  "notification_id",
  "type_code",
  "event_type",
  "template_version",
  "language",
  "recipient_class",
  "recipient_ref",
  "generated_at",
  "synthetic",
  "marking",
  "scenario_id",
  "release_status",
] as const);

/** working-view fields an external party never receives in a RESTRICTED case when it is not on the access list (its own
 *  procedural notice keeps the party-facing core; the policy rows decide the rest) */
const RESTRICTED_INTERNAL_WORKING = new Set<string>([
  "internal_ref",
  "report_id",
  "l1_substate",
  "l2_journey",
  "l3_steps",
  "procedural_status_text",
  "evidence_refs",
  "audit_refs",
  "delivery_status",
  "links_internal",
  "subject_detail",
  "preheader",
  "card_content",
  "attachments",
  "member_names",
  "participant_names",
  "decision_outcome",
]);

/** §39 (owner decision): notifications carry no investigation content (W-F DIS-INV-05 content fields included) */
const S39_FIELDS: readonly string[] = Object.freeze([
  "allegations",
  "investigation_details",
  "decision_outcome",
  "decision_reasons",
  "deliberations",
  "vote_info",
  "conflict_info",
  "recommendation_content",
  "legal_opinion",
]);
/** non-content core every mandatory-scenario allow-set keeps open for the rows to decide (W-F fields; PROPOSAL) */
const CORE_OPEN: Readonly<Record<string, Outcome>> = Object.freeze({
  notice_reference: "ALLOWED",
  template_code: "ALLOWED",
  sender_identity: "ALLOWED",
  confidentiality_notice: "ALLOWED",
  help_text: "ALLOWED",
  required_action: "ALLOWED",
  what_next: "ALLOWED",
});

export interface BilingualText {
  ar: string;
  en: string;
}

/** class-safe generic texts used for GENERALIZED when neither the row nor the policy supplies one (PROPOSAL wording) */
export const DEFAULT_GENERIC: Readonly<Record<string, BilingualText>> = Object.freeze({
  l1_stage_name: {
    ar: "قيد المعالجة وفق الإجراءات المعتمدة",
    en: "Being processed under the applicable procedure",
  },
  procedural_status_text: {
    ar: "الموضوع قيد المعالجة وفق الإجراءات المعتمدة",
    en: "The matter is being processed under the applicable procedure",
  },
  l2_journey: { ar: "الإجراء الخاص بكم قيد المعالجة", en: "Your procedure is in progress" },
  meeting_info: {
    ar: "تُبلَّغون بالموعد والمكان عبر القناة المعتمدة",
    en: "The time and place will be communicated through the approved channel",
  },
  member_names: { ar: "أعضاء اللجنة", en: "Committee members" },
  participant_names: { ar: "المشاركون بحسب صفاتهم", en: "Participants by capacity" },
  exception_indicator: { ar: "طرأ تغيير إجرائي", en: "A procedural change occurred" },
  event_summary: { ar: "صدر إشعار إجرائي يخصّكم", en: "A procedural notice concerning you was issued" },
});

// ---------------------------------------------------------------------------------------------------------------
// Owner-decision ceilings. Each returns the ceiling outcome for a query or null. They never loosen a row's outcome.
// ---------------------------------------------------------------------------------------------------------------
export interface NormalizedContext {
  tags: Set<string>;
  on_access_list: boolean;
}
interface CeilingQuery {
  recipient: RecipientClass;
  field: string;
  channel: string;
  ctx: NormalizedContext;
}
interface Override {
  id: string;
  basis: string[];
  ceiling: (q: CeilingQuery) => Outcome | null;
}

const set = (o: Record<string, Outcome>): Map<string, Outcome> =>
  new Map(Object.entries({ ...CORE_OPEN, ...o }));
/** allow-sets of the six mandatory scenarios (charter §5 / directive §11): field → maximum outcome; others PROHIBITED */
const SCENARIO_CEILINGS: Readonly<
  Record<string, { id: string; basis: string[]; fields: Map<string, Outcome> }>
> = Object.freeze({
  WITNESS: {
    id: "SCN-WITNESS",
    basis: [
      "charter §5 WITNESS: no l1/l2/l3, no case_number, event + required action only",
      "owner decision: witness sees no Level 1",
      "W7 §8 (hearing reference only, no case-system links)",
    ],
    fields: set({
      event_title: "ALLOWED",
      event_summary: "ALLOWED",
      event_at: "ALLOWED",
      recipient_capacity_label: "ALLOWED",
      issuer: "ALLOWED",
      classification_marking: "ALLOWED",
      meeting_info: "ALLOWED",
      deadline: "ALLOWED",
      deadline_basis: "ALLOWED",
      next_action: "ALLOWED",
      help: "ALLOWED",
      preheader: "ALLOWED",
      exception_indicator: "ALLOWED",
    }),
  },
  REPORTER: {
    id: "SCN-REPORTER",
    basis: [
      "charter §5 REPORTER: public stage names only",
      "DEC-24 (owner decision): portal channel only",
      "W7 §8 (Report ID instead of the internal case number)",
    ],
    fields: set({
      event_title: "ALLOWED",
      event_summary: "ALLOWED",
      event_at: "ALLOWED",
      recipient_capacity_label: "ALLOWED",
      issuer: "ALLOWED",
      classification_marking: "ALLOWED",
      report_id: "ALLOWED",
      l1_stage_name: "ALLOWED",
      l2_journey: "ALLOWED",
      procedural_status_text: "GENERALIZED",
      deadline: "ALLOWED",
      deadline_basis: "ALLOWED",
      links_portal: "ALLOWED",
      next_action: "ALLOWED",
      help: "ALLOWED",
      exception_indicator: "ALLOWED",
    }),
  },
  REFERRING_BODY: {
    id: "SCN-REFERRING-BODY",
    basis: [
      "charter §5 REFERRING_BODY: approved referral information only",
      "SOURCE_REQUIRED beyond the acknowledgement (W8-C10/W8-C11 NO SOURCE; D11-012 pending decision)",
    ],
    fields: set({
      event_title: "ALLOWED",
      event_summary: "ALLOWED",
      event_at: "ALLOWED",
      recipient_capacity_label: "ALLOWED",
      issuer: "ALLOWED",
      classification_marking: "ALLOWED",
      case_number: "SAFE_REFERENCE",
      l1_stage_name: "ALLOWED",
      next_action: "ALLOWED",
      help: "ALLOWED",
      preheader: "ALLOWED",
      subject_detail: "ALLOWED",
    }),
  },
  RECUSED_MEMBER: {
    id: "SCN-RECUSED-MEMBER",
    basis: [
      "charter §5 RECUSED_MEMBER: no deliberations, no votes, no member names",
      "W8-C48 (OWNER DECISION: conflicted seats receive no case content)",
    ],
    fields: set({
      event_title: "ALLOWED",
      event_summary: "ALLOWED",
      event_at: "ALLOWED",
      recipient_capacity_label: "ALLOWED",
      issuer: "ALLOWED",
      classification_marking: "ALLOWED",
      case_number: "SAFE_REFERENCE",
      internal_ref: "ALLOWED",
      l1_stage_name: "ALLOWED",
      next_action: "ALLOWED",
      help: "ALLOWED",
      preheader: "ALLOWED",
      exception_indicator: "ALLOWED",
      card_content: "ALLOWED",
    }),
  },
  SUBJECT: {
    id: "SCN-SUBJECT",
    basis: [
      "charter §5 SUBJECT: what procedural rights need (request, deadline with basis, channel), nothing of the deliberations",
      "W7 §8 (notice reference instead of the internal case number)",
    ],
    fields: set({
      event_title: "ALLOWED",
      event_summary: "ALLOWED",
      event_at: "ALLOWED",
      recipient_capacity_label: "ALLOWED",
      issuer: "ALLOWED",
      classification_marking: "ALLOWED",
      case_number: "SAFE_REFERENCE",
      internal_ref: "ALLOWED",
      l1_stage_name: "ALLOWED",
      l2_journey: "ALLOWED",
      l3_steps: "ALLOWED",
      procedural_status_text: "ALLOWED",
      meeting_info: "ALLOWED",
      deadline: "ALLOWED",
      deadline_basis: "ALLOWED",
      links_portal: "ALLOWED",
      next_action: "ALLOWED",
      help: "ALLOWED",
      preheader: "ALLOWED",
      subject_detail: "ALLOWED",
      exception_indicator: "ALLOWED",
    }),
  },
});

const OVERRIDES: readonly Override[] = Object.freeze([
  {
    id: "OD-DEC24-REPORTER-PORTAL-ONLY",
    basis: [
      "DEC-24 (owner decision): reporter channel = portal only until decided",
      "D11-015 (pending decision)",
    ],
    ceiling: (q) =>
      q.recipient === "REPORTER" && EMAIL_CONTENT_CHANNELS.includes(q.channel) ? "PROHIBITED" : null,
  },
  {
    id: "OD-AMB181-NO-CASE-NUMBER-IN-EMAIL",
    basis: [
      "AMB-181 safe default (owner decision): no case number / Report ID in e-mail",
      "D11-008 (pending decision)",
    ],
    ceiling: (q) =>
      (q.field === "case_number" || q.field === "report_id") && EMAIL_CONTENT_CHANNELS.includes(q.channel)
        ? "SAFE_REFERENCE"
        : null,
  },
  {
    id: "OD-DEC22-CASE-NUMBER-HIDDEN-IN-QUEUE",
    basis: [
      "DEC-22 (owner decision): case-number hiding on queue reads — applied to in-app notification lists (INFERENCE)",
    ],
    ceiling: (q) => (q.field === "case_number" && q.channel === "IN_APP" ? "SAFE_REFERENCE" : null),
  },
  {
    id: "OD-S39-NO-INVESTIGATION-CONTENT",
    basis: ["§39 (owner decision): notifications carry no investigation content", "CLAUDE.md §4"],
    ceiling: (q) => (S39_FIELDS.includes(q.field) ? "PROHIBITED" : null),
  },
  {
    id: "OD-S22-PROTECTED-IDENTITY",
    basis: ["CLAUDE.md §22: reporter identity only via api.resolve_reporter_identity()"],
    ceiling: (q) => (q.field === "reporter_identity" ? "PROHIBITED" : null),
  },
  {
    id: "OD-SCOPE-PUBLIC-L1-NAMES-ONLY",
    basis: ["owner decision: scope/public recipients see Level-1 stage names only (D-V12-4)"],
    ceiling: (q) =>
      inList(SCOPE_PUBLIC_CLASSES, q.recipient) && q.field === "l1_substate" ? "PROHIBITED" : null,
  },
  {
    id: "OD-RESTRICTED-CASE",
    basis: [
      "charter §5 RESTRICTED case: every internal field PROHIBITED unless the recipient is on the approved access list",
      "W8-C48 (OWNER DECISION: uncleared seats receive no notification)",
      "DEC-F19",
      "D11-037",
    ],
    // internal seats (and recused members) off the access list receive nothing (the notification is suppressed); an
    // external party keeps the party-facing core of its own procedural notice, never the working view (INFERENCE from
    // "every internal field"; W-F context_resolution agrees); the case's RESTRICTED_CASE_AUTHORITY keeps its own rows
    // (W-F DIS-06-RCA). A recipient verified on the list is projected without the CASE_RESTRICTED tag (see project()).
    ceiling: (q) => {
      if (
        !q.ctx.tags.has("CASE_RESTRICTED") ||
        q.ctx.on_access_list === true ||
        q.recipient === "RESTRICTED_CASE_AUTHORITY"
      )
        return null;
      if (inList(EXTERNAL_CLASSES, q.recipient))
        return RESTRICTED_INTERNAL_WORKING.has(q.field) || S39_FIELDS.includes(q.field) ? "PROHIBITED" : null;
      return "PROHIBITED";
    },
  },
  ...Object.entries(SCENARIO_CEILINGS).map(([cls, sc]): Override => ({
    id: sc.id,
    basis: sc.basis,
    ceiling: (q) => (q.recipient === cls ? sc.fields.get(q.field) || "PROHIBITED" : null),
  })),
]);
export const OVERRIDE_IDS: readonly string[] = Object.freeze(OVERRIDES.map((o) => o.id));

// ---------------------------------------------------------------------------------------------------------------
// Policy loading and normalisation
// ---------------------------------------------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object";

export interface PolicyRow {
  id: string;
  recipient: string | null;
  field: string | null;
  channel: string;
  context: string;
  outcome: string;
  basis: string[];
  note: unknown;
  generic: BilingualText | null;
}

function normRow(r: unknown, i: number, source: string): PolicyRow | null {
  if (!isObj(r)) return null;
  const outcome = String(r.outcome ?? "")
    .trim()
    .toUpperCase();
  const g = r.generic ?? r.generic_text ?? r.generalized_text ?? null;
  return {
    id: (r.id as string | undefined) ?? `${source}-${String(i + 1).padStart(4, "0")}`,
    recipient: String(r.recipient ?? r.recipient_class ?? r.class ?? "").trim() || null,
    field: String(r.field ?? "").trim() || null,
    channel: String(r.channel ?? "*").trim() || "*",
    context: String(r.context ?? "*").trim() || "*",
    outcome,
    basis: Array.isArray(r.basis) ? r.basis.map(String) : r.basis ? [String(r.basis)] : [],
    note: r.note ?? null,
    generic: isObj(g) && (g.ar || g.en) ? { ar: String(g.ar ?? g.en), en: String(g.en ?? g.ar) } : null,
  };
}

function rowsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isObj(raw)) return [];
  for (const k of ["rows", "policy", "entries", "matrix", "rules"]) {
    const v = raw[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

export interface NormalizedPolicy {
  __normalized: true;
  version: string;
  status: string;
  source: string;
  path: string | null;
  rows: PolicyRow[];
  index: Map<string, PolicyRow[]>;
  generic_texts: Record<string, BilingualText>;
  generic_by_recipient: Record<string, Partial<Record<RecipientClass, BilingualText>>>;
  safe_reference_text: BilingualText | null;
  fields: string[];
  warnings: string[];
}
const isNormalizedPolicy = (p: unknown): p is NormalizedPolicy => isObj(p) && p.__normalized === true;

/** normalise any policy object (W-F, provisional or a test fixture) into the shape decide() uses */
export function normalizePolicy(
  raw: unknown,
  { source = "CUSTOM", path = null }: { source?: string; path?: string | null } = {},
): NormalizedPolicy {
  if (isNormalizedPolicy(raw)) return raw;
  const warnings: string[] = [];
  const rows: PolicyRow[] = [];
  rowsOf(raw).forEach((r, i) => {
    const n = normRow(r, i, source);
    if (!n || !n.recipient || !n.field) {
      warnings.push(`row ${i + 1}: missing recipient/field — ignored (default PROHIBITED applies)`);
      return;
    }
    if (!isOutcome(n.outcome)) {
      warnings.push(`row ${i + 1}: unknown outcome "${n.outcome}" — ignored (default PROHIBITED applies)`);
      return;
    }
    if (n.recipient !== "*" && !isRecipient(n.recipient)) {
      warnings.push(`row ${i + 1}: unknown recipient "${n.recipient}" — ignored`);
      return;
    }
    if (n.channel !== "*" && !isChannel(n.channel)) {
      warnings.push(`row ${i + 1}: unknown channel "${n.channel}" — ignored`);
      return;
    }
    rows.push(n);
  });
  const index = new Map<string, PolicyRow[]>();
  for (const r of rows) {
    const k = r.recipient as string;
    let l = index.get(k);
    if (!l) {
      l = [];
      index.set(k, l);
    }
    l.push(r);
  }
  // generic texts: {field: {ar, en}} (provisional shape) or {field: {RECIPIENT: {ar, en}}} (W-F generalized_texts)
  const generic: Record<string, BilingualText> = {};
  const genericBy: Record<string, Partial<Record<RecipientClass, BilingualText>>> = {};
  const obj: Obj = isObj(raw) && !Array.isArray(raw) ? raw : {};
  const bi = (v: Obj): BilingualText => ({ ar: String(v.ar ?? v.en), en: String(v.en ?? v.ar) });
  for (const src of [obj.generic_texts, obj.generalized_texts, obj.generic]) {
    for (const [k, v] of Object.entries(isObj(src) ? src : {})) {
      if (!isObj(v)) continue;
      if (v.ar || v.en) {
        if (!generic[k]) generic[k] = bi(v);
        continue;
      }
      for (const [cls, t] of Object.entries(v)) {
        if (isObj(t) && (t.ar || t.en) && isRecipient(cls)) {
          const per = (genericBy[k] ??= {});
          per[cls] ??= bi(t);
        }
      }
    }
  }
  const srRaw = obj.safe_reference;
  const sr = isObj(srRaw) && (srRaw.ar || srRaw.en) ? bi(srRaw) : null;
  const fields = Array.isArray(obj.fields) ? obj.fields.map(String) : [];
  return {
    __normalized: true,
    version: String(obj.version ?? obj.policy_version ?? "UNVERSIONED"),
    status: String(obj.status ?? ""),
    source,
    path,
    rows,
    index,
    generic_texts: generic,
    generic_by_recipient: genericBy,
    safe_reference_text: sr,
    fields,
    warnings,
  };
}

export interface LoadPolicyOptions {
  /** informational label only in the port (no file system access in lib/); a path without `policy` fails closed */
  path?: string | null;
  /** override policy: an object or a JSON string; null/undefined when given explicitly = missing (fail closed) */
  policy?: unknown;
}

/** load W-F's policy_v13.json (bundled), or an explicit override `policy` (used by tests with fixture policies) */
export function loadPolicy(opts: LoadPolicyOptions = {}): NormalizedPolicy {
  const override = Object.hasOwn(opts, "policy") || (opts.path !== undefined && opts.path !== null);
  let raw: unknown = policyJson;
  const p = opts.path ?? (override ? null : POLICY_PATHS.wf);
  if (override) {
    raw = opts.policy;
    if (raw === undefined || raw === null)
      throw new DisclosureError(
        "NO_POLICY",
        "policy_v13.json not found — nothing can be projected (fail closed)",
      );
  }
  let P: NormalizedPolicy;
  try {
    P = normalizePolicy(typeof raw === "string" ? JSON.parse(raw) : raw, {
      source: override ? "CUSTOM" : "W-F",
      path: p,
    });
  } catch (e) {
    throw new DisclosureError(
      "NO_POLICY",
      `policy unreadable (${e instanceof Error ? e.message : String(e)}) — fail closed`,
    );
  }
  if (!P.rows.length) throw new DisclosureError("NO_POLICY", "policy has no usable rows — fail closed");
  return P;
}

function ensurePolicy(p: unknown): NormalizedPolicy {
  if (!p) return loadPolicy();
  return isNormalizedPolicy(p) ? p : normalizePolicy(p, { source: "CUSTOM" });
}

/** context input: '*' | tag | [tags] | {tags, on_access_list} */
export type ContextInput =
  string | readonly string[] | { tags?: unknown; on_access_list?: unknown } | null | undefined;

export function normalizeContext(context: ContextInput | unknown): NormalizedContext {
  let tags: unknown[] = [];
  let on: unknown;
  if (isNil(context) || context === "*") tags = [];
  else if (typeof context === "string") tags = [context];
  else if (Array.isArray(context)) tags = context.slice();
  else if (typeof context === "object") {
    const c = context as Obj;
    tags = Array.isArray(c.tags) ? c.tags.slice() : c.tags ? [c.tags] : [];
    on = c.on_access_list;
  }
  const strTags = tags.filter((t): t is string => typeof t === "string" && !!t && t !== "*");
  return { tags: new Set(strTags), on_access_list: on === true };
}

// ---------------------------------------------------------------------------------------------------------------
// decide()
// ---------------------------------------------------------------------------------------------------------------
const dedupe = <T>(a: readonly T[]): T[] => [...new Set(a)];

export interface DecideQuery {
  recipient?: unknown;
  field?: unknown;
  channel?: unknown;
  context?: ContextInput | NormalizedContext | unknown;
}
export interface RuleRef {
  id: string;
  recipient: string | null;
  field: string | null;
  channel: string;
  context: string;
  specificity: number;
}
export interface Decision {
  outcome: Outcome;
  basis: string[];
  rule: RuleRef | null;
  row_outcome: Outcome | null;
  overrides: string[];
  conflict: boolean;
  generic: BilingualText | null;
  reason:
    | "UNKNOWN_RECIPIENT"
    | "INVALID_FIELD"
    | "UNKNOWN_CHANNEL"
    | "NO_MATCHING_ROW"
    | "UNKNOWN_FIELD"
    | "TIE_MOST_RESTRICTIVE"
    | "ROW";
}

const isNormalizedContext = (c: unknown): c is NormalizedContext => isObj(c) && c.tags instanceof Set;

export function decide(policy: unknown, query: DecideQuery = {}): Decision {
  const P = ensurePolicy(policy);
  const { recipient, field } = query;
  const channel = query.channel ?? "*";
  const ctx =
    query.context && isNormalizedContext(query.context) ? query.context : normalizeContext(query.context);
  const res = (outcome: Outcome, basis: string[], extra: { reason: Decision["reason"] }): Decision => ({
    outcome,
    basis,
    rule: null,
    row_outcome: null,
    overrides: [],
    conflict: false,
    generic: null,
    ...extra,
  });
  if (!isRecipient(recipient))
    return res("PROHIBITED", ["unknown recipient class — default PROHIBITED (charter §5)"], {
      reason: "UNKNOWN_RECIPIENT",
    });
  if (typeof field !== "string" || !field || field === "*")
    return res("PROHIBITED", ["invalid field — default PROHIBITED (charter §5)"], {
      reason: "INVALID_FIELD",
    });
  if (channel !== "*" && !isChannel(channel))
    return res("PROHIBITED", ["unknown channel — default PROHIBITED (charter §5)"], {
      reason: "UNKNOWN_CHANNEL",
    });
  const ch = channel as string;

  let rowOutcome: Outcome = "PROHIBITED";
  let basis = ["default PROHIBITED (charter §5: no matching row)"];
  let rule: RuleRef | null = null;
  let conflict = false;
  let generic: BilingualText | null = null;
  let reason: Decision["reason"] = "NO_MATCHING_ROW";
  const known = KNOWN_FIELDS.has(field) || P.fields.includes(field);
  if (!known) {
    basis = ["unknown field — default PROHIBITED (charter §5)"];
    reason = "UNKNOWN_FIELD";
  } else {
    const cands = (P.index.get(recipient) || []).concat(P.index.get("*") || []);
    let best: PolicyRow[] = [];
    let spec = -1;
    for (const r of cands) {
      if (r.field !== "*" && r.field !== field) continue;
      if (r.channel !== "*" && r.channel !== ch) continue;
      if (r.context !== "*" && !ctx.tags.has(r.context)) continue;
      const s =
        (r.recipient !== "*" ? 8 : 0) +
        (r.field !== "*" ? 4 : 0) +
        (r.channel !== "*" ? 2 : 0) +
        (r.context !== "*" ? 1 : 0);
      if (s > spec) {
        spec = s;
        best = [r];
      } else if (s === spec) best.push(r);
    }
    const first = best[0];
    if (first) {
      let pick = first;
      for (const r of best.slice(1)) if (rank(r.outcome) > rank(pick.outcome)) pick = r;
      conflict = best.some((r) => r.outcome !== pick.outcome);
      rowOutcome = pick.outcome as Outcome;
      basis = pick.basis.length ? pick.basis.slice() : ["policy row (no basis given)"];
      rule = {
        id: pick.id,
        recipient: pick.recipient,
        field: pick.field,
        channel: pick.channel,
        context: pick.context,
        specificity: spec,
      };
      generic = pick.generic;
      reason = conflict ? "TIE_MOST_RESTRICTIVE" : "ROW";
    }
  }
  let outcome: Outcome = rowOutcome;
  const overrides: string[] = [];
  const q: CeilingQuery = { recipient, field, channel: ch, ctx };
  for (const o of OVERRIDES) {
    const c = o.ceiling(q);
    if (c && rank(c) > rank(outcome)) {
      outcome = c;
      overrides.push(o.id);
      basis = basis.concat(o.basis);
    }
  }
  return {
    outcome,
    basis: dedupe(basis),
    rule,
    row_outcome: rowOutcome,
    overrides,
    conflict,
    generic,
    reason,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// project()
// ---------------------------------------------------------------------------------------------------------------
const REGISTRY_KEY = Symbol.for("cdf.v13.disclosure.projected-registry");
const G = globalThis as typeof globalThis & { [REGISTRY_KEY]?: WeakSet<object> };
const REGISTRY: WeakSet<object> = (G[REGISTRY_KEY] ??= new WeakSet<object>());

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export function resolveSurfaces(channel: unknown): { experience: string; surfaces: Channel[] } {
  if (Array.isArray(channel)) {
    const bad = channel.filter((c) => !isChannel(c));
    if (bad.length || !channel.length)
      throw new DisclosureError("UNKNOWN_CHANNEL", `unknown channel(s): ${bad.join(", ") || "(empty)"}`);
    return { experience: "CUSTOM", surfaces: (channel as Channel[]).slice() };
  }
  if (typeof channel === "string" && Object.hasOwn(EXPERIENCES, channel))
    return { experience: channel, surfaces: EXPERIENCES[channel as Experience].slice() };
  if (isChannel(channel)) return { experience: channel, surfaces: [channel] };
  throw new DisclosureError("UNKNOWN_CHANNEL", `unknown channel or experience: ${String(channel)}`);
}

const TOKEN_RE = /^[A-Z][A-Z0-9-]{3,39}$/;
const ENUM_KEYS = new Set([
  "kind",
  "state",
  "actual",
  "epistemic",
  "status",
  "type",
  "layer",
  "link_kind",
  "channel",
  "object_type",
  "code_kind",
  "mode",
  "tone",
]);
function leafStrings(v: unknown, out: string[] = []): string[] {
  if (isNil(v)) return out;
  if (typeof v === "string") {
    out.push(v);
    return out;
  }
  if (typeof v === "number") {
    out.push(String(v));
    return out;
  }
  if (Array.isArray(v)) {
    for (const x of v) leafStrings(x, out);
    return out;
  }
  if (typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if (!ENUM_KEYS.has(k)) leafStrings(x, out);
    }
  return out;
}

/** input notification model ({meta, fields, safe_refs?}) */
export interface NotificationModelInput {
  meta?: Record<string, unknown> & {
    notification_id?: unknown;
    recipient_class?: unknown;
    context?: unknown;
  };
  fields: Record<string, unknown>;
  safe_refs?: Record<string, unknown>;
  [k: string]: unknown;
}

export function safeToken(model: unknown, field: string, value: unknown): string {
  const m = isObj(model) ? model : {};
  const refs = isObj(m.safe_refs) ? m.safe_refs : undefined;
  const supplied = refs?.[field] ?? refs?.["*"];
  const orig = leafStrings(value).filter((s) => s.length >= 4);
  if (
    typeof supplied === "string" &&
    TOKEN_RE.test(supplied) &&
    !orig.some((s) => supplied.includes(s) || s.includes(supplied))
  )
    return supplied;
  const meta = isObj(m.meta) ? m.meta : undefined;
  const nid = String(meta?.notification_id ?? "no-notification-id");
  return (
    "REF-" +
    createHash("sha256").update(`${nid}|${field}|cdf-v13-safe-ref`).digest("hex").slice(0, 10).toUpperCase()
  );
}

/** values of a withheld field that must not re-appear in any surviving field (identifier-like leaves; all longer leaves of
 *  name / content fields) */
const SWEEP_ALL_LEAVES = new Set([
  "member_names",
  "participant_names",
  "reporter_identity",
  "l1_substate",
  "allegations",
  "investigation_details",
  "decision_outcome",
  "decision_reasons",
]);
const ID_LIKE = /[0-9@/]|-[A-Za-z0-9]/;
/** whole-token matcher for a withheld value */
export function tokenRe(v: unknown): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "u",
  );
}
const ZONED_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
/** reference-only fields whose timestamps are event metadata (an event's own date is governed by event_at / deadline) */
const TIMESTAMP_EXEMPT = new Set(["evidence_refs", "audit_refs"]);
function sensitiveLeaves(field: string, value: unknown): string[] {
  const leaves = leafStrings(value)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^[A-Z_]+$/.test(s))
    .filter((s) => !(TIMESTAMP_EXEMPT.has(field) && ZONED_TS.test(s)));
  const idLike = (s: string) => s.length >= 5 && ID_LIKE.test(s);
  if (SWEEP_ALL_LEAVES.has(field)) return dedupe(leaves.filter((s) => s.length >= 6 || idLike(s)));
  return dedupe(leaves.filter(idLike));
}

/** sub-keys inside other fields that carry the value of a governing field (one decision per field, every surface) */
const GOVERNED_KEYS: Readonly<Record<string, { by: string | readonly string[]; mark: string }>> =
  Object.freeze({
    evidence_event_id: { by: "evidence_refs", mark: "evidence_recorded" },
    status_source_event_id: { by: "evidence_refs", mark: "evidence_recorded" },
    source_event_id: { by: "evidence_refs", mark: "evidence_recorded" },
    // the basis event's id is an evidence reference: it survives only where both the deadline basis and evidence_refs are
    // allowed (W-F field_definitions: deadline_basis = the basis event's date and the rule); the date itself stays
    basis_event_id: { by: ["deadline_basis", "evidence_refs"], mark: "basis_event_ref_withheld" },
    basis_rule: { by: "deadline_basis", mark: "basis_withheld" },
    audit_id: { by: "audit_refs", mark: "audit_withheld" },
  });
function stripGoverned(v: unknown, allowed: (g: string) => boolean, path: string, hits: string[]): void {
  if (Array.isArray(v)) {
    v.forEach((x, i) => stripGoverned(x, allowed, `${path}[${i}]`, hits));
    return;
  }
  if (!isObj(v)) return;
  for (const k of Object.keys(v)) {
    const g = Object.hasOwn(GOVERNED_KEYS, k) ? GOVERNED_KEYS[k] : undefined;
    if (g && !(typeof g.by === "string" ? allowed(g.by) : g.by.every(allowed))) {
      if (!isNil(v[k])) v[g.mark] = true;
      delete v[k];
      hits.push(`${path}.${k}→${String(g.by)}`);
    } else stripGoverned(v[k], allowed, `${path}.${k}`, hits);
  }
}

export interface ProjectOptions {
  recipient?: unknown;
  context?: ContextInput | unknown;
  /** one channel, an experience ('EMAIL' | 'PLATFORM') or a list of channels; default 'EMAIL' */
  channel?: unknown;
  policy?: unknown;
  now?: unknown;
}
export interface FieldLog {
  outcome: Outcome;
  basis: string[];
  deciding_surface: Channel;
  surfaces: Partial<Record<Channel, Outcome>>;
  rule: RuleRef | null;
  overrides: string[];
  note: string | null;
  subfields?: { what_next: Outcome; deadline: Outcome };
}
export interface DisclosureSummary {
  policy_version: string;
  policy_source: string;
  policy_path: string | null;
  policy_status: string;
  policy_warnings: string[];
  recipient: RecipientClass;
  experience: string;
  surfaces: Channel[];
  context: string[];
  effective_context: string[];
  on_access_list: boolean;
  suppressed: boolean;
  channel_prohibited: boolean;
  counts: Record<Outcome, number>;
  leak_sweep: Array<{ field: string; withheld_field: string }>;
}
/**
 * Compile-time brand (SEC review of PR #3; PORT_PLAN §3 item 3). Only project() creates a value of this type, so a
 * model that has not passed the projection does not type-check where a renderer or view model asks for Projected<T>.
 * The symbol is declared, never exported or created at run time; the run-time check stays isProjected/assertProjected.
 */
declare const PROJECTED_BRAND: unique symbol;
export type Projected<T> = T & { readonly [PROJECTED_BRAND]: true };

export interface ProjectedModel {
  readonly meta: Readonly<Record<string, unknown>> & { readonly recipient_class: RecipientClass };
  readonly fields: Readonly<Record<string, unknown>>;
  readonly _disclosure_applied: true;
  readonly _disclosure_log: Readonly<Record<string, Readonly<FieldLog>>>;
  readonly _disclosure_summary: Readonly<DisclosureSummary>;
}

/**
 * project(model, {recipient, context, channel, policy, now}) — see header. `model` = {meta:{…}, fields:{…}, safe_refs?}, or
 * the charter §5 flat form (a plain object whose own keys are the fields, with no `fields`, `meta` or `safe_refs` key), read
 * as {meta:{}, fields:model}: every key is decided like any other field (unknown key → PROHIBITED); the output shape is the same.
 * `channel` defaults to 'EMAIL'. `context`: '*' | tag | [tags] | {tags:[…], on_access_list:boolean}.
 */
export function project(modelIn: unknown, opts: ProjectOptions = {}): Projected<ProjectedModel> {
  let model: unknown = modelIn;
  if (
    model &&
    typeof model === "object" &&
    !Array.isArray(model) &&
    !["fields", "meta", "safe_refs"].some((k) => Object.hasOwn(model as object, k))
  ) {
    model = { meta: {}, fields: model };
  }
  if (!isObj(model) || !model.fields || typeof model.fields !== "object") {
    throw new DisclosureError("INVALID_MODEL", "project() needs a model with a `fields` object");
  }
  const M = model as NotificationModelInput;
  const P = ensurePolicy(opts.policy ?? loadPolicy());
  const metaRecipient = M.meta?.recipient_class;
  const recipient = opts.recipient ?? metaRecipient;
  if (opts.recipient && metaRecipient && opts.recipient !== metaRecipient) {
    throw new DisclosureError(
      "RECIPIENT_MISMATCH",
      `projection recipient ${String(opts.recipient)} ≠ model recipient ${String(metaRecipient)}`,
    );
  }
  if (!isRecipient(recipient))
    throw new DisclosureError("UNKNOWN_RECIPIENT", `unknown recipient class: ${String(recipient)}`);
  const { experience, surfaces } = resolveSurfaces(opts.channel ?? "EMAIL");
  const ctx0 = normalizeContext(opts.context ?? M.meta?.context ?? "*");
  const restrictedCase = ctx0.tags.has("CASE_RESTRICTED");
  // a recipient verified on the restricted case's approved access list is projected under '*' (or EXTERNAL) — W-F
  // context_resolution; the case's RESTRICTED_CASE_AUTHORITY keeps the CASE_RESTRICTED rows that are its own
  const ctx: NormalizedContext =
    restrictedCase && ctx0.on_access_list && recipient !== "RESTRICTED_CASE_AUTHORITY"
      ? { tags: new Set([...ctx0.tags].filter((t) => t !== "CASE_RESTRICTED")), on_access_list: true }
      : ctx0;

  interface FieldDecision {
    dec: Decision;
    decSurface: Channel;
    decisions: Array<[Channel, Decision]>;
  }
  const memo = new Map<string, FieldDecision>();
  const decideField = (field: string): FieldDecision => {
    const hit = memo.get(field);
    if (hit) return hit;
    const decisions = surfaces.map((s): [Channel, Decision] => [
      s,
      decide(P, { recipient, field, channel: s, context: ctx }),
    ]);
    // surfaces is never empty (resolveSurfaces refuses an empty list)
    let [decSurface, dec] = decisions[0] as [Channel, Decision];
    for (const [s, d] of decisions)
      if (rank(d.outcome) > rank(dec.outcome)) {
        dec = d;
        decSurface = s;
      }
    const r = { dec, decSurface, decisions };
    memo.set(field, r);
    return r;
  };
  const allowedField = (f: string) => decideField(f).dec.outcome === "ALLOWED";

  const fields: Record<string, unknown> = {};
  const log: Record<string, FieldLog> = {};
  const withheld: string[] = [];
  for (const [field, value] of Object.entries(M.fields)) {
    const { dec, decSurface, decisions } = decideField(field);
    let outcome: Outcome = dec.outcome;
    const notes: string[] = [];
    if (outcome === "ALLOWED") fields[field] = value === undefined ? null : structuredClone(value);
    else if (outcome === "SAFE_REFERENCE") {
      fields[field] = isNil(value)
        ? null
        : {
            safe_reference: true,
            token: safeToken(M, field, value),
            ...(P.safe_reference_text ? { label: { ...P.safe_reference_text } } : {}),
          };
    } else if (outcome === "GENERALIZED") {
      const g =
        dec.generic ||
        P.generic_by_recipient?.[field]?.[recipient] ||
        P.generic_texts[field] ||
        DEFAULT_GENERIC[field];
      if (isNil(value)) fields[field] = null;
      else if (g) fields[field] = { generalized: true, ar: g.ar, en: g.en };
      else {
        outcome = "REDACTED";
        notes.push("GENERALIZED without a class-safe generic text → removed (fail closed)");
      }
    }
    if (outcome !== "ALLOWED") withheld.push(field);
    log[field] = {
      outcome,
      basis: dec.basis,
      deciding_surface: decSurface,
      surfaces: Object.fromEntries(decisions.map(([s, d]) => [s, d.outcome])),
      rule: dec.rule,
      overrides: dedupe(decisions.flatMap(([, d]) => d.overrides)),
      note: notes.join("; ") || null,
    };
  }

  // composite sub-fields follow their governing field's decision (deadline inside next_action, evidence ids inside steps,
  // deadline basis ids, audit ids, links inside next_action.how) — one decision per field on every surface
  const na = fields.next_action;
  const naLog = log.next_action;
  if (isObj(na) && naLog && !na.generalized && !na.safe_reference) {
    if (!isNil(na.deadline) && !allowedField("deadline")) {
      na.deadline = null;
      na.deadline_reason = null;
      naLog.note = [naLog.note, "deadline withheld (follows field deadline)"].filter(Boolean).join("; ");
    }
    if (Array.isArray(na.optional_rights) && !allowedField("deadline")) {
      for (const r of na.optional_rights)
        if (isObj(r)) {
          r.deadline = null;
          r.deadline_reason = null;
        }
    }
    // the what_next part of next_action follows the what_next field (W-F: next_action = required_action + what_next)
    const wd = decideField("what_next").dec;
    naLog.subfields = { what_next: wd.outcome, deadline: decideField("deadline").dec.outcome };
    if (Array.isArray(na.what_next) && na.what_next.length && wd.outcome !== "ALLOWED") {
      const g =
        wd.outcome === "GENERALIZED"
          ? wd.generic || P.generic_by_recipient?.what_next?.[recipient] || P.generic_texts.what_next
          : null;
      na.what_next = g ? [{ kind: "EXPECTED", generalized: true, ar: g.ar, en: g.en }] : [];
      naLog.note = [
        naLog.note,
        `what_next ${g ? "generalized" : "withheld"} (follows field what_next: ${wd.outcome})`,
      ]
        .filter(Boolean)
        .join("; ");
    }
    if (isObj(na.how)) {
      const lk = na.how.link_kind;
      const gov =
        lk === "PLATFORM_DEEP_LINK" ? "links_internal" : lk === "PORTAL_LINK" ? "links_portal" : null;
      if (gov && !allowedField(gov)) {
        delete na.how.href;
        delete na.how.path;
        na.how.link_kind = "NONE";
        naLog.note = [naLog.note, `link withheld (follows field ${gov})`].filter(Boolean).join("; ");
      }
    }
  }
  for (const [field, value] of Object.entries(fields)) {
    const l = log[field];
    if (!l || l.outcome !== "ALLOWED" || isNil(value) || typeof value !== "object") continue;
    const hits: string[] = [];
    stripGoverned(value, (g) => g === field || allowedField(g), field, hits);
    if (hits.length)
      l.note = [l.note, `governed sub-keys withheld: ${hits.length}`].filter(Boolean).join("; ");
  }

  // leak sweep: a surviving field may not carry a withheld value (e.g. a preheader text quoting the case number). Values
  // are matched as whole tokens (letters and digits are token characters; anything else delimits), so an allowed value
  // that merely shares characters with a withheld one is kept, while an embedded withheld identifier is still removed.
  const sweep: Array<{ field: string; withheld_field: string }> = [];
  const sensitive = withheld.flatMap((f) =>
    sensitiveLeaves(f, M.fields[f]).map((v) => ({ f, v, re: tokenRe(v) })),
  );
  if (sensitive.length) {
    for (const [field, value] of Object.entries(fields)) {
      const l = log[field];
      if (!l || l.outcome !== "ALLOWED") continue;
      const leaves = leafStrings(value);
      const hit = sensitive.find(({ re }) => leaves.some((s) => re.test(s)));
      if (hit) {
        delete fields[field];
        log[field] = {
          ...l,
          outcome: "REDACTED",
          basis: [...l.basis, `leak sweep: carried a withheld value of ${hit.f}`],
          note: "LEAK_SWEEP",
        };
        sweep.push({ field, withheld_field: hit.f });
      }
    }
  }

  const meta: Record<string, unknown> = {};
  for (const k of META_KEYS)
    if (M.meta && Object.prototype.hasOwnProperty.call(M.meta, k)) meta[k] = structuredClone(M.meta[k]);
  meta.recipient_class = recipient;
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const l of Object.values(log)) counts[l.outcome] += 1;
  const total = Object.keys(log).length;
  const out: ProjectedModel = {
    meta: meta as ProjectedModel["meta"],
    fields,
    _disclosure_applied: true,
    _disclosure_log: log,
    _disclosure_summary: {
      policy_version: P.version,
      policy_source: P.source,
      policy_path: P.path,
      policy_status: P.status,
      policy_warnings: P.warnings.slice(),
      recipient,
      experience,
      surfaces,
      context: [...ctx0.tags],
      effective_context: [...ctx.tags],
      on_access_list: ctx0.on_access_list,
      suppressed:
        restrictedCase &&
        !ctx0.on_access_list &&
        !inList(EXTERNAL_CLASSES, recipient) &&
        recipient !== "RESTRICTED_CASE_AUTHORITY",
      channel_prohibited: total > 0 && counts.PROHIBITED + counts.REDACTED === total,
      counts,
      leak_sweep: sweep,
    },
  };
  deepFreeze(out);
  REGISTRY.add(out);
  return out as Projected<ProjectedModel>;
}

export function isProjected(m: unknown): m is Projected<ProjectedModel> {
  return (
    isObj(m) && m._disclosure_applied === true && !!m._disclosure_log && REGISTRY.has(m) && Object.isFrozen(m)
  );
}

/** every renderer calls this first (charter §0.6). The brand catches accidental misuse; it is not a boundary against
 *  hostile in-process code (INFERENCE). */
export function assertProjected(m: unknown): Projected<ProjectedModel> {
  if (!isProjected(m))
    throw new DisclosureError(
      "UNPROJECTED_MODEL",
      "renderer received a model that did not pass the disclosure projection (charter §0.6, §5)",
    );
  return m;
}

/** outcome of one field in a projected model ('ABSENT' when the source model never carried it) */
export function outcomeOf(projected: unknown, field: string): Outcome | "ABSENT" {
  if (!isObj(projected) || !isObj(projected._disclosure_log)) return "ABSENT";
  const l = projected._disclosure_log[field];
  return (isObj(l) ? (l.outcome as Outcome | undefined) : undefined) ?? "ABSENT";
}

/** test/demo helper: withheld source values found in rendered outputs ({surface: string}) — values are masked in the result */
export function findLeaks(
  original: { fields: Record<string, unknown> },
  projected: Projected<ProjectedModel>,
  outputs: Record<string, unknown>,
): Array<{ field: string; surface: string; value: string }> {
  const leaks: Array<{ field: string; surface: string; value: string }> = [];
  for (const [field, l] of Object.entries(projected._disclosure_log)) {
    if (l.outcome === "ALLOWED") continue;
    const vals = sensitiveLeaves(field, original.fields[field]);
    for (const [surface, text] of Object.entries(outputs)) {
      const t = String(text ?? "");
      for (const v of vals) if (t.includes(v)) leaks.push({ field, surface, value: v.slice(0, 3) + "…" });
    }
  }
  return leaks;
}
