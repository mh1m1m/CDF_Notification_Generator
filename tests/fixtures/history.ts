// Browser history steps that cannot race the browser process (V13-QA-002, ARCH diagnosis on #63). Chromium only, the
// one browser QA runs: it reads the history over CDP.
//
// page.goBack() asks the browser process for its history (CDP Page.getNavigationHistory) and steps to the entry before
// the current one. A click that loads a new document (a GET form's Apply) returns once the renderer reports that
// document, which can be before the browser process has recorded it as the current entry. Under load goBack then still
// sees the previous entry as current and steps back one entry too far. So: first wait until the browser's current
// entry is the page's URL, then step.
import { expect, type Page } from "@playwright/test";

async function settleHistory(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await expect
      .poll(
        async () => {
          const { currentIndex, entries } = await cdp.send("Page.getNavigationHistory");
          return entries[currentIndex]?.url;
        },
        { message: "the browser's current history entry is the page's URL", timeout: 5000 },
      )
      .toBe(page.url());
  } finally {
    await cdp.detach();
  }
}

/** page.goBack() once the browser process has recorded the current document as the current entry. */
export async function goBackOneEntry(page: Page): Promise<void> {
  await settleHistory(page);
  await page.goBack();
}

/** page.goForward() once the browser process has recorded the current document as the current entry. */
export async function goForwardOneEntry(page: Page): Promise<void> {
  await settleHistory(page);
  await page.goForward();
}
