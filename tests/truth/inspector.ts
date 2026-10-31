// Procedural Truth Inspector (مدقق الحقيقة الإجرائية) — QG-04 / Gate I (M1 scope), V13-QA-004.
//
// Every StatusBadge, Timeline entry and progress mark (ADR-013 attributes) either names a recorded event that really
// set the shown status for the same case, or is visibly labelled expected / conditional / awaiting approval.
// The event oracle answers from the database (cdf_v13_user, persona claims) once the procedural tables exist; the
// self-tests use an in-memory oracle.
//
// Rules:
//   T1 data-epistemic is one of recorded · expected · conditional · awaiting_approval
//   T2 data-status-kind and data-status are present
//   T3 data-event-id is a UUID exactly when the element is recorded
//   T4 a recorded element's event exists, belongs to the case of its nearest data-case-id ancestor, is not in the
//      future, and the oracle's status for it equals the shown status (PROC's fold; ARCH ruling on derived states)
//   T5 a completed-class status is never shown as anything but recorded
//   T6 a non-recorded element is distinguishable from a recorded one of the same status by its text, not by colour
//   T7 every child frame of the page could be read (evaluated, or parsed from its srcdoc); none passes silently
//   T8 an element with data-status or data-status-kind but no data-epistemic is allowed only as an OPEN task with no
//      data-event-id (ARCH ruling on FE-004, allow-list); every other unmarked status element is a violation
import type { Page } from "@playwright/test";
import { BADGE_EPISTEMIC_VALUES, isCompletedClassStatus } from "@/lib/domain";
import { readChildFrames, type FramePage, type UnreadableFrame } from "../sentinel/frames";

// One source for both lists: lib/domain (PROC-001), the same ones the components use.
export const EPISTEMIC_VALUES = BADGE_EPISTEMIC_VALUES;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface EpistemicNode {
  path: string;
  epistemic: string | null;
  eventId: string | null;
  statusKind: string | null;
  status: string | null;
  caseId: string | null;
  text: string;
}

export interface RecordedEventFact {
  eventId: string;
  caseId: string;
  statusKind: string;
  /** The status PROC's fold yields from this event (and the events before it). */
  status: string;
  recordedAt: string;
}

export interface EventOracle {
  get(eventId: string): Promise<RecordedEventFact | undefined>;
}

export interface TruthViolation {
  rule: string;
  where: string;
  detail: string;
}

/** Runs in the browser on its document, or on `html` parsed in place (a frame's srcdoc). Self-contained. */
function collectInPage(html: string | null): EpistemicNode[] {
  const doc = html === null ? document : new DOMParser().parseFromString(html, "text/html");
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
  return Array.from(doc.querySelectorAll("[data-epistemic], [data-status], [data-status-kind]")).map((el) => {
    const owner = el.closest("[data-case-id]");
    const label = el.getAttribute("aria-label") ?? "";
    const text = ((el instanceof HTMLElement ? el.innerText : el.textContent) ?? "").trim();
    return {
      path: pathOf(el),
      epistemic: el.getAttribute("data-epistemic"),
      eventId: el.getAttribute("data-event-id"),
      statusKind: el.getAttribute("data-status-kind"),
      status: el.getAttribute("data-status"),
      caseId: owner ? owner.getAttribute("data-case-id") : null,
      text: [text, label].filter(Boolean).join(" | "),
    };
  });
}

export interface EpistemicSnapshot {
  nodes: EpistemicNode[];
  /** Child frames the harness could not read (T7). */
  unreadableFrames: UnreadableFrame[];
}

export async function snapshotEpistemic(
  page: Page,
  frames: FramePage | Page = page,
): Promise<EpistemicSnapshot> {
  const nodes = await page.evaluate(collectInPage, null);
  // Child frames (e.g. a sandboxed notification preview) are checked like the main page (ARCH reviews of #7, #13).
  const { reads, unreadable } = await readChildFrames(frames, collectInPage);
  for (const { url, via, result } of reads) {
    const prefix = via === "frame" ? `frame(${url})` : `frame(${url}, srcdoc)`;
    nodes.push(...result.map((n) => ({ ...n, path: `${prefix} ${n.path}` })));
  }
  return { nodes, unreadableFrames: unreadable };
}

