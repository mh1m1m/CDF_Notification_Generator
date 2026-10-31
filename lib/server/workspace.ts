// Workspace switch (FE-002, Scenario C). The decision is pure and testable; the Server Action only applies it.
// Order (SEC-APP-18, TM-E4): the action reads the session itself, then this pre-check, then re-issues the cookie; the
// database re-checks the membership on every later request (ADR-014 §2), so a switch can never widen access.
import "server-only";
import { precheck } from "@/lib/authz";
import type { WorkspaceCode } from "@/lib/contracts";
import type { Session } from "@/lib/auth/session";

export type SwitchPlan =
  | { readonly ok: true; readonly subject: { persona_id: string; active_workspace: WorkspaceCode } }
  | { readonly ok: false; readonly reason: "UNAUTHENTICATED" | "REFUSED" };

/** Decides a switch for `session` to the untrusted form value `rawWorkspace`. */
export function planWorkspaceSwitch(session: Session | null, rawWorkspace: unknown): SwitchPlan {
  if (!session) return { ok: false, reason: "UNAUTHENTICATED" };
  const decision = precheck(session.identity, "workspace.switch", { workspace: rawWorkspace });
  if (!decision.allow) return { ok: false, reason: "REFUSED" };
  return {
    ok: true,
    subject: { persona_id: session.persona.persona_id, active_workspace: rawWorkspace as WorkspaceCode },
  };
}
