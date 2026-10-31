// SEC — lifecycle security controls (charter §12 SEC: recipient manipulation, export validation, header injection, HTML
// injection and unsafe URLs in exports, storage controls). Author: W-D1. Ids SEC-40…SEC-63 (the lower SEC range is left
// to W-D2's disclosure / render tests). All adapters are mocks (PRODUCTION_SUBSTITUTION_REQUIRED). Synthetic data only:
// the example.test address and «Employee Alpha» appear here only as hostile input that must be refused, never stored.
import { test, describe } from "vitest";
import assert from "node:assert/strict";
import * as F from "./support/fixtures";
import { LifecycleError, STATEMENT_KEYS } from "@/lib/notifications/lifecycle/notification";
import { idempotencyKey, IdempotencyError } from "@/lib/notifications/lifecycle/idempotency";
import { createEvidenceStore, EvidenceValidationError } from "@/lib/notifications/lifecycle/evidence";
import {
  buildExportEml,
  ExportError,
  EXPORT_LABELS,
  STATE_EXPORT_LABEL,
  NEVER_SENT_STATES,
  labelFor,
  encodeHeaderWords,
} from "@/lib/notifications/lifecycle/export";
import { createStorage, createMemoryWebStorage, StorageRefusedError } from "./fakes/storage";
import { createNotifyOutbox, OUTBOX_COLUMNS, OutboxError, deepLink } from "./fakes/notifyOutbox";
import {
  createAuditLedger,
  verifyEntries,
  AuditImmutableError,
  AuditValidationError,
} from "./fakes/auditLedger";
import { createStubSender } from "./fakes/sender";
import { createRecipientResolution, RecipientResolutionError } from "./fakes/recipientResolution";
import { createCaseReadModel } from "./fakes/caseReadModel";
import type { NotificationRecord } from "@/lib/notifications/lifecycle/notification";
import type { DeepReadonly } from "@/lib/notifications/lifecycle/util";
import type { OutgoingNotification } from "@/lib/notifications/lifecycle/ports";

type W = F.World;
type Rec = DeepReadonly<NotificationRecord>;
/** Test view of a caught refusal (codes and ids only). */
interface Caught {
  readonly name: string;
  readonly message: string;
  readonly stack: string;
  readonly code?: unknown;
  readonly details?: {
    readonly violations: readonly { readonly id: string; readonly detail: { readonly reason?: unknown } }[];
    readonly [key: string]: unknown;
  };
}

const SEC = F.SECRETARY_ACTOR;
const ADDRESS = "employee.alpha@example.test"; // synthetic hostile input (CLAUDE.md §1: @example.test only)
const OTHER_CASE = "00000000-0000-4000-8000-0000000000c2"; // a second synthetic case
const UNKNOWN_ROW = "10000000-0000-4000-8000-ffffffffffff";
const code = (c: string) => (err: unknown) => err instanceof LifecycleError && err.code === c;
const modelFor = (r: Rec) =>
  F.projectedModel({ recipient_id: r.recipient.recipient_id, recipient_class: r.recipient.class });
const denials = (w: W) => w.ledger.list({ category: "SECURITY" });
const lastDenial = (w: W) => denials(w).at(-1)!;

function catchErr(fn: () => unknown): Caught {
  try {
    fn();
  } catch (err) {
    return err as Caught;
  }
  return assert.fail("expected a refusal");
}

// ------------------------------------------------------------------------------------------ EML reading (tests only) --
const td = new TextDecoder();
const b64decode = (b64: string) =>
  td.decode(Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));
const decodeWords = (v: string) =>
  v.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=\s*/g, (_: string, b: string) => b64decode(b));

function parseEml(eml: string) {
  const split = eml.indexOf("\r\n\r\n");
  const headerBlock = eml.slice(0, split).replace(/\r\n[ \t]/g, " "); // unfold
  const headers = new Map<string, string>();
  for (const line of headerBlock.split("\r\n")) {
    const i = line.indexOf(":");
    headers.set(line.slice(0, i), line.slice(i + 1).trim());
  }
  return { headerBlock, headers, body: eml.slice(split + 4) };
}

function parts(eml: string): { text?: string; html?: string } {
  const { headers, body } = parseEml(eml);
  const m = /boundary="([^"]+)"/.exec(headers.get("Content-Type") ?? "");
  if (!m) return { text: b64decode(body) };
  const out: { text?: string; html?: string } = {};
  for (const chunk of body.split(`--${m[1]}`)) {
    const i = chunk.indexOf("\r\n\r\n");
    if (i < 0) continue;
    const head = chunk.slice(0, i);
    if (/text\/plain/.test(head)) out.text = b64decode(chunk.slice(i + 4));
    if (/text\/html/.test(head)) out.html = b64decode(chunk.slice(i + 4));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ world drivers ------
function failOut(w: W, rowId: string) {
  for (let i = 0; i < 10; i += 1) {
    if (w.outbox.recordEmailDelivery(rowId, false) === "FAILED") return;
    w.outbox.claimEmailBatch(10);
  }
  throw new Error("row did not fail");
}

/** A world with one EMAIL notification in `state` (CORRECTED: version 2; SUPERSEDED: version 1 once version 2 is SENT,
 * lead ruling L-04). Paths through an e-mail DELIVERY_CONFIRMED set SETTLEMENT explicitly (L-07: ACCEPTANCE is the default). */
function drive(state: string, world: F.WorldOptions = {}): { w: W; r: Rec } {
  const viaConfirmation = ["DELIVERY_CONFIRMED", "CORRECTED", "SUPERSEDED"].includes(state);
  const w = F.createWorld(
    viaConfirmation
      ? { ...world, lifecycle: { deliveryConfirmation: "SETTLEMENT", ...(world.lifecycle ?? {}) } }
      : world,
  );
  const lc = w.lifecycle;
  if (state === "AUTHORIZATION_PENDING") {
    let r = lc.draft(F.defenceNoticeDraft()).record;
    r = lc.transition(r, "VALIDATED", {
      actor: SEC,
      model: modelFor(r),
      statement: F.DEFENCE_STATEMENT,
    }).record;
    return { w, r: lc.transition(r, "AUTHORIZATION_PENDING", { actor: SEC }).record };
  }
  let r = lc.draft(F.invitationDraft()).record;
  if (state === "DRAFT") return { w, r };
  if (state === "CANCELLED")
    return {
      w,
      r: lc.transition(r, "CANCELLED", { actor: SEC, reason_code: "SYNTHETIC_CANCELLATION" }).record,
    };
  r = lc.transition(r, "VALIDATED", {
    actor: SEC,
    model: modelFor(r),
    statement: F.INVITATION_STATEMENT,
  }).record;
  if (state === "VALIDATED") return { w, r };
  r = lc.transition(r, "AUTHORIZED", { actor: SEC }).record;
  if (state === "AUTHORIZED") return { w, r };
  r = lc.transition(r, "QUEUED", { actor: SEC }).record;
  if (state === "QUEUED") return { w, r };
  w.outbox.claimEmailBatch(10);
  r = lc.transition(r, "SENT", {}).record;
  if (state === "SENT") return { w, r };
  if (state === "DELIVERY_FAILED") {
    failOut(w, r.outbox!.row_id);
    return { w, r: lc.transition(r, "DELIVERY_FAILED", {}).record };
  }
  w.outbox.recordEmailDelivery(r.outbox!.row_id, true);
  r = lc.transition(r, "DELIVERY_CONFIRMED", {}).record;
  if (state === "DELIVERY_CONFIRMED") return { w, r };
  const out = lc.transition(r, "CORRECTED", { actor: SEC, reason_code: "SYNTHETIC_CORRECTION" });
  if (state === "CORRECTED") return { w, r: out.record };
  if (state === "SUPERSEDED") {
    let v2 = lc.transition(out.record, "VALIDATED", {
      actor: SEC,
      model: modelFor(out.record),
      statement: F.INVITATION_STATEMENT,
    }).record;
    v2 = lc.transition(v2, "AUTHORIZED", { actor: SEC }).record;
    v2 = lc.transition(v2, "QUEUED", { actor: SEC }).record;
    w.outbox.claimEmailBatch(10);
    return { w, r: lc.transition(v2, "SENT", {}).superseded! };
  }
  throw new Error(`no driver for ${state}`);
}

// ======================================================================================= recipient manipulation ======
describe("SEC-40 the recipient comes from authoritative resolution, never from caller input", () => {
  test("SEC-40 an id the resolution port does not return is refused, audited COMMAND_DENIED {command, outcome}, nothing is created", () => {
    const w = F.createWorld();
    for (const recipient_id of [F.IDS.WITNESS, F.IDS.CHAIR, F.IDS.SUBJECT, "usr-not-in-directory"]) {
      assert.throws(
        () => w.lifecycle.draft(F.invitationDraft({ recipient_id })),
        code("RECIPIENT_NOT_RESOLVED"),
      );
      const d = lastDenial(w);
      assert.equal(d.type, "COMMAND_DENIED");
      assert.deepEqual([d.category, d.outcome], ["SECURITY", "DENIED"]);
      assert.deepEqual(
        d.payload,
        { command: "notification_draft", outcome: "FORBIDDEN" },
        "metadata {command, outcome} only (inbox.ts:45-60)",
      );
    }
    assert.equal(w.lifecycle.records().length, 0);
    assert.equal(w.outbox.rows().length, 0);
    assert.equal(w.evidence.size(), 0);
  });
  test("SEC-40 resolution is per type and object: a recipient of another object or type is not a recipient here", () => {
    const w = F.createWorld();
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ object: { type: "MEETING", id: F.IDS.MEETING_2 } })),
      code("RECIPIENT_NOT_RESOLVED"),
    );
    assert.throws(
      () => w.lifecycle.draft(F.defenceNoticeDraft({ recipient_id: F.IDS.MEMBER })),
      code("RECIPIENT_NOT_RESOLVED"),
    );
    const ok = w.lifecycle.draft(F.invitationDraft()).record;
    assert.deepEqual(ok.recipient, {
      recipient_id: F.IDS.MEMBER,
      class: "MEMBER",
      capacity: "COMMITTEE_MEMBER",
    });
  });
});

