// V13 NotificationDraftPort (SQL) with a recording transaction stub: options read only ids, codes, names, versions
// and languages (never subject or body), with explicit columns, inside the identity's context; one bad row refuses the
// list; the command is called with bound values; its refusal column (migration 0013) is read first and maps to refusals
// after the transaction commits, an unknown refusal throws; an answer for another case is refused.
import { describe, expect, it } from "vitest";
import { createV13NotificationDrafts } from "@/lib/adapters/notification-records/v13-notification-drafts";
import { NotificationCommandRefusedError, type RequestIdentity } from "@/lib/contracts";
import type { Tx } from "@/lib/db/security-context";
import { caseIdOf } from "./support/fake-case-source";
import { draftNotificationIdOf, templateVersionIdOf } from "./support/fake-notification-drafts";
import { SECRETARY } from "./support/identities";

function recorder(answers: (call: number) => Promise<unknown[]>) {
  const calls: { text: string; values: unknown[]; identity: RequestIdentity }[] = [];
  const run = async <T>(identity: RequestIdentity, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("$"), values, identity });
      return answers(calls.length);
    }) as unknown as Tx;
    return fn(tx);
  };
  return { calls, port: createV13NotificationDrafts(run) };
}

const templateRow = (extra: Record<string, unknown> = {}) => ({
  template_version_id: templateVersionIdOf(1),
  template_code: "CF-20_INVESTIGATION_ASSIGNED",
  name_ar: "إسناد التحقيق",
  name_en: "Investigation assigned",
  version: 1,
  language: "ar",
  ...extra,
});
const classRow = { code: "WITNESS", name_ar: "الشاهد", name_en: "Witness" };
const command = {
  case_id: caseIdOf(1),
  template_version_id: templateVersionIdOf(1),
  recipient_class: "WITNESS",
  idempotency_key: "a".repeat(64),
};
const answer = (extra: Record<string, unknown> = {}) => ({
  notification_id: draftNotificationIdOf(1),
  case_id: caseIdOf(1),
  lifecycle_status: "DRAFT",
  row_version: 1,
  ...extra,
});
const sqlError = (code: string) => Object.assign(new Error("raw database message"), { code });

describe("options", () => {
  it("reads active template versions and recipient classes with explicit columns, never their text", async () => {
    const { calls, port } = recorder(async (n) => (n === 1 ? [templateRow()] : [classRow]));
    const options = await port.options(SECRETARY);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.identity === SECRETARY)).toBe(true);
    expect(calls[0]?.text).toContain("where t.is_active");
    for (const c of calls) {
      expect(c.text).not.toMatch(/\*|subject|body/);
      expect(c.values).toEqual([]);
    }
    expect(options).toEqual({
      templates: [
        {
          template_version_id: templateVersionIdOf(1),
          template_code: "CF-20_INVESTIGATION_ASSIGNED",
          template_name: { ar: "إسناد التحقيق", en: "Investigation assigned" },
          version: 1,
          language: "ar",
        },
      ],
      recipientClasses: [{ code: "WITNESS", name: { ar: "الشاهد", en: "Witness" } }],
    });
  });

  it.each([
    ["an extra column", templateRow({ body: "text" })],
    ["a missing column", (({ language: _l, ...r }) => r)(templateRow())],
    ["a language outside ar/en", templateRow({ language: "fr" })],
    ["a version 0", templateRow({ version: 0 })],
    ["a control character in a name", templateRow({ name_en: "a\u0007b" })],
  ])("one row with %s refuses the whole list", async (_n, bad) => {
    const { port } = recorder(async (n) => (n === 1 ? [templateRow(), bad] : [classRow]));
    await expect(port.options(SECRETARY)).rejects.toThrow();
  });
});

