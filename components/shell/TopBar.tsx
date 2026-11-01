// TopBar (DG p. 29): 48 px Warm Gray bar with the logo or wordmark and product name at the start edge and the session
// controls at the end. In Arabic the start edge is the right, as the guide requires; English mirrors (ruling D2).
// The product name is styled as H2 Regular but is not a heading: the page's only <h1> is in <main>.
// Landmark: the root layout's synthetic-data band is the page's one banner (<header>) on every page, so the TopBar is a
// labelled region (<section aria-label>), never a second banner (axe landmark-no-duplicate-banner, QA on #76).
import type { ReactNode } from "react";
import type { Translator } from "@/lib/i18n";

export interface TopBarProps {
  t: Translator;
  /** The CDF logo (152×26). BRAND ASSET SOURCE_REQUIRED: until it is supplied the organisation name is shown as text. */
  logo?: ReactNode;
  /** WorkspaceSwitcher. */
  workspace?: ReactNode;
  /** Language switch (LocaleToggle). */
  language?: ReactNode;
  /** PersonaMenu. */
  persona?: ReactNode;
}

export function TopBar({ t, logo, workspace, language, persona }: TopBarProps) {
  return (
    <section className="v13-top-bar" aria-label={t("shell.sessionLabel")} data-testid="top-bar">
      <div className="v13-top-bar-brand">
        {logo ?? <span className="v13-wordmark">{t("shell.orgName")}</span>}
        <p className="v13-product-name">{t("shell.productName")}</p>
      </div>
      <div className="v13-top-bar-controls">
        {workspace}
        {language}
        {persona}
      </div>
    </section>
  );
}
