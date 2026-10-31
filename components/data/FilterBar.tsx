// FilterBar: a GET form, so filters, sort and page live in the URL and a view can be shared and restored
// (INFORMATION_ARCHITECTURE.md §5 rule 5). "Apply" submits; "Clear filters" is a link to the unfiltered URL.
import type { ReactNode } from "react";
import type { Translator } from "@/lib/i18n";

export interface FilterBarProps {
  t: Translator;
  /** The page's own path, e.g. "/portfolio". */
  action: string;
  clearHref: string;
  /** Accessible name of the form. */
  label: string;
  children: ReactNode;
}

export function FilterBar({ t, action, clearHref, label, children }: FilterBarProps) {
  return (
    <form method="get" action={action} className="v13-filter-bar" aria-label={label} data-testid="filter-bar">
      <div className="v13-filter-fields">{children}</div>
      <div className="v13-filter-actions">
        <button type="submit" className="v13-btn v13-btn-primary" data-testid="filter-apply">
          {t("common.apply")}
        </button>
        <a href={clearHref} className="v13-btn v13-btn-text" data-testid="filter-clear">
          {t("common.clearFilters")}
        </a>
      </div>
    </form>
  );
}
