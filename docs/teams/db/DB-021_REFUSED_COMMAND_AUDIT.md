# V13-DB-021 — Recording refused commands in the audit ledger (design note)

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team DB · 1 Nov 2026 · status: **PROPOSED**, for SEC's
threat review first, then the Chief Architect. No migration or code is written until both accept it. Requirement:
**REQ-AUD-005** (outcome on every audit record), following V13-DB-020 (migration 0012, PR #119), which added
`audit_event.outcome` with `REFUSED` reserved for this step. SEC's five questions (#117, comment 6553236861) are
answered in §4. Governing: ADR-011 (append-only hash-chained ledger), ADR-017 (attribution from verified claims).

## 1. What is recorded

A refusal of one of the three request-time commands:

| Command | Refusal codes recorded |
| --- | --- |
| `api_update_task_status` | V1401, V1404, V1409, V1422, V1423 |
| `api_create_notification_draft` | V1401, V1404, V1409, V1422, V1423 |
| `api_switch_workspace` | V1401, V1404 |

Not recorded:
- `api_install_claims_key` (a server-start step, not a user action);
- any other SQLSTATE (42501, V1500, constraint or system errors). These are faults, not refusals, and they keep going
  to the server log with the correlation id.

One refusal is one ledger row (subject to the bound in §4.5):
- `action` = `COMMAND_REFUSED`;
- `outcome` = `REFUSED`;
- `entity_type` = the command's entity (`task`, `notification`, `workspace`);
- `metadata` = `{"command": <allow-listed command name>, "refusal": <allow-listed code>}`, plus `suppressed` (§4.5) when
  it is not zero.

Actor, workspace and correlation id come from the verified claims, as for every row (ADR-017). They are null when
there is no valid context (V1401).

## 2. Two ways to write it

PostgreSQL cannot commit a row inside a transaction that rolls back, and V13 has no autonomous transactions (no dblink,
no extensions, CLAUDE.md §2). The row must therefore be written either by a transaction that commits, or by a second
transaction.

- **(C, recommended) The command records its own refusal.** Each command's body moves, unchanged, into an internal
  `_<command>_impl` function. The `api_*` wrapper calls it inside a PL/pgSQL `BEGIN … EXCEPTION` block:
  - When the impl raises one of the codes in §1, PostgreSQL rolls back the impl's subtransaction. Any row it wrote or
    locked is undone, and its row locks are released.
  - The wrapper then appends the REFUSED row and returns the refusal code instead of raising, so the transaction
    commits with that one row only.
  - Any other error propagates as today.

  The database itself decides that a refusal happened. There is no new callable function, and no caller supplies a
  code, an id or a command name.

  Contract change: the commands return a row whose `refusal` column holds the code, and their other columns are null.
  The adapters (`lib/adapters/my-work`, `lib/adapters/notification-records`) and `lib/server/workspace.ts` map that
  column exactly as they now map the SQLSTATE, so the answer the user sees does not change. Those files belong to other
  teams; the change goes through ARCH.
- **(A) The BFF reports the refusal in a second transaction.** After a command raises, `lib/db` opens a new
  `withRequestContext` transaction (new transaction id, new MAC) and calls `api_record_refusal(p_command, p_refusal)`.
  This is a definer function granted to `cdf_v13_user` that takes only two allow-listed codes. It is weaker:
  - any code holding the request role can write a REFUSED row for its own persona without a refusal having happened
    (rows prove "the BFF reported a refusal", not "the database refused");
  - a crash between the two transactions loses the row;
  - the second transaction adds a round trip to every refused request.

C is recommended. The rest of this note describes C; A differs only in §4.3.

## 3. Writer

`_append_audit` keeps its signature and stays SUCCEEDED-only. A new internal `_append_audit_refused(p_command text,
p_refusal text, p_entity_type text, p_entity_id uuid, p_case_id uuid)` shares its body through one private helper:
- same chain lock, READ COMMITTED check and highest policy version;
- hash version 2, `outcome` = `REFUSED`.

It is owned by `cdf_v13_owner`, SECURITY DEFINER and granted to no role, so only the wrapped commands (also owned by
the owner) can call it. It refuses (V1422) a command or code outside the §1 table.

## 4. SEC's questions

### 4.1 Same row for unknown and unauthorised

V1404 and V1401 rows **never carry an id**: `entity_id` and `case_id` are null, whatever the caller sent and whatever
exists. An unknown id, an unauthorised id, and an accessible case refused for the caller's role (the draft command's
role check also answers V1404) therefore give rows that are identical apart from seq, time, hashes and the claims'
actor, workspace and correlation id.

