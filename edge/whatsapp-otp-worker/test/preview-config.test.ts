import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const guard = join(root, "scripts/check-preview-config.mjs");
const baseline = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
function invoke(config?: unknown) {
  if (config === undefined) return spawnSync(process.execPath, [guard], { encoding: "utf8" });
  const dir = mkdtempSync(join(tmpdir(), "otp-preview-guard-"));
  try {
    const path = join(dir, "wrangler.jsonc");
    writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    return spawnSync(process.execPath, [guard, path], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function assertBlocked(reason: string, change: (copy: any) => void) {
  const modified = structuredClone(baseline);
  change(modified);
  const r = invoke(modified);
  assert.notEqual(r.status, 0, reason);
  assert.match(r.stderr, /BLOCKED/);
}
test("real checked-in preview config is fail-closed and permitted", () => {
  const result = invoke();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});
test("preview config accepts only the literal strings true or false for the delivery permit, and only for the Acceptance Worker", () => {
  for (const bad of ["TRUE", "1", "yes", "", " true"]) assertBlocked("permit " + JSON.stringify(bad), o => { o.vars.WHATSAPP_DELIVERY_ENABLED = bad; });
  assertBlocked("missing permit", o => { delete o.vars.WHATSAPP_DELIVERY_ENABLED; });
  // The permit cannot ride on a production-looking Worker: name and environment are pinned independently.
  assertBlocked("permit on a production-named Worker", o => { o.name = "aladdin-whatsapp-otp-production"; });
  assertBlocked("permit with production environment", o => { o.vars.OTP_ENVIRONMENT = "production"; });
});
test("preview config refuses production Worker name", () => {
  assertBlocked("production Worker", o => { o.name = "aladdin-frontend-production"; });
});
test("preview config refuses production route", () => {
  assertBlocked("production route", o => { o.routes = ["aladdindecore.com/*"]; });
});
test("preview config refuses D1 substitution", () => {
  assertBlocked("wrong D1", o => { o.d1_databases[0].database_id = "00000000-0000-0000-0000-000000000000"; });
});
test("preview config refuses missing signing secret", () => {
  assertBlocked("unsigned Worker", o => { o.secrets_store_secrets = o.secrets_store_secrets.filter((s:any) => s.binding !== "OTP_SIGNING_SECRET"); });
});
test("preview config refuses unexpected Meta token binding", () => {
  assertBlocked("wrong Secrets Store", o => { o.secrets_store_secrets[0].secret_name = "wrong_secret"; });
});

test("preview config refuses re-binding the Supabase Send-SMS-hook secret", () => {
  assertBlocked("SMS hook secret", o => { o.secrets_store_secrets.push({ binding: "SUPABASE_SEND_SMS_HOOK_SECRET", store_id: "acfaa67f391e499db6fde398022f50ce", secret_name: "SUPABASE_SEND_SMS_HOOK_SECRET" }); });
});
test("preview config requires recipient mode open and environment acceptance, with no allowlist anywhere", () => {
  assert.equal(baseline.vars.OTP_RECIPIENT_MODE, "open");
  assert.equal(baseline.vars.WHATSAPP_DELIVERY_ENABLED, "true"); // permit only; the audited D1 switch starts OFF and attestation is separate
  assertBlocked("allowlist mode", o => { o.vars.OTP_RECIPIENT_MODE = "allowlist"; });
  assertBlocked("missing mode", o => { delete o.vars.OTP_RECIPIENT_MODE; });
  assertBlocked("production marker", o => { o.vars.OTP_ENVIRONMENT = "production"; });
  assertBlocked("local marker", o => { o.vars.OTP_ENVIRONMENT = "local"; });
  assertBlocked("missing environment", o => { delete o.vars.OTP_ENVIRONMENT; });
  assertBlocked("allowlist var (empty)", o => { o.vars.OTP_ALLOWED_RECIPIENTS = ""; });
  assertBlocked("allowlist secret binding", o => { o.secrets_store_secrets.push({ binding: "OTP_ALLOWED_RECIPIENTS", store_id: "acfaa67f391e499db6fde398022f50ce", secret_name: "OTP_ALLOWED_RECIPIENTS" }); });
});
test("preview config refuses phone numbers in the repository and a Graph URL override", () => {
  assertBlocked("numbers in repo", o => { o.vars.OTP_ALLOWED_RECIPIENTS = "+201012345678"; });
  assertBlocked("graph override", o => { o.vars.WHATSAPP_GRAPH_BASE_URL = "http://127.0.0.1:1"; });
});

test("the budget is a D1 setting, never an env var; the admin and notify secrets are separate bindings; the cron and notify URL are pinned", () => {
  assertBlocked("env-var budget", (c) => { c.vars.OTP_DAILY_SEND_LIMIT = "50"; });
  assertBlocked("missing admin secret", (c) => { c.secrets_store_secrets = c.secrets_store_secrets.filter((s: any) => s.binding !== "OTP_ADMIN_SIGNING_SECRET"); });
  assertBlocked("missing notify secret", (c) => { c.secrets_store_secrets = c.secrets_store_secrets.filter((s: any) => s.binding !== "OTP_NOTIFY_SIGNING_SECRET"); });
  assertBlocked("admin secret reuses the send secret", (c) => { c.secrets_store_secrets.find((s: any) => s.binding === "OTP_ADMIN_SIGNING_SECRET").secret_name = "PHONE_OTP_WORKER_SECRET"; });
  assertBlocked("notify secret reuses the admin secret", (c) => { c.secrets_store_secrets.find((s: any) => s.binding === "OTP_NOTIFY_SIGNING_SECRET").secret_name = "OTP_ADMIN_SIGNING_SECRET"; });
  assertBlocked("no cron trigger", (c) => { delete c.triggers; });
  assertBlocked("empty cron list", (c) => { c.triggers.crons = []; });
  assertBlocked("http notify URL", (c) => { c.vars.OTP_NOTIFY_URL = "http://example.com/api/internal/whatsapp-otp/notify"; });
  assertBlocked("wrong notify path", (c) => { c.vars.OTP_NOTIFY_URL = "https://example.com/api/other"; });
  assertBlocked("no notify URL", (c) => { delete c.vars.OTP_NOTIFY_URL; });
});

test("the Acceptance Worker is private (no workers.dev address, preview URLs or routes) and carries a distinct admin grant key", () => {
  assertBlocked("public workers.dev", (c) => { c.workers_dev = true; });
  assertBlocked("preview urls", (c) => { c.preview_urls = true; });
  assertBlocked("missing grant key", (c) => { c.secrets_store_secrets = c.secrets_store_secrets.filter((s: any) => s.binding !== "OTP_ADMIN_GRANT_SECRET"); });
  assertBlocked("grant key reuses the admin secret", (c) => { c.secrets_store_secrets.find((s: any) => s.binding === "OTP_ADMIN_GRANT_SECRET").secret_name = "OTP_ADMIN_SIGNING_SECRET"; });
  assertBlocked("production grant key in Acceptance", (c) => { c.secrets_store_secrets.find((s: any) => s.binding === "OTP_ADMIN_GRANT_SECRET").secret_name = "OTP_ADMIN_GRANT_SECRET_PRODUCTION"; });
});

test("the alert callback must use exactly one private Service Binding to the Acceptance frontend, with no Access credential and no public-fetch flag", () => {
  assertBlocked("no service binding", o => { delete o.services; });
  assertBlocked("empty service bindings", o => { o.services = []; });
  assertBlocked("wrong binding name", o => { o.services[0].binding = "OTP_WORKER"; });
  assertBlocked("binding to the production frontend", o => { o.services[0].service = "aladdin-frontend-production"; });
  assertBlocked("binding to the unsuffixed frontend", o => { o.services[0].service = "aladdin-frontend"; });
  assertBlocked("binding to another environment", o => { o.services[0].environment = "production"; });
  assertBlocked("binding to a non-default entrypoint", o => { o.services[0].entrypoint = "Admin"; });
  assertBlocked("a second service binding", o => { o.services.push({ binding: "OTHER", service: "aladdin-backend-preview" }); });
  assertBlocked("an Access client id binding", o => { o.secrets_store_secrets.push({ binding: "OTP_NOTIFY_ACCESS_CLIENT_ID", store_id: "acfaa67f391e499db6fde398022f50ce", secret_name: "OTP_NOTIFY_ACCESS_CLIENT_ID" }); });
  assertBlocked("global_fetch_strictly_public", o => { o.compatibility_flags = ["global_fetch_strictly_public"]; });
});
test("no Access token appears in plaintext vars", () => {
  const text = JSON.stringify(baseline.vars);
  assert.ok(!/cf-access|access_client|.access"/i.test(text));
});
