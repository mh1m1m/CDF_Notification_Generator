# Next Action Card sources (REQ-IA-009): design note

**V13-PROC-025 · PROC · reviewer SEC, then ARCH accepts · base `develop` · design only, no code · SYNTHETIC-DATA
REFERENCE IMPLEMENTATION, not CDF production.**

REQ-IA-009 (M1, Next Action Card): "The next authorized action is prominent and important deadlines are visible."

This note answers four questions from the Chief Architect (1 Nov):

1. Which decided data can name a persona's next authorized action on one case today?
2. Which deadlines count as important, and where does each come from?
3. What must not be shown until the owner decides?
4. What is the contract of the pure function that UX and FE will build on?

The rule throughout is REQ-VIS-005 and the epistemic ceiling (`lib/domain/epistemic.ts`: "The certainty of the
interface must never exceed the certainty of its authoritative source"). No action, state or deadline is invented. When
nothing decided names an action, the card shows nothing.

**Answer in short.** Today one source names an action that a persona is allowed to take on a case: **the persona's own
open task on that case**. Its title, its status and its due date are recorded in V13, and the database lets the
assignee act on it (`api_update_task_status`). Every other candidate below rests on something the owner has not decided
yet, so it stays off the card.

## 1. What can name the next authorized action today

| Candidate | What it says | Recorded in V13? | Decided? | On the card in M1? |
| --- | --- | --- | --- | --- |
| **The persona's own open task on the case** (`task`, migration 0003; read through `ProceduralRecordsReader.listTasks`, `CaseTask` in `lib/contracts/procedural-records.ts`) | "This task is yours on this case": title (ar, en), task code, status, due date | Yes. `task.assignee_persona_id` is recorded and `case_tasks` exposes it as `is_mine`, computed in the database from the verified claims | Yes. Who may act is decided in the database: `api_update_task_status` accepts the assignee (or a persona with an active assignment on the case) on an ACTIVE case, with an allowed transition (`_task_transition_allowed`). The status codes are the task status catalogue (`lib/domain/task-status.ts`, #35, ruling on OI-029) | **Yes**, the only source |
| Notification next-action rules (`lib/notifications/next-action/rules.ts`, `deriveNextAction`) | A per-notification-type, per-recipient-class action, for example `CAST_VOTE` or `REVIEW_MINUTES`, checked with `lib/authority/check.ts` | No. The rules need a notification type, a recipient class, an actor in the authority model's capacities (`CHAIR`, `MEMBER` …) with seat and recusal facts, and a procedural object (meeting, vote, minutes). V13 records none of these. Procedural objects are REQ-JRN-010 (M3) | No. `authority_v13.json` is `status: PROPOSED` (`version AM-V13-draft-2026-10-27`). It lists 45 actions: 39 rest on owner answers and 6 are SOURCE_REQUIRED. Its own header says PROPOSED ≠ APPROVED. Every result carries `epistemic: PROPOSED_ACTION`, and its `release_status` is `DESIGN_PREVIEW` unless the check returns `BASIS_RECORDED` | **No** (see §3) |
| The authority model on the persona's case capacity | "Your capacity allows action X" | The capacity is recorded (`case_assignment.capacity`: `LEAD_INVESTIGATOR`, `INVESTIGATOR`, `SECRETARY`, `GOVERNANCE_REVIEWER`) | No. These four codes are not the authority model's capacities. `LEAD_INVESTIGATOR` and `GOVERNANCE_REVIEWER` do not exist there at all. Treating `SECRETARY` or `INVESTIGATOR` as the same capacity because the names match would itself decide authorization behaviour and decision rights, which REQ-GOV-014 reserves to the owner | **No** |
| The journey's next expected step (`lib/journeys`, `buildProgressView`) | The catalogue's next step after the case's position | The catalogue is shared and PROPOSED (`catalogue_v13.json`). The case's position needs the stage → S-code mapping (OI-039) | No. A Layer B step is `EXPECTED_PROCESS`, not an action anyone is authorised to take. The charter forbids presenting it as done or due | **No** |
| Recorded procedural events (`procedural_event`) | What happened | Yes | — | Not an action. Events say what happened, never what to do next |

**Why the task is an authorized action and not a guess.**

- **The action is recorded.** The task exists, its title is recorded text, and the database computes `is_mine`.
- **The authorization is enforced, not inferred.** The command that acts on a task checks the assignee and the case
  state itself. The card adds no right; it points at a task the persona can already open in the Tasks tab and on My Work.
- **The card names the task, not a new verb.** It shows the task's own title and status. It does not turn
  `task_code` into an authority action, even where a code reads the same as one (the seed's `ISSUE_DECISION_NOTICE`
  task is a task, not `ISSUE_DECISION_NOTICE` in `authority_v13.json`).

## 2. Important deadlines and their sources

| Deadline | Source | Epistemic status | On the card in M1? |
| --- | --- | --- | --- |
| **The chosen task's due date** | `task.due_date` (a calendar `date`, no time and no zone). Seeded today; no command sets it yet | **Recorded** (`RECORDED_FACT`). It is the task's own due date, not a procedural period. The card says "due date" and never "deadline under the rules" | **Yes**, the date only, from the record |
| Overdue, due today or upcoming, for that date | `deadlineOf(due_date, today)` in `lib/server/my-work.ts`, with today taken as the calendar date in Asia/Riyadh, as My Work does | **Computed** (`DERIVED_FROM_VERIFIED_FACTS`) from the recorded date and the clock | **Yes**, computed by FE with the same helper, so the card and My Work never disagree |
| Procedural deadlines named by the next-action rules: `INFO_REQUEST_DUE`, `VOTE_DUE`, `DECISION_NOTICE_DUE`, `GRIEVANCE_DUE`, `ATTENDANCE_CONFIRMATION_DUE`, `STATEMENT_DUE`, `DEFENCE_DUE`, `DECISION_DUE`, `MINUTES_REVIEW_DUE`, `LEGAL_OPINION_DUE` | `resolveDeadline` in `rules.ts`. It needs a deadline record on a procedural object, a recorded basis event of the right type, a rule id that is not SOURCE_REQUIRED, and a date with a zone | Would be **computed**. Today there are no inputs: V13 records no procedural objects or deadline records (REQ-JRN-010, M3), and the periods have no approved source (`authority_v13.json` `documents_missing`: DOA, committee rules, disciplinary, grievance and others). The rule wording is **PROPOSED** | **No**. `resolveDeadline` already returns `null` with `SOURCE_REQUIRED` in this state, and the card shows nothing in its place |
| Grievance window start (`GRIEVANCE_WINDOW_STARTED`) | Rules comment: the clock starts at effective delivery. The period itself has no source | **PROPOSED** | **No** |
| Case dates (`opened_at`, `closed_at`) | `case_record` | Recorded, but they are not deadlines | **No** |

"Important" in M1 therefore means one thing: the due date of the task the card names. Ranking deadlines by importance
across kinds would be a new rule, so this note does not propose one. When procedural deadlines exist (M3) and their
periods have an approved source, their order on the card is a decision for the owner.

## 3. What must not be shown until the owner decides

| Item | Why it waits | Owner decision |
| --- | --- | --- |
| A next step or stage derived from `case_record.stage`, or the journey position | The stage → journey S-code mapping has no source (OI-039). The recorded stage may still be shown as recorded, as the case header does, but no "next stage" is derived from it | Procedural status semantics (REQ-GOV-014, OI-039) |
| Any action from `deriveNextAction` or `check()` | The authority model is PROPOSED. The case capacities do not map to its capacities. Seat, recusal and delegation facts are not recorded | Decision rights and authorization behaviour (REQ-GOV-014) |
| A mapping from `task_code` to an authority action | It would give a task a formal meaning it does not have | Decision rights (REQ-GOV-014) |
| Any value marked SOURCE_REQUIRED: the six SOURCE_REQUIRED actions (`RESCHEDULE_MEETING`, `RECORD_CHAIR_DIRECTION`, `OPEN_PROCEDURAL_VOTE`, `ACKNOWLEDGE_REFERRAL`, `SEND_WITNESS_NOTICE`, `CORRECT_NOTIFICATION`) and every procedural period | No approved source. PROC never writes a value in its place | The owner's sources |
| `what_next` items and Layer B expected steps as actions | They are `EXPECTED_PROCESS` or `CONDITIONAL_STEP`, never an authorized action | (unchanged, charter rule) |
| Notification recipients as action holders | Recipient codes are not mapped to the disclosure classes (OI-037) | Notification recipients (REQ-GOV-014) |
| The PROPOSED wording of `BLOCKED` and `DONE` (`CASE_TASK_STATUS_PROPOSED_LABELS`) | Already shown elsewhere as PROPOSED wording. The card uses the same labels and adds no new wording of its own for statuses | Wording (owner may change) |

Nothing on the card invents a state for a screenshot or a demo (REQ-VIS-005). When no task qualifies, the card renders
nothing. The no-action state needs no wording: the page shows nothing in that place.

## 4. Contract of the pure function

**Where.** `lib/domain/next-action.ts` (PROC path). It is pure: no I/O, no clock and no `server-only` import, and it
does not import `lib/notifications/next-action`. FE's BFF calls it with what it has already read for the Case Workspace.

```ts
import type { CaseHeader, CaseTask, RequestIdentity } from "@/lib/contracts";

export interface NextActionInput {
  /** The case as CaseSourceAdapter.getCase returned it for this identity. */
  readonly case: Pick<CaseHeader, "case_id" | "is_restricted" | "records_state" | "my_capacity">;
  /** The verified identity the reads ran under. Not used to widen anything. */
  readonly persona: Pick<RequestIdentity, "persona_id">;
  /** The persona's capacity on this case (CaseHeader.my_capacity), null when it holds none. */
  readonly capacity: CaseHeader["my_capacity"];
  /** ProceduralRecordsReader.listTasks(identity, case_id), as read: RLS-filtered, ordered by
   *  due_date (nulls last), task_code, id. */
  readonly records: { readonly tasks: readonly CaseTask[] };
}

export type NextActionDeadline = {
  readonly kind: "TASK_DUE_DATE";
  readonly date: string; // YYYY-MM-DD, as recorded; FE classifies it with deadlineOf
  readonly epistemic: "RECORDED_FACT";
  readonly source: { readonly kind: "task.due_date"; readonly task_id: string };
};

export type NextAction =
  | { readonly kind: "NONE" }
  | {
      readonly kind: "TASK";
      readonly epistemic: "RECORDED_FACT";
      readonly case_id: string;
      readonly task_id: string;
      readonly task_code: string;
      readonly title: { readonly ar: string; readonly en: string };
      readonly status: "OPEN" | "IN_PROGRESS" | "BLOCKED";
      readonly row_version: number;
      readonly source: { readonly kind: "task"; readonly task_id: string; readonly status_event_id: string | null };
      readonly deadlines: readonly NextActionDeadline[]; // zero or one entry in M1
    };

export function nextActionForCase(input: unknown): NextAction;
```

**Behaviour, in order.** The function stops at the first failing step and returns `{ kind: "NONE" }`.

1. **Parse.** The input must parse with the existing schemas: `CaseIdSchema`, `RecordsStateSchema`, `CaseCapacitySchema`
   nullable, and `CaseTaskSchema` for every task. Anything else, including an unknown or malformed id, gives `NONE`.
2. **One case.** Every task's `case_id` must equal `input.case.case_id`. One foreign row gives `NONE` for the whole
   input; no row is filtered out and the rest kept. This is the same rule as the journey resolver's `CASE_MISMATCH`
   (V13-PROC-018).
3. **Capacity agrees.** `input.capacity` must equal `input.case.my_capacity`.
4. **Active case.** `records_state` must be `ACTIVE`. A closed case gives `NONE`, because the command refuses there
   (`V1423`).
5. **Restricted case.** If `is_restricted` is true, the persona must hold a capacity on the case (`capacity !== null`).
   This repeats the access rule as a second line. The reader already returns nothing to anyone else.
6. **Choose.** Choose the first task with `is_mine === true` and a status of OPEN, IN_PROGRESS or BLOCKED. The order is
   the reader's existing one: due date (nulls last), task code, id (migrations 0006 and 0011; My Work uses the same
   order). The function sorts again by those keys rather than trusting the input order. This introduces no new
   priority rule.
