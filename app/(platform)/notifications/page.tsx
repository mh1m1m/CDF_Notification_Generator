// Notification Operations Center (FE-006, SCREENS S4): notifications across the cases the persona may see in the
// active workspace, filtered by a GET form and paged by keyset. Data comes only through lib/server (context →
// lib/authz pre-check → NotificationCenterReader inside the database security context). For an investigator the route
// answers exactly like an unknown route (SEC ruling D6, SEC-APP-17): notFound() before anything is read.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslator } from "@/lib/i18n/server";
import { requireRequestContext } from "@/lib/server/context";
import { isAppError } from "@/lib/server/errors";
import {
  loadNotificationCenter,
  type NotificationCenterView as View,
} from "@/lib/server/notification-center";
import type { RawSearchParams } from "@/lib/server/notification-center-query";
import { notificationCenterFor } from "@/lib/server/records";
import { NotificationCenterView } from "./_components/NotificationCenterView";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("notifications.pageTitle") };
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  let view: View;
  try {
    const ctx = await requireRequestContext();
    view = await loadNotificationCenter(
      { ctx, reader: notificationCenterFor(ctx.correlationId) },
      await searchParams,
    );
  } catch (error) {
    if (isAppError(error) && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { locale, t } = await getTranslator();
  return <NotificationCenterView t={t} locale={locale} view={view} />;
}
