// Authenticated area. proxy.ts already redirects requests without a valid session; this layout checks again on the
// server (defence in depth) and renders the shell with the active persona and workspace, the role-aware navigation
// and the workspace switcher (FE-002).
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { getCurrentSession } from "@/lib/auth/server-session";
import { translateKey, WORKSPACE_NAME_KEYS } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { switchableWorkspaces } from "@/lib/authz";
import { navigationFor } from "@/lib/server/navigation";
import { PlatformNav } from "./_components/PlatformNav";
import { WorkspaceSwitcher } from "./_components/WorkspaceSwitcher";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  const { locale, t } = await getTranslator();
  return (
    <AppShell
      t={t}
      personaName={translateKey(locale, session.persona.name_key)}
      workspaceName={t(WORKSPACE_NAME_KEYS[session.identity.active_workspace])}
      actions={
        <>
          <WorkspaceSwitcher
            t={t}
            active={session.identity.active_workspace}
            options={switchableWorkspaces(session.identity)}
          />
          <form action={signOut}>
            <button type="submit" className="v13-button" data-testid="sign-out">
              {t("shell.signOut")}
            </button>
          </form>
        </>
      }
    >
      <PlatformNav t={t} items={navigationFor(session.identity)} />
      {children}
    </AppShell>
  );
}
