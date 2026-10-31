// Shared page plumbing for the Case Workspace tabs (FE-004). One cached load per request, shared by generateMetadata
// and the page: request context → getCaseForRoute (lib/authz pre-check + CaseSourceAdapter) → CaseRecordsReader.
// Anything the persona may not see is notFound(), the same page as an unknown route; no session goes to sign-in.
import "server-only";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getTranslator } from "@/lib/i18n/server";
import { caseRecordsFor } from "@/lib/server/case-records";
import { caseSourceFor } from "@/lib/server/case-source";
import { resolveCaseWorkspace, type CaseTab, type CaseWorkspaceResult } from "@/lib/server/case-workspace";
import { requireRequestContext } from "@/lib/server/context";
import { isAppError } from "@/lib/server/errors";
import { CaseErrorState, CaseWorkspace, TAB_KEYS } from "./CaseWorkspace";

export interface CaseRouteProps {
  readonly params: Promise<{ caseId: string }>;
}

const load = cache(async (rawCaseId: string, tab: CaseTab): Promise<CaseWorkspaceResult> => {
  try {
    const ctx = await requireRequestContext();
    return await resolveCaseWorkspace(
      { ctx, source: caseSourceFor(ctx.correlationId), records: caseRecordsFor(ctx.correlationId) },
      rawCaseId,
      tab,
    );
  } catch (error) {
    if (isAppError(error) && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
});

export async function caseTabMetadata({ params }: CaseRouteProps, tab: CaseTab): Promise<Metadata> {
  const { caseId } = await params;
  const { t } = await getTranslator();
  const result = await load(caseId, tab);
  if (result.kind === "error") return { title: t("case.error.title") };
  return { title: `${result.view.summary.case_number} · ${t(TAB_KEYS[tab])}` };
}

export async function CaseTabPage({ params, tab }: CaseRouteProps & { tab: CaseTab }) {
  const { caseId } = await params;
  const { t, locale } = await getTranslator();
  const result = await load(caseId, tab);
  if (result.kind === "error") return <CaseErrorState t={t} correlationId={result.correlationId} />;
  return <CaseWorkspace t={t} locale={locale} view={result.view} />;
}
