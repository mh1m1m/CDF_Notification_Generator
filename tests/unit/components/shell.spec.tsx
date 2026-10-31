// V13-UX-002 shell components, rendered to static HTML (ADR-013 D8: react-dom/server in the node environment).
// Every component is rendered in Arabic and English; the tests assert landmarks, aria-current, the ADR-013 evidence
// attributes and logical-property-only classes, plus negatives (wrong case identity, too many areas, unknown workspace).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Count } from "@/components/data/Count";
import { formatNumber } from "@/components/format";
import { AppShell } from "@/components/shell/AppShell";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { CaseHeader } from "@/components/shell/CaseHeader";
import { CaseTabs } from "@/components/shell/CaseTabs";
import { CaseWorkspace } from "@/components/shell/CaseWorkspace";
import { PageHeading } from "@/components/shell/PageHeading";
import { PersonaMenu } from "@/components/shell/PersonaMenu";
import { SideNav } from "@/components/shell/SideNav";
import { SyntheticBanner } from "@/components/shell/SyntheticBanner";
import { TopBar } from "@/components/shell/TopBar";
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/shell/WorkspaceSwitcher";
import { createTranslator, messagesFor, type Locale } from "@/lib/i18n";

const LOCALES: readonly Locale[] = ["ar", "en"];
const tr = (l: Locale) => createTranslator(l);
const msg = (l: Locale) => messagesFor(l);
const noop = async (_f: FormData) => undefined;
const render = (node: React.ReactElement) => renderToStaticMarkup(node);
/** Attribute values are HTML-escaped in markup. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

// Synthetic fixtures (CLAUDE.md §1).
const CASE_1 = { id: "6f1c2a40-0000-4000-8000-000000000001", ref: "CDF-DEMO-2026-0001" };

describe("SyntheticBanner", () => {
  it.each(LOCALES)("is a note with a decorative flask glyph and the classification text (%s)", (l) => {
    const html = render(<SyntheticBanner t={tr(l)} />);
    expect(html).toContain('role="note"');
    expect(html).toContain('data-testid="synthetic-banner"');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain(msg(l)["common.banner.synthetic"]);
  });
});

describe("TopBar", () => {
  it.each(LOCALES)(
    "is the header landmark with product name, wordmark fallback and the control slots (%s)",
    (l) => {
      const html = render(
        <TopBar
          t={tr(l)}
          workspace={<span id="ws" />}
          language={<span id="lang" />}
          persona={<span id="pm" />}
        />,
      );
      expect(html).toMatch(/^<header class="v13-top-bar" data-testid="top-bar">/);
      expect(html).toContain(esc(msg(l)["shell.productName"]));
      expect(html).toContain(msg(l)["shell.orgName"]);
      // Not a heading: the page's only <h1> lives in <main>.
      expect(html).not.toMatch(/<h[1-6]/);
      expect(html.indexOf('id="ws"')).toBeLessThan(html.indexOf('id="lang"'));
      expect(html.indexOf('id="lang"')).toBeLessThan(html.indexOf('id="pm"'));
    },
  );

  it("uses a supplied logo instead of the wordmark", () => {
    const html = render(<TopBar t={tr("ar")} logo={<span id="logo" />} />);
    expect(html).toContain('id="logo"');
    expect(html).not.toContain(msg("ar")["shell.orgName"]);
  });
});

describe("SideNav", () => {
  const items = (l: Locale) => [
    { key: "my-work", href: "/my-work", label: msg(l)["shell.nav.label"], count: 3 },
    { key: "portfolio", href: "/portfolio", label: "P" },
    { key: "notifications", href: "/notifications", label: "N", count: 12 },
  ];

  it.each(LOCALES)("is a labelled nav with aria-current on the current area only (%s)", (l) => {
    const html = render(<SideNav t={tr(l)} locale={l} items={items(l)} current="portfolio" />);
    expect(html).toContain(
      `<nav class="v13-side-nav" aria-label="${esc(msg(l)["shell.nav.label"])}" data-testid="app-sidebar">`,
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page" data-testid="nav-portfolio"/);
    for (const k of ["my-work", "portfolio", "notifications"])
      expect(html).toContain(`data-testid="nav-${k}"`);
  });

  it.each(LOCALES)(
    "caps the visible count at 9+ while data-count and the spoken text keep the real number (%s)",
    (l) => {
      const html = render(<SideNav t={tr(l)} locale={l} items={items(l)} />);
      expect(html).toContain('data-testid="count-nav-my-work" data-count="3"');
      expect(html).toContain('data-testid="count-nav-notifications" data-count="12"');
      expect(html).toContain(`<span aria-hidden="true">${formatNumber(l, 9)}+</span>`);
      expect(html).toContain(tr(l)("shell.nav.countLabel", { count: formatNumber(l, 12) }));
      expect(html).not.toContain("count-nav-portfolio");
    },
  );

  it("writes Arabic-Indic digits in Arabic and Western digits in English", () => {
    expect(render(<SideNav t={tr("ar")} locale="ar" items={items("ar")} />)).toContain(">٣<");
    expect(render(<SideNav t={tr("en")} locale="en" items={items("en")} />)).toContain(">3<");
  });

  it("shows no badge for zero and refuses more than five areas", () => {
    const zero = render(
      <SideNav t={tr("en")} locale="en" items={[{ key: "my-work", href: "/", label: "x", count: 0 }]} />,
    );
    expect(zero).not.toContain("data-count");
    const six = Array.from({ length: 6 }, (_, i) => ({ key: `a${i}`, href: "/", label: "x" }));
    expect(() => render(<SideNav t={tr("en")} locale="en" items={six} />)).toThrow(/five/);
  });
});

describe("Count", () => {
  it("renders count-<name> with the real value and formatted text", () => {
    expect(render(<Count name="portfolio-total" value={1234} locale="en" />)).toBe(
      '<span data-testid="count-portfolio-total" data-count="1234">1,234</span>',
    );
    expect(render(<Count name="portfolio-total" value={10} locale="ar" />)).toContain(">١٠<");
  });

  it("refuses names that would make a broken test id and values that are not counts", () => {
    expect(() => render(<Count name="Bad Name" value={1} locale="en" />)).toThrow();
    expect(() => render(<Count name="ok" value={-1} locale="en" />)).toThrow();
    expect(() => render(<Count name="ok" value={1.5} locale="en" />)).toThrow();
  });
});

describe("WorkspaceSwitcher", () => {
  // Seed (ADR-014): Governance Officer Delta holds GOVERNANCE and SECRETARIAT.
  const options = (l: Locale): WorkspaceOption[] => [
    {
      code: "GOVERNANCE",
      name: msg(l)["workspaces.name.governance"],
      role: msg(l)["persona.role.governanceOfficer"],
    },
    {
      code: "SECRETARIAT",
      name: msg(l)["workspaces.name.secretariat"],
      role: msg(l)["persona.role.governanceOfficer"],
    },
  ];

  it.each(LOCALES)(
    "is a disclosure whose control carries data-workspace-code of the active workspace (%s)",
    (l) => {
      const html = render(
        <WorkspaceSwitcher
          t={tr(l)}
          current="GOVERNANCE"
          options={options(l)}
          action={noop}
          pageHref="/workspaces"
        />,
      );
      expect(html).toMatch(/<details class="v13-disclosure v13-workspace-switcher">/);
      expect(html).toMatch(
        /<summary class="v13-disclosure-button" data-testid="workspace-switcher" data-workspace-code="GOVERNANCE">/,
      );
      expect(html).toContain(tr(l)("shell.workspace.button", { name: msg(l)["workspaces.name.governance"] }));
      expect(html).toContain(`role="group" aria-label="${esc(msg(l)["shell.workspace.menuLabel"])}"`);
    },
  );

  it.each(LOCALES)(
    "marks the active option with aria-current, a check glyph and the word, not colour alone (%s)",
    (l) => {
      const html = render(
        <WorkspaceSwitcher
          t={tr(l)}
          current="GOVERNANCE"
          options={options(l)}
          action={noop}
          pageHref="/workspaces"
        />,
      );
      const current = html.match(/<li[^>]*aria-current="true"[^>]*>.*?<\/li>/)?.[0] ?? "";
      expect(current).toContain('data-testid="workspace-menu-current"');
      expect(current).toContain('data-workspace-code="GOVERNANCE"');
      expect(current).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(current).toContain(msg(l)["shell.workspace.current"]);
      expect(current).not.toContain("<button");
      expect(html.match(/aria-current=/g)).toHaveLength(1);
    },
  );

  it("offers each other membership as a form submit with the code, and a link to the full page", () => {
    const html = render(
      <WorkspaceSwitcher
        t={tr("en")}
        current="GOVERNANCE"
        options={options("en")}
        action={noop}
        pageHref="/workspaces"
      />,
    );
    expect(html).toContain('<input type="hidden" name="workspace" value="SECRETARIAT"/>');
    expect(html).toMatch(
      /<button type="submit"[^>]*data-testid="workspace-menu-option-SECRETARIAT" data-workspace-code="SECRETARIAT"/,
    );
    expect(html).not.toContain("workspace-menu-option-GOVERNANCE");
    expect(html).not.toContain("INVESTIGATIONS");
    expect(html).toContain(
      '<a href="/workspaces" class="v13-menu-link" data-testid="workspace-menu-all">All workspaces</a>',
    );
  });

  it("never reuses the /workspaces page's test ids inside the menu (QA #14)", () => {
    const html = render(
      <WorkspaceSwitcher
        t={tr("en")}
        current="GOVERNANCE"
        options={options("en")}
        action={noop}
        pageHref="/workspaces"
      />,
    );
    expect(html).not.toMatch(/data-testid="workspace-option-/);
    expect(html).not.toContain('data-testid="workspace-current"');
    expect(html).not.toContain('data-testid="workspace-all"');
  });

  it.each(LOCALES)(
    "names each option by its visible text plus a hidden verb, with no aria-label override (%s)",
    (l) => {
      const html = render(
        <WorkspaceSwitcher
          t={tr(l)}
          current="GOVERNANCE"
          options={options(l)}
          action={noop}
          pageHref="/workspaces"
        />,
      );
      const button = html.match(/<button type="submit"[^>]*>.*?<\/button>/)?.[0] ?? "";
      const secretariat = options(l).find((o) => o.code === "SECRETARIAT")!;
      expect(button).not.toContain("aria-label");
      expect(button).toContain(
        `<span class="v13-sr-only">${tr(l)("shell.workspace.switchTo", { name: secretariat.name })}</span>`,
      );
      // The visible name follows the hidden verb, so the accessible name contains the visible label (WCAG 2.5.3).
      expect(button.indexOf("v13-sr-only")).toBeLessThan(button.indexOf(`<span>${secretariat.name}</span>`));
    },
  );

  it("shows plain text, no menu, with one membership", () => {
    const html = render(
      <WorkspaceSwitcher
        t={tr("ar")}
        current="INVESTIGATIONS"
        options={[
          {
            code: "INVESTIGATIONS",
            name: msg("ar")["workspaces.name.investigations"],
            role: msg("ar")["persona.role.investigator"],
          },
        ]}
        action={noop}
        pageHref="/workspaces"
      />,
    );
    expect(html).toMatch(
      /^<p class="v13-workspace-single" data-testid="workspace-switcher" data-workspace-code="INVESTIGATIONS">/,
    );
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<form");
  });

  it("refuses an active workspace that is not among the memberships (no silent widening)", () => {
    expect(() =>
      render(
        <WorkspaceSwitcher
          t={tr("en")}
          current="INVESTIGATIONS"
          options={options("en")}
          action={noop}
          pageHref="/w"
        />,
      ),
    ).toThrow(/not among/);
  });
});

describe("PersonaMenu", () => {
  it.each(LOCALES)("shows the synthetic persona, role and sign-out in a disclosure (%s)", (l) => {
    const name = msg(l)["persona.name.secretaryAlpha"];
    const role = msg(l)["persona.role.committeeSecretary"];
    const html = render(<PersonaMenu t={tr(l)} name={name} roleLabel={role} signOutAction={noop} />);
    expect(html).toMatch(/<details class="v13-disclosure v13-persona-menu" data-testid="persona-menu">/);
    expect(html).toContain(`aria-label="${esc(msg(l)["shell.persona.menuLabel"])}"`);
    expect(html).toContain(`data-testid="persona-menu-name">${name}<`);
    expect(html).toContain(`data-testid="persona-menu-role">${role}<`);
    expect(html).toContain(msg(l)["shell.persona.synthetic"]);
    expect(html).toMatch(/<button type="submit"[^>]*data-testid="sign-out">/);
  });

  it("escapes the names it is given", () => {
    const html = render(
      <PersonaMenu t={tr("en")} name={'<img src=x onerror="x">'} roleLabel="r" signOutAction={noop} />,
    );
    expect(html).not.toContain("<img");
  });
});

describe("Breadcrumbs", () => {
  it.each(LOCALES)(
    "is a labelled nav with an ordered list; the last item is current and not a link (%s)",
    (l) => {
      const html = render(
        <Breadcrumbs
          t={tr(l)}
          items={[
            { href: "/portfolio", label: "Portfolio" },
            { href: `/cases/${CASE_1.id}`, label: <bdi dir="ltr">{CASE_1.ref}</bdi> },
            { label: "Tasks" },
          ]}
        />,
      );
      expect(html).toContain(
        `<nav class="v13-breadcrumbs" aria-label="${esc(msg(l)["shell.breadcrumbs.label"])}" data-testid="breadcrumbs"><ol>`,
      );
      expect(html.match(/<li>/g)).toHaveLength(3);
      expect(html).toContain('<span aria-current="page">Tasks</span>');
      expect(html).not.toMatch(/<a[^>]*>Tasks/);
      expect(html).toContain(`<bdi dir="ltr">${CASE_1.ref}</bdi>`);
      // Two separators, decorative and mirrored in RTL.
      expect(html.match(/v13-icon-mirror v13-breadcrumb-sep/g)).toHaveLength(2);
    },
  );

  it("renders nothing without items", () => {
    expect(render(<Breadcrumbs t={tr("ar")} items={[]} />)).toBe("");
  });
});

describe("PageHeading", () => {
  it("is the page's only h1, focusable for the post-switch focus move, with actions at the end", () => {
    const html = render(<PageHeading title="My Work" subtitle="Secretariat" actions={<a href="/x">x</a>} />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 id="page-title" tabindex="-1">My Work</h1>');
    expect(html).toContain('<p class="v13-lead">Secretariat</p>');
    expect(html).toContain('<div class="v13-page-actions"><a href="/x">x</a></div>');
  });
});

describe("CaseWorkspace and CaseHeader (ADR-013 case evidence)", () => {
  const header = (l: Locale, extra: Partial<React.ComponentProps<typeof CaseHeader>> = {}) => (
    <CaseHeader
      t={tr(l)}
      caseId={CASE_1.id}
      caseRef={CASE_1.ref}
      title="Synthetic case title"
      stage={<span id="stage-badge" />}
      recordsState="ACTIVE"
      {...extra}
    />
  );

  it.each(LOCALES)("root and header both carry data-case-id and data-case-ref of the same case (%s)", (l) => {
    const html = render(
      <CaseWorkspace caseId={CASE_1.id} caseRef={CASE_1.ref}>
        {header(l)}
      </CaseWorkspace>,
    );
    expect(html).toMatch(
      new RegExp(
        `^<div class="v13-case-workspace" data-testid="case-workspace" data-case-id="${CASE_1.id}" data-case-ref="${CASE_1.ref}">`,
      ),
    );
    expect(html).toContain(
      `<header class="v13-case-header" data-testid="case-header" data-case-id="${CASE_1.id}" data-case-ref="${CASE_1.ref}">`,
    );
    expect(html.match(/data-case-id="/g)).toHaveLength(2);
    expect(new Set(html.match(/data-case-id="[^"]*"/g))).toEqual(new Set([`data-case-id="${CASE_1.id}"`]));
  });

  it.each(LOCALES)(
    "shows the display number Latin in <bdi dir=ltr>, the stage slot and the records state in words (%s)",
    (l) => {
      const html = render(header(l));
      expect(html).toContain(`<bdi dir="ltr" data-testid="case-number">${CASE_1.ref}</bdi>`);
      expect(html).toContain('<dd data-testid="case-stage"><span id="stage-badge"></span></dd>');
      expect(html).toContain('data-records-state="ACTIVE"');
      expect(html).toContain(msg(l)["common.records.active"]);
      expect(html).not.toContain("case-closed-notice");
      expect(html).not.toContain("case-restricted");
      expect(html).not.toMatch(/<h1/);
    },
  );

  it.each(LOCALES)(
    "closed: glyph + word and the read-only notice; restricted and capacity shown with words (%s)",
    (l) => {
      const html = render(
        header(l, {
          recordsState: "CLOSED",
          restricted: true,
          capacity: msg(l)["persona.role.investigator"],
        }),
      );
      expect(html).toContain('data-records-state="CLOSED"');
      expect(html).toContain(msg(l)["common.records.closed"]);
      expect(html).toContain(`data-testid="case-closed-notice">${esc(msg(l)["shell.case.closedNotice"])}`);
      expect(html).toMatch(/data-testid="case-restricted"><svg[^>]*aria-hidden="true"/);
      expect(html).toContain(msg(l)["shell.case.restricted"]);
      expect(html).toContain(tr(l)("shell.case.capacity", { capacity: msg(l)["persona.role.investigator"] }));
    },
  );

  it("refuses a display number as the key and a UUID as the display number", () => {
    expect(() =>
      render(
        <CaseWorkspace caseId={CASE_1.ref} caseRef={CASE_1.ref}>
          {null}
        </CaseWorkspace>,
      ),
    ).toThrow(/UUID/);
    expect(() =>
      render(
        <CaseWorkspace caseId={CASE_1.id} caseRef={CASE_1.id}>
          {null}
        </CaseWorkspace>,
      ),
    ).toThrow(/display number/);
    expect(() => render(header("en", { caseId: "" }))).toThrow(/UUID/);
    expect(() => render(header("en", { caseRef: "" }))).toThrow(/display number/);
  });

  it("accepts only the contract's lowercase RFC 9562 UUID and synthetic CDF-DEMO-2026 display number", () => {
    expect(() => render(header("en", { caseId: CASE_1.id.toUpperCase() }))).toThrow(/UUID/);
    expect(() => render(header("en", { caseId: "6f1c2a40-0000-0000-0000-000000000001" }))).toThrow(/UUID/);
    expect(() => render(header("en", { caseRef: "CDF-PROD-2026-0001" }))).toThrow(/display number/);
    expect(() => render(header("en", { caseRef: "CDF-DEMO-2025-0001" }))).toThrow(/display number/);
    expect(() => render(header("en", {}))).not.toThrow();
  });
});

describe("CaseTabs", () => {
  it.each(LOCALES)("are links in a labelled nav with aria-current on the open tab (%s)", (l) => {
    const base = `/cases/${CASE_1.id}`;
    const html = render(
      <CaseTabs
        t={tr(l)}
        current="tasks"
        tabs={[
          { key: "overview", href: base, label: "O" },
          { key: "events", href: `${base}/events`, label: "E" },
          { key: "tasks", href: `${base}/tasks`, label: "T" },
          { key: "notifications", href: `${base}/notifications`, label: "N" },
        ]}
      />,
    );
    expect(html).toContain(`aria-label="${esc(msg(l)["shell.case.sectionsLabel"])}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain(`<a href="${base}/tasks" aria-current="page" data-testid="case-tab-tasks">T</a>`);
    for (const k of ["overview", "events", "notifications"])
      expect(html).toContain(`data-testid="case-tab-${k}"`);
  });
});

describe("AppShell", () => {
  it.each(LOCALES)(
    "frame form: TopBar, SideNav, breadcrumbs, then the skip-link target main#main (%s)",
    (l) => {
      const html = render(
        <AppShell
          t={tr(l)}
          topBar={<header id="tb" />}
          sideNav={<nav id="sn" />}
          breadcrumbs={<nav id="bc" />}
        >
          <p>child</p>
        </AppShell>,
      );
      expect(html).toContain('data-testid="app-shell"');
      const order = ['id="tb"', 'id="sn"', 'id="bc"', '<main id="main"'].map((s) => html.indexOf(s));
      expect(order.every((v) => v >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(html).toContain('<main id="main" class="v13-main" tabindex="-1"><p>child</p></main>');
      expect(html).toContain("v13-app-body-with-nav");
      expect(html).not.toContain("v13-session-bar");
    },
  );

  it("frame form without SideNav uses the single-column body", () => {
    const html = render(
      <AppShell t={tr("ar")} topBar={<header />}>
        {null}
      </AppShell>,
    );
    expect(html).not.toContain("v13-app-body-with-nav");
    expect(html.match(/<main/g)).toHaveLength(1);
  });
});

describe("shell styles stay logical (DESIGN_SYSTEM.md §5)", () => {
  const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  const shellFiles = readdirSync(join(ROOT, "components/shell")).map((f) =>
    join(ROOT, "components/shell", f),
  );
  it("no physical Tailwind utilities or left/right in shell component classes", () => {
    for (const f of [
      ...shellFiles,
      join(ROOT, "components/icons/index.tsx"),
      join(ROOT, "components/data/Count.tsx"),
    ]) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)) {
        expect(m[1], f).not.toMatch(
          /(^|\s)-?(ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r)(-|\s|$)/,
        );
      }
    }
  });
});
