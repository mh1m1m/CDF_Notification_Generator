// lib/journeys/index.ts — W-C (V13-05, V13-06). Journey catalogue, synthetic scenarios and the resolver/progress API.
// SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production. The catalogue and the scenarios are synthetic
// reference data shipped as static JSON (no file loading at run time).
//
// The JSON files are the reference data verbatim (only the synthetic case reference literal follows
// CDF-DEMO-2026-NNNN). This module is the one place where they are given their declared types.

import catalogueJson from "./catalogue_v13.json";
import scenarioIndexJson from "./scenarios/index.json";
import sc_CF_15 from "./scenarios/CF-15.json";
import sc_CF_16 from "./scenarios/CF-16.json";
import sc_CF_17 from "./scenarios/CF-17.json";
import sc_CF_18 from "./scenarios/CF-18.json";
import sc_CF_19 from "./scenarios/CF-19.json";
import sc_CF_23b from "./scenarios/CF-23b.json";
import sc_CF_25 from "./scenarios/CF-25.json";
import sc_CF_27 from "./scenarios/CF-27.json";
import sc_CF_28 from "./scenarios/CF-28.json";
import sc_CF_31 from "./scenarios/CF-31.json";
import sc_CF_33 from "./scenarios/CF-33.json";
import sc_CF_34 from "./scenarios/CF-34.json";
import sc_CF_35 from "./scenarios/CF-35.json";
import sc_CF_36 from "./scenarios/CF-36.json";
import sc_CF_37 from "./scenarios/CF-37.json";
import sc_EC_01 from "./scenarios/EC-01.json";
import sc_NOCASE_01 from "./scenarios/NOCASE-01.json";
import sc_REO_01 from "./scenarios/REO-01.json";
import sc_RET_01 from "./scenarios/RET-01.json";
import sc_SUM_01 from "./scenarios/SUM-01.json";
import sc_SUS_01 from "./scenarios/SUS-01.json";
import sc_WIT_01 from "./scenarios/WIT-01.json";
import type {
  Bilingual,
  CaseRecordInput,
  Catalogue,
  JourneyEvent,
  Payload,
  ProceduralObjectInput,
} from "./resolve";

export * from "./resolve";
export * from "./progress";

// ------------------------------------------------------------------ scenario fixture types (scenarios/*.json)
export interface ScenarioExpectedL1Stage {
  readonly code: string;
  readonly layer: "A" | "B";
  readonly state?: string;
  readonly kind?: string;
  readonly current?: boolean;
  readonly note?: string;
  readonly reopened?: boolean;
  readonly previously_visited?: boolean;
}
export interface ScenarioExpectedL1 {
  readonly stage: string | null;
  readonly substate: string | null;
  readonly current_state: string | null;
  readonly derivation: string;
  readonly stages: readonly ScenarioExpectedL1Stage[];
  readonly flags?: Readonly<Record<string, boolean>>;
}
export interface ScenarioViewExpectation {
  readonly level1?: null;
  readonly l1_mode?: string;
  readonly hidden?: readonly string[];
  readonly summary5?: number | null;
}
export interface ScenarioExpected {
  readonly l1?: ScenarioExpectedL1 | null;
  readonly actual?: readonly {
    readonly step_id: string;
    readonly state: string;
    readonly evidence_event_id?: string | null;
    readonly note?: string;
    readonly stage_level?: boolean;
  }[];
  readonly expected_steps?: readonly {
    readonly step_id: string;
    readonly kind: string;
    readonly note?: string;
  }[];
  readonly previous_round?: readonly {
    readonly step_id: string;
    readonly state: string;
    readonly evidence_event_id?: string;
  }[];
  readonly stage_n?: number;
  readonly notice_location?: string;
  readonly must_not?: readonly string[];
  readonly derived?: Readonly<Record<string, unknown>>;
  readonly deadlines?: readonly ({ readonly kind: string } & Readonly<Record<string, unknown>>)[];
  readonly lifecycle?: Readonly<Record<string, boolean>>;
  readonly ignored?: readonly { readonly event_id: string; readonly reason: string }[];
  readonly anomalies_include?: readonly string[];
  readonly anomalies_exclude?: readonly string[];
  readonly notes_include?: readonly string[];
  readonly stages?: readonly { readonly n: number; readonly state: string }[];
  readonly view?: Readonly<Record<string, ScenarioViewExpectation>>;
}
export interface ScenarioVariant {
  readonly id: string;
  readonly title: Bilingual;
  readonly events?: readonly JourneyEvent[];
  readonly events_add?: readonly JourneyEvent[];
  readonly events_replace?: readonly { readonly event_id: string; readonly payload: Payload }[];
  readonly procedural_object_patch?: ProceduralObjectInput;
  readonly case_patch?: Readonly<Record<string, unknown>>;
  readonly expected: ScenarioExpected;
}
export interface Scenario {
  readonly classification: string;
  readonly author?: string;
  readonly version?: string;
  readonly semantics?: unknown;
  readonly id: string;
  readonly title: Bilingual;
  readonly journey: string;
  readonly assignment_id: string;
  readonly recipient_class: string;
  readonly recipient_class_note?: string;
  readonly fixture_note?: string;
  readonly register_meaning?: unknown;
  readonly case: CaseRecordInput;
  readonly procedural_object: ProceduralObjectInput;
  readonly events: readonly JourneyEvent[];
  readonly expected: ScenarioExpected;
  readonly v12_behaviour?: {
    readonly label: string;
    readonly fact: string;
    readonly evidence: readonly string[];
  };
  readonly variants?: readonly ScenarioVariant[];
}
export interface ScenarioIndexEntry {
  readonly id: string;
  readonly journey: string;
  readonly assignment_id: string;
  readonly recipient_class: string;
  readonly variants: readonly string[];
  readonly file: string;
}
export interface ScenarioIndex {
  readonly classification: string;
  readonly author: string;
  readonly version: string;
  readonly semantics: Readonly<Record<string, string>>;
  readonly scenarios: readonly ScenarioIndexEntry[];
}

