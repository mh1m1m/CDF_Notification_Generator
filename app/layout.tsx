// Root layout: <html lang dir> from the v13_locale cookie (Arabic, RTL, by default), the skip link, and the permanent
// synthetic-data banner with the language switch on every page.
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";
import { LocaleToggle } from "@/components/shell/LocaleToggle";
import { SyntheticBanner } from "@/components/shell/SyntheticBanner";
import { dirFor, otherLocale } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { switchLocale } from "./locale-action";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: { template: t("common.meta.titleTemplate", { page: "%s" }), default: t("common.app.name") },
    description: t("common.app.description"),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, t } = await getTranslator();
  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body>
        <a href="#main" className="v13-skip-link" data-testid="skip-link">
          {t("common.skipLink.label")}
        </a>
        <header className="v13-topbar">
          <SyntheticBanner t={t} />
          <LocaleToggle t={t} target={otherLocale(locale)} action={switchLocale} />
        </header>
        {children}
      </body>
    </html>
  );
}
