// PageHeading: the page's only <h1>, an optional subtitle, and page actions at the inline end.
import type { ReactNode } from "react";

export interface PageHeadingProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeading({ title, subtitle, actions }: PageHeadingProps) {
  return (
    <div className="v13-page-heading" data-testid="page-heading">
      <div>
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        {subtitle ? <p className="v13-lead">{subtitle}</p> : null}
      </div>
      {actions ? <div className="v13-page-actions">{actions}</div> : null}
    </div>
  );
}
