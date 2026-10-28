# Design system — CDF V13 Enterprise · نظام التصميم

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team UX, tasks V13-UX-001 (tokens), V13-UX-002
(shell), V13-UX-003 (data components). Status: SPEC, PROPOSED for QA review; code follows when V13-ARCH-001 is on
`develop`. Governing decision: ADR-009 (one token source, `styles/tokens.css`).

## 1. Token source (V13-UX-001)

### 1.1 Lineage

```
CDF Design Guide (DG, pages)  →  CDF_Design_Tokens.json v1.1 (TOK)  →  case platform tokens.css (PLT, AA-adjusted, tested)
                                                                     →  V13 styles/tokens.css  (this repo, single source)
```

`styles/tokens.css` copies the PLT primitives and semantic layer **unchanged in value** (light and dark), keeps the PLT
comments that record each AA deviation from TOK, and adds only what V13 needs (§1.3). The copy is deliberate: the PLT
package is private to its monorepo (`docs/CURRENT_STATE_ARCHITECTURE.md` §5). Drift control: a unit test
(`tests/unit/components/tokens.spec.ts`) pins every copied value to the PLT value at `feffabe`; a change to either side
must update the pin in the same PR, with a reason.

### 1.2 Kept from PLT (FACT, values measured there)

- Primitives: the seven brand colours and the neutral scale.
- Semantic light/dark: bg, surface, surface-subtle, text, text-secondary, text-muted (= secondary, because TOK
  `#8B9095` fails AA), border (decorative only, 1.50:1), border-control (neutral-70, ≥ 3:1 on every background),
  primary, focus, success/warning/danger/info inks and tints, critical, selected, hover, pressed, disabled,
  surface-elevated, overlay, table header.
- Indicators: classification fills with Cinder outline + glyph, named access, legal hold (never red).
- Type scale from TOK (Display 32/39 … Body 3 10/12), motion 120/180/240 ms, reduced-motion rule, focus outline 3 px.

### 1.3 Added for V13

| Token | Light | Dark | Reason |
| ----- | ----- | ---- | ------ |
| `--cdf-header-bg` | `#d7d2cb` (Warm Gray) | `#303841` | DG p. 29: header 48 px Warm Gray, Cinder title. Cinder on Warm Gray = 13.2:1 (to be pinned by test) |
| `--cdf-header-text` | `#101820` | `#ffffff` | DG p. 29 |
| `--cdf-banner-bg` / `--cdf-banner-text` | `#fdd086` / `#101820` | `#3a2f1a` / `#fdd086` | synthetic-data banner; Chardonnay is a brand colour, Cinder text ≥ 7:1 (to be pinned) |
| `--cdf-expected-border` | `#5e646b` dashed | `#8b9095` dashed | Layer B outline. V13 used `#878B8F` (CB 50) = 3.43:1 on white, below 3:1 on some tints; neutral-70 reaches 5.98:1 (RULING (UX), §6 D3) |
| `--cdf-expected-text` | `#5e646b` | `#babdc0` | Layer B text (muted, still ≥ 4.5:1) |
| `--cdf-radius-control` | `0` | `0` | DG p. 33 buttons, p. 37 cards, p. 42 tables: square corners (RULING (UX), §6 D1) |
| `--cdf-radius-pill` | `9999px` | `9999px` | status chips only (DG p. 34 trend chips are pills) |
| `--cdf-header-height` | `48px` | — | DG p. 29 |
| `--cdf-touch-min` | `44px` | — | WCAG 2.5.8 is 24 px; 44 px chosen for primary controls (same as PLT `min-h-11`) |
| `--cdf-space-1 … --cdf-space-10` | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px | — | TOK spacing scale as named tokens |
| `--cdf-font-ar` / `--cdf-font-latin` | see §1.4 | | |

### 1.4 Fonts — SOURCE_REQUIRED (OI-005)

- Arabic brand font: **SOURCE_REQUIRED**. The DG names no Arabic face; the brand compliance matrix marks it
  BRAND_SOURCE_REQUIRED. V13's reference package used IBM Plex Sans Arabic as UNVERIFIED. Fallback stack (no web-font
  download, nothing to license): `--cdf-font-ar: "Segoe UI", Tahoma, "Noto Sans Arabic", "Geeza Pro", Arial, sans-serif`
  — identical to PLT, so both CDF apps look the same until the owner supplies the font.
