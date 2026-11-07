// V13-QA-025: the sign-in page's `load` event is not what signing in waits for. Firefox twice left `load` pending past
// the test timeout on a painted page (CI 42390906101, 42394923906). Here a script the page loads is held back for the
// whole test, so `load` cannot fire: signing in must still reach My Work, and the run must name the held request in
// its `navigation-stall` attachment. The control: nothing held, no attachment. SYNTHETIC personas only.
import { expect, test } from "@playwright/test";
import {
  LOAD_GRACE_MS,
  NAVIGATION_STALL_ATTACHMENT,
  signInAs,
  type PendingRequest,
} from "../fixtures/personas";

const stalls = () => test.info().attachments.filter((a) => a.name === NAVIGATION_STALL_ATTACHMENT);

test("a sign-in page whose load never fires still signs in, and the held script is named", async ({
  page,
}) => {
  let held = "";
  await page.route(/\/_next\/static\/chunks\/[^/]+\.js$/, (route) => {
    if (held === "") {
      held = new URL(route.request().url()).pathname;
      return; // never fulfilled: the page's load event cannot fire
    }
    return route.continue();
  });
  const logged: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void logged.push(args.join(" "));
  const started = Date.now();
  try {
    await signInAs(page, "secretary-alpha");
  } finally {
    console.warn = warn;
  }
  expect(
    logged.filter((l) => l.startsWith(`[${NAVIGATION_STALL_ATTACHMENT}] /sign-in`)).join("\n"),
  ).toContain(held);
  await expect(page).toHaveURL(/\/my-work$/);
  expect(held, "a script was held back").not.toBe("");
  expect(Date.now() - started, "the wait is bounded by the grace period, not the test timeout").toBeLessThan(
    LOAD_GRACE_MS + 15_000,
  );
  const [stall, ...more] = stalls();
  expect(more).toEqual([]);
  const body = JSON.parse(stall!.body!.toString()) as {
    page: string;
    graceMs: number;
    pending: PendingRequest[];
  };
  expect(body.page).toBe("/sign-in");
  expect(body.graceMs).toBe(LOAD_GRACE_MS);
  expect(body.pending.map((p) => p.path)).toContain(held);
  expect(
    body.pending.map((p) => p.path),
    "finished requests are not listed: the document is",
  ).not.toContain("/sign-in");
  for (const p of body.pending) {
    expect(p.path, "a path, never an origin").toMatch(/^\//);
    expect(p.ms).toBeGreaterThanOrEqual(0);
  }
});

test("the control: a sign-in page that loads leaves no stall attachment", async ({ page }) => {
  await signInAs(page, "secretary-alpha");
  await expect(page).toHaveURL(/\/my-work$/);
  expect(stalls()).toEqual([]);
});
