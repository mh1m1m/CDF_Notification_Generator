-- V13 post-apply hardening checks (V13-SEC-004). Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF
-- production.
--
-- V13's own hardening, checked after every hosted V13 migration (docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md §5). Foreign
-- isolation stays in isolation_checks.sql; this file checks the V13 schema itself. It is run by the Chief Architect as the
-- project administrator, who becomes cdf_v13_owner for the run (bootstrap membership, SET only), so the owner-only
-- objects below can be counted and verified.
--
-- One READ ONLY transaction that ends in ROLLBACK. It reads catalogue metadata only. The three exceptions read no row
-- content: the number of rows in claims_key, the verdict of verify_audit_chain(), and the latest policy_version row
-- (a version code and a fingerprint).
--
-- Output: one row per check (check_id | detail | breaches), then VERDICT: PASS only when every check has 0 breaches.
--   P01 RLS enabled on every V13 table
--   P02 no write privilege on any V13 table for cdf_v13_app, cdf_v13_user or PUBLIC
--   P03 SECURITY DEFINER functions are exactly the allow-list below (a new definer fails until it is listed;
--       tests/security/db/post-apply-checks.spec.ts keeps the list equal to the migrations)
--   P04 every V13 function pins search_path = ''
--   P05 no V13 privilege for PUBLIC or the Supabase API roles present (has_*_privilege probes)
--   P06 claims_key: unreadable by cdf_v13_app and cdf_v13_user, deny-all policy present, at most one row
--   P07 the audit chain verifies
--   P08 V13 role memberships are exactly 0000_bootstrap's: cdf_v13_app in cdf_v13_user (SET only), the administrator
--       SET-only on the three roles, and, on a cluster whose administrator is not a superuser (hosted), the automatic
--       ADMIN-only grant PostgreSQL gives the administrator as the roles' creator (granted by the bootstrap superuser;
--       the administrator cannot revoke it).
--   P09 every ACL on a V13 object names only the three V13 roles as grantee: schema, relations (tables, views,
--       sequences), columns, functions, and default ACLs (aclexplode; a NULL ACL is read as its built-in default, so a
--       function with no ACL counts as PUBLIC EXECUTE). PUBLIC or any other role is a breach. Predefined roles such as
--       pg_read_all_data pass has_*_privilege by design on hosted and hold no V13 grant; they are not ACL grantees,
--       so P09 does not report them, and P08 proves no V13 role belongs to one.
--   P10 the access policy is the recorded one: _policy_fingerprint() on this server equals the fingerprint of the highest
--       policy_version row (V13-DB-020, REQ-AUD-005). A migration that changes a policy, an RLS flag, an ACL, a trigger's
--       state or a function without recording a new version fails here. Needs migration 0012; after 0006–0011 run the
--       file as it stood before P10.
-- The section between BEGIN CHECKS and END CHECKS is one SELECT; the local test runs it verbatim.

begin read only;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
set local role cdf_v13_owner;

-- BEGIN CHECKS
with
v13 as (select oid from pg_catalog.pg_namespace where nspname = 'cdf_notifications_v13'),
tbl as (
  select c.oid, c.relname, c.relrowsecurity
    from pg_catalog.pg_class c
   where c.relnamespace = (select oid from v13) and c.relkind in ('r', 'p')),
fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig
    from pg_catalog.pg_proc p
   where p.pronamespace = (select oid from v13)),
-- P03 allow-list: every SECURITY DEFINER function of the V13 migrations, by name.
definer_allow (name) as (values
  ('_api_create_notification_draft_impl'), ('_api_install_claims_key_impl'), ('_api_switch_workspace_impl'),
  ('_api_update_task_status_impl'), ('_append_audit_refused'),
  ('_append_audit'), ('_case_owning_visibility'), ('_claim_uuid'), ('_claims_hmac'), ('_is_colleague'),
  ('_verified_claims'), ('api_create_notification_draft'), ('api_install_claims_key'), ('api_switch_workspace'),
  ('api_update_task_status'), ('can_access_case'), ('claims_key_state'), ('current_correlation_id'),
  ('current_persona'), ('current_persona_id'), ('current_role_codes'), ('current_workspace_id'), ('has_role'),
  ('is_assigned_to_case'), ('verify_audit_chain')),
