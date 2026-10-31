// PC — procedural consistency engine (charter §8; directive §16). Author: W-D1.
// Every rule has a violating and a passing context; V12 replays rebuild the context of a V12 notice from the verified
// evidence (the quoted line is re-read from the V12 package when it is on this machine, read-only) and show which rule
// blocks it. Synthetic-data reference implementation; not CDF production. Ids PC-xx (run_and_record groups them as PC).
import { test, describe, type TestContext } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as disclosureProject from "@/lib/disclosure/project";
import {
  validate,
  explain,
  RULES,
  META_RULES,
  CHARTER_MINIMUM,
  RULES_VERSION,
  ENGINE_VERSION,
  assertMinimumRuleSet,
  assertRuleSet,
} from "@/lib/notifications/consistency/engine";
import { CLAIMS, DEADLINE_KIND_TRIGGERS } from "@/lib/notifications/consistency/rules";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", ".."); // repository root (lib/…)
/** Read-only copies of the V12 files the replays quote, under their own file names (tests/unit/notifications/__evidence__). */
const EVIDENCE = join(HERE, "__evidence__");
/** V12 files ARCH ruled are never copied into the repository: the sample e-mails and the generator sample texts. */
const NOT_COPIED = /^(?:eml\/|generator\/samples\/)/;
const evidencePath = (rel: string): string => join(EVIDENCE, rel.split("/").at(-1) ?? rel);

// ------------------------------------------------------------------------------------------------ fixtures ---------
const CASE_ID = "00000000-0000-4000-8000-0000000000c1";
const OBJ = Object.freeze({
  MEETING: "00000000-0000-4000-8000-0000000000e1",
  BALLOT: "00000000-0000-4000-8000-0000000000b1",
  RECOMMENDATION: "00000000-0000-4000-8000-0000000000d1",
  DECISION: "00000000-0000-4000-8000-0000000000d2",
  OPINION: "00000000-0000-4000-8000-0000000000d3",
  REFERRAL: "00000000-0000-4000-8000-0000000000d4",
  PROCEDURE: "00000000-0000-4000-8000-0000000000d5",
});
const T = (day: number, hm = "10:00") => `2026-10-${String(day).padStart(2, "0")}T${hm}:00+03:00`;
const ev = (
  event_id: string,
  type: string,
  occurred_at: string,
  object: { type: string; id: string } | null = null,
  payload: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  event_id,
  type,
  occurred_at,
  recorded_at: occurred_at,
  case_id: CASE_ID,
  object,
  actor: { capacity: "SECRETARY", id: "usr-secretary-synthetic" },
  provenance: { source: "SYNTHETIC_DEMO", ref: "tests/consistency.test.js" },
  version: 1,
  causation_id: null,
  correlation_id: "corr-pc",
  payload,
  ...extra,
});
const MEETING = { type: "MEETING", id: OBJ.MEETING };
const CASE = Object.freeze({
  case_id: CASE_ID,
  internal_ref: "CDF-DEMO-2026-0001",
  track: "IR",
  classification: "INTERNAL",
  status: { code: "S3.01", recorded_at: T(5), source_event_id: "evt-status" },
  flags: { suspended: false, returned: false, cancelled: false, reopened: false, closed: false },
  restrictions: { rca_required: false },
  exists: true,
});
const TRIGGER = ev("evt-trigger", "MEETING_SCHEDULED", T(20), MEETING);

/** A consistent baseline context (meeting invitation, recorded trigger, existing case); `over` replaces parts. */
/** Overrides of the baseline context; deliberately loose (violating contexts are built on purpose). */
interface CtxOverrides {
  notification?: Record<string, unknown>;
  events?: unknown[];
  [key: string]: unknown;
}
function ctx({ notification = {}, events = [], ...rest }: CtxOverrides = {}): Record<string, unknown> {
  return {
    notification: {
      type_code: "MEETING_INVITATION",
      trigger_event_id: "evt-trigger",
      claims: {},
      fields_shown: [],
      ...notification,
    },
    case: CASE,
    procedural_object: null,
    events: [TRIGGER, ...events],
    progress: { actual: [], expected: [] },
    disclosure_log: {},
    authority: null,
    alternative_groups: [],
    ...rest,
  };
}

type Result = ReturnType<typeof validate>;
type Detail =
  { readonly reason?: unknown; readonly items?: readonly { readonly reason?: unknown }[] } | null | undefined;
const reasonsOf = (d: Detail) =>
  d?.reason === "MULTIPLE" ? (d.items ?? []).map((i) => i.reason) : [d?.reason];
const ids = (r: Result) => [...r.violations, ...r.warnings].map((v) => v.id);

function fires(c: unknown, id: string, reason?: string): Result {
  const r = validate(c);
  const hit = [...r.violations, ...r.warnings].filter((v) => v.id === id);
  assert.ok(hit.length > 0, `${id} expected to fire; fired: ${JSON.stringify(ids(r))}`);
  if (reason)
    assert.ok(
      hit.some((v) => reasonsOf(v.detail).includes(reason)),
      `${id}: reason ${reason} expected, got ${JSON.stringify(hit.map((v) => v.detail))}`,
    );
  const rule = RULES.find((x) => x.id === id);
  if (rule?.severity === "BLOCK") assert.equal(r.ok, false, `${id} is BLOCK: ok must be false`);
  return r;
}

function clean(c: unknown): Result {
  const r = validate(c);
  assert.deepEqual(
    r.violations.map((v) => `${v.id}:${JSON.stringify(v.detail)}`),
    [],
    "passing context must not fire any BLOCK rule",
  );
  assert.equal(r.ok, true);
  return r;
}

// ------------------------------------------------------------------------------- V12 evidence (read-only) --------
function emlPlainText(rel: string): string | null {
  const p = evidencePath(rel);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  const i = raw.search(/Content-Type: text\/plain/i);
  if (i < 0) return null;
  const part = raw.slice(i);
  const sep = part.search(/\r?\n\r?\n/);
  const cte = (/Content-Transfer-Encoding:\s*([\w-]+)/i.exec(part.slice(0, sep))?.[1] ?? "").toLowerCase();
  let body = part.slice(sep).replace(/^\r?\n\r?\n/, "");
  const end = body.search(/\r?\n--/);
  if (end >= 0) body = body.slice(0, end);
  if (cte === "quoted-printable") {
    body = body.replace(/=\r?\n/g, "");
    const bytes: number[] = [];
    for (let k = 0; k < body.length; k += 1) {
      if (body[k] === "=" && /^[0-9A-F]{2}$/i.test(body.slice(k + 1, k + 3))) {
        bytes.push(parseInt(body.slice(k + 1, k + 3), 16));
        k += 2;
      } else bytes.push(body.charCodeAt(k) & 0xff);
    }
    return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
  }
  if (cte === "base64")
    return new TextDecoder().decode(
      Uint8Array.from(atob(body.replace(/\s+/g, "")), (ch) => ch.charCodeAt(0)),
    );
  return body;
}

/** Re-reads «quote» at line `n` of a V12 file when the package is present; records a diagnostic otherwise. */
function evidenceLine(
  _t: TestContext,
  rel: string,
  n: number,
  quote: string,
  { plain = false }: { plain?: boolean } = {},
) {
  const text = plain
    ? existsSync(evidencePath(rel))
      ? readFileSync(evidencePath(rel), "utf8")
      : null
    : emlPlainText(rel);
  if (text === null) {
    // Only the V12 sample e-mails and sample texts may be absent: ARCH ruled they are never copied into the repository.
    // Every other quoted file is in __evidence__, and a missing one fails instead of passing silently.
    assert.ok(
      NOT_COPIED.test(rel),
      `V12 evidence ${rel} is missing from __evidence__ (only eml/ and generator/samples/ may be absent)`,
    );
    console.warn(
      "[diagnostic]",
      `V12 evidence ${rel} not in the repository (EML/sample, ARCH ruling): quote verified only in the reference package run (UNVERIFIED here)`,
    );
    return;
  }
  const line = text.split(/\r?\n/)[n - 1] ?? "";
  assert.ok(line.includes(quote), `${rel} L${n} should contain «${quote}», found «${line.trim()}»`);
}

// ======================================================================================== rules: PC-01 … PC-28 =====
describe("PC-01 decision described as issued requires AUTHORITY_DECISION_RECORDED", () => {
  test("PC-01 violating: decision_issued with only PACKAGE_SUBMITTED_TO_AUTHORITY recorded (DEC-04 pattern)", () => {
    fires(
      ctx({
        notification: { claims: { decision_issued: true } },
        events: [
          ev("evt-pkg", "PACKAGE_SUBMITTED_TO_AUTHORITY", T(23), {
            type: "RECOMMENDATION",
            id: OBJ.RECOMMENDATION,
          }),
        ],
      }),
      "PC-01",
      "NO_RECORDED_EVENT",
    );
  });
  test("PC-01 violating: basis event of the wrong type", () => {
    fires(
      ctx({ notification: { claims: { decision_issued: { value: true, basis_event_id: "evt-trigger" } } } }),
      "PC-01",
      "BASIS_EVENT_WRONG_TYPE",
    );
  });
  test("PC-01 passing: basis is the recorded AUTHORITY_DECISION_RECORDED", () => {
    clean(
      ctx({
        notification: {
          type_code: "DECISION_RECORDED_NOTICE",
          trigger_event_id: "evt-dec",
          claims: { decision_issued: { value: true, basis_event_id: "evt-dec" } },
        },
        events: [
          ev(
            "evt-dec",
            "AUTHORITY_DECISION_RECORDED",
            T(24),
            { type: "DECISION", id: OBJ.DECISION },
            { outcome: "APPROVE_AS_RECOMMENDED" },
          ),
        ],
      }),
    );
  });
});

