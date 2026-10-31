/**
 * SEC — rendering security (W-D2; charter §11–§12; protocol §39, §82–§83; DEC-22, DEC-24, AMB-181).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Every hostile value below is a synthetic string built at
 * run time (no control or bidi character is written literally in this file); every address is on a reserved .test domain.
 * Ported from tests/security_render.test.js (node:test → Vitest).
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as X from "@/lib/notifications/render/escape";
import * as E from "@/lib/notifications/render/email";
import { renderPlatform } from "@/lib/notifications/render/platform";
import { COMPONENTS } from "@/lib/notifications/render/components";
import * as Mo from "@/lib/notifications/render/model";
import * as D from "@/lib/disclosure/project";
import { loadAuthority } from "@/lib/authority/check";
import { loadTokens } from "@/lib/notifications/render/tokens";
import { MARKING } from "@/lib/notifications/render/i18n";
import { inlineScenarios, sentinelsOf } from "@/tests/unit/notifications/support/scenarios_inline";
import * as B from "@/tests/unit/notifications/support/build_demo";
import type { Scenario, Lang } from "@/lib/notifications/render/types";
import type { Density } from "@/lib/notifications/render/densities";
import { isNil } from "@/lib/domain/nil";

const policy = D.loadPolicy();
const authority = loadAuthority();
const tokens = loadTokens();
const SCENARIOS = inlineScenarios();
const sc = (id: string): Scenario => {
  const s = SCENARIOS.find((x) => x.id === id);
  assert.ok(s, id);
  return s;
};
const DEMO = B.renderAll({ scenarios: SCENARIOS, policy, authority, tokens });
const U = (...c: number[]): string => String.fromCharCode(...c);
const CR = U(13);
const LF = U(10);
const CRLF = CR + LF;
const NUL = U(0);
/** C0/C1 controls (not TAB/LF/CR), DEL, zero-width, bidi embeddings/overrides/isolates and marks, line/paragraph separators, BOM */
const INVISIBLE = [
  0, 1, 7, 8, 0x0b, 0x0c, 0x1b, 0x7f, 0x85, 0x9b, 0x200b, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d,
  0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x2028, 0x2029, 0xfeff,
];
const INVISIBLE_RE = new RegExp("[" + INVISIBLE.map((c) => U(c)).join("") + "]");
const EXTERNAL = ["WITNESS", "SUBJECT", "REPORTER", "REFERRING_BODY", "RECUSED_MEMBER", "EVIDENCE_HOLDER"];
const codeIs =
  (code: string) =>
  (e: unknown): boolean =>
    (e as { code?: unknown } | null)?.code === code;
type NextActionView = { kind?: string; how?: { link_kind?: string } } | undefined;
const nextActionOf = (p: { fields: Readonly<Record<string, unknown>> }): NextActionView =>
  p.fields.next_action as NextActionView;

/** a copy of an inline scenario whose free-text values carry a hostile payload */
function hostile(id: string, payload: string): Scenario {
  const s = structuredClone(sc(id));
  const content = s.content ?? (s.content = {});
  content.event_title = { ar: payload, en: payload };
  content.event_summary = { ar: payload, en: payload };
  return s;
}
interface RenderBothOptions {
  lang?: Lang;
  density?: Density;
  to?: { address?: unknown; display?: unknown };
  mutate?: (m: Mo.NotificationModel) => void;
}
function renderBoth(
  s: Scenario,
  cls: string,
  { lang = "en", density = "ADVANCED", to, mutate }: RenderBothOptions = {},
) {
  const r = s.recipients.find((x) => x.class === cls);
  assert.ok(r, `${s.id}/${cls}`);
  const m = Mo.buildNotificationModel(s, r, { lang, authority });
  if (mutate) mutate(m);
  const pe = D.project(m, { recipient: cls, channel: "EMAIL", context: m.meta.context, policy });
  const pp = D.project(m, { recipient: cls, channel: "PLATFORM", context: m.meta.context, policy });
  const email = E.renderEmail(pe, {
    lang,
    density,
    tokens,
    to: to ?? { address: r.email, display: "Synthetic Display" },
  });
  const platform = renderPlatform(pp, { lang, density, tokens });
  return { m, r, pe, pp, email, platform };
}
const head = (eml: string | null): string => (eml ?? "").split(CRLF + CRLF)[0] ?? "";
const headerNames = (eml: string | null): string[] =>
  head(eml)
    .split(CRLF)
    .filter((l) => !/^[ \t]/.test(l))
    .map((l) => l.slice(0, l.indexOf(":")));
