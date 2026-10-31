/**
 * REN — rendering of the 18 components in three densities for platform and e-mail (W-D2, charter §11), progress
 * resolution (charter §3.2, §3.6, W-C catalogue rules) and the demo builder. SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
 * Ported from tests/render.test.js (node:test → Vitest). W-C's resolver, progress view and scenario fixtures are read from
 * the port (@/lib/journeys, lib/journeys/scenarios); W-D1's engine from @/lib/notifications/consistency/engine.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPONENTS, deliveryWording } from "@/lib/notifications/render/components";
import { loadTokens } from "@/lib/notifications/render/tokens";
import {
  DENSITIES,
  COMPONENT_NAMES,
  ORDER,
  MATRIX,
  componentsFor,
  DEFAULT_DENSITY,
} from "@/lib/notifications/render/densities";
import * as E from "@/lib/notifications/render/email";
import { renderPlatform } from "@/lib/notifications/render/platform";
import * as Mo from "@/lib/notifications/render/model";
import { loadPolicy, project } from "@/lib/disclosure/project";
import { loadAuthority } from "@/lib/authority/check";
import { layerBViolations } from "@/lib/notifications/next-action/rules";
import { inlineScenarios } from "@/tests/unit/notifications/support/scenarios_inline";
import * as B from "@/tests/unit/notifications/support/build_demo";
import { MARKING } from "@/lib/notifications/render/i18n";
import * as R from "@/lib/journeys/resolve";
import * as V from "@/lib/journeys/progress";
import { consistencyContext } from "@/tests/unit/notifications/support/consistency_ctx";
import type {
  Scenario,
  Recipient,
  DemoEvent,
  ProceduralObject,
  CaseRecord,
  Bi,
  Lang,
  Experience,
} from "@/lib/notifications/render/types";
import type { Density } from "@/lib/notifications/render/densities";

const policy = loadPolicy();
const authority = loadAuthority();
const tokens = loadTokens();
const SCENARIOS = inlineScenarios();
const sc = (id: string): Scenario => {
  const s = SCENARIOS.find((x) => x.id === id);
  assert.ok(s, id);
  return s;
};
const rcp = (id: string, cls: string): Recipient => {
  const r = sc(id).recipients.find((x) => x.class === cls);
  assert.ok(r, `${id}/${cls}`);
  return r;
};
const DEMO = B.renderAll({ scenarios: SCENARIOS, policy, authority });
const html = DEMO.files.filter((f) => f.surface === "EMAIL_HTML" || f.surface === "PLATFORM");
const CHARTER_18 = [
  "NotificationHeader",
  "ClassificationBadge",
  "EventSummary",
  "SmartNextActionCard",
  "ProceduralStatusCard",
  "ActualProgress",
  "ExpectedProcess",
  "JourneySummary",
  "EvidenceReference",
  "DecisionRightsIndicator",
  "DeadlineIndicator",
  "ConfidentialityNotice",
  "SecureActionLink",
  "ContextualHelp",
  "ExceptionWarning",
  "DeliveryStatus",
  "AuditReference",
  "SimplifiedView",
];
const STATES = [
  "COMPLETED",
  "IN_PROGRESS",
  "PENDING",
  "SUSPENDED",
  "RETURNED",
  "CANCELLED",
  "FAILED",
  "NOT_APPLICABLE",
];
const KINDS = ["EXPECTED", "CONDITIONAL", "OPTIONAL", "ALTERNATIVE", "PARALLEL", "SUBJECT_TO_APPROVAL"];
const INTERNAL = new Set([
  "SECRETARY",
  "CHAIR",
  "MEMBER",
  "INVESTIGATOR",
  "LEGAL_REVIEWER",
  "AUTHORITY",
  "RESTRICTED_CASE_AUTHORITY",
]);
const textOf = (h: string): string =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
const componentsIn = (h: string): string[] =>
  [...h.matchAll(/data-component="([A-Za-z]+)"/g)].map((m) => m[1] ?? "");
const projected = (id: string, cls: string, experience: Experience) =>
  Mo.buildProjected(sc(id), rcp(id, cls), { experience, policy, authority }).projected;
const MATRIX_BY_NAME = MATRIX as Readonly<Record<string, Readonly<Record<string, boolean>>>>;

// a W-C-shaped test journey (catalogue rules: completion type + payload, trigger rule, alternatives, branch, condition, visibility)
const J: Mo.Journey = {
  id: "J-TEST",
  object: { ar: "كائن الاختبار", en: "Test object" },
  capacity: { ar: "صفة", en: "Capacity" },
  capacity_by_recipient: { SECRETARY: { ar: "الأمانة", en: "Secretariat" } },
  structure: "BRANCHING",
  stages: [
    {
      n: 1,
      kind: "SEQUENCE",
      ar: "م1",
      en: "S1",
      steps: [
        {
          id: "J-TEST/1/1",
          kind: "STEP",
          ar: "خ1",
          en: "s1",
          trigger_event_type: null,
          completion_event_type: "A_DONE",
          completion_payload: { x: "1" },
          visibility: ["internal"],
          next: ["J-TEST/2/1", "J-TEST/2/2"],
        },
      ],
    },
    {
      n: 2,
      kind: "CHOICE",
      ar: "م2",
      en: "S2",
      steps: [
        {
          id: "J-TEST/2/1",
          kind: "ALTERNATIVE",
          alternative_group: "J-TEST/G",
          ar: "يسار",
          en: "left",
          trigger_event_type: null,
          completion_event_type: "CHOSEN",
          completion_payload: { c: "L" },
          visibility: ["internal"],
          next: ["J-TEST/3/1"],
        },
        {
          id: "J-TEST/2/2",
          kind: "ALTERNATIVE",
          alternative_group: "J-TEST/G",
          ar: "يمين",
          en: "right",
          trigger_event_type: null,
          completion_event_type: "CHOSEN",
          completion_payload: { c: "R" },
          visibility: ["internal"],
          next: ["J-TEST/3/2"],
        },
      ],
    },
    {
      n: 3,
      kind: "BRANCH",
      ar: "م3",
      en: "S3",
      steps: [
        {
          id: "J-TEST/3/1",
          kind: "STEP",
          ar: "فرع يسار",
          en: "left branch",
          trigger_event_type: "L_STARTED",
          completion_event_type: "L_DONE",
          visibility: ["internal"],
        },
        {
          id: "J-TEST/3/2",
          kind: "STEP",
          ar: "فرع يمين",
          en: "right branch",
          trigger_event_type: null,
          completion_event_type: "R_DONE",
          visibility: ["internal"],
        },
      ],
    },
    {
      n: 4,
      kind: "CONDITION",
      ar: "م4",
      en: "S4",
      applies_if: { match: [{ type: "COND_MET" }], excluded_by: [{ type: "COND_EXCLUDED" }] },
      steps: [
        {
          id: "J-TEST/4/1",
          kind: "STEP",
          ar: "شرطي",
          en: "conditional",
          trigger_event_type: null,
          completion_event_type: "C_DONE",
          visibility: ["internal", "public"],
        },
      ],
    },
    {
      n: 5,
      kind: "TERMINAL",
      ar: "م5",
      en: "S5",
      steps: [
        {
          id: "J-TEST/5/1",
          kind: "STEP",
          ar: "إقفال",
          en: "close",
          trigger_event_type: null,
          completion_event_type: "CLOSED",
          visibility: ["internal", "public"],
        },
      ],
    },
  ],
};
const OBJ = { type: "TEST", id: "obj-test-1" };
const ev = (
  id: string,
  type: string,
  payload: Readonly<Record<string, unknown>> = {},
  recorded = true,
  object: { type: string; id: string } = OBJ,
): DemoEvent => ({
  event_id: id,
  type,
  occurred_at: "2026-10-27T10:00:00+03:00",
  recorded_at: recorded ? "2026-10-27T10:00:00+03:00" : null,
  case_id: "case-test-1",
  object,
  payload,
});
type ProcStepIn = NonNullable<ProceduralObject["steps"]>[number];
const po = (steps: ProcStepIn[] = []): ProceduralObject => ({
  object_id: OBJ.id,
  case_id: "case-test-1",
  steps,
});
const stepOf = (lv: Mo.Levels23, id: string) =>
  (lv.l3?.stages ?? []).flatMap((s) => s.steps).find((x) => x.step_id === id);

test('REN-01 the 18 charter components exist, in charter order groups, and every rendered root carries data-component="<Name>"', () => {
  assert.deepEqual([...Object.keys(COMPONENTS)].sort(), [...CHARTER_18].sort());
  assert.deepEqual([...COMPONENT_NAMES].sort(), [...CHARTER_18].sort());
  const p = projected("CF-27", "MEMBER", "PLATFORM");
  let rendered = 0;
  for (const d of DENSITIES)
    for (const name of componentsFor(d)) {
      const r = COMPONENTS[name](p, { lang: "ar", density: d, experience: "PLATFORM", tokens });
      if (!r) continue;
      rendered++;
      assert.ok(r.html.startsWith(`<div data-component="${name}"`), `${name} root`);
      assert.equal(typeof r.text, "string");
      assert.ok(Array.isArray(r.card));
    }
  assert.ok(rendered >= 30);
  const names = new Set(html.flatMap((f) => componentsIn(f.content)));
  for (const n of names) assert.ok(CHARTER_18.includes(n), n);
  assert.ok(names.size >= 16, `components seen across the demo: ${[...names].join(", ")}`);
});

test("REN-02 densities select, never add: COMPACT = SimplifiedView; STANDARD adds the levels; ADVANCED adds the details group", () => {
  assert.equal(MATRIX.SimplifiedView.COMPACT, true);
  assert.equal(MATRIX.ActualProgress.COMPACT, false);
  assert.equal(MATRIX.EvidenceReference.STANDARD, false);
  assert.equal(MATRIX.EvidenceReference.ADVANCED, true);
  for (const f of html) {
    const c = new Set(componentsIn(f.content));
    for (const n of c)
      assert.ok(MATRIX_BY_NAME[n]?.[f.density], `${f.file}: ${n} is not in the ${f.density} density`);
  }
  const by = (d: Density): string => {
    const f = html.find(
      (x) =>
        x.scenario === "CF-18" &&
        x.recipient === "SECRETARY" &&
        x.surface === "PLATFORM" &&
        x.density === d &&
        x.lang === "ar",
    );
    assert.ok(f, d);
    return f.content;
  };
  assert.ok(componentsIn(by("COMPACT")).includes("SimplifiedView"));
  assert.ok(!componentsIn(by("COMPACT")).includes("ActualProgress"));
  for (const n of ["ProceduralStatusCard", "JourneySummary", "ActualProgress", "ExpectedProcess"])
    assert.ok(componentsIn(by("STANDARD")).includes(n), n);
  const adv = new Set(componentsIn(by("ADVANCED")));
  for (const n of componentsIn(by("STANDARD"))) assert.ok(adv.has(n), `ADVANCED keeps ${n}`);
});

test("REN-03 output order: identity → core message → required action → procedure status → details → help; the action card precedes every progress component", () => {
  for (const f of html) {
    const seq = componentsIn(f.content);
    const idx = seq.map((n) => (ORDER as readonly string[]).indexOf(n));
    assert.deepEqual(
      idx,
      [...idx].sort((a, b) => a - b),
      `${f.file}: ${seq.join(" > ")}`,
    );
    const a = f.content.indexOf('data-component="SmartNextActionCard"');
    assert.ok(a > 0, `${f.file}: action card missing`);
    for (const c of [
      "ActualProgress",
      "ExpectedProcess",
      "JourneySummary",
      "ProceduralStatusCard",
      "SimplifiedView",
    ]) {
      const i = f.content.indexOf(`data-component="${c}"`);
      if (i >= 0) assert.ok(a < i, `${f.file}: ${c} before the action card`);
    }
  }
});

test("REN-04 Layer A items carry a valid data-state and Layer B items a valid data-kind; no ✔, ● or سُجل/اكتُمل/تم inside an expected item", () => {
  let a = 0;
  let b = 0;
  for (const f of html) {
    for (const m of f.content.matchAll(/data-layer="actual"([^>]*)>/g)) {
      a++;
      const s = /data-state="([A-Z_]+)"/.exec(m[1] ?? "");
      assert.ok(s && STATES.includes(s[1] ?? ""), `${f.file}: ${m[0].slice(0, 90)}`);
    }
    for (const m of f.content.matchAll(
      /<(li|p|div|td)\b([^>]*data-layer="expected"[^>]*)>([\s\S]*?)<\/\1>/g,
    )) {
      b++;
      const k = /data-kind="([A-Z_]+)"/.exec(m[2] ?? "");
      assert.ok(k && KINDS.includes(k[1] ?? ""), `${f.file}: ${m[0].slice(0, 90)}`);
      const inner = m[3] ?? "";
      assert.ok(
        !/✔|&#10004;|&#x2714;|●/.test(inner),
        `${f.file}: completed or current symbol inside an expected item`,
      );
      assert.deepEqual(layerBViolations(textOf(inner)), [], `${f.file}: ${textOf(inner).slice(0, 80)}`);
    }
  }
  console.warn("[diagnostic]", `Layer A items ${a}, Layer B items ${b}`);
  assert.ok(a > 0 && b > 0);
});

test("REN-05 (local fallback) a step is COMPLETED only with a recorded, in-scope evidence event of its completion type and payload; otherwise PENDING or IN_PROGRESS by its trigger", () => {
  const done = (evId: string): ProcStepIn => ({
    step_id: "J-TEST/1/1",
    actual: "COMPLETED",
    evidence_event_id: evId,
  });
  const ok = Mo.resolveLevels23(po([done("e1")]), J, [ev("e1", "A_DONE", { x: "1" })]);
  assert.equal(stepOf(ok, "J-TEST/1/1")?.state, "COMPLETED");
  assert.deepEqual(ok.downgraded, []);
  // a CASE event of the same case is in scope (W-C scope rule)
  assert.equal(
    stepOf(
      Mo.resolveLevels23(po([done("e1")]), J, [
        ev("e1", "A_DONE", { x: "1" }, true, { type: "CASE", id: "case-test-1" }),
      ]),
      "J-TEST/1/1",
    )?.state,
    "COMPLETED",
  );
  const cases: Array<[DemoEvent[], string, ProceduralObject?]> = [
    [[ev("e1", "OTHER", { x: "1" })], "wrong type"],
    [[ev("e1", "A_DONE", { x: "2" })], "wrong payload"],
    [[ev("e1", "A_DONE", { x: "1" }, false)], "not recorded"],
    [[], "no event"],
    [[ev("e1", "NOTIFICATION_SENT", { x: "1" })], "a notification is never its own evidence"],
    [
      [ev("e1", "A_DONE", { x: "1" }, true, { type: "TEST", id: "another-object" })],
      "an event on another object is not evidence",
    ],
    [
      [ev("e1", "A_DONE", { x: "1" })],
      "an object without an id has nothing in scope (fail closed)",
      { steps: [done("e1")] },
    ],
  ];
  for (const [events, why, obj = po([done("e1")])] of cases) {
    const r = Mo.resolveLevels23(obj, J, events);
    assert.notEqual(stepOf(r, "J-TEST/1/1")?.state, "COMPLETED", why);
    assert.deepEqual(r.downgraded, ["J-TEST/1/1"], why);
  }
  // trigger rule: IN_PROGRESS only with the trigger event (3/1 trigger L_STARTED)
  const base = [ev("e1", "A_DONE", { x: "1" }), ev("e2", "CHOSEN", { c: "L" })];
  const steps: ProcStepIn[] = [
    done("e1"),
    { step_id: "J-TEST/2/1", actual: "COMPLETED", evidence_event_id: "e2" },
    { step_id: "J-TEST/3/1", actual: "IN_PROGRESS" },
  ];
  assert.equal(stepOf(Mo.resolveLevels23(po(steps), J, base), "J-TEST/3/1")?.state, "PENDING");
  assert.equal(
    stepOf(Mo.resolveLevels23(po(steps), J, [...base, ev("e3", "L_STARTED")]), "J-TEST/3/1")?.state,
    "IN_PROGRESS",
  );
  // payload filter semantics (W-C field_notes)
  assert.ok(Mo.payloadMatches({ a: "X" }, { a: "X" }));
  assert.ok(!Mo.payloadMatches({ a: "X" }, { a: "Y" }));
  assert.ok(Mo.payloadMatches({ a: ["X", "Y"] }, { a: "Y" }));
  assert.ok(Mo.payloadMatches({ a: ["X", null] }, {}));
  assert.ok(!Mo.payloadMatches({ a: ["X"] }, {}));
});

test("REN-06 alternatives are exclusive: the chosen one never completes its siblings; branch steps follow the chosen path (local fallback and W-C view)", () => {
  const evs = [ev("e1", "A_DONE", { x: "1" }), ev("e2", "CHOSEN", { c: "L" })];
  const r = Mo.resolveLevels23(
    po([
      { step_id: "J-TEST/1/1", actual: "COMPLETED", evidence_event_id: "e1" },
      { step_id: "J-TEST/2/1", actual: "COMPLETED", evidence_event_id: "e2" },
    ]),
    J,
    evs,
  );
  const sib = stepOf(r, "J-TEST/2/2");
  assert.equal(sib?.layer, "actual");
  assert.equal(sib?.state, "NOT_APPLICABLE");
  assert.ok(
    !(r.l3?.stages ?? [])
      .flatMap((s) => s.steps)
      .some((x) => x.step_id === "J-TEST/2/2" && (x.layer === "expected" || x.state === "COMPLETED")),
  );
  assert.equal(stepOf(r, "J-TEST/3/1")?.layer, "expected");
  assert.equal(stepOf(r, "J-TEST/3/1")?.kind, "EXPECTED");
  assert.equal(stepOf(r, "J-TEST/3/2"), undefined, "the branch step of the unchosen path is omitted");
  // a CHOSEN event with the other payload does not complete 2/1 (payload filter)
  const wrong = Mo.resolveLevels23(
    po([{ step_id: "J-TEST/2/1", actual: "COMPLETED", evidence_event_id: "e2" }]),
    J,
    [ev("e2", "CHOSEN", { c: "R" })],
  );
  assert.notEqual(stepOf(wrong, "J-TEST/2/1")?.state, "COMPLETED");
  // before any choice: both alternatives and both branch steps are Layer B ALTERNATIVE
  const none = Mo.resolveLevels23(
    po([{ step_id: "J-TEST/1/1", actual: "COMPLETED", evidence_event_id: "e1" }]),
    J,
    evs.slice(0, 1),
  );
  for (const id of ["J-TEST/2/1", "J-TEST/2/2", "J-TEST/3/1", "J-TEST/3/2"]) {
    const x = stepOf(none, id);
    assert.equal(x?.layer, "expected", id);
    assert.equal(x?.kind, "ALTERNATIVE", id);
  }
  // demo (W-C view when present): CF-19 shows exactly one direction COMPLETED (VOTE); every other direction is either not applicable
  // or a Layer B alternative marked «not chosen» — never completed, never plainly expected
  const m = Mo.buildNotificationModel(sc("CF-19"), rcp("CF-19", "SECRETARY"));
  const st2 = m.fields.l3_steps?.stages?.find((s) => s.n === 2);
  assert.ok(st2, "CF-19 Level 3 stage 2");
  const chosen = st2.steps.filter((s) => s.state === "COMPLETED");
  assert.deepEqual(
    chosen.map((s) => s.step_id),
    ["J-CHAIR-DIRECTION/2/4"],
  );
  for (const s of st2.steps.filter((x) => x.step_id !== "J-CHAIR-DIRECTION/2/4")) {
    assert.ok(
      (s.layer === "actual" && s.state === "NOT_APPLICABLE") ||
        (s.layer === "expected" &&
          s.kind === "ALTERNATIVE" &&
          (s.note === "NOT_SELECTED" || s.derived === "ALTERNATIVE_NOT_SELECTED")),
      JSON.stringify(s),
    );
  }
});

test("REN-07 a CONDITION stage is conditional until its applies_if matches, and NOT_APPLICABLE when excluded; visibility limits what each recipient class sees", () => {
  const st4 = (r: Mo.Levels23) => r.l2?.stages?.find((s) => s.n === 4);
  const plain = Mo.resolveLevels23(po(), J, []);
  assert.equal(st4(plain)?.layer, "expected");
  assert.equal(st4(plain)?.kind, "CONDITIONAL");
  assert.equal(st4(Mo.resolveLevels23(po(), J, [ev("c", "COND_MET")]))?.kind, "EXPECTED");
  assert.equal(
    st4(Mo.resolveLevels23(po(), J, [ev("c", "COND_MET", {}, true, { type: "TEST", id: "another-object" })]))
      ?.kind,
    "CONDITIONAL",
    "an out-of-scope event does not satisfy applies_if",
  );
  // W-C: an empty match list means «applies unless excluded»
  assert.equal(Mo.appliesIf({ match: [], excluded_by: [{ type: "X" }] }, []), "APPLIES");
  assert.equal(Mo.appliesIf({ match: [], excluded_by: [{ type: "X" }] }, [ev("x", "X")]), "EXCLUDED");
  const ex = Mo.resolveLevels23(po(), J, [ev("c", "COND_EXCLUDED")]);
  assert.equal(st4(ex)?.layer, "actual");
  assert.equal(st4(ex)?.state, "NOT_APPLICABLE");
  assert.ok(!(ex.l3?.stages ?? []).some((s) => s.n === 4));
  const pub = Mo.resolveLevels23(po(), J, [], { recipient_class: "REPORTER" });
  assert.deepEqual(
    (pub.l2?.stages ?? []).map((s) => s.n),
    [4, 5],
    "a public recipient sees only steps marked public",
  );
  assert.equal(
    Mo.resolveLevels23(po(), J, [], { recipient_class: "SECRETARY" }).l2?.capacity?.ar,
    "الأمانة",
    "capacity wording per recipient",
  );
  assert.equal(
    Mo.resolveLevels23(po(), J, [], { recipient_class: "WITNESS" }).l2?.stages?.length,
    0,
    "internal-only and public steps never reach a restricted participant",
  );
  assert.equal(
    Mo.resolveLevels23(po(), J, [], { recipient_class: "RECUSED_MEMBER" }).l2?.stages?.length,
    0,
    "a recused seat sees no steps (W-C RECIPIENT_POLICY)",
  );
});

test("REN-08 three levels on every internal output at every density (data-level 1, 2 and 3)", () => {
  const cards = html.filter((f) => INTERNAL.has(f.recipient));
  assert.ok(cards.length > 0);
  for (const f of cards)
    for (const n of [1, 2, 3]) assert.ok(f.content.includes(`data-level="${n}"`), `${f.file}: level ${n}`);
  console.warn("[diagnostic]", `internal outputs: ${cards.length}`);
});

test("REN-09 every e-mail has a plain-text twin: marking first and last, the subject, no markup", () => {
  const key = (f: B.DemoFile): string => [f.scenario, f.recipient, f.density, f.lang].join("|");
  const texts = new Map(DEMO.files.filter((f) => f.surface === "EMAIL_TEXT").map((f) => [key(f), f]));
  for (const f of DEMO.files.filter((x) => x.surface === "EMAIL_HTML")) {
    const tw = texts.get(key(f));
    assert.ok(tw, `${f.file}: no twin`);
    const lines = tw.content.trim().split("\n");
    assert.equal(lines[0], MARKING);
    assert.equal(lines.at(-1), MARKING);
    assert.ok(lines[2]?.startsWith("[DESIGN_PREVIEW]"), "subject line");
    assert.doesNotMatch(tw.content, /<\/?[a-z][^>]*>/i, `${tw.file}: markup in the text twin`);
    assert.ok(tw.content.length >= 40);
  }
});

test("REN-10 EML: CRLF only, no line over 998 octets, multipart/alternative (text then HTML), encoded subject, unsent draft, synthetic addresses", () => {
  const emls = DEMO.files.filter((f) => f.surface === "EML");
  assert.ok(emls.length > 0);
  for (const f of emls) {
    const s = f.content;
    assert.ok(!/[^\r]\n/.test(s) && !/\r(?!\n)/.test(s), `${f.file}: bare CR or LF`);
    for (const line of s.split("\r\n"))
      assert.ok(Buffer.byteLength(line, "utf8") <= 998, `${f.file}: long line`);
    const head = s.split("\r\n\r\n")[0] ?? "";
    for (const h of [
      "Date: ",
      "From: ",
      "To: ",
      "Subject: ",
      "Message-ID: <",
      "MIME-Version: 1.0",
      "X-Unsent: 1",
      "X-CDF-Marking: DESIGN_PREVIEW",
    ])
      assert.ok(head.includes(h), `${f.file}: ${h}`);
    assert.match(head, /Subject: =\?UTF-8\?B\?/);
    assert.match(head, /Content-Type: multipart\/(alternative|mixed)/);
    const iText = s.indexOf("Content-Type: text/plain");
    const iHtml = s.indexOf("Content-Type: text/html");
    assert.ok(iText > 0 && iHtml > iText, `${f.file}: text part precedes HTML`);
    for (const addr of head.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? [])
      assert.match(addr, /@(?:[a-z0-9-]+\.)*example\.test$/i, `${f.file}: ${addr}`);
  }
});

test("REN-11 Adaptive Card 1.0: allowed elements only, no actions or URLs, marking first and last, within the 28,000-byte project budget, compact fallback above it", () => {
  for (const f of DEMO.files.filter((x) => x.surface === "CARD")) {
    const card = JSON.parse(f.content) as { body: { text?: string }[] };
    assert.deepEqual(E.validateCard(card), [], f.file);
    assert.ok(
      Buffer.byteLength(f.content, "utf8") <= E.CARD_BUDGET_BYTES + 4096,
      "pretty-printed card stays near the budget",
    );
    assert.equal(card.body[0]?.text, MARKING);
  }
  const p = projected("CF-27", "MEMBER", "EMAIL");
  const rendered = E.renderComponents(p, { lang: "ar", density: "ADVANCED", experience: "EMAIL", tokens });
  const small = E.chooseCard(p, rendered, "ar", { budget: 600 });
  assert.equal(small.mode, "COMPACT_FALLBACK");
  assert.ok(small.full_bytes > 600);
  assert.deepEqual(E.validateCard(small.card), []);
  assert.ok(
    E.validateCard({
      type: "AdaptiveCard",
      version: "1.0",
      body: [{ type: "TextBlock", text: "DESIGN_PREVIEW" }],
      actions: [{ type: "Action.OpenUrl", url: "https://x.example.test" }],
    }).length > 0,
  );
  assert.ok(
    E.validateCard({
      type: "AdaptiveCard",
      version: "1.0",
      body: [{ type: "TextBlock", text: "see https://evil.example" }],
    }).some((x) => /URL/.test(x)),
  );
  assert.ok(
    E.validateCard({
      type: "AdaptiveCard",
      version: "1.0",
      body: [
        { type: "Input.Text", id: "x" },
        { type: "TextBlock", text: "DESIGN_PREVIEW" },
      ],
    }).some((x) => /not allowed/.test(x)),
  );
});

test("REN-12 Arabic outputs are RTL and English outputs LTR; both exist", () => {
  let ar = 0;
  let en = 0;
  for (const f of html) {
    const m = /<html lang="(ar|en)" dir="(rtl|ltr)">/.exec(f.content);
    assert.ok(m, `${f.file}: <html lang dir>`);
    assert.equal(m[1], f.lang);
    assert.equal(m[2], f.lang === "ar" ? "rtl" : "ltr");
    if (f.lang === "ar") ar++;
    else en++;
  }
  assert.ok(ar > 0 && en > 0);
});

test("REN-13 every output carries the design-preview marking; subjects start with [DESIGN_PREVIEW]", () => {
  for (const f of DEMO.files) {
    assert.ok(f.content.includes("DESIGN_PREVIEW"), `${f.file}: DESIGN_PREVIEW`);
    if (f.surface !== "EML") assert.ok(f.content.includes("بيانات اصطناعية"), `${f.file}: «بيانات اصطناعية»`);
    else assert.ok(f.content.includes("بيانات اصطناعية") || /=\?UTF-8\?B\?/.test(f.content), f.file);
  }
  for (const f of DEMO.files.filter((x) => x.surface === "EMAIL_TEXT"))
    assert.ok(f.content.split("\n")[2]?.startsWith("[DESIGN_PREVIEW]"));
});

test("REN-14 the demo covers CF-18, CF-19, CF-31, CF-35, CF-37, a witness, a reporter, a referring body and a subject statement request; the manifest shape holds", () => {
  const types = new Set(SCENARIOS.map((s) => s.type_code));
  for (const t of [
    "CHAIR_DIRECTION_INFO",
    "CHAIR_DIRECTION_VOTE",
    "PACKAGE_SUBMITTED_FOR_DELIBERATION",
    "AUTHORITY_DECISION_RECORDED",
    "DECISION_NOTICE_ISSUED",
    "WITNESS_SUMMONS",
    "REPORT_STATUS_CHANGED",
    "INSTITUTIONAL_REFERRAL_RECEIPT",
    "INTERVIEW_NOTICE",
  ])
    assert.ok(types.has(t), t);
  assert.ok(SCENARIOS.length >= 8);
  for (const f of DEMO.files) {
    assert.ok(B.SURFACES.includes(f.surface));
    assert.ok(["ar", "en"].includes(f.lang));
    assert.ok(DENSITIES.includes(f.density));
    if (f.surface === "EMAIL_HTML") assert.match(f.file, /email/);
    assert.match(
      f.file,
      /^scenarios\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+__[A-Z_]+__(COMPACT|STANDARD|ADVANCED)__(ar|en)\.(email\.html|email\.txt|eml|card\.json|platform\.html)$/,
    );
  }
  for (const cls of B.NO_PLATFORM_SURFACE)
    assert.ok(!DEMO.files.some((f) => f.recipient === cls && f.surface === "PLATFORM"), cls);
  assert.ok(!DEMO.files.some((f) => f.recipient === "REPORTER" && f.surface !== "PLATFORM"));
  assert.ok(DEMO.files.some((f) => f.recipient === "REPORTER" && f.surface === "PLATFORM"));
  const en = DEMO.files.filter((f) => f.lang === "en");
  for (const f of en)
    assert.equal(f.density, DEFAULT_DENSITY[f.recipient], `${f.file}: English at the default density`);
  const index = B.renderIndex({ ...DEMO, info: { marking: MARKING } });
  assert.ok(!/data-component=|data-layer=/.test(index), "the gallery carries no component or layer markers");
  assert.match(index, /<html lang="ar" dir="rtl">/);
});

test("REN-15 output is deterministic: the same inputs give byte-identical files", () => {
  const again = B.renderAll({ scenarios: inlineScenarios(), policy, authority });
  const h = (fs: readonly B.DemoFile[]): string =>
    fs.map((f) => f.file + ":" + createHash("sha256").update(f.content).digest("hex")).join("\n");
  assert.equal(h(again.files), h(DEMO.files));
});

test("REN-16 a calendar object is attached only when meeting_info survives the projection", () => {
  for (const f of DEMO.files.filter((x) => x.surface === "EML")) {
    const s = DEMO.records.find((r) => r.scenario === f.scenario && r.recipient === f.recipient);
    assert.ok(s, f.file);
    const allowed = s.logs.EMAIL?.meeting_info?.outcome === "ALLOWED";
    assert.equal(
      f.content.includes("invitation-design-preview.ics"),
      allowed,
      `${f.file}: .ics ${allowed ? "expected" : "not expected"}`,
    );
    if (allowed) assert.ok(f.content.includes("text/calendar"));
  }
});

test("REN-17 provenance: the catalogue (W-C when present and complete, else the W-D2 subset), resolver and authority version are recorded per model", () => {
  const m = Mo.buildNotificationModel(sc("CF-18"), rcp("CF-18", "SECRETARY"));
  assert.match(m.provenance.catalogue, /W-C src\/journeys\/catalogue_v13\.json|W-D2 subset/);
  assert.ok(m.provenance.resolver);
  assert.equal(m.provenance.authority_source, "W-F");
  const subset = Mo.loadCatalogue({ preferSubset: true });
  assert.equal(subset.master.length, 5);
  assert.ok(subset.__source?.includes("subset"));
  const e = Mo.resolveLevel1({ exists: false }, subset);
  assert.deepEqual(e, { exists: false }, "no case → no master journey");
  const l1 = Mo.resolveLevel1({ exists: true, status: { code: "S4.05" } }, subset);
  assert.equal(l1.position, 4);
});

// W-C's resolver/progress view take W-C's own catalogue/assignment types; the W-D2 Catalogue is the same JSON read openly
type WcCatalogue = Parameters<typeof R.resolveLevel2_3>[1];
type WcAssignment = Parameters<typeof R.resolveLevel2_3>[2];
const wcView = (
  object: ProceduralObject | null | undefined,
  cat: Mo.Catalogue,
  asg: Mo.Assignment | null | undefined,
  events: readonly DemoEvent[],
  cls: string,
) =>
  V.buildProgressView(
    null,
    R.resolveLevel2_3(
      object as Parameters<typeof R.resolveLevel2_3>[0],
      cat as unknown as WcCatalogue,
      (asg ?? null) as unknown as WcAssignment,
      events,
    ),
    cls,
  );

test("REN-18 Levels 2–3 come from W-C (resolve.js + progress.js + catalogue) when present; every rendered state is W-C’s and every COMPLETED step rests on in-scope evidence of its completion type", () => {
  // Port: lib/journeys is a static import, so a missing resolver fails (no skipped test in the committed suite).
  assert.ok(Mo.WC_RESOLVER_PRESENT(), "W-C resolver (lib/journeys) not present");
  const cat = Mo.loadCatalogue({});
  assert.match(cat.__source ?? "", /^W-C/);
  let checked = 0;
  for (const s of SCENARIOS)
    for (const r of s.recipients) {
      const m = Mo.buildNotificationModel(s, r);
      assert.equal(m.provenance.resolver, "W-C resolve.js + progress.js", `${s.id}/${r.class}`);
      assert.deepEqual(
        m.provenance.wc_diagnostics?.anomalies,
        [],
        `${s.id}/${r.class}: W-C anomalies in the synthetic scenario`,
      );
      assert.deepEqual(
        m.provenance.downgraded_steps,
        [],
        `${s.id}/${r.class}: a step claimed beyond its evidence`,
      );
      const asg = s.assignment_id ? cat.assignments?.find((a) => a.id === s.assignment_id) : null;
      const view = wcView(s.object, cat, asg, s.events ?? [], r.class);
      const wcState = new Map<string, string>([
        ...(view.level3?.actual ?? []).map((x) => [x.step_id, String(x.state)] as const),
        ...(view.level3?.expected ?? []).map((x) => [x.step_id, "B:" + x.kind] as const),
      ]);
      const mine = (m.fields.l3_steps?.stages ?? []).flatMap((st) => st.steps);
      assert.equal(
        mine.length,
        wcState.size,
        `${s.id}/${r.class}: same number of visible steps as the W-C view`,
      );
      const journey = cat.journeys.find((j) => j.id === s.object?.journey_id);
      assert.ok(journey, `${s.id}: journey`);
      const catStep = new Map(journey.stages.flatMap((st) => st.steps.map((x) => [x.id, x] as const)));
      const inScope = Mo.inScopeOf(s.object);
      for (const x of mine) {
        assert.equal(
          x.layer === "actual" ? x.state : "B:" + x.kind,
          wcState.get(x.step_id),
          `${s.id}/${r.class} ${x.step_id}`,
        );
        if (x.layer === "actual" && x.state === "COMPLETED") {
          const e = (s.events ?? []).find((y) => y.event_id === x.evidence_event_id);
          assert.ok(
            e && inScope(e) && e.recorded_at,
            `${s.id} ${x.step_id}: evidence ${x.evidence_event_id} recorded and in scope`,
          );
          assert.equal(
            e.type,
            catStep.get(x.step_id)?.completion_event_type,
            `${s.id} ${x.step_id}: completion type`,
          );
          assert.ok(
            Mo.payloadMatches(catStep.get(x.step_id)?.completion_payload ?? null, e.payload),
            `${s.id} ${x.step_id}: completion payload`,
          );
        }
        checked++;
      }
    }
  console.warn("[diagnostic]", `steps compared with the W-C view: ${checked}`);
  assert.ok(checked > 50);
});

test("REN-19 delivery wording follows the lead rulings: e-mail acceptance is «sent — delivery not confirmed» (L-07), in-app inbox (L-02), a read is never an acknowledgement, superseded only after the correction is sent (L-04)", () => {
  const w = (d: Parameters<typeof deliveryWording>[0], x = "EMAIL") => deliveryWording(d, x);
  assert.equal(w({ notification_status: "SENT" }).wording.ar, "أُرسل — لم يُؤكَّد التسليم");
  assert.equal(w({ notification_status: "SENT" }).wording.en, "Sent — delivery not confirmed");
  assert.equal(w({ notification_status: "DELIVERY_ACCEPTED_BY_PROVIDER" }).key, "SENT_EMAIL");
  assert.equal(
    w({ notification_status: "DELIVERY_CONFIRMED" }).key,
    "SENT_EMAIL",
    "no provider report → acceptance wording (fail safe)",
  );
  assert.equal(
    w({ notification_status: "DELIVERY_CONFIRMED", provider_report: true }).key,
    "DELIVERED_EMAIL_REPORT",
  );
  assert.equal(w({ notification_status: "SENT" }, "PLATFORM").key, "IN_APP");
  assert.equal(w({ notification_status: "DELIVERY_FAILED" }).key, "FAILED");
  const read = w({ notification_status: "SENT", read: true });
  assert.match(read.wording.en, /opening is not an acknowledgement/);
  assert.doesNotMatch(read.wording.en, /\backnowledged\b/i);
  assert.equal(
    w({ notification_status: "SUPERSEDED" }).key,
    "CORRECTION_PREPARING",
    "superseded without a sent correction is never shown as superseded",
  );
  assert.equal(w({ notification_status: "SUPERSEDED", superseded_by_sent: true }).key, "SUPERSEDED");
  const prep = w({ notification_status: "SENT", correction_in_progress: true });
  assert.equal(prep.key, "SENT_EMAIL");
  assert.match(prep.wording.en, /correction is being prepared; this notice is still the current version/);
  for (const k of ["SENT", "DELIVERY_CONFIRMED", "DELIVERY_ACCEPTED_BY_PROVIDER"])
    assert.doesNotMatch(w({ notification_status: k }).wording.en, /^Delivered/);
  // every demo output is an unsent preview: the DeliveryStatus line says DRAFT and never claims delivery
  for (const f of html.filter((x) => x.content.includes('data-component="DeliveryStatus"'))) {
    assert.match(f.content, /data-delivery="DRAFT"/, f.file);
    assert.doesNotMatch(textOf(f.content), /Delivered|سُلِّم بحسب/, f.file);
  }
});

test("REN-20 lead ruling L-05: no demo scenario emits a replaced W-C event name", () => {
  const replaced = [
    "GRIEVANCE_REGISTERED",
    "GRIEVANCE_CONCLUDED",
    "PROCEDURE_CLOSED",
    "REFERRAL_DECIDED",
    "REMINDER_ISSUED",
  ];
  for (const s of SCENARIOS)
    for (const e of s.events ?? []) assert.ok(!replaced.includes(e.type ?? ""), `${s.id}: ${e.type}`);
});

// ---- W-D1 consistency engine (lib/notifications/consistency; charter §8) -------------------------------------------
const WD1 = await B.loadWd1();
interface Wd1Detail {
  reason?: string;
  items?: Wd1Detail[];
  field?: string;
  form?: string;
  outcome?: string;
}
interface Wd1Result {
  ok: boolean;
  violations: { id: string; detail?: Wd1Detail }[];
}
interface Wd1CaseOptions {
  experience?: Experience;
  lang?: Lang;
  density?: Density;
  claims?: Scenario["claims"];
  tamper?: (h: string, m: Mo.NotificationModel) => string;
}
/** W-D1 context for one scenario × recipient × experience, rendered at one variant (optionally with tampered outputs) */
function wd1Case(
  id: string,
  cls: string,
  { experience = "EMAIL", lang = "en", density = "STANDARD", claims, tamper }: Wd1CaseOptions = {},
) {
  const s0 = sc(id);
  const s = claims ? { ...s0, claims } : s0;
  const r = rcp(id, cls);
  const catalogue = Mo.loadCatalogue({ needs: [s.object?.journey_id ?? ""] });
  const model = Mo.buildNotificationModel(s, r, { lang, authority, catalogue });
  const proj = project(model, { recipient: cls, channel: experience, context: model.meta.context, policy });
  let rendered: string[];
  if (experience === "EMAIL") {
    const out = E.renderEmail(proj, { lang, density, tokens });
    rendered = [out.html, out.text, JSON.stringify(out.card), out.eml ?? ""];
  } else rendered = [renderPlatform(proj, { lang, density, tokens }).html];
  if (tamper) rendered = rendered.map((x, i) => (i === 0 ? tamper(x, model) : x));
  assert.ok(WD1.fn);
  return {
    model,
    proj,
    res: WD1.fn(
      consistencyContext({ scenario: s, recipient: r, model, projected: proj, catalogue, rendered }),
    ) as Wd1Result,
  };
}
const details = (res: Wd1Result, id: string): (Wd1Detail | undefined)[] =>
  res.violations
    .filter((v) => v.id === id)
    .flatMap((v) => (v.detail?.reason === "MULTIPLE" ? (v.detail.items ?? []) : [v.detail]));

