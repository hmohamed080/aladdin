import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Server-side direct-route enforcement must not depend on someone remembering
 * it. Every Admin page — including ones added later — must call the central
 * guard for ITS OWN route (so a direct URL is refused by the page itself, not
 * merely hidden from the navigation).
 */
const APP_DIR = join(__dirname, "..", "..", "app");
const ADMIN_DIR = join(APP_DIR, "admin");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

/** `/admin/users/[id]/page.tsx` → `/admin/users` (the rule a dynamic page inherits). */
function routeOf(file: string): string {
  const rel = "/" + relative(APP_DIR, file).split(sep).join("/");
  return rel.replace(/\/page\.tsx$/, "").split("/[")[0]!;
}

describe("Admin direct-route enforcement", () => {
  const files = pages(ADMIN_DIR);

  it("finds the Admin pages", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [routeOf(f), f]))("%s guards its own route", (route, file) => {
    const src = readFileSync(file, "utf8");
    expect(src.includes(`requireAdminRoute("${route}")`), `${route} must call requireAdminRoute("${route}")`).toBe(true);
  });
});
