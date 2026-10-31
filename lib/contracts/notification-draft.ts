// Scenario E (SCREENS S3 Notifications tab, V13-FE-006): the options a draft may use and the draft command. Shapes
// mirror DB's notification_template / notification_template_version / notification_recipient_class and
// api_create_notification_draft (migration 0004). Metadata only: no subject, body or recipient details reach the form.
import { z } from "zod";
import { CaseIdSchema, UuidSchema } from "./ids";
import type { RequestIdentity } from "./identity";

const RECIPIENT_CLASS = /^[A-Z][A-Z0-9_]{2,40}$/;
const TEMPLATE_CODE = /^[A-Z][A-Z0-9_-]{2,60}$/;
// eslint-disable-next-line no-control-regex
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const Name = z.string().trim().min(1).max(200).regex(NO_CONTROL_CHARS);
const Bilingual = z.strictObject({ ar: Name, en: Name });

/** One version of an active template a draft may use (its id, code, version and language; never its text). */
export const DraftTemplateOptionSchema = z.strictObject({
  template_version_id: UuidSchema,
  template_code: z.string().regex(TEMPLATE_CODE),
  template_name: Bilingual,
  version: z.number().int().min(1),
  language: z.enum(["ar", "en"]),
});
export type DraftTemplateOption = z.infer<typeof DraftTemplateOptionSchema>;

/** One recipient class (reference data, migration 0004). */
export const DraftRecipientClassSchema = z.strictObject({
  code: z.string().regex(RECIPIENT_CLASS),
  name: Bilingual,
});
export type DraftRecipientClass = z.infer<typeof DraftRecipientClassSchema>;

export interface DraftOptions {
  readonly templates: readonly DraftTemplateOption[];
  readonly recipientClasses: readonly DraftRecipientClass[];
}

/** An idempotency key: 32 random bytes as lower-case hex, issued with the form, used once per author. */
export const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The draft command (api_create_notification_draft). One schema: the form, the server and the database all check it.
 * `case_id` is the route's case, rendered into the form by the server; the database re-checks access and ACTIVE.
 */
export const CreateNotificationDraftCommandSchema = z.strictObject({
  case_id: CaseIdSchema,
  template_version_id: UuidSchema,
  recipient_class: z.string().regex(RECIPIENT_CLASS),
  idempotency_key: z.string().regex(IDEMPOTENCY_KEY_PATTERN),
});
export type CreateNotificationDraftCommand = z.infer<typeof CreateNotificationDraftCommandSchema>;

export const NotificationDraftCreatedSchema = z.strictObject({
  notification_id: UuidSchema,
  case_id: CaseIdSchema,
  lifecycle_status: z.literal("DRAFT"),
  row_version: z.literal(1),
});
export type NotificationDraftCreated = z.infer<typeof NotificationDraftCreatedSchema>;

/** Why the database refused a draft (its codes, mapped by the adapter; never shown to the user as such). */
export const NOTIFICATION_COMMAND_REFUSALS = [
  "NO_CONTEXT",
  "NOT_FOUND",
  "CASE_CLOSED",
  "INVALID_INPUT",
  "DUPLICATE",
] as const;
export type NotificationCommandRefusal = (typeof NOTIFICATION_COMMAND_REFUSALS)[number];

/** A NotificationDraftPort refusal. Its message is the refusal code only (nothing caller-supplied or from the database). */
export class NotificationCommandRefusedError extends Error {
  override readonly name = "NotificationCommandRefusedError";
  constructor(readonly refusal: NotificationCommandRefusal) {
    super(refusal);
  }
}

/**
 * Draft options and the draft command. Contract: every call runs inside the database security context (RLS);
 * `createDraft` checks access, role, case state, input and the author's idempotency key inside one transaction that also
 * writes the notification event and the audit event; a refusal changes nothing and throws
 * NotificationCommandRefusedError with one of NOTIFICATION_COMMAND_REFUSALS; any other error is an unexpected failure.
 */
export interface NotificationDraftPort {
  options(identity: RequestIdentity): Promise<DraftOptions>;
  createDraft(
    identity: RequestIdentity,
    command: CreateNotificationDraftCommand,
  ): Promise<NotificationDraftCreated>;
}