- Latin: DG pp. 21–27 specify Calibri. Stack: `--cdf-font-latin: Calibri, Carlito, "Segoe UI", Arial, sans-serif`
  (Carlito is metric-compatible and free; used only if installed).
- The token file carries the comment `/* BRAND FONT SOURCE_REQUIRED (OI-005): fallback stack in use */`, and the
  design-system page in the app (M2) shows the label. `html[lang="ar"]` uses `--cdf-font-ar`, `html[lang="en"]` uses
  `--cdf-font-latin`.
- Minimum text size in the app: 12 px (Body 2). Body 3 (10 px) is not used for content (DG p. 30 footer → 12 px,
  documented deviation, same as V13 reference).

### 1.5 Delivery format

DECIDED (ADR-013): Tailwind 4 with an `@theme inline` block in `styles/tokens.css` mapping tokens to utilities, as PLT
does, so PLT components port with minimal change; `globals.css` imports it.

### 1.6 Tests (V13-UX-001 acceptance)

`tests/unit/components/tokens.spec.ts` parses `styles/tokens.css` and asserts, for light and dark:
text on bg/surface/surface-subtle ≥ 4.5:1; secondary text ≥ 4.5:1; border-control ≥ 3:1 on every background and tint
(PLT set); status inks on their tints ≥ 4.5:1; banner and header text ≥ 4.5:1; expected border ≥ 3:1 on surface and
surface-subtle; focus colour ≥ 3:1 on bg and surface; PLT pin (§1.1). Negative: a test that the decorative border is
below 3:1 and is not used for controls; a lint-style test that no file in `components/**` contains a hex, `rgb(` or
`hsl(` literal (board acceptance "no literal colours in components").

---

## 2. Shell components (V13-UX-002) — `components/shell/`

All server components unless stated; text comes in as props from `lib/i18n` (components never import strings, so FE
pages choose the namespace); layout uses logical properties only (`ms-`, `pe-`, `start`, `end`, `inline-size`).

| Component | Props (TypeScript sketch) | Behaviour and accessibility | Test ids |
| --------- | ------------------------- | --------------------------- | -------- |
| `AppShell` | `{ banner: ReactNode; topBar: ReactNode; sideNav?: ReactNode; breadcrumbs?: ReactNode; children }` | Skip link "انتقل إلى المحتوى" first in tab order; landmarks `header`, `nav`, `main#main`; on < 768 px SideNav becomes a horizontal scroll row under the TopBar (PLT pattern), no hamburger needed for ≤ 5 items | `app-shell`, `skip-link` |
| `SyntheticDataBanner` | `{ label: string }` | Always rendered, not dismissible, `role="note"`, glyph (flask) + text; Chardonnay fill + Cinder text; never hidden in screenshots | `synthetic-banner` |
| `TopBar` | `{ productName; logo: { src; alt }; workspace: ReactNode; language: ReactNode; persona: ReactNode }` | 48 px, Warm Gray, product name H2 Regular (DG p. 29); logo 152×26 at the start edge; controls ≥ 44 px targets | `top-bar` |
| `SideNav` | `{ label: string; items: { key; href; label; count?; countLabel? }[]; current?: string }` | `nav aria-label`; `aria-current="page"` + 4 px inline-start bar + selected tint (not colour alone); counts "9+" cap with sr-only label (PLT) | `app-sidebar`, `nav-<key>` |
| `WorkspaceSwitcher` | `{ label; current: { code; name; role }; options: { code; name; role; current: boolean }[]; action: (formData) => Promise<void> \| string; pageHref: "/workspaces" }` | Client component (disclosure). Single option → plain text. Each option is a `<form>` submit. Escape closes, focus returns. Without JS: a link to `pageHref`. Active option: check glyph + "الحالية" + `aria-current="true"` | `workspace-switcher`, `workspace-option-<CODE>`, `workspace-current` |
| `LanguageSwitch` | `{ current: "ar" \| "en"; action; labels }` | Form submit setting the locale cookie; the option is labelled in its own language ("English", "العربية") with `lang` attribute | `language-switch` |
| `PersonaMenu` | `{ name; roleLabel; signOutAction; labels }` | Disclosure (`<details>` works without JS); shows synthetic persona name and role; sign out | `persona-menu`, `sign-out` |
| `Breadcrumbs` | `{ label; items: { href?; label }[] }` | `nav aria-label="مسار التنقل"`, ordered list, last item `aria-current="page"` without link; separators are CSS, mirrored in RTL | `breadcrumbs` |
| `CaseHeader` | `{ caseId; displayNumber; title; stage: StatusBadgeProps; recordsState: { code; label }; restricted?: { label }; capacity?: string; labels }` | `header` with `data-case-id={caseId}`; display number in `<bdi dir="ltr">`; indicators by shape + glyph; closed case shows a read-only notice slot | `case-header`, `case-number`, `case-stage` |
| `PageHeading` | `{ title; subtitle?; actions? }` | the page's only `h1`; actions at the inline-end | `page-heading` |

