// The screenshot library's plan (V13-QA-014; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §2–§4; REQ-VIS-001, -004, -005, -010,
// -011, -015). One table names every screen and state the library captures, with the persona, the route and the masks,
// and every cell it does not capture, with the reason. The capture spec (library.spec.ts) and the committed index
// (docs/qa/SCREENSHOT_LIBRARY.md, checked by library-index.spec.ts) are both generated from it, so a state cannot be
// captured without a row here and a missing screenshot is always visible in the index.
//
// Only real states (REQ-VIS-005): every row is a real route, a real persona and a seeded row (or a query the app
// answers with its own empty or generic state). Nothing is styled, injected or routed into existence. SYNTHETIC data
// only: the seeded CDF-DEMO-2026-0001 … 0010 cases and the synthetic personas.

/** Where a run writes its images and manifest (never committed; the CI visual job's artifact). */
export const LIBRARY_DIR = "test-results/library";
export const MANIFEST_PARTS_DIR = `${LIBRARY_DIR}/manifest.d`;

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 360, height: 780 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

export const LANGUAGES = ["ar", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The app supports dark through prefers-color-scheme (styles/tokens.css); nothing else is themed. */
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The browser clock for every capture (REQ-VIS-010): one instant inside the seed's date range (cases opened Feb–Jun
 * 2026, seeded drafts Oct 2026, due dates to 20 Nov 2026). It reaches only browser-side code; server-clock text is
 * masked (D1).
 */
export const BROWSER_TIME = "2026-10-15T09:00:00.000Z";

/** The font packages the CI visual job installs (§3, §8); their versions go into the manifest. */
export const FONT_PACKAGES = [
  "fonts-liberation",
  "fonts-dejavu-core",
  "fonts-crosextra-carlito",
  "fonts-noto-core",
] as const;

/**
 * Applied during each capture only (Playwright's screenshot `style`): the masked correlation id gets a fixed inline
 * size, so a new id of a different glyph width cannot move the mask's edge. It touches nothing that is not masked.
 */
export const CAPTURE_STYLE =
  '[data-testid="correlation-id"], [data-testid="case-preview-correlation-id"] { display: inline-block; inline-size: 38ch; }';

/** One fixed mask colour, so a mask is recognisable in every image. */
export const MASK_COLOR = "#FF00FF";

/**
 * Masks: only what changes between runs (§3.1). Each is listed in the manifest with its reason. A mask never hides a
 * defect; the data check (data-check.ts) runs on the unmasked page before every capture.
 */
export const MASKS = {
  correlationId: {
    selector: '[data-testid="correlation-id"], [data-testid="case-preview-correlation-id"]',
    reason:
      "a new correlation id per request; during the capture only, the masked box gets a fixed width (CAPTURE_STYLE), because its glyph widths change with the id",
  },
  deadline: {
    selector: "[data-deadline-state]",
    reason:
      "deadline words (DeadlineText) count days on the server clock, which the browser clock cannot reach (D1)",
  },
  deadlineCounts: {
    selector: '[data-testid="count-my-work-overdue"], [data-testid="count-my-work-due-week"]',
    reason: "My Work's overdue and due-this-week counts are taken on the server clock (D1)",
  },
  draftCreated: {
    selector: '[data-testid="case-notification-{draft}"] time',
    reason: "the created time of the draft the run makes (server clock)",
  },
  noticeReference: {
    frame: '[data-testid="case-notification-preview-frame"]',
    selector: '[data-field="notice_reference"]',
    reason: "the notice reference of the draft the run makes (derived from its new id)",
  },
} as const satisfies Record<string, { selector: string; reason: string; frame?: string }>;
export type MaskName = keyof typeof MASKS;

/** The {draft} placeholder in a route or mask selector: the id of the draft the row's setup made. */
export const withDraft = (text: string, draftId: string | null) =>
  draftId === null ? text : text.replaceAll("{draft}", draftId);

