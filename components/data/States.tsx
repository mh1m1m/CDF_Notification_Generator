// Page and region states (DESIGN_SYSTEM.md §3.4): empty, error (generic words + correlation id), not found (one page
// for unknown, unauthorised, restricted and other-workspace: identical markup apart from the correlation id) and
// loading (skeleton with aria-busy and a visually hidden label, no spinner-only state).
import type { ReactNode } from "react";
import { CopyButton } from "@/components/data/CopyButton";
import type { Translator } from "@/lib/i18n";

const EMPTY_GLYPH = "○";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="v13-state v13-state-empty" data-testid="empty-state">
      <span aria-hidden="true" className="v13-state-glyph">
        {EMPTY_GLYPH}
      </span>
      <p className="v13-state-title">{title}</p>
      {body ? <p className="v13-muted">{body}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  t: Translator;
  correlationId: string;
  /** role="alert" only for an error after the user's own action. */
  afterUserAction?: boolean;
  retryHref?: string;
  headingLevel?: 1 | 2;
}

export function ErrorState({
  t,
  correlationId,
  afterUserAction,
  retryHref,
  headingLevel = 2,
}: ErrorStateProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div
      className="v13-state v13-state-error"
      role={afterUserAction ? "alert" : undefined}
      data-testid="error-state"
    >
      <Heading className="v13-state-title">{t("common.error.title")}</Heading>
      <p>{t("common.error.body")}</p>
      <p className="v13-correlation">
        <span>{t("common.error.correlation")}</span>
        <bdi dir="ltr">
          <code data-testid="correlation-id">{correlationId}</code>
        </bdi>
        <CopyButton text={correlationId} label={t("common.copy")} doneLabel={t("common.copied")} />
      </p>
      {retryHref ? (
        <a href={retryHref} className="v13-button-link">
          {t("common.error.retry")}
        </a>
      ) : null}
    </div>
  );
}

export interface NotFoundStateProps {
  title: string;
  body: string;
  backHref: string;
  backLabel: string;
  correlationLabel: string;
  correlationId: string;
}

export function NotFoundState({
  title,
  body,
  backHref,
  backLabel,
  correlationLabel,
  correlationId,
}: NotFoundStateProps) {
  return (
    <div className="v13-state" data-testid="not-found-state">
      <h1 className="v13-state-title">{title}</h1>
      <p>{body}</p>
      <p className="v13-correlation">
        <span>{correlationLabel}</span>
        <bdi dir="ltr">
          <code data-testid="correlation-id">{correlationId}</code>
        </bdi>
      </p>
      <a href={backHref} className="v13-button-link">
        {backLabel}
      </a>
    </div>
  );
}

export function LoadingState({ t, label, rows = 3 }: { t: Translator; label?: string; rows?: number }) {
  return (
    <div className="v13-state-loading" role="status" aria-busy="true" data-testid="loading-state">
      <span className="v13-sr-only">{label ?? t("common.loading")}</span>
      {Array.from({ length: Math.max(1, Math.min(rows, 10)) }, (_, i) => (
        <span key={i} aria-hidden="true" className="v13-skeleton" />
      ))}
    </div>
  );
}