describe("createDraft", () => {
  const row = (extra: Record<string, unknown> = {}) => ({ ...answer(), refusal: null, ...extra });
  const refused = (refusal: unknown) => ({
    notification_id: null,
    case_id: null,
    lifecycle_status: null,
    row_version: null,
    refusal,
  });

  it("calls api_create_notification_draft with the four bound values and returns the answer", async () => {
    const { calls, port } = recorder(async () => [row()]);
    expect(await port.createDraft(SECRETARY, command as never)).toEqual(answer());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("from cdf_notifications_v13.api_create_notification_draft(");
    expect(calls[0]?.text).toContain("r.refusal");
    expect(calls[0]?.values).toEqual([
      command.case_id,
      command.template_version_id,
      command.recipient_class,
      command.idempotency_key,
    ]);
  });

  it("re-validates the command before any SQL", async () => {
    const { calls, port } = recorder(async () => [row()]);
    await expect(
      port.createDraft(SECRETARY, { ...command, idempotency_key: "x" } as never),
    ).rejects.toThrow();
    await expect(port.createDraft(SECRETARY, { ...command, extra: 1 } as never)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  // V13-DB-021 R5 and §6: the refusal column is read first and mapped exactly as the SQLSTATE was before 0013, and
  // only after run(...) has resolved, so the transaction holding the REFUSED audit row commits.
  it.each([
    ["V1401", "NO_CONTEXT"],
    ["V1404", "NOT_FOUND"],
    ["V1409", "DUPLICATE"],
    ["V1422", "INVALID_INPUT"],
    ["V1423", "CASE_CLOSED"],
  ] as const)("refusal %s is the refusal %s, after the transaction has committed", async (code, refusal) => {
    const outcome: string[] = [];
    const port = createV13NotificationDrafts(
      async <T>(_identity: RequestIdentity, fn: (tx: Tx) => Promise<T>) => {
        const tx = (() => Promise.resolve([refused(code)])) as unknown as Tx;
        try {
          const value = await fn(tx);
          outcome.push("commit");
          return value;
        } catch (e) {
          outcome.push("rollback");
          throw e;
        }
      },
    );
    const error = await port.createDraft(SECRETARY, command as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotificationCommandRefusedError);
    expect((error as NotificationCommandRefusedError).refusal).toBe(refusal);
    expect((error as Error).message).toBe(refusal);
    expect(outcome).toEqual(["commit"]);
  });

  it("checks the refusal before any other column: a refusal row that also names the asked-for case is refused", async () => {
    // Fails if the adapter ignores the refusal column (the mutation ARCH's §6 asks a test to catch).
    const { port } = recorder(async () => [row({ refusal: "V1409" })]);
    const error = await port.createDraft(SECRETARY, command as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotificationCommandRefusedError);
    expect((error as NotificationCommandRefusedError).refusal).toBe("DUPLICATE");
  });

  it.each([
    ["V1500"],
    ["V1400"],
    ["42501"],
    ["v1404"],
    [""],
    ["constructor"],
    ["__proto__"],
    ["toString"],
    [1404],
  ])("throws a plain error, never a refusal or an answer, on the unknown refusal %j", async (code) => {
    const { port } = recorder(async () => [refused(code)]);
    const error = await port.createDraft(SECRETARY, command as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NotificationCommandRefusedError);
  });

  it("a raised database error, V14xx included, propagates unchanged (no longer a refusal path)", async () => {
    for (const code of ["40001", "V1404", "V1500", "42501"]) {
      const other = sqlError(code);
      const { port } = recorder(async () => {
        throw other;
      });
      await expect(port.createDraft(SECRETARY, command as never)).rejects.toBe(other);
    }
  });

  it.each([
    ["no row", []],
    ["two rows", [row(), row()]],
    ["a refusal row and an answer", [refused("V1404"), row()]],
    ["no refusal column", [answer()]],
    ["refusal null and every other column null", [refused(null)]],
    ["another case", [row({ case_id: caseIdOf(2) })]],
    ["a status other than DRAFT", [row({ lifecycle_status: "APPROVED" })]],
    ["a version other than 1", [row({ row_version: 2 })]],
  ])("an answer with %s is refused (fail closed)", async (_n, rows) => {
    const { port } = recorder(async () => rows);
    const error = await port.createDraft(SECRETARY, command as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NotificationCommandRefusedError);
  });
});
