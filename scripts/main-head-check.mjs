#!/usr/bin/env node
/**
 * Is this commit STILL the head of `main`?
 *
 * `cancel-in-progress: false` serialises workflow runs, but it does not stop `main` from advancing while a run is
 * installing, planning, migrating, waiting for Vercel, or about to promote. An older commit must never be migrated or
 * promoted after a newer one has become `main`. This is the ONE implementation of that question, called by
 * .github/workflows/deploy-staging.yml at three points:
 *
 *   --stage initial       right after checkout
 *   --stage pre-migrate   immediately before `supabase db push`
 *   --stage pre-promote   immediately before `vercel promote`
 *
 * It compares the FULL 40-character SHA (never a prefix) and writes `current=true|false` to $GITHUB_OUTPUT. The workflow's
 * write steps are conditioned on that output, so a "false" means nothing after it can write.
 *
 *   node scripts/main-head-check.mjs --stage <stage> --sha <40-hex>
 *
 * Exit codes: 0 answered (current OR superseded - read the output) · 2 could not answer (usage error, `git ls-remote`
 * failed, malformed output). Not knowing is NOT a "current": the run fails and nothing is written.
 */
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGES = ["initial", "pre-migrate", "pre-promote"];
const FULL_SHA = /^[0-9a-f]{40}$/;

export class HeadCheckError extends Error {}

/** A full 40-character commit SHA, lower-cased; anything else (a prefix, a ref name, empty) is refused. */
export function normalizeSha(value, what) {
  const sha = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!FULL_SHA.test(sha)) throw new HeadCheckError(`${what} must be a full 40-character commit SHA`);
  return sha;
}

/** `git ls-remote origin refs/heads/main` prints "<sha>\trefs/heads/main". */
export function parseLsRemote(output) {
  const lines = String(output ?? "").split(/\r?\n/).filter((l) => l.trim());
  const main = lines.filter((l) => /\trefs\/heads\/main$/.test(l));
  if (main.length !== 1) throw new HeadCheckError(`expected exactly one refs/heads/main line from git ls-remote, got ${main.length}`);
  return normalizeSha(main[0].split("\t")[0], "the remote main head");
}

const SUPERSEDED = {
  initial: (head) => `Superseded: main is now at ${head}. This run will not write anything.`,
  "pre-migrate": (head) =>
    `This workflow was superseded by a newer main commit (${head}) before the database migration. ` +
    "No migration was run and nothing will be promoted. The run for the newer commit will deploy it.",
  "pre-promote": (head) =>
    `This commit was superseded after database migration (main is now ${head}). ` +
    "Database remains forward-only. Application promotion was skipped. " +
    "The queued deployment for the newer main commit will continue from the forward-compatible schema.",
};

/** Pure decision. Both SHAs must be full; equality is exact. */
export function evaluateHead({ remoteHead, expectedSha, stage }) {
  if (!STAGES.includes(stage)) throw new HeadCheckError(`--stage must be one of ${STAGES.join(", ")}`);
  const expected = normalizeSha(expectedSha, "--sha");
  const head = normalizeSha(remoteHead, "the remote main head");
  if (head === expected) return { current: true, message: `main is still ${expected} (${stage}): proceeding.` };
  return { current: false, message: SUPERSEDED[stage](head) };
}

function parseArgs(argv) {
  const args = { stage: undefined, sha: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--stage") args.stage = argv[++i];
    else if (argv[i] === "--sha") args.sha = argv[++i];
    else throw new HeadCheckError(`unexpected argument: ${argv[i]}`);
  }
  if (!args.stage || !args.sha) throw new HeadCheckError("usage: main-head-check.mjs --stage <initial|pre-migrate|pre-promote> --sha <40-hex>");
  return args;
}

const lsRemoteMain = () => execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export function main(argv, { runLsRemote = lsRemoteMain, log = console.log, env = process.env } = {}) {
  try {
    const { stage, sha } = parseArgs(argv);
    const decision = evaluateHead({ remoteHead: parseLsRemote(runLsRemote()), expectedSha: sha, stage });
    log(decision.message);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `current=${decision.current}\n`);
    if (!decision.current) {
      if (env.GITHUB_ACTIONS === "true") log(`::notice title=Superseded (${stage})::${decision.message}`);
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Superseded (${stage})\n\n${decision.message}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof HeadCheckError) {
      log(`main-head-check: ${error.message}`);
      return 2;
    }
    // git itself failed (network, auth): we cannot tell, so we must not proceed.
    log(`main-head-check: could not read the remote main head (${error.message.split("\n")[0]}). Failing closed; nothing is written.`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
