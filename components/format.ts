// Number and date formatting for the interface (DESIGN_SYSTEM.md §5; INFORMATION_ARCHITECTURE.md §6): Arabic-Indic
// digits in Arabic, Western digits in English, Gregorian calendar, Riyadh time. Display numbers (CDF-DEMO-2026-NNNN)
// and correlation ids are never passed through here; they stay Latin in <bdi>.
import type { Locale, Translator } from "@/lib/i18n";

/** Times are shown in Riyadh time whatever the server's zone, so a page renders the same everywhere. */
export const DISPLAY_TIME_ZONE = "Asia/Riyadh";

const NUMBERS: Readonly<Record<Locale, Intl.NumberFormat>> = {
  ar: new Intl.NumberFormat("ar-SA-u-nu-arab"),
  en: new Intl.NumberFormat("en-GB"),
};
const DATE_LOCALES: Readonly<Record<Locale, string>> = { ar: "ar-SA-u-ca-gregory-nu-arab", en: "en-GB" };
const DAY: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
};
const DAY_TIME: Intl.DateTimeFormatOptions = { ...DAY, hour: "numeric", minute: "2-digit" };
const DATE_TIMES: Readonly<Record<Locale, Intl.DateTimeFormat>> = {
  ar: new Intl.DateTimeFormat(DATE_LOCALES.ar, DAY_TIME),
  en: new Intl.DateTimeFormat(DATE_LOCALES.en, DAY_TIME),
};
const DATES: Readonly<Record<Locale, Intl.DateTimeFormat>> = {
  ar: new Intl.DateTimeFormat(DATE_LOCALES.ar, DAY),
  en: new Intl.DateTimeFormat(DATE_LOCALES.en, DAY),
};
const PLURALS: Readonly<Record<Locale, Intl.PluralRules>> = {
  ar: new Intl.PluralRules("ar"),
  en: new Intl.PluralRules("en"),
};

export function formatNumber(locale: Locale, value: number): string {
  return NUMBERS[locale].format(value);
}

/** Parses an ISO 8601 timestamp; throws on anything else, so a bad value is never shown as "Invalid Date". */
export function parseInstant(iso: string): Date {
  const date = new Date(iso);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso) || Number.isNaN(date.getTime()))
    throw new Error("not an ISO 8601 timestamp");
  return date;
}

export function formatDateTime(locale: Locale, iso: string): string {
  return DATE_TIMES[locale].format(parseInstant(iso));
}

export function formatDate(locale: Locale, iso: string): string {
  return DATES[locale].format(parseInstant(iso));
}

/** "٣ أيام", "يومان", "5 days": the day count in words, with the language's plural forms. */
export function formatDays(locale: Locale, t: Translator, days: number): string {
  const category = PLURALS[locale].select(days) as "zero" | "one" | "two" | "few" | "many" | "other";
  return t(`common.days.${category}`, { n: formatNumber(locale, days) });
}

/** Calendar date (YYYY-MM-DD) of an instant in Riyadh time. */
export function riyadhDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TIME_ZONE }).format(parseInstant(iso));
}

/** Whole calendar days from `from` to `to` in Riyadh time (negative when `to` is earlier). */
export function calendarDaysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${riyadhDate(fromIso)}T00:00:00Z`);
  const b = Date.parse(`${riyadhDate(toIso)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
