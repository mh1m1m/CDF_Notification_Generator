-- PROPOSED BY TEAM DB (V13-DB-001) — path owned by the Chief Architect, who reviews and keeps it.
-- Rotation of the request-claims HMAC key (ADR-014 §4). Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
--
-- Run as the project administrator on the Chief Architect's procedure only. It deletes the one row of
-- cdf_notifications_v13.claims_key and writes an audit event in the same transaction; it touches nothing else.
-- Rotation order (never the other way round):
--   1. Set the new V13_SESSION_SECRET in Vercel and redeploy. The new deployment logs CLAIMS_KEY_MISMATCH at start
--      and its requests fail closed (they see nothing) while the old key is still installed.
--   2. Then run this script. From its commit, the next request of the new deployment installs the key derived from
--      the new secret (withRequestContext retries the install).
-- Running it before the redeploy would let a cold start of the old deployment re-install the old key.

begin;
set local lock_timeout = '5s';
set local search_path = '';
set local role cdf_v13_owner;

do $reset$
declare
  n int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cdf_notifications_v13'), 2);
  delete from cdf_notifications_v13.claims_key where key_version = 1;
  get diagnostics n = row_count;
  perform cdf_notifications_v13._append_audit('CLAIMS_KEY_CLEARED', 'claims_key', null, null,
    jsonb_build_object('key_version', 1, 'rows', n));
  raise notice 'claims key cleared (% row); install the new key from the application', n;
end
$reset$;

reset role;
commit;
