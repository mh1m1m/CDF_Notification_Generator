/**
 * PRODUCTION_SUBSTITUTION_REQUIRED: in-memory test double
 *
 * caseReadModel — mock read model for Domain A (Case Intelligence) (W-D1, charter §2 A, §3.1, §10).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Production reads the case through api.* inside the caller's security context (RLS; CLAUDE.md §3), never through the
 * browser. This mock serves CaseRecords from a synthetic scenario map.
 *
 * Mirrors (FACT): case_mgmt.case_record (20261007000400_domain_tables.sql:103-129) — uuid key (:104), display number
 * `case_number` (:105) that is never a key (CLAUDE.md §87), classification (:109), is_restricted (:110), records_state
 * ACTIVE|CLOSED|… (:119-120), closed_at (:124), row_version (:127). The V8 status code and the flags of charter §3.1 come
 * from the 1870 case history (charter §2 A) — here they are scenario data.
 * Contract: getCase(case_id) → CaseRecord (charter §3.1) as a frozen copy, or {case_id, exists:false} for any id that is
 * not a known case key (unknown uuid, a display number, anything else). `exists:false` ⇒ no master journey is rendered
 * (charter §3.1) and the consistency engine blocks any case reference (PC-07).
 * Ported to strict TypeScript from the V13 reference (src/lifecycle/adapters/caseReadModel.js); behaviour unchanged.
 */
import { deepFreeze, clone, UUID } from "@/lib/notifications/lifecycle/util";
import type { CaseReadModelPort, CaseRecord, CaseView } from "@/lib/notifications/lifecycle/ports";

const STATUS_CODE = /^S[1-5]\.\d{2}$/;
const FLAGS = ["suspended", "returned", "cancelled", "reopened", "closed"] as const;

export class CaseReadModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CaseReadModelError";
    this.code = code;
  }
}

/** Scenario input: read defensively (validated below). */
type CaseInput = Partial<Omit<CaseRecord, "status" | "flags">> & {
  status?: { code?: string; recorded_at?: string; source_event_id?: string | null } | null;
  flags?: Partial<Record<(typeof FLAGS)[number], unknown>>;
};

function validateCase(c: CaseInput): void {
  if (!UUID.test(c.case_id ?? "")) throw new CaseReadModelError("INVALID_CASE", "case_id must be a uuid");
  if (!["WB", "IR", "DR"].includes(c.track as string)) throw new CaseReadModelError("INVALID_CASE", "track");
  if (!["PUBLIC", "INTERNAL", "RESTRICTED"].includes(c.classification as string))
    throw new CaseReadModelError("INVALID_CASE", "classification");
  if (c.status !== null && c.status !== undefined) {
    if (!STATUS_CODE.test(c.status.code ?? ""))
      throw new CaseReadModelError("INVALID_CASE", "status.code must be a V8 code (S1.01…S5.xx)");
  }
  for (const f of FLAGS) {
    if (typeof (c.flags ?? {})[f] !== "boolean")
      throw new CaseReadModelError("INVALID_CASE", `flags.${f} must be boolean`);
  }
}

export interface CaseReadModel extends CaseReadModelPort {
  readonly kind: "mock-case-read-model";
}

export function createCaseReadModel(
  scenarios: readonly CaseInput[] | Readonly<Record<string, CaseInput>> = [],
): CaseReadModel {
  const table = new Map<string, CaseView>();
  for (const c of Array.isArray(scenarios)
    ? (scenarios as readonly CaseInput[])
    : Object.values(scenarios as Record<string, CaseInput>)) {
    validateCase(c);
    table.set(c.case_id as string, deepFreeze({ ...clone(c as CaseRecord), exists: true as const }));
  }
  return Object.freeze({
    kind: "mock-case-read-model" as const,
    getCase(caseId: unknown): CaseView {
      if (typeof caseId === "string" && UUID.test(caseId) && table.has(caseId))
        return table.get(caseId) as CaseView;
      return deepFreeze({ case_id: typeof caseId === "string" ? caseId : null, exists: false as const });
    },
  });
}
