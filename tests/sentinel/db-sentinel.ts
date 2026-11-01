// Case Context Sentinel, database half (V13-QA-003; TEST_ARCHITECTURE.md §7 DB layer). QA owns the "everything the
// persona can read is consistent" half; SEC owns the adversarial half (forged claims, bypass attempts). Checks one
// persona's snapshot (tests/fixtures/db-snapshot.ts):
//   D1  a row of any case-keyed table the role may read belongs to a case the persona cannot see
//   D2  a child row is readable while its parent is not (task event → task, notification event → notification,
//       superseding notification → superseded one)
//   D3  a child row's case_id differs from its parent's
//   D4  a notification names a recipient persona who was not on that case's team when it was created (an assignment
//       of the same case, any capacity, whose window holds created_at); the detail says whether the persona is on
//       another case's team instead (V13-QA-007, OI-048, REQ-QA-013)
// Pure functions, so the planted-fault self-test runs them on a copy of a real snapshot. SYNTHETIC data only.
import type { PersonaSnapshot } from "../fixtures/db-snapshot";

export interface DbViolation {
  rule: "D1" | "D2" | "D3" | "D4";
  detail: string;
}

export function dbSentinelViolations(s: PersonaSnapshot): DbViolation[] {
  const out: DbViolation[] = [];
  const visible = new Set(s.cases.map((c) => c.id));
  for (const [table, caseIds] of Object.entries(s.caseKeyed)) {
    for (const id of new Set(caseIds)) {
      if (!visible.has(id)) out.push({ rule: "D1", detail: `${table} has a row of case ${id}` });
    }
  }
  const tasks = new Map(s.tasks.map((t) => [t.id, t]));
  for (const e of s.events) {
    if (e.subject_type !== "task" || e.subject_id === null) continue;
    const t = tasks.get(e.subject_id);
    if (!t) out.push({ rule: "D2", detail: `event ${e.id} of task ${e.subject_id}, which is not readable` });
    else if (t.case_id !== e.case_id)
      out.push({ rule: "D3", detail: `event ${e.id} is on case ${e.case_id}, its task on ${t.case_id}` });
  }
  const notifications = new Map(s.notifications.map((n) => [n.id, n]));
  for (const e of s.notificationEvents) {
    const n = notifications.get(e.notification_id);
    if (!n)
      out.push({
        rule: "D2",
        detail: `notification event ${e.id} of ${e.notification_id}, which is not readable`,
      });
    else if (n.case_id !== e.case_id)
      out.push({
        rule: "D3",
        detail: `notification event ${e.id} is on case ${e.case_id}, its notification on ${n.case_id}`,
      });
  }
  for (const n of s.notifications) {
    if (n.supersedes_id === null) continue;
    const prev = notifications.get(n.supersedes_id);
    if (!prev)
      out.push({
        rule: "D2",
        detail: `notification ${n.id} supersedes ${n.supersedes_id}, which is not readable`,
      });
    else if (prev.case_id !== n.case_id)
      out.push({
        rule: "D3",
        detail: `notification ${n.id} is on case ${n.case_id}, the one it supersedes on ${prev.case_id}`,
      });
  }
  for (const n of s.notifications) {
    if (n.recipient_persona_id === null) continue;
    // Fixed-width UTC timestamps with microseconds (db-snapshot.ts), so string order is time order, without the
    // millisecond rounding of Date.
    const at = n.created_at;
    const held = s.assignments.filter((a) => a.persona_id === n.recipient_persona_id);
    const onTeam = held.some(
      (a) => a.case_id === n.case_id && a.valid_from <= at && (a.valid_to === null || a.valid_to > at),
    );
    if (onTeam) continue;
    const elsewhere = [...new Set(held.filter((a) => a.case_id !== n.case_id).map((a) => a.case_id))];
    const sameCaseOutsideWindow = held.some((a) => a.case_id === n.case_id);
    out.push({
      rule: "D4",
      detail:
        `notification ${n.id} on case ${n.case_id} is addressed to persona ${n.recipient_persona_id}, ` +
        (sameCaseOutsideWindow
          ? "whose assignment to that case did not hold when it was created"
          : elsewhere.length
            ? `who is on the team of case ${elsewhere.join(", ")} instead`
            : "who is on no case team the persona can read"),
    });
  }
  return out;
}

export const formatDbViolations = (vs: readonly { rule: string; detail: string }[]) =>
  vs.length ? vs.map((v) => `${v.rule}: ${v.detail}`).join("\n") : "no violation";
