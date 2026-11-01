/**
 * SEC-APP-23 — export isolation (REQ-SEC-020, "export" clause; V13-SEC-013).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Synthetic scenarios, ids and placeholders only.
 *
 * The export path end to end, with the real projection, the real renderer and the lifecycle's default projection port
 * (not the fixture stand-ins): a model built for the recipient → projectForRecipient() from server records →
 * renderEmail() → lifecycle exportEml(). What it pins (decided behaviour only):
 *   a. the exported bytes carry no value the projection withheld and no internal disclosure marker; no address, no
 *      addressee or send-time header, X-Unsent: 1 and the lifecycle label;
 *   b. a model projected for another case is refused before any bytes, with a SECURITY denial and no export event or
 *      evidence (the model hash fixed at VALIDATED binds the export to the validated model);
 *   c. a hand-made model that only claims `_disclosure_applied` is refused (default projection port);
 *   d. an unknown notification, a stale snapshot and an unknown version are refused and leave no export event;
 *   e. a restricted case whose recipient is not on the access list renders nothing, so nothing can be exported;
 *   f. bidi overrides, isolates and zero-width characters in model values never reach the exported bytes.
 * No route exports today (lib/notifications only); an export route must add the case/persona pre-check of lib/authz.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import * as F from "@/tests/unit/notifications/support/fixtures";
import { inlineScenarios } from "@/tests/unit/notifications/support/scenarios_inline";
import { buildNotificationModel } from "@/lib/notifications/render/model";
import { renderEmail } from "@/lib/notifications/render/email";
import {
  projectForRecipient,
  type ServerProjectionRecords,
} from "@/lib/notifications/binding/server-projection";
import { LifecycleError } from "@/lib/notifications/lifecycle/notification";
import type { Scenario } from "@/lib/notifications/render/types";

const CASE_A = "00000000-0000-4000-8000-00000000a001";
const SEC = F.SECRETARY_ACTOR;
const SCENARIOS = inlineScenarios();
const BIDI = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;

const scenario = (id: string): Scenario => {
  const s = SCENARIOS.find((x) => x.id === id);
  assert.ok(s, `inline scenario ${id}`);
  return s;
};
const recordsFor = (cls: string, restricted = false, onList?: boolean): ServerProjectionRecords => ({
  case_record: { id: CASE_A, is_restricted: restricted },
  recipient_row: { case_id: CASE_A, recipient_class: cls },
  ...(onList === undefined ? {} : { access_list: { case_id: CASE_A, on_access_list: onList } }),
});
type Model = ReturnType<typeof buildNotificationModel>;
const modelOf = (id: string, cls: string, extra: Record<string, unknown> = {}): Model => {
  const s = scenario(id);
  const r = s.recipients.find((x) => x.class === cls);
  assert.ok(r, `${id} has a ${cls} recipient`);
  return buildNotificationModel(s, { ...r, ...extra });
};
/** Synthetic recipient address handed to the model builder (CLAUDE.md §1: @example.test only); never exported. */
const RECIPIENT_ADDRESS = "employee.alpha@example.test";
/** The one address the export may carry: the committed secretariat help mailbox (lib/i18n/notificationRender). */
const HELP_MAILBOX = "secretariat.demo@example.test";
const project = (model: unknown, cls = "MEMBER") => projectForRecipient(model, recordsFor(cls));

// ------------------------------------------------------------------------------------------ EML reading (tests only) --
const td = new TextDecoder();
const b64decode = (b64: string) =>
  td.decode(Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));
const decodeWords = (v: string) =>
  v.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=\s*/g, (_: string, b: string) => b64decode(b));
/** Everything a reader of the file sees: unfolded headers (encoded words decoded) and every decoded body part. */
function readable(eml: string): { headerBlock: string; all: string } {
  const split = eml.indexOf("\r\n\r\n");
  const headerBlock = decodeWords(eml.slice(0, split).replace(/\r\n[ \t]/g, " "));
  const bodies = [...eml.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map(
    (m) => b64decode(m[1]!),
  );
  assert.ok(bodies.length >= 1, "at least one body part");
  return { headerBlock, all: [headerBlock, ...bodies].join("\n") };
}

/** The statement the record is validated against: it shows only a field every projection here allows. */
const STATEMENT = Object.freeze({
  claims: {},
  fields_shown: [{ field: "event_title", form: "RAW" }],
  informational: false,
  required_action: { kind: "READ_ONLY" },
});

/** A lifecycle world on the default projection port, with the record bound to the projection's policy version. */
function queuedWith(projected: ReturnType<typeof project>) {
  const w = F.createWorld({ lifecycle: { projection: null } });
  const draft = F.invitationDraft({ policy_version: projected._disclosure_summary.policy_version });
  const r = F.toQueued(w, draft, { model: projected, statement: STATEMENT });
  return { w, r };
}
const exportEvents = (w: F.World) => w.ledger.list({}).filter((e) => e.type === "NOTIFICATION_EXPORTED");
const exportEvidence = (w: F.World, id: string) => w.evidence.list(id).filter((e) => e.kind === "EXPORT");
function refusal(fn: () => unknown): LifecycleError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof LifecycleError, `a LifecycleError, got ${String(err)}`);
    return err;
  }
  return assert.fail("expected a refusal");
}