Keyboard paths to verify (acceptance): skip link → main; Tab order banner → TopBar controls → SideNav → main; switcher
fully operable by keyboard; visible 3 px focus ring on every control in both themes.

---

## 3. Data components (V13-UX-003) — `components/data/`

### 3.1 StatusBadge — the epistemic rule

**Rule (FACT, V13 charter §0.5 via `epistemic.js`): the certainty shown must never exceed the certainty of the
source.** The badge enforces it in its type, so a page **cannot** draw a recorded-looking badge without a recorded
event:

```ts
type StatusBadgeProps =
  | { variant: "actual"; state: LayerAState; label: string; evidence: { eventId: string; recordedAt: string } }
  | { variant: "expected"; label: string }
  | { variant: "conditional"; label: string; condition: string }
  | { variant: "awaiting-approval"; label: string; approver?: string };
// LayerAState = COMPLETED | IN_PROGRESS | PENDING | SUSPENDED | RETURNED | CANCELLED | FAILED | NOT_APPLICABLE
```

Rendered attributes for the Procedural Truth Inspector: `data-epistemic` (`RECORDED_FACT` for actual,
`EXPECTED_PROCESS` for expected and awaiting-approval, `CONDITIONAL_STEP` for conditional), `data-state`, and for
actual `data-event-id`. Domain tone (info/success/…) for actual badges comes from one registry per status domain, as in
PLT `STATUS_TONES` (unknown code → neutral, never red).

**Four variants, distinct without colour** (each differs from every other in at least two of glyph, outline, fill,
words):

| Variant | Meaning | Glyph | Outline | Fill | Visible words | aria suffix |
| ------- | ------- | ----- | ------- | ---- | ------------- | ----------- |
| actual | a recorded event set this state | Layer A symbol (✔ ● ○ ⏸ ↩ ✕ ⚠ —) | solid 1 px (2 px for IN_PROGRESS) | tone tint | the state label, e.g. "اكتمل" | "— تم تسجيله" with recorded time |
| expected | the process says this step is next; nothing recorded | ◇ | dashed 1 px `--cdf-expected-border` | none | label + "(متوقع)" | "— لم يحدث بعد" |
| conditional | may happen depending on a condition | ◇ | dotted 2 px `--cdf-expected-border` | none | "مشروط: " + label + " — بحسب " + condition | "— خطوة محتملة، لم تحدث" |
| awaiting-approval | the step needs an approval that has not been given | ◇ followed by a stamp glyph | dashed 1 px + 4 px inline-start bar | none | label + "(رهن الاعتماد)" | "— بانتظار الاعتماد، لم يُعتمد" |

Forbidden (unit-tested negatives): an expected/conditional/awaiting badge containing ✔ or ●, or the words سُجل /
اكتُمل / تم (V13 `LAYER_B_FORBIDDEN_WORDS`), in either language's label; an actual badge without `evidence.eventId`
(compile error, plus a runtime guard that renders nothing and logs a content-free warning if called from untyped
code). Greyscale and unstyled screenshots must still show the four as different (QA, following the V13 legend page).

