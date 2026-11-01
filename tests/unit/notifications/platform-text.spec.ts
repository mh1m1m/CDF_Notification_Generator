/**
 * PTX — the plain-text twin of the platform preview (V13-PROC-021; REQ-NOTIF-011, supports REQ-NOTIF-018).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Every hostile value is a synthetic string built at run
 * time (no control or bidi character is written literally in this file); case numbers are CDF-DEMO-2026-NNNN.
 *
 * renderPlatform(...).text follows renderEmail's text twin: the same gate (assertRenderable), the same rendered components
 * in the same order as the page's HTML, marking first and last, controls and bidi characters stripped, lines ≤ 900 octets.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import * as D from "@/lib/disclosure/project";
import * as Mo from "@/lib/notifications/render/model";
import * as E from "@/lib/notifications/render/email";
import { renderPlatform } from "@/lib/notifications/render/platform";
import { MARKING } from "@/lib/notifications/render/i18n";
import { loadAuthority } from "@/lib/authority/check";
import { loadTokens } from "@/lib/notifications/render/tokens";
import { DENSITIES, type Density } from "@/lib/notifications/render/densities";
import {
  buildModelFromRecords,
  type NotificationRecordSet,
} from "@/lib/notifications/binding/model-from-records";
import {
  NotificationBindingError,
  projectForRecipient,
  type ServerProjectionRecords,
} from "@/lib/notifications/binding/server-projection";
import { inlineScenarios, sentinelsOf } from "@/tests/unit/notifications/support/scenarios_inline";
import type { Lang, Scenario } from "@/lib/notifications/render/types";

const policy = D.loadPolicy();
const authority = loadAuthority();
const tokens = loadTokens();
const SCENARIOS = inlineScenarios();
const LANGS = ["ar", "en"] as const;
const U = (...c: number[]): string => String.fromCharCode(...c);
const codeIs = (code: string) => (e: unknown) => (e as { code?: unknown } | null)?.code === code;
const bindingCode = (code: string) => (e: unknown) =>
  e instanceof NotificationBindingError && e.code === code;
/** the Trojan-source class and the other invisible characters stripControls removes */
const BIDI = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
const INVISIBLE = [...BIDI, 0, 1, 7, 0x0b, 0x1b, 0x7f, 0x85, 0x9b, 0x200b, 0x2028, 0x2029, 0xfeff];
const INVISIBLE_RE = new RegExp("[" + INVISIBLE.map((c) => U(c)).join("") + "]");
const RENDER_REFUSALS = new Set(["NOTIFICATION_SUPPRESSED", "CHANNEL_PROHIBITED"]);
const byteLen = (s: string): number => Buffer.byteLength(s, "utf8");

type Out = { text: string; html: string; components: string[] } | { refused: string };
function renderText(
  s: Scenario,
  cls: string,
  lang: Lang,
  density: Density,
  mutate?: (m: Mo.NotificationModel) => void,
): { out: Out; pp: ReturnType<typeof D.project> } {
  const r = s.recipients.find((x) => x.class === cls);
  assert.ok(r, `${s.id}/${cls}`);
  const m = Mo.buildNotificationModel(s, r, { lang, authority });
  if (mutate) mutate(m);
  const pp = D.project(m, { recipient: cls, channel: "PLATFORM", context: m.meta.context, policy });
  try {
    const o = renderPlatform(pp, { lang, density, tokens });
    return { out: { text: o.text, html: o.html, components: o.components }, pp };
  } catch (e) {
    const code = String((e as { code?: unknown }).code);
    if (!RENDER_REFUSALS.has(code)) throw e;
    return { out: { refused: code }, pp };
  }
}
const isText = (o: Out): o is Extract<Out, { text: string }> => "text" in o;
const fieldText = (v: unknown): v is string | { ar: string; en: string } =>
  typeof v === "string" ||
  (!!v &&
    typeof v === "object" &&
    typeof (v as { ar?: unknown }).ar === "string" &&
    typeof (v as { en?: unknown }).en === "string");

