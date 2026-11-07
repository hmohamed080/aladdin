import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  LIVE_VERSION, NEW_NAMES, PLACEHOLDER_URL, SECRET_NAMES, URL_NAME, checkEntries, checkPostflight, checkPreflight, redact, run,
} from "./provision-frontend-otp-secrets.mjs";
import { fingerprint, validateGrantKey } from "./provision-grant-key/provision-grant-key.mjs";

const secret = () => `whsec_${randomBytes(32).toString("base64")}`;
const LIVE_BINDINGS = [
  { name: "APP_PUBLIC_ORIGIN", text: "https://aladdindecore.com", type: "plain_text" },
  { name: "ASSETS", type: "assets" },
  { name: "RESEND_API_KEY", type: "secret_text" },
  { environment: "production", name: "BACKEND", service: "aladdin-backend-production", type: "service" },
];
const RUNTIME = { compatibility_date: "2026-10-01", compatibility_flags: ["nodejs_compat"] };

/** A stateful fake of the four wrangler calls the script makes. Records every call and the stdin of the write. */
function fake({ deployed = [{ version_id: LIVE_VERSION, percentage: 100 }], versions, bulkFails = false, createOnFail = false, readsFailAfterWrite = false, viewFailsForNew = false, mutate } = {}) {
  const state = {
    deployment: { id: "dep-1", versions: deployed },
    versions: versions ?? [{ id: LIVE_VERSION, number: 11 }],
    views: { [LIVE_VERSION]: { resources: { bindings: LIVE_BINDINGS, script_runtime: RUNTIME } } },
    calls: [], stdin: null,
  };
  const wrangler = (args, opts = {}) => {
    state.calls.push({ args, hasInput: opts.input !== undefined });
    const cmd = args.slice(0, 2).join(" ");
    const json = (o) => ({ status: 0, stdout: JSON.stringify(o), stderr: "" });
    if (readsFailAfterWrite && state.stdin !== null && (cmd === "deployments status" || cmd === "versions list")) return { status: 1, stdout: "", stderr: "network down" };
    if (cmd === "deployments status") return json(state.deployment);
    if (cmd === "versions list") return json(state.versions);
    if (cmd === "versions view") { if (viewFailsForNew && args[2] === "new-version-1") return { status: 1, stdout: "", stderr: "view failed" }; return json(state.views[args[2]]); }
    if (args.slice(0, 3).join(" ") === "versions secret bulk") {
      state.stdin = opts.input;
      if (bulkFails) {
        if (createOnFail) state.versions = [...state.versions, { id: "new-version-1", number: 12 }];
        return { status: 1, stdout: "", stderr: `boom ${opts.input}` };
      }
      const id = "new-version-1";
      const added = Object.keys(JSON.parse(opts.input)).map((name) => ({ name, type: "secret_text" }));
      state.versions = [...state.versions, { id, number: 12 }];
      state.views[id] = { resources: { bindings: [...LIVE_BINDINGS, ...added], script_runtime: RUNTIME } };
      mutate?.(state, id);
      return { status: 0, stdout: `Success! Uploaded secret(s) ${Object.keys(JSON.parse(opts.input)).join(", ")}`, stderr: "" };
    }
    throw new Error(`unexpected wrangler call: ${args.join(" ")}`);
  };
  return { state, wrangler };
}
const prompts = (values) => { const q = []; for (const n of SECRET_NAMES) q.push(values[n], values[n]); return async () => q.shift(); };
const go = async (f, argv, hidden, extra = {}) => {
  const lines = [];
  const code = await run({ argv, wrangler: f.wrangler, hidden, out: (s) => lines.push(s), ...extra });
  return { code, text: lines.join("\n") };
};

test("default mode is a read-only preflight: no prompts, no write", async () => {
  const f = fake();
  const r = await go(f, [], async () => { throw new Error("must not prompt"); });
  assert.equal(r.code, 0);
  assert.ok(!f.state.calls.some((c) => c.args.includes("bulk")), "no write call");
});

test("--apply creates exactly one undeployed version, secrets only on stdin, nothing printed", async () => {
  const f = fake();
  const v = Object.fromEntries(SECRET_NAMES.map((n) => [n, secret()]));
  const r = await go(f, ["--apply"], prompts(v));
  assert.equal(r.code, 0, r.text);
  const bulk = f.state.calls.filter((c) => c.args.includes("bulk"));
  assert.equal(bulk.length, 1);
  assert.ok(bulk[0].hasInput, "payload goes through stdin");
  for (const c of f.state.calls) for (const val of [...Object.values(v), PLACEHOLDER_URL]) assert.ok(!c.args.join(" ").includes(val), "no value in a command line");
  const sent = JSON.parse(f.state.stdin);
  assert.deepEqual(Object.keys(sent).sort(), [...NEW_NAMES].sort());
  assert.equal(sent[URL_NAME], PLACEHOLDER_URL);
  for (const val of Object.values(v)) assert.ok(!r.text.includes(val), "no secret value in the output");
  assert.match(r.text, /fingerprint [0-9a-f]{12}/);
  assert.match(r.text, /NOT deployed/);
});