describe("SEC-41 class and capacity are never upgraded by the caller", () => {
  test("SEC-41 a caller-stated class or capacity that differs from the resolved one is refused and audited", () => {
    const w = F.createWorld();
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ recipient_class: "CHAIR" })),
      code("RECIPIENT_CLASS_MISMATCH"),
    );
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ recipient_class: "RESTRICTED_CASE_AUTHORITY" })),
      code("RECIPIENT_CLASS_MISMATCH"),
    );
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ capacity: "COMMITTEE_CHAIR" })),
      code("RECIPIENT_CAPACITY_MISMATCH"),
    );
    assert.equal(denials(w).length, 3);
    assert.ok(denials(w).every((d) => d.type === "COMMAND_DENIED" && d.payload.outcome === "FORBIDDEN"));
    assert.equal(w.lifecycle.records().length, 0);
  });
  test("SEC-41 a forged snapshot cannot change the recipient: the lifecycle uses its own stored record", () => {
    const w = F.createWorld();
    const r = w.lifecycle.draft(F.invitationDraft()).record;
    assert.throws(
      () => {
        // @ts-expect-error -- writing to a frozen record on purpose (must throw)
        r.recipient.class = "CHAIR";
      },
      TypeError,
      "records handed out are deeply frozen",
    );
    const forged = {
      ...r,
      recipient: { recipient_id: F.IDS.CHAIR, class: "CHAIR", capacity: "COMMITTEE_CHAIR" },
    };
    const chairModel = F.projectedModel({ recipient_id: F.IDS.CHAIR, recipient_class: "CHAIR" });
    assert.throws(
      () =>
        w.lifecycle.transition(forged, "VALIDATED", {
          actor: SEC,
          model: chairModel,
          statement: F.INVITATION_STATEMENT,
        }),
      code("MODEL_RECIPIENT_MISMATCH"),
    );
    const v = w.lifecycle.transition(forged, "VALIDATED", {
      actor: SEC,
      model: modelFor(r),
      statement: F.INVITATION_STATEMENT,
    }).record;
    assert.deepEqual(v.recipient, r.recipient, "the forged recipient was ignored");
  });
});

describe("SEC-42 addresses and display names are never recipients", () => {
  test("SEC-42 an address-like recipient is refused and the address is never echoed (error, details, ledger, evidence)", () => {
    const w = F.createWorld();
    for (const recipient_id of [ADDRESS, `Employee Alpha <${ADDRESS}>`, "Employee Alpha"]) {
      const err = catchErr(() => w.lifecycle.draft(F.invitationDraft({ recipient_id })));
      assert.equal(err.code, "RECIPIENT_ADDRESS_NOT_ALLOWED");
      const text = `${err.message} ${JSON.stringify(err.details)}`;
      assert.ok(!text.includes("example.test") && !text.includes("Employee"), text);
    }
    const ledgerText = JSON.stringify(w.ledger.list());
    assert.ok(!ledgerText.includes("example.test") && !ledgerText.includes("Employee"));
    assert.equal(w.ledger.size(), 3, "each refusal is audited");
    assert.equal(w.evidence.size(), 0);
    assert.equal(w.lifecycle.records().length, 0);
  });
});

describe("SEC-43 the resolution port holds opaque ids, classes and capacities only", () => {
  test("SEC-43 addresses, unknown classes and missing capacities are refused; extra fields are dropped; lists are frozen", () => {
    const key = `MEETING_INVITATION:${F.IDS.MEETING}`;
    const build = (entry: Record<string, unknown>) => () => createRecipientResolution({ [key]: [entry] });
    assert.throws(
      build({ recipient_id: ADDRESS, class: "MEMBER", capacity: "COMMITTEE_MEMBER" }),
      (e: unknown) => e instanceof RecipientResolutionError && e.code === "INVALID_RECIPIENT",
    );
    assert.throws(
      build({ recipient_id: F.IDS.MEMBER, class: "SUPERUSER", capacity: "COMMITTEE_MEMBER" }),
      (e: unknown) => (e as Caught).code === "INVALID_CLASS",
    );
    assert.throws(
      build({ recipient_id: F.IDS.MEMBER, class: "MEMBER" }),
      (e: unknown) => (e as Caught).code === "INVALID_CAPACITY",
    );
    const hostile: Record<string, unknown>[] = [
      {
        recipient_id: F.IDS.MEMBER,
        class: "MEMBER",
        capacity: "COMMITTEE_MEMBER",
        display_name: "Employee Alpha",
        mail: ADDRESS,
      },
    ];
    const res = createRecipientResolution({
      [key]: hostile,
    });
    const list = res.resolve({ type_code: "MEETING_INVITATION", object_id: F.IDS.MEETING });
    assert.deepEqual(Object.keys(list[0]!).sort(), ["capacity", "class", "recipient_id"]);
    assert.ok(!JSON.stringify(list).includes("example.test"));
    assert.throws(() => (list as unknown as unknown[]).push({ recipient_id: F.IDS.CHAIR }), TypeError);
    assert.deepEqual(res.resolve({ type_code: "MEETING_INVITATION", object_id: F.IDS.MEETING_2 }), []);
  });
});

