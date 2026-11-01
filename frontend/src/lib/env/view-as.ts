import { z } from "zod";

/**
 * Admin "View as account" kill switch (docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §11).
 *
 * Server-only and OFF by default: when false the eye control is hidden and every view-as route answers 404, whatever
 * the database permissions say. It is a rollout switch, never an authorization: the database still decides who may view.
 */
export const viewAsEnvSchema = z.object({
  ADMIN_VIEW_AS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

export type ViewAsEnv = z.infer<typeof viewAsEnvSchema>;

export function readViewAsEnv(): ViewAsEnv {
  return viewAsEnvSchema.parse({ ADMIN_VIEW_AS_ENABLED: process.env.ADMIN_VIEW_AS_ENABLED || undefined });
}

/** True only when the feature is explicitly switched on. A malformed value fails closed (disabled). */
export function isViewAsEnabled(): boolean {
  try {
    return readViewAsEnv().ADMIN_VIEW_AS_ENABLED;
  } catch {
    return false;
  }
}
