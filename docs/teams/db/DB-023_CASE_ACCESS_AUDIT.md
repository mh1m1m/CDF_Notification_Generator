# V13-DB-023 — Recording case access in the audit ledger (design note)

**SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.** Team DB · 1 Nov 2026 · status: **ACCEPTED** (SEC
threat review ACCEPT 1b32f87 with Q1–Q3 answered and binding points 1–6, #137 comment 6554125758; Chief Architect
accepted in substance with decisions D1–D6, comment 6554193404; all folded into §9, which wins over the text above
where they differ). Requirement: **REQ-AUD-001** ("record audit events for … case access,
restricted information access … and permission changes"; the register's open part reads "case access and permission
changes not audited yet"). Builds on V13-DB-021 (migration 0013: one command per transaction, `refusal_window`, the
REFUSED row). Governing: ADR-011 (append-only hash-chained ledger), ADR-017 (attribution from verified claims). The
migration follows this note (0015 is free). No hosted step: 0013 and 0014 wait behind OI-034.

## 1. Which reads are recorded

A read is recorded when one persona opens **one case's content**: the place where an investigator, secretary or
governance officer actually sees what is in a case.

| Kind (allow-listed argument) | When | Ledger `action` | `entity_type`, `entity_id` |
| --- | --- | --- | --- |
| `CASE` | any case workspace page: overview, events, tasks, notifications tab, any page of those tabs | `CASE_OPENED`, or `RESTRICTED_CASE_OPENED` when the case is restricted | `case`, the case id |
| `NOTIFICATION_PREVIEW` | `?n=` opens a notification preview on the notifications tab | `NOTIFICATION_PREVIEW_OPENED` | `notification`, the notification id |

