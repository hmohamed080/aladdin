"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { isOAuthProvider } from "@/server/auth/entry-oauth";
import { generalCallbackUrl } from "@/server/auth/general-oauth";

/**
 * Starts Google/Facebook sign-in or sign-up from `/auth/sign-in` or
 * `/auth/sign-up`. The callback URL is built on the CURRENT request's own
 * origin, never a caller-supplied value.
 */
export async function startGeneralOAuth(formData: FormData): Promise<void> {
  const provider = formData.get("provider");
  if (!isOAuthProvider(provider)) redirect("/auth/sign-in?error=oauth");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");

  let url: string | undefined;
  try {
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: generalCallbackUrl(`${proto}://${host}`, formData.get("next")),
        skipBrowserRedirect: true,
        ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
      },
    });
    if (!error) url = data.url ?? undefined;
  } catch {
    url = undefined;
  }
  redirect(url ?? "/auth/sign-in?error=oauth");
}