describe("SEC-44 the consistency context cannot be supplied by the caller", () => {
  test("SEC-44 a statement carrying events, authority, recipient, case, object, log or state is refused and audited", () => {
    const w = F.createWorld();
    const r = w.lifecycle.draft(F.invitationDraft()).record;
    const forgedClosure = {
      event_id: "evt-forged-closure",
      type: "MEETING_CLOSED",
      occurred_at: "2026-10-26T10:00:00+03:00",
      case_id: F.IDS.CASE,
      object: { type: "MEETING", id: F.IDS.MEETING },
    };
    const injections = {
      events: [forgedClosure],
      authority: { result: "ALLOWED" },
      recipient: { id: F.IDS.CHAIR, class: "CHAIR" },
      lifecycle_status: "SENT",
      case: { ...F.CASE_RECORD, status: { code: "S5.01" } },
      procedural_object: { status: "CLOSED" },
      disclosure_log: {},
      trigger_event_id: "evt-forged-closure",
    };
    assert.ok(!STATEMENT_KEYS.some((k) => k in injections));
    for (const [field, value] of Object.entries(injections)) {
      const err = catchErr(() =>
        w.lifecycle.transition(r, "VALIDATED", {
          actor: SEC,
          model: modelFor(r),
          statement: { ...F.INVITATION_STATEMENT, [field]: value },
        }),
      );
      assert.equal(err.code, "STATEMENT_FIELD_NOT_ALLOWED", field);
      assert.deepEqual(err.details!.fields, [field]);
      assert.equal(lastDenial(w).type, "VALIDATION_REJECTED");
      assert.deepEqual(lastDenial(w).payload, {
        command: "notification_validate",
        outcome: "STATEMENT_FIELD_NOT_ALLOWED",
      });
    }
    assert.equal(w.lifecycle.get(r.notification_id)!.status, "DRAFT");
    assert.equal(w.evidence.summary(r.notification_id, 1).refusals.length, Object.keys(injections).length);
  });
  test("SEC-44 a forged basis event id is not found: the claim is blocked (PC-03 BASIS_EVENT_NOT_FOUND)", () => {
    const w = F.createWorld();
    const r = w.lifecycle.draft(F.invitationDraft()).record;
    const statement = {
      ...F.INVITATION_STATEMENT,
      claims: { meeting_completed: { value: true, basis_event_id: "evt-forged-closure" } },
    };
    const err = catchErr(() =>
      w.lifecycle.transition(r, "VALIDATED", { actor: SEC, model: modelFor(r), statement }),
    );
    assert.equal(err.code, "CONSISTENCY_BLOCKED");
    assert.deepEqual(
      err.details!.violations.map((v) => [v.id, v.detail.reason]),
      [["PC-03", "BASIS_EVENT_NOT_FOUND"]],
    );
    assert.deepEqual(lastDenial(w).payload, {
      command: "notification_validate",
      outcome: "CONSISTENCY_BLOCKED",
      rule_ids: "PC-03",
    });
  });
});

describe("SEC-45 sending and delivery cannot be asserted by a caller", () => {
  test("SEC-45 SENT before the outbox row was claimed is refused (NOT_CLAIMED) and audited", () => {
    const w = F.createWorld();
    const r = F.toQueued(w);
    assert.throws(() => w.lifecycle.transition(r, "SENT", { actor: SEC }), code("NOT_CLAIMED"));
    assert.deepEqual(lastDenial(w).payload, { command: "notification_send", outcome: "FORBIDDEN" });
    assert.equal(w.lifecycle.get(r.notification_id)!.status, "QUEUED");
    assert.equal(w.outbox.getRow(r.outbox!.row_id)!.status, "PENDING");
  });
  test("SEC-45 DELIVERY_* is refused unless the outbox row is settled that way (SETTLEMENT_NOT_RECORDED); under ACCEPTANCE a settled e-mail still needs a delivery report", () => {
    const { w, r } = drive("SENT", { lifecycle: { deliveryConfirmation: "SETTLEMENT" } }); // explicit (lead ruling L-07)
    assert.throws(
      () => w.lifecycle.transition(r, "DELIVERY_CONFIRMED", { actor: SEC }),
      code("SETTLEMENT_NOT_RECORDED"),
    );
    assert.throws(
      () => w.lifecycle.transition(r, "DELIVERY_FAILED", { actor: SEC }),
      code("SETTLEMENT_NOT_RECORDED"),
    );
    w.outbox.recordEmailDelivery(r.outbox!.row_id, true);
    assert.throws(
      () => w.lifecycle.transition(r, "DELIVERY_FAILED", {}),
      code("SETTLEMENT_NOT_RECORDED"),
      "a delivered row cannot be reported failed",
    );
    assert.equal(w.lifecycle.transition(r, "DELIVERY_CONFIRMED", {}).record.status, "DELIVERY_CONFIRMED");
    assert.equal(denials(w).filter((d) => d.payload.command === "notification_settle").length, 3);
    const a = drive("SENT"); // default ACCEPTANCE: the sender's success is acceptance, not delivery
    a.w.outbox.recordEmailDelivery(a.r.outbox!.row_id, true);
    assert.throws(
      () => a.w.lifecycle.transition(a.r, "DELIVERY_CONFIRMED", { actor: SEC }),
      code("DELIVERY_REPORT_REQUIRED"),
    );
    assert.deepEqual(lastDenial(a.w).payload, { command: "notification_settle", outcome: "FORBIDDEN" });
    assert.equal(a.w.lifecycle.get(a.r.notification_id)!.status, "SENT");
  });
});

// ============================================================================================ export validation ======
describe("SEC-46 a DRAFT export is labelled DRAFT and claims nothing", () => {
  test("SEC-46 DRAFT — NOT SENT in subject, text, HTML and headers; X-Unsent: 1; no Date, To or any address", () => {
    const { w, r } = drive("DRAFT");
    const out = w.lifecycle.exportEml(r, { rendered: F.renderedFor(), model: modelFor(r), actor: SEC });
    const { headerBlock, headers } = parseEml(out.eml);
    assert.equal(out.label.code, "DRAFT_NOT_SENT");
    assert.equal(headers.get("X-Unsent"), "1");
    assert.equal(headers.get("X-CDF-Export-Label"), "DRAFT_NOT_SENT");
    assert.equal(headers.get("X-CDF-Lifecycle-State"), "DRAFT");
    assert.ok(
      !/^(?:Date|To|Cc|Bcc|From|Reply-To|Sender):/im.test(headerBlock),
      "no send time and no addressee header",
    );
    assert.ok(!headers.has("X-CDF-Issued-At"), "never issued → no issue time");
    assert.ok(!out.eml.includes("@"), "no address anywhere in the file");
    const subject = decodeWords(headers.get("Subject")!);
    assert.ok(subject.startsWith("[DRAFT — NOT SENT | مسودة — لم تُرسل] "), subject);
    const p = parts(out.eml);
    assert.ok(p.text!.startsWith("مسودة — لم تُرسل | DRAFT — NOT SENT\r\n"));
    assert.match(p.html!, /<body>\s*<div role="note" data-export-label="DRAFT_NOT_SENT"/);
    for (const t of [subject, p.text, p.html]) {
      assert.ok(
        !/\b(?:sent|delivered|dispatched)\b/i.test(t!.replace(/NOT (?:YET )?SENT/g, "")),
        "no affirmative English sent claim",
      );
      assert.ok(!/تم\s+(?:إرسال|الإرسال|تسليم|التسليم)/u.test(t!), "no affirmative Arabic sent claim");
    }
    assert.equal(w.lifecycle.get(r.notification_id)!.status, "DRAFT");
  });
});

