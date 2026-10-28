"use server";
// Workspace switch (FE-002, Scenario C). Reads the session itself and runs the lib/authz pre-check before anything
// else (SEC-APP-18): no session → sign-in, nothing changed; a workspace the persona is not a member of → nothing
// changed, generic reference shown. On success the cookie is re-issued for the new workspace (fresh 8-hour lifetime)
// and the database re-checks the membership on every request.
import { redirect } from "next/navigation";
import { createSessionToken } from "@/lib/auth/session";
import { getCurrentSession, setSessionCookie } from "@/lib/auth/server-session";
import { logServerError } from "@/lib/http/errors";
import { planWorkspaceSwitch } from "@/lib/server/workspace";

export async function switchWorkspace(formData: FormData): Promise<void> {
  const plan = planWorkspaceSwitch(await getCurrentSession(), formData.get("workspace"));
  if (!plan.ok && plan.reason === "UNAUTHENTICATED") redirect("/sign-in");
  let failure: string | null = null;
  if (plan.ok) {
    try {
      await setSessionCookie(await createSessionToken(plan.subject));
    } catch (error) {
      failure = crypto.randomUUID();
      logServerError("workspace.switch_failed", failure, error);
    }
  } else {
    failure = crypto.randomUUID();
    logServerError("workspace.switch_refused", failure, { code: "SWITCH_REFUSED" });
  }
  redirect(failure ? `/my-work?ref=${failure}` : "/my-work");
}
