// Case Context Sentinel (مراقب سلامة سياق القضية) — QG-02 / Gate B, V13-QA-003.
//
// Proves that everything a page shows, and every payload the browser receives, belongs to the case and persona in
// context. It reads only the ADR-013 DOM evidence attributes and the text the viewer sees; it never touches
// application code or the database. The database half (direct queries as cdf_v13_user) lives in db.ts once the
// case tables are on develop.
//
// Rules (each violation names its rule):
//   S1 inside an element with data-case-id=X, no descendant carries another data-case-id
//   S2 every data-case-id element carries a well-formed UUID and a data-case-ref CDF-DEMO-YYYY-NNNN
//   S3 one case id always maps to the same reference on the page (and one reference to one id)
//   S4 inside data-case-id=X, no visible text or accessible label names another case's reference
//   S5 on a case page, a case-workspace root exists, carries the URL's case, and every data-case-id equals it
//   S6 every case id / reference on the page is one the persona may see (when the visible set is given)
//   S7 every count-* element carries an integer data-count
//   S8 every child frame of the page could be read (evaluated, or parsed from its srcdoc); none passes silently
//   P1 a payload (HTML, RSC flight, JSON) contains no case id or reference outside the allowed set
//   P2 every recorded payload could be read (from the browser, or by fetching the same GET again); none passes silently
import type { Page, Response } from "@playwright/test";
import { readChildFrames, type FramePage, type UnreadableFrame } from "./frames";

export const CASE_REF_PATTERN = /CDF-DEMO-\d{4}-\d{4}/gi;
const CASE_REF_EXACT = /^CDF-DEMO-\d{4}-\d{4}$/;
// Same shape as lib/contracts UUID_PATTERN, unanchored for scanning.
export const UUID_SCAN_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

/**
 * Arabic-Indic (U+0660–0669) and Extended Arabic-Indic (U+06F0–06F9) digits → ASCII, so a reference a component
 * renders with Arabic digits (against DESIGN_SYSTEM §5) is still matched.
 */
export function normaliseDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface CaseOwnerNode {
  path: string;
  caseId: string | null;
  caseRef: string | null;
  testId: string | null;
  /** data-case-id values of descendants that own case content. */
  descendantCaseIds: string[];
  /** Case references in visible text and accessible labels of this element and its descendants. */
  textRefs: string[];
}

export interface CountNode {
  path: string;
  testId: string;
  count: string | null;
}

export interface CaseContextSnapshot {
  url: string;
  owners: CaseOwnerNode[];
  counts: CountNode[];
  /** Number of elements with data-testid="case-workspace". */
  caseWorkspaceRoots: { caseId: string | null; caseRef: string | null }[];
  /** Child frames the harness could not read (S8). */
  unreadableFrames: UnreadableFrame[];
}

export interface CaseExpectation {
  /** The case the URL names (case pages only). */
  contextCaseId?: string;
  /** Cases the persona may see in the active workspace; anything else on the page is a leak. */
  visible?: ReadonlyMap<string, string>; // caseId → caseRef
}

export interface Violation {
  rule: string;
  where: string;
  detail: string;
}

/**
 * Runs in the browser: collects the ADR-013 evidence of its document, or of `html` parsed in place (a frame's srcdoc
 * read from the parent). Must stay self-contained (it is serialised).
 */
