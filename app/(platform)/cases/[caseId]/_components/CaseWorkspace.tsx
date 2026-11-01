// Case Workspace markup (FE-004, SCREENS S3). Server components, no client JavaScript. The frame carries ADR-013's
// data-case-id and data-case-ref; every recorded status names its event (data-event-id), and nothing from another
// case can appear inside it (the loader and adapter refuse foreign rows). Tabs are plain links: the URL is the only
// case context.
import Link from "next/link";
import type { ReactNode } from "react";
import type { CaseEvent, CaseNotification, CaseSummary, CaseTask } from "@/lib/contracts";
import { toBadgeEpistemic } from "@/lib/domain";
import { translateKey, type Locale, type MessageKey, type Translator } from "@/lib/i18n";
import { CASE_TABS, type CaseTab, type CaseWorkspaceView } from "@/lib/server/case-workspace";
import type { DraftFormView, DraftNotice } from "@/lib/server/notification-draft";
import { previewHref, type NotificationPreviewView } from "@/lib/server/notification-preview";
import { NotificationPreviewFrame } from "@/components/data/NotificationPreviewFrame";
import { DraftForm } from "../notifications/_components/DraftForm";
import { DataTable } from "@/components/data/DataTable";
import { StatusBadge, type Tone } from "@/components/data/StatusBadge";
import { Timeline as UxTimeline } from "@/components/data/Timeline";
import { formatDate, formatDateTime } from "@/components/format";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { CaseHeader } from "@/components/shell/CaseHeader";
import { CaseTabs } from "@/components/shell/CaseTabs";
import { CaseWorkspace as UxCaseWorkspace } from "@/components/shell/CaseWorkspace";
import styles from "./case.module.css";
import {
  CAPACITY_KEYS,
  eventLabel,
  notificationStatusLabel,
  PROVENANCE_KEYS,
  recipientClassLabel,
  stageLabel,
  TASK_STATUS_KEYS,
} from "./labels";

export const TAB_KEYS: Readonly<Record<CaseTab, MessageKey>> = {
  overview: "case.tab.overview",
  events: "case.tab.events",
  tasks: "case.tab.tasks",
  notifications: "case.tab.notifications",
};

export function tabHref(caseId: string, tab: CaseTab): string {
  return tab === "overview" ? `/cases/${caseId}` : `/cases/${caseId}/${tab}`;
}

/** Task tones for the recorded badge; the glyph comes from StatusBadge (Layer A codes, else neutral). */
const TASK_TONE: Readonly<Record<CaseTask["status"], Tone>> = {
  OPEN: "neutral",
  IN_PROGRESS: "info",
  BLOCKED: "warning",
  DONE: "success",
  CANCELLED: "neutral",
};

function titleOf(locale: Locale, c: CaseSummary): string {
  if (c.synthetic_title) return c.synthetic_title[locale];
  return c.title_key ? translateKey(locale, c.title_key) : "";
}

/** Header, case sections and the tab heading shared by every tab; `children` is the tab's own content. */
export function CaseFrame({
  t,
  locale,
  view,
  children,
}: {
  t: Translator;
  locale: Locale;
  view: CaseWorkspaceView;
  children: ReactNode;
}) {
  const c = view.summary;
  return (
    <UxCaseWorkspace caseId={c.case_id} caseRef={c.case_number}>
      <Breadcrumbs
        t={t}
        items={[
          { href: "/portfolio", label: t("portfolio.heading"), testId: "case-crumb-portfolio" },
          { label: <bdi dir="ltr">{c.case_number}</bdi> },
        ]}
      />
      <CaseHeader
        t={t}
        caseId={c.case_id}
        caseRef={c.case_number}
        title={titleOf(locale, c)}
        // The case read carries no event for the stage, so the stage is its label, with no epistemic claim.
        stage={stageLabel(t, c.lifecycle_stage)}
        stageCode={c.lifecycle_stage}
        recordsState={c.records_state}
        restricted={c.is_restricted}
        capacity={view.capacity ? t(CAPACITY_KEYS[view.capacity]) : undefined}
        capacityCode={view.capacity}
      />
      <CaseTabs
        t={t}
        current={view.tab}
        tabs={CASE_TABS.map((tab) => ({ key: tab, href: tabHref(c.case_id, tab), label: t(TAB_KEYS[tab]) }))}
      />
      <h1>{t(TAB_KEYS[view.tab])}</h1>
      {children}
    </UxCaseWorkspace>
  );
}

/**
 * Recorded events, newest first. Entries name their event; they are records, not statuses: the event read has no
 * status field, so no entry carries a badge or data-epistemic (ARCH, UX-008(c)).
 */
