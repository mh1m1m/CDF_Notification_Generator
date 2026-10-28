// Contracts: identifiers, case summaries, list filters, request identity, audit events and the case source port.
import { describe, expect, it } from "vitest";
import {
  AuditEventSchema,
  CASE_NUMBER_PATTERN,
  CaseIdSchema,
  CaseListFilterSchema,
  CaseSummarySchema,
  I18N_KEY_PATTERN,
  RequestIdentitySchema,
  UUID_PATTERN,
  type CaseId,
  type CaseListFilter,
  type CaseListPage,
  type CaseSourceAdapter,
  type CaseSummary,
  type RequestIdentity,
} from "@/lib/contracts";

const CASE_ID = "0c000000-0000-4000-8000-000000000001";

const summary = (overrides: Partial<Record<keyof CaseSummary, unknown>> = {}) => ({
  case_id: CASE_ID,
  case_number: "CDF-DEMO-2026-0001",
  title_key: "case.title.demoProceduralBreach",
  synthetic_title: null,
  lifecycle_stage: "INVESTIGATION",
  is_restricted: false,
  records_state: "ACTIVE",
  source_system: "V13_SYNTHETIC",
  source_ref: "demo-0001",
  updated_at: "2026-10-01T09:00:00Z",
  ...overrides,
});

