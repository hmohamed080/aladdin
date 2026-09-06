import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import {
  HEX,
  ARBITRARY_COLOR,
  TAILWIND_PALETTE,
  UNKNOWN_SEMANTIC_UTILITY,
  FOUNDATION_FILES,
} from "./eslint/ui-foundation-guard.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

// The guard's regexes and allow-lists live in ./eslint/ui-foundation-guard.mjs
// — a dependency-free module so `src/lint/foundation-guard.test.ts` can
// import it directly without also triggering this file's `compat.extends(...)`,
// which resolves Next's real ESLint config chain as a side effect of module
// load and has no place running inside a Vitest process.

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
        {
          selector: `Literal[value=/${UNKNOWN_SEMANTIC_UTILITY}/]`,
          message:
            "Unknown semantic utility — this name is not declared in tailwind.config.ts, so Tailwind emits no rule for it and the element silently gets no colour (the bg-surface-sunken / text-warning-fg / border-line / text-heading class of defect). Check the exact token name in src/styles/tokens.css, or add it to tailwind.config.ts (and eslint/ui-foundation-guard.mjs's KNOWN_SEMANTIC_TOKENS) if it is genuinely new. See docs/frontend/UI_CONTRACT.md.",
        },
        {
          selector: `TemplateElement[value.raw=/${UNKNOWN_SEMANTIC_UTILITY}/]`,
          message:
            "Unknown semantic utility in a template literal — not declared in tailwind.config.ts, so it silently emits no CSS. See docs/frontend/UI_CONTRACT.md.",
        },
      ],
    },
  },
];

export default eslintConfig;
