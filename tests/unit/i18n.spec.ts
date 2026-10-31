// i18n namespaces: registration, key parity between Arabic and English at run time, key format, translation helpers.
import { describe, expect, it } from "vitest";
import { I18N_KEY_PATTERN, PERSONAS, ROLE_CODES, WORKSPACE_CODES } from "@/lib/contracts";
import {
  createTranslator,
  DEFAULT_LOCALE,
  dirFor,
  I18N_NAMESPACES,
  isMessageKey,
  messagesFor,
  otherLocale,
  resolveLocale,
  ROLE_NAME_KEYS,
  translateKey,
  WORKSPACE_NAME_KEYS,
} from "@/lib/i18n";

describe("namespaces", () => {
  it("registers every namespace up front", () => {
    expect(Object.keys(I18N_NAMESPACES)).toEqual([
      "common",
      "shell",
      "status",
      "journeys",
      "auth",
      "portfolio",
      "case",
      "myWork",
      "notifications",
      "workspaces",
      "persona",
      "notificationRender",
    ]);
  });

  it.each(Object.entries(I18N_NAMESPACES))("%s: English has exactly the Arabic keys", (_ns, { ar, en }) => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
  });

  it.each(Object.entries(I18N_NAMESPACES))(
    "%s: keys are dotted camelCase and texts are non-empty",
    (ns, { ar, en }) => {
      for (const [key, text] of [...Object.entries(ar), ...Object.entries(en)] as [string, string][]) {
        expect(I18N_KEY_PATTERN.test(`${ns}.${key}`), `${ns}.${key}`).toBe(true);
        expect(text.trim().length, `${ns}.${key}`).toBeGreaterThan(0);
      }
    },
  );

  it("flattens every namespace into one dictionary per locale", () => {
    const total = Object.values(I18N_NAMESPACES).reduce((n, d) => n + Object.keys(d.ar).length, 0);
    expect(Object.keys(messagesFor("ar"))).toHaveLength(total);
    expect(Object.keys(messagesFor("en"))).toHaveLength(total);
  });

  it("has names for every persona, role and workspace", () => {
    for (const p of PERSONAS) expect(isMessageKey(p.name_key), p.name_key).toBe(true);
    for (const r of ROLE_CODES) expect(isMessageKey(ROLE_NAME_KEYS[r])).toBe(true);
    for (const w of WORKSPACE_CODES) expect(isMessageKey(WORKSPACE_NAME_KEYS[w])).toBe(true);
  });
});

describe("locale helpers", () => {
  it("defaults to Arabic, right to left", () => {
    expect(DEFAULT_LOCALE).toBe("ar");
    expect(resolveLocale(undefined)).toBe("ar");
    expect(resolveLocale("fr")).toBe("ar");
    expect(resolveLocale("EN")).toBe("ar");
    expect(resolveLocale("en")).toBe("en");
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
    expect(otherLocale("ar")).toBe("en");
  });

  it("translates and interpolates placeholders", () => {
    const en = createTranslator("en");
    const ar = createTranslator("ar");
    expect(en("auth.signIn.signInAs", { name: "Secretary Alpha" })).toBe("Sign in as Secretary Alpha");
    expect(ar("auth.signIn.signInAs", { name: "أمين السر ألفا" })).toBe("الدخول باسم أمين السر ألفا");
    expect(en("auth.signIn.signInAs")).toBe("Sign in as {name}");
    expect(en("auth.signIn.signInAs", {})).toBe("Sign in as {name}");
  });

  it("returns unknown runtime keys unchanged instead of blank", () => {
    expect(translateKey("en", "persona.name.secretaryAlpha")).toBe("Secretary Alpha");
    expect(translateKey("en", "persona.name.unknown")).toBe("persona.name.unknown");
    expect(translateKey("en", "toString")).toBe("toString");
  });
});