7. **Deadline.** Emit one `TASK_DUE_DATE` entry when that task's `due_date` is set, and none otherwise.

The result never names another persona, never counts tasks and never says why it is `NONE`. An unknown case, a hidden
case and a case with no task of yours therefore look identical (CLAUDE.md §3, no existence leak).

**The card reads no new data.** `nextActionForCase` takes the task rows the Case Workspace overview already reads for
"My open tasks in this case": `loadCaseWorkspace` (`lib/server/case-workspace.ts`) calls `listTasks` over `case_tasks`
and keeps `is_mine` rows with status OPEN, IN_PROGRESS or BLOCKED. The function selects from those same authorised
rows, with the same three statuses, so the card adds no query, no read function and no grant. When OI-054's fix lands
(V13-DB-022, a filtered keyset read of the persona's own open tasks on one case, then V13-FE-014), the card and the
overview move to it together. The contract stays the same, because the function sorts its input itself (step 6).

**What the card shows for `NONE`: nothing.** The card renders no element, no heading and no fixed line. `NONE` carries
no reason to the UI, so the card cannot hint at other people's tasks or at any case state beyond what the page already
shows. A fixed no-action line was considered and is not proposed:

- The overview already says "No open tasks are assigned to you in this case" (`case.overview.noMyTasks`) for the
  common case, so a second line would repeat it.
- `NONE` also covers a closed case where the persona's tasks are still open. A line such as "no action" would then
  contradict the task list beside it, or would need a reason the result does not carry.

**Negative cases the tests must cover** (`tests/unit/domain/next-action.spec.ts`, PROC). Each asserts `NONE` unless
stated:

| # | Input | Expected |
| --- | --- | --- |
| N1 | No tasks | `NONE` |
| N2 | Only DONE or CANCELLED tasks of the persona | `NONE` |
| N3 | Another persona's task and an unassigned task (`is_mine: false`), and none of the persona's own; then the same rows plus one of the persona's tasks due later | `NONE`; then the persona's task (an earlier task of someone else never wins) |
| N4 | The persona's open task on a CLOSED case | `NONE` |
| N5 | Restricted case and `capacity: null` | `NONE` |
| N6 | Restricted case with a capacity and the persona's task | `TASK` (control: restricted alone does not hide the persona's own work) |
| N7 | Unknown or malformed `case_id`, malformed task id, unknown status code, extra fields (strict schemas) | `NONE` |
| N8 | Tasks of case 0001 plus one row of case 0002 (another case) | `NONE` for the whole input |
| N9 | `capacity` differs from `case.my_capacity` | `NONE` |
| N10 | Two of the persona's tasks: due 3 Nov and none; due 3 Nov and due 2 Nov; equal dates with different codes; input order shuffled | The reader's order wins (2 Nov, then 3 Nov, then the undated task; ties by code, then id) |
| N11 | A task with no due date | `TASK` with `deadlines: []` (no date is invented) |
| N12 | Output contents | No persona id, no other task, no count, and no field outside the type (snapshot of keys) |
| N13 | Purity | Same input gives the same output; the input is not mutated (frozen input passes) |

