"use server";
// Workspace switch (FE-002, Scenario C; OI-023). Reads the session itself and runs the lib/authz pre-check before
// anything else (SEC-APP-18): no session → sign-in, nothing changed. Then the audited database command
// api_switch_workspace (WORKSPACE_SWITCHED) runs and commits; only then is the cookie re-issued for the new workspace,
// with the session's current expiry (a switch never extends the session; only sign-in starts one). Any refusal (the
// pre-check, the database's V1401/V1404, an unexpected answer) or failure leaves the cookie unchanged and shows one
// generic reference.
import { redirect } from "next/navigation";
import { reissueSessionToken } from "@/lib/auth/session";
import { getCurrentSession, setSessionCookie } from "@/lib/auth/server-session";
import { withRequestContext } from "@/lib/db/security-context";
import { logServerError } from "@/lib/http/errors";
import { confirmWorkspaceSwitch, planWorkspaceSwitch } from "@/lib/server/workspace";

export async function switchWorkspace(formData: FormData): Promise<void> {
  const session = await getCurrentSession();
  const plan = planWorkspaceSwitch(session, formData.get("workspace"));
  if (!plan.ok && plan.reason === "UNAUTHENTICATED") redirect("/sign-in");
  const correlationId = crypto.randomUUID();
  let failed = false;
  if (plan.ok && session) {
    try {
      // The new token is prepared first (no side effect), so an expired session fails before the command runs.
      const { token, maxAge } = await reissueSessionToken(session.claims, plan.subject.active_workspace);
      await confirmWorkspaceSwitch(
        (identity, fn) => withRequestContext(identity, fn, { correlationId }),
        session.identity,
        plan.subject.active_workspace,
      );
      await setSessionCookie(token, maxAge);
    } catch (error) {
      failed = true;
      logServerError("workspace.switch_failed", correlationId, error);
    }
  } else {
    failed = true;
    logServerError("workspace.switch_refused", correlationId, { code: "SWITCH_REFUSED" });
  }
  redirect(failed ? `/my-work?ref=${correlationId}` : "/my-work?switched=1");
}
