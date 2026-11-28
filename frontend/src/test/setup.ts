import "@testing-library/jest-dom/vitest";
import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// The browser uploader calls this server action when a send fails (ADR-0032). Its module is server-only, which Next replaces
// with an RPC stub in the browser; tests get the same boundary. Its own behaviour is tested in media-release.test.ts.
vi.mock("@/server/actions/media-release", () => ({ releaseUploadAction: vi.fn(async () => ({ ok: true })) }));
