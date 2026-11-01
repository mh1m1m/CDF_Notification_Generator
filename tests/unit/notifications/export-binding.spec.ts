/**
 * EXB — the export is bound to the validated model (V13-PROC-022; OI-053; REQ-SEC-020 export, REQ-CASE-014).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Synthetic scenarios and ids only; every hostile character
 * is built at run time (none is written literally in this file).
 *
 * Finding 1 (SEC, #108): exportEml checked the model against the record (model hash) but took the caller's rendering as
 * given, so a rendering of another notification exported under this record's label and model hash. The lifecycle now
 * accepts a rendering only when W-D2's renderer made it from the very model being exported and it is unchanged since
 * (RENDERER_PROVENANCE_PORT, lib/notifications/render/provenance.ts).
 * Finding 2: buildExportEml now strips controls, bidi characters and zero-width characters from what it is handed.
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
import { LifecycleError, RENDERER_PROVENANCE_PORT } from "@/lib/notifications/lifecycle/notification";
import { buildExportEml } from "@/lib/notifications/lifecycle/export";
import type { Scenario } from "@/lib/notifications/render/types";

const CASE_A = "00000000-0000-4000-8000-00000000a001";
const CASE_B = "00000000-0000-4000-8000-00000000b001";
const SEC = F.SECRETARY_ACTOR;
const SCENARIOS = inlineScenarios();
const U = (...c: number[]): string => String.fromCharCode(...c);
const INVISIBLE = [
  0, 1, 7, 0x0b, 0x1b, 0x7f, 0x85, 0x9b, 0x200b, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069, 0x2028, 0x2029, 0xfeff,
];
const INVISIBLE_RE = new RegExp("[" + INVISIBLE.map((c) => U(c)).join("") + "]");

const scenario = (id: string): Scenario => {
  const s = SCENARIOS.find((x) => x.id === id);
  assert.ok(s, id);
  return s;
};
const records = (caseId: string): ServerProjectionRecords => ({
  case_record: { id: caseId, is_restricted: false },
  recipient_row: { case_id: caseId, recipient_class: "MEMBER" },
});
const projectedOf = (id: string, caseId: string) => {
  const s = scenario(id);
  const r = s.recipients.find((x) => x.class === "MEMBER");
  assert.ok(r, `${id} MEMBER`);
  return projectForRecipient(buildNotificationModel(s, r), records(caseId));
};
type Projected = ReturnType<typeof projectedOf>;
const STATEMENT = Object.freeze({
  claims: {},
  fields_shown: [{ field: "event_title", form: "RAW" }],
  informational: false,
  required_action: { kind: "READ_ONLY" },
});
/** a lifecycle on the default projection and rendering ports (no fixture stand-ins), the record validated with `p` */
function queuedWith(
  p: Projected,
  lifecycle: Record<string, unknown> = { projection: null, rendering: null },
) {
  const w = F.createWorld({ lifecycle });
  const draft = F.invitationDraft({ policy_version: p._disclosure_summary.policy_version });
  const r = F.toQueued(w, draft, { model: p, statement: STATEMENT });
  return { w, r };
}
const exportEvents = (w: F.World) => w.ledger.list({}).filter((e) => e.type === "NOTIFICATION_EXPORTED");
const exportEvidence = (w: F.World, id: string) => w.evidence.list(id).filter((e) => e.kind === "EXPORT");
const security = (w: F.World) => w.ledger.list({ category: "SECURITY" }).length;
function refusal(fn: () => unknown): LifecycleError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof LifecycleError, `a LifecycleError, got ${String(err)}`);
    return err;
  }
  return assert.fail("expected a refusal");
}
const td = new TextDecoder();
const b64 = (s: string) => td.decode(Uint8Array.from(atob(s.replace(/\s+/g, "")), (c) => c.charCodeAt(0)));
/** unfolded, decoded headers and every decoded body part */
function readable(eml: string): string {
  const split = eml.indexOf("\r\n\r\n");
  const head = eml
    .slice(0, split)
    .replace(/\r\n[ \t]/g, " ")
    .replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=\s*/g, (_: string, b: string) => b64(b));
  const bodies = [...eml.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map(
    (m) => b64(m[1]!),
  );
  assert.ok(bodies.length >= 1);
  return [head, ...bodies].join("\n");
}

const OWN = projectedOf("CF-31", CASE_A);
const OTHER = projectedOf("CF-35", CASE_B);
const titleOf = (p: Projected) => (p.fields.event_title as { en: string }).en;

/** the validated model's own rendering whose subject answers the check with its own value and any later read with
 *  another case's subject (time of check vs time of use) */
function getterRendering(): unknown {
  const r = renderEmail(OWN, { lang: "en" });
  const real = r.subject;
  const foreign = renderEmail(OTHER, { lang: "en" }).subject;
  let reads = 0;
  Object.defineProperty(r, "subject", { get: () => (reads++ === 0 ? real : foreign), configurable: true });
  return r;
}

