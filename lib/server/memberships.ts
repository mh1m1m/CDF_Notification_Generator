// The roles the shell and My Work may name (V13-FE-008, OI-044): only roles of memberships the database confirms in
// this request's security context. The session's `identity.roles` and the persona registry say what a synthetic persona
// was given; for a minted persona whose membership expired (Epsilon) or who is inactive (Zeta) they no longer hold,
// and the database confirms nothing. Any read failure also confirms nothing (fail closed: no role is shown), logged by
// code and correlation id only. This never grants or widens anything: it decides only which role words appear.
import "server-only";
import {
  ROLE_CODES,
  type ConfirmedMembership,
  type MembershipReader,
  type RoleCode,
  type WorkspaceCode,
} from "@/lib/contracts";
import type { RequestContext } from "./context";
import { toUserError } from "./errors";

export interface MembershipDeps {
  readonly ctx: RequestContext;
  readonly reader: MembershipReader;
}

/** The current persona's confirmed memberships, or none when the read fails. */
export async function loadConfirmedMemberships({
  ctx,
  reader,
}: MembershipDeps): Promise<readonly ConfirmedMembership[]> {
  try {
    return await reader.confirmedMemberships(ctx.identity);
  } catch (error) {
    toUserError(error, ctx.correlationId, "memberships_load_failed");
    return [];
  }
}

/** The confirmed roles held in one workspace, in the closed set's order, without duplicates. */
export function confirmedRolesIn(
  memberships: readonly ConfirmedMembership[],
  workspace: WorkspaceCode,
): RoleCode[] {
  return [...new Set(memberships.filter((m) => m.workspace === workspace).map((m) => m.role))].sort(
    (a, b) => ROLE_CODES.indexOf(a) - ROLE_CODES.indexOf(b),
  );
}
