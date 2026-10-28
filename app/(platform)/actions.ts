"use server";
// Sign-out: expires the session cookie (same attributes as when it was set) and returns to the sign-in page.
import { redirect } from "next/navigation";
import { clearSessionCookie } from "@/lib/auth/server-session";

export async function signOut(): Promise<void> {
  await clearSessionCookie();
  redirect("/sign-in");
}
