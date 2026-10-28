// Application pre-check (CLAUDE.md §4: authorisation is enforced twice). Pure: no I/O, no framework.
//
// precheck() answers from the verified RequestIdentity (persona, active workspace, roles there) and, for workspace
// switches, from the persona registry in lib/contracts. It can only REFUSE early: an "allow" here is never a reason to
// skip the database, which re-derives roles from its own membership rows and applies RLS and the command checks.
// Case-level rules that need data (assignment, workspace visibility, restricted, closed) belong to the database.
//
// A refused case-targeted action must look exactly like an unknown case to the user (NOT_FOUND); callers map
// `deny` to the same answer as a missing row (lib/server/errors.ts).
//
// PRODUCTION_SUBSTITUTION_REQUIRED: roles come from the synthetic persona registry; production takes them from the
// CDF authorisation registry behind the corporate identity provider.
import {
  CaseIdSchema,
  findPersona,
  WorkspaceCodeSchema,
  workspacesOf,
  type CaseId,
  type RequestIdentity,
  type RoleCode,
  type WorkspaceCode,
} from "@/lib/contracts";
import { AUTHZ_ACTIONS, type AuthzAction } from "./actions";

export { AUTHZ_ACTIONS, type AuthzAction } from "./actions";

const ALL_ROLES: readonly RoleCode[] = ["COMMITTEE_SECRETARY", "INVESTIGATOR", "GOVERNANCE_OFFICER"];

/**
 * Role × action table for M1. A role absent from an action's list is refused before any database call.
 * - notifications.center.read: SEC ruling D6 — investigators use the case Notifications tab only.
 * - notification.draft.create: DATA_MODEL §6 (api_create_notification_draft: COMMITTEE_SECRETARY or INVESTIGATOR).
 * - task.status.update: every role may try; the command allows only the assignee or a persona assigned to the case.
 */
export const ROLE_MATRIX: Readonly<Record<AuthzAction, readonly RoleCode[]>> = Object.freeze({
  "portfolio.read": ALL_ROLES,
  "case.read": ALL_ROLES,
  "tasks.mine.read": ALL_ROLES,
  "task.status.update": ALL_ROLES,
  "notifications.center.read": ["COMMITTEE_SECRETARY", "GOVERNANCE_OFFICER"],
  "notification.draft.create": ["COMMITTEE_SECRETARY", "INVESTIGATOR"],
  "workspace.switch": ALL_ROLES,
});

export type DenyReason = "ROLE" | "TARGET_INVALID" | "NOT_A_MEMBER" | "ACTION_UNKNOWN";
export type Decision = { readonly allow: true } | { readonly allow: false; readonly reason: DenyReason };

const ALLOW: Decision = Object.freeze({ allow: true });
const deny = (reason: DenyReason): Decision => Object.freeze({ allow: false, reason });

/** Optional target of an action. Untrusted values: they are validated here, never assumed. */
export interface PrecheckTarget {
  /** Case id from the route (case-targeted actions). */
  readonly caseId?: unknown;
  /** Workspace code asked for (workspace.switch). */
  readonly workspace?: unknown;
}

const CASE_TARGETED: ReadonlySet<AuthzAction> = new Set<AuthzAction>([
  "case.read",
  "notification.draft.create",
]);

/** Pre-checks one action. Fails closed on anything unexpected (unknown action, malformed identity or target). */
export function precheck(
  identity: RequestIdentity,
  action: AuthzAction,
  target: PrecheckTarget = {},
): Decision {
  if (!(AUTHZ_ACTIONS as readonly string[]).includes(action)) return deny("ACTION_UNKNOWN");
  const allowed = ROLE_MATRIX[action];
  const roles = Array.isArray(identity?.roles) ? identity.roles : [];
  if (!roles.some((role) => allowed.includes(role))) return deny("ROLE");

  if (CASE_TARGETED.has(action) && !CaseIdSchema.safeParse(target.caseId).success) {
    return deny("TARGET_INVALID");
  }

  if (action === "workspace.switch") {
    const wanted = WorkspaceCodeSchema.safeParse(target.workspace);
    if (!wanted.success) return deny("TARGET_INVALID");
    const persona = findPersona(identity.persona_id);
    if (!persona || persona.negative_test || !workspacesOf(persona).includes(wanted.data)) {
      return deny("NOT_A_MEMBER");
    }
  }
  return ALLOW;
}

/** The case id when it is a well-formed UUID, otherwise null (callers answer NOT_FOUND). */
export function parseCaseId(raw: unknown): CaseId | null {
  const parsed = CaseIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Whether the active workspace's roles may see the action at all (navigation: hide what would be refused). */
export function canSee(identity: RequestIdentity, action: AuthzAction): boolean {
  return precheck(identity, action, CASE_TARGETED.has(action) ? { caseId: SAMPLE_CASE_ID } : {}).allow;
}

/** Workspace codes the persona may switch to (its memberships), for the switcher. */
export function switchableWorkspaces(identity: RequestIdentity): readonly WorkspaceCode[] {
  const persona = findPersona(identity.persona_id);
  return persona && !persona.negative_test ? workspacesOf(persona) : [];
}

// A syntactically valid id used only to ask role questions for navigation; never sent anywhere.
const SAMPLE_CASE_ID = "00000000-0000-4000-8000-000000000000";
