"use server";
// Task status update (FE-005, SCREENS S1). A short Server Action form: session → request context → lib/server
// (pre-check, Zod parse, database command). The redirect carries only an outcome flag, a task id the persona just
// updated, or the correlation id; never a status, a case or a database message.
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/server-session";
import { requireRequestContext } from "@/lib/server/context";
import { myWorkFor } from "@/lib/server/my-work-binding";
import { updateMyTaskStatus } from "@/lib/server/my-work";

export async function updateTaskStatus(formData: FormData): Promise<void> {
  if (!(await getCurrentSession())) redirect("/sign-in");
  const ctx = await requireRequestContext();
  const outcome = await updateMyTaskStatus(
    { ctx, command: myWorkFor(ctx.correlationId) },
    {
      task_id: formData.get("task_id"),
      new_status: formData.get("new_status"),
      expected_version: formData.get("expected_version"),
    },
  );
  const target =
    outcome.kind === "updated"
      ? `/my-work?updated=${outcome.taskId}`
      : outcome.kind === "stale"
        ? `/my-work?stale=${outcome.correlationId}`
        : `/my-work?ref=${outcome.correlationId}`;
  redirect(target);
}