/** headers unfolded and RFC 2047-decoded */
const decodedHead = (eml: string | null): string => X.decodeHeaderValue(head(eml));
const tagsOf = (h: string) =>
  [...h.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)].map((m) => ({
    tag: (m[1] ?? "").toLowerCase(),
    attrs: [...(m[2] ?? "").matchAll(/\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"[^"]*")?/g)].map((a) =>
      (a[1] ?? "").toLowerCase(),
    ),
  }));
const ALLOWED_TAGS = new Set([
  "a",
  "article",
  "bdi",
  "body",
  "br",
  "details",
  "div",
  "footer",
  "h1",
  "h2",
  "h3",
  "head",
  "header",
  "html",
  "li",
  "main",
  "meta",
  "p",
  "section",
  "span",
  "strong",
  "style",
  "summary",
  "table",
  "td",
  "title",
  "tr",
  "ul",
]);
const ALLOWED_ATTRS = new Set([
  "align",
  "aria-label",
  "aria-labelledby",
  "border",
  "cellpadding",
  "cellspacing",
  "charset",
  "class",
  "content",
  "dir",
  "href",
  "id",
  "lang",
  "name",
  "role",
  "style",
  "tabindex",
  "width",
  "scope",
  "colspan",
]);
const attrAllowed = (a: string): boolean => ALLOWED_ATTRS.has(a) || /^data-[a-z-]+$/.test(a);

test("SEC-01 header injection: CR, LF and NUL in the subject, display names and header values never start a new header (one To, no Cc/Bcc)", () => {
  const evil = `Ordinary title${CRLF}Bcc: victim@evil.test${NUL}${LF}X-Injected: 1${CR}Cc: other@evil.test`;
  const { email } = renderBoth(hostile("CF-18", evil), "SECRETARY", {
    to: { address: "secretary.delta@example.test", display: `Name${CRLF}Cc: other@evil.test${NUL}` },
  });
  const names = headerNames(email.eml);
  assert.equal(names.filter((n) => n === "To").length, 1);
  assert.equal(names.filter((n) => n === "Subject").length, 1);
  for (const bad of ["Bcc", "Cc", "X-Injected"]) assert.ok(!names.includes(bad), `injected header ${bad}`);
  assert.doesNotMatch(email.subject, /[\r\n\0]/);
  // the only line breaks in the header block are CRLF folds (a fold continues with whitespace)
  for (const l of head(email.eml).split(CRLF)) assert.doesNotMatch(l, /[\r\n\0]/);
  // unit level: every header helper strips CR/LF/NUL before encoding
  assert.equal(X.sanitizeHeaderText(`a${CRLF}Bcc: x${NUL}`), "a Bcc: x");
  const folded = X.encodeHeaderValue("Subject", `a${CRLF}Bcc: x@evil.test`);
  assert.ok(
    folded.split(CRLF).every((l, i) => i === 0 || /^ /.test(l)),
    "continuation lines are folds",
  );
  assert.ok(!/^Bcc:/m.test(folded.replace(/\r\n /g, " ")));
  assert.throws(
    () => X.formatAddressHeader("To", "x", `a@example.test${CRLF}Bcc: b@evil.test`),
    codeIs("INVALID_ADDRESS"),
  );
  // every demo EML uses only the expected header names
  const EXPECTED = new Set([
    "Date",
    "From",
    "To",
    "Subject",
    "Message-ID",
    "MIME-Version",
    "X-Unsent",
    "X-CDF-Marking",
    "X-CDF-Release-Status",
    "X-CDF-Notice-Ref",
    "X-CDF-Template-Code",
    "Content-Type",
  ]);
  for (const f of DEMO.files.filter((x) => x.surface === "EML"))
    for (const n of headerNames(f.content)) assert.ok(EXPECTED.has(n), `${f.file}: header ${n}`);
});