describe("PC-02 vote described as open requires BALLOT_OPENED", () => {
  test("PC-02 violating: chair direction VOTE only (CF-19 pattern)", () => {
    fires(
      ctx({
        notification: { trigger_event_id: "evt-dir", claims: { vote_open: true } },
        events: [
          ev(
            "evt-dir",
            "CHAIR_DIRECTION_RECORDED",
            T(21),
            { type: "PROCEDURE", id: OBJ.PROCEDURE },
            { direction: "VOTE" },
          ),
        ],
      }),
      "PC-02",
      "NO_RECORDED_EVENT",
    );
  });
  test("PC-02 violating: BALLOT_CLOSED after BALLOT_OPENED", () => {
    fires(
      ctx({
        notification: { claims: { vote_open: true } },
        events: [
          ev("evt-bo", "BALLOT_OPENED", T(21), { type: "BALLOT", id: OBJ.BALLOT }),
          ev("evt-bc", "BALLOT_CLOSED", T(22), { type: "BALLOT", id: OBJ.BALLOT }),
        ],
      }),
      "PC-02",
      "BALLOT_CLOSED_AFTER_OPEN",
    );
  });
  test("PC-02 passing: BALLOT_OPENED recorded and not closed", () => {
    clean(
      ctx({
        notification: { claims: { vote_open: { value: true, basis_event_id: "evt-bo" } } },
        events: [ev("evt-bo", "BALLOT_OPENED", T(21), { type: "BALLOT", id: OBJ.BALLOT })],
      }),
    );
  });
});

describe("PC-03 meeting described as completed requires MEETING_CLOSED", () => {
  test("PC-03 violating: only MEETING_OPENED recorded", () => {
    fires(
      ctx({
        notification: { claims: { meeting_completed: true } },
        events: [ev("evt-mo", "MEETING_OPENED", T(21), MEETING)],
      }),
      "PC-03",
      "NO_RECORDED_EVENT",
    );
  });
  test("PC-03 passing: MEETING_CLOSED recorded", () => {
    clean(
      ctx({
        notification: { claims: { meeting_completed: true } },
        events: [
          ev("evt-mo", "MEETING_OPENED", T(21), MEETING),
          ev("evt-mc", "MEETING_CLOSED", T(21, "12:00"), MEETING),
        ],
      }),
    );
  });
});

describe("PC-04 recommendation described as approved requires RECOMMENDATION_ADOPTED", () => {
  test("PC-04 violating: the recommendation was returned, not adopted", () => {
    fires(
      ctx({
        notification: { claims: { recommendation_approved: true } },
        events: [
          ev("evt-rr", "RECOMMENDATION_RETURNED", T(22), { type: "RECOMMENDATION", id: OBJ.RECOMMENDATION }),
        ],
      }),
      "PC-04",
      "NO_RECORDED_EVENT",
    );
  });
  test("PC-04 passing: RECOMMENDATION_ADOPTED recorded", () => {
    clean(
      ctx({
        notification: { claims: { recommendation_approved: { value: true, basis_event_id: "evt-ra" } } },
        events: [
          ev("evt-ra", "RECOMMENDATION_ADOPTED", T(22), { type: "RECOMMENDATION", id: OBJ.RECOMMENDATION }),
        ],
      }),
    );
  });
});

describe("PC-05 deadline basis must be the trigger of its rule", () => {
  const SR = ev("evt-sr", "STATEMENT_REQUESTED", T(21), { type: "PROCEDURE", id: OBJ.PROCEDURE });
  test("PC-05 violating: basis rule SOURCE_REQUIRED (INV-12 / W7 #13 pattern)", () => {
    fires(
      ctx({
        notification: {
          deadline: {
            kind: "STATEMENT_DUE",
            at: T(30),
            basis_event_id: "evt-sr",
            basis_rule: "SOURCE_REQUIRED",
          },
        },
        events: [SR],
      }),
      "PC-05",
      "DEADLINE_RULE_SOURCE_REQUIRED",
    );
  });
  test("PC-05 violating: basis event is not the rule trigger", () => {
    fires(
      ctx({
        notification: {
          deadline: {
            kind: "STATEMENT_DUE",
            at: T(30),
            basis_event_id: "evt-trigger",
            basis_rule: "SYN-RULE-1",
          },
        },
      }),
      "PC-05",
      "BASIS_EVENT_NOT_RULE_TRIGGER",
    );
  });
  test("PC-05 violating: no basis event at all (fixed date)", () => {
    fires(
      ctx({ notification: { deadline: { kind: "STATEMENT_DUE", at: T(30), basis_rule: "SYN-RULE-1" } } }),
      "PC-05",
      "DEADLINE_WITHOUT_BASIS_EVENT",
    );
  });
  test("PC-05 violating: unknown deadline kind and no rule mapping", () => {
    fires(
      ctx({
        notification: {
          deadline: { kind: "SOMETHING_DUE", at: T(30), basis_event_id: "evt-sr", basis_rule: "SYN-RULE-1" },
        },
        events: [SR],
      }),
      "PC-05",
      "DEADLINE_RULE_UNKNOWN",
    );
  });
  test("PC-05 passing: STATEMENT_DUE based on the recorded STATEMENT_REQUESTED", () => {
    clean(
      ctx({
        notification: {
          deadline: { kind: "STATEMENT_DUE", at: T(30), basis_event_id: "evt-sr", basis_rule: "SYN-RULE-1" },
        },
        events: [SR],
      }),
    );
  });
  test("PC-05 passing: a rule table entry overrides the default trigger association", () => {
    clean(
      ctx({
        notification: {
          deadline: { kind: "STATEMENT_DUE", at: T(30), basis_event_id: "evt-irs", basis_rule: "SYN-RULE-2" },
        },
        events: [ev("evt-irs", "INFO_REQUEST_SENT", T(21), { type: "PROCEDURE", id: OBJ.PROCEDURE })],
        deadline_rules: { "SYN-RULE-2": { trigger_event_types: ["INFO_REQUEST_SENT"] } },
      }),
    );
  });
});

describe("PC-06 every shown field needs a disclosure outcome that allows its form", () => {
  test("PC-06 violating: case_number shown although PROHIBITED (WB-08 pattern)", () => {
    fires(
      ctx({
        notification: { fields_shown: ["case_number"] },
        disclosure_log: { case_number: { outcome: "PROHIBITED", basis: ["SYN"] } },
      }),
      "PC-06",
      "FORM_NOT_ALLOWED_BY_OUTCOME",
    );
  });
  test("PC-06 violating: field absent from the log defaults to PROHIBITED", () => {
    fires(
      ctx({ notification: { fields_shown: [{ field: "internal_ref", form: "RAW" }] }, disclosure_log: {} }),
      "PC-06",
      "FIELD_NOT_IN_LOG",
    );
  });
  test("PC-06 violating: no disclosure log at all", () => {
    fires(
      ctx({ notification: { fields_shown: ["meeting_info"] }, disclosure_log: null }),
      "PC-06",
      "NO_DISCLOSURE_LOG",
    );
  });
  test("PC-06 violating: raw value shown where only a generalized form is allowed", () => {
    fires(
      ctx({
        notification: { fields_shown: [{ field: "l1_stage_name", form: "RAW" }] },
        disclosure_log: { l1_stage_name: "GENERALIZED" },
      }),
      "PC-06",
      "FORM_NOT_ALLOWED_BY_OUTCOME",
    );
  });
  test("PC-06 passing: RAW/ALLOWED, GENERALIZED/GENERALIZED, SAFE_REFERENCE/SAFE_REFERENCE", () => {
    clean(
      ctx({
        notification: {
          fields_shown: [
            { field: "meeting_info", form: "RAW" },
            { field: "l1_stage_name", form: "GENERALIZED" },
            { field: "case_number", form: "SAFE_REFERENCE" },
          ],
        },
        disclosure_log: {
          meeting_info: { outcome: "ALLOWED" },
          l1_stage_name: { outcome: "GENERALIZED" },
          case_number: { outcome: "SAFE_REFERENCE" },
        },
      }),
    );
  });
});

describe("PC-07 no case reference when the case does not exist", () => {
  const NO_CASE = { case_id: CASE_ID, exists: false };
  test("PC-07 violating: Level-1 code and stage shown for exists:false (CF-01…04 pattern)", () => {
    fires(
      ctx({
        case: NO_CASE,
        notification: { l1_code: "S1.01", fields_shown: ["l1_stage_name"] },
        disclosure_log: { l1_stage_name: "ALLOWED" },
      }),
      "PC-07",
      "CASE_DOES_NOT_EXIST",
    );
  });
  test("PC-07 violating: case_registered claimed without reading the case", () => {
    fires(ctx({ case: null, notification: { claims: { case_registered: true } } }), "PC-07", "CASE_NOT_READ");
  });
  test("PC-07 passing: exists:false and only non-case fields", () => {
    clean(
      ctx({
        case: NO_CASE,
        notification: { fields_shown: ["report_id"] },
        disclosure_log: { report_id: "ALLOWED" },
      }),
    );
  });
});

describe("PC-08 a required authority check must answer ALLOWED", () => {
  test("PC-08 violating: action named but no authority check result", () => {
    fires(
      ctx({ notification: { authority_action_id: "OPEN_FORMAL_VOTE" } }),
      "PC-08",
      "AUTHORITY_CHECK_MISSING",
    );
  });
  test("PC-08 violating: SOURCE_REQUIRED fails closed", () => {
    fires(
      ctx({
        notification: { authority_action_id: "OPEN_FORMAL_VOTE" },
        authority: { result: "SOURCE_REQUIRED", action_id: "OPEN_FORMAL_VOTE" },
      }),
      "PC-08",
      "GOVERNING_SOURCE_REQUIRED",
    );
  });
  test("PC-08 violating: DENIED", () => {
    fires(
      ctx({
        notification: { authority_action_id: "OPEN_FORMAL_VOTE" },
        authority: { result: "DENIED", action_id: "OPEN_FORMAL_VOTE" },
      }),
      "PC-08",
      "AUTHORITY_NOT_ALLOWED",
    );
  });
  test("PC-08 violating: approval_required flag without a check", () => {
    fires(ctx({ notification: { approval_required: true } }), "PC-08", "AUTHORITY_CHECK_MISSING");
  });
  test("PC-08 passing: ALLOWED", () => {
    clean(
      ctx({
        notification: { authority_action_id: "OPEN_FORMAL_VOTE" },
        authority: { result: "ALLOWED", action_id: "OPEN_FORMAL_VOTE" },
      }),
    );
  });
});

