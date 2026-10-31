// Session helpers bound to the current request (Server Components, Server Actions, Route Handlers). The token logic
// lives in ./session.ts, which proxy.ts also uses; this file adds Next's cookies() and per-request memoisation.
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { expireSessionCookie, readSession, writeSessionCookie, type Session } from "./session";

/** The verified session of this request, or null. Verified once per request render. */
export const getCurrentSession = cache(async (): Promise<Session | null> => readSession(await cookies()));

/**
 * Server Actions and Route Handlers only (Next allows cookie writes there). `maxAge` is the remaining lifetime of a
 * re-issued token (reissueSessionToken); omitted, the cookie lasts a full new session.
 */
export async function setSessionCookie(token: string, maxAge?: number): Promise<void> {
  writeSessionCookie(await cookies(), token, maxAge);
}

/** Server Actions and Route Handlers only. */
export async function clearSessionCookie(): Promise<void> {
  expireSessionCookie(await cookies());
}
