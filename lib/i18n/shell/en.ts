// Namespace "shell" (UX) — English (LTR). Exactly the keys of ./ar.ts (a missing or extra key fails typecheck).
import type { ar } from "./ar";

export const en: Record<keyof typeof ar, string> = {
  sessionLabel: "Current session",
  signedInAs: "Signed in as",
  activeWorkspace: "Active workspace",
  signOut: "Sign out",
};
