// The application's MyWorkReader and TaskCommandPort: the V13 adapter bound to withRequestContext with this request's
// correlation id (the database records it on the audit event).
import "server-only";
import type { CorrelationId, MyWorkReader, TaskCommandPort } from "@/lib/contracts";
import { createV13MyWork } from "@/lib/adapters/my-work/v13-my-work";
import { withRequestContext } from "@/lib/db/security-context";

export function myWorkFor(correlationId: CorrelationId): MyWorkReader & TaskCommandPort {
  return createV13MyWork((identity, fn) => withRequestContext(identity, fn, { correlationId }));
}