test("REN-21 W-D1 validate() passes on every rendered variant of every demo notification (no BLOCK); every claim cites a recorded event of its scenario", () => {
  assert.ok(WD1.fn, WD1.note);
  const { records } = B.renderAll({ scenarios: SCENARIOS, policy, authority, tokens, consistency: WD1.fn });
  const aggs = records.flatMap((r) =>
    Object.entries(r.consistency ?? {}).map(([exp, c]) => ({
      id: `${r.scenario}/${r.recipient}/${exp}`,
      ...c,
    })),
  );
  assert.ok(aggs.length >= 40, `recipient-experiences validated: ${aggs.length}`);
  for (const c of aggs) {
    assert.equal(c.ok, true, `${c.id}: ${JSON.stringify(c.violations)}`);
    assert.ok(c.variants >= 1, c.id);
  }
  const variants = aggs.reduce((a, c) => a + c.variants, 0);
  console.warn(
    "[diagnostic]",
    `W-D1 ${WD1.versions}: ${variants} rendered variants, ${aggs.length} recipient-experiences, ${aggs.filter((c) => c.warnings.length).length} with warnings`,
  );
  let claims = 0;
  for (const s of SCENARIOS)
    for (const [k, v] of Object.entries(s.claims ?? {})) {
      claims++;
      if (v && typeof v === "object") {
        const b = (v as { basis_event_id?: unknown }).basis_event_id;
        assert.ok(
          (s.events ?? []).some((e) => e.event_id === b && e.recorded_at),
          `${s.id} ${k}: basis ${String(b)}`,
        );
      }
    }
  assert.ok(claims >= 10, `claims stated by the demo wording: ${claims}`);
});

