// Timeline of recorded procedural events (DESIGN_SYSTEM.md §3.4): newest first, recorded entries only. The badge of
// each entry is built here from the entry's own event, so the badge, the entry and its case can never disagree.
// Each <li> carries the recorded-event attributes and the case attributes (ADR-013). When the occurred and recorded
// times differ both are shown with words ("وقع في / سُجّل في").
import { assertCaseIdentity } from "@/components/case-identity";
import { StatusBadge, type Tone } from "@/components/data/StatusBadge";
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
  /** The status this event set. */
  status: { statusKind: string; status: string; label: string; tone?: Tone };
}

export interface TimelineProps {
  t: Translator;
  locale: Locale;
  /** Accessible name of the list. */
  label: string;
  entries: readonly TimelineEntry[];
  testId?: string;
}

export function Timeline({ t, locale, label, entries, testId = "timeline" }: TimelineProps) {
  const ordered = [...entries].sort(
    (a, b) =>
      Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
      Date.parse(b.recordedAt) - Date.parse(a.recordedAt),
  );
  return (
    <ol className="v13-timeline" aria-label={label} data-testid={testId}>
      {ordered.map((entry) => {
        assertCaseIdentity(entry.caseId, entry.caseRef);
        if (!entry.eventId) throw new Error("Timeline: every entry needs its recorded event id");
        const sameTime = entry.occurredAt === entry.recordedAt;
        return (
          <li
            key={entry.eventId}
            className="v13-timeline-entry"
            data-testid={`timeline-entry-${entry.eventId}`}
            data-epistemic="recorded"
            data-event-id={entry.eventId}
            data-status-kind={entry.status.statusKind}
            data-status={entry.status.status}
            data-case-id={entry.caseId}
            data-case-ref={entry.caseRef}
          >
            <p className="v13-timeline-title">{entry.title}</p>
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
            <p className="v13-timeline-times">
              {sameTime ? null : (
                <time dateTime={entry.occurredAt}>
                  {t("common.time.occurred", { time: formatDateTime(locale, entry.occurredAt) })}
                </time>
              )}
              <time dateTime={entry.recordedAt}>
                {t("common.time.recorded", { time: formatDateTime(locale, entry.recordedAt) })}
              </time>
            </p>
            {entry.actor ? <p className="v13-muted">{entry.actor}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
