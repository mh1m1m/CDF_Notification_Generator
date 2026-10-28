// Namespace "workspaces" (FE) — English (LTR). Exactly the keys of ./ar.ts (a missing or extra key fails typecheck).
import type { ar } from "./ar";

export const en: Record<keyof typeof ar, string> = {
  "name.secretariat": "Committee Secretariat",
  "name.investigations": "Investigations",
  "name.governance": "Governance",
  "nav.label": "Main areas",
  "switcher.button": "Workspace: {name}",
  "page.title": "Workspaces",
  "page.heading": "Workspaces",
  "page.list": "Workspaces available to you",
  "page.roleHeld": "as {role}",
  "page.current": "Current",
  "page.goTo": "Go to this workspace",
  "page.tabsNote": "Pages open in other tabs will follow the new workspace's permissions.",
  switched: "You are now in the {name} workspace",
};
