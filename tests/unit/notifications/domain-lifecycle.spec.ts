// tests/unit/notifications/domain-lifecycle.spec.ts — CDF Notifications V13 · W-A NotificationStatus against W-D1 lifecycle.
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
//
// This check was the guarded tail of ST-07 in the reference tests/status.test.js: W-A (lib/domain/status.ts) and W-D1
// (lib/notifications/lifecycle/notification.ts, which lands with PROC-005) carry the same record-level and lineage-level
// notification tables. Strict: it runs whenever both modules are present, which in the repository is always.
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import * as S from "@/lib/domain/status";
import * as D1 from "@/lib/notifications/lifecycle/notification";

const flat = (tbl: Readonly<Record<string, readonly string[] | undefined>>) =>
  Object.entries(tbl)
    .flatMap(([f, ts]) => (ts as readonly string[]).map((x) => `${f}→${x}`))
    .sort();
const pairsText = (ps: readonly (readonly [string | null, string])[]) => ps.map(([f, x]) => `${f}→${x}`);

describe("W-A NotificationStatus against W-D1", () => {
  test("ST-07b the W-D1 record-level and lineage-level tables, issued and terminal statuses and canCorrect equal W-A NotificationStatus", () => {
    const o: S.AnyStatusObject = S.STATUS_OBJECTS.NotificationStatus;
    assert.deepEqual(
      flat(D1.ALLOWED_TRANSITIONS),
      pairsText(o.pairs).sort(),
      "record level = W-D1 ALLOWED_TRANSITIONS",
    );
    assert.deepEqual(
      flat(D1.LINEAGE_TRANSITIONS),
      pairsText(o.lineage_pairs).sort(),
      "lineage level = W-D1 LINEAGE_TRANSITIONS",
    );
    assert.deepEqual([...D1.ISSUED_STATUSES], [...S.ISSUED_NOTIFICATION_STATES]);
    assert.deepEqual([...D1.TERMINAL_STATUSES].sort(), [...o.terminal].sort());
    for (const s of o.states) assert.equal(D1.canCorrect(s), S.canCorrect(s), `canCorrect(${s})`);
  });
});
