import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GRID IS THE DEFAULT WHEREVER A PAGE OFFERS BOTH GRID AND LIST.
 *
 * The audit of the whole Production frontend found exactly three views with both modes. This guard keeps that true: a
 * view that offers a Grid / List toggle must open on Grid (there is no persisted preference anywhere, so the first
 * render is the default and the choice lasts for the visit), and a NEW page that adds the toggle cannot start on List.
 * Pages that have no such toggle are not given one.
 *
 *   ROUTE (Production)        VIEW                                                       TOGGLE   DEFAULT
 *   /home/jobs                installer-job-opportunities-preview/…-view.tsx             yes      grid
 *   /home/work                installer-my-work-preview/installer-my-work-view.tsx       yes      grid
 *   /home/reviews             installer-reviews-preview/installer-reviews-preview.tsx    yes      grid
 *   every other route         (no Grid / List toggle)                                     no       n/a
 */

const SRC = path.resolve(__dirname, "../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

const files = sourceFiles(SRC).map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join("/"), text: readFileSync(f, "utf8") }));
/** A file offers BOTH modes when it renders a pressed-state toggle for each (or the bilingual Grid / List labels). */
const offersBoth = (text: string) =>
  (/aria-pressed=\{view === "grid"\}/.test(text) && /aria-pressed=\{view === "list"\}/.test(text)) ||
  (/active=\{view === "grid"\}/.test(text) && /active=\{view === "list"\}/.test(text));

describe("Grid is the default wherever Grid and List both exist", () => {
  const withToggle = files.filter((f) => offersBoth(f.text));

  it("the audit finds exactly the three known views", () => {
    expect(withToggle.map((f) => f.rel).sort()).toEqual([
      "features/installer-job-opportunities-preview/installer-job-opportunities-view.tsx",
      "features/installer-my-work-preview/installer-my-work-view.tsx",
      "features/installer-reviews-preview/installer-reviews-preview.tsx",
    ]);
  });

  it.each(withToggle.map((f) => [f.rel, f.text] as const))("%s opens on grid", (_rel, text) => {
    const initial = text.match(/const \[view, setView\] = useState<[^>]+>\("(grid|list)"\)/);
    expect(initial, "the view state must be a plain useState with a literal default").toBeTruthy();
    expect(initial![1]).toBe("grid");
  });

  it("the toggle offers Grid first and names it 'Grid view' / 'عرض الشبكة' in both languages", () => {
    for (const rel of ["features/installer-my-work-preview/installer-my-work-view.tsx", "features/installer-reviews-preview/installer-reviews-preview.tsx"]) {
      const text = files.find((f) => f.rel === rel)!.text;
      expect(text, rel).toContain("عرض الشبكة");
      expect(text, rel).toContain("Grid view");
      expect(text.indexOf("Grid view"), rel).toBeLessThan(text.indexOf("List view"));
    }
  });

  it("no view reads a stored preference to override the default (there is no persistence system to honour)", () => {
    for (const f of withToggle) expect(f.text, f.rel).not.toMatch(/localStorage|sessionStorage|document\.cookie|searchParams[^;\n]*view/);
  });
});
