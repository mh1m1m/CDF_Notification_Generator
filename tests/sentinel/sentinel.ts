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
//   P1 a payload (HTML, RSC flight, JSON) contains no case id or reference outside the allowed set
import type { Page, Response } from "@playwright/test";

export const CASE_REF_PATTERN = /CDF-DEMO-\d{4}-\d{4}/g;
const CASE_REF_EXACT = /^CDF-DEMO-\d{4}-\d{4}$/;
// Same shape as lib/contracts UUID_PATTERN, unanchored for scanning.
export const UUID_SCAN_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
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

/** Runs in the browser: collects the ADR-013 evidence. Must stay self-contained (it is serialised). */
function collectInPage(): CaseContextSnapshot {
  const refPattern = /CDF-DEMO-\d{4}-\d{4}/g;
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
  const owners = Array.from(document.querySelectorAll("[data-case-id]")).map((el) => {
    const text = [visibleText(el), ...labelsOf(el)].join("\n");
    return {
      path: pathOf(el),
      caseId: el.getAttribute("data-case-id"),
      caseRef: el.getAttribute("data-case-ref"),
      testId: el.getAttribute("data-testid"),
      descendantCaseIds: Array.from(el.querySelectorAll("[data-case-id]")).map(
        (d) => d.getAttribute("data-case-id") ?? "",
      ),
      textRefs: Array.from(new Set(text.match(refPattern) ?? [])),
    };
  });
  const counts = Array.from(document.querySelectorAll('[data-testid^="count-"]')).map((el) => ({
    path: pathOf(el),
    testId: el.getAttribute("data-testid") ?? "",
    count: el.getAttribute("data-count"),
  }));
  const caseWorkspaceRoots = Array.from(document.querySelectorAll('[data-testid="case-workspace"]')).map(
    (el) => ({
      caseId: el.getAttribute("data-case-id"),
      caseRef: el.getAttribute("data-case-ref"),
    }),
  );
  return { url: location.href, owners, counts, caseWorkspaceRoots };
}

export async function snapshotCaseContext(page: Page): Promise<CaseContextSnapshot> {
  const main = await page.evaluate(collectInPage);
  // Same-origin frames (e.g. a notification preview) are part of the page the viewer sees.
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const sub = await frame.evaluate(collectInPage);
      main.owners.push(...sub.owners.map((o) => ({ ...o, path: `frame(${sub.url}) ${o.path}` })));
      main.counts.push(...sub.counts);
      main.caseWorkspaceRoots.push(...sub.caseWorkspaceRoots);
    } catch {
      // Cross-origin or detached frame: nothing to read, and nothing of ours should be there.
    }
  }
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
  for (const id of new Set(text.match(UUID_SCAN_PATTERN) ?? [])) {
    if (allow.knownCaseIds.has(id) && !allow.caseIds.has(id))
      v.push({ rule: "P1", where, detail: `payload carries case id ${id}` });
  }
  for (const ref of new Set(text.match(CASE_REF_PATTERN) ?? [])) {
    if (!allow.caseRefs.has(ref))
      v.push({ rule: "P1", where, detail: `payload carries case reference ${ref}` });
  }
  return v;
}

const SCANNED_TYPES = /text\/html|text\/x-component|application\/json|text\/plain/;

/**
 * Records every same-origin document, RSC flight and JSON response the page receives, for P1 scanning. Attach before
 * the first navigation; call `violations()` after the step under test.
 */
export function recordPayloads(page: Page, origin: string) {
  const bodies: Promise<{ where: string; text: string } | null>[] = [];
  const onResponse = (response: Response) => {
    const url = response.url();
    if (!url.startsWith(origin)) return;
    const type = response.headers()["content-type"] ?? "";
    if (!SCANNED_TYPES.test(type)) return;
    bodies.push(
      response
        .text()
        .then((text) => ({ where: `${response.request().method()} ${url}`, text }))
        .catch(() => null),
    );
  };
  page.on("response", onResponse);
  return {
    async violations(allow: PayloadAllowance): Promise<Violation[]> {
      const done = (await Promise.all(bodies)).filter(
        (b): b is { where: string; text: string } => b !== null,
      );
      return done.flatMap((b) => scanPayload(b.where, b.text, allow));
    },
    async count(): Promise<number> {
      return (await Promise.all(bodies)).filter(Boolean).length;
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
export async function inspectCaseContext(page: Page, expect: CaseExpectation = {}): Promise<Violation[]> {
  return checkCaseContext(await snapshotCaseContext(page), expect);
}
