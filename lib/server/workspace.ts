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

export class WorkspaceSwitchRefusedError extends Error {
  override readonly name = "WorkspaceSwitchRefusedError";
  readonly code = "WORKSPACE_SWITCH_REFUSED";
  constructor(readonly refusal: "NO_CONTEXT" | "NOT_FOUND") {
    super("WORKSPACE_SWITCH_REFUSED");
  }
}

/** The command's refusal codes (migration 0005), returned in its `refusal` column since migration 0013 (V13-DB-021). */
const REFUSALS: Readonly<Record<string, WorkspaceSwitchRefusedError["refusal"]>> = {
  V1401: "NO_CONTEXT",
  V1404: "NOT_FOUND",
};

/**
 * Runs api_switch_workspace for `target` in the current identity's request context and returns once it has
 * committed. The database refuses (V1401 no verified persona, V1404 any unusable target) in its `refusal` column; that
 * column is read first, after the transaction has committed (so its COMMAND_REFUSED audit row persists), and throws
 * WorkspaceSwitchRefusedError. Any other refusal value throws a plain Error. The answer must name exactly the
 * workspace asked for, or the switch is refused (fail closed).
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
      tx<{ workspace_id: string | null; workspace_code: string | null; refusal: string | null }[]>`
      select s.workspace_id, s.workspace_code, s.refusal
        from cdf_notifications_v13.api_switch_workspace(${targetId}::uuid) s`,
  );
  if (rows.length !== 1) throw new WorkspaceSwitchMismatchError("WORKSPACE_SWITCH_MISMATCH");
  const row = rows[0] as { workspace_id: unknown; workspace_code: unknown; refusal: unknown };
  if (row.refusal !== null) {
    const refusal =
      typeof row.refusal === "string" && Object.hasOwn(REFUSALS, row.refusal)
        ? REFUSALS[row.refusal]
        : undefined;
    if (!refusal) throw new Error("api_switch_workspace: unknown refusal");
    throw new WorkspaceSwitchRefusedError(refusal);
  }
  if (row.workspace_id !== targetId || row.workspace_code !== target) {
    throw new WorkspaceSwitchMismatchError("WORKSPACE_SWITCH_MISMATCH");
  }
}
