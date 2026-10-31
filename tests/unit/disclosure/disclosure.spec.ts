/**
 * DIS — disclosure projection (W-D2, charter §5, §12). SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Ported from tests/disclosure.test.js (node:test → Vitest).
 * Policy under test: W-F's lib/disclosure/policy_v13.json (PROPOSED). No provisional policy is in the code path.
 *
 * PROC-003 carries the tests that need only lib/disclosure: DIS-02, DIS-03, DIS-04, DIS-06 and DIS-18. The other
 * thirteen (DIS-01, DIS-05, DIS-07, DIS-08, DIS-09, DIS-10, DIS-11, DIS-12, DIS-13, DIS-14, DIS-15, DIS-16, DIS-17) build their inputs with the notification renderers and the inline scenarios, so they land unchanged
 * in tests/unit/disclosure/disclosure-render.spec.ts with PROC-005 (ARCH, 31 Oct 2026). No test is dropped.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import * as D from "@/lib/disclosure";
import RAW_JSON from "@/lib/disclosure/policy_v13.json";

interface RawPolicy {
  version: string;
  status: string;
  scenarios: Array<{
    id: string;
    recipient: string;
    channels: string[];
    context: unknown;
    expect: Record<string, string>;
  }>;
  invariants?: Array<{ id: string }>;
}

const policy = D.loadPolicy();
const RAW = RAW_JSON as unknown as RawPolicy;
const EMAIL_SURFACES = ["EMAIL_SUBJECT", "EMAIL_PREHEADER", "EMAIL_HTML", "EMAIL_TEXT", "CARD"];
const allFields = () => [
  ...new Set([...policy.fields, ...D.CHARTER_FIELDS, ...D.WD2_FIELDS, ...D.WF_EXTRA_FIELDS]),
];
const codeIs = (code: string) => (e: unknown) => (e as { code?: unknown }).code === code;

test("DIS-02 a missing, unreadable or empty policy fails closed (NO_POLICY) — nothing is projected", () => {
  // port: lib/ has no file system access; the loader takes the override policy as an object or JSON string instead of a path
  assert.throws(() => D.loadPolicy({ path: "absent.json", policy: undefined }), codeIs("NO_POLICY"));
  assert.throws(() => D.loadPolicy({ path: "bad.json", policy: "{not json" }), codeIs("NO_POLICY"));
  assert.throws(
    () =>
      D.loadPolicy({ path: "empty.json", policy: JSON.parse(JSON.stringify({ version: "X", rows: [] })) }),
    codeIs("NO_POLICY"),
  );
});

test("DIS-03 every W-F policy scenario expectation (DIS-01 … DIS-06-RCA) is reproduced by decide()", () => {
  assert.ok(
    Array.isArray(RAW.scenarios) && RAW.scenarios.length > 0,
    "W-F policy carries reference scenarios",
  );
  const bad: string[] = [];
  let n = 0;
  for (const s of RAW.scenarios)
    for (const ch of s.channels)
      for (const [field, want] of Object.entries(s.expect)) {
        n++;
        const d = D.decide(policy, { recipient: s.recipient, field, channel: ch, context: s.context });
        if (d.outcome !== want) bad.push(`${s.id} ${ch} ${field}: want ${want}, got ${d.outcome}`);
      }
  console.warn("[diagnostic]", `${RAW.scenarios.length} W-F scenarios, ${n} field decisions`);
  assert.deepEqual(bad, [], bad.slice(0, 10).join("; "));
});

test("DIS-04 one decision per field: the five e-mail surfaces agree for every recipient, field and context (DIS-INV-01)", () => {
  const bad: string[] = [];
  for (const recipient of D.RECIPIENT_CLASSES)
    for (const field of allFields())
      for (const context of ["*", "CASE_RESTRICTED", "CASE_PUBLIC", "EXTERNAL"]) {
        const outs = EMAIL_SURFACES.map(
          (channel) => D.decide(policy, { recipient, field, channel, context }).outcome,
        );
        if (new Set(outs).size !== 1) bad.push(`${recipient}/${field}/${context}: ${outs.join(",")}`);
      }
  assert.deepEqual(bad, [], bad.slice(0, 10).join("; "));
});

test("DIS-06 reporter identity, report id and the §39 content group are PROHIBITED for every recipient, channel and context", () => {
  const always = [
    "reporter_identity",
    "allegations",
    "investigation_details",
    "deliberations",
    "vote_info",
    "conflict_info",
    "recommendation_content",
    "legal_opinion",
    "decision_reasons",
    "member_names",
    "participant_names",
    "attachments",
  ];
  const bad: string[] = [];
  for (const recipient of D.RECIPIENT_CLASSES)
    for (const channel of D.CHANNELS)
      for (const context of ["*", "CASE_RESTRICTED", "EXTERNAL"]) {
        for (const field of [...always, "report_id"]) {
          if (field === "report_id" && recipient === "REPORTER" && !EMAIL_SURFACES.includes(channel))
            continue; // DIS-INV-04 is checked below
          const o = D.decide(policy, { recipient, field, channel, context }).outcome;
          if (field !== "report_id" && o !== "PROHIBITED")
            bad.push(`${recipient}/${channel}/${context}/${field}: ${o}`);
        }
        const rid = D.decide(policy, { recipient, field: "report_id", channel, context }).outcome;
        if (RAW.invariants?.some((i) => i.id === "DIS-INV-04") && rid !== "PROHIBITED")
          bad.push(`${recipient}/${channel}/${context}/report_id: ${rid}`);
      }
  assert.deepEqual(bad, [], bad.slice(0, 10).join("; "));
});

test("DIS-18 the charter §5 flat model (fields at the top level) is projected exactly like {meta, fields}; unknown keys are PROHIBITED; malformed models are refused", () => {
  // port: synthetic case reference shape CDF-IC-2026-DEMO-NNNN → CDF-DEMO-2026-NNNN
  const flat = {
    case_number: "CDF-DEMO-2026-0001",
    meeting_info: "Committee meeting (synthetic)",
    l1_stage_name: { ar: "مرحلة اصطناعية", en: "synthetic stage" },
    not_a_field: "x",
  };
  const opts = { recipient: "WITNESS", context: "CASE_PUBLIC", channel: "EMAIL_TEXT", policy };
  const a = D.project(flat, opts);
  const b = D.project({ meta: {}, fields: flat }, opts);
  const outcomes = (p: D.ProjectedModel) =>
    Object.fromEntries(Object.entries(p._disclosure_log).map(([f, l]) => [f, l.outcome]));
  assert.deepEqual(outcomes(a), outcomes(b));
  assert.deepEqual(a.fields, b.fields);
  assert.equal(a._disclosure_log.not_a_field?.outcome, "PROHIBITED");
  assert.equal(a._disclosure_log.l1_stage_name?.outcome, "PROHIBITED", "witness: no Level 1");
  assert.notEqual(a._disclosure_log.case_number?.outcome, "ALLOWED", "AMB-181: no case number on e-mail");
  assert.ok(D.isProjected(a) && Object.isFrozen(a));
  for (const bad of [null, 42, "x", [], { fields: "x" }, { meta: {} }])
    assert.throws(() => D.project(bad, opts), codeIs("INVALID_MODEL"), JSON.stringify(bad));
});
