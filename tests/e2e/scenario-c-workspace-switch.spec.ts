// Scenario C — workspace switch (V13-QA-002; TEST_ARCHITECTURE.md §6, WORKSPACES.md §3, SCREENS S5, FE-002).
// Governance Officer Delta, the only persona with two memberships, switches GOVERNANCE ↔ SECRETARIAT through the
// TopBar switcher and /workspaces; every negative leaves the session exactly as it was: a workspace Delta is not a
// member of, a forged code, a single-membership persona, a negative-test persona. SYNTHETIC personas only.
// The database half (RLS re-derives the membership on every request) is covered by DB/SEC's suites.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createSessionToken } from "@/lib/auth/session";
import { messagesFor } from "@/lib/i18n";
import { persona, sessionCookie, SESSION_COOKIE, signInAs } from "../fixtures/personas";

const ar = messagesFor("ar");
const DELTA = "governance-officer-delta";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const switcher = (page: Page) => page.getByTestId("workspace-switcher");

/** Submits the switch form of `visible` after rewriting its hidden value to `forged` (a tampered POST). */
async function submitForged(page: Page, visible: string, forged: string) {
  await page.goto("/workspaces");
  const form = page.getByTestId(`workspace-option-${visible}`).locator("form");
  await form
    .locator('input[name="workspace"]')
    .evaluate((el, v) => ((el as HTMLInputElement).value = v), forged);
  await page.getByTestId(`workspace-go-${visible}`).click();
}

async function expectRefusedUnchanged(
  page: Page,
  context: BrowserContext,
  before: string | undefined,
  active: string,
) {
  await expect(page).toHaveURL(/\/my-work\?ref=/);
  const ref = new URL(page.url()).searchParams.get("ref");
  expect(ref).toMatch(UUID);
  await expect(page.getByTestId("action-error")).toContainText(ref!);
  await expect(page.getByTestId("workspace-switched")).toHaveCount(0);
  await expect(switcher(page)).toHaveAttribute("data-workspace-code", active);
  expect((await sessionCookie(context))?.value).toBe(before);
}

test.describe("Scenario C — Delta switches workspace", () => {
  test("GOVERNANCE → SECRETARIAT → GOVERNANCE through the switcher and /workspaces", async ({
    page,
    context,
  }) => {
    await signInAs(page, DELTA);
    await expect(switcher(page)).toHaveAttribute("data-workspace-code", "GOVERNANCE");
    await expect(page.getByTestId("my-work-workspace")).toHaveText(ar["workspaces.name.governance"]);
    const first = (await sessionCookie(context))?.value;

    await page.getByTestId("workspace-switcher-open").click();
    await expect(page).toHaveURL(/\/workspaces$/);
    const governance = page.getByTestId("workspace-option-GOVERNANCE");
    const secretariat = page.getByTestId("workspace-option-SECRETARIAT");
    await expect(page.locator('[data-testid^="workspace-option-"]')).toHaveCount(2);
    await expect(governance).toHaveAttribute("aria-current", "true");
    await expect(governance.getByTestId("workspace-current")).toHaveText(ar["workspaces.page.current"]);
    await expect(secretariat).not.toHaveAttribute("aria-current", /.*/);
    await expect(page.getByTestId("workspace-go-GOVERNANCE")).toHaveCount(0);

    await page.getByTestId("workspace-go-SECRETARIAT").click();
    await expect(page).toHaveURL(/\/my-work\?switched=1$/);
    await expect(page.getByTestId("workspace-switched")).toHaveText(
      ar["workspaces.switched"].replace("{name}", ar["workspaces.name.secretariat"]),
    );
    await expect(switcher(page)).toHaveAttribute("data-workspace-code", "SECRETARIAT");
    await expect(page.getByTestId("my-work-workspace")).toHaveText(ar["workspaces.name.secretariat"]);
    const second = (await sessionCookie(context))?.value;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    // The new workspace survives a reload (it is in the session, not in the URL).
    await page.goto("/my-work");
    await expect(switcher(page)).toHaveAttribute("data-workspace-code", "SECRETARIAT");
    await expect(page.getByTestId("workspace-switched")).toHaveCount(0);

    await page.goto("/workspaces");
    await expect(page.getByTestId("workspace-option-SECRETARIAT")).toHaveAttribute("aria-current", "true");
    await page.getByTestId("workspace-go-GOVERNANCE").click();
    await expect(page).toHaveURL(/\/my-work\?switched=1$/);
    await expect(switcher(page)).toHaveAttribute("data-workspace-code", "GOVERNANCE");
  });

  test("the announcement names the session's workspace, never a value from the URL", async ({ page }) => {
    await signInAs(page, DELTA);
    await page.goto("/my-work?switched=1&workspace=INVESTIGATIONS");
    await expect(page.getByTestId("workspace-switched")).toHaveText(
      ar["workspaces.switched"].replace("{name}", ar["workspaces.name.governance"]),
    );
  });
});

