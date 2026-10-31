// Acceptance self-test of the Procedural Truth Inspector (V13-QA-004): a clean page passes, and every planted
// unrecorded "completed" badge (and the other T-rules) makes it fail. Fixture pages and an in-memory event oracle
// only; the database oracle replaces it on real pages.
import { expect, test } from "@playwright/test";
import { CASES, EVENTS, caseWorkspaceHtml, openFixture } from "../fixtures/synthetic-case-page";
import { formatTruthViolations, inMemoryOracle, inspectTruth, type RecordedEventFact } from "./inspector";
import { refuseFrameEvaluation } from "../sentinel/frames";

const c1 = CASES.c0001;
const casePath = `/cases/${c1.id}`;
const NOW = new Date("2026-10-28T03:00:00Z");
const facts: RecordedEventFact[] = [
  {
    eventId: EVENTS.e0001stage,
    caseId: c1.id,
    statusKind: "procedure",
    status: "IN_PROGRESS",
    recordedAt: "2026-02-01T09:00:00Z",
  },
  {
    eventId: EVENTS.e0001task,
    caseId: c1.id,
    statusKind: "task",
    status: "COMPLETED",
    recordedAt: "2026-02-05T09:00:00Z",
  },
  {
    eventId: EVENTS.e0002stage,
    caseId: CASES.c0002.id,
    statusKind: "procedure",
    status: "COMPLETED",
    recordedAt: "2026-02-10T09:00:00Z",
  },
];
const oracle = inMemoryOracle(facts);
const rulesOf = (vs: { rule: string }[]) => [...new Set(vs.map((v) => v.rule))].sort();
const planted = (attrs: string) => `<span data-testid="planted" ${attrs}>اكتمل — تم تسجيله</span>`;

test("clean case workspace passes", async ({ page }) => {
  await openFixture(page, casePath, caseWorkspaceHtml());
  const v = await inspectTruth(page, oracle, NOW);
  expect(v, formatTruthViolations(v)).toEqual([]);
});

test.describe('planted unrecorded "completed" badges are detected', () => {
  test("(a) recorded COMPLETED with no data-event-id → T3", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: planted(
          'data-epistemic="recorded" data-status-kind="procedure" data-status="COMPLETED"',
        ),
      }),
    );
    expect(rulesOf(await inspectTruth(page, oracle, NOW))).toEqual(["T3"]);
  });

  test("(b) recorded COMPLETED citing an event that was never recorded → T4", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: planted(
          'data-epistemic="recorded" data-event-id="0e000000-0000-4000-8000-0000000009ff" data-status-kind="procedure" data-status="COMPLETED"',
        ),
      }),
    );
    expect(rulesOf(await inspectTruth(page, oracle, NOW))).toEqual(["T4"]);
  });

  test("(c) recorded COMPLETED citing a real event of another case → T4", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: planted(
          `data-epistemic="recorded" data-event-id="${EVENTS.e0002stage}" data-status-kind="procedure" data-status="COMPLETED"`,
        ),
      }),
    );
    const v = await inspectTruth(page, oracle, NOW);
    expect(rulesOf(v)).toEqual(["T4"]);
    expect(formatTruthViolations(v)).toContain(CASES.c0002.id);
  });

  test("(d) recorded COMPLETED citing this case's event whose fold is IN_PROGRESS → T4", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: planted(
          `data-epistemic="recorded" data-event-id="${EVENTS.e0001stage}" data-status-kind="procedure" data-status="COMPLETED"`,
        ),
      }),
    );
    expect(rulesOf(await inspectTruth(page, oracle, NOW))).toEqual(["T4"]);
  });

  test("(e) COMPLETED dressed as expected → T5", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: `<span data-epistemic="expected" data-status-kind="procedure" data-status="COMPLETED">اكتمل (متوقع)</span>`,
      }),
    );
    expect(rulesOf(await inspectTruth(page, oracle, NOW))).toEqual(["T5"]);
  });
});

