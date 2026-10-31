/**
 * CDF Notifications V13 — demo builder (W-D2). SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production.
 * Port note: moved from the reference src/demo/build_demo.js to the unit-test support folder. The port renders IN MEMORY
 * only: buildDemo() returns the manifest entries and every file's content (`contents`, a Map file → content) instead of
 * writing out/demo/; the reference's CLI entry point and optional Playwright screenshots (takeShots) are not ported.
 * Scenarios: W-C's lib/journeys/scenarios/*.json when present and in the charter shape (ids prefixed WC-), otherwise the
 * inline set (scenarios_inline.ts). For every scenario × recipient: Arabic at the three densities + English at the
 * recipient's default density; per variant the e-mail HTML, its text twin, the Adaptive Card JSON, the EML and the platform
 * page — each only when the disclosure projection allows that experience (refusals are listed, never rendered).
 * The reference wrote out/demo/scenarios/<id>/…, out/demo/index.html and out/demo/MANIFEST.json (JSON array {file, scenario,
 * recipient, density, surface, sha256, lang}); buildDemo() returns the same manifest (`files`), the index HTML (`index`) and
 * the contents. Every output carries «عرض تجريبي — بيانات اصطناعية | DESIGN_PREVIEW — SYNTHETIC DATA». Output is
 * deterministic (fixed generated_at, hashed Message-IDs and MIME boundaries), so sha256 values repeat across runs.
 * Outlook / Gmail / Apple Mail rendering of the e-mails is UNVERIFIED; nothing here claims client compatibility.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { inlineScenarios, SCENARIO_SET } from "./scenarios_inline";
import {
  buildNotificationModel,
  loadCatalogue,
  RESOLVER_NOTE,
  TEMPLATE_VERSION,
  GENERATED_AT,
  type Catalogue,
  type NotificationModel,
} from "@/lib/notifications/render/model";
import { project, loadPolicy } from "@/lib/disclosure/project";
import { loadAuthority } from "@/lib/authority/check";
import { renderEmail } from "@/lib/notifications/render/email";
import { renderPlatform } from "@/lib/notifications/render/platform";
import { DENSITIES, DEFAULT_DENSITY, type Density } from "@/lib/notifications/render/densities";
import { MARKING, pick } from "@/lib/notifications/render/i18n";
import { escHtml } from "@/lib/notifications/render/escape";
import { loadTokens, type Tokens } from "@/lib/notifications/render/tokens";
import {
  validate as wd1Validate,
  ENGINE_VERSION as WD1_ENGINE_VERSION,
  RULES_VERSION as WD1_RULES_VERSION,
} from "@/lib/notifications/consistency/engine";
import type { Scenario, Lang } from "@/lib/notifications/render/types";
import { consistencyContext, type ConsistencyContext } from "./consistency_ctx";

const HERE = dirname(fileURLToPath(import.meta.url));
/** the project root (tests/unit/notifications/support → ../../../..) */
export const ROOT = resolve(HERE, "..", "..", "..", "..");
/** W-F V13-07 (UI-09 referral, UI-11 witness): these recipients have no platform surface; e-mail only */
export const NO_PLATFORM_SURFACE = Object.freeze(["WITNESS", "REFERRING_BODY", "EVIDENCE_HOLDER"] as const);
export const SURFACES = Object.freeze(["PLATFORM", "EMAIL_HTML", "EMAIL_TEXT", "EML", "CARD"] as const);
export type Surface = (typeof SURFACES)[number];
const EXT = Object.freeze({
  EMAIL_HTML: ".email.html",
  EMAIL_TEXT: ".email.txt",
  EML: ".eml",
  CARD: ".card.json",
  PLATFORM: ".platform.html",
} as const);
const sha256 = (s: string | Uint8Array): string => createHash("sha256").update(s).digest("hex");
const safeName = (s: unknown): string => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
const isObj = (v: unknown): v is Readonly<Record<string, unknown>> =>
  !!v && typeof v === "object" && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------
