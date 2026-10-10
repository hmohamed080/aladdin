import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateProjectGate, main, selectDeployment, selectPreviousProduction } from "./vercel-deploy.mjs";

const PROJECT = "prj_staging";
const SHA = "236dd48756e1132bfaaeff55c441287625076f2f";
const dep = (over = {}) => ({
  uid: "dpl_1",
  url: "aladdin-staging-abc.vercel.app",
  projectId: PROJECT,
  target: "production",
  readyState: "READY",
  readySubstate: "STAGED",
  created: 100,
  meta: { githubCommitSha: SHA, githubCommitRef: "main" },
  ...over,
});
const pick = (list, over = {}) => selectDeployment(list, { projectId: PROJECT, sha: SHA, ...over });

test("a READY, staged production deployment of exactly this commit is selected", () => {
  const out = pick([dep()]);
  assert.equal(out.status, "ready-staged");
  assert.equal(out.deployment.uid, "dpl_1");
});

test("never promotes 'latest by assumption': another commit's deployment is ignored", () => {
  const other = dep({ uid: "dpl_other", created: 999, meta: { githubCommitSha: "a".repeat(40), githubCommitRef: "main" } });
  const out = pick([other, dep()]);
  assert.equal(out.deployment.uid, "dpl_1", "the newer deployment of a different commit is not chosen");
  assert.equal(pick([other]).status, "none");
});

test("a SHA prefix is not a match", () => {
  assert.equal(pick([dep({ meta: { githubCommitSha: SHA.slice(0, 12), githubCommitRef: "main" } })]).status, "none");
});

test("SHA comparison ignores case only", () => {
  assert.equal(pick([dep({ meta: { githubCommitSha: SHA.toUpperCase(), githubCommitRef: "main" } })]).status, "ready-staged");
});

test("another project's deployment is never chosen", () => {
  assert.equal(pick([dep({ projectId: "prj_other" })]).status, "none");
});

test("preview deployments are never chosen, even for the same commit", () => {
  assert.equal(pick([dep({ target: null })]).status, "none");
  assert.equal(pick([dep({ target: "staging" })]).status, "none");
});

test("another branch's deployment is never chosen", () => {
  assert.equal(pick([dep({ meta: { githubCommitSha: SHA, githubCommitRef: "feature/x" } })]).status, "none");
  assert.equal(pick([dep({ meta: { githubCommitSha: SHA } })]).status, "ready-staged", "branch not reported: the exact SHA still has to match");
});

test("only READY is promotable; a build in progress means wait; an ended build means stop", () => {
  assert.equal(pick([dep({ readyState: "BUILDING", readySubstate: undefined })]).status, "pending");
  assert.equal(pick([dep({ readyState: "QUEUED" })]).status, "pending");
  assert.equal(pick([dep({ readyState: "ERROR" })]).status, "failed");
  assert.equal(pick([dep({ readyState: "CANCELED" })]).status, "failed");
  assert.equal(pick([]).status, "none");
  assert.equal(pick(undefined).status, "none");
});

test("a failed build does not hide a good rebuild of the same commit; the newest READY wins", () => {
  const out = pick([dep({ uid: "dpl_err", readyState: "ERROR", created: 300 }), dep({ uid: "dpl_old", created: 100 }), dep({ uid: "dpl_new", created: 200 })]);
  assert.equal(out.deployment.uid, "dpl_new");
});

test("an already-promoted deployment is reported as such (idempotent re-run)", () => {
  assert.equal(pick([dep({ readySubstate: "PROMOTED" })]).status, "ready-promoted");
});

test("a missing or short SHA is refused", () => {
  assert.throws(() => selectDeployment([dep()], { projectId: PROJECT, sha: "abc123" }), /40-character/);
  assert.throws(() => selectDeployment([dep()], { projectId: PROJECT, sha: undefined }), /40-character/);
  assert.throws(() => selectDeployment([dep()], { projectId: "", sha: SHA }), /projectId/);
});

test("project gate: only an explicit autoAssignCustomDomains=false is accepted", () => {
  assert.equal(evaluateProjectGate({ id: PROJECT, autoAssignCustomDomains: false }, { projectId: PROJECT }).ok, true);
  const on = evaluateProjectGate({ id: PROJECT, autoAssignCustomDomains: true }, { projectId: PROJECT });
  assert.equal(on.ok, false);
  assert.match(on.message, /Owner action required/);
  assert.match(on.message, /Auto-assign Custom Production Domains/);
  const unknown = evaluateProjectGate({ id: PROJECT }, { projectId: PROJECT });
  assert.equal(unknown.ok, false);
  assert.match(unknown.message, /Cannot confirm/);
  assert.equal(evaluateProjectGate({ id: "prj_other", autoAssignCustomDomains: false }, { projectId: PROJECT }).ok, false);
  assert.equal(evaluateProjectGate(null, { projectId: PROJECT }).ok, false);
});

// ---- main(): the API wiring, with a fake fetch and no network ------------------------------------------------------
const env = (over = {}) => {
  const saved = { ...process.env };
  Object.assign(process.env, { VERCEL_TOKEN: "tok_SECRET_VALUE", VERCEL_ORG_ID: "team_1", VERCEL_PROJECT_ID: PROJECT }, over);
  return () => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  };
};
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