// CF-31: a recommendations package on an unrestricted case; the MEMBER projection withholds investigation details,
// decision reasons, member names, audit refs (PROHIBITED) and the internal ref, evidence refs, subject detail (REDACTED).
const MODEL = modelOf("CF-31", "MEMBER");
const PROJECTED = project(MODEL);
const WITHHELD = Object.entries(PROJECTED._disclosure_log)
  .filter(([, l]) => l.outcome === "PROHIBITED" || l.outcome === "REDACTED")
  .map(([f]) => f);

describe("SEC-APP-23 export isolation (REQ-SEC-020)", () => {
  test("SEC-APP-23a the exported bytes carry no withheld value, no disclosure marker, no address; X-Unsent and the label", () => {
    assert.ok(
      WITHHELD.includes("investigation_details") && WITHHELD.includes("internal_ref"),
      "fixture withholds",
    );
    // every string leaf of every withheld field becomes a unique canary, structure kept (a generic word such as
    // "design preview" may also be static renderer text, so the real values are not a reliable probe)
    let n = 0;
    const canaries: string[] = [];
    const canary = (v: unknown, field: string): unknown => {
      if (typeof v === "string") {
        const c = `CANARY${field.replace(/_/g, "").toUpperCase()}${(n += 1)}`;
        canaries.push(c);
        return c;
      }
      if (Array.isArray(v)) return v.map((x) => canary(x, field));
      if (v && typeof v === "object")
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canary(x, field)]));
      return v;
    };
    const base = modelOf("CF-31", "MEMBER", { email: RECIPIENT_ADDRESS });
    const f = base.fields as Record<string, unknown>;
    const fields = Object.fromEntries(
      Object.entries(f).map(([k, v]) => [k, WITHHELD.includes(k) ? canary(v, k) : v]),
    );
    assert.ok(canaries.length >= 5, `canaries planted (${canaries.length})`);
    // the builder is handed the recipient's address and keeps only the opaque reference
    assert.ok(
      !JSON.stringify(base).includes(RECIPIENT_ADDRESS),
      "the recipient address never enters the model",
    );
    const projected = project({ ...base, fields });
    assert.deepEqual(
      Object.entries(projected._disclosure_log)
        .filter(([, l]) => l.outcome === "PROHIBITED" || l.outcome === "REDACTED")
        .map(([k]) => k),
      WITHHELD,
      "the canaries do not change what the projection withholds",
    );
    for (const lang of ["en", "ar"] as const) {
      const { w, r } = queuedWith(projected);
      const out = w.lifecycle.exportEml(r, {
        rendered: renderEmail(projected, { lang }),
        model: projected,
        actor: SEC,
      });
      const { headerBlock, all } = readable(out.eml);
      assert.ok(
        !/CANARY/.test(all) && !out.eml.includes("CANARY"),
        `${lang}: a withheld value reached the export`,
      );
      assert.ok(
        !/_withheld\b|_disclosure|\bPROHIBITED\b/.test(all),
        `${lang}: an internal disclosure marker`,
      );
      assert.ok(
        !all.includes(RECIPIENT_ADDRESS) && !all.includes("employee.alpha"),
        `${lang}: the recipient's address`,
      );
      assert.equal(
        (all.match(/@/g) ?? []).length,
        [...all.matchAll(new RegExp(HELP_MAILBOX.replace(/\./g, "\\."), "g"))].length,
        `${lang}: an address other than the help mailbox`,
      );
      assert.ok(
        !/^(?:To|Cc|Bcc|From|Reply-To|Sender|Date|Message-ID):/im.test(headerBlock),
        `${lang}: an addressee or send header`,
      );
      assert.match(headerBlock, /^X-Unsent: 1$/m);
      assert.match(headerBlock, /^X-CDF-Export-Label: APPROVED_NOT_YET_SENT$/m);
      assert.equal(exportEvents(w).length, 1);
      assert.equal(exportEvidence(w, r.notification_id).length, 1, "the probe sees an EXPORT evidence entry");
    }
  });

  test("SEC-APP-23b a model projected for another case is refused before any bytes; SECURITY denial, no export", () => {
    const { w, r } = queuedWith(PROJECTED);
    // CF-35: another case's notification to a committee member — same recipient class, same policy
    const other = project(modelOf("CF-35", "MEMBER"));
    assert.equal(other._disclosure_summary.policy_version, PROJECTED._disclosure_summary.policy_version);
    const before = w.ledger.list({ category: "SECURITY" }).length;
    const err = refusal(() =>
      w.lifecycle.exportEml(r, { rendered: renderEmail(other, { lang: "en" }), model: other, actor: SEC }),
    );
    assert.equal(err.code, "MODEL_CHANGED_SINCE_VALIDATION");
    assert.ok(!/CDF-DEMO|NTF-DEMO/.test(err.message), "the refusal echoes no case content");
    assert.equal(w.ledger.list({ category: "SECURITY" }).length, before + 1, "one SECURITY denial");
    assert.equal(exportEvents(w).length, 0);
    assert.equal(exportEvidence(w, r.notification_id).length, 0);
  });

  test("SEC-APP-23c a hand-made model that only claims the projection is refused on the default port", () => {
    const { w, r } = queuedWith(PROJECTED);
    const forged = {
      ...PROJECTED,
      _disclosure_applied: true,
      _disclosure_log: { ...PROJECTED._disclosure_log },
    };
    const err = refusal(() =>
      w.lifecycle.exportEml(r, {
        rendered: renderEmail(PROJECTED, { lang: "en" }),
        model: forged,
        actor: SEC,
      }),
    );
    assert.equal(err.code, "MODEL_NOT_PROJECTED");
    assert.equal(exportEvents(w).length, 0);
  });

  test("SEC-APP-23d an unknown notification, a stale snapshot and an unknown version are refused; no export event", () => {
    const { w, r } = queuedWith(PROJECTED);
    const rendered = renderEmail(PROJECTED, { lang: "en" });
    const tries: [string, typeof r][] = [
      ["UNKNOWN_NOTIFICATION", { ...r, notification_id: "10000000-0000-4000-8000-ffffffffffff" }],
      ["UNKNOWN_NOTIFICATION", { ...r, version: r.version + 1 }],
      ["STALE_RECORD", { ...r, revision: r.revision - 1 }],
    ];
    for (const [code, rec] of tries) {
      const err = refusal(() => w.lifecycle.exportEml(rec, { rendered, model: PROJECTED, actor: SEC }));
      assert.equal(err.code, code);
    }
    assert.equal(exportEvents(w).length, 0);
  });

  test("SEC-APP-23e a restricted case whose recipient is not on the access list renders nothing to export", () => {
    const model = modelOf("CF-31R", "MEMBER");
    const notListed = projectForRecipient(model, recordsFor("MEMBER", true, false));
    assert.equal(notListed._disclosure_summary.suppressed, true);
    assert.throws(
      () => renderEmail(notListed, { lang: "en" }),
      (e: unknown) => {
        return (e as { code?: unknown }).code === "NOTIFICATION_SUPPRESSED";
      },
    );
  });

  test("SEC-APP-23f bidi overrides, isolates and zero-width characters in model values never reach the export", () => {
    const hostile = "\u202Egnp.exe\u202C \u2066x\u2069 \u200Bsynthetic\uFEFF";
    const f = MODEL.fields as Record<string, unknown>;
    const fields = {
      ...f,
      event_title: { ar: `عنوان ${hostile}`, en: `Title ${hostile}` },
      event_summary: { ar: `ملخص ${hostile}`, en: `Summary ${hostile}` },
    };
    const projected = project({ ...MODEL, fields });
    for (const lang of ["en", "ar"] as const) {
      const rendered = renderEmail(projected, { lang });
      assert.ok(rendered.text.includes("gnp.exe"), "the value itself is still shown");
      const { w, r } = queuedWith(projected);
      const out = w.lifecycle.exportEml(r, { rendered, model: projected, actor: SEC });
      assert.ok(
        !BIDI.test(readable(out.eml).all),
        `${lang}: a bidi or zero-width character reached the export`,
      );
    }
  });
});
