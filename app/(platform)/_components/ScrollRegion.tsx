// A table wrapper that scrolls inline at narrow widths. Keyboard users must be able to reach and scroll it, so it is
// focusable and named by the table's caption (WCAG 2.1.1; axe scrollable-region-focusable; QA review of #23).
// Server component; the caller gives the caption the same id.
import type { ReactNode } from "react";

export function ScrollRegion({
  className,
  labelledBy,
  children,
}: {
  className: string | undefined;
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    // A focusable scroll container is the accessible pattern for scrollable content (axe scrollable-region-focusable).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className={className} tabIndex={0} role="region" aria-labelledby={labelledBy} data-scroll-region="">
      {children}
    </div>
  );
}
