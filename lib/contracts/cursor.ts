// The refusal shared by every port that pages with an opaque cursor (CaseSourceAdapter.listCases,
// NotificationCenterReader.listNotifications, and the case list pages of V13-FE-013; OI-031). An adapter throws it,
// before any read, for a cursor it did not issue or that does not decode; the BFF answers with the generic "invalid
// filters" state (the Case Workspace lists: the empty state), never an error page.
export class InvalidCursorError extends Error {
  override readonly name = "InvalidCursorError";
  readonly code = "INVALID_CURSOR";
}
