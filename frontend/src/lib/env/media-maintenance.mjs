// CLI settings stay in the same environment boundary as application settings.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../package.json", import.meta.url));
const { z } = require("zod");
const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_PRIVATE_BUCKET: z.string().min(1).optional(),
});
export function readMaintenanceEnv() {
  return schema.parse({
    SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || undefined,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || undefined,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || undefined,
    R2_PRIVATE_BUCKET: process.env.R2_PRIVATE_BUCKET || undefined,
  });
}
