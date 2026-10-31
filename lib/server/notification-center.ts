// Notification Operations Center loader (FE-006, SCREENS S4). Order: request context → lib/authz pre-check
// ("notifications.center.read", SEC ruling D6) → URL parsing → NotificationCenterReader inside the database security
// context (RLS before filters, order, limit and count; DB-015). The pre-check comes first so that, for an investigator,
// every URL of the route (any query string) answers exactly like an unknown route (SEC-APP-17). The result is a view
// model only: the page never sees an exception, a SQL error or anything about cases the persona may not see.
import "server-only";
import { precheck } from "@/lib/authz";
import {
  InvalidCursorError,
  NotificationCenterFilterSchema,
  type NotificationCenterPage,
  type NotificationCenterReader,
} from "@/lib/contracts";
import type { RequestContext } from "./context";
import { AppError, isAppError, toUserError } from "./errors";
import {
  centerNextHref,
  centerPositionOf,
  centerPrevHref,
  parseCenterQuery,
  toCenterFilter,
  type CenterQuery,
  type RawSearchParams,
} from "./notification-center-query";

export interface NotificationCenterDeps {
  readonly ctx: RequestContext;
  readonly reader: NotificationCenterReader;
}

export type NotificationCenterView =
  | {
      readonly kind: "page";
      readonly query: CenterQuery;
      readonly page: NotificationCenterPage;
      /** 1-based position of the first row among all authorised matches; 0 when unknown. */
      readonly from: number;
      readonly nextHref: string | null;
      readonly prevHref: string | null;
    }
  /** The URL carries filters or a cursor the form cannot produce (edited URL, stale cursor). */
  | { readonly kind: "invalid"; readonly correlationId: string }
  | { readonly kind: "error"; readonly correlationId: string };

/** Throws AppError("NOT_FOUND") when the active workspace's roles may not open the Center (D6). */
export function assertCenterAccess(ctx: RequestContext): void {
  if (!precheck(ctx.identity, "notifications.center.read").allow) throw new AppError("NOT_FOUND");
}

export async function loadNotificationCenter(
  { ctx, reader }: NotificationCenterDeps,
  params: RawSearchParams,
): Promise<NotificationCenterView> {
  assertCenterAccess(ctx);
  const correlationId = ctx.correlationId;
  const parsed = parseCenterQuery(params);
  if (!parsed.ok) return { kind: "invalid", correlationId };
  const { query } = parsed;
  const filter = NotificationCenterFilterSchema.safeParse(toCenterFilter(query));
  if (!filter.success) return { kind: "invalid", correlationId };
  try {
    const page = await reader.listNotifications(ctx.identity, filter.data);
    return {
      kind: "page",
      query,
      page,
      from: centerPositionOf(query),
      nextHref: centerNextHref(query, page.next_cursor),
      prevHref: centerPrevHref(query),
    };
  } catch (error) {
    if (isAppError(error) && error.code === "UNAUTHENTICATED") throw error;
    if (error instanceof InvalidCursorError) return { kind: "invalid", correlationId };
    // Logged with the code and correlation id only; the page shows the generic error with the reference.
    toUserError(error, correlationId, "notification_center.load_failed");
    return { kind: "error", correlationId };
  }
}
