// The refusal shared by every port that pages with an opaque cursor (CaseSourceAdapter.listCases,
// NotificationCenterReader.listNotifications; OI-031). An adapter throws it, before any read, for a cursor it did not
// issue or that does not decode; the BFF answers with the generic "invalid filters" state, never an error page.
export class InvalidCursorError extends Error {
  override readonly name = "InvalidCursorError";
  readonly code = "INVALID_CURSOR";
}