test("SEC-02 HTML injection: markup in values is escaped on both surfaces; only allowlisted tags and attributes exist; no script, no event handler, no foreign link", () => {
  const evil = `<script>alert(1)</script> "><img src=x onerror=alert(2)> <a href="javascript:alert(3)">x</a> <style>*{display:none}</style> ' onmouseover='x' <iframe src=//evil.test>`;
  const { email, platform } = renderBoth(hostile("CF-18", evil), "SECRETARY");
  for (const [name, h] of [
    ["email", email.html],
    ["platform", platform.html],
  ] as const) {
    for (const t of tagsOf(h)) {
      assert.ok(ALLOWED_TAGS.has(t.tag), `${name}: tag <${t.tag}>`);
      for (const a of t.attrs) assert.ok(attrAllowed(a), `${name}: attribute ${a} on <${t.tag}>`);
    }
    assert.doesNotMatch(h, /<script/i, name);
    assert.doesNotMatch(h, /<img|<iframe/i, name);
    for (const m of h.matchAll(/href="([^"]*)"/g)) {
      const u = m[1] ?? "";
      assert.ok(u.startsWith("#") || X.isAllowedUrl(u.replace(/&amp;/g, "&")), `${name}: href ${u}`);
    }
    assert.ok(h.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), `${name}: the payload is shown as text`);
  }
  assert.equal(
    (platform.html.match(/<style>/g) ?? []).length,
    1,
    "the platform page has exactly its own stylesheet",
  );
  assert.doesNotMatch(email.html, /<style/i, "the e-mail uses inline styles only");
  // the Adaptive Card: markdown-significant characters are escaped (no link or emphasis injection)
  for (const tb of JSON.stringify(email.card).match(/"text":"(?:[^"\\]|\\.)*"/g) ?? [])
    assert.doesNotMatch(tb, /(?<!\\\\)\[/, "unescaped [ in a TextBlock");
  // the whole demo: allowlisted tags/attributes only
  for (const f of DEMO.files.filter((x) => x.surface === "EMAIL_HTML" || x.surface === "PLATFORM")) {
    for (const t of tagsOf(f.content)) {
      assert.ok(ALLOWED_TAGS.has(t.tag), `${f.file}: <${t.tag}>`);
      for (const a of t.attrs) assert.ok(attrAllowed(a), `${f.file}: ${a}`);
    }
  }
});

test("SEC-03 unsafe URLs: only https links to the two allowlisted application origins with id-only paths; prototype keys, schemes, credentials, ports, queries and traversal are refused", () => {
  assert.equal(
    X.safeHref("INVESTIGATION_WEB", "/meetings/7a410c7a-1e24-466b-8a73-5e94a46bccbb"),
    "https://cdf-platform.example.test/meetings/7a410c7a-1e24-466b-8a73-5e94a46bccbb",
  );
  assert.equal(X.safeHref("WHISTLEBLOWING_WEB", "/follow-up"), "https://cdf-portal.example.test/follow-up");
  const bad: [string | null, string | null][] = [
    ["EVIL", "/x"],
    ["__proto__", "/x"],
    ["constructor", "/x"],
    ["toString", "/x"],
    ["hasOwnProperty", "/x"],
    ["INVESTIGATION_WEB", "javascript:alert(1)"],
    ["INVESTIGATION_WEB", "//evil.test/x"],
    ["INVESTIGATION_WEB", "/../admin"],
    ["INVESTIGATION_WEB", "/x?token=abc"],
    ["INVESTIGATION_WEB", "/x#frag"],
    ["INVESTIGATION_WEB", "/X"],
    ["INVESTIGATION_WEB", "/" + "a".repeat(250)],
    ["INVESTIGATION_WEB", ""],
    ["INVESTIGATION_WEB", "/x" + LF + "y"],
    ["INVESTIGATION_WEB", null],
    [null, "/x"],
  ];
  for (const [app, path] of bad) assert.equal(X.safeHref(app, path), null, `${app} ${JSON.stringify(path)}`);
  const okUrl = "https://cdf-platform.example.test/cases/abc-1";
  assert.equal(X.isAllowedUrl(okUrl), true);
  for (const u of [
    "http://cdf-platform.example.test/cases/abc",
    "https://cdf-platform.example.test.evil.test/x",
    "https://user:pw@cdf-platform.example.test/x",
    "https://cdf-platform.example.test:8443/x",
    "https://cdf-platform.example.test/x?y=1",
    "https://cdf-platform.example.test/x#y",
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "HTTPS://CDF-PLATFORM.EXAMPLE.TEST/x",
    "https://evil.test/x",
    " " + okUrl,
    okUrl + LF,
  ])
    assert.equal(X.isAllowedUrl(u), false, u);
  // a manipulated next action: no anchor is drawn for a foreign origin, a prototype key or a script path
  const hows = [
    { link_kind: "PLATFORM_DEEP_LINK", app: "EVIL", path: "/x" },
    { link_kind: "PLATFORM_DEEP_LINK", app: "__proto__", path: "/x" },
    { link_kind: "PLATFORM_DEEP_LINK", app: "INVESTIGATION_WEB", path: "javascript:alert(1)" },
    { link_kind: "PLATFORM_DEEP_LINK", app: "INVESTIGATION_WEB", path: "https://evil.test/x" },
  ] as const;
  for (const how of hows) {
    const { email, platform } = renderBoth(sc("CF-18"), "SECRETARY", {
      mutate: (m) => {
        m.fields.next_action = { ...m.fields.next_action, how: { channel: "PLATFORM", ...how } };
      },
    });
    for (const h of [email.html, platform.html]) {
      assert.match(h, /data-component="SecureActionLink" data-link="REJECTED"/, JSON.stringify(how));
      for (const m of h.matchAll(/href="([^"]*)"/g))
        assert.ok((m[1] ?? "").startsWith("#"), `anchor drawn for ${JSON.stringify(how)}: ${m[1]}`);
    }
    assert.doesNotMatch(email.text, /evil\.test|javascript:/, "the text twin carries no rejected link");
  }
  // a URL inside a free-text value never becomes a link: no anchor; the Adaptive Card is refused (CARD_INVALID → no e-mail)
  const u = renderBoth(hostile("CF-18", "Read [this](https://evil.test/x) https://evil.test/y"), "SECRETARY");
  for (const m of u.email.html.matchAll(/href="([^"]*)"/g)) assert.ok(X.isAllowedUrl(m[1]), m[1]);
  assert.ok(u.email.card_errors.some((x) => /URL inside a TextBlock/.test(x)));
  const refused = B.renderAll({
    scenarios: [hostile("CF-18", "Read https://evil.test/y")],
    policy,
    authority,
    tokens,
  });
  assert.ok(refused.refusals.some((x) => x.code === "CARD_INVALID" && x.experience === "EMAIL"));
  assert.ok(
    !refused.files.some((f) => f.surface !== "PLATFORM"),
    "no e-mail output when its card is invalid",
  );
});

