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
// The permit is only ONE of the three Worker-side conditions (permit AND audited Super Admin switch in D1 AND fresh attestation); the switch starts OFF.
must(config.vars?.WHATSAPP_DELIVERY_ENABLED === "true" || config.vars?.WHATSAPP_DELIVERY_ENABLED === "false", "WHATSAPP_DELIVERY_ENABLED must be the literal string \"true\" or \"false\" (this guard accepts \"true\" for the Acceptance Worker only: the name check above and OTP_ENVIRONMENT=acceptance below pin it to Acceptance)");
must(config.workers_dev === false && config.preview_urls === false && Array.isArray(config.routes) && config.routes.length === 0, "the Worker must be private: workers_dev off, preview_urls off, no routes (it is reached only through the frontend service binding)");
must(!config.env?.production && !config.site && !config.route, "no production environments or routes permitted");
must(
  config.d1_databases?.length === 1 &&
  config.d1_databases[0]?.binding === "IDEMPOTENCY_DB" &&
  config.d1_databases[0]?.database_name === "aladdin-whatsapp-otp-acceptance" &&
  config.d1_databases[0]?.database_id === "da65d5e4-8344-4078-9c2d-8a4bb4907f79",
  "D1 must be isolated Acceptance replay DB"
);
// Five DISTINCT secrets: the Meta token, the send, admin and notify signing secrets and the admin GRANT key (which the app server never holds). The send secret
// must never double as the admin or notify secret, so neither route family can be driven with another's credential.
const EXPECTED_BINDINGS = [
  ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN"],
  ["OTP_SIGNING_SECRET", "PHONE_OTP_WORKER_SECRET"],
  ["OTP_ADMIN_SIGNING_SECRET", "OTP_ADMIN_SIGNING_SECRET"],
  ["OTP_NOTIFY_SIGNING_SECRET", "OTP_NOTIFY_SIGNING_SECRET"],
  ["OTP_ADMIN_GRANT_SECRET", "OTP_ADMIN_GRANT_SECRET"],
];
must(
  config.secrets_store_secrets?.length === EXPECTED_BINDINGS.length &&
  EXPECTED_BINDINGS.every(([binding, secretName]) =>
    config.secrets_store_secrets.some((b) => b.binding === binding && b.secret_name === secretName && b.store_id === "acfaa67f391e499db6fde398022f50ce")
  ) &&
  new Set(config.secrets_store_secrets.map((b) => b.secret_name)).size === EXPECTED_BINDINGS.length,
  "the Meta token, the send/admin/notify signing secrets, and the admin grant key must be five distinct pre-verified account Secrets Store bindings"
);
// The alert callback travels over ONE private Service Binding to the Acceptance frontend (never the public hostname, which is behind Access and
// unreachable from a Worker: Cloudflare 1042). No Access credential, no public-fetch compatibility flag, no second or production binding.
must(
  Array.isArray(config.services) && config.services.length === 1 &&
  config.services[0]?.binding === "APP_NOTIFY" && config.services[0]?.service === "aladdin-frontend-preview" &&
  !config.services[0]?.environment && !config.services[0]?.entrypoint,
  "the alert callback must use exactly one private Service Binding APP_NOTIFY -> aladdin-frontend-preview"
);
must(!JSON.stringify(config).includes("OTP_NOTIFY_ACCESS") && !JSON.stringify(config).includes("CF-Access"), "no Cloudflare Access credential may be bound: the internal binding does not traverse Access");
must(!(config.compatibility_flags ?? []).includes("global_fetch_strictly_public"), "global_fetch_strictly_public must not be enabled: the callback uses the private Service Binding, not the public internet");
must(Array.isArray(config.triggers?.crons) && config.triggers.crons.length >= 1, "the scheduled maintenance trigger (journal retention, alert evaluation) must be configured");
must(!("OTP_DAILY_SEND_LIMIT" in (config.vars ?? {})), "the send budget is a Super Admin setting in D1, not an environment variable");
must(/^https:\/\/[a-z0-9.-]+\/api\/internal\/whatsapp-otp\/notify$/.test(String(config.vars?.OTP_NOTIFY_URL ?? "")), "OTP_NOTIFY_URL must be the https URL of the app's notification endpoint");
must(!JSON.stringify(config).includes("SUPABASE_SEND_SMS_HOOK_SECRET"), "the Supabase Send-SMS-hook secret must not be bound: Supabase Phone Auth is never activated for this flow");
must(config.vars?.OTP_ENVIRONMENT === "acceptance" && config.vars?.OTP_RECIPIENT_MODE === "open", "the Acceptance Worker must be environment=acceptance with recipient mode open (owner decision: no allowlist, no dedicated test number)");
must(!("OTP_ALLOWED_RECIPIENTS" in (config.vars ?? {})) && !JSON.stringify(config).includes("OTP_ALLOWED_RECIPIENTS") && !JSON.stringify(config.vars ?? {}).includes("+20"), "no recipient allowlist variable, binding or phone number may be in the repository (recipient mode is open)");
must(!("WHATSAPP_GRAPH_BASE_URL" in (config.vars ?? {})), "the Graph URL override is for local rigs only");
must(!config.secrets?.required?.length, "do not require an unprovisioned per-Worker signing secret");
must(config.vars?.WHATSAPP_PHONE_NUMBER_ID === "1458603463983505", "unexpected WhatsApp sender");
must(config.vars?.WHATSAPP_OTP_TEMPLATE === "aladdin_otp" && config.vars?.WHATSAPP_OTP_LANGUAGES === "ar", "unapproved template");
must(!JSON.stringify(config.vars ?? {}).includes("whsec_") && !JSON.stringify(config.vars ?? {}).includes("Bearer "), "credentials must not be in plaintext vars");
if (errors.length) {
  console.error("OTP Preview configuration BLOCKED:\n" + errors.map(s => "- " + s).join("\n"));
  process.exit(1);
}
console.log("OTP Preview configuration PASS: isolated Worker, Acceptance D1, Secrets Store bindings (Meta token + R2 signing secret), recipient mode open, delivery permit as configured");
