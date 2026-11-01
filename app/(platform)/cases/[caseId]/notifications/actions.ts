"use server";
// Notification draft (V13-FE-006, Scenario E). A short Server Action form (useActionState): session → request context
// → lib/server (pre-check, Zod parse, database command). A created draft redirects to the Notifications tab of the
// case the database returned, with the new notification id. Every refusal returns the same generic state with the
// correlation id, so the browser stays on the page it was on; the form's case id is never echoed. The form's case id
// counts only with the binding the server rendered for it (V13-FE-012, lib/server/draft-binding.ts).
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/server-session";
import { requireRequestContext } from "@/lib/server/context";
import { createdDraftTarget, createNotificationDraft } from "@/lib/server/notification-draft";
import { notificationDraftsFor } from "@/lib/server/records";

/** What the form shows after a refusal: the reference only. */
export type DraftActionState = { readonly reference: string } | null;

export async function createDraft(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  if (!(await getCurrentSession())) redirect("/sign-in");
  const ctx = await requireRequestContext();
  const outcome = await createNotificationDraft(
    { ctx, drafts: notificationDraftsFor(ctx.correlationId) },
    {
      case_id: formData.get("case_id"),
      template_version_id: formData.get("template_version_id"),
      recipient_class: formData.get("recipient_class"),
      idempotency_key: formData.get("idempotency_key"),
      case_binding: formData.get("case_binding"),
    },
  );
  if (outcome.kind === "created") redirect(createdDraftTarget(outcome));
  return { reference: outcome.correlationId };
}