test("SEC-04 recipient manipulation: synthetic addresses only, no header smuggling in addresses, a projection never serves another recipient, and a forged capacity never widens what a restricted recipient gets", () => {
  for (const a of ["victim@gmail.com", "a@example.test.evil.com", "a@evil-example.test", "a@notexample.test"])
    assert.throws(() => X.validateAddress(a), codeIs("ADDRESS_NOT_ALLOWED"), a);
  for (const a of [
    `a@example.test${CRLF}Bcc: b@evil.test`,
    "a@example.test,b@evil.test",
    '"a"@example.test',
    "a b@example.test",
    " a@example.test",
    "a@@example.test",
    "a..b@example.test",
    "<a@example.test>",
    `a${NUL}@example.test`,
  ]) {
    assert.throws(() => X.validateAddress(a), codeIs("INVALID_ADDRESS"), JSON.stringify(a));
  }
  assert.equal(X.validateAddress("witness.gamma@example.test"), "witness.gamma@example.test");
  const s = sc("CF-18");
  const r = s.recipients.find((x) => x.class === "SECRETARY");
  assert.ok(r);
  const m = Mo.buildNotificationModel(s, r, { authority });
  const p = D.project(m, { recipient: "SECRETARY", channel: "EMAIL", context: m.meta.context, policy });
  assert.throws(
    () => E.renderEmail(p, { lang: "en", tokens, to: { address: "someone@gmail.com" } }),
    codeIs("ADDRESS_NOT_ALLOWED"),
  );
  // a model built for a witness cannot be projected as another class
  const w = sc("WIT");
  const wr = w.recipients.find((x) => x.class === "WITNESS");
  assert.ok(wr);
  const wm = Mo.buildNotificationModel(w, wr, { authority });
  assert.throws(
    () => D.project(wm, { recipient: "SECRETARY", channel: "EMAIL", context: wm.meta.context, policy }),
    codeIs("RECIPIENT_MISMATCH"),
  );
  // the render context cannot widen disclosure: components read the class from the projected model, never from ctx
  const wp = D.project(wm, { recipient: "WITNESS", channel: "EMAIL", context: wm.meta.context, policy });
  for (const [name, fn] of Object.entries(COMPONENTS)) {
    const o = fn(wp, {
      lang: "en",
      density: "ADVANCED",
      experience: "EMAIL",
      tokens,
      recipient: "SECRETARY",
      recipient_class: "SECRETARY",
      internal: true,
    });
    if (o) assert.doesNotMatch(o.html, /data-level="[123]"/, `${name} drew a level for a witness`);
  }
  // a forged actor capacity on a restricted/external recipient only ever narrows: no new field, no executable action, no new link
  let n = 0;
  for (const sx of SCENARIOS)
    for (const r0 of sx.recipients) {
      if (!EXTERNAL.includes(r0.class)) continue;
      const base = Mo.buildNotificationModel(sx, r0, { authority });
      for (const exp of ["EMAIL", "PLATFORM"] as const) {
        const pb = D.project(base, { recipient: r0.class, channel: exp, context: base.meta.context, policy });
        const baseKeys = new Set(Object.keys(pb.fields).filter((k) => !isNil(pb.fields[k])));
        for (const cap of [
          "SECRETARY",
          "CHAIR",
          "MEMBER",
          "AUTHORITY",
          "INVESTIGATOR",
          "LEGAL_REVIEWER",
          "RESTRICTED_CASE_AUTHORITY",
          "PLATFORM_ADMIN",
          "SYSTEM",
        ]) {
          const rf = {
            ...r0,
            actor: { ...(r0.actor ?? {}), capacity: cap, seat_active: true, recused: false },
            on_access_list: true,
          };
          const mf = Mo.buildNotificationModel(sx, rf, { authority });
          const pf = D.project(mf, { recipient: r0.class, channel: exp, context: mf.meta.context, policy });
          n++;
          const extra = Object.keys(pf.fields).filter((k) => !isNil(pf.fields[k]) && !baseKeys.has(k));
          assert.deepEqual(extra, [], `${sx.id}/${r0.class}/${exp} as ${cap}: new fields`);
          const kb = nextActionOf(pb)?.kind ?? null;
          const kf = nextActionOf(pf)?.kind ?? null;
          assert.ok(
            kf === kb || ["NONE", "READ_ONLY"].includes(kf ?? ""),
            `${sx.id}/${r0.class}/${exp} as ${cap}: action ${kb} → ${kf}`,
          );
          const hf = nextActionOf(pf)?.how;
          const hb = nextActionOf(pb)?.how;
          assert.ok(
            !hf || hf.link_kind === "NONE" || JSON.stringify(hf) === JSON.stringify(hb),
            `${sx.id}/${r0.class}/${exp} as ${cap}: new link`,
          );
        }
      }
    }
  assert.ok(n >= 100, `forged-capacity cases: ${n}`);
});

