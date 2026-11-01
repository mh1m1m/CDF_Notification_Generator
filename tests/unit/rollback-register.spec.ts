// V13-DB-018 · REQ-DATA-023: every migration has a rollback register entry (docs/architecture/DATA_MODEL.md §9) whose
// object lists equal the migration's own CREATE, DROP and ALTER TABLE … ADD statements. Planted faults show each
// check fails. Static only: nothing here runs against a database. SYNTHETIC fixtures only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMigrations } from "@/scripts/db/lib/migrations.mjs";
import {
  REGISTER_FILE,
  checkRegister,
  checkRepositoryRegister,
  migrationObjects,
  parseRegister,
} from "@/scripts/db/rollback-register.mjs";

const migrations = readMigrations();
const markdown = readFileSync(REGISTER_FILE, "utf8");

/** The register with one migration's block changed by `edit`. */
function withBlock(file: string, edit: (block: string) => string): string {
  const start = markdown.indexOf(`### ${file}\n`);
  expect(start, `block ${file}`).toBeGreaterThan(0);
  const next = markdown.indexOf("\n### ", start + 4);
  const end = next < 0 ? markdown.length : next;
  return markdown.slice(0, start) + edit(markdown.slice(start, end)) + markdown.slice(end);
}

describe("REQ-DATA-023 rollback register: the repository", () => {
  it("has an entry for every migration and agrees with every migration (control)", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(11);
    expect([...parseRegister(markdown).keys()]).toEqual(migrations.map((m) => m.file));
    expect(checkRepositoryRegister()).toEqual([]);
  });

  it("reads the objects the migrations create, replace and alter", () => {
    const by = (file: string) => {
      const m = migrations.find((x) => x.file === file);
      if (!m) throw new Error(file);
      return migrationObjects(m.file, m.sql);
    };
    expect(by("0000_bootstrap.sql").Creates).toContain("role cdf_v13_app");
    expect(by("0002_case_registry.sql").Alters).toEqual(["constraint audit_event_case_fk on audit_event"]);
    expect(by("0006_case_workspace_reads.sql").Replaces).toEqual(["function case_header"]);
    expect(by("0008_my_work_case_columns.sql")).toEqual({
      Creates: [],
      Replaces: ["function my_work_tasks"],
      Drops: [],
      Alters: [],
    });
    expect(by("0009_fk_index_review.sql").Replaces).toEqual(["index notification_event_notification_idx"]);
  });

  it("every entry names a data-loss statement, the local reset and the hosted forward fix", () => {
    for (const [file, entry] of parseRegister(markdown)) {
      expect(String(entry["Data lost on revert"]).length, file).toBeGreaterThan(10);
      expect(String(entry.Local), file).toContain("pnpm db:reset");
      expect(String(entry.Hosted), file).toContain("forward-fix migration");
    }
  });
});

