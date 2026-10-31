/**
 * AUT — authority check (W-D2 lib/authority/check.ts against W-F's lib/authority/authority_v13.json, charter §6).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * AUT-01 … AUT-73 are W-F's reference vectors, one test each (result AND code must match W-F's reference); AUT-101+ are
 * W-D2's own fail-closed checks. Ported from tests/authority.test.js (node:test → Vitest).
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as A from "@/lib/authority";
import RAW_JSON from "@/lib/authority/authority_v13.json";

interface Vector {
  id: string;
  action: string;
  actor?: A.Actor;
  object?: Record<string, unknown>;
  purpose?: string;
  manual_operation?: boolean;
  reference_result: string;
  reference_code: string;
  expect: string;
}
interface RawAction {
  action_id: string;
  governing_source: { status: string; ref?: unknown };
  roles: Record<string, string[] | undefined>;
  preconditions?: Array<{ event_type: string }>;
}
interface Raw {
  version: string;
  status: string;
  tests: Vector[];
  actions: RawAction[];
  admin_capacities_never_case_actors: string[];
}

const P = (rel: string) => new URL(rel, import.meta.url);
const RAW = RAW_JSON as unknown as Raw;
const M = A.loadAuthority();
const VECTORS: Vector[] = Array.isArray(RAW.tests) ? RAW.tests : [];

const run = (t: Vector) =>
  A.check(M, {
    action_id: t.action,
    actor: t.actor,
    object: t.object,
    purpose: t.purpose,
    manual_operation: t.manual_operation,
  });

// ---- W-F reference vectors (one test per vector) ---------------------------------------------------------------
for (const t of VECTORS) {
  test(`${t.id} W-F vector: ${t.action} by ${(t.actor?.capacity as string | undefined) ?? "—"} (${t.purpose ?? "EXECUTE"}) → ${t.reference_result} / ${t.reference_code}`, () => {
    const r = run(t);
    assert.equal(r.result, t.reference_result, `result for ${t.id}`);
    assert.equal(r.code, t.reference_code, `code for ${t.id}`);
    assert.equal(r.result, t.expect, `W-F expect for ${t.id}`);
    if (r.result !== "ALLOWED")
      assert.notEqual(r.effect, "ALLOWED", "fail closed: a non-ALLOWED result never has an ALLOWED effect");
  });
}

// ---- W-D2 checks -----------------------------------------------------------------------------------------------
test("AUT-100 W-F publishes 73 reference vectors and every one is exercised above", () => {
  assert.equal(VECTORS.length, 73);
  assert.equal(new Set(VECTORS.map((t) => t.id)).size, 73);
  let pass = 0;
  for (const t of VECTORS) {
    const r = run(t);
    if (r.result === t.reference_result && r.code === t.reference_code) pass++;
  }
  assert.equal(pass, 73, `final AUT reference pass count ${pass}/73`);
});

test("AUT-101 the only authority model is W-F authority_v13.json; VIEW_PUBLIC_STATUS rests on an OWNER_DECISION, never an unsourced APPROVED", () => {
  assert.equal(M.source, "W-F");
  assert.equal(M.version, RAW.version);
  assert.equal(M.status, RAW.status);
  const v = RAW.actions.find((a) => a.action_id === "VIEW_PUBLIC_STATUS");
  assert.ok(v, "VIEW_PUBLIC_STATUS exists in the W-F model");
  assert.equal(v.governing_source.status, "OWNER_DECISION");
  for (const a of RAW.actions) {
    assert.ok(
      (A.SOURCE_STATUSES as readonly string[]).includes(a.governing_source?.status),
      `${a.action_id}: governing status ${a.governing_source?.status}`,
    );
    if (a.governing_source.status === "APPROVED")
      assert.ok(a.governing_source.ref, `${a.action_id}: APPROVED without a source`);
  }
  // port: the source text check reads the ported lib file instead of src/authority/check.js
  const src = readFileSync(fileURLToPath(P("../../../lib/authority/check.ts")), "utf8").replace(
    /\/\/.*$|\/\*[\s\S]*?\*\//gm,
    "",
  );
  assert.ok(!/provisional/.test(src), "check.js must not load the provisional model");
});

test("AUT-102 a missing, unreadable or empty authority model fails closed (NO_AUTHORITY_MODEL)", () => {
  // port: lib/ has no file system access; the loader takes the override model as an object or JSON string instead of a path
  assert.throws(
    () => A.loadAuthority({ path: "absent.json", model: undefined }),
    (e: A.AuthorityError) => e.code === "NO_AUTHORITY_MODEL",
  );
  assert.throws(
    () => A.loadAuthority({ path: "bad.json", model: "[[[" }),
    (e: A.AuthorityError) => e.code === "NO_AUTHORITY_MODEL",
  );
  assert.throws(
    () =>
      A.loadAuthority({
        path: "empty.json",
        model: JSON.parse(JSON.stringify({ version: "X", actions: [] })),
      }),
    (e: A.AuthorityError) => e.code === "NO_AUTHORITY_MODEL",
  );
});

test("AUT-103 unknown actions are SOURCE_REQUIRED and malformed requests are DENIED — never ALLOWED", () => {
  const u = A.check(M, {
    action_id: "DELETE_AUDIT_LEDGER",
    actor: { capacity: "SECRETARY", seat_active: true },
    object: {},
  });
  assert.equal(u.result, "SOURCE_REQUIRED");
  assert.equal(u.code, "UNKNOWN_ACTION");
  assert.notEqual(u.effect, "ALLOWED");
  for (const actor of [undefined, null, {}, { capacity: "" }, { capacity: 42 }]) {
    const r = A.check(M, { action_id: "SCHEDULE_MEETING", actor, object: {} });
    assert.notEqual(r.result, "ALLOWED", JSON.stringify(actor));
  }
  assert.equal(A.isAllowed({ result: "ALLOWED" }), false, "isAllowed needs both result and effect");
  assert.equal(A.isAllowed(null), false);
});

test("AUT-104 administrative capacities never act as case actors on any action (PROT-§21)", () => {
  const bad: string[] = [];
  for (const cap of RAW.admin_capacities_never_case_actors)
    for (const a of RAW.actions)
      for (const purpose of ["EXECUTE", "DRAFT"]) {
        const r = A.check(M, {
          action_id: a.action_id,
          actor: { capacity: cap, seat_active: true },
          object: { events: [{ type: "MEETING_OPENED" }] },
          purpose,
          manual_operation: true,
        });
        if (r.result === "ALLOWED") bad.push(`${cap} ${a.action_id} ${purpose}`);
      }
  assert.deepEqual(bad, []);
});

test("AUT-105 DECIDE ≠ ISSUE_DECISION_NOTICE: the authority decides but does not issue the notice; the secretary issues it but never decides", () => {
  const ev = (...t: string[]) => ({ events: t.map((type) => ({ type })) });
  const auth = { capacity: "AUTHORITY", seat_active: true };
  const sec = { capacity: "SECRETARY", seat_active: true };
  assert.equal(
    A.check(M, { action_id: "DECIDE", actor: auth, object: ev("PACKAGE_SUBMITTED_TO_AUTHORITY") }).result,
    "ALLOWED",
  );
  assert.notEqual(
    A.check(M, {
      action_id: "ISSUE_DECISION_NOTICE",
      actor: auth,
      object: { ...ev("AUTHORITY_DECISION_RECORDED"), decision_final: true },
    }).result,
    "ALLOWED",
  );
  assert.equal(
    A.check(M, {
      action_id: "ISSUE_DECISION_NOTICE",
      actor: sec,
      object: { ...ev("AUTHORITY_DECISION_RECORDED"), decision_final: true },
    }).result,
    "ALLOWED",
  );
  assert.notEqual(
    A.check(M, { action_id: "DECIDE", actor: sec, object: ev("PACKAGE_SUBMITTED_TO_AUTHORITY") }).result,
    "ALLOWED",
  );
  // a decision that is not final (RETURN_TO_COMMITTEE) cannot be notified
  assert.notEqual(
    A.check(M, {
      action_id: "ISSUE_DECISION_NOTICE",
      actor: sec,
      object: { ...ev("AUTHORITY_DECISION_RECORDED"), decision_final: false },
    }).result,
    "ALLOWED",
  );
  // the decision is never inferred from the recommendation: no recorded decision → no notice
  assert.notEqual(
    A.check(M, {
      action_id: "ISSUE_DECISION_NOTICE",
      actor: sec,
      object: { ...ev("RECOMMENDATION_ADOPTED"), decision_final: true },
    }).result,
    "ALLOWED",
  );
});

test("AUT-106 an action whose basis is SOURCE_REQUIRED is never ALLOWED for execution; DRAFT + manual operation is a labelled design preview only", () => {
  const sr = RAW.actions.filter(
    (a) => a.governing_source.status === "SOURCE_REQUIRED" || a.governing_source.status === "DRAFT",
  );
  assert.ok(sr.length > 0);
  for (const a of sr) {
    const caps = [
      ...new Set([
        ...(a.roles.executor ?? []),
        ...(a.roles.decision_maker ?? []),
        ...(a.roles.approver ?? []),
        ...(a.roles.preparer ?? []),
      ]),
    ];
    for (const capacity of caps) {
      const actor = { capacity, seat_active: true, recused: false };
      const r = A.check(M, {
        action_id: a.action_id,
        actor,
        object: { events: (a.preconditions ?? []).map((p) => ({ type: p.event_type })) },
        purpose: "EXECUTE",
      });
      assert.notEqual(r.result, "ALLOWED", `${a.action_id} by ${capacity}`);
      const d = A.check(M, {
        action_id: a.action_id,
        actor,
        object: {},
        purpose: "DRAFT",
        manual_operation: true,
      });
      if (d.result === "ALLOWED") {
        assert.equal(d.code, "SOURCE_REQUIRED_DRAFT");
        assert.notEqual(d.release_status, "BASIS_RECORDED");
      }
    }
  }
});

test("AUT-107 mutation: removing the recorded precondition, ending the seat or recusing the actor turns every ALLOWED vector into a refusal", () => {
  const allowed = VECTORS.filter((t) => t.expect === "ALLOWED" && (t.purpose ?? "EXECUTE") === "EXECUTE");
  assert.ok(allowed.length > 0);
  const bad: string[] = [];
  for (const t of allowed) {
    const action = RAW.actions.find((a) => a.action_id === t.action);
    assert.ok(action);
    if ((action.preconditions ?? []).length) {
      const r = A.check(M, {
        action_id: t.action,
        actor: t.actor,
        object: { ...t.object, events: [] },
        purpose: "EXECUTE",
      });
      if (r.result === "ALLOWED") bad.push(`${t.id}: allowed without its precondition`);
    }
    if (t.actor?.capacity !== "SYSTEM") {
      const r2 = A.check(M, {
        action_id: t.action,
        actor: { ...t.actor, seat_active: false },
        object: t.object,
        purpose: "EXECUTE",
      });
      if (r2.result === "ALLOWED") bad.push(`${t.id}: allowed with an ended seat`);
    }
    const r3 = A.check(M, {
      action_id: t.action,
      actor: { ...t.actor, recused: true },
      object: t.object,
      purpose: "EXECUTE",
    });
    if (r3.result === "ALLOWED") bad.push(`${t.id}: allowed while recused`);
  }
  assert.deepEqual(bad, []);
});

test("AUT-108 a vote is cast only by the voter themself and never opened from a direction alone", () => {
  const mem = { capacity: "MEMBER", seat_active: true, recused: false };
  assert.equal(
    A.check(M, {
      action_id: "CAST_VOTE",
      actor: mem,
      object: { events: [{ type: "BALLOT_OPENED" }], own_vote: true },
    }).result,
    "ALLOWED",
  );
  assert.notEqual(
    A.check(M, {
      action_id: "CAST_VOTE",
      actor: mem,
      object: { events: [{ type: "BALLOT_OPENED" }], own_vote: false },
    }).result,
    "ALLOWED",
  );
  assert.notEqual(
    A.check(M, { action_id: "CAST_VOTE", actor: mem, object: { events: [{ type: "BALLOT_OPENED" }] } })
      .result,
    "ALLOWED",
    "missing own_vote fails closed",
  );
  const sec = { capacity: "SECRETARY", seat_active: true };
  assert.notEqual(
    A.check(M, {
      action_id: "OPEN_FORMAL_VOTE",
      actor: sec,
      object: { events: [{ type: "CHAIR_DIRECTION_RECORDED", payload: { direction: "VOTE" } }] },
    }).result,
    "ALLOWED",
  );
  assert.notEqual(
    A.check(M, {
      action_id: "OPEN_FORMAL_VOTE",
      actor: sec,
      object: { events: [{ type: "MEETING_OPENED" }, { type: "MEETING_CLOSED" }] },
    }).result,
    "ALLOWED",
    "expires when the meeting closes",
  );
});

test("AUT-109 every check result names its model version and source, and a reason in both languages", () => {
  for (const t of VECTORS) {
    const r = run(t);
    assert.ok((A.RESULTS as readonly string[]).includes(r.result));
    assert.equal(r.model_version, RAW.version);
    assert.equal(r.model_source, "W-F");
    assert.ok(r.reason && typeof r.reason.ar === "string" && typeof r.reason.en === "string", t.id);
  }
});
