# Five foundational screens — specs · مواصفات الشاشات التأسيسية الخمس

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team UX, task V13-UX-004. Status: PROPOSED for QA
review. FE builds the pages (V13-FE-002..006) from these specs with the components in DESIGN_SYSTEM.md. Every string
named here is a key in STRINGS.md or in an FE namespace (`portfolio`, `case`, `myWork`, `notifications`,
`workspaces`; camelCase ids per ADR-013); FE owns those namespaces, UX proposes their text.

Each spec lists: purpose · who · layout · content · states · actions · accessibility · test ids · acceptance. States
are only those the application really has (Prompt B §3.1: no invented states).

Common to all five: AppShell with the synthetic-data banner; one `<h1>`; skip link to `main`; generic errors with a
correlation id; widths checked at 360, 768, 1280 and 1920 px; Arabic RTL and English LTR.

---

## S1 — My Work · أعمالي (`/my-work`, V13-FE-005)

**Purpose.** What needs the signed-in persona now, across all cases they may see in the active workspace.
**Who.** All three roles.

**Layout.** `h1` "أعمالي" + workspace subtitle. Summary strip of at most three counts of the persona's own tasks
(Overdue · Due this week · Open) as filter links, never case counts; each number is a `Count`
(`count-my-work-overdue`, `count-my-work-due-week`, `count-my-work-open`). Below: DataTable of tasks (`scope: "case"`).

**Table columns** (in reading order): Case (display number as link to `/cases/[id]/tasks`, plus title on a second line)
· Task · Due date (DeadlineText: date + "متأخر ٣ أيام" words, not colour alone) · Status (StatusBadge `task` domain,
`recorded`, with its event) · Action ("تحديث الحالة").

**States.** Loading (table skeleton, `aria-busy`) · Empty ("لا توجد مهام مسندة إليك في مساحة العمل هذه") ·
Error (ErrorState) · Stale update refused ("تغيّرت هذه المهمة منذ فتحها. حدّث الصفحة وحاول مرة أخرى." + correlation id).

**Actions.** Update task status: a short Server Action form in a dialog (FE, Zod schema from `lib/contracts`), sends
`row_version`; on success the row updates and a polite live region announces it.

**Accessibility.** Table has a caption; the case cell is the row header (`th scope="row"`); sorting via buttons in
headers with `aria-sort`.

**Test ids.** `my-work-table`, `my-work-row-<taskId>` (carries `data-case-id` and `data-case-ref`), `task-status-update-<taskId>`,
`my-work-empty`.

**Acceptance.** Scenario B: updating a task in case 0001 changes no row of any other case; each row's
`data-case-id` matches its case link; restricted case 0009 never appears for a persona not assigned to it.

---

## S2 — Case Portfolio · محفظة القضايا (`/portfolio`, V13-FE-003)

**Purpose.** Find and open cases the persona may see; understand where each stands.
**Who.** All three roles (content filtered by workspace and assignment).

**Layout.** `h1` "محفظة القضايا". FilterBar (search by display number or title, stage, records state ACTIVE/CLOSED,
"assigned to me") — filters are a GET form, so the URL holds the view. Result line: "١٢ قضية" — count computed **after**
authorisation (FE + DB), shown only as the count of rows the persona may see, rendered as `Count`
(`count-portfolio-results`, `data-count`). DataTable below (`scope: "case"`).

