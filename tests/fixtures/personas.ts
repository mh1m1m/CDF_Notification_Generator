// Persona sign-in for QA's browser suites (ADR-004). Personas come from lib/contracts (the mirror of the database
// seed); listed personas sign in through the real sign-in page; negative-test personas (expired membership, inactive)
// are never listed, so their sessions are minted with createSessionToken and the run's session secret (ARCH, review
// of PR #1). SYNTHETIC identities only.
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { PERSONAS, type Persona } from "@/lib/contracts";

export const SESSION_COOKIE = "__Host-v13_session";

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
