# E06 — Enterprise information architecture · البنية المعلوماتية المؤسسية

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team UX, task V13-UX-004. Status: PROPOSED for QA
review. Scope: milestone M1 (five foundational screens); later milestones are named where the structure must leave room
for them.

## 1. Why the structure changes

V12 and the V13 reference package were built around **one selected case** (FACT: `docs/CURRENT_STATE_ARCHITECTURE.md`,
single-case fixtures `CDF-IC-2026-DEMO-0001`). An enterprise platform serves many people working on many cases at
once. The information architecture therefore starts from three questions a user asks, in this order:

1. **What needs me now?** → My Work (أعمالي)
2. **Which cases am I responsible for, and where are they?** → Case Portfolio (محفظة القضايا)
3. **What is happening in this one case?** → Case Workspace (مساحة عمل القضية)

Notifications are a cross-cutting operational concern, so they have both a home of their own (Notification Operations
Center, مركز عمليات الإشعارات) and a tab inside each case. The workspace (Secretariat, Investigations, Governance)
decides which cases and actions the user sees; it is chosen in the Workspace Switcher (مبدّل مساحات العمل).

## 2. Objects and their keys

| Object | Key (never shown as a key) | Display identifier | Belongs to |
| ------ | -------------------------- | ------------------ | ---------- |
| Workspace | `workspace_id` / code (`SECRETARIAT`, `INVESTIGATIONS`, `GOVERNANCE`) | translated name | organisation |
| Persona (signed-in synthetic user) | `persona_id` | display name, e.g. _Secretary Alpha_ | memberships (persona × workspace × role) |
| Case | `case_id` (UUID) | `CDF-DEMO-2026-NNNN` (display only, never in a URL) | workspace visibility + assignments |
| Task | `task_id` | title | one case |
| Recorded procedural event | `event_id` | event label + time | one case |
| Notification | `notification_id` | template code + version | one case |

Rule (FACT, CLAUDE.md §3): every case-scoped object is reached **through its case**; nothing case-scoped exists in the
interface without its `case_id` in the URL or in the row that carries it.

## 3. Route map (M1)

All platform routes sit under the authenticated layout. Arabic is the default locale; the locale is a user preference
(cookie), not part of the URL, so a copied link opens the same object in the recipient's own language.

| Route | Screen | Area key | Notes |
| ----- | ------ | -------- | ----- |
| `/signin` | Persona sign-in | — | only when `V13_PERSONA_SIGNIN=enabled` (ADR-004) |
| `/` | redirect to `/my-work` | — | My Work is the landing page for every role |
| `/my-work` | My Work | `my-work` | tasks of the signed-in persona across authorised cases in the active workspace |
| `/portfolio` | Case Portfolio | `portfolio` | query string holds filters, sort and page cursor (`?stage=…&q=…&cursor=…`) so a view can be shared and restored (Scenario A, D) |
| `/cases/[caseId]` | Case Workspace — Overview tab | `portfolio` | `caseId` is the UUID; an unknown or unauthorised id gives the same not-found page |
| `/cases/[caseId]/events` | Case Workspace — Recorded events | `portfolio` | |
| `/cases/[caseId]/tasks` | Case Workspace — Tasks | `portfolio` | |
| `/cases/[caseId]/notifications` | Case Workspace — Notifications of this case | `portfolio` | |
| `/notifications` | Notification Operations Center | `notifications` | notifications across authorised cases; each row names its case |
| `/workspaces` | Workspace Switcher (full page) | — | same list as the header menu; also the no-JavaScript route |

Tabs are separate routes (not client state) so that each tab is linkable, works without JavaScript, and is a distinct
page for screen readers (`aria-current="page"` on the tab link).

Reserved for later milestones (no M1 navigation item): `/dashboard` (E09, M2), `/search` (M2, Ctrl/Cmd+K palette),
`/cases/[caseId]/journey` (M3), `/committee`, `/investigations`, `/legal` (M6), `/admin` (M6).

## 4. Navigation model

