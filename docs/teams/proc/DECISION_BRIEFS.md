# PROC decision briefs — for the owner (synthetic data only)

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Task V13-PROC-009. Everything in this file is
**PROPOSED**. No mapping is applied and no code changes with this file. Each question asks for one word: the option
letter. Until the owner answers, the current behaviour stays as it is. That behaviour is the "keep" option in each
table, and it fails closed.

Both questions decide who sees what. REQ-GOV-014 reserves that decision for the owner, so PROC proposes and does not
choose.

How the disclosure figures were produced: the policy's own `decide()` (`lib/disclosure/project.ts`) was run on the
committed policy (`lib/disclosure/policy_v13.json`, version `DP-V13-draft-2026-10-27`, itself PROPOSED). For each field,
the experience-level outcome is the most restrictive one across that experience's surfaces. The context is `*`
(internal delivery, case not restricted). The run was a one-off scratch script and is not committed. "Fields not
prohibited" counts the 50 policy fields whose outcome is ALLOWED, REDACTED, GENERALIZED or SAFE_REFERENCE.

---

## OI-037 — migration 0004's recipient codes against the policy's 13 classes

**Question for the owner.** Which policy class, if any, may each database recipient code be projected as? Answer one
letter per row in the table under "Proposed answer".

### Sources

- Database codes: `database/migrations/0004_notification_core.sql` lines 24–29 (table
  `notification_recipient_class`), referenced by `notification.recipient_class` (line 79).
- Policy classes: `lib/disclosure/project.ts` lines 82–96 (`RECIPIENT_CLASSES`) and `policy_v13.json` `recipients`
  (line 6).
- Recipient rules: `policy_v13.json` `recipient_resolution` (lines 111–118):
  - a recused or conflicted seat holder is RECUSED_MEMBER for every notice about the affected proceeding, and this
    overrides MEMBER and CHAIR;
  - PLATFORM_ADMIN, DB_ADMIN, NOTIFICATION_ADMIN, SOC and audit roles are not recipient classes of case notifications
    (§21);
  - an unresolvable recipient is an error and never falls back to a permissive class.
- Current binding: `lib/notifications/binding/server-projection.ts` refuses any class outside `RECIPIENT_CLASSES` with
  UNKNOWN_RECIPIENT. Today only `WITNESS` passes.
- Seeded notifications: `database/seed/0002_m1_cases.sql` lines 142–146 seed five draft notifications. Two use
  `CASE_TEAM` and three use `COMMITTEE_MEMBERS`. None of them can be previewed today.

### What each candidate class discloses (EMAIL experience, context `*`)

| Policy class | Fields not prohibited (of 50) | Main differences |
| --- | --- | --- |
| `SECRETARY` | 32 | Like INVESTIGATOR, plus `audit_refs` and `delivery_status` (both REDACTED). |
| `MEMBER`, `INVESTIGATOR`, `LEGAL_REVIEWER` | 30 (identical rows) | Level 1, 2 and 3 progress, `procedural_status_text`, `decision_rights`, `meeting_info`, `deadline` and `deadline_basis`, `links_internal`; `internal_ref`, `evidence_refs` and `subject_detail` REDACTED; case number as a safe reference. |
| `RESTRICTED_CASE_AUTHORITY` | 30 | Like AUTHORITY, plus `audit_refs` (REDACTED). |
| `AUTHORITY` | 29 | Like INVESTIGATOR, without `meeting_info`. |
| `SUBJECT` | 21 | Event, required action, `meeting_info`, `deadline` and `deadline_basis`, `links_portal`, case number as a safe reference; `what_next`, `exception_indicator` and `classification_marking` GENERALIZED; no Level 1, 2 or 3. |
| `EVIDENCE_HOLDER` | 18 | Event, required action, meeting, deadline; case number as a safe reference; no Level 1, 2 or 3. |
| `WITNESS` | 17 | Event, required action, meeting, deadline (basis GENERALIZED); no case number; no Level 1, 2 or 3. |
| `RECUSED_MEMBER` | 16 | Event, required action, case number as a safe reference, Level 1 stage name only. No meeting, deadline, Level 2 or 3, or links. |

Every class above is the same on the PLATFORM experience, except that REPORTER gets 17 there and 0 on e-mail
(REPORTER is not a candidate for any code). When the delivery leaves CDF (context EXTERNAL), every internal class drops
to 17.

### Options per code