function CaseTimeline({
  t,
  locale,
  summary,
  events,
  testId = "case-timeline",
  label,
}: {
  t: Translator;
  locale: Locale;
  summary: CaseSummary;
  events: readonly CaseEvent[];
  testId?: string;
  label: string;
}) {
  if (events.length === 0) {
    return (
      <p data-testid="case-events-empty" className={styles.meta}>
        {t("case.events.empty")}
      </p>
    );
  }
  return (
    <UxTimeline
      t={t}
      locale={locale}
      label={label}
      testId={testId}
      data={{ "data-count": events.length }}
      alwaysShowOccurred
      entries={events.map((e) => ({
        eventId: e.id,
        caseId: summary.case_id,
        caseRef: summary.case_number,
        title: eventLabel(t, e.event_code),
        occurredAt: e.occurred_at,
        recordedAt: e.recorded_at,
        testId: "case-event",
        timeTestIds: { occurred: "case-event-occurred", recorded: "case-event-recorded" },
        data: { "data-event-code": e.event_code },
        details: (
          <>
            <span data-testid="case-event-actor">
              {e.actor_capacity
                ? t("case.events.actor", { capacity: t(CAPACITY_KEYS[e.actor_capacity]) })
                : t("case.events.actorNone")}
            </span>
            <span data-testid="case-event-provenance" data-provenance={e.provenance}>
              {t(PROVENANCE_KEYS[e.provenance])}
            </span>
          </>
        ),
      }))}
    />
  );
}

/**
 * A task's status. A status set by a recorded event is a recorded fact: lib/domain's toBadgeEpistemic gives the
 * ADR-013 attributes, with the event id from the authorised case's own task row (DB-008), never from the URL or
 * client input; the task read has no status time, so the badge says "recorded" without one (ARCH, 1 Nov). An
 * untouched OPEN task has no event, so it carries no epistemic claim (ARCH, 31 Oct). Server only.
 */
function TaskStatus({ t, locale, task }: { t: Translator; locale: Locale; task: CaseTask }) {
  const label = t(TASK_STATUS_KEYS[task.status]);
  if (task.status_event_id === null) {
    return (
      <span data-testid="case-task-status" data-task-status={task.status}>
        {label}
      </span>
    );
  }
  const badge = toBadgeEpistemic({ epistemic: "RECORDED_FACT", event_id: task.status_event_id });
  if (badge.value !== "recorded") return null; // toBadgeEpistemic fails closed first; this narrows the type
  return (
    <StatusBadge
      t={t}
      locale={locale}
      testId="case-task-status"
      data={{ "data-task-status": task.status }}
      epistemic="recorded"
      statusKind="task"
      status={task.status}
      label={label}
      tone={TASK_TONE[task.status]}
      evidence={{ eventId: badge.event_id }}
    />
  );
}

export function TaskTable({
  t,
  locale,
  caseRef,
  tasks,
  caption,
  captionVisuallyHidden = false,
  emptyText,
  testId,
}: {
  t: Translator;
  locale: Locale;
  caseRef: string;
  tasks: readonly CaseTask[];
  caption: string;
  /** The caption names the table for assistive technology only (a visible heading already says it). */
  captionVisuallyHidden?: boolean;
  emptyText: string;
  testId: string;
}) {
  if (tasks.length === 0) {
    return (
      <p data-testid={`${testId}-empty`} className={styles.meta}>
        {emptyText}
      </p>
    );
  }
  return (
    <DataTable<CaseTask>
      t={t}
      scope="case"
      testId={testId}
      tableData={{ "data-count": tasks.length }}
      captionId={`${testId}-caption`}
      caption={caption}
      captionVisuallyHidden={captionVisuallyHidden}
      rows={tasks}
      rowKey={(task) => task.id}
      rowTestId={(task) => `case-task-${task.id}`}
      rowData={(task) => ({
        "data-task-id": task.id,
        "data-task-code": task.task_code,
        "data-mine": task.is_mine ? "true" : "false",
      })}
      rowCaseId={(task) => task.case_id}
      rowCaseRef={() => caseRef}
      empty={null}
      columns={[
        {
          key: "task",
          header: t("case.tasks.column.task"),
          rowHeader: true,
          cell: (task) => task.title[locale],
        },
        {
          key: "assignee",
          header: t("case.tasks.column.assignee"),
          cell: (task) => (
            <>
              {task.assignee_capacity ? t(CAPACITY_KEYS[task.assignee_capacity]) : t("case.tasks.unassigned")}
              {task.is_mine ? (
                <>
                  {" "}
                  <span className={styles.flag} data-testid="case-task-mine">
                    {t("case.tasks.mine")}
                  </span>
                </>
              ) : null}
            </>
          ),
        },
        {
          key: "due",
          header: t("case.tasks.column.due"),
          cell: (task) =>
            task.due_date ? (
              // Noon in Riyadh is the same calendar day in Riyadh whatever the server's zone.
              <time dateTime={task.due_date} className="v13-nowrap">
                {formatDate(locale, `${task.due_date}T12:00:00+03:00`)}
              </time>
            ) : (
              t("case.tasks.noDue")
            ),
        },
        {
          key: "status",
          header: t("case.tasks.column.status"),
          cell: (task) => <TaskStatus t={t} locale={locale} task={task} />,
        },
      ]}
    />
  );
}

