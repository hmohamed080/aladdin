import type { Config } from "tailwindcss";

/**
 * Resolve one theme variable into a Tailwind colour that HONOURS the opacity
 * modifier (`bg-surface-2/60`, `bg-danger/10`, `border-accent-solid/50`).
 *
 * WHY THIS EXISTS
 * Every Aladdin colour is a CSS variable, and a variable is opaque to Tailwind's
 * build-time colour parser: it cannot split `var(--surface-2)` into channels, so
 * it cannot synthesise an alpha. Faced with `bg-surface-2/60` it did not warn and
 * did not error — it emitted NO RULE AT ALL. The class stayed in the markup, the
 * element rendered with no background, and the failure was invisible.
 *
 * That silence had cost real states: table header and row hover, admin nav hover,
 * profile-menu hover, sidebar mode and workspace-switcher selection, the collapsed
 * active rail tile, and EVERY soft badge tone (`bg-accent-solid/15`,
 * `bg-success/15`, `bg-danger/15` …) were transparent everywhere in the product.
 *
 * `color-mix` moves the alpha from build time to the browser, where `var()` finally
 * has a value. It composites against the ACTIVE THEME's own token, so one rule is
 * correct on Limestone and on Carbon — which a hardcoded rgba fallback could never
 * be. Applied to every token (semantic, series and brand primitive) so no future
 * `/NN` can quietly evaporate again.
 */
function alpha(token: string) {
  // `<alpha-value>` is Tailwind's own substitution point: it becomes the modifier
  // (`/60` → `0.6`) when one is present and `1` when it is not, so a single string
  // serves `bg-surface-2` and `bg-surface-2/60` alike. Mixing 100% against
  // transparent is exactly the flat colour, so the no-modifier case is unchanged.
  return `color-mix(in srgb, var(${token}) calc(<alpha-value> * 100%), transparent)`;
}

/**
 * Aladdin Tailwind theme — mirrors DESIGN.md ("The Aperture").
 * Concrete values live as CSS variables in `src/styles/tokens.css`; this file
 * only maps them to Tailwind's scale. Semantic colors are theme-aware (they
 * switch under the `dark` class); `brand.*` are the fixed primitives for the
 * Aperture mark, brand artwork, and verification seals.
 */
