// In-memory NotificationPreviewReader for unit tests. Rows are keyed by case and notification id together, and only
// cases the fake case source shows the identity are readable, so an unknown id, another case's notification and a
// hidden case all return null (as RLS does). Synthetic only.
import type { NotificationPreviewReader, NotificationPreviewRecord } from "@/lib/contracts";
import { caseIdOf, visibleTo } from "./fake-case-source";

export const previewNotificationIdOf = (i: number, k: number) =>
  `0f000000-0000-4000-8000-${String(i).padStart(6, "0")}${String(70 + k).padStart(6, "0")}`;

export function previewRecord(
  i: number,
  k: number,
  over: Partial<NotificationPreviewRecord> = {},
): NotificationPreviewRecord {
  return {
    notification_id: previewNotificationIdOf(i, k),
    case_id: caseIdOf(i),
    template_code: "CF-24_MEETING_INVITATION",
    template_version: 1,
    language: "en",
    recipient_class: "WITNESS",
    lifecycle_status: "DRAFT",
    created_at: "2026-10-20T09:00:00.000Z",
    row_version: 1,
    template_name: { ar: "دعوة اجتماع", en: "Meeting invitation" },
    ...over,
  };
}

export function createFakeNotificationPreview(
  rows: readonly NotificationPreviewRecord[],
): NotificationPreviewReader & {
  calls: { caseId: string; notificationId: string }[];
  unrecorded: number;
} {
  const calls: { caseId: string; notificationId: string }[] = [];
  const read: NotificationPreviewReader["getForCase"] = async (identity, caseId, notificationId) => {
    if (!visibleTo(identity).some((c) => c.case_id === caseId)) return null;
    return rows.find((r) => r.case_id === caseId && r.notification_id === notificationId) ?? null;
  };
  const fake = {
    calls,
    unrecorded: 0,
    // Counted apart: the preview must read with getForCaseRecorded only (V13-FE-017).
    async getForCase(identity, caseId, notificationId) {
      fake.unrecorded += 1;
      return read(identity, caseId, notificationId);
    },
    async getForCaseRecorded(identity, caseId, notificationId) {
      calls.push({ caseId, notificationId });
      return read(identity, caseId, notificationId);
    },
  } satisfies NotificationPreviewReader & { calls: unknown; unrecorded: number };
  return fake;
}

/** For inline readers in tests: the unrecorded read, which the preview must never use (V13-FE-017). */
export const unrecordedPreviewRead = async (): Promise<never> => {
  throw new Error("the preview must read with getForCaseRecorded");
};
