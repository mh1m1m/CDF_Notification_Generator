// CaseHeader (SCREENS.md S3): a <header> inside CaseWorkspace, before the tab's <h1>. It repeats data-case-id and
// data-case-ref (same values as the root, allowed by the Sentinel rule). The display number stays Latin inside
// <bdi dir="ltr">. Indicators use a glyph and words, never colour alone; a closed case shows a read-only notice.
import type { ReactNode } from "react";
import { ActiveIcon, ArchiveIcon, LockIcon } from "@/components/icons";
import type { Translator } from "@/lib/i18n";
import { assertCaseIdentity } from "@/components/case-identity";

export type RecordsState = "ACTIVE" | "CLOSED";

export interface CaseHeaderProps {
  t: Translator;
  caseId: string;
  caseRef: string;
  /** Localised synthetic case title. */
  title: string;
  /** The stage as a recorded StatusBadge (V13-UX-003), supplied by the page. */
  stage: ReactNode;
  recordsState: RecordsState;
  /** Named access (restricted case). */
  restricted?: boolean;
  /** Localised capacity of the signed-in persona on this case, e.g. "Investigator". */
  capacity?: string;
}

export function CaseHeader({
  t,
  caseId,
  caseRef,
  title,
  stage,
  recordsState,
  restricted,
  capacity,
}: CaseHeaderProps) {
  assertCaseIdentity(caseId, caseRef);
  const closed = recordsState === "CLOSED";
  return (
    <header
      className="v13-case-header"
      data-testid="case-header"
      data-case-id={caseId}
      data-case-ref={caseRef}
    >
      <p className="v13-case-number">
        <span className="v13-sr-only">{t("shell.case.number")}</span>
        <bdi dir="ltr" data-testid="case-number">
          {caseRef}
        </bdi>
      </p>
      <p className="v13-case-title">{title}</p>
      <dl className="v13-case-facts">
        <div>
          <dt>{t("shell.case.stage")}</dt>
          <dd data-testid="case-stage">{stage}</dd>
        </div>
        <div>
          <dt>{t("shell.case.recordsState")}</dt>
          <dd className="v13-indicator" data-testid="case-records-state" data-records-state={recordsState}>
            {closed ? <ArchiveIcon /> : <ActiveIcon />}
            <span>{t(closed ? "common.records.closed" : "common.records.active")}</span>
          </dd>
        </div>
      </dl>
      {restricted || capacity ? (
        <p className="v13-case-indicators">
          {restricted ? (
            <span className="v13-indicator v13-indicator-outline" data-testid="case-restricted">
              <LockIcon />
              <span>{t("shell.case.restricted")}</span>
            </span>
          ) : null}
          {capacity ? (
            <span data-testid="case-capacity">{t("shell.case.capacity", { capacity })}</span>
          ) : null}
        </p>
      ) : null}
      {closed ? (
        <p className="v13-notice" data-testid="case-closed-notice">
          {t("shell.case.closedNotice")}
        </p>
      ) : null}
    </header>
  );
}
