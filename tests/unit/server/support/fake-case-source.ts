// In-memory CaseSourceAdapter over the 10 synthetic M1 cases, honouring the CaseSourceAdapter contract with the seed
// visibility table of docs/architecture/DATA_MODEL.md §5 (DB, measured 28 Oct 2026). Unit tests only.
import {
  CaseListFilterSchema,
  type CaseCapacity,
  type CaseHeader,
  type CaseId,
  type CaseListFilter,
  type CaseListItem,
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
    synthetic_title: { ar: `قضية تجريبية ${n(i)}`, en: `Demo case ${n(i)}` },
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

/** persona_id → case suffixes with an active case assignment (seed 0002_m1_cases, case_assignment). */
const ASSIGNED: Readonly<Record<string, readonly number[]>> = {
  "0b000000-0000-4000-8000-000000000001": [1, 3, 4, 7, 8, 10],
  "0b000000-0000-4000-8000-000000000002": [1, 3, 5, 6, 9],
  "0b000000-0000-4000-8000-000000000003": [2, 6, 10],
  "0b000000-0000-4000-8000-000000000004": [8],
};

/** persona_id → case suffix → own open tasks (small synthetic sample). */
const OPEN_TASKS: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  "0b000000-0000-4000-8000-000000000001": { 1: 1, 3: 1, 4: 2 },
  "0b000000-0000-4000-8000-000000000002": { 1: 1, 3: 1, 5: 2 },
  "0b000000-0000-4000-8000-000000000003": { 2: 2, 6: 1 },
};

/** persona_id → capacity on its assigned cases (Alpha on 0001 is SECRETARY, DB-008 seed facts). */
const CAPACITY: Readonly<Record<string, CaseCapacity>> = {
  "0b000000-0000-4000-8000-000000000001": "SECRETARY",
  "0b000000-0000-4000-8000-000000000002": "INVESTIGATOR",
  "0b000000-0000-4000-8000-000000000003": "INVESTIGATOR",
  "0b000000-0000-4000-8000-000000000004": "GOVERNANCE_REVIEWER",
};

export const eventIdOf = (i: number) => `0e000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;

/** The row as the identity sees it: last event (none for 0005, to cover the empty case) and own open tasks. */
function itemFor(identity: RequestIdentity, c: CaseSummary): CaseListItem {
  const i = Number(c.case_number.slice(-4));
  return {
    ...c,
    last_event_id: i === 5 ? null : eventIdOf(i),
    last_event_at: i === 5 ? null : `2026-10-${String(10 + i).padStart(2, "0")}T09:00:00.000Z`,
    my_open_task_count: OPEN_TASKS[identity.persona_id]?.[i] ?? 0,
  };
}

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
      const matching = visibleTo(identity)
        .filter((c) => !f.records_state || c.records_state === f.records_state)
        .filter((c) => !f.lifecycle_stage || c.lifecycle_stage === f.lifecycle_stage)
        .filter((c) => !f.text || c.case_number.includes(f.text))
        .filter(
          (c) =>
            !f.assigned_to_me ||
            (ASSIGNED[identity.persona_id] ?? []).includes(Number(c.case_number.slice(-4))),
        )
        .map((c) => itemFor(identity, c));
      const rows = matching.filter((c) => c.case_number > after);
      const items = rows.slice(0, f.limit);
      return {
        items,
        next_cursor: rows.length > f.limit ? (items.at(-1)?.case_number ?? null) : null,
        total: matching.length,
      };
    },
    async getCase(identity: RequestIdentity, caseId: CaseId): Promise<CaseHeader | null> {
      calls.push("getCase");
      const found = visibleTo(identity).find((c) => c.case_id === caseId);
      if (!found) return null;
      const assigned = (ASSIGNED[identity.persona_id] ?? []).includes(Number(found.case_number.slice(-4)));
      return { ...found, my_capacity: assigned ? (CAPACITY[identity.persona_id] ?? null) : null };
    },
  };
}
