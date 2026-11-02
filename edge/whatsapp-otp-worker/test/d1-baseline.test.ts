import { test } from "node:test";
import { strict as assert } from "node:assert";
// @ts-expect-error plain .mjs script
import { classify, expectedFromMigrations, runCheck } from "../scripts/d1-baseline-check.mjs";

const expected = expectedFromMigrations();
const obj = (...names: string[]) => names.map((name) => ({ type: "table", name }));

test("the expected tables come from the repository's own migrations (never drift)", () => {
  for (const t of ["whatsapp_hook_events", "otp_settings", "otp_settings_audit", "otp_admin_requests", "otp_alert_state", "otp_notification_outbox"]) assert.ok(expected.tables.includes(t), t);
});

test("an empty database, the hand-created Production state, a tracked-but-behind and a current database are each classified with the right next step", () => {
  assert.equal(classify([], expected).state, "empty");
  // The Production D1 as inspected read-only on 2026-11-02: 0001's table and index, no d1_migrations tracking table.
  const production = classify([{ type: "index", name: "whatsapp_hook_events_created_at" }, ...obj("whatsapp_hook_events")], expected);
  assert.equal(production.state, "untracked_partial");
  assert.equal(production.tracked, false);
  assert.match(production.next, /migrations apply/);
  assert.match(production.next, /idempotent/);
  assert.equal(classify(obj("d1_migrations", "whatsapp_hook_events"), expected).state, "tracked_behind");
  assert.equal(classify(obj("d1_migrations", ...expected.tables), expected).state, "current");
  assert.equal(classify(obj(...expected.tables), expected).state, "untracked_complete");
});

test("every migration is idempotent, which is what makes `migrations apply` a safe baseline on a hand-created database", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((x: string) => x.endsWith(".sql"))) {
    const sql = readFileSync(new URL(f, dir), "utf8").split(/\r?\n/).filter((l: string) => !l.trim().startsWith("--")).join("\n");
    for (const m of sql.matchAll(/CREATE\s+(TABLE|INDEX)\s+(?!IF NOT EXISTS)/gi)) assert.fail(`${f}: a CREATE without IF NOT EXISTS: ${m[0]}`);
    for (const m of sql.matchAll(/INSERT\s+(?!OR IGNORE)INTO/gi)) assert.fail(`${f}: a non-idempotent INSERT: ${m[0]}`);
    // String values such as 'update' (an audit kind) are not statements, so literals are blanked out before the check.
    assert.ok(!/\b(DROP|ALTER|DELETE|UPDATE)\b/i.test(sql.replace(/'[^']*'/g, "''")), `${f}: a migration must stay additive`);
  }
});

test("runCheck is read-only (one SELECT through wrangler d1 execute), validates the name and surfaces failures", () => {
  const calls: string[][] = [];
  const ok = (_cmd: string, args: string[]) => {
    calls.push(args);
    return { status: 0, stdout: JSON.stringify([{ results: [{ type: "table", name: "whatsapp_hook_events" }] }]), stderr: "" };
  };
  const result = runCheck("aladdin-whatsapp-otp-production", ok);
  assert.equal(result.state, "untracked_partial");
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.includes("--remote") && calls[0]!.includes("--json"));
  const sql = String(calls[0]![calls[0]!.indexOf("--command") + 1]);
  assert.match(sql, /^select /i);
  assert.ok(!/\b(insert|update|delete|drop|alter|create)\b/i.test(sql), "the only statement is a SELECT");
  assert.throws(() => runCheck("bad name; rm -rf /", ok), /usage/);
  assert.throws(() => runCheck("x", ok), /usage/);
  assert.throws(() => runCheck("aladdin-whatsapp-otp-production", () => ({ status: 1, stdout: "", stderr: "Authentication error" })), /wrangler failed/);
});
