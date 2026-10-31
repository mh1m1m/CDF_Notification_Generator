// V13-SEC-003 · SEC-APP-18 · threat TM-E5. The Server Actions that must work without a session, with the reason.
// Shared by the static check (tests/security/app/static-boundaries.spec.ts) and the browser-level probes
// (tests/security/e2e/server-actions.spec.ts). Adding an entry is a security decision and needs SEC review.
export const PUBLIC_ACTIONS: Readonly<Record<string, string>> = {
  "app/(auth)/sign-in/actions.ts#signInAsPersona":
    "creates the session; guarded by V13_PERSONA_SIGNIN and the registry",
  "app/(platform)/actions.ts#signOut": "only expires the caller's own cookie",
  "app/locale-action.ts#switchLocale": "only sets the caller's locale cookie (allow-listed values)",
};
