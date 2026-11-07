// The manual accessibility checklist (REQ-A11Y-003) and the WCAG 2.2 audit (REQ-A11Y-014), V13-QA-018: their structure
// is checked so that a row nobody ran can never read as passed, and the audit cannot drift from the checklist.
// docs/qa/M1_OPEN_QA_ROWS_DESIGN.md §6–§7. SYNTHETIC data only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, "docs", "qa", f), "utf8");

/** The rows of the Markdown table that follows `heading` (a line starting with it), as trimmed cells. */
function table(md: string, heading: string): string[][] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  expect(start, `heading ${heading}`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("|")) {
      inTable = true;
      rows.push(
        line
          .slice(1, -1)
          .split(/(?<!\\)\|/)
          .map((c) => c.trim()),
      );
    } else if (inTable || line.startsWith("#")) break;
  }
  return rows.slice(2); // header and separator
}

/** Every level-3 section under `parent`, by its heading text. */
function sections(md: string, parent: string): string[] {
  const after = md.slice(md.indexOf(`\n${parent}\n`));
  return [...after.matchAll(/^### (.+)$/gm)].map((m) => m[1]!);
}

// WCAG 2.2 Level A and AA success criteria (4.1.1 Parsing removed in 2.2): 31 at A, 24 at AA.
const WCAG22: Record<string, "A" | "AA"> = {
  "1.1.1": "A",
  "1.2.1": "A",
  "1.2.2": "A",
  "1.2.3": "A",
  "1.2.4": "AA",
  "1.2.5": "AA",
  "1.3.1": "A",
  "1.3.2": "A",
  "1.3.3": "A",
  "1.3.4": "AA",
  "1.3.5": "AA",
  "1.4.1": "A",
  "1.4.2": "A",
  "1.4.3": "AA",
  "1.4.4": "AA",
  "1.4.5": "AA",
  "1.4.10": "AA",
  "1.4.11": "AA",
  "1.4.12": "AA",
  "1.4.13": "AA",
  "2.1.1": "A",
  "2.1.2": "A",
  "2.1.4": "A",
  "2.2.1": "A",
  "2.2.2": "A",
  "2.3.1": "A",
  "2.4.1": "A",
  "2.4.2": "A",
  "2.4.3": "A",
  "2.4.4": "A",
  "2.4.5": "AA",
  "2.4.6": "AA",
  "2.4.7": "AA",
  "2.4.11": "AA",
  "2.5.1": "A",
  "2.5.2": "A",
  "2.5.3": "A",
  "2.5.4": "A",
  "2.5.7": "AA",
  "2.5.8": "AA",
  "3.1.1": "A",
  "3.1.2": "AA",
  "3.2.1": "A",
  "3.2.2": "A",
  "3.2.3": "AA",
  "3.2.4": "AA",
  "3.2.6": "A",
  "3.3.1": "A",
  "3.3.2": "A",
  "3.3.3": "AA",
  "3.3.4": "AA",
  "3.3.7": "A",
  "3.3.8": "AA",
  "4.1.2": "A",
  "4.1.3": "AA",
};

const checklist = read("A11Y_MANUAL_CHECKLIST.md");
const audit = read("ACCESSIBILITY_AUDIT.md");
const screens = table(checklist, "## Screens").map((r) => r[0]!);
const checks = table(checklist, "## Checks").map(([id, , sc, , applies]) => ({
  id: id!,
  sc: sc!.split(",").map((s) => s.trim()),
  screens: applies === "all" ? screens : applies!.split(",").map((s) => s.trim()),
}));
const results = new Map(sections(checklist, "## Results").map((id) => [id, table(checklist, `### ${id}`)]));
const criteria = sections(audit, "## Criteria").flatMap((h) => table(audit, `### ${h}`));

describe("manual checklist (REQ-A11Y-003)", () => {
  it("has a result table for every check, with one row per applicable screen in ar and in en", () => {
    expect([...results.keys()]).toEqual(checks.map((c) => c.id));
    for (const c of checks) {
      const rows = results.get(c.id)!.map((r) => `${r[0]!.split(" ")[0]} ${r[1]}`);
      expect(rows, c.id).toEqual(c.screens.flatMap((s) => [`${s} ar`, `${s} en`]));
    }
  });

  it("names only screens and WCAG 2.2 A/AA criteria that exist", () => {
    for (const c of checks) {
      for (const s of c.screens) expect(screens, c.id).toContain(s);
      for (const sc of c.sc) expect(Object.keys(WCAG22), c.id).toContain(sc);
    }
  });

  it("never records a result without who, the tool and version, and the date; a FAIL names its finding", () => {
    for (const [id, rows] of results)
      for (const [screen, lang, result, who, tool, date, finding] of rows) {
        const at = `${id} ${screen} ${lang}`;
        expect(["NOT_RUN", "PASS", "FAIL", "NOT_APPLICABLE"], at).toContain(result);
        if (result === "NOT_RUN") {
          expect([who, tool, date], `${at}: a row nobody ran carries no run details`).toEqual(["", "", ""]);
          continue;
        }
        expect(who, at).not.toBe("");
        expect(tool, `${at}: tool and version`).toMatch(/\d/);
        expect(date, at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (result !== "PASS") expect(finding, at).not.toBe("");
        expect(who, `${at}: no personal e-mail address`).not.toMatch(/@(?!example\.test\b)/);
      }
  });
});

describe("audit (REQ-A11Y-014)", () => {
  it("lists every WCAG 2.2 A and AA criterion once, in order, at its level", () => {
    expect(criteria.map((r) => r[0])).toEqual(Object.keys(WCAG22));
    for (const [sc, level] of criteria) expect(level, sc).toBe(WCAG22[sc!]);
  });

  it("names, for each criterion, exactly the manual checks that list it", () => {
    for (const [sc, , , , manual, result] of criteria) {
      const expected = checks.filter((c) => c.sc.includes(sc!)).map((c) => c.id);
      expect(manual, sc).toBe(expected.join(", ") || "none");
      if (result !== "NOT_APPLICABLE") expect(expected.length, `${sc} has a manual check`).toBeGreaterThan(0);
    }
  });

  it("passes a criterion manually only when every manual row named for it passed; a FAIL names its finding", () => {
    for (const [sc, , , auto, manual, result, note] of criteria) {
      expect(["PASS (automated)", "PASS (manual)", "NOT_RUN", "FAIL", "NOT_APPLICABLE"], sc).toContain(
        result,
      );
      if (result === "PASS (manual)")
        for (const id of manual!.split(", "))
          for (const row of results.get(id)!) expect(row[2], `${sc}: ${id} ${row[0]} ${row[1]}`).toBe("PASS");
      if (result === "PASS (automated)") expect(auto, `${sc}: the suite that passed`).not.toBe("none");
      if (result === "FAIL") expect(note, sc).toMatch(/F-\d{2}/);
      if (result === "NOT_APPLICABLE") expect(note, `${sc}: the reason`).not.toBe("");
    }
  });

  it("every finding a criterion names is in the findings table", () => {
    const findings = table(audit, "## Findings").map((r) => r[0]);
    for (const [sc, , , , , , note] of criteria)
      for (const f of note!.match(/[FQ]-\d{2}/g) ?? []) expect(findings, sc).toContain(f);
  });

  it("claims no conformance", () => {
    for (const [name, md] of [
      ["audit", audit],
      ["checklist", checklist],
    ] as const) {
      expect(md, name).not.toMatch(/\b(WCAG[- ]?)?(compliant|conformant)\b/i);
      expect(md, name).not.toMatch(/production[- ]ready/i);
    }
    expect(audit).toContain("This audit is not a statement of\nconformance");
  });
});