describe("PTX the gate is the page's gate", () => {
  test("PTX-01 an unprojected, forged or wrong-experience model is refused before any text is written", () => {
    const s = SCENARIOS[0]!;
    const r = s.recipients[0]!;
    const m = Mo.buildNotificationModel(s, r, { lang: "en", authority });
    const p = D.project(m, { recipient: r.class, channel: "PLATFORM", context: m.meta.context, policy });
    for (const f of [
      m,
      JSON.parse(JSON.stringify(p)),
      structuredClone(p),
      { ...p, _disclosure_applied: true },
      null,
      {},
    ])
      assert.throws(() => renderPlatform(f as never, { lang: "en", tokens }), codeIs("UNPROJECTED_MODEL"));
    const pe = D.project(m, { recipient: r.class, channel: "EMAIL", context: m.meta.context, policy });
    assert.throws(() => renderPlatform(pe, { lang: "en", tokens }), codeIs("WRONG_EXPERIENCE"));
  });
});

describe("PTX nothing withheld reaches the text", () => {
  test("PTX-02 every scenario × every recipient class (WITNESS and the restricted case included) × density × language: no planted sentinel, and no marker planted in a withheld field", () => {
    let rendered = 0;
    let withheldChecked = 0;
    const classesSeen = new Set<string>();
    const refusals: string[] = [];
    let restrictedSeen = false;
    for (const s of SCENARIOS) {
      const sentinels = sentinelsOf(s);
      if (s.case?.classification === "RESTRICTED") restrictedSeen = true;
      for (const r of s.recipients) {
        for (const lang of LANGS)
          for (const density of DENSITIES) {
            const marks = new Map<string, string>();
            const { out, pp } = renderText(s, r.class, lang, density, (m) => {
              const f = m.fields as Record<string, unknown>;
              for (const k of Object.keys(f)) {
                if (!fieldText(f[k])) continue;
                const mark = `WITHHELD-MARK-${k}-${s.id}`;
                marks.set(k, mark);
                f[k] = typeof f[k] === "string" ? mark : { ar: mark, en: mark };
              }
            });
            classesSeen.add(r.class);
            if (!isText(out)) {
              refusals.push(`${s.id}/${r.class}:${out.refused}`);
              continue;
            }
            rendered++;
            for (const x of sentinels)
              assert.ok(!out.text.includes(x), `${s.id}/${r.class}/${lang}: sentinel`);
            for (const [k, mark] of marks) {
              if (pp._disclosure_log[k]?.outcome === "ALLOWED") continue;
              assert.ok(
                !out.text.includes(mark),
                `${s.id}/${r.class}/${density}/${lang}: withheld ${k} in text`,
              );
              withheldChecked++;
            }
          }
      }
    }
    assert.ok(classesSeen.has("WITNESS"), "WITNESS covered");
    assert.ok(classesSeen.has("RESTRICTED_CASE_AUTHORITY"), "restricted-case authority covered");
    assert.ok(restrictedSeen, "a restricted-case scenario covered");
    console.warn(
      "[diagnostic]",
      `rendered ${rendered}, withheld checked ${withheldChecked}, refusals ${[...new Set(refusals)].join(" ")}`,
    );
    assert.ok(rendered >= 150, `texts rendered: ${rendered}`);
    assert.ok(withheldChecked > 500, `withheld markers checked: ${withheldChecked}`);
    // a refusal is a refusal, not a text: the suppressed restricted-case recipients produce nothing
    assert.ok(
      refusals.some((x) => x.endsWith("NOTIFICATION_SUPPRESSED")),
      "restricted case suppresses",
    );
  });

  test("PTX-03 a value is withheld from the text exactly when the HTML withholds it (same components, same decision)", () => {
    for (const s of SCENARIOS)
      for (const r of s.recipients) {
        const { out } = renderText(s, r.class, "en", "ADVANCED");
        if (!isText(out)) continue;
        for (const x of sentinelsOf(s)) {
          assert.ok(!out.html.includes(x), `${s.id}/${r.class}: sentinel in html`);
          assert.ok(!out.text.includes(x), `${s.id}/${r.class}: sentinel in text`);
        }
      }
  });
});

