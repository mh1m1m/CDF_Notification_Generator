// Case Workspace loader (FE-004, SCREENS S3). The URL's case id is the only case context: no cookie, storage or
// "current case" state. Order: request context → getCaseForRoute (parse, lib/authz pre-check,
// CaseSourceAdapter.getCase, which carries the capacity) → V13 records of that same case (ProceduralRecordsReader,
// NotificationRecordsReader; RLS). Unknown, malformed, unauthorised, restricted and
// other-workspace ids all end in AppError("NOT_FOUND"), which the page turns into the shared not-found page.
// V13-FE-013 (OI-026): the Events, Tasks and Notifications tabs read one bounded page (DB-019's case_*_page), only
// after the route's case passed the pre-check; no count or total is read. A tampered or foreign cursor gives the
// tab's empty state (with a link to the first page), never an error.
import "server-only";
import {
  CASE_RECORDS_PAGE_SIZE,
  InvalidCursorError,
  type CaseCapacity,
  type CaseEvent,
  type CaseNotification,
  type CaseSourceAdapter,
  type CaseSummary,
  type CaseTask,
  type NotificationDraftPort,
  type NotificationPreviewReader,
  type NotificationRecordsReader,
  type ProceduralRecordsReader,
} from "@/lib/contracts";
import { listPaging, FIRST_PAGE, type ListPaging, type ParsedListPage } from "./case-list-paging";
import { getCaseForRoute } from "./cases";
import type { RequestContext } from "./context";
import { toUserError } from "./errors";
import { loadDraftForm, type DraftFormView, type DraftNotice } from "./notification-draft";
import { loadNotificationPreview, type NotificationPreviewView } from "./notification-preview";

export const CASE_TABS = ["overview", "events", "tasks", "notifications"] as const;
export type CaseTab = (typeof CASE_TABS)[number];
/** Events shown on the Overview tab (S3: last five recorded events). */
export const OVERVIEW_EVENTS = 5;

export interface CaseWorkspaceDeps {
  readonly ctx: RequestContext;
  readonly source: CaseSourceAdapter;
  readonly procedural: ProceduralRecordsReader;
  readonly notifications: NotificationRecordsReader;
  /** Draft options and command (V13-FE-006); without it the tab offers no draft form. */
  readonly drafts?: NotificationDraftPort;
  /** The outcome flag of the last draft action, already parsed (notifications tab only). */
  readonly notice?: DraftNotice | null;
  /** The in-case preview's read (V13-FE-006 part 3); without it the tab shows no preview. */
  readonly preview?: NotificationPreviewReader;
  /** The raw `?n=` value (notifications tab only); undefined when absent. */
  readonly previewId?: string;
  /** The parsed `after` / `back` paging state (events, tasks and notifications tabs); default the first page. */
  readonly page?: ParsedListPage;
}

interface Frame {
  readonly summary: CaseSummary;
  readonly capacity: CaseCapacity | null;
}

export type CaseWorkspaceView =
  | (Frame & {
      readonly tab: "overview";
      readonly events: readonly CaseEvent[];
      readonly myTasks: readonly CaseTask[];
    })
  | (Frame & { readonly tab: "events"; readonly events: readonly CaseEvent[]; readonly paging: ListPaging })
  | (Frame & { readonly tab: "tasks"; readonly tasks: readonly CaseTask[]; readonly paging: ListPaging })
  | (Frame & {
      readonly tab: "notifications";
      readonly notifications: readonly CaseNotification[];
      readonly paging: ListPaging;
      readonly draft: DraftFormView | null;
      readonly notice: DraftNotice | null;
      readonly preview: NotificationPreviewView;
    });

const OPEN_STATUSES = new Set(["OPEN", "IN_PROGRESS", "BLOCKED"]);

/**
 * One page of a list, or the empty page for a tampered URL or a cursor the reader refuses (InvalidCursorError): the
 * tab then shows its empty state with a link to the first page. Any other failure propagates (generic error view).
 */
