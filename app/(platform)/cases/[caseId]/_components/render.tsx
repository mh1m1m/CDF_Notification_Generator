// Shared page plumbing for the Case Workspace tabs (FE-004). One cached load per request, shared by generateMetadata
// and the page: request context → getCaseForRoute (lib/authz pre-check + CaseSourceAdapter) → V13 records.
// Anything the persona may not see is notFound(), the same page as an unknown route; no session goes to sign-in.
import "server-only";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getTranslator } from "@/lib/i18n/server";
import { notificationDraftsFor, notificationRecordsFor, proceduralRecordsFor } from "@/lib/server/records";
import { caseSourceFor } from "@/lib/server/case-source";
import { resolveCaseWorkspace, type CaseTab, type CaseWorkspaceResult } from "@/lib/server/case-workspace";
import { requireRequestContext } from "@/lib/server/context";
import { isAppError } from "@/lib/server/errors";
import { parseDraftNotice, type DraftNotice } from "@/lib/server/notification-draft";
import { CaseErrorState, CaseWorkspace, TAB_KEYS } from "./CaseWorkspace";

export interface CaseRouteProps {
  readonly params: Promise<{ caseId: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

// `notice` is a primitive key part (cache() compares arguments by identity): the serialised parsed flag or "".
const load = cache(async (rawCaseId: string, tab: CaseTab, noticeKey = ""): Promise<CaseWorkspaceResult> => {
  const notice = noticeKey ? (JSON.parse(noticeKey) as DraftNotice) : null;
  try {
    const ctx = await requireRequestContext();
    return await resolveCaseWorkspace(
      {
        ctx,
        source: caseSourceFor(ctx.correlationId),
        procedural: proceduralRecordsFor(ctx.correlationId),
        notifications: notificationRecordsFor(ctx.correlationId),
        ...(tab === "notifications" ? { drafts: notificationDraftsFor(ctx.correlationId), notice } : {}),
      },
      rawCaseId,
      tab,
    );
  } catch (error) {
    if (isAppError(error) && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
});

export async function caseTabMetadata(props: CaseRouteProps, tab: CaseTab): Promise<Metadata> {
  const { caseId } = await props.params;
  const { t } = await getTranslator();
  const result = await load(caseId, tab, await noticeKeyOf(props, tab));
  if (result.kind === "error") return { title: t("case.error.title") };
  return { title: `${result.view.summary.case_number} · ${t(TAB_KEYS[tab])}` };
}

const noticeKeyOf = async (props: CaseRouteProps, tab: CaseTab): Promise<string> => {
  if (tab !== "notifications" || !props.searchParams) return "";
  const notice = parseDraftNotice(await props.searchParams);
  return notice ? JSON.stringify(notice) : "";
};

export async function CaseTabPage(props: CaseRouteProps & { tab: CaseTab }) {
  const { params, tab } = props;
  const { caseId } = await params;
  const { t, locale } = await getTranslator();
  const result = await load(caseId, tab, await noticeKeyOf(props, tab));
  if (result.kind === "error") return <CaseErrorState t={t} correlationId={result.correlationId} />;
  return <CaseWorkspace t={t} locale={locale} view={result.view} />;
}
