/**
 * THE UI FOUNDATION GUARD — pure data and regexes only.
 *
 * Split out of `eslint.config.mjs` so this module can be imported with no side
 * effects: `eslint.config.mjs` itself calls `FlatCompat#extends("next/core-web-vitals", …)`
 * at module load, which resolves Next's real ESLint config chain — fine for
 * ESLint's own process, but not something a Vitest run should trigger just to
 * exercise a regex. `src/lint/foundation-guard.test.ts` imports straight from
 * here.
 *
 * It locks in what is ALREADY TRUE rather than demanding a migration: a sweep of
 * `src/**` at the time this was written found zero raw hex values in component
 * code, zero arbitrary Tailwind colour values and zero escapes to Tailwind's
 * default palette. That discipline was holding by convention alone, which is
 * exactly the kind of thing that decays silently — one page in a hurry, and the
 * next author has a precedent.
 *
 * Four checks, all mechanical, all cheap:
 *
 *   1. No raw hex colour in component code. Colour belongs in `tokens.css`.
 *   2. No arbitrary Tailwind colour value — `bg-[#123456]`, `text-[rgb(...)]`.
 *      These bypass the token layer while looking like Tailwind.
 *   3. No Tailwind DEFAULT-palette colour — `bg-slate-500`, `text-blue-600`.
 *      These are the most dangerous of the three because they look canonical and
 *      are theme-blind: a `slate-500` is the same grey in light and dark, so it
 *      silently breaks one theme.
 *   4. No unknown SEMANTIC utility — see `UNKNOWN_SEMANTIC_UTILITY` below.
 *
 * WHAT THE ALLOW-LIST IS FOR. The foundation files themselves must be able to
 * write colour — that is their job — and generated types and brand artwork carry
 * literal values by nature. The list is deliberately short: if it grows, the
 * rule has stopped meaning anything.
 *
 * Everything here is a regex over source text. That is a real limitation and it
 * is the right trade: a proper AST rule for "is this string a Tailwind class"
 * needs a Tailwind resolver in the lint process, and a custom plugin is a
 * maintenance surface of its own. The regexes have false-negative risk (a class
 * built by string concatenation slips through) and near-zero false-positive
 * risk, which is the correct direction for a guard nobody should have to argue
 * with.
 */
