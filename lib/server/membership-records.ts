// The application's MembershipReader (V13-FE-008): the V13 adapter bound to withRequestContext with this request's
// correlation id, read once per request (React cache) for the layout and the page together.
import "server-only";
import { cache } from "react";
import type { ConfirmedMembership } from "@/lib/contracts";
import { createV13MembershipReader } from "@/lib/adapters/identity/v13-memberships";
import { withRequestContext } from "@/lib/db/security-context";
import { requireRequestContext } from "./context";
import { loadConfirmedMemberships } from "./memberships";

export const confirmedMembershipsForRequest = cache(async (): Promise<readonly ConfirmedMembership[]> => {
  const ctx = await requireRequestContext();
  const reader = createV13MembershipReader((identity, fn) =>
    withRequestContext(identity, fn, { correlationId: ctx.correlationId }),
  );
  return loadConfirmedMemberships({ ctx, reader });
});
