// Self-test for media-edge-ticket-key.mjs against a local mock of the Cloudflare API (loopback only).
// Run: env -u NODE_OPTIONS node scripts/hosted-db/media-edge-ticket-key.selftest.mjs   (no network, no secrets)
import { createServer } from "node:http";
import { spawn } from "node:child_process";
const SCRIPT = new URL("./media-edge-ticket-key.mjs", import.meta.url).pathname;
const ACC = "a4c2b7ac45e58a81691b9165492ce6a2";
const TOKEN = "tok_TEST_abcdef0123456789";
function world(over = {}) {
  return {
    expires: new Date(Date.now() + 3600e3).toISOString(),
    accounts: [{ id: ACC, name: "Aladdin" }],
    r2ok: false, hdok: false,
    scripts: ["aladdin-media-edge-preview", "aladdin-frontend-preview", "aladdin-backend-preview"],
    media: [{ type: "r2_bucket", name: "MEDIA_BUCKET", bucket_name: "aladdin-r2-acceptance-20261011-private" }, { type: "hyperdrive", name: "HYPERDRIVE", id: "163eb6ad3a4c4b89840b28983999b995" }],
    front: [{ type: "plain_text", name: "NEXT_PUBLIC_SUPABASE_URL", text: "https://nxossqhdfltcqdwvbewi.supabase.co" }, { type: "plain_text", name: "R2_PRIVATE_BUCKET", text: "aladdin-r2-acceptance-20261011-private" }],
    secrets: { "aladdin-media-edge-preview": {}, "aladdin-frontend-preview": { SUPABASE_SERVICE_ROLE_KEY: "x" } },
    failPut: null, writes: [], ...over,
  };
}
function serve(w) {
  return new Promise((res) => {
    const s = createServer(async (req, rsp) => {
      let body = ""; for await (const c of req) body += c;
      const send = (code, json) => { rsp.writeHead(code, { "content-type": "application/json" }); rsp.end(JSON.stringify(json)); };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { success: false, errors: [{ code: 1000, message: "bad token" }] });
      const u = new URL(req.url, "http://x"); const p = u.pathname.replace(/^\/v4/, "");
      if (p === "/user/tokens/verify") return send(200, { success: true, result: { status: "active", expires_on: w.expires } });
      if (p === "/accounts") return send(200, { success: true, result: w.accounts });
      if (p.endsWith("/r2/buckets")) return w.r2ok ? send(200, { success: true, result: {} }) : send(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
      if (p.endsWith("/hyperdrive/configs")) return w.hdok ? send(200, { success: true, result: [] }) : send(403, { success: false });
      if (p === `/accounts/${ACC}/workers/scripts`) return send(200, { success: true, result: w.scripts.map((id) => ({ id })) });
      const m = p.match(/^\/accounts\/[^/]+\/workers\/scripts\/([^/]+)\/(settings|secrets)(?:\/(.+))?$/);
      if (m) {
        const [, name, kind, sec] = m;
        if (kind === "settings") return send(200, { success: true, result: { bindings: name.includes("media") ? w.media : w.front } });
        if (req.method === "GET") return send(200, { success: true, result: Object.keys(w.secrets[name]).map((n) => ({ name: n, type: "secret_text" })) });
        if (req.method === "PUT") {
          const b = JSON.parse(body);
          if (w.failPut === b.name) return send(400, { success: false, errors: [{ code: 10215, message: `rejected value ${b.text}` }] });
          w.secrets[name][b.name] = b.text; w.writes.push(`PUT ${name} ${b.name}`); return send(200, { success: true, result: { name: b.name } });
        }
        if (req.method === "DELETE") { delete w.secrets[name][sec]; w.writes.push(`DEL ${name} ${sec}`); return send(200, { success: true }); }
      }
      send(404, { success: false, errors: [{ message: `no route ${p}` }] });
    });
    s.listen(0, "127.0.0.1", () => res(s));
  });
}
function run(port, args, input, env = {}) {
  return new Promise((res) => {
    const base = { ...process.env }; delete base.NODE_OPTIONS; const e = { ...base, MEDIA_EDGE_KEY_TEST_API: `http://127.0.0.1:${port}/v4`, CF_MEDIA_KEY_TOKEN: TOKEN, ...env };
    for (const [k, v] of Object.entries(env)) if (v === null) delete e[k];
    const c = spawn(process.execPath, [SCRIPT, ...args], { env: e });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    c.stdin.end(input); c.on("close", (code) => res({ code, out }));
  });
}
let failures = 0;
const check = (label, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : " :: " + extra}`); if (!cond) failures++; };
async function scenario(label, over, args, input, expect, env) {
  const w = world(over); const s = await serve(w); const r = await run(s.address().port, args, input, env); s.close();
  const vals = Object.values(w.secrets).flatMap((o) => Object.values(o)).filter((v) => v.length > 20);
  const leaked = vals.some((v) => r.out.includes(v)) || r.out.includes(TOKEN) || /[A-Za-z0-9_-]{43}/.test(r.out);
  check(label, expect(r, w) && !leaked, `code=${r.code} leaked=${leaked}\n${r.out}`);
  return { r, w };
}
const noWrites = (r, w) => r.code !== 0 && w.writes.length === 0;
await scenario("check mode: passes, no writes", {}, [], "", (r, w) => r.code === 0 && w.writes.length === 0 && /Nothing was changed/.test(r.out));
const { w } = await scenario("apply: installs three secrets media-first", {}, ["--apply"], "install\n", (r, w) => r.code === 0 && w.writes.join("|") === "PUT aladdin-media-edge-preview TICKET_KEYS|PUT aladdin-frontend-preview MEDIA_EDGE_TICKET_SECRET|PUT aladdin-frontend-preview MEDIA_EDGE_TICKET_KID");
{
  const tk = JSON.parse(w.secrets["aladdin-media-edge-preview"].TICKET_KEYS);
  const kid = w.secrets["aladdin-frontend-preview"].MEDIA_EDGE_TICKET_KID, sec = w.secrets["aladdin-frontend-preview"].MEDIA_EDGE_TICKET_SECRET;
  check("formats: kid regex, one key, same secret, 32 bytes base64url", /^[a-z0-9]{1,16}$/.test(kid) && Object.keys(tk).length === 1 && tk[kid] === sec && /^[A-Za-z0-9_-]+$/.test(sec) && Buffer.from(sec, "base64url").length === 32);
  check("frontend service-role secret untouched", w.secrets["aladdin-frontend-preview"].SUPABASE_SERVICE_ROLE_KEY === "x");
}
const a = await scenario("apply twice: new key each run", {}, ["--apply"], "install\n", (r) => r.code === 0);
check("keys differ between runs", a.w.secrets["aladdin-frontend-preview"].MEDIA_EDGE_TICKET_SECRET !== w.secrets["aladdin-frontend-preview"].MEDIA_EDGE_TICKET_SECRET);
await scenario("apply: not confirmed -> no writes", {}, ["--apply"], "yes\n", noWrites);
await scenario("verify: names only", {}, ["--verify"], "", (r, w) => r.code === 0 && w.writes.length === 0 && /TICKET_KEYS MISSING/.test(r.out));
await scenario("token without expiry refused", { expires: undefined }, ["--apply"], "install\n", noWrites);
await scenario("token valid >24h refused", { expires: new Date(Date.now() + 48 * 3600e3).toISOString() }, ["--apply"], "install\n", noWrites);
await scenario("token seeing 2 accounts refused", { accounts: [{ id: ACC }, { id: "b".repeat(32) }] }, ["--apply"], "install\n", noWrites);
await scenario("token on another account refused", { accounts: [{ id: "c".repeat(32) }] }, ["--apply"], "install\n", noWrites);
await scenario("token that can read R2 refused", { r2ok: true }, ["--apply"], "install\n", noWrites);
await scenario("token that can read Hyperdrive refused", { hdok: true }, ["--apply"], "install\n", noWrites);
await scenario("missing media Worker refused", { scripts: ["aladdin-frontend-preview"] }, ["--apply"], "install\n", noWrites);
await scenario("media on another bucket refused", { media: [{ type: "r2_bucket", name: "MEDIA_BUCKET", bucket_name: "aladdin-media-private" }, { type: "hyperdrive", name: "HYPERDRIVE", id: "163eb6ad3a4c4b89840b28983999b995" }] }, ["--apply"], "install\n", noWrites);
await scenario("media on another Hyperdrive refused", { media: [{ type: "r2_bucket", name: "MEDIA_BUCKET", bucket_name: "aladdin-r2-acceptance-20261011-private" }, { type: "hyperdrive", name: "HYPERDRIVE", id: "f".repeat(32) }] }, ["--apply"], "install\n", noWrites);
await scenario("frontend on Production Supabase refused", { front: [{ type: "plain_text", name: "NEXT_PUBLIC_SUPABASE_URL", text: "https://kkpkgjrweysgvhvkhzun.supabase.co" }, { type: "plain_text", name: "R2_PRIVATE_BUCKET", text: "aladdin-r2-acceptance-20261011-private" }] }, ["--apply"], "install\n", noWrites);
await scenario("frontend with delivery enabled refused", { front: [...world().front, { type: "plain_text", name: "MEDIA_EDGE_DELIVERY_ENABLED", text: "true" }] }, ["--apply"], "install\n", noWrites);
await scenario("frontend kid as plain var refused", { front: [...world().front, { type: "plain_text", name: "MEDIA_EDGE_TICKET_KID", text: "k1" }] }, ["--apply"], "install\n", noWrites);
await scenario("PUT failure mid-way: stops, reports, value redacted", { failPut: "MEDIA_EDGE_TICKET_SECRET" }, ["--apply"], "install\n", (r, w) => r.code !== 0 && w.writes.length === 1 && /Already changed: aladdin-media-edge-preview TICKET_KEYS/.test(r.out) && /<hidden>/.test(r.out));
await scenario("remove: deletes frontend then media", { secrets: { "aladdin-media-edge-preview": { TICKET_KEYS: "{}" }, "aladdin-frontend-preview": { MEDIA_EDGE_TICKET_SECRET: "s", MEDIA_EDGE_TICKET_KID: "k", SUPABASE_SERVICE_ROLE_KEY: "x" } } }, ["--remove"], "remove\n", (r, w) => r.code === 0 && w.writes.join("|") === "DEL aladdin-frontend-preview MEDIA_EDGE_TICKET_SECRET|DEL aladdin-frontend-preview MEDIA_EDGE_TICKET_KID|DEL aladdin-media-edge-preview TICKET_KEYS" && w.secrets["aladdin-frontend-preview"].SUPABASE_SERVICE_ROLE_KEY === "x");
await scenario("extra argument refused", {}, ["--apply", "aladdin-frontend-production"], "install\n", noWrites);
await scenario("NODE_OPTIONS refused", {}, ["--apply"], "install\n", noWrites, { NODE_OPTIONS: "--require x" });
await scenario("TLS off refused", {}, ["--apply"], "install\n", noWrites, { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
await scenario("non-loopback test API refused", {}, ["--apply"], "install\n", noWrites, { MEDIA_EDGE_KEY_TEST_API: "http://example.com/v4" });
await scenario("no token refused", {}, ["--apply"], "install\n", noWrites, { CF_MEDIA_KEY_TOKEN: null });
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
