// Platform shell (UX skeleton): session bar with the active persona and workspace, then the page's <main>.
// Server component. All text arrives through the translator; the root layout already renders the synthetic-data
// banner and the skip link, which targets the <main id="main"> rendered here.
import type { ReactNode } from "react";
import type { Translator } from "@/lib/i18n";

export interface AppShellProps {
  t: Translator;
  /** Localised display name of the signed-in persona. */
  personaName: string;
  /** Localised name of the active workspace. */
  workspaceName: string;
  /** Session actions (for example the sign-out form), rendered at the end of the session bar. */
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({ t, personaName, workspaceName, actions, children }: AppShellProps) {
  return (
    <>
      <section className="v13-session-bar" aria-label={t("shell.sessionLabel")} data-testid="app-shell">
        <p className="v13-app-name">{t("common.app.shortName")}</p>
        <dl className="v13-facts">
          <div>
            <dt>{t("shell.signedInAs")}</dt>
            <dd data-testid="shell-persona">{personaName}</dd>
          </div>
          <div>
            <dt>{t("shell.activeWorkspace")}</dt>
            <dd data-testid="shell-workspace">{workspaceName}</dd>
          </div>
        </dl>
        {actions}
      </section>
      <main id="main" className="v13-main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
