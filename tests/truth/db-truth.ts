// Procedural Truth Inspector, database half (V13-QA-004; TEST_ARCHITECTURE.md §8). The browser half checks that each
// badge points at a recorded event; this half checks that the records themselves tell one story, in one persona's
// snapshot (tests/fixtures/db-snapshot.ts):
//   U1  a task's status is not what its TASK_STATUS_CHANGED events give when folded from OPEN in recorded order,
//       or a step starts from a status other than the previous step's result
//   U2  an event recorded in the future, or one that occurred after it was recorded
//   U3  a case without exactly one CASE_OPENED, or whose CLOSED records state and CASE_CLOSED event disagree
//   U4  a notification whose first event is not its DRAFT_CREATED (or that has none)
// M1 vocabulary: the database records task changes as TASK_STATUS_CHANGED {from, to}; a task with no event is OPEN.
// Pure functions, so the planted-fault self-test runs them on a copy of a real snapshot. SYNTHETIC data only.
import type { PersonaSnapshot } from "../fixtures/db-snapshot";

export interface TruthDbViolation {
  rule: "U1" | "U2" | "U3" | "U4";
  detail: string;
}

const INITIAL_TASK_STATUS = "OPEN";

export function dbTruthViolations(s: PersonaSnapshot): TruthDbViolation[] {
  const out: TruthDbViolation[] = [];
  const byTask = new Map<string, PersonaSnapshot["events"]>();
  for (const e of s.events) {
    if (e.recorded_in_future) out.push({ rule: "U2", detail: `event ${e.id} is recorded in the future` });
    if (e.occurred_after_recorded)
      out.push({ rule: "U2", detail: `event ${e.id} occurred after it was recorded` });
    if (e.event_code !== "TASK_STATUS_CHANGED" || e.subject_type !== "task" || e.subject_id === null)
      continue;
    byTask.set(e.subject_id, [...(byTask.get(e.subject_id) ?? []), e]);
  }
  for (const t of s.tasks) {
    let status = INITIAL_TASK_STATUS;
    for (const e of [...(byTask.get(t.id) ?? [])].sort((a, b) => a.seq - b.seq)) {
      if (e.from_status !== status)
        out.push({
          rule: "U1",
          detail: `task ${t.id}: event ${e.id} starts from ${e.from_status}, the fold is at ${status}`,
        });
      status = e.to_status ?? status;
    }
    if (status !== t.status)
      out.push({ rule: "U1", detail: `task ${t.id} is ${t.status}, its events give ${status}` });
  }
  for (const c of s.cases) {
    const codes = s.events
      .filter((e) => e.case_id === c.id && e.subject_type === null)
      .map((e) => e.event_code);
    const opened = codes.filter((x) => x === "CASE_OPENED").length;
    if (opened !== 1) out.push({ rule: "U3", detail: `case ${c.ref} has ${opened} CASE_OPENED events` });
    const closedEvent = codes.includes("CASE_CLOSED");
    if (closedEvent !== (c.records_state === "CLOSED"))
      out.push({
        rule: "U3",
        detail: `case ${c.ref} is ${c.records_state} but CASE_CLOSED is ${closedEvent ? "" : "not "}recorded`,
      });
  }
  for (const n of s.notifications) {
    const first = s.notificationEvents.find((e) => e.notification_id === n.id && e.seq === 1);
    if (!first || first.event_code !== "DRAFT_CREATED")
      out.push({ rule: "U4", detail: `notification ${n.id} starts with ${first?.event_code ?? "no event"}` });
  }
  return out;
}
