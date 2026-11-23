import "server-only";
import { z } from "zod";

/**
 * Server-only settings for the Admin backup console's GitHub hand-off.
 *
 * The browser never sees these values and never talks to GitHub. The app server
 * dispatches a workflow in the PRIVATE `aladdin-backups` repository and reads
 * the run and its `backup` / `restore` job back to decide the real outcome. A
 * green `plan` job alone is never a successful backup: `verifyRunOutcome()`
 * requires the data-moving job to be `success` too.
 *
 * Everything is optional so the rest of the app boots without backups; the
 * dispatch path fails closed with a translation key when the token is absent.
 */
const optional = z.preprocess((value) => (value === "" ? undefined : value), z.string().trim().min(1).optional());

export const backupGithubEnvSchema = z.object({
  BACKUP_GITHUB_TOKEN: optional,
  BACKUP_GITHUB_REPO: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "must be owner/repository")
    .default("hmohamed080/aladdin-backups"),
  BACKUP_GITHUB_BACKUP_WORKFLOW: z.string().trim().min(1).default("daily-backup.yml"),
  BACKUP_GITHUB_RESTORE_WORKFLOW: z.string().trim().min(1).default("restore-test.yml"),
  BACKUP_GITHUB_REF: z.string().trim().min(1).default("main"),
});

export type BackupGithubEnv = z.infer<typeof backupGithubEnvSchema>;

export function readBackupGithubEnv(): BackupGithubEnv {
  return backupGithubEnvSchema.parse({
    BACKUP_GITHUB_TOKEN: process.env.BACKUP_GITHUB_TOKEN,
    BACKUP_GITHUB_REPO: process.env.BACKUP_GITHUB_REPO,
    BACKUP_GITHUB_BACKUP_WORKFLOW: process.env.BACKUP_GITHUB_BACKUP_WORKFLOW,
    BACKUP_GITHUB_RESTORE_WORKFLOW: process.env.BACKUP_GITHUB_RESTORE_WORKFLOW,
    BACKUP_GITHUB_REF: process.env.BACKUP_GITHUB_REF,
  });
}
