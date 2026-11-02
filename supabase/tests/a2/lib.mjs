// Phase A2 - local identity verification harness (library).
//
// LOCAL ONLY. Every helper refuses anything that is not an isolated local Supabase CLI stack:
//   * the API URL must be loopback;
//   * DB_CONTAINER must be named explicitly (no auto-selection), look like supabase_db_<project>, and must
//     not be the shared default stack, or anything staging/prod-like (same contract as tests/lib/db_target.sh);
//   * keys come from the environment or from `supabase status` of THIS worktree; they are never printed.
//
// Nothing here sends WhatsApp / SMS / email. Phone numbers are synthetic and are masked in evidence; raw
// OTPs are never recorded (only fake OTP fixtures from the local test_otp map exist, and they are masked).
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

export const SHARED_STACK = "supabase_db_aladdin";

function fail(message) {
  console.error(`[a2] REFUSED: ${message}`);
  process.exit(2);
}

function localStatus() {
  const out = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const env = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

export function target() {
  const container = process.env.DB_CONTAINER ?? "";
  if (!container) fail("DB_CONTAINER is not set. Name the isolated A2 stack's database container explicitly.");
  if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(container)) fail("DB_CONTAINER is not a local Supabase CLI database container name.");
  if (/staging|prod/i.test(container)) fail("DB_CONTAINER looks like a shared environment.");
  if (container === SHARED_STACK && process.env.ALLOW_SHARED_STACK !== "1") fail("refusing the shared default stack.");
  const s = process.env.A2_API_URL && process.env.A2_ANON_KEY && process.env.A2_SERVICE_KEY
    ? { API_URL: process.env.A2_API_URL, ANON_KEY: process.env.A2_ANON_KEY, SERVICE_ROLE_KEY: process.env.A2_SERVICE_KEY }
    : localStatus();
  const api = new URL(s.API_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(api.hostname)) fail("API URL is not loopback.");
  // The container must expose the same DB the API belongs to: the project suffix has to match the CLI project.
  const label = execFileSync("docker", ["inspect", "-f", "{{ index .Config.Labels \"com.supabase.cli.project\" }}", container], { encoding: "utf8" }).trim();
  if (`supabase_db_${label}` !== container) fail("container label does not match its name.");
  return { container, api: s.API_URL.replace(/\/$/, ""), anon: s.ANON_KEY, service: s.SERVICE_ROLE_KEY };
}

// ---------------------------------------------------------------------------------------------------------
// Database (superuser fixture/verification access; real roles are exercised through PostgREST/GoTrue)
// ---------------------------------------------------------------------------------------------------------
export function makeDb(container) {
  const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"];
  return {
    // Run SQL (stdin) and return stdout.
    sql(text) {
      return execFileSync("docker", args, { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    },
    json(text) {
      const out = this.sql(text);
      return out ? JSON.parse(out) : null;
    },
    // Async variant for genuinely concurrent sessions (one psql process = one database session each).
    async sqlAsync(text) {
      return new Promise((resolve, reject) => {
        const p = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
        let out = "";
        let err = "";
        p.stdout.on("data", (d) => (out += d));
        p.stderr.on("data", (d) => (err += d));
        p.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `psql exit ${code}`))));
        p.stdin.end(text);
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// HTTP: GoTrue + PostgREST (the same surfaces the app uses)
// ---------------------------------------------------------------------------------------------------------
export function makeHttp({ api, anon, service }) {
  async function call(method, path, { token, key = anon, body, headers = {} } = {}) {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { apikey: key, authorization: `Bearer ${token ?? key}`, "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
    return { status: res.status, data };
  }
  return {
    call,
    adminCreateUser: (body) => call("POST", "/auth/v1/admin/users", { key: service, token: service, body }),
    adminGetUser: (id) => call("GET", `/auth/v1/admin/users/${id}`, { key: service, token: service }),
    adminDeleteUser: (id) => call("DELETE", `/auth/v1/admin/users/${id}`, { key: service, token: service }),
    signInPassword: (email, password) => call("POST", "/auth/v1/token?grant_type=password", { body: { email, password } }),
    rpc: (fn, args, token) => call("POST", `/rest/v1/rpc/${fn}`, { token, body: args ?? {} }),
    rpcService: (fn, args) => call("POST", `/rest/v1/rpc/${fn}`, { key: service, token: service, body: args ?? {} }),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Evidence: PASS / FAIL / GAP recorder with redaction
// ---------------------------------------------------------------------------------------------------------
const PHONE = /\+\d{8,15}/g;
const ALIAS = /p\d{8,15}@craftsman-login\.aladdin\.invalid/g;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g;

export function mask(value) {
  return String(value)
    .replace(JWT, "<jwt>")
    .replace(ALIAS, (m) => `p***${m.slice(m.indexOf("@") - 2)}`)
    .replace(PHONE, (m) => `+${"*".repeat(m.length - 3)}${m.slice(-2)}`);
}

export const shortId = (id) => (id ? String(id).slice(0, 8) : null);

export function makeRecorder(suite) {
  const results = [];
  return {
    results,
    // status: PASS | FAIL | GAP  (GAP = a required scenario that is NOT implemented; recorded, never reported as PASS)
    record(id, area, title, status, evidence = "") {
      const row = { id, area, title, status, evidence: mask(evidence) };
      results.push(row);
      const tag = { PASS: "ok  ", GAP: "GAP ", EVAL: "EVAL", FAIL: "FAIL" }[status];
      console.log(`${tag} ${id} ${title}${status === "PASS" ? "" : ` -- ${row.evidence}`}`);
    },
    check(id, area, title, condition, evidence = "") {
      this.record(id, area, title, condition ? "PASS" : "FAIL", condition ? evidence : `expected true; ${evidence}`);
      return Boolean(condition);
    },
    gap(id, area, title, evidence) {
      this.record(id, area, title, "GAP", evidence);
    },
    // EVAL = an observation about a CANDIDATE design (not a pass/fail of shipped behaviour); the verdict is in the report.
    evaluation(id, area, title, evidence) {
      this.record(id, area, title, "EVAL", evidence);
    },
    summary() {
      const c = { PASS: 0, FAIL: 0, GAP: 0, EVAL: 0 };
      for (const r of results) c[r.status] += 1;
      return { suite, ...c, total: results.length };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------------------------------------
export const runTag = () => randomBytes(3).toString("hex");
export const sha = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12);

// Egyptian-shaped synthetic mobiles: +20 10 0 <run:3 hex->digits> <seq:4>. The 0100 block + run tag keeps them
// unique per run; they are never dialled (no transport exists in these tests) and are masked in evidence.
export function phoneFactory(tag) {
  const base = String(parseInt(tag, 16) % 1000).padStart(3, "0");
  let n = 0;
  return () => {
    n += 1;
    const national = `100${base}${String(n).padStart(4, "0")}`; // 10 digits after the trunk 0 -> 1 0 0 b b b n n n n
    return { iso2: "EG", national, e164: `+20${national}` };
  };
}
