// BFF error model. Every failure becomes one of a few public codes plus the request's correlation id; the user never
// sees a message, stack, SQL text, constraint or role name (CLAUDE.md §4, SEC-APP-10). Unknown errors are
// UNAVAILABLE. NOT_FOUND covers unknown AND unauthorised targets alike (no existence leak, SEC-APP-01).
import "server-only";
import { logServerError } from "@/lib/http/errors";

export const PUBLIC_ERROR_CODES = [
  "NOT_FOUND",
  "UNAUTHENTICATED",
  "VALIDATION",
  "CONFLICT",
  "UNAVAILABLE",
] as const;
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

export class AppError extends Error {
  override readonly name = "AppError";
  constructor(readonly code: PublicErrorCode) {
    // The message is the code itself: nothing caller-supplied ever reaches it.
    super(code);
  }
}

/** What a Server Action or page may hand to the client on failure. */
export interface UserError {
  readonly code: PublicErrorCode;
  readonly correlationId: string;
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

/**
 * Maps any thrown value to a UserError. AppErrors keep their code; everything else is logged (event, correlation id,
 * error code only) and reported as UNAVAILABLE.
 */
export function toUserError(error: unknown, correlationId: string, event = "bff_error"): UserError {
  if (isAppError(error)) return { code: error.code, correlationId };
  logServerError(event, correlationId, error);
  return { code: "UNAVAILABLE", correlationId };
}
