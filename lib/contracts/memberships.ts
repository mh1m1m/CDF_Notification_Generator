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
 * The current persona's memberships that hold now. Every implementation guarantees: only the requesting persona's own
 * memberships; none at all for an inactive persona; only memberships whose window contains now() (no expired, no
 * future one); only memberships in an active workspace. The claimed active workspace never adds or removes a row. A
 * value outside the closed workspace and role sets refuses the whole result. How an implementation enforces this is its
 * own concern (V13: lib/adapters/identity/v13-memberships.ts).
 */
export interface MembershipReader {
  confirmedMemberships(identity: RequestIdentity): Promise<readonly ConfirmedMembership[]>;
}
