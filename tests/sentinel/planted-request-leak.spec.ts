// Acceptance self-test of the Sentinel's outbound half (V13-QA-007, OI-048; REQ-QA-013 "data submitted for the wrong
// case"): a request the page sends with a body (form post, Server Action call, fetch) may name only the case of the
// page that sent it (P3), and a body that cannot be read is never a pass (P4). Fixture pages only, served by
// Playwright routing on a test-only origin (tests/fixtures/synthetic-case-page.ts); no application code or database.
// SYNTHETIC data only.
import { expect, test, type Page } from "@playwright/test";
import { ALL_CASE_IDS, CASES, FIXTURE_ORIGIN } from "../fixtures/synthetic-case-page";
import {
  caseContextOf,
  formatViolations,
  recordRequests,
  requestText,
  type RequestAllowance,
} from "./sentinel";

const c1 = CASES.c0001;
const c2 = CASES.c0002;
const c9 = CASES.c0009;
const casePath = `/cases/${c1.id}/notifications`;
const allow: RequestAllowance = {
  refs: new Map([c1, c2, CASES.c0003].map((c) => [c.id, c.ref] as const)),
  knownCaseIds: ALL_CASE_IDS,
};
const rulesOf = (vs: { rule: string }[]) => [...new Set(vs.map((v) => v.rule))].sort();
const toArabicIndic = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

/**
 * Serves `body` (inside a page shell) on GET and a small page on every POST, records the requests, opens `path`, runs
 * `act` (which sends the request under test) and waits until the POST has been answered.
 */
