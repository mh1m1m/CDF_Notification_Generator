// Frames in a capture (V13-QA-014, ARCH CHANGES on #140, C1–C2). The notice preview is a sandboxed srcdoc frame
// (components/data/NotificationPreviewFrame.tsx). Chromium did not paint it when it sat below the viewport (every mobile
// preview came out as an empty box), and a data check that read it before it loaded could pass on an empty document.
// So before the data check and the capture, each frame is brought into view and must show its content with its fonts
// loaded; after the capture, the frame's area of the image must not be one flat colour. SYNTHETIC data only.
import { expect, type Page } from "@playwright/test";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Brings every frame into view and waits for its content and fonts. The page stays scrolled to the last frame: back at
 * the top, Chromium again left a frame below the viewport unpainted in the full-page capture.
 */
export async function settleFrames(page: Page): Promise<void> {
  const frames = page.locator("iframe");
  const n = await frames.count();
  for (let i = 0; i < n; i += 1) {
    const el = frames.nth(i);
    await el.scrollIntoViewIfNeeded();
    // An empty document is never a loaded preview: the renderer's document always has text.
    await expect(el.contentFrame().locator("body"), `frame ${i + 1} shows its content`).not.toHaveText(
      /^\s*$/,
    );
    const frame = await (await el.elementHandle())!.contentFrame();
    expect(frame, `frame ${i + 1} is attached`).not.toBeNull();
    await frame!.evaluate(() => document.fonts.ready.then(() => undefined));
  }
  // two animation frames, so the scroll and the frames' first paint are done before the capture
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/** Each frame's box in page coordinates (the coordinates of a full-page capture taken from the top). */
export async function frameBoxes(page: Page): Promise<Box[]> {
  return page.locator("iframe").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
    }),
  );
}

/** Minimum distinct colours inside a painted frame: any text gives dozens; an empty frame gives one. */
export const MIN_FRAME_COLOURS = 8;

/**
 * Distinct colours inside each box of a PNG (inset 3 px, clear of the frame's border), decoded in the browser
 * (createImageBitmap on a Blob: no network, no CSP request). The mask colour is not counted.
 */
export async function frameColours(
  page: Page,
  png: Buffer,
  boxes: Box[],
  maskColor: string,
): Promise<number[]> {
  return page.evaluate(
    async ({ b64, boxes, mask }) => {
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const m = mask.replace("#", "").toLowerCase();
      return boxes.map((box) => {
        const x = Math.max(0, Math.round(box.x) + 3);
        const y = Math.max(0, Math.round(box.y) + 3);
        const w = Math.min(bitmap.width - x, Math.round(box.width) - 6);
        const h = Math.min(bitmap.height - y, Math.round(box.height) - 6);
        if (w <= 0 || h <= 0) return 0;
        const data = ctx.getImageData(x, y, w, h).data;
        const seen = new Set<string>();
        for (let i = 0; i < data.length; i += 4) {
          const hex = [data[i], data[i + 1], data[i + 2]]
            .map((v) => (v ?? 0).toString(16).padStart(2, "0"))
            .join("");
          if (hex !== m) seen.add(hex);
        }
        return seen.size;
      });
    },
    { b64: png.toString("base64"), boxes, mask: maskColor },
  );
}

/** Fails when a frame's area of the capture is (nearly) one flat colour: an empty frame is never an image. */
export async function expectFramesPainted(
  page: Page,
  png: Buffer,
  boxes: Box[],
  maskColor: string,
): Promise<void> {
  if (boxes.length === 0) return;
  const colours = await frameColours(page, png, boxes, maskColor);
  colours.forEach((count, i) =>
    expect(count, `frame ${i + 1} is painted in the capture (distinct colours)`).toBeGreaterThanOrEqual(
      MIN_FRAME_COLOURS,
    ),
  );
}
