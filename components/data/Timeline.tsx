// Timeline of recorded procedural events (DESIGN_SYSTEM.md §3.4): newest first, recorded entries only. The badge of
// each entry is built here from the entry's own event, so the badge, the entry and its case can never disagree.
// Each <li> carries data-event-id and the case attributes (ADR-013). An entry whose event set a status also carries
// the recorded status attributes and badge; an entry without a status is a record only and makes no epistemic claim
// (the event read has no status field). When the occurred and recorded times differ both are shown with words
// ("وقع في / سُجّل في").
import type { ReactNode } from "react";
import { assertCaseIdentity } from "@/components/case-identity";
import { StatusBadge, type BadgeData, type Tone } from "@/components/data/StatusBadge";
import { formatDateTime } from "@/components/format";
import type { Locale, Translator } from "@/lib/i18n";

export interface TimelineEntry {
  eventId: string;
  caseId: string;
  caseRef: string;
  /** Localised event title. */
  title: string;
  occurredAt: string;
  recordedAt: string;
  /** Localised actor capacity, e.g. "أمين سر اللجنة". */
  actor?: string;
  /** The status this event set, if it set one; without it the entry is a record only (no badge, no claim). */
  status?: { statusKind: string; status: string; label: string; tone?: Tone };
  /** Further facts about the record (e.g. actor and provenance with the page's own test ids). */
  details?: ReactNode;
  /** Test id of the entry; default timeline-entry-<eventId>. */
  testId?: string;
  /** Test ids of the entry's occurred and recorded times. */
  timeTestIds?: { occurred: string; recorded: string };
  /** Extra data-* attributes of the entry (e.g. data-event-code); they never override the entry's own. */
  data?: BadgeData;
}

export interface TimelineProps {
  t: Translator;
  locale: Locale;
  /** Accessible name of the list. */
  label: string;
  entries: readonly TimelineEntry[];
  testId?: string;
  /** Extra data-* attributes of the list (e.g. data-count). */
  data?: BadgeData;
  /** Show the occurred time even when it equals the recorded time (pages whose tests read both). */
  alwaysShowOccurred?: boolean;
}

function dataOnly(data: BadgeData | undefined): BadgeData {
  for (const name of Object.keys(data ?? {}))
    if (!/^data-[a-z0-9-]+$/.test(name)) throw new Error("Timeline: data accepts data-* attributes only");
  return data ?? {};
}

export function Timeline({
  t,
  locale,
  label,
  entries,
  testId = "timeline",
  data,
  alwaysShowOccurred = false,
}: TimelineProps) {
  const ordered = [...entries].sort(
    (a, b) =>
      Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
      Date.parse(b.recordedAt) - Date.parse(a.recordedAt),
  );
  return (
    <ol {...dataOnly(data)} className="v13-timeline" aria-label={label} data-testid={testId}>
      {ordered.map((entry) => {
        assertCaseIdentity(entry.caseId, entry.caseRef);
        if (!entry.eventId) throw new Error("Timeline: every entry needs its recorded event id");
        const hideOccurred = !alwaysShowOccurred && entry.occurredAt === entry.recordedAt;
        return (
          <li
            key={entry.eventId}
            {...dataOnly(entry.data)}
            className="v13-timeline-entry"
            data-testid={entry.testId ?? `timeline-entry-${entry.eventId}`}
            data-epistemic={entry.status ? "recorded" : undefined}
            data-event-id={entry.eventId}
            data-status-kind={entry.status?.statusKind}
            data-status={entry.status?.status}
            data-case-id={entry.caseId}
            data-case-ref={entry.caseRef}
          >
            <p className="v13-timeline-title">{entry.title}</p>
            {entry.status ? (
              <StatusBadge
                t={t}
                locale={locale}
                epistemic="recorded"
                statusKind={entry.status.statusKind}
                status={entry.status.status}
                label={entry.status.label}
                tone={entry.status.tone}
                evidence={{ eventId: entry.eventId, recordedAt: entry.recordedAt }}
              />
            ) : null}
            <p className="v13-timeline-times">
              {hideOccurred ? null : (
                <time dateTime={entry.occurredAt} data-testid={entry.timeTestIds?.occurred}>
                  {t("common.time.occurred", { time: formatDateTime(locale, entry.occurredAt) })}
                </time>
              )}
              <time dateTime={entry.recordedAt} data-testid={entry.timeTestIds?.recorded}>
                {t("common.time.recorded", { time: formatDateTime(locale, entry.recordedAt) })}
              </time>
            </p>
            {entry.actor ? <p className="v13-muted">{entry.actor}</p> : null}
            {entry.details ? <p className="v13-muted v13-timeline-details">{entry.details}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