async function onePage<T>(
  path: string,
  page: ParsedListPage,
  read: (request: { limit: number; cursor?: string }) => Promise<{
    readonly items: readonly T[];
    readonly next_cursor: string | null;
  }>,
): Promise<{ items: readonly T[]; paging: ListPaging }> {
  const refused = { items: [] as readonly T[], paging: listPaging(path, { ok: false }, null) };
  if (!page.ok) return refused;
  try {
    const { after } = page.query;
    const result = await read({
      limit: CASE_RECORDS_PAGE_SIZE,
      ...(after !== undefined ? { cursor: after } : {}),
    });
    return { items: result.items, paging: listPaging(path, page, result.next_cursor) };
  } catch (error) {
    if (error instanceof InvalidCursorError) return refused;
    throw error;
  }
}

/** Loads one tab of one case. Throws AppError("NOT_FOUND") for anything the persona may not see. */
export async function loadCaseWorkspace(
  {
    ctx,
    source,
    procedural,
    notifications,
    drafts,
    notice,
    preview,
    previewId,
    page = FIRST_PAGE,
  }: CaseWorkspaceDeps,
  rawCaseId: unknown,
  tab: CaseTab,
): Promise<CaseWorkspaceView> {
  const { my_capacity: capacity, ...summary } = await getCaseForRoute({ ctx, source }, rawCaseId);
  const caseId = summary.case_id;
  const frame = { summary, capacity };
  switch (tab) {
    case "overview": {
      // The last five events are one page of five (V13-FE-013); own open tasks still read the case's task list.
      const events = await procedural.listEventsPage(ctx.identity, caseId, { limit: OVERVIEW_EVENTS });
      const tasks = await procedural.listTasks(ctx.identity, caseId);
      return {
        ...frame,
        tab,
        events: events.items,
        myTasks: tasks.filter((t) => t.is_mine && OPEN_STATUSES.has(t.status)),
      };
    }
    case "events": {
      const { items, paging } = await onePage(`/cases/${caseId}/events`, page, (request) =>
        procedural.listEventsPage(ctx.identity, caseId, request),
      );
      return { ...frame, tab, events: items, paging };
    }
    case "tasks": {
      const { items, paging } = await onePage(`/cases/${caseId}/tasks`, page, (request) =>
        procedural.listTasksPage(ctx.identity, caseId, request),
      );
      return { ...frame, tab, tasks: items, paging };
    }
    case "notifications": {
      const { items: list, paging } = await onePage(`/cases/${caseId}/notifications`, page, (request) =>
        notifications.listForCasePage(ctx.identity, caseId, request),
      );
      // A "created" flag is shown only for a notification of this case the persona can see (no echo of other ids).
      const shown =
        notice?.kind === "created" && !list.some((n) => n.notification_id === notice.notificationId)
          ? null
          : (notice ?? null);
      return {
        ...frame,
        tab,
        notifications: list,
        paging,
        draft: drafts ? await loadDraftForm({ ctx, drafts }, summary) : null,
        notice: shown,
        preview: preview
          ? await loadNotificationPreview({ ctx, reader: preview, procedural }, summary, previewId)
          : { kind: "none" },
      };
    }
  }
}

export type CaseWorkspaceResult =
  | { readonly kind: "view"; readonly view: CaseWorkspaceView }
  | { readonly kind: "error"; readonly correlationId: string };

/**
 * The page's outcome. NOT_FOUND and UNAUTHENTICATED are re-thrown for the page to turn into notFound() and the sign-in
 * redirect; any other failure is logged (code and correlation id only) and becomes a generic error view.
 */
export async function resolveCaseWorkspace(
  deps: CaseWorkspaceDeps,
  rawCaseId: unknown,
  tab: CaseTab,
): Promise<CaseWorkspaceResult> {
  try {
    return { kind: "view", view: await loadCaseWorkspace(deps, rawCaseId, tab) };
  } catch (error) {
    const user = toUserError(error, deps.ctx.correlationId, "case_workspace_error");
    if (user.code === "NOT_FOUND" || user.code === "UNAUTHENTICATED") throw error;
    return { kind: "error", correlationId: user.correlationId };
  }
}
