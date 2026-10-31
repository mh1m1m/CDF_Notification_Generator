# PROC status — CDF V13 Enterprise (synthetic data only)

Updated: 2026-10-31 ~21:50 UTC · Branch: `claude/project-thread-94r9g5` · Base: `develop` 21f94a0

## Completed
- Baseline of the V13 reference package reproduced on a scratch copy: 726 tests, 726 pass (Node v22.22.0).
- `docs/teams/proc/PORT_PLAN.md` — module mapping, porting rules, test carry-over, fixture fixes BL-45/BL-46,
  requests to ARCH — COMPLETE (PR #3 merged into `develop` 2990c28).
- Full port of all five modules on a scratch copy: tsc 0 errors, 734 pass, 0 skipped (lands PR by PR, below).

## In progress / next
| Task | State | Note |
| ---- | ----- | ---- |
| V13-PROC-001 domain status model | COMPLETE | PR #18 merged into `develop` 64aa5c1 (31 Oct) |
| V13-PROC-002 journeys + BL-45 fixture fixes | COMPLETE | PR #24 merged into `develop` 434f905 (31 Oct); BL-45 fixed (five scenarios); BL-46 held (OI-020) |
| V13-PROC-006 case task status catalogue (OI-029) | COMPLETE | PR #35 merged into `develop` 6db4cd0 (31 Oct); `lib/domain/task-status.ts`: migration 0003's five `task.status` codes, DONE added to the T5 list; for FE's task badges |
| V13-PROC-003 disclosure | COMPLETE | PR #40 merged into `develop` 0f46d79 (31 Oct); `lib/disclosure` + `Projected<T>` brand; DIS-02/03/04/06/18, PRJ-01..03, BND-05/06; the other 13 DIS tests land with PROC-005 (ARCH 31 Oct) |
| V13-PROC-004 authority | COMPLETE | PR #39 merged into `develop` e8bba66 (31 Oct); `lib/authority` (server-only, fail closed) + `tests/unit/authority` (3 files, 88 tests incl. BND-01..04 data boundary and ST-28b) |
| V13-PROC-005 notifications | COMPLETE | PR #45 merged into `develop` ec8653a (31 Oct; SEC ACCEPT, CI 41239195320); `lib/notifications` (lifecycle, consistency PC-00..29, next action, render); renderers take only `Projected<T>`; the 13 deferred DIS tests; NDB-01/02 (diagnostics never reach a recipient); reference skip guards made strict; OI-035 server binding `lib/notifications/binding/server-projection.ts` (context only from the case row's `is_restricted` + the server access-list result, recipient class only from the DB recipient row, fail closed; SPB-01..12) |
| V13-PROC-007 renderer wording into `lib/i18n` (OI-036) | COMPLETE | PR #48 merged into `develop` 45b29cf (31 Oct; SEC ACCEPT and ARCH ACCEPT 8f3c3fa; combined tree unit 1654, test:db 389, e2e 101); OI-036 closed; new PROC namespace `notificationRender` (`lib/i18n/notificationRender/{ar,en}.ts`, 166 keys), registered in `lib/i18n/index.ts` (ARCH-009 folded in); `lib/notifications/render/i18n.ts` only shapes dictionary entries; the other render files' wording moved too (sender, preview notices, deadline basis, issuer, months, AM/PM, separators); RI-01..03; 516 rendered files equal the reference |
| V13-PROC-008 notification model from server records (FE-006 preview) | COMPLETE | PR #55 merged into `develop` b24db04 (31 Oct; CI 41241834121, 6/6); `lib/notifications/binding/model-from-records.ts` `buildModelFromRecords(records)`: case row + notification row (with template) + the case's events, server records only; fills template_code, notice_reference, case_number (policy decides), event_title (template names), issuer/help/confidentiality (per class), classification_marking (RESTRICTED if restricted, else INTERNAL, never PUBLIC), delivery_status (DRAFT, PENDING_APPROVAL, APPROVED, DISPATCHED → sent-not-confirmed, CANCELLED; anything else refused); empty by ruling: l1_stage_name (OI-039), event_summary, next_action, deadline, levels 2–3, evidence_refs; MFR-01..14 |
| V13-PROC-009 owner decision briefs OI-037 / OI-039 | COMPLETE | PR #57 merged into `develop` 21f94a0 (31 Oct; CI 41242891735); `docs/teams/proc/DECISION_BRIEFS.md`, docs only, everything PROPOSED, no mapping applied: OI-037 options per migration 0004 recipient code with the policy's per-class disclosure (computed with `decide()`), recommended least disclosure (WITNESS as is, CASE_TEAM/COMMITTEE_MEMBERS/GOVERNANCE keep refusing, SUBJECT_EMPLOYEE → SUBJECT); OI-039 options per `case_record.stage` (A keep empty, B stage only, C stage + sub-code), recommended A; PRELIMINARY_REVIEW and COMMITTEE_DELIBERATION flagged ambiguous |
| V13-PROC-010 QG-01 source integrity ledger | IN_REVIEW | `scripts/integrity/source-ledger.mjs` (capture / verify: path, size, sha256 per file, sorted; reads only under `/mnt/project-files/notifications/`, refuses any other root, a root that is, is inside or contains the excluded upload, a ledger path under the base and a ledger folder that does not exist (nothing is created; SEC-F-064-1 fixed); never follows a link; never overwrites a ledger); SL-01..19 on temporary fixtures; ledgers kept outside Git in `/mnt/project-files/v13-enterprise/integrity/` (no file name in Git): first capture 16 roots, 2,215 files, 693,421,471 bytes; ARCH scope ruling 31 Oct 21:45 added eml, generator-v8, previews (v13_enterprise left out): `_r2` ledger 19 roots, 2,544 files, 707,615,739 bytes, sha256 8fb85a8f…514e, verify PASS |

## Changed files
- PR #3: `docs/teams/proc/PORT_PLAN.md`, `docs/teams/proc/STATUS.md`
- PROC-001: `lib/domain/{badge,concepts,epistemic,index,invariants,nil,status,types}.ts`,
  `tests/unit/domain/{badge,evidence-scan,invariants,status}.spec.ts`, `tests/unit/domain/__evidence__/` (4 files),
  `docs/teams/proc/EVIDENCE_MANIFEST.md`, `docs/teams/proc/PORT_PLAN.md` (§5 note), this file
- PROC-002: `lib/journeys/**`, `tests/unit/journeys/**` (+ 4 evidence copies), `lib/domain/badge.ts` (T5 code check),
  `tests/unit/domain/badge.spec.ts`, EVIDENCE_MANIFEST, this file
- PROC-006: `lib/domain/{task-status,badge,index}.ts`, `tests/unit/domain/{task-status,badge}.spec.ts`,
  `tests/integration/task-status-catalogue.spec.ts` (outside PROC paths, at ARCH's request), this file
- PROC-004: `lib/authority/{check,index}.ts`, `lib/authority/authority_v13.json`,
  `tests/unit/authority/{authority,data-boundary,domain-evidence-names}.spec.ts`, this file
- PROC-003: `lib/disclosure/{project,index}.ts`, `lib/disclosure/policy_v13.json`,
  `tests/unit/disclosure/{disclosure,projected-brand}.spec.ts`, `tests/unit/authority/data-boundary.spec.ts` (BND-05/06),
  this file
- PROC-010: `scripts/integrity/source-ledger.mjs` (new), `tests/unit/integrity/source-ledger.spec.ts` (new), this file
- PROC-009: `docs/teams/proc/DECISION_BRIEFS.md` (new), this file. No code, migration or test change.
- PROC-008: `lib/notifications/binding/{model-from-records,server-projection}.ts`, `lib/notifications/render/model.ts`
  (`recipientNotices` extracted, same rule), `tests/unit/notifications/model-from-records.spec.ts` (new), this file
- PROC-007: `lib/i18n/notificationRender/{ar,en}.ts` (new), `lib/i18n/index.ts` (ARCH path, agreed),
  `lib/notifications/render/{i18n,email,platform,model,components,escape}.ts`, `tests/unit/i18n.spec.ts` (namespace list),
  `tests/unit/notifications/render-i18n.spec.ts` (new), this file
- PROC-005: `lib/notifications/**` (21 files), `tests/unit/notifications/**` (10 specs, 4 support, 7 fakes, 7 evidence
  copies), `tests/unit/disclosure/disclosure-render.spec.ts`, EVIDENCE_MANIFEST (7 rows), this file;
  OI-035: `lib/notifications/binding/server-projection.ts`, `tests/unit/notifications/server-projection.spec.ts`

## Test evidence
| Command | Result | Counts | Commit |
| ------- | ------ | ------ | ------ |
| `node --test "tests/**/*.test.js"` in a scratch copy of `/mnt/project-files/notifications/v13` with `journeys/`, `generator/` and the built demo | PASS | 726 tests · 726 pass · 0 fail · 0 skipped | reference package (not this repository) |
| `pnpm lint` · `pnpm typecheck` · `pnpm format:check` · `pnpm test` on this branch after merging `develop` f0a7220 (no PROC code yet) | PASS | lint 0 errors/warnings; typecheck 0 errors; format clean; unit 17 files · 251 tests · 251 pass | 8e8236c |
| PROC-001: `pnpm lint` · `pnpm typecheck` · `pnpm test` (develop 2990c28 + PROC-001) | PASS | lint exit 0; typecheck exit 0; unit 22 files · 541 tests · 541 pass, of which `tests/unit/domain` 4 files · 203 pass · 0 skipped | PROC-001 head |
| PROC-001: `pnpm format:check` | FAIL then (expected) | only the two byte-exact evidence JSON copies; fixed by #20 (evidence ignores) | 37a5cfc |
| PROC-001 after merging `develop` 2ec6ce0: `pnpm format:check` · `pnpm lint` · `pnpm typecheck` · `pnpm test` | PASS | format, lint, typecheck exit 0; unit 30 files · 694 pass, of which `tests/unit/domain` 4 files · 203 pass · 0 skipped; EVIDENCE_MANIFEST sha256 of all 4 domain copies match byte for byte | merge of 2ec6ce0 |
| PROC-001: copy-time scan `tests/unit/domain/evidence-scan.spec.ts` (EVS-01/02) | PASS | 4 evidence files · 0 hits · 0 allowed | PROC-001 head |
| PROC-002: `pnpm format:check` · `pnpm lint` · `pnpm typecheck` · `pnpm test` (develop 64aa5c1 + PROC-002) | PASS | all exit 0; unit 33 files · 775 pass, (776 with BADGE-12, below), of which `tests/unit/journeys` 3 files · 81 pass · 0 skipped; evidence scan (EVS-01) now covers the journeys evidence and `lib/journeys/**/*.json`: 0 hits | PROC-002 head |
| PROC-002 equivalence: reference `src/journeys/{resolve,progress}.js` vs `lib/journeys` on the same inputs (22 reference scenario files, refs `CDF-IC-2026-DEMO-NNNN` normalised to `CDF-DEMO-2026-NNNN`), 32 runs incl. variants × (resolve + 13 recipient classes) | PASS | 448 outputs compared, 0 differ; catalogue identical after the ref rename | PROC-002 working tree on 64aa5c1 (after prettier) |
| PROC-002 fixture effect (BL-45): `lib/journeys` on reference vs ported fixtures | EXPECTED DIFFERENCES ONLY | 5 scenario files changed (EC-01, SUM-01, WIT-01, CF-35, CF-37); 448 outputs compared, 2 differ, both CF-37 (base and CF-37-V1: the added `AUTHORITY_DECISION_RECORDED` before the notice); ST-34 now lists only the 7 BL-46 scenarios | same |
| PROC-006 (develop 434f905 + PROC-006, fresh `db:local start` + `db:reset`, 9 migrations): `pnpm format:check` · `lint` · `typecheck` · `db:lint` · `test` · `test:db` · `test:e2e` | PASS | all exit 0; unit 37 files · 813 pass, of which `tests/unit/domain` 5 files · 212 pass (CTS-01..08 new); test:db 18 files · 337 pass, 0 skipped (CTS-DB-01/02 new); e2e 92 pass | PROC-006 head |
| PROC-006 mutation check: `CANCELLED` removed from `CASE_TASK_STATUSES` | FAIL (expected) | CTS-DB-01 and CTS-DB-02 both fail; reverted | local only |
| PROC-004 (develop 6db4cd0 + PROC-004, fresh `db:reset`, 9 migrations): `pnpm format:check` · `lint` · `typecheck` · `db:lint` · `test` · `test:db` · `test:e2e` | PASS | all exit 0; unit 41 files · 955 pass, of which `tests/unit/authority` 3 files · 88 pass · 0 skipped; test:db 19 files · 352 pass; e2e 92 pass | PROC-004 head |
| PROC-004 equivalence: reference `src/authority/check.js` vs `lib/authority/check.ts`, same model (JSON deep-equal to the reference file), 46 action ids (45 + one unknown) × 30 capacity values (the model's 26, plus PLATFORM_ADMIN, DB_ADMIN, none and a repeated SYSTEM) × 3 purposes × 5 actor flag sets × 4 object shapes × 2 manual flags | PASS | 165,600 results compared, 0 differ; every result code reached (ALLOWED 2,168; SOURCE_REQUIRED_DRAFT 276; SOURCE_REQUIRED 600; CONDITIONAL_SOURCE_REQUIRED 780; UNKNOWN_ACTION 3,600; PRECONDITION_MISSING 1,096; EXPIRED 328; OBJECT_CONDITION 128; APPROVAL_MISSING 32; and the DENIED actor checks) | scratch spec, not committed |
| PROC-003 (develop e8bba66 + PROC-003): `pnpm format:check` · `lint` · `typecheck` · `db:lint` · `test` · `test:db` · `test:e2e` (fresh `db:reset`) | PASS | all exit 0; test:db 19 files · 352 pass; e2e 92 pass; unit 43 files · 965 pass, of which `tests/unit/disclosure` 2 files · 8 pass (DIS-02/03/04/06/18, PRJ-01..03) and BND-05/06 in `tests/unit/authority`; mutation: with `Projected<T> = T` typecheck fails on PRJ-02's unused `@ts-expect-error` (TS2578) | PROC-003 head |
| PROC-003 equivalence: reference `src/disclosure/project.js` vs `lib/disclosure/project.ts`, same policy (JSON equal except the documented `case_number` example rename) | PASS | `decide()`: 87,360 queries (15 recipient values × 52 fields × 14 channels × 8 contexts), 0 differ; `project()`: 600 runs (15 recipient values × 5 channels × 8 contexts) on a model carrying every field, 0 differ (fields, log and summary; `policy_path` excluded), 80 refused identically | scratch spec, not committed |
| PROC-005 (develop f937052 + PROC-005, fresh `db:reset`): `pnpm format:check` · `lint` · `typecheck` · `db:lint` · `test` · `test:db` · `test:e2e` · `build` | PASS | all exit 0; unit 55 files · 1,381 pass · 0 skipped, of which `tests/unit/notifications` + `tests/unit/disclosure` 13 files · 379 pass; test:db 19 files · 352 pass; e2e 94 pass | PROC-005 head |
| PROC-005 + OI-035 binding, after merging `develop` f39af8b (fresh `db:reset`, 10 migrations): `pnpm format:check` · `lint` · `typecheck` · `db:lint` · `test` · `test:db` · `test:e2e` · `build` | PASS | all exit 0; unit 56 files · 1,406 pass · 0 skipped (SPB 25 new); test:db 20 files · 357 pass; e2e 94 pass; mutation: binding forced to `on_access_list = true` → 3 SPB fail; tags passed as a Set (read by `project()` as no tags) → 5 SPB fail | PROC-005 head |
| PROC-005 SEC `REVIEW: CHANGES 8384efe` (LOW, fail-open default): the lifecycle's projection port now defaults to `DISCLOSURE_PROJECTION_PORT` (lib/disclosure `isProjected`); `projection: null` falls back to it; the fixture world wires `FIXTURE_PROJECTION_PORT`, which accepts only `projectedModel()` stand-ins. `pnpm format:check` · `lint` · `typecheck` · `test` · `build` | PASS | all exit 0; unit 56 files · 1,411 pass · 0 skipped (LC-03b, 5 new); mutation: default port set to accept-all → 2 LC-03b fail | PROC-005 head |
| PROC-005 SEC `REVIEW: CHANGES 59d420c`: (2) `projectForRecipient` refuses a caller-supplied `policy` (POLICY_NOT_ACCEPTED) and projects with the committed policy; (3) `security_render` addresses now reserved names only (`victim@external.example`, `someone@example.com`, `a@example.test.evil.example`); (1) was fixed in e01c2f5. `pnpm format:check` · `lint` · `typecheck` · `test` · `build` | PASS | all exit 0; unit 56 files · 1,413 pass · 0 skipped (SPB-13/14 new, SPB now 27); mutation: policy check removed → SPB-13 fails | PROC-005 head |
| PROC-008 (develop 45b29cf + PROC-008, fresh `db:reset`): `pnpm format:check` · `lint` · `typecheck` · `db:lint` · `test` · `test:db` · `test:e2e` · `build` | PASS | all exit 0; unit 64 files · 1,681 pass · 0 skipped (MFR 27 new); test:db 24 files · 389 pass; e2e 101 pass; the 516-file reference equivalence still 0 differ after extracting `recipientNotices` | PROC-008 head |
| PROC-007 (develop ec8653a + PROC-007, fresh `db:reset`, 10 migrations): `pnpm format:check` · `lint` · `typecheck` · `db:lint` · `test` · `test:db` · `test:e2e` · `build` | PASS | all exit 0; unit 61 files · 1,568 pass · 0 skipped (RI-01..03 new; i18n spec checks the new namespace's key parity and key format); test:db 22 files · 372 pass; e2e 101 pass; mutation: an Arabic literal added to `render/platform.ts` → RI-01 fails | PROC-007 head |
| PROC-007 equivalence: reference `renderAll()` vs the port's (scratch spec, not committed), same inline scenarios and W-E tokens; the structures of `render/i18n.ts` dumped before and after are byte-identical JSON | PASS | 516 rendered files: 0 differ, none missing; refusals equal (5); control: two English dictionary texts changed → 126 files differ | scratch spec |
| PROC-005 equivalence: reference `src/demo/build_demo.js` `renderAll()` (reference `src/` with its W-E `design/tokens.json`, JSON-equal to `lib/notifications/render/email_tokens.json`) vs the port's, same inline scenarios | PASS | 516 rendered files (platform HTML, e-mail HTML, text, EML, card) compared after the `CDF-IC-2026-DEMO-` → `CDF-DEMO-2026-` rename: 0 differ, none missing on either side; refusals equal (5) | scratch spec, not committed |
| PROC-005: V12 quotes not re-verified here | UNVERIFIED here (by ruling) | 22 `evidenceLine` quotes from V12 sample EMLs (`eml/en/…`) and `generator/samples/WB-08.txt`, and the 77/77 X-Unsent check: ARCH ruled the EMLs are never copied; they pass in the reference package run (726/726). Any other missing evidence file now fails | local |
| same, `src/` + `tests/` only | FAIL (expected: evidence missing) | 713 run · 705 pass · 5 fail · 3 skipped | reference package |

### Baseline without sibling evidence (`src/` + `tests/` only): causes

| Test | Result | Cause |
| ---- | ------ | ----- |
| JR-01 | FAIL | reads `work/` journey-assignment CSV (112 V12 assignments), not present |
| JR-05 | FAIL | reads `work/new_event_types.md` (lead ruling L-05 list), not present |
| JR-17 | FAIL | reads the `work/` V12 → V13 traceability CSV, not present |
| JR-18 | FAIL | reads the `work/` assignment and journey-change CSVs, not present |
| `tests/regression.test.js` (file) | FAIL | the file aborts at load: `out/demo/MANIFEST.json` (generated demo) and the V12 sibling folders are missing, so its 14 tests do not run and the file counts as one failed test (726 − 14 + 1 = 713) |
| ST-18 | SKIPPED | `work/V13-02_concepts.csv` not present |
| ST-22 | SKIPPED | `../../journeys/level2_journeys.json` (V12 evidence) not reachable |
| ST-33 | SKIPPED | the owner's directive text under `work/owner_messages_2026-10-27/` not reachable |

With `work/`, the charter and `docs/` added the result is 726 / 720 pass / 6 fail (REG-09 … REG-14: demo output and V12
evidence); with the V12 siblings and the demo built, 726 / 726.

## Unresolved defects
- Gate G2 PARTIAL: 7 of 22 scenarios declare a status their own events do not give (BL-46: CF-15 … CF-19, CF-23b,
  CF-36), listed by ST-34. BL-45 (the other five) fixed in PROC-002. BL-46 waits for the owner (OI-020).

## Dependencies and requests
- V13-ARCH-001 merged into `develop` (f0a7220, 28 Oct); merged into this branch.
- Plan §7 answered by ARCH (28 Oct ~01:53 UTC): `server-only` 0.0.1 and `resolveJsonModule` in the foundation; tests
  named `*.spec.ts`; port shapes proposed under `lib/contracts/ports/` (ARCH + SEC accept), reusing `CaseSourceAdapter`,
  `ClockPort`, `IdGeneratorPort`, `AuditSinkPort`; i18n per ADR-013 (`lib/i18n/{status,journeys}/{ar,en}.ts`); e-mail
  token snapshot accepted as interim (UX to confirm); unit fixtures may use other `CDF-DEMO-2026-NNNN` numbers, never
  seeded; PRs from `claude/project-thread-94r9g5` one at a time.
- Answered: the epistemic mapping (seven domain classes → ADR-013's four `data-epistemic` values) is ruled in
  `docs/MASTER_EXECUTION_PLAN.md` §8 "Epistemic mapping"; built as `lib/domain/badge.ts` with 9 tests in the port.
- SEC review of PR #3 (`REVIEW: CHANGES 1c9d826`): disclosure boundary (`Projected<T>`, sandboxed preview), policy and
  authority JSON server-only, copy-time evidence scan: added to PORT_PLAN §3.3 and §5.
- BL-46 held for the owner (OI-020); proposal in `docs/teams/proc/PROPOSALS.md`.
- ARCH 28 Oct ~03:47–04:05: rule T5 list (`COMPLETED_CLASS_STATUSES`, 11 entries) owned by PROC in `lib/domain`; QA
  imports it once PROC-001 merges. ADR-016: domain {ar,en} labels stay in `lib/domain`; `lib/i18n` status/journeys hold
  the UI keys, pinned equal by a unit test (lands with the first UI keys). Evidence check accepted; `v9_data.json` copy
  renamed `CDF-IC-2026-0001` → `CDF-DEMO-2026-0001`, scan allowance dropped.
- Checks moved out of the domain specs because they read other modules' data: ST-29b, ST-32b, ST-34 land with PROC-002;
  ST-28b with PROC-004; ST-07b with PROC-005. Each is strict (a missing file fails).
- Evidence ignores landed in #20 (develop 2ec6ce0, 31 Oct). PR #18 merged (64aa5c1) on SEC ACCEPT c3b71f8.
- SEC LOW note on #18 (via ARCH, 31 Oct): T5 matched statuses exactly. Fixed on #24: a badge's `shown_status` must be an
  upper-snake status code or a catalogue step code (`SHOWN_STATUS_NOT_A_CODE` otherwise), and `isCompletedClassStatus`
  fails closed on any other string; BADGE-12 covers "completed", " COMPLETED", "Completed" and more.
- ARCH 31 Oct (OI-035, SEC's two LOWs on #40): built into PROC-005 as `projectForRecipient(model, records, opts)`.
  SEC (on 8384efe): condition (2) is met; condition (1) stays OPEN until the DB-backed binding reads the records.
  SEC (59d420c): the server-records binding is correct and clears OI-035 (1) as code; nothing calls it yet, and the
  server-side access-list check stays open under OI-035 (1). The policy is now the server's too (POLICY_NOT_ACCEPTED).
- ARCH 31 Oct 20:54 (PROC-008 rulings): l1_stage_name stays empty until the owner decides a `case_record.stage` → catalogue
  mapping (OI-039); classification_marking is RESTRICTED or INTERNAL, never PUBLIC (only tightens); template placeholders
  are never filled into free text; a lifecycle code without wording is refused. SUPERSEDED is refused too (no command
  sets it yet; neither wording holds without a sent flag). FE's positive preview path is a WITNESS draft (OI-037); a
  restricted case has no access-list read in M1, so its preview fails closed (NO_ACCESS_LIST_RESULT), never defaulted.
- OI-037 (owner decision, REQ-GOV-014): migration 0004's recipient codes are not the policy's recipient classes. Any
  mapping decides who receives what, so PROC maps nothing; the binding refuses every row class but `WITNESS`
  (UNKNOWN_RECIPIENT). Side by side:

  | Migration 0004 code (`notification_recipient_class`) | Policy class (`lib/disclosure` `RECIPIENT_CLASSES`) |
  | --- | --- |
  | `WITNESS` | `WITNESS` (the one exact match) |
  | `CASE_TEAM` | no exact match |
  | `COMMITTEE_MEMBERS` | no exact match |
  | `SUBJECT_EMPLOYEE` | no exact match |
  | `GOVERNANCE` | no exact match |
  | — | `SECRETARY`, `CHAIR`, `MEMBER`, `INVESTIGATOR`, `LEGAL_REVIEWER`, `AUTHORITY`, `REFERRING_BODY`, `REPORTER`, |
  | — | `SUBJECT`, `EVIDENCE_HOLDER`, `RECUSED_MEMBER`, `RESTRICTED_CASE_AUTHORITY` (no database code) |
- ARCH 31 Oct 20:39: V13-PROC-007 (OI-036) moves the renderer wording into a new PROC namespace `notificationRender`
  (not FE's `notifications`); ARCH-009 folded in, `lib/i18n/index.ts` rides the PR with ARCH's ACCEPT. Not moved (not
  renderer wording; raised with ARCH): the consistency rule texts (`consistency/rules.ts`, `engine.ts`), the next-action
  rule texts (`next-action/rules.ts`) and the export banners (`lifecycle/export.ts`).
