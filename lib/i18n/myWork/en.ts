// Namespace "myWork" (FE) — English (LTR). Exactly the keys of ./ar.ts (a missing or extra key fails typecheck).
import type { ar } from "./ar";

export const en: Record<keyof typeof ar, string> = {
  pageTitle: "My work",
  heading: "My work",
  persona: "Persona",
  roles: "Roles",
  workspace: "Active workspace",
  placeholder:
    "Case workspaces, procedural journeys and the notification operations centre arrive in later slices.",
  navLabel: "My work",
  actionFailed: "The request could not be completed. Reference: {reference}",
};
