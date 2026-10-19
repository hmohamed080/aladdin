import { getServerSupabase } from "@/lib/supabase/server";
import { isAssetKeyForCaller, isPortfolioObjectKey } from "@/lib/storage/professional-assets";
import { deliverMedia, mediaNotFound } from "@/server/storage/delivery";
import { resolveMedia } from "@/server/storage/media";
import { isOrganizationMedia } from "@/lib/storage/media-policy";
import { isProductImageKey } from "@/lib/storage/product-images";
import { consumeRateLimit } from "@/server/cache/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ namespace: string }> }) {
  try {
    const { namespace } = await params;
    if (namespace !== "avatar" && namespace !== "portfolio" && namespace !== "certificate" && namespace !== "product" && namespace !== "organization") return mediaNotFound();
    const keys = new URL(request.url).searchParams.getAll("key");
    const key = keys[0];
    if (keys.length !== 1 || !key || key.length > 256) return mediaNotFound();
    const client = await getServerSupabase();
    // Private media checks the session with Auth on every request so sign-out,
    // ban and session revocation deny the next read. The edge Worker path does
    // the same check in the database, so this cost ends when edge delivery is on.
    const { data, error } = await client.auth.getUser();
    const user = error ? null : data.user;
    if (!user) return mediaNotFound();
    const limited = await consumeRateLimit("media-read", user.id);
    if (limited.outcome === "limited") {
      return new Response(null, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds ?? 60), "Cache-Control": "no-store" } });
    }
    if (isOrganizationMedia(namespace)) {
      const workspace = new URL(request.url).searchParams.getAll("workspace");
      if (workspace.length > 1 || (workspace[0] && !/^[0-9a-f-]{36}$/.test(workspace[0]))) return mediaNotFound();
      if (namespace === "product" ? !isProductImageKey(key) : !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(key)) return mediaNotFound();
      return await deliverMedia(client, namespace, key, undefined, workspace[0] ?? null);
    }
    if (namespace === "avatar" ? !isPortfolioObjectKey(key)
      : !isAssetKeyForCaller(namespace, key, user.id)) return mediaNotFound();
    // Public portfolios still belong on /p/media; this endpoint is owner-private.
    const owner = async () => {
      return (await resolveMedia(client, namespace, key, "read")).owner === user.id;
    };
    return await deliverMedia(client, namespace, key, owner);
  } catch { return mediaNotFound(); }
}
