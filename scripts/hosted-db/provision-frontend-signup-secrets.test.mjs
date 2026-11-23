import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { LIVE_VERSION, NEW_NAMES, P4_VERSION, SIGNUP_SECRET_NAMES } from "./provision-frontend-otp-secrets.mjs";
import { CONFIRM_PHRASE, FIXED, generateValues, run } from "./provision-frontend-signup-secrets.mjs";

const LIVE_BINDINGS = [
  { name: "APP_PUBLIC_ORIGIN", text: "https://aladdindecore.com", type: "plain_text" },
  { name: "ASSETS", type: "assets" },
  { name: "RESEND_API_KEY", type: "secret_text" },
  { environment: "production", name: "BACKEND", service: "aladdin-backend-production", type: "service" },
];
const P4_BINDINGS = [...LIVE_BINDINGS, ...NEW_NAMES.map((name) => ({ name, type: "secret_text" }))];
const RUNTIME = { compatibility_date: "2026-10-01", compatibility_flags: ["nodejs_compat"] };
const NEW_ID = "new-version-1";

/** Stateful fake of the wrangler calls. Records every call; the write is the only call with stdin. */
function fake({ deployed = [{ version_id: LIVE_VERSION, percentage: 100 }], versions, p4Bindings = P4_BINDINGS, bulkFails = false, createOnFail = false, mutate } = {}) {
  const state = {
    deployment: { id: "dep-1", versions: deployed },
    versions: versions ?? [{ id: LIVE_VERSION, number: 11 }, { id: P4_VERSION, number: 12 }],
    views: { [P4_VERSION]: { resources: { bindings: p4Bindings, script_runtime: RUNTIME } } },
    calls: [], stdin: null,
  };
  const wrangler = (args, opts = {}) => {
    state.calls.push({ args, hasInput: opts.input !== undefined });
    const cmd = args.slice(0, 2).join(" ");
    const json = (o) => ({ status: 0, stdout: JSON.stringify(o), stderr: "" });
    if (cmd === "deployments status") return json(state.deployment);
    if (cmd === "versions list") return json(state.versions);
    if (cmd === "versions view") return json(state.views[args[2]]);
    if (args.slice(0, 3).join(" ") === "versions secret bulk") {
      state.stdin = opts.input;
      if (bulkFails) {
        if (createOnFail) state.versions = [...state.versions, { id: NEW_ID, number: 13 }];
        return { status: 1, stdout: "", stderr: `boom ${opts.input}` };
      }
      const added = Object.keys(JSON.parse(opts.input)).map((name) => ({ name, type: "secret_text" }));
      state.versions = [...state.versions, { id: NEW_ID, number: 13 }];
      state.views[NEW_ID] = { resources: { bindings: [...P4_BINDINGS, ...added], script_runtime: RUNTIME } };
      mutate?.(state, NEW_ID);
      return { status: 0, stdout: `Success! Uploaded secret(s) ${Object.keys(JSON.parse(opts.input)).join(", ")} ${opts.input}`, stderr: "" };
    }
    throw new Error(`unexpected wrangler call: ${args.join(" ")}`);
  };
  return { state, wrangler };
}
const go = async (f, argv, confirm, extra = {}) => {
  const lines = [];
  const code = await run({ argv, wrangler: f.wrangler, confirm, out: (s) => lines.push(s), ...extra });
  return { code, text: lines.join("\n") };
};
const noPrompt = async () => { throw new Error("must not prompt"); };
const wrote = (f) => f.state.calls.some((c) => c.args.includes("bulk"));

test("the five names are fixed and disjoint from the P-4 names", () => {
  assert.deepEqual([...SIGNUP_SECRET_NAMES].sort(), ["PHONE_OTP_DELIVERY", "PHONE_OTP_HMAC_KEYS", "PHONE_SIGNUP_COOKIE_SECRET", "PHONE_SIGNUP_VERIFICATION_ENABLED", "PHONE_VERIFICATION_ENABLED"]);
  for (const n of SIGNUP_SECRET_NAMES) assert.ok(!NEW_NAMES.includes(n));
  assert.deepEqual(FIXED, { PHONE_OTP_DELIVERY: "worker", PHONE_VERIFICATION_ENABLED: "true", PHONE_SIGNUP_VERIFICATION_ENABLED: "true" });
});

