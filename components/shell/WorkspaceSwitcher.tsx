// WorkspaceSwitcher (WORKSPACES.md §3). Lists only workspaces with an active membership, each with the role held
// there. One membership: plain text, no menu. Several: a disclosure whose options are form submits (Server Action),
// never a client-side state change; the server re-checks the membership on the switch (switching never widens
// access). The active option shows a check glyph, the word "الحالية" and aria-current="true". The control and every
// option carry data-workspace-code (ADR-013). A link to the full /workspaces page is always in the panel.
// Menu test ids are prefixed `workspace-menu-` so they never collide with the /workspaces page's own ids (QA #14).
// The option's accessible name is its content: a visually hidden verb, then the visible name and role (WCAG 2.5.3).
import { CheckIcon, ChevronDownIcon } from "@/components/icons";
import type { WorkspaceCode } from "@/lib/contracts";
import type { Translator } from "@/lib/i18n";
import { Disclosure } from "./Disclosure";

export interface WorkspaceOption {
  code: WorkspaceCode;
  /** Localised workspace name. */
  name: string;
  /** Localised name of the role held there. Absent or empty when no active membership is confirmed (FE-008, OI-044):
   * then no role line is shown, never an empty "as …". */
  role?: string;
}

export interface WorkspaceSwitcherProps {
  t: Translator;
  /** The active workspace; must be one of the options. */
  current: WorkspaceCode;
  /** The persona's active memberships, in display order. */
  options: readonly WorkspaceOption[];
  /** Server Action receiving the form field `workspace` = the chosen code. */
  action: (formData: FormData) => Promise<void>;
  /** Full-page switcher (works without JavaScript). */
  pageHref: string;
}

export function WorkspaceSwitcher({ t, current, options, action, pageHref }: WorkspaceSwitcherProps) {
  const active = options.find((o) => o.code === current);
  if (!active) throw new Error("WorkspaceSwitcher: the active workspace is not among the memberships");

  if (options.length === 1) {
    return (
      <p className="v13-workspace-single" data-testid="workspace-switcher" data-workspace-code={active.code}>
        <span className="v13-sr-only">{t("shell.workspace.label")}</span>
        <span>{active.name}</span>
        {active.role ? (
          <span className="v13-muted">{t("shell.workspace.roleHeld", { role: active.role })}</span>
        ) : null}
      </p>
    );
  }

  return (
    <Disclosure
      className="v13-workspace-switcher"
      panelLabel={t("shell.workspace.menuLabel")}
      summaryProps={{ "data-testid": "workspace-switcher", "data-workspace-code": active.code }}
      summary={
        <>
          <span>{t("shell.workspace.button", { name: active.name })}</span>
          <ChevronDownIcon />
        </>
      }
    >
      <ul className="v13-menu">
        {options.map((option) =>
          option.code === current ? (
            <li
              key={option.code}
              className="v13-menu-item v13-menu-item-current"
              aria-current="true"
              data-testid="workspace-menu-current"
              data-workspace-code={option.code}
            >
              <CheckIcon />
              <span className="v13-menu-text">
                <span>{option.name}</span>
                {option.role ? (
                  <span className="v13-muted">{t("shell.workspace.roleHeld", { role: option.role })}</span>
                ) : null}
              </span>
              <span className="v13-menu-tag">{t("shell.workspace.current")}</span>
            </li>
          ) : (
            <li key={option.code} className="v13-menu-item">
              <form action={action}>
                <input type="hidden" name="workspace" value={option.code} />
                <button
                  type="submit"
                  className="v13-menu-button"
                  data-testid={`workspace-menu-option-${option.code}`}
                  data-workspace-code={option.code}
                >
                  <span className="v13-sr-only">{t("shell.workspace.switchTo", { name: option.name })}</span>
                  <span className="v13-menu-text">
                    <span>{option.name}</span>
                    {option.role ? (
                      <span className="v13-muted">
                        {t("shell.workspace.roleHeld", { role: option.role })}
                      </span>
                    ) : null}
                  </span>
                </button>
              </form>
            </li>
          ),
        )}
      </ul>
      <a href={pageHref} className="v13-menu-link" data-testid="workspace-menu-all">
        {t("shell.workspace.allWorkspaces")}
      </a>
    </Disclosure>
  );
}
