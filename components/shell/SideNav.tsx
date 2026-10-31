// SideNav: the role's main areas (at most five, INFORMATION_ARCHITECTURE.md §4.2). The list is a convenience, never an
// authorisation: pages re-check. The current area has aria-current="page", a 4 px inline-start bar and a tint (not
// colour alone). A count is the persona's own items needing action, never a number of cases; it shows "9+" above nine
// while data-count keeps the real number (ADR-013), and a visually hidden sentence reads the real number.
import { Count } from "@/components/data/Count";
import { formatNumber } from "@/components/format";
import type { Locale, Translator } from "@/lib/i18n";

export interface SideNavItem {
  /** Area key, e.g. "my-work"; becomes `nav-<key>` and `count-nav-<key>`. */
  key: string;
  href: string;
  /** Localised area name. */
  label: string;
  /** The persona's own items needing action in this area (already authorised). Absent or 0: no badge. */
  count?: number;
}

export interface SideNavProps {
  t: Translator;
  locale: Locale;
  items: readonly SideNavItem[];
  /** Key of the current area. */
  current?: string;
}

export const SIDE_NAV_MAX_ITEMS = 5;
const COUNT_CAP = 9;

export function SideNav({ t, locale, items, current }: SideNavProps) {
  if (items.length > SIDE_NAV_MAX_ITEMS) throw new Error("SideNav: at most five areas");
  return (
    <nav className="v13-side-nav" aria-label={t("shell.nav.label")} data-testid="app-sidebar">
      <ul>
        {items.map((item) => {
          const isCurrent = item.key === current;
          const hasCount = item.count !== undefined && item.count > 0;
          return (
            <li key={item.key}>
              <a
                href={item.href}
                className="v13-side-nav-link"
                aria-current={isCurrent ? "page" : undefined}
                data-testid={`nav-${item.key}`}
              >
                <span>{item.label}</span>
                {hasCount && item.count !== undefined ? (
                  <>
                    <Count
                      name={`nav-${item.key}`}
                      value={item.count}
                      locale={locale}
                      className="v13-nav-count"
                    >
                      <span aria-hidden="true">
                        {item.count > COUNT_CAP
                          ? `${formatNumber(locale, COUNT_CAP)}+`
                          : formatNumber(locale, item.count)}
                      </span>
                    </Count>
                    <span className="v13-sr-only">
                      {t("shell.nav.countLabel", { count: formatNumber(locale, item.count) })}
                    </span>
                  </>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