describe("REQ-DATA-023 rollback register: planted faults fail", () => {
  it("a migration without an entry", () => {
    const md = markdown.replace(/### 0007_claims_key_state\.sql\n/, "### 0007_removed_entry.sql\n");
    expect(checkRegister({ migrations, markdown: md })).toEqual([
      "0007_claims_key_state.sql: no rollback register entry",
      "0007_removed_entry.sql: register entry without a migration file",
    ]);
  });

  it("a new migration file the register does not know", () => {
    const extra = {
      file: "0011_planted.sql",
      sql: "set local role cdf_v13_owner;\ncreate table cdf_notifications_v13.planted (id uuid primary key);\nreset role;\n",
    };
    expect(checkRegister({ migrations: [...migrations, extra], markdown })).toEqual([
      "0011_planted.sql: no rollback register entry",
    ]);
  });

  it("a wrong object, a missing object and an object the migration replaces listed as created", () => {
    const wrong = withBlock("0007_claims_key_state.sql", (b) =>
      b.replace("`function claims_key_state`", "`function claims_key_status`"),
    );
    expect(checkRegister({ migrations, markdown: wrong })).toEqual([
      "0007_claims_key_state.sql: Creates omits function claims_key_state",
      "0007_claims_key_state.sql: Creates lists function claims_key_status, which the migration does not",
    ]);

    const missing = withBlock("0010_notification_operations_reads.sql", (b) =>
      b.replace("`index notification_created_idx`, ", ""),
    );
    expect(checkRegister({ migrations, markdown: missing })).toEqual([
      "0010_notification_operations_reads.sql: Creates omits index notification_created_idx",
    ]);

    const moved = withBlock("0008_my_work_case_columns.sql", (b) =>
      b
        .replace("- **Creates:** none", "- **Creates:** `function my_work_tasks`")
        .replace("- **Replaces:** `function my_work_tasks`", "- **Replaces:** none"),
    );
    expect(checkRegister({ migrations, markdown: moved })).toEqual([
      "0008_my_work_case_columns.sql: Creates lists function my_work_tasks, which the migration does not",
      "0008_my_work_case_columns.sql: Replaces omits function my_work_tasks",
    ]);

    const noAlter = withBlock("0002_case_registry.sql", (b) =>
      b.replace("- **Alters:** `constraint audit_event_case_fk on audit_event`", "- **Alters:** none"),
    );
    expect(checkRegister({ migrations, markdown: noAlter })).toEqual([
      "0002_case_registry.sql: Alters omits constraint audit_event_case_fk on audit_event",
    ]);
  });

  it("a migration that gains an object the register does not list", () => {
    const changed = migrations.map((m) =>
      m.file === "0005_workspace_switch.sql"
        ? {
            ...m,
            sql: `${m.sql}\ncreate policy planted_policy on cdf_notifications_v13.task for select using (false);\n`,
          }
        : m,
    );
    expect(checkRegister({ migrations: changed, markdown })).toEqual([
      "0005_workspace_switch.sql: Creates omits policy planted_policy",
    ]);
  });

  it("a missing field, an empty strategy and a hosted strategy without the forward fix", () => {
    const md = withBlock("0005_workspace_switch.sql", (b) =>
      b
        .replace(/- \*\*Drops:\*\* none\n/, "")
        .replace(/- \*\*Local:\*\* .*\n/, "- **Local:**\n")
        .replace(
          /- \*\*Hosted:\*\* [^\n]*\n(?: {2}\S[^\n]*\n)*/,
          "- **Hosted:** roll it back by hand somehow.\n",
        ),
    );
    expect(checkRegister({ migrations, markdown: md })).toEqual([
      "0005_workspace_switch.sql: field 'Drops' missing",
      "0005_workspace_switch.sql: field 'Local' missing or empty",
      "0005_workspace_switch.sql: Hosted strategy must name the forward-fix migration",
    ]);
  });

  it("a CREATE or DROP form the checker does not know is refused, not ignored", () => {
    expect(() => migrationObjects("0011_x.sql", "create extension pgcrypto;")).toThrow(
      /CREATE form not known/,
    );
    expect(() => migrationObjects("0011_x.sql", "drop aggregate cdf_notifications_v13.a(int);")).toThrow(
      /DROP form not known/,
    );
  });

  it("comments, strings and function bodies never count as statements", () => {
    const sql = [
      "-- create table cdf_notifications_v13.in_comment (id int);",
      "/* drop table cdf_notifications_v13.in_block */",
      "create function cdf_notifications_v13.f() returns text language sql as $$ select 'create table x (id int)' $$;",
      "do $do$ begin execute 'create table cdf_notifications_v13.dynamic (id int)'; end $do$;",
    ].join("\n");
    expect(migrationObjects("0011_x.sql", sql)).toEqual({
      Creates: ["function f"],
      Replaces: [],
      Drops: [],
      Alters: [],
    });
  });
});