function collectInPage(html: string | null): CaseContextSnapshot {
  const doc = html === null ? document : new DOMParser().parseFromString(html, "text/html");
  const refPattern = /CDF-DEMO-\d{4}-\d{4}/gi;
  const ascii = (t: string) =>
    t.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String((d.charCodeAt(0) & 0xf) % 10));
  const pathOf = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && parts.length < 6) {
      const id = node.getAttribute("data-testid");
      parts.unshift(id ? `[data-testid="${id}"]` : node.tagName.toLowerCase());
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const labelsOf = (el: Element): string[] => {
    const out: string[] = [];
    const all = [el, ...Array.from(el.querySelectorAll("*"))];
    for (const node of all) {
      for (const attr of ["aria-label", "title", "alt", "placeholder", "value"]) {
        const v = node.getAttribute(attr);
        if (v) out.push(v);
      }
    }
    return out;
  };
  const visibleText = (el: Element): string =>
    (el instanceof HTMLElement ? el.innerText : el.textContent) ?? "";
  const owners = Array.from(doc.querySelectorAll("[data-case-id]")).map((el) => {
    const text = [visibleText(el), ...labelsOf(el)].join("\n");
    return {
      path: pathOf(el),
      caseId: el.getAttribute("data-case-id"),
      caseRef: el.getAttribute("data-case-ref"),
      testId: el.getAttribute("data-testid"),
      descendantCaseIds: Array.from(el.querySelectorAll("[data-case-id]")).map(
        (d) => d.getAttribute("data-case-id") ?? "",
      ),
      textRefs: Array.from(new Set((ascii(text).match(refPattern) ?? []).map((r) => r.toUpperCase()))),
    };
  });
  const counts = Array.from(doc.querySelectorAll('[data-testid^="count-"]')).map((el) => ({
    path: pathOf(el),
    testId: el.getAttribute("data-testid") ?? "",
    count: el.getAttribute("data-count"),
  }));
  const caseWorkspaceRoots = Array.from(doc.querySelectorAll('[data-testid="case-workspace"]')).map((el) => ({
    caseId: el.getAttribute("data-case-id"),
    caseRef: el.getAttribute("data-case-ref"),
  }));
  return {
    url: html === null ? location.href : "about:srcdoc",
    owners,
    counts,
    caseWorkspaceRoots,
    unreadableFrames: [],
  };
}

export async function snapshotCaseContext(
  page: Page,
  frames: FramePage | Page = page,
): Promise<CaseContextSnapshot> {
  const main = await page.evaluate(collectInPage, null);
  // Child frames (e.g. a sandboxed notification preview) are part of the page the viewer sees.
  const { reads, unreadable } = await readChildFrames(frames, collectInPage);
  for (const { url, via, result: sub } of reads) {
    const prefix = via === "frame" ? `frame(${url})` : `frame(${url}, srcdoc)`;
    main.owners.push(...sub.owners.map((o) => ({ ...o, path: `${prefix} ${o.path}` })));
    main.counts.push(...sub.counts.map((c) => ({ ...c, path: `${prefix} ${c.path}` })));
    main.caseWorkspaceRoots.push(...sub.caseWorkspaceRoots);
  }
  main.unreadableFrames.push(...unreadable);
  return main;
}

/** Pure check of a snapshot against the expectation. */
export function checkCaseContext(snapshot: CaseContextSnapshot, expect: CaseExpectation = {}): Violation[] {
  const v: Violation[] = [];
  const idToRef = new Map<string, string>();
  const refToId = new Map<string, string>();

  for (const o of snapshot.owners) {
    if (!o.caseId || !UUID_EXACT.test(o.caseId)) {
      v.push({
        rule: "S2",
        where: o.path,
        detail: `data-case-id is not a UUID: ${JSON.stringify(o.caseId)}`,
      });
      continue;
    }
    if (!o.caseRef || !CASE_REF_EXACT.test(o.caseRef)) {
      v.push({
        rule: "S2",
        where: o.path,
        detail: `data-case-ref missing or malformed: ${JSON.stringify(o.caseRef)}`,
      });
    } else {
      const knownRef = idToRef.get(o.caseId);
      const knownId = refToId.get(o.caseRef);
      if (knownRef && knownRef !== o.caseRef)
        v.push({
          rule: "S3",
          where: o.path,
          detail: `case ${o.caseId} shown as ${o.caseRef} and as ${knownRef}`,
        });
      if (knownId && knownId !== o.caseId)
        v.push({
          rule: "S3",
          where: o.path,
          detail: `reference ${o.caseRef} used for ${o.caseId} and ${knownId}`,
        });
      idToRef.set(o.caseId, o.caseRef);
      refToId.set(o.caseRef, o.caseId);
    }
    for (const d of o.descendantCaseIds) {
      if (d !== o.caseId)
        v.push({ rule: "S1", where: o.path, detail: `case ${o.caseId} contains case ${d}` });
    }
    for (const ref of o.textRefs) {
      if (o.caseRef && ref !== o.caseRef)
        v.push({
          rule: "S4",
          where: o.path,
          detail: `case ${o.caseRef} shows another case's reference ${ref}`,
        });
    }
    if (expect.visible) {
      const ref = expect.visible.get(o.caseId);
      if (ref === undefined)
        v.push({
          rule: "S6",
          where: o.path,
          detail: `case ${o.caseId} (${o.caseRef}) is not visible to this persona`,
        });
      else if (o.caseRef && ref !== o.caseRef)
        v.push({
          rule: "S6",
          where: o.path,
          detail: `case ${o.caseId} shown as ${o.caseRef}, database says ${ref}`,
        });
    }
  }

  if (expect.contextCaseId) {
    const roots = snapshot.caseWorkspaceRoots;
    if (roots.length !== 1)
      v.push({
        rule: "S5",
        where: snapshot.url,
        detail: `expected exactly one case-workspace root, found ${roots.length}`,
      });
    for (const r of roots) {
      if (r.caseId !== expect.contextCaseId)
        v.push({
          rule: "S5",
          where: snapshot.url,
          detail: `case-workspace root carries ${r.caseId}, URL names ${expect.contextCaseId}`,
        });
    }
    for (const o of snapshot.owners) {
      if (o.caseId && o.caseId !== expect.contextCaseId)
        v.push({
          rule: "S5",
          where: o.path,
          detail: `case page for ${expect.contextCaseId} shows case ${o.caseId}`,
        });
    }
  }

  for (const f of snapshot.unreadableFrames)
    v.push({ rule: "S8", where: `frame(${f.url})`, detail: `frame could not be inspected: ${f.reason}` });

  for (const c of snapshot.counts) {
    if (c.count === null || !/^\d+$/.test(c.count))
      v.push({
        rule: "S7",
        where: c.path,
        detail: `${c.testId} has no integer data-count (${JSON.stringify(c.count)})`,
      });
  }
  return v;
}

