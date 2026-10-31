// V13 NotificationCenterReader (SQL over DB-015) with a recording transaction stub: values are bound parameters (never
// SQL text), only notifications_page and notifications_count are called, in one transaction; rows are strict; the
// cursor is opaque, carries created_at_cursor verbatim (microseconds kept) and is refused when it does not decode.
import { describe, expect, it } from "vitest";
import {
  CENTER_COLUMNS,
  createV13NotificationCenterReader,
  decodeCenterCursor,
  encodeCenterCursor,
  rowToCenterRow,
  type CenterRow,
} from "@/lib/adapters/notification-records/v13-notification-center";
import { InvalidCursorError as AdapterCursorError } from "@/lib/adapters/case-source/cursor";
import { InvalidCursorError, NOTIFICATION_CENTER_PAGE_MAX, type RequestIdentity } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { SECRETARY } from "./support/identities";

const nid = (i: number) => `0f000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
const cid = (i: number) => `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;

const row = (i: number, extra: Partial<CenterRow> = {}): CenterRow => ({
  notification_id: nid(i),
  case_id: cid(1),
  case_number: "CDF-DEMO-2026-0001",
  case_title_ar: "قضية تجريبية 0001",
  case_title_en: "Demo case 0001",
  template_code: "CF-20_INVESTIGATION_ASSIGNED",
  template_name_ar: "إشعار تكليف بالتحقيق",
  template_name_en: "Investigation assignment",
  template_version: 1,
  language: "ar",
  recipient_class: "WITNESS",
  lifecycle_status: "DRAFT",
  created_at: new Date(`2026-10-${String(10 + i).padStart(2, "0")}T09:00:00.123Z`),
  created_at_cursor: `2026-10-${String(10 + i).padStart(2, "0")}T09:00:00.123456Z`,
  last_event_at: null,
  row_version: 1,
  ...extra,
});

function recorder(pageRows: CenterRow[], ...count: unknown[]) {
  const total = count.length > 0 ? count[0] : pageRows.length;
  const calls: { text: string; values: unknown[]; identity: RequestIdentity }[] = [];
  let transactions = 0;
  const run = async <T>(identity: RequestIdentity, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    transactions += 1;
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("$");
      calls.push({ text, values, identity });
      return Promise.resolve(text.includes("notifications_count") ? [{ total }] : pageRows);
    }) as unknown as Tx;
    return fn(tx);
  };
  return { calls, transactions: () => transactions, reader: createV13NotificationCenterReader(run) };
}

describe("center cursor", () => {
  const position = { at: "2026-10-11T09:00:00.123456Z", id: nid(1) };

  it("round-trips the database's cursor text verbatim, microseconds included", () => {
    const cursor = encodeCenterCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCenterCursor(cursor)).toEqual(position);
    expect(decodeCenterCursor(undefined)).toBeNull();
  });

  it("is one error class with the portfolio cursor (OI-031)", () => {
    expect(AdapterCursorError).toBe(InvalidCursorError);
  });

  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");
  it.each([
    ["not base64url", "a+b/c="],
    ["not JSON", Buffer.from("{", "utf8").toString("base64url")],
    ["an array", b64([1, position.at, position.id])],
    ["another version", b64({ v: 2, at: position.at, id: position.id })],
    ["an extra key", b64({ v: 1, at: position.at, id: position.id, x: 1 })],
    ["a missing id", b64({ v: 1, at: position.at, y: 1 })],
    ["milliseconds only (a JS Date)", b64({ v: 1, at: "2026-10-11T09:00:00.123Z", id: position.id })],
    ["an offset other than Z", b64({ v: 1, at: "2026-10-11T09:00:00.123456+03:00", id: position.id })],
    ["SQL in the instant", b64({ v: 1, at: "2026-10-11'; drop table x; --", id: position.id })],
    ["a non-UUID id", b64({ v: 1, at: position.at, id: "CDF-DEMO-2026-0001" })],
    ["an upper-case UUID", b64({ v: 1, at: position.at, id: nid(1).toUpperCase() })],
  ])("refuses %s", (_n, cursor) => {
    expect(() => decodeCenterCursor(cursor)).toThrow(InvalidCursorError);
  });

  it("refuses to encode a position the database did not produce", () => {
    expect(() => encodeCenterCursor({ at: "2026-10-11T09:00:00Z", id: nid(1) })).toThrow(InvalidCursorError);
    expect(() => encodeCenterCursor({ at: position.at, id: "x" })).toThrow(InvalidCursorError);
  });
});

describe("rowToCenterRow", () => {
  it("maps a row to the contract (bilingual titles and names, ISO instants)", () => {
    expect(rowToCenterRow(row(1, { last_event_at: new Date("2026-10-12T10:00:00Z") }))).toEqual({
      notification_id: nid(1),
      case_id: cid(1),
      case_number: "CDF-DEMO-2026-0001",
      case_title: { ar: "قضية تجريبية 0001", en: "Demo case 0001" },
      template_code: "CF-20_INVESTIGATION_ASSIGNED",
      template_name: { ar: "إشعار تكليف بالتحقيق", en: "Investigation assignment" },
      template_version: 1,
      language: "ar",
      recipient_class: "WITNESS",
      lifecycle_status: "DRAFT",
      created_at: "2026-10-11T09:00:00.123Z",
      last_event_at: "2026-10-12T10:00:00.000Z",
      row_version: 1,
    });
  });

  it("names exactly the sixteen columns of notifications_page", () => {
    expect(CENTER_COLUMNS).toHaveLength(16);
    expect(Object.keys(row(1)).sort()).toEqual([...CENTER_COLUMNS].sort());
  });

  it.each([
    ["an extra column (e.g. a person)", { author_persona_id: "x" } as unknown as Partial<CenterRow>],
    ["an unknown lifecycle status", { lifecycle_status: "DELIVERED" }],
    ["a case number that is not a display number", { case_number: "0001" }],
    ["a non-UUID case id", { case_id: "1" }],
    ["an empty title", { case_title_en: "" }],
    ["a control character in a name", { template_name_en: "a\u0000b" }],
    ["a language outside ar/en", { language: "fr" }],
    ["version 0", { template_version: 0 }],
    ["a cursor text without microseconds", { created_at_cursor: "2026-10-11T09:00:00Z" }],
  ])("refuses %s", (_n, extra) => {
    expect(() => rowToCenterRow(row(1, extra))).toThrow();
  });

  it("refuses a row with a missing column", () => {
    const { last_event_at: _omit, ...rest } = row(1);
    expect(() => rowToCenterRow(rest as CenterRow)).toThrow();
  });
});

