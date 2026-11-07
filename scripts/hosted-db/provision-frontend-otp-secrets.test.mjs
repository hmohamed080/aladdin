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

// ---- Regression: the P-4 production run reported assets.html_handling / not_found_handling as absent -> documented defaults ----
import { ASSET_DEFAULTS, checkExistingVersion, normalizeRuntime } from "./provision-frontend-otp-secrets.mjs";

const RT_ABSENT = { compatibility_date: "2026-10-01", compatibility_flags: ["nodejs_compat"], assets: { binding: "ASSETS" } };
const RT_DEFAULTS = { ...RT_ABSENT, assets: { binding: "ASSETS", html_handling: "auto-trailing-slash", not_found_handling: "none" } };
const withRuntime = (rt) => { const a = goodAfter(); a.newView.resources.script_runtime = rt; return a; };
const baselineWith = (rt) => ({ resources: { bindings: LIVE_BINDINGS, script_runtime: rt } });

test("the documented defaults are exactly these two keys", () => {
  assert.deepEqual(ASSET_DEFAULTS, { html_handling: "auto-trailing-slash", not_found_handling: "none" });
});

test("absent asset handling equals the documented defaults, in either direction", () => {
  assert.deepEqual(normalizeRuntime(RT_ABSENT), normalizeRuntime(RT_DEFAULTS));
  const after = withRuntime(RT_DEFAULTS);
  assert.deepEqual(checkPostflight({ before: beforeState, after, baseline: baselineWith(RT_ABSENT) }), []);
  const rev = withRuntime(RT_ABSENT);
  assert.deepEqual(checkPostflight({ before: beforeState, after: rev, baseline: baselineWith(RT_DEFAULTS) }), []);
  const noAssets = { compatibility_date: "2026-10-01", compatibility_flags: ["nodejs_compat"] };
  assert.deepEqual(checkPostflight({ before: beforeState, after: withRuntime(noAssets), baseline: baselineWith(noAssets) }), []);
});

test("an EXPLICIT non-default asset value is still a change", () => {
  for (const assets of [
    { binding: "ASSETS", html_handling: "force-trailing-slash", not_found_handling: "none" },
    { binding: "ASSETS", html_handling: "none", not_found_handling: "none" },
    { binding: "ASSETS", html_handling: "auto-trailing-slash", not_found_handling: "404-page" },
    { binding: "ASSETS", html_handling: "auto-trailing-slash", not_found_handling: "single-page-application" },
  ]) {
    const p = checkPostflight({ before: beforeState, after: withRuntime({ ...RT_ABSENT, assets }), baseline: baselineWith(RT_ABSENT) });
    assert.match(p.join(), /script_runtime/, JSON.stringify(assets));
  }
});

test("only those two keys are normalized: any other runtime difference still fails", () => {
  for (const rt of [
    { ...RT_DEFAULTS, compatibility_date: "2030-01-01" },
    { ...RT_DEFAULTS, compatibility_flags: [] },
    { ...RT_DEFAULTS, assets: { ...RT_DEFAULTS.assets, binding: "OTHER" } },
    { ...RT_DEFAULTS, assets: { ...RT_DEFAULTS.assets, run_worker_first: true } },
    { ...RT_DEFAULTS, usage_model: "unbound" },
  ]) {
    assert.match(checkPostflight({ before: beforeState, after: withRuntime(rt), baseline: baselineWith(RT_ABSENT) }).join(), /script_runtime/, JSON.stringify(rt));
  }
});

test("a different script code identity (etag or handlers) is refused", () => {
  const live = { resources: { bindings: LIVE_BINDINGS, script_runtime: RT_ABSENT, script: { etag: "e1", handlers: ["fetch"] } } };
  const a = goodAfter(); a.newView.resources.script_runtime = RT_DEFAULTS; a.newView.resources.script = { etag: "e1", handlers: ["fetch"] };
  assert.deepEqual(checkPostflight({ before: beforeState, after: a, baseline: live }), []);
  a.newView.resources.script = { etag: "e2", handlers: ["fetch"] };
  assert.match(checkPostflight({ before: beforeState, after: a, baseline: live }).join(), /code identity/);
  a.newView.resources.script = { etag: "e1", handlers: ["fetch", "scheduled"] };
  assert.match(checkPostflight({ before: beforeState, after: a, baseline: live }).join(), /code identity/);
});

