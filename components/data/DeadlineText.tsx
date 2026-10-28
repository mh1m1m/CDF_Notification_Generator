// A due date with words: "متأخر ٣ أيام" / "يستحق اليوم" / "خلال ٥ أيام", and a warning glyph when overdue (not colour
// alone). `now` comes from the server's ClockPort; the component never reads the clock itself. Days are calendar days
// in Riyadh time.
import { calendarDaysBetween, formatDate, formatDays } from "@/components/format";
import type { Locale, Translator } from "@/lib/i18n";

const OVERDUE_GLYPH = "⚠";

export interface DeadlineTextProps {
  t: Translator;
  locale: Locale;
  /** ISO 8601 due instant. */
  due: string;
  /** ISO 8601 "now" from the server clock. */
  now: string;
}

export function DeadlineText({ t, locale, due, now }: DeadlineTextProps) {
  const days = calendarDaysBetween(now, due);
  const state = days < 0 ? "overdue" : days === 0 ? "today" : "upcoming";
  const words =
    state === "overdue"
      ? t("common.deadline.overdue", { days: formatDays(locale, t, -days) })
      : state === "today"
        ? t("common.deadline.today")
        : t("common.deadline.inDays", { days: formatDays(locale, t, days) });
  return (
    <span className={`v13-deadline v13-deadline-${state}`} data-testid="deadline" data-deadline-state={state}>
      {state === "overdue" ? (
        <span aria-hidden="true" className="v13-badge-glyph">
          {OVERDUE_GLYPH}
        </span>
      ) : null}
      <time dateTime={due}>{formatDate(locale, due)}</time>
      <span>{words}</span>
    </span>
  );
}