test("SEC-05 unprojected or forged models are refused by every component and both renderers (copies, JSON round-trips, prototypes and proxies included)", () => {
  const s = sc("CF-19");
  const r = s.recipients.find((x) => x.class === "MEMBER");
  assert.ok(r);
  const m = Mo.buildNotificationModel(s, r, { authority });
  const p = D.project(m, { recipient: "MEMBER", channel: "EMAIL", context: m.meta.context, policy });
  assert.ok(D.isProjected(p));
  const forged: unknown[] = [
    m,
    { ...p },
    JSON.parse(JSON.stringify(p)),
    Object.create(p),
    new Proxy(p, {}),
    structuredClone(p),
    { ...p, _disclosure_applied: true },
    null,
    {},
  ];
  const ctx = { lang: "en", density: "ADVANCED", experience: "EMAIL", tokens } as const;
  for (const f of forged) {
    for (const [name, fn] of Object.entries(COMPONENTS))
      assert.throws(() => fn(f, ctx), codeIs("UNPROJECTED_MODEL"), name);
    // forged on purpose: the type rejects these, and the run-time check must refuse them too
    assert.throws(() => E.renderEmail(f as never, { lang: "en", tokens }), codeIs("UNPROJECTED_MODEL"));
    assert.throws(() => renderPlatform(f as never, { lang: "en", tokens }), codeIs("UNPROJECTED_MODEL"));
  }
  // a projected model cannot be edited in place to widen it (writes through a mutable view of the frozen objects)
  assert.throws(() => {
    (p.fields as Record<string, unknown>).case_number = "x";
  }, TypeError);
  assert.throws(() => {
    (p._disclosure_log.case_number as { outcome: string }).outcome = "ALLOWED";
  }, TypeError);
  assert.throws(() => {
    (p.meta as { recipient_class: string }).recipient_class = "SECRETARY";
  }, TypeError);
});

