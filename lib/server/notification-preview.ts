// In-case notification preview (V13-FE-006 part 3; SCREENS S3 Notifications tab; REQ-NOTIF-011).
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
//
// `?n=<notification id>` on /cases/<case id>/notifications. The case is the one the route already authorised
// (getCaseForRoute). Order:
//   1. the URL value must be a UUID; the read is keyed by this case AND that id (RLS), so an unknown id, another case's
//      notification and an unauthorised one all come back empty and show the same generic state;
//   2. a recipient class the disclosure policy does not know (every database code except WITNESS today, OI-037) is
//      refused by the binding itself (UNKNOWN_RECIPIENT); that one refusal shows the OI-037 state, never a guessed
//      mapping. FE keeps no copy of the policy's class list (lib/disclosure stays behind lib/notifications, BND-05);
//   3. one case_record object, built from the authorised case row, goes to buildModelFromRecords AND to
//      projectForRecipient (ARCH ruling, 31 Oct); access_list is never passed, so a restricted case fails closed
//      (NO_ACCESS_LIST_RESULT) until a read returns the server's access-list result;
//   4. only the projected model is rendered (renderPlatform), and only its HTML reaches UX-006's sandboxed frame.
// Any binding or read error shows one generic state with the correlation id; the log carries the error code only.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: the records come from the prototype's `cdf_notifications_v13` tables; production
// reads the CDF case system of record through CaseSourceAdapter and the CDF access-list service.
import "server-only";
import {
  PreviewNotificationIdSchema,
  type CaseEvent,
  type CaseSummary,
  type NotificationPreviewReader,
  type NotificationPreviewRecord,
  type ProceduralRecordsReader,
} from "@/lib/contracts";
import {
  buildModelFromRecords,
  type CaseRecordRow,
  type NotificationRecordSet,
} from "@/lib/notifications/binding/model-from-records";
import { NotificationBindingError, projectForRecipient } from "@/lib/notifications/binding/server-projection";
import { renderPlatform } from "@/lib/notifications/render/platform";
import type { RequestContext } from "./context";
import { toUserError } from "./errors";

/** The search parameter that names the notification to preview. */
export const PREVIEW_PARAM = "n";

export interface NotificationPreviewDeps {
  readonly ctx: RequestContext;
  readonly reader: NotificationPreviewReader;
  readonly procedural: ProceduralRecordsReader;
}

export type NotificationPreviewView =
  | { readonly kind: "none" }
  | {
      readonly kind: "preview";
      readonly notificationId: string;
      readonly html: string;
      readonly title: string;
      readonly lang: "ar" | "en";
    }
  | { readonly kind: "unmapped"; readonly notificationId: string; readonly recipientClass: string }
  | { readonly kind: "unavailable"; readonly correlationId: string };

/**
 * The raw `?n=` value: undefined when absent, otherwise the single string given ("" for anything else, which the
 * loader treats as malformed). Never trimmed or decoded further.
 */
export function previewParamOf(params: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const v = params?.[PREVIEW_PARAM];
  if (v === undefined) return undefined;
  if (typeof v === "string") return v;
  return Array.isArray(v) && v.length === 1 && typeof v[0] === "string" ? v[0] : "";
}

/** `/cases/<id>/notifications?n=<notification id>` */
export function previewHref(caseId: string, notificationId: string): string {
  return `/cases/${caseId}/notifications?${PREVIEW_PARAM}=${encodeURIComponent(notificationId)}`;
}

/** The authorised case row, as buildModelFromRecords and projectForRecipient read it. */
function caseRecordOf(summary: CaseSummary): CaseRecordRow {
  return Object.freeze({
    id: summary.case_id,
    display_number: summary.case_number,
    is_restricted: summary.is_restricted,
    records_state: summary.records_state,
  });
}

function recordSetOf(
  caseRecord: CaseRecordRow,
  n: NotificationPreviewRecord,
  events: readonly CaseEvent[],
): NotificationRecordSet {
  return {
    case_record: caseRecord,
    notification: {
      id: n.notification_id,
      case_id: n.case_id,
      recipient_class: n.recipient_class,
      lifecycle_status: n.lifecycle_status,
      created_at: n.created_at,
      template: {
        code: n.template_code,
        version: n.template_version,
        language: n.language,
        name_ar: n.template_name.ar,
        name_en: n.template_name.en,
      },
    },
    events: events.map((e) => ({
      id: e.id,
      case_id: e.case_id,
      event_code: e.event_code,
      occurred_at: e.occurred_at,
      recorded_at: e.recorded_at,
    })),
  };
}

/**
 * The preview for `?n=` on an already authorised case. Never throws for a binding or read failure: those become the
 * generic "unavailable" state. NOT_FOUND / UNAUTHENTICATED from the readers are re-thrown for the page.
 */
export async function loadNotificationPreview(
  { ctx, reader, procedural }: NotificationPreviewDeps,
  summary: CaseSummary,
  rawNotificationId: string | undefined,
): Promise<NotificationPreviewView> {
  if (rawNotificationId === undefined) return { kind: "none" };
  const unavailable = { kind: "unavailable", correlationId: ctx.correlationId } as const;
  const id = PreviewNotificationIdSchema.safeParse(rawNotificationId);
  if (!id.success) return unavailable;
  try {
    const n = await reader.getForCase(ctx.identity, summary.case_id, id.data);
    if (n === null) return unavailable;
    const events = await procedural.listEvents(ctx.identity, summary.case_id);
    const caseRecord = caseRecordOf(summary);
    const model = buildModelFromRecords(recordSetOf(caseRecord, n, events));
    let projected: ReturnType<typeof projectForRecipient>;
    try {
      projected = projectForRecipient(
        model,
        {
          case_record: caseRecord,
          recipient_row: { case_id: n.case_id, recipient_class: n.recipient_class },
        },
        { channel: "PLATFORM" },
      );
    } catch (error) {
      // OI-037: the database's class is not a policy class. Nothing is projected or rendered for it.
      if (error instanceof NotificationBindingError && error.code === "UNKNOWN_RECIPIENT")
        return { kind: "unmapped", notificationId: n.notification_id, recipientClass: n.recipient_class };
      throw error;
    }
    const rendered = renderPlatform(projected, { lang: n.language });
    return {
      kind: "preview",
      notificationId: n.notification_id,
      html: rendered.html,
      title: rendered.title,
      lang: n.language,
    };
  } catch (error) {
    const user = toUserError(error, ctx.correlationId, "notification_preview_error");
    if (user.code === "NOT_FOUND" || user.code === "UNAUTHENTICATED") throw error;
    return unavailable;
  }
}
