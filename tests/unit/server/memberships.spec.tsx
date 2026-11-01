// V13-FE-008 (OI-044): the shell's switcher and My Work name only roles the database confirms in the request's
// security context. The session's identity.roles and the persona registry are never used for a role word. The SQL
// adapter reads own memberships under RLS (strict rows); a failed read confirms nothing. Fake readers and a recording
// transaction stub; the database side is in tests/integration/fe/memberships.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createV13MembershipReader, rowToConfirmedMembership } from "@/lib/adapters/identity/v13-memberships";
import type { ConfirmedMembership, MembershipReader, RequestIdentity } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { createTranslator } from "@/lib/i18n";
import { confirmedRolesIn, loadConfirmedMemberships } from "@/lib/server/memberships";
import { workspaceOptions } from "@/app/(platform)/_components/workspace-options";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";
import { CORRELATION, ctxFor, EPSILON, GOVERNANCE, id, SECRETARY } from "./support/identities";

const logServerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/errors", () => ({ logServerError }));
beforeEach(() => logServerError.mockClear());

const t = createTranslator("en");
const noop = async (): Promise<void> => {};
// Minted negative personas: the session still says COMMITTEE_SECRETARY in SECRETARIAT, the database confirms nothing.
const EPSILON_ID = id(EPSILON, "SECRETARIAT", ["COMMITTEE_SECRETARY"]);
const ZETA_ID = id("0b000000-0000-4000-8000-000000000006", "SECRETARIAT", ["COMMITTEE_SECRETARY"]);
const SECRETARY_ROLE = t("persona.role.committeeSecretary");

function recorder(answer: () => Promise<unknown[]>) {
  const calls: { text: string; values: unknown[]; identity: RequestIdentity }[] = [];
  const run = async <T,>(identity: RequestIdentity, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("$"), values, identity });
      return answer();
    }) as unknown as Tx;
    return fn(tx);
  };
  return { calls, reader: createV13MembershipReader(run) };
}