/** A code's label, or the code itself (Latin, isolated) when it has none: never blank. */
function CodeLabel({ label, code }: { label: string | null; code: string }) {
  return label === null ? <bdi dir="ltr">{code}</bdi> : <>{label}</>;
}

/** The class label with its code beside it in <bdi> (the code alone when the class has no label). */
function UnmappedClass({ t, code }: { t: Translator; code: string }) {
  const label = recipientClassLabel(t, code);
  return (
    <>
      {label !== null ? <>{label} </> : null}
      <bdi dir="ltr" data-testid="case-preview-unmapped-code">
        {code}
      </bdi>
    </>
  );
}

export function NotificationTable({
  t,
  locale,
  caseRef,
  notifications,
  createdId = null,
  selectedId = null,
}: {
  t: Translator;
  locale: Locale;
  /** The case's display number, carried on every row as ADR-013 evidence (never a key). */
  caseRef: string;
  notifications: readonly CaseNotification[];
  createdId?: string | null;
  /** The notification shown in the preview below the table, if any. */
  selectedId?: string | null;
}) {
  if (notifications.length === 0) {
    return (
      <p data-testid="case-notifications-empty" className={styles.meta}>
        {t("case.notifications.empty")}
      </p>
    );
  }
  // FE-010 (UXB-08, UX-009 R-04): the shared DataTable, so the caption stays in view and wraps to the visible width
  // at 320 px and 200% zoom instead of being cut at the scroll region's edge.
  return (
    <DataTable<CaseNotification>
      t={t}
      scope="case"
      testId="case-notifications"
      tableData={{ "data-count": notifications.length }}
      captionId="case-notifications-caption"
      caption={t("case.notifications.caption")}
      rows={notifications}
      rowKey={(n) => n.notification_id}
      rowTestId={(n) => `case-notification-${n.notification_id}`}
      rowData={(n) => ({
        "data-notification-id": n.notification_id,
        "data-created": n.notification_id === createdId ? "true" : undefined,
        "data-selected": n.notification_id === selectedId ? "true" : undefined,
      })}
      rowCaseId={(n) => n.case_id}
      rowCaseRef={() => caseRef}
      empty={null}
      columns={[
        {
          key: "template",
          header: t("case.notifications.column.template"),
          rowHeader: true,
          cell: (n) => (
            <>
              <span data-testid="case-notification-template-name">{n.template_name[locale]}</span>{" "}
              <bdi dir="ltr" className={styles.metaRow} data-testid="case-notification-template-code">
                {n.template_code}
              </bdi>
              <span
                className={styles.metaRow}
                data-testid="case-notification-language"
                data-language={n.language}
              >
                {t(n.language === "ar" ? "case.language.ar" : "case.language.en")}
              </span>
            </>
          ),
        },
        {
          key: "version",
          header: t("case.notifications.column.version"),
          // Template versions are identifiers: Latin in <bdi> in both languages (DESIGN_SYSTEM §6 D10; UXB-04).
          cell: (n) => (
            <bdi dir="ltr" data-testid="case-notification-version">
              {n.template_version}
            </bdi>
          ),
        },
        {
          key: "recipient",
          header: t("case.notifications.column.recipient"),
          cellData: (n) => ({
            "data-testid": "case-notification-recipient",
            "data-recipient-class": n.recipient_class,
          }),
          cell: (n) => (
            <CodeLabel label={recipientClassLabel(t, n.recipient_class)} code={n.recipient_class} />
          ),
        },
        {
          key: "status",
          header: t("case.notifications.column.status"),
          cellData: (n) => ({
            "data-testid": "case-notification-status",
            "data-lifecycle-status": n.lifecycle_status,
          }),
          cell: (n) => (
            <CodeLabel label={notificationStatusLabel(t, n.lifecycle_status)} code={n.lifecycle_status} />
          ),
        },
        {
          key: "created",
          header: t("case.notifications.column.created"),
          cell: (n) => (
            <time dateTime={n.created_at} className="v13-nowrap">
              {/* The month in words, as in the Center (UXB-02). */}
              {formatDateTime(locale, n.created_at)}
            </time>
          ),
        },
        {
          key: "preview",
          header: t("case.notifications.column.preview"),
          cell: (n) => (
            <Link
              href={previewHref(n.case_id, n.notification_id)}
              // QA CHANGES 982bd76: the accessible name uses the words on the row, never raw codes.
              aria-label={t("case.notifications.previewLinkLabel", {
                template: n.template_name[locale],
                recipient: recipientClassLabel(t, n.recipient_class) ?? n.recipient_class,
              })}
              aria-current={n.notification_id === selectedId ? "true" : undefined}
              data-testid={`case-notification-preview-link-${n.notification_id}`}
            >
              {t("case.notifications.previewLink")}
            </Link>
          ),
        },
      ]}
    />
  );
}

