// Permanent classification banner. Rendered by the root layout on every page, including sign-in: always present, never
// dismissible, Chardonnay fill with Cinder text, a flask glyph plus words (not colour alone).
import { FlaskIcon } from "@/components/icons";
import type { Translator } from "@/lib/i18n";

export function SyntheticBanner({ t }: { t: Translator }) {
  return (
    <p className="v13-banner" role="note" data-testid="synthetic-banner">
      <FlaskIcon />
      <span>{t("common.banner.synthetic")}</span>
    </p>
  );
}
