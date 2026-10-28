-- V13 isolation checks for the shared CDF GC Review project (ADR-012, docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md §5).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- Run as the project administrator (`postgres`) AFTER 0000_bootstrap and after every later V13 migration.
-- The whole script runs in one transaction that ends in ROLLBACK: it leaves nothing behind.
-- It never reads application rows: every probe is `select 1 … limit 0` or a catalog privilege function, and any probe that
-- unexpectedly succeeds raises inside its own sub-transaction so that its effect is undone at once.
-- It names no GC Review object: targets are enumerated from the catalog at run time.
--
-- Result: one row per check with `breaches` (must be 0), `passed` and a short `detail`. Overall verdict in the row
-- `VERDICT`: PASS only when every check has 0 breaches and 0 unexpected errors.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create temp table v13_iso (check_id text, role_name text, passed int, breaches int, unexpected int, detail text) on commit drop;

do $iso$
declare
  v_roles   text[] := array['cdf_v13_user', 'cdf_v13_app', 'cdf_v13_owner'];
  v_role    text;
  v_target  text;
  r         record;
  v_pass    int;
  v_breach  int;
  v_unexp   int;
  v_detail  text;
  v13       constant text := 'cdf_notifications_v13';
begin
  -- C00 preconditions: the three V13 roles and the V13 schema exist (otherwise nothing else is meaningful).
  if (select count(*) from pg_catalog.pg_roles where rolname = any (v_roles)) <> 3
     or not exists (select 1 from pg_catalog.pg_namespace where nspname = v13) then
    insert into v13_iso values ('C00_preconditions', '*', 0, 1, 0, 'V13 roles or schema missing: bootstrap not applied');
    return;
  end if;
  insert into v13_iso values ('C00_preconditions', '*', 1, 0, 0, 'three V13 roles and the V13 schema exist');

  -- C01 role attributes ---------------------------------------------------------------------------------------------
  foreach v_role in array v_roles loop
    select count(*) filter (where not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolreplication
                                  and rolcanlogin = (v_role = 'cdf_v13_app') and not rolinherit),
           count(*) filter (where rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication
                                  or rolcanlogin <> (v_role = 'cdf_v13_app') or rolinherit)
      into v_pass, v_breach from pg_catalog.pg_roles where rolname = v_role;
    insert into v13_iso values ('C01_role_attributes', v_role, v_pass, v_breach, 0,
      case when v_pass = 1 then 'nosuperuser nobypassrls nocreaterole nocreatedb noreplication noinherit; login only for cdf_v13_app' else 'attribute drift or role missing' end);
  end loop;

  -- C02 memberships: cdf_v13_app is a member of cdf_v13_user only (SET, no INHERIT); the others are members of nothing.
  foreach v_role in array v_roles loop
    select count(*) filter (where (v_role = 'cdf_v13_app' and g.rolname = 'cdf_v13_user' and not m.inherit_option and m.set_option and not m.admin_option)),
           count(*) filter (where not (v_role = 'cdf_v13_app' and g.rolname = 'cdf_v13_user' and not m.inherit_option and m.set_option and not m.admin_option)),
           string_agg(g.rolname, ',' order by g.rolname)
      into v_pass, v_breach, v_detail
      from pg_catalog.pg_auth_members m
      join pg_catalog.pg_roles u on u.oid = m.member
      join pg_catalog.pg_roles g on g.oid = m.roleid
     where u.rolname = v_role;
    insert into v13_iso values ('C02_memberships', v_role, coalesce(v_pass, 0), coalesce(v_breach, 0), 0,
      'member of: ' || coalesce(v_detail, 'nothing'));
  end loop;

  -- C03 who can act as a V13 role: only cdf_v13_app (as cdf_v13_user) and the administrator.
  select count(*) filter (where u.rolname in ('postgres', 'supabase_admin') or (u.rolname = 'cdf_v13_app' and g.rolname = 'cdf_v13_user')),
         count(*) filter (where not (u.rolname in ('postgres', 'supabase_admin') or (u.rolname = 'cdf_v13_app' and g.rolname = 'cdf_v13_user'))),
         string_agg(distinct u.rolname, ',')
    into v_pass, v_breach, v_detail
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles u on u.oid = m.member
    join pg_catalog.pg_roles g on g.oid = m.roleid
   where g.rolname = any (v_roles);
  insert into v13_iso values ('C03_members_of_v13_roles', '*', v_pass, v_breach, 0, 'members: ' || coalesce(v_detail, 'none'));

  -- C04 schema privileges outside V13: no USAGE (except `public`, which every role gets through PUBLIC and which holds
  -- nothing usable — C06/C07 prove that) and no CREATE anywhere outside V13; no CREATE on the database.
  foreach v_role in array v_roles loop
    select count(*) filter (where not (has_schema_privilege(v_role, n.oid, 'USAGE') and n.nspname <> 'public')
                                  and not has_schema_privilege(v_role, n.oid, 'CREATE')),
           count(*) filter (where (has_schema_privilege(v_role, n.oid, 'USAGE') and n.nspname <> 'public')
                                  or has_schema_privilege(v_role, n.oid, 'CREATE')),
           string_agg(n.nspname, ',' order by n.nspname) filter (where (has_schema_privilege(v_role, n.oid, 'USAGE') and n.nspname <> 'public')
                                  or has_schema_privilege(v_role, n.oid, 'CREATE'))
      into v_pass, v_breach, v_detail
      from pg_catalog.pg_namespace n
     where n.nspname not in (v13, 'pg_catalog', 'information_schema')
       and n.nspname not like 'pg\_toast%' and n.nspname not like 'pg\_temp%';
    if has_database_privilege(v_role, current_database(), 'CREATE') then
      v_breach := v_breach + 1; v_detail := concat_ws(',', v_detail, 'database CREATE');
    end if;
    insert into v13_iso values ('C04_foreign_schema_privileges', v_role, v_pass, v_breach, 0, coalesce('breach: ' || v_detail, 'no usage or create outside V13 (public: usage via PUBLIC only)'));
  end loop;

  -- C05 V13 schema privileges: owner owns it; only cdf_v13_user has USAGE; nobody else (PUBLIC included) has anything.
  select (case when pg_get_userbyid(nspowner) = 'cdf_v13_owner' then 1 else 0 end)
       + (case when has_schema_privilege('cdf_v13_user', oid, 'USAGE') then 1 else 0 end)
       + (case when not has_schema_privilege('cdf_v13_user', oid, 'CREATE') then 1 else 0 end)
       + (case when not has_schema_privilege('cdf_v13_app', oid, 'USAGE') and not has_schema_privilege('cdf_v13_app', oid, 'CREATE') then 1 else 0 end)
       + (case when not has_schema_privilege('public', oid, 'USAGE') and not has_schema_privilege('public', oid, 'CREATE') then 1 else 0 end)
    into v_pass from pg_catalog.pg_namespace where nspname = v13;
  insert into v13_iso values ('C05_v13_schema_acl', '*', coalesce(v_pass, 0), 5 - coalesce(v_pass, 0), 0,
    (select coalesce(nspacl::text, '<null>') from pg_catalog.pg_namespace where nspname = v13));

  -- C06 relation privileges outside V13 (catalog check over every table, view, sequence, foreign table).
  foreach v_role in array v_roles loop
    select count(*) filter (where not (has_table_privilege(v_role, c.oid, 'SELECT') or has_table_privilege(v_role, c.oid, 'INSERT')
                                    or has_table_privilege(v_role, c.oid, 'UPDATE') or has_table_privilege(v_role, c.oid, 'DELETE')
                                    or has_table_privilege(v_role, c.oid, 'TRUNCATE') or has_table_privilege(v_role, c.oid, 'REFERENCES')
                                    or has_table_privilege(v_role, c.oid, 'TRIGGER'))),
           count(*) filter (where has_table_privilege(v_role, c.oid, 'SELECT') or has_table_privilege(v_role, c.oid, 'INSERT')
                                    or has_table_privilege(v_role, c.oid, 'UPDATE') or has_table_privilege(v_role, c.oid, 'DELETE')
                                    or has_table_privilege(v_role, c.oid, 'TRUNCATE') or has_table_privilege(v_role, c.oid, 'REFERENCES')
                                    or has_table_privilege(v_role, c.oid, 'TRIGGER'))
      into v_pass, v_breach
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
       and n.nspname not in (v13, 'pg_catalog', 'information_schema')
       and n.nspname not like 'pg\_toast%' and n.nspname not like 'pg\_temp%';
    insert into v13_iso values ('C06_foreign_relation_privileges', v_role, v_pass, v_breach, 0, 'relations checked outside V13');
  end loop;

  -- C07 callable functions outside V13 (EXECUTE and USAGE on the function's schema). Never calls a function.
  foreach v_role in array v_roles loop
    select count(*) filter (where not (has_schema_privilege(v_role, n.oid, 'USAGE') and has_function_privilege(v_role, p.oid, 'EXECUTE'))),
           count(*) filter (where has_schema_privilege(v_role, n.oid, 'USAGE') and has_function_privilege(v_role, p.oid, 'EXECUTE'))
      into v_pass, v_breach
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in (v13, 'pg_catalog', 'information_schema')
       and n.nspname not like 'pg\_toast%' and n.nspname not like 'pg\_temp%';
    insert into v13_iso values ('C07_foreign_callable_functions', v_role, v_pass, v_breach, 0, 'functions checked outside V13 (privilege check only, nothing called)');
  end loop;

  -- C08 live probes: as each V13 role, `select 1 from <every foreign relation> limit 0` must fail with 42501.
  foreach v_role in array v_roles loop
    v_pass := 0; v_breach := 0; v_unexp := 0; v_detail := null;
    execute format('set local role %I', v_role);
    for r in
      select n.nspname, c.relname
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p', 'v', 'm', 'f')
         and n.nspname not in (v13, 'pg_catalog', 'information_schema')
         and n.nspname not like 'pg\_toast%' and n.nspname not like 'pg\_temp%'
    loop
      begin
        execute format('select 1 from %I.%I limit 0', r.nspname, r.relname);
        raise exception using errcode = 'V1301', message = 'probe unexpectedly succeeded';
      exception
        when insufficient_privilege then v_pass := v_pass + 1;
        when sqlstate 'V1301' then v_breach := v_breach + 1; v_detail := concat_ws(',', v_detail, r.nspname || '.' || r.relname);
        when others then v_unexp := v_unexp + 1; v_detail := concat_ws(',', v_detail, sqlstate);
      end;
    end loop;
    execute 'reset role';
    insert into v13_iso values ('C08_live_select_probes', v_role, v_pass, v_breach, v_unexp, coalesce(left(v_detail, 300), 'every probe refused with 42501'));
  end loop;

  -- (SET ROLE escalation is checked against the SESSION user, so it is meaningless from this admin session. It is
  --  proven from the app's own login instead: app/api/health/isolation/route.ts and tests/integration, plan §5.3.)

  -- C09 object creation outside V13: CREATE SCHEMA and CREATE TABLE public.* must fail for every V13 role.
  foreach v_role in array v_roles loop
    v_pass := 0; v_breach := 0; v_unexp := 0; v_detail := null;
    execute format('set local role %I', v_role);
    foreach v_target in array array['create schema v13_isolation_probe', 'create table public.v13_isolation_probe (x int)'] loop
      begin
        execute v_target;
        raise exception using errcode = 'V1301', message = 'create unexpectedly succeeded';
      exception
        when insufficient_privilege then v_pass := v_pass + 1;
        when sqlstate 'V1301' then v_breach := v_breach + 1; v_detail := concat_ws(',', v_detail, v_target);
        when others then v_unexp := v_unexp + 1; v_detail := concat_ws(',', v_detail, sqlstate);
      end;
    end loop;
    execute 'reset role';
    insert into v13_iso values ('C09_foreign_create', v_role, v_pass, v_breach, v_unexp, coalesce(v_detail, 'create schema / create table in public refused'));
  end loop;

  -- C10 V13 tables: RLS enabled on every table, owned by cdf_v13_owner, no privilege for PUBLIC or any non-V13 role.
  select count(*) filter (where c.relrowsecurity and pg_get_userbyid(c.relowner) = 'cdf_v13_owner'
                                and coalesce(c.relacl::text, '') !~ '(^|[{,])(=|anon=|authenticated=|service_role=|cdf_app=)'),
         count(*) filter (where not (c.relrowsecurity and pg_get_userbyid(c.relowner) = 'cdf_v13_owner'
                                and coalesce(c.relacl::text, '') !~ '(^|[{,])(=|anon=|authenticated=|service_role=|cdf_app=)'))
    into v_pass, v_breach
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = v13 and c.relkind in ('r', 'p');
  insert into v13_iso values ('C10_v13_tables_rls_owner_acl', '*', v_pass, v_breach, 0, 'V13 tables checked');

  -- C11 V13 functions: owned by cdf_v13_owner, not executable by PUBLIC, SECURITY DEFINER only with search_path=''.
  select count(*) filter (where pg_get_userbyid(p.proowner) = 'cdf_v13_owner' and not has_function_privilege('public', p.oid, 'EXECUTE')
                                and (not p.prosecdef or 'search_path=""' = any (coalesce(p.proconfig, '{}')) or 'search_path=' = any (coalesce(p.proconfig, '{}')))),
         count(*) filter (where not (pg_get_userbyid(p.proowner) = 'cdf_v13_owner' and not has_function_privilege('public', p.oid, 'EXECUTE')
                                and (not p.prosecdef or 'search_path=""' = any (coalesce(p.proconfig, '{}')) or 'search_path=' = any (coalesce(p.proconfig, '{}')))))
    into v_pass, v_breach
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = v13;
  insert into v13_iso values ('C11_v13_functions', '*', v_pass, v_breach, 0, 'V13 functions checked');

  -- C12 the V13 schema is not reachable by GC Review and Supabase API roles.
  select count(*) filter (where not has_schema_privilege(rolname, v13, 'USAGE')),
         count(*) filter (where has_schema_privilege(rolname, v13, 'USAGE'))
    into v_pass, v_breach
    from pg_catalog.pg_roles
   where rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'cdf_app', 'dashboard_user', 'pgbouncer');
  insert into v13_iso values ('C12_api_roles_cannot_reach_v13', '*', v_pass, v_breach, 0, 'anon, authenticated, service_role, authenticator, cdf_app, dashboard_user, pgbouncer');
end
$iso$;

select check_id, role_name, passed, breaches, unexpected, detail from v13_iso
union all
select 'VERDICT', '*', count(*)::int, sum(breaches)::int, sum(unexpected)::int,
       case when sum(breaches) = 0 and sum(unexpected) = 0 then 'PASS' else 'FAIL' end
  from v13_iso
order by 1, 2;

rollback;
