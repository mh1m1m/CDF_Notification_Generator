/**
 * NA — smart next authorized action (W-D2 lib/notifications/next-action/rules.ts, charter §7). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
 * Ported from tests/next_action.test.js (node:test → Vitest).
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import * as NA from "@/lib/notifications/next-action/rules";
import { loadAuthority, actionOf } from "@/lib/authority/check";
import { loadPolicy } from "@/lib/disclosure/project";
import { buildNotificationModel } from "@/lib/notifications/render/model";
import { inlineScenarios } from "@/tests/unit/notifications/support/scenarios_inline";
import { renderAll } from "@/tests/unit/notifications/support/build_demo";
import { demoUuid } from "@/lib/notifications/render/escape";
import type { Scenario, Recipient } from "@/lib/notifications/render/types";

const authority = loadAuthority();
const policy = loadPolicy();
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
const derive = (s: Scenario, r: unknown, extra: Partial<NA.DeriveNextActionInput> = {}): NA.NextAction =>
  NA.deriveNextAction({
    notification_type: s.type_code,
    recipient: r,
    procedural_object: { ...s.object, events: s.events },
    case: s.case,
    authority_model: authority,
    events: s.events,
    ...extra,
  });
const INFO = "للاطلاع فقط — لا يلزم إجراء حالياً";

test("NA-01 no next-action text uses the completed symbol or the words سُجل / اكتُمل / تم in an expected-process item", () => {
  const bad: string[] = [];
  for (const [type, byClass] of Object.entries(NA.RULES))
    for (const [cls, rule] of Object.entries(byClass)) {
      for (const w of [...(rule.what_next ?? []), ...(rule.what_next_read_only ?? [])]) {
        assert.ok(NA.WHAT_NEXT_KINDS.includes(w.kind), `${type}/${cls}: kind ${w.kind}`);
        const v = NA.layerBViolations(w.ar);
        if (v.length) bad.push(`${type}/${cls}: ${v.join(",")} in «${w.ar}»`);
      }
    }
  assert.deepEqual(bad, []);
  assert.deepEqual(NA.layerBViolations("تم إرسال الطلب"), ["تم"]);
  assert.ok(NA.layerBViolations("✔ خطوة").includes("✔"));
});

test("NA-02 every action a rule proposes exists in the W-F authority model (no invented actions)", () => {
  const missing: string[] = [];
  for (const [type, byClass] of Object.entries(NA.RULES))
    for (const [cls, rule] of Object.entries(byClass)) {
      for (const id of [rule.action_id, ...(rule.optional_rights ?? []).map((o) => o.action_id)].filter(
        Boolean,
      ))
        if (!actionOf(authority, id)) missing.push(`${type}/${cls}: ${id}`);
      if (rule.kind) assert.ok(NA.NEXT_ACTION_KINDS.includes(rule.kind), `${type}/${cls}: kind ${rule.kind}`);
    }
  assert.deepEqual(missing, []);
});

test("NA-03 informational notices print exactly «للاطلاع فقط — لا يلزم إجراء حالياً»; unknown types and recipients are informational", () => {
  assert.equal(NA.INFORMATIONAL_TEXT.ar, INFO);
  const r = NA.deriveNextAction({
    notification_type: "NO_SUCH_TYPE",
    recipient: { class: "SECRETARY", actor: { capacity: "SECRETARY", seat_active: true } },
    procedural_object: {},
    authority_model: authority,
  });
  assert.equal(r.kind, "NONE");
  assert.equal(r.ar, INFO);
  assert.equal(r.informational, true);
  assert.equal(r.deadline, null);
  const c = derive(sc("CF-35"), rcp("CF-35", "CHAIR"));
  assert.equal(c.kind, "NONE");
  assert.equal(c.ar, INFO);
});

test("NA-04 the opening of a vote is never inferred from a direction: READ_ONLY until MEETING_OPENED is recorded, then APPROVE_ACTION", () => {
  const before = derive(sc("CF-19"), rcp("CF-19", "SECRETARY"));
  assert.equal(before.kind, "READ_ONLY");
  assert.equal(before.authority?.code, "PRECONDITION_MISSING");
  assert.ok(before.ar.startsWith("للاطلاع فقط — "));
  assert.equal(before.how.link_kind, "NONE", "a read-only action carries no link");
  assert.equal(before.deadline, null);
  const after = derive(sc("CF-19M"), rcp("CF-19M", "SECRETARY"));
  assert.equal(after.kind, "APPROVE_ACTION");
  assert.equal(after.authority?.result, "ALLOWED");
  assert.equal(after.how.link_kind, "PLATFORM_DEEP_LINK");
  assert.match(after.how.path ?? "", /^\/meetings\/[0-9a-f-]{36}$/);
  assert.equal(after.release_status, "BASIS_RECORDED");
});

test("NA-05 a member reads only until the ballot opens; a recused member reads only; the secretary schedules the meeting", () => {
  const m = derive(sc("CF-31"), rcp("CF-31", "MEMBER"));
  assert.equal(m.kind, "READ_ONLY");
  assert.equal(m.authority?.code, "PRECONDITION_MISSING");
  const opened: Scenario = {
    ...sc("CF-31"),
    events: [
      ...(sc("CF-31").events ?? []),
      {
        event_id: "evt-demo-na05-ballot",
        type: "BALLOT_OPENED",
        occurred_at: "2026-10-27T10:00:00+03:00",
        recorded_at: "2026-10-27T10:00:00+03:00",
      },
    ],
  };
  const m2 = derive(opened, rcp("CF-31", "MEMBER"));
  assert.equal(m2.kind, "DECIDE");
  assert.equal(m2.authority?.result, "ALLOWED");
  const rec = derive(opened, rcp("CF-31", "RECUSED_MEMBER"));
  assert.equal(rec.kind, "READ_ONLY");
  assert.equal(rec.authority?.code, "RECUSED");
  const s = derive(sc("CF-31"), rcp("CF-31", "SECRETARY"));
  assert.equal(s.kind, "COMPLETE_DOCUMENTS");
  assert.equal(s.authority?.action_id, "SCHEDULE_MEETING");
  assert.equal(s.authority?.result, "ALLOWED");
});

test("NA-06 no deadline without a recorded basis event, a sourced rule and a zoned date", () => {
  const ev = [{ event_id: "evt-1", type: "GRIEVANCE_WINDOW_STARTED" }];
  const ok = {
    kind: "GRIEVANCE_DUE",
    at: "2026-11-26T09:40:00+03:00",
    basis_event_id: "evt-1",
    basis_rule: "DEC-F15",
    basis_event_type: "GRIEVANCE_WINDOW_STARTED",
  };
  assert.equal(NA.resolveDeadline(ok, ev).deadline?.at, ok.at);
  const why = (rec: NA.DeadlineRecord | null, events: readonly NA.EventLike[] = ev) =>
    NA.resolveDeadline(rec, events).reason?.detail;
  assert.equal(why(null), "NO_DEADLINE_RECORD");
  assert.equal(why({ ...ok, basis_event_id: null }), "NO_BASIS_EVENT");
  assert.equal(why({ ...ok, basis_rule: "" }), "NO_BASIS_RULE");
  assert.equal(why({ ...ok, basis_rule: "SOURCE_REQUIRED" }), "RULE_SOURCE_REQUIRED");
  assert.equal(why(ok, []), "BASIS_EVENT_NOT_RECORDED");
  assert.equal(why({ ...ok, basis_event_type: "DECISION_NOTICE_ISSUED" }), "BASIS_EVENT_TYPE_MISMATCH");
  assert.equal(why({ ...ok, at: "2026-11-26T09:40:00" }), "INVALID_DATE", "a date without a zone is refused");
  assert.equal(why({ ...ok, at: "26/11/2026" }), "INVALID_DATE");
  for (const r of [null, { ...ok, basis_rule: "SOURCE_REQUIRED" }])
    assert.equal(NA.resolveDeadline(r, ev).reason?.code, "SOURCE_REQUIRED");
});

test("NA-07 the grievance right shows no date until the window start is recorded (CF-37), then the DEC-F15 date with its basis (CF-37D)", () => {
  const a = derive(sc("CF-37"), rcp("CF-37", "SUBJECT"));
  assert.equal(a.kind, "NONE");
  const g = a.optional_rights.find((o) => o.action_id === "FILE_GRIEVANCE");
  assert.ok(g, "FILE_GRIEVANCE is offered (DECISION_NOTICE_ISSUED recorded)");
  assert.equal(g.deadline, null);
  assert.equal(g.deadline_reason?.detail, "BASIS_EVENT_NOT_RECORDED");
  const b = derive(sc("CF-37D"), rcp("CF-37D", "SUBJECT"));
  const g2 = b.optional_rights.find((o) => o.action_id === "FILE_GRIEVANCE");
  assert.equal(g2?.deadline?.at, "2026-11-26T09:40:00+03:00");
  assert.equal(g2?.deadline?.basis_rule, "DEC-F15");
  assert.equal(g2?.deadline?.basis_event_type, "GRIEVANCE_WINDOW_STARTED");
  // the defence period is never invented (DEC-F18 / D11-064)
  const d = derive(sc("CF-23"), rcp("CF-23", "SUBJECT"));
  assert.equal(d.deadline, null);
  assert.equal(d.deadline_reason?.code, "SOURCE_REQUIRED");
});

test("NA-08 deep links carry ids only, for the object types notify.deep_link maps", () => {
  const id = demoUuid("na08");
  assert.equal(NA.deepLinkPath("MEETING", id), `/meetings/${id}`);
  assert.equal(NA.deepLinkPath("DEFENCE_NOTICE", id), `/my-defence/${id}`);
  assert.equal(NA.deepLinkPath("MINUTES", id), `/minutes/${id}`);
  assert.equal(NA.deepLinkPath("CASE", id), null, "no case deep link");
  assert.equal(
    NA.deepLinkPath("MEETING", "CDF-DEMO-2026-0019"),
    null,
    "a business number is never a link key",
  );
  assert.equal(NA.deepLinkPath("MEETING", `${id}/../../admin`), null);
  assert.equal(NA.deepLinkPath("MEETING", id.toUpperCase()), null);
});

test("NA-09 how: the reporter follows the portal page; the authority decides outside the platform via the secretariat mailbox", () => {
  const r = derive(sc("RPT"), rcp("RPT", "REPORTER"));
  assert.equal(r.how.channel, "PORTAL");
  assert.equal(r.how.app, "WHISTLEBLOWING_WEB");
  assert.equal(r.how.path, "/follow-up");
  const a = derive(sc("DEC-01"), rcp("DEC-01", "AUTHORITY"));
  assert.equal(a.kind, "DECIDE");
  assert.equal(a.how.channel, "SECRETARIAT_MAILBOX");
  assert.equal(a.how.link_kind, "NONE");
  const w = derive(sc("WIT"), rcp("WIT", "WITNESS"));
  assert.equal(w.kind, "SUBMIT_STATEMENT");
  assert.equal(w.how.channel, "SECRETARIAT_MAILBOX");
  assert.equal(w.deadline, null, "attendance confirmation period has no source");
});

test("NA-10 a precomputed authority result for another action is refused (fail closed)", () => {
  const s = sc("CF-31");
  const r = derive(s, rcp("CF-31", "SECRETARY"), {
    authority_check: { action_id: "CAST_VOTE", result: "ALLOWED", effect: "ALLOWED", code: "ALLOWED" },
  });
  assert.equal(r.kind, "READ_ONLY");
  assert.equal(r.authority?.code, "AUTHORITY_CHECK_MISMATCH");
  const r2 = derive(s, rcp("CF-31", "SECRETARY"), {
    authority_check: () => ({ result: "DENIED", effect: "DENIED", code: "NO_ROLE" }),
  });
  assert.equal(r2.kind, "READ_ONLY");
});

test("NA-11 capacity comes only from recipient.actor.capacity, never from the class name", () => {
  const s = sc("CF-31");
  const r = derive(s, { class: "SECRETARY", actor: {} });
  assert.equal(r.kind, "READ_ONLY", "no capacity → no action");
  const r2 = derive(s, { class: "SECRETARY", actor: { capacity: "MEMBER", seat_active: true } });
  assert.notEqual(r2.authority?.result, "ALLOWED");
});

test("NA-12 every recipient of every inline scenario gets a next action, and the action card is in every rendered output (READ_ONLY and NONE included)", () => {
  for (const s of SCENARIOS)
    for (const r of s.recipients) {
      const m = buildNotificationModel(s, r, { authority });
      assert.ok(
        (NA.NEXT_ACTION_KINDS as readonly unknown[]).includes(m.fields.next_action?.kind),
        `${s.id}/${r.class}`,
      );
    }
  const demo = renderAll({ scenarios: SCENARIOS, policy, authority });
  const html = demo.files.filter((f) => f.surface === "EMAIL_HTML" || f.surface === "PLATFORM");
  for (const f of html) assert.ok(f.content.includes('data-component="SmartNextActionCard"'), f.file);
  const info = demo.files.filter(
    (f) => f.surface === "EMAIL_TEXT" && f.scenario === "CF-35" && f.recipient === "CHAIR" && f.lang === "ar",
  );
  assert.ok(info.length > 0 && info.every((f) => f.content.includes(INFO)));
  console.warn("[diagnostic]", `${html.length} HTML outputs carry the action card`);
});
