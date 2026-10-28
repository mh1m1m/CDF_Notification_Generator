#!/usr/bin/env node
// @ts-check
// Static checks on database/migrations/*.sql (pnpm db:lint). Runs before any migration reaches a database and
// again inside scripts/db/hosted-bundle.mjs. Every rule is listed in RULES with the reason it exists.
//
// The checks read the SQL with a lexer (scripts/db/lib/sql-lexer.mjs), so comments are ignored and statements
// inside DO blocks and LANGUAGE sql/plpgsql function bodies are checked too. Dynamic SQL built at run time
// (EXECUTE of a computed string) cannot be analysed statically; reviewers check it by hand.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  listFiles,
  MIGRATION_FILE_PATTERN,
  MIGRATION_NAME_PATTERN,
  MIGRATIONS_DIR,
  nameOf,
  ROOT,
  V13_APP,
  V13_OWNER,
  V13_ROLES,
  V13_SCHEMA,
} from "./lib/migrations.mjs";
import { lineOf, render, splitStatements, SqlLexError, tokenize } from "./lib/sql-lexer.mjs";

/** @typedef {import("./lib/sql-lexer.mjs").Token} Token */
/** @typedef {import("./lib/sql-lexer.mjs").Statement} Statement */
/** @typedef {{ rule: string, file: string, line: number, message: string }} Finding */

/** The rule set. Each finding names one of these ids. */
export const RULES = Object.freeze([
  {
    id: "file-name",
    reason:
      "Files apply in lexical order and are recorded by version and name: ^\\d{4}_[a-z0-9_]+\\.sql$, name part 3–80 characters (the schema_migrations.name check); nothing else lives in database/migrations.",
  },
  {
    id: "contiguous-versions",
    reason:
      "Versions run 0000, 0001, … without gaps or duplicates, so the history is a strict sequence the hosted bundle guards rely on.",
  },
  {
    id: "statement-scope",
    reason:
      "CREATE, ALTER, DROP, GRANT, REVOKE and COMMENT may only target objects in schema cdf_notifications_v13 or the three V13 roles: V13 shares a database with other systems and must never change their objects (ADR-012). Policies name V13 roles; only a restrictive deny-all policy (AS RESTRICTIVE … USING (false) [WITH CHECK (false)]) may say TO PUBLIC, because it grants nothing.",
  },
  {
    id: "foreign-schema-reference",
    reason:
      "V13 never references other schemas of the shared database (public, auth, storage, vault, extensions, cdf, Supabase internals) and never writes to pg_catalog.",
  },
  {
    id: "create-extension",
    reason: "Extensions are database-wide objects of the shared project; V13 uses core PostgreSQL only.",
  },
  { id: "alter-system", reason: "ALTER SYSTEM changes the configuration of the whole server." },
  {
    id: "security-definer-search-path",
    reason:
      "A SECURITY DEFINER function runs with its owner's privileges; without SET search_path = '' a caller can hijack unqualified names.",
  },
  {
    id: "forbidden-grantee",
    reason:
      "Nothing is granted to PUBLIC, the Supabase API roles (anon, authenticated, service_role), the GC Review app role (cdf_app) or the administrator (postgres). Only the bootstrap's SET-only memberships for postgres are exempt.",
  },
  {
    id: "truncate",
    reason: "TRUNCATE bypasses row-level security and row triggers (and with them the audit trail).",
  },
  {
    id: "server-side-file-or-program",
    reason:
      "COPY, server-side file functions, large-object import/export and dblink reach outside the database.",
  },
  {
    id: "rls-enabled",
    reason:
      "Every table enables row level security in the migration that creates it (default deny), and RLS is never disabled.",
  },
  {
    id: "transaction-control",
    reason:
      "The runner and the hosted bundle wrap each file in exactly one transaction and record it in that transaction; BEGIN, COMMIT, ROLLBACK, SAVEPOINT or PREPARE TRANSACTION in a file would break that.",
  },
  {
    id: "statement-terminator",
    reason:
      "A migration has at least one statement and ends with a semicolon, because the hosted bundle appends its own statements after the file.",
  },
  {
    id: "search-path",
    reason:
      "search_path may only be set to '', cdf_notifications_v13, pg_catalog or pg_temp, so unqualified names never resolve into another schema.",
  },
  {
    id: "session-role",
    reason:
      "Only SET LOCAL ROLE and RESET ROLE are allowed: a session-level SET ROLE or SET SESSION AUTHORIZATION would outlive the migration's transaction on a pooled connection.",
  },
  {
    id: "owner-role",
    reason:
      "On the hosted project the administrator holds no privilege inside the V13 schema, so every migration after the bootstrap starts with SET LOCAL ROLE cdf_v13_owner (its objects are owned by cdf_v13_owner) and may only RESET ROLE as its last statement.",
  },
  { id: "owner-to", reason: "Objects in cdf_notifications_v13 are owned by cdf_v13_owner only." },
  {
    id: "bootstrap-only-role-and-schema",
    reason:
      "Roles, role memberships, the schema itself and default privileges define the access model; they change only in 0000_bootstrap.sql or through an architect decision that extends this rule.",
  },
  {
    id: "role-attributes",
    reason:
      "V13 roles never get SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS or INHERIT, only cdf_v13_app may LOGIN, memberships are never granted through CREATE ROLE clauses, and passwords never appear in Git (PASSWORD NULL only).",
  },
  { id: "membership-options", reason: "Role memberships are SET-only: WITH INHERIT FALSE, and never ADMIN." },
  {
    id: "notify-listen",
    reason:
      "NOTIFY, LISTEN, UNLISTEN and pg_notify() use channels that are global to the shared database, so another application's listeners would receive V13 messages; V13 never uses them (ADR-012 coexistence rules).",
  },
  {
    id: "unparsed-statement",
    reason:
      "A statement the linter cannot read or classify fails closed (extend the linter rather than bypass it); function bodies must be LANGUAGE sql or plpgsql.",
  },
]);

const RULE_IDS = new Set(RULES.map((r) => r.id));

const V13_ROLE_SET = new Set(V13_ROLES);
const FORBIDDEN_GRANTEES = new Set([
  "public",
  "anon",
  "authenticated",
  "service_role",
  "cdf_app",
  "postgres",
]);
const FOREIGN_SCHEMAS = [
  "public",
  "auth",
  "storage",
  "vault",
  "extensions",
  "cdf",
  "realtime",
  "_realtime",
  "graphql",
  "graphql_public",
  "supabase_functions",
  "supabase_migrations",
  "pgsodium",
  "pgsodium_masks",
  "net",
  "cron",
  "pgbouncer",
];
const QUALIFIED_FOREIGN = new RegExp(`(?:^|[^\\w$"])"?(${FOREIGN_SCHEMAS.join("|")})"?\\.`);
const BARE_FOREIGN = /(?:^|[^\w$])(supabase_\w+|graphql\w*|pgsodium\w*)(?![\w$])/;
const STRING_FOREIGN = new RegExp(`\\b(${FOREIGN_SCHEMAS.join("|")}|supabase_\\w+)\\.[A-Za-z_"]`, "i");
const CATALOG_WRITE = /\b(?:insert into|update|delete from)(?: only)? "?pg_catalog"?\./;
const SERVER_FILE_FUNCTIONS =
  /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|dblink\w*)\b/;
