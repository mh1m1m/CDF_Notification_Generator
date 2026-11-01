import "server-only";
/**
 * CDF Notifications V13 — rendering provenance (V13-PROC-022, OI-053). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
 * renderEmail records, for each rendering it returns, the projected model it was rendered from and a digest of its
 * subject, text and HTML. The lifecycle's export (lib/notifications/lifecycle/notification.ts#exportEml) accepts a
 * rendering only when it came from the very model the export validated, unchanged since: a rendering of another
 * notification (another case) or an edited rendering is refused before any bytes are built.
 * Process-local (a WeakMap): a rendering is bound only within the request that rendered it.
 */
import { createHash } from "node:crypto";

interface Source {
  readonly model: object;
  readonly digest: string;
}
const SOURCES = new WeakMap<object, Source>();

function digestOf(r: { subject?: unknown; text?: unknown; html?: unknown }): string {
  return createHash("sha256")
    .update(JSON.stringify([r.subject ?? null, r.text ?? null, r.html ?? null]))
    .digest("hex");
}

/** called by the renderer on its own output only */
export function recordRendering(
  rendered: { subject?: unknown; text?: unknown; html?: unknown },
  model: object,
): void {
  SOURCES.set(rendered, { model, digest: digestOf(rendered) });
}

/** what the export reads from a rendering: subject, text and HTML */
export interface RenderedContent {
  readonly subject?: unknown;
  readonly text?: unknown;
  readonly html?: unknown;
}

/**
 * Reads subject, text and HTML once, as plain values. Returns null when any of them is an accessor (a getter could
 * answer the check with one value and the export with another), so the caller checks and exports the same snapshot.
 */
export function snapshotRendering(rendered: unknown): RenderedContent | null {
  if (typeof rendered !== "object" || rendered === null) return null;
  const out: Record<string, unknown> = {};
  for (const k of ["subject", "text", "html"] as const) {
    const d = Object.getOwnPropertyDescriptor(rendered, k);
    if (d && !("value" in d)) return null;
    out[k] = d ? d.value : undefined;
  }
  return Object.freeze(out);
}

/**
 * true only for a renderer output made from `model` (the same object) whose subject, text and HTML are unchanged.
 * `content` is the snapshot the caller will use (snapshotRendering); without it, one is taken here.
 */
export function isRenderingOf(
  rendered: unknown,
  model: unknown,
  content: RenderedContent | null = snapshotRendering(rendered),
): boolean {
  if (typeof rendered !== "object" || rendered === null || typeof model !== "object" || model === null)
    return false;
  if (!content) return false;
  const s = SOURCES.get(rendered);
  return !!s && s.model === model && s.digest === digestOf(content);
}