describe("SEC-47 an export never contradicts its label", () => {
  test("SEC-47 rendered text that claims sending is refused for every never-sent state (English and Arabic)", () => {
    const claims = [
      "This invitation has been sent to all members.",
      "The notice was delivered yesterday.",
      "تم إرسال هذه الدعوة إلى الأعضاء.",
      "أُرسلت إليك هذه الدعوة.",
    ];
    for (const status of NEVER_SENT_STATES) {
      const record = {
        notification_id: "ntf-synthetic",
        version: 1,
        status,
        type_code: "MEETING_INVITATION",
        recipient: { recipient_id: F.IDS.MEMBER, class: "MEMBER" },
      };
      for (const text of claims) {
        assert.throws(
          () =>
            buildExportEml({
              record,
              rendered: { subject: "Invitation", text },
              exportedAt: "2026-10-27T06:00:00.000Z",
            }),
          (e: unknown) => e instanceof ExportError && e.code === "SENT_CLAIM_IN_UNSENT_EXPORT",
          `${status}: ${text}`,
        );
      }
    }
  });
  test("SEC-47 through the lifecycle the refusal is audited and nothing is exported; a COPY of a sent version may say so", async () => {
    const { w, r } = drive("QUEUED");
    const claim = { ...F.renderedFor(), text: "This invitation has been sent." };
    const err = catchErr(() => w.lifecycle.exportEml(r, { rendered: claim, model: modelFor(r), actor: SEC }));
    assert.equal(err.code, "SENT_CLAIM_IN_UNSENT_EXPORT");
    assert.deepEqual(lastDenial(w).payload, {
      command: "notification_export",
      outcome: "SENT_CLAIM_IN_UNSENT_EXPORT",
    });
    assert.equal(w.ledger.list({ type: "NOTIFICATION_EXPORTED" }).length, 0);
    assert.equal(w.evidence.summary(r.notification_id, 1).exports.length, 0);
    await w.lifecycle.dispatchEmailBatch(10);
    const sent = w.lifecycle.get(r.notification_id)!;
    const out = w.lifecycle.exportEml(sent, { rendered: claim, model: modelFor(sent), actor: SEC });
    assert.equal(out.label.code, "COPY_NOT_DELIVERY_EVIDENCE");
    assert.equal(parseEml(out.eml).headers.get("X-Unsent"), "1", "a copy is still not the sent message");
    assert.ok(
      parts(out.eml).text!.startsWith("نسخة — ليست دليلاً على التسليم | COPY — NOT DELIVERY EVIDENCE"),
    );
  });
});

