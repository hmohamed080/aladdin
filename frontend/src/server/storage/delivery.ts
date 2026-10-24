import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaNamespace } from "@/lib/storage/provider-types";
import { mediaPolicy } from "@/lib/storage/media-policy";
import { mediaProvider, resolveMedia, privilegedStorageClient } from "./media";

export const MEDIA_NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "cdn-cache-control": "no-store",
  "vercel-cdn-cache-control": "no-store",
  pragma: "no-cache", expires: "0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

export function mediaNotFound() { return new Response(null, { status: 404, headers: MEDIA_NO_STORE }); }

/** Upstream caching cannot grant authority: both checks use the caller's database identity. */
export async function deliverMedia(client: SupabaseClient, namespace: MediaNamespace, key: string,
  additionalAuthorization?: () => Promise<boolean>, workspace?: string | null) {
  let upstream: Response | undefined;
  try {
    if (additionalAuthorization && !await additionalAuthorization()) return mediaNotFound();
    const before = await resolveMedia(client, namespace, key, "read", workspace);
    const types: readonly string[] = mediaPolicy(namespace).types;
    if (before.state !== "ready" || !types.includes(before.contentType)) return mediaNotFound();
    const provider = mediaProvider(before.provider === "supabase" ? privilegedStorageClient() : client, namespace, before.provider);
    const url = await provider.getReadAccess(key, 30);
    // "manual", not "error": Workers throws on redirect "error". A 3xx is not ok, so it is never followed or served.
    upstream = await fetch(url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (!upstream.ok || !upstream.body) { await upstream.body?.cancel(); return mediaNotFound(); }
    const after = await resolveMedia(client, namespace, key, "read", workspace);
    if (after.state !== "ready" || after.provider !== before.provider || after.contentType !== before.contentType
      || (additionalAuthorization && !await additionalAuthorization())) {
      await upstream.body.cancel(); return mediaNotFound();
    }
    const maxBytes = mediaPolicy(namespace).maxBytes;
    const length = upstream.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      await upstream.body.cancel(); return mediaNotFound();
    }
    let size = 0;
    const bounded = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maxBytes) { controller.error(new Error("media stream limit")); return; }
        controller.enqueue(chunk);
      },
    }));
    // No upstream ETag, Location, token, Set-Cookie or cache headers are forwarded.
    return new Response(bounded, { headers: { ...MEDIA_NO_STORE, "content-type": before.contentType,
      "content-disposition": "inline", "content-security-policy": "sandbox" } });
  } catch {
    await upstream?.body?.cancel().catch(() => undefined);
    return mediaNotFound();
  }
}
