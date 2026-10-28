// FE-002 navigation and switcher markup: role-aware items (D6), ADR-013 attributes, only own memberships offered.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@/lib/i18n";
import { navigationFor } from "@/lib/server/navigation";
import { GOVERNANCE, INVESTIGATOR_BETA, SECRETARY } from "./support/identities";

vi.mock("@/app/(platform)/workspace-actions", () => ({ switchWorkspace: async () => undefined }));

const t = createTranslator("ar");

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
    const html = renderToStaticMarkup(<PlatformNav t={t} items={navigationFor(INVESTIGATOR_BETA)} />);
    expect(html).toContain('data-testid="platform-nav"');
    expect(html).toContain('data-testid="nav-portfolio"');
    expect(html).not.toContain("/notifications");
  });

  it("WorkspaceSwitcher carries the active code and offers only the given memberships", async () => {
    const { WorkspaceSwitcher } = await import("@/app/(platform)/_components/WorkspaceSwitcher");
    const html = renderToStaticMarkup(
      <WorkspaceSwitcher t={t} active="GOVERNANCE" options={["GOVERNANCE", "SECRETARIAT"]} />,
    );
    expect(html).toContain('data-testid="workspace-switcher"');
    expect(html).toContain('data-workspace-code="GOVERNANCE"');
    expect(html).toContain('data-testid="workspace-option-SECRETARIAT"');
    expect(html).not.toContain("INVESTIGATIONS");
  });

  it("single membership: the code is shown, no form", async () => {
    const { WorkspaceSwitcher } = await import("@/app/(platform)/_components/WorkspaceSwitcher");
    const html = renderToStaticMarkup(
      <WorkspaceSwitcher t={t} active="SECRETARIAT" options={["SECRETARIAT"]} />,
    );
    expect(html).toContain('data-workspace-code="SECRETARIAT"');
    expect(html).not.toContain("<form");
  });
});
