import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * THE APPROVED PALETTE, AS A MEASUREMENT.
 *
 * Every surface, ink, border, accent and focus token in `tokens.css` derives
 * from four brand colours (Deep Navy, Warm Sand, Soft Cream, Muted
 * Terracotta). Derivation by `color-mix()` is easy to get subtly wrong — a
 * muted ink that reads fine on the canvas can fall under AA on the sunk
 * surface beside it — so this file resolves the stylesheet the way a browser
 * does (custom properties, `var()` chains, `color-mix(in srgb, …)` with
 * premultiplied alpha) and measures every text/background pair the product
 * actually paints — on EVERY ground, in every palette a page can render: the
 * global light and dark tokens, and the `.installer-surface` scope (installer
 * and showroom workspaces) with its flat variant, each light and dark.
 *
 * Thresholds are WCAG 2.2 AA: 4.5:1 for body text, 3:1 for UI component
 * boundaries, focus indicators and graphical objects. There is no exception
 * list: a pair that cannot pass is fixed by changing what it is PAIRED with
 * (the navy `accent-edge` around terracotta fills, `on-status` ink on status
 * fills, terracotta INK rather than the fill for type and lines), never by
 * changing the four palette colours or by skipping a ground.
 */

type RGBA = { r: number; g: number; b: number; a: number };
type Scope = Map<string, string>;

const CSS = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");
const INSTALLER_CSS = readFileSync(join(process.cwd(), "src/styles/installer-theme.css"), "utf8");
const BRAND = ["#071a2d", "#d8c7a6", "#f2e9d8", "#b96f52"];

/** Every `--token: value` declared in the blocks whose selector is exactly `selector`. */
function block(source: string, selector: string): Scope {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Scope = new Map();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((m[1] ?? "").trim() !== selector) continue;
    for (const decl of (m[2] ?? "").split(";")) {
      const d = /^\s*(--[a-z0-9-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
      if (d?.[1] && d[2]) out.set(d[1], d[2]);
    }
  }
  return out;
}
const merge = (...scopes: Scope[]): Scope => new Map(scopes.flatMap((x) => [...x]));

/**
 * The six palettes a page can actually paint: the global light/dark tokens,
 * and the `.installer-surface` scope (installer AND showroom workspaces) with
 * its `flat` variant, each in light and dark. Later blocks override earlier
 * ones exactly as the cascade does (all of them are zero-specificity
 * `:where()` rules, so source order decides).
 */
function parseScopes(tokens: string, installer: string) {
  const light = block(tokens, ":root");
  const dark = merge(light, block(tokens, ".dark"));
  const inst = block(installer, ":where(.installer-surface)");
  const instDark = block(installer, ":where(.dark) :where(.installer-surface)");
  const flat = block(installer, ':where(.installer-surface[data-installer-theme="flat"])');
  const flatDark = block(installer, ':where(.dark) :where(.installer-surface[data-installer-theme="flat"])');
  if (!inst.size || !instDark.size || !flat.size || !flatDark.size) throw new Error("installer-theme.css scopes not found");
  return {
    light,
    dark,
    "installer-light": merge(light, inst),
    "installer-dark": merge(dark, inst, instDark),
    "installer-flat-light": merge(light, inst, flat),
    "installer-flat-dark": merge(dark, inst, instDark, flat, flatDark),
  };
}

function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function hex(value: string): RGBA {
  const h = value.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: 1,
  };
}

function resolve(value: string, scope: Scope, seen: string[] = []): RGBA {
  const v = value.trim();
  if (v.startsWith("#")) return hex(v);
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (ref?.[1]) {
    const name = ref[1];
    const next = scope.get(name);
    if (next === undefined) throw new Error(`undefined token ${name}`);
    if (seen.includes(name)) throw new Error(`cycle at ${name}`);
    return resolve(next, scope, [...seen, name]);
  }
  const mix = /^color-mix\(([\s\S]*)\)$/.exec(v);
  if (mix?.[1]) {
    const [space, a, b] = splitArgs(mix[1]);
    if (space !== "in srgb" || !a || !b) throw new Error(`unsupported color-mix: ${v}`);
    const part = (arg: string) => {
      const p = /^([\s\S]*?)\s+([\d.]+)%$/.exec(arg);
      return p?.[1] && p[2] ? { c: p[1], p: Number(p[2]) } : { c: arg, p: undefined as number | undefined };
    };
    const A = part(a);
    const B = part(b);
    let p1 = A.p ?? (B.p !== undefined ? 100 - B.p : 50);
    let p2 = B.p ?? 100 - p1;
    const sum = p1 + p2;
    const alphaScale = sum < 100 ? sum / 100 : 1;
    p1 /= sum;
    p2 /= sum;
    const c1 = resolve(A.c, scope, seen);
    const c2 = resolve(B.c, scope, seen);
    const a1 = c1.a * p1;
    const a2 = c2.a * p2;
    const alpha = a1 + a2;
    const ch = (k: "r" | "g" | "b") => (alpha === 0 ? 0 : (c1[k] * a1 + c2[k] * a2) / alpha);
    return { r: ch("r"), g: ch("g"), b: ch("b"), a: alpha * alphaScale };
  }
  throw new Error(`not a colour: ${v}`);
}

