#!/usr/bin/env node
// LOCAL END-TO-END RIG. Loopback only. Sends NOTHING anywhere: Meta is faked on this same port.
//
//   RIG_SIGNING_SECRET=whsec_... [RIG_PORT=8788] node edge/whatsapp-otp-worker/scripts/local-rig.mjs
//
// Hosts (a) the REAL Worker handler (src/index.ts) on a REAL SQL D1 (Miniflare, the production migration) and (b) a fake Meta Graph API.
// The Worker runs with OTP_ENVIRONMENT=local, delivery ON, and an allowlist that the test adds numbers to through /__allow (rig only).
//   POST /v1/otp/send, /v1/preflight          -> the Worker
//   POST /v25.0/<sender id>/messages          -> fake Meta: checks the bearer token, records the payload, answers a wamid
//   POST /__allow {to}  GET /__messages?to=   GET /__claims   POST /__fail_next   (rig-only; read what a handset would receive)
// It refuses to start unless it binds to loopback, and the rig's "Meta token" is a fixed fake string.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare } from "miniflare";
import { handleRequest, purgeExpiredReplayClaims } from "../src/index.ts";
import { attestationCanonical } from "../src/attest.ts";
import { runMaintenance } from "../src/maintenance.ts";
import { signPayload } from "../src/signing.ts";

const PORT = Number(process.env.RIG_PORT ?? 8788);
const SECRET = process.env.RIG_SIGNING_SECRET;
if (!SECRET || !/^whsec_[A-Za-z0-9+/=]{43,}$/.test(SECRET)) { console.error("RIG_SIGNING_SECRET (whsec_...) is required"); process.exit(2); }
const FAKE_TOKEN = "rig-fake-meta-token-not-a-credential";
const SENDER_ID = "1415528588305492";

const mf = new Miniflare({ modules: true, script: 'export default { async fetch() { return new Response("rig"); } };', d1Databases: { IDEMPOTENCY_DB: "otp-rig-d1" } });
const d1 = await mf.getD1Database("IDEMPOTENCY_DB");
for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()) {
  const ddl = readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
  for (const stmt of ddl.split(";").map((x) => x.trim()).filter(Boolean)) await d1.prepare(stmt).run();
}
// A LOCAL RIG fixture only: the real Workers get their settings row from an explicit, audited Super Admin action.
await d1.prepare("INSERT INTO otp_settings (id, daily_limit, hard_ceiling, warn_percent, critical_percent, version, updated_at, updated_by) VALUES (1, 100, 5000, 70, 90, 1, 0, '00000000-0000-4000-8000-000000000001')").run();
// QA MODE (RIG_QA=1): the Admin page drives everything. No switch row (OFF), the admin routes are served with the secrets below, and the REAL
// scheduled maintenance (including the attestation round trip to the app) runs every RIG_CRON_SECONDS against RIG_APP_URL (loopback only).
//   RIG_QA=1 RIG_ADMIN_SECRET=whsec_.. RIG_GRANT_SECRET=whsec_.. RIG_NOTIFY_SECRET=whsec_.. RIG_APP_URL=http://127.0.0.1:3000 node local-rig.mjs
// Default mode: the Super Admin delivery switch is a FIXTURE turned ON (with its audit row and a self-signed attestation, refreshed every minute)
// so the phone E2E can exercise the send path. Production gets none of this: its switch comes only from the audited Admin route.
const QA = process.env.RIG_QA === "1";
const NOTIFY_SECRET = process.env.RIG_NOTIFY_SECRET ?? "whsec_" + Buffer.alloc(32, 77).toString("base64");
if (QA) {
  for (const k of ["RIG_ADMIN_SECRET", "RIG_GRANT_SECRET", "RIG_NOTIFY_SECRET", "RIG_APP_URL"]) if (!process.env[k]) { console.error(`${k} is required in QA mode`); process.exit(2); }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(process.env.RIG_APP_URL)) { console.error("RIG_APP_URL must be loopback http"); process.exit(2); }
} else {
  await d1.prepare("INSERT INTO otp_delivery_switch (id, enabled, version, updated_at, updated_by) VALUES (1, 1, 1, 0, '00000000-0000-4000-8000-000000000001')").run();
  await d1.prepare("INSERT INTO otp_delivery_audit (at, request_id, actor, old_enabled, new_enabled, new_version, reason) VALUES (0, '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', NULL, 1, 1, 'rig fixture')").run();
  const attest = async () => {
    const issuedAt = Math.floor(Date.now() / 1000), nonce = "ab".repeat(16);
    const mac = await signPayload(NOTIFY_SECRET, "attest", issuedAt, attestationCanonical({ env: "local", enabled: true, version: 1, issuedAt, nonce }));
    await d1.prepare("INSERT OR REPLACE INTO otp_delivery_attestation (id, enabled, version, issued_at, nonce, mac) VALUES (1, 1, 1, ?1, ?2, ?3)").bind(issuedAt, nonce, mac).run();
  };
  await attest();
  setInterval(() => attest().catch(() => undefined), 60_000).unref();
}

