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

/** true only for a renderer output made from `model` (the same object) whose subject, text and HTML are unchanged */
export function isRenderingOf(rendered: unknown, model: unknown): boolean {
  if (typeof rendered !== "object" || rendered === null || typeof model !== "object" || model === null)
    return false;
  const s = SOURCES.get(rendered);
  return !!s && s.model === model && s.digest === digestOf(rendered as Record<string, unknown>);
}
