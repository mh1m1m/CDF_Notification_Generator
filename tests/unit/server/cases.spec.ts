// FE-001 case read services against the fake adapter: unknown = unauthorised (one NOT_FOUND), counts after
// authorisation, input validation. The V13-records adapter is covered in v13-records-adapter.spec.ts and integration.
import { describe, expect, it } from "vitest";
import type { CaseSourceAdapter, CaseSummary } from "@/lib/contracts";
import { InvalidCursorError } from "@/lib/adapters/case-source/cursor";
import { getCaseForRoute, listPortfolio } from "@/lib/server/cases";
import { AppError } from "@/lib/server/errors";
import { caseIdOf, createFakeCaseSource, FAKE_CASES } from "./support/fake-case-source";
import {
  ctxFor,
  GOVERNANCE,
  GOVERNANCE_AT_SECRETARIAT,
  INVESTIGATOR_BETA,
  INVESTIGATOR_GAMMA,
  SECRETARY,
} from "./support/identities";

const notFound = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe("NOT_FOUND");
  expect((error as AppError).message).toBe("NOT_FOUND");
  return error as AppError;
};

describe("getCaseForRoute", () => {
  it("returns a visible case, including the closed one", async () => {
    const source = createFakeCaseSource();
    const c1 = await getCaseForRoute({ ctx: ctxFor(SECRETARY), source }, caseIdOf(1));
    expect(c1.case_number).toBe("CDF-DEMO-2026-0001");
    const c10 = await getCaseForRoute({ ctx: ctxFor(SECRETARY), source }, caseIdOf(10));
    expect(c10.records_state).toBe("CLOSED");
  });

  it("restricted 0009: the assigned investigator sees it; colleague, secretary and governance get NOT_FOUND", async () => {
    const source = createFakeCaseSource();
    expect(
      (await getCaseForRoute({ ctx: ctxFor(INVESTIGATOR_BETA), source }, caseIdOf(9))).is_restricted,
    ).toBe(true);
    for (const who of [INVESTIGATOR_GAMMA, SECRETARY, GOVERNANCE, GOVERNANCE_AT_SECRETARIAT]) {
      await notFound(getCaseForRoute({ ctx: ctxFor(who), source }, caseIdOf(9)));
    }
  });

  it("unknown, other-workspace, restricted and malformed ids all produce the identical error", async () => {
    const source = createFakeCaseSource();
    const ctx = ctxFor(SECRETARY);
    const errors = [
      await notFound(getCaseForRoute({ ctx, source }, "0c000000-0000-4000-8000-0000000000ff")), // unknown
      await notFound(getCaseForRoute({ ctx, source }, caseIdOf(2))), // other workspace only
      await notFound(getCaseForRoute({ ctx, source }, caseIdOf(9))), // restricted
      await notFound(getCaseForRoute({ ctx, source }, "CDF-DEMO-2026-0001")), // display number
      await notFound(getCaseForRoute({ ctx, source }, "not-a-uuid")),
      await notFound(getCaseForRoute({ ctx, source }, undefined)),
    ];
    const shapes = errors.map((e) => JSON.stringify({ name: e.name, code: e.code, message: e.message }));
    expect(new Set(shapes).size).toBe(1);
  });

  it("never asks the source for malformed ids", async () => {
    const source = createFakeCaseSource();
    await notFound(getCaseForRoute({ ctx: ctxFor(SECRETARY), source }, "CDF-DEMO-2026-0001"));
    expect(source.calls).toEqual([]);
  });

  it("refuses an adapter answer for another case (defence in depth)", async () => {
    const wrong: CaseSourceAdapter = {
      sourceSystem: "V13_SYNTHETIC",
      listCases: async () => ({ items: [], next_cursor: null, total: 0 }),
      getCase: async () => FAKE_CASES[1] as CaseSummary,
      getCaseHeader: async () => ({ ...(FAKE_CASES[1] as CaseSummary), my_capacity: null }),
    };
    await notFound(getCaseForRoute({ ctx: ctxFor(SECRETARY), source: wrong }, caseIdOf(1)));
  });

  it("propagates source failures (mapped to UNAVAILABLE by toUserError, not to NOT_FOUND)", async () => {
    const broken: CaseSourceAdapter = {
      sourceSystem: "V13_SYNTHETIC",
      listCases: async () => {
        throw new Error("boom");
      },
      getCase: async () => {
        throw new Error("boom");
      },
      getCaseHeader: async () => {
        throw new Error("boom");
      },
    };
    await expect(getCaseForRoute({ ctx: ctxFor(SECRETARY), source: broken }, caseIdOf(1))).rejects.toThrow(
      "boom",
    );
  });
});

describe("listPortfolio", () => {
  it.each([
    ["Secretary Alpha", SECRETARY, 7],
    ["Investigator Beta", INVESTIGATOR_BETA, 7],
    ["Investigator Gamma", INVESTIGATOR_GAMMA, 6],
    ["Governance Delta @ Governance", GOVERNANCE, 7],
    ["Governance Delta @ Secretariat", GOVERNANCE_AT_SECRETARIAT, 7],
  ])("%s sees exactly the seed visibility (%i cases)", async (_n, who, count) => {
    const page = await listPortfolio({ ctx: ctxFor(who), source: createFakeCaseSource() }, { limit: 50 });
    expect(page.items).toHaveLength(count);
    expect(page.next_cursor).toBeNull();
  });

  it("restricted 0009 is absent for everyone but the assigned investigator", async () => {
    for (const who of [SECRETARY, INVESTIGATOR_GAMMA, GOVERNANCE]) {
      const page = await listPortfolio({ ctx: ctxFor(who), source: createFakeCaseSource() }, { limit: 50 });
      expect(page.items.map((c) => c.case_number)).not.toContain("CDF-DEMO-2026-0009");
    }
  });

  it("pages with a cursor", async () => {
    const source = createFakeCaseSource();
    const ctx = ctxFor(SECRETARY);
    const first = await listPortfolio({ ctx, source }, { limit: 5 });
    expect(first.items).toHaveLength(5);
    const second = await listPortfolio({ ctx, source }, { limit: 5, cursor: first.next_cursor ?? undefined });
    expect(second.items).toHaveLength(2);
    expect(second.next_cursor).toBeNull();
  });

  it.each([
    ["limit above 100", { limit: 101 }],
    ["limit 0", { limit: 0 }],
    ["unknown field (mass assignment)", { persona_id: "x" }],
    ["records state not in the set", { records_state: "DELETED" }],
    ["control characters in text", { text: "a\u0000b" }],
    ["not an object", "limit=5"],
  ])("refuses %s with VALIDATION and no source call", async (_n, filter) => {
    const source = createFakeCaseSource();
    const error = await listPortfolio({ ctx: ctxFor(SECRETARY), source }, filter).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION");
    expect(source.calls).toEqual([]);
  });

  it("maps an invalid cursor from the adapter to VALIDATION", async () => {
    const source: CaseSourceAdapter = {
      sourceSystem: "V13_SYNTHETIC",
      listCases: async () => {
        throw new InvalidCursorError("bad cursor");
      },
      getCase: async () => null,
      getCaseHeader: async () => null,
    };
    const error = await listPortfolio({ ctx: ctxFor(SECRETARY), source }, { cursor: "zz" }).catch(
      (e: unknown) => e,
    );
    expect((error as AppError).code).toBe("VALIDATION");
  });
});