### 4.1 Global frame (AppShell)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Synthetic-data banner (always, cannot be dismissed)                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ [CDF logo] Product name   │ Workspace: Secretariat ▾ │ عربي/English │ Persona ▾ │  ← TopBar (48 px, Warm Gray, DG p. 29)
├────────────┬─────────────────────────────────────────────────────────────────┤
│ SideNav    │ Breadcrumbs                                                     │
│  My Work   │ CaseHeader (only on /cases/*)                                   │
│  Portfolio │ ─────────────────────────────────────────────────────────────── │
│  Notif.    │ main (one <h1> per page)                                        │
└────────────┴─────────────────────────────────────────────────────────────────┘
```

In Arabic the frame mirrors through logical properties: SideNav on the right, logo at the start (right) edge. The DG
p. 29 rule "logo always on the right" is satisfied in Arabic; in English the logo follows the reading start (left) —
RULING (UX): mirroring the whole frame keeps one layout model; the DG page shows an Arabic-first header. Flagged for
brand confirmation in DESIGN_SYSTEM.md §6.

### 4.2 Areas (SideNav) per role, M1

At most five areas (PLT pattern). The server derives the list from the persona's role in the active workspace; the
list is a convenience, never an authorisation (pages re-check).

| Area | Committee Secretary (Secretariat) | Investigator (Investigations) | Governance Officer (Governance) |
| ---- | :-------------------------------: | :---------------------------: | :-----------------------------: |
| My Work · أعمالي | ✓ | ✓ | ✓ |
| Case Portfolio · محفظة القضايا | ✓ | ✓ | ✓ |
| Notification Operations Center · مركز عمليات الإشعارات | ✓ | — (case tab only) | ✓ (read) |

PROPOSAL (FE + SEC to confirm against the authorisation matrix V13-SEC-001): the investigator reaches notifications
only through the Notifications tab of a case assigned to them.

Counts beside an area show only the persona's own items that need action (e.g. open tasks), never a number of cases
(PLT `CDFNavItem.count` rule; avoids leaking portfolio size).

### 4.3 Breadcrumbs

`My Work` / `Case Portfolio` / `CDF-DEMO-2026-0003` / `Tasks`. The case crumb shows the display number of the case in
the URL — never a remembered or "last opened" case.

## 5. Case context rules (the core of Scenarios A, B, E)

1. **The URL is the only case context.** No React context, store, `localStorage`, `sessionStorage` or cookie holds a
   "current case". Two tabs on two cases are two independent pages (Scenario B).
2. **Every case screen states its case.** CaseHeader shows the display number, title, stage and indicators on every
   `/cases/[caseId]/*` page, and the document title starts with the display number (`CDF-DEMO-2026-0003 · المهام`).
3. **Every cross-case list names the case on each row** (My Work, Notification Operations Center). No row inherits a
   case from a page heading.
4. **Leaving a case is explicit.** Navigating to a global area (My Work, Portfolio, Notification Center) drops the case
   crumb and the CaseHeader.
5. **Returning restores the view, not a case.** Back from a case to the portfolio returns the same filters, sort and
   page because they are in the portfolio URL (Scenario A).
6. **Unknown = unauthorised.** `/cases/<id>` for a case that does not exist, is restricted, or belongs to another
   workspace renders the same generic not-found state with a correlation id; it never says "restricted" or "exists".
7. **Workspace switch closes case pages.** After switching, the user lands on My Work of the new workspace; a case page
   open in another tab re-checks access on its next request (WORKSPACES.md §4).

These rules are what the Case Context Sentinel (QA) checks; each element that owns case content carries `data-case-id`
and `data-case-ref`, and case pages sit inside the `case-workspace` root (ADR-013; DESIGN_SYSTEM.md §4).

## 6. Labelling and language

- Institutional Saudi Arabic first (Prompt A output language); English second. Terms are fixed in STRINGS.md and used
  identically on every screen (heuristic: consistency, real-world language).
- Dates: Gregorian with Arabic-Indic digits in Arabic (`٢٨ أكتوبر ٢٠٢٦`), Western digits in English, through
  `Intl.DateTimeFormat` with `ar-SA-u-ca-gregory-nu-arab` and `en-GB`. PROPOSAL: Hijri date as a secondary line
  where a procedure needs it (M3; needs owner confirmation of which procedures).
- Display numbers (`CDF-DEMO-2026-0003`) are wrapped in `<bdi dir="ltr">` so they never reorder inside Arabic text.

## 7. Heuristic check of this structure (self-review; QA reviews independently)

| Heuristic | How the structure meets it |
| --------- | -------------------------- |
| System status visibility | Workspace and case always visible (TopBar, CaseHeader); actual vs expected status never merged |
| Real-world language | Areas named for work, not data ("أعمالي", not "Tasks table") |
| User control | Back restores filters; tabs are links; no destructive action in M1 screens without confirmation |
| Consistency | One shell, one status registry, one term per concept |
| Error prevention | Case stated on every case page and every cross-case row; switch confirms when a form has unsaved input |
| Recognition over recall | No hidden "current case"; breadcrumbs show where the user is |
| Efficiency | My Work as landing page; portfolio URL keeps views; quick case switcher reserved for M2 |
| Minimalism | Five areas maximum; indicators only where they change handling |
| Error recovery | Generic error with correlation id and a way back (ErrorState) |
