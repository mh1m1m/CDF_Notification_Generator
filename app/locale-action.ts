"use server";
// Stores the chosen locale. Setting a cookie in a Server Action re-renders the current page with the new <html lang dir>.
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export async function switchLocale(formData: FormData): Promise<void> {
  const locale = resolveLocale(String(formData.get("locale") ?? ""));
  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}
