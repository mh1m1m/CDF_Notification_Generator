// Case Portfolio markup (FE-003, SCREENS S2). Server component, no client JavaScript: the filters are a GET form, so
// the URL holds the whole view and the page works without scripts. Every row carries ADR-013's data-case-id and
// data-case-ref; the counts carry data-count. The view model comes from lib/server/portfolio (authorised data only).
import Link from "next/link";
import type { CaseSummary, RecordsState } from "@/lib/contracts";
import { translateKey, type Locale, type MessageKey, type Translator } from "@/lib/i18n";
import type { PortfolioView as View } from "@/lib/server/portfolio";
import {
  CLEAR_FILTERS_HREF,
  filterFormKey,
  hasFilters,
  PORTFOLIO_RECORDS_STATES,
  PORTFOLIO_STAGES,
  type PortfolioQuery,
} from "@/lib/server/portfolio-query";
import { ScrollRegion } from "../../_components/ScrollRegion";
import styles from "./portfolio.module.css";

const STAGE_KEYS: Readonly<Record<(typeof PORTFOLIO_STAGES)[number], MessageKey>> = {
  INTAKE: "case.stage.intake",
  PRELIMINARY_REVIEW: "case.stage.preliminaryReview",
  INVESTIGATION: "case.stage.investigation",
  COMMITTEE_DELIBERATION: "case.stage.committeeDeliberation",
  DECISION: "case.stage.decision",
  CLOSURE: "case.stage.closure",
};

const RECORDS_KEYS: Readonly<Record<RecordsState, MessageKey>> = {
  ACTIVE: "case.records.active",
  CLOSED: "case.records.closed",
};

/** A stage code outside the known catalogue is shown as the code itself (visible, never blank). */
function stageLabel(t: Translator, code: string): string {
  return Object.prototype.hasOwnProperty.call(STAGE_KEYS, code)
    ? t(STAGE_KEYS[code as keyof typeof STAGE_KEYS])
    : code;
}

function titleOf(locale: Locale, c: CaseSummary): string {
  if (c.synthetic_title) return c.synthetic_title[locale];
  return c.title_key ? translateKey(locale, c.title_key) : "";
}

const RESULT_KEYS: Readonly<Record<Intl.LDMLPluralRule, MessageKey>> = {
  zero: "portfolio.results.zero",
  one: "portfolio.results.one",
  two: "portfolio.results.two",
  few: "portfolio.results.few",
  many: "portfolio.results.many",
  other: "portfolio.results.other",
};

/** Arabic UI text uses Arabic-Indic digits, English Latin (DESIGN_SYSTEM.md §5), whatever the runtime's CLDR default. */
function numberFormat(locale: Locale): Intl.NumberFormat {
  return new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-arab" : "en-u-nu-latn");
}

/**
 * Recorded-event dates: calendar date in the CDF time zone (Asia/Riyadh), Arabic-Indic digits in Arabic. The exact
 * instant stays in the <time dateTime> attribute.
 */
function dateFormat(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-arab" : "en-GB-u-nu-latn", {
    dateStyle: "medium",
    timeZone: "Asia/Riyadh",
  });
}

function resultLine(t: Translator, locale: Locale, total: number): string {
  // English has no "zero" plural category; say "No cases" there too.
  const rule = total === 0 ? "zero" : new Intl.PluralRules(locale).select(total);
  return t(RESULT_KEYS[rule], { count: numberFormat(locale).format(total) });
}

