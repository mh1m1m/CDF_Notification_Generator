# Per-case journey instances (REQ-JRN-007): design note

**V13-PROC-018 · PROC · reviewer SEC · base `develop` `988b1d6` · SYNTHETIC-DATA REFERENCE IMPLEMENTATION, not CDF production.**

**Recommendation: path (a).** In M1, the computed journey *is* the case's journey instance. It is computed per case from that case's own records. No `case_journey_instances` table is needed in M1.

This PR adds the missing automated checks and fixes one gap they found:

- The resolver accepted an event recorded under another case when that event named this case's object in its payload.
- The fix refuses it as `CASE_MISMATCH`.

## 1. Source

This is the directive's text, master prompt 1, batch 1 of 28 Oct (quoted).

**Part XII §11, Multi-Case Isolation:**

> "Each case must have its own journey instance.
> Case A must never inherit Case B's procedural state."

**Part XII §11, Journey Versioning** (REQ-JRN-008 and REQ-JRN-009, both M3):

> "A case must retain the applicable journey definition version, with controlled migration where approved.
> Do not silently reinterpret historical progress using newly published journey definitions."

**Part IV §3.8 Journey Intelligence** names the table among other entities:

> "journey_definitions, journey_versions, journey_steps, journey_transitions, journey_assignments, case_journey_instances, procedure_journey_instances, journey_progress_events"

and says of all §3 entities:

> "These are proposed logical entities. The agent must consolidate them where appropriate rather than mechanically creating every table."

The register carries that data model as REQ-DATA-012 (M3, DB).

**Part XXV §24, Migration Strategy, step 6:** "Implement independent journey instances."

What this means for M1:

- The source asks for an *independent instance per case*. It does not ask for a stored row.
- It names `case_journey_instances` as a proposed entity that may be consolidated.
- What a stored row would add is a pinned definition version (§11 Journey Versioning). That is REQ-JRN-008/009 in M3, not REQ-JRN-007 in M1.

## 2. What the instance is today

A case's journey is a pure function of four inputs:

| Input | Source in V13 | Scoped by |
| --- | --- | --- |
| Case record (Level 1) | `case_record` row, read under RLS | `case_id`; an unknown and an unauthorised case look identical |
| Procedural object (Levels 2–3) | not yet recorded (M3, REQ-JRN-010) | its `case_id` |
| Recorded events (Layer A) | `procedural_event` rows: append-only, `case_id NOT NULL`, causation FK `(causation_id, case_id)` | `case_id` |
| Catalogue (Layer B) | `lib/journeys/catalogue_v13.json` (PROPOSED, one version) | none; read-only and shared by design |

`resolveLevel1`, `resolveLevel2_3` and `buildProgressView` (`lib/journeys`) keep no state between calls. The only module-level cache is a `WeakMap` index of the catalogue itself. Expected steps (Layer B) are never stored (migration 0003 header).

So two cases are two instances. Nothing a case's journey depends on can come from another case, as long as the resolver refuses another case's events. That is what the checks below pin.

## 3. The automated checks

### Already on `develop`

| Check | What it proves |
| --- | --- |
| `tests/unit/journeys/journeys.spec.ts` JR-09 | An event of another object is ignored (`OBJECT_MISMATCH`); an event of another case on this object is ignored (`CASE_MISMATCH`); neither completes a step |
| `tests/truth/planted-badge.spec.ts` (c) | A badge citing a real event of another case is a Truth Inspector violation (T4) |
| `tests/unit/notifications/model-from-records.spec.ts` MFR-02, MFR-03, MFR-04 | The notification model refuses another case's notification row or events (`CASE_MISMATCH`), even mixed with the case's own |
| `tests/integration/case-access.spec.ts` "cross-case links are refused by the composite foreign keys" | The database refuses a procedural event whose cause belongs to another case (23503) |
| `tests/security/db/case-matrix.spec.ts` | `procedural_event` reads are limited to accessible cases, per persona |
| `tests/e2e/scenario-b-two-cases-two-tabs.spec.ts` | An update in case 0002 leaves case 0001 as it was |

### Added here: `tests/unit/journeys/case-isolation.spec.ts`

| Test | Check |
| --- | --- |
| JI-01 | Two cases with different events give different Layer A and Layer B. Each case's evidence ids are its own. |
| JI-02 | Given both cases' events mixed, each case resolves exactly as it does from its own events alone. The other case's events are all ignored. |
| JI-03 | An event of another case that names this case's object is refused with `CASE_MISMATCH`, whether it names the object as its object or in its payload. The same payload recorded under this case counts. **Fails on `develop` without the fix.** |
| JI-04 | Interleaved calls for A, B, A, and B with the event order reversed give identical results. The events and the catalogue are unchanged. |
| JI-05 | Level 1 comes from each case's own record only. |
| JI-06 | Each case's progress view cites only its own event ids and never the other case's id. |

### Catalogue version change

This does not apply in M1. There is one catalogue version (`L2-V13-draft-2026-10-27`, PROPOSED), and no case pins a version yet.

Pinning and the "never reinterpret history" check belong to REQ-JRN-008 and REQ-JRN-009 (M3). That is the point where a stored instance row may be needed: case or procedure, journey id, pinned catalogue version, and an approved migration. It would be built then with DB (REQ-DATA-012) and an ARCH ADR. Nothing is built for it now.

## 4. The fix

`lib/journeys/resolve.ts`, in the event-scope filter: the case check now applies to an event that reaches this procedural object through its payload (`subject_object_id`, `object_id`, `target`, `related`), not only through `object`.

- The reference (`src/journeys/resolve.js`) checked only the object path. This is a fail-closed narrowing.
- All 22 shipped scenarios and JR-01..JR-24 are unchanged: 87 of 87 journey tests pass.

Limits of the fix:

- An event with no `case_id` is still judged by object only, as in the reference. Every `procedural_event` row has `case_id NOT NULL`, so an event read from V13's database always has one.
- A procedural object with no `case_id`, such as the NOCASE scenario, has no case to check against.

## 5. Answers (CLAUDE.md §7)

- **Requirement:** REQ-JRN-007 (Part XII §11 Multi-Case Isolation), M1, QG-02 and Gate B.
- **Where access is enforced:** RLS and `case_id` scoping on `case_record` and `procedural_event`, the composite causation FK, and `CASE_MISMATCH` in the resolver and in `buildModelFromRecords`.
- **Audit event:** none. Resolution is a read computation; it writes nothing.
- **How it is tested:** section 3.
- **Production component:** `PRODUCTION_SUBSTITUTION_REQUIRED`. The case and its events come from the CDF case system of record through `CaseSourceAdapter`. The catalogue comes from the approved journey definitions, with per-case version pinning (REQ-JRN-008).

## 6. Register

This PR does not edit the register. The next register pass (V13-PROC-017) assesses REQ-JRN-007 against ruling (b) on #71: a standing rule is COMPLETE only with an automated check. The checks above are those checks.

The row's architecture component reads `case_journey_instances`. That column is outside the pass's columns 10–13, so ARCH decides whether to reword it.
