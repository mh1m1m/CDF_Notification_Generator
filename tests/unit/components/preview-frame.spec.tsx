// NotificationPreviewFrame (V13-UX-006): sandboxed srcdoc only, renderer output only, refusals without content.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPreviewFrame } from "@/components/data/NotificationPreviewFrame";
import { createTranslator, messagesFor, type Locale } from "@/lib/i18n";
import { buildDemo } from "../notifications/support/build_demo";

const LOCALES: readonly Locale[] = ["ar", "en"];
const docs: Record<string, string> = {};

beforeAll(async () => {
  const demo = await buildDemo();
  for (const [file, content] of demo.contents) {
    for (const surface of ["email", "platform"] as const) {
      for (const l of LOCALES) {
        const key = `${surface}-${l}`;
        if (!docs[key] && file.endsWith(`__${l}.${surface}.html`)) docs[key] = content;
      }
    }
  }
}, 60_000);

const render = (l: Locale, html: string, title = "Synthetic notice") =>
  renderToStaticMarkup(
    <NotificationPreviewFrame t={createTranslator(l)} rendered={{ html }} title={title} lang={l} />,
  );
const unescape = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("NotificationPreviewFrame — isolation", () => {
  it("has real renderer output for both surfaces and languages", () => {
    expect(Object.keys(docs).sort()).toEqual(["email-ar", "email-en", "platform-ar", "platform-en"]);
  });

  it.each(["email-ar", "email-en", "platform-ar", "platform-en"])(
    "puts %s into srcdoc of an iframe with an empty sandbox and no src",
    (key) => {
      const l = key.endsWith("-ar") ? "ar" : "en";
      const html = render(l, docs[key]!);
      const frame = html.match(/<iframe[^>]*>/)?.[0] ?? "";
      expect(frame).toMatch(/ sandbox=""/);
      expect(frame).not.toMatch(/ src=/);
      expect(frame).not.toMatch(/allow-/);
      expect(frame).toContain(`lang="${l}"`);
      expect(frame).toContain(`dir="${l === "ar" ? "rtl" : "ltr"}"`);
      expect(frame).toContain('title="Synthetic notice"');
      expect(frame).toMatch(/referrerpolicy="no-referrer"/i);
      const srcdoc = frame.match(/ srcDoc="([^"]*)"/i)?.[1];
      expect(srcdoc).toBeDefined();
      expect(unescape(srcdoc!)).toBe(docs[key]);
      // Nothing of the document reaches the page as markup: the only element-like text is inside the attribute.
      expect(html.replace(/ srcDoc="[^"]*"/i, "")).not.toMatch(/<html|<style|<script|<body/i);
    },
  );

  it("escapes a hostile string inside the document instead of injecting it", () => {
    const hostile = `<!DOCTYPE html><html><body><p data-marking="DESIGN_PREVIEW">x</p>"><script>alert(1)</script></body></html>`;
    const html = render("en", hostile);
    expect(html).not.toContain("<script>");
    expect(html.match(/<iframe/g)).toHaveLength(1);
  });

  it.each(LOCALES)("captions the frame as an isolated synthetic preview (%s)", (l) => {
    const html = render(l, docs[`platform-${l}`]!);
    expect(html).toMatch(/<figure class="v13-preview" data-testid="notification-preview">/);
    expect(html).toContain(messagesFor(l)["common.preview.caption"]);
  });

  it("is a server component that imports renderer types only", () => {
    const src = readFileSync("components/data/NotificationPreviewFrame.tsx", "utf8");
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/dangerouslySetInnerHTML=/);
    for (const line of src
      .split("\n")
      .filter((x) => /^import /.test(x) && /lib\/(notifications|disclosure|authority|server)/.test(x)))
      expect(line).toMatch(/^import type /);
  });
});

describe("NotificationPreviewFrame — refusals render nothing and log no content", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it.each([
    ["a fragment, not a document", '<p data-marking="DESIGN_PREVIEW">Employee Alpha</p>'],
    ["a document without the marking", "<!DOCTYPE html><html><body><p>Employee Alpha</p></body></html>"],
    ["an empty string", ""],
  ])("refuses %s", (_, html) => {
    expect(render("ar", html)).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("Employee Alpha");
  });

  it("refuses a missing html and an empty title", () => {
    expect(
      renderToStaticMarkup(
        <NotificationPreviewFrame
          t={createTranslator("ar")}
          rendered={{} as { html: string }}
          title="x"
          lang="ar"
        />,
      ),
    ).toBe("");
    expect(render("ar", docs["platform-ar"]!, "  ")).toBe("");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
