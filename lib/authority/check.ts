import "server-only";
/**
 * CDF Notifications V13 — Authority check (charter §6). Workstream W-D2.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * PRODUCTION_SUBSTITUTION_REQUIRED: the platform enforces authority twice (@cdf/authorization pre-check + authz.* / RLS in
 * the database, CLAUDE.md §19); this module mirrors the decision shape for rendering and next-action derivation only.
 *
 * check(authorityModel, {action_id, actor:{capacity, seat_active, recused, delegation_active, acting_for}, object, purpose,
 *        manual_operation}) → {result:'ALLOWED'|'DENIED'|'SOURCE_REQUIRED', effect:'ALLOWED'|'DENIED', reason:{ar,en}, code, …}
 *
 * Order (fail closed at the first failing check; W-F authority_v13.json check_semantics.order, FACT):
 *   1 action known (else SOURCE_REQUIRED / UNKNOWN_ACTION) → 2 capacity present and not an administrative capacity
 *   (PLATFORM_ADMIN / DB_ADMIN / NOTIFICATION_ADMIN never act on a case, §21) → 3 seat active (seat capacities need
 *   seat_active === true; any other capacity except SYSTEM is denied when seat_active === false) → 4 not recused →
 *   5 no excluded relation to the object → 6 a role for the purpose (executor / decision maker / approver; preparer only for
 *   drafting; a delegate only where the action allows delegation, the delegation is active and the delegator holds the role)
 *   → 7 governing source (SOURCE_REQUIRED or DRAFT: SOURCE_REQUIRED, i.e. DENIED in effect; ALLOWED for drafting only with
 *   an explicit manual_operation label) → 8 conditional SOURCE_REQUIRED whose `when` holds → 9 precondition events recorded
 *   → 10 not expired → 11 object conditions (+ the capacity's own preconditions) → 12 approvals present → 13 ALLOWED.
 *   A `when` whose key is missing HOLDS unless a known value contradicts it (the stricter path applies); an object
 *   condition whose key is missing does not hold.
 * Authority is never inferred from a title: only `actor.capacity` (an enumerated capacity) is read.
 * Administrative coordination (scheduling, sending a notice, recording) is flagged `administrative:true` and never
 * substitutes for a formal act: ISSUE_DECISION_NOTICE (administrative) and DECIDE (formal) are different actions with
 * different holders, and allowing one says nothing about the other.
 *
 * Port note: the model is bundled as a static JSON import (no file system access in lib/). loadAuthority() keeps its name
 * and still accepts an override (`{model}` object or JSON string); a missing/unreadable/empty override fails closed.
 */
import authorityJson from "./authority_v13.json";

/** the only authority model in the code path: W-F's authority_v13.json (charter §1/§6). Informational in the port: the file is
 *  bundled through a static import. A missing model fails closed (NO_AUTHORITY_MODEL). */
export const AUTHORITY_PATHS = Object.freeze({ wf: "lib/authority/authority_v13.json" } as const);

export const RESULTS = Object.freeze(["ALLOWED", "DENIED", "SOURCE_REQUIRED"] as const);
export type CheckResult = (typeof RESULTS)[number];
export const SOURCE_STATUSES = Object.freeze([
  "APPROVED",
  "DRAFT",
  "OWNER_DECISION",
  "SOURCE_REQUIRED",
] as const);
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
/** capacities that act through a committee seat (seat_active must be explicitly true) — W-F check_semantics.seat_capacities */
const DEFAULT_SEAT_CAPACITIES: readonly string[] = Object.freeze([
  "SECRETARY",
  "ALTERNATE_SECRETARY",
  "CHAIR",
  "DEPUTY_CHAIR",
  "MEMBER",
  "GRIEVANCE_SECRETARY",
]);
/** administrative capacities that never act on case content (PROT-§21) — W-F admin_capacities_never_case_actors */
const DEFAULT_ADMIN_CAPACITIES: readonly string[] = Object.freeze([
  "PLATFORM_ADMIN",
  "DB_ADMIN",
  "NOTIFICATION_ADMIN",
]);

