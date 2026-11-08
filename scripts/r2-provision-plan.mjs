#!/usr/bin/env node
// Prints the exact, ordered operator commands to provision (or verify) the R2 buckets of one environment.
// It RUNS NOTHING and needs no credentials: the output is a script the owner reviews and runs by hand, one GO at a time.
//
//   node scripts/r2-provision-plan.mjs --env acceptance|production [--verify-only]
//
// Names are checked against the same rules the application enforces at runtime (environment-guard.ts): Production
// names carry no non-Production marker, Acceptance names carry one, the buckets are distinct and none is a backup bucket.
import { pathToFileURL } from "node:url";

export class PlanError extends Error {}

const NON_PROD = ["acceptance", "preview", "staging", "local", "test", "dev"];
const isNonProduction = (name) => name.toLowerCase().split(/[^a-z0-9]+/).some((part) => NON_PROD.includes(part));

export const TARGETS = {
  acceptance: {
    supabaseRef: "nxossqhdfltcqdwvbewi",
    private: "aladdin-r2-acceptance-20261011-private", // exists since 2026-10-11
    site: "aladdin-acceptance-site-media",              // proposed: separate from user media (R2_SITE_BUCKET)
    exists: ["private"],
    cors: "docs/operations/r2/cors-acceptance-private.json",
    worker: "aladdin-frontend-preview",
    backup: "aladdin-acceptance-backups-weur",
  },
  production: {
    supabaseRef: "kkpkgjrweysgvhvkhzun",
    private: "aladdin-media-private", // ADR-0018 name
    site: "aladdin-site-media",       // proposed
    exists: [],
    cors: "docs/operations/r2/cors-production-private.json",
    worker: "aladdin-frontend-production",
    backup: "aladdin-production-db-backups",
  },
};

export function validate(env, target = TARGETS[env]) {
  const problems = [];
  if (!target) return [`unknown environment ${env}`];
  const names = [target.private, target.site];
  if (new Set(names).size !== names.length) problems.push("private and site buckets must differ");
  for (const name of names) {
    if (/backup/i.test(name)) problems.push(`${name} looks like a backup bucket`);
    if (name === target.backup) problems.push(`${name} is the backup bucket`);
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) problems.push(`${name} is not a valid R2 bucket name`);
    if (env === "production" && isNonProduction(name)) problems.push(`${name} carries a non-Production marker`);
    if (env === "acceptance" && !isNonProduction(name)) problems.push(`${name} lacks a non-Production marker`);
  }
  return problems;
}

const W = "pnpm exec wrangler"; // run from frontend/, with an R2 admin token that lives one day

export function buildPlan(env, { verifyOnly = false } = {}) {
  const t = TARGETS[env];
  const problems = validate(env);
  if (problems.length) throw new PlanError(problems.join("; "));
  const steps = [];
  const add = (kind, title, command) => steps.push({ kind, title, command });
  const buckets = [["private", t.private], ["site", t.site]];

  for (const [role, name] of buckets) {
    if (!verifyOnly && !t.exists.includes(role)) add("write", `Create the ${role} bucket (Western Europe, Standard)`, `${W} r2 bucket create ${name} --location weur`);
  }
  if (!verifyOnly) {
    add("write", "CORS on the private bucket (PUT only, exact origins)", `${W} r2 bucket cors set ${t.private} --file ../${t.cors}`);
    add("write", "Lifecycle on the private bucket (pending/ 2 days, multipart abort 7 days)", `${W} r2 bucket lifecycle set ${t.private} --file ../docs/operations/r2/lifecycle-private.json`);
    add("write", "Lifecycle on the site bucket (multipart abort only)", `${W} r2 bucket lifecycle set ${t.site} --file ../docs/operations/r2/lifecycle-public.json`);
  }
  for (const [role, name] of buckets) {
    add("read", `${role}: bucket exists in the expected location`, `${W} r2 bucket info ${name}`);
    add("read", `${role}: r2.dev public URL must be DISABLED`, `${W} r2 bucket dev-url get ${name}`);
    add("read", `${role}: no custom domain attached (private media is never served from the bucket)`, `${W} r2 bucket domain list ${name}`);
  }
  add("read", "private: CORS equals the reviewed file", `${W} r2 bucket cors list ${t.private}`);
  add("read", "private: lifecycle equals the reviewed file", `${W} r2 bucket lifecycle list ${t.private}`);
  return {
    env, supabaseRef: t.supabaseRef, buckets: { private: t.private, site: t.site }, steps,
    credentials: [
      { name: "R2 admin token (bucket rules)", scope: "Account: Workers R2 Storage Edit", holder: "operator, expires in 1 day, deleted after the stage" },
      { name: `R2 S3 credential: ${t.worker}`, scope: `Object Read & Write on ${t.private} and ${t.site} only`, holder: `Worker secrets R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY` },
      { name: "R2 S3 credential: reconcile and media tools", scope: `Object Read on ${t.private} only`, holder: "operator shell, never CI" },
      { name: "R2 S3 credential: transcode container (only if video is approved)", scope: `Object Read & Write on ${t.private} only`, holder: "container secrets" },
    ],
    afterCreation: [
      `Commit the reviewed names to frontend/src/lib/storage/environment-manifest.ts (${env === "production" ? "production" : "staging"}.buckets and r2AccountId); until then Production fails closed.`,
      "Set the Worker variables R2_ACCOUNT_ID, R2_PRIVATE_BUCKET, R2_SITE_BUCKET (and secrets) with a version upload; promote only on its own GO.",
    ],
  };
}

export function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--env");
  const env = i >= 0 ? argv[i + 1] : null;
  if (!env || !TARGETS[env]) throw new PlanError("Usage: r2-provision-plan.mjs --env acceptance|production [--verify-only]");
  const plan = buildPlan(env, { verifyOnly: argv.includes("--verify-only") });
  const lines = [`# R2 provisioning plan for ${env} (Supabase ${plan.supabaseRef}). Prints only; nothing was run.`, "# Run from frontend/. Each 'write' step is a hosted change and needs the owner's GO.", ""];
  plan.steps.forEach((s, n) => lines.push(`# ${n + 1}. [${s.kind}] ${s.title}`, s.command, ""));
  lines.push("# Credentials", ...plan.credentials.map((c) => `#  - ${c.name}: ${c.scope} -> ${c.holder}`), "", "# After creation", ...plan.afterCreation.map((a) => `#  - ${a}`));
  console.log(lines.join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error instanceof PlanError ? error.message : "Plan failed"); process.exitCode = 1; }
}
