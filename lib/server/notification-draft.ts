// Scenario E (V13-FE-006, SCREENS S3 Notifications tab): the draft form and the draft command. Order for the command:
// lib/authz pre-check for the case named in the form → Zod parse (the contract's schema) → api_create_notification_draft,
// which re-checks access, role, ACTIVE, input and the author's idempotency key and writes the audit event. The case id
// comes from the route (rendered into the form by the server); the database decides whether this persona may draft
// there. Outcomes carry ids only; logs carry codes only, never form values or database messages.
import "server-only";
import { parseCaseId, precheck } from "@/lib/authz";
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

export type DraftOutcome =
  | { readonly kind: "created"; readonly caseId: CaseId; readonly notificationId: string }
  | { readonly kind: "duplicate"; readonly caseId: CaseId; readonly correlationId: string }
  | { readonly kind: "error"; readonly caseId: CaseId | null; readonly correlationId: string };

export async function createNotificationDraft(
  { ctx, drafts }: DraftDeps,
  form: DraftForm,
): Promise<DraftOutcome> {
  const correlationId = ctx.correlationId;
  // Only a well-formed id is ever echoed into the redirect; the page re-authorises it like any route id.
  const caseId = parseCaseId(form.case_id);
  if (!precheck(ctx.identity, "notification.draft.create", { caseId: form.case_id }).allow) {
    logServerError("notification_draft_refused", correlationId, { code: "PRECHECK" });
    return { kind: "error", caseId, correlationId };
  }
  const parsed = CreateNotificationDraftCommandSchema.safeParse({
    case_id: form.case_id,
    template_version_id: form.template_version_id,
    recipient_class: form.recipient_class,
    idempotency_key: form.idempotency_key,
  });
  if (!parsed.success || caseId === null) {
    logServerError("notification_draft_refused", correlationId, { code: "VALIDATION" });
    return { kind: "error", caseId, correlationId };
  }
  try {
    const created = await drafts.createDraft(ctx.identity, parsed.data);
    return { kind: "created", caseId: created.case_id, notificationId: created.notification_id };
  } catch (error) {
    if (error instanceof NotificationCommandRefusedError) {
      logServerError("notification_draft_refused", correlationId, { code: error.refusal });
      return error.refusal === "DUPLICATE"
        ? { kind: "duplicate", caseId, correlationId }
        : { kind: "error", caseId, correlationId };
    }
    logServerError("notification_draft_failed", correlationId, error);
    return { kind: "error", caseId, correlationId };
  }
}

/**
 * Where the action sends the browser: the case's Notifications tab with an outcome flag. A malformed case id (only a
 * tampered form has one) goes to the portfolio with no detail.
 */
export function draftRedirectTarget(outcome: DraftOutcome): string {
  if (outcome.caseId === null) return "/portfolio";
  const base = `/cases/${outcome.caseId}/notifications`;
  switch (outcome.kind) {
    case "created":
      return `${base}?created=${outcome.notificationId}`;
    case "duplicate":
      return `${base}?duplicate=${outcome.correlationId}`;
    case "error":
      return `${base}?ref=${outcome.correlationId}`;
  }
}

/** The outcome flag on the Notifications tab's URL (untrusted: only well-formed ids are kept). */
export type DraftNotice =
  | { readonly kind: "created"; readonly notificationId: string }
  | { readonly kind: "duplicate"; readonly correlationId: string }
  | { readonly kind: "error"; readonly correlationId: string };

const one = (v: unknown): string | undefined =>
  typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
const uuid = (v: unknown): string | null => {
  const parsed = UuidSchema.safeParse(one(v));
  return parsed.success ? parsed.data : null;
};

export function parseDraftNotice(params: Readonly<Record<string, unknown>> | undefined): DraftNotice | null {
  if (!params) return null;
  const created = uuid(params.created);
  if (created) return { kind: "created", notificationId: created };
  const duplicate = uuid(params.duplicate);
  if (duplicate) return { kind: "duplicate", correlationId: duplicate };
  const ref = uuid(params.ref);
  if (ref) return { kind: "error", correlationId: ref };
  return null;
}