describe("PC-09 an expected step is never shown as completed; a completed step needs its evidence event", () => {
  test("PC-09 violating: expected item in state COMPLETED (CF-25 L19-21 pattern)", () => {
    fires(
      ctx({ progress: { actual: [], expected: [{ step_id: "J-MTG/1/1", state: "COMPLETED" }] } }),
      "PC-09",
      "EXPECTED_ITEM_MARKED_COMPLETED",
    );
  });
  test("PC-09 violating: expected item carrying the ✔ marker", () => {
    fires(
      ctx({ progress: { actual: [], expected: [{ step_id: "J-MTG/1/2", marker: "✔" }] } }),
      "PC-09",
      "EXPECTED_ITEM_MARKED_COMPLETED",
    );
  });
  test("PC-09 violating: actual COMPLETED without evidence", () => {
    fires(
      ctx({
        progress: {
          actual: [{ step_id: "J-MTG/1/2", actual: "COMPLETED", evidence_event_id: null }],
          expected: [],
        },
      }),
      "PC-09",
      "COMPLETED_WITHOUT_EVIDENCE",
    );
  });
  test("PC-09 violating: evidence event not recorded", () => {
    fires(
      ctx({
        progress: {
          actual: [{ step_id: "J-MTG/1/2", actual: "COMPLETED", evidence_event_id: "evt-ghost" }],
          expected: [],
        },
      }),
      "PC-09",
      "EVIDENCE_EVENT_NOT_FOUND",
    );
  });
  test("PC-09 violating: evidence event of the wrong type", () => {
    fires(
      ctx({
        progress: {
          actual: [
            {
              step_id: "J-MTG/4/1",
              actual: "COMPLETED",
              completion_event_type: "MEETING_CLOSED",
              evidence_event_id: "evt-trigger",
            },
          ],
          expected: [],
        },
      }),
      "PC-09",
      "EVIDENCE_EVENT_WRONG_TYPE",
    );
  });
  test("PC-09 passing: completed with its evidence; expected items stay expected", () => {
    clean(
      ctx({
        progress: {
          actual: [
            {
              step_id: "J-MTG/1/1",
              actual: "COMPLETED",
              completion_event_type: "MEETING_SCHEDULED",
              evidence_event_id: "evt-trigger",
              epistemic: "RECORDED_FACT",
            },
          ],
          expected: [{ step_id: "J-MTG/3/1", state: "EXPECTED", epistemic: "EXPECTED_PROCESS" }],
        },
      }),
    );
  });
});

describe("PC-10 a cancelled object is never presented as active", () => {
  const CANCELLED_MEETING = {
    object_id: OBJ.MEETING,
    type: "MEETING",
    case_id: CASE_ID,
    status: "CANCELLED",
    steps: [],
  };
  test("PC-10 violating: cancelled meeting with a step in progress and upcoming steps (CF-25 L12-16 pattern)", () => {
    fires(
      ctx({
        notification: { type_code: "MEETING_CANCELLED", trigger_event_id: "evt-cancel" },
        events: [ev("evt-cancel", "MEETING_CANCELLED", T(22), MEETING)],
        procedural_object: CANCELLED_MEETING,
        progress: {
          actual: [{ step_id: "J-MTG/1", actual: "IN_PROGRESS" }],
          expected: [{ step_id: "J-MTG/2", state: "EXPECTED" }],
        },
      }),
      "PC-10",
      "CANCELLED_SHOWN_ACTIVE",
    );
  });
  test("PC-10 violating: object_active claimed for a cancelled case", () => {
    fires(
      ctx({
        case: { ...CASE, flags: { ...CASE.flags, cancelled: true } },
        notification: { claims: { object_active: true } },
      }),
      "PC-10",
      "CANCELLED_SHOWN_ACTIVE",
    );
  });
  test("PC-10 passing: cancelled meeting shown as cancelled, nothing upcoming", () => {
    clean(
      ctx({
        notification: { type_code: "MEETING_CANCELLED", trigger_event_id: "evt-cancel" },
        events: [ev("evt-cancel", "MEETING_CANCELLED", T(22), MEETING)],
        procedural_object: CANCELLED_MEETING,
        progress: { actual: [{ step_id: "J-MTG/1", actual: "CANCELLED" }], expected: [] },
      }),
    );
  });
});

describe("PC-11 a notification never establishes case closure", () => {
  const CLOSED = {
    ...CASE,
    status: { code: "S5.03", recorded_at: T(26), source_event_id: "evt-closed" },
    flags: { ...CASE.flags, closed: true },
  };
  test("PC-11 violating: case_closed claimed while the case is open (WB-08 L1,L7 pattern)", () => {
    fires(ctx({ notification: { claims: { case_closed: true } } }), "PC-11", "CLOSURE_NOT_RECORDED");
  });
  test("PC-11 violating: CASE_CLOSED caused by a notification event", () => {
    fires(
      ctx({
        case: CLOSED,
        events: [
          ev("evt-ntf", "NOTIFICATION_SENT", T(25), { type: "NOTIFICATION", id: "ntf-1" }),
          ev(
            "evt-closed",
            "CASE_CLOSED",
            T(26),
            { type: "CASE", id: CASE_ID },
            {},
            { causation_id: "evt-ntf" },
          ),
        ],
      }),
      "PC-11",
      "CLOSURE_CAUSED_BY_NOTIFICATION",
    );
  });
  test("PC-11 passing: closure recorded on its own basis and flagged on the case", () => {
    clean(
      ctx({
        case: CLOSED,
        notification: { claims: { case_closed: true } },
        events: [
          ev(
            "evt-dec",
            "AUTHORITY_DECISION_RECORDED",
            T(24),
            { type: "DECISION", id: OBJ.DECISION },
            { outcome: "APPROVE_AS_RECOMMENDED" },
          ),
          ev(
            "evt-closed",
            "CASE_CLOSED",
            T(26),
            { type: "CASE", id: CASE_ID },
            {},
            { causation_id: "evt-dec" },
          ),
        ],
      }),
    );
  });
});

describe("PC-12 a legal opinion is never an adoption", () => {
  const OP = ev(
    "evt-op",
    "LEGAL_OPINION_SUBMITTED",
    T(22),
    { type: "LEGAL_OPINION", id: OBJ.OPINION },
    { outcome: "CONCURS" },
  );
  test("PC-12 violating: recommendation_approved based on the opinion", () => {
    fires(
      ctx({
        notification: { claims: { recommendation_approved: { value: true, basis_event_id: "evt-op" } } },
        events: [OP],
      }),
      "PC-12",
      "OPINION_USED_AS_ADOPTION",
    );
  });
  test("PC-12 violating: adoption step completed by the opinion", () => {
    fires(
      ctx({
        events: [OP],
        progress: {
          actual: [
            {
              step_id: "J-REC/2",
              actual: "COMPLETED",
              completion_event_type: "RECOMMENDATION_ADOPTED",
              evidence_event_id: "evt-op",
            },
          ],
          expected: [],
        },
      }),
      "PC-12",
      "OPINION_COMPLETES_ADOPTION_STEP",
    );
  });
  test("PC-12 passing: adoption based on RECOMMENDATION_ADOPTED while an opinion exists", () => {
    clean(
      ctx({
        notification: { claims: { recommendation_approved: { value: true, basis_event_id: "evt-ra" } } },
        events: [
          OP,
          ev("evt-ra", "RECOMMENDATION_ADOPTED", T(23), { type: "RECOMMENDATION", id: OBJ.RECOMMENDATION }),
        ],
      }),
    );
  });
});

describe("PC-13 an invitation is never the meeting itself", () => {
  test("PC-13 violating: meeting_held based on MEETING_SCHEDULED", () => {
    fires(
      ctx({ notification: { claims: { meeting_held: { value: true, basis_event_id: "evt-trigger" } } } }),
      "PC-13",
      "INVITATION_USED_AS_OCCURRENCE",
    );
  });
  test("PC-13 violating: session step completed by the scheduling event (CF-40 pattern)", () => {
    fires(
      ctx({
        progress: {
          actual: [
            {
              step_id: "J-MTG/3/1",
              actual: "COMPLETED",
              completion_event_type: "MEETING_OPENED",
              evidence_event_id: "evt-trigger",
            },
          ],
          expected: [],
        },
      }),
      "PC-13",
      "INVITATION_COMPLETES_SESSION_STEP",
    );
  });
  test("PC-13 passing: meeting_held based on MEETING_OPENED", () => {
    clean(
      ctx({
        notification: { claims: { meeting_held: { value: true, basis_event_id: "evt-mo" } } },
        events: [ev("evt-mo", "MEETING_OPENED", T(21), MEETING)],
      }),
    );
  });
});