export const HEX = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b`;
export const ARBITRARY_COLOR = String.raw`\b(?:bg|text|border|ring|fill|stroke|shadow|from|via|to|outline|decoration|accent|caret|divide)-\[(?:#|rgb|rgba|hsl|hsla)`;
export const TAILWIND_PALETTE = String.raw`\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|placeholder)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d{3})\b`;

/**
 * THE FOURTH CHECK: an unknown SEMANTIC utility — a class that is syntactically
 * indistinguishable from a real token (no hex, no `[...]`, no default-palette
 * family) but names something that is not actually declared anywhere, so
 * Tailwind emits no rule for it at all and the element silently gets no
 * colour. This is the exact class of defect the Increment 11/12 sessions found
 * by hand — `bg-surface-sunken`, `text-warning-fg`/`bg-warning-fg`,
 * `border-line`, `text-heading` — each one a plausible-sounding name that
 * simply does not exist.
 *
 * THE ALLOW-LIST IS THE FLATTENED `colors` OBJECT FROM `tailwind.config.ts`
 * (plus `borderColor`/`ringColor`), transcribed by hand rather than imported:
 * `eslint.config.mjs` runs as plain Node ESM with no TypeScript loader, so it
 * cannot `import` a `.ts` config file the way the Next.js build can. This is
 * the SAME trade-off `TAILWIND_PALETTE` above already accepts (a hardcoded
 * list, not a live resolver) — extending the existing rule's own philosophy
 * rather than introducing a build-time Tailwind resolution step. A real new
 * token added to `tailwind.config.ts` needs one matching line added here,
 * which is a reviewable, occasional edit — nothing like the silent-typo
 * failure mode this check exists to catch.
 */
export const KNOWN_SEMANTIC_TOKENS = [
  "canvas",
  "workspace",
  "workspace-line",
  "shell",
  "shell-lit",
  "shell-deep",
  "shell-2",
  "shell-line",
  "shell-fg",
  "shell-fg-secondary",
  "shell-fg-muted",
  "shell-active",
  "shell-active-fg",
  "shell-gold",
  "shell-gold-soft",
  "field",
  "field-line",
  "field-fg",
  "field-placeholder",
  "field-hint",
  "field-focus",
  "surface",
  "surface-2",
  "surface-hover",
  "fg",
  "fg-secondary",
  "fg-muted",
  "primary",
  "primary-foreground",
  "accent",
  "accent-solid",
  "on-accent",
  "bronze",
  "lapis",
  "iris",
  "iris-solid",
  "success",
  "warning",
  "danger",
  "info",
  "focus",
  "series-1",
  "series-2",
  "series-3",
  "series-4",
  "series-5",
  "series-6",
  "chart-grid",
  // `borderColor.strong` — the ONE non-DEFAULT entry outside `colors` itself.
  "strong",
  // `brand.*` — fixed primitives, Tailwind-flattened as `brand-<key>`.
  "brand-basalt",
  "brand-basalt-2",
  "brand-basalt-3",
  "brand-limestone",
  "brand-plaster",
  "brand-sand",
  "brand-ink",
  "brand-lumen",
  "brand-lumen-deep",
  "brand-lumen-ink",
  "brand-lumen-soft",
  "brand-bronze",
  "brand-bronze-deep",
  "brand-bronze-ink",
  "brand-lapis",
  "brand-lapis-bright",
  "brand-iris",
  "brand-iris-deep",
  "brand-iris-ink",
  "brand-iris-bright",
  "brand-verdigris",
  "brand-verdigris-deep",
  "brand-ochre",
  "brand-ochre-deep",
  "brand-oxide",
  "brand-stone",
  "brand-stone-muted",
  "brand-graphite",
];

/**
 * `text-*` is the one prefix that is legitimately overloaded: it carries
 * BOTH colour (`text-fg`) and this app's own type-scale ROLE (`text-title`),
 * from `tailwind.config.ts`'s `fontSize` object — a small, deliberately
 * closed set that changes far less often than the colour palette does.
 */
export const FONT_SIZE_ROLES = [
  "display",
  "display-ar",
  "headline",
  "title",
  "body",
  "body-lg",
  "label",
  "caption",
  "mono",
];

/**
 * Tailwind's OWN built-in, non-colour vocabulary for these same prefixes —
 * sides, logical properties and line styles. This is Tailwind's fixed
 * surface area, not this design system's, so — unlike `KNOWN_SEMANTIC_TOKENS`
 * — it essentially never needs a new entry.
 */
export const NATIVE_UTILITY_KEYWORDS = [
  "t",
  "r",
  "b",
  "l",
  "s",
  "e",
  "x",
  "y",
  "inset",
  "none",
  "solid",
  "dashed",
  "dotted",
  "double",
  "hidden",
  "wavy",
  "collapse",
  "separate",
  "start",
  "end",
  "center",
  "left",
  "right",
  "justify",
  "nowrap",
  "wrap",
  "balance",
  "pretty",
  "clip",
  "ellipsis",
  // Universal Tailwind keywords, not part of any themed colour family: a
  // transparent border/stop is structural, and `white`/`black` are the
  // deliberate absolutes used on photo/video overlays (a thumbnail's play
  // button or duration badge is never theme-aware — it sits on an image).
  "transparent",
  "white",
  "black",
  // `bg-gradient-to-*` direction utilities. Same `bg-` prefix as every colour
  // utility, but this is Tailwind's OWN fixed direction vocabulary, not a
  // colour token — `gradient-to-b` was being read as an unknown colour name.
  "gradient-to-t",
  "gradient-to-tr",
  "gradient-to-r",
  "gradient-to-br",
  "gradient-to-b",
  "gradient-to-bl",
  "gradient-to-l",
  "gradient-to-tl",
];

const KNOWN_UTILITY_SUFFIX = [...KNOWN_SEMANTIC_TOKENS, ...FONT_SIZE_ROLES, ...NATIVE_UTILITY_KEYWORDS].join("|");

/**
 * `prefix-word[-word...]` where `word[-word...]` is NOT one of the known
 * suffixes above, immediately followed by a class boundary (end of string,
 * whitespace, quote/backtick, or `/` for an opacity modifier). The boundary
 * check is what lets a KNOWN compound token (`accent-solid`) clear a
 * candidate that merely starts with a shorter known word (`accent`) — the
 * lookahead only succeeds when the known alternative is the WHOLE suffix, not
 * a prefix of it, so `bg-surface-sunken` still matches (nothing in the list
 * is exactly "surface-sunken") while `bg-surface` and `bg-accent-solid` do
 * not (each is exactly a listed entry).
 *
 * DELIBERATELY NARROWER than `TAILWIND_PALETTE`'s prefix list: `shadow`,
 * `accent` and `caret` are left out. `shadow-*` is a different small
 * vocabulary (`sm`/`card`/`lg`/`glow`) this check does not yet cover, and
 * bare `accent-`/`caret-` name the NATIVE `accent-color`/`caret-color`
 * utilities (a different axis from this app's own `accent` colour token) —
 * both are a future narrow addition, not this one.
 *
 * `ring(?!-offset-)`: `ring-offset-canvas`/`ring-offset-surface` are the
 * OFFSET ring's own colour, a completely different Tailwind utility family
 * from `ring-<colour>` that merely happens to share the `ring-` substring —
 * without this exclusion every `focus-visible:ring-offset-canvas` in the
 * product (the single most common focus-ring pattern here) would false-flag.
 *
 * `[trblsexy]-\d+`: Tailwind's side-plus-width border compounds
 * (`border-b-0`, `border-t-2`, `border-s-2`, …) are a NUMBER appended to a
 * native side keyword, which `KNOWN_UTILITY_SUFFIX` — a plain word list —
 * cannot express as entries. A second lookahead branch covers the whole
 * family without enumerating every side/width pair by hand.
 *
 * LEADING `(?:^|[\s:])` INSTEAD OF `\b`: a real utility class always starts
 * at the beginning of a class-list string, after a space, or after a variant
 * `:` — never after a comma or another letter. Plain `\b` also fired inside
 * two unrelated shapes that merely CONTAIN one of these prefix words: a CSS
 * property name inside a `transition-[...]` arbitrary value
 * (`transition-[border-color,box-shadow]` — "border-color" is a property
 * list, not a class) and ordinary English text in an unrelated string literal
 * (a test description reading "...remaining-to-next-level..." — "to-" is not
 * a class prefix there at all). Anchoring the prefix's leading edge to
 * start/space/colon excludes both without touching any real class, which is
 * always preceded by one of those three.
 */
export const UNKNOWN_SEMANTIC_UTILITY = String.raw`(?:^|[\s:])(?:bg|text|border|fill|stroke|outline|decoration|divide|placeholder|from|via|to|ring(?!-offset-))-(?!(?:${KNOWN_UTILITY_SUFFIX})(?:[^a-z0-9-]|$)|[trblsexy]-\d+(?:[^a-z0-9-]|$))[a-z][a-z0-9-]*\b`;

/**
 * Files allowed to write colour literals.
 *
 *   tokens.css / globals.css / tailwind.config — the token layer itself.
 *   icons.tsx / brand.tsx                      — brand artwork with fixed inks.
 *   charts.tsx                                 — series colours resolved from
 *                                                tokens at runtime, but the file
 *                                                also carries literal fallbacks
 *                                                for canvas contexts.
 *   database.types.ts                          — generated.
 *   lint/foundation-guard.test.ts               — exercises this guard's own
 *                                                regexes against deliberately
 *                                                bad fixture strings; its job
 *                                                IS to contain them.
 */
export const FOUNDATION_FILES = [
  "src/styles/**",
  "src/app/globals.css",
  "tailwind.config.ts",
  "src/components/ui/icons.tsx",
  "src/components/layout/brand.tsx",
  "src/components/ui/charts.tsx",
  "src/types/database.types.ts",
  "src/lint/foundation-guard.test.ts",
];