api_roles as (
  select 'public'::text as rolname
  union all
  select r.rolname::text from pg_catalog.pg_roles r
   where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'dashboard_user', 'pgbouncer',
                       'supabase_auth_admin', 'supabase_storage_admin', 'cdf_app')),
v13_roles (rolname) as (values ('cdf_v13_owner'), ('cdf_v13_app'), ('cdf_v13_user')),
acl as (
  select 'schema' as kind, n.nspname::text as object, a.grantee, a.privilege_type
    from pg_catalog.pg_namespace n,
         lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n'::"char", n.nspowner))) a
   where n.oid = (select oid from v13)
  union all
  select 'relation', c.relname::text, a.grantee, a.privilege_type
    from pg_catalog.pg_class c,
         lateral pg_catalog.aclexplode(coalesce(c.relacl,
                   pg_catalog.acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
   where c.relnamespace = (select oid from v13) and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  union all
  select 'column', c.relname || '.' || att.attname, a.grantee, a.privilege_type
    from pg_catalog.pg_attribute att
    join pg_catalog.pg_class c on c.oid = att.attrelid,
         lateral pg_catalog.aclexplode(att.attacl) a
   where c.relnamespace = (select oid from v13) and att.attacl is not null and not att.attisdropped
  union all
  select 'function', p.proname::text, a.grantee, a.privilege_type
    from pg_catalog.pg_proc p,
         lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))) a
   where p.pronamespace = (select oid from v13)
  union all
  select 'default ACL', pg_catalog.pg_get_userbyid(d.defaclrole) || ' ' || d.defaclobjtype::text, a.grantee, a.privilege_type
    from pg_catalog.pg_default_acl d,
         lateral pg_catalog.aclexplode(d.defaclacl) a
   where d.defaclnamespace = (select oid from v13)
      or pg_catalog.pg_get_userbyid(d.defaclrole) in (select rolname from v13_roles)),
