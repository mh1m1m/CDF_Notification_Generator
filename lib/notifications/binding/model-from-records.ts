import "server-only";
/**
 * V13-PROC-008: the notification model built from server records (for FE-006's preview).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 *
 * buildModelFromRecords(records) → an UNPROJECTED NotificationModel. Every input is a record the server read: the case
 * row, the notification row with its template, and the case's procedural events. Nothing comes from the request. The
 * result must pass projectForRecipient() (./server-projection) before any renderer sees it; that is where the policy
 * decides what each recipient sees. This module adds no disclosure rule.
 *
 * Only fields the records can fill are set; a field the records cannot fill is left out, which is how the model marks a
 * missing value. Nothing is invented and nothing comes from the fixtures:
 *   template_code       the template code
 *   notice_reference    derived from the notification id (as for every notice)
 *   case_number         the case's display number (the policy decides whether a recipient sees it)
 *   event_title         the template's catalogue name (ar, en)
 *   issuer              the default issuer text; help and confidentiality_notice: the per-class texts
 *   classification_marking  RESTRICTED when the case is restricted, else INTERNAL; never PUBLIC (ARCH ruling)
 *   delivery_status     the notification row's lifecycle status, in the lifecycle vocabulary the wording reads; a
 *                       status without wording (SUPERSEDED, unknown) is refused (UNSUPPORTED_LIFECYCLE_STATUS)
 *   card_content, preheader, subject_detail   enabled, as for every notice
 * Left out (ARCH rulings, 31 Oct): the Level 1 stage (a mapping from case_record.stage to the catalogue's codes is the
 * owner's decision, OI-039), the event summary (template placeholders are never filled into free text), and the next
 * action, deadline, levels 2–3 and evidence references (the records hold no procedural objects).
 *
 * Fail closed (NotificationBindingError): a missing or malformed record, a notification row or an event of another case.
 * The same records always give the same model (generated_at is the notification row's created_at).
 *
 * PRODUCTION_SUBSTITUTION_REQUIRED: the records come from the prototype's `cdf_notifications_v13` tables; in production
 * from the CDF case system of record through `CaseSourceAdapter` and the approved notification catalogue.
 */
import { isNil } from "@/lib/domain/nil";
import { CLASSIFICATION, MARKING } from "@/lib/notifications/render/i18n";
import { noticeReference, recipientNotices } from "@/lib/notifications/render/model";
import { ar as AR } from "@/lib/i18n/notificationRender/ar";
import { en as EN } from "@/lib/i18n/notificationRender/en";
import { NotificationBindingError } from "./server-projection";

/** `cdf_notifications_v13.case_record`, as read by the server */
export interface CaseRecordRow {
  readonly id: string;
  readonly display_number: string;
  readonly is_restricted: boolean;
  readonly records_state: string;
}
/** `notification_template` + `notification_template_version` of the notification */
export interface TemplateRow {
  readonly code: string;
  readonly version: number;
  readonly language: string;
  readonly name_ar: string;
  readonly name_en: string;
}
/** `cdf_notifications_v13.notification`, with its template */
export interface NotificationRow {
  readonly id: string;
  readonly case_id: string;
  readonly recipient_class: string;
  readonly lifecycle_status: string;
  readonly created_at: string;
  readonly template: TemplateRow;
}
/** `cdf_notifications_v13.procedural_event` of the case */
export interface ProceduralEventRow {
  readonly id: string;
  readonly case_id: string;
  readonly event_code: string;
  readonly occurred_at: string;
  readonly recorded_at: string;
}
export interface NotificationRecordSet {
  readonly case_record: CaseRecordRow;
  readonly notification: NotificationRow;
  readonly events: readonly ProceduralEventRow[];
}

/** The model this module returns: unprojected, keyed to its case. */
export interface RecordsNotificationModel {
  readonly meta: {
    readonly notification_id: string;
    readonly case_id: string;
    readonly type_code: string;
    readonly event_type: null;
    readonly template_version: string;
    readonly language: "ar" | "en";
    readonly recipient_class: string;
    readonly recipient_ref: null;
    readonly generated_at: string;
    readonly synthetic: true;
    readonly marking: string;
    readonly release_status: "DESIGN_PREVIEW";
    /** informative only: projectForRecipient never reads it; fail closed (restricted, not listed) */
    readonly context: { readonly tags: readonly string[]; readonly on_access_list: false };
  };
  readonly fields: Readonly<Record<string, unknown>>;
  readonly safe_refs: Readonly<Record<string, string>>;
}

/**
 * The database lifecycle status in the lifecycle vocabulary deliveryWording() reads (ARCH ruling, 31 Oct 20:54).
 * DISPATCHED reads "sent — delivery not confirmed" on every experience (channel EMAIL: the dispatch outbox sends e-mail),
 * never "delivered". Any other code is refused, SUPERSEDED included: no command sets it yet, and the row does not say
 * whether the correction was sent, so neither "superseded by a sent correction" nor "still the current version" holds.
 */
