// The one way to show a number (ADR-013): `data-testid="count-<name>"` and `data-count` carry the real value, so QA's
// Sentinel can compare it with what the database authorised. The visible text may be shortened (e.g. "9+"); the
// attribute never is.
import type { ReactNode } from "react";
import { formatNumber } from "@/components/format";
import type { Locale } from "@/lib/i18n";

export interface CountProps {
  /** Becomes the test id `count-<name>`, e.g. "nav-my-work" → `count-nav-my-work`. Lower-case, digits and hyphens. */
  name: string;
  /** The real, already authorised number. */
  value: number;
  /** Formats the default text when no children are given. */
  locale: Locale;
  className?: string;
  /** Visible content; defaults to the value formatted for the locale. */
  children?: ReactNode;
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function Count({ name, value, locale, className, children }: CountProps) {
  if (!NAME.test(name)) throw new Error("Count: name must be lower-case words joined by hyphens");
  if (!Number.isInteger(value) || value < 0) throw new Error("Count: value must be a non-negative integer");
  return (
    <span data-testid={`count-${name}`} data-count={value} className={className}>
      {children ?? formatNumber(locale, value)}
    </span>
  );
}
