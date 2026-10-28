-- owner_set_app_login.sql — sets the password of the V13 app login and prints the two staging values.
--
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- WHO RUNS IT: the project owner, in the Supabase SQL editor of project CDF GC Review (jeseeznffxlxmcljpmiu).
-- Claude never runs it and never sees its output (docs/hosted/OWNER_STEP_APP_LOGIN.md).
--
-- WHAT IT CHANGES: exactly one thing, the password of the login role cdf_v13_app (ADR-012). Nothing else in the
-- database is touched; the GC Review application is not affected.
--
-- WHAT IT DOES:
--   1. Generates a random 64-character password for cdf_v13_app inside the database and stores only its
--      SCRAM-SHA-256 verifier (RFC 5802 / RFC 7677, 4096 iterations). The plaintext password never appears in any
--      SQL statement text, so it cannot reach the statement log or pg_stat_statements.
--   2. Generates a random session secret (48 bytes, base64url) for signing the persona session cookie.
--   3. Shows two rows, V13_DATABASE_URL and V13_SESSION_SECRET, to be pasted into Vercel as Sensitive variables.
--      Neither value is stored anywhere else.
--
-- RUNNING IT AGAIN replaces the password (the previous V13_DATABASE_URL stops working) and gives a new session
-- secret (every signed-in persona is signed out); paste both new values into Vercel again.
--
-- SAFETY: it refuses to run unless cdf_v13_app exists as the expected V13 login role (can log in, not a superuser,
-- does not bypass RLS, cannot create roles or databases). It creates only temporary functions in the session's own
-- pg_temp schema, which are dropped before the results are shown. Uses only built-in functions (no extension).
--
-- If Supabase → Connect → "Transaction pooler" shows a host other than aws-1-eu-central-1.pooler.supabase.com,
-- edit v_host below before running.

create function pg_temp.v13_hmac_sha256(p_key bytea, p_msg bytea) returns bytea
language plpgsql immutable strict as $f$
declare
  v_key  bytea := p_key;
  v_ipad bytea;
  v_opad bytea;
begin
  if pg_catalog.length(v_key) > 64 then
    v_key := pg_catalog.sha256(v_key);
  end if;
  v_key := v_key || pg_catalog.decode(pg_catalog.repeat('00', 64 - pg_catalog.length(v_key)), 'hex');
  v_ipad := v_key;
  v_opad := v_key;
  for i in 0..63 loop
    v_ipad := pg_catalog.set_byte(v_ipad, i, pg_catalog.get_byte(v_key, i) # 54);   -- 0x36
    v_opad := pg_catalog.set_byte(v_opad, i, pg_catalog.get_byte(v_key, i) # 92);   -- 0x5c
  end loop;
  return pg_catalog.sha256(v_opad || pg_catalog.sha256(v_ipad || p_msg));
end
$f$;

create function pg_temp.v13_set_app_login() returns table (variable text, value text)
language plpgsql volatile as $f$
declare
  v_ref        constant text := 'jeseeznffxlxmcljpmiu';
  v_host       constant text := 'aws-1-eu-central-1.pooler.supabase.com';
  v_iterations constant int  := 4096;
  v_password   text;
  v_salt       bytea;
  v_key        bytea;
  v_ipad       bytea;
  v_opad       bytea;
  v_u          bytea;
  v_acc        bit(256);
  v_salted     bytea;
  v_client_key bytea;
  v_server_key bytea;
  v_verifier   text;
  v_secret     text;
begin
  if not exists (
    select 1
      from pg_catalog.pg_roles r
     where r.rolname = 'cdf_v13_app'
       and r.rolcanlogin
       and not r.rolsuper
       and not r.rolbypassrls
       and not r.rolcreaterole
       and not r.rolcreatedb
  ) then
    raise exception 'cdf_v13_app is missing or is not the expected V13 login role; nothing was changed';
  end if;

  -- 1. Password: 64 hex characters (244 random bits from gen_random_uuid, which uses the strong random source).
  v_password := pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');

  -- SCRAM-SHA-256 verifier. SaltedPassword = PBKDF2-HMAC-SHA256(password, salt, 4096). The password is plain ASCII,
  -- so SASLprep leaves it unchanged; at 64 bytes it is used directly as the HMAC key block.
  v_salt := pg_catalog.decode(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 'hex');   -- 16 bytes
  v_key := pg_catalog.convert_to(v_password, 'UTF8');
  v_key := v_key || pg_catalog.decode(pg_catalog.repeat('00', 64 - pg_catalog.length(v_key)), 'hex');
  v_ipad := v_key;
  v_opad := v_key;
  for i in 0..63 loop
    v_ipad := pg_catalog.set_byte(v_ipad, i, pg_catalog.get_byte(v_key, i) # 54);
    v_opad := pg_catalog.set_byte(v_opad, i, pg_catalog.get_byte(v_key, i) # 92);
  end loop;
  v_u := pg_catalog.sha256(v_opad || pg_catalog.sha256(v_ipad || v_salt || '\x00000001'::bytea));
  v_acc := ('x' || pg_catalog.encode(v_u, 'hex'))::bit(256);
  for i in 2..v_iterations loop
    v_u := pg_catalog.sha256(v_opad || pg_catalog.sha256(v_ipad || v_u));
    v_acc := v_acc # ('x' || pg_catalog.encode(v_u, 'hex'))::bit(256);
  end loop;
  v_salted := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  for i in 0..31 loop
    v_salted := pg_catalog.set_byte(v_salted, i, pg_catalog.substring(v_acc, i * 8 + 1, 8)::integer);
  end loop;
  v_client_key := pg_temp.v13_hmac_sha256(v_salted, pg_catalog.convert_to('Client Key', 'UTF8'));
  v_server_key := pg_temp.v13_hmac_sha256(v_salted, pg_catalog.convert_to('Server Key', 'UTF8'));
  v_verifier := 'SCRAM-SHA-256$' || v_iterations || ':' || pg_catalog.encode(v_salt, 'base64')
             || '$' || pg_catalog.encode(pg_catalog.sha256(v_client_key), 'base64')
             || ':' || pg_catalog.encode(v_server_key, 'base64');
  execute pg_catalog.format('alter role cdf_v13_app with password %L', v_verifier);

  -- 2. Session secret: 48 random bytes, base64url without padding (64 characters).
  v_secret := pg_catalog.translate(
    pg_catalog.encode(
      pg_catalog.decode(
        pg_catalog.replace(
          pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,
          '-', ''),
        'hex'),
      'base64'),
    '+/=', '-_');

  -- 3. The two values for Vercel.
  variable := 'V13_DATABASE_URL';
  value := 'postgresql://cdf_v13_app.' || v_ref || ':' || v_password || '@' || v_host || ':6543/postgres?sslmode=require';
  return next;
  variable := 'V13_SESSION_SECRET';
  value := v_secret;
  return next;

  execute 'drop function pg_temp.v13_hmac_sha256(bytea, bytea)';
  execute 'drop function pg_temp.v13_set_app_login()';
end
$f$;

select variable, value from pg_temp.v13_set_app_login();
