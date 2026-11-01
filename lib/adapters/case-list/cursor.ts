// Opaque cursor for the Case Workspace's paged lists (V13-FE-013; DB-019 migration 0011). It carries the database's
// page_cursor text verbatim (fixed-format text, so microseconds survive; a JavaScript Date would drop them) and the
// row's id, both of which case_*_page needs, plus which list it belongs to. base64url JSON {v, k, at, id}. Anything
// that does not decode to exactly that shape, for this list, throws InvalidCursorError before any read. The cursor
// names no case: the database looks the anchor row up in the case asked for, under RLS, so another case's cursor and
// a stale one give an empty page.
import { InvalidCursorError, UuidSchema } from "@/lib/contracts";

export type CaseListKind = "events" | "tasks" | "notifications";

const CURSOR_VERSION = 1;
const BASE64URL = /^[A-Za-z0-9_-]{1,512}$/;
const INSTANT = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z`;
/** page_cursor as migration 0011 formats it, per list (and the only shapes the functions accept). */
export const PAGE_CURSOR: Readonly<Record<CaseListKind, RegExp>> = Object.freeze({
  events: new RegExp(`^${INSTANT}\\|${INSTANT}$`),
  tasks: /^(\d{4}-\d{2}-\d{2}|-)\|[A-Z][A-Z0-9_]{1,63}$/,
  notifications: new RegExp(`^${INSTANT}$`),
});

export interface CaseListPosition {
  /** The row's page_cursor text, verbatim. */
  readonly at: string;
  /** The row's id. */
  readonly id: string;
}

const lowerUuid = (v: unknown): v is string =>
  typeof v === "string" && v === v.toLowerCase() && UuidSchema.safeParse(v).success;

export function encodeCaseListCursor(kind: CaseListKind, position: CaseListPosition): string {
  if (!PAGE_CURSOR[kind].test(position.at) || !lowerUuid(position.id)) {
    throw new InvalidCursorError("bad position");
  }
  return Buffer.from(
    JSON.stringify({ v: CURSOR_VERSION, k: kind, at: position.at, id: position.id }),
    "utf8",
  ).toString("base64url");
}

/** The position to page after, or null for the first page. Throws InvalidCursorError on anything else. */
export function decodeCaseListCursor(
  kind: CaseListKind,
  cursor: string | undefined,
): CaseListPosition | null {
  if (cursor === undefined) return null;
  if (!BASE64URL.test(cursor)) throw new InvalidCursorError("bad cursor");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError("bad cursor");
  }
  // base64url decoding skips foreign characters, so the round trip must give back exactly what was passed.
  if (Buffer.from(JSON.stringify(value), "utf8").toString("base64url") !== cursor) {
    throw new InvalidCursorError("bad cursor");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidCursorError("bad cursor");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 4 ||
    v.v !== CURSOR_VERSION ||
    v.k !== kind ||
    typeof v.at !== "string" ||
    !PAGE_CURSOR[kind].test(v.at) ||
    !lowerUuid(v.id)
  ) {
    throw new InvalidCursorError("bad cursor");
  }
  return { at: v.at, id: v.id };
}
