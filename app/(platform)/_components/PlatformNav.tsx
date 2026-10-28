// Role-aware platform navigation (FE-002). Minimal markup until UX-002's SideNav lands; then this passes the same
// items to it. Server component: items come from lib/server/navigation (pre-check), labels from lib/i18n.
import Link from "next/link";
import type { Translator } from "@/lib/i18n";
import type { NavItem } from "@/lib/server/navigation";

export function PlatformNav({ t, items }: { t: Translator; items: readonly NavItem[] }) {
  return (
    <nav aria-label={t("workspaces.nav.label")} data-testid="platform-nav">
      <ul className="v13-nav-list">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} data-testid={`nav-${item.id}`}>
              {t(item.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
