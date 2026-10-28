// The locale of the current request, from the v13_locale cookie (server only). Arabic unless the cookie says "en".
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createTranslator, LOCALE_COOKIE, resolveLocale, type Locale, type Translator } from "./index";

export const getLocale = cache(async (): Promise<Locale> =>
  resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value),
);

/** Locale and translator of the current request. */
export async function getTranslator(): Promise<{ locale: Locale; t: Translator }> {
  const locale = await getLocale();
  return { locale, t: createTranslator(locale) };
}