async function sendFrom(page: Page, path: string, body: string, act: (page: Page) => Promise<void>) {
  await page.route(`${FIXTURE_ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body:
        route.request().method() === "GET"
          ? `<!doctype html><html lang="ar" dir="rtl"><head><title>t</title></head><body>${body}</body></html>`
          : "<!doctype html><html><head><title>ok</title></head><body>ok</body></html>",
    }),
  );
  const requests = recordRequests(page, FIXTURE_ORIGIN);
  await page.goto(`${FIXTURE_ORIGIN}${path}`);
  const answered = page.waitForResponse((r) => r.request().method() !== "GET");
  await act(page);
  await answered;
  return requests;
}

const form = (fields: Record<string, string>, enctype = "application/x-www-form-urlencoded", action = "") =>
  `<form method="post" enctype="${enctype}"${action ? ` action="${action}"` : ""}>${Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`)
    .join("")}<button data-testid="send">send</button></form>`;
const submit = (page: Page) => page.getByTestId("send").click();

test("caseContextOf reads the case from a case page URL only", () => {
  expect(caseContextOf(`${FIXTURE_ORIGIN}/cases/${c1.id}`)).toBe(c1.id);
  expect(caseContextOf(`${FIXTURE_ORIGIN}/cases/${c1.id.toUpperCase()}/tasks?x=1`)).toBe(c1.id);
  expect(caseContextOf(`${FIXTURE_ORIGIN}/portfolio`)).toBeNull();
  expect(caseContextOf(`${FIXTURE_ORIGIN}/cases/${c1.id}x`)).toBeNull();
  expect(caseContextOf("not a url")).toBeNull();
});

test("requestText also scans the percent-decoded URL and form body", () => {
  const text = requestText(
    "http://x/a?c=%D9%A0",
    "ref=CDF-DEMO-2026-%D9%A0%D9%A0%D9%A0%D9%A9",
    "application/x-www-form-urlencoded",
  );
  expect(text).toContain("CDF-DEMO-2026-٠٠٠٩");
  expect(requestText("http://x/", "a=%ZZ", "application/x-www-form-urlencoded")).toContain("a=%ZZ"); // bad escape kept
});

test.describe("clean requests pass", () => {
  test("a form post naming its own case only", async ({ page }) => {
    const r = await sendFrom(page, casePath, form({ case_id: c1.id, ref: c1.ref }), submit);
    expect(r.count()).toBe(1);
    expect(r.violations(allow), formatViolations(r.violations(allow))).toEqual([]);
  });

  test("a post off a case page that names no case; one that names an allowed case", async ({ page }) => {
    const r = await sendFrom(
      page,
      "/my-work",
      form({ task_id: "0d000000-0000-4000-8000-000000000001" }),
      submit,
    );
    expect(r.count()).toBe(1);
    expect(r.violations(allow)).toEqual([]);
  });

  test("a form post without fields has no body; it is scanned by its URL and passes", async ({ page }) => {
    const r = await sendFrom(page, casePath, form({}), submit);
    expect(r.count()).toBe(1);
    expect(r.violations(allow)).toEqual([]);
  });

  test("a cross-origin post and a same-origin GET are not recorded", async ({ page }) => {
    const r = await sendFrom(page, casePath, "", async (p) => {
      await p.evaluate((id) => {
        void fetch(`/cases/${id}`, { method: "GET" });
        void fetch("http://other.v13.test/x", { method: "POST", body: id, mode: "no-cors" }).catch(() => {});
        void fetch("/ok", { method: "POST", body: "nothing" });
      }, c9.id);
    });
    expect(r.count()).toBe(1);
    expect(r.violations(allow)).toEqual([]);
  });

  test("a Server Action-shaped call naming its own case passes (the control for (q))", async ({ page }) => {
    const r = await sendFrom(page, casePath, "", (p) =>
      p.evaluate(async (c) => {
        await fetch(location.pathname, {
          method: "POST",
          headers: { "Next-Action": "7f00aa", "content-type": "text/plain;charset=UTF-8" },
          body: JSON.stringify([{ case_id: c.id, ref: c.ref }]),
        });
      }, c1),
    );
    expect(r.recorded()).toEqual([
      expect.objectContaining({ kind: "server-action", method: "POST", contextCaseId: c1.id, read: true }),
    ]);
    expect(r.violations(allow)).toEqual([]);
  });

  test("each request kind is recorded and named: form-post, server-action, fetch, beacon", async ({
    page,
  }) => {
    const r = await sendFrom(page, casePath, form({ case_id: c1.id }), async (p) => {
      await p.evaluate(async () => {
        await fetch("/a", { method: "PUT", body: "x" });
        await fetch("/b", { method: "DELETE" });
        await fetch("/c", { method: "PATCH", headers: { "Next-Action": "7f00bb" }, body: "[]" });
        navigator.sendBeacon("/d", "y");
      });
      await p.getByTestId("send").click();
    });
    await page.waitForURL(`${FIXTURE_ORIGIN}${casePath}`);
    const seen = r.recorded().map((x) => `${x.kind} ${x.method} ${new URL(x.url).pathname}`);
    expect(seen).toEqual(
      expect.arrayContaining([
        "fetch PUT /a",
        "fetch DELETE /b",
        "server-action PATCH /c",
        "fetch POST /d",
        `form-post POST ${casePath}`,
      ]),
    );
    expect(r.recorded().every((x) => x.read && x.contextCaseId === c1.id)).toBe(true);
    expect(r.violations(allow)).toEqual([]);
  });
});

test.describe("planted request leaks are detected", () => {
  test("(p) restricted 0009's id in a hidden form field → P3", async ({ page }) => {
    const r = await sendFrom(page, casePath, form({ case_id: c9.id }), submit);
    const v = r.violations(allow);
    expect(rulesOf(v)).toEqual(["P3"]);
    expect(formatViolations(v)).toContain(`request carries case id ${c9.id}`);
    expect(formatViolations(v)).toContain(`(from ${FIXTURE_ORIGIN}${casePath})`);
  });

  test("(p′) a visible case's reference typed with Arabic-Indic digits, percent-encoded by the form → P3", async ({
    page,
  }) => {
    const r = await sendFrom(page, casePath, form({ case_id: c1.id, note: toArabicIndic(c2.ref) }), submit);
    expect(rulesOf(r.violations(allow))).toEqual(["P3"]);
    expect(formatViolations(r.violations(allow))).toContain(c2.ref);
  });

  test("(q) a Server Action-shaped call carrying another visible case's id in UPPER CASE → P3", async ({
    page,
  }) => {
    const r = await sendFrom(page, casePath, "", (p) =>
      p.evaluate(async (id) => {
        await fetch(location.pathname, {
          method: "POST",
          headers: { "Next-Action": "7f00aa", "content-type": "text/plain;charset=UTF-8" },
          body: JSON.stringify([{ case_id: id.toUpperCase() }]),
        });
      }, c2.id),
    );
    expect(rulesOf(r.violations(allow))).toEqual(["P3"]);
  });

  test("(r) a multipart form post carrying another case's reference → P3", async ({ page }) => {
    const r = await sendFrom(
      page,
      casePath,
      form({ case_id: c1.id, ref: c2.ref }, "multipart/form-data"),
      submit,
    );
    expect(rulesOf(r.violations(allow))).toEqual(["P3"]);
  });

  test("(s) a post addressed to another case's URL → P3", async ({ page }) => {
    const r = await sendFrom(page, casePath, form({}, undefined, `/cases/${c2.id}/notifications`), submit);
    const v = r.violations(allow);
    expect(rulesOf(v)).toEqual(["P3"]);
    expect(formatViolations(v)).toContain(c2.id);
  });

  test("(t) a post off a case page naming a case → P3, unless the test allows that case there", async ({
    page,
  }) => {
    const r = await sendFrom(page, "/portfolio", form({ case_id: c1.id }), submit);
    expect(rulesOf(r.violations(allow))).toEqual(["P3"]);
    expect(
      r.violations({ ...allow, outsideCase: { caseIds: new Set([c1.id]), caseRefs: new Set() } }),
    ).toEqual([]);
  });

  test("(u) a multipart request whose body is not handed over → P4, never a silent pass", async ({
    page,
  }) => {
    // A real multipart request always has a body (an empty FormData still sends its closing boundary), so a
    // multipart request without one stands for a body the browser did not hand over.
    const r = await sendFrom(page, casePath, "", (p) =>
      p.evaluate(async () => {
        await fetch("/x", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=b" } });
        await fetch("/y", { method: "POST", body: new FormData() }); // empty, but with a body: read and clean
      }),
    );
    expect(r.count()).toBe(2);
    const v = r.violations(allow);
    expect(rulesOf(v)).toEqual(["P4"]);
    expect(v).toHaveLength(1);
    expect(formatViolations(v)).toContain("multipart/form-data body was not handed over");
  });
});
