import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * NO COLOUR MAY CARRY AN OFF-SCALE OPACITY MODIFIER.
 *
 * WHY THIS TEST EXISTS
 * Tailwind's opacity scale runs in steps of five (plus 0 and 100). Ask it for
 * `bg-danger/18` and it does not warn, does not error, and emits NO RULE — the
 * class stays in the markup, the element renders with no background, and the
 * failure is invisible in code review because the class name looks perfectly
 * reasonable. It is only findable by sampling rendered pixels.
 *
 * That silence has now cost real UI three separate times in this repository:
 *
 *   1. Every soft badge tone in the product (`bg-accent-solid/15` and friends)
 *      was transparent everywhere, along with table, nav and menu hover states —
 *      the bug that `tailwind.config`'s `alpha()`/`color-mix` helper was written
 *      to fix. That was a different mechanism (a `var()` Tailwind could not
 *      split) with the identical symptom.
 *   2. The `Panel` header washes (`bg-iris-solid/8` …) shipped dead. The tone
 *      prop was threaded through every panel on the supply dashboard and did
 *      nothing at all; the headers rendered flat, and it read as "the colour did
 *      not work" rather than as a bug.
 *   3. Raising the KPI tiles from 15% to 18% to make them MORE visible removed
 *      every tile background on the strip.
 *
 * A grep is a crude test. It is also the only kind that catches this class of
 * defect before a human sees it, it runs in milliseconds, and it would have
 * caught all three.
 *
 * Arbitrary values in square brackets (`bg-danger/[0.18]`) are legitimate and
 * deliberately not matched — that syntax compiles, and requiring brackets is how
 * a genuinely non-standard alpha gets asked for on purpose.
 */

/** Tailwind's opacity scale: 0, 100, and every multiple of five between. */
const ON_SCALE = new Set(Array.from({ length: 21 }, (_, i) => i * 5));

/** `bg-iris-solid/20`, `text-fg-muted/50`, `border-accent-solid/50` … */
const MODIFIER = /\b(?:bg|text|border|ring|divide|outline|from|via|to|shadow|accent|caret|fill|stroke|placeholder|decoration)-[a-z0-9-]+\/(\d+)\b/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("Tailwind opacity modifiers", () => {
  it("are all on the scale, so none of them compiles to nothing", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // The rule's own documentation quotes off-scale examples; a test that
        // fails on the comment explaining it would be its own worst enemy.
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        for (const match of code.matchAll(MODIFIER)) {
          const value = Number(match[1]);
          if (!ON_SCALE.has(value)) {
            offenders.push(
              `${file.replace(process.cwd(), "").replace(/\\/g, "/")}:${i + 1}  ${match[0]}`,
            );
          }
        }
      });
    }

    expect(
      offenders,
      `These classes compile to NO CSS RULE — Tailwind's opacity scale runs in ` +
        `steps of five. Round to the nearest step, or use an arbitrary value ` +
        `(\`/[0.18]\`) if the exact alpha genuinely matters:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
