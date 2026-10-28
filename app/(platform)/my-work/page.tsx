// My work (placeholder): the signed-in persona, its roles in the active workspace and the workspace. Case lists arrive
// with the CaseSourceAdapter slices. No database access yet.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/server-session";
import { ROLE_NAME_KEYS, translateKey, WORKSPACE_NAME_KEYS } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("myWork.pageTitle") };
}

export default async function MyWorkPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  const { locale, t } = await getTranslator();
  const roles = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    session.identity.roles.map((role) => t(ROLE_NAME_KEYS[role])),
  );
  return (
    <>
      <h1>{t("myWork.heading")}</h1>
      <dl className="v13-facts v13-facts-block" data-testid="my-work-identity">
        <div>
          <dt>{t("myWork.persona")}</dt>
          <dd data-testid="my-work-persona">{translateKey(locale, session.persona.name_key)}</dd>
        </div>
        <div>
          <dt>{t("myWork.roles")}</dt>
          <dd data-testid="my-work-roles">{roles}</dd>
        </div>
        <div>
          <dt>{t("myWork.workspace")}</dt>
          <dd data-testid="my-work-workspace">{t(WORKSPACE_NAME_KEYS[session.identity.active_workspace])}</dd>
        </div>
      </dl>
      <p className="v13-notice">{t("myWork.placeholder")}</p>
    </>
  );
}
