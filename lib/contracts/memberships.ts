// The persona's workspace memberships as the database confirms them in the request's security context (V13-FE-008,
// OI-044). The persona registry (personas.ts) says which memberships a synthetic persona was given; this says which of
// them hold now: the persona is active and the membership's window contains now(). Only this may name a role on screen.
import { z } from "zod";
import type { RequestIdentity } from "./identity";
import { RoleCodeSchema, WorkspaceCodeSchema } from "./workspaces";

/** One active membership of the current persona (persona_workspace_membership × workspace × role, migration 0001). */
export const ConfirmedMembershipSchema = z.strictObject({
  workspace: WorkspaceCodeSchema,
  role: RoleCodeSchema,
});
export type ConfirmedMembership = z.infer<typeof ConfirmedMembershipSchema>;

/**
 * V13's read of the current persona's active memberships. RLS inside every call (membership_select_own,
 * workspace_select_member): an inactive persona, an expired or future membership and an inactive workspace give no
 * row. A row with a code outside the closed sets refuses the whole result.
 */
export interface MembershipReader {
  confirmedMemberships(identity: RequestIdentity): Promise<readonly ConfirmedMembership[]>;
}
