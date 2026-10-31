# PROC proposals — CDF V13 Enterprise (synthetic data only)

Proposals that change procedural status semantics. None is implemented until the owner approves it (REQ-GOV-014,
Prompt B §16). The Chief Architect tracks each one in `docs/OPEN_ISSUES.md` and takes it to the owner.

## BL-46 — PROPOSED, awaiting owner approval (REQ-GOV-014)

**Problem (reference package, gate G2 PARTIAL, test ST-34).** Seven journey-bound procedures (CF-15, CF-16, CF-17, CF-18,
CF-19, CF-23b, CF-36) declare a PROCEDURE status that the domain fold of their own recorded events does not give: their
events (presentation to the chair, chair direction, rights and defence notices, sanction extract) drive no row of the
generic PROCEDURE table, so the fold returns no status.

**Proposal.** Add journey-bound rows to the PROCEDURE table. They apply only to an event whose `object` is a PROCEDURE
of that journey; every other event is ignored as today. Labelled PROPOSED (a modelling mapping derived from the journey
catalogue, not a governance value).

| Journey | Event | From → to |
| ------- | ----- | --------- |
| J-CHAIR-DIRECTION | `MATTER_PRESENTED_TO_CHAIR` | null → OPEN |
| J-CHAIR-DIRECTION | `CHAIR_DIRECTION_RECORDED` | OPEN → IN_PROGRESS |
| J-DEFENCE | `RIGHTS_NOTICE_ISSUED` | null → OPEN |
| J-DEFENCE | `DEFENCE_NOTICE_ISSUED` | OPEN → IN_PROGRESS |
| J-DEFENCE | `DEFENCE_PERIOD_STARTED` | hold (IN_PROGRESS stays, source event unchanged) |
| J-DEFENCE | `DEFENCE_PACKET_RELEASED` | hold (IN_PROGRESS stays, source event unchanged) |
| J-SANCTION-EXTRACT | `SANCTION_EXTRACT_PREPARED` | null → OPEN |
| J-SANCTION-EXTRACT | `SANCTION_EXTRACT_APPROVAL_REQUESTED` | hold (OPEN stays, source event unchanged) |

**Fixture effects.**
- CF-15 declares OPEN (source `evt-CF-15-01`) instead of IN_PROGRESS: it records only the presentation to the chair.
- CF-36 keeps OPEN; its source event becomes `evt-CF-36-01` (the preparation) instead of `evt-CF-36-02` (the approval
  request is a hold row).
- CF-16, CF-17, CF-18, CF-19 and CF-23b are unchanged (declared IN_PROGRESS from their second event, which the rows give).

**ST-34 effect.** ST-34 reports 0 differences and becomes a strict assertion instead of a diagnostic; gate G2 can then be
reported PASS.

**Until approved.** The port keeps the reference behaviour unchanged: no new PROCEDURE rows, and ST-34 keeps the
reference's documented differences for these seven scenarios. Nothing in M1 depends on it (journeys are first shown in
M3).
