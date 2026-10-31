// V13-DB-001 — migration 0001 against the primary cluster with the identity seed: the claims MAC (ADR-014), the
// identity helpers per persona context, the identity read policies and the key install. Every negative case resolves
// to "nobody" (NULL persona, NULL workspace, no roles, no rows) or a privilege error, never to another persona.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimsMac } from "@/lib/db/security-context";
import type { Tx } from "@/lib/db/security-context";
import { TEST_CLAIMS_KEY } from "./support/claims";
import { clusterAvailable, PRIMARY_ADMIN_URL } from "./support/clusters";
import {
  adminClient,
  appClient,
  asOwner,
  asPersona,
  asRaw,
  claimsText,
  CORRELATION,
  identitySeedPresent,
  PERSONA,
  WORKSPACE,
} from "./support/context";

const available = await clusterAvailable("primary", PRIMARY_ADMIN_URL);
const seeded = available && (await identitySeedPresent(adminClient()));
if (available && !seeded)
  console.warn("[integration] skipping identity-claims: no identity seed (pnpm db:reset)");

interface Who {
  persona: string | null;
  workspace: string | null;
  roles: string[];
  correlation: string | null;
}

async function who(tx: Tx): Promise<Who> {
  const [row] = await tx<Who[]>`
    select cdf_notifications_v13.current_persona_id()      as persona,
           cdf_notifications_v13.current_workspace_id()    as workspace,
           cdf_notifications_v13.current_role_codes()      as roles,
           cdf_notifications_v13.current_correlation_id()  as correlation`;
  return row!;
}

const NOBODY: Who = { persona: null, workspace: null, roles: [], correlation: null };

/** What the request role can read of the identity tables (codes only; e-mail is not readable). */
async function visible(tx: Tx) {
  const [row] = await tx<
    { personas: string[] | null; workspaces: string[] | null; memberships: number; roles: number }[]
  >`
    select (select array_agg(code order by code) from cdf_notifications_v13.persona)   as personas,
           (select array_agg(code order by code) from cdf_notifications_v13.workspace) as workspaces,
           (select count(*)::int from cdf_notifications_v13.persona_workspace_membership) as memberships,
           (select count(*)::int from cdf_notifications_v13.role) as roles`;
  return row!;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return String((error as { code?: unknown }).code ?? "UNKNOWN");
  }
}

