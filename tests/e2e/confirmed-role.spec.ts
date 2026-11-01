// V13-FE-008 (OI-044): the shell and My Work name a role only when the database confirms the membership in the
// request's security context. Secretary Epsilon (membership expired 2026-06-30) and Persona Zeta (inactive) still
// carry COMMITTEE_SECRETARY in SECRETARIAT in their (minted) sessions, but the database confirms nothing: no role in
// the switcher, no role line in the persona menu, and My Work says no role is confirmed. Secretary Alpha is the
// positive control. FE-committed at ARCH's request (relayed 1 Nov), for QA's review. SYNTHETIC personas only.
import { expect, test } from "@playwright/test";
import { messagesFor } from "@/lib/i18n";
import { mintSession, signInAs } from "../fixtures/personas";

const ar = messagesFor("ar");
const AS_WORD = ar["shell.workspace.roleHeld"].replace("{role}", "").trim();

for (const slug of ["secretary-epsilon", "persona-zeta"]) {
  test(`${slug}: no confirmed role anywhere (session roles are never shown)`, async ({ page, context }) => {
    test.skip(!process.env.V13_E2E_SESSION_SECRET, "needs the run's session secret (locally started build)");
    await mintSession(context, test.info().project.use.baseURL!, slug, "SECRETARIAT");
    expect((await page.goto("/my-work"))?.status()).toBe(200);
    await expect(page.getByTestId("my-work-roles")).toHaveText(ar["myWork.noConfirmedRole"]);
    await expect(page.getByTestId("persona-menu-role")).toHaveCount(0);
    const switcher = page.getByTestId("workspace-switcher");
    await expect(switcher).toBeVisible();
    await expect(switcher).not.toContainText(AS_WORD);
    await expect(switcher).not.toContainText(ar["persona.role.committeeSecretary"]);
    // QA nit on #81: the Workspaces page names no role either.
    expect((await page.goto("/workspaces"))?.status()).toBe(200);
    await expect(page.locator('[data-testid^="workspace-role-"]')).toHaveCount(0);
    await expect(page.getByTestId("workspaces-page")).not.toContainText(
      ar["persona.role.committeeSecretary"],
    );
  });
}

test("positive control: Secretary Alpha's confirmed role shows in My Work and the persona menu", async ({
  page,
}) => {
  await signInAs(page, "secretary-alpha");
  await page.goto("/my-work");
  const role = ar["persona.role.committeeSecretary"];
  await expect(page.getByTestId("my-work-roles")).toHaveText(role);
  await expect(page.getByTestId("persona-menu-role")).toHaveText(role);
  await expect(page.getByTestId("workspace-switcher")).toContainText(`${AS_WORD} ${role}`);
  await page.goto("/workspaces");
  await expect(page.getByTestId("workspace-role-SECRETARIAT")).toHaveText(
    ar["workspaces.page.roleHeld"].replace("{role}", role),
  );
});
