/** BADGE — ADR-013 data-epistemic mapping (rulings 28 Oct 2026 01:54, 02:00 UTC). Synthetic data only. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import {
  toBadgeEpistemic,
  BADGE_EPISTEMIC_VALUES,
  COMPLETED_CLASS_STATUSES,
  isCompletedClassStatus,
  type BadgeInput,
} from "@/lib/domain/badge";
import * as Domain from "@/lib/domain";
import { CONCEPT_IDS, getConcept } from "@/lib/domain/concepts";
import { STATUS_OBJECTS } from "@/lib/domain/status";
import { EPISTEMIC_CLASSES } from "@/lib/domain/epistemic";
import type { DomainEvent } from "@/lib/domain/types";

const CASE_A = "00000000-0000-4000-8000-00000000000a";
const CASE_B = "00000000-0000-4000-8000-00000000000b";
const BALLOT = "00000000-0000-4000-8000-0000000000b1";
let n = 0;
function ev(type: string, payload: Record<string, unknown> = {}, caseId = CASE_A): DomainEvent {
  n += 1;
  const t = new Date(Date.parse("2026-10-01T08:00:00Z") + n * 60e3).toISOString();
  return {
    event_id: `evt-badge-${String(n).padStart(3, "0")}`,
    type,
    occurred_at: t,
    recorded_at: t,
    case_id: caseId,
    object: { type: "BALLOT", id: BALLOT },
    payload,
  } as DomainEvent;
}
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return "NO_THROW";
};

describe("BADGE — epistemic class → data-epistemic", () => {
  const opened = ev("BALLOT_OPENED");
  const closed = ev("BALLOT_CLOSED", { result: "APPROVED" });

  test("BADGE-01 the four DOM values are exactly ADR-013's", () => {
    assert.deepEqual(
      [...BADGE_EPISTEMIC_VALUES],
      ["recorded", "expected", "conditional", "awaiting_approval"],
    );
  });
  test("BADGE-02 RECORDED_FACT → recorded with its event id; without one it is refused", () => {
    assert.deepEqual(toBadgeEpistemic({ epistemic: "RECORDED_FACT", event_id: "evt-1" }), {
      value: "recorded",
      event_id: "evt-1",
    });
    for (const event_id of ["", "  ", null, undefined, 7]) {
      assert.equal(
        code(() => toBadgeEpistemic({ epistemic: "RECORDED_FACT", event_id } as unknown as BadgeInput)),
        "EVENT_ID_REQUIRED",
      );
    }
  });
  test("BADGE-03 EXPECTED_PROCESS, CONDITIONAL_STEP, SUBJECT_TO_APPROVAL → expected, conditional, awaiting_approval, never with an event id", () => {
    assert.deepEqual(toBadgeEpistemic({ epistemic: "EXPECTED_PROCESS" }), {
      value: "expected",
      event_id: null,
    });
    assert.deepEqual(toBadgeEpistemic({ epistemic: "CONDITIONAL_STEP" }), {
      value: "conditional",
      event_id: null,
    });
    assert.deepEqual(toBadgeEpistemic({ epistemic: "SUBJECT_TO_APPROVAL" }), {
      value: "awaiting_approval",
      event_id: null,
    });
    for (const epistemic of ["EXPECTED_PROCESS", "CONDITIONAL_STEP", "SUBJECT_TO_APPROVAL"]) {
      assert.equal(
        code(() => toBadgeEpistemic({ epistemic, event_id: "evt-1" } as unknown as BadgeInput)),
        "EVENT_ID_NOT_ALLOWED",
        epistemic,
      );
    }
  });
  test("BADGE-04 PROPOSED_ACTION, UNVERIFIED_INFORMATION, NOT_APPLICABLE and anything unknown are never a badge", () => {
    for (const epistemic of [
      "PROPOSED_ACTION",
      "UNVERIFIED_INFORMATION",
      "NOT_APPLICABLE",
      "COMPLETED",
      "",
      null,
      "__proto__",
    ]) {
      assert.equal(
        code(() => toBadgeEpistemic({ epistemic } as unknown as BadgeInput)),
        "NO_BADGE_VALUE",
        String(epistemic),
      );
    }
    assert.equal(
      code(() => toBadgeEpistemic(null as unknown as BadgeInput)),
      "NO_BADGE_VALUE",
    );
    // every domain class is either mapped or refused: nothing falls through
    const mapped = EPISTEMIC_CLASSES.filter(
      (c) => code(() => toBadgeEpistemic({ epistemic: c } as unknown as BadgeInput)) !== "NO_BADGE_VALUE",
    );
    assert.deepEqual(mapped.sort(), [
      "CONDITIONAL_STEP",
      "DERIVED_FROM_VERIFIED_FACTS",
      "EXPECTED_PROCESS",
      "RECORDED_FACT",
    ]);
  });
  test("BADGE-05 DERIVED_FROM_VERIFIED_FACTS → recorded only when the fold gives the shown status; the event id is the fold's source event", () => {
    const r = toBadgeEpistemic({
      epistemic: "DERIVED_FROM_VERIFIED_FACTS",
      derivation: {
        case_id: CASE_A,
        object_type: "BALLOT",
        object_id: BALLOT,
        shown_status: "COMPLETED",
        events: [closed, opened],
      },
    });
    assert.deepEqual(r, { value: "recorded", event_id: closed.event_id });
  });
  test("BADGE-06 negative: a derived status the fold does not produce is refused (stale, invented, or no events)", () => {
    const d = (shown_status: string, events: DomainEvent[]) => () =>
      toBadgeEpistemic({
        epistemic: "DERIVED_FROM_VERIFIED_FACTS",
        derivation: { case_id: CASE_A, object_type: "BALLOT", object_id: BALLOT, shown_status, events },
      });
    assert.equal(code(d("COMPLETED", [opened])), "DERIVATION_UNSUPPORTED", "only opened: not completed");
    assert.equal(
      code(d("FAILED", [opened, closed])),
      "DERIVATION_UNSUPPORTED",
      "another status than the fold",
    );
    assert.equal(code(d("OPEN", [])), "DERIVATION_UNSUPPORTED", "no recorded event");
  });
  test("BADGE-07 negative: another case's event in a derivation is refused, never dropped silently", () => {
    const foreign = ev("BALLOT_CLOSED", { result: "APPROVED" }, CASE_B);
    assert.equal(
      code(() =>
        toBadgeEpistemic({
          epistemic: "DERIVED_FROM_VERIFIED_FACTS",
          derivation: {
            case_id: CASE_A,
            object_type: "BALLOT",
            object_id: BALLOT,
            shown_status: "COMPLETED",
            events: [opened, foreign],
          },
        }),
      ),
      "CROSS_CASE_EVENT",
    );
  });
  test("BADGE-08 negative: a derivation that is missing or malformed, or whose events do not fold, is refused", () => {
    assert.equal(
      code(() => toBadgeEpistemic({ epistemic: "DERIVED_FROM_VERIFIED_FACTS" } as unknown as BadgeInput)),
      "DERIVATION_REQUIRED",
    );
    assert.equal(
      code(() =>
        toBadgeEpistemic({
          epistemic: "DERIVED_FROM_VERIFIED_FACTS",
          derivation: {
            case_id: CASE_A,
            object_type: "BALLOT",
            object_id: "",
            shown_status: "COMPLETED",
            events: [],
          },
        }),
      ),
      "DERIVATION_REQUIRED",
    );
    const badClose = ev("BALLOT_CLOSED", { result: "OTHER" });
    assert.equal(
      code(() =>
        toBadgeEpistemic({
          epistemic: "DERIVED_FROM_VERIFIED_FACTS",
          derivation: {
            case_id: CASE_A,
            object_type: "BALLOT",
            object_id: BALLOT,
            shown_status: "COMPLETED",
            events: [opened, badClose],
          },
        }),
      ),
      "DERIVATION_NOT_FOLDABLE",
    );
  });
  test("BADGE-09 results are frozen", () => {
    assert.ok(Object.isFrozen(toBadgeEpistemic({ epistemic: "RECORDED_FACT", event_id: "evt-1" })));
    assert.ok(Object.isFrozen(toBadgeEpistemic({ epistemic: "EXPECTED_PROCESS" })));
  });
  test("BADGE-10 rule T5: the completed-class list is exported from lib/domain, exactly the eleven statuses", () => {
    assert.deepEqual(
      [...COMPLETED_CLASS_STATUSES],
      [
        "COMPLETED",
        "APPROVED",
        "SENT",
        "DELIVERED",
        "DECIDED",
        "CLOSED",
        "ADOPTED",
        "DELIVERY_CONFIRMED",
        "MINUTES_FINAL",
        "ACCEPTED_BY_PROVIDER",
        "SUBSTANTIATED",
      ],
    );
    assert.ok(Object.isFrozen(COMPLETED_CLASS_STATUSES));
    assert.equal(
      Domain.COMPLETED_CLASS_STATUSES,
      COMPLETED_CLASS_STATUSES,
      "re-exported by the lib/domain index",
    );
    assert.equal(isCompletedClassStatus("IN_PROGRESS"), false);
    assert.equal(isCompletedClassStatus(null), false);
    // The list refuses; it never gives an object a status. Three entries are guards, not V13 statuses: APPROVED is an
    // outcome value in payloads; DELIVERED is forbidden as a status (ST-08, INV-10); ALLEGATION has no status object
    // (SOURCE_REQUIRED, INV-15), so SUBSTANTIATED is never shown from the model either. The rest are domain states.
    const states = new Set(Object.values(STATUS_OBJECTS).flatMap((o) => [...o.states]));
    for (const c of CONCEPT_IDS) for (const t of getConcept(c).transitions) states.add(t.to);
    assert.deepEqual(
      COMPLETED_CLASS_STATUSES.filter((s) => !states.has(s)),
      ["APPROVED", "DELIVERED", "SUBSTANTIATED"],
      "only the three documented guards are outside the domain states",
    );
  });
  test("BADGE-11 negative (rule T5): an expected, conditional or awaiting-approval badge never shows a completed-class status", () => {
    for (const epistemic of ["EXPECTED_PROCESS", "CONDITIONAL_STEP", "SUBJECT_TO_APPROVAL"] as const) {
      for (const shown_status of COMPLETED_CLASS_STATUSES) {
        assert.equal(
          code(() => toBadgeEpistemic({ epistemic, shown_status })),
          "COMPLETED_STATUS_NOT_RECORDED",
          `${epistemic} ${shown_status}`,
        );
      }
      // a step code or a not-yet state passes
      for (const shown_status of ["J-DEMO-COMMITTEE/2/1", "NOT_STARTED", "PENDING", null]) {
        assert.equal(
          toBadgeEpistemic({ epistemic, shown_status }).event_id,
          null,
          `${epistemic} ${String(shown_status)}`,
        );
      }
    }
    // a recorded badge may show one (the status rests on its event)
    assert.equal(toBadgeEpistemic({ epistemic: "RECORDED_FACT", event_id: "evt-1" }).value, "recorded");
  });
  test("BADGE-12 negative (SEC LOW, rule T5): a variant spelling of a status is refused, never matched as not completed", () => {
    for (const shown_status of [
      "completed",
      " COMPLETED",
      "Completed",
      "COMPLETED ",
      "completed_class",
      "Sent",
      "j-demo/1",
    ]) {
      assert.equal(
        isCompletedClassStatus(shown_status),
        true,
        `predicate fails closed on ${JSON.stringify(shown_status)}`,
      );
      for (const epistemic of ["EXPECTED_PROCESS", "CONDITIONAL_STEP", "SUBJECT_TO_APPROVAL"] as const) {
        assert.equal(
          code(() => toBadgeEpistemic({ epistemic, shown_status })),
          "SHOWN_STATUS_NOT_A_CODE",
          `${epistemic} ${JSON.stringify(shown_status)}`,
        );
      }
    }
    // well-formed codes outside the list, step codes and null pass
    for (const shown_status of [
      "IN_PROGRESS",
      "NOT_STARTED",
      "J-DEMO-COMMITTEE/2/1",
      "J-WB-REPORTER",
      null,
    ]) {
      assert.equal(isCompletedClassStatus(shown_status), false, String(shown_status));
      assert.equal(toBadgeEpistemic({ epistemic: "EXPECTED_PROCESS", shown_status }).value, "expected");
    }
    assert.equal(isCompletedClassStatus(42), false, "a non-string is no status at all");
  });
});
