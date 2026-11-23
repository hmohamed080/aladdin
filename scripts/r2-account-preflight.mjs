#!/usr/bin/env node
// Fail-closed preflight for every Cloudflare R2 / Worker step: CLOUDFLARE_ACCOUNT_ID must equal the account pinned in
// frontend/src/lib/storage/environment-manifest.ts, character for character. Prints no secret (an account id is not one).
//
//   CLOUDFLARE_ACCOUNT_ID=<value> node scripts/r2-account-preflight.mjs
//
// Exit 0 only on an exact match. Unset, empty, differently cased, padded or different values all exit 1.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const manifestPath = fileURLToPath(new URL("../frontend/src/lib/storage/environment-manifest.ts", import.meta.url));

export function pinnedAccounts(source = readFileSync(manifestPath, "utf8")) {
  const ids = [...source.matchAll(/r2AccountId:\s*"([a-f0-9]{32})"/g)].map((m) => m[1]);
  return [...new Set(ids)];
}

export function checkAccount(value, pinned = pinnedAccounts()) {
  if (pinned.length !== 1) return { ok: false, reason: "the manifest must pin exactly one Cloudflare account" };
  if (typeof value !== "string" || value === "") return { ok: false, reason: "CLOUDFLARE_ACCOUNT_ID is not set" };
  if (value !== pinned[0]) return { ok: false, reason: "CLOUDFLARE_ACCOUNT_ID does not equal the pinned account" };
  return { ok: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkAccount(process.env.CLOUDFLARE_ACCOUNT_ID);
  if (!result.ok) { console.error(`REFUSED: ${result.reason}. Stop; do not deploy or run any R2 step.`); process.exit(1); }
  console.log("OK: CLOUDFLARE_ACCOUNT_ID equals the pinned account.");
}