### 3.2 Indicators

`NamedAccessFlag` (restricted case), `RecordsStateBadge` (ACTIVE / CLOSED with glyph + word), ported from PLT
`CDFNamedAccessFlag` pattern: rectangle (radius 0), Cinder outline, glyph, never red. Classification levels are not in
M1 data; the component waits for PROC/DB.

### 3.3 Notification sending family (used in S3/S4)

Ported from V13 DESIGN_SYSTEM §4.4 (FACT, lead rulings L-02, L-04, L-07): `SENT_UNCONFIRMED` ✉ «أُرسل — لم يُؤكَّد
التسليم» · `DELIVERED_IN_APP` ⬇ · `DELIVERED_REPORT` ⬇ (defined, not reachable today) · `FAILED` ⚠ · `CORRECTION_PENDING`
✎ (quiet: no fill) · `SUPERSEDED` ↻. Never ✔ (reserved for a recorded Layer A completion). Draft/approval states of M4–
M5 are added when PROC fixes the lifecycle (V13-PROC-005).

### 3.4 Other data components

| Component | Props sketch | Rules | Test ids |
| --------- | ------------ | ----- | -------- |
| `DataTable<Row>` | `{ caption; columns: { key; header; cell(row); rowHeader?; sort?: { href; direction? } }[]; rows; rowKey(row); rowCaseId?(row); empty: ReactNode; pagination?: { prevHref?; nextHref?; summary? } }` | Native `<table>`; DG p. 42–44: Cinder header with white text, alternate rows `--cdf-surface-subtle`, 12 px cell padding, radius 0; sort headers are links with `aria-sort`; `data-case-id` on each `tr` when `rowCaseId` is given; horizontal scroll inside a focusable `region` with a label on narrow screens (PLT `scroll-region`), never page-level overflow | `<testId>`, `<testId>-row-<key>` |
| `Pagination` | `{ label; prevHref?; nextHref?; summary? }` | links, not buttons; arrows mirror in RTL | `pagination-prev`, `pagination-next` |
| `FilterBar` | `{ action: string; children }` | GET form; submit button "تطبيق"; "مسح" link resets URL | `filter-bar` |
| `Timeline` | `{ label; entries: { eventId; caseId; title; occurredAt; recordedAt; actor?; badge: actual StatusBadgeProps }[] }` | Ordered list, newest first; **only actual entries** (type: badge.variant = "actual"); shows "وقع في / سُجّل في" when the times differ; each `li` has `data-event-id` and `data-case-id` | `timeline`, `timeline-entry-<eventId>` |
| `ExpectedSteps` | `{ label; steps: (expected \| conditional \| awaiting-approval StatusBadgeProps)[] }` | Separate list from Timeline, heading "الخطوات المتوقعة"; never merged with actual entries (PLAN M3 rule "actual and expected never merged") | `expected-steps` |
| `EmptyState` | `{ title; body?; action? }` | neutral, outline glyph, no illustration; text says what is empty and why it may be empty | `empty-state` |
| `ErrorState` | `{ title; body; correlationId; correlationLabel; retryHref? }` | generic words only ("تعذّر عرض هذه الصفحة الآن"), correlation id in `<code>` with a copy button (progressive), no stack, SQL or ids other than the correlation id; `role="alert"` only for errors after a user action, otherwise a normal region | `error-state`, `correlation-id` |
| `NotFoundState` | `{ title; body; backHref; correlationId }` | the single page for unknown / unauthorised / restricted / other workspace; identical markup apart from correlation id | `not-found-state` |
| `LoadingState` | `{ label; rows? }` | skeleton blocks with `aria-busy="true"` on the region and a visually hidden "جارٍ التحميل…"; no spinner-only states; respects reduced motion | `loading-state` |
| `DeadlineText` | `{ due: string; now: string; labels }` | date + words ("متأخر ٣ أيام", "يستحق اليوم", "خلال ٥ أيام"), warning glyph when overdue; `now` comes from the server `ClockPort`, never `Date.now()` in the component | `deadline` |
| `Button` | `{ variant: "primary" \| "secondary" \| "tertiary" \| "text"; … }` | DG p. 33: primary Cinder/white, secondary white with Cinder 1 px border (0.5 px in DG, rendered 1 px), tertiary 2 px bottom stroke, text plain; radius 0; height ≥ 44 px; `critical` only inside a confirm dialog (PLT) | `data-testid` passed through |
| `ConfirmDialog` | `{ title; body; confirmLabel; cancelLabel; action }` | native `<dialog>`, focus trapped by the platform, Escape cancels, focus returns to the opener | `confirm-dialog` |