/**
 * The in-case preview (V13-FE-006 part 3). Only the server-rendered HTML of the projected model reaches the page, inside
 * UX-006's sandboxed frame, with its plain-text twin as escaped text below it (V13-FE-011). The unmapped (OI-037) and unavailable states carry no notification content.
 */
export function NotificationPreviewSection({
  t,
  caseId,
  preview,
}: {
  t: Translator;
  caseId: string;
  preview: NotificationPreviewView;
}) {
  if (preview.kind === "none") return null;
  return (
    <section
      aria-labelledby="case-preview-heading"
      data-testid="case-preview"
      data-preview-state={preview.kind}
    >
      <h2 id="case-preview-heading">{t("case.preview.heading")}</h2>
      {preview.kind === "preview" ? (
        <div data-testid="case-preview-ready" data-notification-id={preview.notificationId}>
          <NotificationPreviewFrame
            t={t}
            rendered={{ html: preview.html }}
            title={t("case.preview.frameTitle", {
              title: preview.eventTitle ?? t("case.preview.untitled"),
            })}
            lang={preview.lang}
            testId="case-notification-preview"
          />
          {/* V13-FE-011 (REQ-NOTIF-011): the plain-text twin of the same rendering, as escaped text in the notice's
              language. Closed by default; native <details>, so it works without JavaScript. */}
          <details className={styles.previewText} data-testid="case-preview-text">
            <summary data-testid="case-preview-text-toggle">{t("case.preview.textSummary")}</summary>
            <pre
              lang={preview.lang}
              dir={preview.lang === "ar" ? "rtl" : "ltr"}
              aria-label={t("case.preview.textLabel")}
              data-testid="case-preview-text-body"
            >
              {preview.text}
            </pre>
          </details>
        </div>
      ) : null}
      {preview.kind === "unmapped" ? (
        <p
          className="v13-notice"
          data-testid="case-preview-unmapped"
          data-notification-id={preview.notificationId}
        >
          {t("case.preview.unmapped")}{" "}
          <span data-testid="case-preview-unmapped-class">
            {t("case.preview.unmappedClass")} <UnmappedClass t={t} code={preview.recipientClass} />
          </span>
        </p>
      ) : null}
      {preview.kind === "unavailable" ? (
        <div role="alert" className="v13-error" data-testid="case-preview-unavailable">
          <p>
            <strong>{t("case.preview.unavailableTitle")}</strong>
          </p>
          <p>{t("case.preview.unavailableBody")}</p>
          <p>
            <span>{t("case.error.correlation")}</span>{" "}
            <bdi dir="ltr" data-testid="case-preview-correlation-id">
              {preview.correlationId}
            </bdi>
          </p>
        </div>
      ) : null}
      <p>
        <Link href={tabHref(caseId, "notifications")} data-testid="case-preview-close">
          {t("case.preview.close")}
        </Link>
      </p>
    </section>
  );
}

/** A created draft (redirected here with the id the database returned): a polite status. */
function DraftNoticeView({ t, notice }: { t: Translator; notice: DraftNotice | null }) {
  return (
    <div role="status" aria-live="polite" data-testid="draft-live">
      {notice?.kind === "created" ? (
        <p className="v13-notice" data-testid="draft-created">
          {t("case.draft.created")}
        </p>
      ) : null}
    </div>
  );
}