describe("listNotifications", () => {
  it("calls only the two invoker read functions, in one transaction, with bound values and limit + 1", async () => {
    const { calls, transactions, reader } = recorder([row(1)], "1");
    await reader.listNotifications(SECRETARY, {
      limit: 25,
      lifecycle_status: "DRAFT",
      template_code: "CF-20_INVESTIGATION_ASSIGNED",
      case_number: "CDF-DEMO-2026-0001",
      created_from: "2026-10-01T00:00:00+03:00",
      created_before: "2026-11-01T00:00:00+03:00",
    });
    expect(transactions()).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.identity === SECRETARY)).toBe(true);
    expect(calls[0]!.text).toContain("cdf_notifications_v13.notifications_page(");
    expect(calls[0]!.values).toEqual([
      null,
      null,
      26,
      "DRAFT",
      "CF-20_INVESTIGATION_ASSIGNED",
      "CDF-DEMO-2026-0001",
      "2026-10-01T00:00:00+03:00",
      "2026-11-01T00:00:00+03:00",
    ]);
    expect(calls[1]!.text).toContain("cdf_notifications_v13.notifications_count(");
    expect(calls[1]!.values).toEqual([
      "DRAFT",
      "CF-20_INVESTIGATION_ASSIGNED",
      "CDF-DEMO-2026-0001",
      "2026-10-01T00:00:00+03:00",
      "2026-11-01T00:00:00+03:00",
    ]);
    for (const c of calls) {
      expect(c.text).not.toMatch(/DRAFT|CF-20|CDF-DEMO|from cdf_notifications_v13\.notification\b/);
    }
  });

  it("passes the decoded cursor as both keyset values", async () => {
    const { calls, reader } = recorder([]);
    const cursor = encodeCenterCursor({ at: "2026-10-11T09:00:00.123456Z", id: nid(1) });
    await reader.listNotifications(SECRETARY, { limit: 25, cursor });
    expect(calls[0]!.values.slice(0, 3)).toEqual(["2026-10-11T09:00:00.123456Z", nid(1), 26]);
  });

  it("returns a next cursor from the last shown row's cursor text when one more row exists", async () => {
    const rows = [row(3), row(2), row(1)];
    const { reader } = recorder(rows, 3);
    const page = await reader.listNotifications(SECRETARY, { limit: 2 });
    expect(page.items.map((n) => n.notification_id)).toEqual([nid(3), nid(2)]);
    expect(page.total).toBe(3);
    expect(decodeCenterCursor(page.next_cursor!)).toEqual({ at: row(2).created_at_cursor, id: nid(2) });
  });

  it("returns no next cursor on the last page and a bigint total as a number", async () => {
    const { reader } = recorder([row(1)], BigInt(1));
    const page = await reader.listNotifications(SECRETARY, { limit: 25 });
    expect(page).toMatchObject({ next_cursor: null, total: 1 });
  });

  it("an empty page has total 0 and no cursor", async () => {
    const { reader } = recorder([], "0");
    expect(await reader.listNotifications(SECRETARY, { limit: 25 })).toEqual({
      items: [],
      next_cursor: null,
      total: 0,
    });
  });

  it("refuses a cursor that does not decode before any SQL runs", async () => {
    const { calls, reader } = recorder([]);
    await expect(
      reader.listNotifications(SECRETARY, { limit: 25, cursor: "bm90LWEtY3Vyc29y" }),
    ).rejects.toThrow(InvalidCursorError);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a limit above the page maximum", { limit: NOTIFICATION_CENTER_PAGE_MAX + 1 }],
    ["limit 0", { limit: 0 }],
    ["an unknown status", { limit: 25, lifecycle_status: "DELIVERED" }],
    ["a case id where a display number belongs", { limit: 25, case_number: cid(1) }],
    ["a date without offset", { limit: 25, created_from: "2026-10-01" }],
    ["an unknown filter", { limit: 25, persona_id: "x" }],
  ])("refuses %s before any SQL runs", async (_n, filter) => {
    const { calls, reader } = recorder([]);
    await expect(reader.listNotifications(SECRETARY, filter as never)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a negative count", -1],
    ["a non-numeric count", "many"],
    ["a missing count", undefined],
  ])("refuses %s", async (_n, total) => {
    const { reader } = recorder([row(1)], total);
    await expect(reader.listNotifications(SECRETARY, { limit: 25 })).rejects.toThrow();
  });

  it("refuses a page larger than its own authorised total", async () => {
    const { reader } = recorder([row(2), row(1)], 1);
    await expect(reader.listNotifications(SECRETARY, { limit: 25 })).rejects.toThrow(/total/);
  });

  it("refuses the whole page when one row is malformed", async () => {
    const { reader } = recorder([row(2), row(1, { lifecycle_status: "DELIVERED" })], 2);
    await expect(reader.listNotifications(SECRETARY, { limit: 25 })).rejects.toThrow();
  });
});