describe("SEC-48 header injection", () => {
  test("SEC-48 CR or LF in the subject is refused (HEADER_INJECTION) and audited; nothing is exported", () => {
    const { w, r } = drive("AUTHORIZED");
    for (const subject of [
      `Invitation\r\nBcc: ${ADDRESS}`,
      "Invitation\nX-Unsent: 0",
      "Invitation\rTo: someone",
    ]) {
      const err = catchErr(() =>
        w.lifecycle.exportEml(r, {
          rendered: { ...F.renderedFor(), subject },
          model: modelFor(r),
          actor: SEC,
        }),
      );
      assert.equal(err.code, "HEADER_INJECTION");
      assert.ok(!`${err.message}${JSON.stringify(err.details)}`.includes("example.test"));
      assert.deepEqual(lastDenial(w).payload, {
        command: "notification_export",
        outcome: "HEADER_INJECTION",
      });
    }
    assert.ok(!JSON.stringify(w.ledger.list()).includes("example.test"));
    assert.equal(w.ledger.list({ type: "NOTIFICATION_EXPORTED" }).length, 0);
  });
  test("SEC-48 non-ASCII subjects become RFC 2047 words of at most 75 characters; folding is the only line break", () => {
    const words = encodeHeaderWords(
      `[${EXPORT_LABELS.DRAFT.en} | ${EXPORT_LABELS.DRAFT.ar}] ${"دعوة اجتماع اللجنة ".repeat(6)}`,
    );
    for (const word of words.split("\r\n ")) {
      assert.match(word, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      assert.ok(word.length <= 75, `${word.length}`);
    }
    assert.ok(!/\r\n(?! )/.test(words) && !/\r(?!\n)/.test(words) && !/(?<!\r)\n/.test(words));
  });
});

describe("SEC-49 export is bound to the projected model of this version", () => {
  test("SEC-49 unprojected, foreign-recipient, foreign-class, foreign-policy and changed models are refused and audited", () => {
    const { w, r } = drive("VALIDATED");
    const tryExport = (model: unknown) =>
      catchErr(() => w.lifecycle.exportEml(r, { rendered: F.renderedFor(), model, actor: SEC })).code;
    assert.equal(
      tryExport({ fields: { meeting_info: "Committee meeting (synthetic)" } }),
      "MODEL_NOT_PROJECTED",
    );
    assert.equal(tryExport({ ...modelFor(r), _disclosure_applied: "true" }), "MODEL_NOT_PROJECTED");
    assert.equal(tryExport({ ...modelFor(r), _disclosure_log: null }), "MODEL_NOT_PROJECTED");
    assert.equal(tryExport(F.projectedModel({ recipient_id: F.IDS.MEMBER_2 })), "MODEL_RECIPIENT_MISMATCH");
    assert.equal(tryExport(F.projectedModel({ recipient_class: "CHAIR" })), "MODEL_RECIPIENT_CLASS_MISMATCH");
    assert.equal(
      tryExport(F.projectedModel({ policy_version: "DIS-POLICY-V13-OTHER" })),
      "POLICY_VERSION_MISMATCH",
    );
    assert.equal(
      tryExport(
        F.projectedModel({
          fields: { meeting_info: "Committee meeting (synthetic, edited)", deadline: null },
        }),
      ),
      "MODEL_CHANGED_SINCE_VALIDATION",
    );
    const rejected = denials(w).filter(
      (d) => d.type === "VALIDATION_REJECTED" && d.payload.command === "notification_export",
    );
    assert.equal(rejected.length, 7);
    assert.equal(w.ledger.list({ type: "NOTIFICATION_EXPORTED" }).length, 0);
    assert.equal(
      w.lifecycle.exportEml(r, { rendered: F.renderedFor(), model: modelFor(r), actor: SEC }).label.code,
      "DRAFT_NOT_SENT",
    );
  });
});

describe("SEC-50 the export label follows the lifecycle state", () => {
  test("SEC-50 every state maps to exactly one bilingual label; unknown and prototype keys are refused", () => {
    const expected = {
      DRAFT: "DRAFT_NOT_SENT",
      VALIDATED: "DRAFT_NOT_SENT",
      AUTHORIZATION_PENDING: "DRAFT_NOT_SENT",
      CORRECTED: "DRAFT_NOT_SENT",
      AUTHORIZED: "APPROVED_NOT_YET_SENT",
      QUEUED: "APPROVED_NOT_YET_SENT",
      SENT: "COPY_NOT_DELIVERY_EVIDENCE",
      DELIVERY_CONFIRMED: "COPY_NOT_DELIVERY_EVIDENCE",
      DELIVERY_FAILED: "COPY_NOT_DELIVERY_EVIDENCE",
      CANCELLED: "CANCELLED_DO_NOT_SEND",
      SUPERSEDED: "SUPERSEDED_DO_NOT_SEND",
    };
    assert.deepEqual(Object.keys(STATE_EXPORT_LABEL).sort(), Object.keys(expected).sort());
    for (const [state, c] of Object.entries(expected)) assert.equal(labelFor(state).code, c, state);
    for (const bad of ["sent", "ISSUED", "toString", "__proto__", "constructor", undefined, null]) {
      assert.throws(
        () => labelFor(bad),
        (e: unknown) => e instanceof ExportError && e.code === "UNKNOWN_STATE",
        String(bad),
      );
    }
    for (const l of Object.values(EXPORT_LABELS))
      assert.ok(/[؀-ۿ]/u.test(l.ar) && /^[A-Z —]+$/.test(l.en), l.code);
  });
  test("SEC-50 lifecycle exports carry the label of the version state; only versions that were sent carry an issue time", () => {
    for (const state of [
      "DRAFT",
      "VALIDATED",
      "AUTHORIZATION_PENDING",
      "AUTHORIZED",
      "QUEUED",
      "SENT",
      "DELIVERY_CONFIRMED",
      "DELIVERY_FAILED",
      "CANCELLED",
      "CORRECTED",
      "SUPERSEDED",
    ]) {
      const { w, r } = drive(state);
      const out = w.lifecycle.exportEml(r, { rendered: F.renderedFor(), model: modelFor(r), actor: SEC });
      const { headers } = parseEml(out.eml);
      assert.equal(out.label.code, labelFor(state).code, state);
      assert.equal(headers.get("X-Unsent"), "1", state);
      assert.equal(
        headers.has("X-CDF-Issued-At"),
        ["SENT", "DELIVERY_CONFIRMED", "DELIVERY_FAILED", "SUPERSEDED"].includes(state),
        state,
      );
      assert.equal(
        w.lifecycle.get(r.notification_id, r.version)!.status,
        state,
        "export never changes state",
      );
    }
  });
});

// ============================================================================================= storage controls ======
describe("SEC-51 restricted content is refused in demo browser storage", () => {
  test("SEC-51 RESTRICTED, INTERNAL, unclassified, identity keys and address values are refused; nothing is written", () => {
    const backend = createMemoryWebStorage();
    const s = createStorage({ mode: "DEMO_BROWSER_STORAGE", backend, clock: F.counterClock() });
    const refused = (fn: () => unknown, c: string) =>
      assert.throws(
        fn,
        (e: unknown) =>
          e instanceof StorageRefusedError &&
          e.code === c &&
          !e.message.includes("example.test") &&
          !e.message.includes("S3.01"),
        c,
      );
    refused(
      () => s.put("case-context", { stage: "S3.01" }, { classification: "RESTRICTED" }),
      "CLASSIFICATION_NOT_ALLOWED",
    );
    refused(
      () => s.put("case-context", { stage: "S3.01" }, { classification: "INTERNAL" }),
      "CLASSIFICATION_NOT_ALLOWED",
    );
    refused(() => s.put("case-context", { stage: "S3.01" }), "CLASSIFICATION_REQUIRED");
    refused(
      () => s.put("case-context", { stage: "S3.01" }, { classification: "public" }),
      "CLASSIFICATION_REQUIRED",
    );
    refused(
      () => s.put("prefs", { reporter_name: "Employee Alpha" }, { classification: "PUBLIC" }),
      "PERSONAL_DATA_NOT_ALLOWED",
    );
    refused(
      () => s.put("prefs", { nested: { recipient: F.IDS.MEMBER } }, { classification: "PUBLIC" }),
      "PERSONAL_DATA_NOT_ALLOWED",
    );
    refused(
      () => s.put("prefs", { note: `write to ${ADDRESS}` }, { classification: "PUBLIC" }),
      "PERSONAL_DATA_NOT_ALLOWED",
    );
    refused(() => s.put("prefs", [ADDRESS], { classification: "PUBLIC" }), "PERSONAL_DATA_NOT_ALLOWED");
    refused(() => s.put("Prefs", { density: "compact" }, { classification: "PUBLIC" }), "INVALID_KEY");
    refused(() => createStorage({ backend }), "MODE_REQUIRED");
    assert.equal(backend.length, 0, "nothing was written on any refusal");
    const ok = s.put("ui-density", { density: "compact" }, { classification: "PUBLIC" });
    assert.equal(ok.label, "DEMO_BROWSER_STORAGE");
    assert.equal(backend.length, 1);
    assert.equal((s.get("ui-density")!.value as { density?: unknown }).density, "compact");
  });
});

describe("SEC-52 demo storage expires, fails loudly, and the controlled store is a labelled mock", () => {
  test("SEC-52 demo entries expire (default 8 h) and are removed on read", () => {
    const clock = F.counterClock("2026-10-27T06:00:00.000Z", 1000);
    const backend = createMemoryWebStorage();
    const s = createStorage({ mode: "DEMO_BROWSER_STORAGE", backend, clock });
    assert.equal(
      s.put("ui-density", { density: "compact" }, { classification: "PUBLIC" }).expires_at,
      "2026-10-27T14:00:00.000Z",
    );
    clock.advance(8 * 3600 * 1000);
    assert.equal(s.get("ui-density"), null);
    assert.equal(backend.length, 0);
  });
  test("SEC-52 a failing backend is reported (BACKEND_ERROR), never swallowed, and the error carries no value", () => {
    const failing = {
      getItem: () => {
        throw new Error(`denied for ${ADDRESS}`);
      },
      setItem: () => {
        const e = new Error("quota");
        e.name = "QuotaExceededError";
        throw e;
      },
      removeItem: () => {},
      key: () => null,
      length: 0,
    };
    const s = createStorage({ mode: "DEMO_BROWSER_STORAGE", backend: failing, clock: F.counterClock() });
    const e1 = catchErr(() => s.put("ui-density", { density: "compact" }, { classification: "PUBLIC" }));
    assert.equal(e1.code, "BACKEND_ERROR");
    assert.ok(e1.message.includes("QuotaExceededError") && !e1.message.includes("compact"));
    const e2 = catchErr(() => s.get("ui-density"));
    assert.equal(e2.code, "BACKEND_ERROR");
    assert.ok(!e2.message.includes("example.test"));
  });
  test("SEC-52 CONTROLLED_STORE keeps the classification and is labelled PRODUCTION_SUBSTITUTION_REQUIRED", () => {
    const s = createStorage({ mode: "CONTROLLED_STORE", clock: F.counterClock() });
    const out = s.put("case-context", { stage: "S3.01" }, { classification: "RESTRICTED" });
    assert.match(out.label, /PRODUCTION_SUBSTITUTION_REQUIRED/);
    assert.equal(out.expires_at, null);
    assert.equal(s.kind, "controlled-store-mock");
    assert.equal(s.production_substitution_required, true);
    assert.equal(s.get("case-context")!.classification, "RESTRICTED");
    assert.throws(
      () => s.put("case-context", { stage: "S3.01" }),
      (e: unknown) => (e as Caught).code === "CLASSIFICATION_REQUIRED",
    );
  });
});

// ======================================================================================== the outbox and sender =====
describe("SEC-53 the outbox never stores content", () => {
  test("SEC-53 notify.outbox refuses any content field and names the field, never the value", () => {
    const outbox = createNotifyOutbox({ clock: F.counterClock(), ids: F.counterIds(), users: F.USERS });
    const base = {
      template_code: "MEETING_INVITATION",
      recipient_id: F.IDS.MEMBER,
      object_id: F.IDS.MEETING,
      channel: "EMAIL",
      dedupe: "v13:synthetic",
    };
    for (const extra of [
      "subject",
      "body",
      "html",
      "text",
      "case_number",
      "internal_ref",
      "recipient_email",
      "name",
      "payload",
    ]) {
      const err = catchErr(() => outbox.enqueue({ ...base, [extra]: `${F.INTERNAL_REF} ${ADDRESS}` }));
      assert.ok(err instanceof OutboxError && err.code === "CONTENT_NOT_ALLOWED", extra);
      assert.ok(!err.message.includes("example.test") && !err.message.includes(F.INTERNAL_REF));
    }
    assert.equal(outbox.rows().length, 0);
    assert.equal(outbox.enqueue(base).inserted, true);
  });
  test("SEC-53 a lifecycle row has exactly the 13 platform columns and no wording, case id or reference", async () => {
    const w = F.createWorld();
    const r = F.toQueued(w);
    await w.lifecycle.dispatchEmailBatch(10);
    const row = w.outbox.getRow(r.outbox!.row_id);
    assert.equal(OUTBOX_COLUMNS.length, 13);
    assert.deepEqual(Object.keys(row!).sort(), [...OUTBOX_COLUMNS].sort());
    assert.match(row!.dedupe_key, new RegExp(`^v13:[0-9a-f]{64}:${F.IDS.MEMBER}:EMAIL$`));
    assert.equal(row!.deep_link, `/meetings/${F.IDS.MEETING}`);
    const all = JSON.stringify(w.outbox.rows());
    for (const s of ["invited", "Meeting invitation", "SYNTHETIC DATA", F.IDS.CASE, F.INTERNAL_REF, "@"])
      assert.ok(!all.includes(s), s);
  });
  test("SEC-53 the sender receives exactly {id, recipientId, template, deepLink, attempts}; the stub refuses more", async () => {
    const w = F.createWorld();
    F.toQueued(w);
    F.toQueued(w, F.invitationDraft({ recipient_id: F.IDS.MEMBER_2 }));
    await w.lifecycle.dispatchEmailBatch(10);
    const calls = w.sender.calls();
    assert.equal(calls.length, 2);
    for (const c of calls)
      assert.deepEqual(Object.keys(c).sort(), ["attempts", "deepLink", "id", "recipientId", "template"]);
    const stub = createStubSender();
    await assert.rejects(
      stub.send({
        id: UNKNOWN_ROW,
        recipientId: F.IDS.MEMBER,
        template: "MEETING_INVITATION",
        deepLink: `/meetings/${F.IDS.MEETING}`,
        attempts: 1,
        subject: "Meeting",
      } as OutgoingNotification),
      TypeError,
    );
    assert.equal(stub.calls().length, 0);
  });
});

describe("SEC-54 outbox rows are immutable facts; reading is not acknowledging", () => {
  test("SEC-54 no update or delete, frozen copies, and a settled row cannot be settled again", async () => {
    const w = F.createWorld();
    const r = F.toQueued(w);
    assert.throws(
      () => w.outbox.update(r.outbox!.row_id, { status: "SENT" }),
      (e: unknown) => (e as Caught).code === "IMMUTABLE",
    );
    assert.throws(
      () => w.outbox.delete(r.outbox!.row_id),
      (e: unknown) => (e as Caught).code === "IMMUTABLE",
    );
    const copy = w.outbox.getRow(r.outbox!.row_id);
    assert.throws(() => {
      // @ts-expect-error -- writing to a frozen row copy on purpose (must throw)
      copy!.status = "SENT";
    }, TypeError);
    assert.equal(w.outbox.getRow(r.outbox!.row_id)!.status, "PENDING");
    await w.lifecycle.dispatchEmailBatch(10);
    assert.throws(
      () => w.outbox.recordEmailDelivery(r.outbox!.row_id, false),
      (e: unknown) => (e as Caught).code === "UNKNOWN_OR_SETTLED",
    );
    assert.throws(
      () => w.outbox.recordEmailDelivery(UNKNOWN_ROW, true),
      (e: unknown) => (e as Caught).code === "UNKNOWN_OR_SETTLED",
    );
  });
  test("SEC-54 marking read is the recipient’s own in-app row only (NOT_FOUND otherwise) and is not an acknowledgement", () => {
    const w = F.createWorld();
    const inApp = F.toQueued(w, F.invitationDraft({ channel: "IN_APP" }));
    const email = F.toQueued(w, F.invitationDraft({ recipient_id: F.IDS.MEMBER_2 }));
    for (const [id, who] of <[string, string][]>[
      [inApp.outbox!.row_id, F.IDS.MEMBER_2],
      [inApp.outbox!.row_id, F.IDS.SECRETARY],
      [email.outbox!.row_id, F.IDS.MEMBER_2],
      [UNKNOWN_ROW, F.IDS.MEMBER],
    ]) {
      assert.throws(
        () => w.outbox.markRead(id, who),
        (e: unknown) => e instanceof OutboxError && e.code === "NOT_FOUND",
      );
    }
    w.outbox.markRead(inApp.outbox!.row_id, F.IDS.MEMBER);
    assert.ok(w.outbox.getRow(inApp.outbox!.row_id)!.read_at);
    assert.equal(w.lifecycle.get(inApp.notification_id)!.status, "DELIVERY_CONFIRMED");
    assert.equal(w.ledger.list({ type: "RECIPIENT_ACKNOWLEDGED" }).length, 0, "read ≠ acknowledged");
  });
});

// ============================================================================================ audit and evidence =====
describe("SEC-55 the audit ledger holds codes and ids only and cannot be changed", () => {
  test("SEC-55 unsafe metadata keys (nested too) and values over 120 characters are refused", () => {
    const ledger = createAuditLedger({ clock: F.counterClock(), ids: F.counterIds() });
    const ev = (payload: Record<string, unknown>) => ({
      type: "NOTIFICATION_EXPORTED",
      object: { type: "NOTIFICATION", id: "ntf-synthetic" },
      payload,
    });
    for (const key of [
      "reporter_name",
      "email",
      "recipient_email",
      "phone",
      "password",
      "token",
      "identity",
      "description",
      "body",
      "content",
    ]) {
      assert.throws(
        () => ledger.append(ev({ [key]: "x" })),
        (e: unknown) => e instanceof AuditValidationError && e.code === "UNSAFE_METADATA_KEY",
        key,
      );
    }
    assert.throws(
      () => ledger.append(ev({ outer: { mail_body: "x" } })),
      (e: unknown) => (e as Caught).code === "UNSAFE_METADATA_KEY",
    );
    assert.throws(
      () => ledger.append(ev({ note: "x".repeat(121) })),
      (e: unknown) => (e as Caught).code === "METADATA_VALUE_TOO_LONG",
    );
    assert.equal(ledger.size(), 0);
  });
  test("SEC-55 append-only and hash-chained: update/delete/truncate throw; a tampered or shortened copy fails verification", () => {
    const { w } = drive("DELIVERY_CONFIRMED");
    for (const op of ["update", "delete", "truncate"] as const)
      assert.throws(
        () => w.ledger[op](),
        (e: unknown) => e instanceof AuditImmutableError && e.code === "APPEND_ONLY",
      );
    const entries = w.ledger.list();
    assert.throws(() => {
      // @ts-expect-error -- writing to a frozen ledger entry on purpose (must throw)
      entries[0]!.payload.to = "SENT";
    }, TypeError);
    assert.equal(w.ledger.verifyChain().ok, true);
    const tampered = entries.map((e) => ({ ...e }));
    tampered[2] = { ...tampered[2]!, payload: { ...tampered[2]!.payload, to: "DELIVERY_CONFIRMED" } };
    assert.deepEqual(verifyEntries(tampered), { ok: false, broken_seq: 3, reason: "EVENT_HASH_MISMATCH" });
    assert.equal(verifyEntries(entries.filter((_, i) => i !== 1)).reason, "PREVIOUS_HASH_MISMATCH");
    assert.ok(!JSON.stringify(entries).includes("@"));
  });
});

describe("SEC-56 acknowledgement is the recipient’s own act", () => {
  test("SEC-56 anyone else gets the same answer as for an unknown notification; nothing is recorded but the denial", () => {
    const { w, r } = drive("DELIVERY_CONFIRMED");
    const other = { capacity: "MEMBER", id: F.IDS.MEMBER_2 };
    const errs = [
      catchErr(() => w.lifecycle.acknowledge(r, { actor: { capacity: "CHAIR", id: F.IDS.CHAIR } })),
      catchErr(() => w.lifecycle.acknowledge(r, { actor: other })),
      catchErr(() => w.lifecycle.acknowledge({ ...r, revision: 99 }, { actor: other })),
      catchErr(() =>
        w.lifecycle.acknowledge(
          { notification_id: "ntf-unknown", version: 1, revision: 0 },
          { actor: other },
        ),
      ),
    ];
    assert.deepEqual(
      errs.map((e) => e.code),
      ["NOT_RECIPIENT", "NOT_RECIPIENT", "NOT_RECIPIENT", "NOT_RECIPIENT"],
    );
    const d = denials(w).filter((x) => x.payload.command === "notification_acknowledge");
    assert.equal(d.length, 4);
    assert.ok(d.every((x) => x.type === "COMMAND_DENIED" && x.payload.outcome === "NOT_FOUND"));
    assert.equal(w.ledger.list({ type: "RECIPIENT_ACKNOWLEDGED" }).length, 0);
    assert.equal(w.evidence.summary(r.notification_id, 1).acknowledgements.length, 0);
    const ok = w.lifecycle.acknowledge(r, { actor: { capacity: "CHAIR", id: F.IDS.MEMBER } });
    assert.deepEqual(
      ok.event.actor,
      { capacity: "COMMITTEE_MEMBER", id: F.IDS.MEMBER },
      "the claimed capacity is not trusted",
    );
    assert.equal(ok.record.status, "DELIVERY_CONFIRMED");
  });
});

describe("SEC-57 idempotency keys carry no personal data", () => {
  test("SEC-57 the key is 64 hex characters and refuses addresses, delimiters and whitespace in any component", () => {
    const base = {
      type_code: "MEETING_INVITATION",
      object_id: F.IDS.MEETING,
      recipient_id: F.IDS.MEMBER,
      version: 1,
      policy_version: F.POLICY_VERSION,
    };
    assert.match(idempotencyKey(base), /^[0-9a-f]{64}$/);
    assert.match(
      idempotencyKey({ ...base, channel: "EMAIL", occurrence_id: "evt-meeting-scheduled" }),
      /^[0-9a-f]{64}$/,
    );
    const cases: [string, unknown, string][] = [
      ["recipient_id", ADDRESS, "PERSONAL_DATA_IN_KEY"],
      ["recipient_id", "Employee Alpha", "PERSONAL_DATA_IN_KEY"],
      ["object_id", `${F.IDS.MEETING}|x`, "DELIMITER_IN_COMPONENT"],
      ["policy_version", "P1|ch:EMAIL", "DELIMITER_IN_COMPONENT"],
      ["channel", "EMAIL|occ:evt-x", "DELIMITER_IN_COMPONENT"],
      ["occurrence_id", "evt 1", "PERSONAL_DATA_IN_KEY"],
      ["occurrence_id", "evt\t1", "PERSONAL_DATA_IN_KEY"],
      ["version", 0, "INVALID_COMPONENT"],
      ["type_code", "meeting_invitation", "INVALID_COMPONENT"],
      ["recipient_id", "", "MISSING_COMPONENT"],
    ];
    for (const [k, v, c] of cases) {
      const err = catchErr(() => idempotencyKey({ ...base, [k]: v }));
      assert.ok(err instanceof IdempotencyError && err.code === c, `${k}: ${err.code}`);
      assert.ok(!err.message.includes("example.test") && !err.message.includes("Employee"));
    }
    assert.notEqual(
      idempotencyKey({ ...base, channel: "EMAIL" }),
      idempotencyKey({ ...base, occurrence_id: "EMAIL" }),
      "tags keep optional parts unambiguous",
    );
  });
});

describe("SEC-58 errors are generic codes", () => {
  test("SEC-58 refusal messages and details never echo input, content or identities", () => {
    const w = F.createWorld();
    const r = w.lifecycle.draft(F.invitationDraft()).record;
    const errors = [
      catchErr(() => w.lifecycle.draft(F.invitationDraft({ recipient_id: ADDRESS }))),
      catchErr(() => w.lifecycle.draft(F.invitationDraft({ case_id: F.INTERNAL_REF }))),
      catchErr(() =>
        w.lifecycle.transition(r, "VALIDATED", {
          actor: SEC,
          model: { reporter_name: "Employee Alpha" },
          statement: {},
        }),
      ),
      catchErr(() => w.lifecycle.transition(r, "SENT", { actor: SEC })),
      catchErr(() =>
        w.lifecycle.exportEml(r, {
          rendered: { subject: `x\r\nBcc: ${ADDRESS}`, text: "Employee Alpha" },
          model: modelFor(r),
          actor: SEC,
        }),
      ),
      catchErr(() =>
        buildExportEml({
          record: { ...r, status: "QUEUED" },
          rendered: { subject: "Employee Alpha", text: "Employee Alpha has been sent this." },
        }),
      ),
    ];
    for (const e of errors) {
      assert.match(e.message, /^notification (?:lifecycle|export refused): [A-Z][A-Z0-9_]+$/);
      const all = `${e.message} ${JSON.stringify(e.details ?? {})} ${e.stack.split("\n")[0]}`;
      for (const s of ["example.test", "Employee", F.INTERNAL_REF, "S3.01"])
        assert.ok(!all.includes(s), `${e.code} echoes ${s}`);
    }
  });
});

describe("SEC-59 unknown cases and display numbers resolve to nothing", () => {
  test("SEC-59 the case read model answers exists:false for unknown ids, display numbers and malformed input", () => {
    const cases = createCaseReadModel([F.CASE_RECORD]);
    assert.equal(cases.getCase(F.IDS.CASE).exists, true);
    assert.throws(() => {
      // @ts-expect-error -- writing to a frozen case view on purpose (must throw)
      cases.getCase(F.IDS.CASE).status.code = "S5.01";
    }, TypeError);
    for (const id of [
      F.IDS.CASE_UNKNOWN,
      F.INTERNAL_REF,
      "CDF-DEMO-2026-0001",
      F.IDS.CASE.toUpperCase(),
      ` ${F.IDS.CASE}`,
      "",
      null,
      undefined,
      42,
      { case_id: F.IDS.CASE },
    ]) {
      const c = cases.getCase(id);
      assert.equal(c.exists, false, String(id));
      assert.deepEqual(Object.keys(c).sort(), ["case_id", "exists"]);
    }
  });
  test("SEC-59 a notification cannot be drafted against an unknown case or a display number (NOT_FOUND, audited)", () => {
    const w = F.createWorld();
    assert.throws(
      () => w.lifecycle.draft(F.defenceNoticeDraft({ case_id: F.IDS.CASE_UNKNOWN })),
      code("CASE_NOT_FOUND"),
    );
    assert.deepEqual(lastDenial(w).payload, { command: "notification_draft", outcome: "NOT_FOUND" });
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ case_id: F.INTERNAL_REF })),
      code("INVALID_INPUT"),
    );
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ case_id: "CDF-DEMO-2026-0001" })),
      code("INVALID_INPUT"),
    );
    assert.equal(w.lifecycle.records().length, 0);
  });
});

