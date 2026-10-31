-- 0009_fk_index_review — V13-DB-011 (OPEN_ISSUES OI-032): the performance advisor's unindexed-foreign-key findings.
-- Classification: SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
--
-- An index on a foreign key's columns pays off when the parent row can be deleted or have its key changed (the check
-- then searches the child table), or when a read finds child rows by that key. In V13 no parent key ever changes
-- (UUID keys, no command updates an id) and no application path deletes a parent. The append-only tables refuse
-- UPDATE and DELETE outright. Each of the 14 findings is decided below. The integration suite
-- tests/integration/fk-index-coverage.spec.ts keeps this list exhaustive: a new foreign key fails it until it is
-- indexed or accepted there with a reason.
--
-- INDEXED (1): notification_event_notification_fk (notification_id, case_id). A notification's timeline reads its
--   events by notification. The 0004 index (notification_id, occurred_at) did not start with the foreign key's
--   columns, so the advisor reported both "unindexed FK" and "unused index". It is replaced by
--   (notification_id, case_id, occurred_at): same order for the timeline, and the FK prefix. case_id is fixed by
--   notification_id, so the extra column does not change selectivity.
--
-- ACCEPTED without an index (13). The parent is never deleted and its key never changes, and no read finds children
-- by this key. A manual delete by the administrator would scan a small table once and is refused anyway while
-- children exist.
--   audit_event_actor_persona_id_fkey, audit_event_workspace_id_fkey    append-only ledger; read only by the verifier
--                                                                       (by seq)
--   persona_workspace_membership_role_id_fkey                           role is reference data; reads go by persona
--                                                                       (membership_unique leads with persona_id)
--   persona_workspace_membership_workspace_id_fkey                      reads go by persona, then workspace
--                                                                       (membership_unique)
--   case_record_owning_workspace_id_fkey                                reads by workspace use
--                                                                       case_workspace_visibility_ws_idx
--   procedural_event_recorded_by_persona_id_fkey                        append-only; actor lookups go to
--                                                                       case_assignment
--   procedural_event_causation_fk                                       append-only; no "caused by" read yet
--   notification_event_actor_persona_id_fkey                            append-only
--   notification_template_version_id_fkey                               immutable template versions; reads join
--                                                                       version by its primary key
--   notification_recipient_class_fkey                                   reference data
--   notification_recipient_persona_id_fkey                              no recipient inbox read in M1; index with
--                                                                       that read
--   notification_supersedes_fk                                          no supersede command yet; index with it
--   dispatch_outbox_notification_fk                                     content-free outbox, never deleted from;
--                                                                       the dispatcher reads by its own state
-- The advisor's unused_index findings are expected on tables without traffic and need no change.
-- PRODUCTION_SUBSTITUTION_REQUIRED: production indexing follows the CDF RDS PostgreSQL workload review.

set local role cdf_v13_owner;

drop index cdf_notifications_v13.notification_event_notification_idx;
create index notification_event_notification_idx
  on cdf_notifications_v13.notification_event (notification_id, case_id, occurred_at);
comment on index cdf_notifications_v13.notification_event_notification_idx is 'A notification''s events in time order; leads with the foreign key (notification_id, case_id) to the notification.';

reset role;
