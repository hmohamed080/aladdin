import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Admin View-As is READ-ONLY by construction (docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §7). Server actions run as the
 * ADMIN's session, so rendering one inside a view of someone else's account would let the admin edit their OWN data
 * believing it is the subject's. This test follows the WHOLE import graph (transitively) from every view-as entry point and
 * proves that none of the reachable code can mutate or leave the view:
 *   - no module in the closure is a server action (`"use server"`, `server/actions/**`) or an editor/form of the product;
 *   - no reachable code writes through the Supabase client (insert/update/upsert/delete) or uses a service-role client;
 *   - the ONLY RPCs reachable are the read-only allow-list below (+ the three audited session functions, each only from
 *     the route handler that owns it);
 *   - no `/home` link, every page re-establishes the gate, everything is dynamic and uncached.
 * The writes in the tree are exactly the session POSTs: start (opens the audited session) and exit (ends it).
 *
 * The private-media route (stage 4, `view/media/…/route.ts`) streams bytes from storage, so it is NOT part of that closure:
 * it has its own targeted guard at the bottom (what it may import and call, exactly one RPC, no service role), and the main
 * closure additionally proves that no page, component or reader can reach storage or that route.
 */
const SRC = path.resolve(__dirname, "../..");
const rel = (f: string) => path.relative(SRC, f).replaceAll("\\", "/");
const read = (f: string) => readFileSync(f, "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f);

const VIEW_DIR = path.join(SRC, "app/admin/users/[id]/view");
const MEDIA_ROUTE = path.join(VIEW_DIR, "media/[namespace]/[mediaId]/route.ts");
const ENTRY = [
  ...walk(VIEW_DIR).filter(isSource).filter((f) => f !== MEDIA_ROUTE),
  ...walk(path.join(SRC, "features/admin-view-as")).filter(isSource),
  path.join(SRC, "server/view-as/guard.ts"),
  path.join(SRC, "server/view-as/readers.ts"),
];

function resolveSpec(spec: string, from: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  if (!base) return null; // a package (react, next/…): not part of our code
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function closure(entries: string[]): Map<string, string> {
  const seen = new Map<string, string>(); // file -> first importer
  const stack: [string, string][] = entries.map((e) => [e, "(entry)"]);
  while (stack.length) {
    const [file, via] = stack.pop()!;
    if (seen.has(file)) continue;
    seen.set(file, via);
    const src = read(file);
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
      const next = resolveSpec(m[1]!, file);
      if (next && isSource(next)) stack.push([next, rel(file)]);
    }
  }
  return seen;
}

const graph = closure(ENTRY);
const files = [...graph.keys()];

/** Read-only RPCs the view may call. `admin_view_as_begin` / `_end` live only in their own route handlers (checked below). */
const READ_RPCS = new Set([
  "admin_my_access",
  "admin_view_as_current",
  "admin_view_craftsman_dashboard",
  "admin_view_craftsman_profile",
  "admin_view_craftsman_portfolio",
  "admin_view_craftsman_work",
  "admin_view_craftsman_points",
  "admin_view_craftsman_reviews",
]);
const ROUTE_RPCS: Record<string, string> = {
  "app/admin/users/[id]/view/start/route.ts": "admin_view_as_begin",
  "app/admin/users/[id]/view/exit/route.ts": "admin_view_as_end",
};

describe("Admin View-As is read-only (transitive)", () => {
  it("follows a real, non-trivial import graph", () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => rel(f) === "server/view-as/readers.ts")).toBe(true);
    expect(files.some((f) => rel(f) === "server/authorization/admin.ts")).toBe(true);
  });

  it("cannot reach storage or the media route: private files are only ever an <img>/<a> pointing at the route", () => {
    for (const f of files) {
      expect(rel(f), `${rel(f)} (imported by ${graph.get(f)})`).not.toMatch(/^server\/storage\/|\/view\/media\//);
    }
  });

  it("reaches no server action and no 'use server' module", () => {
    for (const f of files) {
      expect(rel(f), `${rel(f)} (imported by ${graph.get(f)})`).not.toMatch(/^server\/actions\//);
      expect(read(f), `${rel(f)} (imported by ${graph.get(f)})`).not.toMatch(/^\s*["']use server["']/m);
    }
  });

  it("reaches no editor, form or mutation surface of the product", () => {
    const forbidden = /(^|\/)(?:[\w-]*(?:editor|selector|upload|uploader)[\w-]*|profile-hub|installer-profile-page|professional-profile-editor)\.tsx?$/i;
    for (const f of files) expect(rel(f), `${rel(f)} (imported by ${graph.get(f)})`).not.toMatch(forbidden);
  });

  it("reaches no service-role / admin Supabase client", () => {
    for (const f of files) {
      expect(rel(f), `${rel(f)} (imported by ${graph.get(f)})`).not.toMatch(/^lib\/supabase\/admin-server\.ts$|^server\/storage\/media\.ts$/);
      expect(read(f), rel(f)).not.toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY|createAdminClient|getAdminSupabase|getInstallerSecurityAdminClient/);
    }
  });

  it("never writes through the Supabase client anywhere in the closure", () => {
    for (const f of files) {
      expect(read(f), rel(f)).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
      expect(read(f), rel(f)).not.toMatch(/\.storage\s*\.|\.from\(\s*["'][a-z_-]+["']\s*\)\.(?:upload|remove)/);
    }
  });

  it("calls only allow-listed RPCs; the session writers live only in their own route handlers", () => {
    for (const f of files) {
      const own = ROUTE_RPCS[rel(f)];
      for (const m of read(f).matchAll(/\.rpc\(\s*["']([a-z0-9_]+)["']/g)) {
        const name = m[1]!;
        expect(READ_RPCS.has(name) || name === own, `${rel(f)} calls ${name}`).toBe(true);
      }
    }
    for (const [file, rpc] of Object.entries(ROUTE_RPCS)) expect(read(path.join(SRC, file))).toContain(rpc);
  });

  it("makes no network write from the browser (no client fetch / XHR in the closure's view components)", () => {
    // Route handlers run on the server; pages and components are what the browser runs.
    const browserSide = (x: string) => (rel(x).startsWith("features/admin-view-as/") || rel(x).startsWith("app/admin/users/[id]/view/")) && !/\/route\.ts$/.test(rel(x));
    for (const f of files.filter(browserSide)) {
      expect(read(f), rel(f)).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/);
    }
  });

  it("never links to the admin's own craftsman area", () => {
    for (const f of files.filter((x) => rel(x).startsWith("features/admin-view-as/") || rel(x).startsWith("app/admin/users/[id]/view/"))) {
      expect(read(f), rel(f)).not.toMatch(/["'`]\/home(\/|["'`])/);
      expect(read(f), rel(f)).not.toMatch(/redirect\(\s*["'`]\/home/);
    }
  });

  it("re-establishes the gate in the layout and in EVERY page", () => {
    const pages = walk(VIEW_DIR).filter((f) => /\/(page|layout)\.tsx$/.test(f.replaceAll("\\", "/")));
    expect(pages.length).toBeGreaterThanOrEqual(7); // layout + dashboard + 5 sections
    for (const f of pages) expect(read(f), rel(f)).toMatch(/requireViewAs\(/);
    for (const f of pages.filter((x) => x.endsWith("page.tsx"))) expect(read(f), rel(f)).toMatch(/requireAdminRoute\("\/admin\/users"\)/);
  });

  it("is dynamic and never cached", () => {
    for (const f of walk(VIEW_DIR).filter((x) => /(page|layout)\.tsx$/.test(x))) {
      const src = read(f);
      expect(src, rel(f)).toMatch(/export const dynamic = "force-dynamic"/);
      expect(src, rel(f)).not.toMatch(/unstable_cache|revalidate\s*=\s*[1-9]|cacheLife|"use cache"/);
    }
    for (const f of files) expect(read(f), rel(f)).not.toMatch(/unstable_cache|cacheTag|"use cache"/);
  });
});

describe("Admin View-As private media route (stage 4): what it may import and call", () => {
  const src = read(MEDIA_ROUTE);
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);

  it("imports only the audited gate, the permission model, the R2 read provider and the rate limit: no shared resolver, no service role", () => {
    expect([...imports].sort()).toEqual([
      "@/lib/env/view-as",
      "@/lib/permissions/admin",
      "@/lib/storage/media-policy",
      "@/lib/supabase/server",
      "@/server/authorization/admin",
      "@/server/cache/rate-limit",
      "@/server/storage/r2-provider",
      "next/server",
    ]);
    expect(src).not.toMatch(/server\/storage\/(media|delivery)|admin-server|SUPABASE_SERVICE_ROLE_KEY|privilegedStorageClient|createAdminClient/);
    expect(imports.some((i) => i?.startsWith("@/server/actions/"))).toBe(false);
  });

  it("calls exactly ONE RPC, the audited open function, and writes nothing through the Supabase client or storage", () => {
    const rpcs = [...src.matchAll(/\.rpc\(\s*["']([a-z0-9_]+)["']/g)].map((m) => m[1]);
    expect(rpcs).toEqual(["admin_view_as_media_open"]);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\s*\(|\.storage\s*\.|PutObject|DeleteObject|createUploadUrl|commitVerifiedObject/);
  });

  it("is a same-origin-only, uncached, GET-only handler that never follows a redirect", () => {
    expect(src).toMatch(/export const dynamic = "force-dynamic"/);
    expect(src).toMatch(/get\("sec-fetch-site"\) !== "same-origin"/);
    expect(src).toMatch(/redirect: "manual"/);
    expect(src).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)\b/);
    expect(src).not.toMatch(/unstable_cache|cacheTag|"use cache"|public, max-age/);
  });

  it("repeats the authorization after the fetch (Exit, expiry or revocation cuts a file in flight)", () => {
    expect(src.match(/await open\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