| Code (0004) | Option | Projected as | Who would receive what | Tests that would pin it |
| --- | --- | --- | --- | --- |
| `WITNESS` | **W1 (current)** | `WITNESS` | The one exact match. A witness receives 17 fields: no case number and no stage. | Already pinned by SPB-01..14 and MFR-01..14 (the WITNESS positive path). |
| `CASE_TEAM` | **T0 (current) keep refusing** | none (UNKNOWN_RECIPIENT) | Nothing. The two seeded CASE_TEAM drafts cannot be previewed. | Already pinned: SPB-09 and MFR-07 refuse all four non-WITNESS codes (UNKNOWN_RECIPIENT). |
| | T1 | `INVESTIGATOR` | Every case-team recipient receives 30 fields, including Level 2 and 3 progress and internal links. One class for a whole team: a team member who is not an investigator (for example a legal reviewer) gets the same, which here is an identical row. | Mapping-table unit test (`CASE_TEAM` → `INVESTIGATOR`); projection snapshot per field; negative test: a CASE_TEAM row on a restricted case without an access-list result still refuses (NO_ACCESS_LIST_RESULT). |
| | T2 | per-seat class (needs a migration: one recipient row per seat with its own policy class) | Each person receives their own class's row. This is the only option that can honour RECUSED_MEMBER inside a team. | Migration and RLS tests for the new column; per-seat resolution tests, including a recused seat resolving to RECUSED_MEMBER; refusal when a seat cannot be resolved. |
| `COMMITTEE_MEMBERS` | **C0 (current) keep refusing** | none | Nothing. The three seeded drafts cannot be previewed. | As T0. |
| | C1 | `RECUSED_MEMBER` for all | Every member receives 16 fields: event, action, safe case reference and stage name. No meeting or deadline, so members are not told when to attend. | Mapping-table test; snapshot proving no `meeting_info`, `deadline` or `l2_journey`/`l3_steps`. |
| | C2 | `MEMBER` | Every member receives 30 fields. **Risk:** a group code cannot see which seat is recused, so a recused member would receive MEMBER content. This breaks the `recipient_resolution` rule (RECUSED_MEMBER overrides MEMBER). | Would need a recusal check per seat before projecting, with a negative test that a recused seat never receives MEMBER fields. Without per-seat rows that test cannot be written, so C2 should not be chosen before T2/C3. |
| | C3 | per-seat class (as T2: CHAIR, MEMBER, SECRETARY or RECUSED_MEMBER per seat) | Each seat receives its own row; recusal is honoured. | As T2, plus a test that an acting-chair activation resolves DEPUTY_CHAIR to CHAIR and otherwise to MEMBER (`recipient_resolution`, ADR-061 §5). |
| `SUBJECT_EMPLOYEE` | **E0 (current) keep refusing** | none | Nothing. | As T0. |
| | E1 | `SUBJECT` | The employee concerned receives 21 fields: event, action, meeting, deadline with its basis, the portal link and a safe case reference; no stage at any level. | Mapping-table test; snapshot; negative tests that `allegations`, `investigation_details`, `participant_names` and `reporter_identity` are absent. |
| `GOVERNANCE` | **G0 (current) keep refusing** | none | Nothing. This matches `recipient_resolution` (§21: oversight and audit roles are not recipient classes; oversight views show counts and states only). | As T0. |
| | G1 | `AUTHORITY` | 29 fields, including Level 2 and 3 progress. This would make an oversight function a case-content recipient, which §21 rules out. | Mapping-table test; would also need an ADR, because it contradicts §21. |
| | G2 | remove the code (needs a migration) | The code stops existing. Any draft that names it is refused by the foreign key. | Migration test; integration test that `api_create_notification_draft` refuses `GOVERNANCE`. |

### Proposed answer (least disclosure)

| Code | Recommended | Why |
| --- | --- | --- |
| `WITNESS` | W1 | It is the policy's own class. |
| `CASE_TEAM` | T0 now, T2 later | One class for a whole team cannot be checked per person. Refusing discloses nothing. |
| `COMMITTEE_MEMBERS` | C0 now, C3 later (C1 if a group notice is needed earlier) | C2 can leak MEMBER content to a recused member. C1 is the safest group option. |
| `SUBJECT_EMPLOYEE` | E1 | It is a one-to-one match in meaning, and SUBJECT is one of the narrowest classes. E0 if the owner prefers to wait. |
| `GOVERNANCE` | G0 | §21 already says oversight is not a recipient class. |

What an answer starts: E1 is a mapping table in `lib/notifications/binding` plus tests, with no migration. T2, C3 and
G2 each need a DB-team migration first, so the answer becomes a DB task.

---

## OI-039 — `case_record.stage` against the catalogue's S-codes

**Question for the owner.** May the notification model fill `l1_stage_name` from the case's stage, and if so with which
catalogue stage? Answer one letter: A, B or C. If B, also confirm the S-code for each stage in the table.

### Sources

