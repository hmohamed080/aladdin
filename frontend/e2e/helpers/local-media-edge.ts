import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { postgresAuthority } from "../../../edge/media-worker/src/authority";
import { createHandler } from "../../../edge/media-worker/src/handler";
import type { ByteCacheLike, Env, R2BucketLike } from "../../../edge/media-worker/src/types";

/**
 * The media Worker's real handler, served over local HTTPS in the test process,
 * for ISOLATED end-to-end tests only. The R2 binding is an S3 client against the
 * local S3-compatible stand-in, Hyperdrive is a direct connection to the local
 * Supabase database as a media_edge LOGIN member, and the edge cache is an
 * in-memory map that counts hits. Nothing here talks to Cloudflare.
 */
export type LocalEdge = { origin: string; stats: { requests: number; cacheHits: number; denied: number; bytes: number }; close(): Promise<void> };

export function s3Bucket(client: S3Client, bucket: string): R2BucketLike {
  const missing = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
  return {
    async get(key, options) {
      try {
        const range = options?.range ? `bytes=${options.range.offset}-${options.range.offset + options.range.length - 1}` : undefined;
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
        const total = out.ContentRange ? Number(out.ContentRange.split("/")[1]) : Number(out.ContentLength);
        return { size: total, body: out.Body!.transformToWebStream() as ReadableStream<Uint8Array> };
      } catch (error) { if (missing(error)) return null; throw error; }
    },
    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: Number(out.ContentLength) };
      } catch (error) { if (missing(error)) return null; throw error; }
    },
  };
}

export async function startLocalEdge(options: {
  port: number; tls: { key: string; cert: string }; s3: S3Client; bucket: string; databaseUrl: string;
  ticketKeys: Record<string, string>; allowedOrigins: string[];
}): Promise<LocalEdge> {
  const stats = { requests: 0, cacheHits: 0, denied: 0, bytes: 0 };
  const bytes = new Map<string, { body: ArrayBuffer; headers: [string, string][] }>();
  const cache: ByteCacheLike = {
    async match(key) {
      const hit = bytes.get(key);
      if (!hit) return undefined;
      stats.cacheHits += 1;
      return new Response(hit.body, { headers: hit.headers });
    },
    async put(key, response) {
      bytes.set(key, { body: await response.arrayBuffer(), headers: [...response.headers] });
    },
  };
  const env: Env = {
    MEDIA_BUCKET: s3Bucket(options.s3, options.bucket),
    HYPERDRIVE: { connectionString: options.databaseUrl },
    TICKET_KEYS: JSON.stringify(options.ticketKeys),
    PRIVATE_ROUTES: "on", PUBLIC_ROUTES: "on", VIDEO_ROUTES: "on", EDGE_CACHE: "on",
    VIDEO_ALLOWED_ORIGINS: options.allowedOrigins.join(","),
  };
  const handle = createHandler({ authority: (e) => postgresAuthority(e.HYPERDRIVE.connectionString), now: () => Date.now(), cache: () => cache });
  const origin = `https://127.0.0.1:${options.port}`;

  async function serve(req: IncomingMessage, res: ServerResponse) {
    stats.requests += 1;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
    const waits: Promise<unknown>[] = [];
    const response = await handle(new Request(`${origin}${req.url}`, { method: req.method, headers }), env,
      { waitUntil: (p) => { waits.push(p); } });
    if (response.status === 404) stats.denied += 1;
    stats.bytes += Number(response.headers.get("content-length") ?? 0);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body as never).pipe(res);
    else res.end();
    await Promise.allSettled(waits);
  }

  const server = createServer(options.tls, (req, res) => { serve(req, res).catch(() => { res.statusCode = 500; res.end(); }); });
  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));
  return { origin, stats, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