test("secrets in wrangler's own error output are redacted", async () => {
  const f = fake({ bulkFails: true });
  const v = Object.fromEntries(SECRET_NAMES.map((n) => [n, secret()]));
  const r = await go(f, ["--apply"], prompts(v));
  assert.equal(r.code, 1);
  for (const val of Object.values(v)) assert.ok(!r.text.includes(val));
});

test("refuses unless the live version is the only one at 100%", async () => {
  for (const deployed of [
    [{ version_id: LIVE_VERSION, percentage: 90 }, { version_id: "other", percentage: 10 }],
    [{ version_id: "other", percentage: 100 }],
  ]) {
    const f = fake({ deployed });
    const r = await go(f, ["--apply"], async () => { throw new Error("must not prompt"); });
    assert.equal(r.code, 1);
    assert.match(r.text, /not exactly/);
  }
});

test("refuses when the latest uploaded version is not the live one (the bulk command patches the latest)", async () => {
  const f = fake({ versions: [{ id: LIVE_VERSION, number: 11 }, { id: "newer-unlive", number: 12 }] });
  const r = await go(f, ["--apply"], async () => { throw new Error("no prompt"); });
  assert.equal(r.code, 1);
  assert.match(r.text, /latest uploaded version/);
});

test("refuses when a new name already exists on the live version", () => {
  const baseline = { resources: { bindings: [...LIVE_BINDINGS, { name: "PHONE_OTP_ADMIN_SECRET", type: "secret_text" }] } };
  assert.match(checkPreflight({ deployment: { versions: [{ version_id: LIVE_VERSION, percentage: 100 }] }, versions: [{ id: LIVE_VERSION, number: 1 }], baseline }).join(), /already exists/);
});

test("a mismatch between the two entries stops before anything is created", async () => {
  const f = fake();
  const a = secret();
  const q = [a, secret()];
  const r = await go(f, ["--apply"], async () => q.shift());
  assert.equal(r.code, 1);
  assert.ok(!f.state.calls.some((c) => c.args.includes("bulk")));
});

test("entries: format, entropy, distinctness and the grant key are enforced", () => {
  const ok = Object.fromEntries(SECRET_NAMES.map((n) => [n, secret()]));
  assert.deepEqual(checkEntries(ok).problems, []);
  assert.match(checkEntries({ ...ok, PHONE_OTP_ADMIN_SECRET: "not-a-secret" }).problems.join(), /not a valid whsec_/);
  assert.match(checkEntries({ ...ok, PHONE_OTP_ADMIN_SECRET: `whsec_${Buffer.alloc(32, 1).toString("base64")}` }).problems.join(), /low_entropy/);
  assert.match(checkEntries({ ...ok, PHONE_OTP_NOTIFY_SECRET: ok.PHONE_OTP_ADMIN_SECRET }).problems.join(), /must differ/);
  const grantFp = fingerprint(validateGrantKey(ok.PHONE_OTP_WORKER_SECRET).bytes).slice(0, 12);
  assert.match(checkEntries(ok, grantFp).problems.join(), /grant key/);
});

const baseline = { resources: { bindings: LIVE_BINDINGS, script_runtime: RUNTIME } };
const beforeState = { deployment: { id: "dep-1" }, versions: [{ id: LIVE_VERSION, number: 11 }] };
const goodAfter = () => ({
  deployment: { id: "dep-1", versions: [{ version_id: LIVE_VERSION, percentage: 100 }] },
  versions: [{ id: LIVE_VERSION, number: 11 }, { id: "n", number: 12 }],
  newView: { resources: { bindings: [...LIVE_BINDINGS, ...NEW_NAMES.map((name) => ({ name, type: "secret_text" }))], script_runtime: RUNTIME } },
});
test("postflight passes only for baseline + exactly the four new secret bindings", () => {
  assert.deepEqual(checkPostflight({ before: beforeState, after: goodAfter(), baseline }), []);
});
test("postflight catches a changed deployment, a new deployment, a second version", () => {
  const a = goodAfter(); a.deployment = { id: "dep-2", versions: [{ version_id: "n", percentage: 100 }] };
  const p = checkPostflight({ before: beforeState, after: a, baseline }).join();
  assert.match(p, /CHANGED/); assert.match(p, /new deployment/);
  const b = goodAfter(); b.versions.push({ id: "n2", number: 13 });
  assert.match(checkPostflight({ before: beforeState, after: b, baseline }).join(), /exactly one new version/);
});
test("postflight catches a lost or changed binding, an extra binding, a wrong type and changed runtime", () => {
  const lost = goodAfter(); lost.newView.resources.bindings = lost.newView.resources.bindings.filter((b) => b.name !== "RESEND_API_KEY");
  assert.match(checkPostflight({ before: beforeState, after: lost, baseline }).join(), /RESEND_API_KEY was LOST/);
  const changed = goodAfter(); changed.newView.resources.bindings[0] = { ...LIVE_BINDINGS[0], text: "https://evil.example" };
  assert.match(checkPostflight({ before: beforeState, after: changed, baseline }).join(), /APP_PUBLIC_ORIGIN CHANGED/);
  const extra = goodAfter(); extra.newView.resources.bindings.push({ name: "SOMETHING_ELSE", type: "secret_text" });
  assert.match(checkPostflight({ before: beforeState, after: extra, baseline }).join(), /expected exactly/);
  const typed = goodAfter(); typed.newView.resources.bindings = typed.newView.resources.bindings.map((b) => (b.name === URL_NAME ? { ...b, type: "plain_text" } : b));
  assert.match(checkPostflight({ before: beforeState, after: typed, baseline }).join(), /not a secret_text/);
  const rt = goodAfter(); rt.newView.resources.script_runtime = { ...RUNTIME, compatibility_date: "2030-01-01" };
  assert.match(checkPostflight({ before: beforeState, after: rt, baseline }).join(), /script_runtime/);
});

