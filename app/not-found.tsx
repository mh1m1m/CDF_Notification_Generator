// Generic not-found page. Used for unknown routes and for anything the current persona may not see, which must look
// the same (no existence leak).
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslator } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("common.notFound.title") };
}

export default async function NotFound() {
  const { t } = await getTranslator();
  return (
    <main id="main" className="v13-main" tabIndex={-1}>
      <h1>{t("common.notFound.heading")}</h1>
      <p className="v13-lead">{t("common.notFound.body")}</p>
      <Link href="/" className="v13-button-link" data-testid="not-found-home">
        {t("common.notFound.backToStart")}
      </Link>
    </main>
  );
}
