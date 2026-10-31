// Case sections as links (INFORMATION_ARCHITECTURE.md §3): each tab is its own route, so it works without JavaScript
// and is linkable. aria-current="page" marks the open tab, with a bar and weight as well as colour.
import type { Translator } from "@/lib/i18n";

export type CaseTabKey = "overview" | "events" | "tasks" | "notifications";

export interface CaseTab {
  key: CaseTabKey;
  href: string;
  /** Localised tab name. */
  label: string;
}

export function CaseTabs({
  t,
  tabs,
  current,
}: {
  t: Translator;
  tabs: readonly CaseTab[];
  current: CaseTabKey;
}) {
  return (
    <nav className="v13-case-tabs" aria-label={t("shell.case.sectionsLabel")}>
      <ul>
        {tabs.map((tab) => (
          <li key={tab.key}>
            <a
              href={tab.href}
              aria-current={tab.key === current ? "page" : undefined}
              data-testid={`case-tab-${tab.key}`}
            >
              {tab.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
