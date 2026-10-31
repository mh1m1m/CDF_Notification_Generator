// Scenario E (V13-FE-006, SCREENS S3 Notifications tab): the draft form and the draft command. Order for the command:
// lib/authz pre-check for the case named in the form → Zod parse (the contract's schema) → api_create_notification_draft,
// which re-checks access, role, ACTIVE, input and the author's idempotency key and writes the audit event. The case id
// comes from the route (rendered into the form by the server); the database decides whether this persona may draft
// there, and only the case id it returns is used afterwards (SEC). Persona and workspace come only from the session.
// Outcomes carry ids only; logs carry codes only, never form values or database messages.
import "server-only";
import { precheck } from "@/lib/authz";
import {
  CreateNotificationDraftCommandSchema,
  NotificationCommandRefusedError,
  type CaseId,
  type CaseSummary,
  type DraftRecipientClass,
  type DraftTemplateOption,
  type NotificationDraftPort,
  UuidSchema,
} from "@/lib/contracts";
import { logServerError } from "@/lib/http/errors";
import type { RequestContext } from "./context";

/** A fresh idempotency key for one rendering of the form: 32 random bytes, lower-case hex. */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface DraftFormView {
  readonly caseId: CaseId;
  readonly idempotencyKey: string;
  readonly templates: readonly DraftTemplateOption[];
  readonly recipientClasses: readonly DraftRecipientClass[];
}

export interface DraftDeps {
  readonly ctx: RequestContext;
  readonly drafts: NotificationDraftPort;
}

/**
 * The draft form for this case, or null when it is not offered: the active workspace's roles may not draft, the case is
 * not ACTIVE, or there is nothing to choose from. Hiding is a convenience; the command decides again.
 */
export async function loadDraftForm(
  { ctx, drafts }: DraftDeps,
  summary: CaseSummary,
  issueKey: () => string = newIdempotencyKey,
): Promise<DraftFormView | null> {
  if (!precheck(ctx.identity, "notification.draft.create", { caseId: summary.case_id }).allow) return null;
  if (summary.records_state !== "ACTIVE") return null;
  const { templates, recipientClasses } = await drafts.options(ctx.identity);
  if (templates.length === 0 || recipientClasses.length === 0) return null;
  return { caseId: summary.case_id, idempotencyKey: issueKey(), templates, recipientClasses };
}

/** Raw form values (untrusted). */
export interface DraftForm {
  readonly case_id: unknown;
  readonly template_version_id: unknown;
  readonly recipient_class: unknown;
  readonly idempotency_key: unknown;
}

/**
 * The command's outcome. A created draft carries the case id and notification id the database command returned (SEC
 * condition 1: never the form's case id). Every refusal is the same generic outcome with the correlation id; the form's
 * case id is never echoed, redirected to, shown or logged.
 */
export type DraftOutcome =
  | { readonly kind: "created"; readonly caseId: CaseId; readonly notificationId: string }
  | { readonly kind: "refused"; readonly correlationId: string };

export async function createNotificationDraft(
  { ctx, drafts }: DraftDeps,
  form: DraftForm,
): Promise<DraftOutcome> {
  const correlationId = ctx.correlationId;
  const refused = (code: string): DraftOutcome => {
    logServerError("notification_draft_refused", correlationId, { code });
    return { kind: "refused", correlationId };
  };
  if (!precheck(ctx.identity, "notification.draft.create", { caseId: form.case_id }).allow) {
    return refused("PRECHECK");
  }
  const parsed = CreateNotificationDraftCommandSchema.safeParse({
    case_id: form.case_id,
    template_version_id: form.template_version_id,
    recipient_class: form.recipient_class,
    idempotency_key: form.idempotency_key,
  });
  if (!parsed.success) return refused("VALIDATION");
  try {
    const created = await drafts.createDraft(ctx.identity, parsed.data);
    return { kind: "created", caseId: created.case_id, notificationId: created.notification_id };
  } catch (error) {
    if (error instanceof NotificationCommandRefusedError) return refused(error.refusal);
    logServerError("notification_draft_failed", correlationId, error);
    return { kind: "refused", correlationId };
  }
}

/** Where a created draft sends the browser: the Notifications tab of the case the database returned. */
export function createdDraftTarget(outcome: Extract<DraftOutcome, { kind: "created" }>): string {
  return `/cases/${outcome.caseId}/notifications?created=${outcome.notificationId}`;
}

/** The "created" flag on the Notifications tab's URL (untrusted: only a well-formed id is kept). */
export type DraftNotice = { readonly kind: "created"; readonly notificationId: string };

const one = (v: unknown): string | undefined =>
  typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;

export function parseDraftNotice(params: Readonly<Record<string, unknown>> | undefined): DraftNotice | null {
  const parsed = UuidSchema.safeParse(one(params?.created));
  return parsed.success ? { kind: "created", notificationId: parsed.data } : null;
}
