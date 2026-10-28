// Sign-in page: the synthetic personas (negative-test personas are never listed), or a notice when persona sign-in is
// disabled or misconfigured. No database access.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInWorkspace, SIGN_IN_PERSONAS, UUID_PATTERN } from "@/lib/contracts";
import { personaSignInStatus } from "@/lib/auth/session";
import { getCurrentSession } from "@/lib/auth/server-session";
import { ROLE_NAME_KEYS, translateKey, WORKSPACE_NAME_KEYS } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { signInAsPersona } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("auth.signIn.pageTitle") };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const status = personaSignInStatus();
  if (status === "enabled" && (await getCurrentSession())) redirect("/my-work");
  const { locale, t } = await getTranslator();
  const { ref } = await searchParams;
  // Only a correlation id produced by the sign-in action is shown back; anything else is ignored.
  const reference = typeof ref === "string" && UUID_PATTERN.test(ref) ? ref : null;

  return (
    <main id="main" className="v13-main" tabIndex={-1}>
      <h1>{t("auth.signIn.heading")}</h1>
      <p className="v13-lead">{t("auth.signIn.intro")}</p>
      {reference ? (
        <p className="v13-error" role="alert" data-testid="sign-in-error">
          {t("auth.signIn.failed", { reference })}
        </p>
      ) : null}
      {status === "enabled" ? (
        <ul className="v13-persona-list" aria-label={t("auth.signIn.personaList")} data-testid="persona-list">
          {SIGN_IN_PERSONAS.map((persona) => {
            const workspace = signInWorkspace(persona);
            const role = persona.memberships[0]?.role;
            return (
              <li key={persona.persona_id}>
                <form action={signInAsPersona}>
                  <input type="hidden" name="persona_id" value={persona.persona_id} />
                  <button
                    type="submit"
                    className="v13-persona-button"
                    data-testid={`persona-${persona.slug}`}
                  >
                    <span className="v13-persona-name">
                      {t("auth.signIn.signInAs", { name: translateKey(locale, persona.name_key) })}
                    </span>
                    <span className="v13-persona-meta">
                      {t("auth.signIn.personaMeta", {
                        role: role ? t(ROLE_NAME_KEYS[role]) : "",
                        workspace: t(WORKSPACE_NAME_KEYS[workspace]),
                      })}
                    </span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="v13-notice" role="status" data-testid="sign-in-unavailable">
          {t(status === "disabled" ? "auth.signIn.disabled" : "auth.signIn.misconfigured")}
        </p>
      )}
    </main>
  );
}
