/**
 * The server-side READ-ONLY gate for the "view as account" tree.
 *
 * WHY. Exact UI parity means the REAL account components render under `/admin/users/<id>/view/...`, and those components
 * embed Server Actions (Save, upload, delete, send, sign out ...). A Server Action is a POST to the URL of the page that
 * rendered it, and it runs as the AUTHENTICATED principal, which in View-As is the Admin. Left alone, a click on "Save"
 * inside a viewed account would silently write the Admin's OWN data. Hiding or disabling buttons does not prevent that,
 * so mutation is refused here, before any route, action or route handler runs:
 *
 *   1. ANY non-read request (anything but GET / HEAD / OPTIONS) addressed to the view tree is refused, which covers every
 *      Server Action rendered there. The only exceptions are the two deliberate session controls, `.../view/start`
 *      (open the audited session) and `.../view/exit` (end it).
 *   2. ANY non-read request made BY a page of the view tree to another same-origin URL (a client component calling an
 *      `/api/...` route, a form posting elsewhere) is refused too, decided from the request's Referer (and Origin). A
 *      browser always sends one on a same-origin fetch / form; a request without one cannot have come from a view page, and
 *      is unaffected.
 *
 * Reads are never blocked here (navigation, tabs, filters, prefetch, media GET).
 * This is a safety net against the accidental write that matters (Admin clicks a live button), not an authorization
 * boundary: a caller who forges headers can only reach the Admin's own rows, exactly what they could already reach.
 */

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The view tree: `/admin/users/<uuid>/view/...` today, and `/view-as/<uuid>/...` (a top-level tree with the account's own
 * shell instead of the Admin console chrome) once exact UI parity moves it there. Both are guarded from day one.
 */
const VIEW_TREE = /^\/(?:admin\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/view|view-as\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;
/** The only writes allowed in the tree: opening and ending the audited session. */
const SESSION_CONTROL = /^\/(?:admin\/users\/[0-9a-f-]{36}\/view|view-as\/[0-9a-f-]{36})\/(?:start|exit)\/?$/i;

export type ViewAsGateInput = {
  method: string;
  pathname: string;
  /** Request headers (Referer / Origin / Host are read). */
  headers: { get(name: string): string | null };
};

function pathOf(url: string | null, host: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // A different site is never "a page of this app".
    if (host && u.host !== host) return null;
    return u.pathname;
  } catch {
    return null;
  }
}

/** True when this request must be refused because it would mutate from (or inside) the view-as tree. */
export function isViewAsMutation(input: ViewAsGateInput): boolean {
  if (READ_METHODS.has(input.method.toUpperCase())) return false;
  if (VIEW_TREE.test(input.pathname)) return !SESSION_CONTROL.test(input.pathname);
  const host = input.headers.get("host");
  const origin = pathOf(input.headers.get("referer"), host);
  return origin !== null && VIEW_TREE.test(origin) && !SESSION_CONTROL.test(input.pathname);
}

/** The refusal: a generic, cache-proof 403 that names no subject. */
export function viewAsReadOnlyResponse(): Response {
  return new Response(JSON.stringify({ error: "view_as_read_only" }), {
    status: 403,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store, max-age=0",
      "x-view-as-read-only": "1",
    },
  });
}

/**
 * The TRUSTED request header the middleware forwards to the server-side boundary (Server Actions, route handlers, the
 * Supabase client factory). The middleware DELETES any client-supplied copy first and sets it only itself, so a value that
 * reaches server code was computed from the real path / Referer. It can only ever ADD restriction: forging it on a request
 * the middleware does not run on makes that request read-only, never the reverse.
 */
export const VIEW_AS_CONTEXT_HEADER = "x-view-as-context";
export type ViewAsContext = "exact" | "interim";

const EXACT_TREE = /^\/view-as\/[0-9a-f-]{36}(?:\/|$)/i;

function treeOf(pathname: string): ViewAsContext | null {
  if (!VIEW_TREE.test(pathname) || SESSION_CONTROL.test(pathname)) return null;
  return EXACT_TREE.test(pathname) ? "exact" : "interim";
}

/**
 * Which view tree (if any) this request belongs to: by its own path, or, for a NON-READ request only, by the page it was made
 * from (Referer). A plain GET navigating out of a view into the Admin console is deliberately NOT a view request, so the Admin's
 * normal console is never put into read-only mode. The two session controls (start / exit) are never a view request.
 */
export function viewAsContextFor(input: ViewAsGateInput): ViewAsContext | null {
  const own = treeOf(input.pathname);
  if (own) return own;
  if (READ_METHODS.has(input.method.toUpperCase()) || SESSION_CONTROL.test(input.pathname)) return null;
  const from = pathOf(input.headers.get("referer"), input.headers.get("host"));
  return from === null ? null : treeOf(from);
}
