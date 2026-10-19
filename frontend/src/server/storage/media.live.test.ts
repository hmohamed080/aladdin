import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
vi.mock("server-only", () => ({}));
import { readPublicEnv } from "@/lib/env";
import { authorizeMediaUpload, verifyPendingMedia, resolveMedia, removeMedia, readMediaUrl, mediaProvider } from "./media";
import { deliverMedia } from "./delivery";

// Opt-in real HTTP tests: no provider/auth/RPC mocks. The dedicated URL is the safety gate.
const isolated = process.env.MEDIA_ACCEPTANCE_LIVE === "true" && process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:60321";
describe.skipIf(!isolated)("isolated real Supabase/R2 media backend", { timeout: 30_000 }, () => {
  let owner: SupabaseClient; let other: SupabaseClient;
  const createdRows: Array<{ item_id: string; object_key: string }> = [];
  async function clean(row: { item_id: string; object_key: string }) {
    const retired = await owner.rpc("portfolio_item_delete", { p_item_id: row.item_id });
    if (retired.error) throw new Error("Synthetic cleanup retirement failed");
    await removeMedia(owner, "portfolio", row.object_key);
    if ((await owner.rpc("portfolio_item_purge", { p_item_id: row.item_id })).error) throw new Error("Synthetic cleanup purge failed");
  }
  beforeAll(async () => {
    const env = readPublicEnv();
    if (env.NEXT_PUBLIC_APP_ENV !== "local" || process.env.R2_PRODUCTION_WRITES_APPROVED !== "false") throw new Error("Local-only acceptance");
    if (process.env.R2_STORAGE_ENABLED === "true" && (process.env.R2_PRIVATE_BUCKET !== "aladdin-r2-acceptance-20261011-private" || process.env.R2_PUBLIC_BUCKET !== "aladdin-r2-acceptance-20261011-public")) throw new Error("Disposable R2 buckets required");
    owner = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    other = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    for (const [client, email] of [[owner, "ahmed@example.test"], [other, "sara@example.test"]] as const) {
      const { error } = await client.auth.signInWithPassword({ email, password: "Zq9$Kx4#WmT7!Pn2Rb" });
      if (error) throw new Error("Synthetic sign-in failed");
    }
    const previous = await owner.from("portfolio_items").select("id,object_key").eq("title", "Synthetic backend acceptance");
    for (const row of previous.data ?? []) await clean({ item_id: row.id, object_key: row.object_key });
  });
  afterEach(async () => { for (const row of createdRows.splice(0)) await clean(row); });
  async function pending() {
    const { data, error } = await owner.rpc("portfolio_item_create", { p_title: "Synthetic backend acceptance", p_description: null, p_content_type: "image/png" });
    if (error || !data?.[0]) throw new Error("Synthetic metadata creation failed");
    const row = data[0] as { item_id: string; object_key: string };
    createdRows.push(row);
    return row;
  }
  async function put(key: string, bytes: Uint8Array) {
    const grant = await authorizeMediaUpload(owner, "portfolio", key, bytes.length);
    if (grant.provider === "supabase") {
      const { error } = await owner.storage.from(grant.bucket).uploadToSignedUrl(key, grant.token, bytes, { contentType: "image/png", upsert: false });
      if (error) throw new Error("Synthetic upload failed");
    } else {
      const response = await fetch(grant.url, { method: "PUT", headers: grant.headers, body: new Uint8Array(bytes) });
      if (!response.ok) throw new Error(`R2 PUT refused: ${response.status}`);
    }
  }
  it("the old finalizer cannot mark a nonexistent object ready", async () => {
    const row = await pending();
    const { error } = await owner.rpc("portfolio_item_finalize", { p_item_id: row.item_id });
    expect(error?.code).toBe("42501");
    await expect(verifyPendingMedia(owner, "portfolio", row.object_key)).rejects.toThrow();
    expect((await resolveMedia(owner, "portfolio", row.object_key, "read")).state).toBe("pending");
  });
  it("actual bytes earn a receipt; foreign access/upload/deletion stays denied", async () => {
    const row = await pending();
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    await put(row.object_key, bytes);
    await verifyPendingMedia(owner, "portfolio", row.object_key);
    expect((await owner.rpc("portfolio_item_finalize", { p_item_id: row.item_id })).error).toBeNull();
    await verifyPendingMedia(owner, "portfolio", row.object_key);
    for (const operation of ["read", "upload", "delete"] as const) {
      await expect(resolveMedia(other, "portfolio", row.object_key, operation)).rejects.toThrow("unavailable");
    }
    const { data } = await owner.from("media_storage_locations").select("size_bytes,sha256").eq("object_key", row.object_key).single();
    expect(data?.size_bytes).toBe(bytes.length);
    expect(data?.sha256).toMatch(/^[a-f0-9]{64}$/);
    const routing = process.env.R2_STORAGE_ENABLED;
    try {
      process.env.R2_STORAGE_ENABLED = "false";
      expect((await resolveMedia(owner, "portfolio", row.object_key, "read")).provider).toBe(routing === "true" ? "r2" : "supabase");
      expect(await readMediaUrl(owner, "portfolio", row.object_key)).toMatch(/^\/api\/media\/portfolio\?key=/);
      expect(new Uint8Array(await (await deliverMedia(owner, "portfolio", row.object_key)).arrayBuffer())).toEqual(new Uint8Array(bytes));
    } finally { process.env.R2_STORAGE_ENABLED = routing; }
  });
  it("a claimed PNG with malformed stored bytes stays pending", async () => {
    const row = await pending();
    await put(row.object_key, new Uint8Array([137,80,78,71,13,10,26,10]));
    await expect(verifyPendingMedia(owner, "portfolio", row.object_key)).rejects.toThrow();
    expect((await owner.rpc("portfolio_item_finalize", { p_item_id: row.item_id })).error?.code).toBe("42501");
  });
  it("anonymous access and oversized reservations are refused; duplicate verification is safe", async () => {
    const row = await pending(); const env = readPublicEnv();
    const anonymous = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    await expect(resolveMedia(anonymous, "portfolio", row.object_key, "upload")).rejects.toThrow("unavailable");
    if (process.env.R2_STORAGE_ENABLED === "true") await expect(authorizeMediaUpload(owner, "portfolio", row.object_key, 5242881)).rejects.toThrow("outside policy");
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    await put(row.object_key, bytes);
    await Promise.all([verifyPendingMedia(owner, "portfolio", row.object_key), verifyPendingMedia(owner, "portfolio", row.object_key)]);
    expect((await owner.rpc("portfolio_item_finalize", { p_item_id: row.item_id })).error).toBeNull();
  });
  it("interrupted upload retries and concurrent independent uploads finalize safely", async () => {
    const rows = await Promise.all([pending(), pending()]);
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    await authorizeMediaUpload(owner, "portfolio", rows[0].object_key, bytes.length);
    await expect(verifyPendingMedia(owner, "portfolio", rows[0].object_key)).rejects.toThrow();
    await Promise.all(rows.map(async (row) => {
      await put(row.object_key, bytes);
      await verifyPendingMedia(owner, "portfolio", row.object_key);
      expect((await owner.rpc("portfolio_item_finalize", { p_item_id: row.item_id })).error).toBeNull();
    }));
    await Promise.all(rows.map(async (row) => {
      expect((await owner.rpc("portfolio_item_finalize", { p_item_id: row.item_id })).error).toBeNull();
    }));
  });
  it("private PDF certificates deny another tenant upload/read/delete and service attestation", async () => {
    const ownerMembership = await owner.from("memberships").select("organization_id").eq("user_id", (await owner.auth.getUser()).data.user!.id);
    const otherMembership = await other.from("memberships").select("organization_id").eq("user_id", (await other.auth.getUser()).data.user!.id);
    expect(ownerMembership.error).toBeNull(); expect(otherMembership.error).toBeNull();
    expect(ownerMembership.data?.length).toBeGreaterThan(0); expect(otherMembership.data?.length).toBeGreaterThan(0);
    expect(ownerMembership.data?.some((a) => otherMembership.data?.some((b) => a.organization_id === b.organization_id))).toBe(false);
    const created = await owner.rpc("certificate_create", { p_title: "Synthetic PDF acceptance", p_issuer: null,
      p_issued_on: null, p_expires_on: null, p_content_type: "application/pdf", p_original_filename: "synthetic.pdf" });
    expect(created.error).toBeNull();
    const { item_id, object_path: object_key } = created.data[0];
    try {
      const doc = await PDFDocument.create(); doc.addPage(); const bytes = await doc.save();
      const grant = await authorizeMediaUpload(owner, "certificate", object_key, bytes.length);
      if (grant.provider === "r2") expect((await fetch(grant.url, { method: "PUT", headers: grant.headers, body: new Uint8Array(bytes) })).ok).toBe(true);
      else expect((await owner.storage.from(grant.bucket).uploadToSignedUrl(object_key, grant.token, bytes, { contentType: "application/pdf" })).error).toBeNull();
      await verifyPendingMedia(owner, "certificate", object_key);
      expect((await owner.rpc("certificate_finalize", { p_item_id: item_id })).error).toBeNull();
      for (const operation of ["read", "upload", "delete"] as const) await expect(resolveMedia(other, "certificate", object_key, operation)).rejects.toThrow("unavailable");
      expect((await other.rpc("certificate_delete", { p_item_id: item_id })).error).not.toBeNull();
      expect((await owner.rpc("media_storage_attest", { p_namespace: "certificate", p_key: object_key,
        p_owner: (await owner.auth.getUser()).data.user!.id, p_provider: grant.provider, p_size: bytes.length,
        p_content_type: "application/pdf", p_sha256: "0".repeat(64) })).error).not.toBeNull();
      expect(await readMediaUrl(owner, "certificate", object_key)).toMatch(/^\/api\/media\/certificate\?key=/);
      expect(new Uint8Array(await (await deliverMedia(owner, "certificate", object_key)).arrayBuffer())).toEqual(bytes);
      if (grant.provider === "r2") {
        const unsigned = new URL(await mediaProvider(owner, "certificate", "r2").getReadAccess(object_key, 30)); unsigned.search = "";
        expect((await fetch(unsigned)).ok).toBe(false);
      }
    } finally {
      expect((await owner.rpc("certificate_delete", { p_item_id: item_id })).error).toBeNull();
      await removeMedia(owner, "certificate", object_key);
      expect((await owner.rpc("certificate_purge", { p_item_id: item_id })).error).toBeNull();
    }
  });
  it("avatar ownership and revocation survive the real provider lifecycle", async () => {
    const created = await owner.rpc("avatar_request_upload", { p_content_type: "image/jpeg" });
    expect(created.error).toBeNull(); const key = created.data as string;
    await expect(resolveMedia(other, "avatar", key, "read")).rejects.toThrow("unavailable");
    const bytes = await sharp({ create: { width: 512, height: 512, channels: 3, background: "white" } }).jpeg().toBuffer();
    const grant = await authorizeMediaUpload(owner, "avatar", key, bytes.length);
    if (grant.provider === "r2") expect((await fetch(grant.url, { method: "PUT", headers: grant.headers, body: new Uint8Array(bytes) })).ok).toBe(true);
    else expect((await owner.storage.from(grant.bucket).uploadToSignedUrl(key, grant.token, bytes, { contentType: "image/jpeg" })).error).toBeNull();
    await verifyPendingMedia(owner, "avatar", key);
    expect((await owner.rpc("avatar_confirm_upload", { p_object_key: key })).error).toBeNull();
    try {
      // Existing avatar policy permits current-avatar display; mutation stays owner-only.
      expect((await resolveMedia(other, "avatar", key, "read")).owner).toBeNull();
      for (const operation of ["upload", "delete"] as const) await expect(resolveMedia(other, "avatar", key, operation)).rejects.toThrow("unavailable");
      expect((await other.rpc("avatar_confirm_upload", { p_object_key: key })).error).not.toBeNull();
    } finally {
      expect((await owner.rpc("avatar_delete_current")).error).toBeNull();
      await removeMedia(owner, "avatar", key);
    }
    await expect(resolveMedia(owner, "avatar", key, "read")).rejects.toThrow("unavailable");
    await expect(resolveMedia(other, "avatar", key, "read")).rejects.toThrow("unavailable");
  });
  it("two authenticated users upload concurrently without crossing ownership", async () => {
    const bytes = await sharp({ create: { width: 512, height: 512, channels: 3, background: "white" } }).jpeg().toBuffer();
    const keys: string[] = [];
    try {
      await Promise.all([owner, other].map(async (client) => {
        const row = await client.rpc("avatar_request_upload", { p_content_type: "image/jpeg" });
        expect(row.error).toBeNull(); const key = row.data as string; keys.push(key);
        const grant = await authorizeMediaUpload(client, "avatar", key, bytes.length);
        if (grant.provider === "r2") expect((await fetch(grant.url, { method: "PUT", headers: grant.headers, body: new Uint8Array(bytes) })).ok).toBe(true);
        else expect((await client.storage.from(grant.bucket).uploadToSignedUrl(key, grant.token, bytes, { contentType: "image/jpeg" })).error).toBeNull();
        await verifyPendingMedia(client, "avatar", key);
        expect((await client.rpc("avatar_confirm_upload", { p_object_key: key })).error).toBeNull();
        expect((await resolveMedia(client, "avatar", key, "read")).owner).toBe((await client.auth.getUser()).data.user!.id);
      }));
      expect(new Set(keys).size).toBe(2);
    } finally {
      for (const client of [owner, other]) {
        const retired = await client.rpc("avatar_delete_current"); expect(retired.error).toBeNull();
        if (typeof retired.data === "string") await removeMedia(client, "avatar", retired.data);
      }
    }
  });
});
