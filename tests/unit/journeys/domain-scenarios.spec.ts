// tests/unit/journeys/domain-scenarios.spec.ts — CDF Notifications V13 · W-A domain tables against the W-C journeys data.
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
//
// These checks were the guarded tails of ST-29, ST-32 and the whole of ST-34 in the reference tests/status.test.js: they
// read lib/journeys/catalogue_v13.json and lib/journeys/scenarios/*.json, which land with PROC-002. In the repository the
// files are always present, so every check here is strict: a missing file fails the test instead of returning early.
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "@/lib/domain/concepts";
import * as S from "@/lib/domain/status";
import type { DomainEvent, ObjectRef, Payload } from "@/lib/domain/types";

const JOURNEYS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "lib", "journeys");
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(JOURNEYS, rel), "utf8")) as T;
interface CatalogueFile {
  journeys: {
    id: string;
    stages: {
      steps: {
        completion_event_type?: string | null;
        completion_any_of?: { type: string }[] | null;
        completion_target?: string | null;
      }[];
    }[];
  }[];
}
interface ScenarioIndex {
  scenarios: { file: string }[];
}
interface ScenarioFile {
  id: string;
  journey: string;
  procedural_object: {
    type: string;
    object_id: string;
    status: string | null;
    status_source_event_id: string | null;
  };
  events: DomainEvent[];
}

const u = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let seq = 0;
function ev(type: string, object: ObjectRef, payload: Payload = {}): DomainEvent {
  seq += 1;
  const t = new Date(Date.parse("2026-10-01T08:00:00Z") + seq * 60e3).toISOString();
  return {
    event_id: `evt-ds-${String(seq).padStart(4, "0")}`,
    type,
    occurred_at: t,
    recorded_at: t,
    case_id: u(1),
    object,
    actor: { capacity: "SECRETARY", id: "usr-secretary-01" },
    provenance: { source: "SYNTHETIC_DEMO", ref: "tests/unit/journeys/domain-scenarios.spec.ts" },
    version: 1,
    causation_id: null,
    correlation_id: "corr-ds",
    payload,
  } as DomainEvent;
}
const ref = (type: string, id: string): ObjectRef => ({ type, id });

describe("W-A tables against the W-C catalogue and scenarios", () => {
  test("ST-29b closing events: every journey the catalogue closes with PROCEDURE_COMPLETED (completion_target SELF) is closed by it as object or as payload.target", () => {
    const P = u(11);
    const cat = readJson<CatalogueFile>("catalogue_v13.json");
    const index = readJson<ScenarioIndex>("scenarios/index.json");
    const selfClose = new Set<string>();
    for (const j of cat.journeys)
      for (const st of j.stages)
        for (const s of st.steps) {
          const pats = [
            ...(s.completion_event_type ? [{ type: s.completion_event_type }] : []),
            ...(s.completion_any_of || []),
          ];
          if (s.completion_target === "SELF" && pats.some((p) => p.type === "PROCEDURE_COMPLETED"))
            selfClose.add(j.id);
        }
    assert.ok(selfClose.size > 0, "the catalogue closes journeys with PROCEDURE_COMPLETED");
    let n = 0;
    for (const entry of index.scenarios) {
      const sc = readJson<ScenarioFile>(`scenarios/${entry.file}`);
      if (!selfClose.has(sc.journey)) continue;
      const po = sc.procedural_object;
      n += 1;
      assert.ok(
        C.EVENT_CATALOGUE.PROCEDURE_COMPLETED!.object_types.includes(po.type),
        `${sc.id}: PROCEDURE_COMPLETED may close a ${po.type}`,
      );
      assert.ok(
        S.eventConcerns(ev("PROCEDURE_COMPLETED", ref(po.type, po.object_id)), po.type, po.object_id),
        `${sc.id}: as its object`,
      );
      assert.ok(
        S.eventConcerns(
          ev("PROCEDURE_COMPLETED", ref("PROCEDURE", P), { target: po.object_id }),
          po.type,
          po.object_id,
        ),
        `${sc.id}: as payload.target`,
      );
    }
    assert.ok(n > 0, "at least one scenario belongs to a journey closed by PROCEDURE_COMPLETED");
  });

  test("ST-32b referral: the statuses NOCASE-01 and RET-01 declare are the ones the W-A REFERRAL table folds to", () => {
    for (const [file, want, src] of [
      ["NOCASE-01.json", "OPEN", "evt-NOCASE-01-02"],
      ["RET-01.json", "RETURNED", "evt-RET-01-03"],
    ] as const) {
      const po = readJson<ScenarioFile>(`scenarios/${file}`).procedural_object;
      const f = S.statusFromEvents(po.type, po.object_id, readJson<ScenarioFile>(`scenarios/${file}`).events);
      assert.deepEqual(
        [f.status, f.source_event_id],
        [po.status, po.status_source_event_id],
        `${file}: W-A fold = declared status`,
      );
      assert.deepEqual([po.status, po.status_source_event_id], [want, src], file);
    }
  });

  test("ST-34 every scenario history folds under the W-A tables without an illegal move; declared statuses the fold does not reproduce are listed (diagnostic, BL-46)", () => {
    const index = readJson<ScenarioIndex>("scenarios/index.json");
    const differ: string[] = [];
    let n = 0;
    for (const entry of index.scenarios) {
      const sc = readJson<ScenarioFile>(`scenarios/${entry.file}`);
      if (!sc.procedural_object || !S.LIFECYCLE_CONCEPTS.includes(sc.procedural_object.type)) continue;
      const po = sc.procedural_object;
      n += 1;
      for (const e of sc.events)
        assert.ok(C.isKnownEventType(e.type), `${sc.id}: ${e.event_id} ${e.type} is a V13 type`);
      let f: S.StatusFold | undefined;
      assert.doesNotThrow(() => {
        f = S.statusFromEvents(po.type, po.object_id, sc.events);
      }, `${sc.id}: an illegal move under W-A's ${po.type} table`);
      if (f!.status !== po.status || f!.source_event_id !== po.status_source_event_id)
        differ.push(
          `${sc.id} ${po.type}: declared ${po.status} (${po.status_source_event_id}), W-A fold ${f!.status} (${f!.source_event_id})`,
        );
    }
    assert.ok(n > 0);
    if (differ.length > 0)
      console.warn(
        "[diagnostic]",
        `declared status not reproduced by W-A's tables: ${differ.length} — ${differ.join("; ")}`,
      );
  });
});
