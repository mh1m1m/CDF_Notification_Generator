// Switches between Arabic (RTL, default) and English (LTR). A plain form posting to a Server Action, so it works
// without client JavaScript. The button names the other language in that language.
import type { Locale, Translator } from "@/lib/i18n";

export interface LocaleToggleProps {
  t: Translator;
  /** The locale the button switches to. */
  target: Locale;
  /** Server Action that stores the chosen locale. */
  action: (formData: FormData) => Promise<void>;
}

export function LocaleToggle({ t, target, action }: LocaleToggleProps) {
  return (
    <form action={action}>
      <input type="hidden" name="locale" value={target} />
      <button type="submit" className="v13-locale-toggle" lang={target} data-testid="locale-toggle">
        {t("common.locale.switchTo")}
      </button>
    </form>
  );
}
