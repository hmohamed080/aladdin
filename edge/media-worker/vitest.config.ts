import { defineConfig } from "vitest/config";

// Node 20+ provides WebCrypto, fetch Response/Request and web streams, so the
// Worker logic runs here against fake R2 and database bindings; no Cloudflare account.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
