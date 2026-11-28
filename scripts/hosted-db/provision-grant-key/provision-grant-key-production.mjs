#!/usr/bin/env node
// OWNER-RUN, ONE-TIME, PRODUCTION: put the Production WhatsApp OTP admin GRANT KEY (the value stored as OTP_ADMIN_GRANT_SECRET_PRODUCTION) into the
// PRODUCTION database table app.whatsapp_otp_grant_key. This is step P-1 of docs/operations/WHATSAPP_OTP_PRODUCTION_ROLLOUT_CHECKLIST.md.
//
// It is the SAME reviewed code path as the Acceptance helper (provision-grant-key.mjs), run with the stricter PRODUCTION profile:
//
//   node provision-grant-key-production.mjs                                        DRY RUN (default, read-only, no approval needed)
//   node provision-grant-key-production.mjs --write --approval=PROD-GRANT-YYYYMMDD-XXXX   the real write
//
// PRODUCTION APPROVAL REQUIREMENTS (all enforced in code, see PRODUCTION_PROFILE and the tests):
//   * a write needs the owner's written approval reference (--approval=PROD-GRANT-YYYYMMDD-XXXX, from the release record); it is checked before any
//     prompt or connection and is echoed in the output so it lands in the release record. It is a reference, not a credential.
//   * the typed confirmation is "PROVISION PRODUCTION" (the Acceptance phrase is not accepted).
//   * never in CI (the CI variable refuses) and never without an interactive terminal (the prompts are hidden).
//   * the target must be the exact Production pooler or direct host (a string that mentions the Acceptance project is refused), TLS is verified
//     against the pinned Supabase CA, the server must report Postgres 17.6, migration 20261103090001 must be applied (the table exists, RLS on,
//     empty) and the history must hold at least 194 rows. It never overwrites a key (rotation is a separate, reviewed step).
//
// SECRETS: exactly as the Acceptance helper. The key and the connection string are typed at HIDDEN prompts (paste from your password manager),
// never accepted from an argument, file, environment variable or pipe; the key travels only as a bound bytea parameter of a constant statement;
// nothing is printed, logged, stored or read back except a 12-hex-digit fingerprint. Exit codes: 0 done / dry run passed, 1 refused or failed
// safely, 2 usage.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRODUCTION_PROFILE, readHidden, readLine, realConnect, run } from "./provision-grant-key.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ca = fs.readFileSync(path.join(HERE, "supabase-root-2021-ca.crt"));
  run({
    argv: process.argv.slice(2),
    ca,
    profile: PRODUCTION_PROFILE,
    ci: Boolean(process.env.CI),
    hidden: (p) => readHidden(p),
    line: (p) => readLine(p),
    connect: realConnect,
  }).then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