export default {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  // Light + Dark from the design system; toggled via a `dark` class on <html>.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ---- Semantic (theme-aware) ----
        canvas: alpha("--canvas"),
        surface: {
          DEFAULT: alpha("--surface"),
          2: alpha("--surface-2"),
          /* The named hover ground. Still explicit — a token beats an opacity
             modifier for a state the design system has an opinion about. */
          hover: alpha("--surface-hover"),
        },
        fg: {
          DEFAULT: alpha("--fg"),
          secondary: alpha("--fg-secondary"),
          muted: alpha("--fg-muted"),
        },
        primary: {
          DEFAULT: alpha("--primary"),
          foreground: alpha("--primary-foreground"),
        },
        accent: {
          DEFAULT: alpha("--accent"),
          solid: alpha("--accent-solid"),
        },
        bronze: alpha("--bronze-sem"),
        lapis: alpha("--lapis-sem"),
        // The analytic accent. Same DEFAULT/solid contract as `accent`: the
        // DEFAULT is the AA-safe tone for type and strokes, `iris-solid` is the
        // fill. See tokens.css for why a second accent exists at all.
        iris: {
          DEFAULT: alpha("--iris-sem"),
          solid: alpha("--iris-solid"),
        },
        success: alpha("--success"),
        warning: alpha("--warning"),
        danger: alpha("--danger"),
        info: alpha("--info"),
        focus: alpha("--focus"),

        // ---- Categorical data-visualisation series (theme-aware) ----
        // Six distinguishable fills for charts that plot more than one thing.
        // Non-semantic by design: series-1 is not "good" and series-5 is not
        // "bad" — semantic meaning stays with success/warning/danger.
        series: {
          1: alpha("--series-1"),
          2: alpha("--series-2"),
          3: alpha("--series-3"),
          4: alpha("--series-4"),
          5: alpha("--series-5"),
          6: alpha("--series-6"),
        },
        "chart-grid": alpha("--chart-grid"),

        // ---- Fixed primitives (brand artwork, mark, seals) ----
        brand: {
          basalt: alpha("--basalt"),
          "basalt-2": alpha("--basalt-2"),
          "basalt-3": alpha("--basalt-3"),
          limestone: alpha("--limestone"),
          plaster: alpha("--plaster"),
          sand: alpha("--sand"),
          ink: alpha("--ink"),
          lumen: alpha("--lumen"),
          "lumen-deep": alpha("--lumen-deep"),
          "lumen-ink": alpha("--lumen-ink"),
          "lumen-soft": alpha("--lumen-soft"),
          bronze: alpha("--bronze"),
          "bronze-deep": alpha("--bronze-deep"),
          "bronze-ink": alpha("--bronze-ink"),
          lapis: alpha("--lapis"),
          "lapis-bright": alpha("--lapis-bright"),
          iris: alpha("--iris"),
          "iris-deep": alpha("--iris-deep"),
          "iris-ink": alpha("--iris-ink"),
          "iris-bright": alpha("--iris-bright"),
          verdigris: alpha("--verdigris"),
          "verdigris-deep": alpha("--verdigris-deep"),
          ochre: alpha("--ochre"),
          "ochre-deep": alpha("--ochre-deep"),
          oxide: alpha("--oxide"),
          stone: alpha("--stone"),
          "stone-muted": alpha("--stone-muted"),
          graphite: alpha("--graphite"),
        },
      },
      borderColor: {
        DEFAULT: alpha("--border"),
        strong: alpha("--border-strong"),
      },
      ringColor: {
        DEFAULT: alpha("--focus"),
      },
      fontFamily: {
        // Readex Pro — bilingual (AR + EN) product UI workhorse; the default.
        sans: ["var(--font-readex)", "system-ui", "sans-serif"],
        // Archivo — Latin brand & display.
        display: ["var(--font-archivo)", "system-ui", "sans-serif"],
        // Reem Kufi — Arabic brand & display.
        "display-ar": ["var(--font-reem-kufi)", "sans-serif"],
        // JetBrains Mono — EGP figures, RFQ/quote codes, quantities.
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: [
          "clamp(2rem, 4vw, 3.25rem)",
          { lineHeight: "1.02", letterSpacing: "-0.03em", fontWeight: "800" },
        ],
        "display-ar": [
          "clamp(2rem, 4vw, 3rem)",
          { lineHeight: "1.2", letterSpacing: "0", fontWeight: "600" },
        ],
        headline: [
          "2rem",
          { lineHeight: "1.1", letterSpacing: "-0.03em", fontWeight: "800" },
        ],
        title: [
          "1.25rem",
          { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
        body: ["0.875rem", { lineHeight: "1.5", fontWeight: "300" }],
        "body-lg": ["1rem", { lineHeight: "1.5", fontWeight: "400" }],
        label: [
          "0.8125rem",
          { lineHeight: "1.2", letterSpacing: "0.02em", fontWeight: "500" },
        ],
        mono: [
          "0.8125rem",
          { lineHeight: "1.4", letterSpacing: "0.02em", fontWeight: "500" },
        ],
      },
      borderRadius: {
        xs: "8px",
        sm: "10px",
        md: "12px",
        lg: "14px",
        pill: "999px",
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        section: "104px",
      },
      boxShadow: {
        // Raised cards on the light theme (offset + blur, real depth).
        // Elevation is a LEVEL, not a colour. All three resolve through theme
        // variables (see tokens.css) so a card asks for depth and the active
        // theme decides how depth is drawn — a warm 4% wash on Limestone, a
        // deeper and tighter black on Carbon. Overriding Tailwind's own `sm` and
        // `lg` is deliberate: every menu, popover and rail in the product
        // already reaches for those names, and leaving them as Tailwind's fixed
        // rgb(0,0,0,0.05) is exactly how dark mode ended up with cards that had
        // no edge and dropdowns that did not lift off the page.
        sm: "var(--shadow-raised)",
        card: "var(--shadow-card)",
        lg: "var(--shadow-overlay)",
        // Lumen bloom — the aperture's focal glow and AI moments only.
        glow: "0 0 60px rgba(243,171,62,0.18)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        "out-expo": "var(--ease-out-expo)",
        "in-out": "var(--ease-in-out)",
      },
      transitionDuration: {
        instant: "var(--duration-instant)",
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
        slower: "var(--duration-slower)",
      },
      zIndex: {
        base: "0",
        raised: "10",
        sticky: "100",
        header: "200",
        drawer: "300",
        overlay: "400",
        modal: "500",
        popover: "600",
        toast: "700",
        tooltip: "800",
      },
      // Canonical breakpoints (min-width). Reconciled to UI_UX_SYSTEM_GUIDE.md
      // viewports: Mobile 390 (base) · Tablet 768 · Desktop 1024 · Wide 1440.
      // 360/430 are device test widths, not breakpoints.
      screens: {
        tablet: "768px",
        desktop: "1024px",
        wide: "1440px",
      },
    },
  },
  plugins: [],
} satisfies Config;
