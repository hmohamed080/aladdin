#!/usr/bin/env node
// Guard for docs/operations/RELEASE_FOLLOWUPS.md: a tracked release follow-up (for example an expand/contract DROP) cannot be forgotten,
// shipped early, or left open past its due date. Pure file checks: no network, no database. Run by CI (migration-policy) via
// scripts/release-followups-guard.test.mjs and directly: node scripts/release-followups-guard.mjs [--today YYYY-MM-DD]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FOLLOWUPS_FILE = "docs/operations/RELEASE_FOLLOWUPS.md";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFollowups(markdown) {
  const m = markdown.match(/<!-- followups:begin -->\s*```json\s*([\s\S]*?)```\s*<!-- followups:end -->/);
  if (!m) throw new Error("no <!-- followups:begin --> JSON block found");
  const data = JSON.parse(m[1]);
  if (!Array.isArray(data)) throw new Error("the followups block must be a JSON array");
  return data;
}

const isValidDate = (s) => ISO_DATE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const addDays = (s, n) => new Date(Date.parse(s + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** @returns {{ errors: string[], entries: object[] }} */
export function checkFollowups({ root = DEFAULT_ROOT, today = new Date().toISOString().slice(0, 10) } = {}) {
  const errors = [];
  let entries = [];
  const file = path.join(root, FOLLOWUPS_FILE);
  if (!fs.existsSync(file)) return { errors: [`${FOLLOWUPS_FILE} is missing`], entries };
  try { entries = parseFollowups(fs.readFileSync(file, "utf8")); } catch (e) { return { errors: [`${FOLLOWUPS_FILE}: ${e.message}`], entries }; }
  if (!isValidDate(today)) return { errors: [`--today must be YYYY-MM-DD, got ${today}`], entries };

  const proposalsDir = path.join(root, "supabase/proposals");
  const migrationsDir = path.join(root, "supabase/migrations");
  const proposalFiles = fs.existsSync(proposalsDir) ? fs.readdirSync(proposalsDir).filter((f) => /^contract_.*\.sql$/.test(f)) : [];
  const migrationFiles = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir) : [];
  const ids = new Set();

  for (const e of entries) {
    const tag = `${e.id ?? "(no id)"}`;
    if (!e.id || ids.has(e.id)) errors.push(`${tag}: id missing or duplicated`);
    ids.add(e.id);
    if (e.status !== "OPEN" && e.status !== "DONE") errors.push(`${tag}: status must be OPEN or DONE`);
    if (e.mandatory === true && !(Number.isInteger(e.issue) && e.issue > 0)) errors.push(`${tag}: a mandatory follow-up must link its GitHub issue`);
    if (e.production_activated_on !== null && e.production_activated_on !== undefined && !isValidDate(e.production_activated_on)) errors.push(`${tag}: production_activated_on must be YYYY-MM-DD or null`);
    if (!Number.isInteger(e.due_days_after_activation) || e.due_days_after_activation < 1) errors.push(`${tag}: due_days_after_activation must be a positive integer`);
    // The hard backstop: a mandatory follow-up always has an absolute deadline, so it cannot be forgotten even if nobody records the activation date.
    if (e.mandatory === true && !(typeof e.hard_due_on === "string" && isValidDate(e.hard_due_on))) errors.push(`${tag}: a mandatory follow-up needs hard_due_on (YYYY-MM-DD), the absolute deadline that applies even if the Production activation date is never recorded`);
    if (e.hard_due_on !== undefined && e.hard_due_on !== null && !isValidDate(String(e.hard_due_on))) errors.push(`${tag}: hard_due_on must be YYYY-MM-DD`);
    const proposalBase = e.proposal ? path.basename(e.proposal) : null;
    if (e.proposal && !fs.existsSync(path.join(root, e.proposal)) && e.status === "OPEN") errors.push(`${tag}: OPEN but its proposal file ${e.proposal} is missing`);
    if (e.readiness_check && e.status === "OPEN" && !fs.existsSync(path.join(root, e.readiness_check))) errors.push(`${tag}: OPEN but its readiness check ${e.readiness_check} is missing`);

    if (e.status === "OPEN") {
      if (proposalBase && migrationFiles.some((f) => f.endsWith(proposalBase.replace(/^contract_\d+_/, "")) )) errors.push(`${tag}: the contract appears in supabase/migrations while the follow-up is still OPEN (a premature DROP)`);
      if (typeof e.hard_due_on === "string" && isValidDate(e.hard_due_on) && today > e.hard_due_on) errors.push(`${tag}: OVERDUE (hard deadline). It had to be done by ${e.hard_due_on} and today is ${today}. Execute it, or move hard_due_on here with the owner's reason in the PR`);
      if (e.production_activated_on && isValidDate(e.production_activated_on) && Number.isInteger(e.due_days_after_activation)) {
        const due = addDays(e.production_activated_on, e.due_days_after_activation);
        if (today > due) errors.push(`${tag}: OVERDUE. Production was activated on ${e.production_activated_on}, it was due on ${due} and today is ${today}. Execute it, or move the date here with the owner's reason in the PR`);
      }
    } else if (e.status === "DONE") {
      if (!e.closed_by || !migrationFiles.includes(e.closed_by)) errors.push(`${tag}: DONE needs closed_by to name an existing migration file`);
      if (proposalBase && proposalFiles.includes(proposalBase)) errors.push(`${tag}: DONE but its proposal ${proposalBase} is still in supabase/proposals`);
    }
  }
  for (const p of proposalFiles) {
    if (!entries.some((e) => e.proposal && path.basename(e.proposal) === p)) errors.push(`supabase/proposals/${p} is a contract step with no entry in ${FOLLOWUPS_FILE}`);
  }
  return { errors, entries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--today");
  const { errors, entries } = checkFollowups(i > -1 ? { today: process.argv[i + 1] } : {});
  if (errors.length) { console.error("Release follow-ups guard FAILED:\n" + errors.map((x) => "- " + x).join("\n")); process.exit(1); }
  console.log(`Release follow-ups guard PASS: ${entries.length} tracked (${entries.filter((e) => e.status === "OPEN").length} open).`);
}
