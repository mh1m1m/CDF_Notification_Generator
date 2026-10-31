// Pagination: previous/next links (keyset cursors live in the URL), arrows that mirror in RTL, and an optional
// summary. The summary is shown only when the total is authorised; its total goes through Count, so the test id is
// `count-<name>-total` with the real `data-count`.
import { Count } from "@/components/data/Count";
import { formatNumber } from "@/components/format";
import { ChevronEndIcon } from "@/components/icons";
import { interpolateNodes } from "@/components/interpolate";
import type { Locale, Translator } from "@/lib/i18n";

export interface PaginationProps {
  t: Translator;
  locale: Locale;
  prevHref?: string;
  nextHref?: string;
  summary?: { from: number; to: number; total: number; name: string };
}

export function Pagination({ t, locale, prevHref, nextHref, summary }: PaginationProps) {
  return (
    <nav className="v13-pagination" aria-label={t("common.pagination.label")}>
      {summary ? (
        <p className="v13-pagination-summary">
          {interpolateNodes(t("common.pageSummary"), {
            from: formatNumber(locale, summary.from),
            to: formatNumber(locale, summary.to),
            total: <Count name={`${summary.name}-total`} value={summary.total} locale={locale} />,
          })}
        </p>
      ) : null}
      <ul>
        <li>
          {prevHref ? (
            <a href={prevHref} rel="prev" data-testid="pagination-prev">
              <ChevronEndIcon className="v13-flip" />
              <span>{t("common.previous")}</span>
            </a>
          ) : (
            <span aria-disabled="true" className="v13-pagination-off" data-testid="pagination-prev">
              <ChevronEndIcon className="v13-flip" />
              <span>{t("common.previous")}</span>
            </span>
          )}
        </li>
        <li>
          {nextHref ? (
            <a href={nextHref} rel="next" data-testid="pagination-next">
              <span>{t("common.next")}</span>
              <ChevronEndIcon />
            </a>
          ) : (
            <span aria-disabled="true" className="v13-pagination-off" data-testid="pagination-next">
              <span>{t("common.next")}</span>
              <ChevronEndIcon />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
