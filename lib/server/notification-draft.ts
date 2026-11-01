// Scenario E (V13-FE-006, SCREENS S3 Notifications tab): the draft form and the draft command. Order for the command
// (V13-FE-012, ADR-020): Zod parse (the contract's schema) → the form binding (./draft-binding.ts): the case is the one
// the server rendered the form for, verified against the session, and the posted case id must equal it → lib/authz
// pre-check for that case → api_create_notification_draft, which re-checks access, role, ACTIVE, input and the author's
// idempotency key and writes the audit event. A refusal at any step is the same generic outcome, whether an edited id
// names a visible, hidden or unknown case. The database decides whether this persona may draft there, and only the
// case id it returns is used afterwards (SEC). Persona and workspace come only from the session.
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
import { draftBindingKey } from "@/lib/auth/draft-binding-key";
import type { RequestContext } from "./context";
import { signDraftBinding, verifyDraftBinding, type DraftBindingSubject } from "./draft-binding";

/** A fresh idempotency key for one rendering of the form: 32 random bytes, lower-case hex. */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface DraftFormView {
  readonly caseId: CaseId;
  readonly idempotencyKey: string;
  /** Binds caseId and idempotencyKey to this persona, workspace and session (V13-FE-012). */
  readonly binding: string;
  readonly templates: readonly DraftTemplateOption[];
  readonly recipientClasses: readonly DraftRecipientClass[];
}

export interface DraftDeps {
  readonly ctx: RequestContext;
  readonly drafts: NotificationDraftPort;
  /** The form-binding key (default: lib/auth/draft-binding-key.ts). */
  readonly bindingKey?: () => Uint8Array;
  /** The server clock (default: now). */
  readonly now?: () => Date;
}

/** What a binding is bound to in this request: the session's persona, workspace, issued-at and expiry. */
function bindingSubject(ctx: RequestContext): DraftBindingSubject {
  return { identity: ctx.identity, iat: ctx.session.claims.iat, exp: ctx.session.claims.exp };
}

/**
 * The draft form for this case, or null when it is not offered: the active workspace's roles may not draft, the case is
 * not ACTIVE, or there is nothing to choose from. Hiding is a convenience; the command decides again.
 */
export async function loadDraftForm(
  { ctx, drafts, bindingKey = draftBindingKey }: DraftDeps,
  summary: CaseSummary,
  issueKey: () => string = newIdempotencyKey,
): Promise<DraftFormView | null> {
  if (!precheck(ctx.identity, "notification.draft.create", { caseId: summary.case_id }).allow) return null;
  if (summary.records_state !== "ACTIVE") return null;
  const { templates, recipientClasses } = await drafts.options(ctx.identity);
  if (templates.length === 0 || recipientClasses.length === 0) return null;
  const idempotencyKey = issueKey();
  return {
    caseId: summary.case_id,
    idempotencyKey,
    binding: signDraftBinding(bindingKey(), bindingSubject(ctx), summary.case_id, idempotencyKey),
    templates,
    recipientClasses,
  };
}

/** Raw form values (untrusted). */
export interface DraftForm {
  readonly case_id: unknown;
  readonly template_version_id: unknown;
  readonly recipient_class: unknown;
  readonly idempotency_key: unknown;
  readonly case_binding: unknown;
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
  { ctx, drafts, bindingKey = draftBindingKey, now = () => new Date() }: DraftDeps,
  form: DraftForm,
): Promise<DraftOutcome> {
  const correlationId = ctx.correlationId;
  const refused = (code: string): DraftOutcome => {
    logServerError("notification_draft_refused", correlationId, { code });
    return { kind: "refused", correlationId };
  };
  const parsed = CreateNotificationDraftCommandSchema.safeParse({
    case_id: form.case_id,
    template_version_id: form.template_version_id,
    recipient_class: form.recipient_class,
    idempotency_key: form.idempotency_key,
  });
  if (!parsed.success) return refused("VALIDATION");
  // Input binding (OI-049): the case is the one the server rendered this form for in this session; the posted case id
  // must equal it. One code for every binding failure, so nothing (logs included) says which part failed.
  const boundCase = verifyDraftBinding(
    bindingKey(),
    bindingSubject(ctx),
    { caseId: parsed.data.case_id, idempotencyKey: parsed.data.idempotency_key, binding: form.case_binding },
    Math.floor(now().getTime() / 1000),
  );
  if (boundCase === null) return refused("BINDING");
  if (!precheck(ctx.identity, "notification.draft.create", { caseId: boundCase }).allow) {
    return refused("PRECHECK");
  }
  try {
    // The command's case is the verified binding's (SEC, ADR-020), equal to the posted one by now.
    const command = { ...parsed.data, case_id: boundCase as CaseId };
    const created = await drafts.createDraft(ctx.identity, command);
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
