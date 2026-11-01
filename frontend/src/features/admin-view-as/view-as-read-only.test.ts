import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Admin View-As is READ-ONLY by construction (docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §7). Server actions run as the
 * ADMIN's session, so rendering one inside a view of someone else's account would let the admin edit their OWN data
 * believing it is the subject's. This import-graph test keeps the whole view tree free of them:
 *   - nothing under app/admin/users/[id]/view/** or features/admin-view-as/** imports a server action or an editor;
 *   - nothing there is a "use server" module;
 *   - no link points at the admin's own craftsman area (/home...);
 *   - every page and the layout re-establish the gate with requireViewAs (layouts are not re-run on soft navigation);
 *   - nothing opts into a cache.
 * The ONE write in the tree is the exit route handler (a POST that ends the caller's own view session).
 */
const SRC = path.resolve(__dirname, "../..");
const ROOTS = [path.join(SRC, "app/admin/users/[id]/view"), path.join(SRC, "features/admin-view-as")];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const files = ROOTS.flatMap(walk).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => path.relative(SRC, f).replaceAll("\\", "/");

describe("Admin View-As tree is read-only", () => {
  it("finds the files it is meant to police", () => {
    expect(files.some((f) => rel(f).endsWith("view/layout.tsx"))).toBe(true);
    expect(files.some((f) => rel(f).endsWith("view/page.tsx"))).toBe(true);
  });

  it("imports no server action and no editor", () => {
    for (const f of files) {
      const imports = [...read(f).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${rel(f)} imports ${spec}`).not.toMatch(/^@\/server\/actions(\/|$)/);
        expect(spec, `${rel(f)} imports ${spec}`).not.toMatch(/(^|\/)[\w-]*(editor|selector)[\w-]*$/i);
      }
    }
  });

  it("contains no use-server module or inline server action", () => {
    for (const f of files) expect(read(f), rel(f)).not.toMatch(/["']use server["']/);
  });

  it("never links to the admin's own craftsman area", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, rel(f)).not.toMatch(/(href|to|redirect\()\s*[=(]?\s*[{`"']\s*\/home/);
      expect(src, rel(f)).not.toMatch(/["'`]\/home(\/|["'`])/);
    }
  });

  it("re-establishes the gate in the layout and in every page", () => {
    const gated = files.filter((f) => /\/view\/(?:.*\/)?(page|layout)\.tsx$/.test(rel(f).replace(/^app\/admin\/users\/\[id\]/, "")) || /view\/(layout|page)\.tsx$/.test(rel(f)));
    expect(gated.length).toBeGreaterThanOrEqual(2);
    for (const f of gated) expect(read(f), rel(f)).toMatch(/requireViewAs\(/);
  });

  it("is dynamic and never cached", () => {
    for (const f of files.filter((x) => /(page|layout)\.tsx$/.test(x))) {
      const src = read(f);
      expect(src, rel(f)).toMatch(/export const dynamic = "force-dynamic"/);
      expect(src, rel(f)).not.toMatch(/unstable_cache|revalidate\s*=\s*[1-9]|cacheLife|"use cache"/);
    }
  });
});