export interface PayloadAllowance {
  /** Case ids that may appear in this payload. */
  caseIds: ReadonlySet<string>;
  /** Case references that may appear in this payload. */
  caseRefs: ReadonlySet<string>;
  /** Every known case id (so that unrelated UUIDs — correlation ids, persona ids — are not reported). */
  knownCaseIds: ReadonlySet<string>;
}

/** P1: finds case ids and references in a payload that are not allowed. */
export function scanPayload(where: string, text: string, allow: PayloadAllowance): Violation[] {
  const v: Violation[] = [];
  const ascii = normaliseDigits(text);
  for (const id of new Set((ascii.match(UUID_SCAN_PATTERN) ?? []).map((x) => x.toLowerCase()))) {
    if (allow.knownCaseIds.has(id) && !allow.caseIds.has(id))
      v.push({ rule: "P1", where, detail: `payload carries case id ${id}` });
  }
  for (const ref of new Set((ascii.match(CASE_REF_PATTERN) ?? []).map((r) => r.toUpperCase()))) {
    if (!allow.caseRefs.has(ref))
      v.push({ rule: "P1", where, detail: `payload carries case reference ${ref}` });
  }
  return v;
}

// Windows-1252 code points for bytes 0x80–0x9F (the rest of 0x00–0xFF maps to itself).
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d,
  0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a,
  0x153, 0x9d, 0x17e, 0x178,
];
const CP1252_BYTE = new Map(CP1252_HIGH.map((cp, i) => [cp, 0x80 + i] as const));

/**
 * Chromium hands Playwright the body of a text response without a charset (Next.js RSC flight is
 * `text/x-component`) already decoded as Windows-1252, so UTF-8 Arabic arrives as mojibake ("Û²" for "۲") and no
 * pattern can match it. This reverses that decoding when, and only when, the result is valid UTF-8.
 */
export function recoverUtf8(text: string): string {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const b =
      cp <= 0x7f || (cp >= 0xa0 && cp <= 0xff)
        ? cp
        : (CP1252_BYTE.get(cp) ?? (cp >= 0x80 && cp <= 0x9f ? cp : -1));
    if (b < 0) return text; // not a Windows-1252 decoding: leave it as it is
    bytes.push(b);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return text;
  }
}

const SCANNED_TYPES = /text\/html|text\/x-component|application\/json|text\/plain/;
/** How long to wait for the browser to hand over a body before fetching it again. */
const BODY_TIMEOUT_MS = 5_000;
/** Request headers that shape the answer (RSC flight, prefetch, router state); cookies come from the context. */
const REPLAY_HEADERS =
  /^(accept|rsc|next-router-prefetch|next-router-state-tree|next-router-segment-prefetch|next-url)$/i;

