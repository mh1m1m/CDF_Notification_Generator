// Authenticated area. proxy.ts already redirects requests without a valid session; this layout checks again on the
// server (defence in depth) and renders the platform frame (DESIGN_SYSTEM §2, UX-008): TopBar with the workspace
// switcher menu (UX-005, posting to the same Server Action as /workspaces) and the persona menu (sign-out), then the
// role-aware SideNav (FE-002) beside the page. The language switch stays in the root layout's banner.
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { PersonaMenu } from "@/components/shell/PersonaMenu";
import { TopBar } from "@/components/shell/TopBar";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";
import { getCurrentSession } from "@/lib/auth/server-session";
import { translateKey } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
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
  const active = session.identity.active_workspace;
  const options = workspaceOptions(session.identity, locale, t);
  const roleLabel = options.find((o) => o.code === active)?.role ?? "";
  return (
    <AppShell
      t={t}
      topBar={
        <TopBar
          t={t}
          workspace={
            <WorkspaceSwitcher
              t={t}
              current={active}
              options={options}
              action={switchWorkspace}
              pageHref="/workspaces"
            />
          }
          persona={
            <PersonaMenu
              t={t}
              name={translateKey(locale, session.persona.name_key)}
              roleLabel={roleLabel}
              signOutAction={signOut}
              nameTestId="shell-persona"
            />
          }
        />
      }
      sideNav={<PlatformNav t={t} locale={locale} items={navigationFor(session.identity)} />}
    >
      {children}
    </AppShell>
  );
}