test("generateValues: valid keyring (one fresh kid, 32 random bytes), cookie secret >= 32 chars, exactly the five names, different each time", () => {
  const a = generateValues(), b = generateValues();
  assert.deepEqual(Object.keys(a.values).sort(), [...SIGNUP_SECRET_NAMES].sort());
  const ring = JSON.parse(a.values.PHONE_OTP_HMAC_KEYS);
  assert.equal(ring.current, a.kid);
  assert.match(ring.current, /^[A-Za-z0-9_-]{1,32}$/);
  assert.deepEqual(Object.keys(ring.keys), [ring.current]);
  assert.ok(Buffer.from(ring.keys[ring.current], "base64").length >= 32);
  assert.ok(a.values.PHONE_OTP_HMAC_KEYS.length >= 20);
  assert.ok(a.values.PHONE_SIGNUP_COOKIE_SECRET.length >= 32);
  assert.notEqual(a.values.PHONE_SIGNUP_COOKIE_SECRET, b.values.PHONE_SIGNUP_COOKIE_SECRET);
  assert.notEqual(a.values.PHONE_OTP_HMAC_KEYS, b.values.PHONE_OTP_HMAC_KEYS);
});

test("default mode is a DRY RUN: lists names only, no prompt, no write", async () => {
  const f = fake();
  const r = await go(f, [], noPrompt);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /DRY RUN/);
  for (const n of SIGNUP_SECRET_NAMES) assert.ok(r.text.includes(n));
  assert.ok(!wrote(f));
  assert.ok(f.state.calls.every((c) => !c.hasInput));
});

test("--apply: typed phrase, one write through stdin, exactly the five names, no value anywhere else", async () => {
  const f = fake();
  const seen = [];
  const random = (n) => { const b = randomBytes(n); seen.push(b); return b; };
  const r = await go(f, ["--apply"], async () => CONFIRM_PHRASE, { random });
  assert.equal(r.code, 0, r.text);
  const bulk = f.state.calls.filter((c) => c.args.includes("bulk"));
  assert.equal(bulk.length, 1);
  assert.ok(bulk[0].hasInput);
  assert.ok(bulk[0].args.includes("production"));
  assert.ok(!bulk[0].args.some((a) => /^(PHONE_|whsec)/.test(a)), "no value or name argument on the command line");
  const sent = JSON.parse(f.state.stdin);
  assert.deepEqual(Object.keys(sent).sort(), [...SIGNUP_SECRET_NAMES].sort());
  for (const [k, v] of Object.entries(FIXED)) assert.equal(sent[k], v);
  const ring = JSON.parse(sent.PHONE_OTP_HMAC_KEYS);
  const material = [sent.PHONE_OTP_HMAC_KEYS, sent.PHONE_SIGNUP_COOKIE_SECRET, ring.keys[ring.current], ...seen.map((b) => b.toString("base64")), ...seen.map((b) => b.toString("base64url")), ...seen.map((b) => b.toString("hex"))];
  for (const m of material) {
    assert.ok(!r.text.includes(m), "secret material printed");
    for (const c of f.state.calls) assert.ok(!c.args.join(" ").includes(m), "secret material in a command line");
  }
  assert.match(r.text, /NOT deployed/);
  for (const n of SIGNUP_SECRET_NAMES) assert.ok(r.text.includes(n), "names confirmed in the post-check");
  assert.ok(f.state.calls.some((c) => c.args.join(" ") === `versions view ${NEW_ID} --env production --json`), "post-check views the new version");
});

test("a wrong confirmation phrase refuses and writes nothing", async () => {
  for (const typed of ["", "yes", CONFIRM_PHRASE.toLowerCase(), `${CONFIRM_PHRASE} extra`, "SET 5 PHONE SIGNUP SECRETS ON aladdin-frontend-preview"]) {
    const f = fake();
    const r = await go(f, ["--apply"], async () => typed);
    assert.equal(r.code, 1);
    assert.match(r.text, /confirmation phrase did not match/);
    assert.ok(!wrote(f));
  }
  assert.match(CONFIRM_PHRASE, /aladdin-frontend-production/);
});