function captionOf(t: Translator, locale: Locale, query: PortfolioQuery): string {
  const parts: string[] = [];
  if (query.text !== undefined) parts.push(t("portfolio.caption.search", { text: query.text }));
  if (query.stage !== undefined)
    parts.push(t("portfolio.caption.stage", { stage: stageLabel(t, query.stage) }));
  if (query.state !== undefined)
    parts.push(t("portfolio.caption.state", { state: t(RECORDS_KEYS[query.state]) }));
  if (query.mine) parts.push(t("portfolio.caption.mine"));
  return t("portfolio.caption", {
    filters:
      parts.length === 0
        ? t("portfolio.caption.noFilters")
        : t("portfolio.caption.filters", {
            list: new Intl.ListFormat(locale, { type: "conjunction" }).format(parts),
          }),
  });
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

function Filters({ t, query }: { t: Translator; query: PortfolioQuery }) {
  return (
    <form
      method="get"
      action="/portfolio"
      role="search"
      // Back to a page loaded as a document (back_forward) would otherwise get the browser's restored form values
      // instead of the URL's filters (OI-043, QA review of #63).
      autoComplete="off"
      aria-label={t("portfolio.filters.label")}
      className={styles.filters}
      data-testid="portfolio-filters"
    >
      <div className={styles.field}>
        <label htmlFor="portfolio-q">{t("portfolio.filters.search")}</label>
        <input
          id="portfolio-q"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={query.text ?? ""}
          data-testid="portfolio-search"
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="portfolio-stage">{t("portfolio.filters.stage")}</label>
        <select
          id="portfolio-stage"
          name="stage"
          defaultValue={query.stage ?? ""}
          data-testid="portfolio-stage"
        >
          <option value="">{t("portfolio.filters.anyStage")}</option>
          {PORTFOLIO_STAGES.map((code) => (
            <option key={code} value={code}>
              {stageLabel(t, code)}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor="portfolio-state">{t("portfolio.filters.state")}</label>
        <select
          id="portfolio-state"
          name="state"
          defaultValue={query.state ?? ""}
          data-testid="portfolio-state"
        >
          <option value="">{t("portfolio.filters.anyState")}</option>
          {PORTFOLIO_RECORDS_STATES.map((code) => (
            <option key={code} value={code}>
              {t(RECORDS_KEYS[code])}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.check}>
        <input
          id="portfolio-mine"
          name="mine"
          type="checkbox"
          value="1"
          defaultChecked={query.mine === true}
          data-testid="portfolio-mine"
        />
        <label htmlFor="portfolio-mine">{t("portfolio.filters.mine")}</label>
      </div>
      <div className={styles.actions}>
        <button type="submit" className="v13-button" data-testid="portfolio-apply">
          {t("portfolio.filters.apply")}
        </button>
        {hasFilters(query) ? (
          <Link href={CLEAR_FILTERS_HREF} className="v13-button-link" data-testid="portfolio-clear">
            {t("portfolio.filters.clear")}
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function ErrorState({
  t,
  title,
  body,
  correlationId,
  testId,
}: {
  t: Translator;
  title: string;
  body: string;
  correlationId: string;
  testId: string;
}) {
  return (
    <div role="alert" className="v13-error" data-testid={testId}>
      <h2>{title}</h2>
      <p>{body}</p>
      <p>
        <span>{t("portfolio.error.correlation")}</span>{" "}
        <bdi dir="ltr" data-testid="correlation-id">
          {correlationId}
        </bdi>
      </p>
    </div>
  );
}

export function PortfolioView({ t, locale, view }: { t: Translator; locale: Locale; view: View }) {
  const fmt = numberFormat(locale);
  return (
    <section data-testid="portfolio-page">
      <h1>{t("portfolio.heading")}</h1>
      {view.kind === "page" ? <Filters key={filterFormKey(view.query)} t={t} query={view.query} /> : null}
      {view.kind === "invalid" ? (
        <>
          <ErrorState
            t={t}
            testId="portfolio-invalid"
            title={t("portfolio.error.title")}
            body={t("portfolio.error.invalidFilters")}
            correlationId={view.correlationId}
          />
          <p>
            <Link href={CLEAR_FILTERS_HREF} data-testid="portfolio-clear">
              {t("portfolio.filters.clear")}
            </Link>
          </p>
        </>
      ) : null}
      {view.kind === "error" ? (
        <ErrorState
          t={t}
          testId="portfolio-error"
          title={t("portfolio.error.title")}
          body={t("portfolio.error.body")}
          correlationId={view.correlationId}
        />
      ) : null}
      {view.kind === "page" ? <Results t={t} locale={locale} fmt={fmt} view={view} /> : null}
    </section>
  );
}

function Results({
  t,
  locale,
  fmt,
  view,
}: {
  t: Translator;
  locale: Locale;
  fmt: Intl.NumberFormat;
  view: Extract<View, { kind: "page" }>;
}) {
  const { page, query } = view;
  const filtered = hasFilters(query);
  const to = view.from > 0 ? view.from + page.items.length - 1 : 0;
  return (
    <div aria-live="polite" aria-atomic="false" className={styles.results}>
      <p data-testid="count-portfolio-results" data-count={page.total} className={styles.count}>
        {resultLine(t, locale, page.total)}
      </p>
      {page.items.length === 0 ? (
        filtered || query.after !== undefined ? (
          <div data-testid="portfolio-no-results" className={styles.empty}>
            <p>{t("portfolio.noResults")}</p>
            <Link href={CLEAR_FILTERS_HREF}>{t("portfolio.filters.clear")}</Link>
          </div>
        ) : (
          <p data-testid="portfolio-empty" className={styles.empty}>
            {t("portfolio.empty")}
          </p>
        )
      ) : (
        <>
          <ScrollRegion className={styles.scroll} labelledBy="portfolio-table-caption">
            <table className={styles.table} data-testid="portfolio-table">
              <caption id="portfolio-table-caption">{captionOf(t, locale, query)}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("portfolio.column.number")}</th>
                  <th scope="col">{t("portfolio.column.title")}</th>
                  <th scope="col">{t("portfolio.column.stage")}</th>
                  <th scope="col">{t("portfolio.column.state")}</th>
                  <th scope="col">{t("portfolio.column.indicators")}</th>
                  <th scope="col">{t("portfolio.column.lastEvent")}</th>
                  <th scope="col">{t("portfolio.column.myOpenTasks")}</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((c) => (
                  <tr
                    key={c.case_id}
                    data-testid={`portfolio-row-${c.case_id}`}
                    data-case-id={c.case_id}
                    data-case-ref={c.case_number}
                  >
                    <th scope="row" className={styles.nowrap}>
                      <Link href={`/cases/${c.case_id}`} data-testid={`portfolio-open-${c.case_id}`}>
                        <bdi dir="ltr">{c.case_number}</bdi>
                      </Link>
                    </th>
                    <td>{titleOf(locale, c)}</td>
                    <td data-testid="portfolio-stage-cell" data-stage={c.lifecycle_stage}>
                      {stageLabel(t, c.lifecycle_stage)}
                    </td>
                    <td
                      className={styles.nowrap}
                      data-testid="portfolio-records-state"
                      data-records-state={c.records_state}
                    >
                      {c.records_state === "CLOSED" ? <LockGlyph /> : null}
                      {t(RECORDS_KEYS[c.records_state])}
                    </td>
                    <td>
                      {c.is_restricted ? (
                        <span className={styles.flag} data-testid="portfolio-restricted">
                          <KeyGlyph />
                          {t("case.restricted")}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {c.last_event_id !== null && c.last_event_at !== null ? (
                        <time
                          dateTime={c.last_event_at}
                          data-testid="portfolio-last-event"
                          data-event-id={c.last_event_id}
                        >
                          {dateFormat(locale).format(new Date(c.last_event_at))}
                        </time>
                      ) : (
                        <span data-testid="portfolio-no-event">{t("portfolio.noEvent")}</span>
                      )}
                    </td>
                    <td data-testid="portfolio-my-open-tasks" data-count={c.my_open_task_count}>
                      {fmt.format(c.my_open_task_count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <nav aria-label={t("portfolio.pagination.label")} className={styles.pagination}>
            {view.from > 0 ? (
              <p data-testid="count-portfolio-total" data-count={page.total}>
                {t("portfolio.pageSummary", {
                  from: fmt.format(view.from),
                  to: fmt.format(to),
                  total: fmt.format(page.total),
                })}
              </p>
            ) : null}
            {view.prevHref ? (
              <Link href={view.prevHref} rel="prev" data-testid="portfolio-prev">
                {t("portfolio.pagination.previous")}
              </Link>
            ) : null}
            {view.nextHref ? (
              <Link href={view.nextHref} rel="next" data-testid="portfolio-next">
                {t("portfolio.pagination.next")}
              </Link>
            ) : null}
          </nav>
        </>
      )}
    </div>
  );
}
