import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAccount, pinnedAccounts } from "./r2-account-preflight.mjs";

const PINNED = "a4c2b7ac45e58a81691b9165492ce6a2";

test("the manifest pins exactly the owner-confirmed account", () => {
  assert.deepEqual(pinnedAccounts(), [PINNED]);
});
test("an exact match passes", () => assert.equal(checkAccount(PINNED).ok, true));
test("everything else fails closed", () => {
  for (const value of [undefined, "", " " + PINNED, PINNED + "\n", PINNED.toUpperCase(), "b".repeat(32), PINNED.slice(1)]) {
    assert.equal(checkAccount(value).ok, false, JSON.stringify(value));
  }
});
test("a manifest with two different accounts or none is refused", () => {
  assert.equal(checkAccount(PINNED, ["a".repeat(32), "b".repeat(32)]).ok, false);
  assert.equal(checkAccount(PINNED, []).ok, false);
});

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./r2-account-preflight.mjs", import.meta.url));
const run = (env) => spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });

test("the command exits 1 when the variable is missing or different and 0 only on an exact match", () => {
  assert.equal(run({}).status, 1);
  assert.equal(run({ CLOUDFLARE_ACCOUNT_ID: "" }).status, 1);
  assert.equal(run({ CLOUDFLARE_ACCOUNT_ID: "b".repeat(32) }).status, 1);
  assert.equal(run({ CLOUDFLARE_ACCOUNT_ID: PINNED }).status, 0);
});

const WORKFLOWS = ["cloudflare-frontend-preview.yml", "cloudflare-backend-preview.yml", "cloudflare-production.yml"];
for (const name of WORKFLOWS) {
  test(`${name} runs the preflight with the real variable before any Cloudflare step`, () => {
    const text = readFileSync(fileURLToPath(new URL(`../.github/workflows/${name}`, import.meta.url)), "utf8");
    const steps = text.split(/\n(?=      - )/).slice(1);
    const index = steps.findIndex((step) => step.includes("node scripts/r2-account-preflight.mjs"));
    assert.ok(index >= 0, "preflight step is missing");
    assert.match(steps[index], /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*vars\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
    assert.doesNotMatch(steps[index], /\n\s+if:/, "the preflight must not be conditional");
    const firstCloudflare = steps.findIndex((step) => /CLOUDFLARE_API_TOKEN|wrangler/.test(step));
    assert.ok(firstCloudflare > index, "a Cloudflare step runs before the preflight");
    assert.ok(steps.findIndex((step) => /pnpm (install|build)|--dry-run/.test(step)) > index, "a build or dry run runs before the preflight");
  });
}
