// Authenticated area. proxy.ts already redirects requests without a valid session; this layout checks again on the
// server (defence in depth) and renders the shell with the active persona and workspace, the role-aware navigation
// (FE-002) and the shell's workspace switcher menu (UX-005), whose options post to the same Server Action as
// /workspaces.
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { getCurrentSession } from "@/lib/auth/server-session";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";
import { translateKey, WORKSPACE_NAME_KEYS } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { confirmedMembershipsForRequest } from "@/lib/server/membership-records";
import { navigationFor } from "@/lib/server/navigation";
import { PlatformNav } from "./_components/PlatformNav";
import { workspaceOptions } from "./_components/workspace-options";
import { signOut } from "./actions";
import { switchWorkspace } from "./workspace-actions";

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
            current={session.identity.active_workspace}
            options={workspaceOptions(session.identity, locale, t, await confirmedMembershipsForRequest())}
            action={switchWorkspace}
            pageHref="/workspaces"
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
