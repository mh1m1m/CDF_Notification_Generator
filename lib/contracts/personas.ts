// SYNTHETIC personas for the prototype persona sign-in, mirrored from the database seed
// (database/seed/0001_m1_synthetic.sql: cdf_notifications_v13.persona and persona_workspace_membership). The database
// is the authority: it re-checks every request's claims against these rows (persona active, membership active), so a
// persona the application accepts can still be refused there. That is what the two negative-test personas exercise:
//   - Secretary Epsilon: her only membership expired on 2026-06-30;
//   - Persona Zeta: the persona is inactive.
// They are never listed on the sign-in page and persona sign-in refuses them; tests mint their sessions directly.
//
// Display names live in lib/i18n (namespace "persona") under `name_key`.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production identities come from the CDF corporate identity provider (OIDC) and
// role assignments from CDF's authorisation registry; persona sign-in does not exist there.
import { z } from "zod";
import { PersonaIdSchema, type PersonaId } from "./ids";
import { RoleCodeSchema, WorkspaceCodeSchema, type RoleCode, type WorkspaceCode } from "./workspaces";

const MembershipSchema = z.strictObject({ workspace: WorkspaceCodeSchema, role: RoleCodeSchema });

const PersonaSchema = z.strictObject({
  persona_id: PersonaIdSchema,
  /** cdf_notifications_v13.persona.code */
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,40}$/),
  /** Stable kebab-case handle, used in data-testid="persona-<slug>". */
  slug: z.string().regex(/^[a-z]+(-[a-z]+)+$/),
  /** i18n key of the display name. */
  name_key: z.string().regex(/^persona\.name\.[a-z][A-Za-z0-9]*$/),
  /** Workspace × role memberships as seeded. The first one is the workspace that becomes active at sign-in. */
  memberships: z
    .array(MembershipSchema)
    .min(1)
    .refine(
      (ms) => new Set(ms.map((m) => `${m.workspace}/${m.role}`)).size === ms.length,
      "memberships must be unique",
    )
    .readonly(),
  /** True for personas that exist only to prove the database refuses them. */
  negative_test: z.boolean(),
});

export interface PersonaMembership {
  readonly workspace: WorkspaceCode;
  readonly role: RoleCode;
}

export interface Persona {
  readonly persona_id: PersonaId;
  readonly code: string;
  readonly slug: string;
  readonly name_key: string;
  readonly memberships: readonly PersonaMembership[];
  readonly negative_test: boolean;
}

const definePersona = (persona: z.input<typeof PersonaSchema>): Persona =>
  Object.freeze(PersonaSchema.parse(persona));

export const PERSONAS: readonly Persona[] = Object.freeze([
  definePersona({
    persona_id: "0b000000-0000-4000-8000-000000000001",
    code: "SECRETARY_ALPHA",
    slug: "secretary-alpha",
    name_key: "persona.name.secretaryAlpha",
    memberships: [{ workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY" }],
    negative_test: false,
  }),
  definePersona({
    persona_id: "0b000000-0000-4000-8000-000000000002",
    code: "INVESTIGATOR_BETA",
    slug: "investigator-beta",
    name_key: "persona.name.investigatorBeta",
    memberships: [{ workspace: "INVESTIGATIONS", role: "INVESTIGATOR" }],
    negative_test: false,
  }),
  definePersona({
    persona_id: "0b000000-0000-4000-8000-000000000003",
    code: "INVESTIGATOR_GAMMA",
    slug: "investigator-gamma",
    name_key: "persona.name.investigatorGamma",
    memberships: [{ workspace: "INVESTIGATIONS", role: "INVESTIGATOR" }],
    negative_test: false,
  }),
  definePersona({
    persona_id: "0b000000-0000-4000-8000-000000000004",
    code: "GOVERNANCE_DELTA",
    slug: "governance-officer-delta",
    name_key: "persona.name.governanceOfficerDelta",
    memberships: [
      { workspace: "GOVERNANCE", role: "GOVERNANCE_OFFICER" },
      { workspace: "SECRETARIAT", role: "GOVERNANCE_OFFICER" },
    ],
    negative_test: false,
  }),
  definePersona({
    persona_id: "0b000000-0000-4000-8000-000000000005",
    code: "SECRETARY_EPSILON",
    slug: "secretary-epsilon",
    name_key: "persona.name.secretaryEpsilon",
    memberships: [{ workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY" }],
    negative_test: true,
  }),
  definePersona({
    persona_id: "0b000000-0000-4000-8000-000000000006",
    code: "PERSONA_ZETA",
    slug: "persona-zeta",
    name_key: "persona.name.personaZeta",
    memberships: [{ workspace: "SECRETARIAT", role: "COMMITTEE_SECRETARY" }],
    negative_test: true,
  }),
]);

/** The personas offered on the sign-in page (negative-test personas excluded). */
export const SIGN_IN_PERSONAS: readonly Persona[] = Object.freeze(PERSONAS.filter((p) => !p.negative_test));

/** The persona with this id, or null. Input is untrusted: anything that is not a known persona id yields null. */
export function findPersona(personaId: unknown): Persona | null {
  if (typeof personaId !== "string") return null;
  return PERSONAS.find((p) => p.persona_id === personaId) ?? null;
}

/** The workspace that becomes active when the persona signs in (its first membership). */
export function signInWorkspace(persona: Persona): WorkspaceCode {
  return (persona.memberships[0] as PersonaMembership).workspace;
}

/** Workspaces the persona holds a membership in, in membership order, without duplicates (workspace switcher). */
export function workspacesOf(persona: Persona): readonly WorkspaceCode[] {
  return [...new Set(persona.memberships.map((m) => m.workspace))];
}

/** The persona's roles in one workspace (empty when it holds no membership there). */
export function rolesIn(persona: Persona, workspace: WorkspaceCode): readonly RoleCode[] {
  return [...new Set(persona.memberships.filter((m) => m.workspace === workspace).map((m) => m.role))];
}
