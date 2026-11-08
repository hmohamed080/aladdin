import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUpload, run, parse, P4_VERSION, OTP_WORKER_TARGET } from "./verify-frontend-upload.mjs";
import { LIVE_VERSION, SIGNUP_SECRET_NAMES } from "./provision-frontend-otp-secrets.mjs";

const UP = "11111111-2222-4333-8444-555555555555";
const plain = (name, text) => ({ name, type: "plain_text", text });
const secret = (name) => ({ name, type: "secret_text" });
const svc = (name, service) => ({ name, type: "service", service, environment: "production" });
const base = () => [
  plain("APP_PUBLIC_ORIGIN", "https://aladdindecore.com"), plain("EMAIL_FROM", "Aladdin <no-reply@aladdindecore.com>"), plain("NEXT_PUBLIC_APP_ENV", "production"),
  plain("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co"), plain("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"), plain("REDIS_CACHE_ENABLED", "false"),
  secret("AUTH_PASSWORD_PREVIEW_GRANT_SECRET"), secret("RESEND_API_KEY"), secret("SUPABASE_SERVICE_ROLE_KEY"), secret("TURNSTILE_SECRET_KEY"),
  svc("BACKEND", "aladdin-backend-production"), svc("WORKER_SELF_REFERENCE", "aladdin-frontend-production"),
  { name: "ASSETS", type: "assets" }, { name: "IMAGES", type: "images" }, { name: "CF_VERSION_METADATA", type: "version_metadata" },
];
const otpSecrets = () => ["PHONE_OTP_ADMIN_SECRET", "PHONE_OTP_NOTIFY_SECRET", "PHONE_OTP_WORKER_SECRET", "PHONE_OTP_WORKER_URL"].map(secret);
const view = (b) => ({ resources: { bindings: b } });
const signup = () => SIGNUP_SECRET_NAMES.map(secret);
const live = () => view(base());
const p4 = () => view([...base(), ...otpSecrets()]);
const good = () => view([...base(), ...otpSecrets(), ...signup(), svc("OTP_WORKER", OTP_WORKER_TARGET)]);
const dep = { versions: [{ version_id: LIVE_VERSION, percentage: 100 }] };
const check = (up, over = {}) => checkUpload({ live: live(), p4: p4(), up, deployment: dep, versionId: UP, ...over }).join(" | ");
const mod = (fn) => view(fn(good().resources.bindings));

test("a version equal to the P-4 version plus the 5 sign-up secrets plus OTP_WORKER passes", () => assert.equal(check(good()), ""));

test("the 5 sign-up secrets are exactly the expected names", () => {
  assert.deepEqual([...SIGNUP_SECRET_NAMES].sort(), ["PHONE_OTP_DELIVERY", "PHONE_OTP_HMAC_KEYS", "PHONE_SIGNUP_COOKIE_SECRET", "PHONE_SIGNUP_VERIFICATION_ENABLED", "PHONE_VERIFICATION_ENABLED"]);
});

test("the P-4-only set (no sign-up secrets) is refused for the sign-up cutover", () => {
  const p4Only = view([...base(), ...otpSecrets(), svc("OTP_WORKER", OTP_WORKER_TARGET)]);
  const r = check(p4Only);
  for (const n of SIGNUP_SECRET_NAMES) assert.match(r, new RegExp(`secret ${n} is MISSING`));
});

test("a version lacking any single one of the 5 sign-up secrets is refused", () => {
  for (const n of SIGNUP_SECRET_NAMES) assert.match(check(mod((b) => b.filter((x) => x.name !== n))), new RegExp(`secret ${n} is MISSING`));
});

test("a sign-up secret that is not secret_text is refused, and an unknown extra secret is refused", () => {
  for (const n of SIGNUP_SECRET_NAMES) assert.match(check(mod((b) => b.map((x) => (x.name === n ? plain(n, "worker") : x)))), new RegExp(`${n} must be a secret_text`));
  assert.match(check(mod((b) => [...b, secret("PHONE_SIGNUP_EXTRA_SECRET")])), /unexpected secret PHONE_SIGNUP_EXTRA_SECRET/);
});

test("lost, extra or retyped secrets are refused", () => {
  assert.match(check(mod((b) => b.filter((x) => x.name !== "PHONE_OTP_ADMIN_SECRET"))), /PHONE_OTP_ADMIN_SECRET.*MISSING/);
  assert.match(check(mod((b) => b.filter((x) => x.name !== "RESEND_API_KEY"))), /RESEND_API_KEY.*MISSING/);
  assert.match(check(mod((b) => [...b, secret("OTP_ADMIN_GRANT_SECRET")])), /unexpected secret OTP_ADMIN_GRANT_SECRET/);
  assert.match(check(mod((b) => b.map((x) => (x.name === "PHONE_OTP_WORKER_URL" ? plain("PHONE_OTP_WORKER_URL", "u") : x)))), /PHONE_OTP_WORKER_URL must be a secret_text/);
});

test("plain variables must equal the live ones and no OTP/WhatsApp switch may appear", () => {
  assert.match(check(mod((b) => b.map((x) => (x.name === "EMAIL_FROM" ? { ...x, text: "other" } : x)))), /EMAIL_FROM changed/);
  assert.match(check(mod((b) => b.filter((x) => x.name !== "REDIS_CACHE_ENABLED"))), /plain variable names differ/);
  assert.match(check(mod((b) => [...b, plain("PHONE_SIGNUP_ENABLED", "true")])), /PHONE_SIGNUP_ENABLED/);
  assert.match(check(mod((b) => [...b, plain("WHATSAPP_DELIVERY_ENABLED", "false")])), /WHATSAPP_DELIVERY_ENABLED/);
});

