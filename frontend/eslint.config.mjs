import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import {
  HEX,
  ARBITRARY_COLOR,
  TAILWIND_PALETTE,
  UNKNOWN_SEMANTIC_UTILITY,
  FOUNDATION_FILES,
} from "./eslint/ui-foundation-guard.mjs";

// The guard's regexes and allow-lists live in ./eslint/ui-foundation-guard.mjs
// — a dependency-free module so `src/lint/foundation-guard.test.ts` can
// import it directly without also loading this file's Next.js ESLint configs,
// which resolve Next's real ESLint plugin chain as a side effect of module
// load and have no place running inside a Vitest process.

const eslintConfig = [
  // eslint-config-next 16 ships native flat configs (the FlatCompat bridge no longer loads them).
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".open-next/**", ".wrangler/**", "cloudflare/worker.ts"],
  },
  {
    // Next.js 16 upgrade: eslint-config-next 16 turns on eslint-plugin-react-hooks v7's
    // React Compiler rules as errors. They did not exist before the upgrade and flag ~50
    // existing call sites (mostly setState inside an effect). They stay visible as
    // warnings until those components are refactored one by one; do not add new hits.
    name: "aladdin/next16-react-compiler-rules",
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/globals": "warn",
    },
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
          selector: "JSXOpeningElement[name.name='select']",
          message:
            "Raw native <select>. Use Select from @/components/ui/controls (native-compatible API) or SelectMenu from @/components/ui/select-menu — one dropdown design everywhere.",
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