Mutation checks to run before review: drop step 2 (N8 fails), drop step 4 (N4), drop step 5 (N5), choose without
`is_mine` (N3), keep the input order instead of sorting (N10).

**Later work, not part of this design.**

- **UX** designs the card on this contract after UX-014: one task title, its status and its due date, with a link to the
  task in the Tasks tab, and nothing when the result is `NONE`.
- **FE** wires it into the Case Workspace and computes the date state with `deadlineOf`.
- **When the owner decides** the authority model, the capacity mapping and the procedural objects (REQ-GOV-014,
  REQ-JRN-010), a second source can join through `deriveNextAction`, but only results with `BASIS_RECORDED`. How it
  ranks against the task source is the owner's decision.

## 5. Checklist (CLAUDE.md §7)

- **Requirement.** REQ-IA-009 (M1). Related: REQ-VIS-005, REQ-GOV-014, REQ-JRN-010.
- **Access enforced.** In the database (RLS on `task`; `case_tasks` computes `is_mine`; `api_update_task_status`
  checks the assignee and case state) and again in the function (one case, active, restricted needs a capacity).
- **Audit event.** None: the card only reads. Acting on the task goes through the existing command, which writes its
  own audit event.
- **Tests.** As listed above, plus FE's page tests when the card is wired.
- **Production component.** `PRODUCTION_SUBSTITUTION_REQUIRED`: in production the next action comes from the
  procedural read model and the authorization layer (`@cdf/authorization` + `authz.*`), as the header of `rules.ts`
  already says.
