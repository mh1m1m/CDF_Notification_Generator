// Pins the persona registry and workspace map to the database seed (database/seed/0001_m1_synthetic.sql, DB is the
// authority). A change here is an access-model change and needs the matching seed change.
import { describe, expect, it } from "vitest";
import {
  findPersona,
  PERSONAS,
  rolesIn,
  SIGN_IN_PERSONAS,
  signInWorkspace,
  WORKSPACE_CODES,
  WORKSPACE_IDS,
  workspaceCodeOf,
  workspacesOf,
} from "@/lib/contracts";

describe("persona registry", () => {
  it("mirrors the seeded personas, memberships and negative-test flags", () => {
    expect(
      PERSONAS.map((p) => ({
        id: p.persona_id,
        code: p.code,
        slug: p.slug,
        memberships: p.memberships.map((m) => `${m.workspace}/${m.role}`),
        negative_test: p.negative_test,
      })),
    ).toEqual([
      {
        id: "0b000000-0000-4000-8000-000000000001",
        code: "SECRETARY_ALPHA",
        slug: "secretary-alpha",
        memberships: ["SECRETARIAT/COMMITTEE_SECRETARY"],
        negative_test: false,
      },
      {
        id: "0b000000-0000-4000-8000-000000000002",
        code: "INVESTIGATOR_BETA",
        slug: "investigator-beta",
        memberships: ["INVESTIGATIONS/INVESTIGATOR"],
        negative_test: false,
      },
      {
        id: "0b000000-0000-4000-8000-000000000003",
        code: "INVESTIGATOR_GAMMA",
        slug: "investigator-gamma",
        memberships: ["INVESTIGATIONS/INVESTIGATOR"],
        negative_test: false,
      },
      {
        id: "0b000000-0000-4000-8000-000000000004",
        code: "GOVERNANCE_DELTA",
        slug: "governance-officer-delta",
        memberships: ["GOVERNANCE/GOVERNANCE_OFFICER", "SECRETARIAT/GOVERNANCE_OFFICER"],
        negative_test: false,
      },
      {
        id: "0b000000-0000-4000-8000-000000000005",
        code: "SECRETARY_EPSILON",
        slug: "secretary-epsilon",
        memberships: ["SECRETARIAT/COMMITTEE_SECRETARY"],
        negative_test: true,
      },
      {
        id: "0b000000-0000-4000-8000-000000000006",
        code: "PERSONA_ZETA",
        slug: "persona-zeta",
        memberships: ["SECRETARIAT/COMMITTEE_SECRETARY"],
        negative_test: true,
      },
    ]);
  });

  it("maps workspace codes to the seeded workspace ids and back", () => {
    expect(WORKSPACE_IDS).toEqual({
      SECRETARIAT: "0a000000-0000-4000-8000-000000000001",
      INVESTIGATIONS: "0a000000-0000-4000-8000-000000000002",
      GOVERNANCE: "0a000000-0000-4000-8000-000000000003",
    });
    for (const code of WORKSPACE_CODES) expect(workspaceCodeOf(WORKSPACE_IDS[code])).toBe(code);
    expect(workspaceCodeOf("0a000000-0000-4000-8000-000000000004")).toBeNull();
    expect(workspaceCodeOf("SECRETARIAT")).toBeNull();
    expect(workspaceCodeOf(undefined)).toBeNull();
  });

  it("offers only the four regular personas for sign-in", () => {
    expect(SIGN_IN_PERSONAS.map((p) => p.slug)).toEqual([
      "secretary-alpha",
      "investigator-beta",
      "investigator-gamma",
      "governance-officer-delta",
    ]);
  });

  it("derives the sign-in workspace, workspace list and roles per workspace from memberships", () => {
    const delta = findPersona("0b000000-0000-4000-8000-000000000004");
    expect(delta).not.toBeNull();
    if (!delta) return;
    expect(signInWorkspace(delta)).toBe("GOVERNANCE");
    expect(workspacesOf(delta)).toEqual(["GOVERNANCE", "SECRETARIAT"]);
    expect(rolesIn(delta, "SECRETARIAT")).toEqual(["GOVERNANCE_OFFICER"]);
    expect(rolesIn(delta, "INVESTIGATIONS")).toEqual([]);
  });

  it("treats lookups as untrusted input", () => {
    for (const input of [
      undefined,
      null,
      1,
      {},
      "",
      "0B000000-0000-4000-8000-000000000001",
      "secretary-alpha",
    ]) {
      expect(findPersona(input)).toBeNull();
    }
  });

  it("keeps personas immutable", () => {
    const alpha = PERSONAS[0];
    expect(Object.isFrozen(PERSONAS)).toBe(true);
    expect(alpha && Object.isFrozen(alpha)).toBe(true);
  });
});
