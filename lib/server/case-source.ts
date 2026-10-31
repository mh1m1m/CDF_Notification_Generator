// The application's CaseSourceAdapter: the V13-records adapter bound to withRequestContext with this request's
// correlation id. Pages and actions never construct adapters or touch lib/db themselves.
import "server-only";
import type { CaseSourceAdapter, CorrelationId } from "@/lib/contracts";
import { createV13RecordsCaseSource } from "@/lib/adapters/case-source/v13-records";
import { withRequestContext } from "@/lib/db/security-context";

export function caseSourceFor(correlationId: CorrelationId): CaseSourceAdapter {
  return createV13RecordsCaseSource((identity, fn) => withRequestContext(identity, fn, { correlationId }));
}
