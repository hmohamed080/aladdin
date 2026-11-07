import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readPublicEnv } from "@/lib/env";
import {
  identityFromClaims,
  isAuthRequiredPath,
  isPrefetchRequest,
  isProductSurfacePath,
  isSignedOutEntryPath,
  needsNetworkValidatedSession,
} from "@/server/auth/request-gate";

/**
 * Refreshes the Supabase session cookie on every navigation and guards the B2B
 * workspace. Authorization itself is enforced by Postgres RLS on every query;
 * this middleware only prevents rendering the authenticated shell for a caller
 * with no session, and bounces a signed-in caller away from the sign-in page.
 */
export async function middleware(request: NextRequest) {
  // Sign-in / sign-up server actions never need a large body; refuse one before any work.
  const authEntryRoute = /^\/auth\/sign-(in|up)$/.test(request.nextUrl.pathname);
  const contentLength = request.headers.get("content-length");
  if (authEntryRoute && request.method === "POST" && contentLength && Number(contentLength) > 65536) {
    return new NextResponse("Request too large", { status: 413 });
  }
  let response = NextResponse.next({ request });
  const env = readPublicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: { secure: env.NEXT_PUBLIC_APP_ENV !== "local", sameSite: "lax", path: "/" },
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

  // Every redirect below carries the cookies the Supabase client wrote on
  // `response` (a refreshed session, or a cleared one): the browser must not
  // keep a refresh token the Auth server has already rotated.
  const redirectWithSession = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  const path = request.nextUrl.pathname;
  const prefetch = isPrefetchRequest(request.method, request.headers);

  // Who is calling. `getClaims()` reads the session from the cookies, REFRESHES
  // it through the same cookie adapter when the access token has expired (that
  // refresh is the only Auth request it makes), and verifies the token's
  // signature and expiry locally against the project's published signing keys.
  // A missing, forged or expired token is "no user", exactly as `getUser()` was.
  // Admin surfaces still ask the Auth server (`getUser()`), so a session revoked
  // by sign-out-everywhere, a ban or a deletion is refused there immediately.
  // Authorization never depended on this call: PostgREST / RLS verify the same
  // JWT on every query. See docs/frontend/auth-session-reads.md.
  let userId: string | null = null;
  try {
    if (needsNetworkValidatedSession(path)) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } else {
      const { data, error } = await supabase.auth.getClaims();
      userId = error || !data ? null : (identityFromClaims(data.claims)?.id ?? null);
    }
  } catch {
    userId = null;
  }

  // Authenticated-only surfaces: the workspace, the admin console, the consumer
  // home, and the post-registration handoff. Authorization within each (platform
  // staff, org membership, capabilities) is still enforced by RLS + route guards.
  const authRequired = isAuthRequiredPath(path);
  if (authRequired && !userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.searchParams.set("next", path + request.nextUrl.search);
    return redirectWithSession(url);
  }

  // A suspended account (PD-010) is refused by the database on every data
  // request; route it to a page that says so instead of a broken screen. Its own
  // status is the one request the database still answers for it. A router
  // prefetch skips this lookup: it is a GET that mutates nothing, and the real
  // navigation that follows it (a request without the prefetch header — dynamic
  // segments are never served from a prefetch) runs this check before the page
  // renders. Every Server Action is a POST and is always checked.
  const productSurface = isProductSurfacePath(path);
  if (userId && !prefetch && (productSurface || path === "/auth/suspended")) {
    const { data: account } = await supabase.rpc("my_account_status");
    const status = account as { suspended?: boolean; session_active?: boolean } | null;
    // A session signed out elsewhere, revoked, banned or deleted: the database
    // already refuses its token (db_pre_request), so drop the stale cookies and
    // start a fresh sign-in instead of rendering a page whose queries all fail.
    if (status?.session_active === false) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      const url = request.nextUrl.clone();
      url.pathname = "/auth/sign-in";
      url.search = "";
      if (productSurface) url.searchParams.set("next", path + request.nextUrl.search);
      return redirectWithSession(url);
    }
    const suspended = status?.suspended === true;
    if (suspended && productSurface) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/suspended";
      url.search = "";
      return redirectWithSession(url);
    }
    if (!suspended && path === "/auth/suspended") {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return redirectWithSession(url);
    }
  }

  // A signed-in caller never needs Sign In / Sign Up — send them through the resume
  // funnel (/onboarding forwards active users on to the workspace). Recovery,
  // support, verify, and invitation entry stay reachable while signed in.
  if (isSignedOutEntryPath(path) && userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    return redirectWithSession(url);
  }

  return response;
}

// The plain `next build` (CI, local) runs this middleware on Node, and it has no
// need for the Edge runtime: it verifies a JWT with WebCrypto, makes at most a
// token refresh / admin getUser() / status RPC round trip to Supabase, and
// reads/writes cookies — all of which the Node runtime supports.
// Node.js middleware is stable as of Next.js 15.5. Next 16 deprecates the file name in
// favour of `proxy.ts`, which is Node-only; the Workers build needs this file on the Edge
// runtime (scripts/build-cloudflare.mjs), so it stays `middleware.ts` for now.
export const runtime = "nodejs";

export const config = {
  // Run on everything except static assets, the health route and the media
  // delivery routes (`/api/media`, `/p/media`): those authorize every request
  // themselves through the caller's own client (RLS) and refresh the session
  // cookie in their own response when needed, so a page with N images no longer
  // runs this middleware N extra times.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/media/|p/media/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|otf|css|js|map|txt|xml|webmanifest)$).*)",
  ],
};