describe("PC-14 a draft is never presented as issued", () => {
  test("PC-14 violating: minutes_final without MINUTES_FINAL", () => {
    fires(
      ctx({
        notification: { claims: { minutes_final: true } },
        events: [ev("evt-mur", "MINUTES_UNDER_REVIEW", T(22), MEETING)],
      }),
      "PC-14",
      "NO_RECORDED_EVENT",
    );
  });
  test("PC-14 violating: a DRAFT decision presented as issued", () => {
    fires(
      ctx({
        procedural_object: { object_id: OBJ.DECISION, type: "DECISION", case_id: CASE_ID, status: "DRAFT" },
        notification: { claims: { decision_issued: { value: true, basis_event_id: "evt-dec" } } },
        events: [
          ev(
            "evt-dec",
            "AUTHORITY_DECISION_RECORDED",
            T(24),
            { type: "DECISION", id: OBJ.DECISION },
            { outcome: "APPROVE_AS_RECOMMENDED" },
          ),
        ],
      }),
      "PC-14",
      "DRAFT_OBJECT_PRESENTED_AS_ISSUED",
    );
  });
  test("PC-14 violating: a notification in DRAFT says it was sent (W7 #19 pattern)", () => {
    fires(
      ctx({ notification: { lifecycle_status: "DRAFT", claims: { notification_sent: true } } }),
      "PC-14",
      "NOTIFICATION_DRAFT_PRESENTED_AS_ISSUED",
    );
  });
  test("PC-14 passing: draft without a sent claim; minutes_final with MINUTES_FINAL", () => {
    clean(
      ctx({
        notification: { lifecycle_status: "DRAFT", claims: { minutes_final: true } },
        events: [ev("evt-mf", "MINUTES_FINAL", T(23), MEETING)],
      }),
    );
  });
});

describe("PC-15 an export, a download or a manual mark is never delivery", () => {
  test("PC-15 violating: delivered based on a manual «sent» mark (ui_v9.js:478 pattern)", () => {
    fires(
      ctx({
        notification: { claims: { delivered: { value: true, basis_event_id: "evt-man" } } },
        events: [
          ev(
            "evt-man",
            "DELIVERY_CONFIRMED",
            T(25),
            { type: "NOTIFICATION", id: "ntf-1" },
            { evidence_kind: "MANUAL_SENT_MARK" },
          ),
        ],
      }),
      "PC-15",
      "EXPORT_USED_AS_DELIVERY",
    );
  });
  test("PC-15 violating: delivered with only an .eml export recorded (ui_v9.js:460 pattern)", () => {
    fires(
      ctx({
        notification: { claims: { delivered: true } },
        events: [
          ev(
            "evt-exp",
            "NOTIFICATION_SENT",
            T(25),
            { type: "NOTIFICATION", id: "ntf-1" },
            { evidence_kind: "EML_EXPORT" },
          ),
        ],
      }),
      "PC-15",
      "DELIVERY_NOT_EVIDENCED",
    );
  });
  test("PC-15 violating: a deadline counted from an export", () => {
    fires(
      ctx({
        notification: {
          deadline: {
            kind: "GRIEVANCE_WINDOW",
            at: T(30),
            basis_event_id: "evt-exp",
            basis_rule: "SYN-RULE-3",
          },
        },
        events: [
          ev(
            "evt-exp",
            "DELIVERY_CONFIRMED",
            T(25),
            { type: "NOTIFICATION", id: "ntf-1" },
            { evidence_kind: "EML_EXPORT" },
          ),
        ],
      }),
      "PC-15",
      "EXPORT_USED_AS_DELIVERY_BASIS",
    );
  });
  test("PC-15 passing: DELIVERY_CONFIRMED recorded from the sender adapter", () => {
    clean(
      ctx({
        notification: { claims: { delivered: { value: true, basis_event_id: "evt-dlv" } } },
        events: [
          ev(
            "evt-dlv",
            "DELIVERY_CONFIRMED",
            T(25),
            { type: "NOTIFICATION", id: "ntf-1" },
            { evidence_kind: "SENDER_ADAPTER_REPORTED_SUCCESS" },
          ),
        ],
      }),
    );
  });
});

describe("PC-16 delivery is never acknowledgement", () => {
  const DLV = ev(
    "evt-dlv",
    "DELIVERY_CONFIRMED",
    T(25),
    { type: "NOTIFICATION", id: "ntf-1" },
    { evidence_kind: "SENDER_ADAPTER_REPORTED_SUCCESS" },
  );
  test("PC-16 violating: acknowledged based on DELIVERY_CONFIRMED", () => {
    fires(
      ctx({
        notification: { claims: { acknowledged: { value: true, basis_event_id: "evt-dlv" } } },
        events: [DLV],
      }),
      "PC-16",
      "DELIVERY_USED_AS_ACKNOWLEDGEMENT",
    );
  });
  test("PC-16 violating: acknowledged without any RECIPIENT_ACKNOWLEDGED", () => {
    fires(
      ctx({ notification: { claims: { acknowledged: true } }, events: [DLV] }),
      "PC-16",
      "NO_RECORDED_ACKNOWLEDGEMENT",
    );
  });
  test("PC-16 violating: acknowledgement-based deadline counted from delivery (CF-37 pattern)", () => {
    fires(
      ctx({
        notification: {
          deadline: {
            kind: "GRIEVANCE_WINDOW",
            at: T(30),
            basis_event_id: "evt-dlv",
            basis_rule: "SYN-RULE-3",
            basis_kind: "ACKNOWLEDGEMENT",
          },
        },
        events: [DLV],
      }),
      "PC-16",
      "ACKNOWLEDGEMENT_DEADLINE_ON_OTHER_EVENT",
    );
  });
  test("PC-16 passing: acknowledged based on RECIPIENT_ACKNOWLEDGED", () => {
    clean(
      ctx({
        notification: { claims: { acknowledged: { value: true, basis_event_id: "evt-ack" } } },
        events: [DLV, ev("evt-ack", "RECIPIENT_ACKNOWLEDGED", T(26), { type: "NOTIFICATION", id: "ntf-1" })],
      }),
    );
  });
});

describe("PC-17 only the selected alternative can be completed", () => {
  const IRS = ev("evt-irs", "INFO_REQUEST_SENT", T(21), { type: "PROCEDURE", id: OBJ.PROCEDURE });
  const step = (id: string, actual: string, extra: Record<string, unknown> = {}) => ({
    step_id: id,
    actual,
    ...extra,
  });
  const group = (selected?: string | null) => [
    { group_id: "G-DIRECTION", steps: ["J-DIR/3/1", "J-DIR/3/2", "J-DIR/3/3"], selected },
  ];
  test("PC-17 violating: two alternatives completed (CF-19 L19-20 pattern)", () => {
    fires(
      ctx({
        events: [IRS],
        alternative_groups: group("J-DIR/3/3"),
        progress: {
          actual: [
            step("J-DIR/3/1", "COMPLETED", {
              completion_event_type: "MEETING_SCHEDULED",
              evidence_event_id: "evt-trigger",
            }),
            step("J-DIR/3/2", "COMPLETED", {
              completion_event_type: "INFO_REQUEST_SENT",
              evidence_event_id: "evt-irs",
            }),
            step("J-DIR/3/3", "IN_PROGRESS"),
          ],
          expected: [],
        },
      }),
      "PC-17",
      "MULTIPLE_ALTERNATIVES_COMPLETED",
    );
  });
  test("PC-17 violating: a non-selected alternative completed (CF-18 L19 pattern)", () => {
    fires(
      ctx({
        alternative_groups: group("J-DIR/3/2"),
        progress: {
          actual: [
            step("J-DIR/3/1", "COMPLETED", {
              completion_event_type: "MEETING_SCHEDULED",
              evidence_event_id: "evt-trigger",
            }),
            step("J-DIR/3/2", "IN_PROGRESS"),
            step("J-DIR/3/3", "NOT_APPLICABLE"),
          ],
          expected: [],
        },
      }),
      "PC-17",
      "NON_SELECTED_ALTERNATIVE_COMPLETED",
    );
  });
  test("PC-17 passing: only the selected alternative completed, the others not applicable", () => {
    clean(
      ctx({
        events: [IRS],
        alternative_groups: group("J-DIR/3/2"),
        progress: {
          actual: [
            step("J-DIR/3/1", "NOT_APPLICABLE"),
            step("J-DIR/3/2", "COMPLETED", {
              completion_event_type: "INFO_REQUEST_SENT",
              evidence_event_id: "evt-irs",
            }),
            step("J-DIR/3/3", "NOT_APPLICABLE"),
          ],
          expected: [],
        },
      }),
    );
  });
});

describe("PC-18 Level 1 is the recorded case status", () => {
  test("PC-18 violating: S4.03 shown while S3.01 is recorded (CF-33 L9 pattern)", () => {
    fires(ctx({ notification: { l1_code: "S4.03" } }), "PC-18", "L1_NOT_RECORDED_STATUS");
  });
  test("PC-18 violating: Level 1 shown without a status source event", () => {
    fires(
      ctx({
        case: { ...CASE, status: { code: "S3.01", recorded_at: T(5), source_event_id: null } },
        notification: { l1_code: "S3.01" },
      }),
      "PC-18",
      "L1_WITHOUT_RECORDED_STATUS",
    );
  });
  test("PC-18 violating: a CASE_UNCHANGED notice claims a status change", () => {
    fires(
      ctx({ notification: { case_effect: "CASE_UNCHANGED", claims: { case_status_changed: true } } }),
      "PC-18",
      "CASE_UNCHANGED_NOTICE_MOVES_CASE",
    );
  });
  test("PC-18 passing: Level 1 equals the recorded status", () => {
    clean(ctx({ notification: { l1_code: "S3.01", case_effect: "CASE_UNCHANGED" } }));
  });
});

describe("PC-19 a cancelled meeting is never presented as upcoming", () => {
  test("PC-19 violating: invitation rendered after MEETING_CANCELLED (platform rows stay, 1920:133-154)", () => {
    fires(
      ctx({ events: [ev("evt-cancel", "MEETING_CANCELLED", T(22), MEETING)] }),
      "PC-19",
      "CANCELLED_MEETING_SHOWN_UPCOMING",
    );
  });
  test("PC-19 violating: meeting_upcoming claimed on any notice after cancellation", () => {
    fires(
      ctx({
        notification: { type_code: "MINUTES_REVIEW_REMINDER", claims: { meeting_upcoming: true } },
        events: [ev("evt-cancel", "MEETING_CANCELLED", T(22), MEETING)],
      }),
      "PC-19",
      "CANCELLED_MEETING_SHOWN_UPCOMING",
    );
  });
  test("PC-19 passing: cancelled, then rescheduled — the invitation is current", () => {
    clean(
      ctx({
        events: [
          ev("evt-cancel", "MEETING_CANCELLED", T(22), MEETING),
          ev("evt-res", "MEETING_RESCHEDULED", T(23), MEETING),
        ],
      }),
    );
  });
});

