// End-to-end smoke (desktop-ar): Arabic RTL by default with the synthetic-data banner, persona sign-in to My work,
// the session gate, cookie tampering, sign-out, the language switch and the security headers of a production build,
// including the per-request script nonce (threat TM-I13).
import { expect, test, type Page } from "@playwright/test";
import { RESOURCE_CONTENT_SECURITY_POLICY } from "@/lib/http/csp";
import { messagesFor } from "@/lib/i18n";

const ar = messagesFor("ar");
const en = messagesFor("en");
const SESSION_COOKIE = "__Host-v13_session";

/** One directive's value in a policy ("" when the directive is absent). */
const directive = (csp: string | undefined, name: string) =>
  (csp ?? "")
    .split("; ")
    .find((d) => d === name || d.startsWith(`${name} `))
    ?.slice(name.length + 1) ?? "";

const nonceOf = (csp: string | undefined) => /'nonce-([A-Za-z0-9+/]{22}==)'/.exec(csp ?? "")?.[1];

async function signInAsAlpha(page: Page) {
  await page.goto("/sign-in");
  await page.getByTestId("persona-secretary-alpha").click();
  await expect(page).toHaveURL(/\/my-work$/);
}

test("sign-in page: Arabic, right to left, synthetic banner, synthetic personas only", async ({ page }) => {
  const response = await page.goto("/sign-in");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("synthetic-banner")).toHaveText(ar["common.banner.synthetic"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ar["auth.signIn.heading"]);
  await expect(page.getByTestId("persona-list").getByRole("button")).toHaveCount(4);
  await expect(page.getByTestId("persona-secretary-epsilon")).toHaveCount(0);
  await expect(page.getByTestId("persona-persona-zeta")).toHaveCount(0);
});

test("production build sends the security headers and a fresh script nonce on every page", async ({
  page,
}) => {
  const response = await page.goto("/sign-in");
  const headers = response?.headers() ?? {};
  const csp = headers["content-security-policy"];
  const nonce = nonceOf(csp);
  expect(nonce).toBeDefined();
  expect(directive(csp, "script-src")).toBe(`'self' 'nonce-${nonce}' 'strict-dynamic'`);
  expect(directive(csp, "frame-ancestors")).toBe("'none'");
  expect(directive(csp, "object-src")).toBe("'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["x-powered-by"]).toBeUndefined();

  // Next.js put this request's nonce on every script tag it rendered.
  const scriptTags = (await response!.text()).match(/<script\b[^>]*>/g) ?? [];
  expect(scriptTags.length).toBeGreaterThan(0);
  for (const tag of scriptTags) expect(tag).toContain(`nonce="${nonce}"`);

  const again = nonceOf((await page.goto("/sign-in"))?.headers()["content-security-policy"]);
  expect(again).toBeDefined();
  expect(again).not.toBe(nonce);
});

test("the app runs under the nonce policy: no CSP violation from sign-in to My work", async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, "__cspViolations", { value: seen });
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await signInAsAlpha(page);
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/my-work$/);
  // React's inline flight data ran, so the nonce reached Next.js' inline scripts.
  expect(await page.evaluate(() => Array.isArray((self as unknown as { __next_f?: unknown }).__next_f))).toBe(
    true,
  );
  expect(
    await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations),
  ).toEqual([]);
});

test("without a session, protected pages redirect to sign-in", async ({ page }) => {
  await page.goto("/my-work");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("Secretary Alpha signs in to My work in the Secretariat, then signs out", async ({ page, context }) => {
  await signInAsAlpha(page);
  await expect(page.getByTestId("my-work-persona")).toHaveText(ar["persona.name.secretaryAlpha"]);
  await expect(page.getByTestId("my-work-roles")).toHaveText(ar["persona.role.committeeSecretary"]);
  await expect(page.getByTestId("my-work-workspace")).toHaveText(ar["workspaces.name.secretariat"]);
  await expect(page.getByTestId("shell-persona")).toHaveText(ar["persona.name.secretaryAlpha"]);

  const [cookie] = (await context.cookies()).filter((c) => c.name === SESSION_COOKIE);
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });

  // A signed-in persona visiting the sign-in page goes straight back to My work.
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/my-work$/);

  await page.getByTestId("persona-menu-button").click();
  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await context.cookies()).some((c) => c.name === SESSION_COOKIE)).toBe(false);
  await page.goto("/my-work");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("a tampered session cookie is refused and removed", async ({ page, context }) => {
  await signInAsAlpha(page);
  const [cookie] = (await context.cookies()).filter((c) => c.name === SESSION_COOKIE);
  expect(cookie).toBeDefined();
  const [header, payload, signature] = cookie!.value.split(".") as [string, string, string];
  const forgedPayload = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      persona_id: "0b000000-0000-4000-8000-000000000004",
    }),
  ).toString("base64url");
  await context.addCookies([{ ...cookie!, value: `${header}.${forgedPayload}.${signature}` }]);

  await page.goto("/my-work");
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await context.cookies()).some((c) => c.name === SESSION_COOKIE)).toBe(false);
});

test("the language switch turns the page into English, left to right, and back", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("synthetic-banner")).toHaveText(en["common.banner.synthetic"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["auth.signIn.heading"]);

  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("health endpoint is uncached and the isolation probe is off by default", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = await response.json();
  expect([200, 503]).toContain(response.status());
  expect(body).toMatchObject({ app: "v13-enterprise" });
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await request.get("/api/health/isolation")).status()).toBe(404);
});

test("responses the proxy never sees carry the resource policy, once", async ({ page, request }) => {
  await page.goto("/sign-in");
  const script = await page.locator('script[src^="/_next/static/"]').first().getAttribute("src");
  expect(script).toBeTruthy();
  for (const path of ["/api/health", "/api/health/isolation", script!]) {
    const response = await request.get(path);
    const policies = response
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "content-security-policy");
    expect(
      policies.map((h) => h.value),
      path,
    ).toEqual([RESOURCE_CONTENT_SECURITY_POLICY]);
    expect(response.headers()["x-content-type-options"], path).toBe("nosniff");
  }
});
