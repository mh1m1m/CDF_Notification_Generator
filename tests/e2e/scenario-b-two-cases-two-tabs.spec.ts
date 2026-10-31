// Scenario B — two cases in two tabs (V13-QA-002; TEST_ARCHITECTURE.md §6, UXQA-03).
// Investigator Gamma (INVESTIGATIONS) has case 0001 open in tab 1 and case 0002 in tab 2, and changes the status of
// her task "Draft findings" (0002) from tab 2. The database, read in each persona's own security context, must show
// exactly one changed task row (that task: new status, row_version + 1) and exactly one new procedural event
// (TASK_STATUS_CHANGED for that task and case, from → to); tab 1 after a reload is unchanged; tab 2 shows the new
// status with the new event as its source (Truth Inspector, database oracle). A stale update (old row_version, from a
// tab opened before the change) gives the stale notice with a correlation id and changes nothing. Negatives: a task of
// a case Gamma cannot see, with its correct row_version and an allowed transition, gets exactly the same answer as an
// unknown task id, and changes nothing.
// The audit event the command writes in the same transaction is not readable by any persona (audit_event has no
// cdf_v13_user policy); DB's integration and security suites assert it. The tests run serially because they compare
// whole-database snapshots. The status chosen depends on the task's current status, so a CI retry stays valid.
// SYNTHETIC data only.
import { expect, test, type Page } from "@playwright/test";
import {
  databaseEventOracle,
  scenarioDb,
  visibleCases,
  visibleEvents,
  visibleTasks,
  type EventRow,
  type ScenarioDb,
  type TaskRow,
} from "../fixtures/db";
import { signInAs } from "../fixtures/personas";
import { caseId, casePath, expectCaseShown, SEEDED, taskId } from "../fixtures/scenario";

const GAMMA = "investigator-gamma";
const WS = "INVESTIGATIONS" as const;
const ONE = caseId("01");
const TWO = caseId("02");
const TASK = taskId("04"); // DRAFT_FINDINGS, case 0002, assigned to Gamma
const OTHER_GAMMA_TASK = taskId("03"); // COLLECT_DOCUMENTS, case 0002, assigned to Gamma, untouched here
const HIDDEN_TASK = taskId("17"); // case 0009 (restricted, Beta only)
const UNKNOWN_TASK = "0d000000-0000-4000-8000-00000000ff99";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/;
/** A status the task can move to from each open status, keeping it open (so My Work counts stay as seeded). */
const NEXT: Record<string, string> = { OPEN: "IN_PROGRESS", IN_PROGRESS: "BLOCKED", BLOCKED: "IN_PROGRESS" };

test.describe.configure({ mode: "serial" });

let db: ScenarioDb;
test.beforeAll(() => {
  db = scenarioDb();
});
test.afterAll(async () => {
  await db?.end();
});

/** Every task and procedural event in the seed, read as Secretary Alpha and Investigator Beta (together: all ten). */
async function snapshot(): Promise<{ tasks: Map<string, TaskRow>; events: Map<string, EventRow> }> {
  const tasks = new Map([
    ...(await visibleTasks(db, "secretary-alpha", "SECRETARIAT")),
    ...(await visibleTasks(db, "investigator-beta", "INVESTIGATIONS")),
  ]);
  const events = new Map([
    ...(await visibleEvents(db, "secretary-alpha", "SECRETARIAT")),
    ...(await visibleEvents(db, "investigator-beta", "INVESTIGATIONS")),
  ]);
  const caseIds = new Set([...tasks.values()].map((t) => t.case_id));
  expect([...caseIds].sort(), "the snapshot covers every seeded case").toEqual(SEEDED.map(caseId));
  return { tasks, events };
}

function expectUnchanged(
  before: Awaited<ReturnType<typeof snapshot>>,
  after: Awaited<ReturnType<typeof snapshot>>,
) {
  expect(after.tasks).toEqual(before.tasks);
  expect([...after.events.keys()].sort()).toEqual([...before.events.keys()].sort());
}

