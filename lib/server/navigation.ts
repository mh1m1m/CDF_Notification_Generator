// Role-aware navigation of the platform (FE-002). An item is listed only when the pre-check would allow its action for
// the active workspace's roles; hiding is a convenience, never the control (every route checks again, D6: the
// Notification Operations Center answers like an unknown route for investigators).
import "server-only";
import { canSee, type AuthzAction } from "@/lib/authz";
import type { RequestIdentity } from "@/lib/contracts";
import type { MessageKey } from "@/lib/i18n";

export interface NavItem {
  readonly id: "my-work" | "portfolio" | "notifications";
  readonly href: string;
  readonly labelKey: MessageKey;
  readonly action: AuthzAction;
}

export const NAV_ITEMS: readonly NavItem[] = Object.freeze([
  { id: "my-work", href: "/my-work", labelKey: "myWork.navLabel", action: "tasks.mine.read" },
  { id: "portfolio", href: "/portfolio", labelKey: "portfolio.navLabel", action: "portfolio.read" },
  {
    id: "notifications",
    href: "/notifications",
    labelKey: "notifications.navLabel",
    action: "notifications.center.read",
  },
]);

export function navigationFor(identity: RequestIdentity): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => canSee(identity, item.action));
}