const LIFECYCLE_TO_DELIVERY: Readonly<Record<string, { notification_status: string; channel?: string }>> =
  Object.freeze({
    DRAFT: { notification_status: "DRAFT" },
    PENDING_APPROVAL: { notification_status: "AUTHORIZATION_PENDING" },
    APPROVED: { notification_status: "AUTHORIZED" },
    DISPATCHED: { notification_status: "SENT", channel: "EMAIL" },
    CANCELLED: { notification_status: "CANCELLED" },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const isObj = (v: unknown): v is Record<string, unknown> =>
  !isNil(v) && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown, max = 300): v is string =>
  typeof v === "string" && v.trim() !== "" && v.length <= max;
const refuse = (
  code: "NO_SERVER_CONTEXT" | "CASE_MISMATCH" | "UNSUPPORTED_LIFECYCLE_STATUS",
  message: string,
): never => {
  throw new NotificationBindingError(code, message);
};

function checkCase(c: unknown): CaseRecordRow {
  if (
    !isObj(c) ||
    typeof c.id !== "string" ||
    !UUID.test(c.id) ||
    !isText(c.display_number, 40) ||
    typeof c.is_restricted !== "boolean" ||
    !isText(c.records_state, 20)
  )
    refuse("NO_SERVER_CONTEXT", "no valid case record");
  return c as unknown as CaseRecordRow;
}
function checkNotification(n: unknown, caseId: string): NotificationRow {
  if (
    !isObj(n) ||
    typeof n.id !== "string" ||
    !UUID.test(n.id) ||
    typeof n.case_id !== "string" ||
    !isText(n.recipient_class, 60) ||
    !isText(n.lifecycle_status, 40) ||
    typeof n.created_at !== "string" ||
    !ZONED.test(n.created_at)
  )
    refuse("NO_SERVER_CONTEXT", "no valid notification row");
  const row = n as Record<string, unknown>;
  if (row.case_id !== caseId) refuse("CASE_MISMATCH", "the notification row belongs to another case");
  const t = row.template;
  if (
    !isObj(t) ||
    !isText(t.code, 80) ||
    !Number.isInteger(t.version) ||
    (t.version as number) < 1 ||
    (t.language !== "ar" && t.language !== "en") ||
    !isText(t.name_ar, 200) ||
    !isText(t.name_en, 200)
  )
    refuse("NO_SERVER_CONTEXT", "no valid template row");
  return n as unknown as NotificationRow;
}
function checkEvents(events: unknown, caseId: string): readonly ProceduralEventRow[] {
  if (!Array.isArray(events)) refuse("NO_SERVER_CONTEXT", "no event list");
  for (const e of events as unknown[]) {
    if (
      !isObj(e) ||
      typeof e.id !== "string" ||
      typeof e.case_id !== "string" ||
      !isText(e.event_code, 80) ||
      typeof e.occurred_at !== "string" ||
      typeof e.recorded_at !== "string"
    )
      refuse("NO_SERVER_CONTEXT", "a malformed event");
    if ((e as Record<string, unknown>).case_id !== caseId)
      refuse("CASE_MISMATCH", "an event belongs to another case");
  }
  return events as readonly ProceduralEventRow[];
}

/** buildModelFromRecords(records) → the unprojected model of one notification, from server records only. */
export function buildModelFromRecords(records: NotificationRecordSet): RecordsNotificationModel {
  if (!isObj(records)) refuse("NO_SERVER_CONTEXT", "no server records");
  const c = checkCase(records.case_record);
  const n = checkNotification(records.notification, c.id);
  checkEvents(records.events, c.id); // validated for the case; no field is derived from them (see header)
  const cls = n.recipient_class;
  const nid = n.id;
  const delivery = Object.hasOwn(LIFECYCLE_TO_DELIVERY, n.lifecycle_status)
    ? LIFECYCLE_TO_DELIVERY[n.lifecycle_status]
    : undefined;
  if (!delivery)
    refuse("UNSUPPORTED_LIFECYCLE_STATUS", "the notification row's lifecycle status has no delivery wording");
  // INTERNAL unless the case is restricted; never PUBLIC (ARCH ruling: it only tightens, like CASE_PUBLIC)
  const classification = c.is_restricted ? "RESTRICTED" : "INTERNAL";
  const noticeRef = noticeReference(nid);
  const notices = recipientNotices(cls);
  const fields: Record<string, unknown> = {
    event_title: { ar: n.template.name_ar, en: n.template.name_en },
    issuer: { ar: AR["model.defaultIssuer"], en: EN["model.defaultIssuer"] },
    notice_reference: noticeRef,
    template_code: n.template.code,
    case_number: c.display_number,
    card_content: { enabled: true },
    preheader: { enabled: true },
    subject_detail: { enabled: true },
    classification_marking: {
      code: classification,
      ar: CLASSIFICATION[classification].ar,
      en: CLASSIFICATION[classification].en,
    },
    delivery_status: { ...delivery },
    help: notices.help,
    confidentiality_notice: notices.confidentiality_notice,
  };
  for (const k of Object.keys(fields)) if (isNil(fields[k])) delete fields[k];
  return {
    meta: {
      notification_id: nid,
      case_id: c.id,
      type_code: n.template.code,
      event_type: null,
      template_version: `${n.template.code}@v${n.template.version}`,
      language: n.template.language === "en" ? "en" : "ar",
      recipient_class: cls,
      recipient_ref: null,
      generated_at: n.created_at,
      synthetic: true,
      marking: MARKING,
      release_status: "DESIGN_PREVIEW",
      context: { tags: c.is_restricted ? ["CASE_RESTRICTED"] : [], on_access_list: false },
    },
    fields,
    safe_refs: { "*": noticeRef },
  };
}
