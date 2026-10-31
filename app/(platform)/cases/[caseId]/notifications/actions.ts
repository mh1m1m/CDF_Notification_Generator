"use server";
// Notification draft (V13-FE-006, Scenario E). A short Server Action form: session → request context → lib/server
// (pre-check, Zod parse, database command). The redirect carries only an outcome flag with a notification id the
// persona just created or a correlation id; never a template, a recipient or a database message.
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/server-session";
import { requireRequestContext } from "@/lib/server/context";
import { createNotificationDraft, draftRedirectTarget } from "@/lib/server/notification-draft";
import { notificationDraftsFor } from "@/lib/server/records";

export async function createDraft(formData: FormData): Promise<void> {
  if (!(await getCurrentSession())) redirect("/sign-in");
  const ctx = await requireRequestContext();
  const outcome = await createNotificationDraft(
    { ctx, drafts: notificationDraftsFor(ctx.correlationId) },
    {
      case_id: formData.get("case_id"),
      template_version_id: formData.get("template_version_id"),
      recipient_class: formData.get("recipient_class"),
      idempotency_key: formData.get("idempotency_key"),
    },
  );
  redirect(draftRedirectTarget(outcome));
}