### 3.5 Tests (V13-UX-002/003 acceptance)

Unit (`tests/unit/components/`): render each component in ar and en; assert landmarks, `aria-current`, `aria-sort`,
`data-case-id` / `data-event-id` / `data-epistemic` attributes, logical-property classes only (no `left`/`right`/
`ml-`/`mr-`), and the StatusBadge negatives in §3.1. A11y and screenshots of composed pages are QA's (`tests/a11y`,
`tests/visual`); UX supplies a component gallery route (`/dev/components`, only when `V13_PERSONA_SIGNIN=enabled`,
PROPOSAL to ARCH/FE) so QA can run axe and screenshot every component state in both directions.

---

## 4. Case Context Sentinel hooks

Every component that renders case-scoped content accepts the case id and writes it as `data-case-id`: CaseHeader, rows
of DataTable (via `rowCaseId`), Timeline entries, notification rows. QA's Sentinel asserts that on a `/cases/[id]`
page every `data-case-id` in `main` equals `id`, and on cross-case lists each row's `data-case-id` matches its case
link. A component that shows case content without a case id is a defect.

## 5. RTL rules

`dir` and `lang` on `<html>` (set by ARCH's layout from the locale). Logical properties only. Directional glyphs (back
arrows, chevrons, breadcrumb separators) mirror with `[dir="rtl"] { transform: scaleX(-1) }` on the icon only; status
glyphs (✔ ↩ ↻) do **not** mirror. Numbers: Arabic-Indic digits for Arabic UI text via `Intl.NumberFormat`; display
numbers and correlation ids stay Latin inside `<bdi dir="ltr">`. Truncation with `text-overflow: ellipsis` only with a
full-text `title` or a visible expansion, never for case numbers.

## 6. Design rulings and open items

| Id | Topic | Ruling / item | Status |
| -- | ----- | ------------- | ------ |
| D1 | Corner radius | DG pp. 33, 37, 42: square buttons, cards, tables. V13 uses radius 0 for those and inputs; pills only for status chips. PLT uses 4–12 px; the two CDF apps will differ here | RULING (UX); flagged to ARCH for awareness |
| D2 | Logo position in English | DG p. 29 "always on the right". Arabic: start edge = right ✓. English: mirrored to the left with the rest of the frame | RULING (UX); brand confirmation SOURCE_REQUIRED |
| D3 | Expected-step outline colour | V13 reference `#878B8F` (3.43:1) → neutral-70 `#5E646B` (5.98:1 on white) | RULING (UX), accessibility |
| D4 | Arabic brand font | fallback stack, labelled | SOURCE_REQUIRED (OI-005, owner) |
| D5 | Dark mode in M1 | tokens complete; no theme switch in M1, follows `prefers-color-scheme` | PROPOSAL |
| D6 | Investigator access to the Notification Operations Center | case tab only | PROPOSAL (SEC matrix) |
| D7 | Styling technology | Tailwind 4 + `@theme` in `styles/tokens.css` | CLOSED: ARCH, ADR-013 (develop `38dc495`) |
| D8 | Component test tooling | `react-dom/server` `renderToStaticMarkup` in the node environment, `tests/unit/**/*.spec.{ts,tsx}`; behaviour in Playwright | CLOSED: ARCH, 28 Oct |
| D9 | E-mail tokens | PROC keeps a frozen e-mail token snapshot in `lib/notifications/render` (literal values for inline e-mail styles); once `styles/tokens.css` exists, a PROC unit test pins every colour the two share to the `tokens.css` value, and e-mail-only tokens stay in PROC's file | AGREED UX + PROC (via ARCH) |
