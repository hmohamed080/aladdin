/**
 * `/api/backend/*` on the Cloudflare-hosted frontend (ADR-0021).
 *
 * On Vercel, `vercel.json` rewrites `/api/backend(/.*)?` to the FastAPI service
 * inside the same deployment. On Workers the FastAPI service stays where it is
 * (a separate origin), and the Worker forwards the request there unchanged:
 * same path, method, body, query and headers, so the browser keeps calling the
 * app's own origin (no CORS, no cross-site cookies) and FastAPI keeps receiving
 * `/api/backend/...` exactly as it does behind the Vercel rewrite.
 *
 * Pure function of (request, config): no Next.js, no bindings, so the Worker
 * entry can run it before the app and it is unit-tested on its own.
 */
export const BACKEND_PREFIX = "/api/backend";

// Hop-by-hop headers (RFC 9110 §7.6.1) never cross a proxy; `host` is the target's.
const HOP_BY_HOP = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host"];

export function isBackendPath(pathname: string): boolean {
  return pathname === BACKEND_PREFIX || pathname.startsWith(`${BACKEND_PREFIX}/`);
}

export type BackendProxyConfig = {
  /** The FastAPI origin, e.g. `https://backend.example.com` (no path). */
  origin: string | undefined;
  /** `local` allows a plain-http loopback origin for isolated tests. */
  appEnv: string | undefined;
};

/** Validates the configured origin; `null` when it is missing or not allowed. */
export function backendOrigin({ origin, appEnv }: BackendProxyConfig): URL | null {
  if (!origin) return null;
  let url: URL;
  try { url = new URL(origin); } catch { return null; }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol === "https:") return url;
  return url.protocol === "http:" && appEnv === "local" && loopback ? url : null;
}

export function backendRequest(request: Request, target: URL): Request {
  const incoming = new URL(request.url);
  const url = new URL(`${incoming.pathname}${incoming.search}`, target);
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  // FastAPI authenticates the Authorization bearer only; the session cookies (which
  // hold the refresh token) never leave for another origin (security audit 2026-10-22).
  headers.delete("cookie");
  // What a Vercel rewrite tells the service about the original request.
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  const connectingIp = request.headers.get("cf-connecting-ip");
  if (connectingIp) headers.set("x-forwarded-for", connectingIp);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    // A redirect from FastAPI goes back to the browser as-is, like the rewrite.
    redirect: "manual",
    // Streams the body instead of buffering it (required by the fetch spec for a stream body).
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

/** Forwards a `/api/backend` request, or answers 503 when no backend is configured. */
export async function proxyToBackend(request: Request, config: BackendProxyConfig, send: typeof fetch = fetch): Promise<Response> {
  const target = backendOrigin(config);
  if (!target) {
    return Response.json({ status: "unavailable", service: "backend" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  try {
    return await send(backendRequest(request, target));
  } catch {
    return Response.json({ status: "unreachable", service: "backend" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
