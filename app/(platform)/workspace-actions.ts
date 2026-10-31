"use server";
// Workspace switch (FE-002, Scenario C). Reads the session itself and runs the lib/authz pre-check before anything
// else (SEC-APP-18): no session → sign-in, nothing changed; a workspace the persona is not a member of → nothing
// changed, generic reference shown. On success the cookie is re-issued for the new workspace with the session's
// current expiry (a switch never extends the session; only sign-in starts one) and the database re-checks the
// membership on every request. OI-023: the audited database command (api_switch_workspace, DB #17) is called here
// once it is on develop.
import { redirect } from "next/navigation";
import { reissueSessionToken } from "@/lib/auth/session";
import { getCurrentSession, setSessionCookie } from "@/lib/auth/server-session";
import { logServerError } from "@/lib/http/errors";
import { planWorkspaceSwitch } from "@/lib/server/workspace";

export async function switchWorkspace(formData: FormData): Promise<void> {
  const session = await getCurrentSession();
  const plan = planWorkspaceSwitch(session, formData.get("workspace"));
  if (!plan.ok && plan.reason === "UNAUTHENTICATED") redirect("/sign-in");
  let failure: string | null = null;
  if (plan.ok && session) {
    try {
      const { token, maxAge } = await reissueSessionToken(session.claims, plan.subject.active_workspace);
      await setSessionCookie(token, maxAge);
    } catch (error) {
      failure = crypto.randomUUID();
      logServerError("workspace.switch_failed", failure, error);
    }
  } else {
    failure = crypto.randomUUID();
    logServerError("workspace.switch_refused", failure, { code: "SWITCH_REFUSED" });
  }
  redirect(failure ? `/my-work?ref=${failure}` : "/my-work?switched=1");
}
