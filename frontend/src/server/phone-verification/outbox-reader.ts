import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { phoneDigest, type OutboxEntry } from "./delivery";

/**
 * TEST / LOCAL-E2E SUPPORT ONLY. Reads the local outbox written by createOutboxTransport so a test can type the code that the
 * (fake) delivery "sent". Application code must not import this file. The code is returned to the caller, never logged.
 */
export function latestOutboxEntry(dir: string, e164: string, purpose?: string): OutboxEntry | null {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return null;
  }
  const digest = phoneDigest(e164);
  for (let i = files.length - 1; i >= 0; i -= 1) {
    try {
      const entry = JSON.parse(readFileSync(join(dir, files[i]!), "utf8")) as OutboxEntry;
      if (entry.toDigest === digest && (!purpose || entry.purpose === purpose)) return entry;
    } catch {
      /* a half-written file is skipped */
    }
  }
  return null;
}

export const latestOutboxCode = (dir: string, e164: string, purpose?: string): string | null => latestOutboxEntry(dir, e164, purpose)?.code ?? null;
