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
| `notifications/journeys/LEVEL2_JOURNEYS_PROPOSED.csv` | `journeys/LEVEL2_JOURNEYS_PROPOSED.csv` | `27b744597cc7ceb383b7ae23531ab7e6f577be80b2066fee370dc9229109197c` | 104687 | none |
| `notifications/journeys/LEVEL2_JOURNEYS_PROPOSED.md` | `journeys/LEVEL2_JOURNEYS_PROPOSED.md` | `4cd9072d31d58ab04ae540a2a6cd181cdc98781520b9043d8dae74075fe531af` | 89274 | none |
| `notifications/journeys/build_level2_table.py` | `journeys/build_level2_table.py` | `bf60ff33feaf6b80f1f8c0dbec664ee41728337e7a61a838cc9c669d050ede98` | 12544 | none (read only as data by REG-14; never run) |
| `notifications/journeys/level2_journeys.json` | `journeys/level2_journeys.json` | `9d2db3d4766ab929f5cc3f8ce1eefef6224a9772acf6945175fa270170a1a8d0` | 71993 | none |
| `notifications/journeys/make_level2_catalogue.py` | `journeys/make_level2_catalogue.py` | `3f77a0fdf231847350691c9a04c045f76cc4e53dd0141f44929b3ad5779f08fe` | 43756 | none (read only as data by REG-14; never run) |
| `notifications/ui_v9.js` | `generator/source/ui_v9.js` | `d4cec6209a94727531bfe56a29c31a182d50409656de80b40ad70d4ae6df59b0` | 104053 | 1 line (L25): synthetic ref `CDF-IC-2026-DEMO-0001` → `CDF-DEMO-2026-0001`; read only as text by PC-15 (L460, L478); never run |
| `notifications/v12_package_sha256_ledger_2026-10-27T1325Z.csv` | `v13/work/v12_package_sha256_ledger_2026-10-27T1325Z.csv` | `4d0d9895dc3aee1a1245b8e8a504c2386f8a127e719f2e1e10a56e526fdd0f0b` | 13211 | filtered: header + every row under `journeys/` (5) and `generator/source/` (95), 100 of 1,534; rows byte-identical, BOM kept; hashes only, no EML content |

Each PROC PR adds only the rows for the evidence it lands: PROC-001 the four `domain/` rows, PROC-002 the four
`journeys/` rows; PROC-005 adds the `notifications/` rows.