- **Restricted is decided by the database**, from `case_record.is_restricted` at the moment of the write, never by the
  caller. A restricted case therefore always leaves the separate `RESTRICTED_CASE_OPENED` action ("restricted
  information access" in REQ-AUD-001), so a reviewer can find every such access without reading metadata.
- The tab is **not** recorded. One case open is one fact; the tab adds row volume (and, under the bound in §3, would
  need its own window key) without telling a reviewer anything the case id does not.
- The preview gets its own kind because it shows one notification's rendered content, which is the closest M1 has to
  "a document was read".

**Not recorded**, with the reason:

| Read | Why not |
| --- | --- |
| My Work, Portfolio, Notification Center, workspace list | Lists. They show only rows the persona may already see (RLS), as display numbers, titles and statuses. Recording each list render would write one row per page view that names no single case, or one row per listed case, which floods the ledger with rows no reviewer can use. The case-level row is written when a case is opened from the list. See SEC question Q1 for restricted titles in lists. |
| Paging inside a tab (`?page=`) | Same case, same persona: covered by the `CASE` row and its window (§3). |
| The draft form on the notifications tab | Part of the case page (`CASE`); the draft itself is a command with its own row (0004, 0013). |
| `/api/health`, sign-in, locale switch | No case content. |
| A back/forward re-display served from the browser's router cache | No request reaches the server, so nothing can be written. The row records the delivery of case content, not each time it is displayed (D5). |
| A link prefetch | Prefetch never reaches the record or the case content (D1); a click is the open. |
| Reads that fail before the database (malformed id, `lib/authz` pre-check NOT_FOUND) | The BFF answers 404 without reaching the database; nothing names a case. These stay in the server log with the correlation id, as today. |

## 2. Write path

### 2.1 Options

- **(B, recommended) An `api_*` command in the read's own transaction.** A new SECURITY DEFINER command
  `api_record_access(p_kind text, p_case_id uuid, p_notification_id uuid default null)` is granted to `cdf_v13_user`.
  The BFF calls it **first**, inside the same `withRequestContext` transaction as the read it records (for `CASE`, the
  `case_header` read in `getCase`; for `NOTIFICATION_PREVIEW`, the `getForCase` read). The read and its row commit
  together, or neither does. The transaction is the header read's own short one (record, then one header select), as
  `getCase` runs today, never one that also runs the tab reads, so the ledger's chain lock
  (`pg_advisory_xact_lock(…, 1)`, held until commit) never spans them (D4).
- **(A) A read-through command.** `api_open_case` returns the header columns and writes the row, so a header can never
  be served without a row. It is stronger, but a SECURITY DEFINER function runs as the owner, which RLS does not
  bind: the function would have to repeat `case_header`'s visibility predicate by hand, and the two predicates could
  drift. `SET ROLE` is not allowed inside a definer function, so it cannot simply call the invoker read. Rejected for
  that reason; B keeps every read SECURITY INVOKER under RLS (0006, 0011).
- **(C) A separate transaction after the read.** A crash between the two loses the row, and a failed write could
  only be logged after the content was already served (fail open). Rejected.

Under B the database does not force the BFF to call the command: a page that skips it serves content without a row.
That is enforced in the application and in tests instead (§6): every case route and the preview have an integration
test that asserts exactly one row (or one suppressed count, §3) per open, and a mutation that drops the call must fail
it.

### 2.2 What the command does

1. Claims the transaction's command slot (`_claim_command_slot()`, 0013). B puts exactly one `api_*` call in the read
   transaction, and no write command ever shares that transaction (writes are separate Server Actions), so the slot
   is free. A second command in the same transaction gets V1500, as today.
2. Validates `p_kind` against the allow-list (`CASE`, `NOTIFICATION_PREVIEW`), else V1422.
3. Checks access with `can_access_case(p_case_id)` from the verified claims. For `NOTIFICATION_PREVIEW` it also checks
   that the notification belongs to that case and is visible under the notification policy (the same predicate as
   `getForCase`'s read, pinned by a test that compares the two for every persona × workspace × case).
4. **Unknown and unauthorised**: raises V1404. Through 0013's wrapper this becomes one `COMMAND_REFUSED` row with
   `metadata = {"command": "api_record_access", "refusal": "V1404"}` and **no ids**, bounded by `refusal_window`
   (§4). The BFF maps the refusal to NOT_FOUND exactly as it maps an empty header today.
5. **Visible**: appends one row through the shared writer, unless the window in §3 suppresses it.
6. Returns one row `(refusal text)`: null on success, the code otherwise. It never returns whether a row was written
   or suppressed, and never any case data.

`api_record_access` follows 0013's pattern: body in an owner-only `_api_record_access_impl`, wrapper catching V1401,
V1404 and V1422 only. No context (V1401) gives an id-less refused row, as for every command.

### 2.3 When the audit write fails: fail closed

If the append fails (chain lock timeout, constraint, any error), the error propagates, the transaction rolls back, and
the read in it never returns. The page shows the generic error with the correlation id (`resolveCaseWorkspace`'s
error view), not NOT_FOUND.

- **Why closed.** REQ-AUD-001 exists so that every access to case content, and every restricted access, is
  attributable. An open that served content with no row is exactly the event the requirement must exclude. The cost is
  availability: a ledger fault makes case pages unavailable until it is fixed. In M1 the ledger is a local table in the
  same database; it fails only when the database itself is failing, so the read would most likely fail anyway.
- **Why not a leak.** An unauthorised or unknown case never reaches the append (step 4 raises first), so "generic
  error" is only ever shown for a case the persona may see. The 404 for unknown and unauthorised is unchanged.
- **Preview.** The preview already turns any read failure into its own "unavailable" state with the correlation id
  (`loadNotificationPreview`). A failed preview append does the same; the rest of the tab still renders, because it was
  read in other transactions and was itself recorded by the `CASE` row.

## 3. Bounding

Every case page view now takes the ledger's chain lock. To keep rows and lock time bounded, the command keeps one row
per **(persona, case, action, entity)** per window, in a new owner-only table `access_window`, modelled on `refusal_window`:

- columns `persona_id`, `case_id`, `action`, `entity_id`, `window_start`, `suppressed`; primary key on the first
  four; RLS enabled, deny-all policy, no grant to any application role;
- the first open in a window appends the row and starts the window; later opens in the window only increment
  `suppressed` (no chain lock, no ledger write);
- the next row after the window carries `metadata.suppressed = n` when n > 0, so totals stay exact over time;
- `entity_id` is the case id for the two case actions and the notification id for `NOTIFICATION_PREVIEW_OPENED`, so a
  preview of a different notification in the same case within the window is written, not suppressed.

**Window: `ACCESS_AUDIT_WINDOW_SECONDS` = 300, DB-PROPOSED.** Five minutes covers moving between tabs and pages of one
case in one sitting, so a sitting is one row, and a return later the same day is a new row. 0013's 60 s was chosen for
refusals, which an attacker drives; opens are driven by authorised users, so a longer window loses less. **`RESTRICTED_CASE_OPENED` has no
window** (SEC Q2): every restricted open is a row, so restricted access can be counted exactly. The 300 s window
applies to `CASE_OPENED` and `NOTIFICATION_PREVIEW_OPENED` only.

Lock time: a suppressed open takes no chain lock. A written one holds it only for the header read's own transaction
(D4), never across the tab reads.

The window only suppresses, never replaces (SEC 3): a window row is created or restarted only by an append that
succeeded in the same transaction, so a failed append leaves no window row and the next open writes.

Known limit (SEC 2): between rows, `suppressed` lives in the unchained, mutable `access_window`. A burst of ordinary
opens followed by no later open reaches the ledger only as its first row; the count of the rest never does. The fact
of access is always recorded; the exact count of repeat opens within a window is not. Restricted opens have no window,
so the limit does not apply to them.

Concurrency: the window row is taken `FOR UPDATE` (insert … on conflict do update), so two simultaneous opens by the
same persona of the same case write one row, and the other increments `suppressed`.

## 4. The row

- `action` from §1; `outcome` `SUCCEEDED`; `entity_type`, `entity_id` from §1; `case_id` the case id.
- Actor, workspace and correlation id come from the verified claims, as for every row (ADR-017). The policy version
  and hash version 2 are chosen by the writer (0012).
- `metadata` is `{}`, or `{"suppressed": n}`. No title, display number, tab, stage, status, notification content,
  recipient class or any caller text. The `CASE` / `NOTIFICATION_PREVIEW` argument itself is not copied; it only selects
  the action.
- A check constraint extends 0013's shape rule: for the three new actions, `outcome = 'SUCCEEDED'`, `case_id` and
  `entity_id` not null, `entity_type` matching the action, and metadata keys a subset of `suppressed` with an integer
  value.

**Unknown and unauthorised leave identical traces.** Both raise V1404 before any id is used and leave one id-less
`COMMAND_REFUSED` row (window-bounded), identical apart from seq, time, hashes and the claims' actor, workspace and
correlation id. Timing is equal too: both paths stop at the same access check and then append the same refused row.
A visible case leaves a `CASE_OPENED` row, which is the point of the requirement. The ledger has no reader grant
(0001); 0013's rule for any future audit read applies here too: access rows are case-sensitive, and any reader is a
purpose-built governance read with its own decision and negative tests.

## 5. Permission changes

In M1 no command changes roles, memberships, case assignments or persona status. All of them are seeded
(`database/seed/0001`, `0002`) and change only through migrations, which are reviewed in Git and leave their own
`schema_migrations` row. REQ-AUD-001's "permission changes" part therefore has nothing to record in M1; the register
row should say so and keep that part open.

A future permission-change command (membership grant or end, case assignment or end, role change, persona
deactivation) must:
- be an `api_*` SECURITY DEFINER command under 0013's pattern (slot, impl, refused rows);
- write one `SUCCEEDED` row per change in its own transaction, before it commits;
- name the subject persona and the case or workspace by id only (`entity_type` `membership` / `case_assignment` /
  `persona`, `entity_id` the row id, `case_id` when there is one), with metadata from allow-listed codes only (old and
  new role or capacity code, valid-from and valid-to as dates);
- never be suppressed by a window: every permission change is a row;
- be refused (V1404, id-less) when the actor may not administer that case or workspace, identically for unknown and
  unauthorised;
- since a permission change alters what `can_access_case` returns but not the schema, it does not need a
  `V13-ACCESS-NNNN` row; the command that makes it does.

## 6. Tests the migration will carry

- For every persona × workspace × case and the unknown case: an open of a visible case writes exactly one
  `CASE_OPENED` (or `RESTRICTED_CASE_OPENED` for 0009) row with the claims' actor and correlation id; an invisible or
  unknown case writes one id-less `COMMAND_REFUSED` row and the BFF answers 404; the two refused rows are identical in
  every column a reader could compare.
- Restricted: 0009 opened by Beta is `RESTRICTED_CASE_OPENED`; the same case opened after `is_restricted` changes
  follows the flag at write time.
- Window: second open within 300 s writes nothing and increments `suppressed`; the first open after the window carries
  `suppressed`; concurrent opens write one row; different personas, cases or actions are separate windows; a preview
  of a different notification in the same window is written.
- Fail closed: with the append forced to fail (rolled-back test that drops the writer's grant or plants a failing
  constraint), the read in the same transaction does not return and the BFF shows the generic error, not 404 and not
  the page.
- Slot: `api_record_access` plus any other `api_*` in one transaction gives V1500; the read transaction never holds a
  second command.
- Row shape: metadata outside `{suppressed}` is refused by the constraint; no title, number or caller text in any row.
- Grants: EXECUTE on `api_record_access` to `cdf_v13_user` only; `access_window` has RLS on, deny-all, no grant.
- BFF (FE path, separate commit): each case route and the preview call the command first in the read's transaction; a
  mutation that removes the call fails a test; refusal maps to NOT_FOUND; a failed append maps to the generic error.
- SEC path, separate commit: `context-forgery` registry entry; forged contexts write only id-less refused rows.
- `V13-ACCESS-0015` as the migration's last statement; the register and hosted-resume tests extended to 0015.

## 7. Questions for SEC

- **Q1. Restricted titles in lists.** Portfolio and My Work show a restricted case's display number and title to a
  persona who may see it, without opening it. Is that "restricted information access" that needs a row? DB proposes
  no: a title is the case's identity on the list, the open writes the row, and a per-list row would carry no case id
  (or many). If SEC says yes, the least-volume form is one `RESTRICTED_CASE_LISTED` row per (persona, case) per
  window, written by the list read's own transaction under the same pattern.
- **Q2. Window for restricted opens.** Same 300 s as ordinary opens (proposed), a shorter window, or every restricted
  open a row?
- **Q3. Refused opens.** Recording unknown and unauthorised opens as id-less `COMMAND_REFUSED` rows (proposed) gives
  enumeration probes a trace while revealing nothing. The alternative is no row at all for both. DB recommends the
  trace.

## 8. Production substitution

PRODUCTION_SUBSTITUTION_REQUIRED: in production, access events go to the CDF SIEM (SLS) through the audit sink port
(`AuditSinkPort`), with the CDF platform's retention; the window value and the restricted-access rule come from the CDF
records and security policy, not from this note.

## 9. Decisions

Binding on migration 0015 and the FE commit. Where they differ from §1–§7, these win.

**SEC answers (comment 6554125758).**
- **Q1:** no row for restricted titles shown in lists in M1. REQ-AUD-001's register note keeps saying list exposure of
  restricted titles is not recorded.
- **Q2:** no window for `RESTRICTED_CASE_OPENED`; every restricted open is a row. 300 s (DB-PROPOSED) stays for
  `CASE_OPENED` and `NOTIFICATION_PREVIEW_OPENED`.
- **Q3:** refused opens keep their trace: one id-less `COMMAND_REFUSED` row through 0013's wrapper and `refusal_window`,
  identical for unknown and unauthorised.

**SEC binding points.**
1. **One choke point.** The record call sits in the one path that yields a `CaseHeader` for a route (`getCaseForRoute`
   → the case port, in the same transaction as `case_header`), not in each page. A test shows every case tab (overview,
   events, tasks, notifications, each paged tab) and the preview leave exactly one row or one suppressed increment; a
   mutation that removes the call fails it. Any later BFF path that returns case content without `getCaseForRoute` is a
   SEC review item.
2. **Suppressed counts outside the chain** are a stated limit (§3).
3. **The window suppresses, never replaces.** A window row exists only after a successful append in the same
   transaction; tested by forcing the append to fail and checking no `access_window` row remains and the next open
   writes.
4. **Preview parity.** An unknown `?n=`, a notification of another case and a notification hidden by the notification
   policy give the same refused row and the same preview "unavailable" state; the page's case row stays.
5. **Slot.** No transaction holds `api_record_access` and a write command together (V1500); a test shows
   `createDraft`'s transaction never calls the record command.
6. **Registry and grants.** `context-forgery` registry entry (SEC path, separate commit); `access_window` RLS on,
   deny-all, no grant; EXECUTE on `api_record_access` for `cdf_v13_user` only; `V13-ACCESS-0015` as the last statement.

**Chief Architect decisions (comment 6554193404).**
- **D1. No prefetch reaches the record or the content.** Pinned by a browser test on a production build (QA path, with
  the FE commit): rendering My Work, Portfolio and the Notification Center with case links in view and hovered writes
  no access row; clicking one case writes exactly one.
- **D2. One load per request.** `generateMetadata` and the page share the load through React `cache()` with identical
  keys, so one request makes one record call. Pinned where no window can hide a second call: one page request on
  restricted case 0009 leaves exactly one `RESTRICTED_CASE_OPENED` row.
- **D3. The recording read says so in its port.** `CaseSourceAdapter` gains `openCase(identity, caseId)` (record, then
  read the header, in one transaction; a refusal answers null), documented in `lib/contracts`; `getCaseForRoute` is its
  only caller. The preview reader's recording read is named and documented the same way. The `lib/contracts` hunk gets
  the Chief Architect's path-owner review. The CDF platform adapter that replaces the prototype must record access too.
- **D4. Lock time.** The record call stays in the header read's own short transaction, never in one that runs the tab
  reads (§2.1, §3).
- **D5. Router-cache re-display** writes no row (§1).
- **D6. Register.** REQ-AUD-001 stays IN_PROGRESS after 0015 and the FE commit, with two parts open: permission changes
  (no M1 command makes one, §5) and restricted titles in lists (Q1). PROC's next register pass records it.
