// The mask width probe (V13-QA-023; docs/qa/TEST_ARCHITECTURE.md §5.4). A mask hides text that changes between runs
// (the server clock, a new id), but the text under it still takes up room: when its width changes, the page moves around
// the mask and a baseline goes red for no real change (#159's first comparison, run 42372979341). CAPTURE_STYLE gives
// each masked box a fixed size during the capture. This probe proves it does: after the comparison, every masked
// element of the cell is rewritten to values the app itself can show (each deadline state with its longest and shortest
// words, counts 0 and 999, a 36- and a 1-character id), the cell is captured again through the same path, and every
// image must be byte-identical to the cell's own capture. SYNTHETIC values only.
import { readFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";
import { formatDateTime, formatDays, formatNumber } from "@/components/format";
import { createTranslator, type Locale } from "@/lib/i18n";
import { captureCell } from "./capture";
import { settleFrames } from "./frames";
import { MASKS, withDraft, type Capture, type MaskName } from "./library-plan";

/** How a mask's elements are rewritten: the DeadlineText structure, a count tile's value, or plain text. */
export type ProbeKind = "deadline" | "count" | "text";
export const PROBE_KIND: Readonly<Record<MaskName, ProbeKind>> = {
  correlationId: "text",
  deadline: "deadline",
  deadlineCounts: "count",
  draftCreated: "text",
  noticeReference: "text",
};

/** The states DeadlineText renders (components/data/DeadlineText.tsx): its class and data-deadline-state. */
export const DEADLINE_STATES = ["upcoming", "today", "overdue"] as const;
export type DeadlineState = (typeof DEADLINE_STATES)[number];

/** The overdue glyph, read from DeadlineText itself, so the probe adds exactly what the app adds. */
export const OVERDUE_GLYPH = (() => {
  const m = /const OVERDUE_GLYPH = "([^"]+)";/.exec(readFileSync("components/data/DeadlineText.tsx", "utf8"));
  if (!m) throw new Error("OVERDUE_GLYPH not found in components/data/DeadlineText.tsx");
  return m[1]!;
})();

/** Day counts the probe looks through for the longest and shortest words: up to 999 days either way. */
const DAY_RANGE = Array.from({ length: 999 }, (_, i) => i + 1);

function extremes(values: readonly string[]): [longest: string, shortest: string] {
  const sorted = [...values].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return [sorted[0]!, sorted[sorted.length - 1]!];
}

export interface DeadlineValue {
  readonly state: DeadlineState;
  readonly words: string;
}

/** Every deadline state with its longest and shortest words in the language (the i18n keys DeadlineText uses). */
export function deadlineValues(locale: Locale): DeadlineValue[] {
  const t = createTranslator(locale);
  const words = (key: "common.deadline.inDays" | "common.deadline.overdue") =>
    extremes(DAY_RANGE.map((d) => t(key, { days: formatDays(locale, t, d) })));
  const [upLong, upShort] = words("common.deadline.inDays");
  const [overLong, overShort] = words("common.deadline.overdue");
  return [
    { state: "upcoming", words: upLong },
    { state: "upcoming", words: upShort },
    { state: "today", words: t("common.deadline.today") },
    { state: "overdue", words: overLong },
    { state: "overdue", words: overShort },
  ];
}

/** The longest and shortest date-time the app formats in the language over one year, at two times of day. */
export function dateTimeValues(locale: Locale): [string, string] {
  const values: string[] = [];
  for (let d = 0; d < 366; d += 1) {
    const day = new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
    values.push(formatDateTime(locale, `${day}T20:59:00Z`), formatDateTime(locale, `${day}T21:01:00Z`));
  }
  return extremes(values);
}

export interface ProbeVariant {
  readonly name: string;
  readonly deadline: DeadlineValue;
  /** count tile value: raw (data-count) and as the app formats it */
  readonly count: { readonly raw: number; readonly shown: string };
  /** ids (correlation id, notice reference): 36 characters or 1 */
  readonly id: string;
  readonly time: string;
}

/** One variant per deadline value; the other masks alternate between their longest and shortest values. */
export function probeVariants(locale: Locale): ProbeVariant[] {
  const [timeLong, timeShort] = dateTimeValues(locale);
  return deadlineValues(locale).map((deadline, i) => {
    const long = i % 2 === 0;
    const raw = long ? 999 : 0;
    return {
      name: `${deadline.state}-${long ? "long" : "short"}`,
      deadline,
      count: { raw, shown: formatNumber(locale, raw) },
      // the widest hex glyph ("d" in Noto Sans is wider than the digits; "f" is the narrowest), so a real UUID of
      // any digits is no wider than the long variant (V13-QA-024)
      id: long ? "dddddddd-dddd-4ddd-bddd-dddddddddddd" : "0",
      time: long ? timeLong : timeShort,
    };
  });
}

interface RewriteArg {
  kind: ProbeKind;
  text: string;
  raw?: string;
  state?: string;
  glyph?: string;
}

