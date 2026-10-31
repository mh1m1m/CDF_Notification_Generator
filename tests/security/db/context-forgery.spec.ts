// V13-SEC-002 · SEC-DB-01, SEC-DB-02, SEC-DB-03, SEC-DB-06 (forged workspace), SEC-DB-17 (coverage guard)
// Threats TM-S4, TM-S5, TM-S6, TM-E3.
// Every V13 table (discovered from the catalogue) and every function the request role may execute (a coverage guard
// fails when a new one is not listed here) is swept under every hostile context in support.ts: no claims, malformed
// or incomplete claims, a forged, foreign or replayed MAC, an unknown or inactive persona, a non-member or unknown
// workspace, and claims rewritten inside a verified transaction. Each must be "nobody": zero rows or a privilege
// refusal on every table, null/false/empty from every helper, zero rows from every read function, V1401 from every
// command. A control run as Secretary Alpha proves the sweep is not vacuous. Everything is rolled back.
// SYNTHETIC DATA ONLY.
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/lib/db/security-context";
import {
  ALL_CASES,
  appClient,
  CORRELATION,
  asPersona,
  asRaw,
  attempt,
  claimsText,
  databaseReady,
  executableFunctions,
  HOSTILE_CONTEXTS,
  installTestKey,
  PERSONA,
  SCHEMA,
  TASK,
  TEMPLATE_VERSION,
  UNKNOWN_CASE,
  v13Tables,
  WORKSPACE,
  type Outcome,
} from "./support";

const present = await databaseReady("context-forgery");

const CASES = [...ALL_CASES, UNKNOWN_CASE];
const ROLE_CODES = ["COMMITTEE_SECRETARY", "INVESTIGATOR", "GOVERNANCE_OFFICER"];
const KEY = "a".repeat(64);

type Verdict = string | null; // null = nobody (as required); otherwise what leaked

const scalarIs =
  (expected: unknown) =>
  (o: Outcome): Verdict => {
    if (!o.ok) return `refused ${o.code} (expected a value)`;
    const v = Object.values(o.rows?.[0] ?? {})[0];
    // postgres.js returns bigint as a string.
    const norm = typeof expected === "number" && typeof v === "string" ? Number(v) : v;
    return JSON.stringify(norm) === JSON.stringify(expected) ? null : `returned ${JSON.stringify(norm)}`;
  };
const noRows = (o: Outcome): Verdict =>
  !o.ok ? `refused ${o.code} (expected zero rows)` : o.rows!.length === 0 ? null : `${o.rows!.length} row(s)`;
const refusedWith =
  (code: string) =>
  (o: Outcome): Verdict =>
    !o.ok && o.code === code
      ? null
      : o.ok
        ? `ran (${o.rows!.length} row(s))`
        : `refused ${o.code}, not ${code}`;
const emptyArray = (o: Outcome): Verdict => {
  if (!o.ok) return `refused ${o.code}`;
  const v = Object.values(o.rows?.[0] ?? {})[0];
  return v === null || (Array.isArray(v) && v.length === 0) ? null : `returned ${JSON.stringify(v)}`;
};

interface Probe {
  label: string;
  /** Identity probes may answer for a verified persona whose workspace is unusable (personaOnly contexts). */
  identity?: boolean;
  call: (tx: Tx) => Promise<unknown>;
  nobody: (o: Outcome) => Verdict;
}

