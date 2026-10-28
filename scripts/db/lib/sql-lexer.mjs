// @ts-check
// Minimal PostgreSQL lexer for static checks on migration files (scripts/db/lint-migrations.mjs).
// It understands comments (-- and nested /* */), string constants ('…', E'…', U&'…', B'…', X'…', N'…'),
// dollar quoting ($tag$…$tag$), quoted identifiers ("…"), and splits statements on top-level semicolons,
// including SQL-standard function bodies (BEGIN ATOMIC … END). It never executes anything.

/**
 * @typedef {"word" | "qident" | "string" | "dollar" | "number" | "param" | "punct"} TokenType
 * @typedef {{ type: TokenType, value: string, start: number, end: number, tag?: string, bodyStart?: number }} Token
 * @typedef {{ tokens: Token[], start: number, end: number, terminated: boolean }} Statement
 */

export class SqlLexError extends Error {
  /** @param {string} message @param {number} offset */
  constructor(message, offset) {
    super(message);
    this.name = "SqlLexError";
    this.offset = offset;
  }
}

const IDENT_START = /[A-Za-z_\u0080-￿]/;
const IDENT_PART = /[A-Za-z0-9_$\u0080-￿]/;
const DOLLAR_TAG = /\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;
const OPERATOR_CHARS = "+-*/<>=~!@#%^&|`?";
const SINGLE_PUNCT = "()[],;.:";

/**
 * Splits SQL text into tokens. Comments and whitespace are dropped.
 * @param {string} sql
 * @param {number} [base] offset added to every position (for nested bodies)
 * @returns {Token[]}
 */
export function tokenize(sql, base = 0) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  const n = sql.length;

  /** @param {number} from @param {boolean} backslashEscapes */
  const readString = (from, backslashEscapes) => {
    // `from` points at the opening quote.
    let j = from + 1;
    let value = "";
    while (j < n) {
      const c = sql[j];
      if (backslashEscapes && c === "\\") {
        value += sql[j + 1] ?? "";
        j += 2;
        continue;
      }
      if (c === "'") {
        if (sql[j + 1] === "'") {
          value += "'";
          j += 2;
          continue;
        }
        return { value, end: j + 1 };
      }
      value += c;
      j += 1;
    }
    throw new SqlLexError("unterminated string constant", base + from);
  };

  while (i < n) {
    const c = /** @type {string} */ (sql[i]);

    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
      i += 1;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (depth > 0) throw new SqlLexError("unterminated block comment", base + i);
      i = j;
      continue;
    }
    if (c === "'") {
      const s = readString(i, false);
      tokens.push({ type: "string", value: s.value, start: base + i, end: base + s.end });
      i = s.end;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let value = "";
      for (;;) {
        if (j >= n) throw new SqlLexError("unterminated quoted identifier", base + i);
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          break;
        }
        value += sql[j];
        j += 1;
      }
      tokens.push({ type: "qident", value, start: base + i, end: base + j + 1 });
      i = j + 1;
      continue;
    }
    if (c === "$") {
      DOLLAR_TAG.lastIndex = i;
      const m = DOLLAR_TAG.exec(sql);
      if (m) {
        const delimiter = m[0];
        const bodyStart = i + delimiter.length;
        const close = sql.indexOf(delimiter, bodyStart);
        if (close === -1) throw new SqlLexError(`unterminated dollar-quoted string ${delimiter}`, base + i);
        tokens.push({
          type: "dollar",
          value: sql.slice(bodyStart, close),
          tag: delimiter,
          start: base + i,
          end: base + close + delimiter.length,
          bodyStart: base + bodyStart,
        });
        i = close + delimiter.length;
        continue;
      }
      let j = i + 1;
      while (j < n && /[0-9]/.test(/** @type {string} */ (sql[j]))) j += 1;
      tokens.push({ type: "param", value: sql.slice(i, j), start: base + i, end: base + j });
      i = j;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(/** @type {string} */ (sql[j]))) j += 1;
      const raw = sql.slice(i, j);
      const lower = raw.toLowerCase();
      // String constants with a prefix: E'…' (backslash escapes), B'…', X'…', N'…', U&'…'.
      if (sql[j] === "'" && (lower === "e" || lower === "b" || lower === "x" || lower === "n")) {
        const s = readString(j, lower === "e");
        tokens.push({ type: "string", value: s.value, start: base + i, end: base + s.end });
        i = s.end;
        continue;
      }
      if (lower === "u" && sql[j] === "&" && sql[j + 1] === "'") {
        const s = readString(j + 1, false);
        tokens.push({ type: "string", value: s.value, start: base + i, end: base + s.end });
        i = s.end;
        continue;
      }
      tokens.push({ type: "word", value: lower, start: base + i, end: base + j });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      const m = /[0-9_]*\.?[0-9_]*(?:[eE][+-]?[0-9]+)?/y;
      m.lastIndex = i;
      const found = m.exec(sql);
      const j = found && found[0].length > 0 ? i + found[0].length : i + 1;
      tokens.push({ type: "number", value: sql.slice(i, j), start: base + i, end: base + j });
      i = j;
      continue;
    }
    if (c === ":" && sql[i + 1] === ":") {
      tokens.push({ type: "punct", value: "::", start: base + i, end: base + i + 2 });
      i += 2;
      continue;
    }
    if (c === ":" && sql[i + 1] === "=") {
      tokens.push({ type: "punct", value: ":=", start: base + i, end: base + i + 2 });
      i += 2;
      continue;
    }
    if (SINGLE_PUNCT.includes(c)) {
      tokens.push({ type: "punct", value: c, start: base + i, end: base + i + 1 });
      i += 1;
      continue;
    }
    if (OPERATOR_CHARS.includes(c)) {
      let j = i;
      while (
        j < n &&
        OPERATOR_CHARS.includes(/** @type {string} */ (sql[j])) &&
        !(sql[j] === "-" && sql[j + 1] === "-") &&
        !(sql[j] === "/" && sql[j + 1] === "*")
      ) {
        j += 1;
      }
      if (j === i) j = i + 1;
      tokens.push({ type: "punct", value: sql.slice(i, j), start: base + i, end: base + j });
      i = j;
      continue;
    }
    throw new SqlLexError(`unexpected character ${JSON.stringify(c)}`, base + i);
  }
  return tokens;
}