type PayloadRead =
  { where: string; text: string; via: "browser" | "refetch" } | { where: string; error: string };

const timeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no body after ${ms} ms`)), ms)),
  ]);
const firstLine = (e: unknown) =>
  String(e instanceof Error ? e.message : e)
    .split("\n")[0]!
    .slice(0, 160);
const decode = (body: Buffer, type: string) =>
  /charset=/i.test(type) ? body.toString("utf8") : recoverUtf8(body.toString("utf8"));

/**
 * Records every same-origin document, RSC flight and JSON response the page receives, for P1 scanning. Attach before
 * the first navigation; call `violations()` after the step under test.
 *
 * Chromium does not always hand over a body: prefetches that Next.js abandons stay pending for ever, and evicted
 * bodies answer "No data found". Such a GET is fetched again through the page's request context (same cookies, same
 * RSC headers) and that body is scanned. A body that still cannot be read is P2, never a silent pass.
 */
export function recordPayloads(page: Page, origin: string, options: { bodyTimeoutMs?: number } = {}) {
  const wait = options.bodyTimeoutMs ?? BODY_TIMEOUT_MS;
  const reads: Promise<PayloadRead | null>[] = [];
  const read = async (response: Response): Promise<PayloadRead | null> => {
    const request = response.request();
    const method = request.method();
    const url = response.url();
    const where = `${method} ${url}`;
    const type = response.headers()["content-type"] ?? "";
    if (response.status() >= 300 && response.status() < 400) return null; // a redirect has no body
    try {
      return { where, text: decode(await timeout(response.body(), wait), type), via: "browser" };
    } catch (first) {
      if (method !== "GET") return { where, error: `body not readable (${firstLine(first)})` };
      try {
        const headers = Object.fromEntries(
          Object.entries(await request.allHeaders()).filter(([name]) => REPLAY_HEADERS.test(name)),
        );
        const again = await page.request.get(url, { headers, maxRedirects: 0, timeout: wait * 2 });
        const againType = again.headers()["content-type"] ?? type;
        return {
          where: `${where} (fetched again)`,
          text: decode(await again.body(), againType),
          via: "refetch",
        };
      } catch (second) {
        return { where, error: `body not readable (${firstLine(first)}; again: ${firstLine(second)})` };
      }
    }
  };
  const onResponse = (response: Response) => {
    if (!response.url().startsWith(origin)) return;
    if (!SCANNED_TYPES.test(response.headers()["content-type"] ?? "")) return;
    reads.push(read(response));
  };
  page.on("response", onResponse);
  const settled = async () => (await Promise.all(reads)).filter((r): r is PayloadRead => r !== null);
  return {
    async violations(allow: PayloadAllowance): Promise<Violation[]> {
      return (await settled()).flatMap((r) =>
        "error" in r
          ? [{ rule: "P2", where: r.where, detail: `payload could not be inspected: ${r.error}` }]
          : scanPayload(r.where, r.text, allow),
      );
    },
    /** Number of payloads read (from the browser or fetched again). */
    async count(): Promise<number> {
      return (await settled()).filter((r) => !("error" in r)).length;
    },
    /** How each payload was read, for evidence. */
    async summary(): Promise<{ browser: number; refetch: number; unreadable: number }> {
      const all = await settled();
      return {
        browser: all.filter((r) => "via" in r && r.via === "browser").length,
        refetch: all.filter((r) => "via" in r && r.via === "refetch").length,
        unreadable: all.filter((r) => "error" in r).length,
      };
    },
    stop() {
      page.off("response", onResponse);
    },
  };
}

export function formatViolations(violations: Violation[]): string {
  return violations.map((x) => `${x.rule} ${x.where}: ${x.detail}`).join("\n");
}

/** Snapshot + check in one call; returns the violations (empty when the page is clean). */
export async function inspectCaseContext(
  page: Page,
  expect: CaseExpectation = {},
  frames: FramePage | Page = page,
): Promise<Violation[]> {
  return checkCaseContext(await snapshotCaseContext(page, frames), expect);
}
