// Namespace "case" (FE) — English (LTR). Exactly the keys of ./ar.ts (a missing or extra key fails typecheck).
import type { ar } from "./ar";

export const en: Record<keyof typeof ar, string> = {
  "stage.intake": "Intake",
  "stage.preliminaryReview": "Preliminary review",
  "stage.investigation": "Investigation",
  "stage.committeeDeliberation": "Committee deliberation",
  "stage.decision": "Decision",
  "stage.closure": "Closure",
  "records.active": "Active",
  "records.closed": "Closed",
  restricted: "Named access",
};
