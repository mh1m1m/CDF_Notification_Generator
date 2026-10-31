/**
 * PRODUCTION_SUBSTITUTION_REQUIRED: in-memory test double
 *
 * sender — stub NotificationSender (W-D1, charter §10).
 * Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * "the prototype adapter is a stub; the CDF mail relay and the corporate directory lookup of the recipient's address are
 * a human decision (ADR-025)" — packages/application/src/ports.ts:433-440.
 *
 * Mirrors the port `NotificationSender { kind: "stub-email"; send(OutgoingNotification): Promise<boolean> }`
 * (packages/application/src/ports.ts:437-440). OutgoingNotification = {id, recipientId, template, deepLink, attempts}
 * (packages/contracts/src/index.ts:1810-1817): "Never case content (§39, N18)". The stub records only those five fields.
 * `outcomes` scripts the results: true (accepted), false (refused), 'THROW' (transport error — the dispatch loop
 * swallows it and never logs it, packages/application/src/notifications.ts:31-35).
 * Ported to strict TypeScript from the V13 reference (src/lifecycle/adapters/sender.js); behaviour unchanged.
 */
import type { NotificationSenderPort, OutgoingNotification } from "@/lib/notifications/lifecycle/ports";

const OUTGOING_KEYS: readonly string[] = ["id", "recipientId", "template", "deepLink", "attempts"];

export type SenderOutcome = boolean | "THROW";

export interface StubSenderOptions {
  outcomes?: readonly SenderOutcome[];
  defaultOutcome?: SenderOutcome;
}

export interface StubSender extends NotificationSenderPort {
  readonly kind: "stub-email";
  calls(): Readonly<OutgoingNotification>[];
}

export function createStubSender({
  outcomes = [],
  defaultOutcome = true,
}: StubSenderOptions = {}): StubSender {
  const calls: Readonly<OutgoingNotification>[] = [];
  let i = 0;
  return Object.freeze({
    kind: "stub-email" as const,
    async send(notification: OutgoingNotification): Promise<boolean> {
      const extra = Object.keys(notification ?? {}).filter((k) => !OUTGOING_KEYS.includes(k));
      if (extra.length)
        throw new TypeError(
          `OutgoingNotification carries no content; unexpected field(s): ${extra.join(", ")}`,
        );
      calls.push(Object.freeze({ ...notification }));
      const outcome = i < outcomes.length ? outcomes[i++] : defaultOutcome;
      if (outcome === "THROW") throw new Error("stub transport error");
      return outcome === true;
    },
    calls: () => [...calls],
  });
}
