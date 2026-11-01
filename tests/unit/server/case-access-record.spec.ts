// V13-FE-017 (DB-023): the access record is written first, inside the read's own transaction, and a refusal reads
// nothing. Recording transaction stub: one run() per open, the record statement first (bound kind, case and
// notification), then the read; V1401 / V1404 / V1422 answer null with no read; V1500, no row, two rows or another
// column throw (nothing shown). The route and the preview use only the recorded reads. Synthetic only.
import { describe, expect, it } from "vitest";
import { ACCESS_REFUSALS, recordAccess } from "@/lib/adapters/case-source/access-record";
import { createV13RecordsCaseSource } from "@/lib/adapters/case-source/v13-records";
import { createV13NotificationPreviewReader } from "@/lib/adapters/notification-records/v13-notification-preview";
import type { CaseId, RequestIdentity } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { getCaseForRoute } from "@/lib/server/cases";
import { loadNotificationPreview } from "@/lib/server/notification-preview";
import { AppError } from "@/lib/server/errors";
import { caseIdOf, createFakeCaseSource, FAKE_CASES } from "./support/fake-case-source";
import {
  createFakeNotificationPreview,
  previewNotificationIdOf,
  previewRecord,
} from "./support/fake-notification-preview";
import { createFakeProceduralRecords } from "./support/fake-records";
import { ctxFor, SECRETARY } from "./support/identities";

const CASE = caseIdOf(1);
const NID = previewNotificationIdOf(1, 1);

/** A run() whose statements answer `answers` in order; records each statement and which run() it belonged to. */
function scripted(answers: unknown[][]) {
  const calls: { run: number; text: string; values: unknown[]; identity: RequestIdentity }[] = [];
  let runs = 0;
  const run = async <T>(identity: RequestIdentity, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const n = ++runs;
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ run: n, text: strings.join("$"), values, identity });
      return Promise.resolve(answers.shift() ?? []);
    }) as unknown as Tx;
    return fn(tx);
  };
  return { calls, run, runs: () => runs };
}

const headerRow = {
  id: CASE,
  display_number: "CDF-DEMO-2026-0001",
  title_ar: "قضية تجريبية 1",
  title_en: "Demo case 1",
  stage: "INVESTIGATION",
  is_restricted: false,
  records_state: "ACTIVE",
  source_system: "V13_SYNTHETIC",
  source_ref: "demo-0001",
  updated_at: new Date("2026-10-28T00:00:00Z"),
  my_capacity: "SECRETARY",
};
const previewRow = {
  notification_id: NID,
  case_id: CASE,
  template_code: "CF-24_MEETING_INVITATION",
  template_version: 1,
  language: "en",
  recipient_class: "WITNESS",
  lifecycle_status: "DRAFT",
  created_at: new Date("2026-10-20T09:00:00.000Z"),
  row_version: 1,
  name_ar: "دعوة اجتماع",
  name_en: "Meeting invitation",
};

describe("recordAccess", () => {
  const tx = (rows: unknown[]) => (() => Promise.resolve(rows)) as unknown as Tx;
  const open = { kind: "CASE", caseId: CASE } as const;

  it("recorded (or counted in the window): refusal null is true", async () => {
    expect(await recordAccess(tx([{ refusal: null }]), open)).toBe(true);
  });

  it.each(["V1401", "V1404", "V1422"])("refusal %s is false (nothing to show)", async (code) => {
    expect(await recordAccess(tx([{ refusal: code }]), open)).toBe(false);
  });

  it("the refusal list is exactly DB-023's three codes", () => {
    expect([...ACCESS_REFUSALS]).toEqual(["V1401", "V1404", "V1422"]);
  });

  it.each([
    ["V1500 (a command already ran in the transaction)", [{ refusal: "V1500" }]],
    ["an unknown code", [{ refusal: "V9999" }]],
    ["a non-string refusal", [{ refusal: 1404 }]],
    ["no row", []],
    ["two rows", [{ refusal: null }, { refusal: null }]],
    ["an extra column", [{ refusal: null, written: true }]],
    ["another column", [{ outcome: null }]],
  ])("negative: %s throws (never read past)", async (_n, rows) => {
    await expect(recordAccess(tx(rows), open)).rejects.toThrow(/access record/);
  });
});

