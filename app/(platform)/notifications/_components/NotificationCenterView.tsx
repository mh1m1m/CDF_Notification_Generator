// Notification Operations Center markup (FE-006, SCREENS S4). Server component, no client JavaScript: the filters are a
// GET form, so the URL holds the whole view and the page works without scripts. Every row names its case and carries
// ADR-013's data-case-id and data-case-ref; the counts carry data-count. Metadata only: no recipient, author or
// content. "Sent" reads "sent — delivery not confirmed", never "delivered" (V13 L-07). The view model comes from
// lib/server/notification-center (authorised data only).
import Link from "next/link";
import { formatDate, formatDateTime, formatNumber } from "@/components/format";
import { NOTIFICATION_LIFECYCLE_STATUSES, type NotificationLifecycleStatus } from "@/lib/contracts";
import type { Locale, MessageKey, Translator } from "@/lib/i18n";
import type { NotificationCenterView as View } from "@/lib/server/notification-center";
import { previewHref } from "@/lib/server/notification-preview";
import {
  CENTER_PATH,
  centerFilterFormKey,
  hasCenterFilters,
  type CenterQuery,
} from "@/lib/server/notification-center-query";
import { ScrollRegion } from "../../_components/ScrollRegion";
import styles from "./center.module.css";

const STATUS_KEYS: Readonly<Record<NotificationLifecycleStatus, MessageKey>> = {
  DRAFT: "notifications.status.draft",
  PENDING_APPROVAL: "notifications.status.pendingApproval",
  APPROVED: "notifications.status.approved",
  DISPATCHED: "notifications.status.dispatched",
  CANCELLED: "notifications.status.cancelled",
  SUPERSEDED: "notifications.status.superseded",
};

const RECIPIENT_KEYS: Readonly<Record<string, MessageKey>> = {
  CASE_TEAM: "notifications.recipient.caseTeam",
  COMMITTEE_MEMBERS: "notifications.recipient.committeeMembers",
  SUBJECT_EMPLOYEE: "notifications.recipient.subjectEmployee",
  WITNESS: "notifications.recipient.witness",
  GOVERNANCE: "notifications.recipient.governance",
};

/** A recipient class outside the known catalogue is shown as the code itself (visible, never blank). */
function recipientLabel(t: Translator, code: string): string {
  return Object.prototype.hasOwnProperty.call(RECIPIENT_KEYS, code) ? t(RECIPIENT_KEYS[code]!) : code;
}

const RESULT_KEYS: Readonly<Record<Intl.LDMLPluralRule, MessageKey>> = {
  zero: "notifications.results.zero",
  one: "notifications.results.one",
  two: "notifications.results.two",
  few: "notifications.results.few",
  many: "notifications.results.many",
  other: "notifications.results.other",
};

/** A calendar day of the filter (YYYY-MM-DD), shown as that same day (noon UTC is the same date in Riyadh). */
function dayFormat(locale: Locale, day: string): string {
  return formatDate(locale, `${day}T12:00:00Z`);
}

function resultLine(t: Translator, locale: Locale, total: number): string {
  const rule = total === 0 ? "zero" : new Intl.PluralRules(locale).select(total);
  return t(RESULT_KEYS[rule], { count: formatNumber(locale, total) });
}

function captionOf(t: Translator, locale: Locale, query: CenterQuery): string {
  const parts: string[] = [];
  if (query.status !== undefined)
    parts.push(t("notifications.caption.status", { status: t(STATUS_KEYS[query.status]) }));
  if (query.template !== undefined)
    parts.push(t("notifications.caption.template", { template: query.template }));
  if (query.caseNumber !== undefined) parts.push(t("notifications.caption.case", { case: query.caseNumber }));
  if (query.from !== undefined)
    parts.push(t("notifications.caption.from", { date: dayFormat(locale, query.from) }));
  if (query.to !== undefined)
    parts.push(t("notifications.caption.to", { date: dayFormat(locale, query.to) }));
  return t("notifications.caption", {
    filters:
      parts.length === 0
        ? t("notifications.caption.noFilters")
        : t("notifications.caption.filters", {
            list: new Intl.ListFormat(locale, { type: "conjunction" }).format(parts),
          }),
  });
}

