import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { completeEntryOAuth, isEntryKind } from "@/server/auth/entry-oauth";
import { completeGeneralOAuth } from "@/server/auth/general-oauth";
import { completeIdentityLink } from "@/server/auth/link-identity";

export const dynamic = "force-dynamic";

/**
 * Google/Facebook return here (through Supabase Auth) from the Showroom and
 * Installer entry pages. The session cookies written by the code exchange ride
 * the redirect response. See `completeEntryOAuth` for every rule.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // Settings → Sign-in methods: attach Google/Facebook to the account that is already signed in.
  if (params.get("link") === "1") {
    const supabase = await getServerSupabase();
    const path = await completeIdentityLink(supabase, {
      code: params.get("code"),
      provider: params.get("provider"),
      providerError: params.get("error"),
      errorCode: params.get("error_code"),
    });
    return NextResponse.redirect(new URL(path, request.url));
  }
  // /auth/sign-in and /auth/sign-up: sign in, or send a first-time person into the normal registration steps.
  if (params.get("general") === "1") {
    const supabase = await getServerSupabase();
    const outcome = await completeGeneralOAuth(supabase, {
      code: params.get("code"),
      next: params.get("next"),
      providerError: params.get("error"),
    });
    return NextResponse.redirect(new URL(outcome.path, request.url));
  }
  const entry = params.get("entry");
  if (!isEntryKind(entry)) return NextResponse.redirect(new URL("/auth/sign-in", request.url));
  const supabase = await getServerSupabase();
  const outcome = await completeEntryOAuth(supabase, {
    code: params.get("code"),
    kind: entry,
    next: params.get("next"),
    providerError: params.get("error"),
  });
  return NextResponse.redirect(new URL(outcome.path, request.url));
}