describe("CaseSourceAdapter.openCase (V13)", () => {
  it("records first, then reads the header, in ONE transaction; bound kind and case", async () => {
    const s = scripted([[{ refusal: null }], [headerRow]]);
    const header = await createV13RecordsCaseSource(s.run).openCase(SECRETARY, CASE);
    expect(header).toMatchObject({ case_id: CASE, my_capacity: "SECRETARY" });
    expect(s.runs()).toBe(1);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0]!.text).toContain("cdf_notifications_v13.api_record_access(");
    expect(s.calls[0]!.values).toEqual(["CASE", CASE, null]);
    expect(s.calls[1]!.text).toContain("cdf_notifications_v13.case_header(");
    expect(s.calls[1]!.values).toEqual([CASE]);
    expect(s.calls.every((c) => c.identity === SECRETARY)).toBe(true);
  });

  it.each(["V1401", "V1404", "V1422"])(
    "negative: refusal %s answers null and never reads the header",
    async (code) => {
      const s = scripted([[{ refusal: code }], [headerRow]]);
      expect(await createV13RecordsCaseSource(s.run).openCase(SECRETARY, CASE)).toBeNull();
      expect(s.calls).toHaveLength(1);
    },
  );

  it("negative: a record that was not written throws before the header read", async () => {
    const s = scripted([[{ refusal: "V1500" }], [headerRow]]);
    await expect(createV13RecordsCaseSource(s.run).openCase(SECRETARY, CASE)).rejects.toThrow();
    expect(s.calls).toHaveLength(1);
  });

  it("getCase stays an unrecorded read (no command)", async () => {
    const s = scripted([[headerRow]]);
    await createV13RecordsCaseSource(s.run).getCase(SECRETARY, CASE);
    expect(s.calls.map((c) => c.text).join()).not.toContain("api_record_access");
  });
});

describe("NotificationPreviewReader.getForCaseRecorded (V13)", () => {
  it("records first, then reads the preview, in ONE transaction; bound kind, case and notification", async () => {
    const s = scripted([[{ refusal: null }], [previewRow]]);
    const r = await createV13NotificationPreviewReader(s.run).getForCaseRecorded(SECRETARY, CASE, NID);
    expect(r).toMatchObject({ notification_id: NID, case_id: CASE });
    expect(s.runs()).toBe(1);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0]!.text).toContain("cdf_notifications_v13.api_record_access(");
    expect(s.calls[0]!.values).toEqual(["NOTIFICATION_PREVIEW", CASE, NID]);
    expect(s.calls[1]!.text).toContain("cdf_notifications_v13.case_notifications(");
  });

  it.each(["V1401", "V1404", "V1422"])("negative: refusal %s answers null and never reads", async (code) => {
    const s = scripted([[{ refusal: code }], [previewRow]]);
    expect(
      await createV13NotificationPreviewReader(s.run).getForCaseRecorded(SECRETARY, CASE, NID),
    ).toBeNull();
    expect(s.calls).toHaveLength(1);
  });

  it("negative: a malformed id never reaches the database (no record, no read)", async () => {
    const s = scripted([]);
    expect(
      await createV13NotificationPreviewReader(s.run).getForCaseRecorded(SECRETARY, CASE, "not-a-uuid"),
    ).toBeNull();
    expect(s.runs()).toBe(0);
  });

  it("negative: V1500 throws before the read", async () => {
    const s = scripted([[{ refusal: "V1500" }], [previewRow]]);
    await expect(
      createV13NotificationPreviewReader(s.run).getForCaseRecorded(SECRETARY, CASE, NID),
    ).rejects.toThrow();
    expect(s.calls).toHaveLength(1);
  });
});

describe("getCaseForRoute opens the case (one recorded read, never the unrecorded one)", () => {
  it("a visible case: exactly one openCase", async () => {
    const source = createFakeCaseSource();
    await getCaseForRoute({ ctx: ctxFor(SECRETARY), source }, CASE);
    expect(source.calls).toEqual(["openCase"]);
  });

  it("negative: a malformed id is refused before any open (no record)", async () => {
    const source = createFakeCaseSource();
    await expect(
      getCaseForRoute({ ctx: ctxFor(SECRETARY), source }, "CDF-DEMO-2026-0001"),
    ).rejects.toBeInstanceOf(AppError);
    expect(source.calls).toEqual([]);
  });

  it("negative: a refused open (null) is NOT_FOUND, like an unknown case", async () => {
    const source = { ...createFakeCaseSource(), openCase: async () => null };
    const error = await getCaseForRoute({ ctx: ctxFor(SECRETARY), source }, CASE).catch((e: unknown) => e);
    expect((error as AppError).code).toBe("NOT_FOUND");
  });

  it("negative: a failed record propagates (generic error with correlation id, not NOT_FOUND)", async () => {
    const source = {
      ...createFakeCaseSource(),
      openCase: async (): Promise<never> => {
        throw new Error("access record: not recorded");
      },
    };
    await expect(getCaseForRoute({ ctx: ctxFor(SECRETARY), source }, CASE as CaseId)).rejects.toThrow(
      "access record: not recorded",
    );
  });
});

describe("loadNotificationPreview reads with the recorded read only", () => {
  it("?n= given: exactly one recorded read, never the unrecorded one; no ?n: no read at all", async () => {
    const row = previewRecord(1, 1);
    const reader = createFakeNotificationPreview([row]);
    const deps = { ctx: ctxFor(SECRETARY), reader, procedural: createFakeProceduralRecords() };
    const summary = FAKE_CASES[0]!;
    await loadNotificationPreview(deps, summary, row.notification_id);
    expect(reader.calls).toEqual([{ caseId: summary.case_id, notificationId: row.notification_id }]);
    expect(reader.unrecorded).toBe(0);
    await loadNotificationPreview(deps, summary, undefined);
    expect(reader.calls).toHaveLength(1);
    expect(reader.unrecorded).toBe(0);
  });
});
