-- ROLLBACK of everything V13 created on the shared CDF GC Review project (ADR-012, plan §7).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- EXECUTE ONLY ON THE OWNER'S EXPLICIT WORD. It deletes the V13 schema with all V13 synthetic records and the three
-- V13 roles. It touches nothing else: it refuses to run if any object outside cdf_notifications_v13 depends on a V13
-- object, if a V13 role owns or holds a privilege on anything outside the V13 schema, or if the schema holds anything
-- not owned by cdf_v13_owner. The drop itself runs AS cdf_v13_owner, which owns no GC Review object, so even a missed
-- dependency would make the drop fail rather than cascade into GC Review.
--
-- After it commits: run foreign_objects_fingerprint.sql; every category hash must equal the BEFORE baseline
-- (docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md §3). Any difference is an incident (plan §8).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $guard$
declare
  v13 constant text := 'cdf_notifications_v13';
  n_dep int; n_shdep int; n_foreign_owned int;
begin
  if not exists (select 1 from pg_catalog.pg_namespace where nspname = v13) then
    raise notice 'V13 schema absent: only roles (if any) will be removed';
  else
    -- 1. No object outside the V13 schema depends on a V13 table, view, sequence, function or type.
    with v13_objs as (
      select 'pg_catalog.pg_class'::regclass as classid, c.oid from pg_catalog.pg_class c where c.relnamespace = v13::regnamespace
      union all select 'pg_catalog.pg_proc'::regclass, p.oid from pg_catalog.pg_proc p where p.pronamespace = v13::regnamespace
      union all select 'pg_catalog.pg_type'::regclass, t.oid from pg_catalog.pg_type t where t.typnamespace = v13::regnamespace
    )
    select count(*) into n_dep
      from pg_catalog.pg_depend d
      join v13_objs o on o.classid = d.refclassid and o.oid = d.refobjid
     where d.deptype in ('n', 'a')
       and (case d.classid
              when 'pg_catalog.pg_class'::regclass      then (select c.relnamespace from pg_catalog.pg_class c where c.oid = d.objid)
              when 'pg_catalog.pg_proc'::regclass       then (select p.pronamespace from pg_catalog.pg_proc p where p.oid = d.objid)
              when 'pg_catalog.pg_type'::regclass       then (select t.typnamespace from pg_catalog.pg_type t where t.oid = d.objid)
              when 'pg_catalog.pg_constraint'::regclass then (select k.connamespace from pg_catalog.pg_constraint k where k.oid = d.objid)
              when 'pg_catalog.pg_attrdef'::regclass    then (select c.relnamespace from pg_catalog.pg_attrdef a join pg_catalog.pg_class c on c.oid = a.adrelid where a.oid = d.objid)
              when 'pg_catalog.pg_trigger'::regclass    then (select c.relnamespace from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid where t.oid = d.objid)
              when 'pg_catalog.pg_policy'::regclass     then (select c.relnamespace from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid where p.oid = d.objid)
              when 'pg_catalog.pg_rewrite'::regclass    then (select c.relnamespace from pg_catalog.pg_rewrite r join pg_catalog.pg_class c on c.oid = r.ev_class where r.oid = d.objid)
              else null  -- any other dependent kind (publication, cast, …) counts as foreign: refuse and inspect
            end) is distinct from v13::regnamespace::oid;
    if n_dep > 0 then
      raise exception 'ROLLBACK REFUSED: % object(s) outside % depend on V13 objects; inspect pg_depend', n_dep, v13;
    end if;

    -- 2. Everything in the V13 schema is owned by cdf_v13_owner.
    if exists (select 1 from pg_catalog.pg_class c where c.relnamespace = v13::regnamespace and pg_catalog.pg_get_userbyid(c.relowner) <> 'cdf_v13_owner')
       or exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = v13::regnamespace and pg_catalog.pg_get_userbyid(p.proowner) <> 'cdf_v13_owner') then
      raise exception 'ROLLBACK REFUSED: the V13 schema holds an object not owned by cdf_v13_owner';
    end if;
  end if;

  -- 3. V13 roles own nothing and hold no privilege outside the V13 schema (pg_shdepend: o = owner, a = ACL).
  select count(*) into n_shdep
    from pg_catalog.pg_shdepend s
    join pg_catalog.pg_roles r on r.oid = s.refobjid and s.refclassid = 'pg_catalog.pg_authid'::regclass
    cross join lateral pg_catalog.pg_identify_object(s.classid, s.objid, s.objsubid) i
   where r.rolname in ('cdf_v13_owner', 'cdf_v13_app', 'cdf_v13_user')
     and s.deptype in ('o', 'a')
     and s.dbid in (0, (select oid from pg_catalog.pg_database where datname = current_database()))
     and coalesce(i.schema, '') <> v13
     and not (i.type = 'schema' and i.identity = v13)
     and i.type <> 'default acl';  -- the role's own default-ACL rows are reset in step 5
  if n_shdep > 0 then
    raise exception 'ROLLBACK REFUSED: V13 roles own or hold privileges on % object(s) outside %', n_shdep, v13;
  end if;
end
$guard$;

-- 4. Drop the schema as its owner. CASCADE removes only V13 objects: cdf_v13_owner owns nothing else.
do $drop$
begin
  if exists (select 1 from pg_catalog.pg_namespace where nspname = 'cdf_notifications_v13') then
    execute 'set local role cdf_v13_owner';
    execute 'drop schema cdf_notifications_v13 cascade';
    execute 'reset role';
  end if;
end
$drop$;

-- 5. Restore the built-in default privileges of cdf_v13_owner, which removes its pg_default_acl rows.
do $dacl$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'cdf_v13_owner') then
    execute 'set local role cdf_v13_owner';
    execute 'alter default privileges for role cdf_v13_owner grant execute on functions to public';
    execute 'alter default privileges for role cdf_v13_owner grant usage on types to public';
    execute 'reset role';
  end if;
end
$dacl$;

-- 6. Drop the roles (their memberships go with them). DROP ROLE fails if a role still owns or holds anything.
drop role if exists cdf_v13_app;
drop role if exists cdf_v13_user;
drop role if exists cdf_v13_owner;

-- 7. Verify.
do $verify$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname like 'cdf\_v13\_%')
     or exists (select 1 from pg_catalog.pg_namespace where nspname = 'cdf_notifications_v13')
     or exists (select 1 from pg_catalog.pg_default_acl d where pg_catalog.pg_get_userbyid(d.defaclrole) like 'cdf\_v13\_%') then
    raise exception 'ROLLBACK INCOMPLETE: V13 objects remain';
  end if;
end
$verify$;

select 'V13 rollback complete; now run foreign_objects_fingerprint.sql and compare with the BEFORE baseline' as result;
commit;
