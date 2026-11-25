import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAllowed, OperatorError, parseArgs, run } from "./marketplace-timers.mjs";

const local = { SUPABASE_URL: "http://127.0.0.1:59421", SUPABASE_SERVICE_ROLE_KEY: "k-local" };
const acceptance = { SUPABASE_URL: "https://nxossqhdfltcqdwvbewi.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k-acc" };
const production = { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k-prod" };

test("arguments: run needs an explicit project, bounded limit and a real ISO time", () => {
  assert.deepEqual(parseArgs(["run", "--project", "local"]), { command: "run", project: "local", limit: 200, now: null, execute: false });
  assert.equal(parseArgs(["run", "--project", "local", "--limit", "5", "--execute"]).limit, 5);
  assert.equal(parseArgs(["run", "--project", "local", "--now", "2026-12-01T10:00:00Z"]).now, "2026-12-01T10:00:00.000Z");
  assert.equal(parseArgs([]).command, "help");
  for (const bad of [["go"], ["run"], ["run", "--project", "local", "--limit", "0"], ["run", "--project", "local", "--limit", "501"],
    ["run", "--project", "local", "--now", "yesterday"], ["run", "--project", "local", "--bogus"], ["run", "--project"]]) {
    assert.throws(() => parseArgs(bad), OperatorError);
  }
});

test("a dry run calls nothing", async () => {
  const fetcher = async () => { throw new Error("must not be called"); };
  const r = await run(parseArgs(["run", "--project", "local"]), local, fetcher);
  assert.equal(r.dryRun, true);
});

test("an executed run sends the limit and the simulated time and returns counts only", async () => {
  let seen;
  const fetcher = async (url, init) => { seen = { url, body: JSON.parse(init.body), headers: init.headers };
    return { ok: true, status: 200, json: async () => ({ processed: 2, reminders: 1, cancelled: 1, errors: 0, secret: "x" }) }; };
  const r = await run(parseArgs(["run", "--project", "local", "--now", "2026-12-01T10:00:00Z", "--limit", "7", "--execute"]), local, fetcher);
  assert.equal(seen.url, "http://127.0.0.1:59421/rest/v1/rpc/marketplace_timers_run");
  assert.deepEqual(seen.body, { p_limit: 7, p_now: "2026-12-01T10:00:00.000Z" });
  assert.deepEqual(r, { project: "local", dryRun: false, processed: 2, reminders: 1, cancelled: 1, errors: 0 });
});

test("a failed call reports the status only", async () => {
  const fetcher = async () => ({ ok: false, status: 500, json: async () => ({ message: "secret detail" }) });
  await assert.rejects(run(parseArgs(["run", "--project", "local", "--execute"]), local, fetcher), (e) => e instanceof OperatorError && e.message === "Timers run failed (HTTP 500)");
});

test("the project must match the configured environment", () => {
  assert.throws(() => assertAllowed(parseArgs(["run", "--project", "nxossqhdfltcqdwvbewi"]), local), OperatorError);
});

test("simulated time is allowed on local and Acceptance, refused on production", () => {
  const opts = (project) => parseArgs(["run", "--project", project, "--now", "2026-12-01T10:00:00Z", "--execute"]);
  assert.doesNotThrow(() => assertAllowed(opts("local"), local, undefined));
  assert.doesNotThrow(() => assertAllowed(opts("nxossqhdfltcqdwvbewi"), acceptance, undefined));
  assert.throws(() => assertAllowed(opts("abcdefghijklmnopqrst"), production, "abcdefghijklmnopqrst"), OperatorError);
});

test("executing on a hosted project other than Acceptance needs the explicit approval variable", () => {
  const opts = parseArgs(["run", "--project", "abcdefghijklmnopqrst", "--execute"]);
  assert.throws(() => assertAllowed(opts, production, undefined), OperatorError);
  assert.throws(() => assertAllowed(opts, production, "someotherproject"), OperatorError);
  assert.doesNotThrow(() => assertAllowed(opts, production, "abcdefghijklmnopqrst"));
  assert.doesNotThrow(() => assertAllowed(parseArgs(["run", "--project", "abcdefghijklmnopqrst"]), production, undefined)); // dry run
});