/** The task rows a tab shows, as status and source event, in page order. */
async function taskRows(page: Page) {
  return page.locator('[data-testid^="case-task-"][data-task-id]').evaluateAll((rows) =>
    rows.map((r) => {
      const s = r.querySelector('[data-testid="case-task-status"]');
      return {
        id: r.getAttribute("data-task-id"),
        status: s?.getAttribute("data-task-status") ?? null,
        event: s?.getAttribute("data-event-id") ?? null,
      };
    }),
  );
}

/** Opens the update form of `task` on My Work, picks `status` and submits it. */
async function submitUpdate(page: Page, task: string, status: string) {
  const form = page.getByTestId(`task-status-update-${task}`);
  await form.locator("summary").click();
  await page.getByTestId(`task-status-select-${task}`).selectOption(status);
  await page.getByTestId(`task-status-submit-${task}`).click();
}

/** Rewrites the hidden fields of `visible`'s update form (a tampered POST) and submits it. */
async function submitForged(
  page: Page,
  visible: string,
  forged: { task: string; version: number; status: string },
) {
  const form = page.getByTestId(`task-status-update-${visible}`);
  await form.locator("summary").click();
  await page.getByTestId(`task-status-select-${visible}`).selectOption(forged.status);
  await form.locator("form").evaluate((el, f) => {
    (el.querySelector('input[name="task_id"]') as HTMLInputElement).value = f.task;
    (el.querySelector('input[name="expected_version"]') as HTMLInputElement).value = String(f.version);
  }, forged);
  await page.getByTestId(`task-status-submit-${visible}`).click();
}

test("Scenario B — an update in tab 2 (case 0002) changes only that task and leaves tab 1 (case 0001) as it was", async ({
  context,
}) => {
  const cases = await visibleCases(db, GAMMA, WS);
  expect([...cases.keys()].sort(), "Gamma's visible cases (DATA_MODEL §5)").toEqual(
    ["01", "02", "03", "05", "06", "10"].map(caseId),
  );
  const visible = new Map([...cases].map(([id, c]) => [id, c.ref]));
  const oracle = databaseEventOracle(db, GAMMA, WS);
  const before = await snapshot();
  const task = before.tasks.get(TASK)!;
  expect(task.case_id).toBe(TWO);
  const to = NEXT[task.status];
  expect(to, `task status ${task.status} has a next open status`).toBeDefined();

  const tab1 = await context.newPage();
  await signInAs(tab1, GAMMA);
  await tab1.goto(casePath(ONE, "tasks"));
  await expectCaseShown(tab1, ONE, "tasks", visible, oracle);
  const tab1Before = await taskRows(tab1);
  expect(tab1Before.length).toBeGreaterThan(0);

  const tab2 = await context.newPage();
  await tab2.goto(casePath(TWO, "tasks"));
  await expectCaseShown(tab2, TWO, "tasks", visible, oracle);
  await expect(tab2.getByTestId(`case-task-${TASK}`).getByTestId("case-task-status")).toHaveAttribute(
    "data-task-status",
    task.status,
  );

  await tab2.goto("/my-work");
  await submitUpdate(tab2, TASK, to!);
  await expect(tab2).toHaveURL(new RegExp(`/my-work\\?updated=${TASK}$`));
  await expect(tab2.getByTestId("task-status-updated")).toBeVisible();

  // Database: one task row and one procedural event changed, nothing else.
  const after = await snapshot();
  const changed = [...after.tasks.values()].filter(
    (t) => JSON.stringify(t) !== JSON.stringify(before.tasks.get(t.id)),
  );
  expect(changed.map((t) => t.id)).toEqual([TASK]);
  expect(after.tasks.size).toBe(before.tasks.size);
  expect(after.tasks.get(TASK)).toMatchObject({
    case_id: TWO,
    status: to,
    row_version: task.row_version + 1,
  });
  const added = [...after.events.values()].filter((e) => !before.events.has(e.id));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({
    case_id: TWO,
    event_code: "TASK_STATUS_CHANGED",
    subject_id: TASK,
    from_status: task.status,
    to_status: to,
  });
  expect([...before.events.keys()].every((id) => after.events.has(id))).toBe(true);

  // Tab 2 shows the new status, sourced from the new event.
  await tab2.goto(casePath(TWO, "tasks"));
  await expectCaseShown(tab2, TWO, "tasks", visible, oracle);
  const badge = tab2.getByTestId(`case-task-${TASK}`).getByTestId("case-task-status");
  await expect(badge).toHaveAttribute("data-task-status", to!);
  await expect(badge).toHaveAttribute("data-event-id", added[0]!.id);
  await expect(badge).toHaveAttribute("data-epistemic", "recorded");

  // Tab 1, reloaded, is exactly as it was.
  await tab1.reload();
  await expectCaseShown(tab1, ONE, "tasks", visible, oracle);
  expect(await taskRows(tab1)).toEqual(tab1Before);
});

