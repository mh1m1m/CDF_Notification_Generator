-- PROPOSED BY TEAM DB (V13-DB-001) — path owned by the Chief Architect, who reviews and keeps it.
-- Rotation of the request-claims HMAC key (ADR-014 §4). Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
--
-- Run as the project administrator on the Chief Architect's procedure only. It deletes the one row of
-- cdf_notifications_v13.claims_key and writes an audit event in the same transaction; it touches nothing else.
-- Effect: from commit until the application installs the new key (api_install_claims_key), every request resolves
-- to "no claims" and sees nothing (fail closed). Then rotate V13_SESSION_SECRET in Vercel and redeploy; the server
-- installs the key derived from the new secret at start (instrumentation.ts), and the first request retries if that
-- failed.

begin;
set local lock_timeout = '5s';
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
