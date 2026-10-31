# PROC evidence manifest

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.**

Every file under `tests/unit/<proc folder>/__evidence__/` was copied read-only from the frozen V12/V13 evidence under
`/mnt/project-files/notifications/`. Nothing came from the uploads folder, and no EML evidence was copied (ARCH ruling).
The sha256 values are of the exact bytes in the repository, taken after the copy-time scan (SEC, PR #3).
`tests/unit/domain/evidence-scan.spec.ts` re-runs that scan in every unit run.

Content: only synthetic data (Employee Alpha style names, `@example.test`, `CDF-DEMO-2026-NNNN`) or CDF reference text
(the V13 charter, the V12 journeys catalogue, the V12 generator code). No real person's data.

| Repository file (`tests/unit/…/__evidence__/`) | Source (`/mnt/project-files/notifications/`) | sha256 (repository bytes) | Bytes | Change from source |
| --- | --- | --- | --- | --- |
| `domain/CHARTER.md` | `v13/CHARTER.md` | `4d41336e50523193aaebdb2443a11da67165fc0be73fa03230c2781ded6c9f71` | 28845 | 2 lines: synthetic ref `CDF-IC-2026-DEMO-…` → `CDF-DEMO-2026-…` |
| `domain/V13-02_concepts.csv` | `v13/work/V13-02_concepts.csv` | `ebbd11c3b15e78dd039138fe08e3efa834e5a184862b11a47361f41968385e9c` | 61186 | none |
| `domain/level2_journeys.json` | `journeys/level2_journeys.json` | `9d2db3d4766ab929f5cc3f8ce1eefef6224a9772acf6945175fa270170a1a8d0` | 71993 | none |
| `domain/v9_data.json` | `generator/source/tests/v9_data.json` | `68ea3d21664c559a6bba4fb67614c471b5e4edcb74c80f954741f93e75f6aec7` | 573815 | 1 line: superseded synthetic ref `CDF-IC-2026-0001` → `CDF-DEMO-2026-0001` in V12 rule text (ARCH, 28 Oct 04:05); the scan has no allowance |
| `journeys/V13-05_assignments_112.csv` | `v13/work/V13-05_assignments_112.csv` | `35816a1514481604e80775625cdcdc21dbecc9194437ab25eedbcfe79407c91a` | 15739 | none |
| `journeys/V13-05_journey_changes.csv` | `v13/work/V13-05_journey_changes.csv` | `2b2a16e44ac414356ca3d06d95bcf4e6660e85240e073d1ed6309d65f39efba4` | 31210 | none |
| `journeys/level2_journeys.json` | `journeys/level2_journeys.json` | `9d2db3d4766ab929f5cc3f8ce1eefef6224a9772acf6945175fa270170a1a8d0` | 71993 | none |
| `journeys/new_event_types.md` | `v13/work/new_event_types.md` | `a6c1d3bf01723910fd3d152a07124dc446134d87024abd4ce6d1de651517de0e` | 27494 | none |

Each PROC PR adds only the rows for the evidence it lands: PROC-001 the four `domain/` rows, PROC-002 the four
`journeys/` rows; PROC-005 adds the `notifications/` rows.
