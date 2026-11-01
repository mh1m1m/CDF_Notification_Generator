# Changelog

Version history of the CDF Case & Notification Intelligence Platform — V13 Enterprise. **SYNTHETIC-DATA REFERENCE
IMPLEMENTATION, not CDF production.** No release here is a production release.

How this file works (REQ-CICD-006, V13-ARCH-012):

- It has one section per release, newest first, under `## [Unreleased]`. A release heading is
  `## [x.y.z] - YYYY-MM-DD`, following Semantic Versioning (0.x while the milestones are in progress).
- A release is the owner's milestone merge of `develop` into `main` (CLAUDE.md §6). The milestone PR (V13-ARCH-007
  for M1) moves the Unreleased text into a new release section and sets `package.json`'s version to match.
- When the owner merges a milestone into `main`, `.github/workflows/release.yml` tags that merge commit `v<version>` and
  publishes the version's section as the GitHub release notes. A tag is never moved.
- `pnpm lint` checks this file's structure (`scripts/ci/release-notes.mjs --check`).
- Every merge into `develop`, with its CI runs and test counts, is recorded in `docs/TEST_EVIDENCE.md` §4.1. Each
  task's state is on the board (`docs/AGENT_TASK_BOARD.md`).

## [Unreleased]

Milestone M1 work on `develop`, not yet released. The milestone PR (V13-ARCH-007) writes the M1 release notes here as
section `[0.1.0]`, from the board and `docs/TEST_EVIDENCE.md` §4.1.