/** Every executable V13 function, by signature, with the probes that exercise it. */
const REGISTRY: Record<string, Probe[]> = {
  "can_access_case(p_case_id uuid)": CASES.map((c) => ({
    label: `can_access_case ${c.slice(-2)}`,
    call: (tx) => tx`select cdf_notifications_v13.can_access_case(${c}) as v`,
    nobody: scalarIs(false),
  })),
  "is_assigned_to_case(p_case_id uuid)": CASES.map((c) => ({
    label: `is_assigned_to_case ${c.slice(-2)}`,
    // Assignments belong to the persona, not the workspace; case content still needs can_access_case.
    identity: true,
    call: (tx) => tx`select cdf_notifications_v13.is_assigned_to_case(${c}) as v`,
    nobody: scalarIs(false),
  })),
  "has_role(p_role_code text)": ROLE_CODES.map((r) => ({
    label: `has_role ${r}`,
    call: (tx) => tx`select cdf_notifications_v13.has_role(${r}) as v`,
    nobody: scalarIs(false),
  })),
  "_is_colleague(p_persona_id uuid)": Object.values(PERSONA).map((p) => ({
    label: `_is_colleague ${p.slice(-2)}`,
    call: (tx) => tx`select cdf_notifications_v13._is_colleague(${p}) as v`,
    nobody: scalarIs(false),
  })),
  // Pure ranking of a capacity code: no context, nothing to disclose. Listed so the guard stays exhaustive.
  "_capacity_rank(p_capacity text)": [],
  "current_persona_id()": [
    {
      label: "current_persona_id",
      identity: true,
      call: (tx) => tx`select cdf_notifications_v13.current_persona_id() as v`,
      nobody: scalarIs(null),
    },
  ],
  "current_workspace_id()": [
    {
      label: "current_workspace_id",
      call: (tx) => tx`select cdf_notifications_v13.current_workspace_id() as v`,
      nobody: scalarIs(null),
    },
  ],
  "current_correlation_id()": [
    {
      // The caller's own correlation id when the MAC verifies (it identifies the request, not a person); else null.
      label: "current_correlation_id",
      call: (tx) => tx`select cdf_notifications_v13.current_correlation_id() as v`,
      nobody: (o) =>
        scalarIs(null)(o) === null || scalarIs(CORRELATION)(o) === null ? null : scalarIs(null)(o),
    },
  ],
  "current_role_codes()": [
    {
      label: "current_role_codes",
      call: (tx) => tx`select cdf_notifications_v13.current_role_codes() as v`,
      nobody: emptyArray,
    },
  ],
  "current_persona()": [
    {
      label: "current_persona",
      identity: true,
      call: (tx) => tx`select * from cdf_notifications_v13.current_persona()`,
      nobody: noRows,
    },
  ],
  "case_header(p_case_id uuid)": CASES.map((c) => ({
    label: `case_header ${c.slice(-2)}`,
    call: (tx) => tx`select * from cdf_notifications_v13.case_header(${c})`,
    nobody: noRows,
  })),
  "case_events(p_case_id uuid)": CASES.map((c) => ({
    label: `case_events ${c.slice(-2)}`,
    call: (tx) => tx`select * from cdf_notifications_v13.case_events(${c})`,
    nobody: noRows,
  })),
  "case_tasks(p_case_id uuid)": CASES.map((c) => ({
    label: `case_tasks ${c.slice(-2)}`,
    call: (tx) => tx`select * from cdf_notifications_v13.case_tasks(${c})`,
    nobody: noRows,
  })),
  "case_notifications(p_case_id uuid)": CASES.map((c) => ({
    label: `case_notifications ${c.slice(-2)}`,
    call: (tx) => tx`select * from cdf_notifications_v13.case_notifications(${c})`,
    nobody: noRows,
  })),
  "my_work_tasks(p_include_closed boolean)": [true, false].map((b) => ({
    label: `my_work_tasks ${b}`,
    call: (tx) => tx`select * from cdf_notifications_v13.my_work_tasks(${b})`,
    nobody: noRows,
  })),
  "portfolio_count(p_stage text, p_records_state text, p_search text, p_assigned_to_me boolean)": [
    {
      label: "portfolio_count (no filter)",
      call: (tx) => tx`select cdf_notifications_v13.portfolio_count(null, null, null, false) as v`,
      nobody: scalarIs(0),
    },
    {
      label: "portfolio_count (search CDF-DEMO)",
      call: (tx) => tx`select cdf_notifications_v13.portfolio_count(null, null, 'CDF-DEMO', false) as v`,
      nobody: scalarIs(0),
    },
  ],
  "portfolio_page(p_after_display_number text, p_limit integer, p_stage text, p_records_state text, p_search text, p_assigned_to_me boolean)":
    [
      {
        label: "portfolio_page",
        call: (tx) =>
          tx`select * from cdf_notifications_v13.portfolio_page(null, 100, null, null, null, false)`,
        nobody: noRows,
      },
    ],
  "api_update_task_status(p_task_id uuid, p_new_status text, p_expected_version integer)": [1, 2, 17].map(
    (n) => ({
      label: `api_update_task_status task ${n}`,
      call: (tx) => tx`select * from cdf_notifications_v13.api_update_task_status(${TASK(n)}, 'BLOCKED', 1)`,
      nobody: refusedWith("V1401"),
    }),
  ),
  "api_create_notification_draft(p_case_id uuid, p_template_version_id uuid, p_recipient_class text, p_idempotency_key text)":
    [1, 9].map((n) => ({
      label: `api_create_notification_draft case ${n}`,
      call: (tx) =>
        tx`select * from cdf_notifications_v13.api_create_notification_draft(${ALL_CASES[n - 1]!}, ${TEMPLATE_VERSION(1)}, 'CASE_TEAM', ${KEY})`,
      nobody: refusedWith("V1401"),
    })),
  "api_switch_workspace(p_workspace_id uuid)": Object.values(WORKSPACE).map((w) => ({
    label: `api_switch_workspace ${w.slice(-2)}`,
    // A verified persona may switch to a workspace it belongs to (that is the way out of a bad workspace claim).
    identity: true,
    call: (tx) => tx`select * from cdf_notifications_v13.api_switch_workspace(${w})`,
    nobody: refusedWith("V1401"),
  })),
  // V13-DB-009 (migration 0007, PR #28): answers for a transaction-bound probe MAC under a domain-separated label and
  // reads no claims, so it has no "nobody" form; claims-key-state.spec.ts covers forged and replayed probes. Listed
  // so the guard stays exhaustive once 0007 lands (until then it is in NOT_YET_MIGRATED).
  "claims_key_state(p_probe_mac text)": [],
  // First writer wins and does not read the claims; identity-claims.spec.ts covers it (same key: ALREADY_INSTALLED,
  // other key: V1409). Listed so the guard stays exhaustive.
  "api_install_claims_key(p_key bytea)": [],
};

