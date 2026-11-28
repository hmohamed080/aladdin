import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { completeEntryOAuth } from "@/server/auth/entry-oauth";
import { completeIdentityLink } from "@/server/auth/link-identity";

export const dynamic = "force-dynamic";

/**
 * Google/Facebook return here (through Supabase Auth) from /auth/sign-in and
 * /auth/sign-up. The session cookies written by the code exchange ride the
 * redirect response. See `completeEntryOAuth` for every rule.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // Settings → Sign-in methods: attach Google/Facebook to the account that is already signed in.
  if (params.get("link") === "1") {
    const path = await completeIdentityLink(await getServerSupabase(), {
      code: params.get("code"),
      provider: params.get("provider"),
      providerError: params.get("error"),
      errorCode: params.get("error_code"),
    });
    return NextResponse.redirect(new URL(path, request.url));
  }
  const supabase = await getServerSupabase();
  const outcome = await completeEntryOAuth(supabase, {
    code: params.get("code"),
    next: params.get("next"),
    accountType: params.get("type"),
    locale: resolveLocale(request.cookies.get(LOCALE_COOKIE)?.value) as "en" | "ar",
    providerError: params.get("error"),
  });
  return NextResponse.redirect(new URL(outcome.path, request.url));
}
