// Namespace "common" (UX) — English (LTR). Exactly the keys of ./ar.ts (a missing or extra key fails typecheck).
import type { ar } from "./ar";

export const en: Record<keyof typeof ar, string> = {
  "app.name": "CDF Case & Notification Intelligence Platform — V13 Enterprise",
  "app.shortName": "V13 Enterprise",
  "app.description":
    "Synthetic-data reference implementation of the Cultural Development Fund case and notification platform.",
  "banner.synthetic": "Synthetic data — reference implementation — not CDF production",
  "skipLink.label": "Skip to main content",
  "locale.switchTo": "العربية",
  "meta.titleTemplate": "{page} · V13 Enterprise (synthetic data)",
  "notFound.title": "Page not found",
  "notFound.heading": "Page not found",
  "notFound.body": "There is no page at this address, or you may not access it.",
  "notFound.backToStart": "Back to the start",
  "records.active": "Active",
  "records.closed": "Closed",
};
