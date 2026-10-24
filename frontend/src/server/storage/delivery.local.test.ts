import fs from "node:fs";
import { createHmac, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const local = vi.hoisted(() => {
  const enabled = process.env.MEDIA_DELIVERY_LOCAL_TEST === "true";
  return { enabled, settings: {} as Record<string, string>, caller: null as SupabaseClient | null };
});
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: local.settings.API_URL, NEXT_PUBLIC_APP_ENV: "staging" }) }));
vi.mock("@/lib/env/storage", () => ({ readStorageEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: local.settings.SERVICE_ROLE_KEY, R2_STORAGE_ENABLED: false, R2_PRODUCTION_WRITES_APPROVED: false }) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => local.caller }));
import { GET as privateGet } from "@/app/api/media/[namespace]/route";
import { GET as publicGet } from "@/app/p/media/[itemId]/route";
import { authorizeMediaUpload, verifyPendingMedia, removeMedia } from "./media";
if (local.enabled) {
  local.settings = JSON.parse(fs.readFileSync("../logs/private-media-local/status.json", "utf8"));
  if (local.settings.API_URL !== "http://127.0.0.1:60721") throw Error("Only disposable loopback stack allowed");
}

it.skipIf(!local.enabled)("real local Storage uploads, backend receipts, application reads/revocation and cleanup", async () => {
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== local.settings.API_URL) throw Error("Nonlocal request prohibited");
    return nativeFetch(input, init);
  });
  const OWNER = "70000009-0000-4000-8000-000000000009";
  const FOREIGN = "71000006-0000-4000-8000-000000000006";
  function caller(id: string) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    const token = `${header}.${body}.${createHmac("sha256", setting("JWT_SECRET")).update(`${header}.${body}`).digest("base64url")}`;
    const client = createClient(setting("API_URL"), setting("ANON_KEY"), { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const getUser = client.auth.getUser.bind(client.auth);
    vi.spyOn(client.auth, "getUser").mockImplementation(() => getUser(token));
    return client;
  }
  const owner = caller(OWNER); const foreign = caller(FOREIGN); const fresh = caller(OWNER);
  function setting(name: string) { const value = local.settings[name]; if (!value) throw Error("Local test configuration incomplete"); return value; }
  const admin = createClient(setting("API_URL"), setting("SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const anon = createClient(setting("API_URL"), setting("ANON_KEY"), { auth: { persistSession: false } });
  const items: Array<{ namespace: "avatar" | "portfolio" | "certificate"; id?: string; key: string; bucket: string; bytes: Buffer }> = [];
  const rpc = async (client: SupabaseClient, name: string, args: Record<string, unknown>) => {
    const result = await client.rpc(name, args); if (result.error) throw Error(`Local RPC failed: ${name}`); return result.data;
  };
  const read = (namespace: string, key: string) => privateGet(new Request(`http://local.test/api/media/${namespace}?key=${encodeURIComponent(key)}`), { params: Promise.resolve({ namespace }) });
  const publicRead = (id: string) => publicGet(new Request(`http://local.test/p/media/${id}`), { params: Promise.resolve({ itemId: id }) });
  try {
    for (const [namespace, contentType] of [["avatar", "image/png"], ["portfolio", "image/png"], ["certificate", "image/png"], ["certificate", "application/pdf"]] as const) {
      const document = await PDFDocument.create(); document.addPage();
      const bytes = contentType === "application/pdf" ? Buffer.from(await document.save())
        : await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
      const created = await rpc(owner, namespace === "avatar" ? "avatar_request_upload" : namespace === "portfolio" ? "portfolio_item_create" : "certificate_create",
        namespace === "avatar" ? { p_content_type: contentType } : namespace === "portfolio" ? { p_title: "Local revocation", p_description: null, p_content_type: contentType }
          : { p_title: "Local certificate", p_issuer: null, p_issued_on: null, p_expires_on: null, p_content_type: contentType, p_original_filename: contentType === "application/pdf" ? "local.pdf" : "local.png" });
      const key = namespace === "avatar" ? created : namespace === "portfolio" ? created[0].object_key : created[0].object_path;
      const id = namespace === "avatar" ? undefined : created[0].item_id;
      const bucket = namespace === "avatar" ? "avatars" : namespace === "portfolio" ? "professional-portfolio" : "professional-certificates";
      items.push({ namespace, key, id, bucket, bytes });
      const grant = await authorizeMediaUpload(owner, namespace, key, bytes.length);
      expect(grant.provider).toBe("supabase"); if (grant.provider !== "supabase") throw Error("Unexpected routing");
      const upload = await owner.storage.from(bucket).uploadToSignedUrl(key, grant.token, bytes, { contentType, upsert: false });
      expect(upload.error).toBeNull();
      await verifyPendingMedia(owner, namespace, key);
      await rpc(owner, namespace === "avatar" ? "avatar_confirm_upload" : namespace === "portfolio" ? "portfolio_item_finalize" : "certificate_finalize",
        namespace === "avatar" ? { p_object_key: key } : { p_item_id: id });
      for (const client of [owner, foreign, anon]) {
        expect((await client.storage.from(bucket).download(key)).error).not.toBeNull();
        expect((await client.storage.from(bucket).createSignedUrl(key, 60)).error).not.toBeNull();
      }
      local.caller = owner; const response = await read(namespace, key);
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
      local.caller = foreign; expect((await read(namespace, key)).status).toBe(404);
    }
    const portfolio = items.find((i) => i.namespace === "portfolio")!;
    const old = await admin.storage.from(portfolio.bucket).createSignedUrl(portfolio.key, 60); if (old.error) throw Error("Old-token control unavailable");
    await rpc(owner, "portfolio_item_set_visibility", { p_item_id: portfolio.id, p_public: true });
    local.caller = anon; expect((await publicRead(portfolio.id!)).status).toBe(200);
    expect((await anon.storage.from(portfolio.bucket).createSignedUrl(portfolio.key, 60)).error).not.toBeNull();
    await rpc(owner, "portfolio_item_set_visibility", { p_item_id: portfolio.id, p_public: false });
    expect((await publicRead(portfolio.id!)).status).toBe(404);
    // Proves why a new SELECT restriction alone cannot revoke a previously issued token.
    expect((await fetch(old.data.signedUrl, { cache: "no-store" })).status).toBe(200);
    const expiring = await admin.storage.from(portfolio.bucket).createSignedUrl(portfolio.key, 1);
    if (expiring.error) throw Error("Expiry control unavailable");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect((await fetch(expiring.data.signedUrl, { cache: "no-store" })).status).toBeGreaterThanOrEqual(400);
    await rpc(owner, "portfolio_item_delete", { p_item_id: portfolio.id });
    for (const session of [owner, fresh]) { local.caller = session; expect((await read("portfolio", portfolio.key)).status).toBe(404); }
    expect((await admin.storage.from(portfolio.bucket).download(portfolio.key)).error).toBeNull();
    await removeMedia(owner, "portfolio", portfolio.key); await removeMedia(owner, "portfolio", portfolio.key);
    await rpc(owner, "portfolio_item_purge", { p_item_id: portfolio.id });
    console.info("PASS local-only three-category upload/read/direct-denial, publication/old-token control, revocation-before-cleanup and retry");
  } finally {
    for (const item of items) {
      const state = await owner.rpc("media_storage_resolve", { p_namespace: item.namespace, p_key: item.key, p_operation: "read" });
      if (state.data) await rpc(owner, item.namespace === "avatar" ? "avatar_delete_current" : item.namespace === "portfolio" ? "portfolio_item_delete" : "certificate_delete", item.namespace === "avatar" ? {} : { p_item_id: item.id });
      const cleanup = await admin.storage.from(item.bucket).remove([item.key]); if (cleanup.error) throw Error("Exact local cleanup failed");
      if (item.id) await rpc(owner, item.namespace === "portfolio" ? "portfolio_item_purge" : "certificate_purge", { p_item_id: item.id });
    }
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  }
}, 60_000);
