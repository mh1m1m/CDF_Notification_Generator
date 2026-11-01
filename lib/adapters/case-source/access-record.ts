// The access record of DB-023 (migration 0015): cdf_notifications_v13.api_record_access, called first inside the read's
// own transaction, so the read and its ledger row commit together (V13-FE-017). The command never raises for a refusal:
// it returns one row whose `refusal` is null (recorded, or counted in the 300 s window) or a code. V1401, V1404 and
// V1422 (unknown and unauthorised alike) mean "nothing to show"; anything else (V1500, no row, another shape) is a
// failure the caller must not read past.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production writes the access record to the CDF audit service (SLS/SIEM) through the
// ASP.NET Core API on Alibaba Cloud Riyadh.
import "server-only";
import type { CaseId } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";

/** The refusals that read as "not found" (the command recorded one id-less REFUSED row). */
export const ACCESS_REFUSALS: readonly string[] = Object.freeze(["V1401", "V1404", "V1422"]);

export type AccessKind =
  | { readonly kind: "CASE"; readonly caseId: CaseId }
  | { readonly kind: "NOTIFICATION_PREVIEW"; readonly caseId: CaseId; readonly notificationId: string };

/**
 * Records one access in `tx` (which must not have run another api_* command). True when recorded (or counted), false
 * for a refusal; throws for anything else, so the caller never reads without its record.
 */
export async function recordAccess(tx: Tx, access: AccessKind): Promise<boolean> {
  const notificationId = access.kind === "NOTIFICATION_PREVIEW" ? access.notificationId : null;
  const rows = await tx<{ refusal: string | null }[]>`
    select r.refusal
      from cdf_notifications_v13.api_record_access(${access.kind}, ${access.caseId}::uuid, ${notificationId}::uuid) r`;
  if (rows.length !== 1) throw new Error("access record: unexpected result");
  const keys = Object.keys(rows[0] as object);
  if (keys.length !== 1 || keys[0] !== "refusal") throw new Error("access record: unexpected result");
  const refusal = (rows[0] as { refusal: unknown }).refusal;
  if (refusal === null) return true;
  if (typeof refusal === "string" && ACCESS_REFUSALS.includes(refusal)) return false;
  throw new Error("access record: not recorded");
}