test("Scenario B — a stale update from a tab opened before the change shows the stale notice and changes nothing", async ({
  context,
}) => {
  const old = await context.newPage();
  await signInAs(old, GAMMA);
  await old.goto("/my-work");
  await expect(old.getByTestId(`task-status-update-${TASK}`)).toBeVisible();

  // Another tab changes the task first.
  const fresh = await context.newPage();
  const current = (await snapshot()).tasks.get(TASK)!;
  await fresh.goto("/my-work");
  await submitUpdate(fresh, TASK, NEXT[current.status]!);
  await expect(fresh).toHaveURL(new RegExp(`/my-work\\?updated=${TASK}$`));

  const before = await snapshot();
  // The old tab still holds the previous row_version; whatever status it offers, the version is refused first.
  const form = old.getByTestId(`task-status-update-${TASK}`);
  await form.locator("summary").click();
  const offered = await old
    .getByTestId(`task-status-select-${TASK}`)
    .locator("option")
    .first()
    .getAttribute("value");
  await old.getByTestId(`task-status-select-${TASK}`).selectOption(offered!);
  await old.getByTestId(`task-status-submit-${TASK}`).click();
  await expect(old).toHaveURL(/\/my-work\?stale=/);
  const ref = new URL(old.url()).searchParams.get("stale")!;
  expect(ref).toMatch(UUID);
  await expect(old.getByTestId("task-status-stale")).toContainText(ref);
  await expect(old.getByTestId("task-status-updated")).toHaveCount(0);
  expectUnchanged(before, await snapshot());
});

test("Scenario B negative — a task of a case Gamma cannot see answers exactly like an unknown task", async ({
  page,
}) => {
  const before = await snapshot();
  const hidden = before.tasks.get(HIDDEN_TASK)!;
  expect(hidden.case_id).toBe(caseId("09"));
  expect((await visibleTasks(db, GAMMA, WS)).has(HIDDEN_TASK), "Gamma cannot read the hidden task").toBe(
    false,
  );
  expect(NEXT[hidden.status]).toBeDefined();

  await signInAs(page, GAMMA);
  const answers: { url: string; text: string }[] = [];
  for (const forged of [
    // The hidden task with its correct version and an allowed transition: only authorisation refuses it.
    { task: HIDDEN_TASK, version: hidden.row_version, status: NEXT[hidden.status]! },
    { task: UNKNOWN_TASK, version: 1, status: "IN_PROGRESS" },
  ]) {
    await page.goto("/my-work");
    await submitForged(page, OTHER_GAMMA_TASK, forged);
    await expect(page).toHaveURL(/\/my-work\?ref=/);
    const ref = new URL(page.url()).searchParams.get("ref")!;
    expect(ref).toMatch(UUID);
    const error = page.getByTestId("action-error");
    await expect(error).toContainText(ref);
    await expect(page.getByTestId("task-status-updated")).toHaveCount(0);
    await expect(page.getByTestId("task-status-stale")).toHaveCount(0);
    answers.push({
      url: page.url().replace(ref, "<ref>"),
      text: (await error.innerText()).replace(ref, "<ref>"),
    });
  }
  expect(answers[0]).toEqual(answers[1]);
  expectUnchanged(before, await snapshot());
});