function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a);
  const ch = (k: "r" | "g" | "b") => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a;
  return { r: ch("r"), g: ch("g"), b: ch("b"), a };
}

function luminance({ r, g, b }: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg: RGBA, bg: RGBA): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SCOPES = parseScopes(CSS, INSTALLER_CSS);
const THEMES = Object.keys(SCOPES) as Theme[];
type Theme = keyof typeof SCOPES;

/** Resolve `fg` over `bg` over `base` (default: the theme's canvas), then measure. */
function measure(theme: Theme, fg: string, bg: string, base = "var(--canvas)"): number {
  const scope = SCOPES[theme];
  const ground = over(resolve(bg, scope), over(resolve(base, scope), { r: 255, g: 255, b: 255, a: 1 }));
  return ratio(over(resolve(fg, scope), ground), ground);
}

const v = (name: string) => `var(--${name})`;
const tint = (name: string, pct: number, on: string) => `color-mix(in srgb, var(--${name}) ${pct}%, var(--${on}))`;

/** Every ground a component sits on in the workspace — no subset per role. */
const GROUNDS = ["canvas", "surface", "surface-2", "surface-hover", "workspace", "field"];
/** The navy grounds: the rail, its lit rows, and the fixed dark band. */
const NAVY_GROUNDS = ["shell", "shell-lit", "basalt"];
const STATUS = ["success", "warning", "danger", "info"];

type Pair = { fg: string; bg: string; min: number; label: string; base?: string };
const PAIRS: Pair[] = [];
const text = (fg: string, bg: string, label = `${fg} on ${bg}`) => PAIRS.push({ fg, bg, min: 4.5, label });
const ui = (fg: string, bg: string, label = `${fg} on ${bg}`) => PAIRS.push({ fg, bg, min: 3, label });

// Ink, accent ink, status ink, control boundaries and focus: on EVERY ground.
for (const g of GROUNDS) {
  for (const t of ["fg", "fg-secondary", "fg-muted", "accent", "bronze-sem", "lapis-sem", "iris-sem", ...STATUS]) {
    text(v(t), v(g), `${t} on ${g}`);
  }
  for (const t of ["border-strong", "field-line", "focus", ...STATUS]) ui(v(t), v(g), `${t} (graphic) on ${g}`);
  for (let i = 1; i <= 6; i++) ui(v(`series-${i}`), v(g), `series-${i} on ${g}`);
}
// Soft status badges: `bg-<tone>/15 text-<tone>` on every ground.
for (const g of GROUNDS) {
  for (const t of [...STATUS, "accent", "iris-sem"]) {
    const fill = t === "accent" ? "accent-solid" : t;
    text(v(t), tint(fill, 15, g), `${t} on ${t}/15 badge over ${g}`);
  }
}
// Inks that sit ON a fill.
text(v("primary-foreground"), v("primary"), "primary-foreground on primary");
text(v("on-accent"), v("accent-solid"), "on-accent on accent-solid");
for (const t of STATUS) text(v("on-status"), v(t), `on-status on solid ${t}`);
text(v("field-fg"), v("field"), "field-fg on field");
text(v("field-placeholder"), v("field"), "field-placeholder on field");
text(v("field-hint"), v("field"), "field-hint on field");
// The navy rail.
for (const g of ["shell", "shell-lit"]) {
  for (const t of ["shell-fg", "shell-fg-secondary", "shell-fg-muted", "shell-accent"]) text(v(t), v(g), `${t} on ${g}`);
}
// The current rail row is the light carve, and carries its own ink. (An active
// row WITHOUT the carve keeps the shell ground, measured above.)
text(v("shell-active-fg"), v("shell-active"), "shell-active-fg on shell-active");
PAIRS.push({ fg: v("shell-accent"), bg: v("shell-gold-soft"), base: v("shell"), min: 4.5, label: "shell-accent on shell-gold-soft" });
for (const t of ["on-dark", "on-dark-secondary", "on-dark-muted"]) text(v(t), v("basalt"), `${t} on basalt`);

