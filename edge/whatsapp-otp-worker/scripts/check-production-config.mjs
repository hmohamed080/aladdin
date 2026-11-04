#!/usr/bin/env node
// PRODUCTION configuration guard. Static: reads the config file only, never calls Cloudflare, never reads a secret value.
// Run before any Production deploy (and in CI). It pins the exact shape of wrangler.production.jsonc and refuses anything else.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const configPath = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../wrangler.production.jsonc", import.meta.url));
// JSONC: strip whole-line // comments only (the file keeps comments on their own lines; URLs inside strings are untouched).
const text = readFileSync(configPath, "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
const config = JSON.parse(text);
const vars = config.vars ?? {};
const errors = [];
const must = (ok, reason) => { if (!ok) errors.push(reason); };

const STORE = "acfaa67f391e499db6fde398022f50ce";
const ACCEPTANCE_D1 = "da65d5e4-8344-4078-9c2d-8a4bb4907f79";
const ACCEPTANCE_SECRETS = ["WHATSAPP_ACCESS_TOKEN", "PHONE_OTP_WORKER_SECRET", "OTP_ADMIN_SIGNING_SECRET", "OTP_NOTIFY_SIGNING_SECRET"];
const EXPECTED_BINDINGS = [
  ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_ACCESS_TOKEN_PRODUCTION"],
  ["OTP_SIGNING_SECRET", "PHONE_OTP_WORKER_SECRET_PRODUCTION"],
  ["OTP_ADMIN_SIGNING_SECRET", "OTP_ADMIN_SIGNING_SECRET_PRODUCTION"],
  ["OTP_NOTIFY_SIGNING_SECRET", "OTP_NOTIFY_SIGNING_SECRET_PRODUCTION"],
];
const raw = JSON.stringify(config);

must(config.name === "aladdin-whatsapp-otp-production", "unexpected Worker name (must be aladdin-whatsapp-otp-production)");
must(config.main === "src/index.ts", "unexpected entry point");
must(vars.WHATSAPP_DELIVERY_ENABLED === "false", "WhatsApp delivery must stay disabled until the approved cutover");
must(vars.OTP_ENVIRONMENT === "production", "OTP_ENVIRONMENT must be production");
must(vars.OTP_RECIPIENT_MODE === "open", "Production recipient mode must be open");
must(config.workers_dev === true && Array.isArray(config.routes) && config.routes.length === 0 && !config.route && !config.site, "isolated workers.dev only: no custom-domain routes");
must(!config.env, "no wrangler environments: this file IS the Production Worker");
must(
  config.d1_databases?.length === 1 &&
  config.d1_databases[0]?.binding === "IDEMPOTENCY_DB" &&
  config.d1_databases[0]?.database_name === "aladdin-whatsapp-otp-production" &&
  config.d1_databases[0]?.database_id === "30a16841-1108-47e9-99be-3dc9d827fd87" &&
  config.d1_databases[0]?.migrations_dir === "migrations",
  "D1 must be exactly the Production replay database"
);
must(!raw.includes(ACCEPTANCE_D1) && !raw.toLowerCase().includes("acceptance") && !raw.includes("-preview"), "no Acceptance or preview resource may appear in the Production config");
const bindings = config.secrets_store_secrets ?? [];
must(
  bindings.length === EXPECTED_BINDINGS.length &&
  EXPECTED_BINDINGS.every(([b, n]) => bindings.some((x) => x.binding === b && x.secret_name === n && x.store_id === STORE)) &&
  new Set(bindings.map((x) => x.secret_name)).size === EXPECTED_BINDINGS.length,
  "exactly four distinct *_PRODUCTION secrets (Meta token, send, admin, notify) from the account Secrets Store"
);
must(bindings.every((x) => x.secret_name.endsWith("_PRODUCTION") && !ACCEPTANCE_SECRETS.includes(x.secret_name)), "Production must never bind an Acceptance secret");
must(!raw.includes("OTP_ALLOWED_RECIPIENTS"), "no recipient allowlist variable or binding in Production (recipient mode is open)");
must(!raw.includes("SUPABASE_SEND_SMS_HOOK_SECRET"), "the Supabase Send-SMS-hook secret must not be bound: Supabase Phone Auth is never activated for this flow");
must(!("OTP_DAILY_SEND_LIMIT" in vars) && !("OTP_HARD_CEILING" in vars), "the budget is a Super Admin setting in D1, not an environment variable");
must(!("WHATSAPP_GRAPH_BASE_URL" in vars), "the Graph URL override is for local rigs only");
must(vars.OTP_NOTIFY_URL === "https://aladdindecore.com/api/internal/whatsapp-otp/notify", "OTP_NOTIFY_URL must be the Production app's notification endpoint");
must(Array.isArray(config.triggers?.crons) && config.triggers.crons.length >= 1, "the scheduled maintenance trigger must be configured");
must(vars.WHATSAPP_PHONE_NUMBER_ID === "1458603463983505", "unexpected WhatsApp sender");
must(vars.WHATSAPP_OTP_TEMPLATE === "aladdin_otp" && vars.WHATSAPP_OTP_LANGUAGES === "ar", "unapproved template or languages");
must(vars.WHATSAPP_GRAPH_API_VERSION === "v25.0", "unexpected Graph API version");
must(!raw.includes("+20") && !raw.includes("whsec_") && !raw.includes("Bearer "), "no phone numbers or credentials in the repository");
must(!config.secrets?.required?.length, "do not require an unprovisioned per-Worker secret");
const allowedVars = new Set(["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_OTP_TEMPLATE", "WHATSAPP_OTP_LANGUAGES", "WHATSAPP_GRAPH_API_VERSION", "OTP_ENVIRONMENT", "OTP_RECIPIENT_MODE", "OTP_NOTIFY_URL", "WHATSAPP_DELIVERY_ENABLED"]);
must(Object.keys(vars).every((k) => allowedVars.has(k)), "unexpected variable: " + Object.keys(vars).filter((k) => !allowedVars.has(k)).join(", "));

if (errors.length) {
  console.error("OTP Production configuration BLOCKED:\n" + errors.map((s) => "- " + s).join("\n"));
  process.exit(1);
}
console.log("OTP Production configuration PASS: isolated Production Worker + D1, four *_PRODUCTION secrets, recipient mode open without an allowlist, delivery disabled");
