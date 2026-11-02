#!/usr/bin/env node
// Acceptance-only deploy guard. Never call Cloudflare APIs from this script.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Optional path is for negative fixture tests; CI/deploy calls without arguments.
const configPath = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const errors = [];
const must = (predicate, reason) => { if (!predicate) errors.push(reason); };
must(config.name === "aladdin-whatsapp-otp-preview", "unexpected Worker name");
must(config.vars?.WHATSAPP_DELIVERY_ENABLED === "false", "WhatsApp delivery must remain disabled");
must(config.workers_dev === true && Array.isArray(config.routes) && config.routes.length === 0, "preview must use isolated workers.dev with no domain routes");
must(!config.env?.production && !config.site && !config.route, "no production environments or routes permitted");
must(
  config.d1_databases?.length === 1 &&
  config.d1_databases[0]?.binding === "IDEMPOTENCY_DB" &&
  config.d1_databases[0]?.database_name === "aladdin-whatsapp-otp-acceptance" &&
  config.d1_databases[0]?.database_id === "da65d5e4-8344-4078-9c2d-8a4bb4907f79",
  "D1 must be isolated Acceptance replay DB"
);
must(
  config.secrets_store_secrets?.length === 2 &&
  [["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN"], ["OTP_SIGNING_SECRET", "PHONE_OTP_WORKER_SECRET"]].every(([binding, secretName]) =>
    config.secrets_store_secrets.some((b) => b.binding === binding && b.secret_name === secretName && b.store_id === "acfaa67f391e499db6fde398022f50ce")
  ),
  "the Meta token and the app<->Worker signing secret must be the two pre-verified account Secrets Store bindings"
);
must(!JSON.stringify(config).includes("SUPABASE_SEND_SMS_HOOK_SECRET"), "the Supabase Send-SMS-hook secret must not be bound: Supabase Phone Auth is never activated for this flow");
must(config.vars?.OTP_ENVIRONMENT === "acceptance" && config.vars?.OTP_RECIPIENT_MODE === "allowlist", "the Acceptance Worker must be environment=acceptance with the recipient allowlist enforced");
must(!("OTP_ALLOWED_RECIPIENTS" in (config.vars ?? {})) && !JSON.stringify(config.vars ?? {}).includes("+20"), "the recipient allowlist (phone numbers) must be set in the Worker dashboard, never in the repository");
must(!("WHATSAPP_GRAPH_BASE_URL" in (config.vars ?? {})), "the Graph URL override is for local rigs only");
must(!config.secrets?.required?.length, "do not require an unprovisioned per-Worker signing secret");
must(config.vars?.WHATSAPP_PHONE_NUMBER_ID === "1415528588305492", "unexpected WhatsApp sender");
must(config.vars?.WHATSAPP_OTP_TEMPLATE === "aladdin_otp" && config.vars?.WHATSAPP_OTP_LANGUAGES === "ar", "unapproved template");
must(!JSON.stringify(config.vars ?? {}).includes("whsec_") && !JSON.stringify(config.vars ?? {}).includes("Bearer "), "credentials must not be in plaintext vars");
if (errors.length) {
  console.error("OTP Preview configuration BLOCKED:\n" + errors.map(s => "- " + s).join("\n"));
  process.exit(1);
}
console.log("OTP Preview configuration PASS: isolated Worker, Acceptance D1, Secrets Store bindings (Meta token + R2 signing secret), allowlist mode, delivery disabled");
