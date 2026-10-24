import "server-only";
import { z } from "zod";

const optional = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
export const storageEnvSchema = z.object({
  R2_STORAGE_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  R2_PRODUCTION_WRITES_APPROVED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  R2_ACCOUNT_ID: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^[a-f0-9]{32}$/).optional()),
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_PUBLIC_BUCKET: optional,
  R2_PRIVATE_BUCKET: optional,
  R2_PUBLIC_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  SUPABASE_SERVICE_ROLE_KEY: optional,
  // Edge delivery through the media Worker (edge/media-worker). Off by default; the
  // application proxy (server/storage/delivery.ts) remains the path when off.
  MEDIA_EDGE_DELIVERY_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // Mode C (published portfolio, listed avatars) can be held back independently.
  MEDIA_EDGE_PUBLIC_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  MEDIA_EDGE_ORIGIN: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  MEDIA_EDGE_TICKET_KID: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^[a-z0-9]{1,16}$/).optional()),
  MEDIA_EDGE_TICKET_SECRET: optional,
  // Video (ADR-0020): uploads go straight to R2 and playback only through the edge
  // Worker, so this needs both of those on. Off by default.
  VIDEO_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // LOCAL ONLY: an S3-compatible endpoint standing in for R2 (e.g. SeaweedFS) in
  // isolated tests. Refused outside NEXT_PUBLIC_APP_ENV=local.
  R2_LOCAL_S3_ENDPOINT: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
}).superRefine((env, ctx) => {
  if (env.VIDEO_ENABLED && (!env.R2_STORAGE_ENABLED || !env.MEDIA_EDGE_DELIVERY_ENABLED)) {
    ctx.addIssue({ code: "custom", path: ["VIDEO_ENABLED"], message: "Video needs R2_STORAGE_ENABLED and MEDIA_EDGE_DELIVERY_ENABLED" });
  }
  if (env.R2_LOCAL_S3_ENDPOINT && env.APP_ENV !== "local") {
    ctx.addIssue({ code: "custom", path: ["R2_LOCAL_S3_ENDPOINT"], message: "Only allowed in local isolated tests" });
  }
  if (env.R2_PUBLIC_BASE_URL && !env.R2_PUBLIC_BASE_URL.startsWith("https://")) {
    ctx.addIssue({ code: "custom", path: ["R2_PUBLIC_BASE_URL"], message: "Public media must use HTTPS" });
  }
  if (env.R2_PUBLIC_BUCKET && env.R2_PUBLIC_BUCKET === env.R2_PRIVATE_BUCKET) {
    ctx.addIssue({ code: "custom", path: ["R2_PRIVATE_BUCKET"], message: "Public and private buckets must differ" });
  }
  if (env.MEDIA_EDGE_DELIVERY_ENABLED) {
    if (!env.MEDIA_EDGE_ORIGIN || !/^https:\/\/[^/]+$/.test(env.MEDIA_EDGE_ORIGIN.replace(/\/$/, ""))) {
      ctx.addIssue({ code: "custom", path: ["MEDIA_EDGE_ORIGIN"], message: "Edge delivery requires an HTTPS origin without a path" });
    }
    if (!env.MEDIA_EDGE_TICKET_KID) ctx.addIssue({ code: "custom", path: ["MEDIA_EDGE_TICKET_KID"], message: "Required for edge delivery" });
    const secret = env.MEDIA_EDGE_TICKET_SECRET;
    if (!secret || !/^[A-Za-z0-9_-]+$/.test(secret) || Buffer.from(secret, "base64url").length < 32) {
      ctx.addIssue({ code: "custom", path: ["MEDIA_EDGE_TICKET_SECRET"], message: "Edge delivery requires a base64url secret of at least 32 bytes" });
    }
  }
  if (env.R2_STORAGE_ENABLED) {
    for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PRIVATE_BUCKET", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
      if (!env[name]) ctx.addIssue({ code: "custom", path: [name], message: "Required for R2 writes" });
    }
  }
});

export function readStorageEnv() {
  return storageEnvSchema.parse({
    R2_STORAGE_ENABLED: process.env.R2_STORAGE_ENABLED,
    R2_PRODUCTION_WRITES_APPROVED: process.env.R2_PRODUCTION_WRITES_APPROVED,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_PUBLIC_BUCKET: process.env.R2_PUBLIC_BUCKET,
    R2_PRIVATE_BUCKET: process.env.R2_PRIVATE_BUCKET,
    R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MEDIA_EDGE_DELIVERY_ENABLED: process.env.MEDIA_EDGE_DELIVERY_ENABLED,
    MEDIA_EDGE_PUBLIC_ENABLED: process.env.MEDIA_EDGE_PUBLIC_ENABLED,
    MEDIA_EDGE_ORIGIN: process.env.MEDIA_EDGE_ORIGIN,
    MEDIA_EDGE_TICKET_KID: process.env.MEDIA_EDGE_TICKET_KID,
    MEDIA_EDGE_TICKET_SECRET: process.env.MEDIA_EDGE_TICKET_SECRET,
    R2_LOCAL_S3_ENDPOINT: process.env.R2_LOCAL_S3_ENDPOINT,
    VIDEO_ENABLED: process.env.VIDEO_ENABLED,
    APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  });
}
