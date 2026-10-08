import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PRODUCTION MUST NOT REACH THE PREVIEW'S FIXTURES.
 *
 * `/home/jobs` and `/home/work` render the SAME presentation as the two preview
 * routes, but their data comes only from real queries. This walks every
 * (value) import reachable from each production route and fails if any of them
 * leads to a fixture module, a preview adapter, a preview wrapper, or a preview
 * route. A guard on the import graph, not on names in the output: it is what stops
 * a future refactor from quietly making production depend on demo data again.
 *
 * Type-only imports are erased at build time and carry no runtime dependency, so
 * they are skipped.
 */

const SRC = path.resolve(__dirname, "../..");

const FORBIDDEN: { name: string; test: RegExp }[] = [
  { name: "a fixture module (preview-data)", test: /(^|\/)preview-data\.ts$/ },
  { name: "a fixture module (mock-data)", test: /(^|\/)mock-data\.ts$/ },
  { name: "a preview adapter", test: /(^|\/)preview-adapter\.ts$/ },
  { name: "a preview wrapper", test: /installer-(job-opportunities|my-work)-preview\.tsx$/ },
  { name: "a preview route", test: /(^|\/)app\/preview\// },
];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package: not our code
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Value imports only: `import x from`, `import { a } from`, `import "x"`, `export … from`, `import("x")`. */
function valueImports(source: string): string[] {
  const specs: string[] = [];
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of stripped.matchAll(statement)) {
    if (m[2]) continue; // `import type` / `export type`
    specs.push(m[4]!);
  }
  for (const m of stripped.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) specs.push(m[1]!);
  for (const m of stripped.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]!);
  return specs;
}

function reach(entry: string): Map<string, string | null> {
  const seen = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      const resolved = resolveImport(file, spec);
      if (resolved && !seen.has(resolved)) {
        seen.set(resolved, file);
        queue.push(resolved);
      }
    }
  }
  return seen;
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

function violations(entry: string): string[] {
  const seen = reach(entry);
  const out: string[] = [];
  for (const [file, importer] of seen) {
    const hit = FORBIDDEN.find((f) => f.test.test(rel(file)));
    if (hit) out.push(`${rel(file)} (${hit.name}) <- imported by ${importer ? rel(importer) : "entry"}`);
  }
  return out;
}

describe("production installer routes have no transitive dependency on preview fixtures", () => {
  for (const route of ["app/home/jobs/page.tsx", "app/home/work/page.tsx"]) {
    it(`${route}`, () => {
      const entry = path.join(SRC, route);
      expect(existsSync(entry)).toBe(true);
      // The walk really did traverse the shared presentation (the check is not vacuous).
      expect(reach(entry).size).toBeGreaterThan(8);
      expect(violations(entry)).toEqual([]);
    });
  }

  it("does reach the shared presentation modules, so a guard failure would be meaningful", () => {
    const jobs = [...reach(path.join(SRC, "app/home/jobs/page.tsx")).keys()].map(rel);
    expect(jobs).toContain("features/installer-job-opportunities-preview/installer-job-opportunities-view.tsx");
    const work = [...reach(path.join(SRC, "app/home/work/page.tsx")).keys()].map(rel);
    expect(work).toContain("features/installer-my-work-preview/installer-my-work-view.tsx");
  });

  it("the detector itself flags a preview import (it is not blind)", () => {
    const wrapper = path.join(SRC, "features/installer-my-work-preview/installer-my-work-preview.tsx");
    expect(violations(wrapper).length).toBeGreaterThan(0);
    const previewRoute = path.join(SRC, "app/preview/installer-job-opportunities/page.tsx");
    expect(violations(previewRoute).length).toBeGreaterThan(0);
  });
});
