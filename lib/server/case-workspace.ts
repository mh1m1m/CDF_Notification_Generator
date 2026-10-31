// Case Workspace loader (FE-004, SCREENS S3). The URL's case id is the only case context: no cookie, storage or
// "current case" state. Order: request context → getCaseForRoute (parse, lib/authz pre-check,
// CaseSourceAdapter.getCase, which carries the capacity) → V13 records of that same case (ProceduralRecordsReader,
// NotificationRecordsReader; RLS). Unknown, malformed, unauthorised, restricted and
// other-workspace ids all end in AppError("NOT_FOUND"), which the page turns into the shared not-found page.
import "server-only";
import type {
  CaseCapacity,
  CaseEvent,
  CaseNotification,
  CaseSourceAdapter,
  CaseSummary,
  CaseTask,
  NotificationDraftPort,
  NotificationPreviewReader,
  NotificationRecordsReader,
  ProceduralRecordsReader,
} from "@/lib/contracts";
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
  | (Frame & { readonly tab: "events"; readonly events: readonly CaseEvent[] })
  | (Frame & { readonly tab: "tasks"; readonly tasks: readonly CaseTask[] })
  | (Frame & {
      readonly tab: "notifications";
      readonly notifications: readonly CaseNotification[];
      readonly draft: DraftFormView | null;
      readonly notice: DraftNotice | null;
      readonly preview: NotificationPreviewView;
    });

const OPEN_STATUSES = new Set(["OPEN", "IN_PROGRESS", "BLOCKED"]);

/** Loads one tab of one case. Throws AppError("NOT_FOUND") for anything the persona may not see. */
export async function loadCaseWorkspace(
  { ctx, source, procedural, notifications, drafts, notice, preview, previewId }: CaseWorkspaceDeps,
  rawCaseId: unknown,
  tab: CaseTab,
): Promise<CaseWorkspaceView> {
  const { my_capacity: capacity, ...summary } = await getCaseForRoute({ ctx, source }, rawCaseId);
  const caseId = summary.case_id;
  const frame = { summary, capacity };
  switch (tab) {
    case "overview": {
      const events = await procedural.listEvents(ctx.identity, caseId);
      const tasks = await procedural.listTasks(ctx.identity, caseId);
      return {
        ...frame,
        tab,
        events: events.slice(0, OVERVIEW_EVENTS),
        myTasks: tasks.filter((t) => t.is_mine && OPEN_STATUSES.has(t.status)),
      };
    }
    case "events":
      return { ...frame, tab, events: await procedural.listEvents(ctx.identity, caseId) };
    case "tasks":
      return { ...frame, tab, tasks: await procedural.listTasks(ctx.identity, caseId) };
    case "notifications": {
      const list = await notifications.listForCase(ctx.identity, caseId);
      // A "created" flag is shown only for a notification of this case the persona can see (no echo of other ids).
      const shown =
        notice?.kind === "created" && !list.some((n) => n.notification_id === notice.notificationId)
          ? null
          : (notice ?? null);
      return {
        ...frame,
        tab,
        notifications: list,
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
