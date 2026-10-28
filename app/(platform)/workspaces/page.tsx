// Workspaces page (FE-002, SCREENS S5, WORKSPACES.md §3 and §5): the persona's active memberships with the role held,
// the current one marked by glyph + word + aria-current (not colour alone), every other one a POST to switchWorkspace.
// Works without JavaScript. The list is the persona registry; the Server Action and the database re-check it.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { rolesIn } from "@/lib/contracts";
import { getCurrentSession } from "@/lib/auth/server-session";
import { switchableWorkspaces } from "@/lib/authz";
import { ROLE_NAME_KEYS, WORKSPACE_NAME_KEYS } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { switchWorkspace } from "../workspace-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("workspaces.page.title") };
}

export default async function WorkspacesPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  const { locale, t } = await getTranslator();
  const active = session.identity.active_workspace;
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  return (
    <section data-testid="workspaces-page">
      <h1>{t("workspaces.page.heading")}</h1>
      <ul aria-label={t("workspaces.page.list")} className="v13-card-list">
        {switchableWorkspaces(session.identity).map((code) => {
          const roles = list.format(rolesIn(session.persona, code).map((role) => t(ROLE_NAME_KEYS[role])));
          const current = code === active;
          return (
            <li
              key={code}
              className="v13-card"
              data-testid={`workspace-option-${code}`}
              data-workspace-code={code}
              aria-current={current ? "true" : undefined}
            >
              <h2>{t(WORKSPACE_NAME_KEYS[code])}</h2>
              <p>{t("workspaces.page.roleHeld", { role: roles })}</p>
              {current ? (
                <p data-testid="workspace-current">
                  <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>{" "}
                  {t("workspaces.page.current")}
                </p>
              ) : (
                <form action={switchWorkspace}>
                  <input type="hidden" name="workspace" value={code} />
                  <button type="submit" className="v13-button" data-testid={`workspace-go-${code}`}>
                    {t("workspaces.page.goTo")}
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <p className="v13-notice">{t("workspaces.page.tabsNote")}</p>
    </section>
  );
}
