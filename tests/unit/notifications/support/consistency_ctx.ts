/**
 * CDF Notifications V13 — W-D1 consistency context from a projected and rendered demo notification (W-D2).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Port note: moved from the reference src/demo/ to the unit-test support folder (it serves the demo build and its tests).
 *
 * consistencyContext({scenario, recipient, model, projected, catalogue, rendered}) → the context of W-D1's validate(ctx)
 * (consistency rules header). It describes what the notification shows, so that W-D1's rules compare it with the
 * record and with the disclosure log:
 *  - fields_shown: every projected field with a value, in the form the projection gave it — GENERALIZED for
 *    {generalized:true}, SAFE_REFERENCE for {safe_reference:true} (or the notice's safe token), otherwise RAW; and then a
 *    check of the RENDERED outputs (`rendered`: HTML, text twin, card JSON, EML of one variant): a field whose recorded
 *    value was withheld or transformed, but whose identifying leaves (for name/content fields: any longer leaf) still
 *    appear as whole tokens in a rendered output, is reported as shown RAW — so W-D1's PC-06 blocks a renderer that
 *    re-introduces what the projection removed, independently of W-D2's own sweeps;
 *  - l1_code: the recorded status code whenever Level 1 is shown (the position is derived from it, charter §3.1);
 *  - deadline: the record's deadline (with its basis) only when the projected deadline shows a date;
 *  - progress: the Level-3 items the projection lets through, with the record's evidence ids and the catalogue's
 *    completion types; alternative_groups from W-C's resolution; deadline_rules from the catalogue;
 *  - claims: the statements the scenario's wording makes (scenario.claims), each with its basis event;
 *  - informational / required_action: the rendered next-action flag and kind; lifecycle_status DRAFT (design preview).
 * Not passed: journey/addressed capacities (the W-C catalogue names capacities as labels, not codes: PC-21 not evaluated),
 * an event label type (the header names the template, not an event: PC-24 not evaluated), and the authority of the act a
 * notice reports unless a scenario names `reported_action` (PC-08).
 */
import { wcResolution, type Catalogue, type NotificationModel } from "@/lib/notifications/render/model";
import type { Scenario, Recipient, L3Steps, StepView, DeadlineField } from "@/lib/notifications/render/types";
import { isNil } from "@/lib/domain/nil";

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
/** fields whose every longer leaf identifies content (names, narratives, outcomes, Level-1 names) */
const ALL_LEAVES = new Set([
  "member_names",
  "participant_names",
  "reporter_identity",
  "l1_substate",
  "l1_stage_name",
  "allegations",
  "investigation_details",
  "decision_outcome",
  "decision_reasons",
]);
const ID_LIKE = /[0-9@/]|-[A-Za-z0-9]/;

