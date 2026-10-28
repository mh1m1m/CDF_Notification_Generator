// lib/authz pre-check: role matrix (incl. SEC ruling D6), case-target validation, workspace switch, fail-closed paths.
import { describe, expect, it } from "vitest";
import { AUTHZ_ACTIONS, canSee, parseCaseId, precheck, ROLE_MATRIX, switchableWorkspaces } from "@/lib/authz";
import type { AuthzAction } from "@/lib/authz";
import {
  ALPHA,
  EPSILON,
  GOVERNANCE,
  GOVERNANCE_AT_SECRETARIAT,
  id,
  INVESTIGATOR_BETA,
  SECRETARY,
} from "../server/support/identities";

const CASE = "0c000000-0000-4000-8000-000000000001";

describe("role matrix", () => {
  it("covers every action exactly once", () => {
    expect(Object.keys(ROLE_MATRIX).sort()).toEqual([...AUTHZ_ACTIONS].sort());
  });

  it("D6: investigators never get the Notification Operations Center; secretary and governance do", () => {
    expect(precheck(INVESTIGATOR_BETA, "notifications.center.read")).toEqual({
      allow: false,
      reason: "ROLE",
    });
    expect(canSee(INVESTIGATOR_BETA, "notifications.center.read")).toBe(false);
    expect(precheck(SECRETARY, "notifications.center.read").allow).toBe(true);
    expect(precheck(GOVERNANCE, "notifications.center.read").allow).toBe(true);
  });

  it("draft creation only for secretary and investigator (governance refused)", () => {
    expect(precheck(SECRETARY, "notification.draft.create", { caseId: CASE }).allow).toBe(true);
    expect(precheck(INVESTIGATOR_BETA, "notification.draft.create", { caseId: CASE }).allow).toBe(true);
    expect(precheck(GOVERNANCE, "notification.draft.create", { caseId: CASE })).toEqual({
      allow: false,
      reason: "ROLE",
    });
  });

  it("every role may read the portfolio, a case and its own tasks", () => {
    for (const who of [SECRETARY, INVESTIGATOR_BETA, GOVERNANCE]) {
      expect(precheck(who, "portfolio.read").allow).toBe(true);
      expect(precheck(who, "case.read", { caseId: CASE }).allow).toBe(true);
      expect(precheck(who, "tasks.mine.read").allow).toBe(true);
    }
  });
});

describe("fail closed", () => {
  it("refuses an identity without roles, with unknown roles or with a broken shape", () => {
    expect(precheck(id(ALPHA, "SECRETARIAT", []), "portfolio.read").allow).toBe(false);
    expect(precheck(id(ALPHA, "SECRETARIAT", ["PLATFORM_ADMIN"]), "portfolio.read").allow).toBe(false);
    expect(precheck({} as never, "portfolio.read").allow).toBe(false);
    expect(precheck(null as never, "portfolio.read").allow).toBe(false);
  });

  it("refuses an unknown action", () => {
    expect(precheck(SECRETARY, "case.delete" as AuthzAction)).toEqual({
      allow: false,
      reason: "ACTION_UNKNOWN",
    });
  });
});

describe("case targets", () => {
  it.each([
    ["missing", undefined],
    ["display number", "CDF-DEMO-2026-0001"],
    ["upper-case uuid", CASE.toUpperCase()],
    ["nil uuid", "00000000-0000-0000-0000-000000000000"],
    ["number", 1],
    ["array", [CASE]],
    ["sql text", "' or 1=1 --"],
    ["path traversal", "../0c000000-0000-4000-8000-000000000001"],
  ])("refuses a %s as a case id", (_label, caseId) => {
    expect(precheck(SECRETARY, "case.read", { caseId })).toEqual({ allow: false, reason: "TARGET_INVALID" });
    expect(parseCaseId(caseId)).toBeNull();
  });

  it("accepts a canonical uuid", () => {
    expect(parseCaseId(CASE)).toBe(CASE);
  });
});

describe("workspace switch", () => {
  it("allows only the persona's own memberships", () => {
    expect(precheck(GOVERNANCE, "workspace.switch", { workspace: "SECRETARIAT" }).allow).toBe(true);
    expect(precheck(GOVERNANCE_AT_SECRETARIAT, "workspace.switch", { workspace: "GOVERNANCE" }).allow).toBe(
      true,
    );
    expect(precheck(GOVERNANCE, "workspace.switch", { workspace: "INVESTIGATIONS" })).toEqual({
      allow: false,
      reason: "NOT_A_MEMBER",
    });
    expect(precheck(SECRETARY, "workspace.switch", { workspace: "GOVERNANCE" }).allow).toBe(false);
  });

  it("refuses malformed targets and negative-test personas", () => {
    for (const workspace of [undefined, "governance", "0a000000-0000-4000-8000-000000000003", 3]) {
      expect(precheck(GOVERNANCE, "workspace.switch", { workspace })).toEqual({
        allow: false,
        reason: "TARGET_INVALID",
      });
    }
    const epsilon = id(EPSILON, "SECRETARIAT", ["COMMITTEE_SECRETARY"]);
    expect(precheck(epsilon, "workspace.switch", { workspace: "SECRETARIAT" }).allow).toBe(false);
    expect(switchableWorkspaces(epsilon)).toEqual([]);
  });

  it("lists switchable workspaces from the registry", () => {
    expect(switchableWorkspaces(GOVERNANCE)).toEqual(["GOVERNANCE", "SECRETARIAT"]);
    expect(switchableWorkspaces(SECRETARY)).toEqual(["SECRETARIAT"]);
  });
});
