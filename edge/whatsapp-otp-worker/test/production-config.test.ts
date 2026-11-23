import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const guard = join(root, "scripts/check-production-config.mjs");
const stripComments = (t: string) => t.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
const baseline = JSON.parse(stripComments(readFileSync(join(root, "wrangler.production.jsonc"), "utf8")));
const preview = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));

function invoke(config?: unknown) {
  if (config === undefined) return spawnSync(process.execPath, [guard], { encoding: "utf8" });
  const dir = mkdtempSync(join(tmpdir(), "otp-prod-guard-"));
  try {
    const path = join(dir, "wrangler.production.jsonc");
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    return spawnSync(process.execPath, [guard, path], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function blocked(reason: string, change: (c: any) => void) {
  const copy = structuredClone(baseline);
  change(copy);
  const r = invoke(copy);
  assert.notEqual(r.status, 0, reason);
  assert.match(r.stderr, /BLOCKED/);
}

test("the checked-in Production config passes: isolated, delivery permit true (a permit only), open mode, no allowlist", () => {
  const r = invoke();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PASS/);
});

test("the permit accepts only the literal true or false, and the environment/mode are pinned", () => {
  for (const bad of ["TRUE", "1", "yes", "", " true"]) blocked("permit " + JSON.stringify(bad), (c) => { c.vars.WHATSAPP_DELIVERY_ENABLED = bad; });
  blocked("permit missing", (c) => { delete c.vars.WHATSAPP_DELIVERY_ENABLED; });
  blocked("allowlist mode", (c) => { c.vars.OTP_RECIPIENT_MODE = "allowlist"; });
  blocked("acceptance marker", (c) => { c.vars.OTP_ENVIRONMENT = "acceptance"; });
  blocked("local marker", (c) => { c.vars.OTP_ENVIRONMENT = "local"; });
});

test("no recipient allowlist can be bound or set, in vars or as a Secrets Store binding", () => {
  blocked("allowlist var", (c) => { c.vars.OTP_ALLOWED_RECIPIENTS = "+201000000000"; });
  blocked("allowlist binding", (c) => { c.secrets_store_secrets.push({ binding: "OTP_ALLOWED_RECIPIENTS", store_id: "acfaa67f391e499db6fde398022f50ce", secret_name: "OTP_ALLOWED_RECIPIENTS_PRODUCTION" }); });
});

test("the Worker is isolated: name, routes, environments", () => {
  blocked("acceptance name", (c) => { c.name = "aladdin-whatsapp-otp-preview"; });
  blocked("frontend name", (c) => { c.name = "aladdin-frontend-production"; });
  blocked("custom route", (c) => { c.routes = ["aladdindecore.com/*"]; });
  blocked("route key", (c) => { c.route = "aladdindecore.com/*"; });
  blocked("public workers.dev address", (c) => { c.workers_dev = true; });
  blocked("preview URLs on", (c) => { c.preview_urls = true; });
  blocked("preview URLs missing", (c) => { delete c.preview_urls; });
  blocked("env block", (c) => { c.env = { staging: {} }; });
});

test("the D1 database is exactly the Production one; the Acceptance one is refused anywhere", () => {
  blocked("acceptance D1", (c) => { c.d1_databases[0] = { ...preview.d1_databases[0] }; });
  blocked("wrong id", (c) => { c.d1_databases[0].database_id = "00000000-0000-0000-0000-000000000000"; });
  blocked("wrong binding", (c) => { c.d1_databases[0].binding = "DB"; });
  blocked("second D1", (c) => { c.d1_databases.push({ ...c.d1_databases[0], binding: "OTHER" }); });
  blocked("acceptance id in a var", (c) => { c.vars.X = preview.d1_databases[0].database_id; });
});

test("exactly five distinct *_PRODUCTION secrets (incl. the admin grant key); no Acceptance secret, no reuse, no SMS-hook secret", () => {
  const names = (c: any) => c.secrets_store_secrets as any[];
  blocked("acceptance token", (c) => { names(c)[0].secret_name = "WHATSAPP_ACCESS_TOKEN"; });
  blocked("acceptance send secret", (c) => { names(c)[1].secret_name = "PHONE_OTP_WORKER_SECRET"; });
  blocked("acceptance admin secret", (c) => { names(c)[2].secret_name = "OTP_ADMIN_SIGNING_SECRET"; });
  blocked("acceptance grant key", (c) => { names(c)[4].secret_name = "OTP_ADMIN_GRANT_SECRET"; });
  blocked("grant key reuses the admin secret", (c) => { names(c)[4].secret_name = "OTP_ADMIN_SIGNING_SECRET_PRODUCTION"; });
  blocked("missing grant binding", (c) => { c.secrets_store_secrets = names(c).filter((s) => s.binding !== "OTP_ADMIN_GRANT_SECRET"); });
  blocked("admin reuses the send secret", (c) => { names(c)[2].secret_name = "PHONE_OTP_WORKER_SECRET_PRODUCTION"; });
  blocked("notify reuses the admin secret", (c) => { names(c)[3].secret_name = "OTP_ADMIN_SIGNING_SECRET_PRODUCTION"; });
  blocked("missing admin binding", (c) => { c.secrets_store_secrets = names(c).filter((s) => s.binding !== "OTP_ADMIN_SIGNING_SECRET"); });
  blocked("missing notify binding", (c) => { c.secrets_store_secrets = names(c).filter((s) => s.binding !== "OTP_NOTIFY_SIGNING_SECRET"); });
  blocked("other store", (c) => { names(c)[0].store_id = "0".repeat(32); });
  blocked("extra binding", (c) => { names(c).push({ binding: "X", store_id: "acfaa67f391e499db6fde398022f50ce", secret_name: "X_PRODUCTION" }); });
  blocked("sms hook secret", (c) => { names(c).push({ binding: "SUPABASE_SEND_SMS_HOOK_SECRET", store_id: "acfaa67f391e499db6fde398022f50ce", secret_name: "SUPABASE_SEND_SMS_HOOK_SECRET" }); });
});

test("the budget is never an env var; the notify URL, cron, sender and template are pinned; nothing sensitive is committed", () => {
  blocked("env budget", (c) => { c.vars.OTP_DAILY_SEND_LIMIT = "50"; });
  blocked("env ceiling", (c) => { c.vars.OTP_HARD_CEILING = "5000"; });
  blocked("graph override", (c) => { c.vars.WHATSAPP_GRAPH_BASE_URL = "http://127.0.0.1:1"; });
  blocked("acceptance notify url", (c) => { c.vars.OTP_NOTIFY_URL = preview.vars.OTP_NOTIFY_URL; });
  blocked("http notify url", (c) => { c.vars.OTP_NOTIFY_URL = "http://aladdindecore.com/api/internal/whatsapp-otp/notify"; });
  blocked("no notify url", (c) => { delete c.vars.OTP_NOTIFY_URL; });
  blocked("no cron", (c) => { delete c.triggers; });
  blocked("other sender", (c) => { c.vars.WHATSAPP_PHONE_NUMBER_ID = "1415528588305492"; });
  blocked("other template", (c) => { c.vars.WHATSAPP_OTP_TEMPLATE = "other"; });
  blocked("phone number committed", (c) => { c.vars.NOTE = "+201012345678"; });
  blocked("secret committed", (c) => { c.vars.NOTE = "whsec_" + "A".repeat(43); });
  blocked("unknown var", (c) => { c.vars.SOMETHING = "1"; });
});

test("the Acceptance guard still refuses the Production config, and the two configs share no secret or database", () => {
  assert.equal(baseline.vars.OTP_ENVIRONMENT, "production");
  const prodNames = new Set(baseline.secrets_store_secrets.map((s: any) => s.secret_name));
  for (const s of preview.secrets_store_secrets) assert.ok(!prodNames.has(s.secret_name), `shared secret ${s.secret_name}`);
  assert.notEqual(baseline.d1_databases[0].database_id, preview.d1_databases[0].database_id);
  const dir = mkdtempSync(join(tmpdir(), "otp-prod-vs-preview-"));
  try {
    const path = join(dir, "wrangler.jsonc");
    writeFileSync(path, JSON.stringify(baseline));
    const r = spawnSync(process.execPath, [join(root, "scripts/check-preview-config.mjs"), path], { encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /BLOCKED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the private APP_NOTIFY service binding to the Production app is required, and only that one (alerts and the delivery attestation depend on it)", () => {
  assert.deepEqual(baseline.services, [{ binding: "APP_NOTIFY", service: "aladdin-frontend-production" }]);
  blocked("no service binding", (c) => { delete c.services; });
  blocked("empty service bindings", (c) => { c.services = []; });
  blocked("binding to the preview app", (c) => { c.services = [{ binding: "APP_NOTIFY", service: "aladdin-frontend-preview" }]; });
  blocked("wrong binding name", (c) => { c.services = [{ binding: "APP", service: "aladdin-frontend-production" }]; });
  blocked("an extra binding", (c) => { c.services = [...c.services, { binding: "OTHER", service: "aladdin-backend-production" }]; });
});
