// My Work view (FE-005, SCREENS S1). Server component: it only renders the view model from lib/server/my-work.ts.
// A task status set by a recorded event is a recorded fact (lib/domain toBadgeEpistemic, event id from the
// authorised row); an untouched OPEN task carries no epistemic claim (ARCH, 31 Oct). Counts are plain text with
// data-count, never badges. The update form offers only the transitions the database accepts and sends row_version.
import Link from "next/link";
import type { MyWorkTask } from "@/lib/contracts";
import { toBadgeEpistemic } from "@/lib/domain";
import type { Locale, MessageKey, Translator } from "@/lib/i18n";
import type { Deadline, MyWorkFilter, MyWorkRow, MyWorkView as View } from "@/lib/server/my-work";
import { ScrollRegion } from "../../_components/ScrollRegion";
import { updateTaskStatus } from "../actions";
import { dateFormat, numberFormat, TASK_STATUS_KEYS } from "../../cases/[caseId]/_components/labels";
import styles from "./my-work.module.css";

const FILTER_KEYS: Readonly<Record<Exclude<MyWorkFilter, "all">, MessageKey>> = {
  overdue: "myWork.counts.overdue",
  week: "myWork.counts.week",
};

function filterHref(filter: MyWorkFilter): string {
  return filter === "all" ? "/my-work" : `/my-work?filter=${filter}`;
}

function CountStrip({
  t,
  locale,
  view,
}: {
  t: Translator;
  locale: Locale;
  view: Extract<View, { kind: "list" }>;
}) {
  const n = numberFormat(locale);
  const items: { filter: MyWorkFilter; key: MessageKey; value: number; testId: string }[] = [
    {
      filter: "overdue",
      key: "myWork.counts.overdue",
      value: view.counts.overdue,
      testId: "count-my-work-overdue",
    },
    { filter: "week", key: "myWork.counts.week", value: view.counts.week, testId: "count-my-work-due-week" },
    { filter: "all", key: "myWork.counts.open", value: view.counts.open, testId: "count-my-work-open" },
  ];
  return (
    <nav className={styles.counts} aria-label={t("myWork.counts.label")}>
      <ul>
        {items.map((item) => (
          <li key={item.filter}>
            <Link
              href={filterHref(item.filter)}
              data-testid={item.testId}
              data-count={item.value}
              aria-current={view.filter === item.filter ? "page" : undefined}
            >
              <span className={styles.countValue}>{n.format(item.value)}</span>
              <span>{t(item.key)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function DeadlineText({ t, locale, deadline }: { t: Translator; locale: Locale; deadline: Deadline }) {
  if (deadline.kind === "none") return <span data-deadline="none">{t("myWork.deadline.none")}</span>;
  const relative = new Intl.RelativeTimeFormat(locale === "ar" ? "ar-u-nu-arab" : "en-u-nu-latn", {
    numeric: "always",
  }).format(deadline.days, "day");
  const text =
    deadline.kind === "overdue"
      ? t("myWork.deadline.overdue", { relative })
      : deadline.kind === "today"
        ? t("myWork.deadline.today")
        : t("myWork.deadline.upcoming", { relative });
  return (
    <span data-deadline={deadline.kind} className={deadline.kind === "overdue" ? styles.overdue : undefined}>
      {text}
      <time className={styles.secondLine} dateTime={deadline.date}>
        {dateFormat(locale).format(new Date(`${deadline.date}T00:00:00Z`))}
      </time>
    </span>
  );
}

function StatusBadge({ t, task }: { t: Translator; task: MyWorkTask }) {
  const label = t(TASK_STATUS_KEYS[task.status]);
  if (task.status_event_id === null) {
    return (
      <span data-testid="my-work-task-status" data-task-status={task.status}>
        {label}
      </span>
    );
  }
  const badge = toBadgeEpistemic({ epistemic: "RECORDED_FACT", event_id: task.status_event_id });
  return (
    <span
      data-testid="my-work-task-status"
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

function UpdateForm({ t, row }: { t: Translator; row: MyWorkRow }) {
  const { task } = row;
  if (task.case_records_state !== "ACTIVE") {
    return <span data-testid={`task-status-closed-${task.task_id}`}>{t("myWork.update.closed")}</span>;
  }
  if (row.transitions.length === 0) return null;
  const selectId = `new-status-${task.task_id}`;
  return (
    <details data-testid={`task-status-update-${task.task_id}`}>
      <summary>{t("myWork.update.summary")}</summary>
      <form action={updateTaskStatus} className={styles.form}>
        <input type="hidden" name="task_id" value={task.task_id} />
        <input type="hidden" name="expected_version" value={String(task.row_version)} />
        <label htmlFor={selectId}>{t("myWork.update.label")}</label>
        <select id={selectId} name="new_status" required data-testid={`task-status-select-${task.task_id}`}>
          {row.transitions.map((status) => (
            <option key={status} value={status}>
              {t(TASK_STATUS_KEYS[status])}
            </option>
          ))}
        </select>
        <button type="submit" data-testid={`task-status-submit-${task.task_id}`}>
          {t("myWork.update.submit")}
        </button>
      </form>
    </details>
  );
}

export function MyWorkTable({
  t,
  locale,
  view,
}: {
  t: Translator;
  locale: Locale;
  view: Extract<View, { kind: "list" }>;
}) {
  return (
    <>
      <CountStrip t={t} locale={locale} view={view} />
      {view.filter !== "all" ? (
        <p>
          {t("myWork.filter.current", { name: t(FILTER_KEYS[view.filter]) })}{" "}
          <Link href="/my-work" data-testid="my-work-filter-all">
            {t("myWork.filter.all")}
          </Link>
        </p>
      ) : null}
      {view.rows.length === 0 ? (
        <p data-testid="my-work-empty">
          {view.filter === "all" ? t("myWork.empty") : t("myWork.emptyFilter")}
        </p>
      ) : (
        <ScrollRegion className={styles.scroll} labelledBy="my-work-table-caption">
          <table className={styles.table} data-testid="my-work-table" data-count={view.rows.length}>
            <caption id="my-work-table-caption">{t("myWork.table.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("myWork.column.case")}</th>
                <th scope="col">{t("myWork.column.task")}</th>
                <th scope="col">{t("myWork.column.due")}</th>
                <th scope="col">{t("myWork.column.status")}</th>
                <th scope="col">{t("myWork.column.action")}</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr
                  key={row.task.task_id}
                  data-testid={`my-work-row-${row.task.task_id}`}
                  data-case-id={row.task.case_id}
                  data-case-ref={row.task.case_number}
                  data-task-code={row.task.task_code}
                >
                  <th scope="row">
                    <Link
                      href={`/cases/${row.task.case_id}/tasks`}
                      data-testid={`my-work-case-${row.task.task_id}`}
                    >
                      {row.task.case_number}
                    </Link>
                    <span className={styles.secondLine}>{row.task.case_title[locale]}</span>
                  </th>
                  <td>{row.task.title[locale]}</td>
                  <td>
                    <DeadlineText t={t} locale={locale} deadline={row.deadline} />
                  </td>
                  <td>
                    <StatusBadge t={t} task={row.task} />
                  </td>
                  <td>
                    <UpdateForm t={t} row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </>
  );
}
