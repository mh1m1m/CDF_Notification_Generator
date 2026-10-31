// In-memory NotificationCenterReader over synthetic notifications in cases 0001, 0002, 0003, 0009 and 0010, honouring
// the contract with fake-case-source's visibility table (authorisation before filters, order, limit and count). Unit
// tests only; the SQL adapter is covered by v13-notification-center-adapter.spec.ts and integration.
import {
  InvalidCursorError,
  NotificationCenterFilterSchema,
  type NotificationCenterFilter,
  type NotificationCenterPage,
  type NotificationCenterReader,
  type NotificationCenterRow,
  type NotificationLifecycleStatus,
  type RequestIdentity,
} from "@/lib/contracts";
import { caseIdOf, visibleTo } from "./fake-case-source";

export const notificationIdOf = (i: number) =>
  `0f000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;

const SPEC: readonly [number, number, NotificationLifecycleStatus, string][] = [
  // [notification, case suffix, status, recipient class]
  [1, 1, "DRAFT", "WITNESS"],
  [2, 1, "DISPATCHED", "CASE_TEAM"],
  [3, 2, "DRAFT", "WITNESS"],
  [4, 3, "APPROVED", "COMMITTEE_MEMBERS"],
  [5, 9, "DRAFT", "WITNESS"],
  [6, 10, "SUPERSEDED", "GOVERNANCE"],
];

export const FAKE_NOTIFICATIONS: readonly NotificationCenterRow[] = SPEC.map(([i, c, status, recipient]) => ({
  notification_id: notificationIdOf(i),
  case_id: caseIdOf(c),
  case_number: `CDF-DEMO-2026-${String(c).padStart(4, "0")}`,
  case_title: { ar: `قضية تجريبية ${c}`, en: `Demo case ${c}` },
  template_code: i % 2 === 0 ? "CF-24_MEETING_INVITATION" : "CF-20_INVESTIGATION_ASSIGNED",
  template_name:
    i % 2 === 0
      ? { ar: "دعوة اجتماع", en: "Meeting invitation" }
      : { ar: "تكليف بالتحقيق", en: "Investigation assignment" },
  template_version: 1,
  language: "ar",
  recipient_class: recipient,
  lifecycle_status: status,
  // Newest first: a higher number is newer.
  created_at: `2026-10-${String(10 + i).padStart(2, "0")}T09:00:00.000Z`,
  last_event_at: i === 2 ? "2026-10-20T09:00:00.000Z" : null,
  row_version: 1,
}));

export function createFakeNotificationCenter(): NotificationCenterReader & {
  calls: { identity: RequestIdentity; filter: NotificationCenterFilter }[];
} {
  const calls: { identity: RequestIdentity; filter: NotificationCenterFilter }[] = [];
  return {
    calls,
    async listNotifications(identity, filter): Promise<NotificationCenterPage> {
      calls.push({ identity, filter });
      const f = NotificationCenterFilterSchema.parse(filter);
      const visible = new Set(visibleTo(identity).map((c) => c.case_id));
      const matching = FAKE_NOTIFICATIONS.filter((n) => visible.has(n.case_id))
        .filter((n) => !f.lifecycle_status || n.lifecycle_status === f.lifecycle_status)
        .filter((n) => !f.template_code || n.template_code === f.template_code)
        .filter((n) => !f.case_number || n.case_number === f.case_number)
        .filter((n) => !f.created_from || Date.parse(n.created_at) >= Date.parse(f.created_from))
        .filter((n) => !f.created_before || Date.parse(n.created_at) < Date.parse(f.created_before))
        .toSorted((a, b) => b.created_at.localeCompare(a.created_at));
      let start = 0;
      if (f.cursor !== undefined) {
        const at = matching.findIndex(
          (n) => Buffer.from(n.notification_id).toString("base64url") === f.cursor,
        );
        if (at < 0) throw new InvalidCursorError("bad cursor");
        start = at + 1;
      }
      const rows = matching.slice(start);
      const items = rows.slice(0, f.limit);
      return {
        items,
        next_cursor:
          rows.length > f.limit ? Buffer.from(items.at(-1)!.notification_id).toString("base64url") : null,
        total: matching.length,
      };
    },
  };
}
