/**
 * CDF Notifications V13 — procedural consistency engine (W-D1, charter §8).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * validate(ctx, rules = RULES) → {ok, violations:[{id, severity, blocking, explanation, remediation, detail}],
 *                                 warnings:[…], evaluated:[rule ids], rules_version, engine_version}
 *   - ok === true only when no BLOCK rule fired. WARN rules go to `warnings` and never block.
 *   - Fail closed: a context without notification/type_code yields PC-00; a rule whose condition throws yields
 *     PC-ENGINE for that rule (the error message is not copied: it could echo data).
 *   - Pure and deterministic: same context → same result. No generative model is consulted; the rules are the
 *     source of truth, and the lifecycle (lib/notifications/lifecycle/notification.ts) refuses VALIDATED unless ok === true.
 * explain(violation, lang) → one human-readable line in Arabic ('ar', default) or English ('en').
 * Ported to strict TypeScript from the V13 reference package (src/consistency/engine.js); behaviour unchanged.
 */
import { RULES, META_RULES, RULES_VERSION, CHARTER_MINIMUM } from "./rules";
import type { Bilingual, ConsistencyContext, ConsistencyRule, RuleDetail, Severity } from "./rules";
import { deepFreeze, type DeepReadonly } from "../lifecycle/util";

export const ENGINE_VERSION = "PC-ENGINE-V13-draft-2026-10-27";

interface IndexedRule {
  readonly ar?: string;
  readonly en?: string;
  readonly severity?: Severity;
  readonly explanation?: Bilingual;
  readonly remediation?: Bilingual;
}

const RULE_INDEX = new Map<string, IndexedRule>([
  ...RULES.map((r): [string, IndexedRule] => [r.id, r]),
  ...Object.entries(META_RULES),
]);

export class RuleSetError extends Error {
  readonly code = "INVALID_RULE_SET" as const;
  constructor(message: string) {
    super(message);
    this.name = "RuleSetError";
  }
}

/** Throws unless every rule is well formed and ids are unique. */
export function assertRuleSet(rules: unknown): true {
  if (!Array.isArray(rules)) throw new RuleSetError("rules must be an array");
  const seen = new Set<string>();
  for (const item of rules as readonly unknown[]) {
    const r = item as Partial<ConsistencyRule> | null | undefined;
    if (!r || typeof r.id !== "string" || typeof r.condition !== "function")
      throw new RuleSetError("each rule needs an id and a condition function");
    if (!["BLOCK", "WARN"].includes(r.severity as string) || r.blocking !== (r.severity === "BLOCK"))
      throw new RuleSetError(`${r.id}: severity/blocking mismatch`);
    if (seen.has(r.id)) throw new RuleSetError(`duplicate rule id ${r.id}`);
    seen.add(r.id);
  }
  return true;
}

/** Throws unless the charter §8 minimum (PC-01 … PC-17) is present. */
export function assertMinimumRuleSet(rules: unknown): true {
  assertRuleSet(rules);
  const ids = new Set((rules as readonly ConsistencyRule[]).map((r) => r.id));
  const missing = CHARTER_MINIMUM.filter((id) => !ids.has(id));
  if (missing.length) throw new RuleSetError(`rule set lacks charter §8 minimum: ${missing.join(", ")}`);
  return true;
}

/** One fired rule: codes and ids only in `detail`. */
export interface RuleItem {
  id: string;
  severity: Severity;
  blocking: boolean;
  explanation: Bilingual | undefined;
  remediation: Bilingual | undefined;
  detail: RuleDetail | null;
}

export interface ValidationResult {
  ok: boolean;
  violations: RuleItem[];
  warnings: RuleItem[];
  evaluated: string[];
  rules_version: string;
  engine_version: string;
}

interface ItemSource {
  readonly id: string;
  readonly severity: Severity;
  readonly blocking: boolean;
  readonly explanation?: Bilingual;
  readonly remediation?: Bilingual;
}

function item(rule: ItemSource, detail: RuleDetail | null | undefined): RuleItem {
  return {
    id: rule.id,
    severity: rule.severity,
    blocking: rule.blocking,
    explanation: rule.explanation,
    remediation: rule.remediation,
    detail: detail ?? null,
  };
}

export function validate(ctx: unknown, rules: unknown = RULES): DeepReadonly<ValidationResult> {
  assertRuleSet(rules);
  const violations: RuleItem[] = [];
  const warnings: RuleItem[] = [];
  const base = { rules_version: RULES_VERSION, engine_version: ENGINE_VERSION };
  const c = ctx as { readonly notification?: { readonly type_code?: unknown } } | null | undefined;
  if (
    !c ||
    typeof c !== "object" ||
    !c.notification ||
    typeof c.notification.type_code !== "string" ||
    !c.notification.type_code
  ) {
    violations.push(item(META_RULES["PC-00"], { reason: "CONTEXT_INCOMPLETE" }));
    return deepFreeze({ ok: false, violations, warnings, evaluated: [], ...base });
  }
  const list = rules as readonly ConsistencyRule[];
  for (const rule of list) {
    let detail: RuleDetail | null | undefined | false;
    try {
      detail = rule.condition(ctx as ConsistencyContext);
    } catch (err) {
      const e = err as { readonly name?: unknown; readonly code?: unknown } | null | undefined;
      violations.push(
        item(META_RULES["PC-ENGINE"], { rule_id: rule.id, error: e?.name ?? "Error", code: e?.code ?? null }),
      );
      continue;
    }
    if (detail === null || detail === undefined || detail === false) continue;
    (rule.blocking ? violations : warnings).push(item(rule, detail));
  }
  return deepFreeze({
    ok: violations.length === 0,
    violations,
    warnings,
    evaluated: list.map((r) => r.id),
    ...base,
  });
}

/** What explain() reads from a violation (a RuleItem, or any object carrying at least an id). */
export interface ExplainInput {
  readonly id?: unknown;
  readonly severity?: Severity | string;
  readonly explanation?: Partial<Bilingual> | null;
  readonly remediation?: Partial<Bilingual> | null;
  readonly detail?: RuleDetail | null;
}

export function explain(violation: ExplainInput | null | undefined, lang = "ar"): string {
  if (!violation || typeof violation.id !== "string")
    throw new TypeError("explain: a violation with an id is required");
  const id = violation.id;
  const L = lang === "en" ? "en" : "ar";
  const rule = RULE_INDEX.get(id);
  const title = rule ? rule[L] : id;
  const exp = violation.explanation?.[L] ?? rule?.explanation?.[L] ?? "";
  const rem = violation.remediation?.[L] ?? rule?.remediation?.[L] ?? "";
  const reason = violation.detail?.reason
    ? ` (${String(violation.detail.reason)})`
    : violation.detail?.rule_id
      ? ` (${String(violation.detail.rule_id)})`
      : "";
  const sev = violation.severity ?? rule?.severity ?? "BLOCK";
  if (L === "ar")
    return `[${id} · ${sev === "BLOCK" ? "مانع" : "تنبيه"}] ${title}${reason}: ${exp} — المعالجة: ${rem}`;
  return `[${id} · ${sev}] ${title}${reason}: ${exp} — Remediation: ${rem}`;
}

export { RULES, META_RULES, RULES_VERSION, CHARTER_MINIMUM };
