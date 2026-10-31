// Frame walking shared by the Case Context Sentinel and the Procedural Truth Inspector (ARCH review of #13).
//
// Every child frame of the page is read with the harness's own collector. A frame the harness cannot evaluate in (a
// sandboxed preview without allow-scripts / allow-same-origin on a browser that refuses evaluation there, a
// cross-origin or detached frame) is read from its srcdoc in the parent document instead. A frame that still cannot
// be read is returned as unreadable, and the callers turn that into a violation: nothing passes silently.
import type { Frame, Page } from "@playwright/test";

/** A browser-side collector: with no argument it reads its own document; with HTML it parses and reads that. */
export type FrameCollector<T> = (html: string | null) => T;

export interface FrameRead<T> {
  url: string;
  via: "frame" | "srcdoc";
  result: T;
}

export interface UnreadableFrame {
  url: string;
  reason: string;
}

export interface FrameReads<T> {
  reads: FrameRead<T>[];
  unreadable: UnreadableFrame[];
}

/** The subset of Page the walker needs (lets the self-tests simulate a frame the harness cannot evaluate in). */
export interface FramePage {
  frames(): Frame[];
  mainFrame(): Frame;
}

const firstLine = (e: unknown) =>
  String(e instanceof Error ? e.message : e)
    .split("\n")[0]!
    .slice(0, 160);

export async function readChildFrames<T>(
  page: FramePage | Page,
  collect: FrameCollector<T>,
): Promise<FrameReads<T>> {
  const reads: FrameRead<T>[] = [];
  const unreadable: UnreadableFrame[] = [];
  const main = page.mainFrame();
  for (const frame of page.frames()) {
    if (frame === main) continue;
    const url = frame.url();
    try {
      reads.push({ url, via: "frame", result: await frame.evaluate(collect, null) });
      continue;
    } catch (e) {
      try {
        const element = await frame.frameElement();
        const srcdoc = await element.getAttribute("srcdoc");
        if (srcdoc === null) {
          unreadable.push({
            url,
            reason: `cannot evaluate in the frame and it has no srcdoc (${firstLine(e)})`,
          });
          continue;
        }
        const parent = frame.parentFrame() ?? main;
        reads.push({ url, via: "srcdoc", result: await parent.evaluate(collect, srcdoc) });
      } catch (e2) {
        unreadable.push({
          url,
          reason: `cannot evaluate in the frame or read its srcdoc (${firstLine(e2)})`,
        });
      }
    }
  }
  return { reads, unreadable };
}

/**
 * Test helper: the same page, but evaluation inside every child frame fails, as it would on a browser that refuses
 * to run anything in a sandboxed frame. Used to prove the srcdoc fallback and the unreadable-frame rule.
 */
export function refuseFrameEvaluation(page: Page): FramePage {
  const main = page.mainFrame();
  return {
    mainFrame: () => main,
    frames: () =>
      page.frames().map((f) =>
        f === main
          ? f
          : (new Proxy(f, {
              get(target, prop, receiver) {
                if (prop === "evaluate")
                  return () => Promise.reject(new Error("evaluation refused (simulated)"));
                const value = Reflect.get(target, prop, receiver);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }) as Frame),
      ),
  };
}