function leaves(v: unknown, out: string[] = []): string[] {
  if (isNil(v)) return out;
  if (typeof v === "string") out.push(v);
  else if (typeof v === "number") out.push(String(v));
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (typeof v === "object")
    for (const [k, x] of Object.entries(v)) if (!ENUM_KEYS.has(k)) leaves(x, out);
  return out;
}
const wholeToken = (s: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");

/** identifying leaves of a field's recorded value */
export function identifyingLeaves(field: string, value: unknown): string[] {
  return [
    ...new Set(
      leaves(value)
        .map((s) => s.trim())
        .filter((s) => (ALL_LEAVES.has(field) ? s.length >= 6 : s.length >= 4 && ID_LIKE.test(s))),
    ),
  ];
}

/** fields whose recorded value (not the projected replacement) surfaces in a rendered output */
export function surfacedFields(
  model: { fields?: Readonly<Record<string, unknown>> } | null | undefined,
  projectedFields: Readonly<Record<string, unknown>>,
  rendered: readonly unknown[] | null | undefined,
): string[] {
  const outs = (rendered ?? []).filter((x): x is string => typeof x === "string" && !!x);
  if (!outs.length) return [];
  const hits: string[] = [];
  for (const [field, value] of Object.entries(model?.fields ?? {})) {
    const pv = projectedFields[field];
    const transformed =
      isNil(pv) ||
      (typeof pv === "object" &&
        ((pv as { generalized?: unknown }).generalized === true ||
          (pv as { safe_reference?: unknown }).safe_reference === true));
    if (!transformed) continue; // shown as recorded: nothing withheld to look for
    const leak = identifyingLeaves(field, value).find((s) => outs.some((o) => wholeToken(s).test(o)));
    if (leak) hits.push(field);
  }
  return hits;
}

type Form = "GENERALIZED" | "SAFE_REFERENCE" | "RAW";
const formOf = (value: unknown, safeToken: string | null): Form => {
  if (value && typeof value === "object" && (value as { generalized?: unknown }).generalized === true)
    return "GENERALIZED";
  if (value && typeof value === "object" && (value as { safe_reference?: unknown }).safe_reference === true)
    return "SAFE_REFERENCE";
  if (typeof value === "string" && safeToken && value === safeToken) return "SAFE_REFERENCE";
  return "RAW";
};

/** what the context reads from a projected model */
export interface ProjectedLike {
  fields?: Readonly<Record<string, unknown>>;
  _disclosure_log?: unknown;
}
export interface ConsistencyInput {
  scenario: Scenario;
  recipient: Recipient;
  model: NotificationModel;
  projected: ProjectedLike | null | undefined;
  catalogue: Catalogue | null | undefined;
  rendered?: readonly unknown[];
}
export interface ConsistencyContext {
  notification: {
    type_code: string;
    trigger_event_id: string | null;
    lifecycle_status: "DRAFT";
    claims: Readonly<Record<string, unknown>>;
    fields_shown: { field: string; form: Form }[];
    deadline: {
      kind: string | null | undefined;
      at: string | null | undefined;
      basis_event_id: string | null;
      basis_rule: string | null;
    } | null;
    l1_code: string | null;
    recipient: { id: string | null; class: string; capacity: string | null };
    informational: boolean | undefined;
    required_action: { kind: string } | undefined;
    rendered_from_event_id: string | null;
    authority_action_id?: string;
  };
  case: Scenario["case"] | null;
  procedural_object: Scenario["object"] | null;
  events: NonNullable<Scenario["events"]>;
  progress: {
    actual: {
      step_id: string;
      actual: string | null | undefined;
      evidence_event_id: string | null;
      completion_event_type: string | null;
    }[];
    expected: { step_id: string; kind: string | undefined; epistemic: string | null }[];
  };
  disclosure_log: unknown;
  authority: { result: string; action_id: string } | null;
  alternative_groups: unknown;
  deadline_rules: Record<string, { trigger_event_types: string[] }>;
}

export function consistencyContext({
  scenario,
  recipient,
  model,
  projected,
  catalogue,
  rendered = [],
}: ConsistencyInput): ConsistencyContext {
  const pf = projected?.fields ?? {};
  const safeToken = model?.safe_refs?.["*"] ?? null;
  const shown = new Map<string, Form>(
    Object.entries(pf)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([field, v]) => [field, formOf(v, field === "notice_reference" ? null : safeToken)]),
  );
  for (const field of surfacedFields(model as { fields?: Readonly<Record<string, unknown>> }, pf, rendered))
    shown.set(field, "RAW");
  const fields_shown = [...shown].map(([field, form]) => ({ field, form }));
  const l1 = pf.l1_stage_name as
    { generalized?: unknown; safe_reference?: unknown; exists?: unknown } | null | undefined;
  const l1Shown =
    !!l1 && typeof l1 === "object" && !l1.generalized && !l1.safe_reference && l1.exists !== false;
  const pDeadline = pf.deadline as { at?: unknown } | null | undefined;
  const shownDeadline: DeadlineField | null | undefined =
    pDeadline && typeof pDeadline === "object" && pDeadline.at ? model.fields.deadline : null;
  const deadline = shownDeadline
    ? {
        kind: shownDeadline.kind,
        at: shownDeadline.at,
        basis_event_id: shownDeadline.basis_event_id ?? null,
        basis_rule: shownDeadline.basis_rule ?? null,
      }
    : null;
  const journey = (catalogue?.journeys ?? []).find((j) => j.id === scenario.object?.journey_id) ?? null;
  const catStep = new Map((journey?.stages ?? []).flatMap((st) => st.steps.map((x) => [x.id, x] as const)));
  const recordSteps = new Map(
    (model?.fields?.l3_steps?.stages ?? []).flatMap((st) => st.steps).map((x) => [x.step_id, x]),
  );
  const pl3 = pf.l3_steps as L3Steps | null | undefined;
  const l3 = pl3 && typeof pl3 === "object" && !pl3.generalized && !pl3.safe_reference ? pl3 : null;
  const steps: StepView[] = (l3?.stages ?? []).flatMap((st) => st.steps ?? []);
  const progress = {
    actual: steps
      .filter((x) => x.layer === "actual")
      .map((x) => ({
        step_id: x.step_id,
        actual: x.state,
        evidence_event_id: recordSteps.get(x.step_id)?.evidence_event_id ?? null,
        completion_event_type: catStep.get(x.step_id)?.completion_event_type ?? null,
      })),
    expected: steps
      .filter((x) => x.layer === "expected")
      .map((x) => ({ step_id: x.step_id, kind: x.kind, epistemic: x.epistemic ?? null })),
  };
  const l23 = wcResolution(scenario.object, scenario.events ?? [], catalogue, scenario.assignment_id ?? null);
  const deadline_rules = Object.fromEntries(
    Object.entries(catalogue?.deadline_rules ?? {})
      .filter((e): e is [string, { basis_event_type: string }] => !!e[1] && !!e[1].basis_event_type)
      .map(([id, r]) => [id, { trigger_event_types: [r.basis_event_type] }]),
  );
  const na0 = pf.next_action;
  const na = na0 && typeof na0 === "object" ? (na0 as { informational?: unknown; kind?: unknown }) : null;
  return {
    notification: {
      type_code: scenario.type_code,
      trigger_event_id: scenario.trigger_event_id ?? null,
      lifecycle_status: "DRAFT",
      claims: scenario.claims ?? {},
      fields_shown,
      deadline,
      l1_code: l1Shown ? (scenario.case?.status?.code ?? null) : null,
      recipient: {
        id: recipient.ref ?? null,
        class: recipient.class,
        capacity: recipient.actor?.capacity ?? null,
      },
      informational: na ? na.informational === true : undefined,
      required_action: na?.kind ? { kind: String(na.kind) } : undefined,
      rendered_from_event_id: scenario.trigger_event_id ?? null,
      ...(scenario.reported_action ? { authority_action_id: scenario.reported_action.action_id } : {}),
    },
    case: scenario.case ?? null,
    procedural_object: scenario.object ?? null,
    events: scenario.events ?? [],
    progress,
    disclosure_log: projected?._disclosure_log ?? null,
    authority: scenario.reported_action?.result
      ? { result: scenario.reported_action.result, action_id: scenario.reported_action.action_id }
      : null,
    alternative_groups: l23?.alternative_groups ?? [],
    deadline_rules,
  };
}