test("main find-deployment: waits for the build, then returns the exact deployment; token and ids never logged", async () => {
  const restore = env();
  try {
    const calls = [];
    const answers = [
      { deployments: [dep({ readyState: "BUILDING", readySubstate: undefined })] },
      { deployments: [dep({ uid: "dpl_ready" })] },
    ];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      return reply(200, answers.shift());
    };
    const logs = [];
    const code = await main(["find-deployment", "--sha", SHA, "--interval-sec", "0", "--timeout-min", "1"], { fetchImpl, log: (l) => logs.push(l) });
    assert.equal(code, 0);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /\/v7\/deployments\?/);
    assert.match(calls[0], /projectId=prj_staging/);
    assert.match(calls[0], /teamId=team_1/);
    assert.match(calls[0], /target=production/);
    assert.match(calls[0], new RegExp(`sha=${SHA}`));
    assert.ok(logs.some((l) => /Found READY deployment dpl_ready/.test(l)));
    assert.ok(!logs.join("\n").includes("tok_SECRET_VALUE"), "the token is never logged");
  } finally {
    restore();
  }
});

test("main find-deployment: refuses when the only deployment for the commit failed to build", async () => {
  const restore = env();
  try {
    const fetchImpl = async () => reply(200, { deployments: [dep({ readyState: "ERROR" })] });
    const logs = [];
    assert.equal(await main(["find-deployment", "--sha", SHA, "--interval-sec", "0"], { fetchImpl, log: (l) => logs.push(l) }), 1);
    assert.match(logs.join("\n"), /No promotable deployment/);
  } finally {
    restore();
  }
});

test("main find-deployment: times out instead of waiting forever", async () => {
  const restore = env();
  try {
    const fetchImpl = async () => reply(200, { deployments: [] });
    const logs = [];
    const code = await main(["find-deployment", "--sha", SHA, "--interval-sec", "0", "--timeout-min", "0"], { fetchImpl, log: (l) => logs.push(l) });
    assert.equal(code, 1);
    assert.match(logs.join("\n"), /Timed out/);
  } finally {
    restore();
  }
});

test("main: API failures and bad configuration are errors (exit 2) that do not leak secrets", async () => {
  let restore = env();
  try {
    const logs = [];
    assert.equal(await main(["find-deployment", "--sha", SHA], { fetchImpl: async () => reply(403, {}), log: (l) => logs.push(l) }), 2);
    assert.match(logs.join("\n"), /HTTP 403/);
    assert.ok(!logs.join("\n").includes("tok_SECRET_VALUE"));
    assert.equal(await main(["find-deployment"], { fetchImpl: async () => reply(200, {}), log: () => {} }), 2, "--sha required");
    assert.equal(await main(["nonsense"], { fetchImpl: async () => reply(200, {}), log: () => {} }), 2);
  } finally {
    restore();
  }
  restore = env({ VERCEL_PROJECT_ID: "" });
  try {
    assert.equal(await main(["check-project"], { fetchImpl: async () => reply(200, {}), log: () => {} }), 2, "no implicit project");
  } finally {
    restore();
  }
});

test("main check-project: fails while auto-promotion is on, passes when off, report-only never fails", async () => {
  const restore = env();
  try {
    const project = (v) => async () => reply(200, { id: PROJECT, autoAssignCustomDomains: v });
    assert.equal(await main(["check-project"], { fetchImpl: project(true), log: () => {} }), 1);
    assert.equal(await main(["check-project"], { fetchImpl: project(false), log: () => {} }), 0);
    assert.equal(await main(["check-project"], { fetchImpl: project(undefined), log: () => {} }), 1);
    assert.equal(await main(["check-project", "--report-only"], { fetchImpl: project(true), log: () => {} }), 0);
  } finally {
    restore();
  }
});

test("previous production: the newest PROMOTED deployment other than the new one, same project, production only", () => {
  const promoted = (uid, created, over = {}) => dep({ uid, created, readySubstate: "PROMOTED", ...over });
  const list = [
    promoted("dpl_new", 500),
    promoted("dpl_prev", 400),
    promoted("dpl_older", 300),
    promoted("dpl_other_project", 450, { projectId: "prj_other" }),
    promoted("dpl_preview", 460, { target: null }),
    dep({ uid: "dpl_staged", created: 470, readySubstate: "STAGED" }),
  ];
  assert.equal(selectPreviousProduction(list, { projectId: PROJECT, excludeId: "dpl_new" }).uid, "dpl_prev");
  assert.equal(selectPreviousProduction([], { projectId: PROJECT, excludeId: "x" }), null);
  assert.equal(selectPreviousProduction(undefined, { projectId: PROJECT, excludeId: "x" }), null);
});

test("main previous-production never fails the deployment, even when the API does", async () => {
  const restore = env();
  try {
    const logs = [];
    assert.equal(await main(["previous-production", "--exclude", "dpl_new"], { fetchImpl: async () => reply(500, {}), log: (l) => logs.push(l) }), 0);
    assert.match(logs.join("\n"), /continuing/);
    const ok = async () => reply(200, { deployments: [dep({ uid: "dpl_prev", readySubstate: "PROMOTED" })] });
    const out = [];
    assert.equal(await main(["previous-production", "--exclude", "dpl_new"], { fetchImpl: ok, log: (l) => out.push(l) }), 0);
    assert.match(out.join("\n"), /Previously promoted production deployment: dpl_prev/);
  } finally {
    restore();
  }
});
