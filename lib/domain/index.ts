/**
 * lib/domain/index.ts — CDF Notifications V13 · workstream W-A (domain model), TypeScript port: the public API.
 * SYNTHETIC-DATA REFERENCE IMPLEMENTATION — not CDF production; no production-readiness claim.
 *
 * Re-exports the four domain modules (concepts, epistemic, status, invariants) and the shared types. status re-exports
 * a few concepts bindings (the delivery-confirmation catalogue, StatusObjectName); a name exported by two modules
 * resolves to the same binding.
 */
export * from "./types";
export * from "./concepts";
export * from "./epistemic";
export * from "./status";
export * from "./invariants";
export * from "./badge";
