// V13-UX-008(a): the platform frame's pieces as the layout uses them: SideNav with plain props and the URL's area,
// test ids the e2e relies on (platform-nav, shell-persona, case-crumb-portfolio), and negatives (no area for a case
// page or a look-alike path, nothing marked when no area matches).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { PersonaMenu } from "@/components/shell/PersonaMenu";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";
import { currentArea, SideNav, SideNavList, sideNavListItems } from "@/components/shell/SideNav";
import { SideNavAuto } from "@/components/shell/SideNavAuto";
import { createTranslator, type Locale } from "@/lib/i18n";

const LOCALES: readonly Locale[] = ["ar", "en"];
const noop = async (_f: FormData) => undefined;
const AREAS = [
  { key: "my-work", href: "/my-work", label: "My work" },
  { key: "portfolio", href: "/portfolio", label: "Portfolio" },
  { key: "notifications", href: "/notifications", label: "Notifications" },
] as const;

describe("currentArea", () => {
  it("matches the area's own path and paths below it", () => {
    expect(currentArea("/my-work", AREAS)).toBe("my-work");
    expect(currentArea("/portfolio", AREAS)).toBe("portfolio");
    expect(currentArea("/notifications/abc", AREAS)).toBe("notifications");
  });

  it("marks no area for a case page, /workspaces, the root or a look-alike path", () => {
    for (const path of [
      "/cases/0c000000-0000-4000-8000-000000000001",
      "/workspaces",
      "/",
      "",
      "/portfolio-x",
      "/my-workspace",
    ]) {
      expect(currentArea(path, AREAS)).toBeUndefined();
    }
  });
});

describe("SideNavList and SideNav", () => {
  it.each(LOCALES)("%s: one aria-current, on the current area only, and the given test id", (locale) => {
    const t = createTranslator(locale);
    const html = renderToStaticMarkup(
      <SideNavList
        locale={locale}
        label={t("shell.nav.label")}
        items={AREAS}
        current="portfolio"
        testId="platform-nav"
      />,
    );
    expect(html).toContain('data-testid="platform-nav"');
    expect(html).not.toContain('data-testid="app-sidebar"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page" data-testid="nav-portfolio"/);
  });

  it("no current area: nothing marked", () => {
    const html = renderToStaticMarkup(<SideNavList locale="ar" label="x" items={AREAS} />);
    expect(html).not.toContain("aria-current");
  });

  it("SideNav and SideNavList give the same markup; the count sentence is localised up front", () => {
    const t = createTranslator("ar");
    const items = [{ key: "my-work", href: "/my-work", label: "أعمالي", count: 3 }];
    const listItems = sideNavListItems(t, "ar", items);
    expect(listItems[0]!.countLabel).toBe(t("shell.nav.countLabel", { count: "٣" }));
    expect(renderToStaticMarkup(<SideNav t={t} locale="ar" items={items} current="my-work" />)).toBe(
      renderToStaticMarkup(
        <SideNavList locale="ar" label={t("shell.nav.label")} items={listItems} current="my-work" />,
      ),
    );
  });

  it("SideNavAuto renders outside a router without marking an area", () => {
    const html = renderToStaticMarkup(
      <SideNavAuto locale="en" label="Areas" items={AREAS} testId="platform-nav" />,
    );
    expect(html).toContain('data-testid="platform-nav"');
    expect(html).not.toContain("aria-current");
  });
});

describe("test ids the platform layout passes", () => {
  it("Breadcrumbs puts an item's test id on its link or current span", () => {
    const t = createTranslator("ar");
    const html = renderToStaticMarkup(
      <Breadcrumbs
        t={t}
        items={[
          { href: "/portfolio", label: "Portfolio", testId: "case-crumb-portfolio" },
          { label: <bdi dir="ltr">CDF-DEMO-2026-0001</bdi>, testId: "case-crumb-current" },
        ]}
      />,
    );
    expect(html).toMatch(/<a href="\/portfolio" data-testid="case-crumb-portfolio">/);
    expect(html).toMatch(/<span aria-current="page" data-testid="case-crumb-current">/);
  });

  it("PersonaMenu puts the name test id on the visible name only", () => {
    const t = createTranslator("en");
    const html = renderToStaticMarkup(
      <PersonaMenu
        t={t}
        name="Secretary Alpha"
        roleLabel="Committee Secretary"
        signOutAction={noop}
        nameTestId="shell-persona"
      />,
    );
    expect(html).toContain('<span data-testid="shell-persona">Secretary Alpha</span>');
    expect(html.match(/data-testid="shell-persona"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="sign-out"');
  });
});

// FE-008 (OI-044): a role is shown only when an active membership is confirmed; without one, no empty "as …" line.
describe("no confirmed role", () => {
  const t = createTranslator("ar");
  const asPrefix = t("shell.workspace.roleHeld", { role: "" }).trim();

  it("menu option without a role: no role line for it, the other option keeps its role", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSwitcher
        t={t}
        current="GOVERNANCE"
        options={[
          { code: "GOVERNANCE", name: "الحوكمة", role: "مسؤول الحوكمة" },
          { code: "SECRETARIAT", name: "أمانة اللجنة" },
        ]}
        action={noop}
        pageHref="/workspaces"
      />,
    );
    expect(html).toContain(t("shell.workspace.roleHeld", { role: "مسؤول الحوكمة" }));
    expect(html).not.toMatch(new RegExp(`${asPrefix}\\s*<`));
    // Every "as …" on the page is GOVERNANCE's: none for the option without a role (not even a placeholder).
    const count = (needle: string) => html.split(needle).length - 1;
    expect(count(asPrefix)).toBe(count(t("shell.workspace.roleHeld", { role: "مسؤول الحوكمة" })));
    expect(html).toContain('data-testid="workspace-menu-option-SECRETARIAT"');
  });

  it("single workspace without a role: the name only", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSwitcher
        t={t}
        current="SECRETARIAT"
        options={[{ code: "SECRETARIAT", name: "أمانة اللجنة", role: "" }]}
        action={noop}
        pageHref="/workspaces"
      />,
    );
    expect(html).toContain('data-testid="workspace-switcher"');
    expect(html).toContain("أمانة اللجنة");
    expect(html).not.toContain("v13-muted");
  });

  it("PersonaMenu without a role label: no persona-menu-role line, sign-out stays", () => {
    const html = renderToStaticMarkup(
      <PersonaMenu t={t} name="Persona Zeta" roleLabel="" signOutAction={noop} />,
    );
    expect(html).not.toContain("persona-menu-role");
    expect(html).toContain('data-testid="sign-out"');
  });
});