describe("SEC-60 evidence holds references and hashes, never content", () => {
  test("SEC-60 content keys are refused at any depth and nothing is stored on refusal", () => {
    const ev = createEvidenceStore({ clock: F.counterClock(), ids: F.counterIds() });
    const entry = (data: Record<string, unknown>) => ({
      notification_id: "ntf-synthetic",
      version: 1,
      kind: "EXPORT" as const,
      data,
    });
    for (const key of [
      "subject",
      "body",
      "html",
      "text",
      "content",
      "narrative",
      "address",
      "recipient_email",
      "reporter_name",
      "email_address",
      "mail_body",
      "phone",
      "token",
    ]) {
      assert.throws(
        () => ev.append(entry({ [key]: "x" })),
        (e: unknown) => e instanceof EvidenceValidationError && e.code === "CONTENT_NOT_ALLOWED",
        key,
      );
    }
    assert.throws(
      () => ev.append(entry({ model: { rendered_subject: "x" } })),
      (e: unknown) => (e as Caught).code === "CONTENT_NOT_ALLOWED",
    );
    assert.equal(ev.size(), 0);
  });
  test("SEC-60 a full lifecycle with an export leaves ids, codes and hashes only — no wording, address or reference", async () => {
    const w = F.createWorld();
    const r = F.toQueued(w);
    await w.lifecycle.dispatchEmailBatch(10);
    w.lifecycle.exportEml(w.lifecycle.get(r.notification_id), {
      rendered: F.renderedFor(),
      model: modelFor(r),
      actor: SEC,
    });
    const all = JSON.stringify(w.evidence.list(r.notification_id));
    for (const s of ["invited", "Meeting invitation", "SYNTHETIC DATA", "@", F.INTERNAL_REF])
      assert.ok(!all.includes(s), s);
    assert.match(w.evidence.summary(r.notification_id, 1).model_hash!, /^[0-9a-f]{64}$/);
    assert.equal(w.evidence.summary(r.notification_id, 1).exports.length, 1);
  });
});

