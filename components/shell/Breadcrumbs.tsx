// Breadcrumbs (INFORMATION_ARCHITECTURE.md §4.3): an ordered list in a labelled nav; the last item is the current page,
// with aria-current="page" and no link. Separators are decorative chevrons that mirror in RTL. A case crumb shows the
// case of the URL only; pass its display number wrapped in <bdi dir="ltr">.
import type { ReactNode } from "react";
import { ChevronEndIcon } from "@/components/icons";
import type { Translator } from "@/lib/i18n";

export interface BreadcrumbItem {
  /** Omitted for the current page (the last item). */
  href?: string;
  label: ReactNode;
}

export function Breadcrumbs({ t, items }: { t: Translator; items: readonly BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  const last = items.length - 1;
  return (
    <nav className="v13-breadcrumbs" aria-label={t("shell.breadcrumbs.label")} data-testid="breadcrumbs">
      <ol>
        {items.map((item, i) => (
          <li key={i}>
            {i > 0 ? <ChevronEndIcon className="v13-breadcrumb-sep" /> : null}
            {i === last || item.href === undefined ? (
              <span aria-current={i === last ? "page" : undefined}>{item.label}</span>
            ) : (
              <a href={item.href}>{item.label}</a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
