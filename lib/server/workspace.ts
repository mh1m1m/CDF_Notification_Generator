// Workspace switch (FE-002, Scenario C; OI-023). The decision is pure and testable; the Server Action applies it.
// Order (SEC-APP-18, TM-E4): the action reads the session itself, then this pre-check, then the audited database
// command api_switch_workspace (DB #17, migration 0005: WORKSPACE_SWITCHED, ids only), and only after that command has
// committed does it re-issue the cookie. The database re-checks the membership on every later request (ADR-014 §2),
// so a switch can never widen access.
import "server-only";
import { precheck } from "@/lib/authz";
import {
  WorkspaceCodeSchema,
  WORKSPACE_IDS,
  type RequestIdentity,
  type WorkspaceCode,
} from "@/lib/contracts";
import type { Session } from "@/lib/auth/session";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";

export type SwitchPlan =
  | { readonly ok: true; readonly subject: { persona_id: string; active_workspace: WorkspaceCode } }
  | { readonly ok: false; readonly reason: "UNAUTHENTICATED" | "REFUSED" };

/** Decides a switch for `session` to the untrusted form value `rawWorkspace`. */
export function planWorkspaceSwitch(session: Session | null, rawWorkspace: unknown): SwitchPlan {
  if (!session) return { ok: false, reason: "UNAUTHENTICATED" };
  const decision = precheck(session.identity, "workspace.switch", { workspace: rawWorkspace });
  if (!decision.allow) return { ok: false, reason: "REFUSED" };
  // The pre-check has validated the code; parse it again so the plan carries a typed value, not a cast.
  const target = WorkspaceCodeSchema.safeParse(rawWorkspace);
  if (!target.success) return { ok: false, reason: "REFUSED" };
  return { ok: true, subject: { persona_id: session.persona.persona_id, active_workspace: target.data } };
}

export class WorkspaceSwitchMismatchError extends Error {
  override readonly name = "WorkspaceSwitchMismatchError";
  readonly code = "WORKSPACE_SWITCH_MISMATCH";
}

/**
 * Runs api_switch_workspace for `target` in the current identity's request context and returns once it has
 * committed. The database refuses (V1401 no verified persona, V1404 any unusable target) by throwing; the answer must
 * name exactly the workspace asked for, or the switch is refused (fail closed).
 */
export async function confirmWorkspaceSwitch(
  run: RequestContextRunner,
  identity: RequestIdentity,
  target: WorkspaceCode,
): Promise<void> {
  const targetId = WORKSPACE_IDS[target];
  const rows = await run(
    identity,
    (tx) =>
      tx<{ workspace_id: string; workspace_code: string }[]>`
      select s.workspace_id, s.workspace_code
        from cdf_notifications_v13.api_switch_workspace(${targetId}::uuid) s`,
  );
  if (rows.length !== 1 || rows[0]?.workspace_id !== targetId || rows[0]?.workspace_code !== target) {
    throw new WorkspaceSwitchMismatchError("WORKSPACE_SWITCH_MISMATCH");
  }
}
