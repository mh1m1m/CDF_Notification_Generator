// A due date with words: "متأخر ٣ أيام" / "يستحق اليوم" / "خلال ٥ أيام", and a warning glyph when overdue (not colour
// alone). The component never reads the clock itself. Two inputs, one rendering:
// - `due` + `now`: ISO instants, `now` from the server's ClockPort; days are calendar days in Riyadh time;
// - `date` + `days`: a calendar due date (YYYY-MM-DD) and the day count the server already worked out from its clock
//   (e.g. My Work's deadline model), so the page and the counts above it can never disagree.
import { calendarDaysBetween, formatDate, formatDays } from "@/components/format";
import type { Locale, Translator } from "@/lib/i18n";

const OVERDUE_GLYPH = "⚠";
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface DeadlineBase {
  t: Translator;
  locale: Locale;
}
export interface DeadlineFromInstants extends DeadlineBase {
  /** ISO 8601 due instant. */
  due: string;
  /** ISO 8601 "now" from the server clock. */
  now: string;
  date?: never;
  days?: never;
}
export interface DeadlineFromDays extends DeadlineBase {
  /** Calendar due date, YYYY-MM-DD (Riyadh). */
  date: string;
  /** Whole days from today to the due date (negative when overdue), from the server clock. */
  days: number;
  due?: never;
  now?: never;
}
export type DeadlineTextProps = DeadlineFromInstants | DeadlineFromDays;

export function DeadlineText(props: DeadlineTextProps) {
  const { t, locale } = props;
  let days: number;
  let dateTime: string;
  let shown: string;
  if (props.date !== undefined) {
    if (!CALENDAR_DATE.test(props.date) || !Number.isInteger(props.days))
      throw new Error("DeadlineText: date must be YYYY-MM-DD and days a whole number");
    days = props.days;
    dateTime = props.date;
    // Noon in Riyadh is the same calendar day in Riyadh whatever the server's zone.
    shown = formatDate(locale, `${props.date}T12:00:00+03:00`);
  } else {
    days = calendarDaysBetween(props.now, props.due);
    dateTime = props.due;
    shown = formatDate(locale, props.due);
  }
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
      <time dateTime={dateTime}>{shown}</time>
      <span>{words}</span>
    </span>
  );
}
