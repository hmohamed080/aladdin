import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkFollowups, parseFollowups, FOLLOWUPS_FILE } from "./release-followups-guard.mjs";

const PROPOSAL = "supabase/proposals/contract_20261031090001_retire_registration_phone_challenges.sql";
const READINESS = "supabase/proposals/readiness_check_legacy_phone_challenges.sql";

const entry = (over = {}) => ({
  id: "RF-001", title: "t", status: "OPEN", mandatory: true, proposal: PROPOSAL, readiness_check: READINESS, issue: 135,
  production_activated_on: null, due_days_after_activation: 14, hard_due_on: "2026-12-31", closed_by: null, ...over,
});

/** Builds a throwaway repo layout and returns its root. */
function repo({ entries = [entry()], proposals = [PROPOSAL, READINESS], migrations = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "followups-"));
  const put = (rel, body = "-- x\n") => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
  put(FOLLOWUPS_FILE, "# x\n<!-- followups:begin -->\n```json\n" + JSON.stringify(entries) + "\n```\n<!-- followups:end -->\n");
  for (const p of proposals) put(p);
  fs.mkdirSync(path.join(root, "supabase/migrations"), { recursive: true });
  for (const m of migrations) put("supabase/migrations/" + m);
  return root;
}
const run = (opts, today = "2026-11-10") => checkFollowups({ root: repo(opts), today });
const has = (r, re) => r.errors.some((e) => re.test(e));

test("a tracked, open, not-yet-due follow-up passes", () => {
  assert.deepEqual(run({}).errors, []);
});

test("a contract proposal with no entry cannot exist (untracked contract step)", () => {
  const r = run({ entries: [], proposals: [PROPOSAL] });
  assert.ok(has(r, /no entry in docs\/operations\/RELEASE_FOLLOWUPS\.md/));
});

test("a mandatory follow-up must link its GitHub issue", () => {
  assert.ok(has(run({ entries: [entry({ issue: null })] }), /must link its GitHub issue/));
});

test("an OPEN follow-up becomes OVERDUE after production_activated_on + due_days (and not a day earlier)", () => {
  const e = entry({ production_activated_on: "2026-11-01", due_days_after_activation: 14 });
  assert.deepEqual(run({ entries: [e] }, "2026-11-15").errors, [], "due date itself is still allowed");
  assert.ok(has(run({ entries: [e] }, "2026-11-16"), /OVERDUE/));
  assert.deepEqual(run({ entries: [entry({ hard_due_on: "2099-12-31" })] }, "2030-01-01").errors, [], "no activation date recorded and the backstop not reached: not overdue yet");
});

test("the hard backstop fails even when the Production activation date was never recorded, and is mandatory", () => {
  assert.deepEqual(run({}, "2026-12-31").errors, [], "the deadline day itself is allowed");
  assert.ok(has(run({}, "2027-01-01"), /OVERDUE \(hard deadline\)/));
  assert.ok(has(run({ entries: [entry({ hard_due_on: null })] }), /needs hard_due_on/));
  assert.ok(has(run({ entries: [entry({ hard_due_on: "soon" })] }), /hard_due_on/));
});

test("the contract must not appear in supabase/migrations while the follow-up is OPEN (premature DROP)", () => {
  const r = run({ migrations: ["20261120090001_retire_registration_phone_challenges.sql"] });
  assert.ok(has(r, /premature DROP/));
});

test("DONE requires closed_by to name an existing migration and the proposal to be gone", () => {
  const done = entry({ status: "DONE", closed_by: "20261120090001_retire_registration_phone_challenges.sql" });
  assert.deepEqual(run({ entries: [done], proposals: [READINESS], migrations: [done.closed_by] }).errors, []);
  assert.ok(has(run({ entries: [done], proposals: [READINESS], migrations: [] }), /existing migration/));
  assert.ok(has(run({ entries: [done], proposals: [PROPOSAL, READINESS], migrations: [done.closed_by] }), /still in supabase\/proposals/));
});

test("bad dates, ids and statuses are refused", () => {
  assert.ok(has(run({ entries: [entry({ production_activated_on: "11/01/2026" })] }), /YYYY-MM-DD/));
  assert.ok(has(run({ entries: [entry({ production_activated_on: "2026-02-30" })] }), /YYYY-MM-DD/));
  assert.ok(has(run({ entries: [entry({ status: "WAIVED" })] }), /OPEN or DONE/));
  assert.ok(has(run({ entries: [entry(), entry()] }), /duplicated/));
  assert.ok(has(run({ entries: [entry({ due_days_after_activation: 0 })] }), /positive integer/));
});

test("a missing or malformed tracking file fails closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "followups-"));
  assert.ok(checkFollowups({ root, today: "2026-11-10" }).errors[0].includes("missing"));
  fs.mkdirSync(path.join(root, "docs/operations"), { recursive: true });
  fs.writeFileSync(path.join(root, FOLLOWUPS_FILE), "no block here");
  assert.ok(checkFollowups({ root, today: "2026-11-10" }).errors[0].includes("followups:begin"));
  assert.throws(() => parseFollowups("<!-- followups:begin -->\n```json\n{}\n```\n<!-- followups:end -->"), /JSON array/);
});

test("THE REAL REPOSITORY: every contract step is tracked, linked to an issue, not premature and not overdue", () => {
  const r = checkFollowups();
  assert.deepEqual(r.errors, []);
  const rf1 = r.entries.find((e) => e.id === "RF-001");
  assert.ok(rf1 && rf1.mandatory === true && rf1.issue === 135, "RF-001 (legacy table drop) must stay tracked against issue #135");
});