test.describe("Scenario C — negatives leave the session unchanged", () => {
  test("Delta → INVESTIGATIONS (not a member, forged POST) is refused with a reference", async ({
    page,
    context,
  }) => {
    await signInAs(page, DELTA);
    const before = (await sessionCookie(context))?.value;
    await submitForged(page, "SECRETARIAT", "INVESTIGATIONS");
    await expectRefusedUnchanged(page, context, before, "GOVERNANCE");
  });

  for (const forged of ["ROOT", "governance", "", "SECRETARIAT\u0000", "GOVERNANCE,SECRETARIAT"]) {
    test(`a forged workspace code ${JSON.stringify(forged)} is refused`, async ({ page, context }) => {
      await signInAs(page, DELTA);
      const before = (await sessionCookie(context))?.value;
      await submitForged(page, "SECRETARIAT", forged);
      await expectRefusedUnchanged(page, context, before, "GOVERNANCE");
    });
  }

  test("Investigator Beta (one membership): the switcher is text, /workspaces offers nothing to switch to", async ({
    page,
  }) => {
    await signInAs(page, "investigator-beta");
    await expect(switcher(page)).toHaveAttribute("data-workspace-code", "INVESTIGATIONS");
    await expect(page.getByTestId("workspace-switcher-open")).toHaveCount(0);
    await expect(page.getByTestId("nav-notifications")).toHaveCount(0); // ruling D6
    await page.goto("/workspaces");
    await expect(page.locator('[data-testid^="workspace-option-"]')).toHaveCount(1);
    await expect(page.getByTestId("workspace-option-INVESTIGATIONS")).toHaveAttribute("aria-current", "true");
    await expect(page.locator('[data-testid^="workspace-go-"]')).toHaveCount(0);
  });

  test("Investigator Beta cannot switch into SECRETARIAT by replaying Delta's switch form", async ({
    page,
    context,
    browser,
  }) => {
    const baseURL = test.info().project.use.baseURL!;
    // Delta's page carries the progressive-enhancement fields of the switch form (the Server Action id).
    const other = await browser.newContext({ baseURL });
    const deltaPage = await other.newPage();
    await signInAs(deltaPage, DELTA);
    await deltaPage.goto("/workspaces");
    const fields = await deltaPage
      .getByTestId("workspace-option-SECRETARIAT")
      .locator("form input[type=hidden]")
      .evaluateAll((inputs) =>
        inputs.map((i): [string, string] => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]),
      );
    await other.close();
    expect(fields.some(([name]) => name.startsWith("$ACTION_ID_"))).toBe(true);

    await signInAs(page, "investigator-beta");
    const before = (await sessionCookie(context))?.value;
    const response = await page.request.post("/workspaces", {
      multipart: Object.fromEntries(fields),
      headers: { origin: new URL(baseURL).origin },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toMatch(/^\/my-work\?ref=[0-9a-f-]{36}$/);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(SESSION_COOKIE);
    expect((await sessionCookie(context))?.value).toBe(before);
    await page.goto("/my-work");
    await expect(switcher(page)).toHaveAttribute("data-workspace-code", "INVESTIGATIONS");
  });

  test("Secretary Epsilon (expired membership, minted session) cannot switch anywhere", async ({
    page,
    context,
  }) => {
    const secret = process.env.V13_E2E_SESSION_SECRET;
    test.skip(!secret, "needs the run's session secret (set by playwright.config.ts for local builds)");
    const epsilon = persona("secretary-epsilon");
    const token = await createSessionToken(
      { persona_id: epsilon.persona_id, active_workspace: "SECRETARIAT" },
      { env: { V13_SESSION_SECRET: secret, V13_PERSONA_SIGNIN: "enabled" } },
    );
    const baseURL = test.info().project.use.baseURL!;
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
    await page.goto("/workspaces");
    // Wherever the app lands (sign-in or an empty list), Epsilon is offered no workspace and keeps her token.
    await expect(page.locator('[data-testid^="workspace-go-"]')).toHaveCount(0);
    expect((await sessionCookie(context))?.value ?? token).toBe(token);
  });
});
