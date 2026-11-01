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
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { ScrollRegion } from "../../../_components/ScrollRegion";
import styles from "./case.module.css";
import {
  CAPACITY_KEYS,
  dateFormat,
  dateTimeFormat,
  eventLabel,
  notificationStatusLabel,
  numberFormat,
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

function titleOf(locale: Locale, c: CaseSummary): string {
  if (c.synthetic_title) return c.synthetic_title[locale];
  return c.title_key ? translateKey(locale, c.title_key) : "";
}

function LockGlyph() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      className={styles.glyph}
    >
      <rect x="3" y="7" width="10" height="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function KeyGlyph() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      className={styles.glyph}
    >
      <circle cx="5" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8h6M12 8v3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Header, notices and section links shared by every tab; `children` is the tab's own content. */
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
    <section data-testid="case-workspace" data-case-id={c.case_id} data-case-ref={c.case_number}>
      <Breadcrumbs
        t={t}
        items={[
          { href: "/portfolio", label: t("portfolio.heading"), testId: "case-crumb-portfolio" },
          { label: <bdi dir="ltr">{c.case_number}</bdi> },
        ]}
      />
      <header
        className={styles.header}
        data-testid="case-header"
        data-case-id={c.case_id}
        data-case-ref={c.case_number}
      >
        <p className={styles.number} data-testid="case-number">
          <bdi dir="ltr">{c.case_number}</bdi>
        </p>
        <p data-testid="case-title">{titleOf(locale, c)}</p>
        <dl className={styles.facts}>
          <div>
            <dt>{t("case.header.stage")}</dt>
            <dd data-testid="case-stage" data-stage={c.lifecycle_stage}>
              {stageLabel(t, c.lifecycle_stage)}
            </dd>
          </div>
          <div>
            <dt>{t("case.header.records")}</dt>
            <dd data-testid="case-records-state" data-records-state={c.records_state}>
              {c.records_state === "CLOSED" ? <LockGlyph /> : null}
              {t(c.records_state === "CLOSED" ? "case.records.closed" : "case.records.active")}
            </dd>
          </div>
        </dl>
        {c.is_restricted ? (
          <p>
            <span className={styles.flag} data-testid="case-restricted">
              <KeyGlyph />
              {t("case.restricted")}
            </span>
          </p>
        ) : null}
        <p className={styles.meta} data-testid="case-capacity" data-capacity={view.capacity ?? ""}>
          {view.capacity
            ? t("case.capacity", { capacity: t(CAPACITY_KEYS[view.capacity]) })
            : t("case.capacity.none")}
        </p>
      </header>
      {c.records_state === "CLOSED" ? (
        <p role="note" className={styles.notice} data-testid="case-closed-notice">
          {t("case.closedNotice")}
        </p>
      ) : null}
      <nav aria-label={t("case.workspace.sections")} className={styles.tabs}>
        <ul>
          {CASE_TABS.map((tab) => (
            <li key={tab}>
              <Link
                href={tabHref(c.case_id, tab)}
                aria-current={tab === view.tab ? "page" : undefined}
                data-testid={`case-tab-${tab}`}
              >
                {t(TAB_KEYS[tab])}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <h1>{t(TAB_KEYS[view.tab])}</h1>
      {children}
    </section>
  );
}

/** Recorded events, newest first. Entries name their event; they are records, not statuses (no data-epistemic). */
export function Timeline({
  t,
  locale,
  events,
  testId = "case-timeline",
}: {
  t: Translator;
  locale: Locale;
  events: readonly CaseEvent[];
  testId?: string;
}) {
  if (events.length === 0) {
    return (
      <p data-testid="case-events-empty" className={styles.meta}>
        {t("case.events.empty")}
      </p>
    );
  }
  const when = dateTimeFormat(locale);
  return (
    <ol className={styles.timeline} data-testid={testId} data-count={events.length}>
      {events.map((e) => (
        <li key={e.id} data-testid="case-event" data-event-id={e.id} data-event-code={e.event_code}>
          <p>
            <strong>{eventLabel(t, e.event_code)}</strong>
          </p>
          <p className={styles.metaRow}>
            <time dateTime={e.occurred_at} data-testid="case-event-occurred">
              {t("case.events.occurred", { time: when.format(new Date(e.occurred_at)) })}
            </time>
            <time dateTime={e.recorded_at} data-testid="case-event-recorded">
              {t("case.events.recorded", { time: when.format(new Date(e.recorded_at)) })}
            </time>
          </p>
          <p className={styles.metaRow}>
            <span data-testid="case-event-actor">
              {e.actor_capacity
                ? t("case.events.actor", { capacity: t(CAPACITY_KEYS[e.actor_capacity]) })
                : t("case.events.actorNone")}
            </span>
            <span data-testid="case-event-provenance" data-provenance={e.provenance}>
              {t(PROVENANCE_KEYS[e.provenance])}
            </span>
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * A task's status. A status set by a recorded event is a recorded fact: lib/domain's toBadgeEpistemic gives the
 * ADR-013 attributes, with the event id from the authorised case's own task row (DB-008), never from the URL or
 * client input. An untouched OPEN task has no event, so it carries no epistemic claim (ARCH, 31 Oct). Server only.
 */
function TaskStatus({ t, task }: { t: Translator; task: CaseTask }) {
  const label = t(TASK_STATUS_KEYS[task.status]);
  if (task.status_event_id === null) {
    return (
      <span data-testid="case-task-status" data-task-status={task.status}>
        {label}
      </span>
    );
  }
  const badge = toBadgeEpistemic({ epistemic: "RECORDED_FACT", event_id: task.status_event_id });
  return (
    <span
      data-testid="case-task-status"
      data-task-status={task.status}
      data-epistemic={badge.value}
      data-status-kind="task"
      data-status={task.status}
      data-event-id={badge.event_id}
    >
      {label}
    </span>
  );
}

export function TaskTable({
  t,
  locale,
  tasks,
  caption,
  captionHidden = false,
  emptyText,
  testId,
}: {
  t: Translator;
  locale: Locale;
  tasks: readonly CaseTask[];
  caption: string;
  /** The caption still names the table and its scroll region, but is not shown when a heading above says the same. */
  captionHidden?: boolean;
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
  const day = dateFormat(locale);
  return (
    <ScrollRegion className={styles.scroll} labelledBy={`${testId}-caption`}>
      <table className={styles.table} data-testid={testId} data-count={tasks.length}>
        <caption id={`${testId}-caption`} className={captionHidden ? "v13-sr-only" : undefined}>
          {caption}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("case.tasks.column.task")}</th>
            <th scope="col">{t("case.tasks.column.assignee")}</th>
            <th scope="col">{t("case.tasks.column.due")}</th>
            <th scope="col">{t("case.tasks.column.status")}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              data-testid={`case-task-${task.id}`}
              data-task-id={task.id}
              data-task-code={task.task_code}
              data-mine={task.is_mine ? "true" : "false"}
            >
              <th scope="row">{task.title[locale]}</th>
              <td>
                {task.assignee_capacity
                  ? t(CAPACITY_KEYS[task.assignee_capacity])
                  : t("case.tasks.unassigned")}
                {task.is_mine ? (
                  <>
                    {" "}
                    <span className={styles.flag} data-testid="case-task-mine">
                      {t("case.tasks.mine")}
                    </span>
                  </>
                ) : null}
              </td>
              <td className={styles.nowrap}>
                {task.due_date ? (
                  <time dateTime={task.due_date}>{day.format(new Date(`${task.due_date}T00:00:00Z`))}</time>
                ) : (
                  t("case.tasks.noDue")
                )}
              </td>
              <td>
                <TaskStatus t={t} task={task} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
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
  notifications,
  createdId = null,
  selectedId = null,
}: {
  t: Translator;
  locale: Locale;
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
  const when = dateTimeFormat(locale);
  const num = numberFormat(locale);
  return (
    <ScrollRegion className={styles.scroll} labelledBy="case-notifications-caption">
      <table className={styles.table} data-testid="case-notifications" data-count={notifications.length}>
        <caption id="case-notifications-caption">{t("case.notifications.caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("case.notifications.column.template")}</th>
            <th scope="col">{t("case.notifications.column.version")}</th>
            <th scope="col">{t("case.notifications.column.recipient")}</th>
            <th scope="col">{t("case.notifications.column.status")}</th>
            <th scope="col">{t("case.notifications.column.created")}</th>
            <th scope="col">{t("case.notifications.column.preview")}</th>
          </tr>
        </thead>
        <tbody>
          {notifications.map((n) => (
            <tr
              key={n.notification_id}
              data-testid={`case-notification-${n.notification_id}`}
              data-notification-id={n.notification_id}
              data-created={n.notification_id === createdId ? "true" : undefined}
              data-selected={n.notification_id === selectedId ? "true" : undefined}
            >
              <th scope="row">
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
              </th>
              <td>{num.format(n.template_version)}</td>
              <td data-testid="case-notification-recipient" data-recipient-class={n.recipient_class}>
                <CodeLabel label={recipientClassLabel(t, n.recipient_class)} code={n.recipient_class} />
              </td>
              <td data-testid="case-notification-status" data-lifecycle-status={n.lifecycle_status}>
                <CodeLabel label={notificationStatusLabel(t, n.lifecycle_status)} code={n.lifecycle_status} />
              </td>
              <td className={styles.nowrap}>
                <time dateTime={n.created_at}>{when.format(new Date(n.created_at))}</time>
              </td>
              <td>
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/**
 * The in-case preview (V13-FE-006 part 3). Only the server-rendered HTML of the projected model reaches the page, inside
 * UX-006's sandboxed frame. The unmapped (OI-037) and unavailable states carry no notification content.
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
  const num = numberFormat(locale);
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
          version: num.format(o.version),
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
            tasks={view.myTasks}
            caption={t("case.overview.myTasks")}
            // M1-09: the heading above is the visible label; the caption stays for assistive technology only.
            captionHidden
            emptyText={t("case.overview.noMyTasks")}
            testId="case-my-tasks"
          />
          <h2>{t("case.overview.lastEvents")}</h2>
          <Timeline t={t} locale={locale} events={view.events} testId="case-last-events" />
          <p>
            <Link href={tabHref(view.summary.case_id, "events")} data-testid="case-all-events">
              {t("case.tab.events")}
            </Link>
          </p>
        </div>
      );
    case "events":
      return <Timeline t={t} locale={locale} events={view.events} />;
    case "tasks":
      return (
        <TaskTable
          t={t}
          locale={locale}
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
