// V13-records CaseSourceAdapter (SQL) with a recording transaction stub: values are bound parameters (never SQL text), only
// the invoker read functions are called, rows are validated against CaseSummary, cursors are opaque and checked.
import { describe, expect, it } from "vitest";
import {
  createV13RecordsCaseSource,
  rowToCaseSummary,
  type CaseRow,
} from "@/lib/adapters/case-source/v13-records";
import { decodeCursor, encodeCursor, InvalidCursorError } from "@/lib/adapters/case-source/cursor";
import type { CaseId, RequestIdentity } from "@/lib/contracts";
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

describe("listCases", () => {
  it("calls portfolio_page with bound values, inside the identity's context", async () => {
    const { calls, adapter } = recorder([row(1), row(3)]);
    const page = await adapter.listCases(SECRETARY, { limit: 25, text: "x'); drop table t; --" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.identity).toBe(SECRETARY);
    expect(call.text).toMatch(/cdf_notifications_v13\.portfolio_page\(/);
    expect(call.text).not.toContain("drop table");
    expect(call.values).toEqual([null, 26, null, null, "x'); drop table t; --"]);
    expect(page.items.map((c) => c.case_number)).toEqual(["CDF-DEMO-2026-0001", "CDF-DEMO-2026-0003"]);
    expect(page.next_cursor).toBeNull();
  });

  it("returns an opaque next cursor only when an extra row exists", async () => {
    const { calls, adapter } = recorder([row(1), row(2), row(3)]);
    const page = await adapter.listCases(SECRETARY, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.next_cursor).not.toContain("CDF-DEMO");
    expect(decodeCursor(page.next_cursor ?? undefined)).toBe("CDF-DEMO-2026-0002");
    await adapter.listCases(SECRETARY, { limit: 2, cursor: page.next_cursor ?? undefined });
    expect(calls[1]?.values[0]).toBe("CDF-DEMO-2026-0002");
  });

  it("refuses the whole page when any row breaks the contract", async () => {
    const { adapter } = recorder([row(1), row(2, { display_number: "CASE-1" })]);
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
    });
  });

  it.each([
    ["missing updated_at", { updated_at: null }],
    ["missing source_ref", { source_ref: null }],
    ["missing source_system", { source_system: null }],
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