/**
 * THE TERRACOTTA FILL. `accent-solid` is the brand colour itself and is never
 * lightened or darkened, so it is not measured against a ground directly — on
 * the sand grounds it cannot clear 3:1. Instead every fill carries the navy
 * `accent-edge` hairline (enforced by the source scan below), and the fill's
 * BOUNDARY passes on a ground when either
 *   - the edge stands out from the ground (cream and sand grounds), or
 *   - the edge melts into the ground and the fill stands out from both
 *     (navy grounds).
 * Measured on every ground, in both themes — no ground is skipped.
 */
function fillBoundary(theme: Theme, ground: string): number {
  const edgeOnGround = measure(theme, v("accent-edge"), ground);
  if (edgeOnGround >= 3) return edgeOnGround;
  return Math.min(measure(theme, v("accent-solid"), ground), measure(theme, v("accent-solid"), v("accent-edge")));
}
const FILL_GROUNDS = [...GROUNDS, ...NAVY_GROUNDS];

describe("brand palette", () => {
  it("declares the four approved colours as the palette roots", () => {
    for (const name of ["deep-navy", "warm-sand", "soft-cream", "muted-terracotta"]) {
      const value = SCOPES.light.get(`--${name}`)?.toLowerCase();
      expect(BRAND).toContain(value);
    }
  });

  it("uses no raw hex outside the palette roots and the semantic status tones", () => {
    const allowed = new Set([
      ...BRAND,
      // Semantic status tones: success, warning, danger, info (light / dark).
      ...["--status-success", "--status-warning", "--status-danger", "--status-info"].flatMap((n) => [
        SCOPES.light.get(n),
        SCOPES.light.get(`${n}-bright`),
      ]),
    ]);
    const raw = [...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(raw.filter((h) => !allowed.has(h))).toEqual([]);
  });
});

describe.each(THEMES)("WCAG AA contrast — %s", (theme) => {
  it.each(PAIRS)("$label ≥ $min:1", ({ fg, bg, min, base }) => {
    expect(measure(theme, fg, bg, base)).toBeGreaterThanOrEqual(min);
  });
  it.each(FILL_GROUNDS)("terracotta fill boundary on %s ≥ 3:1", (ground) => {
    expect(fillBoundary(theme, v(ground))).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The fill-boundary measurement above holds only if every terracotta fill in
 * the product actually draws the edge. These scans make that a fact of the
 * source, not a convention: a new `bg-accent-solid` without its edge, or the
 * raw fill colour used as type or as a line, fails here.
 */
function walk(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full, ext);
    return ext.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}
const SRC = join(process.cwd(), "src");

describe("terracotta pairing in source", () => {
  const sources = walk(SRC, /\.tsx?$/).map((f) => ({ f, s: readFileSync(f, "utf8") }));

  it("every solid bg-accent-solid class string also draws the navy accent-edge", () => {
    const offenders: string[] = [];
    for (const { f, s } of sources) {
      for (const m of s.matchAll(/"[^"\n]*"|`[^`]*`|'[^'\n]*'/g)) {
        const str = m[0];
        if (/(?<![\w-])bg-accent-solid(?![\w/-])/.test(str) && !/(ring|border)-accent-edge\b/.test(str)) {
          offenders.push(`${f.replace(SRC, "src")}: ${str.slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never uses the raw terracotta fill as type, a line or a ring (use `accent`)", () => {
    const offenders = sources.flatMap(({ f, s }) =>
      [...s.matchAll(/(?<![\w-])(text|border|ring|stroke|fill|outline|decoration|divide)-accent-solid(?![\w/-])/g)].map(
        (m) => `${f.replace(SRC, "src")}: ${m[0]}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("every stylesheet rule that paints a terracotta fill also draws the navy accent-edge", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC, /\.css$/)) {
      const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const [, selector = "", body = ""] = rule;
        // Text selection is not a component: navy ink on the fill, nothing to bound.
        if (/::selection/.test(selector)) continue;
        if (/background(-color)?:\s*var\(--(accent-solid|lumen|muted-terracotta)\)/.test(body) && !/accent-edge/.test(body)) {
          offenders.push(`${f.replace(SRC, "src")}: ${selector.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** `PALETTE_REPORT=1 pnpm vitest run src/styles/palette-contrast.test.ts` prints the table. */
if (process.env.PALETTE_REPORT) {
  for (const theme of THEMES) {
    const rows = [
      ...PAIRS.map((p) => ({ ...p, r: measure(theme, p.fg, p.bg, p.base) })),
      ...FILL_GROUNDS.map((g) => ({ min: 3, label: `terracotta fill boundary on ${g}`, r: fillBoundary(theme, v(g)) })),
    ].sort((a, b) => a.r - b.r);
    console.log(`\n${theme}\n` + rows.map((x) => `${x.r.toFixed(2).padStart(6)}  (min ${x.min})  ${x.label}`).join("\n"));
  }
}
