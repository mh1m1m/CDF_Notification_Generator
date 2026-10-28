// Namespace "auth" (FE) — English (LTR). Exactly the keys of ./ar.ts (a missing or extra key fails typecheck).
import type { ar } from "./ar";

export const en: Record<keyof typeof ar, string> = {
  "signIn.pageTitle": "Sign in",
  "signIn.heading": "Sign in with a synthetic persona",
  "signIn.intro":
    "Choose one of the synthetic personas below. There are no real accounts in this reference implementation.",
  "signIn.personaList": "Available synthetic personas",
  "signIn.signInAs": "Sign in as {name}",
  "signIn.personaMeta": "{role} — {workspace}",
  "signIn.disabled": "Persona sign-in is disabled in this environment.",
  "signIn.misconfigured": "Sign-in is unavailable because the session configuration is incomplete.",
  "signIn.failed": "Sign-in failed. Reference: {reference}",
};
