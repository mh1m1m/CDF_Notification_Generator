// Expected steps (Layer B): a list separate from the Timeline, never merged with recorded entries. Only the three
// projected variants are accepted by the type, and StatusBadge refuses any that claims completion.
import { StatusBadge, type ProjectedBadge } from "@/components/data/StatusBadge";
import type { Locale, Translator } from "@/lib/i18n";

export interface ExpectedStepsProps {
  t: Translator;
  locale: Locale;
  steps: readonly (ProjectedBadge & { key: string })[];
  /** Heading level of the list's title (default 2). */
  headingLevel?: 2 | 3;
}

export function ExpectedSteps({ t, locale, steps, headingLevel = 2 }: ExpectedStepsProps) {
  if (steps.length === 0) return null;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      className="v13-expected-steps"
      aria-labelledby="expected-steps-title"
      data-testid="expected-steps"
    >
      <Heading id="expected-steps-title">{t("common.epistemic.expectedHeading")}</Heading>
      <ul>
        {steps.map(({ key, ...step }) => (
          <li key={key}>
            {(step as { epistemic: string }).epistemic === "recorded" ? null : (
              <StatusBadge t={t} locale={locale} {...step} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
