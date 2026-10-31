// SideNav: the role's main areas (at most five, INFORMATION_ARCHITECTURE.md §4.2). The list is a convenience, never an
// authorisation: pages re-check. The current area has aria-current="page", a 4 px inline-start bar and a tint (not
// colour alone). A count is the persona's own items needing action, never a number of cases; it shows "9+" above nine
// while data-count keeps the real number (ADR-013), and a visually hidden sentence reads the real number.
//
// Two entry points share one markup (SideNavList, plain serialisable props):
// - SideNav: server rendering with a translator and an explicit `current`;
// - SideNavAuto (client): the platform layout's form, which works out `current` from the URL (a layout cannot see it).
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
  /** Test id of the <nav>; defaults to `app-sidebar`. */
  testId?: string;
}

/** A SideNav item with its count sentence already localised (serialisable, so a client component can render it). */
export interface SideNavListItem extends SideNavItem {
  /** Visually hidden sentence for the count, e.g. "3 items need your action". */
  countLabel?: string;
}

export interface SideNavListProps {
  locale: Locale;
  /** Localised label of the navigation landmark. */
  label: string;
  items: readonly SideNavListItem[];
  current?: string;
  testId?: string;
}

export const SIDE_NAV_MAX_ITEMS = 5;
const COUNT_CAP = 9;

/** The area whose link is the URL's path or a parent of it; none when no area contains the path (e.g. /cases/…). */
export function currentArea(
  pathname: string,
  items: readonly Pick<SideNavItem, "key" | "href">[],
): string | undefined {
  return items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.key;
}

export function sideNavListItems(
  t: Translator,
  locale: Locale,
  items: readonly SideNavItem[],
): SideNavListItem[] {
  return items.map((item) =>
    item.count !== undefined && item.count > 0
      ? { ...item, countLabel: t("shell.nav.countLabel", { count: formatNumber(locale, item.count) }) }
      : { ...item },
  );
}

export function SideNavList({ locale, label, items, current, testId = "app-sidebar" }: SideNavListProps) {
  if (items.length > SIDE_NAV_MAX_ITEMS) throw new Error("SideNav: at most five areas");
  return (
    <nav className="v13-side-nav" aria-label={label} data-testid={testId}>
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
                    {item.countLabel ? <span className="v13-sr-only">{item.countLabel}</span> : null}
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

export function SideNav({ t, locale, items, current, testId }: SideNavProps) {
  return (
    <SideNavList
      locale={locale}
      label={t("shell.nav.label")}
      items={sideNavListItems(t, locale, items)}
      current={current}
      testId={testId}
    />
  );
}
