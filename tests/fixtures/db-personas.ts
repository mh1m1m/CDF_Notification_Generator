// The persona/workspace pairs the database halves check, each pinned to its visible cases (DATA_MODEL.md §5), so an
// empty read (wrong claims key, broken policy) fails instead of passing vacuously. SYNTHETIC data only.
import type { WorkspaceCode } from "@/lib/contracts";
import { caseId } from "./scenario";

export interface PersonaInWorkspace {
  persona: string;
  workspace: WorkspaceCode;
  sees: string[];
}

const PAIRS: readonly PersonaInWorkspace[] = [
  { persona: "secretary-alpha", workspace: "SECRETARIAT", sees: ["01", "03", "04", "06", "07", "08", "10"] },
  {
    persona: "investigator-beta",
    workspace: "INVESTIGATIONS",
    sees: ["01", "02", "03", "05", "06", "09", "10"],
  },
  { persona: "investigator-gamma", workspace: "INVESTIGATIONS", sees: ["01", "02", "03", "05", "06", "10"] },
  {
    persona: "governance-officer-delta",
    workspace: "GOVERNANCE",
    sees: ["01", "02", "03", "04", "07", "08", "10"],
  },
  {
    persona: "governance-officer-delta",
    workspace: "SECRETARIAT",
    sees: ["01", "03", "04", "06", "07", "08", "10"],
  },
];

export const DB_PERSONAS: readonly PersonaInWorkspace[] = PAIRS.map((p) => ({
  ...p,
  sees: p.sees.map(caseId).sort(),
}));

/** Case-keyed tables cdf_v13_user reads today; discovery must find at least these. */
export const KNOWN_CASE_KEYED = [
  "case_assignment",
  "case_workspace_visibility",
  "notification",
  "notification_event",
  "procedural_event",
  "task",
] as const;
