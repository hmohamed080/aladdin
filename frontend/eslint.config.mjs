import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * THE UI FOUNDATION GUARD.
 *
 * It locks in what is ALREADY TRUE rather than demanding a migration: a sweep of
 * `src/**` at the time this was written found zero raw hex values in component
 * code, zero arbitrary Tailwind colour values and zero escapes to Tailwind's
 * default palette. That discipline was holding by convention alone, which is
 * exactly the kind of thing that decays silently — one page in a hurry, and the
 * next author has a precedent.
 *
 * Three rules, all mechanical, all cheap:
 *
 *   1. No raw hex colour in component code. Colour belongs in `tokens.css`.
 *   2. No arbitrary Tailwind colour value — `bg-[#123456]`, `text-[rgb(...)]`.
 *      These bypass the token layer while looking like Tailwind.
 *   3. No Tailwind DEFAULT-palette colour — `bg-slate-500`, `text-blue-600`.
 *      These are the most dangerous of the three because they look canonical and
 *      are theme-blind: a `slate-500` is the same grey in light and dark, so it
 *      silently breaks one theme.
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
const HEX = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b`;
const ARBITRARY_COLOR = String.raw`\b(?:bg|text|border|ring|fill|stroke|shadow|from|via|to|outline|decoration|accent|caret|divide)-\[(?:#|rgb|rgba|hsl|hsla)`;
const TAILWIND_PALETTE = String.raw`\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|placeholder)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d{3})\b`;

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
 */
const FOUNDATION_FILES = [
  "src/styles/**",
  "src/app/globals.css",
  "tailwind.config.ts",
  "src/components/ui/icons.tsx",
  "src/components/layout/brand.tsx",
  "src/components/ui/charts.tsx",
  "src/types/database.types.ts",
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  {
    name: "aladdin/ui-foundation",
    files: ["src/**/*.{ts,tsx}"],
    ignores: FOUNDATION_FILES,
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=/${HEX}/]`,
          message:
            "Raw hex colour. Use a semantic token from src/styles/tokens.css (e.g. text-fg, bg-surface, text-on-accent). If no token expresses what you need, that is a foundation gap — report it before adding a literal. See docs/frontend/UI_CONTRACT.md.",
        },
        {
          selector: `TemplateElement[value.raw=/${HEX}/]`,
          message:
            "Raw hex colour in a template literal. Use a semantic token from src/styles/tokens.css. See docs/frontend/UI_CONTRACT.md.",
        },
        {
          selector: `Literal[value=/${ARBITRARY_COLOR}/]`,
          message:
            "Arbitrary Tailwind colour value bypasses the token layer. Use a semantic utility (bg-surface, text-fg-secondary, border-strong, text-on-accent). See docs/frontend/UI_CONTRACT.md.",
        },
        {
          selector: `TemplateElement[value.raw=/${ARBITRARY_COLOR}/]`,
          message:
            "Arbitrary Tailwind colour value bypasses the token layer. Use a semantic utility. See docs/frontend/UI_CONTRACT.md.",
        },
        {
          selector: `Literal[value=/${TAILWIND_PALETTE}/]`,
          message:
            "Tailwind default-palette colour. These are theme-blind — the same value in light and dark — so they silently break one theme. Use a semantic token. See docs/frontend/UI_CONTRACT.md.",
        },
        {
          selector: `TemplateElement[value.raw=/${TAILWIND_PALETTE}/]`,
          message:
            "Tailwind default-palette colour is theme-blind. Use a semantic token. See docs/frontend/UI_CONTRACT.md.",
        },
      ],
    },
  },
];

export default eslintConfig;