/**
 * Groups tokens into statements on top-level semicolons. A SQL-standard body (BEGIN ATOMIC … END) keeps its inner
 * semicolons; CASE … END inside it is tracked so its END does not close the body.
 * @param {Token[]} tokens
 * @returns {Statement[]}
 */
export function splitStatements(tokens) {
  /** @type {Statement[]} */
  const statements = [];
  /** @type {Token[]} */
  let current = [];
  let atomicDepth = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    const t = /** @type {Token} */ (tokens[k]);
    if (t.type === "punct" && t.value === ";" && atomicDepth === 0) {
      if (current.length > 0) {
        statements.push({
          tokens: current,
          start: /** @type {Token} */ (current[0]).start,
          end: t.end,
          terminated: true,
        });
      }
      current = [];
      continue;
    }
    if (t.type === "word") {
      const next = tokens[k + 1];
      if (t.value === "begin" && next?.type === "word" && next.value === "atomic") {
        atomicDepth += 1;
      } else if (atomicDepth > 0 && t.value === "case") {
        atomicDepth += 1;
      } else if (atomicDepth > 0 && t.value === "end") {
        atomicDepth -= 1;
      }
    }
    current.push(t);
  }
  if (current.length > 0) {
    statements.push({
      tokens: current,
      start: /** @type {Token} */ (current[0]).start,
      end: /** @type {Token} */ (current[current.length - 1]).end,
      terminated: false,
    });
  }
  return statements;
}

/**
 * Renders tokens as normalised text for pattern checks: lower-case words, "quoted" identifiers, '' for an empty
 * string and '?' for any other string, $…$ for dollar-quoted bodies; one space between tokens, none around ".".
 * @param {Token[]} tokens
 */
export function render(tokens) {
  let out = "";
  /** @type {Token | undefined} */
  let prev;
  for (const t of tokens) {
    let text;
    switch (t.type) {
      case "qident":
        text = `"${t.value}"`;
        break;
      case "string":
        text = t.value === "" ? "''" : "'?'";
        break;
      case "dollar":
        text = "$…$";
        break;
      default:
        text = t.value;
    }
    const glue =
      prev === undefined ||
      (prev.type === "punct" && prev.value === ".") ||
      (t.type === "punct" && t.value === ".");
    out += glue ? text : ` ${text}`;
    prev = t;
  }
  return out;
}

/**
 * 1-based line number of an offset.
 * @param {string} text
 * @param {number} offset
 */
export function lineOf(text, offset) {
  let line = 1;
  for (let k = 0; k < offset && k < text.length; k += 1) if (text.charCodeAt(k) === 10) line += 1;
  return line;
}
