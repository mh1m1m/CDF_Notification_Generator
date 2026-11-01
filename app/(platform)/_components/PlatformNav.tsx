// Role-aware platform navigation (FE-002) in the shell's SideNav (UX-008). Items come from lib/server/navigation (the
// pre-check), labels from lib/i18n; SideNavAuto marks the area that contains the URL with aria-current="page".
import { sideNavListItems } from "@/components/shell/SideNav";
import { SideNavAuto } from "@/components/shell/SideNavAuto";
import type { Locale, Translator } from "@/lib/i18n";
import type { NavItem } from "@/lib/server/navigation";

export function PlatformNav({
  t,
  locale,
  items,
}: {
  t: Translator;
  locale: Locale;
  items: readonly NavItem[];
}) {
  return (
    <SideNavAuto
      locale={locale}
      label={t("workspaces.nav.label")}
      testId="platform-nav"
      items={sideNavListItems(
        t,
        locale,
        items.map((item) => ({ key: item.id, href: item.href, label: t(item.labelKey) })),
      )}
    />
  );
}
