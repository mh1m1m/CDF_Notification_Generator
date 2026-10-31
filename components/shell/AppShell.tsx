// Platform frame (DESIGN_SYSTEM.md §2): TopBar, then SideNav beside the content column (breadcrumbs, then the
// skip-link target <main id="main">). Landmarks: header (TopBar), nav (SideNav, Breadcrumbs), main. Under 768 px the
// SideNav becomes a horizontal row under the TopBar. The root layout renders the skip link and the synthetic-data
// banner on every page, before this frame.
//
// Two forms while V13-FE-002 moves the platform layout to the TopBar:
// - frame form: `topBar` (with optional `sideNav`, `breadcrumbs`);
// - session-bar form (the foundation's skeleton, still used by app/(platform)/layout.tsx): `personaName`,
//   `workspaceName`, optional `actions`. It goes once FE-002 lands.
import type { ReactNode } from "react";
import type { Translator } from "@/lib/i18n";

interface FrameSlots {
  t: Translator;
  /** SideNav. */
  sideNav?: ReactNode;
  /** Breadcrumbs, shown above <main>. */
  breadcrumbs?: ReactNode;
  children: ReactNode;
}

export interface AppShellFrameProps extends FrameSlots {
  /** TopBar. */
  topBar: ReactNode;
  personaName?: never;
  workspaceName?: never;
  actions?: never;
}

export interface AppShellSessionBarProps extends FrameSlots {
  topBar?: never;
  /** Localised display name of the signed-in persona. */
  personaName: string;
  /** Localised name of the active workspace. */
  workspaceName: string;
  /** Session actions (for example the sign-out form), rendered at the end of the session bar. */
  actions?: ReactNode;
}

export type AppShellProps = AppShellFrameProps | AppShellSessionBarProps;

export function AppShell(props: AppShellProps) {
  const { t, sideNav, breadcrumbs, children } = props;
  const top =
    props.topBar !== undefined ? (
      props.topBar
    ) : (
      <section className="v13-session-bar" aria-label={t("shell.sessionLabel")}>
        <p className="v13-app-name">{t("common.app.shortName")}</p>
        <dl className="v13-facts">
          <div>
            <dt>{t("shell.signedInAs")}</dt>
            <dd data-testid="shell-persona">{props.personaName}</dd>
          </div>
          <div>
            <dt>{t("shell.activeWorkspace")}</dt>
            <dd data-testid="shell-workspace">{props.workspaceName}</dd>
          </div>
        </dl>
        {props.actions}
      </section>
    );

  return (
    <div className="v13-app-shell" data-testid="app-shell">
      {top}
      <div className={sideNav ? "v13-app-body v13-app-body-with-nav" : "v13-app-body"}>
        {sideNav}
        <div className="v13-app-content">
          {breadcrumbs}
          <main id="main" className="v13-main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
