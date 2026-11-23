import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCEPTANCE_REF, projectRef, runSmoke } from "./registration-gate-smoke.mjs";

const env = (over = {}) => ({ SMOKE_URL: `https://${ACCEPTANCE_REF}.supabase.co`, SMOKE_PUBLISHABLE_KEY: "sb_publishable_x", SMOKE_EMAIL: "a@probe.test", SMOKE_PASSWORD: "pw", ...over });
const res = (status, json) => ({ status, text: async () => (json === undefined ? "" : JSON.stringify(json)), json: async () => json });

// A fake Data API. gateOn = whether the registration gate refuses writes of an unfinished account.
function fake({ state = "consent_pending", gateOn = true, doneState = "access_ready" } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const u = new URL(url), method = init?.method ?? "GET";
    calls.push(`${method} ${u.pathname}`);
    if (u.pathname.endsWith("/token")) return res(200, { access_token: JSON.parse(init.body).email.startsWith("done") ? "tok-done" : "tok-open" });
    const done = init.headers.authorization === "Bearer tok-done";
    if (u.pathname.endsWith("/rpc/my_registration_state")) return res(200, done ? doneState : state);
    if (u.pathname.endsWith("/rpc/my_account_status")) return res(200, { status: "pending_verification" });
    const write = method !== "GET";
    if (write && !done && gateOn) return res(403, { code: "42501", hint: "registration_incomplete", message: "registration incomplete" });
    return res(write ? 204 : 200, write ? undefined : []);
  };
  return { impl, calls };
}

test("it refuses any project that is not Acceptance, and a secret key", async () => {
  assert.equal(projectRef("https://kkpkgjrweysgvhvkhzun.supabase.co"), "kkpkgjrweysgvhvkhzun");
  const r1 = await runSmoke({ fetchImpl: fake().impl, env: env({ SMOKE_URL: "https://kkpkgjrweysgvhvkhzun.supabase.co" }) });
  assert.equal(r1.ok, false); assert.match(r1.lines[0], /not the Acceptance project/);
  const r2 = await runSmoke({ fetchImpl: fake().impl, env: env({ SMOKE_PUBLISHABLE_KEY: "sb_secret_abc" }) });
  assert.equal(r2.ok, false); assert.match(r2.lines[0], /PUBLISHABLE/);
  const r3 = await runSmoke({ fetchImpl: fake().impl, env: env({ SMOKE_EMAIL: "" }) });
  assert.equal(r3.ok, false);
});

test("with the gate active every write probe is refused, reads work, and the smoke passes", async () => {
  const { impl } = fake();
  const r = await runSmoke({ fetchImpl: impl, env: env() });
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.match(r.lines.at(-1), /SMOKE: OK/);
  assert.equal(r.lines.filter((l) => l.startsWith("FAIL")).length, 0);
});

test("with the gate MISSING the smoke FAILS (writes were not refused)", async () => {
  const r = await runSmoke({ fetchImpl: fake({ gateOn: false }).impl, env: env() });
  assert.equal(r.ok, false);
  assert.ok(r.lines.filter((l) => l.startsWith("FAIL")).length >= 5, r.lines.join("\n"));
  assert.match(r.lines.at(-1), /FAILED/);
});

test("it refuses to run with an account that has already finished registration", async () => {
  const r = await runSmoke({ fetchImpl: fake({ state: "access_ready" }).impl, env: env() });
  assert.equal(r.ok, false); assert.match(r.lines[0], /must be mid-registration/);
});

test("the optional finished account must not be refused; a finished account that is refused FAILS", async () => {
  const good = await runSmoke({ fetchImpl: fake().impl, env: env({ SMOKE_DONE_EMAIL: "done@probe.test", SMOKE_DONE_PASSWORD: "pw" }) });
  assert.equal(good.ok, true, good.lines.join("\n"));
  const wrong = await runSmoke({ fetchImpl: fake({ doneState: "consent_pending" }).impl, env: env({ SMOKE_DONE_EMAIL: "done@probe.test", SMOKE_DONE_PASSWORD: "pw" }) });
  assert.equal(wrong.ok, false);
});

test("every write probe targets a row that cannot exist or fails on its own input (harmless if the gate were off)", async () => {
  const { impl, calls } = fake({ gateOn: false });
  await runSmoke({ fetchImpl: impl, env: env() });
  const writes = calls.filter((c) => !c.startsWith("GET") && !c.includes("/token") && !c.includes("my_registration_state") && !c.includes("my_account_status"));
  assert.deepEqual(writes.sort(), ["DELETE /rest/v1/user_availability_windows", "PATCH /rest/v1/profiles", "POST /rest/v1/organizations", "POST /rest/v1/rpc/graphql", "POST /rest/v1/rpc/job_save"]);
});

test("with CAPTCHA protection ON the smoke runs from existing access tokens and never calls the password grant", async () => {
  const { impl, calls } = fake();
  const base = env({ SMOKE_EMAIL: "", SMOKE_PASSWORD: "", SMOKE_ACCESS_TOKEN: "tok-open", SMOKE_DONE_ACCESS_TOKEN: "tok-done" });
  const r = await runSmoke({ fetchImpl: impl, env: base });
  assert.equal(r.ok, true, r.lines.join("\n"));
  assert.equal(calls.some((c) => c.includes("/token")), false);
  assert.ok(r.lines.some((l) => /second account is registered/.test(l)));
});
