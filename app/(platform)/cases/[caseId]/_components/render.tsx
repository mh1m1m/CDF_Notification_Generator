// Shared page plumbing for the Case Workspace tabs (FE-004). One load per page render: request context →
// getCaseForRoute (lib/authz pre-check + CaseSourceAdapter.openCase, which writes the case's access record in the same
// transaction, V13-FE-017) → V13 records. generateMetadata reads nothing (see caseTabMetadata).
// Anything the persona may not see is notFound(), the same page as an unknown route; no session goes to sign-in.
import "server-only";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getTranslator } from "@/lib/i18n/server";
import { notificationDraftsFor, notificationRecordsFor, proceduralRecordsFor } from "@/lib/server/records";
import { caseSourceFor } from "@/lib/server/case-source";
import { parseListPage, type ParsedListPage } from "@/lib/server/case-list-paging";
import { resolveCaseWorkspace, type CaseTab, type CaseWorkspaceResult } from "@/lib/server/case-workspace";
import { requireRequestContext } from "@/lib/server/context";
import { isAppError } from "@/lib/server/errors";
import { parseDraftNotice, type DraftNotice } from "@/lib/server/notification-draft";
import { previewParamOf } from "@/lib/server/notification-preview";
import { notificationPreviewFor } from "@/lib/server/preview-records";
import { CaseErrorState, CaseWorkspace, TAB_KEYS } from "./CaseWorkspace";

export interface CaseRouteProps {
  readonly params: Promise<{ caseId: string }>;
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

// `noticeKey`, `previewKey` and `pageKey` are primitive key parts (cache() compares arguments by identity): the
// serialised parsed flag or "", the raw `?n=` value or undefined, and the serialised parsed paging state (V13-FE-013).
const load = cache(
  async (
    rawCaseId: string,
    tab: CaseTab,
    noticeKey = "",
    previewKey?: string,
    pageKey = "",
  ): Promise<CaseWorkspaceResult> => {
    const notice = noticeKey ? (JSON.parse(noticeKey) as DraftNotice) : null;
    const page = pageKey ? (JSON.parse(pageKey) as ParsedListPage) : undefined;
    try {
      const ctx = await requireRequestContext();
      return await resolveCaseWorkspace(
        {
          ctx,
          source: caseSourceFor(ctx.correlationId),
          procedural: proceduralRecordsFor(ctx.correlationId),
          notifications: notificationRecordsFor(ctx.correlationId),
          ...(tab === "notifications"
            ? {
                drafts: notificationDraftsFor(ctx.correlationId),
                notice,
                preview: notificationPreviewFor(ctx.correlationId),
                ...(previewKey === undefined ? {} : { previewId: previewKey }),
              }
            : {}),
          ...(page ? { page } : {}),
        },
        rawCaseId,
        tab,
      );
    } catch (error) {
      if (isAppError(error) && error.code === "UNAUTHENTICATED") redirect("/sign-in");
      if (isAppError(error) && error.code === "NOT_FOUND") notFound();
      throw error;
    }
  },
);

/**
 * The tab's document title, read from no record (V13-FE-017, DB-023 D1/D2). Next.js resolves metadata on its own: on a
 * link prefetch (which then carries the head) and apart from the page on a document request, so a title built from the
 * case would open the case for a prefetch, and twice per page. The title therefore names the tab only; the case number
 * stays in the page (and out of the browser history).
 */
export async function caseTabMetadata(_props: CaseRouteProps, tab: CaseTab): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("case.documentTitle", { tab: t(TAB_KEYS[tab]) }) };
}

const noticeKeyOf = async (props: CaseRouteProps, tab: CaseTab): Promise<string> => {
  if (tab !== "notifications" || !props.searchParams) return "";
  const notice = parseDraftNotice(await props.searchParams);
  return notice ? JSON.stringify(notice) : "";
};

// V13-FE-013: the paged tabs; V13-FE-014: the overview's own open tasks too (its last five events are not paged).
const pageKeyOf = async (props: CaseRouteProps): Promise<string> =>
  !props.searchParams ? "" : JSON.stringify(parseListPage(await props.searchParams));

const previewKeyOf = async (props: CaseRouteProps, tab: CaseTab): Promise<string | undefined> =>
  tab === "notifications" && props.searchParams ? previewParamOf(await props.searchParams) : undefined;

export async function CaseTabPage(props: CaseRouteProps & { tab: CaseTab }) {
  const { params, tab } = props;
  const { caseId } = await params;
  const { t, locale } = await getTranslator();
  const result = await load(
    caseId,
    tab,
    await noticeKeyOf(props, tab),
    await previewKeyOf(props, tab),
    await pageKeyOf(props),
  );
  if (result.kind === "error") return <CaseErrorState t={t} correlationId={result.correlationId} />;
  return <CaseWorkspace t={t} locale={locale} view={result.view} />;
}
