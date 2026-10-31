// Not-found page inside the authenticated shell (OI-042). notFound() from a platform page (unknown, hidden or
// unauthorised case; the Notification Center for an investigator, D6) renders here, inside the AppShell's own
// <main id="main">, so this page is a plain section: one main landmark, one skip-link target. The visible text and
// data-testid are the root not-found page's, so an unknown route and a refused one read the same.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("common.notFound.title") };
}

export default async function PlatformNotFound() {
  const { t } = await getTranslator();
  return (
    <section aria-labelledby="not-found-heading" data-testid="not-found-state">
      <h1 id="not-found-heading">{t("common.notFound.heading")}</h1>
      <p className="v13-lead">{t("common.notFound.body")}</p>
      <Link href="/" className="v13-button-link" data-testid="not-found-home">
        {t("common.notFound.backToStart")}
      </Link>
    </section>
  );
}
