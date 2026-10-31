// V13 ProceduralRecordsReader and NotificationRecordsReader, and CaseSourceAdapter.getCase (SQL), with a
// recording transaction stub: only the invoker read functions are called, with the case id as a bound value, inside
// the identity's context; rows are validated against the contract; a row from another
// case, or one that breaks the contract, refuses the whole result.
import { describe, expect, it } from "vitest";
import { createV13RecordsCaseSource } from "@/lib/adapters/case-source/v13-records";
import { createV13NotificationRecordsReader } from "@/lib/adapters/notification-records/v13-notification-records";
import {
  CaseRecordsMismatchError,
  createV13ProceduralRecordsReader,
  rowToCaseTask,
} from "@/lib/adapters/procedural-records/v13-procedural-records";
import type { CaseId, RequestIdentity } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { caseIdOf } from "./support/fake-case-source";
import { caseEventId, caseNotificationId, caseTaskId } from "./support/fake-records";
import { SECRETARY } from "./support/identities";

const CASE = caseIdOf(1);
const OTHER = caseIdOf(2);

function recorder(rows: unknown[]) {
  const calls: { text: string; values: unknown[]; identity: RequestIdentity }[] = [];
  const run = async <T>(identity: RequestIdentity, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("$"), values, identity });
      return Promise.resolve(rows);
    }) as unknown as Tx;
    return fn(tx);
  };
  const procedural = createV13ProceduralRecordsReader(run);
  const notifications = createV13NotificationRecordsReader(run);
  const source = createV13RecordsCaseSource(run);
  const reader = {
    getCase: (i: RequestIdentity, c: CaseId) => source.getCase(i, c),
    listEvents: (i: RequestIdentity, c: CaseId) => procedural.listEvents(i, c),
    listTasks: (i: RequestIdentity, c: CaseId) => procedural.listTasks(i, c),
    listForCase: (i: RequestIdentity, c: CaseId) => notifications.listForCase(i, c),
  };
  return { calls, reader };
}

const eventRow = (extra: Record<string, unknown> = {}) => ({
  id: caseEventId(1, 2),
  case_id: CASE,
  event_code: "TASK_STATUS_CHANGED",
  occurred_at: new Date("2026-10-05T10:30:00Z"),
  recorded_at: new Date("2026-10-05T10:31:00Z"),
  actor_capacity: null,
  provenance: "SEED_SYNTHETIC",
  subject_type: "case_task",
  subject_id: caseTaskId(1, 1),
  causation_id: null,
  ...extra,
});

const taskRow = (extra: Record<string, unknown> = {}) => ({
  id: caseTaskId(1, 1),
  case_id: CASE,
  task_code: "INTAKE_REVIEW",
  title_ar: "مراجعة الاستلام",
  title_en: "Intake review",
  assignee_capacity: "LEAD_INVESTIGATOR",
  is_mine: false,
  status: "IN_PROGRESS",
  due_date: new Date("2026-11-05T00:00:00Z"),
  row_version: 2,
  status_event_id: caseEventId(1, 2),
  ...extra,
});

const notificationRow = (extra: Record<string, unknown> = {}) => ({
  notification_id: caseNotificationId(1, 1),
  case_id: CASE,
  template_code: "CASE-OPENED-NOTICE",
  template_version: 1,
  language: "ar",
  recipient_class: "CASE_TEAM",
  lifecycle_status: "DRAFT",
  created_at: new Date("2026-10-02T08:00:00Z"),
  row_version: 1,
  ...extra,
});

const caseHeaderRow = (extra: Record<string, unknown> = {}) => ({
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
  ...extra,
});

const FUNCTIONS = [
  ["getCase", "case_header", [caseHeaderRow()]],
  ["listEvents", "case_events", [eventRow()]],
  ["listTasks", "case_tasks", [taskRow()]],
  ["listForCase", "case_notifications", [notificationRow()]],
] as const;