test("REN-22 W-D1 blocks what the renderer must never do: a withheld value re-introduced in a rendered output (PC-06), and wording that claims an unrecorded vote, decision, delivery, acknowledgement or sending (PC-01/02/14/15/16)", () => {
  assert.ok(WD1.fn, WD1.note);
  // baseline: the untampered outputs pass
  assert.equal(wd1Case("CF-18", "SECRETARY").res.ok, true);
  assert.equal(wd1Case("WIT", "WITNESS").res.ok, true);
  // the raw case number (SAFE_REFERENCE for an internal e-mail) put back into the HTML → PC-06 on case_number
  const a = wd1Case("CF-18", "SECRETARY", {
    tamper: (h, m) => h.replace("</body>", `<p>${String(m.fields.case_number)}</p></body>`),
  });
  assert.equal(a.proj._disclosure_log.case_number?.outcome, "SAFE_REFERENCE");
  assert.equal(a.res.ok, false);
  assert.ok(
    details(a.res, "PC-06").some(
      (d) => d?.field === "case_number" && d.form === "RAW" && d.outcome === "SAFE_REFERENCE",
    ),
    JSON.stringify(a.res.violations),
  );
  // a Level-1 stage name put back into a witness e-mail (witness sees no Level 1) → PC-06 on l1_stage_name
  const b = wd1Case("WIT", "WITNESS", {
    tamper: (h, m) => h.replace("</body>", `<p>${String(m.fields.l1_stage_name?.en)}</p></body>`),
  });
  assert.equal(b.res.ok, false);
  assert.ok(
    details(b.res, "PC-06").some((d) => d?.field === "l1_stage_name" && d.outcome === "PROHIBITED"),
    JSON.stringify(b.res.violations),
  );
  // the same on the platform surface (in-app): the raw case number re-introduced
  const c = wd1Case("CF-18", "SECRETARY", {
    experience: "PLATFORM",
    tamper: (h, m) => h.replace("</body>", `<p>${String(m.fields.case_number)}</p></body>`),
  });
  assert.equal(c.res.ok, false);
  // claims the record does not support
  const ids = (res: Wd1Result): string[] => res.violations.map((v) => v.id);
  assert.ok(
    ids(wd1Case("CF-19", "SECRETARY", { claims: { vote_open: true } }).res).includes("PC-02"),
    "a chair direction is not an opened vote",
  );
  assert.ok(
    ids(wd1Case("DEC-01", "AUTHORITY", { claims: { decision_issued: true } }).res).includes("PC-01"),
    "a raised recommendation is not a decision",
  );
  assert.ok(
    ids(wd1Case("CF-37", "SUBJECT", { claims: { delivered: true } }).res).includes("PC-15"),
    "an issued notice is not a delivered notice",
  );
  const d = (sc("CF-37D").events ?? []).find((e) => e.type === "DECISION_NOTICE_DELIVERED");
  assert.ok(d);
  const ack = wd1Case("CF-37D", "SUBJECT", {
    claims: { acknowledged: { value: true, basis_event_id: d.event_id } },
  }).res;
  assert.ok(
    details(ack, "PC-16").some((x) => x?.reason === "DELIVERY_USED_AS_ACKNOWLEDGEMENT"),
    "delivery (or a read) is never an acknowledgement (L-02)",
  );
  assert.ok(
    details(wd1Case("CF-18", "SECRETARY", { claims: { notification_sent: true } }).res, "PC-14").some(
      (x) => x?.reason === "NOTIFICATION_DRAFT_PRESENTED_AS_ISSUED",
    ),
    "a design preview never presents itself as sent",
  );
});

