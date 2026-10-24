import "server-only";
import { NextResponse } from "next/server";
import { VideoUploadError, type VideoErrorCode } from "./uploads";

const STATUS: Record<VideoErrorCode, number> = {
  not_allowed: 403, invalid: 400, limit: 409, rate_limited: 429, not_found: 404, incomplete: 409, unavailable: 503,
};
const NO_STORE = { "cache-control": "private, no-store" };

/**
 * These JSON endpoints use the session cookie, so they accept only same-origin
 * requests with a JSON body (a cross-site form cannot send either).
 */
export function refuseCrossSite(request: Request): Response | null {
  const origin = request.headers.get("origin");
  // Browsers omit Origin on same-origin GETs; a GET changes nothing and CORS keeps
  // its answer from other sites. Every other method must carry our own origin.
  // "Ours" is the host the browser addressed (as Next.js server actions check it):
  // request.url can carry the server's bind address instead.
  if (origin ? originHost(origin) !== requestHost(request) : request.method !== "GET") return json({ error: "not_allowed" }, 403);
  if (request.method !== "GET" && request.method !== "DELETE"
    && !(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ error: "invalid" }, 415);
  }
  return null;
}

function originHost(origin: string): string | null {
  try { return new URL(origin).host; } catch { return null; }
}
function requestHost(request: Request): string {
  return (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host).split(",")[0]!.trim();
}

export function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function failure(error: unknown): Response {
  const code: VideoErrorCode = error instanceof VideoUploadError ? error.code : "unavailable";
  return json({ error: code }, STATUS[code]);
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 4096) throw new VideoUploadError("invalid");
  try { return JSON.parse(text); } catch { throw new VideoUploadError("invalid"); }
}
