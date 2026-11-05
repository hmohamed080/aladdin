import { NextResponse } from "next/server";
import { STAFF_INVITATION_COOKIE, STAFF_TOKEN_SHAPE, cookieOptions } from "@/server/auth/staff-invitation-token";

export const dynamic = "force-dynamic";

/**
 * Entry of an Admin Staff invitation link. It does exactly one thing: move the token out of the URL. A well-formed token is stored in an httpOnly
 * cookie and the browser is redirected (303) to the tokenless page; a malformed one is simply dropped. It never validates against the database
 * and never grants anything, so link scanners and prefetchers that open the URL gain nothing. The response is uncacheable and sends no Referer.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const response = NextResponse.redirect(new URL("/auth/staff-invitation", request.url), 303);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (STAFF_TOKEN_SHAPE.test(token)) response.cookies.set(STAFF_INVITATION_COOKIE, token, cookieOptions());
  return response;
}
