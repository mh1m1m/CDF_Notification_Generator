// My Work (FE-005, SCREENS S1): the signed-in persona, its roles and workspace, and its own open tasks in the active
// workspace with a count strip (Overdue, Due this week, Open) and a short status form per task. Data comes only
// through lib/server (context → lib/authz pre-check → MyWorkReader inside the database security context).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/server-session";
import { ROLE_NAME_KEYS, translateKey, WORKSPACE_NAME_KEYS } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { requireRequestContext } from "@/lib/server/context";
import { isAppError } from "@/lib/server/errors";
import { confirmedMembershipsForRequest } from "@/lib/server/membership-records";
import { confirmedRolesIn } from "@/lib/server/memberships";
import { loadMyWork, type MyWorkView } from "@/lib/server/my-work";
import { myWorkFor } from "@/lib/server/my-work-binding";
import { MyWorkTable } from "./_components/MyWorkView";
import styles from "./_components/my-work.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("myWork.pageTitle") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{
    ref?: string | string[];
    stale?: string | string[];
    switched?: string | string[];
    updated?: string | string[];
    filter?: string | string[];
  }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  let view: MyWorkView;
  const params = await searchParams;
  try {
    const ctx = await requireRequestContext();
    view = await loadMyWork({ ctx, reader: myWorkFor(ctx.correlationId) }, one(params.filter));
  } catch (error) {
    if (isAppError(error) && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    throw error;
  }
  const { locale, t } = await getTranslator();
  const workspaceName = t(WORKSPACE_NAME_KEYS[session.identity.active_workspace]);
  // Only roles the database confirms in this request (V13-FE-008, OI-044), never the session's.
  const confirmedRoles = confirmedRolesIn(
    await confirmedMembershipsForRequest(),
    session.identity.active_workspace,
  );
  const roles =
    confirmedRoles.length > 0
      ? new Intl.ListFormat(locale, { type: "conjunction" }).format(
          confirmedRoles.map((role) => t(ROLE_NAME_KEYS[role])),
        )
      : t("myWork.noConfirmedRole");
  // Outcome references from a redirect: only well-formed UUIDs are shown, anything else is ignored.
  const reference = UUID.test(one(params.ref) ?? "") ? (one(params.ref) as string) : null;
  const stale = UUID.test(one(params.stale) ?? "") ? (one(params.stale) as string) : null;
  const updated = !reference && !stale && UUID.test(one(params.updated) ?? "");
  return (
    <>
      <h1>{t("myWork.heading")}</h1>
      <p className={styles.subtitle} data-testid="my-work-subtitle">
        {t("myWork.subtitle", { workspace: workspaceName })}
      </p>
      {one(params.switched) === "1" && !reference ? (
        // Announces the workspace the session is actually in now (never a value from the URL).
        <p className="v13-notice" role="status" data-testid="workspace-switched">
          {t("workspaces.switched", { name: workspaceName })}
        </p>
      ) : null}
      <div role="status" aria-live="polite" data-testid="my-work-live">
        {updated ? (
          <p className="v13-notice" data-testid="task-status-updated">
            {t("myWork.updated")}
          </p>
        ) : null}
      </div>
      {stale ? (
        <p className="v13-notice" role="alert" data-testid="task-status-stale">
          {t("myWork.stale", { reference: stale })}
        </p>
      ) : null}
      {reference ? (
        <p className="v13-notice" role="alert" data-testid="action-error">
          {t("myWork.actionFailed", { reference })}
        </p>
      ) : null}
      <dl className="v13-facts v13-facts-block" data-testid="my-work-identity">
        <div>
          <dt>{t("myWork.persona")}</dt>
          <dd data-testid="my-work-persona">{translateKey(locale, session.persona.name_key)}</dd>
        </div>
        <div>
          <dt>{t("myWork.roles")}</dt>
          <dd data-testid="my-work-roles">{roles}</dd>
        </div>
        <div>
          <dt>{t("myWork.workspace")}</dt>
          <dd data-testid="my-work-workspace">{workspaceName}</dd>
        </div>
      </dl>
      {view.kind === "error" ? (
        <p className="v13-notice" role="alert" data-testid="my-work-error">
          {t("myWork.loadFailed", { reference: view.correlationId })}
        </p>
      ) : (
        <MyWorkTable t={t} locale={locale} view={view} />
      )}
    </>
  );
}
