/**
 * NDB — W-C diagnostics never reach a recipient (SEC LOW on PR #24, planned for PROC-005).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Synthetic scenarios only.
 *
 * A W-C progress view carries `diagnostics` (anomalies, notes, hidden-step counts) for every recipient class, the
 * external classes included. The notification model keeps them only under `provenance.wc_diagnostics`, and the W-D2
 * projection keeps only the allow-listed meta keys and the policy-decided fields. These tests pin that: no projected
 * model and no rendered output for any scenario, recipient or experience carries diagnostics or provenance; and a
 * model whose `_disclosure_applied` is false, or a copy that only claims it, is refused by every renderer.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import * as D from "@/lib/disclosure";
import { buildProjected } from "@/lib/notifications/render/model";
import { renderComponents, renderEmail } from "@/lib/notifications/render/email";
import { renderPlatform } from "@/lib/notifications/render/platform";
import { inlineScenarios } from "@/tests/unit/notifications/support/scenarios_inline";

const policy = D.loadPolicy();
const SCENARIOS = inlineScenarios();
const codeIs = (code: string) => (e: unknown) => (e as { code?: unknown }).code === code;
const FORBIDDEN_KEYS = [
  "provenance",
  "diagnostics",
  "wc_diagnostics",
  "anomalies",
  "hidden_steps",
  "ignored_events",
];
const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  return out;
};
/** Render where the projection allows it; a refusal (prohibited channel, suppressed case) renders nothing. */
const renderOrNull = (fn: () => unknown): string | null => {
  try {
    return JSON.stringify(fn());
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    assert.ok(
      code === "CHANNEL_PROHIBITED" || code === "NOTIFICATION_SUPPRESSED",
      `unexpected refusal ${String(code)}`,
    );
    return null;
  }
};

describe("NDB W-C diagnostics stay out of every recipient's notification", () => {
  test("NDB-01 no projected model or rendered output carries diagnostics or provenance, external classes included", () => {
    let projections = 0;
    let rendered = 0;
    const externalSeen = new Set<string>();
    let diagnosticsBuilt = 0;
    for (const s of SCENARIOS)
      for (const r of s.recipients)
        for (const experience of ["EMAIL", "PLATFORM"] as const) {
          const { model, projected } = buildProjected(s, r, { experience, policy });
          const wc = (model as { provenance?: { wc_diagnostics?: unknown } }).provenance?.wc_diagnostics;
          if (wc) diagnosticsBuilt++;
          const keys = keysOf(projected);
          for (const k of FORBIDDEN_KEYS)
            assert.ok(!keys.has(k), `${s.id}/${r.class}/${experience}: projected key ${k}`);
          projections++;
          if ((D.EXTERNAL_CLASSES as readonly string[]).includes(r.class)) externalSeen.add(r.class);
          const out =
            experience === "EMAIL"
              ? renderOrNull(() => renderEmail(projected, { lang: "en" }))
              : renderOrNull(() => renderPlatform(projected, { lang: "en" }));
          if (out === null) continue;
          rendered++;
          for (const k of ["wc_diagnostics", "provenance", "UNKNOWN_RECIPIENT_CLASS", "ignored_events"])
            assert.ok(!out.includes(k), `${s.id}/${r.class}/${experience}: output carries ${k}`);
        }
    console.warn(
      "[diagnostic]",
      `${projections} projections, ${rendered} rendered, ${diagnosticsBuilt} models built with W-C diagnostics`,
    );
    assert.ok(diagnosticsBuilt > 0, "the inputs do carry W-C diagnostics, so the check is not vacuous");
    assert.ok(externalSeen.size >= 3, `external classes exercised: ${[...externalSeen].join(", ")}`);
  });

  test("NDB-02 negative: a model with _disclosure_applied false, or a copy that only claims true, is refused by every renderer", () => {
    const s = SCENARIOS.find((x) => x.recipients.some((r) => r.class === "SECRETARY"));
    assert.ok(s, "a scenario with a secretary recipient");
    const r = s.recipients.find((x) => x.class === "SECRETARY")!;
    const { projected: pe } = buildProjected(s, r, { experience: "EMAIL", policy });
    const { projected: pp } = buildProjected(s, r, { experience: "PLATFORM", policy });
    const forged: unknown[] = [
      { ...pe, _disclosure_applied: false },
      Object.freeze({ ...pe, _disclosure_applied: false }),
      Object.freeze({ ...pe }),
      Object.freeze({ ...pp, _disclosure_applied: true }),
    ];
    const ctx = { lang: "en", density: "STANDARD", experience: "EMAIL" } as const;
    for (const f of forged) {
      assert.equal(D.isProjected(f), false);
      // forged on purpose: the type rejects these, and the run-time check must refuse them too
      assert.throws(() => renderEmail(f as never, { lang: "en" }), codeIs("UNPROJECTED_MODEL"));
      assert.throws(() => renderPlatform(f as never, { lang: "en" }), codeIs("UNPROJECTED_MODEL"));
      assert.throws(() => renderComponents(f as never, ctx as never), codeIs("UNPROJECTED_MODEL"));
    }
    assert.ok(renderEmail(pe, { lang: "en" }).html.length > 0, "the real projection still renders");
  });
});
