// Server Action forms work with JavaScript off (V13-QA-021; OI-056, V13-ARCH-013). With `Referrer-Policy: no-referrer`
// a browser sends `Origin: null` on a form POST that is a navigation, and Next's Server Actions origin check refused
// every such submission with a 500, so persona sign-in never reached My Work without JavaScript. The fix is the
// `same-origin` policy (next.config.ts), never a wider origin check. These tests submit real forms in a browser with
// JavaScript disabled and pin both halves: the POST carries the app's own origin, and the action completes.
// SYNTHETIC personas only.
import { expect, test, type Page, type Request } from "@playwright/test";
import { sessionCookie } from "../fixtures/personas";

test.use({ javaScriptEnabled: false });

/** Submits by clicking `submit`, and returns the form POST the click sent (a navigation, not a fetch). */
async function submitForm(page: Page, submit: string): Promise<Request> {
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.method() === "POST" && r.isNavigationRequest()),
    page.getByTestId(submit).click(),
  ]);
  return request;
}

/** The POST carried the app's own origin, never `null`, and was answered without a server error. */
async function expectSameOriginPost(request: Request, baseURL: string) {
  const headers = await request.allHeaders();
  expect(headers.origin, "the form POST carries the app's origin").toBe(new URL(baseURL).origin);
  const response = await request.response();
  expect(response, "the POST was answered").not.toBeNull();
  expect(response!.status(), "the Server Action did not fail").toBeLessThan(500);
}

test.describe("no JavaScript: Server Action forms (V13-QA-021)", () => {
  test("the browser really runs no JavaScript (the control)", async ({ page }) => {
    // The TopBar's workspace menu is a <details> that opens natively; its client script (components/shell/Disclosure)
    // closes it on a click outside. Here it must stay open: no script ran. With JavaScript on, this test fails.
    await page.goto("/sign-in");
    await page.getByTestId("persona-governance-officer-delta").click();
    await expect(page).toHaveURL(/\/my-work$/);
    const menu = page.locator('details:has([data-testid="workspace-menu-all"])');
    await page.getByTestId("workspace-switcher").click();
    await expect(menu).toHaveAttribute("open", "");
    await page.getByTestId("my-work-workspace").click();
    await expect(menu).toHaveAttribute("open", "");
  });

  test("persona sign-in reaches My Work with the session cookie set", async ({ page, context, baseURL }) => {
    await page.goto("/sign-in");
    expect(await sessionCookie(context)).toBeUndefined();

    const request = await submitForm(page, "persona-secretary-alpha");
    await expectSameOriginPost(request, baseURL!);

    await expect(page).toHaveURL(/\/my-work$/);
    await expect(page.getByTestId("my-work-workspace")).toBeVisible();
    const cookie = await sessionCookie(context);
    expect(cookie?.value, "the session cookie is set").toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
  });

  test("Governance Officer Delta switches workspace on /workspaces", async ({ page, context, baseURL }) => {
    await page.goto("/sign-in");
    await expectSameOriginPost(await submitForm(page, "persona-governance-officer-delta"), baseURL!);
    await expect(page).toHaveURL(/\/my-work$/);
    const before = (await sessionCookie(context))?.value;
    expect(before).toBeTruthy();

    await page.goto("/workspaces");
    await expect(page.getByTestId("workspace-option-GOVERNANCE")).toHaveAttribute("aria-current", "true");
    const request = await submitForm(page, "workspace-go-SECRETARIAT");
    await expectSameOriginPost(request, baseURL!);

    await expect(page).toHaveURL(/\/my-work\?switched=1$/);
    await expect(page.getByTestId("workspace-switched")).toBeVisible();
    const after = (await sessionCookie(context))?.value;
    expect(after, "the switch reissued the session").toBeTruthy();
    expect(after).not.toBe(before);
    await page.goto("/workspaces");
    await expect(page.getByTestId("workspace-option-SECRETARIAT")).toHaveAttribute("aria-current", "true");
  });
});
