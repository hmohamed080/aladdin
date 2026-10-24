import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is `force-dynamic`, so there is no ISR output to store: the default
// (no incremental cache) is correct and needs no R2 bucket or KV namespace.
const config = {
  ...defineCloudflareConfig({}),
  // Marks the Next build as the Workers build: next.config.ts then swaps the
  // image engine to the Images binding, keeping sharp out of the Worker bundle.
  buildCommand: "ALADDIN_BUILD_TARGET=workers pnpm build",
};

export default config;