const allowed = new Set();
if (process.env.RIG_ALLOW) for (const n of process.env.RIG_ALLOW.split(",").filter(Boolean)) allowed.add(n);
const messages = []; // what Meta "received": {at, to, code, template, language, buttonCode}
let failNext = 0;

const env = () => ({
  OTP_SIGNING_SECRET: { get: async () => SECRET },
  WHATSAPP_ACCESS_TOKEN: { get: async () => FAKE_TOKEN },
  WHATSAPP_PHONE_NUMBER_ID: SENDER_ID,
  WHATSAPP_OTP_TEMPLATE: "aladdin_otp",
  WHATSAPP_OTP_LANGUAGES: "ar",
  WHATSAPP_GRAPH_API_VERSION: "v25.0",
  WHATSAPP_DELIVERY_ENABLED: "true",
  OTP_ENVIRONMENT: "local",
  OTP_RECIPIENT_MODE: "allowlist",
  OTP_ALLOWED_RECIPIENTS: [...allowed].join(","),
  WHATSAPP_GRAPH_BASE_URL: `http://127.0.0.1:${PORT}`,
  IDEMPOTENCY_DB: d1,
  OTP_NOTIFY_SIGNING_SECRET: { get: async () => NOTIFY_SECRET },
  ...(QA ? {
    OTP_ADMIN_SIGNING_SECRET: { get: async () => process.env.RIG_ADMIN_SECRET },
    OTP_ADMIN_GRANT_SECRET: { get: async () => process.env.RIG_GRANT_SECRET },
    OTP_NOTIFY_URL: `${process.env.RIG_APP_URL}/api/internal/whatsapp-otp/notify`,
  } : {}),
});

async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks).toString("utf8"); }
const json = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/__allow" && req.method === "POST") { const { to } = JSON.parse(await readBody(req)); allowed.add(String(to)); return json(res, 200, { ok: true }); }
    // QA MODE ONLY: what an attacker with D1 write access can do (a consistent switch row AND audit row, no grant, no signature). Loopback rig only.
    if (QA && url.pathname === "/__forge_switch" && req.method === "POST") {
      const { enabled, version } = JSON.parse(await readBody(req));
      const actor = "00000000-0000-4000-8000-0000000000ee";
      await d1.prepare("INSERT OR REPLACE INTO otp_delivery_switch (id, enabled, version, updated_at, updated_by) VALUES (1, ?1, ?2, ?3, ?4)").bind(enabled ? 1 : 0, version, Math.floor(Date.now() / 1000), actor).run();
      await d1.prepare("INSERT INTO otp_delivery_audit (at, request_id, actor, old_enabled, new_enabled, new_version, reason) VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'forged by a direct D1 write (QA simulation)')").bind(Math.floor(Date.now() / 1000), crypto.randomUUID(), actor, enabled ? 1 : 0, version).run();
      return json(res, 200, { forged: { enabled, version } });
    }
    if (url.pathname === "/__messages") { const to = url.searchParams.get("to")?.replace(/^\+/, ""); return json(res, 200, messages.filter((m) => !to || m.to === to)); }
    if (url.pathname === "/__claims") { const r = await d1.prepare("SELECT state, COUNT(*) AS n FROM whatsapp_hook_events GROUP BY state").all(); return json(res, 200, Object.fromEntries(r.results.map((x) => [x.state, x.n]))); }
    if (url.pathname === "/__fail_next" && req.method === "POST") { failNext += 1; return json(res, 200, { ok: true }); }
    // fake Meta
    if (req.method === "POST" && url.pathname === `/v25.0/${SENDER_ID}/messages`) {
      if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}`) return json(res, 401, { error: "bad token" });
      const b = JSON.parse(await readBody(req));
      if (failNext > 0) { failNext -= 1; return json(res, 500, { error: "simulated meta failure" }); }
      const comps = b.template?.components ?? [];
      messages.push({ at: Date.now(), to: b.to, template: b.template?.name, language: b.template?.language?.code, type: b.type, code: comps.find((c) => c.type === "body")?.parameters?.[0]?.text, buttonCode: comps.find((c) => c.type === "button")?.parameters?.[0]?.text, buttonSubType: comps.find((c) => c.type === "button")?.sub_type, buttonIndex: comps.find((c) => c.type === "button")?.index });
      return json(res, 200, { messages: [{ id: "wamid.rig" }] });
    }
    // the Worker
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
    const r = await handleRequest(new Request(url, { method: req.method, headers: req.headers, body }), env());
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text());
  } catch (e) { json(res, 500, { error: "rig error" }); }
});
if (QA) {
  const every = Math.max(5, Number(process.env.RIG_CRON_SECONDS ?? 15)) * 1000;
  setInterval(() => runMaintenance(env(), purgeExpiredReplayClaims, fetch).then((r) => console.log("cron", JSON.stringify({ attested: r.attested, errors: r.errors }))).catch(() => undefined), every).unref();
}
server.listen(PORT, "127.0.0.1", () => console.log(`rig ready on http://127.0.0.1:${PORT} (Worker + fake Meta, loopback only)`));
process.on("SIGTERM", async () => { server.close(); await mf.dispose(); process.exit(0); });
process.on("SIGINT", async () => { server.close(); await mf.dispose(); process.exit(0); });
