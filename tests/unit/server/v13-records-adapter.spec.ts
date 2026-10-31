// V13-records CaseSourceAdapter (SQL) with a recording transaction stub: values are bound parameters (never SQL text), only
// the invoker read functions are called, rows are validated against CaseSummary, cursors are opaque and checked.
import { describe, expect, it } from "vitest";
import {
  createV13RecordsCaseSource,
  rowToCaseSummary,
  type CaseRow,
} from "@/lib/adapters/case-source/v13-records";
import { decodeCursor, encodeCursor, InvalidCursorError } from "@/lib/adapters/case-source/cursor";
import {
  PORTFOLIO_DB_ROW_BOUND,
  PORTFOLIO_PAGE_MAX,
  type CaseId,
  type RequestIdentity,
} from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { SECRETARY } from "./support/identities";

const row = (i: number, extra: Partial<CaseRow> = {}): CaseRow => ({
  id: `0c000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
  display_number: `CDF-DEMO-2026-${String(i).padStart(4, "0")}`,
  title_ar: `قضية تجريبية ${i}`,
  title_en: `Demo case ${i}`,
  stage: "INVESTIGATION",
  is_restricted: false,
  records_state: "ACTIVE",
  source_system: "V13_SYNTHETIC",
  source_ref: `demo-${i}`,
  updated_at: new Date("2026-10-28T00:00:00Z"),
  ...extra,
});

function recorder(rows: CaseRow[]) {
  const calls: { text: string; values: unknown[]; identity: RequestIdentity }[] = [];
  const run = async <T>(identity: RequestIdentity, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("$"), values, identity });
      return Promise.resolve(rows);
    }) as unknown as Tx;
    return fn(tx);
  };
  return { calls, adapter: createV13RecordsCaseSource(run) };
}

/** Rows as the joined portfolio statement returns them: the total on every row, one null row for an empty page. */
const counted = (total: number | string, rows: CaseRow[]): CaseRow[] =>
  rows.length === 0
    ? [{ total, id: null } as unknown as CaseRow]
    : rows.map(
        (r) =>
          ({
            last_event_id: null,
            last_event_at: null,
            my_open_task_count: 0,
            ...r,
            total,
          }) as unknown as CaseRow,
      );

describe("listCases", () => {
  it("calls portfolio_count and portfolio_page in one statement with bound values, inside the identity's context", async () => {
    const { calls, adapter } = recorder(counted("2", [row(1), row(3)]));
    const page = await adapter.listCases(SECRETARY, { limit: 25, text: "x'); drop table t; --" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.identity).toBe(SECRETARY);
    expect(call.text).toMatch(/cdf_notifications_v13\.portfolio_count\(/);
    expect(call.text).toMatch(/cdf_notifications_v13\.portfolio_page\(/);
    expect(call.text).not.toContain("drop table");
    const text = "x'); drop table t; --";
    expect(call.values).toEqual([null, null, text, false, null, 26, null, null, text, false]);
    expect(page.items.map((c) => c.case_number)).toEqual(["CDF-DEMO-2026-0001", "CDF-DEMO-2026-0003"]);
    expect(page.next_cursor).toBeNull();
    expect(page.total).toBe(2);
  });

  it("passes the same filters to the count and to the page", async () => {
    const { calls, adapter } = recorder(counted(1, [row(10, { records_state: "CLOSED", stage: "CLOSURE" })]));
    await adapter.listCases(SECRETARY, {
      lifecycle_stage: "CLOSURE",
      records_state: "CLOSED",
      text: "0010",
      assigned_to_me: true,
    });
    expect(calls[0]?.values).toEqual([
      "CLOSURE",
      "CLOSED",
      "0010",
      true,
      null,
      26,
      "CLOSURE",
      "CLOSED",
      "0010",
      true,
    ]);
  });

  it("returns an empty page with its total when no case matches", async () => {
    const { adapter } = recorder(counted("0", []));
    const page = await adapter.listCases(SECRETARY, { text: "nothing" });
    expect(page).toEqual({ items: [], next_cursor: null, total: 0 });
  });

  it("keeps the total of all matching cases on a later page", async () => {
    const { adapter } = recorder(counted(7, [row(6), row(7)]));
    const page = await adapter.listCases(SECRETARY, { limit: 5, cursor: encodeCursor("CDF-DEMO-2026-0005") });
    expect(page.total).toBe(7);
  });

  it.each([
    ["negative", -1],
    ["not a number", "many"],
    ["fractional", 1.5],
    ["missing", undefined],
  ])("refuses a %s total", async (_n, total) => {
    const { adapter } = recorder(counted(total as number, [row(1)]));
    await expect(adapter.listCases(SECRETARY, {})).rejects.toThrow();
  });

  it("maps the row summaries: last recorded event and own open tasks", async () => {
    const { adapter } = recorder(
      counted(2, [
        row(1, {
          last_event_id: "0e000000-0000-4000-8000-000000000001",
          last_event_at: new Date("2026-10-01T09:00:00Z"),
          my_open_task_count: 2,
        } as Partial<CaseRow>),
        row(5),
      ]),
    );
    const page = await adapter.listCases(SECRETARY, {});
    expect(page.items[0]).toMatchObject({
      last_event_id: "0e000000-0000-4000-8000-000000000001",
      last_event_at: "2026-10-01T09:00:00.000Z",
      my_open_task_count: 2,
    });
    expect(page.items[1]).toMatchObject({ last_event_id: null, last_event_at: null, my_open_task_count: 0 });
  });

  it.each([
    ["no open-task count (older read function)", { my_open_task_count: null }],
    ["a negative open-task count", { my_open_task_count: -1 }],
    ["an event id without its time", { last_event_id: "0e000000-0000-4000-8000-000000000001" }],
  ])("refuses the page when a row has %s", async (_n, extra) => {
    const { adapter } = recorder(counted(1, [row(1, extra as Partial<CaseRow>)]));
    await expect(adapter.listCases(SECRETARY, {})).rejects.toThrow();
  });

  it("refuses a page larger than its authorised total", async () => {
    const { adapter } = recorder(counted(1, [row(1), row(2)]));
    await expect(adapter.listCases(SECRETARY, {})).rejects.toThrow();
  });

  it("returns an opaque next cursor only when an extra row exists", async () => {
    const { calls, adapter } = recorder(counted(3, [row(1), row(2), row(3)]));
    const page = await adapter.listCases(SECRETARY, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.next_cursor).not.toContain("CDF-DEMO");
    expect(decodeCursor(page.next_cursor ?? undefined)).toBe("CDF-DEMO-2026-0002");
    await adapter.listCases(SECRETARY, { limit: 2, cursor: page.next_cursor ?? undefined });
    expect(calls[1]?.values[4]).toBe("CDF-DEMO-2026-0002");
  });

  it("at the largest page size the look-ahead row stays inside the database bound and still offers a next page", async () => {
    const rows = Array.from({ length: PORTFOLIO_DB_ROW_BOUND }, (_, k) => row(k + 1));
    const { calls, adapter } = recorder(counted(150, rows));
    const page = await adapter.listCases(SECRETARY, { limit: PORTFOLIO_PAGE_MAX });
    expect(calls[0]?.values[5]).toBe(PORTFOLIO_DB_ROW_BOUND);
    expect(page.items).toHaveLength(PORTFOLIO_PAGE_MAX);
    expect(decodeCursor(page.next_cursor ?? undefined)).toBe("CDF-DEMO-2026-0099");
    await expect(adapter.listCases(SECRETARY, { limit: PORTFOLIO_DB_ROW_BOUND })).rejects.toThrow();
  });

  it("refuses the whole page when any row breaks the contract", async () => {
    const { adapter } = recorder(counted(2, [row(1), row(2, { display_number: "CASE-1" })]));
    await expect(adapter.listCases(SECRETARY, {})).rejects.toThrow();
  });

  it("refuses a tampered cursor before any SQL", async () => {
    const { calls, adapter } = recorder([]);
    await expect(adapter.listCases(SECRETARY, { cursor: "not!base64" })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("getCase", () => {
  it("calls case_header with the id bound and maps the row", async () => {
    const { calls, adapter } = recorder([row(4)]);
    const c = await adapter.getCase(SECRETARY, row(4).id as CaseId);
    expect(calls[0]?.text).toMatch(/cdf_notifications_v13\.case_header\(/);
    expect(calls[0]?.values).toEqual([row(4).id]);
    expect(c?.case_number).toBe("CDF-DEMO-2026-0004");
  });

  it("returns null when the database returns no row (unknown and unauthorised alike)", async () => {
    const { adapter } = recorder([]);
    expect(await adapter.getCase(SECRETARY, row(4).id as CaseId)).toBeNull();
  });
});

describe("rowToCaseSummary", () => {
  it("maps a full row and serialises dates", () => {
    expect(rowToCaseSummary(row(10, { records_state: "CLOSED" }))).toMatchObject({
      case_id: row(10).id,
      records_state: "CLOSED",
      updated_at: "2026-10-28T00:00:00.000Z",
      source_system: "V13_SYNTHETIC",
      synthetic_title: { ar: "قضية تجريبية 10", en: "Demo case 10" },
      title_key: null,
    });
  });

  it.each([
    ["missing updated_at", { updated_at: null }],
    ["missing source_ref", { source_ref: null }],
    ["missing source_system", { source_system: null }],
    ["source_ref the database would refuse", { source_ref: "has space" }],
    ["missing English title", { title_en: "" }],
    ["bad uuid", { id: "1" }],
    ["unknown records state", { records_state: "DELETED" }],
  ])("refuses a row with %s", (_n, extra) => {
    expect(() => rowToCaseSummary(row(1, extra as Partial<CaseRow>))).toThrow();
  });
});

describe("cursor", () => {
  it("round-trips a display number", () => {
    expect(decodeCursor(encodeCursor("CDF-DEMO-2026-0007"))).toBe("CDF-DEMO-2026-0007");
    expect(decodeCursor(undefined)).toBeNull();
  });

  it.each([
    ["not base64url", "a b"],
    ["empty json", Buffer.from("{}").toString("base64url")],
    [
      "wrong version",
      Buffer.from(JSON.stringify({ v: 2, after: "CDF-DEMO-2026-0001" })).toString("base64url"),
    ],
    [
      "extra key",
      Buffer.from(JSON.stringify({ v: 1, after: "CDF-DEMO-2026-0001", x: 1 })).toString("base64url"),
    ],
    ["sql in position", Buffer.from(JSON.stringify({ v: 1, after: "' or 1=1" })).toString("base64url")],
    ["not json", Buffer.from("abc").toString("base64url")],
    ["too long", "a".repeat(513)],
  ])("refuses %s", (_n, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
  });

  it("refuses to encode anything but a display number", () => {
    expect(() => encodeCursor("x")).toThrow(InvalidCursorError);
  });
});
