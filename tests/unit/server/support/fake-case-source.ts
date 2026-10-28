// In-memory CaseSourceAdapter over the 10 synthetic M1 cases, honouring the CaseSourceAdapter contract with the seed
// visibility table of docs/architecture/DATA_MODEL.md §5 (DB, measured 28 Oct 2026). Unit tests only.
import {
  CaseListFilterSchema,
  type CaseId,
  type CaseListFilter,
  type CaseListPage,
  type CaseSourceAdapter,
  type CaseSummary,
  type RequestIdentity,
} from "@/lib/contracts";

const n = (i: number) => String(i).padStart(4, "0");
export const caseIdOf = (i: number) =>
  `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}` as CaseId;

export const FAKE_CASES: readonly CaseSummary[] = Array.from({ length: 10 }, (_, k) => {
  const i = k + 1;
  return {
    case_id: caseIdOf(i),
    case_number: `CDF-DEMO-2026-${n(i)}`,
    title_key: null,
    synthetic_title: `Demo case ${n(i)}`,
    lifecycle_stage: i === 10 ? "CLOSURE" : "INVESTIGATION",
    is_restricted: i === 9,
    records_state: i === 10 ? "CLOSED" : "ACTIVE",
    source_system: "V13_SYNTHETIC",
    source_ref: `demo-${n(i)}`,
    updated_at: "2026-10-28T00:00:00.000Z",
  } as CaseSummary;
});

/** persona_id@workspace → visible case numbers (suffixes). Anything not listed sees nothing. */
const VISIBLE: Readonly<Record<string, readonly number[]>> = {
  "0b000000-0000-4000-8000-000000000001@SECRETARIAT": [1, 3, 4, 6, 7, 8, 10],
  "0b000000-0000-4000-8000-000000000002@INVESTIGATIONS": [1, 2, 3, 5, 6, 9, 10],
  "0b000000-0000-4000-8000-000000000003@INVESTIGATIONS": [1, 2, 3, 5, 6, 10],
  "0b000000-0000-4000-8000-000000000004@GOVERNANCE": [1, 2, 3, 4, 7, 8, 10],
  "0b000000-0000-4000-8000-000000000004@SECRETARIAT": [1, 3, 4, 6, 7, 8, 10],
};

export function visibleTo(identity: RequestIdentity): readonly CaseSummary[] {
  const allowed = VISIBLE[`${identity.persona_id}@${identity.active_workspace}`] ?? [];
  return FAKE_CASES.filter((_, k) => allowed.includes(k + 1));
}

export function createFakeCaseSource(): CaseSourceAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    sourceSystem: "V13_SYNTHETIC",
    calls,
    async listCases(identity: RequestIdentity, filter: CaseListFilter): Promise<CaseListPage> {
      calls.push("listCases");
      const f = CaseListFilterSchema.parse(filter);
      const after = f.cursor ?? "";
      const rows = visibleTo(identity)
        .filter((c) => c.case_number > after)
        .filter((c) => !f.records_state || c.records_state === f.records_state)
        .filter((c) => !f.text || c.case_number.includes(f.text));
      const items = rows.slice(0, f.limit);
      return { items, next_cursor: rows.length > f.limit ? (items.at(-1)?.case_number ?? null) : null };
    },
    async getCase(identity: RequestIdentity, caseId: CaseId): Promise<CaseSummary | null> {
      calls.push("getCase");
      return visibleTo(identity).find((c) => c.case_id === caseId) ?? null;
    },
  };
}