/** Registry entries whose migration is in review, not yet on develop: allowed to be absent, never extra. */
const NOT_YET_MIGRATED = new Set(["claims_key_state(p_probe_mac text)"]);

/** Runs every table read and every probe in the current context; returns what was NOT "nobody". */
/** Tables whose policies depend on the persona alone (own rows, own memberships, signed-in reference data). */
const IDENTITY_TABLES = new Set([
  "persona",
  "persona_workspace_membership",
  "workspace",
  "role",
  "notification_recipient_class",
]);

async function sweep(tx: Tx, tables: { name: string }[], personaOnly = false): Promise<string[]> {
  const leaks: string[] = [];
  for (const t of tables) {
    if (personaOnly && IDENTITY_TABLES.has(t.name)) continue;
    const o = await attempt(tx, (sp) => sp`select count(*)::int as n from ${sp(SCHEMA)}.${sp(t.name)}`);
    if (o.ok && Number(o.rows?.[0]?.n) !== 0) leaks.push(`table ${t.name}: ${String(o.rows?.[0]?.n)} row(s)`);
    if (!o.ok && o.code !== "42501") leaks.push(`table ${t.name}: refused ${o.code}, not 42501`);
  }
  for (const probes of Object.values(REGISTRY)) {
    for (const p of probes) {
      if (personaOnly && p.identity) continue;
      const verdict = p.nobody(await attempt(tx, p.call));
      if (verdict) leaks.push(`${p.label}: ${verdict}`);
    }
  }
  return leaks;
}

describe.skipIf(!present)(
  "SEC-DB-01/02/03/06 every hostile context is nobody, on every table and function",
  () => {
    let sql: postgres.Sql;
    let tables: { name: string; caseColumn: string | null }[];

    beforeAll(async () => {
      sql = appClient();
      await installTestKey(sql);
      tables = await asPersona(sql, PERSONA.alpha, "SECRETARIAT", (tx) => v13Tables(tx));
    });
    afterAll(async () => {
      await sql?.end({ timeout: 5 });
    });

    it("SEC-DB-17 coverage guard: every function the request role may execute is in the registry, and only those", async () => {
      const executable = await asPersona(sql, PERSONA.alpha, "SECRETARIAT", (tx) => executableFunctions(tx));
      const listed = Object.keys(REGISTRY).filter(
        (sig) => executable.includes(sig) || !NOT_YET_MIGRATED.has(sig),
      );
      expect(executable).toEqual(listed.sort());
      expect(tables.length).toBeGreaterThanOrEqual(18);
    });

    it("control: a valid Secretary Alpha context is somebody (the sweep would see a leak)", async () => {
      const seen = await asRaw(
        sql,
        { claims: claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT), mac: "valid" },
        (tx) => sweep(tx, tables),
      );
      // Alpha reads its cases, its tasks, its colleagues and its roles, and its commands run (all rolled back).
      expect(seen.some((l) => l.startsWith("table case_record:"))).toBe(true);
      expect(seen.some((l) => l.startsWith("current_persona_id:"))).toBe(true);
      expect(seen.some((l) => l.startsWith("portfolio_count (no filter):"))).toBe(true);
      expect(seen.some((l) => l.startsWith("api_switch_workspace"))).toBe(true);
    });

    for (const ctx of HOSTILE_CONTEXTS) {
      it(`${ctx.label}: zero rows, null helpers, V1401 commands`, async () => {
        const leaks = await ctx.run(sql, (tx) => sweep(tx, tables, ctx.personaOnly));
        expect(leaks).toEqual([]);
      });
    }
  },
);
