/**
 * PRJ — the Projected<T> brand (SEC review of PR #3; PORT_PLAN §3 item 3). SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
 * A compile-time brand on top of the run-time marker and registry: only project() makes a Projected<ProjectedModel>,
 * so code that asks for one cannot be handed a hand-built or copied model. Typecheck enforces the @ts-expect-error
 * lines below; the run-time half is isProjected / assertProjected. Synthetic values only.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import * as D from "@/lib/disclosure";
import type { Projected, ProjectedModel } from "@/lib/disclosure";

const codeIs = (code: string) => (e: unknown) => (e as { code?: unknown }).code === code;
const policy = D.loadPolicy();
const FLAT = {
  case_number: "CDF-DEMO-2026-0001",
  event_title: { ar: "عنوان اصطناعي", en: "Synthetic title" },
  allegations: "SENTINEL-ALLEGATION-PRJ",
};
const opts = { recipient: "SECRETARY", context: "CASE_PUBLIC", channel: "PLATFORM", policy } as const;

/** Stands in for a renderer or view model: it accepts only a projected model. */
const consume = (m: Projected<ProjectedModel>): number => Object.keys(m.fields).length;

describe("PRJ Projected<T> brand", () => {
  test("PRJ-01 project() returns Projected<ProjectedModel>, accepted where a projected model is required", () => {
    const p = D.project(FLAT, opts);
    assert.ok(consume(p) >= 0);
    assert.ok(D.isProjected(p) && Object.isFrozen(p));
    assert.equal(D.assertProjected(p), p);
  });

  test("PRJ-02 negative (compile time): a plain or copied model does not type-check as Projected<T>", () => {
    const p = D.project(FLAT, opts);
    const plain: ProjectedModel = { ...p };
    // @ts-expect-error a ProjectedModel that did not come from project() is not Projected<ProjectedModel>
    assert.throws(() => consume(D.assertProjected(plain) && plain), codeIs("UNPROJECTED_MODEL"));
    // @ts-expect-error an unprojected source model is not Projected<ProjectedModel>
    const n: number = consume({ meta: {}, fields: FLAT });
    assert.equal(typeof n, "number");
  });

  test("PRJ-03 negative (run time): copies are refused, and a narrowed unknown is the branded type", () => {
    const p = D.project(FLAT, opts);
    for (const copy of [{ ...p }, structuredClone(p), JSON.parse(JSON.stringify(p)) as unknown]) {
      assert.equal(D.isProjected(copy), false);
      assert.throws(() => D.assertProjected(copy), codeIs("UNPROJECTED_MODEL"));
    }
    const u: unknown = p;
    if (D.isProjected(u)) assert.ok(consume(u) >= 0);
    else assert.fail("a projected model narrows");
    assert.ok(!JSON.stringify(p).includes("SENTINEL-ALLEGATION-PRJ"), "§39 content group is withheld");
  });
});
