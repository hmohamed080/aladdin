import { z } from "zod";

/**
 * Admin "View as account" kill switch (docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §11).
 *
 * Server-only and OFF by default: when false the eye control is hidden and every view-as route answers 404, whatever
 * the database permissions say. It is a rollout switch, never an authorization: the database still decides who may view.
 */
export const viewAsEnvSchema = z.object({
  ADMIN_VIEW_AS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  /** Private media inside the view (Stage 4). Needs ADMIN_VIEW_AS_ENABLED and the existing media-edge delivery; otherwise placeholders. */
  ADMIN_VIEW_AS_MEDIA_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

export type ViewAsEnv = z.infer<typeof viewAsEnvSchema>;

export function readViewAsEnv(): ViewAsEnv {
  return viewAsEnvSchema.parse({
    ADMIN_VIEW_AS_ENABLED: process.env.ADMIN_VIEW_AS_ENABLED || undefined,
    ADMIN_VIEW_AS_MEDIA_ENABLED: process.env.ADMIN_VIEW_AS_MEDIA_ENABLED || undefined,
  });
}

/** True only when the feature is explicitly switched on. A malformed value fails closed (disabled). */
export function isViewAsEnabled(): boolean {
  try {
    return readViewAsEnv().ADMIN_VIEW_AS_ENABLED;
  } catch {
    return false;
  }
}

/** Private media in the view: only when the view itself is on AND the media switch is explicitly on. Fails closed. */
export function isViewAsMediaEnabled(): boolean {
  try {
    const env = readViewAsEnv();
    return env.ADMIN_VIEW_AS_ENABLED && env.ADMIN_VIEW_AS_MEDIA_ENABLED;
  } catch {
    return false;
  }
}

/**
 * The media-edge settings the View-As minter needs, and NOTHING else. Deliberately not `readStorageEnv()`: that module also names the
 * service-role key and every storage secret, and the View-As read-only guard forbids reaching it. Same variables, same rules as
 * lib/env/storage.ts (an https origin without a path, a lowercase key id, a base64url secret of at least 32 bytes); pinned equal by
 * view-as.test.ts. Any invalid or missing value means "no private media" (null), never a partial configuration.
 */
const blank = (v: unknown) => (v === "" ? undefined : v);
const viewAsEdgeSchema = z.object({
  MEDIA_EDGE_DELIVERY_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  MEDIA_EDGE_ORIGIN: z.preprocess(blank, z.string().url().optional()),
  MEDIA_EDGE_TICKET_KID: z.preprocess(blank, z.string().regex(/^[a-z0-9]{1,16}$/).optional()),
  MEDIA_EDGE_TICKET_SECRET: z.preprocess(blank, z.string().regex(/^[A-Za-z0-9_-]+$/).optional()),
});

export type ViewAsEdgeConfig = { origin: string; kid: string; secret: Uint8Array };

export function readViewAsEdgeConfig(): ViewAsEdgeConfig | null {
  try {
    const env = viewAsEdgeSchema.parse({
      MEDIA_EDGE_DELIVERY_ENABLED: process.env.MEDIA_EDGE_DELIVERY_ENABLED,
      MEDIA_EDGE_ORIGIN: process.env.MEDIA_EDGE_ORIGIN,
      MEDIA_EDGE_TICKET_KID: process.env.MEDIA_EDGE_TICKET_KID,
      MEDIA_EDGE_TICKET_SECRET: process.env.MEDIA_EDGE_TICKET_SECRET,
    });
    if (!env.MEDIA_EDGE_DELIVERY_ENABLED) return null;
    const origin = env.MEDIA_EDGE_ORIGIN?.replace(/\/$/, "");
    if (!origin || !/^https:\/\/[^/]+$/.test(origin) || !env.MEDIA_EDGE_TICKET_KID || !env.MEDIA_EDGE_TICKET_SECRET) return null;
    const secret = new Uint8Array(Buffer.from(env.MEDIA_EDGE_TICKET_SECRET, "base64url"));
    if (secret.length < 32) return null;
    return { origin, kid: env.MEDIA_EDGE_TICKET_KID, secret };
  } catch {
    return null;
  }
}
