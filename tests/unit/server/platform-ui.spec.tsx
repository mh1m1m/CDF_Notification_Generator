// FE-002 navigation and switcher markup: role-aware items (D6), ADR-013 attributes, only own memberships offered.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n";
import { navigationFor } from "@/lib/server/navigation";
import { GOVERNANCE, INVESTIGATOR_BETA, SECRETARY } from "./support/identities";

const t = createTranslator("ar");
// What the database confirms for these personas in the M1 seed (V13-FE-008): Delta holds GOVERNANCE_OFFICER in
// GOVERNANCE and SECRETARIAT, Alpha COMMITTEE_SECRETARY in SECRETARIAT.
const DELTA_CONFIRMED = [
  { workspace: "GOVERNANCE", role: "GOVERNANCE_OFFICER" },
  { workspace: "SECRETARIAT", role: "GOVERNANCE_OFFICER" },
] as const;
const ALPHA_CONFIRMED = [{ workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY" }] as const;
const noop = async (): Promise<void> => {};

describe("navigationFor", () => {
  it("D6: investigators get no Notification Operations Center entry", () => {
    expect(navigationFor(INVESTIGATOR_BETA).map((i) => i.id)).toEqual(["my-work", "portfolio"]);
  });

  it("secretary and governance get all three", () => {
    for (const who of [SECRETARY, GOVERNANCE]) {
      expect(navigationFor(who).map((i) => i.id)).toEqual(["my-work", "portfolio", "notifications"]);
    }
  });
});

describe("markup", () => {
  it("PlatformNav renders labelled links with test ids", async () => {
    const { PlatformNav } = await import("@/app/(platform)/_components/PlatformNav");
    const html = renderToStaticMarkup(
      <PlatformNav t={t} locale="ar" items={navigationFor(INVESTIGATOR_BETA)} />,
    );
    expect(html).toContain('data-testid="platform-nav"');
    expect(html).toContain('data-testid="nav-portfolio"');
    expect(html).not.toContain("/notifications");
  });

  // UX-005: the TopBar switcher is the shell's menu (components/shell/WorkspaceSwitcher, unit-tested in
  // tests/unit/components/shell.spec.tsx); these pin what the layout feeds it.
  it("WorkspaceSwitcher with several memberships: a menu of own memberships carrying the active code", async () => {
    const { WorkspaceSwitcher } = await import("@/components/shell/WorkspaceSwitcher");
    const { workspaceOptions } = await import("@/app/(platform)/_components/workspace-options");
    const options = workspaceOptions(GOVERNANCE, "ar", t, DELTA_CONFIRMED);
    expect(options.map((o) => o.code)).toEqual(["GOVERNANCE", "SECRETARIAT"]);
    expect(options[0]!.name).toBe(t("workspaces.name.governance"));
    expect(options[0]!.role).toBe(t("persona.role.governanceOfficer"));
    const html = renderToStaticMarkup(
      <WorkspaceSwitcher t={t} current="GOVERNANCE" options={options} action={noop} pageHref="/workspaces" />,
    );
    expect(html.match(/data-testid="workspace-switcher"/g)).toHaveLength(1);
    expect(html).toMatch(/data-testid="workspace-switcher" data-workspace-code="GOVERNANCE"/);
    expect(html).toContain('data-testid="workspace-menu-option-SECRETARIAT"');
    expect(html).toContain('href="/workspaces"');
    expect(html).not.toContain("INVESTIGATIONS");
  });

  it("single membership: the code is shown, no form", async () => {
    const { WorkspaceSwitcher } = await import("@/components/shell/WorkspaceSwitcher");
    const { workspaceOptions } = await import("@/app/(platform)/_components/workspace-options");
    const options = workspaceOptions(SECRETARY, "ar", t, ALPHA_CONFIRMED);
    expect(options.map((o) => o.code)).toEqual(["SECRETARIAT"]);
    const html = renderToStaticMarkup(
      <WorkspaceSwitcher
        t={t}
        current="SECRETARIAT"
        options={options}
        action={noop}
        pageHref="/workspaces"
      />,
    );
    expect(html).toContain('data-workspace-code="SECRETARIAT"');
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<form");
  });

  it("an active workspace that is not switchable is shown alone, with nothing to switch to", async () => {
    const { workspaceOptions } = await import("@/app/(platform)/_components/workspace-options");
    // A persona id outside the registry: no switchable memberships, so only the session's own workspace is shown.
    const unknown = {
      ...GOVERNANCE,
      persona_id: "0b000000-0000-4000-8000-0000000000ff",
    } as typeof GOVERNANCE;
    expect(workspaceOptions(unknown, "en", t, []).map((o) => o.code)).toEqual(["GOVERNANCE"]);
  });

  it("FE-008 negative: nothing confirmed gives no role, and the shell renders no 'as …' line or persona role", async () => {
    const { WorkspaceSwitcher } = await import("@/components/shell/WorkspaceSwitcher");
    const { PersonaMenu } = await import("@/components/shell/PersonaMenu");
    const { workspaceOptions } = await import("@/app/(platform)/_components/workspace-options");
    for (const locale of ["ar", "en"] as const) {
      const tl = createTranslator(locale);
      const options = workspaceOptions(SECRETARY, locale, tl, []);
      const roleLabel = options.find((o) => o.code === "SECRETARIAT")?.role ?? "";
      expect(roleLabel).toBe("");
      const switcher = renderToStaticMarkup(
        <WorkspaceSwitcher
          t={tl}
          current="SECRETARIAT"
          options={options}
          action={noop}
          pageHref="/workspaces"
        />,
      );
      const asWord = tl("shell.workspace.roleHeld", { role: "" }).trim();
      expect(switcher).not.toContain(`>${asWord}`);
      expect(switcher).not.toContain("v13-muted");
      const menu = renderToStaticMarkup(
        <PersonaMenu
          t={tl}
          name="Secretary Alpha"
          roleLabel={roleLabel}
          signOutAction={noop}
          nameTestId="shell-persona"
        />,
      );
      expect(menu).not.toContain('data-testid="persona-menu-role"');
    }
  });

  it("FE-008 positive control: a confirmed role shows in the switcher and the persona menu", async () => {
    const { PersonaMenu } = await import("@/components/shell/PersonaMenu");
    const { workspaceOptions } = await import("@/app/(platform)/_components/workspace-options");
    const options = workspaceOptions(SECRETARY, "ar", t, ALPHA_CONFIRMED);
    const roleLabel = options.find((o) => o.code === "SECRETARIAT")?.role ?? "";
    expect(roleLabel).toBe(t("persona.role.committeeSecretary"));
    const menu = renderToStaticMarkup(
      <PersonaMenu t={t} name="x" roleLabel={roleLabel} signOutAction={noop} nameTestId="shell-persona" />,
    );
    expect(menu).toContain(`data-testid="persona-menu-role">${roleLabel}<`);
  });
});
