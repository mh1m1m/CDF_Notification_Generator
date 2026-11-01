# Screenshot library index (V13-QA-014)

<!-- Generated from tests/visual/library-plan.ts by `V13_E2E_VISUAL=index pnpm exec playwright test tests/visual/library-index.spec.ts`. Do not edit by hand. -->

Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION. Seeded synthetic data only (`CDF-DEMO-2026-0001` … `0010`,
synthetic personas). Design: `docs/qa/M1_OPEN_QA_ROWS_DESIGN.md` §2–§4.

The images are not committed. They are the artifact of the CI visual job (`test-results/library/`), with
`manifest.json` listing each file, its persona, route, masks, commit and font versions. Run locally with
`pnpm db:reset && V13_E2E_VISUAL=library pnpm exec playwright test --project=visual-library`; local images are
for looking only, never baselines (fonts differ by machine).

Matrix: desktop 1280 × 800, tablet 768 × 1024, mobile 360 × 780; ar, en; light, dark. 244 images per run.
Browser clock fixed at 2026-10-15T09:00:00.000Z; reduced motion; animations disabled; caret hidden; mask colour #FF00FF.
Capture-only style (masked boxes only): `[data-testid="correlation-id"], [data-testid="case-preview-correlation-id"] { display: inline-block; inline-size: 38ch; }`

## Captured

| Screen | State | Persona | Route | Viewports | Masks | How the state is reached |
| --- | --- | --- | --- | --- | --- | --- |
| my-work | data | investigator-beta | `/my-work` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | seeded tasks assigned to Investigator Beta |
| my-work | empty | persona-zeta | `/my-work` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | Persona Zeta (inactive membership, minted session): no task |
| portfolio | data | secretary-alpha | `/portfolio` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | seeded cases visible to the Secretariat |
| portfolio | empty | persona-zeta | `/portfolio` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | Persona Zeta: no visible case |
| portfolio | empty-filter | secretary-alpha | `/portfolio?q=ZZZ-NO-MATCH` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | a search that matches no case |
| case-overview | data | secretary-alpha | `/cases/0c000000-0000-4000-8000-000000000001` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | case CDF-DEMO-2026-0001, Secretary Alpha on its team |
| case-events | data | secretary-alpha | `/cases/0c000000-0000-4000-8000-000000000001/events` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | seeded procedural events of CDF-DEMO-2026-0001 |
| case-tasks | data | secretary-alpha | `/cases/0c000000-0000-4000-8000-000000000001/tasks` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | seeded tasks of CDF-DEMO-2026-0001 |
| case-notifications | data | secretary-alpha | `/cases/0c000000-0000-4000-8000-000000000001/notifications` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | seeded draft 2f…01 of CDF-DEMO-2026-0001, with the draft form |
| case-notifications | empty | secretary-alpha | `/cases/0c000000-0000-4000-8000-000000000004/notifications` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | CDF-DEMO-2026-0004 has no notification in the seed |
| notification-center | data | secretary-alpha | `/notifications` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | seeded drafts visible to Secretary Alpha |
| notification-center | empty | persona-zeta | `/notifications` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | Persona Zeta: no notification |
| notification-center | empty-filter | secretary-alpha | `/notifications?case=CDF-DEMO-2026-0004` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | a case filter on CDF-DEMO-2026-0004, which has no notification in the seed |
| notification-center | error | secretary-alpha | `/notifications?status=DELIVERED` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | an edited URL with a status the filter does not offer: the generic invalid state with a reference |
| notification-preview | data | investigator-beta | `/cases/0c000000-0000-4000-8000-000000000005/notifications?n={draft}` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts, draftCreated, noticeReference | a WITNESS draft the run makes on CDF-DEMO-2026-0005 through its draft form, in the sandboxed frame |
| notification-preview | no-mapping | secretary-alpha | `/cases/0c000000-0000-4000-8000-000000000001/notifications?n=2f000000-0000-4000-8000-000000000001` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | seeded draft 2f…01 (CASE_TEAM): no disclosure mapping for its recipient class yet, so the app shows none |
| notification-preview | error | secretary-alpha | `/cases/0c000000-0000-4000-8000-000000000001/notifications?n=0c000000-0000-4000-8000-0000000000ff` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | an id no notification has: the generic state with a correlation id |
| not-found | error | secretary-alpha | `/cases/0c000000-0000-4000-8000-0000000000ff` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | a case id no case has |
| not-found | restricted | secretary-alpha | `/cases/0c000000-0000-4000-8000-000000000009` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | restricted CDF-DEMO-2026-0009, Secretary Alpha not on its team: restricted = not found by design (CLAUDE.md §3) |
| workspace-switcher | data | governance-officer-delta | `/my-work` | desktop, tablet, mobile | correlationId, deadline, deadlineCounts | Governance Officer Delta holds two workspaces; the menu is open |
| mobile-navigation | data | secretary-alpha | `/my-work` | mobile | correlationId, deadline, deadlineCounts | the side navigation at 360 px |

## Masks

| Mask | Selector | Reason |
| --- | --- | --- |
| correlationId | `[data-testid="correlation-id"], [data-testid="case-preview-correlation-id"]` | a new correlation id per request; during the capture only, the masked box gets a fixed width (CAPTURE_STYLE), because its glyph widths change with the id |
| deadline | `[data-deadline-state]` | deadline words (DeadlineText) count days on the server clock, which the browser clock cannot reach (D1) |
| deadlineCounts | `[data-testid="count-my-work-overdue"], [data-testid="count-my-work-due-week"]` | My Work's overdue and due-this-week counts are taken on the server clock (D1) |
| draftCreated | `[data-testid="case-notification-{draft}"] time` | the created time of the draft the run makes (server clock) |
| noticeReference | in `[data-testid="case-notification-preview-frame"]`: `[data-field="notice_reference"]` | the notice reference of the draft the run makes (derived from its new id) |

## Not applicable

| Screen | State | Reason |
| --- | --- | --- |
| Notification Generator | all | no page in M1; the draft form is captured with case-notifications |
| Search Interface | all | no page in M1; the Portfolio and Center filters are captured with those screens |
| all screens | loading | no route renders a loading state (no loading.tsx, no Suspense fallback) |
| case-events, case-tasks | empty | every seeded case has events and two tasks |
| mobile-navigation | desktop, tablet | the row is the navigation at 360 px; at 768 px and wider it is the side navigation on every screen |
| case pages | restricted | restricted and unknown look the same by design: captured once as not-found / restricted |