describe("PC-20 a deadline falls after its basis event and carries an offset", () => {
  const SR = ev("evt-sr", "STATEMENT_REQUESTED", T(21), { type: "PROCEDURE", id: OBJ.PROCEDURE });
  test("PC-20 violating: deadline before its basis event", () => {
    fires(
      ctx({
        notification: {
          deadline: { kind: "STATEMENT_DUE", at: T(20), basis_event_id: "evt-sr", basis_rule: "SYN-RULE-1" },
        },
        events: [SR],
      }),
      "PC-20",
      "DEADLINE_NOT_AFTER_BASIS",
    );
  });
  test("PC-20 violating: deadline without a time-zone offset (W4-09)", () => {
    fires(
      ctx({
        notification: {
          deadline: {
            kind: "STATEMENT_DUE",
            at: "2026-10-30T10:00:00",
            basis_event_id: "evt-sr",
            basis_rule: "SYN-RULE-1",
          },
        },
        events: [SR],
      }),
      "PC-20",
      "TIMESTAMP_WITHOUT_OFFSET",
    );
  });
  test("PC-20 passing: deadline after the basis, with an offset", () => {
    clean(
      ctx({
        notification: {
          deadline: {
            kind: "STATEMENT_DUE",
            at: "2026-10-30T23:59:00Z",
            basis_event_id: "evt-sr",
            basis_rule: "SYN-RULE-1",
          },
        },
        events: [SR],
      }),
    );
  });
});

describe("PC-21 one recipient, one capacity, on its own journey", () => {
  const r = (capacity: string, cls = "MEMBER") => ({ id: "usr-recipient-synthetic", class: cls, capacity });
  test("PC-21 violating: two capacities addressed in one notice (CF-18 L11 pattern)", () => {
    fires(
      ctx({
        notification: {
          recipient: r("COMMITTEE_CHAIR", "CHAIR"),
          addressed_capacities: ["COMMITTEE_CHAIR", "EXECUTING_SECRETARIAT"],
        },
      }),
      "PC-21",
      "BUNDLED_CAPACITIES",
    );
  });
  test("PC-21 violating: addressed capacity is not the recipient’s", () => {
    fires(
      ctx({ notification: { recipient: r("COMMITTEE_MEMBER"), addressed_capacities: ["COMMITTEE_CHAIR"] } }),
      "PC-21",
      "ADDRESSED_CAPACITY_NOT_RECIPIENT",
    );
  });
  test("PC-21 violating: a witness placed on the member journey (CF-24 pattern)", () => {
    fires(
      ctx({ notification: { recipient: r("WITNESS", "WITNESS"), journey_capacities: ["COMMITTEE_MEMBER"] } }),
      "PC-21",
      "RECIPIENT_CAPACITY_NOT_IN_JOURNEY",
    );
  });
  test("PC-21 passing: one matching capacity on its journey", () => {
    clean(
      ctx({
        notification: {
          recipient: r("COMMITTEE_MEMBER"),
          addressed_capacities: ["COMMITTEE_MEMBER"],
          journey_capacities: ["COMMITTEE_MEMBER", "COMMITTEE_SECRETARY"],
        },
      }),
    );
  });
});

describe("PC-22 the grievance period starts only with GRIEVANCE_WINDOW_STARTED", () => {
  test("PC-22 violating: «period has started» on a decision notice (CF-37 pattern)", () => {
    fires(
      ctx({
        notification: {
          type_code: "DECISION_NOTICE_ISSUED",
          trigger_event_id: "evt-dni",
          claims: { grievance_period_started: true },
        },
        events: [ev("evt-dni", "DECISION_NOTICE_ISSUED", T(25), { type: "DECISION", id: OBJ.DECISION })],
      }),
      "PC-22",
      "NO_RECORDED_EVENT",
    );
  });
  test("PC-22 passing: GRIEVANCE_WINDOW_STARTED recorded", () => {
    clean(
      ctx({
        notification: {
          type_code: "DECISION_NOTICE_ISSUED",
          trigger_event_id: "evt-dni",
          claims: { grievance_period_started: { value: true, basis_event_id: "evt-gws" } },
        },
        events: [
          ev("evt-dni", "DECISION_NOTICE_ISSUED", T(25), { type: "DECISION", id: OBJ.DECISION }),
          ev("evt-gws", "GRIEVANCE_WINDOW_STARTED", T(26), { type: "DECISION", id: OBJ.DECISION }),
        ],
      }),
    );
  });
});

describe("PC-23 a stated outcome is the recorded outcome", () => {
  const DEC = (outcome?: string) =>
    ev(
      "evt-dec",
      "AUTHORITY_DECISION_RECORDED",
      T(24),
      { type: "DECISION", id: OBJ.DECISION },
      outcome === undefined ? {} : { outcome },
    );
  test("PC-23 violating: APPROVE stated, RETURN_TO_COMMITTEE recorded (CF-35 / F-W2-07 pattern)", () => {
    fires(
      ctx({
        notification: { claims: { outcome: { value: "APPROVE_AS_RECOMMENDED", basis_event_id: "evt-dec" } } },
        events: [DEC("RETURN_TO_COMMITTEE")],
      }),
      "PC-23",
      "OUTCOME_MISMATCH",
    );
  });
  test("PC-23 violating: an outcome stated with nothing recorded", () => {
    fires(ctx({ notification: { claims: { outcome: "UPHOLD" } } }), "PC-23", "OUTCOME_NOT_RECORDED");
  });
  test("PC-23 violating: basis event carries no outcome", () => {
    fires(
      ctx({
        notification: { claims: { outcome: { value: "APPROVE_AS_RECOMMENDED", basis_event_id: "evt-dec" } } },
        events: [DEC(undefined)],
      }),
      "PC-23",
      "BASIS_EVENT_HAS_NO_OUTCOME",
    );
  });
  test("PC-23 passing: stated equals recorded", () => {
    clean(
      ctx({
        notification: { claims: { outcome: { value: "RETURN_TO_COMMITTEE", basis_event_id: "evt-dec" } } },
        events: [DEC("RETURN_TO_COMMITTEE")],
      }),
    );
  });
});

describe("PC-24 the event label names the trigger", () => {
  test("PC-24 violating: «Meeting scheduled» on a reschedule notice (CF-29 L23 pattern)", () => {
    fires(
      ctx({
        notification: { trigger_event_id: "evt-res", event_label_type: "MEETING_SCHEDULED" },
        events: [ev("evt-res", "MEETING_RESCHEDULED", T(22), MEETING)],
      }),
      "PC-24",
      "EVENT_LABEL_MISMATCH",
    );
  });
  test("PC-24 passing: label equals the trigger type", () => {
    clean(
      ctx({
        notification: { trigger_event_id: "evt-res", event_label_type: "MEETING_RESCHEDULED" },
        events: [ev("evt-res", "MEETING_RESCHEDULED", T(22), MEETING)],
      }),
    );
  });
});

describe("PC-25 every notification has a recorded trigger event of an allowed type", () => {
  test("PC-25 violating: no trigger at all (W7 §3.2: 66 of 69 V12 triggers were not transition events)", () => {
    fires(ctx({ notification: { trigger_event_id: null } }), "PC-25", "TRIGGER_EVENT_MISSING");
  });
  test("PC-25 violating: trigger id not recorded", () => {
    fires(
      ctx({ notification: { trigger_event_id: "evt-typed-in-browser" } }),
      "PC-25",
      "TRIGGER_EVENT_NOT_FOUND",
    );
  });
  test("PC-25 violating: trigger type not allowed for this notification type", () => {
    fires(
      ctx({ notification: { allowed_trigger_types: ["MEETING_RESCHEDULED"] } }),
      "PC-25",
      "TRIGGER_TYPE_NOT_ALLOWED",
    );
  });
  test("PC-25 passing: recorded trigger of an allowed type", () => {
    clean(ctx({ notification: { allowed_trigger_types: ["MEETING_SCHEDULED", "MEETING_RESCHEDULED"] } }));
  });
});

describe("PC-26 a returned or suspended object shows the return or the suspension", () => {
  const RETURNED_REFERRAL = {
    object_id: OBJ.REFERRAL,
    type: "REFERRAL",
    case_id: CASE_ID,
    status: "RETURNED",
    steps: [],
  };
  test("PC-26 violating: returned referral drawn as a first pass (CF-02 pattern)", () => {
    fires(
      ctx({
        procedural_object: RETURNED_REFERRAL,
        progress: { actual: [{ step_id: "J-REF/1", actual: "IN_PROGRESS" }], expected: [] },
      }),
      "PC-26",
      "RETURN_OR_SUSPENSION_NOT_SHOWN",
    );
  });
  test("PC-26 violating: suspended case drawn as moving forward", () => {
    fires(
      ctx({
        case: { ...CASE, flags: { ...CASE.flags, suspended: true } },
        progress: { actual: [{ step_id: "J-X/2", actual: "IN_PROGRESS" }], expected: [] },
      }),
      "PC-26",
      "RETURN_OR_SUSPENSION_NOT_SHOWN",
    );
  });
  test("PC-26 passing: the RETURNED step is shown", () => {
    clean(
      ctx({
        procedural_object: RETURNED_REFERRAL,
        progress: { actual: [{ step_id: "J-REF/1", actual: "RETURNED" }], expected: [] },
      }),
    );
  });
});

