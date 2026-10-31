// OI-042: notFound() inside the authenticated shell renders app/(platform)/not-found.tsx, which must add no second
// <main> landmark and no second id="main" (the AppShell owns both), while reading exactly like the root not-found page
// (same visible text, same data-testid, same title) so a refused route and an unknown route cannot be told apart.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTranslator, type Locale } from "@/lib/i18n";

let locale: Locale = "ar";
vi.mock("@/lib/i18n/server", () => ({
  getTranslator: async () => ({ locale, t: createTranslator(locale) }),
  getLocale: async () => locale,
}));

const RootNotFound = (await import("@/app/not-found")).default;
const rootMeta = (await import("@/app/not-found")).generateMetadata;
const PlatformNotFound = (await import("@/app/(platform)/not-found")).default;
const platformMeta = (await import("@/app/(platform)/not-found")).generateMetadata;

const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

describe("platform not-found page (OI-042)", () => {
  for (const l of ["ar", "en"] as const) {
    it(`${l}: no main landmark, no id="main", keeps not-found-state and the home link`, async () => {
      locale = l;
      const html = renderToStaticMarkup(await PlatformNotFound());
      expect(html).not.toMatch(/<main\b/);
      expect(html).not.toMatch(/\bid="main"/);
      expect(html).not.toMatch(/role="main"/);
      expect(html).toContain('data-testid="not-found-state"');
      expect(html).toContain('data-testid="not-found-home"');
      expect(html.match(/<h1\b/g)).toHaveLength(1);
    });

    it(`${l}: same visible text and title as the root not-found page`, async () => {
      locale = l;
      const platform = renderToStaticMarkup(await PlatformNotFound());
      const root = renderToStaticMarkup(await RootNotFound());
      expect(text(platform)).toBe(text(root));
      expect(await platformMeta()).toEqual(await rootMeta());
    });
  }
});