export interface BilingualText {
  ar: string;
  en: string;
}

const REASONS = Object.freeze({
  UNKNOWN_ACTION: {
    ar: "الإجراء غير معرّف في نموذج الصلاحيات — المصدر المعتمد مطلوب",
    en: "The action is not defined in the authority model — an approved source is required",
  },
  NO_CAPACITY: { ar: "لم تُحدَّد صفة المستلم", en: "No recipient capacity was given" },
  ADMIN_NEVER_CASE_ACTOR: {
    ar: "الصفات الإدارية للمنصة لا تمارس أي إجراء على القضايا",
    en: "Platform administration capacities never act on a case",
  },
  SEAT_INACTIVE: {
    ar: "المقعد أو التكليف غير نشط؛ لا تُمارَس الصلاحية منه",
    en: "The seat or assignment is not active; authority is not exercised from it",
  },
  RECUSED: {
    ar: "المستلم متنحٍّ عن هذا البند؛ لا يعتمد ولا ينفّذ",
    en: "The recipient is recused from this item; a recused member never approves or executes",
  },
  EXCLUDED_RELATION: {
    ar: "صلة المستلم بهذا الموضوع تمنعه من هذا الإجراء",
    en: "The recipient's relation to this object excludes it from this action",
  },
  INFORMED_ONLY: {
    ar: "صفة المستلم في هذا الإجراء: للعلم فقط",
    en: "The recipient's capacity for this action is: informed only",
  },
  NO_ROLE: { ar: "لا تملك هذه الصفة دوراً في هذا الإجراء", en: "This capacity holds no role in this action" },
  SOURCE_REQUIRED: {
    ar: "لا يوجد مصدر حوكمة معتمد لهذا الإجراء — يُمنع التنفيذ إلى حين اعتماد المصدر",
    en: "No approved governance source exists for this action — execution is blocked until a source is approved",
  },
  CONDITIONAL_SOURCE_REQUIRED: {
    ar: "لا يوجد مصدر معتمد لهذا الإجراء في هذه الحالة — يُمنع التنفيذ إلى حين اعتماده",
    en: "No approved source covers this action in this situation — execution is blocked until one is approved",
  },
  SOURCE_REQUIRED_DRAFT: {
    ar: "مسودة فقط بتشغيل يدوي معلَن — لا تنفيذ قبل اعتماد المصدر",
    en: "Draft only, under a declared manual operation — no execution before a source is approved",
  },
  PRECONDITION_MISSING: {
    ar: "الحدث المسبق المطلوب غير مسجّل",
    en: "The required prior event is not recorded",
  },
  EXPIRED: { ar: "انتهت صلاحية الإجراء بحدث مسجّل", en: "The action expired with a recorded event" },
  OBJECT_CONDITION: {
    ar: "شرط الموضوع الإجرائي لهذا الإجراء غير متحقق",
    en: "A condition of the procedural object for this action does not hold",
  },
  APPROVAL_MISSING: {
    ar: "الموافقة المطلوبة لهذا الإجراء غير مسجّلة",
    en: "The approval this action requires is not recorded",
  },
  ALLOWED: { ar: "مسموح وفق نموذج الصلاحيات", en: "Allowed under the authority model" },
} satisfies Record<string, BilingualText>);
export type CheckCode = keyof typeof REASONS;