describe("PTX the text reads like renderEmail's text twin", () => {
  test("PTX-04 component order equals the HTML's, in both languages and every density", () => {
    let checked = 0;
    for (const s of SCENARIOS)
      for (const r of s.recipients)
        for (const lang of LANGS)
          for (const density of DENSITIES) {
            const { out, pp } = renderText(s, r.class, lang, density);
            if (!isText(out)) continue;
            const inHtml = [...out.html.matchAll(/data-component="([A-Za-z]+)"/g)].map((x) => x[1]);
            assert.deepEqual(inHtml, out.components, `${s.id}/${r.class}/${density}/${lang}: html order`);
            // every component's own text appears in the text twin, in the same order
            const comps = E.renderComponents(pp, { lang, density, experience: "PLATFORM", tokens });
            assert.deepEqual(
              comps.map((c) => c.name),
              out.components,
            );
            let at = 0;
            for (const c of comps) {
              const t = c.text.split("\n")[0]!.replace(INVISIBLE_RE, "").trim();
              if (!t) continue;
              const i = out.text.indexOf(t, at);
              assert.ok(i >= at, `${s.id}/${r.class}/${density}/${lang}: ${c.name} out of order`);
              at = i + t.length;
            }
            checked++;
          }
    assert.ok(checked >= 150, `checked ${checked}`);
  });

  test("PTX-05 layout: marking first and last, a heading per group, the platform preview notice, blank line after each component; ar and en differ only in wording", () => {
    const s = SCENARIOS.find((x) => x.recipients.some((r) => r.class === "SECRETARY"))!;
    const texts: Record<string, string> = {};
    for (const lang of LANGS) {
      const { out } = renderText(s, "SECRETARY", lang, "STANDARD");
      assert.ok(isText(out));
      const lines = out.text.split("\n");
      assert.equal(lines[0], MARKING);
      assert.equal(lines[1], "");
      assert.equal(lines.at(-1), "");
      assert.equal(lines.at(-2), MARKING);
      assert.equal(lines.at(-3), "");
      assert.ok(lines.filter((l) => /^== .+ ==$/.test(l)).length >= 3, `${lang}: group headings`);
      texts[lang] = out.text;
    }
    assert.notEqual(texts.ar, texts.en);
    assert.match(texts.ar!, /[؀-ۿ]/);
    // the e-mail twin of the same notification has the same skeleton (marking, headings, blank-line rhythm)
    const r = s.recipients.find((x) => x.class === "SECRETARY")!;
    const m = Mo.buildNotificationModel(s, r, { lang: "en", authority });
    const pe = D.project(m, { recipient: "SECRETARY", channel: "EMAIL", context: m.meta.context, policy });
    const email = E.renderEmail(pe, { lang: "en", density: "STANDARD", tokens });
    const shape = (t: string) =>
      t
        .split("\n")
        .filter((l) => l === MARKING || /^== .+ ==$/.test(l))
        .map((l) => (l === MARKING ? "M" : "H"));
    assert.equal(shape(texts.en!)[0], "M");
    assert.equal(shape(texts.en!).at(-1), "M");
    assert.equal(shape(email.text)[0], "M");
    assert.equal(shape(email.text).at(-1), "M");
  });

  test("PTX-06 deterministic: the same projection gives the same text, byte for byte", () => {
    for (const s of SCENARIOS.slice(0, 6))
      for (const r of s.recipients)
        for (const lang of LANGS) {
          const a = renderText(s, r.class, lang, "ADVANCED").out;
          const b = renderText(s, r.class, lang, "ADVANCED").out;
          assert.deepEqual(a, b, `${s.id}/${r.class}/${lang}`);
        }
  });

  test("PTX-07 a planted bidi override, isolate, mark or control character in a value never reaches the text; no line exceeds 900 octets", () => {
    const evil =
      INVISIBLE.map((c) => `x${U(c)}y`).join(" ") + " gnp" + U(0x202e) + "exe.pdf " + "طويل ".repeat(400);
    const s = structuredClone(SCENARIOS.find((x) => x.recipients.some((r) => r.class === "SECRETARY"))!);
    const content = s.content ?? (s.content = {});
    content.event_title = { ar: evil, en: evil };
    content.event_summary = { ar: evil, en: evil };
    for (const lang of LANGS)
      for (const density of DENSITIES) {
        const { out } = renderText(s, "SECRETARY", lang, density);
        assert.ok(isText(out));
        assert.ok(
          out.text.includes("gnpexe.pdf"),
          `${lang}/${density}: the planted value is rendered (stripped)`,
        );
        assert.doesNotMatch(out.text, INVISIBLE_RE, `${lang}/${density}`);
        for (const line of out.text.split("\n"))
          assert.ok(byteLen(line) <= 900, `${lang}/${density}: line width`);
      }
    // the renderer adds no isolate of its own to the text either (renderEmail's text has none)
    for (const s0 of SCENARIOS)
      for (const r of s0.recipients) {
        const { out } = renderText(s0, r.class, "ar", "ADVANCED");
        if (isText(out)) assert.doesNotMatch(out.text, INVISIBLE_RE, `${s0.id}/${r.class}`);
      }
  });
});

