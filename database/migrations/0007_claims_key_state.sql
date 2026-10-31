-- 0007_claims_key_state — V13-DB-009 (closes OPEN_ISSUES OI-022): the claims-key state for GET /api/health.
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- claims_key_state(p_probe_mac) tells the application whether the installed request-claims key (ADR-014) is the key it
-- derives from its own V13_SESSION_SECRET, without either side revealing the key:
--   probe   = base64url(HMAC-SHA256(K, 'cdf-v13/claims-key-probe/v1' || '|' || pg_current_xact_id())), no padding,
--             computed by the application in the same transaction (lib/db/health-probe.ts).
--   result  = NOT_INSTALLED       no key row
--             INSTALLED_MATCH     the probe verifies under the installed key
--             INSTALLED_MISMATCH  it does not (another secret, or a forged probe)
-- A code only: never key material, a hash or a fingerprint. No audit row (health is polled). The label is
-- domain-separated from claims: a claims text must be the v1 JSON object, so a probe MAC is never a valid claims MAC,
-- and the probe is bound to this transaction like a claims MAC.
-- SECURITY DEFINER (the key table is owner-only, ADR-014), owned by cdf_v13_owner, search_path ''. EXECUTE for the
-- request role cdf_v13_user only: health sets that role first, so cdf_v13_app keeps no privilege of its own (§5).
-- PRODUCTION_SUBSTITUTION_REQUIRED: production holds the key in CDF KMS and checks it with the KMS key id.

set local role cdf_v13_owner;

create function cdf_notifications_v13.claims_key_state(p_probe_mac text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_expect text;
begin
  if not exists (select 1 from cdf_notifications_v13.claims_key k where k.key_version = 1) then
    return 'NOT_INSTALLED';
  end if;
  v_expect := pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(cdf_notifications_v13._claims_hmac(
                pg_catalog.convert_to('cdf-v13/claims-key-probe/v1|' || pg_catalog.pg_current_xact_id()::text, 'UTF8')),
                'base64'), '+/', '-_'), '=');
  if p_probe_mac is not null and p_probe_mac = v_expect then
    return 'INSTALLED_MATCH';
  end if;
  return 'INSTALLED_MISMATCH';
end
$fn$;
comment on function cdf_notifications_v13.claims_key_state(text) is 'Health: NOT_INSTALLED, INSTALLED_MATCH or INSTALLED_MISMATCH for a transaction-bound probe MAC over a domain-separated label. A code only; no key material; not audited (ADR-014, OI-022).';

grant execute on function cdf_notifications_v13.claims_key_state(text) to cdf_v13_user;

reset role;
