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
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { handleRequest } from "../src/index.ts";

const PORT = Number(process.env.RIG_PORT ?? 8788);
const SECRET = process.env.RIG_SIGNING_SECRET;
if (!SECRET || !/^whsec_[A-Za-z0-9+/=]{43,}$/.test(SECRET)) { console.error("RIG_SIGNING_SECRET (whsec_...) is required"); process.exit(2); }
const FAKE_TOKEN = "rig-fake-meta-token-not-a-credential";
const SENDER_ID = "1415528588305492";

const mf = new Miniflare({ modules: true, script: 'export default { async fetch() { return new Response("rig"); } };', d1Databases: { IDEMPOTENCY_DB: "otp-rig-d1" } });
const d1 = await mf.getD1Database("IDEMPOTENCY_DB");
const ddl = readFileSync(new URL("../migrations/0001_hook_events.sql", import.meta.url), "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
for (const stmt of ddl.split(";").map((x) => x.trim()).filter(Boolean)) await d1.prepare(stmt).run();

const allowed = new Set();
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
});

async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks).toString("utf8"); }
const json = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/__allow" && req.method === "POST") { const { to } = JSON.parse(await readBody(req)); allowed.add(String(to)); return json(res, 200, { ok: true }); }
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
server.listen(PORT, "127.0.0.1", () => console.log(`rig ready on http://127.0.0.1:${PORT} (Worker + fake Meta, loopback only)`));
process.on("SIGTERM", async () => { server.close(); await mf.dispose(); process.exit(0); });
process.on("SIGINT", async () => { server.close(); await mf.dispose(); process.exit(0); });