V1409, V1422 and V1423 are raised only after access was proven (0003, 0004). Those rows carry the target id and
`case_id` only if `can_access_case(case_id)` is still true when the row is written; otherwise both are null.
Re-checking at write time keeps the rule true even if a later command raises one of these codes earlier.

Timing: every refusal path ends with the same append, so recording adds the same cost to unknown and unauthorised
answers. The task command's access check still runs before any row lock (0003).

### 4.2 No free text

- `metadata` is built inside the database from two allow-listed codes, plus an integer when `suppressed` is not zero.
- No caller argument is copied into the row: not form values, status names, idempotency keys, template ids or reason
  text.
- A check constraint on the ledger pins it: a REFUSED row's metadata keys are a subset of `command`, `refusal` and
  `suppressed`, and its values match the allow-lists.

### 4.3 Write path

- **Under C**, the REFUSED row is written by the command's own committing transaction, through
  `_append_audit_refused`. No role gains a grant on `audit_event`, and no new function is granted to `cdf_v13_user`.
  The row is hash-chained like any other (same lock, hash version 2, `prev_hash` of the latest row), and
  `verify_audit_chain()` needs no change.
- **Under A**, the write path is `api_record_refusal`, which is granted to the request role and takes codes only. The
  chain is the same.

### 4.4 Readers

The ledger has no reader grant today (0001): only the owner and the administrator read it, through
`verify_audit_chain()`, which returns counts only. This step adds no reader.

Rule for any later audit read (a governance view, an export): REFUSED rows are excluded for every case-team capacity.
They are shown only through a purpose-built governance read with its own decision and negative tests. The existence of
a refusal on a case is case-sensitive information. This note proposes the rule; the read that applies it is not built
here.

### 4.5 Flooding

Repeated refusals must not grow the ledger or hold the chain lock without bound.

- **Bound.** One REFUSED row per key per window. The key is (actor persona, or none when there is no context; command;
  refusal code). The window is `REFUSAL_AUDIT_WINDOW_SECONDS`, proposed at 60.
- **Counter table.** A new owner-only table `refusal_window` holds, per key, the window start and a `suppressed` count.
  It has RLS with deny-all, no grant, and only `_append_audit_refused` updates it.
- **Within a window.** The first refusal for a key appends a ledger row and takes the chain lock. Later refusals only
  increment `suppressed`, under a row lock on that one key, with no chain lock and no ledger row.
- **Next window.** The next refusal for the key writes its row with `suppressed` = the previous window's count, so the
  count is carried in the chain. A count with no later refusal stays in `refusal_window`, readable by the owner.
- **Worst case.** Ledger growth is (personas + 1) × 3 commands × 5 codes rows per window, and the no-context key is a
  single shared row per command and code. Advisory and row locks stay in the V13 namespace and table.
- **Upstream limit.** A rate limit on the BFF's server actions is a separate control (`RateLimiter` port,
  PRODUCTION_SUBSTITUTION_REQUIRED). It is not a substitute for this bound.

## 5. Migration (sizing only; not written yet)

The next free migration (0013 if #119 lands first) would contain:
- `_append_audit_refused` and the shared private helper; `_append_audit` re-created with its body unchanged in effect;
- the three `_<command>_impl` functions;
- the three `api_*` wrappers, with the same arguments and one added `refusal` result column (dropped and created again,
  grants restored);
- table `refusal_window` (RLS, deny-all, owner-only);
- a check constraint on `audit_event` for REFUSED metadata;
- the register entry in DATA_MODEL.md §9;
- its own `policy_version` row as the last statement (rule from DB-020).

SEC's definer allow-lists (P03 and `catalog-audit`) gain `_append_audit_refused` and the three `_impl` functions, which
are definer because they hold the commands' bodies unchanged.

Tests:
- For each command and each code: one REFUSED row with exactly the §4.1 targets, and no other row changed. The
  subtransaction's partial writes and locks are gone.
- Unknown and unauthorised give identical row shapes.
- No caller value appears in any row.
- The window bound: N refusals give 1 row plus `suppressed` = N − 1, carried into the next window's row.
- The chain verifies across mixed SUCCEEDED and REFUSED rows.
- The request role still cannot read the ledger or `refusal_window`.
- The answers the BFF sees are unchanged (the adapters' unit tests and e2e).

## 6. Questions

1. For SEC: write path **C** (recommended) or A?
2. For SEC: the window bound in §4.5 (one row per persona, command and code per 60 s, with a suppressed count)?
3. For ARCH: under C, the return-shape change touches `lib/adapters/my-work`, `lib/adapters/notification-records` and
   `lib/server/workspace.ts`. Should DB propose those edits in the same PR for the owning teams to review, or should
   each team make its own?
