/**
 * Trusted forwarding headers on the Cloudflare-hosted frontend (ADR-0021).
 *
 * The app reads the client IP and the public host from headers that Vercel's
 * edge overwrites on every request: `x-vercel-forwarded-for` (phone sign-in /
 * sign-up throttle), `x-forwarded-for` / `x-real-ip` (Turnstile `remoteip`),
 * `x-forwarded-host` / `x-forwarded-proto` (Turnstile hostname fallback, OAuth
 * and email callback URLs, the video same-origin check). Cloudflare does not:
 * it passes a client's own `x-vercel-forwarded-for` and `x-forwarded-host`
 * through untouched and appends to a client's `x-forwarded-for`. Without this
 * step a caller could pick the IP its throttle is counted under, and every
 * honest caller would share one "unknown" IP bucket.
 *
 * The Worker entry runs this before the app, so the app sees the same contract
 * on both hosts: each header is rebuilt from what Cloudflare itself guarantees
 * (`cf-connecting-ip`, which Cloudflare always overwrites, and the URL the
 * request was actually addressed to), and a client-sent value never survives.
 */
const CLIENT_IP_HEADERS = ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"] as const;

export function withPlatformForwardedHeaders(request: Request): Request {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const clientIp = request.headers.get("cf-connecting-ip")?.trim();
  for (const name of CLIENT_IP_HEADERS) {
    if (clientIp) headers.set(name, clientIp);
    else headers.delete(name);
  }
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  return new Request(request, { headers });
}
