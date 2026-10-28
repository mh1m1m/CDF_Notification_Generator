"use server";
// Persona sign-in (prototype). The persona id is untrusted form input; issuePersonaSession accepts only the personas
// offered on the sign-in page and only while V13_PERSONA_SIGNIN=enabled. Failures are logged with a correlation id and
// an error code only, and the user sees a generic message with the same correlation id.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production signs in through the CDF corporate identity provider (OIDC).
import { redirect } from "next/navigation";
import { issuePersonaSession } from "@/lib/auth/session";
import { setSessionCookie } from "@/lib/auth/server-session";
import { logServerError } from "@/lib/http/errors";

export async function signInAsPersona(formData: FormData): Promise<void> {
  let failure: string | null = null;
  try {
    const { token } = await issuePersonaSession(formData.get("persona_id"));
    await setSessionCookie(token);
  } catch (error) {
    failure = crypto.randomUUID();
    logServerError("auth.persona_sign_in_failed", failure, error);
  }
  redirect(failure ? `/sign-in?ref=${failure}` : "/my-work");
}
