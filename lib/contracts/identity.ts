// The verified identity of one request: who acts, in which workspace, with which roles there. Built server-side from
// the signed session and the persona registry (lib/auth/session.ts), never from request input. `roles` are the
// persona's roles in the active workspace; the database derives the same from its membership rows and is the
// authority (lib/db/security-context.ts sends only persona_id and workspace_id).
import { z } from "zod";
import { PersonaIdSchema } from "./ids";
import { RoleCodeSchema, WorkspaceCodeSchema } from "./workspaces";

export const RequestIdentitySchema = z.strictObject({
  persona_id: PersonaIdSchema,
  active_workspace: WorkspaceCodeSchema,
  roles: z
    .array(RoleCodeSchema)
    .min(1, "at least one role")
    .max(3)
    .refine((roles) => new Set(roles).size === roles.length, "roles must be unique")
    .readonly(),
});
export type RequestIdentity = z.infer<typeof RequestIdentitySchema>;