describe("SEC-61 deep links are ids only", () => {
  test("SEC-61 links are relative paths from the object id; non-uuid object ids are refused by the outbox and the lifecycle", () => {
    assert.equal(deepLink("MEETING", F.IDS.MEETING), `/meetings/${F.IDS.MEETING}`);
    assert.equal(deepLink("DEFENCE_NOTICE", F.IDS.DEFENCE_NOTICE), `/my-defence/${F.IDS.DEFENCE_NOTICE}`);
    assert.equal(
      deepLink("CASE", F.IDS.CASE),
      null,
      "no link for an object type notify.deep_link does not know (1920:202-215)",
    );
    const outbox = createNotifyOutbox({ clock: F.counterClock(), ids: F.counterIds(), users: F.USERS });
    const base = {
      template_code: "MEETING_INVITATION",
      recipient_id: F.IDS.MEMBER,
      channel: "IN_APP",
      dedupe: "v13:synthetic",
    };
    for (const object_id of [
      "CDF-DEMO-2026-0001",
      "../../admin",
      `${F.IDS.MEETING}?next=https://example.test`,
      "javascript:alert(1)",
      F.IDS.MEETING.toUpperCase(),
    ]) {
      assert.throws(
        () => outbox.enqueue({ ...base, object_id }),
        (e: unknown) => e instanceof OutboxError && e.code === "INVALID",
        object_id,
      );
    }
    assert.equal(outbox.rows().length, 0);
    const w = F.createWorld();
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ object: { type: "MEETING", id: "CDF-DEMO-2026-0001" } })),
      code("INVALID_INPUT"),
    );
    const r = F.toQueued(w, F.invitationDraft({ channel: "IN_APP" }));
    const link = w.outbox.getRow(r.outbox!.row_id)!.deep_link;
    assert.match(link, /^\/meetings\/[0-9a-f-]{36}$/);
    assert.equal(link.split("/").at(-1), F.IDS.MEETING);
  });
});