// ---- Read-only verification of an already created version ----
const CAND = "3fc37397-9157-4fa6-8fce-d32dffe0a194";
const withCandidate = (over = {}) => {
  const f = fake();
  f.state.views[LIVE_VERSION].resources.script_runtime = RT_ABSENT;
  f.state.versions = [...f.state.versions, { id: CAND, number: 12 }];
  f.state.views[CAND] = { resources: { bindings: [...LIVE_BINDINGS, ...NEW_NAMES.map((name) => ({ name, type: "secret_text" }))], script_runtime: RT_DEFAULTS } };
  over.after?.(f.state);
  return f;
};
const verify = (f, arg = `--verify-version=${CAND}`) => go(f, [arg], async () => { throw new Error("must not prompt"); });
const onlyReads = (f) => {
  for (const c of f.state.calls) {
    assert.ok(!c.args.includes("bulk") && !c.args.includes("deploy") && !c.args.includes("rollback") && !c.args.includes("put") && !c.args.includes("delete"), c.args.join(" "));
    assert.ok(!c.hasInput, "no stdin");
  }
};

test("--verify-version verifies an existing version read-only (the real P-4 shape passes)", async () => {
  const f = withCandidate();
  const r = await verify(f);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /VERIFIED \(read-only\)/);
  assert.match(r.text, /NOT deployed/);
  onlyReads(f);
});

test("--verify-version refuses: candidate deployed, another newer version, live not alone, lost binding, unknown id", async () => {
  const deployedCand = withCandidate({ after: (s) => { s.deployment = { id: "d", versions: [{ version_id: CAND, percentage: 100 }] }; } });
  assert.equal((await verify(deployedCand)).code, 1);
  const two = withCandidate({ after: (s) => { s.versions.push({ id: "another", number: 13 }); } });
  assert.match((await verify(two)).text, /versions newer than the live one/);
  const split = withCandidate({ after: (s) => { s.deployment = { id: "d", versions: [{ version_id: LIVE_VERSION, percentage: 90 }, { version_id: CAND, percentage: 10 }] }; } });
  assert.equal((await verify(split)).code, 1);
  const lost = withCandidate({ after: (s) => { s.views[CAND].resources.bindings = s.views[CAND].resources.bindings.filter((b) => b.name !== "RESEND_API_KEY"); } });
  assert.match((await verify(lost)).text, /RESEND_API_KEY was LOST/);
  const unknown = withCandidate();
  assert.equal((await verify(unknown, "--verify-version=00000000-0000-0000-0000-000000000000")).code, 1);
  for (const f of [deployedCand, two, split, lost]) onlyReads(f);
});

test("--verify-version needs a full uuid and cannot be combined with --apply", async () => {
  const f = withCandidate();
  assert.equal((await go(f, ["--verify-version=3fc37397"], async () => "x")).code, 2);
  assert.equal((await go(f, ["--apply", `--verify-version=${CAND}`], async () => "x")).code, 2);
  assert.equal(f.state.calls.length, 0, "refused before any call");
});

test("checkExistingVersion is pure: ok for baseline + four names with normalized defaults", () => {
  const f = withCandidate();
  assert.deepEqual(checkExistingVersion({ id: CAND, deployment: f.state.deployment, versions: f.state.versions, baseline: f.state.views[LIVE_VERSION], nv: f.state.views[CAND] }), []);
});

import { safeWranglerEnv, spawnWrangler } from "./provision-frontend-otp-secrets.mjs";

test("the wrangler child always gets safe logging settings, even if the owner's shell sets unsafe ones", () => {
  const e = safeWranglerEnv({ WRANGLER_LOG_SANITIZE: "false", WRANGLER_LOG: "debug", WRANGLER_SEND_METRICS: "true", KEEP: "1" });
  assert.equal(e.WRANGLER_LOG_SANITIZE, "true");
  assert.equal(e.WRANGLER_LOG, "log");
  assert.equal(e.WRANGLER_SEND_METRICS, "false");
  assert.equal(e.KEEP, "1");
  let seen;
  spawnWrangler(["versions", "secret", "bulk"], { input: "x" }, (cmd, args, o) => { seen = o; return { status: 0 }; }, { WRANGLER_LOG_SANITIZE: "false" });
  assert.equal(seen.env.WRANGLER_LOG_SANITIZE, "true");
  assert.equal(seen.input, "x");
});
