// Shell components rendered to static HTML with react-dom/server (node environment; no DOM emulation, no Testing
// Library). All text must come from the dictionaries, in both languages.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/shell/AppShell";
import { LocaleToggle } from "@/components/shell/LocaleToggle";
import { SyntheticBanner } from "@/components/shell/SyntheticBanner";
import { createTranslator, messagesFor } from "@/lib/i18n";

const ar = createTranslator("ar");
const en = createTranslator("en");
const noopAction = async (_formData: FormData) => undefined;

describe("SyntheticBanner", () => {
  it("states the classification in the active language, as a note", () => {
    const html = renderToStaticMarkup(<SyntheticBanner t={ar} />);
    expect(html).toContain('role="note"');
    expect(html).toContain('data-testid="synthetic-banner"');
    expect(html).toContain(messagesFor("ar")["common.banner.synthetic"]);
    expect(renderToStaticMarkup(<SyntheticBanner t={en} />)).toContain(
      "Synthetic data — reference implementation — not CDF production",
    );
  });
});

describe("AppShell", () => {
  it("shows persona and workspace in a labelled session bar, then the skip-link target <main id=main>", () => {
    const html = renderToStaticMarkup(
      <AppShell t={en} personaName="Secretary Alpha" workspaceName="Committee Secretariat">
        <p>child content</p>
      </AppShell>,
    );
    expect(html).toContain(`aria-label="${messagesFor("en")["shell.sessionLabel"]}"`);
    expect(html).toContain('data-testid="app-shell"');
    expect(html).toMatch(/<dd data-testid="shell-persona">Secretary Alpha<\/dd>/);
    expect(html).toMatch(/<dd data-testid="shell-workspace">Committee Secretariat<\/dd>/);
    expect(html).toMatch(/<main id="main" class="v13-main" tabindex="-1"><p>child content<\/p><\/main>/);
  });

  it("escapes the names it is given", () => {
    const html = renderToStaticMarkup(
      <AppShell t={ar} personaName={'<script>alert("x")</script>'} workspaceName="أمانة اللجنة">
        {null}
      </AppShell>,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(`aria-label="${messagesFor("ar")["shell.sessionLabel"]}"`);
  });
});

describe("LocaleToggle", () => {
  it("names the other language in that language and posts it as a hidden field", () => {
    const toEnglish = renderToStaticMarkup(<LocaleToggle t={ar} target="en" action={noopAction} />);
    expect(toEnglish).toContain('<input type="hidden" name="locale" value="en"/>');
    expect(toEnglish).toMatch(/<button[^>]*lang="en"[^>]*data-testid="locale-toggle"[^>]*>English<\/button>/);

    const toArabic = renderToStaticMarkup(<LocaleToggle t={en} target="ar" action={noopAction} />);
    expect(toArabic).toContain('value="ar"');
    expect(toArabic).toMatch(/lang="ar"[^>]*>العربية<\/button>/);
  });
});
