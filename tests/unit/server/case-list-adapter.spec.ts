// V13-FE-013 (OI-026): the Case Workspace lists' opaque cursor and the adapters' paging step. The cursor carries
// migration 0011's page_cursor text verbatim, the row id and the list; anything else is InvalidCursorError before any
// read. The paging step asks for limit + 1 rows, keeps limit, issues the next cursor from the last kept row, and refuses
// the whole result for a row of another case or a page_cursor in any other format. Synthetic values only.
import { describe, expect, it, vi } from "vitest";
import { InvalidCursorError, type CaseId } from "@/lib/contracts";
import {
  decodeCaseListCursor,
  encodeCaseListCursor,
  type CaseListKind,
} from "@/lib/adapters/case-list/cursor";
import { readCaseListPage } from "@/lib/adapters/case-list/page";
import { CaseRecordsMismatchError } from "@/lib/adapters/procedural-records/v13-procedural-records";

const ID = "0e000000-0000-4000-8000-000001000001";
const AT: Record<CaseListKind, string> = {
  events: "2026-10-01T08:00:00.123456Z|2026-10-01T08:00:01.000000Z",
  tasks: "2026-10-05|INTAKE_REVIEW",
  myOpenTasks: "-|INTAKE_REVIEW",
  notifications: "2026-10-02T08:00:00.000001Z",
};
const KINDS = ["events", "tasks", "myOpenTasks", "notifications"] as const;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");