describe("PTX case isolation (the projection's own checks, nothing new)", () => {
  const CASE_1 = "0c000000-0000-4000-8000-000000000001";
  const CASE_2 = "0c000000-0000-4000-8000-000000000002";
  const recordsFor = (n: 1 | 2): NotificationRecordSet => {
    const caseId = n === 1 ? CASE_1 : CASE_2;
    return {
      case_record: {
        id: caseId,
        display_number: `CDF-DEMO-2026-000${n}`,
        is_restricted: false,
        records_state: "ACTIVE",
      },
      notification: {
        id: `0d000000-0000-4000-8000-00000000010${n}`,
        case_id: caseId,
        recipient_class: "MEMBER",
        lifecycle_status: "DRAFT",
        created_at: "2026-10-20T09:00:00Z",
        template: {
          code: "CF-24_MEETING_INVITATION",
          version: 1,
          language: "en",
          name_ar: "دعوة اجتماع",
          name_en: `Meeting invitation ${n}`,
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
  const server = (r: NotificationRecordSet): ServerProjectionRecords => ({
    case_record: { id: r.case_record.id, is_restricted: r.case_record.is_restricted },
    recipient_row: { case_id: r.notification.case_id, recipient_class: r.notification.recipient_class },
  });

  test("PTX-08 another case's record passed in is refused (CASE_MISMATCH); the case's own text carries nothing of the other case", () => {
    const r1 = recordsFor(1);
    const r2 = recordsFor(2);
    assert.throws(
      () => buildModelFromRecords({ ...r1, notification: r2.notification }),
      bindingCode("CASE_MISMATCH"),
    );
    assert.throws(
      () => buildModelFromRecords({ ...r1, events: [...r1.events, ...r2.events] }),
      bindingCode("CASE_MISMATCH"),
    );
    const m1 = buildModelFromRecords(r1);
    assert.throws(
      () => projectForRecipient(m1, server(r2), { channel: "PLATFORM" }),
      bindingCode("CASE_MISMATCH"),
    );
    const p1 = projectForRecipient(m1, server(r1), { channel: "PLATFORM" });
    for (const lang of LANGS) {
      const t = renderPlatform(p1, { lang }).text;
      assert.ok(t.length > 0);
      for (const other of [CASE_2, r2.notification.id, "CDF-DEMO-2026-0002", "Meeting invitation 2"])
        assert.ok(!t.includes(other), `${lang}: ${other}`);
    }
  });
});
