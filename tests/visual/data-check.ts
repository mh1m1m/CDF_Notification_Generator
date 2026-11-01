// Pre-capture data check for the screenshot library (V13-QA-014; REQ-VIS-011; docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §4).
// All data is synthetic (CLAUDE.md §1), so masks serve determinism, not secrecy. This check still runs on the unmasked
// page and every frame before each capture, so a screenshot can never carry anything else; a finding fails the test
// and no image is written.
//
//   V1 every case reference is one of the seeded CDF-DEMO-2026-0001 … 0010 (Arabic-Indic digits normalised, as the
//      Sentinel does), and no other CDF-…-number shape appears;
//   V2 every e-mail address is @example.test;
//   V3 no real CDF domain (cdf.gov.sa) appears anywhere;
//   V4 the persona name the shell shows is one of the synthetic personas' names, in either language;
//   V5 no session cookie value or session secret appears in the page text or markup.
import { PERSONAS } from "@/lib/contracts";
import { createTranslator, LOCALES } from "@/lib/i18n";
import { normaliseDigits } from "../sentinel/sentinel";

export interface DataFinding {
  readonly rule: "V1" | "V2" | "V3" | "V4" | "V5";
  readonly where: string;
  readonly detail: string;
}

export const SEEDED_CASE_REFS: ReadonlySet<string> = new Set(
  Array.from({ length: 10 }, (_, i) => `CDF-DEMO-2026-${String(i + 1).padStart(4, "0")}`),
);

/** Every synthetic persona's display name, in every language the app has. */
export const SYNTHETIC_PERSONA_NAMES: ReadonlySet<string> = new Set(
  LOCALES.flatMap((locale) => {
    const t = createTranslator(locale);
    return PERSONAS.map((p) => t(p.name_key as Parameters<typeof t>[0]));
  }),
);

/** Anything shaped like a CDF case or report number: CDF-, optional letter groups, then a group of 3+ digits. */
const CDF_NUMBER = /\bCDF-(?:[A-Z]+-)*\d{3,}(?:-\d+)*/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;
const REAL_DOMAIN = /cdf\.gov\.sa/i;

export interface DataInput {
  /** Where the text came from (the page, a frame), for the message. */
  readonly where: string;
  /** Visible text and markup (attributes included, so a value in a hidden input or srcdoc is seen). */
  readonly text: string;
}

export interface DataContext {
  /** The persona name the shell shows, if any (V4). */
  readonly personaNames: readonly string[];
  /** Session cookie values and the run's session secret (V5). Empty strings are ignored. */
  readonly secrets: readonly string[];
}

export function checkSynthetic(inputs: readonly DataInput[], ctx: DataContext): DataFinding[] {
  const out: DataFinding[] = [];
  for (const { where, text } of inputs) {
    const plain = normaliseDigits(text);
    for (const m of plain.matchAll(CDF_NUMBER)) {
      const ref = m[0].toUpperCase();
      if (!SEEDED_CASE_REFS.has(ref))
        out.push({ rule: "V1", where, detail: `case reference ${ref} is not seeded` });
    }
    for (const m of plain.matchAll(EMAIL)) {
      if (!/@example\.test$/i.test(m[0]))
        out.push({
          rule: "V2",
          where,
          detail: `e-mail address outside @example.test (domain ${m[0].split("@")[1]})`,
        });
    }
    if (REAL_DOMAIN.test(plain)) out.push({ rule: "V3", where, detail: "a real CDF domain (cdf.gov.sa)" });
    for (const secret of ctx.secrets) {
      if (secret.length >= 8 && text.includes(secret))
        out.push({ rule: "V5", where, detail: "a session cookie value or the session secret" });
    }
  }
  for (const name of ctx.personaNames) {
    const n = name.trim();
    if (n && !SYNTHETIC_PERSONA_NAMES.has(n))
      out.push({ rule: "V4", where: "shell", detail: `persona name outside the synthetic list: ${n}` });
  }
  return out;
}

export const formatFindings = (fs: readonly DataFinding[]) =>
  fs.map((f) => `${f.rule} ${f.where}: ${f.detail}`).join("\n");