const ALLOWED_SEARCH_PATH = new Set(["", V13_SCHEMA, "pg_catalog", "pg_temp"]);
const ROLE_ATTRIBUTE_WORDS = new Set([
  "superuser",
  "createdb",
  "createrole",
  "replication",
  "bypassrls",
  "inherit",
]);
const ROLE_MEMBERSHIP_CLAUSES = new Set(["in", "role", "admin", "user", "sysid", "group"]);
const TRANSACTION_WORDS = new Set([
  "begin",
  "start",
  "commit",
  "end",
  "rollback",
  "abort",
  "savepoint",
  "release",
]);
const NESTED_HEAD_PREDECESSORS = new Set(["begin", "then", "else", "loop"]);
const HEAD_VERBS = new Set([
  "create",
  "alter",
  "drop",
  "grant",
  "revoke",
  "comment",
  "truncate",
  "copy",
  "set",
  "reset",
  "load",
  "import",
  "reassign",
  "security",
  "notify",
  "listen",
  "unlisten",
]);
const CREATE_MODIFIERS = new Set([
  "temp",
  "temporary",
  "unlogged",
  "global",
  "local",
  "recursive",
  "trusted",
  "procedural",
  "unique",
  "constraint",
  "default",
]);

/** Object types, longest first. */
const OBJECT_TYPES = [
  "foreign data wrapper",
  "text search configuration",
  "text search dictionary",
  "text search parser",
  "text search template",
  "materialized view",
  "foreign table",
  "event trigger",
  "access method",
  "user mapping",
  "operator class",
  "operator family",
  "default privileges",
  "large object",
  "table",
  "view",
  "index",
  "sequence",
  "function",
  "procedure",
  "routine",
  "aggregate",
  "type",
  "domain",
  "trigger",
  "policy",
  "rule",
  "schema",
  "role",
  "user",
  "group",
  "extension",
  "statistics",
  "collation",
  "conversion",
  "operator",
  "cast",
  "transform",
  "language",
  "server",
  "publication",
  "subscription",
  "tablespace",
  "database",
  "system",
  "column",
  "constraint",
  "owned",
].map((s) => s.split(" "));

/** Types whose target is a schema-qualified object name. */
const NAMED_TYPES = new Set([
  "table",
  "view",
  "materialized view",
  "index",
  "sequence",
  "function",
  "procedure",
  "routine",
  "aggregate",
  "type",
  "domain",
  "statistics",
  "collation",
  "conversion",
  "operator",
  "operator class",
  "operator family",
  "text search configuration",
  "text search dictionary",
  "text search parser",
  "text search template",
  "foreign table",
]);
const ON_TABLE_TYPES = new Set(["trigger", "policy", "rule"]);
const ROLE_TYPES = new Set(["role", "user", "group"]);
/** Database- or server-wide objects V13 never creates, alters, drops or comments on. */
const GLOBAL_TYPES = new Set([
  "foreign data wrapper",
  "event trigger",
  "access method",
  "user mapping",
  "large object",
  "cast",
  "transform",
  "language",
  "server",
  "publication",
  "subscription",
  "tablespace",
  "database",
]);

// ---- Token helpers ------------------------------------------------------------------------------------------

/** @param {Token | undefined} t @param {string} word */
const isWord = (t, word) => t?.type === "word" && t.value === word;
/** @param {Token | undefined} t @param {string} p */
const isPunct = (t, p) => t?.type === "punct" && t.value === p;
/** @param {Token | undefined} t */
const isName = (t) => t?.type === "word" || t?.type === "qident";

/**
 * @param {Token[]} t
 * @param {number} i
 * @param {string[]} words
 */
function matchWords(t, i, words) {
  return words.every((w, k) => isWord(t[i + k], w));
}

/** @param {Token[]} t @param {number} i @param {string[]} words */
function skipWords(t, i, words) {
  return matchWords(t, i, words) ? i + words.length : i;
}

/** @param {Token[]} t @param {number} i */
function matchType(t, i) {
  for (const words of OBJECT_TYPES)
    if (matchWords(t, i, words)) return { type: words.join(" "), next: i + words.length };
  return null;
}

/**
 * Schema-qualified name at i: a.b.c (words or quoted identifiers). Operators may end a qualified name.
 * @param {Token[]} t
 * @param {number} i
 * @returns {{ parts: string[], next: number } | null}
 */