// W-C scenario fixture shape (lib/journeys/scenarios/*.json; open — only what this test reads)
interface FxItem {
  step_id: string;
  state?: string;
  kind?: string;
  note?: string;
}
interface FxVariant {
  id: string;
  events?: DemoEvent[];
  events_add?: DemoEvent[];
  events_replace?: { event_id: string; payload: Readonly<Record<string, unknown>> }[];
  case_patch?: Readonly<Record<string, unknown>>;
  procedural_object_patch?: Readonly<Record<string, unknown>>;
  expected?: FxExpected;
}
interface FxExpected {
  actual?: FxItem[];
  expected_steps?: FxItem[];
}
interface Fixture {
  id: string;
  recipient_class: string;
  title?: Bi;
  events: DemoEvent[];
  case: CaseRecord;
  procedural_object: ProceduralObject;
  assignment_id?: string | null;
  expected?: FxExpected;
  variants?: FxVariant[];
}

test("REN-23 W-C scenario fixtures (src/journeys/scenarios, when present): through W-D2’s model, every scenario and variant renders exactly W-C’s view for its recipient class, and W-C’s expected lists wherever the view hides nothing", () => {
  const dir = join(B.ROOT, "lib", "journeys", "scenarios");
  assert.ok(
    Mo.WC_RESOLVER_PRESENT() && existsSync(dir),
    "W-C resolver or scenario fixtures (lib/journeys) not present",
  );
  const cat = Mo.loadCatalogue({});
  // W-C variant semantics (scenario file header): events replace, events_add append, events_replace payloads, shallow patches
  const apply = (base: Fixture, v: FxVariant): Fixture => {
    let events = v.events ? [...v.events] : [...base.events];
    if (v.events_add) events = [...events, ...v.events_add];
    if (v.events_replace) {
      const rep = new Map(v.events_replace.map((x) => [x.event_id, x.payload]));
      events = events.map((e) => (rep.has(e.event_id) ? { ...e, payload: rep.get(e.event_id) } : e));
    }
    const kase: Record<string, unknown> = { ...base.case };
    for (const [k, x] of Object.entries(v.case_patch ?? {})) {
      if (x === null) delete kase[k];
      else kase[k] = x;
    }
    return {
      ...base,
      id: v.id,
      events,
      procedural_object: { ...base.procedural_object, ...(v.procedural_object_patch ?? {}) },
      case: kase,
      expected: v.expected ?? {},
    };
  };
  const line = (x: FxItem, layer: "A" | "B"): string =>
    `${x.step_id}:${layer === "A" ? x.state : x.kind}${x.note ? ":" + x.note : ""}`;
  let views = 0;
  let full = 0;
  let closed = 0;
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".json") && x !== "index.json")
    .sort()) {
    const base = JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture;
    for (const s of [base, ...(base.variants ?? []).map((v) => apply(base, v))]) {
      const cls = s.recipient_class;
      const scn: Scenario = {
        id: s.id,
        type_code: "WC_RESOLVER_SCENARIO",
        trigger_event_id: s.events.at(-1)?.event_id ?? null,
        case: s.case,
        object: s.procedural_object,
        events: s.events,
        content: { event_title: s.title ?? { ar: s.id, en: s.id } },
        assignment_id: s.assignment_id ?? null,
        recipients: [
          {
            class: cls,
            ref: "usr-demo-wc",
            actor: { capacity: cls, seat_active: true, recused: false },
            on_access_list: true,
          },
        ],
      };
      const r0 = scn.recipients[0];
      assert.ok(r0);
      const m = Mo.buildNotificationModel(scn, r0, { catalogue: cat, authority });
      assert.equal(m.provenance.resolver, "W-C resolve.js + progress.js", s.id);
      const steps = (m.fields.l3_steps?.stages ?? []).flatMap((st) => st.steps);
      const mineA = steps.filter((x) => x.layer === "actual").map((x) => line(x as FxItem, "A"));
      const mineB = steps.filter((x) => x.layer === "expected").map((x) => line(x as FxItem, "B"));
      const asg = s.assignment_id ? cat.assignments?.find((a) => a.id === s.assignment_id) : null;
      const view = wcView(s.procedural_object, cat, asg, s.events, cls);
      assert.deepEqual(
        mineA,
        (view.level3?.actual ?? []).map((x) => line(x as FxItem, "A")),
        `${s.id}/${cls}: Layer A = W-C view`,
      );
      assert.deepEqual(
        mineB,
        (view.level3?.expected ?? []).map((x) => line(x as FxItem, "B")),
        `${s.id}/${cls}: Layer B = W-C view`,
      );
      views++;
      if (!view.level3) {
        assert.equal(
          m.fields.l3_steps ?? null,
          null,
          `${s.id}/${cls}: no Level 3 when W-C renders none (fail closed)`,
        );
        closed++;
        continue;
      }
      if ((view.level3.hidden_steps ?? 0) > 0 || !Array.isArray(s.expected?.actual)) continue;
      assert.deepEqual(
        mineA,
        s.expected.actual.map((x) => line(x, "A")),
        `${s.id}/${cls}: W-C expected Layer A`,
      );
      assert.deepEqual(
        mineB,
        (s.expected.expected_steps ?? []).map((x) => line(x, "B")),
        `${s.id}/${cls}: W-C expected Layer B`,
      );
      full++;
    }
  }
  console.warn(
    "[diagnostic]",
    `W-C fixtures: ${views} scenario views compared, ${full} also against W-C's expected lists, ${closed} closed (no Level 3 for the class)`,
  );
  assert.ok(views >= 20 && full >= 15);
});

