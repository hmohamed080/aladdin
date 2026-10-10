import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Structural tests of .github/workflows/deploy-staging.yml (no YAML library: the file's layout is regular).
 *
 * The workflow's WRITE steps (`supabase db push --yes`, `vercel promote`, and everything that depends on them) are
 * conditioned on the answers of three freshness checks. These tests evaluate the workflow's real `if:` conditions for every
 * way a run can be superseded, and assert that the two writes cannot run after their own freshness check says "superseded".
 */
const WORKFLOW = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "deploy-staging.yml"), "utf8");

function parseSteps(text) {
  const body = text.slice(text.indexOf("\n    steps:\n") + "\n    steps:\n".length);
  const blocks = [];
  let current = null;
  for (const line of body.split("\n")) {
    if (/^ {6}- /.test(line)) {
      current = [line];
      blocks.push(current);
    } else if (current) current.push(line);
  }
  return blocks.map((lines) => {
    const block = lines.join("\n");
    const field = (key) => new RegExp(`^ {6}(?:- )?${key}: (.*)$|^ {8}${key}: (.*)$`, "m").exec(block)?.slice(1).find(Boolean);
    const runMatch = /^ {8}run: \|\n((?:(?: {10}.*)?\n?)*)/m.exec(block);
    const run = runMatch ? runMatch[1] : (field("run") ?? "");
    return { name: field("name") ?? field("uses") ?? "", id: field("id"), if: field("if"), run, block };
  });
}

const STEPS = parseSteps(WORKFLOW);
const byId = (id) => {
  const step = STEPS.find((s) => s.id === id);
  assert.ok(step, `step with id ${id} exists`);
  return step;
};

/** The subset of GitHub's expression language the workflow uses: `a == 'x' && b != 'y'`, over steps.<id>.outputs.<name>. */
function evalIf(expr, outputs) {
  if (expr === undefined) return true; // no condition: runs (previous steps succeeded)
  return expr.split("&&").every((raw) => {
    const m = /^\s*steps\.([a-z_]+)\.outputs\.([a-z_]+)\s*(==|!=)\s*'([^']*)'\s*$/.exec(raw);
    assert.ok(m, `unsupported condition term: ${raw.trim()}`);
    const actual = outputs[`${m[1]}.${m[2]}`] ?? ""; // an unset output is the empty string
    return m[3] === "==" ? actual === m[4] : actual !== m[4];
  });
}

/** Run the job's steps in order with the given answers; return which of them executed. */
function simulate({ deploy, fresh, freshMigrate, freshPromote, alreadyPromoted = "false", configured = "true" }) {
  const answers = { fresh, fresh_migrate: freshMigrate, fresh_promote: freshPromote };
  const outputs = { "gate.deploy": String(deploy), "preflight.configured": configured, "vercel.already_promoted": alreadyPromoted };
  const ran = new Set();
  for (const step of STEPS) {
    if (!step.if || step.if.includes("failure()")) {
      if (step.if) continue; // the rollback-instruction step only runs after a smoke failure
    }
    if (!evalIf(step.if, outputs)) continue;
    ran.add(step.id ?? step.name);
    if (step.id in answers && answers[step.id] !== undefined) outputs[`${step.id}.current`] = String(answers[step.id]);
  }
  return ran;
}

const WRITES = ["migrate", "verify", "vercel", "previous", "fresh_promote", "promote", "smoke"];
const WRITE_NAMES = ["Install the smoke browser"];
const didRun = (ran, ...ids) => ids.filter((id) => ran.has(id));

test("the three freshness checks exist, use ONE helper, and the workflow has no inline git ls-remote", () => {
  const stages = { fresh: "initial", fresh_migrate: "pre-migrate", fresh_promote: "pre-promote" };
  for (const [id, stage] of Object.entries(stages)) {
    assert.ok(byId(id).run.includes(`node scripts/main-head-check.mjs --stage ${stage} --sha "$COMMIT_SHA"`), id);
    assert.match(byId(id).block, /COMMIT_SHA: \$\{\{ github\.sha \}\}/, `${id} compares against the full triggering SHA`);
  }
  assert.ok(!/ls-remote/.test(STEPS.map((s) => s.run).join("\n")), "no fragile inline head check remains in the workflow");
  assert.equal(STEPS.filter((s) => s.run.includes("main-head-check.mjs")).length, 3);
});

test("the freshness check sits IMMEDIATELY before each write", () => {
  const index = (id) => STEPS.findIndex((s) => s.id === id);
  assert.equal(index("fresh_migrate") + 1, index("migrate"), "pre-migrate check is the step right before `db push`");
  assert.equal(index("fresh_promote") + 1, index("promote"), "pre-promote check is the step right before `vercel promote`");
});

