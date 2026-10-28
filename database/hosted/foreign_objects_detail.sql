-- Per-object detail for the fingerprint of every database object that does NOT belong to V13 (ADR-012).
-- Run as the project admin before and after each V13 migration on the shared CDF GC Review project.
-- Reads catalog metadata only: it never reads application rows. The per-category hashes must be identical
-- before and after a V13 migration; any difference stops the rollout (docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md).
with
excl_schemas as (select unnest(array['pg_catalog','information_schema','cdf_notifications_v13']) as s),
v13_roles as (select unnest(array['cdf_v13_owner','cdf_v13_app','cdf_v13_user']) as r),
rels as (
  select n.nspname||'.'||c.relname as k,
    concat_ws('|', c.relkind, pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity, coalesce(c.relacl::text,''),
      (select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''), ',' order by a.attnum)
         from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) as v
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname not in (select s from excl_schemas) and n.nspname not like 'pg\_toast%' and n.nspname not like 'pg\_temp%'
    and c.relkind in ('r','p','v','m','S','f')),
funcs as (
  select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as k,
    concat_ws('|', md5(coalesce(p.prosrc,'')), p.prosecdef, pg_get_userbyid(p.proowner), coalesce(p.proacl::text,''), coalesce(array_to_string(p.proconfig,';'),''), p.provolatile) as v
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname not in (select s from excl_schemas) and n.nspname not like 'pg\_toast%' and n.nspname not like 'pg\_temp%'),
pols as (
  select schemaname||'.'||tablename||'.'||policyname as k, concat_ws('|', permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')) as v
  from pg_policies where schemaname not in (select s from excl_schemas)),
trigs as (
  select n.nspname||'.'||c.relname||'.'||t.tgname as k, concat_ws('|', t.tgenabled, pg_get_triggerdef(t.oid)) as v
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname not in (select s from excl_schemas)),
idx as (select schemaname||'.'||indexname as k, indexdef as v from pg_indexes where schemaname not in (select s from excl_schemas)),
cons as (
  select n.nspname||'.'||cl.relname||'.'||co.conname as k, co.contype::text||'|'||pg_get_constraintdef(co.oid) as v
  from pg_constraint co join pg_class cl on cl.oid=co.conrelid join pg_namespace n on n.oid=cl.relnamespace
  where n.nspname not in (select s from excl_schemas)),
roles as (
  select r.rolname as k, concat_ws('|', r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls, r.rolconnlimit,
     coalesce(array_to_string(r.rolconfig,';'),''),
     (select string_agg(g.rolname||':'||m.admin_option||':'||m.inherit_option||':'||m.set_option, ',' order by g.rolname)
        from pg_auth_members m join pg_roles g on g.oid=m.roleid where m.member=r.oid and g.rolname not in (select r from v13_roles))) as v
  from pg_roles r where r.rolname not in (select r from v13_roles)),
schemas as (select nspname as k, pg_get_userbyid(nspowner)||'|'||coalesce(nspacl::text,'') as v from pg_namespace
            where nspname not in (select s from excl_schemas) and nspname not like 'pg\_toast%' and nspname not like 'pg\_temp%'),
dacl as (select coalesce(n.nspname,'<global>')||'.'||pg_get_userbyid(d.defaclrole)||'.'||d.defaclobjtype::text as k, d.defaclacl::text as v
         from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
         where coalesce(n.nspname,'') <> 'cdf_notifications_v13' and pg_get_userbyid(d.defaclrole) not in (select r from v13_roles)),
evt as (select evtname as k, concat_ws('|', evtevent, evtfoid::regproc::text, evtenabled, coalesce(array_to_string(evttags,','),'')) as v from pg_event_trigger),
pubs as (select p.pubname as k, concat_ws('|', p.puballtables, (select string_agg(schemaname||'.'||tablename, ',' order by 1) from pg_publication_tables pt where pt.pubname=p.pubname)) as v from pg_publication p),
exts as (select e.extname as k, e.extversion||'|'||n.nspname as v from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
migs as (select version as k, coalesce(name,'') as v from supabase_migrations.schema_migrations),
allrows as (
  select 'relations' as cat, k, v from rels union all select 'functions',k,v from funcs union all select 'policies',k,v from pols
  union all select 'triggers',k,v from trigs union all select 'indexes',k,v from idx union all select 'constraints',k,v from cons
  union all select 'roles',k,v from roles union all select 'schemas',k,v from schemas union all select 'default_acls',k,v from dacl
  union all select 'event_triggers',k,v from evt union all select 'publications',k,v from pubs union all select 'extensions',k,v from exts
  union all select 'supabase_migrations',k,v from migs)
select cat, k, md5(v) as h from allrows order by cat collate "C", k collate "C";