test("REN-24 details show what was recorded: AuditReference shows the audit id, never «غير متاح» for a recorded id; EvidenceReference isolates the event id and the event type in Arabic outputs", () => {
  let audits = 0;
  let evid = 0;
  for (const f of html.filter((x) => x.density === "ADVANCED" && INTERNAL.has(x.recipient))) {
    const a = f.content.match(
      /data-component="AuditReference"[\s\S]*?data-field="audit_refs"[^>]*>([\s\S]*?)<\/p>/,
    );
    if (a) {
      audits++;
      assert.doesNotMatch(a[1] ?? "", /غير متاح|Not available/, `${f.file}: recorded audit id not shown`);
      assert.match(
        a[1] ?? "",
        /<bdi dir="ltr"[^>]*>aud-demo-[a-z0-9-]+<\/bdi>/,
        `${f.file}: audit id isolated`,
      );
    }
    for (const m of f.content.matchAll(/data-field="evidence_refs"[^>]*>([\s\S]*?)<\/(?:li|p)>/g)) {
      evid++;
      if (f.lang === "ar")
        assert.match(
          m[1] ?? "",
          /^<bdi dir="ltr"[^>]*>[^<]+<\/bdi> — <bdi dir="ltr"[^>]*>[A-Z0-9_]+<\/bdi>/,
          `${f.file}: evidence reference not isolated`,
        );
    }
  }
  console.warn("[diagnostic]", `AuditReference blocks ${audits}, evidence reference items ${evid}`);
  assert.ok(audits >= 10 && evid >= 10, `audit blocks ${audits}, evidence items ${evid}`);
});