export type AuthorityErrorCode = "NO_AUTHORITY_MODEL";
export class AuthorityError extends Error {
  readonly code: AuthorityErrorCode | string;
  constructor(code: AuthorityErrorCode | string, message: string) {
    super(message);
    this.name = "AuthorityError";
    this.code = code;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object";
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const objArr = (v: unknown): Obj[] =>
  Array.isArray(v) ? v.filter((x): x is Obj => !!x && typeof x === "object") : [];

/** `when`: {all:[{key, in|equals}]} */
export interface WhenClause {
  all?: Array<{ key?: string; in?: unknown[]; equals?: unknown }>;
}
export interface Condition {
  key?: string;
  equals?: unknown;
  in?: unknown[];
  between?: unknown[];
  applies_when?: WhenClause;
  [k: string]: unknown;
}
export interface Precondition {
  event_type: string;
  payload?: Record<string, unknown>;
  [k: string]: unknown;
}
export interface GoverningSource {
  status: SourceStatus;
  ref?: unknown;
  claims?: unknown;
  decision_ids?: unknown;
  [k: string]: unknown;
}

export interface NormalizedAction {
  action_id: string;
  ar: unknown;
  en: unknown;
  administrative: boolean;
  governing_source: GoverningSource;
  roles: Record<
    "preparer" | "reviewer" | "approver" | "decision_maker" | "executor" | "informed" | "auditor",
    string[]
  >;
  approval_required: boolean;
  approval: { kind: unknown; by: string[]; applies_to: unknown; source: unknown } | null;
  conditional_approvals: Array<Obj & { approver: string[]; when?: unknown }>;
  conditional_source_required: Obj[];
  excluded_relations: string[];
  object_conditions: Obj[];
  capacity_preconditions: Obj;
  evidence_required: unknown;
  preconditions: Precondition[];
  expires_on_events: string[];
  delegation: { allowed: boolean; from: string[]; to: string[]; acting_for: string[]; conditions: unknown };
  coi_restriction: unknown;
  next_action_kind: unknown;
  platform: { status: unknown; command: unknown } | null;
}

function normAction(a: Obj): NormalizedAction {
  const roles: Obj = isObj(a.roles) ? a.roles : {};
  const gs: Obj = isObj(a.governing_source)
    ? a.governing_source
    : { status: a.governing_source_status ?? "SOURCE_REQUIRED" };
  const status: SourceStatus = (SOURCE_STATUSES as readonly string[]).includes(String(gs.status))
    ? (String(gs.status) as SourceStatus)
    : "SOURCE_REQUIRED";
  const d: Obj = isObj(a.delegation) ? a.delegation : {};
  const ap: Obj | null = isObj(a.approval) ? a.approval : null;
  const roleKeys = [
    "preparer",
    "reviewer",
    "approver",
    "decision_maker",
    "executor",
    "informed",
    "auditor",
  ] as const;
  const plat = isObj(a.platform) ? a.platform : null;
  return {
    action_id: String(a.action_id),
    ar: a.ar ?? a.label_ar ?? a.action_id,
    en: a.en ?? a.label_en ?? a.action_id,
    administrative: a.administrative === true,
    governing_source: { ...gs, status },
    roles: Object.fromEntries(roleKeys.map((k) => [k, arr(roles[k])])) as NormalizedAction["roles"],
    approval_required: a.approval_required === true,
    approval: ap
      ? {
          kind: ap.kind ?? null,
          by: arr(ap.by),
          applies_to: ap.applies_to ?? null,
          source: ap.source ?? null,
        }
      : null,
    conditional_approvals: objArr(a.conditional_approvals).map((c) => ({ ...c, approver: arr(c.approver) })),
    conditional_source_required: objArr(a.conditional_source_required),
    excluded_relations: arr(a.excluded_relations),
    object_conditions: objArr(a.object_conditions),
    capacity_preconditions: isObj(a.capacity_preconditions) ? a.capacity_preconditions : {},
    evidence_required: a.evidence_required ?? null,
    preconditions: Array.isArray(a.preconditions)
      ? (a.preconditions.filter((p) => isObj(p) && p.event_type) as Precondition[])
      : [],
    expires_on_events: Array.isArray(a.expires_on_events) ? a.expires_on_events.map(String) : [],
    delegation: {
      allowed: d.allowed === true,
      from: arr(d.from),
      to: arr(d.to),
      acting_for: arr(d.acting_for),
      conditions: d.conditions ?? null,
    },
    coi_restriction: a.coi_restriction ?? null,
    next_action_kind: a.next_action_kind ?? null,
    platform: plat ? { status: plat.status ?? null, command: plat.command ?? null } : null,
  };
}

function actionsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isObj(raw))
    for (const k of ["actions", "authority", "rows", "entries"]) {
      const v = raw[k];
      if (Array.isArray(v)) return v;
    }
  return [];
}