describe("workspaceOptions: role words come only from confirmed memberships", () => {
  it.each([
    ["Epsilon (membership expired)", EPSILON_ID],
    ["Zeta (inactive persona)", ZETA_ID],
  ])("negative: %s — the session's role is never shown", (_label, who) => {
    const options = workspaceOptions(who, "en", t, []);
    expect(options).toEqual([{ code: "SECRETARIAT", name: t("workspaces.name.secretariat"), role: "" }]);
    const html = renderToStaticMarkup(
      <WorkspaceSwitcher
        t={t}
        current="SECRETARIAT"
        options={options}
        action={noop}
        pageHref="/workspaces"
      />,
    );
    expect(html).not.toContain(SECRETARY_ROLE);
    expect(html).not.toContain("<form");
  });

  it("a confirmed membership names its role; the session's roles are ignored even when they differ", () => {
    const claimsMore = id("0b000000-0000-4000-8000-000000000001", "SECRETARIAT", [
      "COMMITTEE_SECRETARY",
      "GOVERNANCE_OFFICER",
    ]);
    const options = workspaceOptions(claimsMore, "en", t, [
      { workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY" },
    ]);
    expect(options[0]?.role).toBe(SECRETARY_ROLE);
    expect(options[0]?.role).not.toContain(t("persona.role.governanceOfficer"));
  });

  it("negative: a confirmation for another workspace never fills this one's role", () => {
    const options = workspaceOptions(SECRETARY, "en", t, [
      { workspace: "GOVERNANCE", role: "GOVERNANCE_OFFICER" },
    ]);
    expect(options).toEqual([{ code: "SECRETARIAT", name: t("workspaces.name.secretariat"), role: "" }]);
  });

  it("Delta: each switchable workspace carries its own confirmed role; one the database drops shows none", () => {
    const all = workspaceOptions(GOVERNANCE, "en", t, [
      { workspace: "GOVERNANCE", role: "GOVERNANCE_OFFICER" },
      { workspace: "SECRETARIAT", role: "GOVERNANCE_OFFICER" },
    ]);
    expect(all.map((o) => [o.code, o.role])).toEqual([
      ["GOVERNANCE", t("persona.role.governanceOfficer")],
      ["SECRETARIAT", t("persona.role.governanceOfficer")],
    ]);
    const partial = workspaceOptions(GOVERNANCE, "en", t, [
      { workspace: "GOVERNANCE", role: "GOVERNANCE_OFFICER" },
    ]);
    expect(partial.map((o) => [o.code, o.role])).toEqual([
      ["GOVERNANCE", t("persona.role.governanceOfficer")],
      ["SECRETARIAT", ""],
    ]);
  });
});

describe("confirmedRolesIn and loadConfirmedMemberships", () => {
  const m = (workspace: string, role: string) => ({ workspace, role }) as ConfirmedMembership;
  it("keeps one workspace's roles, in the closed set's order and without duplicates", () => {
    expect(
      confirmedRolesIn(
        [
          m("SECRETARIAT", "INVESTIGATOR"),
          m("SECRETARIAT", "COMMITTEE_SECRETARY"),
          m("SECRETARIAT", "INVESTIGATOR"),
          m("GOVERNANCE", "GOVERNANCE_OFFICER"),
        ],
        "SECRETARIAT",
      ),
    ).toEqual(["COMMITTEE_SECRETARY", "INVESTIGATOR"]);
    expect(confirmedRolesIn([], "SECRETARIAT")).toEqual([]);
  });

  it("orders roles as the closed set does, not alphabetically (GOVERNANCE_OFFICER after INVESTIGATOR)", () => {
    expect(
      confirmedRolesIn(
        [
          m("SECRETARIAT", "GOVERNANCE_OFFICER"),
          m("SECRETARIAT", "INVESTIGATOR"),
          m("SECRETARIAT", "COMMITTEE_SECRETARY"),
        ],
        "SECRETARIAT",
      ),
    ).toEqual(["COMMITTEE_SECRETARY", "INVESTIGATOR", "GOVERNANCE_OFFICER"]);
  });

  it("returns the reader's rows for this request's identity", async () => {
    const calls: RequestIdentity[] = [];
    const reader: MembershipReader = {
      confirmedMemberships: async (who) => {
        calls.push(who);
        return [m("SECRETARIAT", "COMMITTEE_SECRETARY")];
      },
    };
    expect(await loadConfirmedMemberships({ ctx: ctxFor(SECRETARY), reader })).toEqual([
      m("SECRETARIAT", "COMMITTEE_SECRETARY"),
    ]);
    expect(calls).toEqual([SECRETARY]);
  });

  it("negative: a failed read confirms nothing and is logged by code only", async () => {
    const raw = Object.assign(new Error("permission denied for table persona_workspace_membership"), {
      code: "42501",
    });
    const reader: MembershipReader = {
      confirmedMemberships: async () => {
        throw raw;
      },
    };
    expect(await loadConfirmedMemberships({ ctx: ctxFor(SECRETARY), reader })).toEqual([]);
    expect(logServerError).toHaveBeenCalledWith("memberships_load_failed", CORRELATION, raw);
  });
});

describe("V13 MembershipReader (SQL)", () => {
  it("reads own active memberships in the identity's context, explicit columns, no bound values", async () => {
    const { calls, reader } = recorder(async () => [
      { workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY" },
    ]);
    expect(await reader.confirmedMemberships(SECRETARY)).toEqual([
      { workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.identity).toBe(SECRETARY);
    expect(calls[0]?.values).toEqual([]);
    const text = calls[0]!.text;
    expect(text).toContain("where m.persona_id = cdf_notifications_v13.current_persona_id()");
    expect(text).toContain("and m.valid_from <= now()");
    expect(text).toContain("and (m.valid_to is null or m.valid_to > now())");
    expect(text).toContain("and w.is_active");
    expect(text).not.toMatch(/\*|email/);
  });

  it("no row: nothing confirmed", async () => {
    expect(await recorder(async () => []).reader.confirmedMemberships(EPSILON_ID)).toEqual([]);
  });

  it.each([
    ["an extra column", { workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY", valid_to: null }],
    ["a missing column", { workspace: "SECRETARIAT" }],
    ["an unknown workspace", { workspace: "LEGAL", role: "COMMITTEE_SECRETARY" }],
    ["an unknown role", { workspace: "SECRETARIAT", role: "PLATFORM_ADMIN" }],
  ])("negative: %s refuses the whole result", async (_label, bad) => {
    await expect(
      recorder(async () => [
        { workspace: "GOVERNANCE", role: "GOVERNANCE_OFFICER" },
        bad,
      ]).reader.confirmedMemberships(GOVERNANCE),
    ).rejects.toThrow();
    expect(() => rowToConfirmedMembership(bad as never)).toThrow();
  });
});
