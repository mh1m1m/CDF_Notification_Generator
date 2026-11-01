// The application's NotificationPreviewReader (V13-FE-006 part 3): the V13 adapter bound to withRequestContext with
// this request's correlation id. Kept beside records.ts; pages never construct adapters or touch lib/db themselves.
import "server-only";
import type { CorrelationId, NotificationPreviewReader } from "@/lib/contracts";
import { createV13NotificationPreviewReader } from "@/lib/adapters/notification-records/v13-notification-preview";
import { withRequestContext } from "@/lib/db/security-context";

export function notificationPreviewFor(correlationId: CorrelationId): NotificationPreviewReader {
  return createV13NotificationPreviewReader((identity, fn) =>
    withRequestContext(identity, fn, { correlationId }),
  );
}