test("`supabase db push --yes` and `vercel promote` each exist exactly once, behind their own freshness answer", () => {
  const dbPushWrites = STEPS.filter((s) => /db push --linked --yes/.test(s.run));
  assert.equal(dbPushWrites.length, 1);
  assert.equal(dbPushWrites[0].id, "migrate");
  assert.ok(dbPushWrites[0].if.includes("steps.fresh_migrate.outputs.current == 'true'"));
  assert.ok(dbPushWrites[0].if.includes("steps.gate.outputs.deploy == 'true'"));

  const promotes = STEPS.filter((s) => /vercel@\S+"? promote|\bpromote "\$DEPLOYMENT_URL"/.test(s.run));
  assert.equal(promotes.length, 1);
  assert.equal(promotes[0].id, "promote");
  assert.ok(promotes[0].if.includes("steps.fresh_promote.outputs.current == 'true'"));
  assert.ok(promotes[0].if.includes("steps.gate.outputs.deploy == 'true'"));
});

test("forbidden commands never appear in the workflow", () => {
  const code = WORKFLOW.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  for (const forbidden of ["--include-all", "migration repair", "db reset"]) assert.ok(!code.includes(forbidden), forbidden);
});

test("everything current, deploy mode: the full path runs", () => {
  const ran = simulate({ deploy: true, fresh: true, freshMigrate: true, freshPromote: true });
  for (const id of WRITES) assert.ok(ran.has(id), `${id} runs`);
  assert.ok(ran.has("Install the smoke browser"));
});

test("superseded at the initial check: no database write, no promotion, nothing after it", () => {
  const ran = simulate({ deploy: true, fresh: false });
  assert.deepEqual(didRun(ran, ...WRITES, "fresh_migrate"), []);
  assert.ok(!ran.has("Install the smoke browser"));
});

test("superseded BEFORE the migration: `db push --yes` and everything after it are skipped", () => {
  const ran = simulate({ deploy: true, fresh: true, freshMigrate: false });
  assert.ok(ran.has("fresh_migrate"), "the check itself ran");
  assert.deepEqual(didRun(ran, ...WRITES), [], "no migrate, verify, deployment lookup, promotion or smoke");
  assert.ok(!ran.has("Install the smoke browser"));
});

test("superseded AFTER the migration: the migration ran, but `vercel promote` and the smoke are skipped", () => {
  const ran = simulate({ deploy: true, fresh: true, freshMigrate: true, freshPromote: false });
  assert.deepEqual(didRun(ran, "migrate", "verify", "vercel", "previous", "fresh_promote"), ["migrate", "verify", "vercel", "previous", "fresh_promote"]);
  assert.deepEqual(didRun(ran, "promote", "smoke"), [], "no promotion and no smoke of an unpromoted deployment");
  assert.ok(!ran.has("Install the smoke browser"));
});

test("plan mode (switch off): not one write step can run, whatever the freshness answers say", () => {
  for (const fresh of [true, false]) {
    for (const freshMigrate of [true, false]) {
      for (const freshPromote of [true, false]) {
        const ran = simulate({ deploy: false, fresh, freshMigrate, freshPromote });
        assert.deepEqual(didRun(ran, ...WRITES, "fresh_migrate"), []);
      }
    }
  }
});

test("a freshness step that could not answer (its output never set) leaves every later write skipped", () => {
  // fresh_migrate ran but failed closed -> the job fails; even if it were continue-on-error the output is empty:
  const ran = simulate({ deploy: true, fresh: true, freshMigrate: undefined });
  assert.deepEqual(didRun(ran, ...WRITES), []);
  const ran2 = simulate({ deploy: true, fresh: true, freshMigrate: true, freshPromote: undefined });
  assert.deepEqual(didRun(ran2, "promote", "smoke"), []);
});

test("already promoted (idempotent re-run): no second promote, the smoke still runs", () => {
  const ran = simulate({ deploy: true, fresh: true, freshMigrate: true, freshPromote: true, alreadyPromoted: "true" });
  assert.ok(!ran.has("promote"));
  assert.ok(ran.has("smoke"));
});

test("exhaustive: over every combination of answers, a write never runs after its own check says superseded", () => {
  const vals = [true, false, undefined];
  for (const deploy of [true, false]) {
    for (const fresh of vals) for (const fm of vals) for (const fp of vals) {
      const ran = simulate({ deploy, fresh, freshMigrate: fm, freshPromote: fp });
      if (ran.has("migrate")) assert.ok(deploy && fm === true && fresh === true, `migrate ran with deploy=${deploy} fresh=${fresh} fm=${fm}`);
      if (ran.has("promote")) assert.ok(deploy && fp === true && fm === true && fresh === true, `promote ran with deploy=${deploy} fresh=${fresh} fm=${fm} fp=${fp}`);
      for (const id of ["verify", "vercel", "previous"]) if (ran.has(id)) assert.ok(fm === true, `${id} ran after a non-current pre-migrate check`);
      if (ran.has("smoke")) assert.ok(fp === true, "smoke ran after a non-current pre-promote check");
    }
  }
});

test("the parser really sees the workflow (guards against silently testing nothing)", () => {
  assert.ok(STEPS.length >= 20, `parsed ${STEPS.length} steps`);
  for (const id of ["gate", "fresh", "preflight", "fresh_migrate", "migrate", "verify", "vercel", "previous", "fresh_promote", "promote", "smoke"]) byId(id);
  assert.ok(WRITE_NAMES.every((n) => STEPS.some((s) => s.name === n)));
});
