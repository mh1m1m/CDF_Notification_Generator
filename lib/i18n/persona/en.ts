// Namespace "persona" (ARCH) — English (LTR). Exactly the keys of ./ar.ts (a missing or extra key fails typecheck).
import type { ar } from "./ar";

export const en: Record<keyof typeof ar, string> = {
  "name.secretaryAlpha": "Secretary Alpha",
  "name.investigatorBeta": "Investigator Beta",
  "name.investigatorGamma": "Investigator Gamma",
  "name.governanceOfficerDelta": "Governance Officer Delta",
  "name.secretaryEpsilon": "Secretary Epsilon (expired)",
  "name.personaZeta": "Persona Zeta (inactive)",
  "role.committeeSecretary": "Committee Secretary",
  "role.investigator": "Investigator",
  "role.governanceOfficer": "Governance Officer",
};
