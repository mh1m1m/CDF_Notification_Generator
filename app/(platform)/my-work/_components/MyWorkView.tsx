// My Work view (FE-005, SCREENS S1). Server component: it only renders the view model from lib/server/my-work.ts.
// A task status set by a recorded event is a recorded fact (lib/domain toBadgeEpistemic, event id from the
// authorised row); an untouched OPEN task carries no epistemic claim (ARCH, 31 Oct). Counts are plain text with
// data-count, never badges. The update form offers only the transitions the database accepts and sends row_version.
import Link from "next/link";
import { DataTable } from "@/components/data/DataTable";
import { DeadlineText } from "@/components/data/DeadlineText";
import { StatusBadge, type Tone } from "@/components/data/StatusBadge";
import type { MyWorkTask } from "@/lib/contracts";
import { toBadgeEpistemic } from "@/lib/domain";
import type { Locale, MessageKey, Translator } from "@/lib/i18n";
import type { Deadline, MyWorkFilter, MyWorkRow, MyWorkView as View } from "@/lib/server/my-work";
import { updateTaskStatus } from "../actions";
import { numberFormat, TASK_STATUS_KEYS } from "../../cases/[caseId]/_components/labels";
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

function DueCell({ t, locale, deadline }: { t: Translator; locale: Locale; deadline: Deadline }) {
  if (deadline.kind === "none") return <span>{t("myWork.deadline.none")}</span>;
  return <DeadlineText t={t} locale={locale} date={deadline.date} days={deadline.days} />;
}

/** Task tones for the recorded badge; the glyph comes from StatusBadge (Layer A codes, else neutral). */
const TASK_TONE: Readonly<Record<MyWorkTask["status"], Tone>> = {
  OPEN: "neutral",
  IN_PROGRESS: "info",
  BLOCKED: "warning",
  DONE: "success",
  CANCELLED: "neutral",
};

function TaskStatus({ t, locale, task }: { t: Translator; locale: Locale; task: MyWorkTask }) {
  const label = t(TASK_STATUS_KEYS[task.status]);
  if (task.status_event_id === null) {
    return (
      <span data-testid="my-work-task-status" data-task-status={task.status}>
        {label}
      </span>
    );
  }
  const badge = toBadgeEpistemic({ epistemic: "RECORDED_FACT", event_id: task.status_event_id });
  if (badge.value !== "recorded") return null;
  // No status time on the My Work read: the badge says "recorded" without a time (ARCH, 1 Nov).
  return (
    <StatusBadge
      t={t}
      locale={locale}
      testId="my-work-task-status"
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
        <DataTable<MyWorkRow>
          t={t}
          scope="case"
          testId="my-work-table"
          tableData={{ "data-count": view.rows.length }}
          captionId="my-work-table-caption"
          caption={t("myWork.table.caption")}
          rows={view.rows}
          rowKey={(row) => row.task.task_id}
          rowTestId={(row) => `my-work-row-${row.task.task_id}`}
          rowData={(row) => ({ "data-task-code": row.task.task_code })}
          rowCaseId={(row) => row.task.case_id}
          rowCaseRef={(row) => row.task.case_number}
          empty={null}
          columns={[
            {
              key: "case",
              header: t("myWork.column.case"),
              rowHeader: true,
              cell: (row) => (
                <>
                  <Link
                    href={`/cases/${row.task.case_id}/tasks`}
                    data-testid={`my-work-case-${row.task.task_id}`}
                  >
                    <bdi dir="ltr">{row.task.case_number}</bdi>
                  </Link>
                  <span className="v13-second-line">{row.task.case_title[locale]}</span>
                </>
              ),
            },
            { key: "task", header: t("myWork.column.task"), cell: (row) => row.task.title[locale] },
            {
              key: "due",
              header: t("myWork.column.due"),
              cellData: (row) => ({ "data-deadline": row.deadline.kind }),
              cell: (row) => <DueCell t={t} locale={locale} deadline={row.deadline} />,
            },
            {
              key: "status",
              header: t("myWork.column.status"),
              cell: (row) => <TaskStatus t={t} locale={locale} task={row.task} />,
            },
            {
              key: "action",
              header: t("myWork.column.action"),
              cell: (row) => <UpdateForm t={t} row={row} />,
            },
          ]}
        />
      )}
    </>
  );
}
