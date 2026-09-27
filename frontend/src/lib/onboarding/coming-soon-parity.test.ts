import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPE_CHOICES } from "./account-types";

/**
 * Coming Soon is enforced twice — by the server actions (this catalog's
 * `comingSoon` flag) and by the authoritative database RPC
 * (`app.coming_soon_account_types()`, staging-prep Increment 13). The two must
 * name exactly the same account types, or a type could be open in one layer
 * and closed in the other. This reads the LATEST migration that defines the
 * database list (marked `COMING_SOON_ACCOUNT_TYPES`) and compares.
 */
function databaseComingSoon(): string[] {
  const dir = path.resolve(__dirname, "../../../../supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let found: string[] | null = null;
  for (const f of files) {
    const sql = readFileSync(path.join(dir, f), "utf8");
    const m = sql.match(/select array\[([^\]]*)\]::text\[\];\s*--\s*COMING_SOON_ACCOUNT_TYPES/);
    if (m) found = [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
  }
  if (!found) throw new Error("no migration defines app.coming_soon_account_types()");
  return found.sort();
}

describe("Coming Soon parity: server actions ⇄ database", () => {
  const frontend = ACCOUNT_TYPE_CHOICES.filter((c) => c.comingSoon)
    .map((c) => c.accountType)
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort();

  it("the frontend closes Personal Account, Engineer and Contractor", () => {
    expect(frontend).toEqual(["contractor", "end_consumer", "engineer"]);
  });

  it("the database closes exactly the same account types", () => {
    expect(databaseComingSoon()).toEqual(frontend);
  });
});
