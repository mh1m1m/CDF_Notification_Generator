// Shell workspace switcher menu (V13-UX-005; WORKSPACES.md §3, SCREENS S5, DESIGN_SYSTEM §2). Governance Officer
// Delta switches in place through the TopBar menu, which posts to the same Server Action as /workspaces. Keyboard:
// Escape closes the menu and returns focus to the control. Exactly one `workspace-switcher` per page, and the menu
// never reuses the /workspaces page ids. SYNTHETIC personas only; Scenario C keeps the page path and the negatives.
import { expect, test } from "@playwright/test";
import { messagesFor } from "@/lib/i18n";
import { sessionCookie, signInAs } from "../fixtures/personas";

const ar = messagesFor("ar");
const DELTA = "governance-officer-delta";

test.describe("Shell workspace menu", () => {
  test("Delta switches GOVERNANCE → SECRETARIAT → GOVERNANCE from the menu", async ({ page, context }) => {
    await signInAs(page, DELTA);
    const switcher = page.getByTestId("workspace-switcher");
    await expect(switcher).toHaveCount(1);
    await expect(switcher).toHaveAttribute("data-workspace-code", "GOVERNANCE");
    const first = (await sessionCookie(context))?.value;

    await switcher.click();
    await expect(page.getByTestId("workspace-menu-current")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("workspace-menu-current")).toHaveAttribute(
      "data-workspace-code",
      "GOVERNANCE",
    );
    await expect(page.locator('[data-testid^="workspace-menu-option-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="workspace-option-"]')).toHaveCount(0);
    const option = page.getByTestId("workspace-menu-option-SECRETARIAT");
    await expect(option).toHaveAccessibleName(
      new RegExp(ar["shell.workspace.switchTo"].replace("{name}", ar["workspaces.name.secretariat"])),
    );
    await option.click();

    await expect(page).toHaveURL(/\/my-work\?switched=1$/);
    await expect(page.getByTestId("workspace-switcher")).toHaveAttribute(
      "data-workspace-code",
      "SECRETARIAT",
    );
    await expect(page.getByTestId("my-work-workspace")).toHaveText(ar["workspaces.name.secretariat"]);
    expect((await sessionCookie(context))?.value).not.toBe(first);
    // The TopBar survives the navigation; choosing an item closed the menu.
    await expect(page.getByTestId("workspace-menu-option-GOVERNANCE")).toBeHidden();

    await page.getByTestId("workspace-switcher").click();
    await page.getByTestId("workspace-menu-option-GOVERNANCE").click();
    await expect(page).toHaveURL(/\/my-work\?switched=1$/);
    await expect(page.getByTestId("workspace-switcher")).toHaveAttribute("data-workspace-code", "GOVERNANCE");
  });

  test("keyboard: Enter opens, Escape closes and returns focus to the control", async ({ page }) => {
    await signInAs(page, DELTA);
    const switcher = page.getByTestId("workspace-switcher");
    await switcher.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("workspace-menu-option-SECRETARIAT")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("workspace-menu-option-SECRETARIAT")).toBeHidden();
    await expect(switcher).toBeFocused();
  });

  test("/workspaces carries one switcher and its own ids only", async ({ page }) => {
    await signInAs(page, DELTA);
    await page.goto("/workspaces");
    await expect(page.getByTestId("workspace-switcher")).toHaveCount(1);
    await expect(page.locator('[data-testid^="workspace-option-"]')).toHaveCount(2);
    await expect(page.getByTestId("workspace-current")).toHaveCount(1);
  });
});