test("refuses unless the live version is the only one at 100% (dry run and apply)", async () => {
  for (const deployed of [
    [{ version_id: LIVE_VERSION, percentage: 90 }, { version_id: P4_VERSION, percentage: 10 }],
    [{ version_id: P4_VERSION, percentage: 100 }],
    [{ version_id: LIVE_VERSION, percentage: 50 }],
  ]) {
    for (const argv of [[], ["--apply"]]) {
      const f = fake({ deployed });
      const r = await go(f, argv, noPrompt);
      assert.equal(r.code, 1);
      assert.match(r.text, /not exactly/);
      assert.ok(!wrote(f));
    }
  }
});

test("refuses when the latest uploaded version is not the P-4 version (bulk patches the latest)", async () => {
  const f = fake({ versions: [{ id: LIVE_VERSION, number: 11 }, { id: P4_VERSION, number: 12 }, { id: "newer", number: 13 }] });
  const r = await go(f, ["--apply"], noPrompt);
  assert.equal(r.code, 1);
  assert.match(r.text, /latest uploaded version is newer/);
  const g = fake({ versions: [{ id: LIVE_VERSION, number: 11 }] });
  assert.match((await go(g, [], noPrompt)).text, /not the P-4 version/);
});

test("refuses when a P-4 name is missing, a sign-up name already exists, or a grant key is present", async () => {
  const missing = fake({ p4Bindings: P4_BINDINGS.filter((b) => b.name !== "PHONE_OTP_ADMIN_SECRET") });
  assert.match((await go(missing, [], noPrompt)).text, /PHONE_OTP_ADMIN_SECRET is not a secret_text binding on the P-4 version/);
  const exists = fake({ p4Bindings: [...P4_BINDINGS, { name: "PHONE_OTP_DELIVERY", type: "secret_text" }] });
  assert.match((await go(exists, [], noPrompt)).text, /PHONE_OTP_DELIVERY already exists/);
  const grant = fake({ p4Bindings: [...P4_BINDINGS, { name: "OTP_ADMIN_GRANT_SECRET", type: "secret_text" }] });
  assert.match((await go(grant, [], noPrompt)).text, /must never be on the frontend/);
});

test("refuses --apply in CI or without a terminal, and any other argument", async () => {
  for (const extra of [{ ci: true }, { isTTY: false }]) {
    const f = fake();
    assert.equal((await go(f, ["--apply"], noPrompt, extra)).code, 1);
    assert.equal(f.state.calls.length, 0);
  }
  for (const argv of [["--env=preview"], ["--verify-version=x"], ["--apply", "--force"]]) {
    const f = fake();
    assert.equal((await go(f, argv, noPrompt)).code, 2);
    assert.equal(f.state.calls.length, 0);
  }
});

test("the only write is `versions secret bulk --env production`; never deploy, rollback or `secret put`", async () => {
  const f = fake();
  await go(f, ["--apply"], async () => CONFIRM_PHRASE);
  for (const c of f.state.calls) {
    const a = c.args.join(" ");
    assert.ok(/^(deployments status|versions list|versions view|versions secret bulk) /.test(a), `unexpected call: ${a}`);
    assert.ok(!/deploy |rollback|secret put|delete/.test(a));
    assert.ok(a.includes("--env production"));
  }
});

test("wrangler error output is redacted, and a failed write is verified read-only", async () => {
  const f = fake({ bulkFails: true, createOnFail: true });
  const r = await go(f, ["--apply"], async () => CONFIRM_PHRASE);
  assert.equal(r.code, 1);
  const sent = JSON.parse(f.state.stdin);
  assert.ok(!r.text.includes(sent.PHONE_SIGNUP_COOKIE_SECRET));
  assert.ok(!r.text.includes(sent.PHONE_OTP_HMAC_KEYS));
  assert.match(r.text, /NEW VERSION\(S\) EXIST/);
});

test("postflight problems: a promoted/extra binding or changed binding is reported", async () => {
  const f = fake({ mutate: (s, id) => { s.views[id].resources.bindings.push({ name: "EXTRA", type: "secret_text" }); } });
  const r = await go(f, ["--apply"], async () => CONFIRM_PHRASE);
  assert.equal(r.code, 1);
  assert.match(r.text, /POSTFLIGHT PROBLEMS/);
  assert.match(r.text, /new bindings are/);
});
