// Shared checks for Scenarios A, B and D (TEST_ARCHITECTURE.md §6). SYNTHETIC seed data only (DATA_MODEL.md §5).
import { expect, type Page } from "@playwright/test";
import {
  CASE_REF_PATTERN,
  formatViolations,
  inspectCaseContext,
  normaliseDigits,
  UUID_SCAN_PATTERN,
} from "../sentinel/sentinel";
import { formatTruthViolations, inspectTruth, type EventOracle } from "../truth/inspector";

export const SEEDED = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, "0"));
export const caseId = (n: string) => `0c000000-0000-4000-8000-0000000000${n}`;
export const caseRef = (n: string) => `CDF-DEMO-2026-00${n}`;
export const taskId = (n: string) => `0d000000-0000-4000-8000-0000000000${n}`;
export const SEEDED_CASE_IDS: ReadonlySet<string> = new Set(SEEDED.map(caseId));

export type CaseTab = "overview" | "events" | "tasks" | "notifications";
export const casePath = (id: string, tab: CaseTab = "overview") =>
  tab === "overview" ? `/cases/${id}` : `/cases/${id}/${tab}`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The page shows exactly one case, the one the URL names, on the named tab; the Case Context Sentinel (only `id` as
 * context, only `visible` cases anywhere) and the Truth Inspector (badges against the database oracle) are clean.
 */
export async function expectCaseShown(
  page: Page,
  id: string,
  tab: CaseTab,
  visible: ReadonlyMap<string, string>,
  oracle: EventOracle,
) {
  await expect(page).toHaveURL(new RegExp(`${escape(casePath(id, tab))}$`));
  const root = page.getByTestId("case-workspace");
  await expect(root).toHaveCount(1);
  await expect(root).toHaveAttribute("data-case-id", id);
  await expect(page.getByTestId("case-number")).toContainText(visible.get(id)!);
  await expect(page.getByTestId(`case-tab-${tab}`)).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-testid^="case-tab-"][aria-current]')).toHaveCount(1);
  const v = await inspectCaseContext(page, { contextCaseId: id, visible });
  expect(v, formatViolations(v)).toEqual([]);
  const t = await inspectTruth(page, oracle);
  expect(t, formatTruthViolations(t)).toEqual([]);
}

/** No browser storage the page can read holds a case id or a case reference: the URL is the only case context. */
export async function expectNoCaseInStorage(page: Page) {
  const stored = await page.evaluate(() => {
    const dump = (s: Storage) =>
      Array.from({ length: s.length }, (_, i) => {
        const k = s.key(i) ?? "";
        return `${k}=${s.getItem(k) ?? ""}`;
      });
    return [...dump(window.localStorage), ...dump(window.sessionStorage), document.cookie].join("\n");
  });
  const text = normaliseDigits(stored);
  const ids = (text.match(UUID_SCAN_PATTERN) ?? [])
    .map((x) => x.toLowerCase())
    .filter((x) => SEEDED_CASE_IDS.has(x));
  expect(ids, "case ids in browser storage").toEqual([]);
  expect(text.match(CASE_REF_PATTERN) ?? [], "case references in browser storage").toEqual([]);
}