test.describe("other truth rules", () => {
  test("unknown epistemic value → T1", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: `<span data-epistemic="RECORDED_FACT" data-status-kind="task" data-status="PENDING">x</span>`,
      }),
    );
    expect(rulesOf(await inspectTruth(page, oracle, NOW))).toEqual(["T1"]);
  });

  test("missing status attributes → T2; event id on an expected step → T3", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: `<span data-epistemic="expected">x</span><span data-epistemic="conditional" data-event-id="${EVENTS.e0001task}" data-status-kind="task" data-status="PENDING">y</span>`,
      }),
    );
    expect(rulesOf(await inspectTruth(page, oracle, NOW))).toEqual(["T2", "T3"]);
  });

  test("an event recorded after 'now' → T4", async ({ page }) => {
    await openFixture(page, casePath, caseWorkspaceHtml());
    const v = await inspectTruth(page, oracle, new Date("2026-02-03T00:00:00Z")); // before the task event
    expect(rulesOf(v)).toEqual(["T4"]);
  });

  test("an expected step reading exactly like the recorded one → T6", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: `<span data-epistemic="expected" data-status-kind="procedure" data-status="IN_PROGRESS">قيد التحقيق — تم تسجيله</span>`,
      }),
    );
    expect(rulesOf(await inspectTruth(page, oracle, NOW))).toEqual(["T6"]);
  });

  test("an unmarked OPEN task badge is allowed (ARCH ruling on FE-004)", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: `<span data-testid="status-badge" data-status-kind="task" data-status="OPEN">مفتوحة</span>`,
      }),
    );
    const v = await inspectTruth(page, oracle, NOW);
    expect(v, formatTruthViolations(v)).toEqual([]);
  });

  test("a COMPLETED badge with no data-epistemic at all → T8", async ({ page }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: `<span data-testid="status-badge" data-status-kind="task" data-status="COMPLETED">اكتملت</span>`,
      }),
    );
    expect(rulesOf(await inspectTruth(page, oracle, NOW))).toEqual(["T8"]);
  });

  test("a planted badge inside a same-origin frame (notification preview) → T3", async ({ page }) => {
    const badge =
      '<span data-epistemic="recorded" data-status-kind="notification" data-status="SENT">أُرسل</span>';
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({ insideWorkspace: `<iframe title="preview" srcdoc='${badge}'></iframe>` }),
    );
    const v = await inspectTruth(page, oracle, NOW);
    expect(rulesOf(v)).toEqual(["T3"]);
    expect(formatTruthViolations(v)).toContain("frame(");
  });
});

test.describe("sandboxed preview frames (SEC form for FE-006: sandbox + srcdoc, no allow-scripts, no allow-same-origin)", () => {
  const badge =
    '<span data-epistemic="recorded" data-status-kind="notification" data-status="SENT">أُرسل</span>';
  const sandboxed = `<iframe sandbox="" title="preview" srcdoc='${badge}'></iframe>`;

  test("an unrecorded SENT badge inside a sandboxed srcdoc preview → T3", async ({ page }) => {
    await openFixture(page, casePath, caseWorkspaceHtml({ insideWorkspace: sandboxed }));
    expect(rulesOf(await inspectTruth(page, oracle, NOW))).toEqual(["T3"]);
  });

  test("same badge when the frame refuses evaluation → read from srcdoc in the parent, T3", async ({
    page,
  }) => {
    await openFixture(page, casePath, caseWorkspaceHtml({ insideWorkspace: sandboxed }));
    const v = await inspectTruth(page, oracle, NOW, refuseFrameEvaluation(page));
    expect(rulesOf(v)).toEqual(["T3"]);
    expect(formatTruthViolations(v)).toContain("srcdoc)");
  });

  test("a frame that can be neither evaluated nor read from srcdoc → T7, never a silent pass", async ({
    page,
  }) => {
    await openFixture(
      page,
      casePath,
      caseWorkspaceHtml({
        insideWorkspace: `<iframe sandbox="" title="preview" src="/preview-frame"></iframe>`,
      }),
    );
    const v = await inspectTruth(page, oracle, NOW, refuseFrameEvaluation(page));
    expect(rulesOf(v)).toEqual(["T7"]);
  });
});
