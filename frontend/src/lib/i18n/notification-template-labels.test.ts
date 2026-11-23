import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getMessages } from "./translate";

/** Every template key the migrations seed: ('<key>', '<event type>', array[...] ... */
function seededTemplateKeys(): string[] {
  const dir = join(__dirname, "../../../../supabase/migrations");
  const keys = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const m of sql.matchAll(/\(\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'\s*,\s*'\1'\s*,\s*array\[/g)) keys.add(m[1]!);
  }
  return [...keys].sort();
}

function label(messages: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, part) => (o && typeof o === "object" ? (o as Record<string, unknown>)[part] : undefined),
    (messages as { notificationTemplates: { template: unknown } }).notificationTemplates.template);
}

describe("notification template names", () => {
  const keys = seededTemplateKeys();

  it("finds the seeded templates, including the marketplace stock ones", () => {
    expect(keys.length).toBeGreaterThan(5);
    expect(keys).toContain("marketplace.stock.low");
    expect(keys).toContain("marketplace.stock.out");
  });

  it.each(["en", "ar"] as const)("every seeded template has a name in %s (no raw key on /admin/notification-templates)", (locale) => {
    const messages = getMessages(locale);
    const missing = keys.filter((k) => typeof label(messages, k) !== "string" || (label(messages, k) as string).trim() === "");
    expect(missing).toEqual([]);
  });
});
