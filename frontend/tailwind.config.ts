import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  // Light + Dark from the design system; toggled via a `dark` class on <html>.
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