function parseName(t, i) {
  /** @type {string[]} */
  const parts = [];
  let j = i;
  for (;;) {
    const tok = t[j];
    if (isName(tok)) {
      parts.push(/** @type {Token} */ (tok).value);
      j += 1;
    } else if (parts.length > 0 && tok?.type === "punct" && /^[+\-*/<>=~!@#%^&|`?]+$/.test(tok.value)) {
      parts.push(tok.value);
      j += 1;
      break;
    } else {
      break;
    }
    if (isPunct(t[j], ".")) {
      j += 1;
      continue;
    }
    break;
  }
  return parts.length > 0 ? { parts, next: j } : null;
}

/** Index after a balanced (...) group at i, or i when there is none. @param {Token[]} t @param {number} i */
function skipParens(t, i) {
  if (!isPunct(t[i], "(")) return i;
  let depth = 0;
  for (let j = i; j < t.length; j += 1) {
    if (isPunct(t[j], "(")) depth += 1;
    else if (isPunct(t[j], ")")) {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
  }
  return t.length;
}

/**
 * Index of the first depth-0 word from `words` at or after i, or -1.
 * @param {Token[]} t
 * @param {number} i
 * @param {string[]} words
 */
function findTop(t, i, words) {
  let depth = 0;
  for (let j = i; j < t.length; j += 1) {
    const tok = /** @type {Token} */ (t[j]);
    if (isPunct(tok, "(")) depth += 1;
    else if (isPunct(tok, ")")) depth -= 1;
    else if (depth === 0 && tok.type === "word" && words.includes(tok.value)) return j;
  }
  return -1;
}

/**
 * Comma-separated names (with optional argument lists) starting at i, stopping at `stop` words.
 * @param {Token[]} t
 * @param {number} i
 * @param {string[]} [stop]
 */
function parseNameList(t, i, stop = []) {
  /** @type {string[][]} */
  const names = [];
  let j = i;
  for (;;) {
    if (t[j] && t[j]?.type === "word" && stop.includes(/** @type {Token} */ (t[j]).value)) break;
    const name = parseName(t, j);
    if (!name) break;
    names.push(name.parts);
    j = skipParens(t, name.next);
    if (isPunct(t[j], ",")) {
      j += 1;
      continue;
    }
    break;
  }
  return { names, next: j };
}

/**
 * Role specifications (comma-separated) starting at i, stopping at `stop` words. `group x` counts as x.
 * @param {Token[]} t
 * @param {number} i
 * @param {string[]} stop
 */
function parseRoleList(t, i, stop) {
  /** @type {string[]} */
  const roles = [];
  let j = i;
  while (j < t.length) {
    const tok = /** @type {Token} */ (t[j]);
    if (tok.type === "word" && stop.includes(tok.value)) break;
    if (isWord(tok, "group") && isName(t[j + 1])) {
      j += 1;
      continue;
    }
    if (isName(tok)) roles.push(tok.value);
    else if (!isPunct(tok, ",")) break;
    j += 1;
  }
  return { roles, next: j };
}

const inV13 = (/** @type {string[]} */ parts) => parts.length >= 2 && parts[0] === V13_SCHEMA;
const display = (/** @type {string[]} */ parts) => parts.join(".");

// ---- Per-file context ---------------------------------------------------------------------------------------

class FileContext {
  /** @param {string} file @param {string} text */
  constructor(file, text) {
    this.file = file;
    this.text = text;
    this.version = file.slice(0, 4);
    this.isBootstrap = this.version === "0000";
    /** @type {Finding[]} */
    this.findings = [];
    /** @type {Map<string, number>} created table → offset */
    this.createdTables = new Map();
    /** @type {Set<string>} */
    this.rlsEnabled = new Set();
  }

  /** @param {string} rule @param {number} offset @param {string} message */
  report(rule, offset, message) {
    if (!RULE_IDS.has(rule)) throw new Error(`unknown rule ${rule}`);
    this.findings.push({ rule, file: this.file, line: lineOf(this.text, offset), message });
  }
}

// ---- Statement analysis -------------------------------------------------------------------------------------

/**
 * @param {FileContext} ctx
 * @param {Statement} st
 * @param {{ topLevel: boolean }} opts
 */
function checkStatement(ctx, st, opts) {
  const tokens = st.tokens;
  checkNestedBodies(ctx, tokens);
  checkPatterns(ctx, st);

  const heads = opts.topLevel ? [0] : nestedHeads(tokens);
  for (const h of heads) analyzeHead(ctx, tokens.slice(h), opts);
}

/** Positions where a statement starts inside a PL/pgSQL body. @param {Token[]} tokens */
function nestedHeads(tokens) {
  /** @type {number[]} */
  const heads = [];
  tokens.forEach((t, k) => {
    if (t.type !== "word" || !HEAD_VERBS.has(t.value)) return;
    const prev = tokens[k - 1];
    if (k === 0 || (prev?.type === "word" && NESTED_HEAD_PREDECESSORS.has(prev.value))) heads.push(k);
  });
  return heads;
}

/**
 * Lints DO bodies and LANGUAGE sql/plpgsql function bodies as SQL; other dollar-quoted strings are data.
 * @param {FileContext} ctx
 * @param {Token[]} tokens
 */
function checkNestedBodies(ctx, tokens) {
  const head = tokens[0];
  const isDo = isWord(head, "do");
  const isRoutine =
    isWord(head, "create") &&
    findTop(tokens, 1, ["function", "procedure"]) !== -1 &&
    findTop(tokens, 1, ["as", "begin"]) !== -1;
  const languageAt = findTop(tokens, 1, ["language"]);
  const language = languageAt === -1 ? (isDo ? "plpgsql" : null) : (tokens[languageAt + 1]?.value ?? null);

  tokens.forEach((tok, k) => {
    const isBody =
      (isDo && (tok.type === "dollar" || tok.type === "string")) ||
      (isRoutine && (tok.type === "dollar" || tok.type === "string") && isWord(tokens[k - 1], "as"));
    if (!isBody) {
      if (tok.type === "dollar") checkDataString(ctx, tok);
      return;
    }
    if (language !== "sql" && language !== "plpgsql") {
      ctx.report(
        "unparsed-statement",
        tok.start,
        `function bodies must be LANGUAGE sql or plpgsql (found ${language ?? "none"})`,
      );
      return;
    }
    let nested;
    try {
      const offset = tok.type === "dollar" ? (tok.bodyStart ?? tok.start) : tok.start + 1;
      nested = splitStatements(tokenize(tok.value, offset));
    } catch (error) {
      if (!(error instanceof SqlLexError)) throw error;
      ctx.report("unparsed-statement", error.offset, `cannot read the body: ${error.message}`);
      return;
    }
    for (const st of nested) checkStatement(ctx, st, { topLevel: false });
  });
}

/** @param {FileContext} ctx @param {Token} tok */
function checkDataString(ctx, tok) {
  const m = STRING_FOREIGN.exec(tok.value);
  if (m) ctx.report("foreign-schema-reference", tok.start, `string references another schema (${m[0]}…)`);
}

/** Pattern checks on the rendered statement. @param {FileContext} ctx @param {Statement} st */
function checkPatterns(ctx, st) {
  const text = render(st.tokens);
  const q = QUALIFIED_FOREIGN.exec(text) ?? BARE_FOREIGN.exec(text);
  if (q) ctx.report("foreign-schema-reference", st.start, `references schema "${q[1]}"`);
  if (CATALOG_WRITE.test(text)) ctx.report("foreign-schema-reference", st.start, "writes to pg_catalog");
  const f = SERVER_FILE_FUNCTIONS.exec(text);
  if (f) ctx.report("server-side-file-or-program", st.start, `calls ${f[1]}`);
  if (/\bpg_notify\b/.test(text)) ctx.report("notify-listen", st.start, "calls pg_notify");
  if (
    /\bset_config \( '\?' /.test(text) &&
    st.tokens.some((t) => t.type === "string" && t.value.toLowerCase() === "search_path")
  ) {
    ctx.report("search-path", st.start, "set_config('search_path', …) is not allowed");
  }
  if (/\bdisable row level security\b/.test(text))
    ctx.report("rls-enabled", st.start, "row level security is never disabled");
  for (const tok of st.tokens) if (tok.type === "string") checkDataString(ctx, tok);
  checkSearchPathClauses(ctx, st.tokens);
  checkOwnerTo(ctx, st.tokens);
}

/** `SET search_path …` in statements and function clauses. @param {FileContext} ctx @param {Token[]} t */
function checkSearchPathClauses(ctx, t) {
  t.forEach((tok, k) => {
    if (!isWord(tok, "search_path")) return;
    const before = t[k - 1];
    const isSet =
      isWord(before, "set") ||
      ((isWord(before, "local") || isWord(before, "session")) && isWord(t[k - 2], "set"));
    if (!isSet) return;
    let j = k + 1;
    if (isWord(t[j], "from") && isWord(t[j + 1], "current")) {
      ctx.report("search-path", tok.start, "SET search_path FROM CURRENT is not allowed");
      return;
    }
    if (!isPunct(t[j], "=") && !isWord(t[j], "to")) return;
    j += 1;
    for (;;) {
      const v = t[j];
      if (!v) break;
      const value = v.type === "string" || v.type === "qident" || v.type === "word" ? v.value : null;
      if (value === null) break;
      if (!ALLOWED_SEARCH_PATH.has(value)) {
        ctx.report(
          "search-path",
          v.start,
          `search_path may not include ${value === "default" ? "DEFAULT" : `"${value}"`}`,
        );
      }
      j += 1;
      if (!isPunct(t[j], ",")) break;
      j += 1;
    }
  });
}

/** @param {FileContext} ctx @param {Token[]} t */
function checkOwnerTo(ctx, t) {
  t.forEach((tok, k) => {
    if (isWord(tok, "owner") && isWord(t[k + 1], "to")) {
      const owner = t[k + 2];
      if (!isName(owner) || owner?.value !== V13_OWNER) {
        ctx.report(
          "owner-to",
          tok.start,
          `OWNER TO ${owner?.value ?? "?"}: V13 objects are owned by ${V13_OWNER}`,
        );
      }
    }
  });
}

/**
 * @param {FileContext} ctx
 * @param {Token[]} t tokens starting at the statement verb
 * @param {{ topLevel: boolean }} opts
 */
function analyzeHead(ctx, t, opts) {
  const head = t[0];
  if (!head || head.type !== "word") return;
  switch (head.value) {
    case "create":
      return analyzeCreate(ctx, t);
    case "alter":
      return analyzeAlter(ctx, t);
    case "drop":
      return analyzeDrop(ctx, t);
    case "grant":
      return analyzeGrant(ctx, t, false);
    case "revoke":
      return analyzeGrant(ctx, t, true);
    case "comment":
      return analyzeComment(ctx, t);
    case "truncate":
      return ctx.report("truncate", head.start, "TRUNCATE is not allowed in migrations");
    case "copy":
      return ctx.report("server-side-file-or-program", head.start, "COPY is not allowed in migrations");
    case "set":
      return analyzeSet(ctx, t);
    case "reset":
      if (isWord(t[1], "search_path") || isWord(t[1], "all")) {
        ctx.report(
          "search-path",
          head.start,
          `RESET ${t[1]?.value.toUpperCase()} would restore a search_path outside V13`,
        );
      }
      if (isWord(t[1], "session") && isWord(t[2], "authorization")) {
        ctx.report("session-role", head.start, "RESET SESSION AUTHORIZATION is not allowed");
      }
      return;
    case "load":
    case "import":
      return ctx.report(
        "statement-scope",
        head.start,
        `${head.value.toUpperCase()} is not allowed in migrations`,
      );
    case "security":
      if (isWord(t[1], "label"))
        ctx.report("statement-scope", head.start, "SECURITY LABEL is not allowed in migrations");
      return;
    case "notify":
    case "listen":
    case "unlisten":
      return ctx.report("notify-listen", head.start, `${head.value.toUpperCase()} is not allowed in V13`);
    case "reassign": {
      if (!ctx.isBootstrap)
        ctx.report("bootstrap-only-role-and-schema", head.start, "REASSIGN OWNED belongs to the bootstrap");
      const by = findTop(t, 1, ["by"]);
      const { roles } = parseRoleList(t, by + 1, ["to"]);
      const to = findTop(t, 1, ["to"]);
      const target = to === -1 ? [] : parseRoleList(t, to + 1, []).roles;
      for (const r of [...roles, ...target]) {
        if (!V13_ROLE_SET.has(r))
          ctx.report("statement-scope", head.start, `REASSIGN OWNED names role "${r}" outside V13`);
      }
      return;
    }
    default:
      if (opts.topLevel && TRANSACTION_WORDS.has(head.value)) {
        ctx.report("transaction-control", head.start, `${head.value.toUpperCase()} inside a migration file`);
      } else if (opts.topLevel && isWord(head, "prepare") && isWord(t[1], "transaction")) {
        ctx.report("transaction-control", head.start, "PREPARE TRANSACTION inside a migration file");
      }
  }
}

/** @param {FileContext} ctx @param {number} offset @param {string} what */
function bootstrapOnly(ctx, offset, what) {
  if (!ctx.isBootstrap)
    ctx.report("bootstrap-only-role-and-schema", offset, `${what} belongs to 0000_bootstrap.sql`);
}

/** @param {FileContext} ctx @param {number} offset @param {string[]} parts @param {string} verb */
function requireV13Name(ctx, offset, parts, verb) {
  if (!inV13(parts)) {
    ctx.report(
      "statement-scope",
      offset,
      `${verb} target "${display(parts)}" is not schema-qualified in ${V13_SCHEMA}`,
    );
  }
}

/** @param {FileContext} ctx @param {number} offset @param {string} role @param {string} verb */
function requireV13Role(ctx, offset, role, verb) {
  if (!V13_ROLE_SET.has(role))
    ctx.report("statement-scope", offset, `${verb} names role "${role}", which is not a V13 role`);
}

/**
 * `name ON [ONLY] table` targets (triggers, policies, rules, constraints, CREATE INDEX).
 * @param {FileContext} ctx
 * @param {Token[]} t
 * @param {number} from
 * @param {string} verb
 */
function checkOnTable(ctx, t, from, verb) {
  const on = findTop(t, from, ["on"]);
  if (on === -1)
    return ctx.report(
      "unparsed-statement",
      /** @type {Token} */ (t[0]).start,
      `${verb}: expected ON <table>`,
    );
  // ON [ONLY] table, or ON DOMAIN d for COMMENT ON CONSTRAINT c ON DOMAIN d.
  let j = skipWords(t, on + 1, ["only"]);
  j = skipWords(t, j, ["domain"]);
  const target = parseName(t, j);
  if (!target)
    return ctx.report(
      "unparsed-statement",
      /** @type {Token} */ (t[0]).start,
      `${verb}: expected a table name`,
    );
  requireV13Name(ctx, /** @type {Token} */ (t[0]).start, target.parts, verb);
  return target;
}

/** CREATE POLICY / ALTER POLICY role lists. @param {FileContext} ctx @param {Token[]} t @param {boolean} required */
function checkPolicyRoles(ctx, t, required) {
  const denyAll = isDenyAllPolicy(t);
  const on = findTop(t, 1, ["on"]);
  const to = findTop(t, on === -1 ? 1 : on, ["to"]);
  const start = /** @type {Token} */ (t[0]).start;
  if (to === -1) {
    if (required)
      ctx.report(
        "statement-scope",
        start,
        "CREATE POLICY must name the V13 role(s) with TO (the default is PUBLIC)",
      );
    return;
  }
  const { roles } = parseRoleList(t, to + 1, ["using", "with"]);
  for (const r of roles) {
    if (denyAll && r === "public") continue;
    requireV13Role(ctx, start, r, "policy");
  }
}

/**
 * AS RESTRICTIVE … USING (false) and, when present, WITH CHECK (false): the policy can only remove access.
 * @param {Token[]} t
 */
function isDenyAllPolicy(t) {
  const text = render(t);
  return (
    /\bas restrictive\b/.test(text) &&
    /\busing \( false \)/.test(text) &&
    (!/\bwith check\b/.test(text) || /\bwith check \( false \)/.test(text))
  );
}

/**
 * Role options of CREATE ROLE / ALTER ROLE (everything after the role name).
 * @param {FileContext} ctx
 * @param {Token[]} t
 * @param {number} from
 * @param {string} role
 * @param {boolean} isCreate
 */
function checkRoleAttributes(ctx, t, from, role, isCreate) {
  let j = skipWords(t, from, ["with"]);
  for (; j < t.length; j += 1) {
    const tok = /** @type {Token} */ (t[j]);
    if (tok.type !== "word") continue;
    if (ROLE_ATTRIBUTE_WORDS.has(tok.value)) {
      ctx.report("role-attributes", tok.start, `role ${role} may not have ${tok.value.toUpperCase()}`);
    } else if (tok.value === "login" && role !== V13_APP) {
      ctx.report("role-attributes", tok.start, `only ${V13_APP} may LOGIN`);
    } else if (tok.value === "password" || (tok.value === "encrypted" && isWord(t[j + 1], "password"))) {
      const value = tok.value === "encrypted" ? t[j + 2] : t[j + 1];
      if (!isWord(value, "null"))
        ctx.report("role-attributes", tok.start, "passwords never appear in Git (use PASSWORD NULL)");
      if (tok.value === "encrypted") j += 1;
      j += 1;
    } else if (isCreate && ROLE_MEMBERSHIP_CLAUSES.has(tok.value)) {
      ctx.report(
        "role-attributes",
        tok.start,
        `CREATE ROLE … ${tok.value.toUpperCase()}: grant memberships explicitly (WITH INHERIT FALSE)`,
      );
    } else if (tok.value === "valid" && isWord(t[j + 1], "until")) {
      j += 2;
    } else if (tok.value === "connection" && isWord(t[j + 1], "limit")) {
      j += 2;
    }
  }
}

/** @param {FileContext} ctx @param {Token[]} t */
function analyzeCreate(ctx, t) {
  const start = /** @type {Token} */ (t[0]).start;
  let i = skipWords(t, 1, ["or", "replace"]);
  const modifiers = new Set();
  while (t[i]?.type === "word" && CREATE_MODIFIERS.has(/** @type {Token} */ (t[i]).value)) {
    // "default" is a modifier only for CREATE DEFAULT CONVERSION.
    if (isWord(t[i], "default") && !isWord(t[i + 1], "conversion")) break;
    modifiers.add(/** @type {Token} */ (t[i]).value);
    i += 1;
  }
  const m = matchType(t, i);
  if (!m) return ctx.report("unparsed-statement", start, "cannot classify this CREATE statement");
  i = m.next;
  if (m.type === "extension") return ctx.report("create-extension", start, "CREATE EXTENSION is not allowed");
  if (GLOBAL_TYPES.has(m.type))
    return ctx.report("statement-scope", start, `CREATE ${m.type.toUpperCase()} is not allowed`);

  if (m.type === "schema") {
    bootstrapOnly(ctx, start, "CREATE SCHEMA");
    i = skipWords(t, i, ["if", "not", "exists"]);
    if (isWord(t[i], "authorization")) {
      return ctx.report(
        "statement-scope",
        start,
        "CREATE SCHEMA AUTHORIZATION <role> creates a schema named after the role",
      );
    }
    const name = parseName(t, i);
    if (!name || name.parts.length !== 1 || name.parts[0] !== V13_SCHEMA) {
      return ctx.report("statement-scope", start, `the only schema is ${V13_SCHEMA}`);
    }
    if (isWord(t[name.next], "authorization")) {
      const owner = t[name.next + 1];
      if (owner?.value !== V13_OWNER)
        ctx.report("owner-to", start, `schema ${V13_SCHEMA} is owned by ${V13_OWNER}`);
    }
    return;
  }
  if (ROLE_TYPES.has(m.type)) {
    bootstrapOnly(ctx, start, `CREATE ${m.type.toUpperCase()}`);
    const name = parseName(t, i);
    if (!name) return ctx.report("unparsed-statement", start, "CREATE ROLE without a name");
    const role = /** @type {string} */ (name.parts[0]);
    requireV13Role(ctx, start, role, "CREATE ROLE");
    return checkRoleAttributes(ctx, t, name.next, role, true);
  }
  if (m.type === "index") {
    i = skipWords(t, i, ["concurrently"]);
    i = skipWords(t, i, ["if", "not", "exists"]);
    checkOnTable(ctx, t, i, "CREATE INDEX");
    return;
  }
  if (m.type === "trigger") {
    const target = checkOnTable(ctx, t, i, "CREATE TRIGGER");
    const exec = findTop(t, i, ["execute"]);
    if (target && exec !== -1) {
      const fn = parseName(t, skipWords(t, skipWords(t, exec + 1, ["function"]), ["procedure"]));
      if (fn) requireV13Name(ctx, start, fn.parts, "trigger function");
    }
    return;
  }
  if (m.type === "policy") {
    checkOnTable(ctx, t, i, "CREATE POLICY");
    return checkPolicyRoles(ctx, t, true);
  }
  if (m.type === "rule") {
    const to = findTop(t, i, ["to"]);
    const target = to === -1 ? null : parseName(t, to + 1);
    if (!target) return ctx.report("unparsed-statement", start, "CREATE RULE: expected TO <table>");
    return requireV13Name(ctx, start, target.parts, "CREATE RULE");
  }
  if (
    m.type === "column" ||
    m.type === "constraint" ||
    m.type === "owned" ||
    m.type === "default privileges" ||
    m.type === "system"
  ) {
    return ctx.report("unparsed-statement", start, "cannot classify this CREATE statement");
  }
  if (NAMED_TYPES.has(m.type)) {
    i = skipWords(t, i, ["if", "not", "exists"]);
    const name = parseName(t, i);
    if (!name)
      return ctx.report("unparsed-statement", start, `CREATE ${m.type.toUpperCase()} without a name`);
    requireV13Name(ctx, start, name.parts, `CREATE ${m.type.toUpperCase()}`);
    if (m.type === "table" && !modifiers.has("temp") && !modifiers.has("temporary")) {
      ctx.createdTables.set(display(name.parts), start);
    }
    if (m.type === "function" || m.type === "procedure") checkSecurityDefiner(ctx, t);
    return;
  }
  return ctx.report("unparsed-statement", start, "cannot classify this CREATE statement");
}

/** @param {FileContext} ctx @param {Token[]} t */
function checkSecurityDefiner(ctx, t) {
  const text = render(t);
  if (/\bsecurity definer\b/.test(text) && !/\bset search_path (?:=|to) ''(?! ,)/.test(text)) {
    ctx.report(
      "security-definer-search-path",
      /** @type {Token} */ (t[0]).start,
      "SECURITY DEFINER requires SET search_path = '' in the same definition",
    );
  }
}

/** @param {FileContext} ctx @param {Token[]} t */
function analyzeAlter(ctx, t) {
  const start = /** @type {Token} */ (t[0]).start;
  const m = matchType(t, 1);
  if (!m) return ctx.report("unparsed-statement", start, "cannot classify this ALTER statement");
  let i = m.next;
  if (m.type === "system") return ctx.report("alter-system", start, "ALTER SYSTEM is not allowed");
  if (m.type === "extension" || GLOBAL_TYPES.has(m.type)) {
    return ctx.report("statement-scope", start, `ALTER ${m.type.toUpperCase()} is not allowed`);
  }
  if (m.type === "default privileges") return analyzeDefaultPrivileges(ctx, t, i);
  if (m.type === "schema") {
    bootstrapOnly(ctx, start, "ALTER SCHEMA");
    const name = parseName(t, i);
    if (!name || name.parts[0] !== V13_SCHEMA)
      ctx.report("statement-scope", start, `the only schema is ${V13_SCHEMA}`);
    if (name && isWord(t[name.next], "rename"))
      ctx.report("statement-scope", start, `${V13_SCHEMA} is never renamed`);
    return;
  }
  if (ROLE_TYPES.has(m.type)) {
    bootstrapOnly(ctx, start, `ALTER ${m.type.toUpperCase()}`);
    const name = parseName(t, i);
    if (!name) return ctx.report("unparsed-statement", start, "ALTER ROLE without a name");
    const role = /** @type {string} */ (name.parts[0]);
    requireV13Role(ctx, start, role, "ALTER ROLE");
    // ALTER ROLE r [IN DATABASE d] SET/RESET parameter: configuration, checked by the search-path rule.
    let j = name.next;
    if (isWord(t[j], "in") && isWord(t[j + 1], "database")) {
      ctx.report("statement-scope", start, "ALTER ROLE … IN DATABASE is not allowed");
      j += 3;
    }
    if (isWord(t[j], "set") || isWord(t[j], "reset")) return;
    if (isWord(t[j], "rename")) return ctx.report("statement-scope", start, "V13 roles are never renamed");
    return checkRoleAttributes(ctx, t, j, role, false);
  }
  if (ON_TABLE_TYPES.has(m.type)) {
    checkOnTable(ctx, t, i, `ALTER ${m.type.toUpperCase()}`);
    if (m.type === "policy") checkPolicyRoles(ctx, t, false);
    return;
  }
  if (NAMED_TYPES.has(m.type)) {
    i = skipWords(t, i, ["if", "exists"]);
    i = skipWords(t, i, ["only"]);
    const name = parseName(t, i);
    if (!name) return ctx.report("unparsed-statement", start, `ALTER ${m.type.toUpperCase()} without a name`);
    requireV13Name(ctx, start, name.parts, `ALTER ${m.type.toUpperCase()}`);
    const setSchema = findTop(t, name.next, ["schema"]);
    if (setSchema !== -1 && isWord(t[setSchema - 1], "set")) {
      const target = t[setSchema + 1];
      if (target?.value !== V13_SCHEMA)
        ctx.report("statement-scope", start, "objects never move out of the V13 schema");
    }
    if (m.type === "table" && /\benable row level security\b/.test(render(t)))
      ctx.rlsEnabled.add(display(name.parts));
    if (m.type === "function" || m.type === "procedure" || m.type === "routine") checkSecurityDefiner(ctx, t);
    return;
  }
  return ctx.report("unparsed-statement", start, "cannot classify this ALTER statement");
}

/** @param {FileContext} ctx @param {Token[]} t @param {number} from */
function analyzeDefaultPrivileges(ctx, t, from) {
  const start = /** @type {Token} */ (t[0]).start;
  bootstrapOnly(ctx, start, "ALTER DEFAULT PRIVILEGES");
  let i = from;
  /** @type {string[]} */
  const forRoles = [];
  while (i < t.length && !isWord(t[i], "grant") && !isWord(t[i], "revoke")) {
    if (isWord(t[i], "for") && (isWord(t[i + 1], "role") || isWord(t[i + 1], "user"))) {
      const list = parseRoleList(t, i + 2, ["in", "grant", "revoke"]);
      forRoles.push(...list.roles);
      i = list.next;
    } else if (isWord(t[i], "in") && isWord(t[i + 1], "schema")) {
      const list = parseNameList(t, i + 2, ["for", "grant", "revoke"]);
      for (const s of list.names) {
        if (s.length !== 1 || s[0] !== V13_SCHEMA)
          ctx.report("statement-scope", start, `default privileges IN SCHEMA ${display(s)}`);
      }
      i = list.next;
    } else {
      return ctx.report("unparsed-statement", start, "cannot read this ALTER DEFAULT PRIVILEGES statement");
    }
  }
  if (forRoles.length === 0) {
    ctx.report("statement-scope", start, `ALTER DEFAULT PRIVILEGES must name FOR ROLE ${V13_OWNER}`);
  }
  for (const r of forRoles) requireV13Role(ctx, start, r, "ALTER DEFAULT PRIVILEGES FOR ROLE");
  if (i < t.length) checkGrantees(ctx, t.slice(i), isWord(t[i], "revoke"), false);
}

/** @param {FileContext} ctx @param {Token[]} t */
function analyzeDrop(ctx, t) {
  const start = /** @type {Token} */ (t[0]).start;
  const m = matchType(t, 1);
  if (!m) return ctx.report("unparsed-statement", start, "cannot classify this DROP statement");
  let i = m.next;
  if (m.type === "extension" || GLOBAL_TYPES.has(m.type) || m.type === "system") {
    return ctx.report("statement-scope", start, `DROP ${m.type.toUpperCase()} is not allowed`);
  }
  if (m.type === "owned") {
    bootstrapOnly(ctx, start, "DROP OWNED");
    const { roles } = parseRoleList(t, skipWords(t, i, ["by"]), ["cascade", "restrict"]);
    for (const r of roles) requireV13Role(ctx, start, r, "DROP OWNED");
    return;
  }
  i = skipWords(t, i, ["concurrently"]);
  i = skipWords(t, i, ["if", "exists"]);
  if (m.type === "schema") {
    bootstrapOnly(ctx, start, "DROP SCHEMA");
    const { names } = parseNameList(t, i, ["cascade", "restrict"]);
    for (const s of names)
      if (s.length !== 1 || s[0] !== V13_SCHEMA)
        ctx.report("statement-scope", start, `DROP SCHEMA ${display(s)}`);
    return;
  }
  if (ROLE_TYPES.has(m.type)) {
    bootstrapOnly(ctx, start, "DROP ROLE");
    const { roles } = parseRoleList(t, i, []);
    for (const r of roles) requireV13Role(ctx, start, r, "DROP ROLE");
    return;
  }
  if (ON_TABLE_TYPES.has(m.type)) {
    checkOnTable(ctx, t, i, `DROP ${m.type.toUpperCase()}`);
    return;
  }
  if (NAMED_TYPES.has(m.type)) {
    const { names } = parseNameList(t, i, ["cascade", "restrict"]);
    if (names.length === 0)
      return ctx.report("unparsed-statement", start, `DROP ${m.type.toUpperCase()} without a name`);
    for (const n of names) requireV13Name(ctx, start, n, `DROP ${m.type.toUpperCase()}`);
    return;
  }
  return ctx.report("unparsed-statement", start, "cannot classify this DROP statement");
}

/**
 * Grantee checks for GRANT/REVOKE (and the GRANT/REVOKE part of ALTER DEFAULT PRIVILEGES).
 * @param {FileContext} ctx
 * @param {Token[]} t tokens starting at GRANT or REVOKE
 * @param {boolean} isRevoke
 * @param {boolean} membershipExempt bootstrap SET-only membership for postgres
 */
function checkGrantees(ctx, t, isRevoke, membershipExempt) {
  const start = /** @type {Token} */ (t[0]).start;
  const sep = findTop(t, 1, [isRevoke ? "from" : "to"]);
  if (sep === -1)
    return ctx.report("unparsed-statement", start, `${isRevoke ? "REVOKE" : "GRANT"} without grantees`);
  const { roles } = parseRoleList(t, sep + 1, ["with", "granted", "cascade", "restrict"]);
  if (isRevoke) return;
  for (const r of roles) {
    if (membershipExempt && r === "postgres") continue;
    if (FORBIDDEN_GRANTEES.has(r))
      ctx.report("forbidden-grantee", start, `GRANT … TO ${r === "public" ? "PUBLIC" : r}`);
    else requireV13Role(ctx, start, r, "GRANT");
  }
}

/** @param {FileContext} ctx @param {Token[]} t @param {boolean} isRevoke */
function analyzeGrant(ctx, t, isRevoke) {
  const start = /** @type {Token} */ (t[0]).start;
  let i = 1;
  if (isRevoke) {
    for (const opt of ["grant", "admin", "inherit", "set"]) i = skipWords(t, i, [opt, "option", "for"]);
  }
  const sepWord = isRevoke ? "from" : "to";
  const sep = findTop(t, i, [sepWord]);
  const on = findTop(t, i, ["on"]);
  if (sep === -1)
    return ctx.report("unparsed-statement", start, `${isRevoke ? "REVOKE" : "GRANT"} without grantees`);

  if (on !== -1 && on < sep) {
    checkPrivilegeTargets(ctx, t.slice(on + 1, sep), start);
    return checkGrantees(ctx, t, isRevoke, false);
  }

  // Role membership: GRANT role TO role / REVOKE role FROM role.
  bootstrapOnly(ctx, start, isRevoke ? "REVOKE <role>" : "GRANT <role>");
  const { roles } = parseRoleList(t, i, [sepWord]);
  for (const r of roles) requireV13Role(ctx, start, r, isRevoke ? "REVOKE" : "GRANT");
  if (isRevoke) return;
  const options = render(t.slice(sep + 1));
  if (!/\bwith\b.*\binherit false\b/.test(options)) {
    ctx.report("membership-options", start, "role memberships must say WITH INHERIT FALSE");
  }
  if (/\badmin (?:true|option)\b/.test(options))
    ctx.report("membership-options", start, "role memberships never carry ADMIN");
  const grantees = parseRoleList(t, sep + 1, ["with", "granted"]).roles;
  const exempt =
    ctx.isBootstrap &&
    grantees.length === 1 &&
    grantees[0] === "postgres" &&
    /\bwith inherit false , set true$/.test(options);
  checkGrantees(ctx, t, false, exempt);
}

/** @param {FileContext} ctx @param {Token[]} spec tokens between ON and TO/FROM @param {number} start */
function checkPrivilegeTargets(ctx, spec, start) {
  if (
    isWord(spec[0], "all") &&
    /^(tables|sequences|functions|procedures|routines)$/.test(spec[1]?.value ?? "")
  ) {
    if (!isWord(spec[2], "in") || !isWord(spec[3], "schema")) {
      return ctx.report("unparsed-statement", start, "expected ALL … IN SCHEMA");
    }
    const { names } = parseNameList(spec, 4);
    for (const s of names)
      if (s.length !== 1 || s[0] !== V13_SCHEMA)
        ctx.report("statement-scope", start, `privileges IN SCHEMA ${display(s)}`);
    return;
  }
  const kinds = [
    ["foreign", "data", "wrapper"],
    ["foreign", "server"],
    ["large", "object"],
    ["table"],
    ["sequence"],
    ["function"],
    ["procedure"],
    ["routine"],
    ["schema"],
    ["type"],
    ["domain"],
    ["database"],
    ["language"],
    ["tablespace"],
    ["parameter"],
  ];
  const kind = kinds.find((k) => matchWords(spec, 0, k));
  const kindName = kind ? kind.join(" ") : "table";
  if (
    [
      "foreign data wrapper",
      "foreign server",
      "large object",
      "database",
      "language",
      "tablespace",
      "parameter",
    ].includes(kindName)
  ) {
    return ctx.report("statement-scope", start, `privileges on ${kindName.toUpperCase()} are not allowed`);
  }
  const { names } = parseNameList(spec, kind ? kind.length : 0);
  if (names.length === 0) return ctx.report("unparsed-statement", start, "privilege target without a name");
  for (const n of names) {
    if (kindName === "schema") {
      if (n.length !== 1 || n[0] !== V13_SCHEMA)
        ctx.report("statement-scope", start, `privileges on schema ${display(n)}`);
    } else {
      requireV13Name(ctx, start, n, "privilege");
    }
  }
}

/** @param {FileContext} ctx @param {Token[]} t */
function analyzeComment(ctx, t) {
  const start = /** @type {Token} */ (t[0]).start;
  if (!isWord(t[1], "on")) return ctx.report("unparsed-statement", start, "expected COMMENT ON");
  const m = matchType(t, 2);
  if (!m) return ctx.report("unparsed-statement", start, "cannot classify this COMMENT statement");
  const i = m.next;
  if (m.type === "extension" || GLOBAL_TYPES.has(m.type)) {
    return ctx.report("statement-scope", start, `COMMENT ON ${m.type.toUpperCase()} is not allowed`);
  }
  if (m.type === "schema") {
    const name = parseName(t, i);
    if (!name || name.parts.length !== 1 || name.parts[0] !== V13_SCHEMA)
      ctx.report("statement-scope", start, `the only schema is ${V13_SCHEMA}`);
    return;
  }
  if (ROLE_TYPES.has(m.type)) {
    const name = parseName(t, i);
    if (name) requireV13Role(ctx, start, /** @type {string} */ (name.parts[0]), "COMMENT ON ROLE");
    return;
  }
  if (m.type === "column") {
    const name = parseName(t, i);
    if (!name || name.parts.length < 3 || name.parts[0] !== V13_SCHEMA) {
      ctx.report("statement-scope", start, `COMMENT ON COLUMN must name ${V13_SCHEMA}.<table>.<column>`);
    }
    return;
  }
  if (m.type === "constraint" || ON_TABLE_TYPES.has(m.type)) {
    checkOnTable(ctx, t, i, `COMMENT ON ${m.type.toUpperCase()}`);
    return;
  }
  if (NAMED_TYPES.has(m.type)) {
    const name = parseName(t, i);
    if (!name) return ctx.report("unparsed-statement", start, "COMMENT ON without a name");
    requireV13Name(ctx, start, name.parts, `COMMENT ON ${m.type.toUpperCase()}`);
    return;
  }
  return ctx.report("unparsed-statement", start, "cannot classify this COMMENT statement");
}

/** @param {FileContext} ctx @param {Token[]} t */
function analyzeSet(ctx, t) {
  const start = /** @type {Token} */ (t[0]).start;
  let i = 1;
  let local = false;
  if (isWord(t[i], "local")) {
    local = true;
    i += 1;
  } else if (isWord(t[i], "session")) {
    if (isWord(t[i + 1], "authorization"))
      return ctx.report("session-role", start, "SET SESSION AUTHORIZATION is not allowed");
    i += 1;
  }
  if (isWord(t[i], "role")) {
    if (!local)
      ctx.report(
        "session-role",
        start,
        "use SET LOCAL ROLE (a session-level SET ROLE outlives the transaction)",
      );
  }
}

/**
 * The owner-role rule on the top-level statements of a migration after the bootstrap.
 * @param {FileContext} ctx
 * @param {Statement[]} statements
 */
function checkOwnerRole(ctx, statements) {
  if (ctx.isBootstrap || statements.length === 0) return;
  const first = /** @type {Statement} */ (statements[0]);
  if (render(first.tokens) !== `set local role ${V13_OWNER}`) {
    ctx.report(
      "owner-role",
      first.start,
      `a migration after the bootstrap starts with SET LOCAL ROLE ${V13_OWNER};`,
    );
  }
  statements.slice(1).forEach((st, k) => {
    const text = render(st.tokens);
    const isLast = k === statements.length - 2;
    if (/^set local role\b/.test(text) && text !== `set local role ${V13_OWNER}`) {
      ctx.report("owner-role", st.start, `migrations run as ${V13_OWNER} only`);
    }
    if (text === "reset role" && !isLast)
      ctx.report("owner-role", st.start, "RESET ROLE may only be the last statement");
  });
}

// ---- Entry points -------------------------------------------------------------------------------------------

/**
 * Lints one migration's SQL text. `file` is the file name (NNNN_name.sql).
 * @param {string} file
 * @param {string} text
 * @returns {Finding[]}
 */
export function lintMigrationSource(file, text) {
  const ctx = new FileContext(file, text);
  let statements;
  try {
    statements = splitStatements(tokenize(text));
  } catch (error) {
    if (!(error instanceof SqlLexError)) throw error;
    ctx.report("unparsed-statement", error.offset, error.message);
    return ctx.findings;
  }
  if (statements.length === 0) {
    ctx.report("statement-terminator", 0, "the migration has no statements");
    return ctx.findings;
  }
  const last = /** @type {Statement} */ (statements[statements.length - 1]);
  if (!last.terminated)
    ctx.report("statement-terminator", last.start, "the last statement must end with a semicolon");
  for (const st of statements) checkStatement(ctx, st, { topLevel: true });
  checkOwnerRole(ctx, statements);
  for (const [table, offset] of ctx.createdTables) {
    if (!ctx.rlsEnabled.has(table)) {
      ctx.report(
        "rls-enabled",
        offset,
        `table ${table} has no ALTER TABLE … ENABLE ROW LEVEL SECURITY in this file`,
      );
    }
  }
  return ctx.findings;
}

/**
 * Lints every file of a migrations directory, including the file-set rules.
 * @param {string} [dir]
 * @returns {{ files: string[], findings: Finding[] }}
 */
export function lintMigrationsDir(dir = MIGRATIONS_DIR) {
  const files = listFiles(dir);
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Map<string, string>} */
  const versions = new Map();
  for (const file of files) {
    if (!MIGRATION_FILE_PATTERN.test(file)) {
      findings.push({
        rule: "file-name",
        file,
        line: 1,
        message: "file name must match NNNN_name.sql (lower-case name)",
      });
      continue;
    }
    if (!MIGRATION_NAME_PATTERN.test(nameOf(file))) {
      findings.push({
        rule: "file-name",
        file,
        line: 1,
        message: "the name part must be 3–80 characters of [a-z0-9_]",
      });
    }
    const version = file.slice(0, 4);
    const previous = versions.get(version);
    if (previous) {
      findings.push({
        rule: "contiguous-versions",
        file,
        line: 1,
        message: `version ${version} is also used by ${previous}`,
      });
    } else {
      versions.set(version, file);
    }
    findings.push(...lintMigrationSource(file, readFileSync(join(dir, file), "utf8")));
  }
  const sorted = [...versions.keys()].sort();
  sorted.forEach((version, index) => {
    const expected = String(index).padStart(4, "0");
    if (version !== expected) {
      findings.push({
        rule: "contiguous-versions",
        file: /** @type {string} */ (versions.get(version)),
        line: 1,
        message: `expected version ${expected} next (versions start at 0000 and have no gaps)`,
      });
    }
  });
  return { files, findings };
}

/** @param {Finding} f @param {string} dir */
export function formatFinding(f, dir = MIGRATIONS_DIR) {
  return `${relative(ROOT, join(dir, f.file))}:${f.line}: [${f.rule}] ${f.message}`;
}

function main() {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf("--migrations-dir");
  const dir = dirFlag === -1 ? MIGRATIONS_DIR : /** @type {string} */ (args[dirFlag + 1]);
  const { files, findings } = lintMigrationsDir(dir);
  for (const f of findings) console.error(formatFinding(f, dir));
  const summary = `db:lint: ${files.length} migration file(s), ${findings.length} finding(s), ${RULES.length} rules`;
  if (findings.length > 0) {
    console.error(`✗ ${summary}`);
    process.exit(1);
  }
  console.log(`✓ ${summary}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
