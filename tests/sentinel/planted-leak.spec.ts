// Acceptance self-test of the Case Context Sentinel (V13-QA-003): a clean page passes, and every planted cross-case
// leak makes it fail with the right rule. Fixture pages only (tests/fixtures/synthetic-case-page.ts); no application
// code or database is involved, so a Sentinel that cannot see a leak fails here before it is trusted on real pages.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import {
  ALL_CASE_IDS,
  CASES,
  FIXTURE_ORIGIN,
  caseWorkspaceHtml,
  openFixture,
  portfolioHtml,
} from "../fixtures/synthetic-case-page";
import {
  formatViolations,
  inspectCaseContext,
  recordPayloads,
  recoverUtf8,
  REFETCH_MAX_RETRIES,
  timeout,
  type PayloadAllowance,
} from "./sentinel";
import { refuseFrameEvaluation } from "./frames";

const c1 = CASES.c0001;
const casePath = `/cases/${c1.id}`;
const visibleToAlpha = new Map([CASES.c0001, CASES.c0002, CASES.c0003].map((c) => [c.id, c.ref] as const));
const allowOn0001: PayloadAllowance = {
  caseIds: new Set([c1.id]),
  caseRefs: new Set([c1.ref]),
  knownCaseIds: ALL_CASE_IDS,
};

const rulesOf = (vs: { rule: string }[]) => [...new Set(vs.map((v) => v.rule))].sort();

test.describe("clean fixtures pass", () => {
  test("case workspace of 0001", async ({ page }) => {
    const payloads = recordPayloads(page, FIXTURE_ORIGIN);
    await openFixture(page, casePath, caseWorkspaceHtml());
    const dom = await inspectCaseContext(page, { contextCaseId: c1.id, visible: visibleToAlpha });
    expect(dom, formatViolations(dom)).toEqual([]);
    const p = await payloads.violations(allowOn0001);
    expect(p, formatViolations(p)).toEqual([]);
    expect(await payloads.count()).toBeGreaterThanOrEqual(2); // the document and the RSC stand-in were scanned
  });

  test("portfolio list of three visible cases", async ({ page }) => {
    await openFixture(page, "/portfolio", portfolioHtml());
    const dom = await inspectCaseContext(page, { visible: visibleToAlpha });
    expect(dom, formatViolations(dom)).toEqual([]);
  });
});

