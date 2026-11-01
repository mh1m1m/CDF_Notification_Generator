// V13-DB-021 (migration 0013): helpers for suites that assert a command's refusal.
//
// Since 0013 the three request-time commands answer a refusal in their `refusal` column and the transaction commits one
// COMMAND_REFUSED audit row, at most one per (persona or none, command, code) per 60 s window (refusal_window).
// Integration files run one at a time (vitest.config.ts), but a window opened by an earlier file would suppress the
// row a later file expects, so a suite that asserts the row clears the windows first, as the administrator.
import type postgres from "postgres";
import type { Tx } from "@/lib/db/security-context";

/** Deletes every refusal window (committed, administrator connection). Test clusters only. */
export async function clearRefusalWindows(admin: postgres.Sql | Tx): Promise<void> {
  await admin`delete from cdf_notifications_v13.refusal_window`;
}

/**
 * The outcome of a command call: its `refusal` value when the single row carries one, "OK" for a single row without
 * one, the SQLSTATE when it raised, "UNKNOWN" otherwise.
 */
export async function outcomeOf(promise: Promise<unknown>): Promise<string> {
  try {
    const rows = (await promise) as readonly Record<string, unknown>[] | undefined;
    if (Array.isArray(rows) && rows.length === 1 && typeof rows[0]?.refusal === "string")
      return rows[0].refusal;
    return "OK";
  } catch (error) {
    return String((error as { code?: unknown }).code ?? "UNKNOWN");
  }
}

/**
 * Fixture write for a suite that needs several drafts in one transaction, which the commands refuse since 0013 (one
 * api_* call per transaction, V13-DB-021 R1). Runs the draft command's body (_api_create_notification_draft_impl) as the
 * administrator under the transaction's current verified claims, then returns to cdf_v13_user. The body's checks and
 * audit row are the command's own; only the one-command mark is not taken. Administrator connections only: the request
 * role cannot execute the body (R3).
 */
export async function draftFixture(
  tx: Tx,
  caseId: string,
  templateVersionId: string,
  recipientClass: string,
  idempotencyKey: string,
): Promise<{ notification_id: string }[]> {
  await tx`reset role`;
  const rows = await tx<{ notification_id: string }[]>`
    select notification_id from cdf_notifications_v13._api_create_notification_draft_impl(
      ${caseId}::uuid, ${templateVersionId}::uuid, ${recipientClass}, ${idempotencyKey})`;
  await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
  return [...rows];
}