export type ScreenId =
  | "my-work"
  | "portfolio"
  | "case-overview"
  | "case-events"
  | "case-tasks"
  | "case-notifications"
  | "notification-center"
  | "notification-preview"
  | "not-found"
  | "workspace-switcher"
  | "mobile-navigation";

export type StateId = "data" | "empty" | "empty-filter" | "error" | "restricted" | "no-mapping";

export interface Capture {
  readonly screen: ScreenId;
  readonly state: StateId;
  /** A persona slug from lib/contracts; negative-test personas get a minted session. */
  readonly persona: string;
  readonly route: string;
  /** The element that must be visible before the capture: the state's own marker, so a wrong state never passes. */
  readonly ready: string;
  readonly masks: readonly MaskName[];
  /** Capture only this element (the open menu, the navigation) instead of the full page. */
  readonly element?: string;
  /**
   * Make a WITNESS draft on this case through the case's own draft form before the captures (the only notification a
   * preview can show today: the seeded drafts' recipient classes have no disclosure mapping). Its id fills {draft}.
   */
  readonly draftOnCase?: string;
  /** Open the workspace switcher before the capture. */
  readonly openSwitcher?: boolean;
  /** Viewports this row applies to (default: all). */
  readonly viewports?: readonly ViewportName[];
  /** Why the row exists: the register row and how the state is reached. */
  readonly how: string;
}

export interface NotApplicable {
  readonly screen: string;
  readonly state: string;
  readonly reason: string;
}

const CASE_0001 = "0c000000-0000-4000-8000-000000000001";
const CASE_0004 = "0c000000-0000-4000-8000-000000000004";
/**
 * Investigator Beta's own case, owned by Investigations and visible to no other workspace: the run's draft there never
 * reaches a page another row captures (Secretary Alpha's Center and case pages).
 */
const CASE_0005 = "0c000000-0000-4000-8000-000000000005";
const CASE_0009 = "0c000000-0000-4000-8000-000000000009";
/** Seeded DRAFT notification 2f…01 (CASE_TEAM) on case 0001 (seed 0002_m1_cases.sql). */
const NOTIFICATION_0001 = "2f000000-0000-4000-8000-000000000001";
/** A well-formed id no row has: the app answers with its generic state, never with a hint. */
const UNKNOWN_ID = "0c000000-0000-4000-8000-0000000000ff";

const ALL_MASKS: readonly MaskName[] = ["correlationId", "deadline", "deadlineCounts"];