describe("PC-27 (WARN) rendered from state older than the latest recorded event", () => {
  test("PC-27 violating: a later MINUTES_DRAFTED exists → warning, not a block", () => {
    const r = fires(
      ctx({
        notification: { rendered_from_event_id: "evt-trigger" },
        events: [ev("evt-md", "MINUTES_DRAFTED", T(23), MEETING)],
      }),
      "PC-27",
      "RENDERED_FROM_STALE_STATE",
    );
    assert.equal(r.ok, true, "WARN never blocks");
    assert.ok(r.warnings.some((w) => w.id === "PC-27"));
  });
  test("PC-27 passing: rendered from the latest event (later notification events are ignored)", () => {
    const r = clean(
      ctx({
        notification: { rendered_from_event_id: "evt-md" },
        events: [
          ev("evt-md", "MINUTES_DRAFTED", T(23), MEETING),
          ev("evt-ns", "NOTIFICATION_SENT", T(24), { type: "NOTIFICATION", id: "ntf-1" }),
        ],
      }),
    );
    assert.deepEqual(r.warnings, []);
  });
});

describe("PC-28 (WARN) an information-only notice asks for nothing", () => {
  test("PC-28 violating: «للعلم» with SUBMIT_STATEMENT → warning (W7 #11 pattern)", () => {
    const r = fires(
      ctx({ notification: { informational: true, required_action: { kind: "SUBMIT_STATEMENT" } } }),
      "PC-28",
      "INFORMATIONAL_NOTICE_REQUIRES_ACTION",
    );
    assert.equal(r.ok, true);
  });
  test("PC-28 passing: informational with READ_ONLY", () => {
    const r = clean(ctx({ notification: { informational: true, required_action: { kind: "READ_ONLY" } } }));
    assert.deepEqual(r.warnings, []);
  });
});

describe("PC-29 every relied-on event time carries an explicit offset", () => {
  test("PC-29 violating: a zone-less occurred_at (W4-09)", () => {
    fires(
      ctx({ events: [ev("evt-md", "MINUTES_DRAFTED", "2026-10-23T10:00:00", MEETING)] }),
      "PC-29",
      "EVENT_TIMESTAMP_WITHOUT_OFFSET",
    );
  });
  test("PC-29 violating: a zone-less recorded_at", () => {
    fires(
      ctx({
        events: [ev("evt-md", "MINUTES_DRAFTED", T(23), MEETING, {}, { recorded_at: "2026-10-23 10:05" })],
      }),
      "PC-29",
      "EVENT_TIMESTAMP_WITHOUT_OFFSET",
    );
  });
  test("PC-29 passing: Z and +03:00 offsets", () => {
    clean(ctx({ events: [ev("evt-md", "MINUTES_DRAFTED", "2026-10-23T07:00:00Z", MEETING)] }));
  });
});