// ------------------------------------------------------------------ data
const asScenario = (x: unknown): Scenario => x as Scenario;
/** catalogue_v13.json (PROPOSED, synthetic reference data). */
export const CATALOGUE_V13: Catalogue = catalogueJson as unknown as Catalogue;
/** scenarios/index.json. */
export const SCENARIO_INDEX: ScenarioIndex = scenarioIndexJson as unknown as ScenarioIndex;
/** Every scenario fixture, keyed by its file name in scenarios/ (as SCENARIO_INDEX lists it). */
export const SCENARIOS: Readonly<Record<string, Scenario>> = Object.freeze({
  "CF-15.json": asScenario(sc_CF_15),
  "CF-16.json": asScenario(sc_CF_16),
  "CF-17.json": asScenario(sc_CF_17),
  "CF-18.json": asScenario(sc_CF_18),
  "CF-19.json": asScenario(sc_CF_19),
  "CF-23b.json": asScenario(sc_CF_23b),
  "CF-25.json": asScenario(sc_CF_25),
  "CF-27.json": asScenario(sc_CF_27),
  "CF-28.json": asScenario(sc_CF_28),
  "CF-31.json": asScenario(sc_CF_31),
  "CF-33.json": asScenario(sc_CF_33),
  "CF-34.json": asScenario(sc_CF_34),
  "CF-35.json": asScenario(sc_CF_35),
  "CF-36.json": asScenario(sc_CF_36),
  "CF-37.json": asScenario(sc_CF_37),
  "EC-01.json": asScenario(sc_EC_01),
  "NOCASE-01.json": asScenario(sc_NOCASE_01),
  "REO-01.json": asScenario(sc_REO_01),
  "RET-01.json": asScenario(sc_RET_01),
  "SUM-01.json": asScenario(sc_SUM_01),
  "SUS-01.json": asScenario(sc_SUS_01),
  "WIT-01.json": asScenario(sc_WIT_01),
});
/** The scenario fixture for an index entry's file name; throws when the file is not shipped. */
export function loadScenario(file: string): Scenario {
  const sc = Object.prototype.hasOwnProperty.call(SCENARIOS, file) ? SCENARIOS[file] : undefined;
  if (!sc) throw new Error(`journeys: scenario ${file} not found`);
  return sc;
}
