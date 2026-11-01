// @ts-check
// V13-DB-018 · REQ-DATA-023 "Define a rollback strategy for every migration." The register lives in
// docs/architecture/DATA_MODEL.md §9. This module checks it against the migration files: every migration has an entry,
// and each entry's object lists equal what the migration's statements create, replace, drop or add. Statements are
// read with the migration linter's lexer, so comments, strings and function bodies never count as statements.
// Static only: it never connects to a database. SYNTHETIC-DATA REFERENCE IMPLEMENTATION.
//
//   node scripts/db/rollback-register.mjs      exit 0 when the register agrees with the migrations, 1 otherwise
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MIGRATIONS_DIR, ROOT, readMigrations } from "./lib/migrations.mjs";
import { render, splitStatements, tokenize } from "./lib/sql-lexer.mjs";

export const REGISTER_FILE = join(ROOT, "docs", "architecture", "DATA_MODEL.md");

/** The register's fields, in order. Object fields hold `kind name` items in backticks; text fields hold prose. */
export const OBJECT_FIELDS = Object.freeze(["Creates", "Replaces", "Drops", "Alters"]);
export const TEXT_FIELDS = Object.freeze(["Data lost on revert", "Local", "Hosted"]);

const NAME = String.raw`(?:[a-z0-9_]+\.)?("?[a-z0-9_]+"?)`;
/** CREATE forms that make a named object. Any other CREATE is refused, so a new kind cannot slip past the register. */
const CREATE_FORMS = [
  { kind: "role", rx: new RegExp(String.raw`^create role ${NAME}`) },
  { kind: "schema", rx: new RegExp(String.raw`^create schema (?:if not exists )?${NAME}`) },
  { kind: "table", rx: new RegExp(String.raw`^create (?:unlogged )?table (?:if not exists )?${NAME}`) },
  {
    kind: "index",
    rx: new RegExp(String.raw`^create (?:unique )?index (?:concurrently )?(?:if not exists )?${NAME} on`),
  },
  { kind: "function", rx: new RegExp(String.raw`^create (?:or replace )?function ${NAME} \(`) },
  { kind: "procedure", rx: new RegExp(String.raw`^create (?:or replace )?procedure ${NAME} \(`) },
  { kind: "trigger", rx: new RegExp(String.raw`^create (?:or replace )?(?:constraint )?trigger ${NAME}`) },
  { kind: "policy", rx: new RegExp(String.raw`^create policy ${NAME} on`) },
  { kind: "view", rx: new RegExp(String.raw`^create (?:or replace )?(?:materialized )?view ${NAME}`) },
  { kind: "type", rx: new RegExp(String.raw`^create type ${NAME}`) },
  { kind: "sequence", rx: new RegExp(String.raw`^create sequence (?:if not exists )?${NAME}`) },
];
const DROP_FORM = new RegExp(
  String.raw`^drop (role|schema|table|index|function|procedure|trigger|policy|view|type|sequence) (?:if exists )?${NAME}`,
);
const ADD_CONSTRAINT_FORM = new RegExp(
  String.raw`^alter table (?:only )?(?:if exists )?${NAME} add constraint ${NAME}`,
);
const ADD_COLUMN_FORM = new RegExp(
  String.raw`^alter table (?:only )?(?:if exists )?${NAME} add (?:column )?${NAME}`,
);

/**
 * The objects one migration creates, replaces (drops and creates again in the same file), drops or alters (a
 * constraint or column added to a table of an earlier migration).
 * @param {string} file
 * @param {string} text
 * @returns {{ Creates: string[], Replaces: string[], Drops: string[], Alters: string[] }}
 */
export function migrationObjects(file, text) {
  /** @type {Set<string>} */ const created = new Set();
  /** @type {Set<string>} */ const dropped = new Set();
  /** @type {Set<string>} */ const altered = new Set();
  for (const statement of splitStatements(tokenize(text))) {
    const sql = render(statement.tokens);
    if (sql.startsWith("create ")) {
      const form = CREATE_FORMS.find((f) => f.rx.test(sql));
      const m = form?.rx.exec(sql);
      if (!form || !m)
        throw new Error(`${file}: CREATE form not known to the rollback register: ${sql.slice(0, 80)}`);
      created.add(`${form.kind} ${m[1]}`);
    } else if (sql.startsWith("drop ")) {
      const m = DROP_FORM.exec(sql);
      if (!m) throw new Error(`${file}: DROP form not known to the rollback register: ${sql.slice(0, 80)}`);
      dropped.add(`${m[1]} ${m[2]}`);
    } else if (sql.startsWith("alter table ")) {
      const c = ADD_CONSTRAINT_FORM.exec(sql);
      const col = c ? undefined : ADD_COLUMN_FORM.exec(sql);
      if (c) altered.add(`constraint ${c[2]} on ${c[1]}`);
      else if (col && !/ add (?:constraint|primary|unique|check|foreign|exclude)\b/.test(sql))
        altered.add(`column ${col[2]} on ${col[1]}`);
    }
  }
  const sort = (/** @type {Iterable<string>} */ s) => [...s].sort();
  return {
    Creates: sort([...created].filter((o) => !dropped.has(o))),
    Replaces: sort([...created].filter((o) => dropped.has(o))),
    Drops: sort([...dropped].filter((o) => !created.has(o))),
    Alters: sort(altered),
  };
}

