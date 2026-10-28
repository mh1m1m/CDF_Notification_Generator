// Server-side error reporting for route handlers and actions: one structured line with a correlation id and an error
// code, never the message, stack, SQL text or connection details (CLAUDE.md §4).
import "server-only";

/** A short, non-sensitive code for an error: its `code` property when it looks like one (e.g. SQLSTATE), else its name. */
export function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(name)) return name;
  }
  return "UNKNOWN";
}

/** Logs `{event, correlation_id, code}` to stderr. */
export function logServerError(event: string, correlationId: string, error: unknown): void {
  console.error(JSON.stringify({ event, correlation_id: correlationId, code: errorCode(error) }));
}
