"use client";
import type { UploadGrant } from "./provider-types";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

let active = 0;
const waiters: Array<() => void> = [];

/** Four uploads per tab; database pending limits bound concurrency across devices. */
export async function uploadWithGrant(grant: UploadGrant, body: Blob, onProgress?: (percent: number) => void) {
  if (active >= 4) await new Promise<void>((resolve) => waiters.push(resolve));
  else active++;
  try {
    if (grant.provider === "supabase") {
      const { error } = await createBrowserSupabaseClient().storage.from(grant.bucket)
        .uploadToSignedUrl(grant.key, grant.token, body, { contentType: body.type, upsert: false });
      if (error) throw new Error("upload failed");
      onProgress?.(100);
      return;
    }
    // PUT to a temporary key is idempotent until finalization. Retry only transport/5xx failures.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", grant.url);
          xhr.timeout = 60_000;
          for (const [name, value] of Object.entries(grant.headers)) xhr.setRequestHeader(name, value);
          xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
          xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve()
            : reject(new Error(xhr.status >= 500 ? "retryable" : "upload refused"));
          xhr.onerror = xhr.ontimeout = () => reject(new Error("retryable"));
          xhr.send(body);
        });
        return;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "retryable" || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt + Math.random() * 200));
      }
    }
  } finally {
    const next = waiters.shift();
    if (next) next(); else active--;
  }
}