checks (check_id, detail, breaches) as (
  -- P00: nothing below means anything without the schema and the roles.
  select 'P00_preconditions',
         'V13 schema and three V13 roles present',
         case when exists (select 1 from v13)
                   and (select count(*) from pg_catalog.pg_roles where rolname in (select rolname from v13_roles)) = 3
              then 0 else 1 end
  union all
  select 'P01_rls_enabled',
         coalesce('RLS off: ' || string_agg(t.relname, ', ' order by t.relname) filter (where not t.relrowsecurity),
                  count(*) || ' tables, RLS on every one'),
         count(*) filter (where not t.relrowsecurity)
    from tbl t
  union all
  select 'P02_no_table_writes',
         coalesce('write grants: ' || string_agg(distinct g.who || ' ' || g.priv || ' ' || g.relname, ', '),
                  'no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER for cdf_v13_app, cdf_v13_user, PUBLIC'),
         count(g.*)
    from (select r.who, p.priv, t.relname
            from tbl t
           cross join (values ('cdf_v13_app'), ('cdf_v13_user'), ('public')) r (who)
           cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (priv)
           where pg_catalog.has_table_privilege(r.who, t.oid, p.priv)) g
  union all
  select 'P03_definer_allow_list',
         coalesce('unlisted definer: ' || string_agg(f.proname, ', ' order by f.proname) filter (where a.name is null), '')
           || coalesce(' listed but not definer: '
                       || (select string_agg(a2.name, ', ' order by a2.name) from definer_allow a2
                            where not exists (select 1 from fn f2 where f2.proname = a2.name and f2.prosecdef)), '')
           || case when count(*) filter (where a.name is null) = 0
                        and not exists (select 1 from definer_allow a2
                                         where not exists (select 1 from fn f2 where f2.proname = a2.name and f2.prosecdef))
                   then count(*) || ' definers, all on the allow-list' else '' end,
         count(*) filter (where a.name is null)
           + (select count(*) from definer_allow a2
               where not exists (select 1 from fn f2 where f2.proname = a2.name and f2.prosecdef))
    from fn f left join definer_allow a on a.name = f.proname
   where f.prosecdef
  union all
  select 'P04_search_path_pinned',
         coalesce('search_path not pinned: '
                  || string_agg(f.proname, ', ' order by f.proname)
                       filter (where not ('search_path=""' = any (coalesce(f.proconfig, '{}'))
                                          or 'search_path=' = any (coalesce(f.proconfig, '{}')))),
                  count(*) || ' functions, search_path pinned to empty'),
         count(*) filter (where not ('search_path=""' = any (coalesce(f.proconfig, '{}'))
                                     or 'search_path=' = any (coalesce(f.proconfig, '{}'))))
    from fn f
  union all
  select 'P05_no_api_role_privileges',
         coalesce('privileges: ' || string_agg(distinct x.who || ' ' || x.what, ', '),
                  'PUBLIC and ' || ((select count(*) from api_roles) - 1)
                    || ' API role(s) present: no schema, table, sequence or function privilege'),
         count(x.*)
    from (select r.rolname as who, 'USAGE/CREATE on schema' as what
            from api_roles r
           where pg_catalog.has_schema_privilege(r.rolname, (select oid from v13), 'USAGE')
              or pg_catalog.has_schema_privilege(r.rolname, (select oid from v13), 'CREATE')
          union all
          select r.rolname, p.priv || ' ' || c.relname
            from api_roles r
           cross join pg_catalog.pg_class c
           cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (priv)
           where c.relnamespace = (select oid from v13) and c.relkind in ('r', 'p', 'v', 'm', 'f')
             and pg_catalog.has_table_privilege(r.rolname, c.oid, p.priv)
          union all
          select r.rolname, 'USAGE ' || c.relname
            from api_roles r
           cross join pg_catalog.pg_class c
           where c.relnamespace = (select oid from v13) and c.relkind = 'S'
             and (pg_catalog.has_sequence_privilege(r.rolname, c.oid, 'USAGE')
                  or pg_catalog.has_sequence_privilege(r.rolname, c.oid, 'SELECT'))
          union all
          select r.rolname, 'EXECUTE ' || f.proname
            from api_roles r cross join fn f
           where pg_catalog.has_function_privilege(r.rolname, f.oid, 'EXECUTE')) x
  union all
  select 'P06_claims_key_protected',
         case when k.oid is null then 'claims_key missing'
              else concat_ws(' / ',
                     case when pg_catalog.has_table_privilege('cdf_v13_app', k.oid, 'SELECT') then 'cdf_v13_app can read' end,
                     case when pg_catalog.has_table_privilege('cdf_v13_user', k.oid, 'SELECT') then 'cdf_v13_user can read' end,
                     case when pg_catalog.has_table_privilege('public', k.oid, 'SELECT') then 'PUBLIC can read' end,
                     case when not exists (select 1 from pg_catalog.pg_policy pol
                                            where pol.polrelid = k.oid and not pol.polpermissive
                                              and pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) = 'false')
                          then 'restrictive deny-all policy missing' end,
                     case when (select count(*) from cdf_notifications_v13.claims_key) > 1 then 'more than one key row' end,
                     'rows: ' || (select count(*) from cdf_notifications_v13.claims_key))
         end,
         case when k.oid is null then 1
              else (pg_catalog.has_table_privilege('cdf_v13_app', k.oid, 'SELECT'))::int
                 + (pg_catalog.has_table_privilege('cdf_v13_user', k.oid, 'SELECT'))::int
                 + (pg_catalog.has_table_privilege('public', k.oid, 'SELECT'))::int
                 + (not exists (select 1 from pg_catalog.pg_policy pol
                                 where pol.polrelid = k.oid and not pol.polpermissive
                                   and pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) = 'false'))::int
                 + ((select count(*) from cdf_notifications_v13.claims_key) > 1)::int
         end
    from (select (select c.oid from tbl c where c.relname = 'claims_key') as oid) k
  union all
  select 'P07_audit_chain_valid',
         'rows checked: ' || v.rows_checked || coalesce(', first broken seq: ' || v.first_broken_seq, ''),
         case when v.is_valid then 0 else 1 end
    from cdf_notifications_v13.verify_audit_chain() v
  union all
  select 'P08_memberships',
         coalesce('unexpected: ' || string_agg(m.member || ' in ' || m.grp
                                               || case when m.admin_option then ' (admin)' else '' end
                                               || case when m.inherit_option then ' (inherit)' else '' end
                                               || case when not m.set_option then ' (no set)' else '' end, ', '
                                               order by m.grp, m.member)
                    filter (where not m.expected),
                  'cdf_v13_app in cdf_v13_user (SET only), administrator SET-only on the V13 roles (plus the creator ADMIN grant when not a superuser), nothing else'),
         count(*) filter (where not m.expected)
           + case when exists (select 1 from pg_catalog.pg_auth_members am
                                 join pg_catalog.pg_roles u on u.oid = am.member
                                 join pg_catalog.pg_roles g on g.oid = am.roleid
                                where u.rolname = 'cdf_v13_app' and g.rolname = 'cdf_v13_user')
                  then 0 else 1 end
    from (select u.rolname::text as member, g.rolname::text as grp, am.admin_option, am.inherit_option, am.set_option,
                 (not am.admin_option and not am.inherit_option and am.set_option
                  and ((u.rolname = 'cdf_v13_app' and g.rolname = 'cdf_v13_user')
                       or (u.rolname in ('postgres', 'supabase_admin')
                           and g.rolname in (select rolname from v13_roles))))
                 -- The creator's automatic grant on a non-superuser administrator (hosted): ADMIN only, from a superuser.
                 or (u.rolname in ('postgres', 'supabase_admin') and not u.rolsuper
                     and g.rolname in (select rolname from v13_roles)
                     and am.admin_option and not am.inherit_option and not am.set_option
                     and gr.rolsuper) as expected
            from pg_catalog.pg_auth_members am
            join pg_catalog.pg_roles u on u.oid = am.member
            join pg_catalog.pg_roles g on g.oid = am.roleid
            join pg_catalog.pg_roles gr on gr.oid = am.grantor
           where u.rolname in (select rolname from v13_roles) or g.rolname in (select rolname from v13_roles)) m
  union all
  select 'P09_acl_grantees_v13_only',
         coalesce('foreign grantees: '
                  || string_agg(distinct case when x.grantee = 0 then 'PUBLIC'
                                              else pg_catalog.pg_get_userbyid(x.grantee) end
                                         || ' ' || x.privilege_type || ' on ' || x.kind || ' ' || x.object, ', '),
                  (select count(*) from acl) || ' ACL entries, every grantee a V13 role'),
         count(x.*)
    from (select * from acl
           where acl.grantee = 0
              or pg_catalog.pg_get_userbyid(acl.grantee) not in (select rolname from v13_roles)) x
  union all
  select 'P10_policy_version_current',
         case when pv.version is null then 'no policy_version row'
              when pv.fingerprint = f.live then 'live access policy = ' || pv.version
              else 'access policy changed since ' || pv.version || ' without a new policy_version row' end,
         case when pv.version is not null and pv.fingerprint = f.live then 0 else 1 end
    from (select cdf_notifications_v13._policy_fingerprint() as live) f
    left join (select v.version, v.fingerprint
                 from cdf_notifications_v13.policy_version v
                order by v.version desc
                limit 1) pv on true
)
select check_id, detail, breaches::int as breaches from checks
union all
select 'VERDICT',
       case when sum(breaches) = 0 then 'PASS' else 'FAIL' end,
       sum(breaches)::int
  from checks
order by 1;
-- END CHECKS

rollback;