export interface AuthorityModel {
  __normalized: true;
  version: string;
  status: string;
  source: string;
  path: string | null;
  actions: Map<string, NormalizedAction>;
  warnings: string[];
  seat_capacities: Set<string>;
  admin_capacities: Set<string>;
  reference_tests: unknown[];
}

const isNormalized = (v: unknown): v is AuthorityModel => isObj(v) && v.__normalized === true;

export function normalizeAuthority(
  raw: unknown,
  { source = "CUSTOM", path = null }: { source?: string; path?: string | null } = {},
): AuthorityModel {
  if (isNormalized(raw)) return raw;
  const actions = new Map<string, NormalizedAction>();
  const warnings: string[] = [];
  for (const a of actionsOf(raw)) {
    if (!isObj(a) || !a.action_id) {
      warnings.push("action without action_id ignored");
      continue;
    }
    actions.set(String(a.action_id), normAction(a));
  }
  const r: Obj = isObj(raw) && !Array.isArray(raw) ? raw : {};
  const sem: Obj = isObj(r.check_semantics) ? r.check_semantics : {};
  const seat = sem.seat_capacities;
  const admin = r.admin_capacities_never_case_actors;
  return {
    __normalized: true,
    version: String(r.version ?? "UNVERSIONED"),
    status: String(r.status ?? ""),
    source,
    path,
    actions,
    warnings,
    seat_capacities: new Set(Array.isArray(seat) && seat.length ? seat.map(String) : DEFAULT_SEAT_CAPACITIES),
    admin_capacities: new Set(
      Array.isArray(admin) && admin.length ? admin.map(String) : DEFAULT_ADMIN_CAPACITIES,
    ),
    reference_tests: Array.isArray(r.tests) ? r.tests : [],
  };
}

export interface LoadAuthorityOptions {
  /** informational label only in the port (no file system access in lib/); a path without `model` fails closed */
  path?: string | null;
  /** override model: an object or a JSON string; null/undefined when given explicitly = missing (fail closed) */
  model?: unknown;
}

/** load W-F's authority_v13.json (bundled), or an explicit override `model` (used by tests with fixture models) */
export function loadAuthority(opts: LoadAuthorityOptions = {}): AuthorityModel {
  const override = Object.hasOwn(opts, "model") || (opts.path !== undefined && opts.path !== null);
  let raw: unknown = authorityJson;
  const p = opts.path ?? (override ? null : AUTHORITY_PATHS.wf);
  if (override) {
    raw = opts.model;
    if (raw === undefined || raw === null)
      throw new AuthorityError(
        "NO_AUTHORITY_MODEL",
        "authority_v13.json not found — every action fails closed",
      );
  }
  let M: AuthorityModel;
  try {
    M = normalizeAuthority(typeof raw === "string" ? JSON.parse(raw) : raw, {
      source: override ? "CUSTOM" : "W-F",
      path: p,
    });
  } catch (e) {
    throw new AuthorityError(
      "NO_AUTHORITY_MODEL",
      `authority model unreadable (${e instanceof Error ? e.message : String(e)}) — fail closed`,
    );
  }
  if (!M.actions.size)
    throw new AuthorityError("NO_AUTHORITY_MODEL", "authority model has no actions — fail closed");
  return M;
}