describe("EXB the export takes only a rendering of the model it validated (OI-053)", () => {
  test("EXB-01 control: the validated model's own rendering exports, in Arabic and English", () => {
    for (const lang of ["en", "ar"] as const) {
      const { w, r } = queuedWith(OWN);
      const out = w.lifecycle.exportEml(r, { rendered: renderEmail(OWN, { lang }), model: OWN, actor: SEC });
      assert.ok(out.eml.length > 0);
      assert.equal(exportEvents(w).length, 1);
      assert.equal(exportEvidence(w, r.notification_id).length, 1);
    }
  });

  test("EXB-02 another case's rendering with the validated model is refused before any bytes (PROC's swap probe, SEC's finding 1)", () => {
    assert.notEqual(titleOf(OTHER), titleOf(OWN), "the two notifications differ");
    const { w, r } = queuedWith(OWN);
    const before = security(w);
    const err = refusal(() =>
      w.lifecycle.exportEml(r, { rendered: renderEmail(OTHER, { lang: "en" }), model: OWN, actor: SEC }),
    );
    assert.equal(err.code, "RENDERING_NOT_FROM_MODEL");
    assert.ok(!err.message.includes(titleOf(OTHER)) && !/CDF-DEMO/.test(err.message), "no content echoed");
    assert.equal(security(w), before + 1, "one SECURITY denial");
    assert.equal(exportEvents(w).length, 0);
    assert.equal(exportEvidence(w, r.notification_id).length, 0);
  });

  test("EXB-03 an edited rendering, a copy, a hand-made rendering, a rendering of an equal re-projection and a getter that answers twice are refused", () => {
    const own = renderEmail(OWN, { lang: "en" });
    const reprojected = projectedOf("CF-31", CASE_A); // equal content, another projection object
    const edited = renderEmail(OWN, { lang: "en" });
    (edited as { text: string }).text = renderEmail(OTHER, { lang: "en" }).text;
    const tries: [string, unknown][] = [
      ["edited text", edited],
      ["copy", { ...own }],
      ["hand-made", { subject: own.subject, text: own.text, html: own.html }],
      ["re-projection", renderEmail(reprojected, { lang: "en" })],
      ["getter (SEC's probe on #113)", getterRendering()],
    ];
    for (const [name, rendered] of tries) {
      const { w, r } = queuedWith(OWN);
      const err = refusal(() =>
        w.lifecycle.exportEml(r, { rendered: rendered as never, model: OWN, actor: SEC }),
      );
      assert.equal(err.code, "RENDERING_NOT_FROM_MODEL", name);
      assert.equal(exportEvents(w).length, 0, name);
    }
  });

  test("EXB-04 the default rendering port is the renderer's provenance, never 'accept'; the fixture port keeps it for real models", () => {
    const own = renderEmail(OWN, { lang: "en" });
    const other = renderEmail(OTHER, { lang: "en" });
    const snap = (x: { subject: string; text: string; html: string }) => ({
      subject: x.subject,
      text: x.text,
      html: x.html,
    });
    assert.equal(RENDERER_PROVENANCE_PORT.isRenderingOf(own, OWN, snap(own)), true);
    assert.equal(RENDERER_PROVENANCE_PORT.isRenderingOf(other, OWN, snap(other)), false);
    assert.equal(F.FIXTURE_RENDERING_PORT.isRenderingOf(other, OWN, snap(other)), false);
    // the digest is checked on the snapshot the export will use, not on a second read of the object
    assert.equal(
      RENDERER_PROVENANCE_PORT.isRenderingOf(own, OWN, { ...snap(own), subject: other.subject }),
      false,
    );
    // the fixture world (FIXTURE_RENDERING_PORT) on the real projection port refuses the swap too
    const { w, r } = queuedWith(OWN, { projection: null });
    const err = refusal(() =>
      w.lifecycle.exportEml(r, { rendered: renderEmail(OTHER, { lang: "en" }), model: OWN, actor: SEC }),
    );
    assert.equal(err.code, "RENDERING_NOT_FROM_MODEL");
  });
});

describe("EXB the export builder strips what the renderer strips (SEC finding 2)", () => {
  const record = {
    notification_id: "10000000-0000-4000-8000-000000000001",
    version: 1,
    status: "AUTHORIZED",
    type_code: "MEETING_INVITATION",
    recipient: { recipient_id: "20000000-0000-4000-8000-000000000001", class: "MEMBER" },
  };
  const evil = INVISIBLE.map((c) => `x${U(c)}y`).join(" ") + " gnp" + U(0x202e) + "exe.pdf";

  test("EXB-05 controls, bidi characters and zero-width characters in a supplied subject, text or HTML never reach the EML", () => {
    const out = buildExportEml({
      record,
      rendered: {
        subject: `Subject ${evil}`,
        text: `Text ${evil}\nsecond line`,
        html: `<!doctype html><html><body><p>Html ${evil}</p></body></html>`,
      },
      exportedAt: "2026-11-01T03:00:00Z",
    });
    const all = readable(out.eml);
    assert.doesNotMatch(all, INVISIBLE_RE);
    assert.doesNotMatch(out.eml, INVISIBLE_RE);
    for (const part of ["Subject", "Text", "Html"]) assert.ok(all.includes(`${part} xy xy`), part);
    assert.ok(all.includes("gnpexe.pdf") && all.includes("second line"));
  });

  test("EXB-06 header injection in the subject is still refused before stripping; clean input is unchanged", () => {
    assert.throws(
      () => buildExportEml({ record, rendered: { subject: "a\r\nBcc: x@example.test", text: "t" } }),
      (e: unknown) => (e as { code?: unknown }).code === "HEADER_INJECTION",
    );
    const a = buildExportEml({ record, rendered: { subject: "Plain", text: "Body" }, exportedAt: "x" });
    const b = buildExportEml({
      record,
      rendered: { subject: "Pla" + U(0x200b) + "in", text: "Bo" + U(0x202e) + "dy" },
      exportedAt: "x",
    });
    assert.equal(a.eml, b.eml, "the stripped input exports the same bytes as the clean one");
  });
});