export const CAPTURES: readonly Capture[] = [
  {
    screen: "my-work",
    state: "data",
    persona: "investigator-beta",
    route: "/my-work",
    ready: '[data-testid^="my-work-case-"]',
    masks: ALL_MASKS,
    how: "seeded tasks assigned to Investigator Beta",
  },
  {
    screen: "my-work",
    state: "empty",
    persona: "persona-zeta",
    route: "/my-work",
    ready: '[data-testid="my-work-empty"]',
    masks: ALL_MASKS,
    how: "Persona Zeta (inactive membership, minted session): no task",
  },
  {
    screen: "portfolio",
    state: "data",
    persona: "secretary-alpha",
    route: "/portfolio",
    ready: '[data-testid^="portfolio-open-"]',
    masks: ALL_MASKS,
    how: "seeded cases visible to the Secretariat",
  },
  {
    screen: "portfolio",
    state: "empty",
    persona: "persona-zeta",
    route: "/portfolio",
    ready: '[data-testid="portfolio-empty"]',
    masks: ALL_MASKS,
    how: "Persona Zeta: no visible case",
  },
  {
    screen: "portfolio",
    state: "empty-filter",
    persona: "secretary-alpha",
    route: "/portfolio?q=ZZZ-NO-MATCH",
    ready: '[data-testid="portfolio-no-results"]',
    masks: ALL_MASKS,
    how: "a search that matches no case",
  },
  {
    screen: "case-overview",
    state: "data",
    persona: "secretary-alpha",
    route: `/cases/${CASE_0001}`,
    ready: '[data-testid="case-header"]',
    masks: ALL_MASKS,
    how: "case CDF-DEMO-2026-0001, Secretary Alpha on its team",
  },
  {
    screen: "case-events",
    state: "data",
    persona: "secretary-alpha",
    route: `/cases/${CASE_0001}/events`,
    ready: '[data-testid="case-header"]',
    masks: ALL_MASKS,
    how: "seeded procedural events of CDF-DEMO-2026-0001",
  },
  {
    screen: "case-tasks",
    state: "data",
    persona: "secretary-alpha",
    route: `/cases/${CASE_0001}/tasks`,
    ready: '[data-testid="case-header"]',
    masks: ALL_MASKS,
    how: "seeded tasks of CDF-DEMO-2026-0001",
  },
  {
    screen: "case-notifications",
    state: "data",
    persona: "secretary-alpha",
    route: `/cases/${CASE_0001}/notifications`,
    ready: `[data-testid="case-notification-${NOTIFICATION_0001}"]`,
    masks: ALL_MASKS,
    how: "seeded draft 2f…01 of CDF-DEMO-2026-0001, with the draft form",
  },
  {
    screen: "case-notifications",
    state: "empty",
    persona: "secretary-alpha",
    route: `/cases/${CASE_0004}/notifications`,
    ready: '[data-testid="case-notifications-empty"]',
    masks: ALL_MASKS,
    how: "CDF-DEMO-2026-0004 has no notification in the seed",
  },
  {
    screen: "notification-center",
    state: "data",
    persona: "secretary-alpha",
    route: "/notifications",
    ready: '[data-testid="notifications-table"]',
    masks: ALL_MASKS,
    how: "seeded drafts visible to Secretary Alpha",
  },
  {
    screen: "notification-center",
    state: "empty",
    persona: "persona-zeta",
    route: "/notifications",
    ready: '[data-testid="notifications-empty"]',
    masks: ALL_MASKS,
    how: "Persona Zeta: no notification",
  },
  {
    screen: "notification-center",
    state: "empty-filter",
    persona: "secretary-alpha",
    route: "/notifications?case=CDF-DEMO-2026-0004",
    ready: '[data-testid="notifications-no-results"]',
    masks: ALL_MASKS,
    how: "a case filter on CDF-DEMO-2026-0004, which has no notification in the seed",
  },
  {
    screen: "notification-center",
    state: "error",
    persona: "secretary-alpha",
    route: "/notifications?status=DELIVERED",
    ready: '[data-testid="notifications-invalid"]',
    masks: ALL_MASKS,
    how: "an edited URL with a status the filter does not offer: the generic invalid state with a reference",
  },

  {
    screen: "notification-preview",
    state: "data",
    persona: "investigator-beta",
    route: `/cases/${CASE_0005}/notifications?n={draft}`,
    ready: '[data-testid="case-preview-ready"]',
    masks: [...ALL_MASKS, "draftCreated", "noticeReference"],
    draftOnCase: CASE_0005,
    how: "a WITNESS draft the run makes on CDF-DEMO-2026-0005 through its draft form, in the sandboxed frame",
  },
  {
    screen: "notification-preview",
    state: "no-mapping",
    persona: "secretary-alpha",
    route: `/cases/${CASE_0001}/notifications?n=${NOTIFICATION_0001}`,
    ready: '[data-testid="case-preview-unmapped"]',
    masks: ALL_MASKS,
    how: "seeded draft 2f…01 (CASE_TEAM): no disclosure mapping for its recipient class yet, so the app shows none",
  },
  {
    screen: "notification-preview",
    state: "error",
    persona: "secretary-alpha",
    route: `/cases/${CASE_0001}/notifications?n=${UNKNOWN_ID}`,
    ready: '[data-testid="case-preview-unavailable"]',
    masks: ALL_MASKS,
    how: "an id no notification has: the generic state with a correlation id",
  },
  {
    screen: "not-found",
    state: "error",
    persona: "secretary-alpha",
    route: `/cases/${UNKNOWN_ID}`,
    ready: "main",
    masks: ALL_MASKS,
    how: "a case id no case has",
  },
  {
    screen: "not-found",
    state: "restricted",
    persona: "secretary-alpha",
    route: `/cases/${CASE_0009}`,
    ready: "main",
    masks: ALL_MASKS,
    how: "restricted CDF-DEMO-2026-0009, Secretary Alpha not on its team: restricted = not found by design (CLAUDE.md §3)",
  },
  {
    screen: "workspace-switcher",
    state: "data",
    persona: "governance-officer-delta",
    route: "/my-work",
    ready: '[data-testid="workspace-switcher"]',
    masks: ALL_MASKS,
    openSwitcher: true,
    how: "Governance Officer Delta holds two workspaces; the menu is open",
  },
  {
    screen: "mobile-navigation",
    state: "data",
    persona: "secretary-alpha",
    route: "/my-work",
    ready: '[data-testid="platform-nav"]',
    masks: ALL_MASKS,
    element: '[data-testid="platform-nav"]',
    viewports: ["mobile"],
    how: "the side navigation at 360 px",
  },
];