- Case stages: `database/migrations/0002_case_registry.sql` lines 21–22 (check constraint on `case_record.stage`).
  There are six codes: INTAKE, PRELIMINARY_REVIEW, INVESTIGATION, COMMITTEE_DELIBERATION, DECISION and CLOSURE.
  `records_state` (line 24) is ACTIVE or CLOSED.
- Catalogue stages: `lib/journeys/catalogue_v13.json`, `master` (line 263) S1–S5 and `master_sub` (line 295)
  S1.01–S5.07.
- Catalogue rules (lines 9–16):
  - "Level 1 is resolved from CaseRecord.status.code only".
  - "A witness sees no Level 1; public and scope recipients see Level-1 stage names only".
  - "Unknown or unsourced values fail closed".
- Resolver: `lib/journeys/resolve.ts` `resolveLevel1` (lines 768–800). It needs a **sub-code** such as `S3.03`. An
  unknown code gives no stage (`UNKNOWN_STATUS_CODE`) and every stage is marked unverified.
- Current model: `lib/notifications/binding/model-from-records.ts` leaves `l1_stage_name` empty, by ARCH's ruling of
  31 Oct 20:54.

### Who would see a filled stage name (policy, context `*`)

| Field | Classes |
| --- | --- |
| `l1_stage_name` | Allowed for SECRETARY, CHAIR, MEMBER, INVESTIGATOR, LEGAL_REVIEWER, AUTHORITY, RESTRICTED_CASE_AUTHORITY, REFERRING_BODY and RECUSED_MEMBER, and for REPORTER on the platform only. Prohibited for SUBJECT, WITNESS and EVIDENCE_HOLDER. |
| `l1_substate` | Internal classes only (the first seven above). |

### Candidate stages per case stage

| `case_record.stage` | Candidate S-stage (name) | Candidate sub-code, option C only | Note |
| --- | --- | --- | --- |
| INTAKE | S1 Receipt and registration | S1.03 Case registered | Clear. |
| PRELIMINARY_REVIEW | S2 Completeness, jurisdiction and assessment, **or** S3 Competent handling and investigation | S2.04 Preliminary assessment, **or** S3.03 Preliminary investigation | **Ambiguous.** The name fits both. The owner must choose. |
| INVESTIGATION | S3 Competent handling and investigation | S3.02 Information and evidence gathering | The sub-code is a guess: nothing records which investigation step is current. |
| COMMITTEE_DELIBERATION | S4 Recommendation and competent decision, **or** S3 (S3.05 extended investigation, hearings) | S4.01 Outputs and recommendations prepared | **Ambiguous** between deliberating on a recommendation (S4) and hearings (S3). |
| DECISION | S4 Recommendation and competent decision | S4.04 Awaiting the authorised body's decision, **or** S4.05 Competent decision issued | The stage says nothing about whether the decision has been issued. |
| CLOSURE | S5 Notification, execution and closure | S5.05 Case path closed (when `records_state` is CLOSED) | Clear for a closed case. A CLOSURE stage on an ACTIVE row has no sub-code. |

### Options

| Option | What it does | Who would see what | Tests that would pin it |
| --- | --- | --- | --- |
| **A (current) keep empty** | `l1_stage_name` stays empty for every case. | No recipient sees a stage in a notification. Internal users still see the stage on the case page, which is FE's existing screen and separate from notifications. | Already pinned: MFR-09 lists the exact fields the model sets, and `l1_stage_name` is not among them. |
| B stage only (master code) | A fixed table maps each case stage to one S-stage (S1–S5). `l1_stage_name` is filled; `l1_substate` stays empty. Needs a small code change, because the resolver reads sub-codes. | The nine classes listed above see the S-stage name. SUBJECT, WITNESS and EVIDENCE_HOLDER still see nothing. | Table test (6 rows); a test that an unknown stage leaves the field empty (fail closed); a test that `l1_substate` is never filled; projection tests for SUBJECT, WITNESS and EVIDENCE_HOLDER (absent) and for RECUSED_MEMBER (name only). |
| C stage and sub-code | Each case stage maps to one sub-code, and the resolver runs as it does for the reference scenarios. | As B, plus internal classes see a current sub-step. | As B, plus sub-code tests. **Not recommended:** the sub-codes in the table above would state a current step that no recorded event supports. The catalogue rule "unknown or unsourced values fail closed" argues against it. |

### Proposed answer (least disclosure)

**A** discloses the least, and nothing is lost on screen: the case page already shows the stage to internal users. If
the owner wants the stage in notifications, choose **B**, and confirm S2 or S3 for PRELIMINARY_REVIEW and S4 or S3 for
COMMITTEE_DELIBERATION. C should wait until the case record carries a real sub-state.
