// A date that states a recorded event (e.g. the portfolio's "last recorded event" column). It is a <time> carrying
// the recorded-event attributes, so QA's Procedural Truth Inspector checks it like a recorded badge.
import { formatDateTime } from "@/components/format";
import type { Locale } from "@/lib/i18n";

export interface RecordedEventDateProps {
  locale: Locale;
  eventId: string;
  statusKind: string;
  status: string;
  /** ISO 8601 timestamp of the event. */
  at: string;
}

export function RecordedEventDate({ locale, eventId, statusKind, status, at }: RecordedEventDateProps) {
  if (!eventId) throw new Error("RecordedEventDate: an event id is required");
  return (
    <time
      dateTime={at}
      data-testid="recorded-event-date"
      data-epistemic="recorded"
      data-event-id={eventId}
      data-status-kind={statusKind}
      data-status={status}
    >
      {formatDateTime(locale, at)}
    </time>
  );
}
