#!/usr/bin/env node
// Decides what a run of .github/workflows/media-cleanup.yml may do. Pure (reads only the object it is given), so the gates are
// tested offline (media-cleanup-plan.test.mjs). Prints one JSON array for the job matrix: [{label, project, execute}] or fails.
//
// Switches are repository variables, all OFF by default, set by the owner:
//   ACCEPTANCE_MEDIA_CLEANUP   off (default) | dry-run | execute
//   PRODUCTION_MEDIA_CLEANUP   off (default) | dry-run | execute
// Deleting bytes is destructive, so:
//   * "execute" for Production also needs PRODUCTION_BACKUP_ENABLED=true: bytes are never deleted where no independent backup runs;
//   * a MANUAL run is a dry run unless it asks to execute, and a manual Production execute needs the typed confirmation;
//   * a manual run never exceeds the repository switch (a switch at dry-run refuses a manual execute).
import { pathToFileURL } from "node:url";

export const PROJECTS = { acceptance: "nxossqhdfltcqdwvbewi", production: "kkpkgjrweysgvhvkhzun" };
export const PRODUCTION_CONFIRMATION = "clean up production media";
const MODES = ["off", "dry-run", "execute"];
const rank = (mode) => MODES.indexOf(mode);

function mode(env, name) {
  const value = env[name] || "off";
  if (!MODES.includes(value)) throw new Error(`${name} must be off, dry-run or execute`);
  return value;
}

export function planCleanup(env) {
  const switches = { acceptance: mode(env, "ACCEPTANCE_MEDIA_CLEANUP"), production: mode(env, "PRODUCTION_MEDIA_CLEANUP") };
  const backups = env.PRODUCTION_BACKUP_ENABLED === "true";
  const out = [];
  const add = (label, execute) => {
    if (execute && label === "production" && !backups) throw new Error("Production cleanup cannot execute while PRODUCTION_BACKUP_ENABLED is not true");
    out.push({ label, project: PROJECTS[label], execute });
  };

  if (env.EVENT === "schedule") {
    for (const label of ["acceptance", "production"]) {
      if (switches[label] === "off") continue;
      // A scheduled Production execute without backups is skipped quietly to a dry run, never to a deletion.
      add(label, switches[label] === "execute" && (label !== "production" || backups));
    }
    return out;
  }
  if (env.EVENT !== "workflow_dispatch") throw new Error(`unknown event: ${env.EVENT ?? ""}`);

  const label = env.INPUT_LABEL;
  if (label !== "acceptance" && label !== "production") throw new Error("choose acceptance or production");
  const wantsExecute = env.INPUT_EXECUTE === "true";
  if (switches[label] === "off") throw new Error(`${label} media cleanup is not activated (its repository switch is off)`);
  if (wantsExecute) {
    if (rank(switches[label]) < rank("execute")) throw new Error(`${label} media cleanup is not activated for execution (switch is ${switches[label]})`);
    if (label === "production" && !backups) throw new Error("Production cleanup cannot execute while PRODUCTION_BACKUP_ENABLED is not true");
    if (label === "production" && env.INPUT_CONFIRM !== PRODUCTION_CONFIRMATION) throw new Error(`type "${PRODUCTION_CONFIRMATION}" to confirm a manual Production cleanup`);
  }
  add(label, wantsExecute);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(planCleanup(process.env))); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