interface RecordedEvent {
  type: unknown;
  payload: Obj;
  event_id: unknown;
}
function recordedEvents(object: Obj): RecordedEvent[] {
  const ev: RecordedEvent[] = [];
  if (Array.isArray(object?.events))
    for (const e of object.events)
      if (isObj(e) && (e.type || e.event_type))
        ev.push({
          type: e.type ?? e.event_type,
          payload: (e.payload ?? {}) as Obj,
          event_id: e.event_id ?? null,
        });
  if (Array.isArray(object?.recorded_event_types))
    for (const t of object.recorded_event_types) ev.push({ type: String(t), payload: {}, event_id: null });
  return ev;
}
function satisfies(events: RecordedEvent[], pre: Precondition): RecordedEvent | null {
  return (
    events.find(
      (e) =>
        e.type === pre.event_type &&
        Object.entries(pre.payload ?? {}).every(([k, v]) => e.payload?.[k] === v),
    ) ?? null
  );
}
/** `when`: {all:[{key:'object.<k>'|'actor.<k>', in:[…]|equals}]} — a missing key HOLDS unless a known value contradicts it */
function lookup(key: unknown, actor: Obj, object: Obj): unknown {
  const k = String(key ?? "");
  if (k.startsWith("object.")) return object?.[k.slice(7)];
  if (k.startsWith("actor.")) return actor?.[k.slice(6)];
  return object?.[k];
}
function whenHolds(when: unknown, actor: Obj, object: Obj): boolean {
  if (!isObj(when)) return true;
  const all = Array.isArray(when.all) ? (when.all as unknown[]) : [];
  return all.every((c0) => {
    const c: Obj = isObj(c0) ? c0 : {};
    const v = lookup(c.key, actor, object);
    if (v === undefined || v === null) return true;
    if (Array.isArray(c.in)) return c.in.includes(v);
    if (Object.prototype.hasOwnProperty.call(c, "equals")) return v === c.equals;
    return true;
  });
}
/** object condition: {key, equals|in|between, applies_when?} — a missing key does NOT hold */
function conditionHolds(c: Obj, actor: Obj, object: Obj): boolean {
  if (c.applies_when && !whenHolds(c.applies_when, actor, object)) return true;
  const v = lookup(c.key, actor, object);
  if (v === undefined || v === null) return false;
  if (Object.prototype.hasOwnProperty.call(c, "equals")) return v === c.equals;
  if (Array.isArray(c.in)) return c.in.includes(v);
  if (Array.isArray(c.between) && c.between.length === 2)
    return typeof v === "number" && v >= (c.between[0] as number) && v <= (c.between[1] as number);
  return false;
}

export interface Actor {
  capacity?: unknown;
  seat_active?: unknown;
  recused?: unknown;
  delegation_active?: unknown;
  acting_for?: unknown;
  [k: string]: unknown;
}
export interface CheckQuery {
  action_id?: unknown;
  actor?: Actor | null;
  object?: Record<string, unknown> | null;
  purpose?: unknown;
  manual_operation?: unknown;
}
export interface CheckStep {
  id: string;
  ok: boolean;
  [k: string]: unknown;
}
export interface CheckOutcome {
  result: CheckResult;
  effect: "ALLOWED" | "DENIED";
  code: CheckCode;
  reason: BilingualText;
  action_id: unknown;
  purpose: "DRAFT" | "EXECUTE";
  capacity: unknown;
  checks: CheckStep[];
  model_version: string;
  model_source: string;
  [k: string]: unknown;
}

