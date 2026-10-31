/**
 * MFR — the notification model built from server records (V13-PROC-008, for FE-006's preview).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Synthetic ids and CDF-DEMO-2026-NNNN numbers only.
 *
 * The record shapes mirror migration 0002–0004 rows. Recipient classes here are the policy's (WITNESS, MEMBER); the
 * database's own codes are refused by the projection until the owner decides OI-037.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as D from "@/lib/disclosure";
import {
  buildModelFromRecords,
  type NotificationRecordSet,
} from "@/lib/notifications/binding/model-from-records";
import {
  NotificationBindingError,
  projectForRecipient,
  type ServerProjectionRecords,
} from "@/lib/notifications/binding/server-projection";
import { renderEmail } from "@/lib/notifications/render/email";
import { renderPlatform } from "@/lib/notifications/render/platform";
import { deliveryWording } from "@/lib/notifications/render/components";

const CASE_1 = "0c000000-0000-4000-8000-000000000001";
const CASE_2 = "0c000000-0000-4000-8000-000000000002";
const NTF_1 = "0d000000-0000-4000-8000-000000000101";
const NTF_2 = "0d000000-0000-4000-8000-000000000202";
const codeIs = (code: string) => (e: unknown) => (e as { code?: unknown }).code === code;
const bindingCode = (code: string) => (e: unknown) =>
  e instanceof NotificationBindingError && e.code === code;

const recordsFor = (
  n: 1 | 2,
  over: { recipient_class?: string; lifecycle_status?: string; restricted?: boolean } = {},
): NotificationRecordSet => {
  const caseId = n === 1 ? CASE_1 : CASE_2;
  return {
    case_record: {
      id: caseId,
      display_number: `CDF-DEMO-2026-000${n}`,
      is_restricted: over.restricted ?? false,
      records_state: "ACTIVE",
    },
    notification: {
      id: n === 1 ? NTF_1 : NTF_2,
      case_id: caseId,
      recipient_class: over.recipient_class ?? "WITNESS",
      lifecycle_status: over.lifecycle_status ?? "DRAFT",
      created_at: "2026-10-20T09:00:00Z",
      template: {
        code: "CF-24_MEETING_INVITATION",
        version: 1,
        language: "en",
        name_ar: "دعوة اجتماع",
        name_en: "Meeting invitation",
      },
    },
    events: [
      {
        id: `0e000000-0000-4000-8000-00000000000${n}`,
        case_id: caseId,
        event_code: "CASE_OPENED",
        occurred_at: "2026-10-01T08:00:00Z",
        recorded_at: "2026-10-01T08:00:00Z",
      },
    ],
  };
};
const serverRecords = (
  r: NotificationRecordSet,
  access?: { on: boolean } | null,
  cls = r.notification.recipient_class,
): ServerProjectionRecords => ({
  case_record: { id: r.case_record.id, is_restricted: r.case_record.is_restricted },
  recipient_row: { case_id: r.notification.case_id, recipient_class: cls },
  ...(access ? { access_list: { case_id: r.case_record.id, on_access_list: access.on } } : {}),
});

describe("MFR the model carries its own case only", () => {
  test("MFR-01 built from 0001's records, the model and its projection carry 0001 only", () => {
    const r1 = recordsFor(1);
    const m = buildModelFromRecords(r1);
    assert.equal(m.meta.case_id, CASE_1);
    assert.equal(m.meta.notification_id, NTF_1);
    assert.equal(m.fields.case_number, "CDF-DEMO-2026-0001");
    const p = projectForRecipient(m, serverRecords(r1), { channel: "EMAIL" });
    for (const out of [JSON.stringify(m), JSON.stringify(p), renderEmail(p, { lang: "en" }).html])
      for (const other of [CASE_2, NTF_2, "CDF-DEMO-2026-0002"]) assert.ok(!out.includes(other), other);
  });

  test("MFR-02 a notification row of another case is refused (CASE_MISMATCH)", () => {
    const r1 = recordsFor(1);
    const r2 = recordsFor(2);
    assert.throws(
      () => buildModelFromRecords({ ...r1, notification: r2.notification }),
      bindingCode("CASE_MISMATCH"),
    );
  });

  test("MFR-03 an event of another case is refused (CASE_MISMATCH), even among the case's own events", () => {
    const r1 = recordsFor(1);
    const r2 = recordsFor(2);
    assert.throws(
      () => buildModelFromRecords({ ...r1, events: [...r1.events, ...r2.events] }),
      bindingCode("CASE_MISMATCH"),
    );
  });

  test("MFR-04 a model of case 0001 projected with case 0002's records is refused (CASE_MISMATCH)", () => {
    const m = buildModelFromRecords(recordsFor(1));
    assert.throws(() => projectForRecipient(m, serverRecords(recordsFor(2))), bindingCode("CASE_MISMATCH"));
  });
});

describe("MFR the projection still decides", () => {
  test("MFR-05 projectForRecipient refuses the model when the recipient row's class differs (RECIPIENT_MISMATCH)", () => {
    const r = recordsFor(1, { recipient_class: "WITNESS" });
    const m = buildModelFromRecords(r);
    assert.throws(
      () => projectForRecipient(m, serverRecords(r, null, "MEMBER")),
      codeIs("RECIPIENT_MISMATCH"),
    );
  });

  test("MFR-06 a restricted case without an access-list result is refused (NO_ACCESS_LIST_RESULT)", () => {
    const r = recordsFor(1, { restricted: true });
    const m = buildModelFromRecords(r);
    assert.throws(() => projectForRecipient(m, serverRecords(r)), bindingCode("NO_ACCESS_LIST_RESULT"));
    assert.ok(D.isProjected(projectForRecipient(m, serverRecords(r, { on: false }))));
  });

  test("MFR-07 the database's own recipient codes are refused by the projection (OI-037, owner decision)", () => {
    for (const cls of ["CASE_TEAM", "COMMITTEE_MEMBERS", "SUBJECT_EMPLOYEE", "GOVERNANCE"]) {
      const r = recordsFor(1, { recipient_class: cls });
      const m = buildModelFromRecords(r);
      assert.throws(() => projectForRecipient(m, serverRecords(r)), bindingCode("UNKNOWN_RECIPIENT"), cls);
    }
  });

  test("MFR-08 the case number reaches no recipient the policy withholds it from (the same decision as any model)", () => {
    for (const cls of ["WITNESS", "MEMBER"]) {
      const r = recordsFor(1, { recipient_class: cls });
      const p = projectForRecipient(buildModelFromRecords(r), serverRecords(r));
      const want = D.decide(D.loadPolicy(), {
        recipient: cls,
        field: "case_number",
        channel: "EMAIL_TEXT",
        context: "*",
      }).outcome;
      if (want !== "ALLOWED") assert.notEqual(p.fields.case_number, "CDF-DEMO-2026-0001", cls);
      assert.equal(p._disclosure_log.case_number?.outcome !== "ALLOWED", want !== "ALLOWED", cls);
    }
  });
});

describe("MFR records only, deterministic, fail closed", () => {
  test("MFR-09 only the fields the records can fill are set; nothing comes from the fixtures", () => {
    const m = buildModelFromRecords(recordsFor(1));
    assert.deepEqual(Object.keys(m.fields).sort(), [
      "card_content",
      "case_number",
      "classification_marking",
      "confidentiality_notice",
      "delivery_status",
      "event_title",
      "issuer",
      "notice_reference",
      "preheader",
      "subject_detail",
      "template_code",
    ]);
    assert.deepEqual(m.fields.event_title, { ar: "دعوة اجتماع", en: "Meeting invitation" });
    assert.equal(m.meta.generated_at, "2026-10-20T09:00:00Z");
    assert.equal(m.meta.language, "en");
    assert.equal(m.meta.recipient_class, "WITNESS");
  });

  test("MFR-10 the same records always give the same model, projection and rendering", () => {
    const a = buildModelFromRecords(recordsFor(1, { recipient_class: "MEMBER" }));
    const b = buildModelFromRecords(recordsFor(1, { recipient_class: "MEMBER" }));
    assert.deepEqual(a, b);
    const r = recordsFor(1, { recipient_class: "MEMBER" });
    const pa = projectForRecipient(a, serverRecords(r), { channel: "PLATFORM" });
    const pb = projectForRecipient(b, serverRecords(r), { channel: "PLATFORM" });
    assert.equal(JSON.stringify(pa), JSON.stringify(pb));
    assert.equal(renderPlatform(pa, { lang: "ar" }).html, renderPlatform(pb, { lang: "ar" }).html);
  });

  test("MFR-11 the lifecycle status maps to the lifecycle vocabulary; DISPATCHED reads sent, never delivered", () => {
    const want: Record<string, { notification_status: string; channel?: string }> = {
      DRAFT: { notification_status: "DRAFT" },
      PENDING_APPROVAL: { notification_status: "AUTHORIZATION_PENDING" },
      APPROVED: { notification_status: "AUTHORIZED" },
      DISPATCHED: { notification_status: "SENT", channel: "EMAIL" },
      CANCELLED: { notification_status: "CANCELLED" },
    };
    for (const [status, mapped] of Object.entries(want))
      assert.deepEqual(
        buildModelFromRecords(recordsFor(1, { lifecycle_status: status })).fields.delivery_status,
        mapped,
        status,
      );
    // the wording the renderers would show (the policy decides whether a recipient sees the field at all)
    const dispatched = buildModelFromRecords(recordsFor(1, { lifecycle_status: "DISPATCHED" })).fields
      .delivery_status as Parameters<typeof deliveryWording>[0];
    for (const experience of ["EMAIL", "PLATFORM"])
      assert.equal(deliveryWording(dispatched, experience).key, "SENT_EMAIL");
  });

  test("MFR-11b a lifecycle status without wording is refused, SUPERSEDED included (UNSUPPORTED_LIFECYCLE_STATUS)", () => {
    for (const status of ["SUPERSEDED", "SENT", "DELIVERED", "draft", "__proto__", "toString"])
      assert.throws(
        () => buildModelFromRecords(recordsFor(1, { lifecycle_status: status })),
        bindingCode("UNSUPPORTED_LIFECYCLE_STATUS"),
        status,
      );
  });

  test("MFR-11c the classification marking is RESTRICTED for a restricted case and INTERNAL otherwise, never PUBLIC", () => {
    assert.deepEqual(buildModelFromRecords(recordsFor(1)).fields.classification_marking, {
      code: "INTERNAL",
      ar: "داخلي — سري",
      en: "Internal — confidential",
    });
    assert.deepEqual(
      buildModelFromRecords(recordsFor(1, { restricted: true })).fields.classification_marking,
      {
        code: "RESTRICTED",
        ar: "مقيد — سري للغاية",
        en: "Restricted — highly confidential",
      },
    );
  });

  const r = recordsFor(1);
  const malformed: Array<[string, unknown]> = [
    ["no records", undefined],
    ["no case record", { ...r, case_record: null }],
    ["case id not a uuid", { ...r, case_record: { ...r.case_record, id: "1" } }],
    ["is_restricted as text", { ...r, case_record: { ...r.case_record, is_restricted: "false" } }],
    ["no notification", { ...r, notification: undefined }],
    ["notification id not a uuid", { ...r, notification: { ...r.notification, id: "CDF-DEMO-2026-0001" } }],
    [
      "created_at without a zone",
      { ...r, notification: { ...r.notification, created_at: "2026-10-20T09:00" } },
    ],
    ["no template", { ...r, notification: { ...r.notification, template: null } }],
    [
      "template language unknown",
      { ...r, notification: { ...r.notification, template: { ...r.notification.template, language: "fr" } } },
    ],
    [
      "template version 0",
      { ...r, notification: { ...r.notification, template: { ...r.notification.template, version: 0 } } },
    ],
    ["events not a list", { ...r, events: null }],
    ["an event without a case", { ...r, events: [{ ...r.events[0], case_id: undefined }] }],
  ];
  for (const [name, input] of malformed)
    test(`MFR-12 refused: ${name} (NO_SERVER_CONTEXT)`, () => {
      assert.throws(
        () => buildModelFromRecords(input as NotificationRecordSet),
        bindingCode("NO_SERVER_CONTEXT"),
      );
    });

  test("MFR-13 the model is unprojected: renderers refuse it until projectForRecipient has run", () => {
    const m = buildModelFromRecords(recordsFor(1));
    assert.equal(D.isProjected(m), false);
    // @ts-expect-error an unprojected model does not type-check as a renderer input
    assert.throws(() => renderEmail(m), codeIs("UNPROJECTED_MODEL"));
  });
});

test("MFR-14 the modules FE calls are server-only (renderPlatform's HTML is all that reaches the preview frame)", () => {
  for (const f of [
    "lib/notifications/binding/model-from-records.ts",
    "lib/notifications/binding/server-projection.ts",
    "lib/notifications/render/platform.ts",
    "lib/notifications/render/email.ts",
  ])
    assert.equal(readFileSync(join(process.cwd(), f), "utf8").split("\n")[0], 'import "server-only";', f);
});
