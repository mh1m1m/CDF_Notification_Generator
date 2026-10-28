// Workspace switcher (FE-002, Scenario C; ADR-013: data-testid="workspace-switcher" + data-workspace-code). Offers
// only the persona's own memberships; the Server Action re-checks the choice and the database re-checks every request.
// Minimal markup until UX-002's WorkspaceSwitcher component lands.
import type { WorkspaceCode } from "@/lib/contracts";
import { WORKSPACE_NAME_KEYS, type Translator } from "@/lib/i18n";
import { switchWorkspace } from "../workspace-actions";

export interface WorkspaceSwitcherProps {
  t: Translator;
  active: WorkspaceCode;
  options: readonly WorkspaceCode[];
}

export function WorkspaceSwitcher({ t, active, options }: WorkspaceSwitcherProps) {
  return (
    <div data-testid="workspace-switcher" data-workspace-code={active}>
      {options.length > 1 ? (
        <form action={switchWorkspace}>
          <label htmlFor="workspace-switcher-select">{t("workspaces.switcher.label")}</label>
          <select
            id="workspace-switcher-select"
            name="workspace"
            defaultValue={active}
            data-testid="workspace-switcher-select"
          >
            {options.map((code) => (
              <option key={code} value={code} data-testid={`workspace-option-${code}`}>
                {t(WORKSPACE_NAME_KEYS[code])}
              </option>
            ))}
          </select>
          <button type="submit" className="v13-button" data-testid="workspace-switcher-submit">
            {t("workspaces.switcher.submit")}
          </button>
        </form>
      ) : null}
    </div>
  );
}
