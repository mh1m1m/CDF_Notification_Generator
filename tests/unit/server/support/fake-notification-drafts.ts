// In-memory NotificationDraftPort mirroring api_create_notification_draft (migration 0004): the case must be visible to
// the identity (restricted visibility already applied by visibleTo), the role must be COMMITTEE_SECRETARY or
// INVESTIGATOR, the case ACTIVE, the template version and recipient class known, and the key unused by this author.
// Unit tests only. Synthetic data.
import {
  CreateNotificationDraftCommandSchema,
  NotificationCommandRefusedError,
  type DraftOptions,
  type NotificationDraftPort,
  type RequestIdentity,
} from "@/lib/contracts";
import { visibleTo } from "./fake-case-source";

export const templateVersionIdOf = (n: number) => `1f000000-0000-4000-8000-00000000000${n}`;
export const draftNotificationIdOf = (n: number) =>
  `2f000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

export const FAKE_DRAFT_OPTIONS: DraftOptions = {
  templates: [
    {
      template_version_id: templateVersionIdOf(1),
      template_code: "CF-20_INVESTIGATION_ASSIGNED",
      template_name: { ar: "إسناد التحقيق", en: "Investigation assigned" },
      version: 1,
      language: "ar",
    },
    {
      template_version_id: templateVersionIdOf(2),
      template_code: "CF-20_INVESTIGATION_ASSIGNED",
      template_name: { ar: "إسناد التحقيق", en: "Investigation assigned" },
      version: 1,
      language: "en",
    },
  ],
  recipientClasses: [
    { code: "CASE_TEAM", name: { ar: "فريق القضية", en: "Case team" } },
    { code: "WITNESS", name: { ar: "الشاهد", en: "Witness" } },
  ],
};

export function createFakeNotificationDrafts(
  options: DraftOptions = FAKE_DRAFT_OPTIONS,
): NotificationDraftPort & { calls: string[]; created: { case_id: string; author: string }[] } {
  const calls: string[] = [];
  const created: { case_id: string; author: string }[] = [];
  const keys = new Set<string>();
  return {
    calls,
    created,
    async options(_identity: RequestIdentity) {
      calls.push("options");
      return options;
    },
    async createDraft(identity, command) {
      calls.push("createDraft");
      const c = CreateNotificationDraftCommandSchema.parse(command);
      const kase = visibleTo(identity).find((x) => x.case_id === c.case_id);
      const role = identity.roles.some((r) => r === "COMMITTEE_SECRETARY" || r === "INVESTIGATOR");
      if (!kase || !role) throw new NotificationCommandRefusedError("NOT_FOUND");
      if (kase.records_state !== "ACTIVE") throw new NotificationCommandRefusedError("CASE_CLOSED");
      if (
        !options.templates.some((t) => t.template_version_id === c.template_version_id) ||
        !options.recipientClasses.some((r) => r.code === c.recipient_class)
      )
        throw new NotificationCommandRefusedError("INVALID_INPUT");
      const k = `${identity.persona_id}:${c.idempotency_key}`;
      if (keys.has(k)) throw new NotificationCommandRefusedError("DUPLICATE");
      keys.add(k);
      created.push({ case_id: c.case_id, author: identity.persona_id });
      return {
        notification_id: draftNotificationIdOf(created.length),
        case_id: c.case_id,
        lifecycle_status: "DRAFT",
        row_version: 1,
      };
    },
  };
}