test("SEC-06 sentinel and identifier sweep over every demo output: no planted sentinel anywhere; no raw case number where its decision is not ALLOWED (never in e-mail, AMB-181; never to a witness, reporter or referring body, DEC-22)", () => {
  assert.ok(DEMO.files.length > 400);
  const all = SCENARIOS.flatMap((s) => sentinelsOf(s));
  assert.ok(all.length >= 20, `sentinels planted: ${all.length}`);
  const decode = (f: B.DemoFile): string =>
    f.surface === "EML" ? decodedHead(f.content) + CRLF + f.content : f.content;
  for (const f of DEMO.files) {
    const text = decode(f);
    for (const s of all) assert.ok(!text.includes(s), `${f.file}: sentinel ${s.slice(0, 18)}…`);
  }
  let checked = 0;
  for (const s of SCENARIOS) {
    const raw = typeof s.case?.internal_ref === "string" ? s.case.internal_ref : null; // CaseRecord §3.1: the case number
    assert.ok(raw, `${s.id}: case number present in the record`);
    for (const f of DEMO.files.filter((x) => x.scenario === s.id)) {
      const rec = DEMO.records.find((x) => x.scenario === s.id && x.recipient === f.recipient);
      const exp = f.surface === "PLATFORM" ? "PLATFORM" : "EMAIL";
      const outcome = rec?.logs?.[exp]?.case_number?.outcome ?? "PROHIBITED";
      const text = decode(f);
      if (
        exp === "EMAIL" ||
        ["WITNESS", "REPORTER", "REFERRING_BODY"].includes(f.recipient) ||
        outcome !== "ALLOWED"
      ) {
        assert.ok(!X.stripControls(text).includes(raw), `${f.file}: raw case number (${outcome})`);
        checked++;
      }
    }
  }
  assert.ok(checked > 300, `outputs swept for the raw case number: ${checked}`);
  // the identifier pattern never appears in an e-mail surface at all
  // port: the synthetic case numbers are CDF-DEMO-YYYY-NNNN (CLAUDE.md §1); the reference pattern is kept and the port's added
  for (const f of DEMO.files.filter((x) => x.surface !== "PLATFORM"))
    assert.doesNotMatch(decode(f), /CDF-(?:(IC|WB|IR)-\d{4}-DEMO|DEMO-\d{4})-\d+/, f.file);
});

test("SEC-07 bidi overrides, isolates, zero-width, C0/C1 controls and line separators in values never reach any output (HTML, text twin, card, EML headers and bodies, platform)", () => {
  const evil = INVISIBLE.map((c) => `x${U(c)}y`).join(" ") + " gnp" + U(0x202e) + "exe.pdf";
  for (const lang of ["ar", "en"] as const) {
    const { email, platform } = renderBoth(hostile("CF-18", evil), "SECRETARY", {
      lang,
      to: { address: "secretary.delta@example.test", display: "Name" + U(0x202e) + U(0x200b) },
    });
    for (const [name, out] of [
      ["html", email.html],
      ["text", email.text],
      ["card", JSON.stringify(email.card)],
      ["eml", email.eml ?? ""],
      ["eml-head", decodedHead(email.eml)],
      ["subject", email.subject],
      ["preheader", email.preheader],
      ["platform", platform.html],
      ["platform-text", platform.text],
      ["platform-title", platform.title],
    ] as const) {
      assert.doesNotMatch(out, INVISIBLE_RE, `${lang} ${name}`);
    }
  }
  for (const f of DEMO.files)
    assert.doesNotMatch(
      f.surface === "EML" ? decodedHead(f.content) + f.content : f.content,
      INVISIBLE_RE,
      f.file,
    );
  assert.equal(X.stripControls("a" + U(0x202e) + "b" + U(0x2028) + "c" + NUL), "ab c");
});

test("SEC-08 JSON embedded in HTML (jsonForHtmlScript) cannot close the script element or break the document", () => {
  const v = {
    a: "</script><script>alert(1)</script>",
    b: "<!-- & -->",
    c: U(0x2028) + U(0x2029),
    d: "'\"",
    e: [1, { f: "</SCRIPT>" }],
  };
  const s = X.jsonForHtmlScript(v);
  assert.doesNotMatch(s, /[<>&]/);
  assert.ok(!s.includes(U(0x2028)) && !s.includes(U(0x2029)));
  assert.deepEqual(JSON.parse(s), v);
  // the card embed is used only when card_content is ALLOWED, which the current policy never decides (D11-074)
  for (const f of DEMO.files.filter((x) => x.surface === "EMAIL_HTML"))
    assert.doesNotMatch(f.content, /<script/i, f.file);
});