/**
 * Reads the register: from the heading "## 9. Migration rollback register" to the next "## " heading, one
 * "### NNNN_name.sql" block per migration, each with one "- **Field:** …" line per field. Object fields list
 * `kind name` items in backticks, or "none".
 * @param {string} markdown
 * @returns {Map<string, Record<string, string[] | string>>}
 */
export function parseRegister(markdown) {
  const start = markdown.search(/^## 9\. Migration rollback register/m);
  if (start < 0) throw new Error("DATA_MODEL.md has no '## 9. Migration rollback register' section");
  const rest = markdown.slice(start + 3);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  /** @type {Map<string, Record<string, string[] | string>>} */
  const entries = new Map();
  for (const block of section.split(/^### /m).slice(1)) {
    const file = block.split("\n", 1)[0]?.trim() ?? "";
    if (entries.has(file)) throw new Error(`register lists ${file} twice`);
    /** @type {Record<string, string[] | string>} */
    const entry = {};
    for (const m of block.matchAll(/^- \*\*([^*]+):\*\* ?(.*(?:\n {2}\S.*)*)/gm)) {
      const field = /** @type {string} */ (m[1]);
      const value = /** @type {string} */ (m[2]).replace(/\s+/g, " ").trim();
      if (field in entry) throw new Error(`register entry ${file} lists the field '${field}' twice`);
      entry[field] = OBJECT_FIELDS.includes(field)
        ? [...value.matchAll(/`([^`]+)`/g)].map((x) => /** @type {string} */ (x[1])).sort()
        : value;
    }
    entries.set(file, entry);
  }
  return entries;
}

/**
 * Compares the register with the migrations. Each finding names the migration and what disagrees.
 * @param {{ migrations: { file: string, sql: string }[], markdown: string }} input
 * @returns {string[]}
 */
export function checkRegister({ migrations, markdown }) {
  const findings = [];
  const register = parseRegister(markdown);
  const files = new Set(migrations.map((m) => m.file));
  for (const { file, sql } of migrations) {
    const entry = register.get(file);
    if (!entry) {
      findings.push(`${file}: no rollback register entry`);
      continue;
    }
    const actual = migrationObjects(file, sql);
    for (const field of OBJECT_FIELDS) {
      const listed = entry[field];
      if (!Array.isArray(listed)) {
        findings.push(`${file}: field '${field}' missing`);
        continue;
      }
      const expected = actual[/** @type {keyof typeof actual} */ (field)];
      const missing = expected.filter((o) => !listed.includes(o));
      const extra = listed.filter((o) => !expected.includes(o));
      if (missing.length > 0) findings.push(`${file}: ${field} omits ${missing.join(", ")}`);
      if (extra.length > 0)
        findings.push(`${file}: ${field} lists ${extra.join(", ")}, which the migration does not`);
    }
    for (const field of TEXT_FIELDS) {
      const text = entry[field];
      if (typeof text !== "string" || text.length < 10)
        findings.push(`${file}: field '${field}' missing or empty`);
    }
    const hosted = entry.Hosted;
    if (typeof hosted === "string" && !/forward-fix migration/.test(hosted))
      findings.push(`${file}: Hosted strategy must name the forward-fix migration`);
  }
  for (const file of register.keys())
    if (!files.has(file)) findings.push(`${file}: register entry without a migration file`);
  return findings;
}

/** The register against the repository's migrations. */
export function checkRepositoryRegister(dir = MIGRATIONS_DIR, registerFile = REGISTER_FILE) {
  return checkRegister({ migrations: readMigrations(dir), markdown: readFileSync(registerFile, "utf8") });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const findings = checkRepositoryRegister();
  for (const f of findings) console.error(`✗ ${f}`);
  console.log(`rollback register: ${readMigrations().length} migration(s), ${findings.length} finding(s)`);
  process.exit(findings.length === 0 ? 0 : 1);
}