describe.skipIf(!seeded)("claims, identity helpers and identity reads (migration 0001)", () => {
  let app: postgres.Sql;
  let admin: postgres.Sql;

  beforeAll(async () => {
    app = appClient();
    admin = adminClient();
    // Installs the synthetic test key if db:reset left none.
    await asPersona(app, PERSONA.alpha, "SECRETARIAT", async () => undefined);
  });

  afterAll(async () => {
    await app?.end({ timeout: 5 });
    await admin?.end({ timeout: 5 });
  });

  describe("identity helpers per persona context", () => {
    const cases: [string, string, keyof typeof WORKSPACE, Who][] = [
      [
        "Secretary Alpha in the Secretariat",
        PERSONA.alpha,
        "SECRETARIAT",
        {
          persona: PERSONA.alpha,
          workspace: WORKSPACE.SECRETARIAT,
          roles: ["COMMITTEE_SECRETARY"],
          correlation: CORRELATION,
        },
      ],
      [
        "Investigator Beta in Investigations",
        PERSONA.beta,
        "INVESTIGATIONS",
        {
          persona: PERSONA.beta,
          workspace: WORKSPACE.INVESTIGATIONS,
          roles: ["INVESTIGATOR"],
          correlation: CORRELATION,
        },
      ],
      [
        "Governance Officer Delta in Governance",
        PERSONA.delta,
        "GOVERNANCE",
        {
          persona: PERSONA.delta,
          workspace: WORKSPACE.GOVERNANCE,
          roles: ["GOVERNANCE_OFFICER"],
          correlation: CORRELATION,
        },
      ],
      [
        "Delta in the Secretariat keeps its own role there, not the secretary's",
        PERSONA.delta,
        "SECRETARIAT",
        {
          persona: PERSONA.delta,
          workspace: WORKSPACE.SECRETARIAT,
          roles: ["GOVERNANCE_OFFICER"],
          correlation: CORRELATION,
        },
      ],
      [
        "Delta claiming Investigations (no membership): no workspace, no roles",
        PERSONA.delta,
        "INVESTIGATIONS",
        { persona: PERSONA.delta, workspace: null, roles: [], correlation: CORRELATION },
      ],
      [
        "Secretary Epsilon (membership expired): no workspace, no roles",
        PERSONA.epsilon,
        "SECRETARIAT",
        { persona: PERSONA.epsilon, workspace: null, roles: [], correlation: CORRELATION },
      ],
      [
        "Persona Zeta (deactivated): nobody",
        PERSONA.zeta,
        "SECRETARIAT",
        { persona: null, workspace: null, roles: [], correlation: CORRELATION },
      ],
      [
        "a persona that does not exist: nobody",
        PERSONA.unknown,
        "SECRETARIAT",
        { persona: null, workspace: null, roles: [], correlation: CORRELATION },
      ],
    ];

    it.each(cases)("%s", async (_name, persona, workspace, expected) => {
      expect(await asPersona(app, persona, workspace, who)).toEqual(expected);
    });

    it("has_role follows current_role_codes and never widens", async () => {
      const roles = await asPersona(app, PERSONA.delta, "SECRETARIAT", async (tx) => {
        const [row] = await tx<{ gov: boolean; sec: boolean; inv: boolean }[]>`
          select cdf_notifications_v13.has_role('GOVERNANCE_OFFICER') as gov,
                 cdf_notifications_v13.has_role('COMMITTEE_SECRETARY') as sec,
                 cdf_notifications_v13.has_role('INVESTIGATOR') as inv`;
        return row;
      });
      expect(roles).toEqual({ gov: true, sec: false, inv: false });
    });
  });

  describe("identity read policies", () => {
    it("Alpha sees itself and active colleagues of the Secretariat only, never the inactive Zeta", async () => {
      expect(await asPersona(app, PERSONA.alpha, "SECRETARIAT", visible)).toEqual({
        personas: ["GOVERNANCE_DELTA", "SECRETARY_ALPHA"],
        workspaces: ["SECRETARIAT"],
        memberships: 1,
        roles: 3,
      });
    });

    it("Beta sees the Investigations team; Delta in Governance sees itself and both of its workspaces", async () => {
      expect(await asPersona(app, PERSONA.beta, "INVESTIGATIONS", visible)).toEqual({
        personas: ["INVESTIGATOR_BETA", "INVESTIGATOR_GAMMA"],
        workspaces: ["INVESTIGATIONS"],
        memberships: 1,
        roles: 3,
      });
      expect(await asPersona(app, PERSONA.delta, "GOVERNANCE", visible)).toEqual({
        personas: ["GOVERNANCE_DELTA"],
        workspaces: ["GOVERNANCE", "SECRETARIAT"],
        memberships: 2,
        roles: 3,
      });
    });

    it("an invalid workspace claim shows no colleagues; an expired member sees only itself", async () => {
      expect(await asPersona(app, PERSONA.delta, "INVESTIGATIONS", visible)).toMatchObject({
        personas: ["GOVERNANCE_DELTA"],
      });
      expect(await asPersona(app, PERSONA.epsilon, "SECRETARIAT", visible)).toEqual({
        personas: ["SECRETARY_EPSILON"],
        workspaces: null,
        memberships: 1,
        roles: 3,
      });
    });

    it("a deactivated or unknown persona sees nothing", async () => {
      const nothing = { personas: null, workspaces: null, memberships: 0, roles: 0 };
      expect(await asPersona(app, PERSONA.zeta, "SECRETARIAT", visible)).toEqual(nothing);
      expect(await asPersona(app, PERSONA.unknown, "SECRETARIAT", visible)).toEqual(nothing);
    });

    it("hides persona e-mail addresses (42501); a persona reads its own through current_persona()", async () => {
      expect(
        await codeOf(
          asPersona(
            app,
            PERSONA.alpha,
            "SECRETARIAT",
            (tx) => tx`select email from cdf_notifications_v13.persona`,
          ),
        ),
      ).toBe("42501");
      expect(
        await codeOf(
          asPersona(
            app,
            PERSONA.alpha,
            "SECRETARIAT",
            (tx) => tx`select * from cdf_notifications_v13.persona`,
          ),
        ),
      ).toBe("42501");
      const own = await asPersona(
        app,
        PERSONA.alpha,
        "SECRETARIAT",
        (tx) => tx`select id, code, email from cdf_notifications_v13.current_persona()`,
      );
      expect([...own]).toEqual([
        { id: PERSONA.alpha, code: "SECRETARY_ALPHA", email: "secretary.alpha@example.test" },
      ]);
      const none = await asPersona(
        app,
        PERSONA.zeta,
        "SECRETARIAT",
        (tx) => tx`select id from cdf_notifications_v13.current_persona()`,
      );
      expect(none).toHaveLength(0);
    });

    it("refuses every write on the identity tables (no write grants)", async () => {
      const writes: ((tx: Tx) => Promise<unknown>)[] = [
        (tx) => tx`insert into cdf_notifications_v13.workspace (id, code, name_ar, name_en)
                   values (gen_random_uuid(), 'TEST_WS', 'x', 'x')`,
        (tx) =>
          tx`update cdf_notifications_v13.persona set display_name_en = 'x' where id = ${PERSONA.alpha}`,
        (tx) => tx`delete from cdf_notifications_v13.persona_workspace_membership`,
        (tx) => tx`update cdf_notifications_v13.role set name_en = 'x'`,
        (tx) => tx`truncate cdf_notifications_v13.workspace`,
      ];
      for (const write of writes)
        expect(await codeOf(asPersona(app, PERSONA.alpha, "SECRETARIAT", write))).toBe("42501");
    });
  });

  describe("claims MAC (ADR-014): every forged, altered or replayed context is nobody", () => {
    const alphaClaims = claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT);

    it("a hand-built context with a valid MAC is accepted (control case)", async () => {
      expect(await asRaw(app, { claims: alphaClaims, mac: "valid" }, who)).toMatchObject({
        persona: PERSONA.alpha,
        roles: ["COMMITTEE_SECRETARY"],
      });
    });

    const negatives: [string, Parameters<typeof asRaw>[1]][] = [
      ["no claims and no MAC", {}],
      ["claims without a MAC", { claims: alphaClaims }],
      ["claims with an empty MAC", { claims: alphaClaims, mac: "" }],
      ["claims with a garbage MAC", { claims: alphaClaims, mac: "not-a-mac" }],
      [
        "a MAC with padding",
        { claims: alphaClaims, mac: `${claimsMac(TEST_CLAIMS_KEY, alphaClaims, "1")}=` },
      ],
      [
        "claims rewritten after the MAC (Alpha's MAC, Delta's claims)",
        { claims: claimsText(PERSONA.delta, WORKSPACE.SECRETARIAT), mac: "valid", macOver: alphaClaims },
      ],
      ["a MAC replayed from another transaction", { claims: alphaClaims, mac: "valid", macXid: "1" }],
      [
        "version 2",
        {
          claims: JSON.stringify({
            v: 2,
            persona_id: PERSONA.alpha,
            workspace_id: WORKSPACE.SECRETARIAT,
            correlation_id: CORRELATION,
          }),
          mac: "valid",
        },
      ],
      [
        "an extra key (roles)",
        {
          claims: JSON.stringify({
            v: 1,
            persona_id: PERSONA.alpha,
            workspace_id: WORKSPACE.SECRETARIAT,
            correlation_id: CORRELATION,
            roles: ["GOVERNANCE_OFFICER"],
          }),
          mac: "valid",
        },
      ],
      [
        "a missing key",
        {
          claims: JSON.stringify({ v: 1, persona_id: PERSONA.alpha, workspace_id: WORKSPACE.SECRETARIAT }),
          mac: "valid",
        },
      ],
      [
        "an upper-case persona UUID",
        { claims: claimsText(PERSONA.alpha.toUpperCase(), WORKSPACE.SECRETARIAT), mac: "valid" },
      ],
      [
        "v as a string",
        {
          claims: JSON.stringify({
            v: "1",
            persona_id: PERSONA.alpha,
            workspace_id: WORKSPACE.SECRETARIAT,
            correlation_id: CORRELATION,
          }),
          mac: "valid",
        },
      ],
      ["malformed JSON", { claims: '{"v":1,"persona_id":', mac: "valid" }],
      ["a JSON array", { claims: `[${alphaClaims}]`, mac: "valid" }],
      ["claims longer than 512 characters", { claims: alphaClaims + " ".repeat(512), mac: "valid" }],
    ];

    it.each(negatives)("%s", async (_name, ctx) => {
      expect(await asRaw(app, ctx, who)).toEqual(NOBODY);
      expect(await asRaw(app, ctx, visible)).toEqual({
        personas: null,
        workspaces: null,
        memberships: 0,
        roles: 0,
      });
    });

    it("without an installed key even a correct MAC is nobody", async () => {
      const result = await asOwner(admin, async (tx) => {
        await tx`delete from cdf_notifications_v13.claims_key`;
        const [row] = await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`;
        const mac = claimsMac(TEST_CLAIMS_KEY, alphaClaims, row!.xid);
        await tx`select pg_catalog.set_config('request.v13.claims', ${alphaClaims}, true),
                        pg_catalog.set_config('request.v13.claims_mac', ${mac}, true)`;
        await tx.unsafe("set local role cdf_v13_user");
        return who(tx);
      });
      expect(result).toEqual(NOBODY);
    });

    it("the app login itself (no SET ROLE) cannot call the helpers at all", async () => {
      const code = await codeOf(app.begin((tx) => tx`select cdf_notifications_v13.current_persona_id()`));
      expect(code).toBe("42501");
    });
  });

  describe("TM-S4: a verified context cannot be rewritten inside its own transaction", () => {
    const deltaClaims = claimsText(PERSONA.delta, WORKSPACE.SECRETARIAT);
    const ATTACKER_KEY = new Uint8Array(32).fill(0x33);

    /** Runs `fn` in a savepoint so a refused step does not abort the transaction; returns rows or the SQLSTATE. */
    async function attempt<T>(tx: Tx, fn: (sp: Tx) => Promise<T>): Promise<T | { refused: string }> {
      try {
        return (await tx.savepoint((sp) => fn(sp as unknown as Tx))) as T;
      } catch (error) {
        return { refused: String((error as { code?: unknown }).code ?? "UNKNOWN") };
      }
    }

    const xid = async (tx: Tx) =>
      (await tx<{ xid: string }[]>`select pg_catalog.pg_current_xact_id()::text as xid`)[0]!.xid;

    it("(a) Delta's claims under Alpha's MAC, or under a MAC from the caller's own key, are nobody", async () => {
      const seen = await asPersona(app, PERSONA.alpha, "SECRETARIAT", async (tx) => {
        const before = await who(tx);
        await tx`select pg_catalog.set_config('request.v13.claims', ${deltaClaims}, true)`;
        const keptMac = { who: await who(tx), visible: await visible(tx) };
        const ownMac = claimsMac(ATTACKER_KEY, deltaClaims, await xid(tx));
        await tx`select pg_catalog.set_config('request.v13.claims_mac', ${ownMac}, true)`;
        const attackerMac = { who: await who(tx), visible: await visible(tx) };
        const [user] = await tx<{ u: string }[]>`select current_user::text as u`;
        return { before, keptMac, attackerMac, user: user!.u };
      });
      expect(seen.user).toBe("cdf_v13_user");
      expect(seen.before.persona).toBe(PERSONA.alpha);
      for (const step of [seen.keptMac, seen.attackerMac]) {
        expect(step.who).toEqual(NOBODY);
        expect(step.visible).toEqual({ personas: null, workspaces: null, memberships: 0, roles: 0 });
      }
    });

    it("(b) RESET ROLE leaves the app login, which reads nothing, and SET ROLE cdf_v13_owner is refused", async () => {
      const seen = await asPersona(app, PERSONA.alpha, "SECRETARIAT", async (tx) => {
        const ownerFromUser = await attempt(tx, (sp) => sp.unsafe("set local role cdf_v13_owner"));
        await tx.unsafe("reset role");
        const [user] = await tx<{ u: string }[]>`select current_user::text as u`;
        const reads = await attempt(tx, (sp) => visible(sp));
        const helpers = await attempt(tx, (sp) => who(sp));
        const ownerFromApp = await attempt(tx, (sp) => sp.unsafe("set local role cdf_v13_owner"));
        const ownerViaSetConfig = await attempt(
          tx,
          (sp) => sp`select pg_catalog.set_config('role', 'cdf_v13_owner', true)`,
        );
        return { ownerFromUser, user: user!.u, reads, helpers, ownerFromApp, ownerViaSetConfig };
      });
      expect(seen.ownerFromUser).toEqual({ refused: "42501" });
      expect(seen.user).toBe("cdf_v13_app");
      // The app login holds no grant on the identity tables or helpers; if it ever did, the policies (current_user =
      // 'cdf_v13_user') would still return no rows.
      expect([
        { refused: "42501" },
        { personas: null, workspaces: null, memberships: 0, roles: 0 },
      ]).toContainEqual(seen.reads);
      expect([{ refused: "42501" }, NOBODY]).toContainEqual(seen.helpers);
      expect(seen.ownerFromApp).toEqual({ refused: "42501" });
      expect(seen.ownerViaSetConfig).toEqual({ refused: "42501" });
    });
  });

  describe("database HMAC equals the app's HMAC", () => {
    it("matches a fixed vector derived with requestClaimsKey from the synthetic test secret", async () => {
      const claims = claimsText(PERSONA.alpha, WORKSPACE.SECRETARIAT);
      const pinned = "CWl1XB7B0-ixxSqprlDUkSD05mJYiecgc8q6NcenoT4";
      expect(Buffer.from(TEST_CLAIMS_KEY).toString("hex")).toBe(
        "a2bee1a0e1c614f648933bf27cb65854ba220fbfd0b45d5ccc41b0dd9bd2af87",
      );
      expect(claimsMac(TEST_CLAIMS_KEY, claims, "12345")).toBe(pinned);
      const fromDb = await asOwner(admin, async (tx) => {
        const [row] = await tx<{ mac: string }[]>`
          select pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(
                   cdf_notifications_v13._claims_hmac(pg_catalog.convert_to(${`${claims}|12345`}, 'UTF8')),
                   'base64'), '+/', '-_'), '=') as mac`;
        return row?.mac;
      });
      expect(fromDb).toBe(pinned);
    });
  });

  describe("claims key install and protection", () => {
    it("the same key again is ALREADY_INSTALLED; another key is V1409; a wrong length or NULL is V1422", async () => {
      const call = (key: Buffer | null) =>
        app.begin(async (tx) => {
          await tx`select pg_catalog.set_config('role', 'cdf_v13_user', true)`;
          const [row] = await tx<{ r: string }[]>`
            select cdf_notifications_v13.api_install_claims_key(${key}) as r`;
          return row?.r;
        });
      expect(await call(Buffer.from(TEST_CLAIMS_KEY))).toBe("ALREADY_INSTALLED");
      expect(await codeOf(call(Buffer.alloc(32, 0x33)))).toBe("V1409");
      expect(await codeOf(call(Buffer.alloc(31, 0x5a)))).toBe("V1422");
      expect(await codeOf(call(Buffer.alloc(33, 0x5a)))).toBe("V1422");
      expect(await codeOf(call(null))).toBe("V1422");
    });

    it("the install is audited once, with the key version only (no key material)", async () => {
      const rows = await asOwner(
        admin,
        (tx) =>
          tx<{ metadata: unknown; actor_persona_id: string | null }[]>`
          select metadata, actor_persona_id from cdf_notifications_v13.audit_event
           where action = 'CLAIMS_KEY_INSTALLED'`,
      );
      expect([...rows]).toEqual([{ metadata: { key_version: 1 }, actor_persona_id: null }]);
    });

    it("the request role cannot read the key or call the internal helpers", async () => {
      const refused: ((tx: Tx) => Promise<unknown>)[] = [
        (tx) => tx`select * from cdf_notifications_v13.claims_key`,
        (tx) => tx`select key_version from cdf_notifications_v13.claims_key`,
        (tx) => tx`select cdf_notifications_v13._claims_hmac('\\x00'::bytea)`,
        (tx) => tx`select cdf_notifications_v13._verified_claims()`,
        (tx) => tx`select cdf_notifications_v13._claim_uuid('persona_id')`,
        (tx) => tx`delete from cdf_notifications_v13.claims_key`,
      ];
      for (const query of refused)
        expect(await codeOf(asPersona(app, PERSONA.alpha, "SECRETARIAT", query))).toBe("42501");
    });

    it("database/hosted/reset_claims_key.sql clears the key, audits CLAIMS_KEY_CLEARED and keeps the chain valid", async () => {
      const script = readFileSync(join(process.cwd(), "database", "hosted", "reset_claims_key.sql"), "utf8");
      // The script brings its own BEGIN/COMMIT; run its body inside a transaction that is rolled back instead.
      const body = script.replace(/^begin;$/m, "").replace(/^commit;$/m, "");
      expect(body).not.toMatch(/^\s*(begin|commit);/im);
      const result = await asOwner(admin, async (tx) => {
        await tx.unsafe("reset role");
        await tx.unsafe(body);
        await tx.unsafe("set local role cdf_v13_owner");
        const [keys] = await tx<
          { n: number }[]
        >`select count(*)::int as n from cdf_notifications_v13.claims_key`;
        const audit = await tx<{ metadata: unknown }[]>`
          select metadata from cdf_notifications_v13.audit_event where action = 'CLAIMS_KEY_CLEARED'`;
        const [chain] = await tx<
          { is_valid: boolean }[]
        >`select is_valid from cdf_notifications_v13.verify_audit_chain()`;
        return { keys: keys?.n, audit: [...audit], valid: chain?.is_valid };
      });
      expect(result).toEqual({ keys: 0, audit: [{ metadata: { key_version: 1, rows: 1 } }], valid: true });
      // Rolled back: the key is still installed.
      expect(await asPersona(app, PERSONA.alpha, "SECRETARIAT", who)).toMatchObject({
        persona: PERSONA.alpha,
      });
    });

    it("the key table is deny-all for everyone but its owner (RLS on, restrictive policy, no grants)", async () => {
      const [row] = await admin<{ rls: boolean; grants: number; policies: string[] }[]>`
        select c.relrowsecurity as rls,
               (select count(*)::int from information_schema.role_table_grants g
                 where g.table_schema = 'cdf_notifications_v13' and g.table_name = 'claims_key'
                   and g.grantee <> 'cdf_v13_owner') as grants,
               (select array_agg(p.polname::text || ':' || p.polpermissive::text) from pg_catalog.pg_policy p
                 where p.polrelid = c.oid) as policies
          from pg_catalog.pg_class c
         where c.oid = 'cdf_notifications_v13.claims_key'::regclass`;
      expect(row).toEqual({ rls: true, grants: 0, policies: ["claims_key_deny_all:false"] });
    });
  });
});
