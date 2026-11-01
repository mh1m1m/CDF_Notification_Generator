// MembershipReader over V13's own-membership read (migration 0001): persona_workspace_membership (RLS
// membership_select_own) joined to workspace (RLS workspace_select_member) and role, inside the request security
// context, explicit columns, strict rows. current_persona_id() is NULL for an inactive persona, so it gets no row; the
// window check drops expired and future memberships. Nothing here grants anything: the switch command and every read
// re-check the membership themselves.
//
// PRODUCTION_SUBSTITUTION_REQUIRED: production derives memberships from the CDF corporate IdP's groups.
import "server-only";
import {
  ConfirmedMembershipSchema,
  type ConfirmedMembership,
  type MembershipReader,
  type RequestIdentity,
} from "@/lib/contracts";
import type { RequestContextRunner } from "@/lib/adapters/case-source/v13-records";

interface MembershipRow {
  workspace: string;
  role: string;
}
const COLUMNS = ["workspace", "role"];

export function rowToConfirmedMembership(r: MembershipRow): ConfirmedMembership {
  const keys = Object.keys(r);
  if (keys.length !== COLUMNS.length || !keys.every((k) => COLUMNS.includes(k)))
    throw new Error("memberships: unexpected columns");
  return ConfirmedMembershipSchema.parse(r);
}

export function createV13MembershipReader(run: RequestContextRunner): MembershipReader {
  return {
    async confirmedMemberships(identity: RequestIdentity): Promise<readonly ConfirmedMembership[]> {
      const rows = await run(
        identity,
        (tx) =>
          tx<MembershipRow[]>`
          select w.code as workspace, r.code as role
            from cdf_notifications_v13.persona_workspace_membership m
            join cdf_notifications_v13.workspace w on w.id = m.workspace_id
            join cdf_notifications_v13.role r on r.id = m.role_id
           where m.persona_id = cdf_notifications_v13.current_persona_id()
             and w.is_active
             and m.valid_from <= now()
             and (m.valid_to is null or m.valid_to > now())
           order by w.code, r.code`,
      );
      return rows.map(rowToConfirmedMembership);
    },
  };
}
