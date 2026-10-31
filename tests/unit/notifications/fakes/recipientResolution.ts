/**
 * PRODUCTION_SUBSTITUTION_REQUIRED: in-memory test double
 *
 * recipientResolution — authoritative recipient resolution (mock) (W-D1, charter §2 Domain F, §10).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * In the platform the recipients are selected server-side inside the notification triggers, in the same transaction as
 * the domain write (20261007001920_notification_engine.sql): meeting participants who pass the case gate (:309-312),
 * participants of a cancelled meeting without a meeting conflict (:329-336), minutes reviewers (:356-361, :363-366), the
 * assigned legal reviewer (:384), the subject only through the active portal link (:399-401), grievance secretaries who
 * may handle the grievance (:421-427), the restricted-case owner (:430-433).
 *
 * Rule enforced by the lifecycle (SEC tests): a recipient is never taken from caller input. The caller may only name one
 * of the resolved recipient ids; class and capacity always come from here; addresses and names never appear.
 * Ported to strict TypeScript from the V13 reference (src/lifecycle/adapters/recipientResolution.js); behaviour unchanged.
 * `RECIPIENT_CLASSES` moved to lib/notifications/lifecycle/vocabulary.ts and is re-exported here.
 */
import { deepFreeze, clone, OPAQUE_ID, type DeepReadonly } from "@/lib/notifications/lifecycle/util";
import { RECIPIENT_CLASSES } from "@/lib/notifications/lifecycle/vocabulary";
import type { RecipientResolutionPort, ResolvedRecipient } from "@/lib/notifications/lifecycle/ports";

export { RECIPIENT_CLASSES };

export class RecipientResolutionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RecipientResolutionError";
    this.code = code;
  }
}

export interface RecipientResolution extends RecipientResolutionPort {
  readonly kind: "mock-recipient-resolution";
}

/** @param map keyed `${type_code}:${object_id}` */
export function createRecipientResolution(
  map: Readonly<Record<string, readonly Partial<ResolvedRecipient>[]>> = {},
): RecipientResolution {
  const table = new Map<string, readonly DeepReadonly<ResolvedRecipient>[]>();
  for (const [key, list] of Object.entries(map)) {
    for (const r of list) {
      if (
        typeof r.recipient_id !== "string" ||
        !OPAQUE_ID.test(r.recipient_id) ||
        r.recipient_id.includes("@")
      ) {
        throw new RecipientResolutionError(
          "INVALID_RECIPIENT",
          "recipient ids are opaque ids, never addresses",
        );
      }
      if (!(RECIPIENT_CLASSES as readonly unknown[]).includes(r.class))
        throw new RecipientResolutionError("INVALID_CLASS", "unknown recipient class");
      if (typeof r.capacity !== "string" || !r.capacity)
        throw new RecipientResolutionError("INVALID_CAPACITY", "capacity required");
    }
    table.set(
      key,
      deepFreeze(
        clone(
          (list as readonly ResolvedRecipient[]).map(({ recipient_id, class: cls, capacity }) => ({
            recipient_id,
            class: cls,
            capacity,
          })),
        ),
      ),
    );
  }
  return Object.freeze({
    kind: "mock-recipient-resolution" as const,
    /** The recipients the platform would notify for this type and object (frozen; empty when none). */
    resolve: ({
      type_code,
      object_id,
    }: {
      type_code: string;
      object_id: string;
    }): readonly DeepReadonly<ResolvedRecipient>[] =>
      table.get(`${type_code}:${object_id}`) ?? Object.freeze([]),
  });
}
