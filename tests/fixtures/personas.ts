// Persona sign-in for QA's browser suites (ADR-004). Personas come from lib/contracts (the mirror of the database
// seed); listed personas sign in through the real sign-in page; negative-test personas (expired membership, inactive)
// are never listed, so their sessions are minted with createSessionToken and the run's session secret (ARCH, review
// of PR #1). SYNTHETIC identities only.
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { PERSONAS, type Persona, type WorkspaceCode } from "@/lib/contracts";

export const SESSION_COOKIE = SESSION_COOKIE_NAME;

export function persona(slug: string): Persona {
  const found = PERSONAS.find((p) => p.slug === slug);
  if (!found) throw new Error(`unknown synthetic persona slug: ${slug}`);
  return found;
}

export const signInPersonas = (): Persona[] => PERSONAS.filter((p) => !p.negative_test);
export const negativePersonas = (): Persona[] => PERSONAS.filter((p) => p.negative_test);

/** Signs in through the sign-in page and waits for My Work. */
export async function signInAs(page: Page, slug: string): Promise<Persona> {
  const p = persona(slug);
  if (p.negative_test) throw new Error(`${slug} is a negative-test persona; use a minted session`);
  await page.goto("/sign-in");
  await page.getByTestId(`persona-${p.slug}`).click();
  await expect(page).toHaveURL(/\/my-work$/);
  return p;
}

/** The session cookie of the context, if any. */
export async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
}

/**
 * Gives the context a session for a negative-test persona (expired membership, inactive persona), minted with the
 * run's session secret, because persona sign-in never offers them. Returns the token. Needs V13_E2E_SESSION_SECRET,
 * which playwright.config.ts sets for locally started builds.
 */
export async function mintSession(
  context: BrowserContext,
  baseURL: string,
  slug: string,
  workspace: WorkspaceCode,
): Promise<string> {
  const secret = process.env.V13_E2E_SESSION_SECRET;
  if (!secret) throw new Error("minting a session needs V13_E2E_SESSION_SECRET (a locally started build)");
  const p = persona(slug);
  const token = await createSessionToken(
    { persona_id: p.persona_id, active_workspace: workspace },
    { env: { V13_SESSION_SECRET: secret, V13_PERSONA_SIGNIN: "enabled" } },
  );
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: new URL(baseURL).hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return token;
}
