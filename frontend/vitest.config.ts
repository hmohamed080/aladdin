import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // JSX in tests uses the automatic runtime (no explicit React import needed).
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Node for pure logic; happy-dom (a real DOM) for component/tsx tests.
    environmentMatchGlobs: [
      ["src/**/*.test.tsx", "happy-dom"],
    ],
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
  },
});
