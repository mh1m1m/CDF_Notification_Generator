// Synthetic identities and sessions for FE unit tests (persona registry ids, lib/contracts).
import type { CorrelationId, RequestIdentity } from "@/lib/contracts";
import { findPersona } from "@/lib/contracts";
import type { Session } from "@/lib/auth/session";
import type { RequestContext } from "@/lib/server/context";

export const ALPHA = "0b000000-0000-4000-8000-000000000001";
export const BETA = "0b000000-0000-4000-8000-000000000002";
export const GAMMA = "0b000000-0000-4000-8000-000000000003";
export const DELTA = "0b000000-0000-4000-8000-000000000004";
export const EPSILON = "0b000000-0000-4000-8000-000000000005";

export const id = (persona_id: string, active_workspace: string, roles: string[]) =>
  ({ persona_id, active_workspace, roles }) as unknown as RequestIdentity;

export const SECRETARY = id(ALPHA, "SECRETARIAT", ["COMMITTEE_SECRETARY"]);
export const INVESTIGATOR_BETA = id(BETA, "INVESTIGATIONS", ["INVESTIGATOR"]);
export const INVESTIGATOR_GAMMA = id(GAMMA, "INVESTIGATIONS", ["INVESTIGATOR"]);
export const GOVERNANCE = id(DELTA, "GOVERNANCE", ["GOVERNANCE_OFFICER"]);
export const GOVERNANCE_AT_SECRETARIAT = id(DELTA, "SECRETARIAT", ["GOVERNANCE_OFFICER"]);

export const CORRELATION = "11111111-1111-4111-8111-111111111111" as CorrelationId;

export function ctxFor(identity: RequestIdentity): RequestContext {
  const persona = findPersona(identity.persona_id);
  if (!persona) throw new Error("test persona missing");
  const session = { persona, identity, claims: {} } as unknown as Session;
  return { session, identity, correlationId: CORRELATION };
}
