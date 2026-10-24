import { defineConfig } from "vitest/config";

// The Worker's rules (src/policy.ts) are pure, so they run in Node with no
// Cloudflare account; the Container class itself is exercised by `wrangler dev`.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