/** Server-side preparation of the Scenario E form: ids and already-localised strings only. */
function DraftFormFor({ t, locale, draft }: { t: Translator; locale: Locale; draft: DraftFormView }) {
  return (
    <DraftForm
      caseId={draft.caseId}
      idempotencyKey={draft.idempotencyKey}
      templates={draft.templates.map((o) => ({
        value: o.template_version_id,
        code: o.template_code,
        label: t("case.draft.templateOption", {
          name: o.template_name[locale],
          code: o.template_code,
          // A version is an identifier: Latin digits in both languages, never grouped (D10). An <option> holds
          // text only, so no <bdi> here.
          version: String(o.version),
          language: t(o.language === "ar" ? "case.language.ar" : "case.language.en"),
        }),
      }))}
      recipients={draft.recipientClasses.map((c) => ({ value: c.code, label: c.name[locale] }))}
      text={{
        heading: t("case.draft.heading"),
        hint: t("case.draft.hint"),
        template: t("case.draft.template"),
        recipient: t("case.draft.recipient"),
        submit: t("case.draft.submit"),
        error: t("case.draft.error"),
        correlation: t("case.error.correlation"),
      }}
    />
  );
}

/** The content of the active tab. */
export function CaseTabContent({
  t,
  locale,
  view,
}: {
  t: Translator;
  locale: Locale;
  view: CaseWorkspaceView;
}) {
  switch (view.tab) {
    case "overview":
      return (
        <div data-testid="case-overview">
          <h2>{t("case.overview.stageCard")}</h2>
          <p data-testid="case-overview-stage" data-stage={view.summary.lifecycle_stage}>
            {stageLabel(t, view.summary.lifecycle_stage)}
          </p>
          <h2>{t("case.overview.myTasks")}</h2>
          <TaskTable
            t={t}
            locale={locale}
            caseRef={view.summary.case_number}
            tasks={view.myTasks}
            caption={t("case.overview.myTasks")}
            captionVisuallyHidden
            emptyText={t("case.overview.noMyTasks")}
            testId="case-my-tasks"
          />
          <h2>{t("case.overview.lastEvents")}</h2>
          <CaseTimeline
            t={t}
            locale={locale}
            summary={view.summary}
            events={view.events}
            testId="case-last-events"
            label={t("case.overview.lastEvents")}
          />
          <p>
            <Link href={tabHref(view.summary.case_id, "events")} data-testid="case-all-events">
              {t("case.tab.events")}
            </Link>
          </p>
        </div>
      );
    case "events":
      return (
        <CaseTimeline
          t={t}
          locale={locale}
          summary={view.summary}
          events={view.events}
          label={t("case.tab.events")}
        />
      );
    case "tasks":
      return (
        <TaskTable
          t={t}
          locale={locale}
          caseRef={view.summary.case_number}
          tasks={view.tasks}
          caption={t("case.tasks.caption")}
          emptyText={t("case.tasks.empty")}
          testId="case-tasks"
        />
      );
    case "notifications":
      return (
        <>
          <DraftNoticeView t={t} notice={view.notice} />
          <NotificationTable
            t={t}
            locale={locale}
            caseRef={view.summary.case_number}
            notifications={view.notifications}
            createdId={view.notice?.kind === "created" ? view.notice.notificationId : null}
            selectedId={
              view.preview.kind === "preview" || view.preview.kind === "unmapped"
                ? view.preview.notificationId
                : null
            }
          />
          <NotificationPreviewSection t={t} caseId={view.summary.case_id} preview={view.preview} />
          {view.draft ? <DraftFormFor t={t} locale={locale} draft={view.draft} /> : null}
        </>
      );
  }
}

/** Generic failure: no detail, only the correlation id (CLAUDE.md §4). */
export function CaseErrorState({ t, correlationId }: { t: Translator; correlationId: string }) {
  return (
    <section data-testid="case-workspace-error">
      <div role="alert" className="v13-error" data-testid="case-error">
        <h1>{t("case.error.title")}</h1>
        <p>{t("case.error.body")}</p>
        <p>
          <span>{t("case.error.correlation")}</span>{" "}
          <bdi dir="ltr" data-testid="correlation-id">
            {correlationId}
          </bdi>
        </p>
      </div>
      <p>
        <Link href="/portfolio" data-testid="case-crumb-portfolio">
          {t("portfolio.heading")}
        </Link>
      </p>
    </section>
  );
}

export function CaseWorkspace({
  t,
  locale,
  view,
}: {
  t: Translator;
  locale: Locale;
  view: CaseWorkspaceView;
}) {
  return (
    <CaseFrame t={t} locale={locale} view={view}>
      <CaseTabContent t={t} locale={locale} view={view} />
    </CaseFrame>
  );
}