function Filters({ t, query }: { t: Translator; query: CenterQuery }) {
  return (
    <form
      method="get"
      action={CENTER_PATH}
      role="search"
      // Back to a page loaded as a document (back_forward) would otherwise get the browser's restored form values
      // instead of the URL's filters (OI-043, QA review of #63).
      autoComplete="off"
      aria-label={t("notifications.filters.label")}
      className={styles.filters}
      data-testid="notifications-filters"
    >
      <div className={styles.field}>
        <label htmlFor="notifications-status">{t("notifications.filters.status")}</label>
        <select
          id="notifications-status"
          name="status"
          defaultValue={query.status ?? ""}
          data-testid="notifications-filter-status"
        >
          <option value="">{t("notifications.filters.anyStatus")}</option>
          {NOTIFICATION_LIFECYCLE_STATUSES.map((code) => (
            <option key={code} value={code}>
              {t(STATUS_KEYS[code])}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor="notifications-template">{t("notifications.filters.template")}</label>
        <input
          id="notifications-template"
          name="template"
          type="text"
          dir="ltr"
          maxLength={61}
          autoComplete="off"
          aria-describedby="notifications-template-hint"
          defaultValue={query.template ?? ""}
          data-testid="notifications-filter-template"
        />
        <span id="notifications-template-hint" className={styles.hint}>
          {t("notifications.filters.templateHint")}
        </span>
      </div>
      <div className={styles.field}>
        <label htmlFor="notifications-case">{t("notifications.filters.case")}</label>
        <input
          id="notifications-case"
          name="case"
          type="text"
          dir="ltr"
          maxLength={18}
          autoComplete="off"
          aria-describedby="notifications-case-hint"
          defaultValue={query.caseNumber ?? ""}
          data-testid="notifications-filter-case"
        />
        <span id="notifications-case-hint" className={styles.hint}>
          {t("notifications.filters.caseHint")}
        </span>
      </div>
      <div className={styles.field}>
        <label htmlFor="notifications-from">{t("notifications.filters.from")}</label>
        <input
          id="notifications-from"
          name="from"
          type="date"
          defaultValue={query.from ?? ""}
          data-testid="notifications-filter-from"
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="notifications-to">{t("notifications.filters.to")}</label>
        <input
          id="notifications-to"
          name="to"
          type="date"
          defaultValue={query.to ?? ""}
          data-testid="notifications-filter-to"
        />
      </div>
      <div className={styles.actions}>
        <button type="submit" className="v13-button" data-testid="notifications-apply">
          {t("notifications.filters.apply")}
        </button>
        {hasCenterFilters(query) ? (
          <Link href={CENTER_PATH} className="v13-button-link" data-testid="notifications-clear">
            {t("notifications.filters.clear")}
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function ErrorState({
  t,
  body,
  correlationId,
  testId,
}: {
  t: Translator;
  body: string;
  correlationId: string;
  testId: string;
}) {
  return (
    <div role="alert" className="v13-error" data-testid={testId}>
      <h2>{t("notifications.error.title")}</h2>
      <p>{body}</p>
      <p>
        <span>{t("notifications.error.correlation")}</span>{" "}
        <bdi dir="ltr" data-testid="correlation-id">
          {correlationId}
        </bdi>
      </p>
    </div>
  );
}

export function NotificationCenterView({ t, locale, view }: { t: Translator; locale: Locale; view: View }) {
  return (
    <section data-testid="notifications-page">
      <h1>{t("notifications.heading")}</h1>
      {view.kind === "page" ? (
        <Filters key={centerFilterFormKey(view.query)} t={t} query={view.query} />
      ) : null}
      {view.kind === "invalid" ? (
        <>
          <ErrorState
            t={t}
            testId="notifications-invalid"
            body={t("notifications.error.invalidFilters")}
            correlationId={view.correlationId}
          />
          <p>
            <Link href={CENTER_PATH} data-testid="notifications-clear">
              {t("notifications.filters.clear")}
            </Link>
          </p>
        </>
      ) : null}
      {view.kind === "error" ? (
        <ErrorState
          t={t}
          testId="notifications-error"
          body={t("notifications.error.body")}
          correlationId={view.correlationId}
        />
      ) : null}
      {view.kind === "page" ? <Results t={t} locale={locale} view={view} /> : null}
    </section>
  );
}

function Results({
  t,
  locale,
  view,
}: {
  t: Translator;
  locale: Locale;
  view: Extract<View, { kind: "page" }>;
}) {
  const { page, query } = view;
  const fmt = (value: number) => formatNumber(locale, value);
  const to = view.from > 0 ? view.from + page.items.length - 1 : 0;
  return (
    <div aria-live="polite" aria-atomic="false" className={styles.results}>
      <p data-testid="count-notifications-results" data-count={page.total} className={styles.count}>
        {resultLine(t, locale, page.total)}
      </p>
      {page.items.length === 0 ? (
        hasCenterFilters(query) || query.after !== undefined ? (
          <div data-testid="notifications-no-results" className={styles.empty}>
            <p>{t("notifications.noResults")}</p>
            <Link href={CENTER_PATH}>{t("notifications.filters.clear")}</Link>
          </div>
        ) : (
          <p data-testid="notifications-empty" className={styles.empty}>
            {t("notifications.empty")}
          </p>
        )
      ) : (
        <>
          <ScrollRegion className={styles.scroll} labelledBy="notifications-table-caption">
            <table className={styles.table} data-testid="notifications-table">
              <caption id="notifications-table-caption">{captionOf(t, locale, query)}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("notifications.column.case")}</th>
                  <th scope="col">{t("notifications.column.notification")}</th>
                  <th scope="col">{t("notifications.column.recipient")}</th>
                  <th scope="col">{t("notifications.column.status")}</th>
                  <th scope="col">{t("notifications.column.created")}</th>
                  <th scope="col">{t("notifications.column.lastEvent")}</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((n) => (
                  <tr
                    key={n.notification_id}
                    data-testid={`notification-row-${n.notification_id}`}
                    data-notification-id={n.notification_id}
                    data-case-id={n.case_id}
                    data-case-ref={n.case_number}
                  >
                    <th scope="row">
                      <Link
                        href={`/cases/${n.case_id}`}
                        className={styles.nowrap}
                        data-testid={`notifications-open-case-${n.notification_id}`}
                      >
                        <bdi dir="ltr">{n.case_number}</bdi>
                      </Link>
                      <span className={styles.sub}>{n.case_title[locale]}</span>
                    </th>
                    <td>
                      <Link
                        href={previewHref(n.case_id, n.notification_id)}
                        data-testid={`notifications-open-${n.notification_id}`}
                      >
                        {n.template_name[locale]}
                      </Link>
                      <span className={styles.sub}>
                        <bdi dir="ltr" className={styles.nowrap} data-testid="notification-template-code">
                          {n.template_code}
                        </bdi>{" "}
                        {/* Template versions are identifiers: Latin in <bdi> in both languages (DESIGN_SYSTEM §6 D10). */}
                        <span className={styles.nowrap}>
                          {t("notifications.versionLabel")}{" "}
                          <bdi dir="ltr" data-testid="notification-template-version">
                            {n.template_version}
                          </bdi>
                        </span>
                      </span>
                    </td>
                    <td data-testid="notification-recipient-class" data-recipient-class={n.recipient_class}>
                      {recipientLabel(t, n.recipient_class)}
                    </td>
                    <td data-testid="notification-status" data-lifecycle-status={n.lifecycle_status}>
                      {t(STATUS_KEYS[n.lifecycle_status])}
                    </td>
                    <td className={styles.nowrap}>
                      <time dateTime={n.created_at}>{formatDateTime(locale, n.created_at)}</time>
                    </td>
                    <td className={styles.nowrap}>
                      {n.last_event_at !== null ? (
                        <time dateTime={n.last_event_at} data-testid="notification-last-event">
                          {formatDateTime(locale, n.last_event_at)}
                        </time>
                      ) : (
                        <span data-testid="notification-no-event">{t("notifications.noEvent")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <nav aria-label={t("notifications.pagination.label")} className={styles.pagination}>
            {view.from > 0 ? (
              <p data-testid="count-notifications-total" data-count={page.total}>
                {t("notifications.pageSummary", {
                  from: fmt(view.from),
                  to: fmt(to),
                  total: fmt(page.total),
                })}
              </p>
            ) : null}
            {view.prevHref ? (
              <Link href={view.prevHref} rel="prev" data-testid="notifications-prev">
                {t("notifications.pagination.previous")}
              </Link>
            ) : null}
            {view.nextHref ? (
              <Link href={view.nextHref} rel="next" data-testid="notifications-next">
                {t("notifications.pagination.next")}
              </Link>
            ) : null}
          </nav>
        </>
      )}
    </div>
  );
}
