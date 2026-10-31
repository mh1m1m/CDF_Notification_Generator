// Options for the shell's WorkspaceSwitcher (UX-005, WORKSPACES.md §3): the persona's active memberships, each with
// its localised name and the roles held there. Only switchable memberships are offered; the Server Action and the
// database re-check every switch, so this list never widens access. If the active workspace is not switchable
// (a negative-test persona, an expired membership), the switcher shows it alone, as plain text, and offers nothing.
import type { RequestIdentity, RoleCode, WorkspaceCode } from "@/lib/contracts";
import { findPersona, rolesIn } from "@/lib/contracts";
import { switchableWorkspaces } from "@/lib/authz";
import { ROLE_NAME_KEYS, WORKSPACE_NAME_KEYS, type Locale, type Translator } from "@/lib/i18n";
import type { WorkspaceOption } from "@/components/shell/WorkspaceSwitcher";

export function workspaceOptions(
  identity: RequestIdentity,
  locale: Locale,
  t: Translator,
): WorkspaceOption[] {
  const persona = findPersona(identity.persona_id);
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const option = (code: WorkspaceCode, roles: readonly RoleCode[]): WorkspaceOption => ({
    code,
    name: t(WORKSPACE_NAME_KEYS[code]),
    role: list.format(roles.map((role) => t(ROLE_NAME_KEYS[role]))),
  });
  const switchable = switchableWorkspaces(identity);
  if (persona && switchable.includes(identity.active_workspace)) {
    return switchable.map((code) => option(code, rolesIn(persona, code)));
  }
  return [option(identity.active_workspace, identity.roles)];
}