export const NOT_APPLICABLE: readonly NotApplicable[] = [
  {
    screen: "Notification Generator",
    state: "all",
    reason: "no page in M1; the draft form is captured with case-notifications",
  },
  {
    screen: "Search Interface",
    state: "all",
    reason: "no page in M1; the Portfolio and Center filters are captured with those screens",
  },
  {
    screen: "all screens",
    state: "loading",
    reason: "no route renders a loading state (no loading.tsx, no Suspense fallback)",
  },
  { screen: "case-events, case-tasks", state: "empty", reason: "every seeded case has events and two tasks" },
  {
    screen: "mobile-navigation",
    state: "desktop, tablet",
    reason:
      "the row is the navigation at 360 px; at 768 px and wider it is the side navigation on every screen",
  },
  {
    screen: "case pages",
    state: "restricted",
    reason: "restricted and unknown look the same by design: captured once as not-found / restricted",
  },
];

/** File name of one capture: <screen>/<state>.<lang>.<viewport>.<theme>.png (§2.4). */
export const captureFile = (c: Capture, lang: Language, viewport: ViewportName, theme: Theme) =>
  `${c.screen}/${c.state}.${lang}.${viewport}.${theme}.png`;

export const viewportsOf = (c: Capture): readonly ViewportName[] =>
  c.viewports ?? (Object.keys(VIEWPORTS) as ViewportName[]);

/** The number of images one run writes. */
export const imageCount = () =>
  CAPTURES.reduce((n, c) => n + viewportsOf(c).length * LANGUAGES.length * THEMES.length, 0);

