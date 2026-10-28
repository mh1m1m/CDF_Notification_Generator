// Namespace "workspaces" (FE) — English (LTR). Exactly the keys of ./ar.ts (a missing or extra key fails typecheck).
import type { ar } from "./ar";

export const en: Record<keyof typeof ar, string> = {
  "name.secretariat": "Committee Secretariat",
  "name.investigations": "Investigations",
  "name.governance": "Governance",
  "nav.label": "Platform navigation",
  "switcher.label": "Workspace",
  "switcher.submit": "Switch workspace",
};
