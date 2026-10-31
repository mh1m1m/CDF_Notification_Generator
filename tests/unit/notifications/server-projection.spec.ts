/**
 * SPB — server binding of the W-D2 projection (OPEN_ISSUES OI-035, SEC's two LOWs on #40).
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. Synthetic scenarios and ids only.
 *
 * The projection context comes only from server records (the case row's `is_restricted` and the server's access-list
 * result), never from the model or the request; the recipient class comes only from the database recipient row.
 * Everything missing, malformed or of another case is refused. No fallback to `*`.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import * as D from "@/lib/disclosure";
import { buildNotificationModel, buildProjected } from "@/lib/notifications/render/model";
import { renderEmail } from "@/lib/notifications/render/email";
import {
  NotificationBindingError,
  projectForRecipient,
  serverProjectionContext,
  type ServerProjectionRecords,
} from "@/lib/notifications/binding/server-projection";
import { inlineScenarios } from "@/tests/unit/notifications/support/scenarios_inline";
import type { Recipient, Scenario } from "@/lib/notifications/render/types";

const policy = D.loadPolicy();
const SCENARIOS = inlineScenarios();
const CASE_A = "00000000-0000-4000-8000-00000000a001";
const CASE_B = "00000000-0000-4000-8000-00000000b002";
const codeIs = (code: string) => (e: unknown) => (e as { code?: unknown }).code === code;

const scenario = (id: string): Scenario => {
  const s = SCENARIOS.find((x) => x.id === id);
  assert.ok(s, `inline scenario ${id}`);
  return s;
};
const recipientOf = (s: Scenario, cls: string): Recipient => {
  const r = s.recipients.find((x) => x.class === cls);
  assert.ok(r, `${s.id} has a ${cls} recipient`);
  return r;
};
const records = (
  cls: string,
  { restricted, onList, delivery }: { restricted: boolean; onList?: boolean; delivery?: string },
): ServerProjectionRecords => ({
  case_record: { id: CASE_A, is_restricted: restricted },
  recipient_row: {
    case_id: CASE_A,
    recipient_class: cls,
    ...(delivery ? { delivery_context: delivery } : {}),
  },
  ...(onList === undefined ? {} : { access_list: { case_id: CASE_A, on_access_list: onList } }),
});
const outcomes = (p: D.ProjectedModel) =>
  Object.fromEntries(Object.entries(p._disclosure_log).map(([f, l]) => [f, l.outcome]));

// CF-31R: a recommendations package on a restricted case (CDF-DEMO-2026-0032); the member is not on the access list
const RESTRICTED = scenario("CF-31R");
const MEMBER = recipientOf(RESTRICTED, "MEMBER");

describe("SPB the projection context comes from server records only", () => {
  test("SPB-01 a restricted case projects under CASE_RESTRICTED for a recipient the server does not list, whatever the model claims", () => {
    const model = buildNotificationModel(RESTRICTED, MEMBER);
    // the model claims the least restrictive context: no tags and on the access list
    const forged = { ...model, meta: { ...model.meta, context: { tags: [], on_access_list: true } } };
    const viaServer = projectForRecipient(forged, records("MEMBER", { restricted: true, onList: false }));
    const restricted = D.project(model, {
      recipient: "MEMBER",
      context: { tags: ["CASE_RESTRICTED"], on_access_list: false },
      policy,
    });
    const open = D.project(forged, { recipient: "MEMBER", policy });
    assert.deepEqual(outcomes(viaServer), outcomes(restricted));
    assert.deepEqual(viaServer.fields, restricted.fields);
    assert.notDeepEqual(
      outcomes(viaServer),
      outcomes(open),
      "the model's claim would have widened the projection",
    );
    assert.deepEqual(viaServer._disclosure_summary.effective_context, ["CASE_RESTRICTED"]);
    assert.equal(viaServer._disclosure_summary.on_access_list, false);
  });

  test("SPB-02 the access-list result decides on_access_list; the model's own value is never read", () => {
    const model = buildNotificationModel(RESTRICTED, { ...MEMBER, on_access_list: true });
    assert.equal(model.meta.context.on_access_list, true, "fixture: the model claims the list");
    const notListed = projectForRecipient(model, records("MEMBER", { restricted: true, onList: false }));
    assert.deepEqual(notListed._disclosure_summary.effective_context, ["CASE_RESTRICTED"]);
    assert.equal(notListed._disclosure_summary.on_access_list, false);
    const listed = projectForRecipient(model, records("MEMBER", { restricted: true, onList: true }));
    assert.equal(listed._disclosure_summary.on_access_list, true);
    assert.deepEqual(
      outcomes(listed),
      outcomes(
        D.project(model, {
          recipient: "MEMBER",
          context: { tags: ["CASE_RESTRICTED"], on_access_list: true },
          policy,
        }),
      ),
    );
  });

  test("SPB-03 the context of an unrestricted case ignores a model context, and the server context object is frozen", () => {
    const s = scenario("CF-31");
    const r = recipientOf(s, "MEMBER");
    const model = buildNotificationModel(s, r);
    const forged = {
      ...model,
      meta: { ...model.meta, context: { tags: ["CASE_RESTRICTED"], on_access_list: false } },
    };
    const p = projectForRecipient(forged, records("MEMBER", { restricted: false }));
    assert.deepEqual(outcomes(p), outcomes(D.project(model, { recipient: "MEMBER", context: "*", policy })));
    const ctx = serverProjectionContext(records("MEMBER", { restricted: false }));
    assert.deepEqual(ctx.context, { tags: [], on_access_list: false });
    assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.context) && Object.isFrozen(ctx.context.tags));
  });

  test("SPB-04 EXTERNAL is added for a referring body and for a recipient row delivered outside CDF; CASE_PUBLIC is never derived", () => {
    assert.deepEqual(serverProjectionContext(records("REFERRING_BODY", { restricted: false })).context.tags, [
      "EXTERNAL",
    ]);
    assert.deepEqual(
      serverProjectionContext(records("WITNESS", { restricted: false, delivery: "EXTERNAL" })).context.tags,
      ["EXTERNAL"],
    );
    assert.deepEqual(
      serverProjectionContext(records("WITNESS", { restricted: true, onList: false, delivery: "EXTERNAL" }))
        .context.tags,
      ["CASE_RESTRICTED", "EXTERNAL"],
    );
    assert.deepEqual(
      serverProjectionContext(records("WITNESS", { restricted: false, delivery: "INTERNAL" })).context.tags,
      [],
    );
  });

  test("SPB-05 a context or recipient passed by the caller is refused (CONTEXT_NOT_ACCEPTED)", () => {
    const model = buildNotificationModel(RESTRICTED, MEMBER);
    const rec = records("MEMBER", { restricted: true, onList: false });
    const refused = codeIs("CONTEXT_NOT_ACCEPTED");
    // the options type has no context or recipient: they come from server records only
    // @ts-expect-error context is not an option
    assert.throws(() => projectForRecipient(model, rec, { context: "*" }), refused);
    assert.throws(
      // @ts-expect-error context is not an option
      () => projectForRecipient(model, rec, { context: { tags: [], on_access_list: true } }),
      refused,
    );
    // @ts-expect-error recipient is not an option
    assert.throws(() => projectForRecipient(model, rec, { recipient: "MEMBER" }), refused);
  });
});

describe("SPB the disclosure policy is the server's", () => {
  test("SPB-13 a caller-supplied policy is refused (POLICY_NOT_ACCEPTED), even the committed one", () => {
    const model = buildNotificationModel(RESTRICTED, MEMBER);
    const rec = records("MEMBER", { restricted: true, onList: false });
    const permissive = {
      version: "X",
      rows: [{ recipient: "*", field: "*", channel: "*", outcome: "ALLOWED" }],
    };
    for (const p of [permissive, policy, null, undefined])
      assert.throws(
        // @ts-expect-error policy is not an option: the server's committed policy is used
        () => projectForRecipient(model, rec, { policy: p }),
        (e: unknown) => e instanceof NotificationBindingError && codeIs("POLICY_NOT_ACCEPTED")(e),
      );
  });

  test("SPB-14 the projection uses the committed policy", () => {
    const model = buildNotificationModel(RESTRICTED, MEMBER);
    const p = projectForRecipient(model, records("MEMBER", { restricted: true, onList: false }));
    assert.equal(p._disclosure_summary.policy_version, policy.version);
    assert.equal(p._disclosure_summary.policy_source, policy.source);
  });
});

describe("SPB fail closed on missing, malformed or other-case records", () => {
  const model = buildNotificationModel(RESTRICTED, MEMBER);
  const good = records("MEMBER", { restricted: true, onList: false });
  const cases: Array<[string, unknown, string]> = [
    ["no records", undefined, "NO_SERVER_CONTEXT"],
    ["null records", null, "NO_SERVER_CONTEXT"],
    ["no case record", { ...good, case_record: undefined }, "NO_SERVER_CONTEXT"],
    ["case id empty", { ...good, case_record: { id: "", is_restricted: true } }, "NO_SERVER_CONTEXT"],
    ["is_restricted missing", { ...good, case_record: { id: CASE_A } }, "NO_SERVER_CONTEXT"],
    [
      "is_restricted as text",
      { ...good, case_record: { id: CASE_A, is_restricted: "false" } },
      "NO_SERVER_CONTEXT",
    ],
    [
      "is_restricted null",
      { ...good, case_record: { id: CASE_A, is_restricted: null } },
      "NO_SERVER_CONTEXT",
    ],
    ["no recipient row", { ...good, recipient_row: undefined }, "NO_RECIPIENT_ROW"],
    ["recipient class missing", { ...good, recipient_row: { case_id: CASE_A } }, "NO_RECIPIENT_ROW"],
    [
      "recipient row of another case",
      { ...good, recipient_row: { case_id: CASE_B, recipient_class: "MEMBER" } },
      "CASE_MISMATCH",
    ],
    ["restricted, no access-list result", { ...good, access_list: undefined }, "NO_ACCESS_LIST_RESULT"],
    ["restricted, access list null", { ...good, access_list: null }, "NO_ACCESS_LIST_RESULT"],
    [
      "restricted, access-list flag as text",
      { ...good, access_list: { case_id: CASE_A, on_access_list: "true" } },
      "NO_ACCESS_LIST_RESULT",
    ],
    [
      "access list of another case",
      { ...good, access_list: { case_id: CASE_B, on_access_list: true } },
      "CASE_MISMATCH",
    ],
  ];
  for (const [name, rec, code] of cases)
    test(`SPB-06 ${name} → ${code}`, () => {
      assert.throws(
        () => projectForRecipient(model, rec as ServerProjectionRecords),
        (e: unknown) => e instanceof NotificationBindingError && codeIs(code)(e),
      );
    });

  test("SPB-07 a model of another case (meta.case_id) is refused", () => {
    const other = { ...model, meta: { ...model.meta, case_id: CASE_B } };
    assert.throws(() => projectForRecipient(other, good), codeIs("CASE_MISMATCH"));
    const same = { ...model, meta: { ...model.meta, case_id: CASE_A } };
    assert.ok(D.isProjected(projectForRecipient(same, good)));
  });
});

describe("SPB the recipient class comes from the database recipient row", () => {
  test("SPB-08 a model built for another class than the row is refused (RECIPIENT_MISMATCH)", () => {
    const model = buildNotificationModel(RESTRICTED, MEMBER);
    assert.throws(
      () => projectForRecipient(model, records("SECRETARY", { restricted: true, onList: true })),
      codeIs("RECIPIENT_MISMATCH"),
    );
  });

  test("SPB-09 a row class the policy does not know is refused, the database's own codes included (UNKNOWN_RECIPIENT)", () => {
    const model = buildNotificationModel(RESTRICTED, MEMBER);
    // CASE_TEAM, COMMITTEE_MEMBERS, SUBJECT_EMPLOYEE, GOVERNANCE: migration 0004's codes, not policy classes (mapping raised with ARCH, never guessed)
    for (const cls of ["CASE_TEAM", "COMMITTEE_MEMBERS", "SUBJECT_EMPLOYEE", "GOVERNANCE", "member", "", "*"])
      assert.throws(
        () => projectForRecipient(model, records(cls, { restricted: true, onList: false })),
        codeIs("UNKNOWN_RECIPIENT"),
        cls,
      );
  });

  test("SPB-10 a model with no recipient class takes the row's class", () => {
    const model = buildNotificationModel(RESTRICTED, MEMBER);
    const { recipient_class: _dropped, ...meta } = model.meta;
    void _dropped;
    const p = projectForRecipient({ ...model, meta }, records("MEMBER", { restricted: true, onList: false }));
    assert.equal(p.meta.recipient_class, "MEMBER");
  });
});

describe("SPB parity with the reference fixtures and the renderers", () => {
  test("SPB-11 for every inline scenario, recipient and experience, server records equal to the fixture give the reference projection", () => {
    let n = 0;
    for (const s of SCENARIOS)
      for (const r of s.recipients)
        for (const experience of ["EMAIL", "PLATFORM"] as const) {
          const ref = buildProjected(s, r, { experience, policy });
          const cls = s.case?.classification;
          const restricted = cls === "RESTRICTED" || cls === "SECRET";
          const viaServer = projectForRecipient(
            ref.model,
            records(r.class, {
              restricted,
              ...(restricted ? { onList: r.on_access_list === true } : {}),
              ...(typeof r.delivery_context === "string" ? { delivery: r.delivery_context } : {}),
            }),
            { channel: experience },
          );
          assert.deepEqual(outcomes(viaServer), outcomes(ref.projected), `${s.id}/${r.class}/${experience}`);
          assert.deepEqual(viaServer.fields, ref.projected.fields, `${s.id}/${r.class}/${experience}`);
          n++;
        }
    assert.ok(n >= 50, `${n} projections compared`);
  });

  test("SPB-12 the server projection carries the Projected brand the renderers require", () => {
    const s = scenario("CF-31");
    const model = buildNotificationModel(s, recipientOf(s, "SECRETARY"));
    const p = projectForRecipient(model, records("SECRETARY", { restricted: false }));
    assert.ok(D.isProjected(p) && Object.isFrozen(p));
    const out = renderEmail(p);
    assert.equal(typeof out.html, "string");
  });
});
