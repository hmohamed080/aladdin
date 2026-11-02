#!/usr/bin/env node
// Signed, side-effect-free check of a DEPLOYED (or local) delivery Worker: calls POST /v1/preflight, which reports whether each binding is
// PRESENT and the state of the switches. Sends nothing to Meta, writes nothing, and the answer never contains a secret value.
//
//   PHONE_OTP_WORKER_SECRET=whsec_... node edge/whatsapp-otp-worker/scripts/worker-preflight.mjs https://<worker>.workers.dev
//
// Exit 0 only when: signing secret bound, Meta token bound, D1 reachable, allowlist has entries, recipient mode is allowlist. It also prints
// delivery_enabled so you can see whether the master switch is OFF (expected before the pilot) or ON.
import { createHmac, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function run(base, env, fetchImpl = fetch, log = console.log) {
  const secret = env.PHONE_OTP_WORKER_SECRET;
  if (!base || !secret) { log("NOT RUN - usage: PHONE_OTP_WORKER_SECRET=whsec_... worker-preflight.mjs <worker base url>. Nothing was called."); return 3; }
  if (!/^whsec_[A-Za-z0-9+/=]{43,}$/.test(secret)) { log("NOT RUN - the secret must look like whsec_<base64>."); return 2; }
  const url = new URL("/v1/preflight", base);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) { log("NOT RUN - the Worker URL must be https."); return 2; }
  const body = JSON.stringify({ check: "preflight" });
  const id = `preflight_${randomUUID()}`;
  const stamp = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${stamp}.${body}`).digest("base64");
  const res = await fetchImpl(url.toString(), { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": stamp, "webhook-signature": `v1,${sig}` }, body });
  const text = await res.text();
  let out = null; try { out = JSON.parse(text); } catch { /* not json */ }
  if (res.status !== 200 || !out) { log(JSON.stringify({ ok: false, http: res.status, hint: res.status === 401 ? "the signing secret differs from the Worker's OTP_SIGNING_SECRET" : res.status === 503 ? "the Worker's signing secret binding is missing" : "unexpected answer" })); return 1; }
  const checks = {
    signing_secret_bound: out.signing_secret_bound === true,
    meta_token_bound: out.meta_token_bound === true,
    d1_reachable: out.d1_reachable === true,
    allowlist_has_entries: Number(out.allowlist_entries) > 0,
    recipient_mode_is_allowlist: out.recipient_mode === "allowlist",
  };
  const ok = Object.values(checks).every(Boolean);
  log(JSON.stringify({ ok, checks, delivery_enabled: out.delivery_enabled === true, environment: out.environment, allowlist_entries: out.allowlist_entries, template: out.template, languages: out.languages, graph_version: out.graph_version, sender_id_suffix: out.sender_id_suffix }, null, 2));
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv[2], process.env).then((c) => { process.exitCode = c; }, (e) => { console.error(String(e?.message ?? e).slice(0, 200)); process.exitCode = 1; });
}
