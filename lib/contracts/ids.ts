// Identifier contracts. UUIDs are the keys of every record; business numbers (CDF-DEMO-2026-0001) are display
// identifiers only and never authorise anything on their own. Workspaces have both: a code (WorkspaceCode, used in
// sessions and the UI) and a database id (WorkspaceId, used in request claims and rows), mapped by WORKSPACE_IDS in
// ./workspaces.ts.
import { z } from "zod";

/** Canonical lowercase RFC 9562 UUID (versions 1–8, RFC variant). The nil UUID and upper case are rejected. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const UuidSchema = z.string().regex(UUID_PATTERN, "must be a lowercase RFC 9562 UUID");

export const CaseIdSchema = UuidSchema.brand<"CaseId">();
export type CaseId = z.infer<typeof CaseIdSchema>;

export const PersonaIdSchema = UuidSchema.brand<"PersonaId">();
export type PersonaId = z.infer<typeof PersonaIdSchema>;

/** Correlation id: shown to users with generic errors and recorded on audit events. */
export const CorrelationIdSchema = UuidSchema.brand<"CorrelationId">();
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;