/** T7: a frame the harness could not read is a violation, never a pass. */
export function checkFrames(unreadableFrames: UnreadableFrame[]): TruthViolation[] {
  return unreadableFrames.map((f) => ({
    rule: "T7",
    where: `frame(${f.url})`,
    detail: `frame could not be inspected: ${f.reason}`,
  }));
}

export async function checkTruth(
  nodes: EpistemicNode[],
  oracle: EventOracle,
  now: Date = new Date(),
): Promise<TruthViolation[]> {
  const v: TruthViolation[] = [];
  const recordedTextByStatus = new Map<string, Set<string>>();

  for (const n of nodes) {
    const where = n.path;
    if (n.epistemic === null) {
      // Allow-list of one: an OPEN task with no status event. Anything else must say what it is.
      const openTask = n.statusKind === "task" && n.status === "OPEN" && n.eventId === null;
      if (!openTask)
        v.push({
          rule: "T8",
          where,
          detail: `${n.statusKind ?? "?"}/${n.status ?? "?"}${n.eventId ? ` (event ${n.eventId})` : ""} shown without data-epistemic`,
        });
      continue;
    }
    if (!(EPISTEMIC_VALUES as readonly string[]).includes(n.epistemic)) {
      v.push({ rule: "T1", where, detail: `data-epistemic ${JSON.stringify(n.epistemic)} is not allowed` });
      continue;
    }
    if (!n.statusKind || !n.status)
      v.push({ rule: "T2", where, detail: "data-status-kind and data-status are required" });

    const recorded = n.epistemic === "recorded";
    if (recorded && (!n.eventId || !UUID_EXACT.test(n.eventId))) {
      v.push({
        rule: "T3",
        where,
        detail: `recorded ${n.status} without a valid data-event-id (${JSON.stringify(n.eventId)})`,
      });
      continue;
    }
    if (!recorded && n.eventId !== null)
      v.push({ rule: "T3", where, detail: `${n.epistemic} element carries data-event-id ${n.eventId}` });

    if (!recorded && isCompletedClassStatus(n.status))
      v.push({ rule: "T5", where, detail: `${n.status} shown as ${n.epistemic}` });

    if (recorded && n.eventId) {
      const fact = await oracle.get(n.eventId);
      if (!fact) {
        v.push({ rule: "T4", where, detail: `event ${n.eventId} is not recorded` });
        continue;
      }
      if (n.caseId === null)
        v.push({ rule: "T4", where, detail: "recorded element outside any data-case-id owner" });
      else if (fact.caseId !== n.caseId)
        v.push({
          rule: "T4",
          where,
          detail: `event ${n.eventId} belongs to case ${fact.caseId}, shown under ${n.caseId}`,
        });
      if (Date.parse(fact.recordedAt) > now.getTime())
        v.push({
          rule: "T4",
          where,
          detail: `event ${n.eventId} is recorded in the future (${fact.recordedAt})`,
        });
      if (fact.status !== n.status || fact.statusKind !== n.statusKind)
        v.push({
          rule: "T4",
          where,
          detail: `shows ${n.statusKind}/${n.status}, recorded event yields ${fact.statusKind}/${fact.status}`,
        });
      const key = `${n.statusKind}/${n.status}`;
      if (!recordedTextByStatus.has(key)) recordedTextByStatus.set(key, new Set());
      recordedTextByStatus.get(key)!.add(n.text);
    }
  }

  for (const n of nodes) {
    if (n.epistemic === null || n.epistemic === "recorded" || !n.statusKind || !n.status) continue;
    if (recordedTextByStatus.get(`${n.statusKind}/${n.status}`)?.has(n.text))
      v.push({
        rule: "T6",
        where: n.path,
        detail: `${n.epistemic} reads exactly like a recorded ${n.status}: "${n.text}"`,
      });
  }
  return v;
}

export function inMemoryOracle(facts: RecordedEventFact[]): EventOracle {
  const byId = new Map(facts.map((f) => [f.eventId, f]));
  return { get: async (id) => byId.get(id) };
}

export function formatTruthViolations(violations: TruthViolation[]): string {
  return violations.map((x) => `${x.rule} ${x.where}: ${x.detail}`).join("\n");
}

export async function inspectTruth(
  page: Page,
  oracle: EventOracle,
  now?: Date,
  frames: FramePage | Page = page,
): Promise<TruthViolation[]> {
  const { nodes, unreadableFrames } = await snapshotEpistemic(page, frames);
  return [...(await checkTruth(nodes, oracle, now)), ...checkFrames(unreadableFrames)];
}
