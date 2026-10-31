// Guards for the case evidence attributes (ADR-013). A component that shows case content must name its case with a
// UUID key and a display number; rendering with anything else is a programming error, so it throws instead of
// writing a misleading attribute. The messages carry no case data. The patterns are the contract's own, so the
// shell accepts exactly what the Truth Inspector and the domain accept.
import { CASE_NUMBER_PATTERN, UUID_PATTERN } from "@/lib/contracts";

export function assertCaseIdentity(caseId: string, caseRef: string): void {
  if (!UUID_PATTERN.test(caseId)) throw new Error("case component: caseId must be a UUID");
  if (!CASE_NUMBER_PATTERN.test(caseRef)) throw new Error("case component: caseRef must be a display number");
}