describe("case list cursor", () => {
  it.each(KINDS)("%s: round trip of the database's page_cursor text and the row id", (kind) => {
    const c = encodeCaseListCursor(kind, { at: AT[kind], id: ID });
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCaseListCursor(kind, c)).toEqual({ at: AT[kind], id: ID });
    expect(decodeCaseListCursor(kind, undefined)).toBeNull();
  });

  it("a task without a due date uses the database's '-' form", () => {
    const c = encodeCaseListCursor("tasks", { at: "-|INTAKE_REVIEW", id: ID });
    expect(decodeCaseListCursor("tasks", c)).toEqual({ at: "-|INTAKE_REVIEW", id: ID });
  });

  it("refuses to issue a cursor from a malformed position", () => {
    for (const [kind, at, id] of [
      ["events", AT.notifications, ID],
      ["notifications", "2026-10-02T08:00:00.000Z", ID],
      ["tasks", "2026-10-05|intake", ID],
      ["events", AT.events, ID.toUpperCase()],
      ["events", AT.events, "x"],
    ] as const) {
      expect(() => encodeCaseListCursor(kind, { at, id })).toThrow(InvalidCursorError);
    }
  });

  it("a cursor of one list is refused by another", () => {
    for (const from of KINDS)
      for (const to of KINDS.filter((k) => k !== from)) {
        const c = encodeCaseListCursor(from, { at: AT[from], id: ID });
        expect(() => decodeCaseListCursor(to, c), `${from} → ${to}`).toThrow(InvalidCursorError);
      }
  });

  it.each([
    ["not base64url", "abc$"],
    ["empty", ""],
    ["too long", "A".repeat(513)],
    ["not JSON", Buffer.from("{nope", "utf8").toString("base64url")],
    ["an array", b64(["events", AT.events, ID])],
    ["another version", b64({ v: 2, k: "events", at: AT.events, id: ID })],
    ["a missing id", b64({ v: 1, k: "events", at: AT.events })],
    ["an extra field", b64({ v: 1, k: "events", at: AT.events, id: ID, case: ID })],
    ["an upper-case id", b64({ v: 1, k: "events", at: AT.events, id: ID.toUpperCase() })],
    [
      "a millisecond instant",
      b64({ v: 1, k: "events", at: "2026-10-01T08:00:00.123Z|2026-10-01T08:00:01.000Z", id: ID }),
    ],
    ["SQL in the position", b64({ v: 1, k: "events", at: "x' or '1'='1", id: ID })],
  ])("refuses %s", (_n, cursor) => {
    expect(() => decodeCaseListCursor("events", cursor)).toThrow(InvalidCursorError);
  });

  // SEC CHANGES 5254893: cursors that decode to the right values but are not in the form this module issues. Each is
  // refused only by the canonical re-encoding check.
  it.each([
    [
      "its keys reordered",
      (p: Record<string, unknown>) => JSON.stringify({ id: p.id, at: p.at, k: p.k, v: p.v }),
    ],
    ["whitespace in the JSON", (p: Record<string, unknown>) => JSON.stringify(p, null, 1)],
    ["an escaped character", (p: Record<string, unknown>) => JSON.stringify(p).replace('"k"', '"\\u006b"')],
  ])("refuses a non-canonical cursor with %s that still decodes", (_n, text) => {
    const position = { at: AT.events, id: ID };
    const canonical = encodeCaseListCursor("events", position);
    const payload = JSON.parse(Buffer.from(canonical, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const odd = Buffer.from(text(payload), "utf8").toString("base64url");
    expect(odd).not.toBe(canonical);
    // it decodes to the same values…
    expect(JSON.parse(Buffer.from(odd, "base64url").toString("utf8"))).toEqual(payload);
    // …and is refused
    expect(() => decodeCaseListCursor("events", odd)).toThrow(InvalidCursorError);
  });

  it("refuses a valid cursor with a character appended that base64url decoding would skip", () => {
    const c = encodeCaseListCursor("events", { at: AT.events, id: ID });
    expect(() => decodeCaseListCursor("events", `${c}A`)).toThrow(InvalidCursorError);
  });
});

describe("readCaseListPage", () => {
  const CASE = "0c000000-0000-4000-8000-000000000001" as CaseId;
  const OTHER = "0c000000-0000-4000-8000-000000000003";
  const rows = (n: number, caseId: string = CASE) =>
    Array.from({ length: n }, (_, k) => ({
      id: `0e000000-0000-4000-8000-0000010000${String(k).padStart(2, "0")}`,
      case_id: caseId,
      page_cursor: `2026-10-${String(28 - k).padStart(2, "0")}T08:00:00.000000Z`,
    }));
  const run = (available: ReturnType<typeof rows>, page: { limit: number; cursor?: string }) => {
    const read = vi.fn(async (_after: { at: string | null; id: string | null }, limit: number) =>
      available.slice(0, limit),
    );
    return {
      read,
      result: readCaseListPage(
        "notifications",
        CASE,
        page,
        read,
        ({ page_cursor: _c, ...r }) => r,
        (r) => r.id,
      ),
    };
  };

  it("asks for limit + 1 rows, keeps limit and issues the next cursor from the last kept row", async () => {
    const { read, result } = run(rows(5), { limit: 2 });
    const page = await result;
    expect(read).toHaveBeenCalledWith({ at: null, id: null }, 3);
    expect(page.items.map((r) => r.id)).toEqual(rows(2).map((r) => r.id));
    expect(decodeCaseListCursor("notifications", page.next_cursor!)).toEqual({
      at: rows(2)[1]!.page_cursor,
      id: rows(2)[1]!.id,
    });
  });

  it("passes the decoded cursor to the read, and the last page has no next cursor", async () => {
    const cursor = encodeCaseListCursor("notifications", { at: AT.notifications, id: ID });
    const { read, result } = run(rows(2), { limit: 2, cursor });
    const page = await result;
    expect(read).toHaveBeenCalledWith({ at: AT.notifications, id: ID }, 3);
    expect(page.items).toHaveLength(2);
    expect(page.next_cursor).toBeNull();
  });

  it("an empty page (unknown, unauthorised, foreign or stale cursor) has no next cursor", async () => {
    const page = await run([], { limit: 25 }).result;
    expect(page).toEqual({ items: [], next_cursor: null });
  });

  it("a cursor that does not decode is refused before any read", async () => {
    for (const cursor of [
      "AAAA",
      encodeCaseListCursor("events", { at: AT.events, id: ID }),
      b64({ v: 1, k: "notifications", at: AT.notifications }),
    ]) {
      const { read, result } = run(rows(3), { limit: 2, cursor });
      await expect(result).rejects.toThrow(InvalidCursorError);
      expect(read).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["limit 0", { limit: 0 }],
    ["limit 100 (limit + 1 would pass the database's 100)", { limit: 100 }],
    ["a fractional limit", { limit: 2.5 }],
    ["an extra field", { limit: 2, case_id: CASE }],
    ["a cursor with foreign characters", { limit: 2, cursor: "a.b" }],
  ])("refuses a request with %s before any read", async (_n, page) => {
    const { read, result } = run(rows(3), page as never);
    await expect(result).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("a row of another case refuses the whole page", async () => {
    const mixed = [...rows(1), ...rows(1, OTHER)];
    await expect(run(mixed, { limit: 5 }).result).rejects.toThrow(CaseRecordsMismatchError);
  });

  it("a page_cursor in any other format refuses the whole page", async () => {
    const bad = rows(2).map((r, k) => (k === 1 ? { ...r, page_cursor: "2026-10-01T08:00:00Z" } : r));
    await expect(run(bad, { limit: 5 }).result).rejects.toThrow(/bad cursor column/);
  });
});