describe("SEC-62 HTML injection and unsafe URLs never reach an export", () => {
  test("SEC-62 an HTML part with active content or a javascript:/vbscript:/data: URL is refused", () => {
    const record = {
      notification_id: "ntf-synthetic",
      version: 1,
      status: "DELIVERY_CONFIRMED",
      type_code: "MEETING_INVITATION",
      recipient: { recipient_id: F.IDS.MEMBER, class: "MEMBER" },
    };
    const html = (body: string) =>
      `<!doctype html><html lang="en" dir="ltr"><head><title>t</title></head><body>${body}</body></html>`;
    const rendered = (body: string) => ({
      subject: "Invitation",
      text: "Invitation (synthetic)",
      html: html(body),
    });
    for (const body of [
      "<script>alert(1)</script>",
      '<p><a href="javascript:alert(1)">open</a></p>',
      "<p><a href='  JaVaScRiPt:alert(1)'>open</a></p>",
      '<p><a href="vbscript:msgbox(1)">open</a></p>',
      '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
      '<p onclick="steal()">x</p>',
      '<iframe src="https://example.test/"></iframe>',
      '<form action="https://example.test/collect"><input name="q"></form>',
      '<meta http-equiv="refresh" content="0;url=https://example.test/">',
    ]) {
      assert.throws(
        () => buildExportEml({ record, rendered: rendered(body) }),
        (e: unknown) => e instanceof ExportError && e.code === "ACTIVE_CONTENT_IN_EXPORT",
        body,
      );
    }
    const ok = buildExportEml({
      record,
      rendered: rendered(`<p>Option one = two; <a href="/meetings/${F.IDS.MEETING}">open</a></p>`),
    });
    assert.equal(ok.label.code, "COPY_NOT_DELIVERY_EVIDENCE");
  });
  test("SEC-62 through the lifecycle the refusal is audited (VALIDATION_REJECTED) and the record is unchanged", () => {
    const { w, r } = drive("AUTHORIZED");
    const err = catchErr(() =>
      w.lifecycle.exportEml(r, {
        rendered: { ...F.renderedFor(), html: "<html><body><script>x()</script></body></html>" },
        model: modelFor(r),
        actor: SEC,
      }),
    );
    assert.equal(err.code, "ACTIVE_CONTENT_IN_EXPORT");
    assert.deepEqual(lastDenial(w).payload, {
      command: "notification_export",
      outcome: "ACTIVE_CONTENT_IN_EXPORT",
    });
    assert.equal(w.lifecycle.get(r.notification_id)!.revision, r.revision);
  });
});

describe("SEC-63 the case is read from the procedural object, not chosen by the caller", () => {
  test("SEC-63 a different case id is refused (NOT_FOUND), an object type mismatch is refused, an omitted case is filled in", () => {
    const other = { ...F.CASE_RECORD, case_id: OTHER_CASE };
    const w = F.createWorld({ cases: [F.CASE_RECORD, other] });
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ case_id: OTHER_CASE })),
      code("CASE_OBJECT_MISMATCH"),
    );
    assert.deepEqual(lastDenial(w).payload, { command: "notification_draft", outcome: "NOT_FOUND" });
    assert.throws(
      () => w.lifecycle.draft(F.invitationDraft({ object: { type: "DECISION", id: F.IDS.MEETING } })),
      code("OBJECT_TYPE_MISMATCH"),
    );
    assert.equal(w.lifecycle.records().length, 0);
    const r = w.lifecycle.draft(F.invitationDraft({ case_id: null })).record;
    assert.equal(r.case_id, F.IDS.CASE);
  });
});

describe("SEC-64 the correction lineage cannot be steered by a caller (lead ruling L-04)", () => {
  test("SEC-64 SUPERSEDED cannot be requested; forged snapshot fields cannot redirect a correction; a second correction and a stale snapshot are refused", async () => {
    const { w, r } = drive("DELIVERY_CONFIRMED");
    const lc = w.lifecycle;
    assert.throws(
      () => lc.transition(r, "SUPERSEDED", { actor: SEC, reason_code: "FORGED" }),
      code("SUPERSEDED_ONLY_BY_CORRECTION"),
    );
    // a snapshot is a key and a revision: forged state, lineage links and version owner are ignored
    const forged = {
      ...r,
      status: "SUPERSEDED",
      corrects: { notification_id: "ntf-forged", version: 7, reason_code: "FORGED" },
      superseded_by: 9,
    };
    const c = lc.transition(forged, "CORRECTED", { actor: SEC, reason_code: "WRONG_TIME" });
    assert.deepEqual(c.record.corrects, {
      notification_id: r.notification_id,
      version: 1,
      reason_code: "WRONG_TIME",
    });
    assert.deepEqual([c.predecessor!.status, c.predecessor!.superseded_by], ["DELIVERY_CONFIRMED", null]);
    assert.throws(
      () => lc.transition(lc.get(r.notification_id, 1), "CORRECTED", { actor: SEC, reason_code: "AGAIN" }),
      code("CORRECTION_IN_PROGRESS"),
    );
    assert.equal(lc.versions(r.notification_id).length, 2);
    let v2 = lc.transition(c.record, "VALIDATED", {
      actor: SEC,
      model: modelFor(c.record),
      statement: F.INVITATION_STATEMENT,
    }).record;
    v2 = lc.transition(v2, "AUTHORIZED", { actor: SEC }).record;
    lc.transition(v2, "QUEUED", { actor: SEC });
    await lc.dispatchEmailBatch(10);
    assert.equal(lc.get(r.notification_id, 1)!.status, "SUPERSEDED");
    assert.throws(
      () => lc.transition(r, "CORRECTED", { actor: SEC, reason_code: "STALE" }),
      code("STALE_RECORD"),
    );
    assert.throws(
      () => lc.transition(lc.get(r.notification_id, 1), "CORRECTED", { actor: SEC, reason_code: "AGAIN" }),
      code("INVALID_TRANSITION"),
    );
    assert.equal(lc.lineage(r.notification_id)!.current_version, 2);
  });
});
