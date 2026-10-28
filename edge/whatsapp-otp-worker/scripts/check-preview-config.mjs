#!/usr/bin/env node
// Acceptance-only deploy guard. Never call Cloudflare APIs from this script.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
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
  config.secrets_store_secrets?.length === 1 &&
  config.secrets_store_secrets[0]?.binding === "WHATSAPP_ACCESS_TOKEN" &&
  config.secrets_store_secrets[0]?.secret_name === "WHATSAPP_ACCESS_TOKEN" &&
  config.secrets_store_secrets[0]?.store_id === "acfaa67f391e499db6fde398022f50ce",
  "Meta token must use the pre-verified account Secrets Store binding"
);
must(
  config.secrets?.required?.includes("SUPABASE_SEND_SMS_HOOK_SECRET"),
  "Supabase signing secret is required for deployment"
);
must(config.vars?.WHATSAPP_PHONE_NUMBER_ID === "1415528588305492", "unexpected WhatsApp sender");
must(config.vars?.WHATSAPP_OTP_TEMPLATE === "aladdin_otp" && config.vars?.WHATSAPP_OTP_LANGUAGE === "ar", "unapproved template");
must(!JSON.stringify(config.vars ?? {}).includes("whsec_") && !JSON.stringify(config.vars ?? {}).includes("Bearer "), "credentials must not be in plaintext vars");
if (errors.length) {
  console.error("OTP Preview configuration BLOCKED:\n" + errors.map(s => "- " + s).join("\n"));
  process.exit(1);
}
console.log("OTP Preview configuration PASS: isolated Worker, Acceptance D1, approved Secrets Store binding, delivery disabled");