/** docs/qa/SCREENSHOT_LIBRARY.md, generated from this plan. Never hand-edited (library-index.spec.ts checks it). */
export function renderIndex(): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const lines = [
    "# Screenshot library index (V13-QA-014)",
    "",
    "<!-- Generated from tests/visual/library-plan.ts by `V13_E2E_VISUAL=index pnpm exec playwright test tests/visual/library-index.spec.ts`. Do not edit by hand. -->",
    "",
    "Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION. Seeded synthetic data only (`CDF-DEMO-2026-0001` … `0010`,",
    "synthetic personas). Design: `docs/qa/M1_OPEN_QA_ROWS_DESIGN.md` §2–§4.",
    "",
    "The images are not committed. They are the artifact of the CI visual job (`test-results/library/`), with",
    "`manifest.json` listing each file, its persona, route, masks, commit and font versions. Run locally with",
    "`pnpm db:reset && V13_E2E_VISUAL=library pnpm exec playwright test --project=visual-library`; local images are",
    "for looking only, never baselines (fonts differ by machine).",
    "",
    `Matrix: ${Object.entries(VIEWPORTS)
      .map(([k, v]) => `${k} ${v.width} × ${v.height}`)
      .join(", ")}; ${LANGUAGES.join(", ")}; ${THEMES.join(", ")}. ${imageCount()} images per run.`,
    `Browser clock fixed at ${BROWSER_TIME}; reduced motion; animations disabled; caret hidden; mask colour ${MASK_COLOR}.`,
    `Capture-only style (masked boxes only): \`${CAPTURE_STYLE}\``,
    "",
    "## Captured",
    "",
    "| Screen | State | Persona | Route | Viewports | Masks | How the state is reached |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...CAPTURES.map(
      (c) =>
        `| ${c.screen} | ${c.state} | ${c.persona} | \`${cell(c.route)}\` | ${viewportsOf(c).join(", ")} | ${c.masks.join(", ")} | ${cell(c.how)} |`,
    ),
    "",
    "## Masks",
    "",
    "| Mask | Selector | Reason |",
    "| --- | --- | --- |",
    ...Object.entries(MASKS).map(
      ([k, m]: [string, { selector: string; reason: string; frame?: string }]) =>
        `| ${k} | ${m.frame ? `in \`${cell(m.frame)}\`: ` : ""}\`${cell(m.selector)}\` | ${cell(m.reason)} |`,
    ),
    "",
    "## Not applicable",
    "",
    "| Screen | State | Reason |",
    "| --- | --- | --- |",
    ...NOT_APPLICABLE.map((n) => `| ${cell(n.screen)} | ${cell(n.state)} | ${cell(n.reason)} |`),
    "",
    "## Baselines (V13-QA-015)",
    "",
    `Committed under \`tests/visual/__screenshots__/\` and compared by the \`visual-baseline\` project (V13_E2E_VISUAL=baseline): ${BASELINE_VIEWPORTS.join(", ")}; ${LANGUAGES.join(", ")}; ${BASELINE_THEME}; threshold ${BASELINE_COMPARE.threshold}, at most ${BASELINE_COMPARE.maxDiffPixels} differing pixels. ${baselineCount()} images. Never written by the runner in CI (G7); a missing one fails and its candidate goes to \`${BASELINE_CANDIDATES_DIR}/\`.`,
    "",
    "| Screen | State | Files |",
    "| --- | --- | --- |",
    ...BASELINE_ROWS.map(
      (c) =>
        `| ${c.screen} | ${c.state} | ${LANGUAGES.flatMap((l) => BASELINE_VIEWPORTS.map((v) => `\`${baselineFile(c, l, v)}\``)).join(", ")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

/**
 * The committed regression subset (V13-QA-015, design §5.1, D2): each screen's data state and the open workspace
 * switcher, at desktop and mobile, in ar and en, light theme. Compared on every run of the `visual-baseline` project with
 * toHaveScreenshot; the full library stays an artifact. Baselines are made only in the CI visual job (fonts, §3).
 */
export const BASELINE_ROWS: readonly Capture[] = CAPTURES.filter(
  (c) => c.state === "data" && c.screen !== "mobile-navigation",
);
export const BASELINE_VIEWPORTS: readonly ViewportName[] = ["desktop", "mobile"];
export const BASELINE_THEME: Theme = "light";
/** Pixel comparison (design §5.1): per-pixel colour threshold 0.2, and not one pixel may differ beyond it. */
export const BASELINE_COMPARE = { threshold: 0.2, maxDiffPixels: 0 } as const;

/**
 * File name of one baseline under tests/visual/__screenshots__/ (one Linux image set; no platform suffix). Dashes, not
 * dots: Playwright turns every dot before the extension into a dash, and the name must be the file's own.
 */
export const baselineFile = (c: Capture, lang: Language, viewport: ViewportName) =>
  `${c.screen}-${c.state}-${lang}-${viewport}.png`;

/**
 * Where the spec writes the image of a baseline that does not exist yet (Playwright fails a missing baseline under
 * updateSnapshots "none" but writes no actual image). The CI visual job uploads this folder; a reviewed PR copies its
 * images into tests/visual/__screenshots__/ (§5.2). Never read by any comparison.
 */
export const BASELINE_CANDIDATES_DIR = "test-results/baseline-candidates";

export const baselineCount = () => BASELINE_ROWS.length * BASELINE_VIEWPORTS.length * LANGUAGES.length;