test("a deployment that moves during the write is reported (postflight problem, exit 1)", async () => {
  const f = fake({ mutate: (s, id) => { s.deployment = { id: "dep-2", versions: [{ version_id: id, percentage: 100 }] }; } });
  const v = Object.fromEntries(SECRET_NAMES.map((n) => [n, secret()]));
  const r = await go(f, ["--apply"], prompts(v));
  assert.equal(r.code, 1);
  assert.match(r.text, /POSTFLIGHT PROBLEMS/);
});

test("never in CI, never without a terminal, unknown arguments are refused", async () => {
  const f = fake();
  assert.equal((await go(f, ["--apply"], async () => "x", { ci: true })).code, 1);
  assert.equal((await go(f, ["--apply"], async () => "x", { isTTY: false })).code, 1);
  assert.equal((await go(f, ["--yolo"], async () => "x")).code, 2);
});

test("redact removes every occurrence of a secret", () => {
  assert.equal(redact("a SECRET123 b SECRET123", ["SECRET123"]), "a [redacted] b [redacted]");
});

const values3 = () => Object.fromEntries(SECRET_NAMES.map((n) => [n, secret()]));
const noPromotion = (f) => {
  const bulks = f.state.calls.filter((c) => c.args.includes("bulk")).length;
  assert.equal(bulks, 1, "never retried");
  assert.ok(!f.state.calls.some((c) => c.args.includes("deploy") || c.args.includes("rollback") || c.args.includes("put")), "never promotes or rolls back");
};

test("nonzero wrangler exit with no new version: verified read-only, then said so", async () => {
  const f = fake({ bulkFails: true });
  const r = await go(f, ["--apply"], prompts(values3()));
  assert.equal(r.code, 1);
  assert.match(r.text, /Verifying read-only/);
  assert.match(r.text, /Verified read-only: no new version exists/);
  assert.match(r.text, /live deployment is unchanged/);
  noPromotion(f);
});

test("nonzero wrangler exit but a version WAS created: reports its id and recovery, never claims none", async () => {
  const f = fake({ bulkFails: true, createOnFail: true });
  const r = await go(f, ["--apply"], prompts(values3()));
  assert.equal(r.code, 1);
  assert.ok(r.text.includes("1 NEW VERSION(S) EXIST"));
  assert.match(r.text, /new-version-1/);
  assert.match(r.text, /NOT promoted/);
  assert.doesNotMatch(r.text, /no new version exists/);
  noPromotion(f);
});

test("nonzero wrangler exit and the check itself cannot read: refuses to claim anything", async () => {
  const f = fake({ bulkFails: true, readsFailAfterWrite: true });
  const r = await go(f, ["--apply"], prompts(values3()));
  assert.equal(r.code, 1);
  assert.match(r.text, /COULD NOT VERIFY/);
  assert.doesNotMatch(r.text, /no new version exists/);
  noPromotion(f);
});

test("postflight failure after a successful upload: reports the new version id and safe recovery, no retry, no promotion", async () => {
  const f = fake({ mutate: (s) => { s.views["new-version-1"].resources.bindings = s.views["new-version-1"].resources.bindings.filter((b) => b.name !== "RESEND_API_KEY"); } });
  const r = await go(f, ["--apply"], prompts(values3()));
  assert.equal(r.code, 1);
  assert.match(r.text, /POSTFLIGHT PROBLEMS after a successful upload/);
  assert.ok(r.text.includes("New version id(s): new-version-1"));
  assert.match(r.text, /will NOT retry/);
  assert.match(r.text, /wrangler deployments status/);
  noPromotion(f);
});

test("an error thrown during postflight still reports the verification and the new version id", async () => {
  const f = fake({ viewFailsForNew: true });
  const r = await go(f, ["--apply"], prompts(values3()));
  assert.equal(r.code, 1);
  assert.match(r.text, /unexpected error occurred after the write began/);
  assert.match(r.text, /new-version-1/);
  noPromotion(f);
});