export function check(authorityModel: unknown, query: CheckQuery = {}): CheckOutcome {
  const M = isNormalized(authorityModel)
    ? authorityModel
    : normalizeAuthority(authorityModel ?? {}, { source: "CUSTOM" });
  const { action_id } = query;
  const actor: Actor = query.actor ?? {};
  const object: Obj = query.object ?? {};
  const purpose = query.purpose === "DRAFT" ? "DRAFT" : "EXECUTE";
  const checks: CheckStep[] = [];
  const done = (result: CheckResult, code: CheckCode, extra: Obj = {}): CheckOutcome => ({
    result,
    effect: result === "ALLOWED" ? "ALLOWED" : "DENIED",
    code,
    reason: REASONS[code] ?? REASONS.NO_ROLE,
    action_id: action_id ?? null,
    purpose,
    capacity: actor.capacity ?? null,
    checks,
    model_version: M.version,
    model_source: M.source,
    ...extra,
  });
  // 1 action known
  const a = M.actions.get(String(action_id));
  if (!a) {
    checks.push({ id: "action_known", ok: false });
    return done("SOURCE_REQUIRED", "UNKNOWN_ACTION");
  }
  checks.push({ id: "action_known", ok: true });
  const base = {
    administrative: a.administrative,
    basis_status: a.governing_source.status,
    basis_ref: a.governing_source.ref ?? null,
    basis_claims: a.governing_source.claims ?? [],
    decision_ids: a.governing_source.decision_ids ?? [],
    action: { ar: a.ar, en: a.en },
    platform_status: a.platform?.status ?? null,
  };
  // 2 capacity (never inferred from a title); administrative capacities never act on a case
  const cap = typeof actor.capacity === "string" ? actor.capacity.trim() : "";
  if (!cap) {
    checks.push({ id: "capacity", ok: false });
    return done("DENIED", "NO_CAPACITY", base);
  }
  if (M.admin_capacities.has(cap)) {
    checks.push({ id: "capacity", ok: false, note: "administrative capacity" });
    return done("DENIED", "ADMIN_NEVER_CASE_ACTOR", base);
  }
  checks.push({ id: "capacity", ok: true });
  // 3 seat / assignment active
  if (
    (M.seat_capacities.has(cap) && actor.seat_active !== true) ||
    (cap !== "SYSTEM" && actor.seat_active === false)
  ) {
    checks.push({ id: "seat_active", ok: false });
    return done("DENIED", "SEAT_INACTIVE", base);
  }
  checks.push({ id: "seat_active", ok: true });
  // 4 recusal
  if (actor.recused === true) {
    checks.push({ id: "not_recused", ok: false });
    return done("DENIED", "RECUSED", base);
  }
  checks.push({ id: "not_recused", ok: true });
  // 5 excluded relations to the object
  const rel = arr(object.actor_relations).filter((r) => a.excluded_relations.includes(r));
  if (rel.length) {
    checks.push({ id: "excluded_relation", ok: false, relations: rel });
    return done("DENIED", "EXCLUDED_RELATION", { ...base, excluded_relations: rel });
  }
  checks.push({ id: "excluded_relation", ok: true });
  // 6 role for the purpose (delegation only where allowed, active, and the delegator holds the role)
  const R = a.roles;
  let role: string | null = null;
  let viaDelegation = false;
  const execRoles: Array<[string, string[]]> = [
    ["executor", R.executor],
    ["decision_maker", R.decision_maker],
    ["approver", R.approver],
  ];
  for (const [name, list] of execRoles)
    if (list.includes(cap)) {
      role = name;
      break;
    }
  if (!role && purpose === "DRAFT" && R.preparer.includes(cap)) role = "preparer";
  let delegationNote: string | null = null;
  if (!role && actor.delegation_active === true && actor.acting_for) {
    const af = String(actor.acting_for);
    const held: readonly [string, ...unknown[]] | null =
      execRoles.find(([, list]) => list.includes(af)) ??
      (purpose === "DRAFT" && R.preparer.includes(af) ? ["preparer"] : null);
    const toOk = !a.delegation.to.length || a.delegation.to.includes(cap);
    const forOk = !a.delegation.acting_for.length || a.delegation.acting_for.includes(af);
    if (held && a.delegation.allowed && toOk && forOk) {
      role = held[0];
      viaDelegation = true;
    } else if (held)
      delegationNote = "delegation not valid for this action (not allowed, wrong delegate or delegator)";
  }
  if (!role) {
    checks.push({ id: "role", ok: false, ...(delegationNote ? { note: delegationNote } : {}) });
    return done("DENIED", R.informed.includes(cap) ? "INFORMED_ONLY" : "NO_ROLE", base);
  }
  checks.push({ id: "role", ok: true, role, via_delegation: viaDelegation });
  const withRole = { ...base, role, via_delegation: viaDelegation };
  // 7 governing source; 8 conditional SOURCE_REQUIRED (fail closed; drafting only under a declared manual operation)
  const draftOk = purpose === "DRAFT" && query.manual_operation === true;
  if (a.governing_source.status === "SOURCE_REQUIRED" || a.governing_source.status === "DRAFT") {
    if (draftOk) {
      checks.push({
        id: "governing_source",
        ok: true,
        note: `${a.governing_source.status} — drafting under manual_operation`,
      });
      return done("ALLOWED", "SOURCE_REQUIRED_DRAFT", {
        ...withRole,
        manual_operation: true,
        label: "MANUAL_OPERATION",
        release_status: "DESIGN_PREVIEW",
      });
    }
    checks.push({ id: "governing_source", ok: false, status: a.governing_source.status });
    return done("SOURCE_REQUIRED", "SOURCE_REQUIRED", withRole);
  }
  checks.push({ id: "governing_source", ok: true, status: a.governing_source.status });
  const csr = a.conditional_source_required.find((c) =>
    whenHolds(c.when, { ...actor, capacity: cap }, object),
  );
  if (csr) {
    if (draftOk) {
      checks.push({
        id: "conditional_source",
        ok: true,
        note: "conditional SOURCE_REQUIRED — drafting under manual_operation",
      });
      return done("ALLOWED", "SOURCE_REQUIRED_DRAFT", {
        ...withRole,
        manual_operation: true,
        label: "MANUAL_OPERATION",
        release_status: "DESIGN_PREVIEW",
        condition: csr.condition ?? null,
      });
    }
    checks.push({ id: "conditional_source", ok: false, condition: csr.condition ?? null });
    return done("SOURCE_REQUIRED", "CONDITIONAL_SOURCE_REQUIRED", {
      ...withRole,
      condition: csr.condition ?? null,
      condition_decision_ids: csr.decision_ids ?? [],
    });
  }
  checks.push({ id: "conditional_source", ok: true });

  if (purpose === "EXECUTE") {
    // 9 preconditions
    const events = recordedEvents(object);
    for (const pre of a.preconditions) {
      const hit = satisfies(events, pre);
      if (!hit) {
        checks.push({ id: "precondition", ok: false, event_type: pre.event_type });
        return done("DENIED", "PRECONDITION_MISSING", {
          ...withRole,
          missing_event: pre.event_type,
          missing_payload: pre.payload ?? null,
        });
      }
      checks.push({ id: "precondition", ok: true, event_type: pre.event_type, event_id: hit.event_id });
    }
    // 10 expiry
    const exp = events.find((e) => a.expires_on_events.includes(e.type as string));
    if (exp) {
      checks.push({ id: "not_expired", ok: false, event_type: exp.type });
      return done("DENIED", "EXPIRED", { ...withRole, expired_by: exp.type });
    }
    checks.push({ id: "not_expired", ok: true });
    // 11 object conditions + the capacity's own preconditions
    const conds = [...a.object_conditions, ...objArr(a.capacity_preconditions[cap])];
    const failed = conds.find((c) => !conditionHolds(c, { ...actor, capacity: cap }, object));
    if (failed) {
      checks.push({ id: "object_condition", ok: false, key: failed.key });
      return done("DENIED", "OBJECT_CONDITION", { ...withRole, failed_condition: failed.key ?? null });
    }
    checks.push({ id: "object_condition", ok: true, count: conds.length });
    // 12 approvals
    const need: string[][] = [];
    if (a.approval_required && a.approval?.applies_to === "BEFORE_EXECUTION" && a.approval.by.length)
      need.push(a.approval.by);
    for (const c of a.conditional_approvals)
      if (c.approver.length && whenHolds(c.when, { ...actor, capacity: cap }, object)) need.push(c.approver);
    const have = arr(object.approvals);
    const missingApproval = need.find((set) => !set.some((x) => have.includes(x)));
    if (missingApproval) {
      checks.push({ id: "approval", ok: false, approver: missingApproval });
      return done("DENIED", "APPROVAL_MISSING", { ...withRole, missing_approval: missingApproval });
    }
    checks.push({ id: "approval", ok: true, required: need.length });
  }
  // 13 allowed
  return done("ALLOWED", "ALLOWED", { ...withRole, release_status: "BASIS_RECORDED" });
}

export const isAllowed = (r: unknown): boolean =>
  isObj(r) && r.result === "ALLOWED" && r.effect === "ALLOWED";
export function actionOf(authorityModel: unknown, action_id: unknown): NormalizedAction | null {
  const M = isNormalized(authorityModel) ? authorityModel : normalizeAuthority(authorityModel ?? {});
  return M.actions.get(String(action_id)) ?? null;
}
