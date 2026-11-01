// V13 NotificationPreviewReader (SQL) with a recording transaction stub: one statement keyed by the case AND the
// notification id, explicit columns, bound values, no template text (subject, body) read, inside the identity's
// context; strict rows (an extra column, a malformed row, a second row or a row of another case/notification refuses);
// a malformed id never reaches the database.
import { describe, expect, it } from "vitest";
import {
  createV13NotificationPreviewReader,
  PREVIEW_COLUMNS,
  rowToPreviewRecord,
  type PreviewRow,
} from "@/lib/adapters/notification-records/v13-notification-preview";
import type { RequestIdentity } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { caseIdOf } from "./support/fake-case-source";
import { previewNotificationIdOf } from "./support/fake-notification-preview";
import { SECRETARY } from "./support/identities";

function recorder(answer: () => Promise<unknown[]>) {
  const calls: { text: string; values: unknown[]; identity: RequestIdentity }[] = [];
  const run = async <T>(identity: RequestIdentity, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("$"), values, identity });
      return answer();
    }) as unknown as Tx;
    return fn(tx);
  };
  return { calls, reader: createV13NotificationPreviewReader(run) };
}

const NID = previewNotificationIdOf(1, 1);
const row = (extra: Record<string, unknown> = {}): PreviewRow =>
  ({
    notification_id: NID,
    case_id: caseIdOf(1),
    template_code: "CF-24_MEETING_INVITATION",
    template_version: 1,
    language: "en",
    recipient_class: "WITNESS",
    lifecycle_status: "DRAFT",
    created_at: new Date("2026-10-20T09:00:00.000Z"),
    row_version: 1,
    name_ar: "دعوة اجتماع",
    name_en: "Meeting invitation",
    ...extra,
  }) as PreviewRow;

describe("getForCase", () => {
  it("reads one row keyed by the case and the notification id, with explicit columns and bound values", async () => {
    const { calls, reader } = recorder(async () => [row()]);
    const r = await reader.getForCase(SECRETARY, caseIdOf(1), NID);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.identity).toBe(SECRETARY);
    expect(calls[0]?.values).toEqual([caseIdOf(1), NID]);
    const text = calls[0]?.text ?? "";
    expect(text).toContain("cdf_notifications_v13.case_notifications($::uuid)");
    expect(text).toContain("where n.notification_id = $::uuid");
    expect(text).not.toMatch(/\*|subject|body|notification_template_version/);
    for (const c of PREVIEW_COLUMNS) expect(text).toContain(c);
    expect(r).toEqual({
      notification_id: NID,
      case_id: caseIdOf(1),
      template_code: "CF-24_MEETING_INVITATION",
      template_version: 1,
      language: "en",
      recipient_class: "WITNESS",
      lifecycle_status: "DRAFT",
      created_at: "2026-10-20T09:00:00.000Z",
      row_version: 1,
      template_name: { ar: "دعوة اجتماع", en: "Meeting invitation" },
    });
  });

  it("returns null when RLS or the key hides the row (unknown, other case, unauthorised look the same)", async () => {
    const { reader } = recorder(async () => []);
    expect(await reader.getForCase(SECRETARY, caseIdOf(1), NID)).toBeNull();
  });

  it.each(["", "CDF-DEMO-2026-0001", NID.toUpperCase(), `${NID}'--`, "not-a-uuid"])(
    "negative: the malformed id %j never reaches the database",
    async (bad) => {
      const { calls, reader } = recorder(async () => [row()]);
      expect(await reader.getForCase(SECRETARY, caseIdOf(1), bad)).toBeNull();
      expect(calls).toHaveLength(0);
    },
  );

  it("negative: a row of another case or another notification refuses the result", async () => {
    await expect(
      recorder(async () => [row({ case_id: caseIdOf(3) })]).reader.getForCase(SECRETARY, caseIdOf(1), NID),
    ).rejects.toThrow("another case");
    await expect(
      recorder(async () => [row({ notification_id: previewNotificationIdOf(1, 2) })]).reader.getForCase(
        SECRETARY,
        caseIdOf(1),
        NID,
      ),
    ).rejects.toThrow("another case or notification");
  });

  it("negative: a second row refuses the result", async () => {
    await expect(
      recorder(async () => [row(), row()]).reader.getForCase(SECRETARY, caseIdOf(1), NID),
    ).rejects.toThrow("more than one row");
  });
});

describe("rowToPreviewRecord (strict rows)", () => {
  it("negative: an extra or a missing column refuses", () => {
    expect(() => rowToPreviewRecord(row({ subject: "x" }))).toThrow("unexpected columns");
    const { name_en: _drop, ...missing } = row();
    expect(() => rowToPreviewRecord(missing as PreviewRow)).toThrow("unexpected columns");
  });
  it("negative: malformed values refuse", () => {
    expect(() => rowToPreviewRecord(row({ language: "fr" }))).toThrow();
    expect(() => rowToPreviewRecord(row({ name_en: "" }))).toThrow();
    expect(() => rowToPreviewRecord(row({ name_ar: "a\u0000b" }))).toThrow();
    expect(() => rowToPreviewRecord(row({ case_id: "0009" }))).toThrow();
    expect(() => rowToPreviewRecord(row({ template_version: 0 }))).toThrow();
  });
});
