// The application's CaseRecordsReader: the V13 adapter bound to withRequestContext with this request's correlation id.
import "server-only";
import type { CaseRecordsReader, CorrelationId } from "@/lib/contracts";
import { createV13CaseRecordsReader } from "@/lib/adapters/case-records/v13-case-records";
import { withRequestContext } from "@/lib/db/security-context";

export function caseRecordsFor(correlationId: CorrelationId): CaseRecordsReader {
  return createV13CaseRecordsReader((identity, fn) => withRequestContext(identity, fn, { correlationId }));
}