describe("identifiers", () => {
  it("accepts canonical lowercase UUIDs (including the readable seed ids)", () => {
    for (const id of [CASE_ID, "0b000000-0000-4000-8000-000000000006", crypto.randomUUID()]) {
      expect(UUID_PATTERN.test(id)).toBe(true);
      expect(CaseIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("rejects the nil UUID, upper case, other variants and non-UUID text", () => {
    for (const id of [
      "00000000-0000-0000-0000-000000000000",
      CASE_ID.toUpperCase(),
      "0c000000-0000-4000-c000-000000000001",
      "CDF-DEMO-2026-0001",
      `${CASE_ID} `,
      "",
    ]) {
      expect(CaseIdSchema.safeParse(id).success, id).toBe(false);
    }
  });
});

describe("CaseSummarySchema", () => {
  it("accepts a synthetic summary with a title key", () => {
    expect(CaseSummarySchema.parse(summary()).case_number).toBe("CDF-DEMO-2026-0001");
  });

  it("accepts a synthetic free-text title instead of a key", () => {
    expect(
      CaseSummarySchema.safeParse(summary({ title_key: null, synthetic_title: "Demo case 0001" })).success,
    ).toBe(true);
  });

  it("requires exactly one of title_key and synthetic_title", () => {
    expect(CaseSummarySchema.safeParse(summary({ synthetic_title: "Demo case" })).success).toBe(false);
    expect(CaseSummarySchema.safeParse(summary({ title_key: null })).success).toBe(false);
  });

  it("rejects non-synthetic case numbers, bad codes, control characters and unknown fields", () => {
    expect(CASE_NUMBER_PATTERN.test("CDF-2026-0001")).toBe(false);
    expect(CaseSummarySchema.safeParse(summary({ case_number: "CDF-2026-0001" })).success).toBe(false);
    expect(CaseSummarySchema.safeParse(summary({ lifecycle_stage: "investigation" })).success).toBe(false);
    expect(
      CaseSummarySchema.safeParse(summary({ title_key: null, synthetic_title: "line\u0000break" })).success,
    ).toBe(false);
    expect(CaseSummarySchema.safeParse({ ...summary(), narrative: "x" }).success).toBe(false);
    expect(CaseSummarySchema.safeParse(summary({ updated_at: "yesterday" })).success).toBe(false);
  });

  it("uses i18n keys of the form <namespace>.<key>", () => {
    expect(I18N_KEY_PATTERN.test("case.title.demo")).toBe(true);
    for (const bad of ["case", "Case.title", "case..title", "case.title-x", "case.Title"]) {
      expect(I18N_KEY_PATTERN.test(bad), bad).toBe(false);
    }
  });
});

describe("CaseListFilterSchema", () => {
  it("defaults the page size and bounds it", () => {
    expect(CaseListFilterSchema.parse({}).limit).toBe(25);
    expect(CaseListFilterSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(CaseListFilterSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("rejects unknown filters and over-long text", () => {
    expect(CaseListFilterSchema.safeParse({ workspace: "GOVERNANCE" }).success).toBe(false);
    expect(CaseListFilterSchema.safeParse({ text: "x".repeat(101) }).success).toBe(false);
  });
});

describe("RequestIdentitySchema", () => {
  const identity = {
    persona_id: "0b000000-0000-4000-8000-000000000001",
    active_workspace: "SECRETARIAT",
    roles: ["COMMITTEE_SECRETARY"],
  };

  it("accepts a verified identity", () => {
    expect(RequestIdentitySchema.parse(identity).active_workspace).toBe("SECRETARIAT");
  });

  it("rejects no roles, duplicate roles, unknown roles, unknown workspaces and extra fields", () => {
    expect(RequestIdentitySchema.safeParse({ ...identity, roles: [] }).success).toBe(false);
    expect(
      RequestIdentitySchema.safeParse({ ...identity, roles: ["COMMITTEE_SECRETARY", "COMMITTEE_SECRETARY"] })
        .success,
    ).toBe(false);
    expect(RequestIdentitySchema.safeParse({ ...identity, roles: ["PLATFORM_ADMIN"] }).success).toBe(false);
    expect(RequestIdentitySchema.safeParse({ ...identity, active_workspace: "FINANCE" }).success).toBe(false);
    expect(RequestIdentitySchema.safeParse({ ...identity, is_admin: true }).success).toBe(false);
  });
});

describe("AuditEventSchema (shaped like cdf_notifications_v13.audit_event)", () => {
  const event = {
    event_id: crypto.randomUUID(),
    occurred_at: "2026-10-28T10:00:00Z",
    correlation_id: crypto.randomUUID(),
    actor_persona_id: "0b000000-0000-4000-8000-000000000002",
    workspace_id: "0a000000-0000-4000-8000-000000000002",
    action: "CASE_VIEWED",
    entity_type: "case_record",
    entity_id: CASE_ID,
    case_id: CASE_ID,
    metadata: { stage: "INVESTIGATION", attempt: 1 },
  };

  it("accepts ids, codes and small metadata", () => {
    expect(AuditEventSchema.parse(event).action).toBe("CASE_VIEWED");
    expect(AuditEventSchema.parse({ ...event, metadata: undefined }).metadata).toEqual({});
  });

  it("rejects ledger-incompatible actions, entity types and oversized or nested metadata", () => {
    expect(AuditEventSchema.safeParse({ ...event, action: "case.view" }).success).toBe(false);
    expect(AuditEventSchema.safeParse({ ...event, entity_type: "Case" }).success).toBe(false);
    expect(AuditEventSchema.safeParse({ ...event, metadata: { note: { nested: true } } }).success).toBe(
      false,
    );
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
    expect(AuditEventSchema.safeParse({ ...event, metadata: many }).success).toBe(false);
    const big = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, "x".repeat(200)]));
    expect(AuditEventSchema.safeParse({ ...event, metadata: big }).success).toBe(false);
  });
});

describe("CaseSourceAdapter contract", () => {
  // A minimal in-memory adapter honouring the contract: authorisation before filtering, null for unknown and for
  // unauthorised ids alike, no total count.
  const visible = CaseSummarySchema.parse(summary());
  const hidden = CaseSummarySchema.parse(
    summary({ case_id: "0c000000-0000-4000-8000-000000000009", case_number: "CDF-DEMO-2026-0009" }),
  );
  const adapter: CaseSourceAdapter = {
    sourceSystem: "V13_SYNTHETIC",
    async listCases(identity: RequestIdentity, filter: CaseListFilter): Promise<CaseListPage> {
      const f = CaseListFilterSchema.parse(filter);
      const allowed = [visible, hidden].filter(
        (c) => identity.active_workspace === "INVESTIGATIONS" || c === visible,
      );
      return { items: allowed.slice(0, f.limit), next_cursor: null };
    },
    async getCase(identity: RequestIdentity, caseId: CaseId): Promise<CaseSummary | null> {
      const allowed = [visible, hidden].filter(
        (c) => identity.active_workspace === "INVESTIGATIONS" || c === visible,
      );
      return allowed.find((c) => c.case_id === caseId) ?? null;
    },
  };
  const secretary = RequestIdentitySchema.parse({
    persona_id: "0b000000-0000-4000-8000-000000000001",
    active_workspace: "SECRETARIAT",
    roles: ["COMMITTEE_SECRETARY"],
  });

  it("returns the same null for an unknown id and for an id the identity may not see", async () => {
    const unknown = await adapter.getCase(secretary, CaseIdSchema.parse(crypto.randomUUID()));
    const unauthorised = await adapter.getCase(secretary, hidden.case_id);
    expect(unknown).toBeNull();
    expect(unauthorised).toBeNull();
  });

  it("lists pages without a total count", async () => {
    const page = await adapter.listCases(secretary, {});
    expect(page.items.map((c) => c.case_number)).toEqual(["CDF-DEMO-2026-0001"]);
    expect(Object.keys(page).sort()).toEqual(["items", "next_cursor"]);
  });
});
