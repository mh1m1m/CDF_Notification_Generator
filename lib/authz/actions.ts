// Action catalogue of the application pre-check (lib/authz). One code per thing a persona can ask the BFF to do.
// The database decides again for every action (RLS + api_* commands); this list only gates what the BFF attempts.
// Source: docs/security/AUTHORIZATION_MATRIX.md (SEC, E05) §3–§5 and ruling D6.

export const AUTHZ_ACTIONS = [
  /** Case Portfolio list and counts (authorised rows only, RLS). */
  "portfolio.read",
  /** One case: header, overview, recorded events, its tasks and its notifications tab. */
  "case.read",
  /** My Work: the persona's own tasks across cases it may see. */
  "tasks.mine.read",
  /** api_update_task_status (assignee or case right, re-checked by the command). */
  "task.status.update",
  /** Notification Operations Center (/notifications): cross-case list. Not for investigators in M1 (D6). */
  "notifications.center.read",
  /** api_create_notification_draft (role right, re-checked by the command). */
  "notification.draft.create",
  /** Switch the active workspace to another membership of the persona. */
  "workspace.switch",
] as const;

export type AuthzAction = (typeof AUTHZ_ACTIONS)[number];
