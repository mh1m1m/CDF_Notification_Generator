// Localisation for the V13 platform. Arabic (RTL) is the primary language and the default; English (LTR) is
// secondary. Every user-facing string comes from these dictionaries; components never hard-code text.
//
// Dictionaries are split into namespaces, one directory per namespace (lib/i18n/<ns>/ar.ts and en.ts), each owned by
// one team. All namespaces are registered here up front (an empty one is `{}`), and a message is addressed as
// "<ns>.<key>", for example "auth.signIn.heading". en.ts is typed against ar.ts, so a missing or extra key fails
// typecheck; tests/unit/i18n.spec.ts checks the same at run time.
import type { RoleCode, WorkspaceCode } from "@/lib/contracts";
import { ar as authAr } from "./auth/ar";
import { en as authEn } from "./auth/en";
import { ar as caseAr } from "./case/ar";
import { en as caseEn } from "./case/en";
import { ar as commonAr } from "./common/ar";
import { en as commonEn } from "./common/en";
import { ar as journeysAr } from "./journeys/ar";
import { en as journeysEn } from "./journeys/en";
import { ar as myWorkAr } from "./myWork/ar";
import { en as myWorkEn } from "./myWork/en";
import { ar as notificationsAr } from "./notifications/ar";
import { en as notificationsEn } from "./notifications/en";
import { ar as personaAr } from "./persona/ar";
import { en as personaEn } from "./persona/en";
import { ar as portfolioAr } from "./portfolio/ar";
import { en as portfolioEn } from "./portfolio/en";
import { ar as shellAr } from "./shell/ar";
import { en as shellEn } from "./shell/en";
import { ar as statusAr } from "./status/ar";
import { en as statusEn } from "./status/en";
import { ar as workspacesAr } from "./workspaces/ar";
import { en as workspacesEn } from "./workspaces/en";

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";
/** Cookie holding the chosen locale. Not a secret; read on the server for <html lang dir>. */
export const LOCALE_COOKIE = "v13_locale";

/**
 * Every namespace with its Arabic and English dictionary. Owners: UX common, shell; PROC status, journeys; FE auth,
 * portfolio, case, myWork, notifications, workspaces; ARCH persona.
 */
export const I18N_NAMESPACES = {
  common: { ar: commonAr, en: commonEn },
  shell: { ar: shellAr, en: shellEn },
  status: { ar: statusAr, en: statusEn },
  journeys: { ar: journeysAr, en: journeysEn },
  auth: { ar: authAr, en: authEn },
  portfolio: { ar: portfolioAr, en: portfolioEn },
  case: { ar: caseAr, en: caseEn },
  myWork: { ar: myWorkAr, en: myWorkEn },
  notifications: { ar: notificationsAr, en: notificationsEn },
  workspaces: { ar: workspacesAr, en: workspacesEn },
  persona: { ar: personaAr, en: personaEn },
} as const;

export type NamespaceId = keyof typeof I18N_NAMESPACES;
type NamespaceKey<N extends NamespaceId> = Extract<keyof (typeof I18N_NAMESPACES)[N]["ar"], string>;
/** "<ns>.<key>" for every key of every namespace. */
export type MessageKey = { [N in NamespaceId]: `${N}.${NamespaceKey<N>}` }[NamespaceId];
export type Messages = Readonly<Record<MessageKey, string>>;

function flatten(locale: Locale): Messages {
  const out: Record<string, string> = {};
  for (const [ns, dictionaries] of Object.entries(I18N_NAMESPACES)) {
    const dictionary: Readonly<Record<string, string>> = dictionaries[locale];
    for (const [key, value] of Object.entries(dictionary)) out[`${ns}.${key}`] = value;
  }
  return Object.freeze(out) as Messages;
}

const MESSAGES: Readonly<Record<Locale, Messages>> = Object.freeze({ ar: flatten("ar"), en: flatten("en") });

/** Any value other than exactly "en" resolves to Arabic, the default. */
export function resolveLocale(value: string | null | undefined): Locale {
  return value === "en" ? "en" : DEFAULT_LOCALE;
}

export function otherLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar";
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** The flat dictionary of a locale ("<ns>.<key>" → text). */
export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale];
}

export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(MESSAGES.ar, key);
}

export type Translator = (key: MessageKey, vars?: Readonly<Record<string, string>>) => string;

/** Replaces {name} placeholders. Unknown placeholders stay visible so a missing value is noticed. */
function interpolate(template: string, vars?: Readonly<Record<string, string>>): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? (vars[name] ?? match) : match,
  );
}

export function createTranslator(locale: Locale): Translator {
  const messages = MESSAGES[locale];
  return (key, vars) => interpolate(messages[key], vars);
}

/**
 * Translates a key that is only known at runtime (for example a persona's name_key). A key missing from the
 * dictionaries is returned as-is, so the gap is visible instead of silently blank.
 */
export function translateKey(locale: Locale, key: string, vars?: Readonly<Record<string, string>>): string {
  return isMessageKey(key) ? interpolate(MESSAGES[locale][key], vars) : key;
}

/** Message keys of the workspace names (namespace "workspaces"). */
export const WORKSPACE_NAME_KEYS = Object.freeze({
  SECRETARIAT: "workspaces.name.secretariat",
  INVESTIGATIONS: "workspaces.name.investigations",
  GOVERNANCE: "workspaces.name.governance",
} as const satisfies Record<WorkspaceCode, MessageKey>);

/** Message keys of the role names (namespace "persona"). */
export const ROLE_NAME_KEYS = Object.freeze({
  COMMITTEE_SECRETARY: "persona.role.committeeSecretary",
  INVESTIGATOR: "persona.role.investigator",
  GOVERNANCE_OFFICER: "persona.role.governanceOfficer",
} as const satisfies Record<RoleCode, MessageKey>);