**Columns.** Case number (link) · Title · Stage (StatusBadge, `recorded`) · Records state · Indicators (NamedAccessFlag for
restricted cases the persona is assigned to) · Last recorded event (`RecordedEventDate`, with `data-event-id`) · Open tasks (persona's own).

**Pagination.** Keyset (cursor) from the server; "التالي / السابق" links + "عرض ٢٥ من …" only when the total is
authorised (`count-portfolio-total`); page size 25. No infinite scroll (keyboard and screen-reader cost).

**States.** Loading · Empty portfolio ("لا توجد قضايا ظاهرة لك في مساحة العمل هذه") · No results for filters ("لا توجد
نتائج مطابقة" + "مسح عوامل التصفية") · Error.

**Accessibility.** Filters have visible labels; results region has `aria-live="polite"` announcing the new count after
a filter submit; the table caption repeats the active filters in words.

**Test ids.** `portfolio-filters`, `portfolio-search`, `portfolio-table`, `portfolio-row-<caseId>`,
`count-portfolio-results`, `portfolio-next`, `portfolio-prev`, `portfolio-empty`, `portfolio-no-results`.

**Acceptance.** Scenario A: open 0003, go back, the same filters/sort/page show. Scenario D basics: a search never
returns 0009 for a non-assigned persona, and the count matches the visible rows. Closed case 0010 shows the
"مغلقة" records state with glyph + word.

---

## S3 — Case Workspace · مساحة عمل القضية (`/cases/[caseId]/*`, V13-FE-004)

**Purpose.** Everything about **one** case, with its identity always visible.
**Who.** Personas authorised for this case in the active workspace.

**Layout.** Breadcrumbs, then the `CaseWorkspace` root (`data-testid="case-workspace"`, `data-case-id`,
`data-case-ref`) wrapping CaseHeader → tab links (Overview · Recorded events · Tasks · Notifications) → tab content.

**CaseHeader.** Display number (large, `bdi ltr`), title, stage (StatusBadge `recorded`), records state, indicators
(restricted → NamedAccessFlag; closed → "مغلقة" with glyph), the persona's capacity on this case ("صفتك: محقق").
`data-case-id` and `data-case-ref` on the header too (same values as the root).

**Next Action Card (V13-UX-015, REQ-IA-009).** First in the Overview tab, above the stage card, so the next
authorised action is the first thing after the header. Built on PROC's contract (`nextActionForCase`,
`docs/teams/proc/NEXT_ACTION_SOURCES.md`); its only source in M1 is the persona's own open task on this case.

- **TASK.** A `section` labelled by its `h2` "إجراؤك التالي" (`common.nextAction.heading`), then the task's recorded title
  as a link to the task (escaped text in `<bdi>`, page language only), then two facts: "الحالة" with the task's status as
  the Tasks tab shows it (existing labels and recorded badge; BLOCKED and DONE wording stays PROPOSED), and "تاريخ
  الاستحقاق" with `DeadlineText` from the recorded `due_date` and FE's `deadlineOf` day count (the same clock as My Work).
  No due date recorded → no due line; no date is invented, and the card says "due date", never "deadline under the rules".
- **The link.** Goes to the task itself, not to page 1 of the Tasks tab, because on the paged tab the task may be on a
  later page. FE chooses the URL (for example `/cases/{case_id}/tasks?task={task_id}`); the page it opens must show that
  task's row.
- **NONE.** The card renders nothing: no element, no heading, no line, no placeholder. NONE carries no reason, and the
  overview's own "لا توجد مهام مفتوحة مسندة إليك في هذه القضية" already covers the common case.
- **Look.** Card surface with a 1 px control border and a 4 px start-side bar in `--cdf-primary`; the heading is small
  and secondary, the title large (H2 size) and bold, so it stands out by position, weight and the bar, not colour alone.
  The title link is underlined. Facts wrap; nothing scrolls sideways at 320 px.
- **Never on the card.** Another persona, another task, a count, a reason for NONE, an action from the authority model,
  a stage or journey step, a procedural deadline (PROC §3).
- **Test ids.** `next-action-card` (with `data-task-id`), `next-action-link`, `next-action-status`, `next-action-due`.
- **Component.** `components/data/NextActionCard.tsx` (UX); FE wires it (calls `nextActionForCase`, passes the status
  element, the day count and the link).

**Overview tab.** Next Action Card (above) · stage card (current stage, `recorded`, with the event that set it and when) · "Next expected step"
card (Layer B, expected variant only — never a completed glyph; M1 shows it only when PROC supplies it, otherwise the
card is absent, not empty) · the persona's open tasks in this case · last five recorded events (Timeline).

**Recorded events tab.** Timeline of recorded procedural events, newest first, each with occurred time, recorded time
(when they differ, both shown with words "وقع في / سُجّل في"), actor capacity, and provenance. Only recorded entries.

**Tasks tab.** DataTable as in My Work (`scope: "case"`), without the case column.

**Notifications tab.** DataTable (`scope: "case"`) of this case's notifications: template, recipient class, version, lifecycle status
(sending family badges — DESIGN_SYSTEM.md §3.3), created. Secretary sees "إنشاء مسودة إشعار" (V13-FE-006).

**States.** Loading per tab · Not found (shared by unknown, unauthorised, restricted, other-workspace) · Empty tab
("لا توجد أحداث مسجلة بعد" etc.) · Closed case (read-only notice "هذه القضية مغلقة؛ العرض للاطلاع فقط") · Error.

**Accessibility.** Tabs are links in a `nav aria-label="أقسام القضية"` with `aria-current="page"`; document title
starts with the display number; the CaseHeader is a `header` inside `main`, before the `h1` of the tab ("المهام").

**Test ids.** `case-header`, `case-number`, `case-stage`, `case-tab-<overview|events|tasks|notifications>`,
`case-workspace`, `not-found-state`, `case-closed-notice`, `case-timeline`.

**Acceptance.** Scenario B: 0001 and 0002 open in two tabs; a task change in 0001 leaves 0002's page unchanged after
reload. Inside `case-workspace` no element carries another case's `data-case-id` or reference (Sentinel); the `?n=` preview
renders inside the root. Unknown UUID, 0009 (for a non-assigned persona) and an other-workspace case produce
byte-identical `not-found-state` markup apart from the correlation id.

---

## S4 — Notification Operations Center · مركز عمليات الإشعارات (`/notifications`, V13-FE-006)

**Purpose.** Operational view of notifications across the cases the persona may see: what was drafted, approved,
sent, failed or superseded.
**Who.** Committee Secretary (operate), Governance Officer (read). Not in the investigator's navigation; for an investigator the route answers like an unknown route (RULED by SEC, D6, test SEC-APP-17).

**Layout.** `h1` "مركز عمليات الإشعارات". FilterBar (lifecycle status, template, case number, date range). DataTable.

**Columns** (DataTable `scope: "case"`). Case (display number link + title) · Notification (template name + code + version) · Recipient class
(never a recipient's personal details in M1) · Status (sending-family badge) · Created · Last event.

**Rules.** Each row names its case; no notification appears without its case. A notification's preview opens inside
its case (`/cases/[id]/notifications?n=<notificationId>`), so the CaseHeader is visible while reading it.
"Sent" is never shown as "delivered" (V13 L-07: «أُرسل — لم يُؤكَّد التسليم»).

**States.** Loading · Empty ("لا توجد إشعارات في مساحة العمل هذه") · No results · Error.

**Test ids.** `notifications-table`, `notification-row-<notificationId>` (with `data-case-id` and `data-case-ref`), `notifications-filters`,
`notifications-empty`.

**Acceptance.** Scenario E: a draft created in case 0001 appears in this list with case 0001 only, and in the
Notifications tab of 0001, never under 0002.

---

## S5 — Workspace Switcher · مبدّل مساحات العمل (TopBar control + `/workspaces`, V13-FE-002)

Full interaction spec in WORKSPACES.md §3. Page `/workspaces`: `h1` "مساحات العمل", a list of the persona's active
memberships, each a card with workspace name, role held, and a "الانتقال إلى هذه المساحة" button (secondary); the
active one shows "الحالية" with a check glyph instead of the button.

**Test ids.** TopBar control: `workspace-switcher` (with `data-workspace-code`); inside its menu
`workspace-menu-option-<CODE>`, `workspace-menu-current`, `workspace-menu-all`. Page `/workspaces`: `workspaces-page`,
`workspace-option-<CODE>`, `workspace-current`. The menu and the page never share an id, so a test that finds one of
them finds exactly one element (QA review of #14, 28 Oct; pending ARCH ruling as a spec change).

**Acceptance.** WORKSPACES.md §5.

---

## Screenshot inventory for QA (UXQA-05, M1)

| Screen | States that exist in M1 |
| ------ | ----------------------- |
| My Work | populated, empty, loading, error, stale-update refusal |
| Case Portfolio | populated, empty, no results, loading, error |
| Case Workspace | each of 4 tabs populated and empty, not found, closed case, loading, error |
| Notification Operations Center | populated, empty, no results, loading, error |
| Workspace Switcher | menu open (2 memberships, Delta), single membership (plain text), `/workspaces` page |

Each in ar/RTL and en/LTR at 360, 768, 1280 px (1920 px for the two tables). Dark mode: tokens support it; whether M1
exposes a theme switch is PROPOSAL (default: follow `prefers-color-scheme`, no switch in M1). Loading states are
captured only where QA can produce them deterministically; otherwise they are listed as not applicable, never staged.
