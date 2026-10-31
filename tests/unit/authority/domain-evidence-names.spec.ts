// tests/unit/authority/domain-evidence-names.spec.ts — CDF Notifications V13 · W-A event names against W-F authority data.
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
//
// This check was the guarded tail of ST-28 in the reference tests/status.test.js: it reads lib/authority/authority_v13.json,
// which lands with PROC-004. It reads the file with fs (never imports it: only lib/authority/check.ts imports the JSON)
// and is strict: a missing file fails the test instead of returning early.
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "@/lib/domain/concepts";

interface AuthorityFile {
  actions: { action_id: string; evidence_required?: unknown }[];
}
const FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "lib",
  "authority",
  "authority_v13.json",
);

describe("W-A event names against the W-F authority file", () => {
  test("ST-28b every evidence name in authority_v13.json resolves through toV13EventType, or is a listed non-event name or open item", () => {
    const r = C.toV13EventType;
    const auth = JSON.parse(readFileSync(FILE, "utf8")) as AuthorityFile;
    assert.ok(Array.isArray(auth.actions), "authority_v13.json has an actions list");
    // Names in evidence_required that are not event names (FACT, read in the file) and the open items (named in work/V13-02_notes.md)
    const NOT_EVENTS = {
      DECISION_NOT_FINAL: "refusal code",
      ALREADY_NOTIFIED: "refusal code",
      RETURN_TO_COMMITTEE: "outcome value",
      NOT_REQUIRED: "value",
      DEEMED_ATTESTED: "value",
      RECORD_AUTHORITY_DECISION: "action id",
    };
    const OPEN = ["COMMITTEE_RECORD", "RECORD_ACTING_CHAIR_ACTIVATED", "RECORD_ACTING_CHAIR_ENDED"];
    const names = new Map<string, string[]>();
    for (const a of auth.actions) {
      const s =
        typeof a.evidence_required === "string"
          ? a.evidence_required
          : JSON.stringify(a.evidence_required ?? "");
      for (const n of s.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) || [])
        names.set(n, [...(names.get(n) || []), a.action_id]);
    }
    assert.ok(names.size > 0, "the file names evidence");
    const unresolved = [...names.keys()].filter((n) => r(n) === null).sort();
    assert.deepEqual(
      unresolved,
      [...Object.keys(NOT_EVENTS), ...OPEN].sort(),
      "every evidence name resolves, or is a listed non-event name or open item",
    );
    assert.ok(
      auth.actions.some((a) => a.action_id === "RECORD_AUTHORITY_DECISION"),
      "RECORD_AUTHORITY_DECISION is an action id",
    );
  });
});