// ============================================================================================ engine (PC-00) ========
describe("PC-00 engine: fail closed, explain, catalogue, determinism", () => {
  test("PC-00 context without a notification or type code → PC-00, ok:false", () => {
    for (const c of [
      null,
      undefined,
      {},
      { notification: {} },
      { notification: { type_code: "" } },
      "text",
    ]) {
      const r = validate(c);
      assert.equal(r.ok, false);
      assert.deepEqual(
        r.violations.map((v) => v.id),
        ["PC-00"],
      );
      assert.deepEqual(r.evaluated, []);
    }
  });

  test("PC-00b a rule that throws yields PC-ENGINE (fail closed) without copying its message", () => {
    const throwing = {
      id: "PC-99",
      severity: "BLOCK",
      blocking: true,
      condition: () => {
        throw new TypeError("Employee Alpha <alpha@example.test>");
      },
    };
    const r = validate(ctx(), [...RULES, throwing]);
    assert.equal(r.ok, false);
    const v = r.violations.find((x) => x.id === "PC-ENGINE");
    assert.deepEqual(v!.detail, { rule_id: "PC-99", error: "TypeError", code: null });
    assert.ok(
      !JSON.stringify(r).includes("alpha@example.test"),
      "the error message is never copied into the result",
    );
  });

  test("PC-00b a zone-less event time makes an ordering rule fail closed (PC-ENGINE) besides PC-29 (W4-09)", () => {
    const c = ctx({
      notification: { claims: { vote_open: true } },
      events: [
        ev("evt-bo", "BALLOT_OPENED", "2026-10-21T10:00:00", { type: "BALLOT", id: OBJ.BALLOT }),
        ev("evt-bc", "BALLOT_CLOSED", T(22), { type: "BALLOT", id: OBJ.BALLOT }),
      ],
    });
    const r = validate(c);
    assert.equal(r.ok, false);
    assert.ok(
      r.violations.some(
        (v) =>
          v.id === "PC-ENGINE" &&
          v.detail!.rule_id === "PC-02" &&
          v.detail!.code === "TIMESTAMP_WITHOUT_OFFSET",
      ),
    );
    assert.ok(r.violations.some((v) => v.id === "PC-29"));
  });

  test("PC-00c explain(): Arabic by default, English on request, both from the catalogue", () => {
    const r = validate(ctx({ notification: { claims: { decision_issued: true } } }));
    const v = r.violations.find((x) => x.id === "PC-01");
    const ar = explain(v);
    const en = explain(v, "en");
    assert.match(ar, /^\[PC-01 · مانع\] /);
    assert.ok(ar.includes("المعالجة:") && ar.includes("(NO_RECORDED_EVENT)"));
    assert.match(en, /^\[PC-01 · BLOCK\] Decision described as issued/);
    assert.ok(en.includes("Remediation:"));
    const w = validate(ctx({ notification: { informational: true, required_action: { kind: "DECIDE" } } }))
      .warnings[0];
    assert.match(explain(w), /^\[PC-28 · تنبيه\]/);
    assert.match(explain({ id: "PC-ENGINE", detail: { rule_id: "PC-02" } }, "en"), /\(PC-02\)/);
    assert.throws(() => explain(null), TypeError);
  });

  test("PC-00d catalogue: charter minimum present, every rule complete and bilingual, ids unique", () => {
    assert.equal(RULES.length, 29);
    assert.ok(assertMinimumRuleSet(RULES));
    assert.deepEqual(
      CHARTER_MINIMUM,
      Array.from({ length: 17 }, (_, i) => `PC-${String(i + 1).padStart(2, "0")}`),
    );
    const AR = /[؀-ۿ]/;
    for (const r of RULES) {
      assert.match(r.id, /^PC-\d{2}$/);
      assert.ok(AR.test(r.ar) && /[A-Za-z]/.test(r.en), `${r.id} bilingual title`);
      assert.equal(typeof r.condition, "function");
      assert.ok(Array.isArray(r.source_data) && r.source_data.length > 0, `${r.id} source_data`);
      assert.ok(["BLOCK", "WARN"].includes(r.severity));
      assert.equal(r.blocking, r.severity === "BLOCK");
      assert.ok(AR.test(r.explanation.ar) && r.explanation.en.length > 20, `${r.id} explanation`);
      assert.ok(AR.test(r.remediation.ar) && r.remediation.en.length > 10, `${r.id} remediation`);
      assert.equal(r.test, `tests/consistency.test.js#${r.id}`);
      assert.ok(r.origin && r.v12_findings.length > 0, `${r.id} origin and V12 findings`);
      assert.ok(Object.isFrozen(r));
    }
    assert.deepEqual(
      RULES.filter((r) => r.severity === "WARN").map((r) => r.id),
      ["PC-27", "PC-28"],
    );
    assert.ok(
      Object.keys(CLAIMS).length >= 15 &&
        DEADLINE_KIND_TRIGGERS.GRIEVANCE_WINDOW!.includes("GRIEVANCE_WINDOW_STARTED"),
    );
    assert.equal(META_RULES["PC-00"].test, "tests/consistency.test.js#PC-00");
  });

  test("PC-00e a rule set without the charter minimum, with duplicates or malformed rules is refused", () => {
    assert.throws(() => assertMinimumRuleSet(RULES.filter((r) => r.id !== "PC-05")), /PC-05/);
    assert.throws(() => assertRuleSet([...RULES, RULES[0]]), /duplicate/);
    assert.throws(
      () => validate(ctx(), [{ id: "X", severity: "BLOCK", blocking: false, condition: () => null }]),
      /severity/,
    );
    assert.throws(() => validate(ctx(), [{ id: "X", severity: "BLOCK", blocking: true }]), /condition/);
  });

  test("PC-00f deterministic and pure: same context → same frozen result; no clock, randomness, network or model", () => {
    const c = ctx({ notification: { claims: { decision_issued: true, vote_open: true }, l1_code: "S4.03" } });
    const snapshot = JSON.stringify(c);
    const a = validate(c);
    const b = validate(structuredClone(c));
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(c), snapshot, "the context is not modified");
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.violations[0]));
    assert.equal(a.rules_version, RULES_VERSION);
    assert.equal(a.engine_version, ENGINE_VERSION);
    for (const f of ["lib/notifications/consistency/rules.ts", "lib/notifications/consistency/engine.ts"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      assert.doesNotMatch(
        src,
        /Math\.random|Date\.now\(|new Date\(|fetch\(|XMLHttpRequest|child_process|node:https?|import\(/,
        `${f} must stay deterministic and offline`,
      );
      const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
      assert.ok(
        imports.every((p) => p!.startsWith("./") || p!.startsWith("../")),
        `${f} imports local modules only: ${imports.join(", ")}`,
      );
    }
  });

  test("PC-00g a violation carries codes and ids, not notification text", () => {
    const r = validate(
      ctx({
        notification: {
          claims: { decision_issued: true, minutes_final: true, vote_open: true },
          l1_code: "S4.03",
        },
        events: [],
      }),
    );
    for (const v of r.violations) {
      for (const s of JSON.stringify(v.detail).match(/"[^"]*"/g) ?? [])
        assert.ok(!/\s/.test(s.slice(1, -1)), `${v.id} detail value «${s}» must be a code or id`);
    }
  });
});

// ================================================================================== V12 replays (evidence) =========
describe("PC V12 replays: the V12 notices each rule would have blocked", () => {
  test("PC-02 V12 replay CF-31: «This notice: Voting open» on a package-submitted notice — also PC-24", (t) => {
    evidenceLine(t, "eml/en/CF-31_PACKAGE_SUBMITTED_FOR_DELIBERATION.eml", 21, "This notice: Voting open");
    const c = ctx({
      notification: {
        type_code: "PACKAGE_SUBMITTED_FOR_DELIBERATION",
        trigger_event_id: "evt-pkg",
        event_label_type: "BALLOT_OPENED",
        claims: { vote_open: true },
      },
      events: [
        ev("evt-pkg", "PACKAGE_SUBMITTED_FOR_DELIBERATION", T(22), {
          type: "RECOMMENDATION",
          id: OBJ.RECOMMENDATION,
        }),
      ],
    });
    fires(c, "PC-02", "NO_RECORDED_EVENT");
    fires(c, "PC-24", "EVENT_LABEL_MISMATCH");
  });

  test("PC-17 V12 replay CF-19: ✔ meeting and ✔ information request on a VOTE direction — also PC-02, PC-09, PC-21", (t) => {
    evidenceLine(t, "eml/en/CF-19_CHAIR_DIRECTION_VOTE.eml", 19, "✔ Meeting or hearing scheduled");
    evidenceLine(t, "eml/en/CF-19_CHAIR_DIRECTION_VOTE.eml", 20, "✔ Information request sent");
    evidenceLine(
      t,
      "eml/en/CF-19_CHAIR_DIRECTION_VOTE.eml",
      11,
      "as Committee chair, and the executing secretariat",
    );
    const c = ctx({
      notification: {
        type_code: "CHAIR_DIRECTION_VOTE",
        trigger_event_id: "evt-dir",
        claims: { vote_open: true },
        recipient: { id: "usr-chair-synthetic", class: "CHAIR", capacity: "COMMITTEE_CHAIR" },
        addressed_capacities: ["COMMITTEE_CHAIR", "EXECUTING_SECRETARIAT"],
      },
      events: [
        ev(
          "evt-dir",
          "CHAIR_DIRECTION_RECORDED",
          T(21),
          { type: "PROCEDURE", id: OBJ.PROCEDURE },
          { direction: "VOTE" },
        ),
      ],
      alternative_groups: [
        { group_id: "G-DIRECTION", steps: ["J-DIR/3/1", "J-DIR/3/2", "J-DIR/3/3"], selected: "J-DIR/3/3" },
      ],
      progress: {
        actual: [
          { step_id: "J-DIR/3/1", actual: "COMPLETED" },
          { step_id: "J-DIR/3/2", actual: "COMPLETED" },
          { step_id: "J-DIR/3/3", actual: "IN_PROGRESS" },
        ],
        expected: [],
      },
    });
    fires(c, "PC-17", "MULTIPLE_ALTERNATIVES_COMPLETED");
    fires(c, "PC-02", "NO_RECORDED_EVENT");
    fires(c, "PC-09", "COMPLETED_WITHOUT_EVIDENCE");
    fires(c, "PC-21", "BUNDLED_CAPACITIES");
  });

  test("PC-17 V12 replay CF-18: ✔ meeting scheduled on an INFO_REQUEST direction", (t) => {
    evidenceLine(t, "eml/en/CF-18_CHAIR_DIRECTION_INFO.eml", 19, "✔ Meeting or hearing scheduled");
    evidenceLine(t, "eml/en/CF-18_CHAIR_DIRECTION_INFO.eml", 20, "● Information request sent");
    const c = ctx({
      notification: { type_code: "CHAIR_DIRECTION_INFO", trigger_event_id: "evt-dir" },
      events: [
        ev(
          "evt-dir",
          "CHAIR_DIRECTION_RECORDED",
          T(21),
          { type: "PROCEDURE", id: OBJ.PROCEDURE },
          { direction: "INFO_REQUEST" },
        ),
      ],
      alternative_groups: [
        { group_id: "G-DIRECTION", steps: ["J-DIR/3/1", "J-DIR/3/2", "J-DIR/3/3"], selected: "J-DIR/3/2" },
      ],
      progress: {
        actual: [
          { step_id: "J-DIR/3/1", actual: "COMPLETED" },
          { step_id: "J-DIR/3/2", actual: "IN_PROGRESS" },
          { step_id: "J-DIR/3/3", actual: "PENDING" },
        ],
        expected: [],
      },
    });
    fires(c, "PC-17", "NON_SELECTED_ALTERNATIVE_COMPLETED");
    fires(c, "PC-09", "COMPLETED_WITHOUT_EVIDENCE");
  });

  test("PC-09 V12 replay CF-25: ✔ agenda / date / invitations on a cancelled meeting — also PC-10", (t) => {
    evidenceLine(t, "eml/en/CF-25_MEETING_CANCELLED.eml", 19, "✔ Agenda approved");
    evidenceLine(t, "eml/en/CF-25_MEETING_CANCELLED.eml", 22, "● Rescheduled or cancelled where required");
    const c = ctx({
      notification: { type_code: "MEETING_CANCELLED", trigger_event_id: "evt-cancel" },
      events: [ev("evt-cancel", "MEETING_CANCELLED", T(22), MEETING)],
      procedural_object: {
        object_id: OBJ.MEETING,
        type: "MEETING",
        case_id: CASE_ID,
        status: "CANCELLED",
        steps: [],
      },
      progress: {
        actual: [{ step_id: "J-MTG/1/4", actual: "IN_PROGRESS" }],
        expected: [
          { step_id: "J-MTG/1/1", marker: "✔" },
          { step_id: "J-MTG/1/2", marker: "✔" },
          { step_id: "J-MTG/1/3", marker: "✔" },
          { step_id: "J-MTG/2", state: "EXPECTED" },
        ],
      },
    });
    fires(c, "PC-09", "EXPECTED_ITEM_MARKED_COMPLETED");
    fires(c, "PC-10", "CANCELLED_SHOWN_ACTIVE");
  });

  test("PC-24 V12 replay CF-29: «This notice: Meeting scheduled» under a reschedule subject", (t) => {
    evidenceLine(t, "eml/en/CF-29_MEETING_RESCHEDULED.eml", 23, "This notice: Meeting scheduled");
    fires(
      ctx({
        notification: { trigger_event_id: "evt-res", event_label_type: "MEETING_SCHEDULED" },
        events: [ev("evt-res", "MEETING_RESCHEDULED", T(22), MEETING)],
      }),
      "PC-24",
      "EVENT_LABEL_MISMATCH",
    );
  });

  test("PC-23 V12 replay CF-34: «Returned to the committee» for a CONCURS opinion — also PC-18 (S4.03 shown)", (t) => {
    evidenceLine(t, "eml/en/CF-34_LEGAL_OPINION_RECORDED.eml", 22, "This notice: Returned to the committee");
    evidenceLine(t, "eml/en/CF-34_LEGAL_OPINION_RECORDED.eml", 9, "Case position: S4.03");
    const c = ctx({
      case: { ...CASE, status: { code: "S4.01", recorded_at: T(22), source_event_id: "evt-status" } },
      notification: {
        type_code: "LEGAL_OPINION_RECORDED",
        trigger_event_id: "evt-op",
        l1_code: "S4.03",
        claims: { outcome: { value: "RETURNED_TO_COMMITTEE", basis_event_id: "evt-op" } },
      },
      events: [
        ev(
          "evt-op",
          "LEGAL_OPINION_SUBMITTED",
          T(22),
          { type: "LEGAL_OPINION", id: OBJ.OPINION },
          { outcome: "CONCURS" },
        ),
      ],
    });
    fires(c, "PC-23", "OUTCOME_MISMATCH");
    fires(c, "PC-18", "L1_NOT_RECORDED_STATUS");
  });

  test("PC-24 V12 replay CF-35: «With the competent authority» on a decision-recorded notice — also PC-18 (S4.05 shown)", (t) => {
    evidenceLine(
      t,
      "eml/en/CF-35_AUTHORITY_DECISION_RECORDED.eml",
      21,
      "This notice: With the competent authority",
    );
    evidenceLine(
      t,
      "eml/en/CF-35_AUTHORITY_DECISION_RECORDED.eml",
      9,
      "Case position: S4.05 Competent decision issued",
    );
    const c = ctx({
      case: { ...CASE, status: { code: "S4.03", recorded_at: T(24), source_event_id: "evt-status" } },
      notification: {
        type_code: "AUTHORITY_DECISION_RECORDED",
        trigger_event_id: "evt-dec",
        l1_code: "S4.05",
        event_label_type: "PACKAGE_SUBMITTED_TO_AUTHORITY",
      },
      events: [
        ev(
          "evt-dec",
          "AUTHORITY_DECISION_RECORDED",
          T(24),
          { type: "DECISION", id: OBJ.DECISION },
          { outcome: "RETURN_TO_COMMITTEE" },
        ),
      ],
    });
    fires(c, "PC-24", "EVENT_LABEL_MISMATCH");
    fires(c, "PC-18", "L1_NOT_RECORDED_STATUS");
  });

  test("PC-22 V12 replay CF-37: «The period to file a grievance has started» with receipt not acknowledged — also PC-16", (t) => {
    evidenceLine(
      t,
      "eml/en/CF-37_DECISION_NOTICE_ISSUED.eml",
      1,
      "The period to file a grievance has started.",
    );
    evidenceLine(t, "eml/en/CF-37_DECISION_NOTICE_ISSUED.eml", 20, "○ Receipt acknowledged");
    const c = ctx({
      notification: {
        type_code: "DECISION_NOTICE_ISSUED",
        trigger_event_id: "evt-dni",
        claims: { grievance_period_started: true },
        deadline: {
          kind: "GRIEVANCE_WINDOW",
          at: T(30),
          basis_event_id: "evt-dni",
          basis_rule: "SYN-GRIEVANCE-RULE",
          basis_kind: "ACKNOWLEDGEMENT",
        },
      },
      events: [ev("evt-dni", "DECISION_NOTICE_ISSUED", T(25), { type: "DECISION", id: OBJ.DECISION })],
    });
    fires(c, "PC-22", "NO_RECORDED_EVENT");
    fires(c, "PC-16", "ACKNOWLEDGEMENT_DEADLINE_ON_OTHER_EVENT");
    fires(c, "PC-05", "BASIS_EVENT_NOT_RULE_TRIGGER");
  });

  test("PC-07 V12 replay CF-08: «Case position: S1.03 Case registered» on an escalation decision — also PC-23", (t) => {
    evidenceLine(
      t,
      "eml/en/CF-08_REFERRAL_ESCALATION_DECIDED.eml",
      6,
      "Case position: S1.03 Case registered",
    );
    evidenceLine(
      t,
      "eml/en/CF-08_REFERRAL_ESCALATION_DECIDED.eml",
      22,
      "This notice: Received by the committee",
    );
    const c = ctx({
      case: { case_id: null, exists: false },
      notification: {
        type_code: "REFERRAL_ESCALATION_DECIDED",
        trigger_event_id: "evt-esc",
        l1_code: "S1.03",
        claims: {
          case_registered: true,
          outcome: { value: "RECEIVED_BY_COMMITTEE", basis_event_id: "evt-esc" },
        },
      },
      events: [
        ev(
          "evt-esc",
          "REFERRAL_ESCALATION_DECIDED",
          T(12),
          { type: "REFERRAL", id: OBJ.REFERRAL },
          { outcome: "UPHOLD" },
        ),
      ],
    });
    fires(c, "PC-07", "CASE_DOES_NOT_EXIST");
    fires(c, "PC-23", "OUTCOME_MISMATCH");
  });

  test("PC-18 V12 replay CF-33: «Case position: S4.03» printed at legal review assignment", (t) => {
    evidenceLine(
      t,
      "eml/en/CF-33_LEGAL_REVIEW_ASSIGNED.eml",
      9,
      "Case position: S4.03 Recommendation raised to the authority",
    );
    fires(
      ctx({
        notification: { type_code: "LEGAL_REVIEW_ASSIGNED", trigger_event_id: "evt-lrr", l1_code: "S4.03" },
        events: [ev("evt-lrr", "LEGAL_REVIEW_REQUESTED", T(21), { type: "LEGAL_OPINION", id: OBJ.OPINION })],
      }),
      "PC-18",
      "L1_NOT_RECORDED_STATUS",
    );
  });

  test("PC-06 V12 replay WB-08: case reference to the reporter, closure claimed on an S2 snapshot — also PC-11, PC-09", (t) => {
    evidenceLine(t, "generator/samples/WB-08.txt", 6, "الرقم المرجعي للحالة: CDF-WB-2026-DEMO-0002", {
      plain: true,
    });
    evidenceLine(t, "generator/samples/WB-08.txt", 1, "إشعار بانتهاء معالجة البلاغ", { plain: true });
    evidenceLine(t, "generator/samples/WB-08.txt", 7, "الحالة: التقييم الأولي", { plain: true });
    evidenceLine(t, "generator/samples/WB-08.txt", 40, "✔ 4. معالجة بلاغك لدى الجهة المختصة", {
      plain: true,
    });
    const c = ctx({
      case: {
        ...CASE,
        track: "WB",
        status: { code: "S2.01", recorded_at: T(3), source_event_id: "evt-status" },
      },
      notification: {
        type_code: "WB_CLOSURE_NOTICE",
        trigger_event_id: "evt-trigger",
        recipient: { id: "usr-reporter-synthetic", class: "REPORTER", capacity: "REPORTER" },
        fields_shown: ["case_number"],
        claims: { case_closed: true },
      },
      disclosure_log: {
        case_number: { outcome: "PROHIBITED", basis: ["DEC-24 (e-mail rows PROHIBITED until decided)"] },
      },
      progress: { actual: [], expected: [1, 2, 3, 4].map((n) => ({ step_id: `J-WB/${n}`, marker: "✔" })) },
    });
    fires(c, "PC-06", "FORM_NOT_ALLOWED_BY_OUTCOME");
    fires(c, "PC-11", "CLOSURE_NOT_RECORDED");
    fires(c, "PC-09", "EXPECTED_ITEM_MARKED_COMPLETED");
  });

  test("PC-15 V12 replay generator: download logged «exported», manual button sets «sent», 77/77 sample EMLs are X-Unsent drafts", (t) => {
    evidenceLine(t, "generator/source/ui_v9.js", 460, "addLog(n,out,'exported')", { plain: true });
    evidenceLine(t, "generator/source/ui_v9.js", 478, "status='sent'", { plain: true });
    // The 77 V12 sample EMLs (≈118 MB) are not copied into __evidence__; the guarded check runs only where they are present.
    const samples = join(EVIDENCE, "samples");
    if (existsSync(samples)) {
      const emls = readdirSync(samples).filter((f) => f.endsWith(".eml"));
      const unsent = emls.filter((f) => /^X-Unsent: 1\r?$/m.test(readFileSync(join(samples, f), "utf8")));
      assert.equal(unsent.length, emls.length, "every V12 sample EML is an unsent draft");
      console.warn(
        "[diagnostic]",
        `V12 generator samples: ${unsent.length}/${emls.length} EMLs carry X-Unsent: 1`,
      );
    } else {
      console.warn(
        "[diagnostic]",
        "V12 generator samples not copied into __evidence__ (size): the 77/77 X-Unsent check is not re-run here (UNVERIFIED here)",
      );
    }
    fires(
      ctx({
        notification: { claims: { delivered: { value: true, basis_event_id: "evt-man" } } },
        events: [
          ev(
            "evt-man",
            "DELIVERY_CONFIRMED",
            T(25),
            { type: "NOTIFICATION", id: "ntf-v12" },
            { evidence_kind: "MANUAL_SENT_MARK" },
          ),
        ],
      }),
      "PC-15",
      "EXPORT_USED_AS_DELIVERY",
    );
  });

  test("PC-26 V12 replay CF-02: a returned referral drawn as a first pass", () => {
    fires(
      ctx({
        case: { case_id: null, exists: false },
        procedural_object: {
          object_id: OBJ.REFERRAL,
          type: "REFERRAL",
          case_id: null,
          status: "RETURNED",
          steps: [],
        },
        notification: { type_code: "REFERRAL_RETURNED", trigger_event_id: "evt-ret" },
        events: [ev("evt-ret", "REFERRAL_RETURNED", T(11), { type: "REFERRAL", id: OBJ.REFERRAL })],
        progress: {
          actual: [{ step_id: "J-REF/1", actual: "IN_PROGRESS" }],
          expected: [{ step_id: "J-REF/2", state: "EXPECTED" }],
        },
      }),
      "PC-26",
      "RETURN_OR_SUSPENSION_NOT_SHOWN",
    );
  });

  test("PC-01 V12 replay DEC-04: decision notice says a decision was issued while the matter awaits the authority", () => {
    fires(
      ctx({
        notification: {
          type_code: "DECISION_NOTICE",
          trigger_event_id: "evt-pkg",
          claims: { decision_issued: true },
        },
        events: [
          ev("evt-pkg", "PACKAGE_SUBMITTED_TO_AUTHORITY", T(23), {
            type: "RECOMMENDATION",
            id: OBJ.RECOMMENDATION,
          }),
        ],
      }),
      "PC-01",
      "NO_RECORDED_EVENT",
    );
  });
});

// ============================================================= optional: W-D2 projection, when present ============
test("PC-06 with the W-D2 projection (guarded): every PROHIBITED field shown RAW blocks, every ALLOWED one passes", async () => {
  const mod: {
    project?: (
      model: unknown,
      opts: Record<string, unknown>,
    ) => { readonly _disclosure_log?: unknown } | null;
  } = disclosureProject as unknown as {
    project?: (
      model: unknown,
      opts: Record<string, unknown>,
    ) => { readonly _disclosure_log?: unknown } | null;
  };
  // Port: lib/disclosure is a static import, so a missing project() fails (no skipped test in the committed suite).
  const projectFn = mod.project;
  assert.ok(typeof projectFn === "function", "lib/disclosure/project.ts project() not loadable (W-D2)");
  let projected: { readonly _disclosure_log?: unknown } | null | undefined;
  try {
    projected = projectFn(
      {
        case_number: "CDF-DEMO-2026-0001",
        meeting_info: "Committee meeting (synthetic)",
        l1_stage_name: "synthetic",
      },
      { recipient: "WITNESS", context: "CASE_PUBLIC", channel: "EMAIL_TEXT" },
    );
  } catch (err) {
    assert.fail(`project() API differs from the assumed shape (${(err as { name?: string } | null)?.name})`);
  }
  const log = projected?._disclosure_log;
  assert.ok(log && typeof log === "object", "projection returned no _disclosure_log");
  const outcome = (v: unknown) => (typeof v === "string" ? v : (v as { outcome?: unknown } | null)?.outcome);
  for (const [field, v] of Object.entries(log)) {
    const c = ctx({ notification: { fields_shown: [{ field, form: "RAW" }] }, disclosure_log: log });
    const fired = validate(c).violations.some((x) => x.id === "PC-06");
    assert.equal(
      fired,
      outcome(v) !== "ALLOWED",
      `${field}: outcome ${outcome(v)} → PC-06 ${fired ? "fires" : "passes"}`,
    );
  }
});
