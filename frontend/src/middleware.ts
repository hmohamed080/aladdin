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

  // A suspended account (PD-010) is refused by the database on every data
  // request; route it to a page that says so instead of a broken screen. Its own
  // status is the one request the database still answers for it.
  const productSurface =
    authRequired || path.startsWith("/settings") || path.startsWith("/business");
  if (user && (productSurface || path === "/auth/suspended")) {
    const { data: account } = await supabase.rpc("my_account_status");
    const suspended = (account as { suspended?: boolean } | null)?.suspended === true;
    if (suspended && productSurface) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/suspended";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (!suspended && path === "/auth/suspended") {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // A signed-in caller never needs Sign In / Sign Up (shared email pages or the
  // installer phone pages) — send them through the resume
  // funnel (/onboarding forwards active users on to the workspace). Recovery,
  // support, verify, and invitation entry stay reachable while signed in.
  if (
    (path === "/auth/sign-in" ||
      path === "/auth/sign-up" ||
      path === "/installer/sign-in" ||
      path === "/installer/sign-up") &&
    user
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

// Vercel Services cannot host Edge Function output, and this middleware has no
// need for the Edge runtime: it does one network round trip to the Supabase auth
// server and reads/writes cookies, both of which the Node runtime supports.
// Node.js middleware is stable as of Next.js 15.5 (installed: 15.5.22).
export const runtime = "nodejs";

export const config = {
  // Run on everything except static assets and the health route.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
