import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// jsdom never loads images, yet reports `complete: true` with a zero natural
// width, which a real browser only does for a FAILED image. Report "still
// loading" so SafeImage's pre-hydration failure check only fires in browsers
// (or when a test overrides this on purpose).
if (typeof HTMLImageElement !== "undefined") {
  Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => false });
}
