// Number formatting for the interface (DESIGN_SYSTEM.md §5): Arabic-Indic digits in Arabic, Western digits in English.
// Display numbers (CDF-DEMO-2026-NNNN) and correlation ids are never passed through here; they stay Latin in <bdi>.
import type { Locale } from "@/lib/i18n";

const FORMATTERS: Readonly<Record<Locale, Intl.NumberFormat>> = {
  ar: new Intl.NumberFormat("ar-SA-u-nu-arab"),
  en: new Intl.NumberFormat("en-GB"),
};

export function formatNumber(locale: Locale, value: number): string {
  return FORMATTERS[locale].format(value);
}
