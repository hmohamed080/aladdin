import "server-only";
import { createHmac } from "node:crypto";
import { readAuthIdentifierSecret, readPublicEnv } from "@/lib/env";
import { consumeClientRateLimit, type RateLimitResult, type RateLimitRule } from "@/server/cache/rate-limit";
import { clientIpFrom } from "./turnstile";

/**
 * A per-client ceiling for public routes and actions that have no signed-in user (the Marketplace image route
 * and cart quote). The client is the IP the Worker entry rebuilds from `cf-connecting-ip` on every request
 * (lib/cloudflare/forwarded-headers.ts), HMAC-hashed so no raw IP reaches Redis or logs. When the identifier
 * secret is not configured the call degrades to "allowed" (this is an abuse brake, not an authorization check),
 * and a request without a trustworthy IP shares one "unknown" bucket rather than escaping the limit.
 */
export async function clientRateLimit(rule: RateLimitRule, headers: { get(name: string): string | null }): Promise<RateLimitResult> {
  try {
    const ip = readPublicEnv().NEXT_PUBLIC_APP_ENV === "local"
      ? clientIpFrom((name) => headers.get(name))
      : clientIpFrom((name) => (name === "x-forwarded-for" ? headers.get("x-vercel-forwarded-for") : null));
    const id = createHmac("sha256", readAuthIdentifierSecret()).update(`ip:${ip ?? "unknown"}`).digest("hex");
    return await consumeClientRateLimit(rule, id);
  } catch {
    return { outcome: "allowed", source: "memory" };
  }
}
