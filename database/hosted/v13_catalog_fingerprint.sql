-- V13 catalogue fingerprint: one row per category and a TOTAL (V13-ARCH-005).
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- Reads catalogue metadata of schema cdf_notifications_v13 and the three V13 roles only: relations, columns,
-- constraints, indexes, policies, functions (signature, settings, owner, ACL, result, language, md5 of the body),
-- triggers, enum and domain types, role attributes, memberships between V13 roles, the schema ACL and default ACLs. It
-- reads no table row and no password field. Memberships of the administrator are left out on purpose: they differ by
-- design between a superuser-built local cluster and the hosted project (PostgreSQL's creator grant), and
-- post_apply_checks.sql P08 checks them.
--
-- Use: run on the hosted project after a V13 migration (ACTUAL) and on a local database built by `pnpm db:reset` from the
-- same commit (EXPECTED). Equal hashes show the applied schema is the reviewed one. On a difference, run
-- v13_catalog_detail.sql on both sides to find the object, and record EXPECTED / ACTUAL / DRIFT / CAUSE / REMEDIATION
-- (docs/hosted/ISOLATION_AND_RECOVERY_PLAN.md §5.7). Run by the Chief Architect as the administrator; read-only.
with ns as (select oid from pg_catalog.pg_namespace where nspname = 'cdf_notifications_v13'),
v13_roles as (select unnest(array['cdf_v13_owner','cdf_v13_app','cdf_v13_user']) as r),
d(category, key, sig) as (
  select 'relation', c.relname::text,
         concat_ws('|', c.relkind, c.relrowsecurity, c.relforcerowsecurity, pg_catalog.pg_get_userbyid(c.relowner),
                   coalesce(c.relacl::text, ''))
    from pg_catalog.pg_class c
   where c.relnamespace = (select oid from ns) and c.relkind in ('r','v','m','p','f','S')
  union all
  select 'column', c.relname || '.' || a.attname,
         concat_ws('|', a.attnum, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
                   coalesce(pg_catalog.pg_get_expr(ad.adbin, ad.adrelid), ''), a.attidentity, a.attgenerated,
                   coalesce(a.attacl::text, ''))
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    left join pg_catalog.pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
   where c.relnamespace = (select oid from ns) and c.relkind in ('r','v','m','p') and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint', con.conrelid::regclass::text || '.' || con.conname,
         concat_ws('|', con.contype, pg_catalog.pg_get_constraintdef(con.oid))
    from pg_catalog.pg_constraint con
   where con.connamespace = (select oid from ns)
  union all
  select 'index', ic.relname::text, pg_catalog.pg_get_indexdef(i.indexrelid)
    from pg_catalog.pg_index i
    join pg_catalog.pg_class ic on ic.oid = i.indexrelid
   where ic.relnamespace = (select oid from ns)
  union all
  select 'policy', c.relname || '.' || p.polname,
         concat_ws('|', p.polcmd, p.polpermissive,
                   (select string_agg(x.n, ',' order by x.n collate "C")
                      from (select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end as n
                              from unnest(p.polroles) as r) as x),
                   coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), ''),
                   coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), ''))
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
   where c.relnamespace = (select oid from ns)
  union all
  select 'function', p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
         concat_ws('|', p.prokind, p.prosecdef, p.provolatile, p.proleakproof, p.proisstrict,
                   coalesce(p.proconfig::text, ''), pg_catalog.pg_get_userbyid(p.proowner), coalesce(p.proacl::text, ''),
                   pg_catalog.pg_get_function_result(p.oid), l.lanname, md5(p.prosrc))
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
   where p.pronamespace = (select oid from ns)
  union all
  select 'trigger', c.relname || '.' || t.tgname, concat_ws('|', t.tgenabled, pg_catalog.pg_get_triggerdef(t.oid))
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
   where c.relnamespace = (select oid from ns) and not t.tgisinternal
  union all
  select 'type', t.typname::text,
         concat_ws('|', t.typtype,
                   coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder)
                               from pg_catalog.pg_enum e where e.enumtypid = t.oid), ''),
                   coalesce(pg_catalog.format_type(t.typbasetype, t.typtypmod), ''))
    from pg_catalog.pg_type t
   where t.typnamespace = (select oid from ns) and t.typtype in ('e','d')
  union all
  select 'role', r.rolname::text,
         concat_ws('|', r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication,
                   r.rolbypassrls, r.rolconnlimit, coalesce(r.rolconfig::text, ''))
    from pg_catalog.pg_roles r
   where r.rolname in (select r from v13_roles)
  union all
  select 'membership', pg_catalog.pg_get_userbyid(m.roleid) || '>' || pg_catalog.pg_get_userbyid(m.member),
         concat_ws('|', m.admin_option, m.inherit_option, m.set_option)
    from pg_catalog.pg_auth_members m
   where pg_catalog.pg_get_userbyid(m.roleid) in (select r from v13_roles)
     and pg_catalog.pg_get_userbyid(m.member) in (select r from v13_roles)
  union all
  select 'schema', n.nspname::text, concat_ws('|', pg_catalog.pg_get_userbyid(n.nspowner), coalesce(n.nspacl::text, ''))
    from pg_catalog.pg_namespace n
   where n.nspname = 'cdf_notifications_v13'
  union all
  select 'default_acl', pg_catalog.pg_get_userbyid(da.defaclrole) || '.' || da.defaclobjtype::text,
         coalesce(da.defaclacl::text, '')
    from pg_catalog.pg_default_acl da
   where da.defaclnamespace = (select oid from ns)
      or pg_catalog.pg_get_userbyid(da.defaclrole) in (select r from v13_roles)
),
h as (select category, key, md5(sig) as h from d),
s as (
  select category, count(*) as objects, md5(string_agg(key || '=' || h, ';' order by key collate "C")) as hash
    from h
   group by category
  union all
  select 'TOTAL', count(*),
         md5(string_agg(category || ':' || key || '=' || h, ';' order by category collate "C", key collate "C"))
    from h
)
select category, objects, hash from s order by category collate "C";
