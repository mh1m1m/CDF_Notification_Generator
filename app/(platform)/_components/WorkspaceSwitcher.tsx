// Workspace switcher, TopBar control (FE-002, Scenario C; WORKSPACES.md §3; ADR-013: data-testid="workspace-switcher"
// + data-workspace-code). With one membership it is plain text; with more it links to /workspaces, the list that
// works without JavaScript (UX-002's disclosure menu will add the in-place menu over the same Server Action).
import Link from "next/link";
import type { WorkspaceCode } from "@/lib/contracts";
import { WORKSPACE_NAME_KEYS, type Translator } from "@/lib/i18n";

export interface WorkspaceSwitcherProps {
  t: Translator;
  active: WorkspaceCode;
  options: readonly WorkspaceCode[];
}

export function WorkspaceSwitcher({ t, active, options }: WorkspaceSwitcherProps) {
  const label = t("workspaces.switcher.button", { name: t(WORKSPACE_NAME_KEYS[active]) });
  return (
    <div data-testid="workspace-switcher" data-workspace-code={active}>
      {options.length > 1 ? (
        <Link href="/workspaces" className="v13-button-link" data-testid="workspace-switcher-open">
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}
