// End-to-end against a LOCAL Supabase database with the real postgres.js driver:
// ticket -> media_edge_authorize as a media_edge LOGIN member -> fake R2 bytes,
// then the same ticket after revocation. Skipped unless MEDIA_EDGE_LIVE_ADMIN_URL
// points at localhost (e.g. postgres://postgres:postgres@127.0.0.1:54322/postgres).
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import vectors from "./ticket-vectors.json";
import { postgresAuthority } from "../src/authority";
import { createHandler } from "../src/handler";
import { parseTicketKeys, signTicket } from "../src/ticket";
import type { Env } from "../src/types";

const admin = process.env.MEDIA_EDGE_LIVE_ADMIN_URL;
const local = !!admin && ["127.0.0.1", "localhost"].includes(new URL(admin).hostname);
const OWNER = "70000009-0000-4000-8000-000000000009";

describe.skipIf(!local)("live local database authority", () => {
  it("allows the owner, then denies the same ticket after sign-out, unpublish and delete", async () => {
    const sql = postgres(admin!, { max: 1 });
    const role = `media_edge_live_${randomBytes(4).toString("hex")}`;
    const password = randomBytes(18).toString("base64url");
    const item = randomUUID(), session = randomUUID(), key = `${item}.png`;
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    try {
      await sql.unsafe(`create role ${role} login password '${password}' in role media_edge`);
      await sql`insert into auth.sessions(id,user_id,created_at,aal) values (${session},${OWNER},now(),'aal1')`;
      await sql`insert into public.portfolio_items(id,owner_user_id,object_key,content_type,state,title) values (${item},${OWNER},${key},'image/png','ready','Live edge test')`;
      await sql`insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type,size_bytes,sha256,verified_at)
        values ('portfolio',${key},${OWNER},'r2','image/png',${bytes.length},${"a".repeat(64)},now())`;
      const url = new URL(admin!); url.username = role; url.password = password;
      const env: Env = {
        MEDIA_BUCKET: {
          async get(k) { return k === `portfolio/${key}` ? { size: bytes.length, body: new Blob([bytes]).stream() } : null; },
          async head(k) { return k === `portfolio/${key}` ? { size: bytes.length } : null; },
        },
        HYPERDRIVE: { connectionString: url.toString() }, TICKET_KEYS: JSON.stringify(vectors.keys), PRIVATE_ROUTES: "on", PUBLIC_ROUTES: "on",
      };
      const waits: Promise<unknown>[] = [];
      const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
      const handle = createHandler({ authority: (e) => postgresAuthority(e.HYPERDRIVE.connectionString), now: () => Date.now() });
      const exp = Math.floor(Date.now() / 1000) + 90;
      const ticket = await signTicket("k1", parseTicketKeys(JSON.stringify(vectors.keys)).get("k1")!,
        { v: 1, ns: "portfolio", k: key, var: "original", sub: OWNER, sid: session, ws: null, exp });
      const privateUrl = `https://media.example.test/m/portfolio/original?t=${ticket}`;
      const publicUrl = `https://media.example.test/c/portfolio/${item}/original`;

      const ok = await handle(new Request(privateUrl), env, ctx);
      expect(ok.status).toBe(200);
      expect(new Uint8Array(await ok.arrayBuffer())).toEqual(bytes);
      expect((await handle(new Request(publicUrl), env, ctx)).status).toBe(404);

      await sql`update public.portfolio_items set visibility='public' where id=${item}`;
      expect((await handle(new Request(publicUrl), env, ctx)).status).toBe(200);
      await sql`update public.portfolio_items set visibility='private' where id=${item}`;
      expect((await handle(new Request(publicUrl), env, ctx)).status).toBe(404);

      await sql`delete from auth.sessions where id=${session}`;
      expect((await handle(new Request(privateUrl), env, ctx)).status).toBe(404);
      await sql`insert into auth.sessions(id,user_id,created_at,aal) values (${session},${OWNER},now(),'aal1')`;
      expect((await handle(new Request(privateUrl), env, ctx)).status).toBe(200);
      await sql`update public.portfolio_items set state='deleted' where id=${item}`;
      expect((await handle(new Request(privateUrl), env, ctx)).status).toBe(404);

      // The Worker's login can do nothing else: no table reads, no other RPCs.
      const worker = postgres(url.toString(), { max: 1 });
      try {
        await expect(worker`select count(*) from public.users`).rejects.toThrow(/permission denied/);
        await expect(worker`select public.media_storage_resolve('portfolio', ${key}, 'read')`).rejects.toThrow(/permission denied/);
      } finally { await worker.end(); }
      await Promise.all(waits);
    } finally {
      await sql`delete from public.media_storage_locations where namespace='portfolio' and object_key=${key}`;
      await sql`delete from public.portfolio_items where id=${item}`;
      await sql`delete from auth.sessions where id=${session}`;
      await sql.unsafe(`drop role if exists ${role}`);
      await sql.end();
    }
  }, 30_000);
});