test.describe("planted leaks are detected", () => {
  test("(a) another case's element inside the case workspace → S1 and S5", async ({ page }) => {
    const c2 = CASES.c0002;
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: `<div data-testid="notification-row-x" data-case-id="${c2.id}" data-case-ref="${c2.ref}">إشعار</div>`,
      }),
    );
    const v = await inspectCaseContext(page, { contextCaseId: c1.id, visible: visibleToAlpha });
    expect(rulesOf(v)).toEqual(expect.arrayContaining(["S1", "S5"]));
  });

  test("(b) another case's reference in visible text → S4", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({ insideWorkspace: `<p>انظر أيضًا <bdi dir="ltr">${CASES.c0003.ref}</bdi></p>` }),
    );
    const v = await inspectCaseContext(page, { contextCaseId: c1.id });
    expect(rulesOf(v)).toEqual(["S4"]);
  });

  test("(b′) another case's reference hidden in an accessible label → S4", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({ insideWorkspace: `<button aria-label="فتح ${CASES.c0002.ref}">فتح</button>` }),
    );
    expect(rulesOf(await inspectCaseContext(page, { contextCaseId: c1.id }))).toEqual(["S4"]);
  });

  test("(c) restricted 0009's id in an RSC payload → P1, while the DOM stays clean", async ({ page }) => {
    const payloads = recordPayloads(page, FIXTURE_ORIGIN);
    await openFixture(page, casePath, caseWorkspaceHtml(), `1:{"caseId":"${CASES.c0009.id}"}\n`);
    expect(await inspectCaseContext(page, { contextCaseId: c1.id })).toEqual([]);
    const p = await payloads.violations(allowOn0001);
    expect(rulesOf(p)).toEqual(["P1"]);
    expect(formatViolations(p)).toContain(CASES.c0009.id);
  });

  test("(c′) restricted 0009's reference in the document HTML (not rendered) → P1", async ({ page }) => {
    const payloads = recordPayloads(page, FIXTURE_ORIGIN);
    await openFixture(page, casePath, caseWorkspaceHtml({ afterWorkspace: `<!-- ${CASES.c0009.ref} -->` }));
    expect(await inspectCaseContext(page, { contextCaseId: c1.id })).toEqual([]);
    expect(rulesOf(await payloads.violations(allowOn0001))).toEqual(["P1"]);
  });

  test("(d) a case outside the persona's visibility in a list → S6", async ({ page }) => {
    const c9 = CASES.c0009;
    await openFixture(
      page,
      "/portfolio",
      portfolioHtml(`<tr data-case-id="${c9.id}" data-case-ref="${c9.ref}"><th>${c9.ref}</th></tr>`),
    );
    expect(rulesOf(await inspectCaseContext(page, { visible: visibleToAlpha }))).toEqual(["S6"]);
  });

  test("(e) a row without data-case-ref, and a reference used for two ids → S2 and S3", async ({ page }) => {
    await openFixture(
      page,
      "/portfolio",
      portfolioHtml(
        `<tr data-case-id="${CASES.c0002.id}"><th>x</th></tr>` +
          `<tr data-case-id="${CASES.c0003.id}" data-case-ref="${c1.ref}"><th>y</th></tr>`,
      ),
    );
    expect(rulesOf(await inspectCaseContext(page, {}))).toEqual(["S2", "S3"]);
  });

  test("(f) case page without its case-workspace root → S5", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml().replace('data-testid="case-workspace"', 'data-testid="x"'),
    );
    expect(rulesOf(await inspectCaseContext(page, { contextCaseId: c1.id }))).toEqual(["S5"]);
  });

  test("(g) a count without an integer data-count → S7", async ({ page }) => {
    await openFixture(page, "/portfolio", portfolioHtml().replace('data-count="3"', 'data-count="many"'));
    expect(rulesOf(await inspectCaseContext(page, {}))).toEqual(["S7"]);
  });

  test("(h) restricted 0009's id in UPPER CASE in an RSC payload → P1", async ({ page }) => {
    const payloads = recordPayloads(page, FIXTURE_ORIGIN);
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml(),
      `1:{"caseId":"${CASES.c0009.id.toUpperCase()}"}\n`,
    );
    const p = await payloads.violations(allowOn0001);
    expect(rulesOf(p)).toEqual(["P1"]);
    expect(formatViolations(p)).toContain(CASES.c0009.id);
  });

  test("(i) another case's reference written with Arabic-Indic digits → S4", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({ insideWorkspace: "<p>انظر CDF-DEMO-٢٠٢٦-٠٠٠٣</p>" }),
    );
    const v = await inspectCaseContext(page, { contextCaseId: c1.id });
    expect(rulesOf(v)).toEqual(["S4"]);
    expect(formatViolations(v)).toContain(CASES.c0003.ref);
  });

  test("(j) restricted 0009's reference with Extended Arabic-Indic digits in a payload → P1", async ({
    page,
  }) => {
    const payloads = recordPayloads(page, FIXTURE_ORIGIN);
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml(),
      '1:{"title":"فضية مقيدة — في الحفظ","ref":"CDF-DEMO-۲۰۲۶-۰۰۰۹"}\n',
    );
    const p = await payloads.violations(allowOn0001);
    expect(rulesOf(p)).toEqual(["P1"]);
    expect(formatViolations(p)).toContain(CASES.c0009.ref);
  });

  test("(k) another case's element inside a same-origin frame of the case page → S5", async ({ page }) => {
    const c2 = CASES.c0002;
    const frame = `<div data-case-id="${c2.id}" data-case-ref="${c2.ref}">معاينة</div>`;
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({ insideWorkspace: `<iframe title="preview" srcdoc='${frame}'></iframe>` }),
    );
    expect(rulesOf(await inspectCaseContext(page, { contextCaseId: c1.id }))).toEqual(["S5"]);
  });
});

test.describe("sandboxed preview frames (SEC form for FE-006: sandbox + srcdoc, no allow-scripts, no allow-same-origin)", () => {
  const c2 = CASES.c0002;
  const leak = `<div data-case-id="${c2.id}" data-case-ref="${c2.ref}">معاينة</div>`;
  const sandboxed = (srcdoc: string) => `<iframe sandbox="" title="preview" srcdoc='${srcdoc}'></iframe>`;

  test("(l) another case's element inside a sandboxed srcdoc preview → S5", async ({ page }) => {
    await openFixture(page, casePath, caseWorkspaceHtml({ insideWorkspace: sandboxed(leak) }));
    expect(rulesOf(await inspectCaseContext(page, { contextCaseId: c1.id }))).toEqual(["S5"]);
  });

  test("(l′) same leak when the frame refuses evaluation → read from srcdoc in the parent, S5", async ({
    page,
  }) => {
    await openFixture(page, casePath, caseWorkspaceHtml({ insideWorkspace: sandboxed(leak) }));
    const v = await inspectCaseContext(page, { contextCaseId: c1.id }, refuseFrameEvaluation(page));
    expect(rulesOf(v)).toEqual(["S5"]);
    expect(formatViolations(v)).toContain("srcdoc)");
  });

  test("a clean sandboxed preview passes, also when read from srcdoc", async ({ page }) => {
    const own = `<div data-case-id="${c1.id}" data-case-ref="${c1.ref}">معاينة</div>`;
    await openFixture(page, casePath, caseWorkspaceHtml({ insideWorkspace: sandboxed(own) }));
    for (const frames of [page, refuseFrameEvaluation(page)]) {
      const v = await inspectCaseContext(page, { contextCaseId: c1.id }, frames);
      expect(v, formatViolations(v)).toEqual([]);
    }
  });

  test("(m) a frame that can be neither evaluated nor read from srcdoc → S8, never a silent pass", async ({
    page,
  }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: `<iframe sandbox="" title="preview" src="/preview-frame"></iframe>`,
      }),
    );
    const v = await inspectCaseContext(page, { contextCaseId: c1.id }, refuseFrameEvaluation(page));
    expect(rulesOf(v)).toEqual(["S8"]);
  });
});

