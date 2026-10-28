// Permanent classification banner (UX skeleton). Rendered by the root layout on every page, including sign-in.
import type { Translator } from "@/lib/i18n";

export function SyntheticBanner({ t }: { t: Translator }) {
  return (
    <p className="v13-banner" role="note" data-testid="synthetic-banner">
      {t("common.banner.synthetic")}
    </p>
  );
}