/** Runs in the page (or the frame): rewrites each element as the app would render the value; returns how many. */
function rewriteElements(els: Element[], arg: RewriteArg): number {
  let n = 0;
  for (const el of els) {
    if (arg.kind === "deadline") {
      const state = arg.state!;
      el.className = `v13-deadline v13-deadline-${state}`;
      el.setAttribute("data-deadline-state", state);
      el.querySelectorAll(':scope > span[aria-hidden="true"]').forEach((g) => g.remove());
      const words = el.querySelector(":scope > span:last-child");
      if (!words || words.previousElementSibling?.tagName !== "TIME") continue;
      words.textContent = arg.text;
      if (state === "overdue") {
        const glyph = el.ownerDocument.createElement("span");
        glyph.setAttribute("aria-hidden", "true");
        glyph.className = "v13-badge-glyph";
        glyph.textContent = arg.glyph!;
        el.prepend(glyph);
      }
    } else if (arg.kind === "count") {
      const value = el.firstElementChild;
      if (!value) continue;
      value.textContent = arg.text;
      el.setAttribute("data-count", arg.raw!);
    } else {
      el.textContent = arg.text;
    }
    n += 1;
  }
  return n;
}

function argFor(mask: MaskName, v: ProbeVariant): RewriteArg {
  switch (PROBE_KIND[mask]) {
    case "deadline":
      return { kind: "deadline", text: v.deadline.words, state: v.deadline.state, glyph: OVERDUE_GLYPH };
    case "count":
      return { kind: "count", text: v.count.shown, raw: String(v.count.raw) };
    case "text":
      return { kind: "text", text: mask === "draftCreated" ? v.time : v.id };
  }
}

function maskLocator(page: Page, mask: MaskName, draft: string | null): Locator {
  const m: { selector: string; frame?: string } = MASKS[mask];
  const selector = withDraft(m.selector, draft);
  return m.frame ? page.frameLocator(m.frame).locator(selector) : page.locator(selector);
}

/**
 * Rewrites a mask's elements. Inside a frame it evaluates in the frame; where the frame refuses that, it rewrites the
 * frame's srcdoc from the parent and waits for the frame again (text masks only). Neither working fails the test.
 */
async function rewriteMask(
  page: Page,
  mask: MaskName,
  draft: string | null,
  arg: RewriteArg,
): Promise<number> {
  const m: { selector: string; frame?: string } = MASKS[mask];
  try {
    return await maskLocator(page, mask, draft).evaluateAll(rewriteElements, arg);
  } catch (inFrame) {
    if (!m.frame || arg.kind !== "text") throw inFrame;
    const n = await page.locator(m.frame).evaluate(
      (iframe, a) => {
        const f = iframe as HTMLIFrameElement;
        const doc = new DOMParser().parseFromString(f.srcdoc, "text/html");
        const els = Array.from(doc.querySelectorAll(a.selector));
        for (const el of els) el.textContent = a.text;
        f.srcdoc = `<!doctype html>${doc.documentElement.outerHTML}`;
        return els.length;
      },
      { selector: withDraft(m.selector, draft), text: arg.text },
    );
    await settleFrames(page);
    return n;
  }
}

export interface MaskCount {
  matched: number;
  rewritten: number;
}

export interface ProbeResult {
  /** per mask of the row: elements matched in the cell, and elements rewritten in every variant */
  readonly masks: Record<string, MaskCount>;
  /** per variant: the capture after the rewrite, and whether it is byte-identical to the cell's own capture */
  readonly variants: { name: string; png: Buffer; identical: boolean }[];
}

/**
 * Probes one opened, captured cell. `base` is the cell's own capture. `style` replaces the capture style (only the
 * planted negative in library-index.spec.ts passes it). A mask whose elements cannot all be rewritten fails here.
 */
export async function probeMasks(
  page: Page,
  c: Capture,
  draft: string | null,
  locale: Locale,
  base: Buffer,
  options: { style?: string } = {},
): Promise<ProbeResult> {
  const counts = new Map<MaskName, MaskCount>();
  for (const mask of c.masks)
    counts.set(mask, { matched: await maskLocator(page, mask, draft).count(), rewritten: 0 });
  const masks = Object.fromEntries(counts);
  const variants: ProbeResult["variants"] = [];
  if ([...counts.values()].every((n) => n.matched === 0)) return { masks, variants };
  for (const v of probeVariants(locale)) {
    for (const [mask, count] of counts) {
      if (count.matched === 0) continue;
      const n = await rewriteMask(page, mask, draft, argFor(mask, v));
      expect(n, `mask ${mask}, variant ${v.name}: every matched element is rewritten`).toBe(count.matched);
      count.rewritten = n;
    }
    const { png } = await captureCell(page, c, draft, options);
    variants.push({ name: v.name, png, identical: png.equals(base) });
  }
  return { masks, variants };
}