test.describe("payloads the browser does not hand over", () => {
  test("a wait of 0 ms never reads the body, however fast it is (OI-046)", async () => {
    for (const ms of [0, -1, Number.NaN]) {
      await expect(timeout(Promise.resolve(Buffer.from("ready")), ms), String(ms)).rejects.toThrow("no body");
    }
    await expect(timeout(Promise.resolve("ready"), 1000)).resolves.toBe("ready");
  });

  test("(n) a body that cannot be read, nor fetched again → P2, never a silent pass", async ({ page }) => {
    // A zero wait forces the fallback; the fixture origin exists only in page routing, so fetching again fails.
    const payloads = recordPayloads(page, FIXTURE_ORIGIN, { bodyTimeoutMs: 0 });
    await openFixture(page, casePath, caseWorkspaceHtml());
    const p = await payloads.violations(allowOn0001);
    expect(rulesOf(p)).toEqual(["P2"]);
    expect(await payloads.count()).toBe(0);
  });

  test("(o) a leak in a body read by fetching the same GET again → P1", async ({ page }) => {
    // A real local server: the second fetch (page.request, same cookies and RSC headers) reaches it.
    const html = caseWorkspaceHtml();
    const server: Server = createServer((req, res) => {
      if (req.url === "/rsc-payload") {
        res.writeHead(200, { "content-type": "text/x-component" });
        res.end(`1:{"caseId":"${CASES.c0009.id}","rsc":"${req.headers["rsc"] ?? ""}"}\n`);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html.replace('fetch("/rsc-payload")', 'fetch("/rsc-payload", { headers: { RSC: "1" } })'));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const payloads = recordPayloads(page, origin, { bodyTimeoutMs: 0 });
      await page.goto(`${origin}${casePath}`);
      await page.waitForFunction(() => document.body.dataset.rsc !== undefined);
      const p = await payloads.violations(allowOn0001);
      expect(rulesOf(p)).toEqual(["P1"]);
      expect(formatViolations(p)).toContain("(fetched again)");
      expect(await payloads.summary()).toEqual({ browser: 0, refetch: 2, unreadable: 0 });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test.describe("refetch retries (OI-047)", () => {
  test("a refetch reset on every attempt is retried, then still P2, never a pass", async ({ page }) => {
    // The browser gets the page; every later request (the refetches) has its connection reset.
    expect(REFETCH_MAX_RETRIES).toBeGreaterThan(0);
    let served = 0;
    let reset = 0;
    const server: Server = createServer((req, res) => {
      if (served === 0 && req.url === casePath) {
        served += 1;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<!doctype html><html><head><title>t</title></head><body>no case here</body></html>");
        return;
      }
      if (req.url === casePath) reset += 1; // not /favicon.ico and the like
      req.socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const payloads = recordPayloads(page, origin, { bodyTimeoutMs: 0 });
      await page.goto(`${origin}${casePath}`);
      const p = await payloads.violations(allowOn0001);
      expect(rulesOf(p)).toEqual(["P2"]);
      expect(await payloads.summary()).toEqual({ browser: 0, refetch: 0, unreadable: 1 });
      expect(await payloads.count()).toBe(0);
      // One first attempt plus the retries, each reset: the option reaches Playwright.
      expect(reset).toBe(1 + REFETCH_MAX_RETRIES);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("recoverUtf8 reverses a Windows-1252 decoding of UTF-8 and leaves other text alone", () => {
  // Every byte value 0x80–0xBF occurs as a UTF-8 continuation byte across this Arabic sample.
  const arabic = "فضية مقيدة — في الحفظ، صندوق التنمية الثقافي ٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹";
  const bytes = Buffer.from(arabic, "utf8");
  const cp1252 = new TextDecoder("windows-1252").decode(bytes);
  expect(cp1252).not.toBe(arabic);
  expect(recoverUtf8(cp1252)).toBe(arabic);
  expect(recoverUtf8(arabic)).toBe(arabic); // already correct text is untouched
  expect(recoverUtf8("plain ASCII")).toBe("plain ASCII");
});
