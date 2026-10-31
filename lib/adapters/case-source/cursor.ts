// Opaque portfolio cursor. The database pages by keyset on display_number (portfolio_page, migration 0002); the
// cursor carries that sort position only. The display number is never used to look a case up: it bounds an
// already-authorised, RLS-filtered query. Anything that does not decode to a well-formed position is refused.
import { CASE_NUMBER_PATTERN } from "@/lib/contracts";

const CURSOR_VERSION = 1;
const BASE64URL = /^[A-Za-z0-9_-]{1,512}$/;

export class InvalidCursorError extends Error {
  override readonly name = "InvalidCursorError";
  readonly code = "INVALID_CURSOR";
}

export function encodeCursor(afterDisplayNumber: string): string {
  if (!CASE_NUMBER_PATTERN.test(afterDisplayNumber)) throw new InvalidCursorError("bad position");
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, after: afterDisplayNumber }), "utf8").toString(
    "base64url",
  );
}

/** The display number to page after, or null for the first page. Throws InvalidCursorError on anything else. */
export function decodeCursor(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  if (!BASE64URL.test(cursor)) throw new InvalidCursorError("bad cursor");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError("bad cursor");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 2 ||
    (value as { v?: unknown }).v !== CURSOR_VERSION ||
    typeof (value as { after?: unknown }).after !== "string" ||
    !CASE_NUMBER_PATTERN.test((value as { after: string }).after)
  ) {
    throw new InvalidCursorError("bad cursor");
  }
  return (value as { after: string }).after;
}
