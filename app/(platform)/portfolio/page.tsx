// Case Portfolio (FE-003, SCREENS S2): the cases the persona may see in the active workspace, filtered by a GET form
// and paged by keyset. Data comes only through lib/server (context → lib/authz pre-check → CaseSourceAdapter inside
// the database security context); the result count is the authorised total from the database.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslator } from "@/lib/i18n/server";
import { caseSourceFor } from "@/lib/server/case-source";
import { requireRequestContext } from "@/lib/server/context";
import { isAppError } from "@/lib/server/errors";
import { loadPortfolio, type PortfolioView as View } from "@/lib/server/portfolio";
import type { RawSearchParams } from "@/lib/server/portfolio-query";
import { PortfolioView } from "./_components/PortfolioView";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("portfolio.pageTitle") };
}

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  let view: View;
  try {
    const ctx = await requireRequestContext();
    view = await loadPortfolio({ ctx, source: caseSourceFor(ctx.correlationId) }, await searchParams);
  } catch (error) {
    if (isAppError(error) && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { locale, t } = await getTranslator();
  return <PortfolioView t={t} locale={locale} view={view} />;
}
