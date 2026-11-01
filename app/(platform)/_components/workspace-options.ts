// Options for the shell's WorkspaceSwitcher (UX-005, WORKSPACES.md §3): the persona's switchable workspaces, each with
// its localised name. Only switchable memberships are offered; the Server Action and the database re-check every
// switch, so this list never widens access. If the active workspace is not switchable (a negative-test persona, an
// expired membership), the switcher shows it alone, as plain text, and offers nothing.
// The role line names only roles the database confirms in this request's security context (V13-FE-008, OI-044): an
// option without a confirmed role carries an empty role, never the session's or the registry's.
import type { ConfirmedMembership, RequestIdentity, RoleCode, WorkspaceCode } from "@/lib/contracts";
import { findPersona } from "@/lib/contracts";
import { switchableWorkspaces } from "@/lib/authz";
import { ROLE_NAME_KEYS, WORKSPACE_NAME_KEYS, type Locale, type Translator } from "@/lib/i18n";
import type { WorkspaceOption } from "@/components/shell/WorkspaceSwitcher";
import { confirmedRolesIn } from "@/lib/server/memberships";

export function workspaceOptions(
  identity: RequestIdentity,
  locale: Locale,
  t: Translator,
  confirmed: readonly ConfirmedMembership[],
): WorkspaceOption[] {
  const persona = findPersona(identity.persona_id);
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const role = (roles: readonly RoleCode[]) => list.format(roles.map((r) => t(ROLE_NAME_KEYS[r])));
  const option = (code: WorkspaceCode): WorkspaceOption => ({
    code,
    name: t(WORKSPACE_NAME_KEYS[code]),
    role: role(confirmedRolesIn(confirmed, code)),
  });
  const switchable = switchableWorkspaces(identity);
  if (persona && switchable.includes(identity.active_workspace)) return switchable.map(option);
  return [option(identity.active_workspace)];
}
