// Request context for BFF services: the verified session, its RequestIdentity and one correlation id per request.
// Every service and every state-changing Server Action starts here (SEC-APP-18, TM-E4): no session → UNAUTHENTICATED,
// whatever proxy.ts did before.
import "server-only";
import { cache } from "react";
import { CorrelationIdSchema, type CorrelationId, type RequestIdentity } from "@/lib/contracts";
import { getCurrentSession } from "@/lib/auth/server-session";
import type { Session } from "@/lib/auth/session";
import { AppError } from "./errors";

export interface RequestContext {
  readonly session: Session;
  readonly identity: RequestIdentity;
  readonly correlationId: CorrelationId;
}

/** One correlation id per request render or action invocation. */
export const requestCorrelationId = cache((): CorrelationId =>
  CorrelationIdSchema.parse(crypto.randomUUID()),
);

/** Builds a context from a session (pure; exported for tests). */
export function contextFromSession(session: Session | null, correlationId: CorrelationId): RequestContext {
  if (!session) throw new AppError("UNAUTHENTICATED");
  return { session, identity: session.identity, correlationId };
}

/** The current request's context, or throws AppError("UNAUTHENTICATED"). */
export async function requireRequestContext(): Promise<RequestContext> {
  return contextFromSession(await getCurrentSession(), requestCorrelationId());
}