test("SEC-09 attachment file names: no path, no control or separator characters, ASCII fallback plus an RFC 2231 value; a hostile name cannot add a MIME header", () => {
  const cases = [
    "../../etc/passwd",
    "..\\..\\boot.ini",
    `a${CRLF}Content-Type: text/html.ics`,
    'x";filename=evil.exe',
    ".hidden",
    "",
    "دعوة الاجتماع.ics",
    `n${NUL}ame${U(0x202e)}cod.exe`,
  ];
  for (const c of cases) {
    const f = X.sanitizeFilename(c, "attachment");
    assert.doesNotMatch(f.name, /[\\/\r\n\0"';:*?<>|=%]/, JSON.stringify(c));
    assert.doesNotMatch(f.name, INVISIBLE_RE);
    assert.match(f.ascii, /^[\x20-\x7E]+$/);
    assert.doesNotMatch(f.ascii, /[\\/"';:=]/);
    assert.match(f.rfc2231, /^UTF-8''[A-Za-z0-9%._~!-]+$/);
    assert.ok(!f.name.startsWith("."));
  }
  assert.equal(X.sanitizeFilename("../../etc/passwd").name, "passwd");
  assert.equal(X.sanitizeFilename("").name, "attachment");
  const eml = E.buildEml({
    from: { display: "Sender", address: "notifications.demo@example.test" },
    to: { display: "To", address: "witness.gamma@example.test" },
    subject: "S",
    date: "Tue, 27 Oct 2026 15:00:00 +0300",
    messageId: "id@cdf-demo.example.test",
    text: "t",
    html: "<p>h</p>",
    attachments: [
      {
        filename: `inv${CRLF}Content-Type: text/html; x="1.ics`,
        contentType: `text/calendar${CRLF}X-Evil: 1`,
        content: "BEGIN:VCALENDAR",
      },
    ],
  });
  assert.doesNotMatch(eml, /^X-Evil:/m);
  assert.doesNotMatch(eml, /^Content-Type: text\/html; x=/m);
  const disp = eml.split(CRLF).filter((l) => l.startsWith("Content-Disposition:"));
  assert.equal(disp.length, 1);
  assert.match(
    eml,
    /Content-Type: application\/octet-stream; name=/,
    "an invalid content type falls back to application/octet-stream",
  );
});

test("SEC-10 extra MIME headers: only X- names of letters, digits and hyphens; values are sanitised; renderEmail sets the four metadata headers only (W-F surface composition)", () => {
  const base = {
    from: { display: "S", address: "notifications.demo@example.test" },
    to: { display: "T", address: "witness.gamma@example.test" },
    subject: "S",
    date: "Tue, 27 Oct 2026 15:00:00 +0300",
    messageId: "id@cdf-demo.example.test",
    text: "t",
    html: "<p>h</p>",
  };
  for (const name of ["Bcc", "Subject", `X-Ok${CRLF}Bcc`, "X-Ok: v", "X Ok", "X-", "x-lower_case", ""]) {
    assert.throws(
      () => E.buildEml({ ...base, headers: { [name]: "v" } }),
      codeIs("BAD_HEADER_NAME"),
      JSON.stringify(name),
    );
  }
  const eml = E.buildEml({ ...base, headers: { "X-Ok": `v${CRLF}Bcc: victim@evil.test${NUL}` } });
  assert.ok(!headerNames(eml).includes("Bcc"));
  assert.match(head(eml), /^X-Ok: v Bcc: victim@evil\.test$/m);
  for (const f of DEMO.files.filter((x) => x.surface === "EML")) {
    const xs = headerNames(f.content).filter((n) => n.startsWith("X-"));
    for (const n of xs)
      assert.ok(
        [
          "X-Unsent",
          "X-CDF-Marking",
          "X-CDF-Release-Status",
          "X-CDF-Notice-Ref",
          "X-CDF-Template-Code",
        ].includes(n),
        `${f.file}: ${n}`,
      );
    assert.match(head(f.content), /^X-Unsent: 1$/m, `${f.file}: unsent draft`);
    assert.match(head(f.content), /^X-CDF-Release-Status: DESIGN_PREVIEW$/m);
  }
});

test("SEC-11 no secrets and no non-synthetic endpoints: no key, token or credential pattern in W-D2 sources or outputs; every address and link is on a reserved .test domain", () => {
  const SECRET = [
    /service[_-]?role[_-]?key\s*[:=]/i,
    /\bsk_(live|test)_[A-Za-z0-9]/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bSUPABASE_[A-Z_]*KEY\s*=/,
    /\bpassw(or)?d\s*[:=]\s*['"][^'"]+['"]/i,
    /\bapi[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
    /\bxox[baprs]-[A-Za-z0-9-]+/,
    /\bghp_[A-Za-z0-9]{20,}/,
  ];
  // port: the reference's src/{render,demo,disclosure,authority,nextAction} map to the ported folders below (.ts sources)
  const dirs = [
    "lib/notifications/render/",
    "tests/unit/notifications/support/",
    "lib/disclosure/",
    "lib/authority/",
    "lib/notifications/next-action/",
  ];
  const sources = dirs.flatMap((d) =>
    readdirSync(join(B.ROOT, d))
      .filter((n) => n.endsWith(".ts"))
      .map((n) => [d + n, readFileSync(join(B.ROOT, d, n), "utf8")] as const),
  );
  assert.ok(sources.length >= 12);
  for (const [n, s] of sources) for (const re of SECRET) assert.doesNotMatch(s, re, `${n}: ${re}`);
  for (const f of DEMO.files) {
    for (const re of SECRET) assert.doesNotMatch(f.content, re, `${f.file}: ${re}`);
    for (const m of f.content.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g))
      assert.match((m[1] ?? "").toLowerCase(), /(^|\.)example\.test$/, `${f.file}: address domain ${m[1]}`);
    for (const m of f.content.matchAll(/https?:\/\/([^\s"'<>)/]+)/g))
      assert.match((m[1] ?? "").toLowerCase(), /(^|\.)example\.test$/, `${f.file}: link host ${m[1]}`);
  }
});

test("SEC-12 the gallery index and the manifest carry outcomes and metadata only: no sentinel, case number, address, component or progress marker", () => {
  const info = { marking: MARKING, policy: "p", authority: "a" };
  const html = B.renderIndex({ files: DEMO.files, refusals: DEMO.refusals, records: DEMO.records, info });
  for (const s of SCENARIOS) {
    for (const x of sentinelsOf(s)) assert.ok(!html.includes(x), `index: sentinel of ${s.id}`);
    const raw = s.case?.internal_ref;
    assert.ok(typeof raw === "string" && !html.includes(raw), `index: case number of ${s.id}`);
    for (const r of s.recipients)
      if (r.email) assert.ok(!html.includes(r.email), `index: address of ${s.id}/${r.class}`);
  }
  assert.doesNotMatch(html, /data-(component|layer|level|state|kind)=/);
  assert.doesNotMatch(html, /<script/i);
  assert.ok(html.includes(MARKING));
  for (const x of DEMO.refusals) assert.ok(html.includes(x.code), `refusal ${x.code} listed`);
  // refusal reasons are generic: no stack trace, file path or internal module name
  for (const x of DEMO.refusals)
    assert.doesNotMatch(x.why, /\bat \S+:\d+|\/mnt\/|node:internal|\.js:\d+/, x.code);
  const manifestKeys = new Set(["file", "scenario", "recipient", "density", "surface", "sha256", "lang"]);
  for (const f of DEMO.files)
    for (const k of Object.keys({
      file: f.file,
      scenario: f.scenario,
      recipient: f.recipient,
      density: f.density,
      surface: f.surface,
      sha256: "x",
      lang: f.lang,
    }))
      assert.ok(manifestKeys.has(k));
});

test("SEC-13 nothing is produced for a suppressed or refused recipient: restricted-case recipients off the access list, the reporter by e-mail (DEC-24), the witness and the referring body in-app", () => {
  const has = (sid: string, cls: string, pred: (f: B.DemoFile) => boolean = () => true): boolean =>
    DEMO.files.some((f) => f.scenario === sid && f.recipient === cls && pred(f));
  const suppressed = DEMO.refusals.filter((x) => x.code === "NOTIFICATION_SUPPRESSED");
  assert.ok(suppressed.length >= 1);
  for (const x of suppressed)
    assert.ok(!has(x.scenario, x.recipient), `${x.scenario}/${x.recipient}: output despite suppression`);
  for (const s of SCENARIOS) {
    if (s.recipients.some((r) => r.class === "REPORTER"))
      assert.ok(!has(s.id, "REPORTER", (f) => f.surface !== "PLATFORM"), `${s.id}: reporter e-mail`);
    for (const cls of ["WITNESS", "REFERRING_BODY"])
      if (s.recipients.some((r) => r.class === cls))
        assert.ok(!has(s.id, cls, (f) => f.surface === "PLATFORM"), `${s.id}: ${cls} platform page`);
  }
  // restricted case: only listed internal recipients and the restricted-case authority receive anything
  const rc = SCENARIOS.filter(
    (s) => s.case?.classification === "RESTRICTED" || s.case?.classification === "SECRET",
  );
  assert.ok(rc.length >= 1);
  for (const s of rc)
    for (const r of s.recipients)
      if (r.on_access_list !== true)
        assert.ok(!has(s.id, r.class), `${s.id}/${r.class} is not on the access list`);
});
