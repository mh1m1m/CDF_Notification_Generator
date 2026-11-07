// Persona sign-in for QA's browser suites (ADR-004). Personas come from lib/contracts (the mirror of the database
// seed); listed personas sign in through the real sign-in page; negative-test personas (expired membership, inactive)
// are never listed, so their sessions are minted with createSessionToken and the run's session secret (ARCH, review
// of PR #1). SYNTHETIC identities only.
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
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

/** How long the sign-in page's `load` event may lag behind its document before the lag is recorded. */
export const LOAD_GRACE_MS = 5_000;
/** The attachment that names the subresources still pending when `load` had not fired (V13-QA-025). */
export const NAVIGATION_STALL_ATTACHMENT = "navigation-stall";

export interface PendingRequest {
  readonly type: string;
  /** Path and query only: no origin, header, cookie or body ever reaches the attachment. */
  readonly path: string;
  readonly ms: number;
}

/**
 * Opens the sign-in page (V13-QA-025). Waits for its document, not for its `load` event: in Firefox `load` has twice
 * failed to fire within the test timeout (CI 42390906101, 42394923906) on a page already painted, so a test hung on
 * a subresource the sign-in does not need. The persona buttons are Server Action forms that also work before
 * hydration (tests/e2e/no-js-server-actions.spec.ts), so signing in needs only the document. When `load` has not
 * fired after LOAD_GRACE_MS, the requests still pending are attached as `navigation-stall` and printed on one log
 * line, so the run names the stalled resource instead of hiding it.
 */
export async function openSignIn(page: Page): Promise<void> {
  const started = new Map<Request, { type: string; path: string; at: number }>();
  const add = (r: Request) => {
    const u = new URL(r.url());
    started.set(r, { type: r.resourceType(), path: `${u.pathname}${u.search}`, at: Date.now() });
  };
  const done = (r: Request) => started.delete(r);
  page.on("request", add);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  try {
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    const loaded = await page.waitForLoadState("load", { timeout: LOAD_GRACE_MS }).then(
      () => true,
      () => false,
    );
    if (!loaded) {
      const now = Date.now();
      const pending: PendingRequest[] = [...started.values()].map((r) => ({
        type: r.type,
        path: r.path,
        ms: now - r.at,
      }));
      // one line in the job log and in the JUnit report's system-err, which the cross-browser artifact keeps
      console.warn(
        `[${NAVIGATION_STALL_ATTACHMENT}] /sign-in: load not fired after ${LOAD_GRACE_MS} ms; pending: ` +
          (pending.map((r) => `${r.type} ${r.path} (${r.ms} ms)`).join(", ") || "none"),
      );
      await test.info().attach(NAVIGATION_STALL_ATTACHMENT, {
        contentType: "application/json",
        body: JSON.stringify({ page: "/sign-in", graceMs: LOAD_GRACE_MS, pending }),
      });
    }
  } finally {
    page.off("request", add);
    page.off("requestfinished", done);
    page.off("requestfailed", done);
  }
}

/** Signs in through the sign-in page and waits for My Work. */
export async function signInAs(page: Page, slug: string): Promise<Persona> {
  const p = persona(slug);
  if (p.negative_test) throw new Error(`${slug} is a negative-test persona; use a minted session`);
  await openSignIn(page);
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
