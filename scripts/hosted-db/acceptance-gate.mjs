#!/usr/bin/env node
/**
 * Pure decision logic for the Acceptance preflight (acceptance-preflight.sh) and the apply script. No network.
 *
 * Re-pinned 2026-11-11 to the ACTUAL Acceptance history read read-only on 2026-11-11T10:14Z: 207 applied, latest
 * 20261107090006 (the four 2026-11-07 migrations are already applied). The old 203-migration / 090003..090006 pin is gone.
 * A plan names exactly which migrations may be pending and what the history must look like before and after:
 *
 *   media     main today: only 20261110090001 (Track C media ids-only keys) is pending. 207 -> 208.
 *   m1        after `media` is applied: only 20261110090002 (P1 M1) is pending. 208 -> 209.
 *   media+m1  one plain push of both, in order. 207 -> 209.
 *
 *   node acceptance-gate.mjs <plan> <migration-list.json> <dry-run.json> <migrations dir>
 *   node acceptance-gate.mjs post <plan> <migration-list.json>
 *   node acceptance-gate.mjs describe <plan>      (prints shell-safe KEY=VALUE lines for acceptance-apply.sh)
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ACCEPTANCE_REF = "nxossqhdfltcqdwvbewi";
const MEDIA = "20261110090001", M1 = "20261110090002", BASE = "20261107090006";
/** changed = function names (schema.name, every overload) the plan is allowed to touch; nothing else may change in the catalog. */
export const PLANS = {
  media: { applied: 207, latest: BASE, pending: [MEDIA], preContract: BASE, postContract: MEDIA,
    changed: ["app.media_storage_key_assign", "public.media_migration_target_key", "public.media_migration_switch", "public.media_migration_rollback"] },
  m1: { applied: 208, latest: MEDIA, pending: [M1], preContract: MEDIA, postContract: M1,
    changed: ["public.my_registration_state", "app.profile_completion", "public.admin_users_directory"] },
  "media+m1": { applied: 207, latest: BASE, pending: [MEDIA, M1], preContract: BASE, postContract: M1,
    changed: ["app.media_storage_key_assign", "public.media_migration_target_key", "public.media_migration_switch", "public.media_migration_rollback",
      "public.my_registration_state", "app.profile_completion", "public.admin_users_directory"] },
};
export const plan = (name) => {
  const p = PLANS[name];
  if (!p) throw new Error(`unknown plan "${name}"; expected one of ${Object.keys(PLANS).join(", ")}`);
  return p;
};
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function checkAcceptance({ plan: name, list, dry, localVersions }) {
  const P = plan(name), p = [];
  const rows = list?.migrations ?? [];
  const remote = rows.filter((r) => r.remote).map((r) => String(r.remote)).sort();
  const pending = rows.filter((r) => r.local && !r.remote).map((r) => String(r.local)).sort();
  if (remote.length !== P.applied) p.push(`Acceptance has ${remote.length} applied migrations, expected ${P.applied}`);
  if (remote.at(-1) !== P.latest) p.push(`latest applied is ${remote.at(-1)}, expected ${P.latest}`);
  const remoteOnly = rows.filter((r) => r.remote && !r.local);
  if (remoteOnly.length) p.push(`remote-only (history drift): ${remoteOnly.map((r) => r.remote).join(", ")}`);
  if (!same(pending, P.pending)) p.push(`pending is [${pending.join(", ")}], expected exactly [${P.pending.join(", ")}]`);
  // plain push must be possible: every pending version is newer than the latest applied (no --include-all needed)
  const older = pending.filter((v) => remote.length && v < remote.at(-1));
  if (older.length) p.push(`out-of-order pending (would need --include-all, not allowed here): ${older.join(", ")}`);
  const would = (dry?.migrations ?? []).map((f) => String(f).slice(0, 14));
  if (dry?.dryRun !== true) p.push("the dry run output does not say dryRun:true");
  if (!same(would, P.pending)) p.push(`dry run would push [${would.join(", ")}], expected exactly [${P.pending.join(", ")}]`);
  for (const v of P.pending) if (!localVersions.includes(v)) p.push(`migration file ${v} is not in this checkout`);
  return p;
}

/** After the real push: applied + pending.length applied, latest = last pending, none pending, no remote-only. */
export function checkAcceptancePost({ plan: name, list }) {
  const P = plan(name), p = [];
  const rows = list?.migrations ?? [];
  const remote = rows.filter((r) => r.remote).map((r) => String(r.remote)).sort();
  const want = P.applied + P.pending.length;
  if (remote.length !== want) p.push(`${remote.length} applied after the push, expected ${want}`);
  if (remote.at(-1) !== P.pending.at(-1)) p.push(`latest applied is ${remote.at(-1)}, expected ${P.pending.at(-1)}`);
  for (const v of P.pending) if (!remote.includes(v)) p.push(`${v} is not applied`);
  const pending = rows.filter((r) => r.local && !r.remote);
  if (pending.length) p.push(`still pending: ${pending.map((r) => r.local).join(", ")}`);
  const remoteOnly = rows.filter((r) => r.remote && !r.local);
  if (remoteOnly.length) p.push(`remote-only: ${remoteOnly.map((r) => r.remote).join(", ")}`);
  return p;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const j = (f) => JSON.parse(readFileSync(f, "utf8").replace(/^[^{]*/, ""));
  try {
    const [a, b, c, d] = process.argv.slice(2);
    if (a === "describe") {
      const P = plan(b);
      console.log(`PRE_CONTRACT=${P.preContract}\nPOST_CONTRACT=${P.postContract}\nN_PENDING=${P.pending.length}\nPOST_APPLIED=${P.applied + P.pending.length}\nLATEST=${P.pending.at(-1)}
PENDING_VERSIONS="${P.pending.join(" ")}"\nEXPECT_CHANGED='${P.changed.join(";")}'`);
      process.exit(0);
    }
    if (a === "post") {
      const problems = checkAcceptancePost({ plan: b, list: j(c) });
      if (problems.length) { console.error("Acceptance post-push gate: FAILED\n" + problems.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
      const P = plan(b);
      console.log(`Acceptance post-push gate: ok (${P.applied + P.pending.length} applied, latest ${P.pending.at(-1)}, none pending)`);
      process.exit(0);
    }
    const problems = checkAcceptance({ plan: a, list: j(b), dry: j(c), localVersions: readdirSync(d).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, 14)) });
    if (problems.length) { console.error("Acceptance gate: REFUSED\n" + problems.map((x) => `  - ${x}`).join("\n")); process.exit(1); }
    const P = plan(a);
    console.log(`Acceptance gate: ok (plan ${a}: ${P.applied} applied, latest ${P.latest}, exactly [${P.pending.join(", ")}] pending, plain push, no drift)`);
  } catch (e) { console.error(`UNUSABLE INPUT: ${e.message}`); process.exit(2); }
}
