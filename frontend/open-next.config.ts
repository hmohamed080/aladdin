import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is `force-dynamic`, so there is no ISR output to store: the default
// (no incremental cache) is correct and needs no R2 bucket or KV namespace.
export default defineCloudflareConfig({});
