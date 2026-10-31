/**
 * DIS (renderer half) — disclosure projection (W-D2, charter §5, §12). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
 * Ported from tests/disclosure.test.js (node:test → Vitest). These thirteen tests (DIS-01, DIS-05, DIS-07, DIS-08, DIS-09, DIS-10, DIS-11, DIS-12, DIS-13, DIS-14, DIS-15, DIS-16, DIS-17) build their inputs
 * with the notification renderers and the inline scenarios, so they land with PROC-005; DIS-02, 03, 04, 06 and 18 landed
 * with PROC-003 in disclosure.spec.ts (ARCH, 31 Oct 2026). The test bodies are unchanged from the PROC-003 split, apart
 * from formatting and `@ts-expect-error` on the calls that hand a renderer an unprojected model on purpose.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as D from "@/lib/disclosure";
import RAW_JSON from "@/lib/disclosure/policy_v13.json";
import { buildNotificationModel, buildProjected } from "@/lib/notifications/render/model";
import { renderEmail, renderComponents } from "@/lib/notifications/render/email";
import { renderPlatform } from "@/lib/notifications/render/platform";
import { inlineScenarios, sentinelsOf } from "@/tests/unit/notifications/support/scenarios_inline";
import { renderAll } from "@/tests/unit/notifications/support/build_demo";

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
type Scn = ReturnType<typeof inlineScenarios>[number];
type Rcp = Scn["recipients"][number];
type Fields = Record<string, unknown>;

const P = (rel: string) => new URL(rel, import.meta.url);
const policy = D.loadPolicy();
const RAW = RAW_JSON as unknown as RawPolicy;
const SCENARIOS = inlineScenarios();
const sc = (id: string): Scn => {
  const s = SCENARIOS.find((x) => x.id === id);
  assert.ok(s, id);
  return s;
};
const rcp = (id: string, cls: string): Rcp => {
  const r = sc(id).recipients.find((x) => x.class === cls);
  assert.ok(r, `${id}/${cls}`);
  return r;
};
const DEMO = renderAll({ scenarios: SCENARIOS, policy });
const EMAIL_SURFACES = ["EMAIL_SUBJECT", "EMAIL_PREHEADER", "EMAIL_HTML", "EMAIL_TEXT", "CARD"];
const L1_NAMES = [
  "الاستقبال والتسجيل",
  "فحص الاكتمال والاختصاص والتقييم",
  "المعالجة والتحقيق المختص",
  "التوصية والقرار المختص",
  "التبليغ والتنفيذ والإغلاق",
  "Receipt and registration",
  "Completeness, jurisdiction and assessment",
  "Competent handling and investigation",
  "Recommendation and competent decision",
  "Notification, execution and closure",
];
const allFields = () => [
  ...new Set([...policy.fields, ...D.CHARTER_FIELDS, ...D.WD2_FIELDS, ...D.WF_EXTRA_FIELDS]),
];
const codeIs = (code: string) => (e: unknown) => (e as { code?: unknown }).code === code;
const fieldsOf = (m: unknown): Fields => (m as { fields: Fields }).fields;
const contextOf = (m: unknown): { tags: string[]; on_access_list?: boolean } =>
  (m as { meta: { context: { tags: string[]; on_access_list?: boolean } } }).meta.context;

test("DIS-01 the only policy is W-F policy_v13.json (PROPOSED is reported, never promoted); no provisional file in the code path", () => {
  assert.equal(policy.source, "W-F");
  assert.equal(policy.version, RAW.version);
  assert.equal(policy.status, RAW.status);
  assert.notEqual(
    policy.status,
    "APPROVED",
    "the W-F policy is a draft (D11-017); nothing may present it as approved",
  );
  // port: the source text check reads the ported lib file instead of src/disclosure/project.js
  const src = readFileSync(fileURLToPath(P("../../../lib/disclosure/project.ts")), "utf8");
  assert.ok(
    !/policy_v13\.provisional\.json/.test(src.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")),
    "project.js must not load the provisional policy",
  );
  const { projected } = buildProjected(sc("CF-18"), rcp("CF-18", "SECRETARY"), {
    experience: "EMAIL",
    policy,
  });
  assert.equal(projected._disclosure_summary.policy_version, RAW.version);
  assert.equal(projected._disclosure_summary.policy_status, RAW.status);
});
test("DIS-05 default deny: unknown recipient class, field or channel resolves PROHIBITED", () => {
  assert.equal(
    D.decide(policy, { recipient: "JOURNALIST", field: "event_title", channel: "EMAIL_HTML" }).outcome,
    "PROHIBITED",
  );
  assert.equal(
    D.decide(policy, { recipient: "SECRETARY", field: "no_such_field", channel: "EMAIL_HTML" }).outcome,
    "PROHIBITED",
  );
  assert.equal(
    D.decide(policy, { recipient: "SECRETARY", field: "event_title", channel: "SMS" }).outcome,
    "PROHIBITED",
  );
  assert.equal(
    D.decide(policy, { recipient: "SECRETARY", field: "*", channel: "EMAIL_HTML" }).outcome,
    "PROHIBITED",
  );
  const model = buildNotificationModel(sc("CF-18"), rcp("CF-18", "SECRETARY"));
  const p = D.project(
    { ...model, fields: { ...fieldsOf(model), surprise_field: "SENTINEL-UNKNOWN-FIELD-1" } },
    { recipient: "SECRETARY", channel: "EMAIL", context: contextOf(model), policy },
  );
  assert.equal(p._disclosure_log.surprise_field?.outcome, "PROHIBITED");
  assert.ok(!JSON.stringify(p.fields).includes("SENTINEL-UNKNOWN-FIELD-1"));
});
test("DIS-07 reporter: every e-mail surface is PROHIBITED (DEC-24 portal only) — the e-mail is refused, the portal view renders", () => {
  for (const ch of EMAIL_SURFACES)
    for (const f of allFields())
      assert.equal(
        D.decide(policy, { recipient: "REPORTER", field: f, channel: ch }).outcome,
        "PROHIBITED",
        `${ch}/${f}`,
      );
  const { projected: pe } = buildProjected(sc("RPT"), rcp("RPT", "REPORTER"), {
    experience: "EMAIL",
    policy,
  });
  assert.equal(pe._disclosure_summary.channel_prohibited, true);
  assert.throws(() => renderEmail(pe, { lang: "ar" }), codeIs("CHANNEL_PROHIBITED"));
  const { projected: pp } = buildProjected(sc("RPT"), rcp("RPT", "REPORTER"), {
    experience: "PLATFORM",
    policy,
  });
  const page = renderPlatform(pp, { lang: "ar", density: "COMPACT" });
  assert.match(page.html, /data-component="SmartNextActionCard"/);
  assert.ok(
    DEMO.refusals.some(
      (r) => r.scenario === "RPT" && r.experience === "EMAIL" && r.code === "CHANNEL_PROHIBITED",
    ),
  );
});
test("DIS-08 the case number is never ALLOWED on e-mail (AMB-181); its safe reference is the notice reference, never the case number", () => {
  for (const recipient of D.RECIPIENT_CLASSES)
    for (const ch of EMAIL_SURFACES)
      for (const context of ["*", "CASE_RESTRICTED", "EXTERNAL"])
        assert.notEqual(
          D.decide(policy, { recipient, field: "case_number", channel: ch, context }).outcome,
          "ALLOWED",
          `${recipient}/${ch}/${context}`,
        );
  const { model, projected } = buildProjected(sc("CF-37"), rcp("CF-37", "SUBJECT"), {
    experience: "EMAIL",
    policy,
  });
  const cn = projected.fields.case_number as { safe_reference?: boolean; token: string } | null | undefined;
  if (cn && cn.safe_reference) {
    assert.equal(cn.token, fieldsOf(model).notice_reference);
    assert.ok(!cn.token.includes(fieldsOf(model).case_number as string));
  }
  const external = DEMO.files.filter(
    (f) =>
      ["WITNESS", "REPORTER", "REFERRING_BODY", "SUBJECT"].includes(f.recipient) && f.surface !== "PLATFORM",
  );
  assert.ok(external.length > 0);
  // port: synthetic case reference shape CDF-IC-2026-DEMO-NNNN → CDF-DEMO-2026-NNNN
  for (const f of external) assert.doesNotMatch(f.content, /CDF-DEMO-2026-\d+/, f.file);
  for (const f of DEMO.files.filter((x) => x.surface !== "PLATFORM"))
    assert.doesNotMatch(
      f.content,
      /CDF-DEMO-2026-\d+/,
      `e-mail surfaces carry no case number by default: ${f.file}`,
    );
});
test("DIS-09 a witness sees no Level 1, 2 or 3 and no master stage name, on any surface", () => {
  for (const f of ["l1_stage_name", "l1_substate", "l2_journey", "l3_steps"])
    for (const ch of [...EMAIL_SURFACES, "IN_APP"])
      assert.equal(
        D.decide(policy, { recipient: "WITNESS", field: f, channel: ch }).outcome,
        "PROHIBITED",
        `${f}/${ch}`,
      );
  const w = DEMO.files.filter((f) => f.recipient === "WITNESS");
  assert.ok(w.length > 0);
  for (const f of w) {
    assert.ok(!f.content.includes('data-level="1"'), `${f.file}: Level-1 section`);
    for (const s of L1_NAMES) assert.ok(!f.content.includes(s), `${f.file}: «${s}»`);
  }
  console.warn("[diagnostic]", `witness outputs checked: ${w.length}`);
});
test("DIS-10 restricted case: an unlisted internal recipient gets nothing; listed recipients and the restricted-case authority are projected normally", () => {
  const s = sc("CF-31R");
  const unlisted = buildNotificationModel(s, rcp("CF-31R", "MEMBER"));
  assert.ok(contextOf(unlisted).tags.includes("CASE_RESTRICTED"));
  const pu = D.project(unlisted, {
    recipient: "MEMBER",
    channel: "EMAIL",
    context: contextOf(unlisted),
    policy,
  });
  assert.equal(pu._disclosure_summary.suppressed, true);
  assert.deepEqual(Object.keys(pu.fields), []);
  assert.throws(() => renderEmail(pu, { lang: "ar" }), codeIs("NOTIFICATION_SUPPRESSED"));
  const listed = buildNotificationModel(s, rcp("CF-31R", "SECRETARY"));
  assert.ok(
    !contextOf(listed).tags.includes("CASE_RESTRICTED"),
    "CASE_RESTRICTED is sent only when on_access_list !== true",
  );
  const pl = D.project(listed, {
    recipient: "SECRETARY",
    channel: "EMAIL",
    context: contextOf(listed),
    policy,
  });
  assert.equal(pl._disclosure_summary.suppressed, false);
  assert.ok(pl.fields.event_title);
  const rca = buildNotificationModel(s, rcp("CF-31R", "RESTRICTED_CASE_AUTHORITY"));
  const pr = D.project(rca, {
    recipient: "RESTRICTED_CASE_AUTHORITY",
    channel: "PLATFORM",
    context: { tags: ["CASE_RESTRICTED"], on_access_list: true },
    policy,
  });
  assert.equal(pr._disclosure_summary.suppressed, false);
  assert.ok(!DEMO.files.some((f) => f.scenario === "CF-31R" && f.recipient === "MEMBER"));
  // unknown membership counts as not listed (fail closed)
  const unknown = buildNotificationModel(s, { ...rcp("CF-31R", "SECRETARY"), on_access_list: undefined });
  assert.ok(contextOf(unknown).tags.includes("CASE_RESTRICTED"));
});
test("DIS-11 EXTERNAL context only when the delivery leaves CDF (referring body, or an address outside CDF)", () => {
  assert.ok(
    contextOf(buildNotificationModel(sc("CF-11"), rcp("CF-11", "REFERRING_BODY"))).tags.includes("EXTERNAL"),
  );
  assert.ok(!contextOf(buildNotificationModel(sc("WIT"), rcp("WIT", "WITNESS"))).tags.includes("EXTERNAL"));
  assert.ok(
    !contextOf(buildNotificationModel(sc("CF-21"), rcp("CF-21", "SUBJECT"))).tags.includes("EXTERNAL"),
  );
  assert.ok(
    contextOf(
      buildNotificationModel(sc("WIT"), { ...rcp("WIT", "WITNESS"), delivery_context: "EXTERNAL" }),
    ).tags.includes("EXTERNAL"),
  );
});
test("DIS-12 the leak sweep is fail-closed but matches whole tokens only", () => {
  // port: synthetic case reference shape CDF-IC-2026-DEMO-NNNN → CDF-DEMO-2026-NNNN
  const re = D.tokenRe("CDF-DEMO-2026-0031");
  assert.ok(re.test("x CDF-DEMO-2026-0031 y"));
  assert.ok(
    re.test("NTF-CDF-DEMO-2026-0031"),
    "an embedded identifier delimited by punctuation is still caught",
  );
  assert.ok(re.test("القضية CDF-DEMO-2026-0031."));
  assert.ok(!re.test("XCDF-DEMO-2026-0031"));
  assert.ok(!re.test("CDF-DEMO-2026-00312"));
  // a surviving field that quotes a withheld value is redacted; unrelated allowed fields survive
  const s = sc("RPT");
  const r = rcp("RPT", "REPORTER");
  const m = buildNotificationModel(s, r);
  const sub = (fieldsOf(m).l1_substate as { ar?: string } | null | undefined)?.ar;
  assert.ok(sub, "the reporter scenario has a sub-state");
  const forged = {
    ...m,
    fields: { ...fieldsOf(m), event_summary: { ar: `انتقل بلاغك إلى ${sub}.`, en: "x" } },
  };
  const p = D.project(forged, { recipient: "REPORTER", channel: "PLATFORM", context: contextOf(m), policy });
  assert.equal(
    p._disclosure_log.l1_substate?.outcome === "ALLOWED",
    false,
    "the sub-state is withheld from the reporter",
  );
  assert.equal(p._disclosure_log.event_summary?.outcome, "REDACTED");
  assert.equal(p._disclosure_log.event_summary?.note, "LEAK_SWEEP");
  assert.ok(p.fields.event_title, "the title does not quote the sub-state and survives");
  const clean = D.project(m, { recipient: "REPORTER", channel: "PLATFORM", context: contextOf(m), policy });
  assert.equal(
    clean._disclosure_log.event_summary?.outcome,
    "ALLOWED",
    "the inline reporter summary does not quote the sub-state",
  );
});
test("DIS-13 governed sub-keys follow their own field: evidence ids leave Level 3 when evidence_refs is withheld; the deadline date stays without its basis event id", () => {
  const s = sc("CF-37D");
  const r = rcp("CF-37D", "SUBJECT");
  const { model, projected } = buildProjected(s, r, { experience: "EMAIL", policy });
  assert.notEqual(projected._disclosure_log.evidence_refs?.outcome, "ALLOWED");
  const json = JSON.stringify(projected.fields);
  for (const e of (fieldsOf(model).evidence_refs as Array<{ event_id: string }> | undefined) ?? [])
    assert.ok(!json.includes(e.event_id), `evidence id ${e.event_id} survived`);
  if (projected._disclosure_log.deadline?.outcome === "ALLOWED") {
    const pd = projected.fields.deadline as { at?: unknown; basis_event_id?: unknown };
    assert.equal(pd.at, (fieldsOf(model).deadline as { at?: unknown }).at, "the recorded date stays");
    assert.equal(pd.basis_event_id, undefined);
  }
  const sec = buildProjected(sc("CF-18"), rcp("CF-18", "SECRETARY"), {
    experience: "PLATFORM",
    policy,
  }).projected;
  if (
    sec._disclosure_log.evidence_refs?.outcome === "ALLOWED" &&
    sec._disclosure_log.l3_steps?.outcome === "ALLOWED"
  )
    assert.ok(
      JSON.stringify(sec.fields.l3_steps).includes("evidence_event_id"),
      "kept where evidence_refs is allowed",
    );
});
test("DIS-14 a projected model is frozen and branded: it cannot be edited, and a copy is not accepted as projected", () => {
  const { projected } = buildProjected(sc("CF-18"), rcp("CF-18", "SECRETARY"), {
    experience: "EMAIL",
    policy,
  });
  assert.ok(D.isProjected(projected));
  assert.throws(() => {
    (projected.fields as Record<string, unknown>).allegations = "x";
  }, TypeError);
  assert.throws(() => {
    (projected.fields.event_title as { ar: string }).ar = "x";
  }, TypeError);
  for (const copy of [
    { ...projected },
    structuredClone(projected),
    JSON.parse(JSON.stringify(projected)) as unknown,
  ]) {
    assert.equal(D.isProjected(copy), false);
    assert.throws(() => D.assertProjected(copy), codeIs("UNPROJECTED_MODEL"));
  }
});
test("DIS-15 renderers refuse an unprojected model and a projection made for the other experience", () => {
  const model = buildNotificationModel(sc("CF-18"), rcp("CF-18", "SECRETARY"));
  // @ts-expect-error an unprojected model on purpose: the type rejects it, and the run-time check must too
  assert.throws(() => renderEmail(model, { lang: "ar" }), codeIs("UNPROJECTED_MODEL"));
  // @ts-expect-error same, platform renderer
  assert.throws(() => renderPlatform(model, { lang: "ar" }), codeIs("UNPROJECTED_MODEL"));
  assert.throws(
    // @ts-expect-error same, component renderer
    () => renderComponents(model, { lang: "ar", density: "STANDARD", experience: "EMAIL" }),
    codeIs("UNPROJECTED_MODEL"),
  );
  const pp = D.project(model, {
    recipient: "SECRETARY",
    channel: "PLATFORM",
    context: contextOf(model),
    policy,
  });
  assert.throws(() => renderEmail(pp, { lang: "ar" }), codeIs("WRONG_EXPERIENCE"));
  const pe = D.project(model, {
    recipient: "SECRETARY",
    channel: "EMAIL",
    context: contextOf(model),
    policy,
  });
  assert.throws(() => renderPlatform(pe, { lang: "ar" }), codeIs("WRONG_EXPERIENCE"));
});
test("DIS-16 no planted sentinel survives any projection (every inline scenario × recipient × experience)", () => {
  let n = 0;
  for (const s of SCENARIOS)
    for (const r of s.recipients)
      for (const experience of ["EMAIL", "PLATFORM"] as const) {
        const { projected } = buildProjected(s, r, { experience, policy });
        const json = JSON.stringify(projected);
        for (const v of sentinelsOf(s))
          assert.ok(!json.includes(v), `${s.id}/${r.class}/${experience}: ${v.slice(0, 22)}…`);
        n++;
      }
  console.warn("[diagnostic]", `${n} projections checked`);
});
test("DIS-17 GENERALIZED values are W-F generalized texts and never carry the original value", () => {
  let seen = 0;
  for (const s of SCENARIOS)
    for (const r of s.recipients)
      for (const experience of ["EMAIL", "PLATFORM"] as const) {
        const { model, projected } = buildProjected(s, r, { experience, policy });
        for (const [f, l] of Object.entries(projected._disclosure_log)) {
          if (l.outcome !== "GENERALIZED" || !projected.fields[f]) continue;
          seen++;
          const v = projected.fields[f] as { generalized?: unknown; ar?: unknown; en?: unknown };
          assert.equal(v.generalized, true, `${s.id}/${r.class}/${f}`);
          assert.ok(
            typeof v.ar === "string" && v.ar.length > 0 && typeof v.en === "string" && v.en.length > 0,
            `${f} has both languages`,
          );
          const mf = fieldsOf(model);
          for (const tok of [mf.case_number, mf.internal_ref, mf.report_id].filter(Boolean) as string[])
            assert.ok(!JSON.stringify(v).includes(tok), `${f} carries ${tok}`);
        }
      }
  assert.ok(seen > 0, "at least one GENERALIZED field is exercised");
});
