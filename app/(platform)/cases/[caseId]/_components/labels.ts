// Message keys for case codes (FE-004). A code outside these tables is shown as the code itself, never blank.
import type { CaseCapacity, TaskStatus } from "@/lib/contracts";
import type { Locale, MessageKey, Translator } from "@/lib/i18n";

export const CAPACITY_KEYS: Readonly<Record<CaseCapacity, MessageKey>> = {
  LEAD_INVESTIGATOR: "case.capacity.leadInvestigator",
  INVESTIGATOR: "case.capacity.investigator",
  SECRETARY: "case.capacity.secretary",
  GOVERNANCE_REVIEWER: "case.capacity.governanceReviewer",
};

export const TASK_STATUS_KEYS: Readonly<Record<TaskStatus, MessageKey>> = {
  OPEN: "case.task.status.open",
  IN_PROGRESS: "case.task.status.inProgress",
  BLOCKED: "case.task.status.blocked",
  DONE: "case.task.status.done",
  CANCELLED: "case.task.status.cancelled",
};

export const PROVENANCE_KEYS: Readonly<Record<"RECORDED_IN_V13" | "SEED_SYNTHETIC", MessageKey>> = {
  RECORDED_IN_V13: "case.provenance.recordedInV13",
  SEED_SYNTHETIC: "case.provenance.seedSynthetic",
};

const EVENT_KEYS: Readonly<Record<string, MessageKey>> = {
  CASE_OPENED: "case.event.caseOpened",
  CASE_CLOSED: "case.event.caseClosed",
  TASK_STATUS_CHANGED: "case.event.taskStatusChanged",
};

const STAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  INTAKE: "case.stage.intake",
  PRELIMINARY_REVIEW: "case.stage.preliminaryReview",
  INVESTIGATION: "case.stage.investigation",
  COMMITTEE_DELIBERATION: "case.stage.committeeDeliberation",
  DECISION: "case.stage.decision",
  CLOSURE: "case.stage.closure",
};

// M1-07: the case Notifications tab shows labels, not raw codes. DISPATCHED reads "sent — delivery not confirmed",
// never "delivered" (ARCH ruling, 31 Oct 20:54). A code outside the table is shown as written.
const NOTIFICATION_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  DRAFT: "case.notifications.status.draft",
  PENDING_APPROVAL: "case.notifications.status.pendingApproval",
  APPROVED: "case.notifications.status.approved",
  DISPATCHED: "case.notifications.status.dispatched",
  CANCELLED: "case.notifications.status.cancelled",
  SUPERSEDED: "case.notifications.status.superseded",
};

/** The database's recipient class codes (migration 0004), labelled as its reference table names them. */
const RECIPIENT_CLASS_KEYS: Readonly<Record<string, MessageKey>> = {
  CASE_TEAM: "case.notifications.recipient.caseTeam",
  COMMITTEE_MEMBERS: "case.notifications.recipient.committeeMembers",
  SUBJECT_EMPLOYEE: "case.notifications.recipient.subjectEmployee",
  WITNESS: "case.notifications.recipient.witness",
  GOVERNANCE: "case.notifications.recipient.governance",
};

const own = (table: Readonly<Record<string, MessageKey>>, code: string) =>
  Object.prototype.hasOwnProperty.call(table, code) ? table[code] : undefined;

export function eventLabel(t: Translator, code: string): string {
  const key = own(EVENT_KEYS, code);
  return key ? t(key) : code;
}

export function stageLabel(t: Translator, code: string): string {
  const key = own(STAGE_KEYS, code);
  return key ? t(key) : code;
}

/** A notification's lifecycle status label, or null when the code has none (the caller shows the code). */
export function notificationStatusLabel(t: Translator, code: string): string | null {
  const key = own(NOTIFICATION_STATUS_KEYS, code);
  return key ? t(key) : null;
}

/** A recipient class label, or null when the code has none (the caller shows the code). */
export function recipientClassLabel(t: Translator, code: string): string | null {
  const key = own(RECIPIENT_CLASS_KEYS, code);
  return key ? t(key) : null;
}

/** Calendar dates (YYYY-MM-DD), shown as that date whatever the time zone. */
export function dateFormat(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-arab" : "en-GB-u-nu-latn", {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}

export function numberFormat(locale: Locale): Intl.NumberFormat {
  return new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-arab" : "en-u-nu-latn");
}
