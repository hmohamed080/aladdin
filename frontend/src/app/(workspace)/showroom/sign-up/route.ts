// Retired entry page (ADR-0025): neither a page nor a redirect. Sign in and sign up live at /auth/* only.
// A route handler is not wrapped by the Showroom layout guard, so this answers a plain 404 for everyone. Without it the path
// falls into the dynamic /showroom/[page] route, whose layout redirects a logged-out visitor to /auth/sign-in.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export const HEAD = GET;
