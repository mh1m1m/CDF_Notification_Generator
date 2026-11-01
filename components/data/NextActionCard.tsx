// Next Action Card (V13-UX-015, REQ-IA-009) on PROC's contract (docs/teams/proc/NEXT_ACTION_SOURCES.md): the one task
// the persona can act on next in this case, its status and its due date, with a link to that task. A server component
// with no data access: FE passes what `nextActionForCase` returned, already narrowed to these fields, plus its own
// rendering of the status (the existing labels and recorded badge) and the link to the task.
//
// NONE renders nothing at all: no element, no heading, no line (PROC §4). The card never says why there is no action,
// so it cannot hint at other personas' tasks or at a case the persona may not see.
import type { ReactNode } from "react";
import { DeadlineText } from "@/components/data/DeadlineText";
import type { Locale, Translator } from "@/lib/i18n";

export interface NextActionCardTask {
  /** The task's id (UUID), from the authorised task row. */
  readonly taskId: string;
  /** The task's code, as the Tasks tab carries it: an attribute for tests, never shown as text. */
  readonly taskCode: string;
  /** The task's recorded title in both languages; shown in the page language as text. */
  readonly title: { readonly ar: string; readonly en: string };
  /** The task's existing status rendering from FE (label from the task status catalogue, recorded badge). */
  readonly status: ReactNode;
  /** The recorded due date and FE's day count from `deadlineOf` (same clock as My Work); null when none is recorded. */
  readonly due: { readonly date: string; readonly days: number } | null;
  /** FE's link to this task, one that shows it whichever page of the Tasks tab it is on. */
  readonly href: string;
}

export interface NextActionCardProps {
  t: Translator;
  locale: Locale;
  /** null when the contract returned NONE. */
  action: NextActionCardTask | null;
}

const HEADING_ID = "next-action-heading";

export function NextActionCard({ t, locale, action }: NextActionCardProps) {
  if (action === null) return null;
  return (
    <section
      className="v13-next-action"
      aria-labelledby={HEADING_ID}
      data-testid="next-action-card"
      data-task-id={action.taskId}
      data-task-code={action.taskCode}
    >
      <h2 id={HEADING_ID} className="v13-next-action-heading">
        {t("common.nextAction.heading")}
      </h2>
      <p className="v13-next-action-title">
        <a href={action.href} data-testid="next-action-link">
          <bdi>{action.title[locale]}</bdi>
        </a>
      </p>
      <dl className="v13-next-action-facts">
        <div>
          <dt>{t("common.nextAction.status")}</dt>
          <dd data-testid="next-action-status">{action.status}</dd>
        </div>
        {action.due === null ? null : (
          <div>
            <dt>{t("common.nextAction.dueDate")}</dt>
            <dd data-testid="next-action-due">
              <DeadlineText t={t} locale={locale} date={action.due.date} days={action.due.days} />
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
