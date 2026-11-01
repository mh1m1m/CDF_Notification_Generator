// NotificationDraftPort over V13's template, template-version and recipient-class tables (SELECT under RLS, migration
// 0004) and api_create_notification_draft (SECURITY DEFINER command, 0004). Inside the request security context,
// bound values, explicit columns (strict rows), no template text read. A row that breaks the contract refuses the whole list; the
// command's refusal codes are mapped to NotificationCommandRefusedError (never shown to the user as such).
//
// V13 is the system of record for its notifications. PRODUCTION_SUBSTITUTION_REQUIRED for this implementation only:
// prototype PostgreSQL (Supabase); production runs the same functions on RDS PostgreSQL behind the ASP.NET Core API
// on Alibaba Cloud Riyadh.
import "server-only";
import {
  CreateNotificationDraftCommandSchema,
  DraftRecipientClassSchema,
  DraftTemplateOptionSchema,
  NotificationCommandRefusedError,
  NotificationDraftCreatedSchema,
  type CreateNotificationDraftCommand,
  type DraftOptions,
  type NotificationCommandRefusal,
  type NotificationDraftCreated,
  type NotificationDraftPort,
  type RequestIdentity,
} from "@/lib/contracts";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";

interface TemplateRow {
  template_version_id: string;
  template_code: string;
  name_ar: string;
  name_en: string;
  version: number;
  language: string;
}

interface RecipientClassRow {
  code: string;
  name_ar: string;
  name_en: string;
}

const TEMPLATE_COLUMNS = [
  "template_version_id",
  "template_code",
  "name_ar",
  "name_en",
  "version",
  "language",
];
const CLASS_COLUMNS = ["code", "name_ar", "name_en"];

/** Strict rows: a row with a column the query did not ask for refuses the whole result. */
function exactColumns(row: object, columns: readonly string[]): void {
  const keys = Object.keys(row);
  if (keys.length !== columns.length || !keys.every((k) => columns.includes(k)))
    throw new Error("notification draft options: unexpected columns");
}

export const rowToDraftTemplateOption = (r: TemplateRow) => {
  exactColumns(r, TEMPLATE_COLUMNS);
  return DraftTemplateOptionSchema.parse({
    template_version_id: r.template_version_id,
    template_code: r.template_code,
    template_name: { ar: r.name_ar, en: r.name_en },
    version: r.version,
    language: r.language,
  });
};

export const rowToDraftRecipientClass = (r: RecipientClassRow) => {
  exactColumns(r, CLASS_COLUMNS);
  return DraftRecipientClassSchema.parse({ code: r.code, name: { ar: r.name_ar, en: r.name_en } });
};

/**
 * The command's refusal codes (migration 0004), returned in its `refusal` column since migration 0013 (V13-DB-021).
 * Any other value, V1500 included, is an unexpected failure and throws a plain Error; any other database error
 * propagates unchanged.
 */
const REFUSALS: Readonly<Record<string, NotificationCommandRefusal>> = {
  V1401: "NO_CONTEXT",
  V1404: "NOT_FOUND",
  V1409: "DUPLICATE",
  V1422: "INVALID_INPUT",
  V1423: "CASE_CLOSED",
};

interface CommandRow {
  notification_id: string | null;
  case_id: string | null;
  lifecycle_status: string | null;
  row_version: number | null;
  refusal: string | null;
}

function refusalOf(code: string): NotificationCommandRefusal {
  const refusal = Object.hasOwn(REFUSALS, code) ? REFUSALS[code] : undefined;
  if (!refusal) throw new Error("api_create_notification_draft: unknown refusal");
  return refusal;
}

export function createV13NotificationDrafts(run: RequestContextRunner): NotificationDraftPort {
  return {
    async options(identity: RequestIdentity): Promise<DraftOptions> {
      return run(identity, async (tx) => {
        const templates = await tx<TemplateRow[]>`
          select tv.id as template_version_id, t.code as template_code, t.name_ar, t.name_en, tv.version, tv.language
            from cdf_notifications_v13.notification_template_version tv
            join cdf_notifications_v13.notification_template t on t.id = tv.template_id
           where t.is_active
           order by t.code collate "C", tv.version, tv.language`;
        const classes = await tx<RecipientClassRow[]>`
          select r.code, r.name_ar, r.name_en
            from cdf_notifications_v13.notification_recipient_class r
           order by r.code collate "C"`;
        return {
          templates: templates.map(rowToDraftTemplateOption),
          recipientClasses: classes.map(rowToDraftRecipientClass),
        };
      });
    },

    async createDraft(
      identity: RequestIdentity,
      command: CreateNotificationDraftCommand,
    ): Promise<NotificationDraftCreated> {
      const c = CreateNotificationDraftCommandSchema.parse(command);
      // One command per transaction (R1). The refusal is mapped only after run(...) has resolved, so the transaction
      // that holds the database's COMMAND_REFUSED audit row (migration 0013) has committed (DB-021 §6).
      const rows = await run(
        identity,
        (tx) =>
          tx<CommandRow[]>`
          select r.notification_id, r.case_id, r.lifecycle_status, r.row_version, r.refusal
            from cdf_notifications_v13.api_create_notification_draft(
                   ${c.case_id}::uuid, ${c.template_version_id}::uuid, ${c.recipient_class},
                   ${c.idempotency_key}) r`,
      );
      if (rows.length !== 1) throw new Error("api_create_notification_draft: expected one row");
      const { refusal, ...answer } = rows[0] as CommandRow;
      // The refusal column is read before any other column (fail closed on an unknown code).
      if (refusal !== null) throw new NotificationCommandRefusedError(refusalOf(refusal));
      const created = NotificationDraftCreatedSchema.parse(answer);
      // The database must answer for the case asked for (fail closed otherwise).
      if (created.case_id !== c.case_id) {
        throw new Error("api_create_notification_draft: answer does not match the command");
      }
      return created;
    },
  };
}
