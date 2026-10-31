// The application's ProceduralRecordsReader, NotificationRecordsReader and NotificationDraftPort: the V13 adapters bound to
// withRequestContext with this request's correlation id. Pages never construct adapters or touch lib/db themselves.
import "server-only";
import type {
  CorrelationId,
  NotificationCenterReader,
  NotificationDraftPort,
  NotificationRecordsReader,
  ProceduralRecordsReader,
} from "@/lib/contracts";
import { createV13NotificationCenterReader } from "@/lib/adapters/notification-records/v13-notification-center";
import { createV13NotificationDrafts } from "@/lib/adapters/notification-records/v13-notification-drafts";
import { createV13NotificationRecordsReader } from "@/lib/adapters/notification-records/v13-notification-records";
import { createV13ProceduralRecordsReader } from "@/lib/adapters/procedural-records/v13-procedural-records";
import { withRequestContext } from "@/lib/db/security-context";

export function proceduralRecordsFor(correlationId: CorrelationId): ProceduralRecordsReader {
  return createV13ProceduralRecordsReader((identity, fn) =>
    withRequestContext(identity, fn, { correlationId }),
  );
}

export function notificationRecordsFor(correlationId: CorrelationId): NotificationRecordsReader {
  return createV13NotificationRecordsReader((identity, fn) =>
    withRequestContext(identity, fn, { correlationId }),
  );
}

export function notificationCenterFor(correlationId: CorrelationId): NotificationCenterReader {
  return createV13NotificationCenterReader((identity, fn) =>
    withRequestContext(identity, fn, { correlationId }),
  );
}

export function notificationDraftsFor(correlationId: CorrelationId): NotificationDraftPort {
  return createV13NotificationDrafts((identity, fn) => withRequestContext(identity, fn, { correlationId }));
}
