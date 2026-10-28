// Workspaces and role codes of the V13 platform. Closed sets: adding one is an access-model change (architect decision).
// The database is the authority (cdf_notifications_v13.workspace / .role, migration 0001 and the M1 seed); these
// constants mirror it so the application can pre-check and render without a query. tests/unit/persona-registry.spec.ts
// pins the values; tests/integration/persona-registry.spec.ts compares them with the database when the seed is loaded.
import { z } from "zod";
import { UuidSchema } from "./ids";

export const WORKSPACE_CODES = ["SECRETARIAT", "INVESTIGATIONS", "GOVERNANCE"] as const;
export const WorkspaceCodeSchema = z.enum(WORKSPACE_CODES);
export type WorkspaceCode = z.infer<typeof WorkspaceCodeSchema>;

/** Primary key of cdf_notifications_v13.workspace. */
export const WorkspaceIdSchema = UuidSchema.brand<"WorkspaceId">();
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

/** Workspace code → database id (fixed ids of the M1 seed, database/seed/0001_m1_synthetic.sql). */
export const WORKSPACE_IDS: Readonly<Record<WorkspaceCode, WorkspaceId>> = Object.freeze({
  SECRETARIAT: WorkspaceIdSchema.parse("0a000000-0000-4000-8000-000000000001"),
  INVESTIGATIONS: WorkspaceIdSchema.parse("0a000000-0000-4000-8000-000000000002"),
  GOVERNANCE: WorkspaceIdSchema.parse("0a000000-0000-4000-8000-000000000003"),
});

/** The code of a workspace id, or null for any other value (untrusted input). */
export function workspaceCodeOf(id: unknown): WorkspaceCode | null {
  if (typeof id !== "string") return null;
  return WORKSPACE_CODES.find((code) => WORKSPACE_IDS[code] === id) ?? null;
}

export const ROLE_CODES = ["COMMITTEE_SECRETARY", "INVESTIGATOR", "GOVERNANCE_OFFICER"] as const;
export const RoleCodeSchema = z.enum(ROLE_CODES);
export type RoleCode = z.infer<typeof RoleCodeSchema>;
