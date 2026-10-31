-- 0005_workspace_switch — V13-DB-007: the audited workspace switch (FE-002, ARCH ruling 28 Oct).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- api_switch_workspace(p_workspace_id) is called by the BFF before it re-issues the session cookie for another
-- workspace. It never changes the request's own claims (they are fixed for the transaction); it proves that the
-- verified persona may act in the target workspace and records the switch.
--   Who:     any verified persona (current_persona_id() not NULL). The current workspace claim may be invalid
--            (e.g. a membership that just expired): switching away from it is allowed, and its id is recorded as NULL.
--   Target:  an active workspace in which the persona holds an active membership now.
--   Writes:  one audit row WORKSPACE_SWITCHED, ids only: actor = persona, workspace_id = from (verified current
--            workspace or NULL), metadata {from_workspace_id, to_workspace_id}. No other table is written.
--   Refuses: no verified persona V1401; NULL, unknown, inactive or not-a-member target V1404 (one generic answer, so
--            the response never tells which workspaces exist).
-- PRODUCTION_SUBSTITUTION_REQUIRED: production derives workspace membership from the CDF corporate IdP's groups.

set local role cdf_v13_owner;

create function cdf_notifications_v13.api_switch_workspace(p_workspace_id uuid)
returns table (workspace_id uuid, workspace_code text, role_codes text[])
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_persona uuid := cdf_notifications_v13.current_persona_id();
  v_from    uuid := cdf_notifications_v13.current_workspace_id();
  v_code    text;
  v_roles   text[];
begin
  if v_persona is null then
    raise exception 'no valid context' using errcode = 'V1401';
  end if;
  if p_workspace_id is null then
    raise exception 'not found' using errcode = 'V1404';
  end if;

  select w.code, array_agg(distinct r.code order by r.code)
    into v_code, v_roles
    from cdf_notifications_v13.workspace w
    join cdf_notifications_v13.persona_workspace_membership m
      on m.workspace_id = w.id
     and m.persona_id = v_persona
     and m.valid_from <= now()
     and (m.valid_to is null or m.valid_to > now())
    join cdf_notifications_v13.role r on r.id = m.role_id
   where w.id = p_workspace_id
     and w.is_active
   group by w.code;
  if v_code is null then
    raise exception 'not found' using errcode = 'V1404';
  end if;

  perform cdf_notifications_v13._append_audit('WORKSPACE_SWITCHED', 'workspace', p_workspace_id, null,
    jsonb_build_object('from_workspace_id', v_from, 'to_workspace_id', p_workspace_id));

  workspace_id := p_workspace_id; workspace_code := v_code; role_codes := v_roles;
  return next;
end
$fn$;
comment on function cdf_notifications_v13.api_switch_workspace(uuid) is 'Command: confirm and audit a switch of the verified persona to a workspace where it holds an active membership (WORKSPACE_SWITCHED, ids only). Returns the target workspace and the persona''s roles there. V1401 without a verified persona; V1404 for any unusable target.';

grant execute on function cdf_notifications_v13.api_switch_workspace(uuid) to cdf_v13_user;

reset role;
