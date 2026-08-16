import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readPublicEnv } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie on every navigation and guards the B2B
 * workspace. Authorization itself is enforced by Postgres RLS on every query;
 * this middleware only prevents rendering the authenticated shell for a caller
 * with no session, and bounces a signed-in caller away from the sign-in page.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = readPublicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: getUser() validates the JWT with the auth server and triggers a
  // refresh (writing new cookies) when the access token is stale.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Authenticated-only surfaces: the workspace, the admin console, the consumer
  // home, and the post-registration handoff. Authorization within each (platform
  // staff, org membership, capabilities) is still enforced by RLS + route guards.
  const authRequired =
    path.startsWith("/b2b") ||
    path.startsWith("/admin") ||
    path.startsWith("/home") ||
    path.startsWith("/onboarding");
  if (authRequired && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // A signed-in caller never needs Sign In / Sign Up — send them through the resume
  // funnel (/onboarding forwards active users on to the workspace). Recovery,
  // support, verify, and invitation entry stay reachable while signed in.
  if ((path === "/auth/sign-in" || path === "/auth/sign-up") && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const runtime = "nodejs";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

export const config = {
  // Run on everything except static assets and the health route.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