test("existing service/asset bindings stay, OTP_WORKER must target the production OTP Worker, nothing else is new", () => {
  assert.match(check(mod((b) => b.filter((x) => x.name !== "BACKEND"))), /BACKEND was LOST/);
  assert.match(check(mod((b) => b.map((x) => (x.name === "BACKEND" ? svc("BACKEND", "elsewhere") : x)))), /BACKEND CHANGED/);
  assert.match(check(mod((b) => b.filter((x) => x.name !== "OTP_WORKER"))), /OTP_WORKER must be a service binding/);
  assert.match(check(mod((b) => b.map((x) => (x.name === "OTP_WORKER" ? svc("OTP_WORKER", "aladdin-whatsapp-otp-preview") : x)))), /OTP_WORKER must be a service binding/);
  assert.match(check(mod((b) => [...b, { name: "EXTRA_KV", type: "kv_namespace" }])), /new bindings beyond.*EXTRA_KV/);
});

test("the live version must stay alone at 100%; the upload must serve 0%", () => {
  assert.match(check(good(), { deployment: { versions: [{ version_id: UP, percentage: 100 }] } }), /not exactly the live version/);
  assert.match(check(good(), { deployment: { versions: [{ version_id: LIVE_VERSION, percentage: 90 }, { version_id: UP, percentage: 10 }] } }), /part of the deployment/);
  assert.match(check(good(), { versionId: P4_VERSION }), /not a new upload/);
  assert.match(check(view([])), /no bindings/);
});

function wr(over = {}) {
  const calls = [];
  const j = (o) => ({ status: 0, stdout: JSON.stringify(o), stderr: "" });
  const wrangler = (args) => {
    calls.push(args);
    if (args[0] === "deployments") return j(over.deployment ?? dep);
    if (args[0] === "versions") return j(args[2] === LIVE_VERSION ? live() : args[2] === P4_VERSION ? p4() : over.up ?? good());
    throw new Error(`unexpected ${args.join(" ")}`);
  };
  return { calls, wrangler };
}
const go = async (f, argv) => { const lines = []; const code = await run({ argv, wrangler: f.wrangler, out: (s) => lines.push(s) }); return { code, text: lines.join("\n") }; };

test("the run reads only versions view and deployments status, and reports pass/refuse", async () => {
  const f = wr({ up: withMsg("upload-only a0aa22962851") });
  const ok = await go(f, [`--version=${UP}`, `--expect-sha=${SHA}`]);
  assert.equal(ok.code, 0, ok.text);
  assert.match(ok.text, /All read-only checks passed/);
  for (const c of f.calls) assert.ok((c[0] === "versions" && c[1] === "view") || (c[0] === "deployments" && c[1] === "status"), `not read-only: ${c.join(" ")}`);
  assert.equal((await go(wr({ up: mod((b) => b.filter((x) => x.name !== "OTP_WORKER")) }), [`--version=${UP}`, `--expect-sha=${SHA}`])).code, 1);
});

test("a missing or malformed version id, or any other argument, is a usage error and calls nothing", async () => {
  for (const argv of [[], ["--version=abc"], [`--version=${UP}`], [`--version=${UP}`, "--deploy"]]) {
    const f = wr();
    assert.equal((await go(f, argv)).code, 2);
    assert.equal(f.calls.length, 0);
  }
});

test("parse skips wrangler banner lines (even ones starting with [) and fails closed without JSON", () => {
  const ok = (stdout) => ({ status: 0, stdout });
  assert.deepEqual(parse(ok(' ⛅️ wrangler 4.0\n[wrangler:info] hi\n{"a":1}\n'), "x"), { a: 1 });
  assert.deepEqual(parse(ok('﻿[1,2]'), "x"), [1, 2]);
  assert.throws(() => parse(ok("[wrangler:info] nothing"), "x"), /no JSON/);
  assert.throws(() => parse({ status: 1, stdout: "{}" }, "x"), /failed/);
});

const SHA = "a0aa22962851c4ea466c03c240f835e7ade2943a";
const withMsg = (m) => ({ ...good(), annotations: m === undefined ? {} : { "workers/message": m } });

test("--expect-sha: the version message must carry the first 12 hex of the expected SHA", () => {
  assert.equal(check(withMsg("upload-only a0aa22962851"), { expectSha: SHA }), "");
  assert.match(check(withMsg("upload-only 78d1b5c0c743"), { expectSha: SHA }), /source commit mismatch/);
  assert.match(check(withMsg(undefined), { expectSha: SHA }), /no workers[/]message annotation/);
  assert.match(check(withMsg("P-4-otp-secrets-not-deployed"), { expectSha: SHA }), /source commit mismatch/);
  assert.equal(check(withMsg("anything")), "", "without the flag the message is not checked");
});

test("run: --expect-sha is validated, required, and reported", async () => {
  for (const argv of [[`--version=${UP}`, "--expect-sha=abc"], [`--version=${UP}`, `--expect-sha=${SHA.toUpperCase()}`], [`--version=${UP}`, `--expect-sha=${SHA}`, `--expect-sha=${SHA}`]]) {
    const f = wr(); assert.equal((await go(f, argv)).code, 2); assert.equal(f.calls.length, 0);
  }
  const ok = await go(wr({ up: withMsg("upload-only a0aa22962851") }), [`--version=${UP}`, `--expect-sha=${SHA}`]);
  assert.equal(ok.code, 0, ok.text); assert.match(ok.text, /Source label matches a0aa22962851/);
  assert.equal((await go(wr({ up: withMsg("upload-only 000000000000") }), [`--version=${UP}`, `--expect-sha=${SHA}`])).code, 1);
});
