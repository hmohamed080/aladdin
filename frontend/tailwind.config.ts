import type { Config } from "tailwindcss";

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
        canvas: "var(--canvas)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
        },
        fg: {
          DEFAULT: "var(--fg)",
          secondary: "var(--fg-secondary)",
          muted: "var(--fg-muted)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          solid: "var(--accent-solid)",
        },
        bronze: "var(--bronze-sem)",
        lapis: "var(--lapis-sem)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",
        focus: "var(--focus)",

        // ---- Fixed primitives (brand artwork, mark, seals) ----
        brand: {
          basalt: "var(--basalt)",
          "basalt-2": "var(--basalt-2)",
          "basalt-3": "var(--basalt-3)",
          limestone: "var(--limestone)",
          plaster: "var(--plaster)",
          sand: "var(--sand)",
          ink: "var(--ink)",
          lumen: "var(--lumen)",
          "lumen-deep": "var(--lumen-deep)",
          "lumen-ink": "var(--lumen-ink)",
          "lumen-soft": "var(--lumen-soft)",
          bronze: "var(--bronze)",
          "bronze-deep": "var(--bronze-deep)",
          "bronze-ink": "var(--bronze-ink)",
          lapis: "var(--lapis)",
          "lapis-bright": "var(--lapis-bright)",
          verdigris: "var(--verdigris)",
          "verdigris-deep": "var(--verdigris-deep)",
          ochre: "var(--ochre)",
          "ochre-deep": "var(--ochre-deep)",
          oxide: "var(--oxide)",
          stone: "var(--stone)",
          "stone-muted": "var(--stone-muted)",
          graphite: "var(--graphite)",
        },
      },
      borderColor: {
        DEFAULT: "var(--border)",
        strong: "var(--border-strong)",
      },
      ringColor: {
        DEFAULT: "var(--focus)",
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
        card: "0 1px 2px rgba(20,16,10,0.04), 0 8px 24px rgba(20,16,10,0.05)",
        // Lumen bloom — the aperture's focal glow and AI moments only.
        glow: "0 0 60px rgba(243,171,62,0.18)",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.4,0,0.2,1)",
        "out-expo": "cubic-bezier(0.16,1,0.3,1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
