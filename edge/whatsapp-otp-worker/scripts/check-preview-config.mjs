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
must(config.workers_dev === false && config.preview_urls === false && Array.isArray(config.routes) && config.routes.length === 0, "the Worker must be private: workers_dev off, preview_urls off, no routes (it is reached only through the frontend service binding)");
must(!config.env?.production && !config.site && !config.route, "no production environments or routes permitted");
must(
  config.d1_databases?.length === 1 &&
  config.d1_databases[0]?.binding === "IDEMPOTENCY_DB" &&
  config.d1_databases[0]?.database_name === "aladdin-whatsapp-otp-acceptance" &&
  config.d1_databases[0]?.database_id === "da65d5e4-8344-4078-9c2d-8a4bb4907f79",
  "D1 must be isolated Acceptance replay DB"
);
// Seven DISTINCT secrets: the Meta token, the send, admin and notify signing secrets, the admin GRANT key (which the app server never holds) and the Access service-token pair. The send secret
// must never double as the admin or notify secret, so neither route family can be driven with another's credential.
const EXPECTED_BINDINGS = [
  ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN"],
  ["OTP_SIGNING_SECRET", "PHONE_OTP_WORKER_SECRET"],
  ["OTP_ADMIN_SIGNING_SECRET", "OTP_ADMIN_SIGNING_SECRET"],
  ["OTP_NOTIFY_SIGNING_SECRET", "OTP_NOTIFY_SIGNING_SECRET"],
  ["OTP_ADMIN_GRANT_SECRET", "OTP_ADMIN_GRANT_SECRET"],
  // Cloudflare Access service token (Client ID + Secret) for the alert callback: Worker-only, a dedicated pair, never the frontend's.
  ["OTP_NOTIFY_ACCESS_CLIENT_ID", "OTP_NOTIFY_ACCESS_CLIENT_ID"],
  ["OTP_NOTIFY_ACCESS_CLIENT_SECRET", "OTP_NOTIFY_ACCESS_CLIENT_SECRET"],
];
must(
  config.secrets_store_secrets?.length === EXPECTED_BINDINGS.length &&
  EXPECTED_BINDINGS.every(([binding, secretName]) =>
    config.secrets_store_secrets.some((b) => b.binding === binding && b.secret_name === secretName && b.store_id === "acfaa67f391e499db6fde398022f50ce")
  ) &&
  new Set(config.secrets_store_secrets.map((b) => b.secret_name)).size === EXPECTED_BINDINGS.length,
  "the Meta token, the send/admin/notify signing secrets, the admin grant key and the Access service-token pair must be seven distinct pre-verified account Secrets Store bindings"
);
must(Array.isArray(config.triggers?.crons) && config.triggers.crons.length >= 1, "the scheduled maintenance trigger (journal retention, alert evaluation) must be configured");
must(!("OTP_DAILY_SEND_LIMIT" in (config.vars ?? {})), "the send budget is a Super Admin setting in D1, not an environment variable");
must(/^https:\/\/[a-z0-9.-]+\/api\/internal\/whatsapp-otp\/notify$/.test(String(config.vars?.OTP_NOTIFY_URL ?? "")), "OTP_NOTIFY_URL must be the https URL of the app's notification endpoint");
must(!JSON.stringify(config).includes("SUPABASE_SEND_SMS_HOOK_SECRET"), "the Supabase Send-SMS-hook secret must not be bound: Supabase Phone Auth is never activated for this flow");
must(config.vars?.OTP_ENVIRONMENT === "acceptance" && config.vars?.OTP_RECIPIENT_MODE === "allowlist", "the Acceptance Worker must be environment=acceptance with the recipient allowlist enforced");
must(!("OTP_ALLOWED_RECIPIENTS" in (config.vars ?? {})) && !JSON.stringify(config.vars ?? {}).includes("+20"), "the recipient allowlist (phone numbers) must be set in the Worker dashboard, never in the repository");
must(!("WHATSAPP_GRAPH_BASE_URL" in (config.vars ?? {})), "the Graph URL override is for local rigs only");
must(!config.secrets?.required?.length, "do not require an unprovisioned per-Worker signing secret");
must(config.vars?.WHATSAPP_PHONE_NUMBER_ID === "1458603463983505", "unexpected WhatsApp sender");
must(config.vars?.WHATSAPP_OTP_TEMPLATE === "aladdin_otp" && config.vars?.WHATSAPP_OTP_LANGUAGES === "ar", "unapproved template");
must(!JSON.stringify(config.vars ?? {}).includes("whsec_") && !JSON.stringify(config.vars ?? {}).includes("Bearer "), "credentials must not be in plaintext vars");
if (errors.length) {
  console.error("OTP Preview configuration BLOCKED:\n" + errors.map(s => "- " + s).join("\n"));
  process.exit(1);
}
console.log("OTP Preview configuration PASS: isolated Worker, Acceptance D1, Secrets Store bindings (Meta token + R2 signing secret), allowlist mode, delivery disabled");