// W-C scenarios (guarded): accepted only in the charter shape; otherwise the inline set serves and the reason is recorded
// ---------------------------------------------------------------------------------------------------------------
export type AdaptResult = { ok: true; scenario: Scenario } | { ok: false; why: string };
export function adaptWcScenario(s: unknown): AdaptResult {
  if (!isObj(s)) return { ok: false, why: "not an object" };
  const id = s.id ?? s.scenario_id;
  const type = s.type_code ?? s.notification_type ?? s.template_code;
  const kase = s.case ?? s.case_record ?? null;
  const obj = s.object ?? s.procedural_object ?? null;
  const events = s.events ?? s.event_stream ?? null;
  const recipients = s.recipients ?? null;
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,60}$/.test(id)) return { ok: false, why: "no usable id" };
  if (typeof type !== "string" || !type) return { ok: false, why: `${id}: no type_code` };
  if (
    !Array.isArray(events) ||
    !events.every((e: unknown) => isObj(e) && typeof e.event_id === "string" && (e.type || e.event_type))
  )
    return { ok: false, why: `${id}: events not in the charter §3.3 shape` };
  if (
    !Array.isArray(recipients) ||
    !recipients.length ||
    !recipients.every((r: unknown) => isObj(r) && typeof r.class === "string")
  )
    return { ok: false, why: `${id}: recipients without a charter §5 class` };
  if (
    kase &&
    (typeof kase !== "object" ||
      ((kase as { exists?: unknown }).exists !== false &&
        !(kase as { status?: { code?: unknown } | null }).status?.code))
  )
    return { ok: false, why: `${id}: CaseRecord without status.code` };
  if (
    obj &&
    (typeof obj !== "object" ||
      !(obj as { journey_id?: unknown }).journey_id ||
      !Array.isArray((obj as { steps?: unknown }).steps ?? []))
  )
    return { ok: false, why: `${id}: ProceduralObject without journey_id/steps` };
  const recs = (recipients as Readonly<Record<string, unknown>>[]).map((r) => ({
    ...r,
    actor: { capacity: r.class, ...(isObj(r.actor) ? r.actor : {}) },
  }));
  // the checks above establish the charter shape the Scenario type describes (open shapes; extra keys are kept)
  return {
    ok: true,
    scenario: {
      ...s,
      id: `WC-${id}`,
      source_id: id,
      type_code: type,
      case: kase,
      object: obj,
      events,
      source: "W-C src/journeys/scenarios",
      recipients: recs,
    } as unknown as Scenario,
  };
}
export interface WcScenarios {
  scenarios: Scenario[];
  notes: string[];
}
export function loadWcScenarios(dir: string = join(ROOT, "lib", "journeys", "scenarios")): WcScenarios {
  if (!existsSync(dir)) return { scenarios: [], notes: ["W-C scenarios directory absent"] };
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (!files.length) return { scenarios: [], notes: ["W-C scenarios directory present but empty"] };
  const scenarios: Scenario[] = [];
  const notes: string[] = [];
  for (const f of files) {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const list: unknown[] = Array.isArray(raw)
        ? raw
        : isObj(raw) && Array.isArray(raw.scenarios)
          ? raw.scenarios
          : [raw];
      for (const s of list) {
        const a = adaptWcScenario(s);
        if (a.ok) scenarios.push(a.scenario);
        else notes.push(`${f}: ${a.why}`);
      }
    } catch (e) {
      notes.push(`${f}: unreadable (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return { scenarios, notes };
}
export interface ScenarioSelection {
  scenarios: Scenario[];
  source: string;
  notes: string[];
}
/** W-C scenarios when at least one is usable, else the inline set */
export function selectScenarios(): ScenarioSelection {
  const wc = loadWcScenarios();
  if (wc.scenarios.length)
    return { scenarios: wc.scenarios, source: "W-C src/journeys/scenarios", notes: wc.notes };
  return { scenarios: inlineScenarios(), source: `W-D2 inline (${SCENARIO_SET})`, notes: wc.notes };
}

// W-D1 consistency engine; its result is recorded in the index, never used to widen what is rendered.
// Port note: the reference probed ../consistency/{engine,index,check}.js with a dynamic import; the port imports W-D1's
// lib/notifications/consistency/engine statically (it is part of the port), so the "absent" branches no longer occur.
export type ConsistencyFn = (ctx: ConsistencyContext) => unknown;
export interface Wd1 {
  fn: ConsistencyFn | null;
  versions?: string;
  note: string;
}
export async function loadWd1(): Promise<Wd1> {
  const fn: ConsistencyFn = (ctx) => wd1Validate(ctx);
  const versions = [WD1_ENGINE_VERSION, WD1_RULES_VERSION].filter(Boolean).join(", ");
  return {
    fn,
    versions,
    note: `W-D1 consistency/engine present (${versions || "version not stated"}) — validate() run on every rendered variant (record + projection + rendered outputs, tests/unit/notifications/support/consistency_ctx.ts); recorded in the index, never used to widen what is rendered`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// rendering (in memory)
// ---------------------------------------------------------------------------------------------------------------
export interface Variant {
  lang: Lang;
  density: Density;
}
export function variantsFor(cls: string): Variant[] {
  return [
    ...DENSITIES.map((density) => ({ lang: "ar" as const, density })),
    { lang: "en", density: DEFAULT_DENSITY[cls] ?? "STANDARD" },
  ];
}
export function fileBase(scenarioId: string, cls: string, density: string, lang: string): string {
  return `scenarios/${safeName(scenarioId)}/${safeName(scenarioId)}__${safeName(cls)}__${density}__${lang}`;
}

export interface DemoFile {
  scenario: string;
  recipient: string;
  density: Density;
  lang: Lang;
  surface: Surface;
  file: string;
  content: string;
}
export interface Refusal {
  scenario: string;
  recipient: string;
  experience: "EMAIL" | "PLATFORM";
  code: string;
  why: string;
}
export interface ConsistencyItem {
  id: string;
  reason: unknown;
  field?: unknown;
}
export interface ConsistencyAggregate {
  ok: boolean | null;
  variants: number;
  violations: ConsistencyItem[];
  warnings: ConsistencyItem[];
}
export interface DemoRecord {
  scenario: string;
  title: Scenario["title"] | null;
  recipient: string;
  recipient_ref: string | null;
  logs: Partial<Record<"EMAIL" | "PLATFORM", ReturnType<typeof project>["_disclosure_log"]>>;
  summaries: Partial<Record<"EMAIL" | "PLATFORM", ReturnType<typeof project>["_disclosure_summary"]>>;
  provenance: NotificationModel["provenance"] | null;
  consistency: Partial<Record<"EMAIL" | "PLATFORM", ConsistencyAggregate>> | null;
  outputs: number;
}
export interface RenderAllInput {
  scenarios: readonly Scenario[];
  policy?: ReturnType<typeof loadPolicy>;
  authority?: ReturnType<typeof loadAuthority>;
  tokens?: Tokens;
  consistency?: ConsistencyFn | null;
}
export interface RenderAllResult {
  files: DemoFile[];
  refusals: Refusal[];
  records: DemoRecord[];
}

/**
 * renderAll({scenarios, policy, authority, tokens, consistency}) → {files:[{file, scenario, recipient, density, surface, lang, content}],
 *   refusals:[…], records:[{scenario, title, recipient, logs, summaries, consistency}]}
 */
export function renderAll({
  scenarios,
  policy = loadPolicy(),
  authority = loadAuthority(),
  tokens = loadTokens(),
  consistency = null,
}: RenderAllInput): RenderAllResult {
  const files: DemoFile[] = [];
  const refusals: Refusal[] = [];
  const records: DemoRecord[] = [];
  const catCache = new Map<string, Catalogue>();
  const catalogueFor = (sc: Scenario): Catalogue => {
    const jids = [
      ...new Set(
        [sc.object?.journey_id, ...sc.recipients.map((r) => r.object?.journey_id)].filter(
          (x): x is string => !!x,
        ),
      ),
    ];
    const key = jids.join("|");
    let c = catCache.get(key);
    if (!c) {
      c = loadCatalogue({ needs: jids });
      catCache.set(key, c);
    }
    return c;
  };
  for (const sc of scenarios) {
    const catalogue = catalogueFor(sc);
    for (const r of sc.recipients) {
      const cls = r.class;
      const rec: DemoRecord = {
        scenario: sc.id,
        title: sc.title ?? null,
        recipient: cls,
        recipient_ref: r.ref ?? null,
        logs: {},
        summaries: {},
        provenance: null,
        consistency: null,
        outputs: 0,
      };
      for (const exp of ["EMAIL", "PLATFORM"] as const) {
        if (exp === "PLATFORM" && (NO_PLATFORM_SURFACE as readonly string[]).includes(cls)) {
          refusals.push({
            scenario: sc.id,
            recipient: cls,
            experience: exp,
            code: "NO_PLATFORM_SURFACE",
            why: "W-F V13-07 (UI-09 referral / UI-11 witness): e-mail only for this recipient",
          });
          continue;
        }
        for (const [i, v] of variantsFor(cls).entries()) {
          const model = buildNotificationModel(sc, r, { lang: v.lang, authority, catalogue });
          const projected = project(model, {
            recipient: cls,
            channel: exp,
            context: model.meta.context,
            policy,
          });
          if (i === 0) {
            rec.logs[exp] = projected._disclosure_log;
            rec.summaries[exp] = projected._disclosure_summary;
            rec.provenance = model.provenance;
          }
          const base = fileBase(sc.id, cls, v.density, v.lang);
          const meta = { scenario: sc.id, recipient: cls, density: v.density, lang: v.lang };
          let rendered: string[] = [];
          let refused = false;
          try {
            if (exp === "EMAIL") {
              const to = r.email
                ? { address: r.email, display: r.display ? pick(r.display, v.lang) : "" }
                : null;
              const out = renderEmail(projected, { lang: v.lang, density: v.density, tokens, to });
              if (out.card_errors.length)
                throw Object.assign(new Error(`card invalid: ${out.card_errors.join("; ")}`), {
                  code: "CARD_INVALID",
                });
              files.push({ ...meta, surface: "EMAIL_HTML", file: base + EXT.EMAIL_HTML, content: out.html });
              files.push({ ...meta, surface: "EMAIL_TEXT", file: base + EXT.EMAIL_TEXT, content: out.text });
              files.push({
                ...meta,
                surface: "CARD",
                file: base + EXT.CARD,
                content: JSON.stringify(out.card, null, 2) + "\n",
              });
              if (out.eml) files.push({ ...meta, surface: "EML", file: base + EXT.EML, content: out.eml });
              rec.outputs += out.eml ? 4 : 3;
              rendered = [out.html, out.text, JSON.stringify(out.card), out.eml ?? ""];
            } else {
              const out = renderPlatform(projected, { lang: v.lang, density: v.density, tokens });
              files.push({ ...meta, surface: "PLATFORM", file: base + EXT.PLATFORM, content: out.html });
              rec.outputs += 1;
              rendered = [out.html];
            }
          } catch (e) {
            const code = isObj(e) ? e.code : undefined;
            if (!code) throw e;
            refusals.push({
              scenario: sc.id,
              recipient: cls,
              experience: exp,
              code: String(code),
              why: e instanceof Error ? e.message : String(e),
            });
            refused = true;
          }
          // W-D1 validate() on every rendered variant (record, projection and rendered outputs); one aggregate per experience
          if (consistency && projected._disclosure_summary?.suppressed !== true) {
            rec.consistency = rec.consistency ?? {};
            const agg: ConsistencyAggregate =
              rec.consistency[exp] ??
              (rec.consistency[exp] = { ok: true, variants: 0, violations: [], warnings: [] });
            const key = (x: ConsistencyItem): string =>
              `${x.id}|${String(x.reason)}|${String(x.field ?? "")}`;
            const add = (list: ConsistencyItem[], x: ConsistencyItem): void => {
              const k = key(x);
              if (!list.some((y) => key(y) === k)) list.push(x);
            };
            const flat = (v2: unknown): ConsistencyItem[] => {
              const o = isObj(v2) ? v2 : {};
              const d = o.detail;
              const items: unknown[] =
                isObj(d) && d.reason === "MULTIPLE" && Array.isArray(d.items) ? d.items : [d];
              return items.map((x) => ({
                id: String(o.id),
                reason: isObj(x) ? (x.reason ?? null) : null,
                ...(isObj(x) && x.field ? { field: x.field } : {}),
              }));
            };
            try {
              const res = consistency(
                consistencyContext({ scenario: sc, recipient: r, model, projected, catalogue, rendered }),
              );
              const resObj = isObj(res) ? res : null;
              agg.variants += 1;
              if (resObj?.ok !== true) agg.ok = false;
              const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
              for (const x of list(resObj?.violations).flatMap(flat)) add(agg.violations, x);
              for (const x of list(resObj?.warnings).flatMap(flat)) add(agg.warnings, x);
            } catch (e) {
              agg.ok = null;
              add(agg.violations, { id: "CALL_FAILED", reason: e instanceof Error ? e.name : "Error" });
            }
          }
          if (refused) break; // the same projection refuses every variant of this experience
        }
      }
      records.push(rec);
    }
  }
  return { files, refusals, records };
}

// ---------------------------------------------------------------------------------------------------------------
// index.html (gallery, disclosure logs, refusals). No component markers, no Layer A/B markers, no field values.
// ---------------------------------------------------------------------------------------------------------------
const OUTCOME_ORDER = ["ALLOWED", "SAFE_REFERENCE", "GENERALIZED", "REDACTED", "PROHIBITED"] as const;
export interface RenderIndexInput {
  files: readonly DemoFile[];
  refusals: readonly Refusal[];
  records: readonly DemoRecord[];
  info: Readonly<Record<string, unknown>>;
}
export function renderIndex({ files, refusals, records, info }: RenderIndexInput): string {
  const e = escHtml;
  const byKey = new Map<string, DemoFile[]>();
  for (const f of files) {
    const k = `${f.scenario}|${f.recipient}`;
    const l = byKey.get(k) ?? [];
    if (!byKey.has(k)) byKey.set(k, l);
    l.push(f);
  }
  const scenarioIds = [...new Set(records.map((r) => r.scenario))];
  const rows: string[] = [];
  type LogEntry = { outcome?: unknown; basis?: readonly unknown[] } | undefined;
  const logOf = (r: DemoRecord, exp: "EMAIL" | "PLATFORM", f: string): LogEntry => {
    const l = r.logs[exp] as Readonly<Record<string, LogEntry>> | undefined;
    return l && Object.hasOwn(l, f) ? l[f] : undefined;
  };
  for (const sid of scenarioIds) {
    const recs = records.filter((r) => r.scenario === sid);
    const title = recs[0]?.title;
    rows.push(
      `<section class="sc" aria-labelledby="sc-${e(safeName(sid))}"><h2 id="sc-${e(safeName(sid))}">${e(sid)} — ${e(title ? pick(title, "ar") : "")} <span class="en" lang="en" dir="ltr">${e(title ? pick(title, "en") : "")}</span></h2>`,
    );
    for (const r of recs) {
      const fl = byKey.get(`${sid}|${r.recipient}`) ?? [];
      const links = fl
        .map((f) => `<li><a href="${e(f.file)}">${e(f.surface)} · ${e(f.density)} · ${e(f.lang)}</a></li>`)
        .join("");
      const ref = refusals
        .filter((x) => x.scenario === sid && x.recipient === r.recipient)
        .map((x) => `<li><strong>${e(x.experience)}</strong>: ${e(x.code)} — ${e(x.why)}</li>`)
        .join("");
      const sum = (exp: "EMAIL" | "PLATFORM"): string => {
        const s = r.summaries[exp] as
          | { counts?: Readonly<Record<string, number>>; suppressed?: unknown; channel_prohibited?: unknown }
          | undefined;
        if (!s) return "—";
        return (
          OUTCOME_ORDER.map((o) => `${o} ${s.counts?.[o] ?? 0}`).join(" · ") +
          (s.suppressed ? " · SUPPRESSED" : "") +
          (s.channel_prohibited ? " · CHANNEL_PROHIBITED" : "")
        );
      };
      const fields = [
        ...new Set([...Object.keys(r.logs.EMAIL ?? {}), ...Object.keys(r.logs.PLATFORM ?? {})]),
      ];
      const logRows = fields
        .map(
          (f) =>
            `<tr><th scope="row"><code>${e(f)}</code></th><td>${e(logOf(r, "EMAIL", f)?.outcome ?? "—")}</td><td>${e(logOf(r, "PLATFORM", f)?.outcome ?? "—")}</td><td>${e((logOf(r, "EMAIL", f) ?? logOf(r, "PLATFORM", f))?.basis?.join(", ") ?? "")}</td></tr>`,
        )
        .join("");
      const prov = r.provenance as {
        catalogue?: unknown;
        resolver?: unknown;
        authority_version?: unknown;
        downgraded_steps?: readonly string[];
      } | null;
      rows.push(`<article class="rc"><h3>${e(r.recipient)}</h3>
<p class="meta">EMAIL: ${e(sum("EMAIL"))}<br>PLATFORM: ${e(sum("PLATFORM"))}</p>
<p class="meta">catalogue: ${e(prov?.catalogue ?? "—")} · resolver: ${e(prov?.resolver ?? "—")} · authority: ${e(prov?.authority_version ?? "—")}${prov?.downgraded_steps?.length ? ` · steps shown below their claimed state: ${e(prov.downgraded_steps.join(", "))}` : ""}</p>
${
  r.consistency
    ? `<p class="meta">W-D1 consistency: ${Object.entries(r.consistency)
        .map(
          ([x, c]) =>
            `${e(x)} (${c.variants ?? 0} variants) ${c.ok === true ? "ok" : c.ok === false ? "BLOCK " + e(c.violations.map((v) => v.id + (v.reason ? ":" + String(v.reason) : "") + (v.field ? ":" + String(v.field) : "")).join(", ")) : "not run"}${c.warnings.length ? " · WARN " + e(c.warnings.map((v) => v.id + (v.reason ? ":" + String(v.reason) : "")).join(", ")) : ""}`,
        )
        .join(" — ")}</p>`
    : ""
}
${links ? `<ul class="files">${links}</ul>` : '<p class="meta">لا مخرجات (انظر الرفض أدناه) — no outputs (see refusals)</p>'}
${ref ? `<ul class="refusals">${ref}</ul>` : ""}
<details><summary>سجل الإفصاح لكل حقل — disclosure log per field</summary><div class="tw"><table><thead><tr><th scope="col">field</th><th scope="col">EMAIL</th><th scope="col">PLATFORM</th><th scope="col">basis</th></tr></thead><tbody>${logRows}</tbody></table></div></details>
</article>`);
    }
    rows.push("</section>");
  }
  const counts = SURFACES.map((s) => `${s} ${files.filter((f) => f.surface === s).length}`).join(" · ");
  const infoRows = Object.entries(info)
    .map(([k, v]) => `<li><strong>${e(k)}</strong>: ${e(Array.isArray(v) ? v.join(" | ") : String(v))}</li>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>معرض الإشعارات — DESIGN_PREVIEW</title>
<style>
body{margin:0;font-family:Tahoma,Arial,sans-serif;background:#f4f5f7;color:#1f2933;line-height:1.6}
.marking{margin:0;padding:0.625rem 1rem;background:#fff4c2;font-weight:700}
main{max-inline-size:72rem;margin-inline:auto;padding:1rem}
.sc{background:#fff;border:0.0625rem solid #d5dae1;margin-block:1rem;padding:1rem}
.rc{border-block-start:0.0625rem solid #e4e7eb;padding-block:0.75rem}
.meta{font-size:0.875rem;color:#3e4c59}.en{font-size:0.875rem;color:#52606d}
.files{display:flex;flex-wrap:wrap;gap:0.25rem 1rem;padding:0;list-style:none;font-size:0.875rem}
.refusals{font-size:0.875rem;color:#8a4b00}
.tw{overflow-x:auto}table{border-collapse:collapse;font-size:0.8125rem}th,td{border:0.0625rem solid #d5dae1;padding:0.25rem 0.5rem;text-align:start}
a:focus-visible,summary:focus-visible{outline:0.1875rem solid #1f5fbf;outline-offset:0.125rem}
</style></head>
<body>
<header><p class="marking">${e(MARKING)}</p></header>
<main>
<h1>معرض إشعارات V13 التجريبي — V13 notification demo gallery</h1>
<p>عرض تصميمي ببيانات اصطناعية فقط؛ ليس منصة الصندوق الإنتاجية. عرض رسائل البريد في Outlook وGmail وApple Mail غير متحقق منه (UNVERIFIED). — A design preview with synthetic data only; not CDF production. E-mail rendering in Outlook, Gmail and Apple Mail is UNVERIFIED.</p>
<ul class="meta">${infoRows}<li><strong>outputs</strong>: ${e(counts)} · total ${files.length} · refusals ${refusals.length}</li></ul>
${rows.join("\n")}
</main>
<footer><p class="marking">${e(MARKING)}</p></footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------------------------
// buildDemo (in memory): the reference's out/demo/MANIFEST.json entries, index.html and file contents, nothing written
// ---------------------------------------------------------------------------------------------------------------
export interface ManifestEntry {
  file: string;
  scenario: string;
  recipient: string;
  density: Density;
  surface: Surface;
  sha256: string;
  lang: Lang;
}
export interface BuiltDemo {
  files: ManifestEntry[];
  contents: Map<string, string>;
  index: string;
  manifestJson: string;
  refusals: Refusal[];
  records: DemoRecord[];
  info: Readonly<Record<string, unknown>>;
}
export async function buildDemo({
  scenarios = null,
}: { scenarios?: readonly Scenario[] | null } = {}): Promise<BuiltDemo> {
  const sel: ScenarioSelection = scenarios
    ? { scenarios: [...scenarios], source: "caller", notes: [] }
    : selectScenarios();
  const policy = loadPolicy();
  const authority = loadAuthority();
  const tokens = loadTokens();
  const wd1 = await loadWd1();
  const { files, refusals, records } = renderAll({
    scenarios: sel.scenarios,
    policy,
    authority,
    tokens,
    consistency: wd1.fn,
  });
  const manifest: ManifestEntry[] = [];
  const contents = new Map<string, string>();
  for (const f of files) {
    if (f.file.startsWith("/") || f.file.split("/").includes(".."))
      throw new Error(`refusing to place a file outside the output directory: ${f.file}`);
    contents.set(f.file, f.content);
    manifest.push({
      file: f.file,
      scenario: f.scenario,
      recipient: f.recipient,
      density: f.density,
      surface: f.surface,
      sha256: sha256(Buffer.from(f.content, "utf8")),
      lang: f.lang,
    });
  }
  const info = {
    marking: MARKING,
    generated_at: GENERATED_AT,
    template_version: TEMPLATE_VERSION,
    scenarios: `${sel.source} (${sel.scenarios.length})`,
    scenario_notes: sel.notes.length ? sel.notes : ["—"],
    policy: `${policy.version} (${policy.status}, ${policy.source})`,
    authority: `${authority.version} (${authority.status}, ${authority.source})`,
    resolver: RESOLVER_NOTE(),
    consistency: wd1.note,
    tokens: tokens.source ?? "V12 + v4 template (W-E design/tokens.json not present)",
  };
  const index = renderIndex({ files, refusals, records, info });
  const manifestJson = JSON.stringify(manifest, null, 1) + "\n";
  return { files: manifest, contents, index, manifestJson, refusals, records, info };
}
