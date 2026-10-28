// Guards for the case evidence attributes (ADR-013). A component that shows case content must name its case with a
// UUID key and a display number; rendering with anything else is a programming error, so it throws instead of
// writing a misleading attribute. The messages carry no case data.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASE_REF = /^CDF-[A-Z]+-\d{4}-\d{4}$/;

export function assertCaseIdentity(caseId: string, caseRef: string): void {
  if (!UUID.test(caseId)) throw new Error("case component: caseId must be a UUID");
  if (!CASE_REF.test(caseRef)) throw new Error("case component: caseRef must be a display number");
}