describe("V13 record readers", () => {
  it.each(FUNCTIONS)(
    "%s calls cdf_notifications_v13.%s with the case id bound, inside the identity's context",
    async (method, fn, rows) => {
      const { calls, reader } = recorder([...rows]);
      await reader[method](SECRETARY, CASE);
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.identity).toBe(SECRETARY);
      expect(call.text).toMatch(new RegExp(`from cdf_notifications_v13\\.${fn}\\(\\$::uuid\\)`));
      expect(call.text).not.toContain("*");
      expect(call.text).not.toContain(CASE);
      expect(call.values).toEqual([CASE]);
    },
  );

  it("maps events: instants as ISO strings", async () => {
    const { reader } = recorder([eventRow()]);
    const [e] = await reader.listEvents(SECRETARY, CASE);
    expect(e).toMatchObject({ occurred_at: "2026-10-05T10:30:00.000Z", provenance: "SEED_SYNTHETIC" });
  });

  it("maps tasks: bilingual title, calendar due date", async () => {
    const { reader } = recorder([taskRow(), taskRow({ id: caseTaskId(1, 2), due_date: "2026-11-30" })]);
    const tasks = await reader.listTasks(SECRETARY, CASE);
    expect(tasks[0]).toMatchObject({
      title: { ar: "مراجعة الاستلام", en: "Intake review" },
      due_date: "2026-11-05",
    });
    expect(tasks[1]!.due_date).toBe("2026-11-30");
  });

  it("maps notifications: metadata only", async () => {
    const { reader } = recorder([notificationRow()]);
    const [n] = await reader.listForCase(SECRETARY, CASE);
    expect(Object.keys(n!).sort()).toEqual(
      [
        "case_id",
        "created_at",
        "language",
        "lifecycle_status",
        "notification_id",
        "recipient_class",
        "row_version",
        "template_code",
        "template_version",
      ].sort(),
    );
  });

  it("getCase: the summary plus the caller's capacity; null capacity kept; no row is null", async () => {
    expect(await recorder([caseHeaderRow()]).reader.getCase(SECRETARY, CASE)).toMatchObject({
      case_id: CASE,
      case_number: "CDF-DEMO-2026-0001",
      my_capacity: "SECRETARY",
    });
    expect(
      (await recorder([caseHeaderRow({ my_capacity: null })]).reader.getCase(SECRETARY, CASE))?.my_capacity,
    ).toBeNull();
    expect(await recorder([]).reader.getCase(SECRETARY, CASE)).toBeNull();
  });

  it("unknown or unauthorised cases give empty results (the database decides)", async () => {
    const { reader } = recorder([]);
    expect(await reader.listEvents(SECRETARY, OTHER)).toEqual([]);
    expect(await reader.listTasks(SECRETARY, OTHER)).toEqual([]);
    expect(await reader.listForCase(SECRETARY, OTHER)).toEqual([]);
  });

  it.each([
    ["listEvents", eventRow({ case_id: OTHER })],
    ["listTasks", taskRow({ case_id: OTHER })],
    ["listForCase", notificationRow({ case_id: OTHER })],
  ] as const)("%s refuses the whole result when a row belongs to another case", async (method, foreign) => {
    const own = method === "listEvents" ? eventRow() : method === "listTasks" ? taskRow() : notificationRow();
    const { reader } = recorder([own, foreign]);
    await expect(reader[method](SECRETARY, CASE)).rejects.toBeInstanceOf(CaseRecordsMismatchError);
  });

  it.each([
    ["an unknown capacity on the header", "getCase", [caseHeaderRow({ my_capacity: "CHAIR" })]],
    ["an unknown provenance", "listEvents", [eventRow({ provenance: "IMPORTED" })]],
    ["an event code that is not a code", "listEvents", [eventRow({ event_code: "case opened" })]],
    ["a non-UUID event id", "listEvents", [eventRow({ id: "1" })]],
    ["an extra notification column", "listForCase", [{ ...notificationRow(), body: "x" }]],
    ["an unknown task status", "listTasks", [taskRow({ status: "ARCHIVED" })]],
    [
      "a non-OPEN status without its event",
      "listTasks",
      [taskRow({ status: "DONE", status_event_id: null })],
    ],
    ["a task title with control characters", "listTasks", [taskRow({ title_en: "a\u0007b" })]],
    ["an empty task title", "listTasks", [taskRow({ title_ar: "  " })]],
    ["a row version below 1", "listTasks", [taskRow({ row_version: 0 })]],
    ["an unknown notification language", "listForCase", [notificationRow({ language: "fr" })]],
    ["a malformed template code", "listForCase", [notificationRow({ template_code: "x" })]],
  ] as const)("refuses %s", async (_n, method, rows) => {
    const { reader } = recorder([...rows]);
    await expect(reader[method](SECRETARY, CASE as CaseId)).rejects.toThrow();
  });

  it("an OPEN task needs no status event", () => {
    expect(rowToCaseTask(taskRow({ status: "OPEN", status_event_id: null })).status_event_id).toBeNull();
  });
});
